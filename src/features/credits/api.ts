import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleLineInput } from '@/features/sales/api'
import type { CreditPayment, CreditSummary, InstallmentStatus } from './types'
import type { Frequency } from './schedule'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

export const listCredits = (c: SupabaseClient) =>
  unwrap<CreditSummary[]>(c.from('credit_summaries').select('*').order('created_at', { ascending: false }))

export const listCustomerCredits = (c: SupabaseClient, customerId: string) =>
  unwrap<CreditSummary[]>(
    c.from('credit_summaries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
  )

export const getCredit = (c: SupabaseClient, id: string) =>
  unwrap<CreditSummary>(c.from('credit_summaries').select('*').eq('id', id).single())

export const getCreditBySale = (c: SupabaseClient, saleId: string) =>
  unwrap<CreditSummary | null>(c.from('credit_summaries').select('*').eq('sale_id', saleId).maybeSingle())

export const listInstallments = (c: SupabaseClient, creditId: string) =>
  unwrap<InstallmentStatus[]>(c.from('installment_status').select('*').eq('credit_id', creditId).order('number'))

export const listCreditPayments = (c: SupabaseClient, saleId: string) =>
  unwrap<CreditPayment[]>(
    c.from('payments').select('*').eq('sale_id', saleId).in('kind', ['down_payment', 'installment']).order('created_at'),
  )

export interface CreateCreditArgs {
  customerId: string
  source: string
  items: SaleLineInput[]
  financedTotal: string
  downPayment: string
  frequency: Frequency
  installments: number
  firstDueDate: string
  notes: string | null
}

export const createCreditSale = (c: SupabaseClient, a: CreateCreditArgs, key: string) =>
  unwrap<string>(
    c.rpc('create_credit_sale', {
      p_customer_id: a.customerId,
      p_source: a.source,
      p_items: a.items,
      p_financed_total: a.financedTotal,
      p_down_payment: a.downPayment,
      p_frequency: a.frequency,
      p_installments: a.installments,
      p_first_due_date: a.firstDueDate,
      p_notes: a.notes,
      p_idempotency_key: key,
    }),
  )

export const recordCreditPayment = (
  c: SupabaseClient,
  a: { creditId: string; kind: 'down_payment' | 'installment'; method: 'cash' | 'transfer'; amount: string; reference: string | null },
  key: string,
) =>
  unwrap<string>(
    c.rpc('record_credit_payment', {
      p_credit_id: a.creditId,
      p_kind: a.kind,
      p_method: a.method,
      p_amount: a.amount,
      p_reference: a.reference,
      p_idempotency_key: key,
    }),
  )

export interface PaymentAllocationRow {
  amount: number
  reversed_at: string | null
  installment: { number: number; due_date: string } | null
}

export const listPaymentAllocations = (c: SupabaseClient, paymentId: string) =>
  unwrap<PaymentAllocationRow[]>(
    c.from('payment_allocations').select('amount, reversed_at, installment:installments(number, due_date)').eq('payment_id', paymentId),
  )

export interface PaymentOverview extends CreditPayment {
  sale: { sale_number: string; customer: { name: string } | null; credit: { id: string; credit_number: string } | null } | null
}

export const listAllCreditPayments = (c: SupabaseClient) =>
  unwrap<PaymentOverview[]>(
    c
      .from('payments')
      .select('*, sale:sales(sale_number, customer:customers(name), credit:credits(id, credit_number))')
      .in('kind', ['down_payment', 'installment'])
      .order('created_at', { ascending: false })
      .limit(300),
  )