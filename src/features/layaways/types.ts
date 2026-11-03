export type LayawayStatus = 'pending_down' | 'active' | 'settled' | 'converted' | 'cancelled'

export interface LayawaySummary {
  id: string
  layaway_number: string
  sale_id: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  sale_number: string
  status: LayawayStatus
  down_payment: number
  total: number
  due_date: string
  notes: string | null
  created_at: string
  settled_at: string | null
  converted_at: string | null
  cancelled_at: string | null
  confirmed_paid: number
  pending_verification: number
  balance: number
  is_expired: boolean
  days_overdue: number
}

export interface LayawayPayment {
  id: string
  sale_id: string
  kind: 'layaway'
  method: 'cash' | 'transfer'
  amount: number
  status: 'pending' | 'confirmed' | 'rejected' | 'reversed'
  reference: string | null
  status_reason: string | null
  confirmed_at: string | null
  created_at: string
}

export const LAYAWAY_STATUS_LABEL: Record<LayawayStatus, string> = {
  pending_down: 'Pendiente de anticipo',
  active: 'Vigente',
  settled: 'Liquidado',
  converted: 'Convertido en venta',
  cancelled: 'Cancelado',
}
