import { expect, test, type Page } from '@playwright/test'

// Tienda pública contra Supabase real. Los datos de prueba se crean con la sesión del administrador (por API) y la
// tienda se recorre como VISITANTE SIN SESIÓN. Prefijo "E2E " (limpieza: tests/integration/cleanup-test-data.sql).
// Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD
const supaUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function luhnImei(seed: number): string {
  const base = `35${String(seed).padStart(12, '0').slice(-12)}`
  let total = 0
  for (let i = base.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(base[i])
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    total += d
  }
  return base + ((10 - (total % 10)) % 10)
}

async function adminApi() {
  const res = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { access_token } = (await res.json()) as { access_token: string }
  const auth = { apikey: anonKey!, Authorization: `Bearer ${access_token}` }
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(`${supaUrl}${path}`, {
      method,
      headers: { ...auth, 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`)
    return text ? JSON.parse(text) : null
  }
  return {
    insert: (table: string, row: unknown) => call('POST', `/rest/v1/${table}`, row, { Prefer: 'return=representation' }).then((r) => r[0]),
    rpc: (fn: string, args: unknown) => call('POST', `/rest/v1/rpc/${fn}`, args),
    select: (path: string) => call('GET', `/rest/v1/${path}`),
    patch: (path: string, body: unknown) => call('PATCH', `/rest/v1/${path}`, body),
    remove: (path: string) => call('DELETE', `/rest/v1/${path}`),
    upsertSettings: (rows: unknown[]) =>
      call('POST', '/rest/v1/business_settings?on_conflict=key', rows, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    removeFiles: async (paths: string[]) => {
      if (paths.length === 0) return
      await fetch(`${supaUrl}/storage/v1/object/product-images`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      })
    },
    upload: async (path: string, content: Buffer) => {
      const r = await fetch(`${supaUrl}/storage/v1/object/product-images/${path}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'image/png' },
        body: new Uint8Array(content),
      })
      if (!r.ok) throw new Error(`upload ${path} → ${r.status} ${await r.text()}`)
    },
  }
}

type Api = Awaited<ReturnType<typeof adminApi>>

