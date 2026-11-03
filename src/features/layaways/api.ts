import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleLineInput } from '@/features/sales/api'
import type { LayawayPayment, LayawaySummary } from './types'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

export const listLayaways = (c: SupabaseClient) =>
  unwrap<LayawaySummary[]>(c.from('layaway_summaries').select('*').order('created_at', { ascending: false }))

export const listCustomerLayaways = (c: SupabaseClient, customerId: string) =>
  unwrap<LayawaySummary[]>(
    c.from('layaway_summaries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
  )

export const getLayaway = (c: SupabaseClient, id: string) =>
  unwrap<LayawaySummary>(c.from('layaway_summaries').select('*').eq('id', id).single())

export const getLayawayBySale = (c: SupabaseClient, saleId: string) =>
  unwrap<LayawaySummary | null>(c.from('layaway_summaries').select('*').eq('sale_id', saleId).maybeSingle())

export const listLayawayPayments = (c: SupabaseClient, saleId: string) =>
  unwrap<LayawayPayment[]>(c.from('payments').select('*').eq('sale_id', saleId).eq('kind', 'layaway').order('created_at'))

export const createLayaway = (
  c: SupabaseClient,
  a: { customerId: string; source: string; items: SaleLineInput[]; downPayment: string; dueDate: string; notes: string | null },
  key: string,
) =>
  unwrap<string>(
    c.rpc('create_layaway', {
      p_customer_id: a.customerId,
      p_source: a.source,
      p_items: a.items,
      p_down_payment: a.downPayment,
      p_due_date: a.dueDate,
      p_notes: a.notes,
      p_idempotency_key: key,
    }),
  )

export const recordLayawayPayment = (
  c: SupabaseClient,
  a: { layawayId: string; method: 'cash' | 'transfer'; amount: string; reference: string | null },
  key: string,
) =>
  unwrap<string>(
    c.rpc('record_layaway_payment', {
      p_layaway_id: a.layawayId,
      p_method: a.method,
      p_amount: a.amount,
      p_reference: a.reference,
      p_idempotency_key: key,
    }),
  )

export const convertLayaway = (c: SupabaseClient, layawayId: string) =>
  unwrap<string>(c.rpc('convert_layaway', { p_layaway_id: layawayId }))
