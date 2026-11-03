import { Link, NavLink, Outlet } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { Wordmark } from '@/components/shared/Wordmark'
import { useCart } from '@/features/catalog/CartContext'
import { useBusinessInfo } from '@/features/catalog/hooks'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/iphone', label: 'iPhone', end: false },
  { to: '/accesorios', label: 'Accesorios', end: false },
  { to: '/contacto', label: 'Contacto', end: false },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-muted text-graphite' : 'text-subtle hover:text-graphite')

export function PublicLayout() {
  const { count } = useCart()
  const info = useBusinessInfo()

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" aria-label="NovaCell, inicio">
            <Wordmark />
          </Link>
          <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/carrito"
            className="relative inline-flex h-11 items-center gap-2 rounded-xl bg-muted px-4 text-sm font-medium hover:bg-gray-200"
            aria-label={`Carrito, ${count} ${count === 1 ? 'artículo' : 'artículos'}`}
          >
            <ShoppingBag className="size-5" aria-hidden />
            <span aria-hidden>Carrito</span>
            {count > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-white" data-testid="cart-count">
                {count}
              </span>
            )}
          </Link>
        </div>
        <nav aria-label="Principal móvil" className="flex gap-1 overflow-x-auto border-t border-gray-100 px-3 py-1 md:hidden">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        <Outlet />
      </main>

      <footer className="bg-graphite py-10 text-sm text-gray-300">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">{info.data?.business_name ?? 'NovaCell'}</p>
            <p>Tecnología que conecta contigo.</p>
          </div>
          <nav aria-label="Pie de página" className="space-y-1">
            <p className="font-medium text-white">Tienda</p>
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="block hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="space-y-1">
            <p className="font-medium text-white">Contacto</p>
            {info.data?.business_hours && <p>{info.data.business_hours}</p>}
            {info.data?.business_address && <p>{info.data.business_address}</p>}
            {!info.data?.business_hours && !info.data?.business_address && <p>Escríbenos por WhatsApp desde tu carrito.</p>}
          </div>
        </div>
      </footer>
    </div>
  )
}
