import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as customersApi from '@/features/customers/api'
import * as inventoryApi from '@/features/inventory/api'
import { NewSalePage } from '@/features/sales/NewSalePage'
import { PaymentDialog } from '@/features/sales/components/PaymentDialog'
import * as salesApi from '@/features/sales/api'

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('@/features/customers/api', async (orig) => ({
  ...(await orig<typeof import('@/features/customers/api')>()),
  listCustomers: vi.fn(),
}))
vi.mock('@/features/inventory/api', async (orig) => ({
  ...(await orig<typeof import('@/features/inventory/api')>()),
  listUnits: vi.fn(),
}))
vi.mock('@/features/sales/api', async (orig) => ({
  ...(await orig<typeof import('@/features/sales/api')>()),
  listSellableVariants: vi.fn(),
  createSale: vi.fn(),
  recordPayment: vi.fn(),
}))

const wrap = (ui: React.ReactNode, path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaymentDialog', () => {
  beforeEach(() => vi.mocked(salesApi.recordPayment).mockReset())

  it('una transferencia sin clave de rastreo no se envía', async () => {
    wrap(<PaymentDialog open onOpenChange={vi.fn()} saleId="s1" remainingCents={10000} />)
    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), 'transfer')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    expect(await screen.findByText(/requiere la clave de rastreo/)).toBeInTheDocument()
    expect(salesApi.recordPayment).not.toHaveBeenCalled()
  })

  it('el efectivo se registra con el saldo como importe por defecto y una clave de idempotencia', async () => {
    vi.mocked(salesApi.recordPayment).mockResolvedValue('p1')
    const onOpenChange = vi.fn()
    wrap(<PaymentDialog open onOpenChange={onOpenChange} saleId="s1" remainingCents={1059800} />)
    expect(screen.getByLabelText('Importe (MXN)')).toHaveValue('10598.00')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [, args, key] = vi.mocked(salesApi.recordPayment).mock.calls[0]!
    expect(args).toMatchObject({ saleId: 's1', method: 'cash', amount: '10598.00', reference: null })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('NewSalePage', () => {
  const customer = { id: 'c1', name: 'Ana Pérez', phone: '5512345678', is_active: true }
  const unit = {
    id: 'u1', internal_code: 'NC-000001', product_id: 'p1', imei: '490154203237518', storage_gb: 256,
    color: 'Negro', condition: 'used', status: 'available', acquisition_cost: 8000, sale_price: 11000,
    product: { name: 'iPhone 15 Pro' },
  }
  const variant = {
    id: 'v1', product_id: 'p2', sku: 'FUN-1', color: 'Negro', compatible_model: null, price: 299, cost: 90,
    stock_quantity: 5, is_active: true, product: { name: 'Funda' },
  }

  beforeEach(() => {
    vi.mocked(customersApi.listCustomers).mockResolvedValue([customer] as never)
    vi.mocked(inventoryApi.listUnits).mockResolvedValue([unit] as never)
    vi.mocked(salesApi.listSellableVariants).mockResolvedValue([variant] as never)
    vi.mocked(salesApi.createSale).mockReset()
  })

  function renderPage() {
    return wrap(
      <Routes>
        <Route path="/" element={<NewSalePage />} />
        <Route path="/admin/ventas/:id" element={<div>detalle de venta</div>} />
      </Routes>,
    )
  }

  async function fillSale() {
    await screen.findByLabelText('Cliente')
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('Agregar iPhone disponible'), 'u1')
    await userEvent.selectOptions(screen.getByLabelText('Agregar accesorio con existencias'), 'v1')
  }

  it('calcula el total estimado con precios editables y no permite enviar sin datos', async () => {
    renderPage()
    await screen.findByLabelText('Cliente')
    expect(screen.getByRole('button', { name: 'Crear venta' })).toBeDisabled()
    await fillSale()
    expect(screen.getByTestId('sale-total')).toHaveTextContent('$11,299.00')
    await userEvent.clear(screen.getByLabelText(/Cantidad de Funda/))
    await userEvent.type(screen.getByLabelText(/Cantidad de Funda/), '2')
    expect(screen.getByTestId('sale-total')).toHaveTextContent('$11,598.00')
    await userEvent.clear(screen.getByLabelText(/Precio de iPhone 15 Pro/))
    await userEvent.type(screen.getByLabelText(/Precio de iPhone 15 Pro/), '10000')
    expect(screen.getByTestId('sale-total')).toHaveTextContent('$10,598.00')
  })

  it('no deja pedir más accesorios que las existencias', async () => {
    renderPage()
    await fillSale()
    await userEvent.clear(screen.getByLabelText(/Cantidad de Funda/))
    await userEvent.type(screen.getByLabelText(/Cantidad de Funda/), '6')
    expect(screen.getByRole('button', { name: 'Crear venta' })).toBeDisabled()
  })

  it('envía las líneas al backend y navega a la venta creada', async () => {
    vi.mocked(salesApi.createSale).mockResolvedValue('sale-1')
    renderPage()
    await fillSale()
    await userEvent.click(screen.getByRole('button', { name: 'Crear venta' }))
    expect(await screen.findByText('detalle de venta')).toBeInTheDocument()
    const [, args] = vi.mocked(salesApi.createSale).mock.calls[0]!
    expect(args.customerId).toBe('c1')
    expect(args.items).toEqual([
      { unit_id: 'u1', unit_price: '11000' },
      { variant_id: 'v1', quantity: 1, unit_price: '299' },
    ])
  })

  it('un reintento idéntico reutiliza la clave; cambiar la venta genera una nueva', async () => {
    vi.mocked(salesApi.createSale)
      .mockRejectedValueOnce({ code: '500' })
      .mockRejectedValueOnce({ code: '500' })
      .mockResolvedValueOnce('sale-1')
    renderPage()
    await fillSale()
    const submit = screen.getByRole('button', { name: 'Crear venta' })
    await userEvent.click(submit)
    await screen.findByRole('alert')
    await userEvent.click(submit)
    await waitFor(() => expect(salesApi.createSale).toHaveBeenCalledTimes(2))
    const [k1, k2] = vi.mocked(salesApi.createSale).mock.calls.map((c) => c[2])
    expect(k1).toBe(k2)

    await userEvent.clear(screen.getByLabelText(/Precio de Funda/))
    await userEvent.type(screen.getByLabelText(/Precio de Funda/), '250')
    await userEvent.click(submit)
    await waitFor(() => expect(salesApi.createSale).toHaveBeenCalledTimes(3))
    expect(vi.mocked(salesApi.createSale).mock.calls[2]![2]).not.toBe(k1)
  })

  it('muestra el error del backend en español', async () => {
    vi.mocked(salesApi.createSale).mockRejectedValueOnce({ code: '23514', message: 'La unidad NC-000001 no está disponible (estado: reserved)' })
    renderPage()
    await fillSale()
    await userEvent.click(screen.getByRole('button', { name: 'Crear venta' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/no está disponible/)).toBeInTheDocument()
  })
})
