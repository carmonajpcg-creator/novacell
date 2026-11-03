import { normalizePhone, customerSchema } from '@/features/customers/schemas'
import { paymentSchema, reasonSchema } from '@/features/sales/schemas'
import { formatCents, isMoney, toCents } from '@/lib/money'

describe('dinero en centavos', () => {
  it('convierte importes a centavos enteros sin errores de punto flotante', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(30)
    expect(toCents('1299.5')).toBe(129950)
    expect(toCents('10000')).toBe(1000000)
    expect(toCents('0.07')).toBe(7)
  })
  it('valida importes', () => {
    expect(isMoney('299')).toBe(true)
    expect(isMoney('299.99')).toBe(true)
    expect(isMoney('299.999')).toBe(false)
    expect(isMoney('-5')).toBe(false)
    expect(isMoney('')).toBe(false)
    expect(isMoney('NaN')).toBe(false)
  })
  it('formatea en MXN', () => {
    expect(formatCents(1059800)).toBe('$10,598.00')
  })
})

describe('cliente', () => {
  it('normaliza el teléfono', () => {
    expect(normalizePhone('(55) 1234-5678')).toBe('5512345678')
    expect(normalizePhone('55 1234 5678')).toBe('5512345678')
  })
  const base = { name: 'Ana', phone: '', contact_method: 'whatsapp', acquisition_source: 'facebook', notes: '' } as const
  it('el teléfono es opcional pero debe tener 10 dígitos si se da', () => {
    expect(customerSchema.safeParse(base).success).toBe(true)
    expect(customerSchema.safeParse({ ...base, phone: '55 1234 5678' }).success).toBe(true)
    expect(customerSchema.safeParse({ ...base, phone: '12345' }).success).toBe(false)
  })
  it('el nombre es obligatorio', () => {
    expect(customerSchema.safeParse({ ...base, name: '  ' }).success).toBe(false)
  })
})

describe('pago', () => {
  it('el efectivo no requiere referencia', () => {
    expect(paymentSchema.safeParse({ method: 'cash', amount: '100', reference: '' }).success).toBe(true)
  })
  it('una transferencia exige clave de rastreo de al menos 4 caracteres', () => {
    expect(paymentSchema.safeParse({ method: 'transfer', amount: '100', reference: '' }).success).toBe(false)
    expect(paymentSchema.safeParse({ method: 'transfer', amount: '100', reference: 'abc' }).success).toBe(false)
    expect(paymentSchema.safeParse({ method: 'transfer', amount: '100', reference: 'ABC123' }).success).toBe(true)
  })
  it('el importe debe ser mayor a cero', () => {
    expect(paymentSchema.safeParse({ method: 'cash', amount: '0', reference: '' }).success).toBe(false)
  })
  it('un motivo es obligatorio', () => {
    expect(reasonSchema.safeParse({ reason: ' ' }).success).toBe(false)
    expect(reasonSchema.safeParse({ reason: 'Cliente desistió' }).success).toBe(true)
  })
})
