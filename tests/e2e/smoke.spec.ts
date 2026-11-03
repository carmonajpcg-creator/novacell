import { expect, test } from '@playwright/test'

test('la página principal carga', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Tecnología que conecta contigo.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'NovaCell, inicio' })).toBeVisible()
})

test('/admin sin sesión redirige al login', async ({ page }) => {
  await page.goto('/#/admin')
  await expect(page).toHaveURL(/#\/admin\/login$/)
  await expect(page.getByLabel('Correo')).toBeVisible()
})

test('enlace profundo del login sobrevive a una recarga', async ({ page }) => {
  await page.goto('/#/admin/login')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
})

test('ruta inexistente muestra 404', async ({ page }) => {
  await page.goto('/#/no-existe')
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible()
})

test('el login no desborda horizontalmente', async ({ page }) => {
  await page.goto('/#/admin/login')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
})
