import { z } from 'zod'

/**
 * Importe monetario capturado como texto con hasta 2 decimales (p. ej. "1299.50").
 * Se mantiene como string hasta llegar a la base de datos (NUMERIC(14,2)); nunca se opera con floats.
 */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Ingresa un importe válido (hasta 2 decimales)')
