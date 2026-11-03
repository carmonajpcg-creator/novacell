import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as catalogApi from '@/features/catalog/api'
import {
  addLine, buildOrderMessage, cartCount, cartTotalCents, parseStoredCart, reconcileCart, removeLine, setQuantity,
  unitLine, variantLine,
} from '@/features/catalog/cart'
import { CartProvider } from '@/features/catalog/CartContext'
import { CartPage } from '@/features/catalog/CartPage'
import { CatalogPage } from '@/features/catalog/CatalogPage'
import { DEFAULT_FILTERS, filterProducts, normalizeText } from '@/features/catalog/filters'
import { ProductPage } from '@/features/catalog/ProductPage'
import type { Catalog } from '@/features/catalog/types'
import { settingsSchema } from '@/features/settings/SettingsPage'

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('@/features/catalog/api', async (orig) => ({
  ...(await orig<typeof import('@/features/catalog/api')>()),
  fetchCatalog: vi.fn(),
  fetchBusinessInfo: vi.fn(),
  publicImageUrl: (_c: unknown, path: string) => `https://img.test/${path}`,
}))

const catalog: Catalog = {
  categories: [
    { id: 'c1', name: 'iPhone 15', slug: 'iphone-15', kind: 'iphone', sort_order: 0 },
    { id: 'c2', name: 'Fundas', slug: 'fundas', kind: 'accessory', sort_order: 0 },
  ],
  products: [
    { id: 'p1', category_id: 'c1', kind: 'iphone', name: 'iPhone 15 Pro', slug: 'iphone-15-pro', description: 'Titanio', created_at: '2026-11-02T00:00:00Z', price_from: 18500, price_to: 21000, available_count: 2, primary_image_path: 'p1/a.jpg' },
    { id: 'p2', category_id: 'c1', kind: 'iphone', name: 'iPhone 15 Agotado', slug: 'iphone-15-agotado', description: null, created_at: '2026-11-01T00:00:00Z', price_from: null, price_to: null, available_count: 0, primary_image_path: null },
    { id: 'p3', category_id: 'c2', kind: 'accessory', name: 'Funda Silicón', slug: 'funda-silicon', description: 'Suave', created_at: '2026-11-03T00:00:00Z', price_from: 299, price_to: 349, available_count: 2, primary_image_path: null },
  ],
  units: [
    { public_code: 'AB12CD', product_id: 'p1', storage_gb: 256, color: 'Negro', condition: 'used', battery_health: 91, physical_grade: 'Excelente', price: 18500 },
    { public_code: 'EF34AB', product_id: 'p1', storage_gb: 128, color: 'Azul', condition: 'new', battery_health: null, physical_grade: null, price: 21000 },
  ],
  variants: [
    { id: 'v1', product_id: 'p3', sku: 'F-NEG', color: 'Negro', compatible_model: 'iPhone 15 Pro', price: 299, availability: 'available' },
    { id: 'v2', product_id: 'p3', sku: 'F-ROJ', color: 'Rojo', compatible_model: null, price: 349, availability: 'low' },
    { id: 'v3', product_id: 'p3', sku: 'F-AZU', color: 'Azul', compatible_model: null, price: 399, availability: 'out' },
  ],
  images: [{ id: 'i1', product_id: 'p1', unit_code: null, storage_path: 'p1/a.jpg', alt_text: 'Frente', sort_order: 0, is_primary: true }],
}

describe('filtros del catálogo', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizeText('  Funda SILICÓN ')).toBe('funda silicon')
  })
  it('filtra por tipo', () => {
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, kind: 'accessory' }).map((p) => p.id)).toEqual(['p3'])
  })
  it('la búsqueda ignora acentos y mayúsculas', () => {
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, query: 'SILICON' }).map((p) => p.id)).toEqual(['p3'])
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, query: 'titanio' }).map((p) => p.id)).toEqual(['p1'])
  })
  it('filtra iPhone por condición y capacidad usando sus unidades', () => {
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, kind: 'iphone', condition: 'new' }).map((p) => p.id)).toEqual(['p1'])
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, kind: 'iphone', storage: 512 })).toEqual([])
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, kind: 'iphone', storage: 256, condition: 'used' }).map((p) => p.id)).toEqual(['p1'])
  })
  it('solo disponibles y precio máximo', () => {
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, kind: 'iphone', onlyAvailable: true }).map((p) => p.id)).toEqual(['p1'])
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, maxPrice: 1000 }).map((p) => p.id)).toEqual(['p3'])
  })
  it('ordena por precio y por más recientes', () => {
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, sort: 'price_asc' }).map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
    expect(filterProducts(catalog, { ...DEFAULT_FILTERS, sort: 'recent' }).map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
  })
})

