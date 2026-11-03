import { Link } from 'react-router-dom'
import { ArrowRight, MessageCircle, ShoppingBag, Smartphone } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { ProductCard } from './components/ProductCard'
import { useBusinessInfo, useCatalog } from './hooks'

const steps = [
  { icon: Smartphone, title: 'Elige tu equipo', text: 'Explora iPhone nuevos y seminuevos y accesorios con fotografías reales.' },
  { icon: ShoppingBag, title: 'Arma tu pedido', text: 'Agrega lo que te interesa al carrito. No necesitas crear una cuenta.' },
  { icon: MessageCircle, title: 'Confírmalo por WhatsApp', text: 'Te enviamos precio final y disponibilidad. Abrir WhatsApp no compromete tu compra.' },
]

export function StoreHomePage() {
  const catalog = useCatalog()
  const info = useBusinessInfo()

  const recent = (catalog.data?.products ?? []).filter((p) => p.available_count > 0).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4)
  const categoryName = (id: string) => catalog.data?.categories.find((c) => c.id === id)?.name

  return (
    <div className="space-y-16">
      <section className="space-y-6 py-8 text-center md:py-16" aria-labelledby="hero-title">
        <p className="text-sm font-medium uppercase tracking-wide text-brand">{info.data?.business_name ?? 'NovaCell'}</p>
        <h1 id="hero-title" className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
          Tecnología que conecta contigo.
        </h1>
        <p className="mx-auto max-w-xl text-lg text-subtle">iPhone nuevos y seminuevos, y los accesorios que necesitas, con atención directa por WhatsApp.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/iphone">
              Ver iPhone <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link to="/accesorios">Ver accesorios</Link>
          </Button>
        </div>
      </section>

      <section className="space-y-6" aria-labelledby="recent-title">
        <div className="flex items-end justify-between">
          <h2 id="recent-title" className="text-2xl font-semibold tracking-tight">
            Recién llegados
          </h2>
          <Link to="/iphone" className="text-sm text-brand hover:underline">
            Ver todo
          </Link>
        </div>
        {catalog.isPending ? (
          <LoadingState label="Cargando catálogo…" />
        ) : catalog.isError ? (
          <ErrorState message="No pudimos cargar el catálogo. Intenta de nuevo en un momento." onRetry={() => void catalog.refetch()} />
        ) : recent.length === 0 ? (
          <p className="rounded-card bg-muted p-8 text-center text-subtle">Estamos preparando nuestro catálogo. Vuelve pronto.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {recent.map((p) => (
              <ProductCard key={p.id} product={p} categoryName={categoryName(p.category_id)} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6" aria-labelledby="how-title">
        <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
          Así de fácil
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="space-y-3 rounded-card border border-gray-200 bg-surface p-6">
              <Icon className="size-6 text-brand" aria-hidden />
              <h3 className="font-medium">
                {i + 1}. {title}
              </h3>
              <p className="text-sm text-subtle">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
