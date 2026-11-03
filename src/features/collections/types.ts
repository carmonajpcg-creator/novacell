export type ReminderStatus = 'prepared' | 'whatsapp_opened' | 'contacted'
export type ReminderOutcome = 'no_answer' | 'promise_to_pay' | 'paid' | 'refused' | 'other'
export type ReminderKind = 'upcoming' | 'overdue' | 'manual'

export interface QueueItem {
  kind: 'installment' | 'layaway'
  ref_id: string
  credit_id: string | null
  layaway_id: string | null
  customer_id: string
  customer_name: string
  customer_phone: string | null
  folio: string
  installment_number: number | null
  due_date: string
  amount_due: number
  /** > 0: vencido hace N días. <= 0: faltan -N días. */
  days_overdue: number
  last_reminder_status: ReminderStatus | null
  last_reminder_at: string | null
  last_outcome: ReminderOutcome | null
  last_promised_date: string | null
}

export interface Reminder {
  id: string
  customer_id: string
  installment_id: string | null
  layaway_id: string | null
  kind: ReminderKind
  message: string
  status: ReminderStatus
  whatsapp_opened_at: string | null
  contacted_at: string | null
  outcome: ReminderOutcome | null
  promised_date: string | null
  note: string | null
  created_at: string
}

/**
 * Etiquetas deliberadamente honestas (CLAUDE.md §12): abrir WhatsApp NO demuestra que el mensaje se envió,
 * por eso no existe ningún estado "enviado" o "entregado".
 */
export const REMINDER_STATUS_LABEL: Record<ReminderStatus, string> = {
  prepared: 'Mensaje preparado',
  whatsapp_opened: 'WhatsApp abierto (no confirma el envío)',
  contacted: 'Contactado',
}

export const OUTCOME_LABEL: Record<ReminderOutcome, string> = {
  no_answer: 'Sin respuesta',
  promise_to_pay: 'Promesa de pago',
  paid: 'Dice que ya pagó',
  refused: 'Se negó a pagar',
  other: 'Otro',
}
