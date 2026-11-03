import { z } from 'zod'
import { formatMXN } from './format'

/**
 * Importe monetario capturado como texto con hasta 2 decimales (p. ej. "1299.50").
 * Se mantiene como string hasta llegar a la base de datos (NUMERIC(14,2)); nunca se opera con floats.
 */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Ingresa un importe válido (hasta 2 decimales)')

/** Convierte un importe válido ("1299.5") a centavos enteros, para sumar sin errores de punto flotante. */
export function toCents(value: string): number {
  const [whole = '0', frac = ''] = value.trim().split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2))
}

export function isMoney(value: string): boolean {
  return moneyString.safeParse(value).success
}

/** Solo para mostrar: el total definitivo siempre lo calcula la base de datos. */
export function formatCents(cents: number): string {
  return formatMXN(cents / 100)
}
