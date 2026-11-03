import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

export function ErrorState({
  title = 'Algo salió mal',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertCircle className="size-8 text-danger" aria-hidden />
      <p className="font-medium">{title}</p>
      {message && <p className="text-sm text-subtle">{message}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Inbox className="size-8 text-subtle" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-subtle">{description}</p>}
      {action}
    </div>
  )
}
