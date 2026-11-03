import { Badge } from '@/components/ui/badge'
import {
  PAYMENT_STATUS_LABEL,
  SALE_STATUS_LABEL,
  type PaymentStatus,
  type SaleStatus,
} from '../types'

const saleTone: Record<SaleStatus, 'warning' | 'success' | 'neutral'> = {
  pending: 'warning',
  confirmed: 'success',
  cancelled: 'neutral',
}

const paymentTone: Record<PaymentStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  reversed: 'neutral',
}

export const SaleStatusBadge = ({ status }: { status: SaleStatus }) => (
  <Badge tone={saleTone[status]}>{SALE_STATUS_LABEL[status]}</Badge>
)

export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={paymentTone[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>
)
