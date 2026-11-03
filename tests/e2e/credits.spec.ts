import { expect, test, type Page } from '@playwright/test'

// Flujo real de créditos contra Supabase. Datos con prefijo "E2E " (limpieza: tests/integration/cleanup-test-data.sql).
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

test.describe('créditos (Supabase real)', () => {
  test.skip(!email || !password || !supaUrl || !anonKey, 'Sin credenciales/URL de Supabase en el entorno')

  test('flujo completo: crear crédito, enganche, abonos (pendiente/confirmado), reverso, recibo, estado de cuenta y liquidación', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(240_000)
    page.on('dialog', (d) => void d.accept())
    const ts = Date.now()
    const api = await adminApi()

    // ---- Datos base por API ----
    const cat = await api.insert('categories', { name: `E2E CatCr ${ts}`, slug: `e2e-catcr-${ts}`, kind: 'iphone' })
    const prod = await api.insert('products', { category_id: cat.id, kind: 'iphone', name: `E2E iPhone Cr ${ts}`, slug: `e2e-ipcr-${ts}` })
    const imei = luhnImei(ts)
    const unitId = await api.rpc('register_unit', {
      p_product_id: prod.id, p_imei: imei, p_serial_number: null, p_storage_gb: 256, p_color: 'Titanio', p_condition: 'new',
      p_physical_grade: null, p_battery_health: null, p_acquisition_cost: '8000', p_sale_price: '10000', p_notes: null,
      p_idempotency_key: `e2e-cr-unit-${ts}`,
    })
    const customerName = `E2E Cliente Cr ${ts}`
    await api.insert('customers', { name: customerName, phone: '5512345678' })

    await login(page)
    const metric = (label: string) => page.locator('p', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`, 'i') }).locator('xpath=following-sibling::p[1]')

    // ---- Nuevo crédito: validaciones y vista previa ----
    await page.goto('/#/admin/creditos/nuevo')
    await page.getByLabel('Cliente', { exact: true }).selectOption({ label: `${customerName} · 5512345678` })
    const unitOption = await page.locator('#add-unit option', { hasText: `E2E iPhone Cr ${ts}` }).getAttribute('value')
    await page.getByLabel('Agregar iPhone disponible').selectOption(unitOption!)
    await page.getByLabel(/Precio final financiado/).fill('12000')
    await page.getByLabel('Enganche (MXN)').fill('12000')
    await expect(page.getByText('El enganche debe ser menor al precio financiado')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear crédito' })).toBeDisabled()
    await page.getByLabel('Enganche (MXN)').fill('2000')
    await expect(page.getByText(/A financiar tras el enganche/)).toContainText('$10,000.00')
    await expect(page.getByRole('row', { name: /^4\s/ })).toContainText('$2,500.00')
    await page.getByRole('button', { name: 'Crear crédito' }).click()

    await expect(page).toHaveURL(/#\/admin\/creditos\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Pendiente de enganche').first()).toBeVisible()
    await expect(metric('Precio financiado')).toHaveText('$12,000.00')
    await expect(metric('Saldo')).toHaveText('$10,000.00')
    expect((await api.select(`product_units?id=eq.${unitId}&select=status`))[0].status).toBe('reserved')
    await expect(page.getByRole('row', { name: /^1\s/ })).toContainText('$2,500.00')

    // ---- Enganche: parcial en efectivo, resto por transferencia (pendiente → confirmada) ----
    await page.getByRole('button', { name: 'Registrar enganche' }).click()
    await page.getByLabel('Importe (MXN)').fill('500')
    await page.getByRole('button', { name: 'Registrar enganche' }).click()
    await expect(metric('Enganche cobrado')).toContainText('$500.00 de $2,000.00')
    await expect(page.getByText('Pendiente de enganche').first()).toBeVisible()

    await page.getByRole('button', { name: 'Registrar enganche' }).click()
    await page.getByLabel('Método de pago').selectOption('transfer')
    await page.getByLabel('Importe (MXN)').fill('1500')
    await page.getByLabel('Clave de rastreo').fill(`E2EENG${ts}`)
    await page.getByRole('button', { name: 'Registrar enganche' }).click()
    await expect(page.getByText(/por verificar/i).first()).toBeVisible()
    await expect(page.getByText('Pendiente de enganche').first()).toBeVisible() // un pago pendiente no activa el crédito
    await page.getByRole('button', { name: 'Confirmar pago' }).click()
    await expect(page.getByText('Activo', { exact: true }).first()).toBeVisible()
    expect((await api.select(`product_units?id=eq.${unitId}&select=status`))[0].status).toBe('sold')

    // ---- Abono por transferencia: pendiente NO baja el saldo; confirmado sí ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Método de pago').selectOption('transfer')
    await page.getByLabel('Importe (MXN)').fill('1000')
    await page.getByLabel('Clave de rastreo').fill(`E2EABO${ts}`)
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await expect(page.getByText(/Hay \$1,000\.00 por verificar/)).toBeVisible()
    await expect(metric('Saldo')).toHaveText('$10,000.00')
    await page.getByRole('button', { name: 'Confirmar pago' }).click()
    await expect(metric('Saldo')).toHaveText('$9,000.00')
    await expect(metric('Abonado (confirmado)')).toHaveText('$1,000.00')

    // ---- Abono en efectivo que se reparte entre dos cuotas (más antigua primero) ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('2500')
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await expect(metric('Saldo')).toHaveText('$6,500.00')
    await expect(page.getByRole('row', { name: /^1\s/ })).toContainText('Pagada')
    await expect(page.getByRole('row', { name: /^2\s/ })).toContainText('Parcial')

    // ---- Un abono de más es rechazado ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('99999')
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /excede/ })).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(metric('Saldo')).toHaveText('$6,500.00')

    // ---- Reverso: se conserva el registro y se restituye el saldo ----
    const cashRow = page.getByRole('row', { name: /Abono.*Efectivo.*\$2,500\.00/ })
    await cashRow.getByRole('button', { name: 'Revertir' }).click()
    await page.getByRole('button', { name: 'Revertir pago' }).last().click()
    await expect(page.getByText('Escribe el motivo')).toBeVisible()
    await page.getByLabel('Motivo').fill('Abono registrado por error')
    await page.getByRole('button', { name: 'Revertir pago' }).last().click()
    await expect(metric('Saldo')).toHaveText('$9,000.00')
    await expect(page.getByRole('row', { name: /Abono.*Efectivo.*Revertido/ })).toContainText('Abono registrado por error')

    // ---- Recibo del abono confirmado por transferencia ----
    await page.getByRole('row', { name: /Abono.*Transferencia.*Confirmado/ }).getByRole('link', { name: 'Recibo' }).click()
    const receipt = page.getByRole('article', { name: 'Recibo de pago' })
    await expect(receipt).toContainText('$1,000.00')
    await expect(receipt).toContainText(customerName)
    await expect(receipt).toContainText('Cuota 1')
    await page.getByRole('link', { name: 'Volver al crédito' }).click()

    // ---- Estado de cuenta ----
    await page.getByRole('link', { name: 'Estado de cuenta' }).click()
    const statement = page.getByRole('article', { name: 'Estado de cuenta' })
    await expect(statement).toContainText(customerName)
    await expect(statement).toContainText('$9,000.00')
    await expect(statement).toContainText('No es una factura fiscal')
    await page.getByRole('link', { name: 'Volver al crédito' }).click()

    // ---- Liquidación anticipada: pagar todo el saldo ----
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await page.getByLabel('Importe (MXN)').fill('9000')
    await page.getByRole('button', { name: 'Registrar abono' }).click()
    await expect(page.getByText('Liquidado', { exact: true }).first()).toBeVisible()
    await expect(metric('Saldo')).toHaveText('$0.00')
    await expect(page.getByRole('button', { name: 'Registrar abono' })).toHaveCount(0)

    // ---- Listados ----
    await page.goto('/#/admin/abonos')
    await page.getByLabel('Filtrar por estado').selectOption('all')
    await expect(page.getByRole('row', { name: new RegExp(customerName) }).first()).toBeVisible()
    await page.goto('/#/admin/creditos')
    await page.getByLabel('Buscar créditos').fill(customerName)
    await expect(page.getByRole('row', { name: /Liquidado/ })).toBeVisible()
    await page.getByRole('link', { name: /^C-\d+$/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('C-')

    // ---- La venta enlaza al crédito ----
    await page.getByRole('link', { name: /^V-\d+$/ }).click()
    await expect(page.getByText('Venta a crédito')).toBeVisible()
    await expect(page.getByRole('link', { name: /Ver crédito C-/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
  })
})
