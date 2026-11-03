import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as collectionsApi from '@/features/collections/api'
import { buildReminderMessage, dueLabel } from '@/features/collections/messages'
import { ReminderDialog } from '@/features/collections/ReminderDialog'
import { OUTCOME_LABEL, REMINDER_STATUS_LABEL, type QueueItem, type Reminder } from '@/features/collections/types'
import * as customersApi from '@/features/customers/api'
import * as inventoryApi from '@/features/inventory/api'
import * as layawaysApi from '@/features/layaways/api'
import { NewLayawayPage } from '@/features/layaways/NewLayawayPage'
import { layawayPaymentSchema } from '@/features/layaways/schemas'
import * as salesApi from '@/features/sales/api'
import { buildWhatsAppUrl, normalizeMxPhone } from '@/lib/whatsapp'

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('@/features/customers/api', async (orig) => ({ ...(await orig<typeof import('@/features/customers/api')>()), listCustomers: vi.fn() }))
vi.mock('@/features/inventory/api', async (orig) => ({ ...(await orig<typeof import('@/features/inventory/api')>()), listUnits: vi.fn() }))
vi.mock('@/features/sales/api', async (orig) => ({ ...(await orig<typeof import('@/features/sales/api')>()), listSellableVariants: vi.fn() }))
vi.mock('@/features/layaways/api', async (orig) => ({ ...(await orig<typeof import('@/features/layaways/api')>()), createLayaway: vi.fn() }))
vi.mock('@/features/collections/api', async (orig) => ({
  ...(await orig<typeof import('@/features/collections/api')>()),
  listReminders: vi.fn(),
  prepareReminder: vi.fn(),
  markWhatsAppOpened: vi.fn(),
  markContacted: vi.fn(),
}))

describe('teléfono y enlace de WhatsApp', () => {
  it('normaliza teléfonos mexicanos de 10 dígitos', () => {
    expect(normalizeMxPhone('55 1234 5678')).toBe('5512345678')
    expect(normalizeMxPhone('(55) 1234-5678')).toBe('5512345678')
    expect(normalizeMxPhone('+52 55 1234 5678')).toBe('5512345678')
    expect(normalizeMxPhone('12345')).toBeNull()
    expect(normalizeMxPhone(null)).toBeNull()
  })
  it('construye el enlace wa.me con lada 52 y el mensaje codificado', () => {
    const url = buildWhatsAppUrl('5512345678', 'Hola, ¿qué tal? 100%')
    expect(url).toBe(`https://wa.me/525512345678?text=${encodeURIComponent('Hola, ¿qué tal? 100%')}`)
  })
  it('sin teléfono válido no hay enlace', () => {
    expect(buildWhatsAppUrl(null, 'x')).toBeNull()
    expect(buildWhatsAppUrl('123', 'x')).toBeNull()
  })
})

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  kind: 'installment', ref_id: 'i1', credit_id: 'c1', layaway_id: null, customer_id: 'cu1',
  customer_name: 'Ana María Pérez', customer_phone: '5512345678', folio: 'C-000001', installment_number: 2,
  due_date: '2026-11-10', amount_due: 2500, days_overdue: 3, last_reminder_status: null, last_reminder_at: null,
  last_outcome: null, last_promised_date: null, ...over,
})

