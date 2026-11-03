import { describeDbError } from '@/lib/dbErrors'
import { isValidImei, maskImei } from '@/lib/imei'
import { moneyString } from '@/lib/money'
import { slugify } from '@/lib/slug'
import { stockSchema, toStockMovement, unitSchema } from '@/features/inventory/schemas'

describe('IMEI', () => {
  it('acepta IMEI con dígito verificador correcto', () => {
    expect(isValidImei('490154203237518')).toBe(true)
    expect(isValidImei('352099001761481')).toBe(true)
  })
  it('rechaza dígito verificador incorrecto, longitud y caracteres no numéricos', () => {
    expect(isValidImei('490154203237519')).toBe(false)
    expect(isValidImei('12345')).toBe(false)
    expect(isValidImei('49015420323751a')).toBe(false)
    expect(isValidImei('')).toBe(false)
  })
  it('enmascara todo salvo los últimos 4 dígitos', () => {
    expect(maskImei('490154203237518')).toBe('•••••••••••7518')
  })
})

describe('slugify', () => {
  it('genera slugs válidos sin acentos', () => {
    expect(slugify('Funda Silicón — iPhone 15 Pro!')).toBe('funda-silicon-iphone-15-pro')
    expect(slugify('  --  ')).toBe('')
  })
})

describe('moneyString', () => {
  it('acepta importes con hasta 2 decimales', () => {
    expect(moneyString.safeParse('1299.50').success).toBe(true)
    expect(moneyString.safeParse('0').success).toBe(true)
  })
  it('rechaza negativos, 3 decimales y texto', () => {
    expect(moneyString.safeParse('-1').success).toBe(false)
    expect(moneyString.safeParse('1.999').success).toBe(false)
    expect(moneyString.safeParse('abc').success).toBe(false)
  })
})

describe('unitSchema', () => {
  const valid = {
    imei: '490154203237518',
    serial_number: '',
    storage_gb: '256',
    color: 'Negro',
    condition: 'used' as const,
    physical_grade: '',
    battery_health: '',
    acquisition_cost: '8000',
    sale_price: '11000.00',
    notes: '',
  }
  it('acepta una unidad válida', () => {
    expect(unitSchema.safeParse(valid).success).toBe(true)
  })
  it('rechaza IMEI inválido', () => {
    expect(unitSchema.safeParse({ ...valid, imei: '490154203237519' }).success).toBe(false)
  })
  it('valida el rango de salud de batería', () => {
    expect(unitSchema.safeParse({ ...valid, battery_health: '101' }).success).toBe(false)
    expect(unitSchema.safeParse({ ...valid, battery_health: '87' }).success).toBe(true)
  })
})

describe('movimientos de stock', () => {
  it('traduce el formulario a cantidad con signo', () => {
    expect(toStockMovement({ kind: 'entry', quantity: '5' })).toEqual({ type: 'entry', delta: 5 })
    expect(toStockMovement({ kind: 'exit', quantity: '3' })).toEqual({ type: 'exit', delta: -3 })
    expect(toStockMovement({ kind: 'adjustment_down', quantity: '2', reason: 'merma' })).toEqual({
      type: 'adjustment',
      delta: -2,
    })
  })
  it('un ajuste exige motivo; una entrada no', () => {
    expect(stockSchema.safeParse({ kind: 'adjustment_up', quantity: '1', reason: '' }).success).toBe(false)
    expect(stockSchema.safeParse({ kind: 'entry', quantity: '1', reason: '' }).success).toBe(true)
  })
  it('rechaza cantidad cero o decimal', () => {
    expect(stockSchema.safeParse({ kind: 'entry', quantity: '0' }).success).toBe(false)
    expect(stockSchema.safeParse({ kind: 'entry', quantity: '1.5' }).success).toBe(false)
  })
})

describe('describeDbError', () => {
  it('traduce errores comunes', () => {
    expect(describeDbError({ code: '23505', message: 'duplicate key ... product_units_imei_key' })).toMatch(/IMEI/)
    expect(describeDbError({ code: '23505', message: 'duplicate key ... product_variants_sku_key' })).toMatch(/SKU/)
    expect(describeDbError({ code: '23514', message: 'Existencias insuficientes (disponibles: 2)' })).toBe(
      'Existencias insuficientes',
    )
    expect(describeDbError({ code: '42501' })).toMatch(/permisos/)
    expect(describeDbError(new Error('x'))).toMatch(/Intenta de nuevo/)
  })
})
