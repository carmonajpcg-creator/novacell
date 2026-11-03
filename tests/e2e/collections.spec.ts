import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Flujo real de cobranza contra Supabase. Datos con prefijo "E2E " (limpieza: tests/integration/cleanup-test-data.sql).
// Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
// Para simular un pago vencido (una cuota no puede crearse en el pasado) se necesita además E2E_DB_URL,
// la URL de Postgres de desarrollo; sin ella la prueba se omite.
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD
const supaUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const dbUrl = process.env.E2E_DB_URL

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

const todayMx = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date())
const plusDays = (iso: string, n: number) => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

test.describe('cobranza (Supabase real)', () => {
  test.skip(!email || !password || !supaUrl || !anonKey || !dbUrl, 'Sin credenciales/URL de Supabase o E2E_DB_URL en el entorno')

  test('cola de vencidos y próximos, recordatorio por WhatsApp sin afirmar el envío y seguimiento', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(240_000)
    const ts = Date.now()
    const api = await adminApi()

    // ---- Datos base: crédito activo con 3 cuotas semanales de 1000; la cuota 1 se vence hace 3 días ----
    const cat = await api.insert('categories', { name: `E2E CatCo ${ts}`, slug: `e2e-catco-${ts}`, kind: 'iphone' })
    const prod = await api.insert('products', { category_id: cat.id, kind: 'iphone', name: `E2E iPhone Co ${ts}`, slug: `e2e-ipco-${ts}` })
    const unitId = await api.rpc('register_unit', {
      p_product_id: prod.id, p_imei: luhnImei(ts), p_serial_number: null, p_storage_gb: 128, p_color: 'Negro', p_condition: 'new',
      p_physical_grade: null, p_battery_health: null, p_acquisition_cost: '2000', p_sale_price: '3000', p_notes: null,
      p_idempotency_key: `e2e-co-unit-${ts}`,
    })
    const customerName = `E2E Cliente Cob ${ts}`
    const customer = await api.insert('customers', { name: customerName, phone: '55 1234 5678'.replace(/\s/g, '') })
    const creditId = await api.rpc('create_credit_sale', {
      p_customer_id: customer.id, p_source: 'whatsapp', p_items: [{ unit_id: unitId }], p_financed_total: '3000',
      p_down_payment: '0', p_frequency: 'weekly', p_installments: 3, p_first_due_date: todayMx(), p_notes: null,
      p_idempotency_key: `e2e-co-credit-${ts}`,
    })
    const sqlFile = join(mkdtempSync(join(tmpdir(), 'novacell-e2e-')), 'backdate.sql')
    writeFileSync(
      sqlFile,
      `update public.installments set due_date = (now() at time zone 'America/Mexico_City')::date - 3 where credit_id = '${creditId}' and number = 1`,
    )
    const backdate = spawnSync('npx', ['supabase', 'db', 'query', `--remote=${dbUrl}`, '--yes', '-f', sqlFile], {
      shell: true,
      encoding: 'utf8',
    })
    expect(backdate.status, `${backdate.stdout}${backdate.stderr}`).toBe(0)

    // WhatsApp nunca se contacta de verdad en las pruebas
    await context.route(/wa\.me/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'wa' }))

    await login(page)

    // ---- Cola de vencidos ----
    await page.goto('/#/admin/cobranza')
    await page.getByLabel('Filtrar por cliente').selectOption({ label: customerName })
    const row = page.getByRole('row', { name: new RegExp(customerName) })
    await expect(row).toHaveCount(1) // en "Vencidos" solo la cuota 1
    await expect(row).toContainText('Vencido hace 3 d')
    await expect(row).toContainText('$1,000.00')
    await expect(row).toContainText('cuota 1')
    await expect(row).toContainText('Sin seguimiento')

    // ---- Recordatorio: preparar, abrir WhatsApp (sin afirmar el envío) ----
    await row.getByRole('button', { name: 'Recordatorio' }).click()
    const dialog = page.getByRole('dialog', { name: 'Recordatorio de cobranza' })
    await expect(dialog).toContainText('Teléfono: 5512345678')
    const message = dialog.getByLabel('Mensaje')
    await expect(message).toHaveValue(/Hola E2E/)
    await expect(message).toHaveValue(/venció el/)
    await expect(message).toHaveValue(/\$1,000\.00/)
    await expect(message).not.toHaveValue(/recargo|penaliz|interés/i)
    await dialog.getByRole('button', { name: 'Preparar recordatorio' }).click()
    await expect(dialog.getByText('Mensaje preparado').first()).toBeVisible()

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      dialog.getByRole('button', { name: 'Abrir WhatsApp' }).click(),
    ])
    expect(popup.url()).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/)
    expect(decodeURIComponent(popup.url())).toContain('venció el')
    await popup.close()
    await expect(dialog.getByText(/WhatsApp abierto \(no confirma el envío\)/).first()).toBeVisible()
    await expect(dialog.getByText(/no confirma que lo hayas enviado/)).toBeVisible()
    await expect(dialog.getByText(/entregado/i)).toHaveCount(0)

    // ---- Seguimiento: promesa de pago exige fecha ----
    await dialog.getByLabel('Resultado del contacto').selectOption('promise_to_pay')
    await dialog.getByRole('button', { name: 'Guardar seguimiento' }).click()
    await expect(dialog.getByText('Indica la fecha en que promete pagar')).toBeVisible()
    await dialog.getByLabel('Fecha prometida').fill(plusDays(todayMx(), 3))
    await dialog.getByLabel('Nota').fill('Pagará el viernes')
    await dialog.getByRole('button', { name: 'Guardar seguimiento' }).click()
    await expect(dialog.getByText(/Resultado:/)).toContainText('Promesa de pago')
    await page.keyboard.press('Escape')

    await expect(row).toContainText('Contactado')
    await expect(row).toContainText('Promesa de pago')

    // ---- Próximos: la cuota 2 vence en 7 días ----
    await page.getByRole('button', { name: 'Próximos', exact: true }).click()
    const upcoming = page.getByRole('row', { name: new RegExp(customerName) })
    await expect(upcoming).toHaveCount(1)
    await expect(upcoming).toContainText('Vence en 7 d')
    await expect(upcoming).toContainText('cuota 2')

    // ---- Todos: las 3 cuotas; un abono que cubre la cuota 1 la saca de la cola ----
    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toHaveCount(3)
    await api.rpc('record_credit_payment', {
      p_credit_id: creditId, p_kind: 'installment', p_method: 'cash', p_amount: '1000', p_reference: null,
      p_idempotency_key: `e2e-co-pay-${ts}`,
    })
    await page.reload()
    await page.getByLabel('Filtrar por cliente').selectOption({ label: customerName })
    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toHaveCount(2)
    await page.getByRole('button', { name: 'Vencidos', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toHaveCount(0)
  })
})
