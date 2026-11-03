import { expect, test } from '@playwright/test'

// Requiere un proyecto de Supabase real y credenciales por entorno (nunca en el repo):
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD

test.describe('login administrativo (Supabase real)', () => {
  test.skip(!email || !password, 'Sin E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD')

  test('credenciales incorrectas muestran error', async ({ page }) => {
    await page.goto('/#/admin/login')
    await page.getByLabel('Correo').fill(email!)
    await page.getByLabel('Contraseña').fill('contraseña-incorrecta-123')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos')
    await expect(page).toHaveURL(/#\/admin\/login$/)
  })

  test('el admin entra al panel, recarga y cierra sesión', async ({ page }) => {
    await page.goto('/#/admin/login')
    await page.getByLabel('Correo').fill(email!)
    await page.getByLabel('Contraseña').fill(password!)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL(/#\/admin$/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.reload() // la sesión persiste
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Salir' }).click()
    await page.goto('/#/admin')
    await expect(page).toHaveURL(/#\/admin\/login$/)
  })
})