describe('carrito (lógica)', () => {
  const p = catalog.products
  const iphone = unitLine(p[0]!.name, p[0]!.slug, catalog.units[0]!)
  const funda = variantLine(p[2]!.name, p[2]!.slug, catalog.variants[0]!, 2)

  it('un seminuevo describe condición, batería y referencia pública', () => {
    expect(iphone.label).toContain('256 GB Negro')
    expect(iphone.label).toContain('Seminuevo, batería 91%')
    expect(iphone.label).toContain('Ref. AB12CD')
    expect(iphone.unitPriceCents).toBe(1850000)
  })
  it('un iPhone no se duplica; un accesorio suma cantidades hasta el máximo', () => {
    expect(addLine(addLine([], iphone), iphone)).toHaveLength(1)
    const lines = addLine(addLine([], funda), variantLine(p[2]!.name, p[2]!.slug, catalog.variants[0]!, 9))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.quantity).toBe(10)
  })
  it('"pocas piezas" limita la cantidad a 3 y "agotado" no se puede agregar con cantidad útil', () => {
    expect(variantLine('F', 'f', catalog.variants[1]!, 9).quantity).toBe(3)
  })
  it('totales en centavos sin errores de punto flotante', () => {
    const lines = [funda, iphone]
    expect(cartTotalCents(lines)).toBe(29900 * 2 + 1850000)
    expect(cartCount(lines)).toBe(3)
    expect(cartTotalCents([variantLine('X', 'x', { ...catalog.variants[0]!, price: 0.1 }, 3)])).toBe(30)
  })
  it('cambiar cantidad respeta el rango y quitar elimina la línea', () => {
    expect(setQuantity([funda], funda.key, 99)[0]!.quantity).toBe(10)
    expect(setQuantity([funda], funda.key, 0)[0]!.quantity).toBe(1)
    expect(removeLine([funda, iphone], funda.key)).toEqual([iphone])
  })
  it('el mensaje de WhatsApp lista productos, cantidades e importes y no confirma nada', () => {
    const m = buildOrderMessage([iphone, funda], 'NovaCell')
    expect(m).toContain('Hola NovaCell, quisiera hacer este pedido')
    expect(m).toContain('1. iPhone 15 Pro 256 GB Negro')
    expect(m).toContain('× 2')
    expect(m).toContain('$598.00')
    expect(m).toContain('Total estimado: $19,098.00')
    expect(m).toMatch(/confírmenme disponibilidad, precio final y forma de entrega/)
    expect(m).not.toMatch(/pedido confirmado|compra realizada|apartado/i)
  })
  it('ignora datos corruptos o manipulados en el almacenamiento local', () => {
    expect(parseStoredCart(null)).toEqual([])
    expect(parseStoredCart('no es json')).toEqual([])
    expect(parseStoredCart('{"a":1}')).toEqual([])
    expect(parseStoredCart(JSON.stringify([{ ...funda }, { key: 'x' }, { ...funda, quantity: -5 }, { ...funda, unitPriceCents: 1.5 }]))).toHaveLength(1)
  })
  it('reconcilia con el catálogo: quita lo no disponible y actualiza precios', () => {
    const stale = [
      { ...iphone, unitPriceCents: 1 },
      { ...unitLine('X', 'x', { ...catalog.units[0]!, public_code: 'GONE00' }, ) },
      variantLine('F', 'f', catalog.variants[2]!, 1),
      funda,
    ]
    const r = reconcileCart(stale, catalog)
    expect(r.removed).toHaveLength(2) // unidad vendida y variante agotada
    expect(r.lines.map((l) => l.key)).toEqual([iphone.key, funda.key])
    expect(r.lines[0]!.unitPriceCents).toBe(1850000)
    expect(r.changed).toHaveLength(1)
  })
})

describe('configuración del negocio', () => {
  const base = {
    business_name: 'NovaCell', whatsapp_number: '5512345678', business_hours: '', business_address: '', delivery_info: '',
    layaway_min_down_percent: '', freq_weekly: true, freq_biweekly: true, freq_monthly: true,
  }
  it('acepta datos válidos y teléfonos con formato', () => {
    expect(settingsSchema.safeParse(base).success).toBe(true)
    expect(settingsSchema.safeParse({ ...base, whatsapp_number: '55 1234-5678' }).success).toBe(true)
  })
  it('rechaza un WhatsApp inválido y un porcentaje fuera de rango', () => {
    expect(settingsSchema.safeParse({ ...base, whatsapp_number: '12345' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...base, layaway_min_down_percent: '150' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...base, layaway_min_down_percent: '20' }).success).toBe(true)
  })
})

