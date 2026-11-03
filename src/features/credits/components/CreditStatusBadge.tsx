import { Badge } from '@/components/ui/badge'
import { CREDIT_STATUS_LABEL, type CreditStatus, type InstallmentStatus } from '../types'

const tone: Record<CreditStatus, 'warning' | 'brand' | 'success' | 'neutral'> = {
  pending_down: 'warning',
  active: 'brand',
  settled: 'success',
  cancelled: 'neutral',
}

export const CreditStatusBadge = ({ status }: { status: CreditStatus }) => (
  <Badge tone={tone[status]}>{CREDIT_STATUS_LABEL[status]}</Badge>
)

export function InstallmentBadge({ i }: { i: InstallmentStatus }) {
  if (i.remaining <= 0) return <Badge tone="success">Pagada</Badge>
  if (i.is_overdue) return <Badge tone="danger">Vencida · {i.days_overdue} d</Badge>
  if (i.paid > 0) return <Badge tone="warning">Parcial</Badge>
  return <Badge>Pendiente</Badge>
}
