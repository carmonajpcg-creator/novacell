import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductVariant } from '@/features/inventory/types'
import type { Payment, PaymentMethod, SaleItem, SaleSummary } from './types'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

// ----- Lectura -----
export const listSales = (c: SupabaseClient) =>
  unwrap<SaleSummary[]>(c.from('sale_summaries').select('*').order('created_at', { ascending: false }))

export const listCustomerSales = (c: SupabaseClient, customerId: string) =>
  unwrap<SaleSummary[]>(
    c.from('sale_summaries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
  )

export const getSale = (c: SupabaseClient, id: string) =>
  unwrap<SaleSummary>(c.from('sale_summaries').select('*').eq('id', id).single())

export const listSaleItems = (c: SupabaseClient, saleId: string) =>
  unwrap<SaleItem[]>(
    c
      .from('sale_items')
      .select('id, description, quantity, unit_price, unit_cost, product_unit_id, product_variant_id, unit:product_units(imei, internal_code)')
      .eq('sale_id', saleId)
      .order('created_at'),
  )

export const listPayments = (c: SupabaseClient, saleId: string) =>
  unwrap<Payment[]>(c.from('payments').select('*').eq('sale_id', saleId).order('created_at'))

export interface SellableVariant extends ProductVariant {
  product: { name: string } | null
}

export const listSellableVariants = (c: SupabaseClient) =>
  unwrap<SellableVariant[]>(
    c.from('product_variants').select('*, product:products(name)').eq('is_active', true).gt('stock_quantity', 0).order('sku'),
  )

// ----- Operaciones (RPC transaccionales: el total y el inventario los decide la base de datos) -----
export interface SaleLineInput {
  unit_id?: string
  variant_id?: string
  quantity?: number
  unit_price?: string
}

export const createSale = (
  c: SupabaseClient,
  args: { customerId: string; source: string; items: SaleLineInput[]; notes: string | null },
  key: string,
) =>
  unwrap<string>(
    c.rpc('create_sale', {
      p_customer_id: args.customerId,
      p_source: args.source,
      p_items: args.items,
      p_notes: args.notes,
      p_idempotency_key: key,
    }),
  )

export const recordPayment = (
  c: SupabaseClient,
  args: { saleId: string; method: PaymentMethod; amount: string; reference: string | null },
  key: string,
) =>
  unwrap<string>(
    c.rpc('record_payment', {
      p_sale_id: args.saleId,
      p_method: args.method,
      p_amount: args.amount,
      p_reference: args.reference,
      p_idempotency_key: key,
    }),
  )

export const confirmPayment = (c: SupabaseClient, paymentId: string) =>
  unwrap<string>(c.rpc('confirm_payment', { p_payment_id: paymentId }))

export const rejectPayment = (c: SupabaseClient, paymentId: string, reason: string) =>
  unwrap<string>(c.rpc('reject_payment', { p_payment_id: paymentId, p_reason: reason }))

export const reversePayment = (c: SupabaseClient, paymentId: string, reason: string) =>
  unwrap<string>(c.rpc('reverse_payment', { p_payment_id: paymentId, p_reason: reason }))

export const cancelSale = (c: SupabaseClient, saleId: string, reason: string) =>
  unwrap<string>(c.rpc('cancel_sale', { p_sale_id: saleId, p_reason: reason }))