describe('plantillas de recordatorio', () => {
  it('cuota vencida: nombre, importe, folio, cuota y fecha', () => {
    const m = buildReminderMessage(item())
    expect(m).toContain('Hola Ana')
    expect(m).toContain('$2,500.00')
    expect(m).toContain('C-000001')
    expect(m).toContain('cuota 2')
    expect(m).toMatch(/venció el/)
  })
  it('cuota próxima usa "vence"', () => {
    expect(buildReminderMessage(item({ days_overdue: -2 }))).toMatch(/vence el/)
  })
  it('apartado: menciona el saldo y la fecha límite', () => {
    const m = buildReminderMessage(item({ kind: 'layaway', folio: 'A-000001', installment_number: null, amount_due: 9000, days_overdue: 1 }))
    expect(m).toContain('apartado A-000001')
    expect(m).toContain('$9,000.00')
    expect(m).toMatch(/fecha límite fue/)
  })
  it('NO menciona recargos, penalizaciones ni consecuencias (no hay política aprobada)', () => {
    for (const d of [3, 0, -5]) {
      for (const k of ['installment', 'layaway'] as const) {
        expect(buildReminderMessage(item({ kind: k, days_overdue: d }))).not.toMatch(/recargo|penaliz|interés|interes|multa|cancelar|perder|embargo|legal/i)
      }
    }
  })
  it('etiquetas de vencimiento', () => {
    expect(dueLabel(3)).toBe('Vencido hace 3 d')
    expect(dueLabel(0)).toBe('Vence hoy')
    expect(dueLabel(-2)).toBe('Vence en 2 d')
  })
})

describe('honestidad de los estados de cobranza (CLAUDE.md §12)', () => {
  it('no existe un estado "enviado" ni "entregado"', () => {
    expect(Object.keys(REMINDER_STATUS_LABEL)).toEqual(['prepared', 'whatsapp_opened', 'contacted'])
    for (const label of Object.values(REMINDER_STATUS_LABEL)) expect(label).not.toMatch(/^(enviado|entregado)/i)
    expect(REMINDER_STATUS_LABEL.whatsapp_opened).toMatch(/no confirma/i)
  })
  it('el resultado "pagó" se rotula como declaración del cliente', () => {
    expect(OUTCOME_LABEL.paid).toMatch(/dice/i)
  })
})

