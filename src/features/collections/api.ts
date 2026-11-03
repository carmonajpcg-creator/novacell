import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueueItem, Reminder, ReminderKind, ReminderOutcome } from './types'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

export const listQueue = (c: SupabaseClient) =>
  unwrap<QueueItem[]>(c.from('collection_queue').select('*').order('due_date'))

export const listReminders = (c: SupabaseClient, item: Pick<QueueItem, 'kind' | 'ref_id'>) =>
  unwrap<Reminder[]>(
    c
      .from('collection_reminders')
      .select('*')
      .eq(item.kind === 'installment' ? 'installment_id' : 'layaway_id', item.ref_id)
      .order('created_at', { ascending: false }),
  )

/** Prepara un recordatorio (estado "preparado"). No envía nada. */
export const prepareReminder = (c: SupabaseClient, item: QueueItem, message: string) => {
  const kind: ReminderKind = item.days_overdue > 0 ? 'overdue' : 'upcoming'
  return unwrap<Reminder>(
    c
      .from('collection_reminders')
      .insert({
        customer_id: item.customer_id,
        installment_id: item.kind === 'installment' ? item.ref_id : null,
        layaway_id: item.kind === 'layaway' ? item.ref_id : null,
        kind,
        message,
      })
      .select()
      .single(),
  )
}

/** Registra que el administrador abrió WhatsApp (no que el mensaje se haya enviado). */
export const markWhatsAppOpened = (c: SupabaseClient, id: string) =>
  unwrap<Reminder>(c.from('collection_reminders').update({ status: 'whatsapp_opened' }).eq('id', id).select().single())

export const markContacted = (
  c: SupabaseClient,
  id: string,
  v: { outcome: ReminderOutcome; promisedDate: string | null; note: string | null },
) =>
  unwrap<Reminder>(
    c
      .from('collection_reminders')
      .update({ status: 'contacted', outcome: v.outcome, promised_date: v.promisedDate, note: v.note })
      .eq('id', id)
      .select()
      .single(),
  )
