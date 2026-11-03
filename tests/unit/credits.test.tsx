import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as creditsApi from '@/features/credits/api'
import { CreditPaymentDialog } from '@/features/credits/components/CreditPaymentDialog'
import { NewCreditPage } from '@/features/credits/NewCreditPage'
import { creditPaymentSchema, creditTermsSchema } from '@/features/credits/schemas'
import { buildSchedule } from '@/features/credits/schedule'
import * as customersApi from '@/features/customers/api'
import * as inventoryApi from '@/features/inventory/api'
import * as salesApi from '@/features/sales/api'
import { formatDate, todayIso } from '@/lib/format'

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('@/features/customers/api', async (orig) => ({ ...(await orig<typeof import('@/features/customers/api')>()), listCustomers: vi.fn() }))
vi.mock('@/features/inventory/api', async (orig) => ({ ...(await orig<typeof import('@/features/inventory/api')>()), listUnits: vi.fn() }))
vi.mock('@/features/sales/api', async (orig) => ({ ...(await orig<typeof import('@/features/sales/api')>()), listSellableVariants: vi.fn() }))
vi.mock('@/features/credits/api', async (orig) => ({
  ...(await orig<typeof import('@/features/credits/api')>()),
  createCreditSale: vi.fn(),
  recordCreditPayment: vi.fn(),
}))

describe('calendario de pagos (debe coincidir con create_credit_sale)', () => {
  it('semanal: cuotas iguales y fechas cada 7 días', () => {
    const s = buildSchedule(800000, 4, 'weekly', '2026-11-10')
    expect(s.map((x) => x.cents)).toEqual([200000, 200000, 200000, 200000])
    expect(s.map((x) => x.due)).toEqual(['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01'])
  })
  it('el residuo de centavos va a la última cuota y la suma es exacta', () => {
    const s = buildSchedule(100000, 3, 'biweekly', '2026-11-10')
    expect(s.map((x) => x.cents)).toEqual([33333, 33333, 33334])
    expect(s.reduce((a, x) => a + x.cents, 0)).toBe(100000)
    expect(s.map((x) => x.due)).toEqual(['2026-11-10', '2026-11-24', '2026-12-08'])
  })
  it('mensual desde el día 31: ajusta fin de mes sin arrastrar el desfase', () => {
    const s = buildSchedule(300000, 4, 'monthly', '2026-12-31')
    expect(s.map((x) => x.due)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31'])
  })
  it('mensual en año bisiesto', () => {
    expect(buildSchedule(200000, 2, 'monthly', '2028-01-31').map((x) => x.due)).toEqual(['2028-01-31', '2028-02-29'])
  })
  it('devuelve vacío con datos inválidos', () => {
    expect(buildSchedule(0, 3, 'weekly', '2026-11-10')).toEqual([])
    expect(buildSchedule(100, 0, 'weekly', '2026-11-10')).toEqual([])
  })
})

describe('fechas', () => {
  it('una fecha sin hora se muestra como el mismo día calendario (sin desfase por zona horaria)', () => {
    expect(formatDate('2026-11-10')).toContain('10')
    expect(formatDate('2026-11-10')).toMatch(/nov/i)
  })
  it('todayIso devuelve YYYY-MM-DD en la zona del negocio', () => {
    expect(todayIso(new Date('2026-11-03T05:30:00Z'))).toBe('2026-11-02') // 23:30 del día 2 en Ciudad de México
    expect(todayIso(new Date('2026-11-03T12:00:00Z'))).toBe('2026-11-03')
  })
})

describe('validaciones de crédito', () => {
  const base = { financedTotal: '9000', downPayment: '1000', frequency: 'weekly', installments: '4', firstDueDate: '2026-11-10' } as const
  it('acepta condiciones válidas', () => {
    expect(creditTermsSchema.safeParse(base).success).toBe(true)
  })
  it('rechaza cuotas fuera de rango o precio en cero', () => {
    expect(creditTermsSchema.safeParse({ ...base, installments: '0' }).success).toBe(false)
    expect(creditTermsSchema.safeParse({ ...base, installments: '261' }).success).toBe(false)
    expect(creditTermsSchema.safeParse({ ...base, financedTotal: '0' }).success).toBe(false)
  })
  it('una transferencia exige clave de rastreo', () => {
    expect(creditPaymentSchema.safeParse({ kind: 'installment', method: 'transfer', amount: '100', reference: '' }).success).toBe(false)
    expect(creditPaymentSchema.safeParse({ kind: 'installment', method: 'cash', amount: '100', reference: '' }).success).toBe(true)
  })
})

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CreditPaymentDialog', () => {
  beforeEach(() => vi.mocked(creditsApi.recordCreditPayment).mockReset())

  it('registra un abono con el importe sugerido y una clave de idempotencia', async () => {
    vi.mocked(creditsApi.recordCreditPayment).mockResolvedValue('p1')
    const onOpenChange = vi.fn()
    wrap(<CreditPaymentDialog open onOpenChange={onOpenChange} creditId="c1" saleId="s1" kind="installment" suggestedCents={200000} limitCents={800000} />)
    expect(screen.getByLabelText('Importe (MXN)')).toHaveValue('2000.00')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar abono' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [, args, key] = vi.mocked(creditsApi.recordCreditPayment).mock.calls[0]!
    expect(args).toMatchObject({ creditId: 'c1', kind: 'installment', method: 'cash', amount: '2000.00', reference: null })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('una transferencia sin clave de rastreo no se envía', async () => {
    wrap(<CreditPaymentDialog open onOpenChange={vi.fn()} creditId="c1" saleId="s1" kind="down_payment" suggestedCents={100000} limitCents={100000} />)
    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), 'transfer')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar enganche' }))
    expect(await screen.findByText(/requiere la clave de rastreo/)).toBeInTheDocument()
    expect(creditsApi.recordCreditPayment).not.toHaveBeenCalled()
  })

  it('muestra el error del backend en español', async () => {
    vi.mocked(creditsApi.recordCreditPayment).mockRejectedValueOnce({ code: '23514', message: 'El abono excede el saldo del crédito (saldo por cubrir: 100.00)' })
    wrap(<CreditPaymentDialog open onOpenChange={vi.fn()} creditId="c1" saleId="s1" kind="installment" suggestedCents={20000} limitCents={10000} />)
    await userEvent.click(screen.getByRole('button', { name: 'Registrar abono' }))
    expect(await screen.findByText(/excede el saldo/)).toBeInTheDocument()
  })
})

