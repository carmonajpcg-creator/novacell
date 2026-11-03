import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnitFormDialog } from '@/features/inventory/components/UnitFormDialog'
import * as api from '@/features/inventory/api'

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))
vi.mock('@/features/inventory/api', async (orig) => ({
  ...(await orig<typeof import('@/features/inventory/api')>()),
  registerUnit: vi.fn(),
  updateUnit: vi.fn(),
}))

function renderDialog(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <UnitFormDialog open onOpenChange={onOpenChange} productId="p1" />
    </QueryClientProvider>,
  )
  return onOpenChange
}

async function fillValid(imei = '490154203237518') {
  await userEvent.type(screen.getByLabelText('IMEI'), imei)
  await userEvent.type(screen.getByLabelText('Capacidad (GB)'), '256')
  await userEvent.type(screen.getByLabelText('Color'), 'Negro')
  await userEvent.type(screen.getByLabelText('Costo de adquisición (MXN)'), '8000')
  await userEvent.type(screen.getByLabelText('Precio de venta (MXN)'), '11000')
}

describe('UnitFormDialog', () => {
  beforeEach(() => vi.mocked(api.registerUnit).mockReset())

  it('rechaza un IMEI inválido sin llamar al backend', async () => {
    renderDialog()
    await fillValid('490154203237519')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText(/IMEI inválido/)).toBeInTheDocument()
    expect(api.registerUnit).not.toHaveBeenCalled()
  })

  it('registra la unidad con una clave de idempotencia y cierra', async () => {
    vi.mocked(api.registerUnit).mockResolvedValue('unit-1')
    const onOpenChange = renderDialog()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [, productId, values, key] = vi.mocked(api.registerUnit).mock.calls[0]!
    expect(productId).toBe('p1')
    expect(values.imei).toBe('490154203237518')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('muestra el error del backend en español (IMEI duplicado)', async () => {
    vi.mocked(api.registerUnit).mockRejectedValueOnce({ code: '23505', message: 'duplicate key product_units_imei_key' })
    renderDialog()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Ya existe una unidad con ese IMEI')).toBeInTheDocument()
  })
  it('un reintento tras un error reutiliza la misma clave de idempotencia', async () => {
    vi.mocked(api.registerUnit).mockRejectedValueOnce({ code: '500' }).mockResolvedValueOnce('unit-1')
    renderDialog()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(api.registerUnit).toHaveBeenCalledTimes(2))
    const keys = vi.mocked(api.registerUnit).mock.calls.map((c) => c[3])
    expect(keys[0]).toBe(keys[1])
  })
})
