import { createClient } from '@supabase/supabase-js'

// Detecta (y con --apply elimina) fotografías huérfanas: archivos del bucket "product-images" sin fila en product_images.
// Las fotos de un producto borrado seguirían siendo públicas por URL. Usa la sesión del administrador (nunca service_role).
// Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Sin --apply solo informa.
const { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!E2E_ADMIN_EMAIL || !E2E_ADMIN_PASSWORD || !VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('Faltan E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const BUCKET = 'product-images'

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error: authError } = await supabase.auth.signInWithPassword({ email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD })
if (authError) {
  console.error('No se pudo iniciar sesión:', authError.message)
  process.exit(1)
}

const { data: rows, error: rowsError } = await supabase.from('product_images').select('storage_path')
if (rowsError) throw rowsError
const referenced = new Set(rows.map((r) => r.storage_path))

const orphans = []
let total = 0
const { data: folders, error: listError } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
if (listError) throw listError
for (const folder of folders) {
  // En la raíz solo hay carpetas (una por producto); un archivo suelto también se evalúa.
  if (folder.id !== null) {
    total++
    if (!referenced.has(folder.name)) orphans.push(folder.name)
    continue
  }
  const { data: files, error } = await supabase.storage.from(BUCKET).list(folder.name, { limit: 1000 })
  if (error) throw error
  for (const f of files) {
    total++
    const path = `${folder.name}/${f.name}`
    if (!referenced.has(path)) orphans.push(path)
  }
}

console.log(`Archivos en Storage: ${total} · referenciados: ${referenced.size} · huérfanos: ${orphans.length}`)
if (orphans.length > 0 && apply) {
  const { error } = await supabase.storage.from(BUCKET).remove(orphans)
  if (error) throw error
  console.log(`Eliminados ${orphans.length} archivos huérfanos.`)
} else if (orphans.length > 0) {
  console.log('Ejecuta con --apply para eliminarlos.')
}
