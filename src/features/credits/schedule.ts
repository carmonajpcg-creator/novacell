export type Frequency = 'weekly' | 'biweekly' | 'monthly'

export interface ScheduleItem {
  number: number
  /** Fecha ISO (YYYY-MM-DD). */
  due: string
  cents: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate()

function parse(iso: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return { y, m, d }
}

function addDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Suma k meses desde la fecha base (no encadenada): 31 ene +1 = 28 feb, +2 = 31 mar. Igual que PostgreSQL. */
function addMonths(iso: string, k: number): string {
  const { y, m, d } = parse(iso)
  const idx = m - 1 + k
  const year = y + Math.floor(idx / 12)
  const month1 = (idx % 12) + 1
  return `${year}-${pad(month1)}-${pad(Math.min(d, daysInMonth(year, month1)))}`
}

/**
 * Vista previa del calendario. Mismo algoritmo que `create_credit_sale` (propuesta C3): cuotas iguales en
 * centavos y el residuo a la última cuota. Es solo informativa: el calendario definitivo lo crea la base de datos.
 */
export function buildSchedule(principalCents: number, count: number, frequency: Frequency, firstDate: string): ScheduleItem[] {
  if (!Number.isInteger(principalCents) || principalCents < 1 || !Number.isInteger(count) || count < 1) return []
  const base = Math.floor(principalCents / count)
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    due:
      frequency === 'weekly'
        ? addDays(firstDate, 7 * i)
        : frequency === 'biweekly'
          ? addDays(firstDate, 14 * i)
          : addMonths(firstDate, i),
    cents: i === count - 1 ? principalCents - base * (count - 1) : base,
  }))
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
}
