import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@/lib/csv'
import { deliveryEditSchema, deliveryFormSchema } from '@/features/deliveries/schemas'
import { isTerminal, NEXT_STATUS } from '@/features/deliveries/types'
import { presetRange } from '@/features/reports/api'

describe('csv', () => {
  it('neutraliza fórmulas (inyección CSV) en celdas de texto', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+52 55')).toBe(`'+52 55`)
    expect(csvCell('-1')).toBe(`'-1`)
    expect(csvCell('@cmd')).toBe(`'@cmd`)
  })

  it('no altera números ni texto normal, y escapa comas y comillas', () => {
    expect(csvCell(-25.5)).toBe('-25.5')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(null)).toBe('')
    expect(csvCell('Juan Pérez')).toBe('Juan Pérez')
    expect(csvCell('Calle 1, Col. "Centro"')).toBe('"Calle 1, Col. ""Centro"""')
  })

  it('genera BOM, encabezados y saltos CRLF', () => {
    const out = toCsv(['A', 'B'], [[1, 'x']])
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(out.slice(1)).toBe('A,B\r\n1,x\r\n')
  })
})

describe('entregas', () => {
  const base = { address: 'Calle Falsa 123', reference_notes: '', delivery_cost: '', scheduled_date: '', notes: '' }

  it('exige una dirección y rechaza costos inválidos', () => {
    expect(deliveryEditSchema.safeParse(base).success).toBe(true)
    expect(deliveryEditSchema.safeParse({ ...base, address: 'abc' }).success).toBe(false)
    expect(deliveryEditSchema.safeParse({ ...base, delivery_cost: '10.123' }).success).toBe(false)
    expect(deliveryEditSchema.safeParse({ ...base, delivery_cost: '-5' }).success).toBe(false)
    expect(deliveryEditSchema.safeParse({ ...base, delivery_cost: '150.50' }).success).toBe(true)
    expect(deliveryEditSchema.safeParse({ ...base, scheduled_date: '12/05/2026' }).success).toBe(false)
  })

  it('el alta exige elegir una venta válida', () => {
    expect(deliveryFormSchema.safeParse({ ...base, saleId: '' }).success).toBe(false)
    expect(deliveryFormSchema.safeParse({ ...base, saleId: '3f1b8c1e-6a52-4a53-9d0b-4f0f6b7a1c11' }).success).toBe(true)
  })

  it('los estados solo avanzan y los terminales no tienen siguiente', () => {
    expect(NEXT_STATUS.pending?.to).toBe('preparing')
    expect(NEXT_STATUS.preparing?.to).toBe('on_the_way')
    expect(NEXT_STATUS.on_the_way?.to).toBe('delivered')
    expect(NEXT_STATUS.delivered).toBeUndefined()
    expect(NEXT_STATUS.cancelled).toBeUndefined()
    expect(isTerminal('delivered')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('on_the_way')).toBe(false)
  })
})

describe('reportes: rangos rápidos', () => {
  it('calcula hoy, mes, mes anterior y últimos 30 días', () => {
    expect(presetRange('2026-11-03', 'today')).toEqual({ from: '2026-11-03', to: '2026-11-03' })
    expect(presetRange('2026-11-03', 'month')).toEqual({ from: '2026-11-01', to: '2026-11-03' })
    expect(presetRange('2026-11-03', 'prev-month')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('2026-11-03', 'last-30')).toEqual({ from: '2026-10-05', to: '2026-11-03' })
  })

  it('maneja el cambio de año', () => {
    expect(presetRange('2027-01-10', 'prev-month')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(presetRange('2027-01-10', 'last-30')).toEqual({ from: '2026-12-12', to: '2027-01-10' })
  })
})
