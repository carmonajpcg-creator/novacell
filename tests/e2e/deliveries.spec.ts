import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// Flujo real de entregas, dashboard y reportes contra Supabase. Los datos llevan el prefijo "E2E " y se limpian con
// tests/integration/cleanup-test-data.sql. Requiere E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, VITE_SUPABASE_URL y
// VITE_SUPABASE_ANON_KEY en el entorno.
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

test.describe('entregas, dashboard y reportes (Supabase real)', () => {
  test.skip(!email || !password || !supaUrl || !anonKey, 'Sin credenciales/URL de Supabase en el entorno')

  test('las pantallas nuevas no desbordan en móvil', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil')
    await login(page)
    for (const path of ['', 'entregas', 'reportes']) {
      await page.goto(`/#/admin/${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(overflow, `desborda en /admin/${path}`).toBe(false)
    }
  })

  test('flujo: programar entrega desde la venta, avanzar estados, dashboard y exportar CSV', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(180_000)
    page.on('dialog', (d) => void d.accept())
    const ts = Date.now()
    const api = await adminApi()

    // ---- Datos base por API: una venta de contado ya cobrada (confirmada) ----
    const cat = await api.insert('categories', { name: `E2E CatEnt ${ts}`, slug: `e2e-catent-${ts}`, kind: 'iphone' })
    const prod = await api.insert('products', { category_id: cat.id, kind: 'iphone', name: `E2E iPhone Ent ${ts}`, slug: `e2e-ent-${ts}` })
    const unitId = await api.rpc('register_unit', {
      p_product_id: prod.id, p_imei: luhnImei(ts), p_serial_number: null, p_storage_gb: 128, p_color: 'Negro',
      p_condition: 'new', p_physical_grade: null, p_battery_health: null, p_acquisition_cost: '1000',
      p_sale_price: '2000', p_notes: null, p_idempotency_key: `e2e-ent-unit-${ts}`,
    })
    const customerName = `E2E Cliente Ent ${ts}`
    const customer = await api.insert('customers', { name: customerName, phone: '5512345678' })
    const saleId = await api.rpc('create_sale', {
      p_customer_id: customer.id, p_source: 'whatsapp', p_items: [{ unit_id: unitId }], p_notes: null, p_idempotency_key: `e2e-ent-sale-${ts}`,
    })
    await api.rpc('record_payment', { p_sale_id: saleId, p_method: 'cash', p_amount: '2000', p_reference: null, p_idempotency_key: `e2e-ent-pay-${ts}` })
    const sale = (await api.select(`sales?id=eq.${saleId}&select=sale_number,status`))[0] as { sale_number: string; status: string }
    expect(sale.status).toBe('confirmed')

    await login(page)

    // ---- Programar entrega desde el detalle de la venta (con validación) ----
    await page.goto(`/#/admin/ventas/${saleId}`)
    await page.getByRole('button', { name: 'Programar entrega' }).click()
    await page.getByLabel('Dirección de entrega').fill('abc')
    await page.getByRole('button', { name: 'Programar entrega' }).last().click()
    await expect(page.getByText('Ingresa la dirección de entrega')).toBeVisible()
    await page.getByLabel('Dirección de entrega').fill('Calle Falsa 123, Col. Centro, CDMX')
    await page.getByLabel('Costo de entrega (MXN)').fill('10.123')
    await page.getByRole('button', { name: 'Programar entrega' }).last().click()
    await expect(page.getByText('Ingresa un importe válido (hasta 2 decimales)')).toBeVisible()
    await page.getByLabel('Costo de entrega (MXN)').fill('150')
    await page.getByRole('button', { name: 'Programar entrega' }).last().click()

    // La venta ahora muestra el enlace a su entrega y ya no ofrece programar otra
    await expect(page.getByRole('link', { name: /Ver entrega E-/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Programar entrega' })).toHaveCount(0)
    // El costo de entrega NO altera el total de la venta
    expect((await api.select(`sales?id=eq.${saleId}&select=total`))[0].total).toBe(2000)

    // ---- Detalle: editar y avanzar estados ----
    await page.getByRole('link', { name: /Ver entrega E-/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E-')
    await expect(page.getByText('Pendiente', { exact: true }).first()).toBeVisible()
    await page.getByLabel('Costo de entrega (MXN)').fill('200')
    await page.getByRole('button', { name: /Guardar/ }).click()
    await expect(page.getByLabel('Costo de entrega (MXN)')).toHaveValue('200')

    await page.getByRole('button', { name: 'Marcar en preparación' }).click()
    await expect(page.getByText('En preparación', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Marcar en camino' }).click()
    await expect(page.getByText('En camino', { exact: true }).first()).toBeVisible()

    // ---- Dashboard: aparece la entrega en curso y las cifras se muestran por separado ----
    await page.goto('/#/admin')
    await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dinero cobrado' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Utilidad estimada' })).toBeVisible()
    await expect(page.getByText(customerName)).toBeVisible()

    // ---- Entregar: estado final, sin botones ni formulario de edición ----
    await page.getByRole('link', { name: /^E-/ }).first().click()
    await page.getByRole('button', { name: 'Marcar entregada' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Entregada el/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Marcar entregada' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancelar entrega' })).toHaveCount(0)
    const delivered = await api.select(`deliveries?sale_id=eq.${saleId}&select=status,delivery_cost`)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].status).toBe('delivered')
    expect(Number(delivered[0].delivery_cost)).toBe(200)

    // ---- Reportes: la venta aparece y el CSV se descarga con la venta ----
    await page.goto('/#/admin/reportes')
    await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resumen' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Detalle de ventas' }).getByText(sale.sale_number)).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()])
    expect(download.suggestedFilename()).toMatch(/^ventas_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(sale.sale_number)
    expect(csv).toContain(customerName)

    // Un rango inválido se explica y no consulta
    await page.getByLabel('Desde').fill('2099-01-01')
    await expect(page.getByRole('alert')).toContainText('no puede ser posterior')
  })
})
