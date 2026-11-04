import type { SupabaseClient } from '@supabase/supabase-js'

export interface SalesReportRow {
  sale_id: string
  sale_number: string
  confirmed_on: string
  customer_name: string
  modality: 'cash' | 'credit' | 'layaway'
  total: number
  cost: number
  estimated_profit: number
  confirmed_paid: number
  balance: number
}

export interface PaymentsReportRow {
  payment_id: string
  confirmed_on: string
  sale_number: string
  customer_name: string
  kind: 'sale' | 'down_payment' | 'installment' | 'layaway'
  method: 'cash' | 'transfer'
  amount: number
  reference: string | null
}

export interface ReportSummary {
  from: string
  to: string
  sales_count: number
  sales_total: number
  cost_total: number
  collected_total: number
  collected_cash: number
  collected_transfer: number
  payments_count: number
}

async function rpc<T>(c: SupabaseClient, fn: string, from: string, to: string): Promise<T> {
  const { data, error } = await c.rpc(fn, { p_from: from, p_to: to })
  if (error) throw error
  return data as T
}

export const fetchSalesReport = (c: SupabaseClient, from: string, to: string) => rpc<SalesReportRow[]>(c, 'report_sales', from, to)
export const fetchPaymentsReport = (c: SupabaseClient, from: string, to: string) => rpc<PaymentsReportRow[]>(c, 'report_payments', from, to)
export const fetchReportSummary = (c: SupabaseClient, from: string, to: string) => rpc<ReportSummary>(c, 'report_summary', from, to)

export const MODALITY_LABEL = { cash: 'Contado', credit: 'Crédito', layaway: 'Apartado' } as const
export const PAYMENT_KIND_REPORT_LABEL = {
  sale: 'Venta de contado',
  down_payment: 'Enganche',
  installment: 'Abono de crédito',
  layaway: 'Apartado',
} as const

/** Rangos rápidos en hora de Ciudad de México a partir de la fecha de hoy (YYYY-MM-DD). */
export function presetRange(today: string, preset: 'today' | 'month' | 'prev-month' | 'last-30'): { from: string; to: string } {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number)
  const iso = (dt: Date) => dt.toISOString().slice(0, 10)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: today }
    case 'prev-month':
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) }
    case 'last-30':
      return { from: iso(new Date(Date.UTC(y, m - 1, d - 29))), to: today }
  }
}
