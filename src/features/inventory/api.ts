import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/slug'
import {
  blankToNull,
  toStockMovement,
  type CategoryValues,
  type ProductValues,
  type StockValues,
  type UnitValues,
  type VariantValues,
} from './schemas'
import type {
  Category,
  InventoryMovement,
  Product,
  ProductImage,
  ProductUnit,
  ProductVariant,
} from './types'

export const IMAGES_BUCKET = 'product-images'

/** Resuelve una consulta de Supabase o lanza su error. El tipo T lo declara quien llama (sin tipos generados de la BD). */
async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

// ----- Categorías -----
export const listCategories = (c: SupabaseClient) =>
  unwrap<Category[]>(c.from('categories').select('*').order('kind').order('sort_order').order('name'))

export const createCategory = (c: SupabaseClient, v: CategoryValues) =>
  unwrap(c.from('categories').insert({ name: v.name, kind: v.kind, slug: slugify(v.name) }).select().single())

export const updateCategory = (c: SupabaseClient, id: string, patch: Partial<Pick<Category, 'name' | 'is_active'>>) =>
  unwrap(c.from('categories').update(patch).eq('id', id).select().single())

export const deleteCategory = (c: SupabaseClient, id: string) =>
  unwrap(c.from('categories').delete().eq('id', id))

// ----- Productos -----
export const listProducts = (c: SupabaseClient) =>
  unwrap<Product[]>(c.from('products').select('*, category:categories(name)').order('name'))

export const getProduct = (c: SupabaseClient, id: string) =>
  unwrap<Product>(c.from('products').select('*, category:categories(name)').eq('id', id).single())

export const createProduct = (c: SupabaseClient, v: ProductValues, kind: Product['kind']) =>
  unwrap<Product>(
    c
      .from('products')
      .insert({
        name: v.name,
        category_id: v.category_id,
        kind,
        slug: `${slugify(v.name)}-${crypto.randomUUID().slice(0, 6)}`,
        description: blankToNull(v.description),
        is_published: v.is_published,
        is_active: v.is_active,
      })
      .select()
      .single(),
  )

export const updateProduct = (c: SupabaseClient, id: string, v: Pick<ProductValues, 'name' | 'description' | 'is_published' | 'is_active'>) =>
  unwrap(
    c
      .from('products')
      .update({
        name: v.name,
        description: blankToNull(v.description),
        is_published: v.is_published,
        is_active: v.is_active,
      })
      .eq('id', id)
      .select()
      .single(),
  )

/**
 * Borra un producto vacío. Sus fotografías se eliminan primero de Storage: borrar la fila en cascada no borra los
 * archivos, que seguirían siendo públicos por URL (hallazgo de la revisión de seguridad). Si el producto tiene
 * unidades, variantes o historial, la clave foránea lo impide y las fotos NO se tocan.
 */
export async function deleteProduct(c: SupabaseClient, id: string) {
  const [units, variants] = await Promise.all([
    c.from('product_units').select('id', { count: 'exact', head: true }).eq('product_id', id),
    c.from('product_variants').select('id', { count: 'exact', head: true }).eq('product_id', id),
  ])
  if (units.error) throw units.error
  if (variants.error) throw variants.error
  if ((units.count ?? 0) > 0 || (variants.count ?? 0) > 0) {
    throw { code: '23503', message: 'El producto tiene unidades o variantes' }
  }
  const images = await unwrap<{ storage_path: string }[]>(c.from('product_images').select('storage_path').eq('product_id', id))
  const paths = images.map((i) => i.storage_path)
  if (paths.length > 0) {
    const { error } = await c.storage.from(IMAGES_BUCKET).remove(paths)
    if (error) throw error
  }
  return unwrap(c.from('products').delete().eq('id', id))
}

// ----- Variantes (accesorios) -----
export const listVariants = (c: SupabaseClient, productId: string) =>
  unwrap<ProductVariant[]>(c.from('product_variants').select('*').eq('product_id', productId).order('sku'))

export const createVariant = (c: SupabaseClient, productId: string, v: VariantValues) =>
  unwrap(
    c
      .from('product_variants')
      .insert({
        product_id: productId,
        sku: v.sku,
        color: blankToNull(v.color),
        compatible_model: blankToNull(v.compatible_model),
        price: v.price,
        cost: v.cost,
        is_active: v.is_active,
      })
      .select()
      .single(),
  )

export const updateVariant = (c: SupabaseClient, id: string, v: VariantValues) =>
  unwrap(
    c
      .from('product_variants')
      .update({
        sku: v.sku,
        color: blankToNull(v.color),
        compatible_model: blankToNull(v.compatible_model),
        price: v.price,
        cost: v.cost,
        is_active: v.is_active,
      })
      .eq('id', id)
      .select()
      .single(),
  )

