import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleSummary } from '@/features/sales/types'
import { blankToNull } from '@/features/inventory/schemas'
import type { DeliveryFormValues, DeliveryEditValues } from './schemas'
import type { DeliveryStatus, DeliverySummary } from './types'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

export const listDeliveries = (c: SupabaseClient) =>
  unwrap<DeliverySummary[]>(c.from('delivery_summaries').select('*').order('created_at', { ascending: false }))

export const getDelivery = (c: SupabaseClient, id: string) =>
  unwrap<DeliverySummary>(c.from('delivery_summaries').select('*').eq('id', id).single())

/** La entrega vigente (no cancelada) de una venta, si existe. */
export const getActiveDeliveryBySale = (c: SupabaseClient, saleId: string) =>
  unwrap<DeliverySummary | null>(
    c.from('delivery_summaries').select('*').eq('sale_id', saleId).neq('status', 'cancelled').maybeSingle(),
  )

/** Ventas confirmadas (las únicas que admiten entrega). */
export const listConfirmedSales = (c: SupabaseClient) =>
  unwrap<SaleSummary[]>(
    c.from('sale_summaries').select('*').eq('status', 'confirmed').order('created_at', { ascending: false }).limit(300),
  )

export const createDelivery = (c: SupabaseClient, v: DeliveryFormValues, key: string) =>
  unwrap<string>(
    c.rpc('create_delivery', {
      p_sale_id: v.saleId,
      p_address: v.address,
      p_reference_notes: blankToNull(v.reference_notes),
      p_cost: v.delivery_cost.trim() === '' ? '0' : v.delivery_cost,
      p_scheduled_date: v.scheduled_date.trim() === '' ? null : v.scheduled_date,
      p_notes: blankToNull(v.notes),
      p_idempotency_key: key,
    }),
  )

export const setDeliveryStatus = (c: SupabaseClient, id: string, status: DeliveryStatus, reason: string | null) =>
  unwrap<string>(c.rpc('set_delivery_status', { p_delivery_id: id, p_status: status, p_reason: reason }))

/** Edita los datos descriptivos por RPC (valida y deja bitácora); el estado cambia solo con set_delivery_status. */
export const updateDelivery = (c: SupabaseClient, id: string, v: DeliveryEditValues) =>
  unwrap(
    c.rpc('update_delivery', {
      p_delivery_id: id,
      p_address: v.address,
      p_reference_notes: blankToNull(v.reference_notes),
      p_cost: v.delivery_cost.trim() === '' ? '0' : v.delivery_cost,
      p_scheduled_date: v.scheduled_date.trim() === '' ? null : v.scheduled_date,
      p_notes: blankToNull(v.notes),
    }),
  )
