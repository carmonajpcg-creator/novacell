import { z } from 'zod'
import { moneyString } from '@/lib/money'

const optionalText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).optional().or(z.literal(''))

const cost = z
  .string()
  .trim()
  .refine((v) => v === '' || moneyString.safeParse(v).success, 'Ingresa un importe válido (hasta 2 decimales)')

const base = {
  address: z.string().trim().min(5, 'Ingresa la dirección de entrega').max(500, 'Máximo 500 caracteres'),
  reference_notes: optionalText(500),
  delivery_cost: cost,
  scheduled_date: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Fecha inválida'),
  notes: optionalText(1000),
}

export const deliveryFormSchema = z.object({ saleId: z.uuid('Selecciona la venta'), ...base })
export type DeliveryFormValues = z.infer<typeof deliveryFormSchema>

export const deliveryEditSchema = z.object(base)
export type DeliveryEditValues = z.infer<typeof deliveryEditSchema>
