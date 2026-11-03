import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth'
import { cn } from '@/lib/utils'
import { adminNav } from './adminNav'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand text-white' : 'text-graphite hover:bg-muted',
  )

export function AdminLayout() {
  const { email, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-muted md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-surface p-4 md:flex">
        <Wordmark className="mb-6 px-3" />
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1">
          {adminNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-gray-200 bg-surface px-4">
          <Wordmark className="md:hidden" />
          <span className="hidden text-sm text-subtle md:inline">{email}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut className="size-4" aria-hidden /> Salir
          </Button>
        </header>
        <nav
          aria-label="Principal móvil"
          className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-surface p-2 md:hidden"
        >
          {adminNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
