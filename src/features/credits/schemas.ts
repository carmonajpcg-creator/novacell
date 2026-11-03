import { z } from 'zod'
import { moneyString } from '@/lib/money'

export const creditTermsSchema = z.object({
  financedTotal: moneyString.refine((v) => Number(v) > 0, 'El precio financiado debe ser mayor a cero'),
  downPayment: moneyString,
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  installments: z.string().trim().regex(/^[1-9]\d{0,2}$/, 'Ingresa un número de cuotas (1 a 260)').refine((v) => Number(v) <= 260, 'Máximo 260 cuotas'),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona la fecha del primer pago'),
})
export type CreditTermsValues = z.infer<typeof creditTermsSchema>

export const creditPaymentSchema = z
  .object({
    kind: z.enum(['down_payment', 'installment']),
    method: z.enum(['cash', 'transfer']),
    amount: moneyString.refine((v) => Number(v) > 0, 'El importe debe ser mayor a cero'),
    reference: z.string().trim().max(100, 'Máximo 100 caracteres').optional().or(z.literal('')),
  })
  .refine((v) => v.method !== 'transfer' || (v.reference ?? '').trim().length >= 4, {
    message: 'Una transferencia requiere la clave de rastreo (mínimo 4 caracteres)',
    path: ['reference'],
  })
export type CreditPaymentValues = z.infer<typeof creditPaymentSchema>
