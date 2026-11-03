import { expect, test, type Page } from '@playwright/test'

// Flujo real de apartados contra Supabase. Datos con prefijo "E2E " (limpieza: tests/integration/cleanup-test-data.sql).
// Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el entorno.
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

async function adminApi() {
  const res = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { access_token } = (await res.json()) as { access_token: string }
  const headers = { apikey: anonKey!, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(`${supaUrl}${path}`, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
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

test.describe('apartados (Supabase real)', () => {
  test.skip(!email || !password || !supaUrl || !anonKey, 'Sin credenciales/URL de Supabase en el entorno')

  test('flujo completo: apartar, anticipo por transferencia, abonos, bloqueos de cancelación, liquidar y convertir en venta', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(240_000)
    page.on('dialog', (d) => void d.accept())
    const ts = Date.now()
    const api = await adminApi()

    // ---- Datos base por API ----
    const cat = await api.insert('categories', { name: `E2E CatAp ${ts}`, slug: `e2e-catap-${ts}`, kind: 'iphone' })
    const prod = await api.insert('products', { category_id: cat.id, kind: 'iphone', name: `E2E iPhone Ap ${ts}`, slug: `e2e-ipap-${ts}` })
    const imei = luhnImei(ts)
    const unitId = await api.rpc('register_unit', {
      p_product_id: prod.id, p_imei: imei, p_serial_number: null, p_storage_gb: 256, p_color: 'Titanio', p_condition: 'new',
      p_physical_grade: null, p_battery_health: null, p_acquisition_cost: '8000', p_sale_price: '10000', p_notes: null,
      p_idempotency_key: `e2e-ap-unit-${ts}`,
    })
    const customerName = `E2E Cliente Ap ${ts}`
    await api.insert('customers', { name: customerName, phone: '5512345678' })
    const unitStatus = async () => (await api.select(`product_units?id=eq.${unitId}&select=status`))[0].status

    await login(page)
    const metric = (label: string) => page.locator('p', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`, 'i') }).locator('xpath=following-sibling::p[1]')

    // ---- Nuevo apartado: validaciones ----
    await page.goto('/#/admin/apartados/nuevo')
    await page.getByLabel('Cliente', { exact: true }).selectOption({ label: `${customerName} · 5512345678` })
    const unitOption = await page.locator('#add-unit option', { hasText: `E2E iPhone Ap ${ts}` }).getAttribute('value')
    await page.getByLabel('Agregar iPhone disponible').selectOption(unitOption!)
    await expect(page.getByTestId('layaway-total')).toHaveText('$10,000.00')
    await expect(page.getByRole('button', { name: 'Crear apartado' })).toBeDisabled() // falta el anticipo
    await page.getByLabel(/Anticipo pactado/).fill('20000')
    await expect(page.getByText('El anticipo no puede exceder el total')).toBeVisible()
    await page.getByLabel(/Anticipo pactado/).fill('2000')
    await page.getByRole('button', { name: 'Crear apartado' }).click()

    await expect(page).toHaveURL(/#\/admin\/apartados\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Pendiente de anticipo').first()).toBeVisible()
    await expect(metric('Total del apartado')).toHaveText('$10,000.00')
    await expect(metric('Saldo')).toContainText('$10,000.00')
    expect(await unitStatus()).toBe('reserved')

    // ---- Anticipo por transferencia: pendiente NO cuenta; cancelar exige resolverlo antes ----
    await page.getByRole('button', { name: 'Registrar anticipo' }).click()
    await page.getByLabel('Método de pago').selectOption('transfer')
    await page.getByLabel('Importe (MXN)').fill('2000')
    await page.getByLabel('Clave de rastreo').fill(`E2EAPT${ts}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(metric('Por verificar')).toHaveText('$2,000.00')
    await expect(metric('Cobrado (confirmado)')).toHaveText('$0.00')
    await expect(page.getByText('Pendiente de anticipo').first()).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar apartado' }).first().click()
    await page.getByLabel('Motivo').fill('Cliente desistió')
    await page.getByRole('button', { name: 'Cancelar apartado' }).last().click()
    await expect(page.getByRole('alert').filter({ hasText: /pagos pendientes de verificación/ })).toBeVisible()
    expect(await unitStatus()).toBe('reserved') // no se liberó el equipo
    await page.getByRole('button', { name: 'Volver' }).click()

    await page.getByRole('button', { name: 'Confirmar pago' }).click()
    await expect(page.getByText('Vigente').first()).toBeVisible()
    await expect(metric('Cobrado (confirmado)')).toHaveText('$2,000.00')

    // ---- Abono en efectivo y bloqueo de cancelación con anticipo cobrado ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('3000')
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(metric('Saldo')).toHaveText('$5,000.00')

    await page.getByRole('button', { name: 'Cancelar apartado' }).first().click()
    await page.getByLabel('Motivo').fill('Cliente desistió')
    await page.getByRole('button', { name: 'Cancelar apartado' }).last().click()
    await expect(page.getByRole('alert').filter({ hasText: /política/ })).toBeVisible()
    expect(await unitStatus()).toBe('reserved')
    await page.getByRole('button', { name: 'Volver' }).click()

    // ---- Un abono de más es rechazado ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('99999')
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /excede/ })).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()

    // ---- Liquidar y convertir en venta ----
    await expect(page.getByRole('button', { name: 'Convertir en venta' })).toHaveCount(0) // aún no está liquidado
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('5000')
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(page.getByText('Liquidado').first()).toBeVisible()
    await expect(metric('Saldo')).toHaveText('$0.00')
    expect(await unitStatus()).toBe('reserved') // sigue reservado hasta la entrega
    await expect(page.getByRole('button', { name: 'Registrar abono' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Convertir en venta' }).click()
    await expect(page.getByText('Convertido en venta').first()).toBeVisible()
    expect(await unitStatus()).toBe('sold')
    await expect(page.getByRole('button', { name: 'Cancelar apartado' })).toHaveCount(0)

    // ---- Comprobante de la venta resultante ----
    await page.getByRole('link', { name: 'Comprobante de venta' }).click()
    const receipt = page.getByRole('article', { name: 'Comprobante de venta' })
    await expect(receipt).toContainText(customerName)
    await expect(receipt).toContainText(`IMEI ${imei}`)
    await expect(receipt).toContainText('$10,000.00')
    await expect(receipt).toContainText('No es una factura fiscal')

    // ---- Listados y enlace desde la venta ----
    await page.goto('/#/admin/apartados')
    await page.getByLabel('Buscar apartados').fill(customerName)
    await expect(page.getByRole('row', { name: /Convertido en venta/ })).toBeVisible()
    await page.getByRole('link', { name: /^A-\d+$/ }).click()
    await page.getByRole('link', { name: /^V-\d+$/ }).click()
    await expect(page.getByText('Venta por apartado')).toBeVisible()
    await expect(page.getByRole('link', { name: /Ver apartado A-/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
  })
})