describe('NewCreditPage', () => {
  const customer = { id: 'c1', name: 'Ana Pérez', phone: null, is_active: true }
  const unit = {
    id: 'u1', internal_code: 'NC-000001', product_id: 'p1', imei: '490154203237518', storage_gb: 256, color: 'Negro',
    condition: 'used', status: 'available', acquisition_cost: 6000, sale_price: 10000, product: { name: 'iPhone 15 Pro' },
  }

  beforeEach(() => {
    vi.mocked(customersApi.listCustomers).mockResolvedValue([customer] as never)
    vi.mocked(inventoryApi.listUnits).mockResolvedValue([unit] as never)
    vi.mocked(salesApi.listSellableVariants).mockResolvedValue([] as never)
    vi.mocked(creditsApi.createCreditSale).mockReset()
  })

  function renderPage() {
    return wrap(
      <Routes>
        <Route path="/" element={<NewCreditPage />} />
        <Route path="/admin/creditos/:id" element={<div>detalle del crédito</div>} />
      </Routes>,
    )
  }

  async function pickUnit() {
    await screen.findByLabelText('Cliente')
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('Agregar iPhone disponible'), 'u1')
  }

  it('sugiere el precio financiado y muestra la vista previa del calendario', async () => {
    renderPage()
    await pickUnit()
    expect(screen.getByLabelText(/Precio final financiado/)).toHaveValue('10000.00')
    await userEvent.clear(screen.getByLabelText('Enganche (MXN)'))
    await userEvent.type(screen.getByLabelText('Enganche (MXN)'), '2000')
    // 10000 - 2000 = 8000 entre 4 cuotas
    expect(await screen.findByText(/A financiar tras el enganche/)).toHaveTextContent('$8,000.00')
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThanOrEqual(4)
  })

  it('no permite un enganche igual o mayor al precio financiado', async () => {
    renderPage()
    await pickUnit()
    await userEvent.clear(screen.getByLabelText('Enganche (MXN)'))
    await userEvent.type(screen.getByLabelText('Enganche (MXN)'), '10000')
    expect(screen.getByText('El enganche debe ser menor al precio financiado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear crédito' })).toBeDisabled()
  })

  it('envía las condiciones al backend y navega al crédito creado', async () => {
    vi.mocked(creditsApi.createCreditSale).mockResolvedValue('credit-1')
    renderPage()
    await pickUnit()
    await userEvent.clear(screen.getByLabelText(/Precio final financiado/))
    await userEvent.type(screen.getByLabelText(/Precio final financiado/), '12000')
    await userEvent.clear(screen.getByLabelText('Enganche (MXN)'))
    await userEvent.type(screen.getByLabelText('Enganche (MXN)'), '2000')
    await userEvent.selectOptions(screen.getByLabelText('Frecuencia de pago'), 'biweekly')
    await userEvent.click(screen.getByRole('button', { name: 'Crear crédito' }))
    expect(await screen.findByText('detalle del crédito')).toBeInTheDocument()
    const [, args, key] = vi.mocked(creditsApi.createCreditSale).mock.calls[0]!
    expect(args).toMatchObject({
      customerId: 'c1', financedTotal: '12000', downPayment: '2000', frequency: 'biweekly', installments: 4,
      items: [{ unit_id: 'u1', unit_price: '10000' }],
    })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })
})
