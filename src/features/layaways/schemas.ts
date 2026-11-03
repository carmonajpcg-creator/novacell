import { z } from 'zod'
import { moneyString } from '@/lib/money'

export const layawayPaymentSchema = z
  .object({
    method: z.enum(['cash', 'transfer']),
    amount: moneyString.refine((v) => Number(v) > 0, 'El importe debe ser mayor a cero'),
    reference: z.string().trim().max(100, 'Máximo 100 caracteres').optional().or(z.literal('')),
  })
  .refine((v) => v.method !== 'transfer' || (v.reference ?? '').trim().length >= 4, {
    message: 'Una transferencia requiere la clave de rastreo (mínimo 4 caracteres)',
    path: ['reference'],
  })
export type LayawayPaymentValues = z.infer<typeof layawayPaymentSchema>
