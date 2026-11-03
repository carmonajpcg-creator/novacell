import type { Frequency } from './schedule'

export type CreditStatus = 'pending_down' | 'active' | 'settled' | 'cancelled'

export interface CreditSummary {
  id: string
  credit_number: string
  sale_id: string
  customer_id: string
  customer_name: string
  sale_number: string
  status: CreditStatus
  financed_total: number
  down_payment: number
  principal: number
  frequency: Frequency
  installments_count: number
  first_due_date: string
  notes: string | null
  created_at: string
  settled_at: string | null
  cancelled_at: string | null
  down_paid: number
  installments_paid: number
  balance: number
  pending_verification: number
  overdue_amount: number
  overdue_count: number
  next_due_date: string | null
}

export interface InstallmentStatus {
  id: string
  credit_id: string
  number: number
  due_date: string
  amount: number
  paid: number
  remaining: number
  is_overdue: boolean
  days_overdue: number
}

export interface CreditPayment {
  id: string
  sale_id: string
  kind: 'down_payment' | 'installment'
  method: 'cash' | 'transfer'
  amount: number
  status: 'pending' | 'confirmed' | 'rejected' | 'reversed'
  reference: string | null
  status_reason: string | null
  confirmed_at: string | null
  created_at: string
}

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  pending_down: 'Pendiente de enganche',
  active: 'Activo',
  settled: 'Liquidado',
  cancelled: 'Cancelado',
}

export const PAYMENT_KIND_LABEL = { down_payment: 'Enganche', installment: 'Abono' } as const
