import { z } from 'zod'
import { moneyString } from '@/lib/money'

export const paymentSchema = z
  .object({
    method: z.enum(['cash', 'transfer']),
    amount: moneyString.refine((v) => Number(v) > 0, 'El importe debe ser mayor a cero'),
    reference: z.string().trim().max(100, 'Máximo 100 caracteres').optional().or(z.literal('')),
  })
  .refine((v) => v.method !== 'transfer' || (v.reference ?? '').trim().length >= 4, {
    message: 'Una transferencia requiere la clave de rastreo (mínimo 4 caracteres)',
    path: ['reference'],
  })
export type PaymentValues = z.infer<typeof paymentSchema>

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Escribe el motivo').max(500, 'Máximo 500 caracteres'),
})
export type ReasonValues = z.infer<typeof reasonSchema>

export const SALE_SOURCES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'in_person', label: 'Presencial' },
  { value: 'other', label: 'Otros' },
] as const
