import { Badge } from '@/components/ui/badge'
import { DELIVERY_STATUS_LABEL, type DeliveryStatus } from '../types'

const tone: Record<DeliveryStatus, 'warning' | 'brand' | 'success' | 'neutral'> = {
  pending: 'warning',
  preparing: 'brand',
  on_the_way: 'brand',
  delivered: 'success',
  cancelled: 'neutral',
}

export const DeliveryStatusBadge = ({ status }: { status: DeliveryStatus }) => (
  <Badge tone={tone[status]}>{DELIVERY_STATUS_LABEL[status]}</Badge>
)
