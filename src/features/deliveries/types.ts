export type DeliveryStatus = 'pending' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled'

export interface DeliverySummary {
  id: string
  delivery_number: string
  sale_id: string
  sale_number: string
  modality: 'cash' | 'credit' | 'layaway'
  sale_total: number
  customer_id: string
  customer_name: string
  customer_phone: string | null
  status: DeliveryStatus
  address: string
  reference_notes: string | null
  delivery_cost: number
  scheduled_date: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  notes: string | null
  created_at: string
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  on_the_way: 'En camino',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
}

/** Siguiente estado natural; los estados solo avanzan (CLAUDE.md §13, propuesta D3). */
export const NEXT_STATUS: Partial<Record<DeliveryStatus, { to: DeliveryStatus; label: string }>> = {
  pending: { to: 'preparing', label: 'Marcar en preparación' },
  preparing: { to: 'on_the_way', label: 'Marcar en camino' },
  on_the_way: { to: 'delivered', label: 'Marcar entregada' },
}

export const isTerminal = (s: DeliveryStatus) => s === 'delivered' || s === 'cancelled'
