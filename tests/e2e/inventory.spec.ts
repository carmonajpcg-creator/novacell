import { expect, test, type Page } from '@playwright/test'

// Flujo real contra Supabase. Los datos llevan el prefijo "E2E" para poder limpiarlos después.
// Requiere E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (nunca en el repo).
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function login(page: Page) {
  await page.goto('/#/admin/login')
  await page.getByLabel('Correo').fill(email!)
  await page.getByLabel('Contraseña').fill(password!)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/#\/admin$/)
}

test.describe('inventario (Supabase real)', () => {
  test.skip(!email || !password, 'Sin E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD')

  test('las pantallas de inventario no desbordan en móvil', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil')
    await login(page)
    for (const path of ['productos', 'inventario', 'clientes', 'ventas', 'ventas/nueva', 'creditos', 'creditos/nuevo', 'abonos', 'apartados', 'apartados/nuevo', 'cobranza']) {
      await page.goto(`/#/admin/${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, `desborda en /admin/${path}`).toBe(false)
    }
  })

  test('flujo completo: categoría, producto, variantes, stock, fotos e iPhone por IMEI', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el flujo que escribe datos corre solo en escritorio')
    test.setTimeout(120_000)
    page.on('dialog', (d) => void d.accept())
    const ts = Date.now()
    const catAcc = `E2E Fundas ${ts}`
    const catIp = `E2E iPhone ${ts}`
    const prodAcc = `E2E Funda ${ts}`
    const prodIp = `E2E iPhone 15 ${ts}`
    const sku = `E2E-${ts}`

    await login(page)

    // ---- Categorías ----
    await page.goto('/#/admin/productos')
    await page.getByRole('button', { name: 'Categorías' }).click()
    for (const [name, kind] of [
      [catAcc, 'accessory'],
      [catIp, 'iphone'],
    ] as const) {
      await page.getByRole('button', { name: 'Nueva categoría' }).click()
      await page.getByLabel('Nombre').fill(name)
      await page.getByLabel('Tipo').selectOption(kind)
      await page.getByRole('button', { name: 'Crear' }).click()
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
    }
    // Validación: nombre vacío
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByRole('button', { name: 'Crear' }).click()
    await expect(page.getByText('Ingresa un nombre')).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()

    // ---- Productos ----
    await page.getByRole('button', { name: 'Productos', exact: true }).click()
    for (const [name, cat] of [
      [prodAcc, `${catAcc} (Accesorio)`],
      [prodIp, `${catIp} (iPhone)`],
    ] as const) {
      await page.getByRole('button', { name: 'Nuevo producto' }).click()
      await page.getByLabel('Nombre').fill(name)
      await page.getByLabel('Categoría').selectOption({ label: cat })
      await page.getByRole('button', { name: 'Crear producto' }).click()
      await expect(page.getByRole('link', { name })).toBeVisible()
    }

    // ---- Accesorio: variante + stock ----
    await page.getByRole('link', { name: prodAcc }).click()
    await expect(page.getByRole('heading', { level: 1, name: prodAcc })).toBeVisible()
    await page.getByRole('button', { name: 'Nueva variante' }).click()
    await page.getByLabel('SKU').fill(sku)
    await page.getByLabel('Color', { exact: true }).fill('Negro')
    await page.getByLabel('Modelo compatible').fill('iPhone 15 Pro')
    await page.getByLabel('Precio (MXN)').fill('299')
    await page.getByLabel('Costo (MXN)').fill('90')
    await page.getByRole('button', { name: 'Guardar' }).click()
    const row = page.getByRole('row', { name: new RegExp(sku) })
    await expect(row).toContainText('Negro')
    await expect(row).toContainText('$299.00')

    const move = async (kind: string, qty: string, reason = '') => {
      await row.getByRole('button', { name: 'Mover stock' }).click()
      await page.getByLabel('Tipo de movimiento').selectOption(kind)
      await page.getByLabel('Cantidad').fill(qty)
      if (reason) await page.getByLabel('Motivo').fill(reason)
      await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    }
    await move('entry', '10')
    await expect(row.getByRole('cell', { name: '10', exact: true })).toBeVisible()
    await move('exit', '3')
    await expect(row.getByRole('cell', { name: '7', exact: true })).toBeVisible()
    // No se permite stock negativo
    await row.getByRole('button', { name: 'Mover stock' }).click()
    await page.getByLabel('Tipo de movimiento').selectOption('exit')
    await page.getByLabel('Cantidad').fill('8')
    await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Existencias insuficientes' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(row.getByRole('cell', { name: '7', exact: true })).toBeVisible()
    // Un ajuste exige motivo
    await row.getByRole('button', { name: 'Mover stock' }).click()
    await page.getByLabel('Tipo de movimiento').selectOption('adjustment_down')
    await page.getByLabel('Cantidad').fill('1')
    await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    await expect(page.getByText('Un ajuste requiere un motivo')).toBeVisible()
    await page.getByLabel('Motivo').fill('Merma de prueba')
    await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    await expect(row.getByRole('cell', { name: '6', exact: true })).toBeVisible()

    // ---- Fotografías: subir y eliminar ----
    await page.getByLabel('Seleccionar fotografías').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    })
    const photo = page.getByRole('img', { name: 'Fotografía del producto' })
    await expect(photo).toBeVisible()
    await expect(page.getByText('Principal', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Eliminar fotografía' }).click()
    await expect(page.getByText('Sin fotografías')).toBeVisible()
    // Tipo de archivo no permitido
    await page.getByLabel('Seleccionar fotografías').setInputFiles({
      name: 'doc.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hola'),
    })
    await expect(page.getByText('Solo se permiten JPG, PNG o WebP')).toBeVisible()

    // ---- iPhone por IMEI ----
    await page.goto('/#/admin/productos')
    await page.getByRole('link', { name: prodIp }).click()
    await expect(page.getByRole('heading', { level: 1, name: prodIp })).toBeVisible()
    const fillUnit = async (imei: string) => {
      await page.getByLabel('IMEI', { exact: true }).fill(imei)
      await page.getByLabel('Capacidad (GB)').fill('256')
      await page.getByLabel('Color', { exact: true }).fill('Titanio')
      await page.getByLabel('Costo de adquisición (MXN)').fill('18000')
      await page.getByLabel('Precio de venta (MXN)').fill('22500')
    }
    await page.getByRole('button', { name: 'Registrar iPhone' }).click()
    await fillUnit('490154203237519') // dígito verificador incorrecto
    await page.getByRole('button', { name: 'Registrar', exact: true }).click()
    await expect(page.getByText(/IMEI inválido/)).toBeVisible()
    await page.getByLabel('IMEI', { exact: true }).fill('490154203237518')
    await page.getByRole('button', { name: 'Registrar', exact: true }).click()
    const unitRow = page.getByRole('row', { name: /NC-/ })
    await expect(unitRow).toContainText('•••••••••••7518') // IMEI enmascarado
    await expect(unitRow).toContainText('Disponible')
    await unitRow.getByRole('button', { name: 'Mostrar IMEI' }).click()
    await expect(unitRow).toContainText('490154203237518')

    // IMEI duplicado
    await page.getByRole('button', { name: 'Registrar iPhone' }).click()
    await fillUnit('490154203237518')
    await page.getByRole('button', { name: 'Registrar', exact: true }).click()
    await expect(page.getByText('Ya existe una unidad con ese IMEI')).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()

    // Desactivar y reactivar
    await unitRow.getByRole('button', { name: 'Desactivar' }).click()
    await expect(unitRow).toContainText('Inactiva')
    await unitRow.getByRole('button', { name: 'Activar' }).click()
    await expect(unitRow).toContainText('Disponible')

    // ---- Inventario global ----
    await page.goto('/#/admin/inventario')
    await page.getByLabel('Buscar unidades').fill('7518')
    await expect(page.getByRole('row', { name: new RegExp(prodIp) })).toBeVisible()
    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByRole('row', { name: new RegExp(sku) }).first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Merma de prueba/ })).toBeVisible()
  })
})
