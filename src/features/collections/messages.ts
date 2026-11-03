import { formatDate, formatMXN } from '@/lib/format'
import type { QueueItem } from './types'

/**
 * Plantillas PROVISIONALES de recordatorio (docs/PENDING_RULES.md, B4): redacción pendiente de aprobación.
 * No mencionan recargos, penalizaciones ni consecuencias porque no existe una política aprobada.
 */
export function buildReminderMessage(item: QueueItem): string {
  const first = item.customer_name.trim().split(/\s+/)[0] ?? ''
  const amount = formatMXN(item.amount_due)
  const due = formatDate(item.due_date)
  const greeting = `Hola ${first}, te saludamos de NovaCell.`
  const overdue = item.days_overdue > 0

  if (item.kind === 'installment') {
    const what = `tu pago de ${amount} del crédito ${item.folio} (cuota ${item.installment_number})`
    return overdue
      ? `${greeting} Te recordamos que ${what} venció el ${due}. ¿Nos confirmas cuándo podrías realizarlo? Gracias.`
      : `${greeting} Te recordamos que ${what} vence el ${due}. Gracias por tu preferencia.`
  }
  const what = `tu apartado ${item.folio} tiene un saldo de ${amount}`
  return overdue
    ? `${greeting} Te recordamos que ${what} y su fecha límite fue el ${due}. ¿Nos confirmas cómo deseas continuar? Gracias.`
    : `${greeting} Te recordamos que ${what} y su fecha límite es el ${due}. Gracias por tu preferencia.`
}

export function dueLabel(daysOverdue: number): string {
  if (daysOverdue > 0) return `Vencido hace ${daysOverdue} d`
  if (daysOverdue === 0) return 'Vence hoy'
  return `Vence en ${-daysOverdue} d`
}
