import { Link, useLocation } from 'react-router-dom'
import { EmptyState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { adminNav } from '@/components/layout/adminNav'

export function HomePage() {
  return (
    <section className="space-y-4 py-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">NovaCell</h1>
      <p className="text-lg text-subtle">Tecnología que conecta contigo.</p>
      <p className="text-sm text-subtle">El catálogo estará disponible próximamente.</p>
    </section>
  )
}

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
