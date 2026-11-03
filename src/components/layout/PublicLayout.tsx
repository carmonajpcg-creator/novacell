import { Link, Outlet } from 'react-router-dom'
import { Wordmark } from '@/components/shared/Wordmark'

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="NovaCell, inicio">
            <Wordmark />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="bg-graphite py-8 text-sm text-gray-300">
        <div className="mx-auto max-w-6xl px-4">
          NovaCell · Tecnología que conecta contigo.
        </div>
      </footer>
    </div>
  )
}
