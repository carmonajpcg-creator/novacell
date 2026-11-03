export type SaleStatus = 'pending' | 'confirmed' | 'cancelled'
export type PaymentMethod = 'cash' | 'transfer'
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'reversed'

export interface SaleSummary {
  id: string
  sale_number: string
  customer_id: string
  customer_name: string
  modality: 'cash' | 'credit'
  status: SaleStatus
  source: 'facebook' | 'whatsapp' | 'in_person' | 'other'
  total: number
  notes: string | null
  cancel_reason: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  created_at: string
  confirmed_paid: number
  pending_paid: number
}

export interface SaleItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  unit_cost: number
  product_unit_id: string | null
  product_variant_id: string | null
  unit?: { imei: string; internal_code: string } | null
}

export interface Payment {
  id: string
  sale_id: string
  kind: 'sale' | 'down_payment' | 'installment'
  method: PaymentMethod
  amount: number
  status: PaymentStatus
  reference: string | null
  status_reason: string | null
  confirmed_at: string | null
  created_at: string
}

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pendiente de verificar',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
  reversed: 'Revertido',
}
