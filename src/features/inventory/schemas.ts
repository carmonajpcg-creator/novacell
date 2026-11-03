import { z } from 'zod'
import { isValidImei } from '@/lib/imei'
import { moneyString } from '@/lib/money'

// Los formularios trabajan con strings; la conversión a los tipos de la base ocurre en `to*Input`.

const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional().or(z.literal(''))

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Ingresa un nombre').max(80, 'Máximo 80 caracteres'),
  kind: z.enum(['iphone', 'accessory']),
})
export type CategoryValues = z.infer<typeof categorySchema>

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Ingresa un nombre').max(120, 'Máximo 120 caracteres'),
  category_id: z.uuid('Selecciona una categoría'),
  description: optionalText(4000),
  is_published: z.boolean(),
  is_active: z.boolean(),
})
export type ProductValues = z.infer<typeof productSchema>

export const variantSchema = z.object({
  sku: z.string().trim().min(1, 'Ingresa el SKU').max(60, 'Máximo 60 caracteres'),
  color: optionalText(60),
  compatible_model: optionalText(120),
  price: moneyString,
  cost: moneyString,
  is_active: z.boolean(),
})
export type VariantValues = z.infer<typeof variantSchema>

export const unitSchema = z.object({
  imei: z
    .string()
    .trim()
    .refine(isValidImei, 'IMEI inválido: 15 dígitos con dígito verificador correcto'),
  serial_number: optionalText(40),
  storage_gb: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,4}$/, 'Ingresa la capacidad en GB (ej. 256)'),
  color: z.string().trim().min(1, 'Ingresa el color').max(60, 'Máximo 60 caracteres'),
  condition: z.enum(['new', 'used']),
  physical_grade: optionalText(200),
  battery_health: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) <= 100), 'Debe ser un número de 0 a 100'),
  acquisition_cost: moneyString,
  sale_price: moneyString,
  notes: optionalText(2000),
})
export type UnitValues = z.infer<typeof unitSchema>

export const MOVEMENT_KINDS = [
  { value: 'entry', label: 'Entrada (+)' },
  { value: 'exit', label: 'Salida (−)' },
  { value: 'adjustment_up', label: 'Ajuste (+)' },
  { value: 'adjustment_down', label: 'Ajuste (−)' },
] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]['value']

export const stockSchema = z
  .object({
    kind: z.enum(['entry', 'exit', 'adjustment_up', 'adjustment_down']),
    quantity: z.string().trim().regex(/^[1-9]\d{0,6}$/, 'Ingresa una cantidad entera mayor a 0'),
    reason: optionalText(500),
  })
  .refine((v) => !v.kind.startsWith('adjustment') || (v.reason ?? '').trim().length > 0, {
    message: 'Un ajuste requiere un motivo',
    path: ['reason'],
  })
export type StockValues = z.infer<typeof stockSchema>

/** Traduce el formulario de stock al tipo de movimiento y cantidad con signo del RPC. */
export function toStockMovement(values: StockValues): { type: 'entry' | 'exit' | 'adjustment'; delta: number } {
  const qty = Number(values.quantity)
  switch (values.kind) {
    case 'entry':
      return { type: 'entry', delta: qty }
    case 'exit':
      return { type: 'exit', delta: -qty }
    case 'adjustment_up':
      return { type: 'adjustment', delta: qty }
    case 'adjustment_down':
      return { type: 'adjustment', delta: -qty }
  }
}

export const blankToNull = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}