/** Mueve existencias mediante RPC transaccional (sin negativos, con historial e idempotencia). */
export const adjustVariantStock = (c: SupabaseClient, variantId: string, v: StockValues, key: string) => {
  const { type, delta } = toStockMovement(v)
  return unwrap<number>(
    c.rpc('adjust_variant_stock', {
      p_variant_id: variantId,
      p_type: type,
      p_delta: delta,
      p_reason: blankToNull(v.reason),
      p_idempotency_key: key,
    }),
  )
}

// ----- Unidades iPhone -----
export const listUnits = (c: SupabaseClient) =>
  unwrap<ProductUnit[]>(
    c.from('product_units').select('*, product:products(name)').order('created_at', { ascending: false }),
  )

export const listUnitsByProduct = (c: SupabaseClient, productId: string) =>
  unwrap<ProductUnit[]>(
    c.from('product_units').select('*').eq('product_id', productId).order('created_at', { ascending: false }),
  )

export const registerUnit = (c: SupabaseClient, productId: string, v: UnitValues, key: string) =>
  unwrap<string>(
    c.rpc('register_unit', {
      p_product_id: productId,
      p_imei: v.imei,
      p_serial_number: blankToNull(v.serial_number),
      p_storage_gb: Number(v.storage_gb),
      p_color: v.color,
      p_condition: v.condition,
      p_physical_grade: blankToNull(v.physical_grade),
      p_battery_health: v.battery_health.trim() === '' ? null : Number(v.battery_health),
      p_acquisition_cost: v.acquisition_cost,
      p_sale_price: v.sale_price,
      p_notes: blankToNull(v.notes),
      p_idempotency_key: key,
    }),
  )

export const updateUnit = (c: SupabaseClient, id: string, v: UnitValues) =>
  unwrap(
    c
      .from('product_units')
      .update({
        imei: v.imei,
        serial_number: blankToNull(v.serial_number),
        storage_gb: Number(v.storage_gb),
        color: v.color,
        condition: v.condition,
        physical_grade: blankToNull(v.physical_grade),
        battery_health: v.battery_health.trim() === '' ? null : Number(v.battery_health),
        acquisition_cost: v.acquisition_cost,
        sale_price: v.sale_price,
        notes: blankToNull(v.notes),
      })
      .eq('id', id)
      .select()
      .single(),
  )

export const setUnitActive = (c: SupabaseClient, unitId: string, active: boolean, reason: string, key: string) =>
  unwrap<string>(
    c.rpc('set_unit_active', {
      p_unit_id: unitId,
      p_active: active,
      p_reason: reason,
      p_idempotency_key: key,
    }),
  )

// ----- Movimientos -----
export const listMovements = (c: SupabaseClient, limit = 100) =>
  unwrap<InventoryMovement[]>(
    c
      .from('inventory_movements')
      .select(
        'id, movement_type, quantity_delta, stock_after, reason, created_at, unit:product_units(internal_code, product:products(name)), variant:product_variants(sku, product:products(name))',
      )
      .order('created_at', { ascending: false })
      .limit(limit),
  )

// ----- Fotografías -----
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function validateImageFile(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Solo se permiten JPG, PNG o WebP'
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen no debe superar 5 MB'
  return null
}

export const listImages = (c: SupabaseClient, productId: string) =>
  unwrap<ProductImage[]>(
    c.from('product_images').select('*').eq('product_id', productId).order('sort_order').order('created_at'),
  )

export const imageUrl = (c: SupabaseClient, path: string) =>
  c.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl

export async function uploadImage(c: SupabaseClient, productId: string, file: File, makePrimary: boolean) {
  const problem = validateImageFile(file)
  if (problem) throw new Error(problem)
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${productId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await c.storage.from(IMAGES_BUCKET).upload(path, file, { contentType: file.type })
  if (upErr) throw upErr
  const { error } = await c
    .from('product_images')
    .insert({ product_id: productId, storage_path: path, is_primary: makePrimary })
  if (error) {
    await c.storage.from(IMAGES_BUCKET).remove([path]) // no dejar archivos huérfanos
    throw error
  }
}

export async function deleteImage(c: SupabaseClient, image: ProductImage) {
  // Primero el archivo: si falla, la fila sigue y se puede reintentar. Al revés quedaría un archivo público huérfano.
  const { error: fileError } = await c.storage.from(IMAGES_BUCKET).remove([image.storage_path])
  if (fileError) throw fileError
  const { error } = await c.from('product_images').delete().eq('id', image.id)
  if (error) throw error
}

export async function setPrimaryImage(c: SupabaseClient, productId: string, imageId: string) {
  // Primero se retira la principal actual: el índice único admite solo una por producto.
  const { error: e1 } = await c
    .from('product_images')
    .update({ is_primary: false })
    .eq('product_id', productId)
    .is('product_unit_id', null)
  if (e1) throw e1
  const { error: e2 } = await c.from('product_images').update({ is_primary: true }).eq('id', imageId)
  if (e2) throw e2
}
