import { Badge } from '@/components/ui/badge'
import { LAYAWAY_STATUS_LABEL, type LayawayStatus } from '../types'

const tone: Record<LayawayStatus, 'warning' | 'brand' | 'success' | 'neutral'> = {
  pending_down: 'warning',
  active: 'brand',
  settled: 'success',
  converted: 'success',
  cancelled: 'neutral',
}

export const LayawayStatusBadge = ({ status }: { status: LayawayStatus }) => (
  <Badge tone={tone[status]}>{LAYAWAY_STATUS_LABEL[status]}</Badge>
)

export const ExpiredBadge = ({ days }: { days: number }) => <Badge tone="danger">Reserva vencida · {days} d</Badge>
