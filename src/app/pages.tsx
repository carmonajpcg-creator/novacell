import { Link, useLocation } from 'react-router-dom'
import { EmptyState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { adminNav } from '@/components/layout/adminNav'

export function AdminSectionPage() {
  const { pathname } = useLocation()
  const item = adminNav.find((n) => n.to === pathname)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{item?.label ?? 'Panel'}</h1>
      <EmptyState
        title="Sección en construcción"
        description="Esta sección se implementará en una fase posterior del roadmap."
      />
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <Button asChild>
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  )
}