describe('ReminderDialog', () => {
  let store: Reminder[]
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)

  beforeEach(() => {
    store = []
    open.mockClear()
    vi.mocked(collectionsApi.listReminders).mockImplementation(async () => [...store])
    vi.mocked(collectionsApi.prepareReminder).mockImplementation(async (_c, it, message) => {
      const r: Reminder = {
        id: 'r1', customer_id: it.customer_id, installment_id: it.ref_id, layaway_id: null, kind: 'overdue', message,
        status: 'prepared', whatsapp_opened_at: null, contacted_at: null, outcome: null, promised_date: null, note: null,
        created_at: '2026-11-03T10:00:00Z',
      }
      store = [r]
      return r
    })
    vi.mocked(collectionsApi.markWhatsAppOpened).mockImplementation(async () => {
      store = store.map((r) => ({ ...r, status: 'whatsapp_opened', whatsapp_opened_at: '2026-11-03T10:01:00Z' }))
      return store[0]!
    })
    vi.mocked(collectionsApi.markContacted).mockImplementation(async (_c, _id, v) => {
      store = store.map((r) => ({ ...r, status: 'contacted', outcome: v.outcome, promised_date: v.promisedDate, note: v.note }))
      return store[0]!
    })
  })

  function renderDialog(it: QueueItem) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ReminderDialog item={it} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )
  }

  it('prepara, abre WhatsApp (sin afirmar el envío) y registra el seguimiento', async () => {
    renderDialog(item())
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar recordatorio' }))
    expect(await screen.findByText('Mensaje preparado')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    expect(open).toHaveBeenCalledOnce()
    expect(String(open.mock.calls[0]![0])).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/)
    expect(open.mock.calls[0]![2]).toContain('noopener')
    expect((await screen.findAllByText(/WhatsApp abierto \(no confirma el envío\)/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent(/no confirma que lo hayas enviado/)
    expect(screen.queryByText(/^enviado$|entregado/i)).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Resultado del contacto'), 'promise_to_pay')
    await userEvent.type(screen.getByLabelText('Fecha prometida'), '2099-01-15')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))
    await waitFor(() => expect(collectionsApi.markContacted).toHaveBeenCalled())
    expect(vi.mocked(collectionsApi.markContacted).mock.calls[0]![2]).toMatchObject({ outcome: 'promise_to_pay', promisedDate: '2099-01-15' })
    expect((await screen.findAllByText(/Contactado/)).length).toBeGreaterThan(0)
  })

  it('una promesa de pago exige la fecha', async () => {
    renderDialog(item())
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar recordatorio' }))
    await screen.findByText('Mensaje preparado')
    await userEvent.selectOptions(screen.getByLabelText('Resultado del contacto'), 'promise_to_pay')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))
    expect(await screen.findByText('Indica la fecha en que promete pagar')).toBeInTheDocument()
    expect(collectionsApi.markContacted).not.toHaveBeenCalled()
  })

  it('un cliente sin teléfono válido no puede abrir WhatsApp pero sí copiar el mensaje', async () => {
    renderDialog(item({ customer_phone: null }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar recordatorio' }))
    await screen.findByText('Mensaje preparado')
    expect(screen.getByRole('button', { name: 'Abrir WhatsApp' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copiar mensaje' })).toBeEnabled()
    expect(screen.getByText(/no tiene un teléfono válido/)).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
  })
})

describe('pago de apartado', () => {
  it('una transferencia exige clave de rastreo', () => {
    expect(layawayPaymentSchema.safeParse({ method: 'transfer', amount: '100', reference: '' }).success).toBe(false)
    expect(layawayPaymentSchema.safeParse({ method: 'cash', amount: '100', reference: '' }).success).toBe(true)
  })
})

describe('NewLayawayPage', () => {
  const customer = { id: 'c1', name: 'Ana Pérez', phone: null, is_active: true }
  const unit = {
    id: 'u1', internal_code: 'NC-000001', product_id: 'p1', imei: '490154203237518', storage_gb: 256, color: 'Negro',
    condition: 'used', status: 'available', acquisition_cost: 6000, sale_price: 10000, product: { name: 'iPhone 15 Pro' },
  }
  beforeEach(() => {
    vi.mocked(customersApi.listCustomers).mockResolvedValue([customer] as never)
    vi.mocked(inventoryApi.listUnits).mockResolvedValue([unit] as never)
    vi.mocked(salesApi.listSellableVariants).mockResolvedValue([] as never)
    vi.mocked(layawaysApi.createLayaway).mockReset()
  })

  function renderPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<NewLayawayPage />} />
            <Route path="/admin/apartados/:id" element={<div>detalle del apartado</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  async function pick() {
    await screen.findByLabelText('Cliente')
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('Agregar iPhone disponible'), 'u1')
  }

  it('exige un anticipo mayor a cero y no mayor al total', async () => {
    renderPage()
    await pick()
    expect(screen.getByRole('button', { name: 'Crear apartado' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Anticipo pactado/), '20000')
    expect(screen.getByText('El anticipo no puede exceder el total')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear apartado' })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText(/Anticipo pactado/))
    await userEvent.type(screen.getByLabelText(/Anticipo pactado/), '2000')
    expect(screen.getByRole('button', { name: 'Crear apartado' })).toBeEnabled()
  })

  it('envía el apartado al backend y navega al detalle', async () => {
    vi.mocked(layawaysApi.createLayaway).mockResolvedValue('lay-1')
    renderPage()
    await pick()
    await userEvent.type(screen.getByLabelText(/Anticipo pactado/), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Crear apartado' }))
    expect(await screen.findByText('detalle del apartado')).toBeInTheDocument()
    const [, args, key] = vi.mocked(layawaysApi.createLayaway).mock.calls[0]!
    expect(args).toMatchObject({ customerId: 'c1', downPayment: '2000', items: [{ unit_id: 'u1', unit_price: '10000' }] })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('muestra el error del backend en español', async () => {
    vi.mocked(layawaysApi.createLayaway).mockRejectedValueOnce({ code: '23514', message: 'El anticipo mínimo es el 20 por ciento del total' })
    renderPage()
    await pick()
    await userEvent.type(screen.getByLabelText(/Anticipo pactado/), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Crear apartado' }))
    expect(await screen.findByText(/anticipo mínimo/)).toBeInTheDocument()
  })
})
