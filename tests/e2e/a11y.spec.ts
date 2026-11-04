import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Accesibilidad automática (WCAG 2.0/2.1 A y AA) con axe. No sustituye una revisión manual con lector de pantalla.
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodo(s) · ${v.nodes[0]?.target.join(' ')}`)
  expect(summary, `violaciones de accesibilidad en ${label}`).toEqual([])
}

test.describe('accesibilidad: tienda pública y login', () => {
  for (const [name, path] of [
    ['inicio', '/#/'],
    ['catálogo iPhone', '/#/iphone'],
    ['catálogo accesorios', '/#/accesorios'],
    ['carrito', '/#/carrito'],
    ['contacto', '/#/contacto'],
    ['login', '/#/admin/login'],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('main').or(page.locator('#root > *').first()).first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      await scan(page, name)
    })
  }
})

test.describe('accesibilidad: panel administrativo', () => {
  test.skip(!email || !password, 'Sin E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD')

  test('pantallas del panel', async ({ page, isMobile }) => {
    test.skip(isMobile, 'se revisa en escritorio; la estructura es la misma')
    test.setTimeout(120_000)
    await page.goto('/#/admin/login')
    await page.getByLabel('Correo').fill(email!)
    await page.getByLabel('Contraseña').fill(password!)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL(/#\/admin$/)
    for (const path of ['', 'productos', 'inventario', 'clientes', 'ventas', 'ventas/nueva', 'creditos', 'abonos', 'apartados', 'cobranza', 'entregas', 'reportes', 'configuracion']) {
      await page.goto(`/#/admin/${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await scan(page, `/admin/${path}`)
    }
  })
})
