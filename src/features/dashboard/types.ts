/** Métricas calculadas en la base de datos (función `dashboard_metrics`). Aquí solo se muestran. */
export interface Counted {
  count: number
  total: number
}

export interface Collected {
  total: number
  cash: number
  transfer: number
}

export interface DashboardMetrics {
  today: string
  month_start: string
  sales_today: Counted
  sales_month: Counted
  collected_today: Collected
  collected_month: Collected
  pending_verification: Counted
  estimated_profit_month: number
  credits_active: number
  receivable_credits: number
  receivable_layaways: number
  overdue_installments: Counted
  overdue_layaways: Counted
  available_units: number
  accessory_variants_in_stock: number
  accessory_pieces: number
  deliveries_open: number
  next_deliveries: {
    id: string
    delivery_number: string
    status: 'pending' | 'preparing' | 'on_the_way'
    scheduled_date: string | null
    customer_name: string
  }[]
  last_14_days: { date: string; sales_total: number; collected_total: number }[]
}
