const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

/** Formatea un importe como MXN. Solo para mostrar: el cálculo financiero vive en el backend. */
export function formatMXN(amount: number): string {
  return mxn.format(amount)
}

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

/**
 * Formatea una fecha. Una fecha sin hora (`2026-11-10`, como las de vencimiento) se interpreta como día
 * calendario local: `new Date('2026-11-10')` sería medianoche UTC y en México mostraría el día anterior.
 */
export function formatDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y = 0, m = 1, d = 1] = value.split('-').map(Number)
    return dateFormat.format(new Date(y, m - 1, d))
  }
  return dateFormat.format(typeof value === 'string' ? new Date(value) : value)
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(now)
}