/** Crea un iPhone publicado (1 unidad disponible, 1 reservada), un borrador y un accesorio con 3 variantes. */
async function seed(api: Api, ts: number, tag: string) {
  const catIp = await api.insert('categories', { name: `E2E Tienda iPhone ${tag}${ts}`, slug: `e2e-t-ip-${tag}${ts}`, kind: 'iphone' })
  const catAc = await api.insert('categories', { name: `E2E Tienda Fundas ${tag}${ts}`, slug: `e2e-t-ac-${tag}${ts}`, kind: 'accessory' })
  const prodIp = await api.insert('products', { category_id: catIp.id, kind: 'iphone', name: `E2E iPhone Tienda ${tag}${ts}`, slug: `e2e-iphone-tienda-${tag}${ts}`, description: 'Titanio natural', is_published: true })
  const draft = await api.insert('products', { category_id: catIp.id, kind: 'iphone', name: `E2E Borrador ${tag}${ts}`, slug: `e2e-borrador-${tag}${ts}`, is_published: false })
  const prodAc = await api.insert('products', { category_id: catAc.id, kind: 'accessory', name: `E2E Funda Tienda ${tag}${ts}`, slug: `e2e-funda-tienda-${tag}${ts}`, is_published: true })

  const secrets = { imei: luhnImei(ts), cost: '7777.77', serial: `SERIE-SECRETA-${ts}` }
  const reg = (product: string, imei: string, color: string, cost: string, price: string, extra: Record<string, unknown>, key: string) =>
    api.rpc('register_unit', {
      p_product_id: product, p_imei: imei, p_serial_number: extra.serial ?? null, p_storage_gb: 256, p_color: color,
      p_condition: extra.condition ?? 'used', p_physical_grade: extra.grade ?? null, p_battery_health: extra.battery ?? null,
      p_acquisition_cost: cost, p_sale_price: price, p_notes: 'nota interna secreta', p_idempotency_key: key,
    })
  const unitAvail = await reg(prodIp.id, secrets.imei, 'Negro', secrets.cost, '18500', { serial: secrets.serial, grade: 'Excelente, sin rayones', battery: 91 }, `e2e-st-a-${tag}${ts}`)
  const unitRes = await reg(prodIp.id, luhnImei(ts + 1), 'Rojo', '6000', '17000', {}, `e2e-st-b-${tag}${ts}`)
  await reg(draft.id, luhnImei(ts + 2), 'Azul', '5000', '9000', {}, `e2e-st-c-${tag}${ts}`)
  // reservar la segunda unidad con una venta pendiente
  const customer = await api.insert('customers', { name: `E2E Cliente Tienda ${tag}${ts}` })
  await api.rpc('create_sale', { p_customer_id: customer.id, p_source: 'whatsapp', p_items: [{ unit_id: unitRes }], p_notes: null, p_idempotency_key: `e2e-st-sale-${tag}${ts}` })

  const variant = async (sku: string, color: string, price: string, stock: number) => {
    const v = await api.insert('product_variants', { product_id: prodAc.id, sku, color, compatible_model: 'iPhone 15 Pro', price, cost: '55.55' })
    if (stock > 0) await api.rpc('adjust_variant_stock', { p_variant_id: v.id, p_type: 'entry', p_delta: stock, p_reason: 'E2E', p_idempotency_key: `e2e-st-stock-${sku}` })
    return v
  }
  const vOk = await variant(`E2E-ST-OK-${tag}${ts}`, 'Negro', '299', 10)
  await variant(`E2E-ST-LOW-${tag}${ts}`, 'Rojo', '349', 2)
  await variant(`E2E-ST-ZERO-${tag}${ts}`, 'Azul', '399', 0)

  const path = `${prodIp.id}/${crypto.randomUUID()}.png`
  await api.upload(path, PNG_1X1)
  await api.insert('product_images', { product_id: prodIp.id, storage_path: path, is_primary: true, alt_text: 'Frente del iPhone de prueba' })

  return { prodIp, draft, prodAc, unitAvail, unitRes, vOk, secrets, tag, ts, imagePath: path }
}

/** Recoge todas las respuestas de la API de Supabase que recibe el navegador del visitante. */
function collectApiBodies(page: Page) {
  const bodies: Promise<string>[] = []
  page.on('response', (r) => {
    if (r.url().startsWith(`${supaUrl}/rest/v1/`)) bodies.push(r.text().catch(() => ''))
  })
  return () => Promise.all(bodies).then((all) => all.join('\n'))
}

