import { expect, test, type Page } from '@playwright/test'

// Flujo real de ventas contra Supabase. Los datos llevan el prefijo "E2E " y se limpian con
// tests/integration/cleanup-test-data.sql. Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD,
// VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (claves públicas) en el entorno.
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD
const supaUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

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

async function login(page: Page) {
  await page.goto('/#/admin/login')
  await page.getByLabel('Correo').fill(email!)
  await page.getByLabel('Contraseña').fill(password!)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/#\/admin$/)
}

/** Cliente REST autenticado como el admin (misma sesión que usa la app). */
async function adminApi() {
  const res = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { access_token } = (await res.json()) as { access_token: string }
  const headers = { apikey: anonKey!, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(`${supaUrl}${path}`, {
      method,
      headers: { ...headers, ...extra },
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
  }
}

test.describe('ventas de contado (Supabase real)', () => {
  test.skip(!email || !password || !supaUrl || !anonKey, 'Sin credenciales/URL de Supabase en el entorno')

  test('flujo completo: cliente, venta, pagos (efectivo y transferencia), comprobante y cancelación', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(180_000)
    page.on('dialog', (d) => void d.accept())
    const ts = Date.now()
    const api = await adminApi()

    // ---- Datos base por API ----
    const catIp = await api.insert('categories', { name: `E2E CatIP ${ts}`, slug: `e2e-catip-${ts}`, kind: 'iphone' })
    const catAc = await api.insert('categories', { name: `E2E CatAC ${ts}`, slug: `e2e-catac-${ts}`, kind: 'accessory' })
    const prodIp = await api.insert('products', { category_id: catIp.id, kind: 'iphone', name: `E2E iPhone ${ts}`, slug: `e2e-ip-${ts}` })
    const prodAc = await api.insert('products', { category_id: catAc.id, kind: 'accessory', name: `E2E Funda ${ts}`, slug: `e2e-fun-${ts}` })
    const imei = luhnImei(ts)
    const unitId = await api.rpc('register_unit', {
      p_product_id: prodIp.id, p_imei: imei, p_serial_number: null, p_storage_gb: 256, p_color: 'Titanio',
      p_condition: 'new', p_physical_grade: null, p_battery_health: null, p_acquisition_cost: '15000',
      p_sale_price: '20000', p_notes: null, p_idempotency_key: `e2e-unit-${ts}`,
    })
    const variant = await api.insert('product_variants', { product_id: prodAc.id, sku: `E2E-${ts}`, color: 'Negro', price: '100', cost: '30' })
    await api.rpc('adjust_variant_stock', { p_variant_id: variant.id, p_type: 'entry', p_delta: 3, p_reason: 'E2E', p_idempotency_key: `e2e-stock-${ts}` })

    await login(page)

    // ---- Cliente (con validación) ----
    const customerName = `E2E Cliente ${ts}`
    await page.goto('/#/admin/clientes')
    await page.getByRole('button', { name: 'Nuevo cliente' }).click()
    await page.getByLabel('Nombre').fill(customerName)
    await page.getByLabel('Teléfono').fill('123')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Ingresa un teléfono de 10 dígitos')).toBeVisible()
    await page.getByLabel('Teléfono').fill('55 1234 5678')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('link', { name: customerName })).toBeVisible()

    // ---- Nueva venta: iPhone (precio ajustado) + 2 fundas ----
    await page.goto('/#/admin/ventas/nueva')
    await page.getByLabel('Cliente', { exact: true }).selectOption({ label: `${customerName} · 5512345678` })
    const unitOption = await page.locator('#add-unit option', { hasText: `E2E iPhone ${ts}` }).getAttribute('value')
    await page.getByLabel('Agregar iPhone disponible').selectOption(unitOption!)
    const varOption = await page.locator('#add-variant option', { hasText: `E2E-${ts}` }).getAttribute('value')
    await page.getByLabel('Agregar accesorio con existencias').selectOption(varOption!)
    await page.getByLabel(new RegExp(`Cantidad de E2E Funda ${ts}`)).fill('2')
    await page.getByLabel(new RegExp(`Precio de E2E iPhone ${ts}`)).fill('19000')
    await expect(page.getByTestId('sale-total')).toHaveText('$19,200.00')
    await page.getByRole('button', { name: 'Crear venta' }).click()

    await expect(page).toHaveURL(/#\/admin\/ventas\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Pendiente', { exact: true }).first()).toBeVisible()
    const metric = (label: string) => page.locator('p', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`, 'i') }).locator('xpath=following-sibling::p[1]')
    await expect(metric('Venta registrada')).toHaveText('$19,200.00')
    await expect(metric('Cobrado (confirmado)')).toHaveText('$0.00')
    // El stock del accesorio se descontó al crear la venta
    expect((await api.select(`product_variants?id=eq.${variant.id}&select=stock_quantity`))[0].stock_quantity).toBe(1)

    // ---- Pago en efectivo: parcial, no confirma la venta ----
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await page.getByLabel('Importe (MXN)').fill('200')
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(metric('Cobrado (confirmado)')).toHaveText('$200.00')
    await expect(page.getByText('Confirmado', { exact: true })).toHaveCount(1) // el pago en efectivo
    await expect(page.getByText('Confirmada', { exact: true })).toHaveCount(0) // la venta sigue pendiente
    await expect(page.getByText('Pendiente', { exact: true }).first()).toBeVisible()

    // ---- Transferencia: queda por verificar y NO cuenta como cobrada ----
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await page.getByLabel('Método de pago').selectOption('transfer')
    await page.getByLabel('Importe (MXN)').fill('19000')
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(page.getByText('Una transferencia requiere la clave de rastreo')).toBeVisible()
    await page.getByLabel('Clave de rastreo').fill(`E2EREF${ts}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(metric('Por verificar')).toHaveText('$19,000.00')
    await expect(metric('Cobrado (confirmado)')).toHaveText('$200.00')
    await expect(metric('Por cobrar')).toHaveText('$0.00')
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0) // no se puede cobrar de más

    // ---- Confirmar la transferencia verificada → venta confirmada ----
    await page.getByRole('button', { name: 'Confirmar pago' }).click()
    await expect(metric('Cobrado (confirmado)')).toHaveText('$19,200.00')
    await expect(page.getByRole('link', { name: 'Comprobante' })).toBeVisible()
    expect((await api.select(`product_units?id=eq.${unitId}&select=status`))[0].status).toBe('sold')

    // ---- Comprobante ----
    await page.getByRole('link', { name: 'Comprobante' }).click()
    const receipt = page.getByRole('article', { name: 'Comprobante de venta' })
    await expect(receipt).toContainText(customerName)
    await expect(receipt).toContainText(`IMEI ${imei}`)
    await expect(receipt).toContainText('$19,200.00')
    await expect(receipt).toContainText('No es una factura fiscal')

    // ---- Inventario muestra el equipo como vendido ----
    await page.goto('/#/admin/inventario')
    await page.getByLabel('Buscar unidades').fill(imei.slice(-6))
    await expect(page.getByRole('row', { name: /Vendida/ })).toBeVisible()

    // ---- Segunda venta: cancelar libera inventario y rechaza el pago pendiente ----
    await page.goto('/#/admin/ventas/nueva')
    await page.getByLabel('Cliente', { exact: true }).selectOption({ label: `${customerName} · 5512345678` })
    const varOption2 = await page.locator('#add-variant option', { hasText: `E2E-${ts}` }).getAttribute('value')
    await page.getByLabel('Agregar accesorio con existencias').selectOption(varOption2!)
    await page.getByRole('button', { name: 'Crear venta' }).click()
    await expect(page).toHaveURL(/#\/admin\/ventas\/[0-9a-f-]{36}$/)
    expect((await api.select(`product_variants?id=eq.${variant.id}&select=stock_quantity`))[0].stock_quantity).toBe(0)
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await page.getByLabel('Método de pago').selectOption('transfer')
    await page.getByLabel('Clave de rastreo').fill(`E2EREFB${ts}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(page.getByText('Pendiente de verificar')).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar venta' }).first().click()
    await page.getByRole('button', { name: 'Cancelar venta' }).last().click()
    await expect(page.getByText('Escribe el motivo')).toBeVisible()
    await page.getByLabel('Motivo').fill('Cliente desistió')
    await page.getByRole('button', { name: 'Cancelar venta' }).last().click()
    await expect(page.getByRole('status').filter({ hasText: /Venta cancelada/ })).toBeVisible()
    await expect(page.getByText('Rechazado')).toBeVisible()
    expect((await api.select(`product_variants?id=eq.${variant.id}&select=stock_quantity`))[0].stock_quantity).toBe(1)

    // ---- Historial del cliente ----
    await page.goto('/#/admin/clientes')
    await page.getByRole('link', { name: customerName }).click()
    await expect(page.getByRole('row', { name: /V-\d+.*Confirmada/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /V-\d+.*Cancelada/ })).toBeVisible()
  })
})
