import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ProductCard } from './components/ProductCard'
import { availableStorages, DEFAULT_FILTERS, filterProducts, type CatalogFilters, type SortKey } from './filters'
import { useCatalog } from './hooks'
import type { ProductKind, UnitCondition } from './types'

const TITLES: Record<ProductKind, { title: string; subtitle: string }> = {
  iphone: { title: 'iPhone', subtitle: 'Nuevos y seminuevos. Cada equipo se describe con su condición real.' },
  accessory: { title: 'Accesorios', subtitle: 'Fundas, cargadores, protectores y más.' },
}

export function CatalogPage({ kind }: { kind: ProductKind }) {
  const catalog = useCatalog()
  const [filters, setFilters] = useState<CatalogFilters>({ ...DEFAULT_FILTERS, kind })
  const patch = (p: Partial<CatalogFilters>) => setFilters((f) => ({ ...f, ...p }))

  const categories = (catalog.data?.categories ?? []).filter((c) => c.kind === kind)
  const storages = useMemo(() => (catalog.data ? availableStorages(catalog.data) : []), [catalog.data])
  const products = useMemo(() => (catalog.data ? filterProducts(catalog.data, { ...filters, kind }) : []), [catalog.data, filters, kind])
  const categoryName = (id: string) => catalog.data?.categories.find((c) => c.id === id)?.name
  const hasFilters = JSON.stringify({ ...filters, kind }) !== JSON.stringify({ ...DEFAULT_FILTERS, kind })

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{TITLES[kind].title}</h1>
        <p className="text-subtle">{TITLES[kind].subtitle}</p>
      </header>

      <section aria-label="Filtros" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            type="search"
            placeholder="Buscar…"
            aria-label="Buscar en el catálogo"
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
          <Select aria-label="Ordenar por" value={filters.sort} onChange={(e) => patch({ sort: e.target.value as SortKey })}>
            <option value="recent">Más recientes</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
            <option value="name">Nombre</option>
          </Select>
          {kind === 'iphone' && (
            <Select aria-label="Condición" value={filters.condition} onChange={(e) => patch({ condition: e.target.value as UnitCondition | 'all' })}>
              <option value="all">Nuevos y seminuevos</option>
              <option value="new">Solo nuevos</option>
              <option value="used">Solo seminuevos</option>
            </Select>
          )}
          {kind === 'iphone' && (
            <Select
              aria-label="Capacidad"
              value={filters.storage ?? ''}
              onChange={(e) => patch({ storage: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">Cualquier capacidad</option>
              {storages.map((s) => (
                <option key={s} value={s}>
                  {s} GB
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {categories.length > 0 && (
            <div role="group" aria-label="Categorías" className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={filters.categorySlug === ''}
                onClick={() => patch({ categorySlug: '' })}
                className={`rounded-full px-4 py-1.5 text-sm ${filters.categorySlug === '' ? 'bg-graphite text-white' : 'bg-muted hover:bg-gray-200'}`}
              >
                Todas
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={filters.categorySlug === c.slug}
                  onClick={() => patch({ categorySlug: c.slug })}
                  className={`rounded-full px-4 py-1.5 text-sm ${filters.categorySlug === c.slug ? 'bg-graphite text-white' : 'bg-muted hover:bg-gray-200'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={filters.onlyAvailable} onChange={(e) => patch({ onlyAvailable: e.target.checked })} />
            Solo disponibles
          </label>
          <label className="flex items-center gap-2 text-sm">
            Precio máximo
            <Input
              className="h-9 w-32"
              inputMode="numeric"
              placeholder="MXN"
              aria-label="Precio máximo en pesos"
              value={filters.maxPrice ?? ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                patch({ maxPrice: digits === '' ? null : Number(digits) })
              }}
            />
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, kind })}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </section>

      {catalog.isPending ? (
        <LoadingState label="Cargando catálogo…" />
      ) : catalog.isError ? (
        <ErrorState message="No pudimos cargar el catálogo. Intenta de nuevo en un momento." onRetry={() => void catalog.refetch()} />
      ) : products.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No encontramos resultados' : 'Aún no hay productos en esta sección'}
          description={hasFilters ? 'Prueba con otros filtros.' : 'Estamos preparando el catálogo. Vuelve pronto.'}
        />
      ) : (
        <>
          <p className="text-sm text-subtle" role="status">
            {products.length} {products.length === 1 ? 'producto' : 'productos'}
          </p>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} categoryName={categoryName(p.category_id)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
