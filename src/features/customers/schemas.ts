import { z } from 'zod'

/** Quita espacios, guiones y paréntesis: se guardan solo los 10 dígitos. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]/g, '')
}

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Ingresa el nombre').max(120, 'Máximo 120 caracteres'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{10}$/.test(normalizePhone(v)), 'Ingresa un teléfono de 10 dígitos'),
  contact_method: z.enum(['whatsapp', 'phone', 'facebook', 'in_person', 'other']),
  acquisition_source: z.enum(['facebook', 'whatsapp', 'in_person', 'other']),
  notes: z.string().trim().max(2000, 'Máximo 2000 caracteres').optional().or(z.literal('')),
})
export type CustomerValues = z.infer<typeof customerSchema>