test.describe('tienda pública (Supabase real, visitante sin sesión)', () => {
  // Ambas pruebas de escritorio modifican los datos de contacto del negocio: se ejecutan una tras otra.
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !password || !supaUrl || !anonKey, 'Sin credenciales/URL de Supabase en el entorno')

  test('visitante: catálogo, ficha, carrito y pedido por WhatsApp sin tocar el inventario ni ver datos privados', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'el flujo completo con datos de contacto corre solo en escritorio')
    test.setTimeout(240_000)
    const ts = Date.now()
    const api = await adminApi()

    let imagePath = '' // se elimina de Storage al terminar para no dejar archivos públicos huérfanos
    // Datos de contacto de prueba: se guardan los valores previos para restaurarlos al terminar
    const keys = ['whatsapp_number', 'business_name', 'business_hours', 'business_address', 'delivery_info']
    const previous = (await api.select(`business_settings?key=in.(${keys.join(',')})&select=key,value,is_public`)) as { key: string; value: unknown; is_public: boolean }[]
    try {
      await api.upsertSettings([
        { key: 'whatsapp_number', value: '5512345678', is_public: true },
        { key: 'business_name', value: 'NovaCell Prueba', is_public: true },
        { key: 'business_hours', value: 'Lunes a sábado de 10:00 a 19:00', is_public: true },
        { key: 'business_address', value: 'Calle Prueba 123, Ciudad de México', is_public: true },
        { key: 'delivery_info', value: 'Entregas a domicilio previa confirmación por WhatsApp', is_public: true },
      ])
      const d = await seed(api, ts, 'd')
      imagePath = d.imagePath
      const getBodies = collectApiBodies(page)
      await context.route(/wa\.me/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'wa' }))

      // ---- Inicio ----
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1, name: 'Tecnología que conecta contigo.' })).toBeVisible()
      await expect(page.getByRole('link', { name: new RegExp(`E2E iPhone Tienda d${ts}`) })).toBeVisible()
      await expect(page.getByText('Ver iPhone')).toBeVisible()

      // ---- Catálogo: solo lo publicado; filtros ----
      await page.getByRole('link', { name: 'iPhone', exact: true }).first().click()
      await expect(page).toHaveURL(/#\/iphone$/)
      await page.getByLabel('Buscar en el catálogo').fill(`tienda d${ts}`)
      await expect(page.getByRole('link', { name: new RegExp(`E2E iPhone Tienda d${ts}`) })).toBeVisible()
      await page.getByLabel('Buscar en el catálogo').fill(`borrador d${ts}`)
      await expect(page.getByText('No encontramos resultados')).toBeVisible() // el borrador no se publica
      await page.getByLabel('Buscar en el catálogo').fill(`tienda d${ts}`)
      await page.getByLabel('Condición').selectOption('new')
      await expect(page.getByText('No encontramos resultados')).toBeVisible() // la unidad es seminueva
      await page.getByLabel('Condición').selectOption('used')
      await expect(page.getByRole('link', { name: new RegExp(`E2E iPhone Tienda d${ts}`) })).toBeVisible()

      // ---- Ficha: la unidad disponible sí, la reservada no; sin datos privados ----
      await page.getByRole('link', { name: new RegExp(`E2E iPhone Tienda d${ts}`) }).click()
      await expect(page.getByRole('heading', { level: 1, name: `E2E iPhone Tienda d${ts}` })).toBeVisible()
      const unitCard = page.getByRole('listitem').filter({ hasText: '256 GB · Negro' })
      await expect(unitCard).toContainText('Seminuevo')
      await expect(unitCard).toContainText('Batería 91%')
      await expect(unitCard).toContainText('Excelente, sin rayones')
      await expect(unitCard).toContainText('$18,500.00')
      await expect(unitCard).toContainText(/Ref\. [0-9A-F]{6}/)
      await expect(page.getByText('256 GB · Rojo')).toHaveCount(0) // reservada: no se publica
      await expect(page.getByRole('img', { name: 'Frente del iPhone de prueba' }).first()).toBeVisible()
      await page.reload() // enlace profundo + recarga
      await expect(page.getByRole('heading', { level: 1, name: `E2E iPhone Tienda d${ts}` })).toBeVisible()

      await page.getByRole('button', { name: 'Agregar al carrito' }).click()
      await expect(page.getByText('Agregado al carrito')).toBeVisible()
      await expect(page.getByTestId('cart-count')).toHaveText('1')
      await expect(page.getByRole('button', { name: 'En el carrito' })).toBeDisabled()

      // ---- Accesorio: disponibilidad como estado, no como cantidad ----
      await page.goto(`/#/producto/${d.prodAc.slug}`)
      await expect(page.getByRole('heading', { level: 1, name: `E2E Funda Tienda d${ts}` })).toBeVisible()
      await expect(page.getByText('Pocas piezas')).toBeVisible()
      await expect(page.getByText('Agotado', { exact: true }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Agotado' })).toBeDisabled()
      const okRow = page.getByRole('listitem').filter({ hasText: 'Negro · para iPhone 15 Pro' })
      await okRow.getByLabel(/Cantidad de/).selectOption('2')
      await okRow.getByRole('button', { name: 'Agregar al carrito' }).click()
      await expect(page.getByTestId('cart-count')).toHaveText('3')

      // ---- Carrito ----
      await page.getByRole('link', { name: /Carrito/ }).click()
      await expect(page.getByRole('heading', { name: 'Tu carrito' })).toBeVisible()
      await expect(page.getByTestId('cart-total')).toHaveText('$19,098.00') // 18,500 + 2 × 299
      await page.getByLabel(/Cantidad de E2E Funda Tienda/).selectOption('3')
      await expect(page.getByTestId('cart-total')).toHaveText('$19,397.00')
      await page.getByLabel(/Cantidad de E2E Funda Tienda/).selectOption('2')

      // ---- Pedido por WhatsApp: abre la conversación pero NO toca el inventario ----
      const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: /Enviar pedido por WhatsApp/ }).click()])
      expect(popup.url()).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/)
      const text = decodeURIComponent(popup.url().split('text=')[1]!)
      expect(text).toContain('Hola NovaCell Prueba, quisiera hacer este pedido')
      expect(text).toContain(`E2E iPhone Tienda d${ts} 256 GB Negro`)
      expect(text).toContain('× 2')
      expect(text).toContain('Total estimado: $19,098.00')
      expect(text).toMatch(/Ref\. [0-9A-F]{6}/)
      expect(text).not.toContain(d.secrets.imei)
      await popup.close()
      await expect(page.getByText(/Aún no es una compra/)).toBeVisible()
      expect((await api.select(`product_units?id=eq.${d.unitAvail}&select=status`))[0].status).toBe('available') // sigue disponible
      expect((await api.select(`product_variants?id=eq.${d.vOk.id}&select=stock_quantity`))[0].stock_quantity).toBe(10) // stock intacto

      // ---- Contacto y entregas ----
      await page.getByRole('link', { name: 'Contacto', exact: true }).first().click()
      await expect(page.getByRole('heading', { name: 'Contacto y entregas' })).toBeVisible()
      const main = page.locator('#contenido')
      await expect(main.getByText('Lunes a sábado de 10:00 a 19:00')).toBeVisible()
      await expect(main.getByText('Calle Prueba 123, Ciudad de México')).toBeVisible()
      await expect(main.getByText('Entregas a domicilio previa confirmación por WhatsApp')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Escribir por WhatsApp' })).toHaveAttribute('href', /wa\.me\/525512345678/)

      // ---- Despublicar: desaparece de la tienda y del carrito guardado ----
      await api.patch(`products?id=eq.${d.prodIp.id}`, { is_published: false })
      await page.goto('/#/carrito')
      await page.reload() // el catálogo en caché dura 60 s: se recarga para ver el cambio al instante
      await expect(page.getByRole('alert')).toContainText('ya no está disponible')
      await expect(page.getByTestId('cart-total')).toHaveText('$598.00') // solo quedan las fundas
      await page.goto('/#/iphone')
      await page.getByLabel('Buscar en el catálogo').fill(`tienda d${ts}`)
      await expect(page.getByText('No encontramos resultados')).toBeVisible()
      await page.goto(`/#/producto/${d.prodIp.slug}`)
      await expect(page.getByText('Este producto ya no está disponible')).toBeVisible()

      // ---- Ninguna respuesta de la API contuvo datos privados ----
      const all = await getBodies()
      expect(all.length).toBeGreaterThan(100)
      expect(all).not.toContain(d.secrets.imei)
      expect(all).not.toContain(d.secrets.serial)
      expect(all).not.toContain('7777.77')
      expect(all).not.toContain('55.55')
      expect(all).not.toContain('nota interna secreta')
      expect(all).not.toMatch(/NC-\d{6}/)
      expect(all).not.toMatch(/acquisition_cost|stock_quantity|"imei"|serial_number|internal_code/)
    } finally {
      await api.removeFiles(imagePath ? [imagePath] : [])
      // Restaurar los datos de contacto previos del negocio
      const before = new Map(previous.map((r) => [r.key, r]))
      const restore = previous.map((r) => ({ key: r.key, value: r.value, is_public: r.is_public }))
      if (restore.length > 0) await api.upsertSettings(restore)
      for (const key of keys) if (!before.has(key)) await api.remove(`business_settings?key=eq.${key}`)
    }
  })

  test('administrador: la configuración del negocio se valida, se guarda y se refleja en la tienda', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(180_000)
    const api = await adminApi()
    const keys = ['whatsapp_number', 'business_name', 'business_hours', 'business_address', 'delivery_info', 'layaway_min_down_percent', 'credit_allowed_frequencies']
    const previous = (await api.select(`business_settings?key=in.(${keys.join(',')})&select=key,value,is_public`)) as { key: string; value: unknown; is_public: boolean }[]
    try {
      await page.goto('/#/admin/login')
      await page.getByLabel('Correo').fill(email!)
      await page.getByLabel('Contraseña').fill(password!)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL(/#\/admin$/)

      await page.goto('/#/admin/configuracion')
      await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible()
      await page.getByLabel('WhatsApp del negocio').fill('12345')
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByText('Ingresa 10 dígitos (sin lada internacional)')).toBeVisible()

      await page.getByLabel('Nombre del negocio').fill('NovaCell E2E')
      await page.getByLabel('WhatsApp del negocio').fill('55 9999 0000')
      await page.getByLabel('Horario de atención').fill('Todos los días de 9:00 a 20:00')
      await page.getByLabel('Anticipo mínimo de un apartado (%)').fill('150')
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByText('Debe ser un porcentaje de 0 a 100')).toBeVisible()
      await page.getByLabel('Anticipo mínimo de un apartado (%)').fill('')
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByText('Configuración guardada')).toBeVisible()

      // se guardó solo con dígitos y es público; las reglas privadas no lo son
      const saved = (await api.select(`business_settings?key=eq.whatsapp_number&select=value,is_public`))[0]
      expect(saved).toEqual({ value: '5599990000', is_public: true })

      await page.goto('/#/contacto')
      await expect(page.locator('#contenido').getByText('Todos los días de 9:00 a 20:00')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Escribir por WhatsApp' })).toHaveAttribute('href', /wa\.me\/525599990000/)

      // una frecuencia de crédito debe quedar habilitada
      await page.goto('/#/admin/configuracion')
      for (const f of ['Semanal', 'Quincenal', 'Mensual']) await page.getByLabel(f).uncheck()
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Habilita al menos una frecuencia' })).toBeVisible()
    } finally {
      const before = new Map(previous.map((r) => [r.key, r]))
      const restore = previous.map((r) => ({ key: r.key, value: r.value, is_public: r.is_public }))
      if (restore.length > 0) await api.upsertSettings(restore)
      for (const key of keys) if (!before.has(key)) await api.remove(`business_settings?key=eq.${key}`)
    }
  })

  test('móvil: inicio, catálogo, ficha y carrito sin desbordar y con navegación visible', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil')
    test.setTimeout(180_000)
    const ts = Date.now()
    const api = await adminApi()
    const d = await seed(api, ts, 'm')
    try {
      for (const path of ['/', '/iphone', '/accesorios', `/producto/${d.prodIp.slug}`, `/producto/${d.prodAc.slug}`, '/carrito', '/contacto']) {
        await page.goto(`/#${path}`)
        await expect(page.getByRole('banner')).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Principal móvil' })).toBeVisible()
        await expect(page.locator('main')).toBeVisible()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        expect(overflow, `desborda en ${path}`).toBe(false)
      }
    } finally {
      await api.removeFiles([d.imagePath])
    }
  })
})