function renderApp(path: string, info: Record<string, string> = {}) {
  vi.mocked(catalogApi.fetchCatalog).mockResolvedValue(catalog)
  vi.mocked(catalogApi.fetchBusinessInfo).mockResolvedValue(info)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CartProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/iphone" element={<CatalogPage kind="iphone" />} />
            <Route path="/producto/:slug" element={<ProductPage />} />
            <Route path="/carrito" element={<CartPage />} />
          </Routes>
        </MemoryRouter>
      </CartProvider>
    </QueryClientProvider>,
  )
}

describe('páginas de la tienda', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  beforeEach(() => {
    window.localStorage.clear()
    open.mockClear()
  })

  it('el catálogo lista productos, filtra por texto y muestra estados', async () => {
    renderApp('/iphone')
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument()
    expect(screen.getByText('iPhone 15 Agotado')).toBeInTheDocument()
    expect(screen.getByText('Agotado')).toBeInTheDocument()
    expect(screen.queryByText('Funda Silicón')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Buscar en el catálogo'), 'zzz')
    expect(await screen.findByText('No encontramos resultados')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument()
  })

  it('la ficha de un iPhone muestra cada unidad sin datos privados y permite agregarla al carrito', async () => {
    renderApp('/producto/iphone-15-pro')
    expect(await screen.findByRole('heading', { name: 'iPhone 15 Pro' })).toBeInTheDocument()
    expect(screen.getByText(/Batería 91%/)).toBeInTheDocument()
    expect(screen.getByText(/Ref\. AB12CD/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/imei|número de serie|costo/i)
    const first = screen.getAllByRole('button', { name: 'Agregar al carrito' })[0]!
    await userEvent.click(first)
    expect(await screen.findByText('Agregado al carrito')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /En el carrito/ })).toHaveLength(1)
    expect(JSON.parse(window.localStorage.getItem('novacell-cart-v1')!)).toHaveLength(1)
  })

  it('una variante agotada no se puede agregar', async () => {
    renderApp('/producto/funda-silicon')
    await screen.findByRole('heading', { name: 'Funda Silicón' })
    expect(screen.getByRole('button', { name: 'Agotado' })).toBeDisabled()
    expect(screen.getByText('Pocas piezas')).toBeInTheDocument()
  })

  it('un producto que ya no existe lo indica', async () => {
    renderApp('/producto/no-existe')
    expect(await screen.findByText('Este producto ya no está disponible')).toBeInTheDocument()
  })

  it('el carrito vacío invita a explorar', async () => {
    renderApp('/carrito')
    expect(await screen.findByText('Tu carrito está vacío')).toBeInTheDocument()
  })

  it('abre WhatsApp con el pedido y aclara que no es una compra', async () => {
    window.localStorage.setItem('novacell-cart-v1', JSON.stringify([unitLine('iPhone 15 Pro', 'iphone-15-pro', catalog.units[0]!)]))
    renderApp('/carrito', { whatsapp_number: '5512345678', business_name: 'NovaCell' })
    expect(await screen.findByTestId('cart-total')).toHaveTextContent('$18,500.00')
    await userEvent.click(await screen.findByRole('button', { name: /Enviar pedido por WhatsApp/ }))
    expect(open).toHaveBeenCalledOnce()
    const url = String(open.mock.calls[0]![0])
    expect(url).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/)
    expect(decodeURIComponent(url)).toContain('Ref. AB12CD')
    expect(open.mock.calls[0]![2]).toContain('noopener')
    expect(await screen.findByText(/Aún no es una compra/)).toBeInTheDocument()
    // abrir WhatsApp no vacía ni confirma nada
    expect(screen.getByTestId('cart-total')).toBeInTheDocument()
  })

  it('sin WhatsApp configurado no hay botón de envío pero sí copiar el pedido', async () => {
    window.localStorage.setItem('novacell-cart-v1', JSON.stringify([unitLine('iPhone 15 Pro', 'iphone-15-pro', catalog.units[0]!)]))
    renderApp('/carrito')
    await screen.findByTestId('cart-total')
    expect(await screen.findByText(/contacto por WhatsApp aún no está disponible/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Enviar pedido por WhatsApp/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar pedido/ })).toBeEnabled()
  })

  it('al abrir el carrito quita lo que ya no está disponible y avisa', async () => {
    const gone = unitLine('iPhone 15 Pro', 'iphone-15-pro', { ...catalog.units[0]!, public_code: 'GONE00' })
    window.localStorage.setItem('novacell-cart-v1', JSON.stringify([gone, unitLine('iPhone 15 Pro', 'iphone-15-pro', catalog.units[1]!)]))
    renderApp('/carrito')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/ya no está disponible/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('$21,000.00'))
    expect(screen.getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(0)
  })
})
