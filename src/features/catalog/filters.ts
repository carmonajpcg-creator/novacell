import type { Catalog, ProductKind, PublicProduct, UnitCondition } from './types'

export type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'name'

export interface CatalogFilters {
  kind: ProductKind | 'all'
  categorySlug: string
  query: string
  condition: UnitCondition | 'all'
  storage: number | null
  maxPrice: number | null
  onlyAvailable: boolean
  sort: SortKey
}

export const DEFAULT_FILTERS: CatalogFilters = {
  kind: 'all',
  categorySlug: '',
  query: '',
  condition: 'all',
  storage: null,
  maxPrice: null,
  onlyAvailable: false,
  sort: 'recent',
}

/** Minúsculas y sin acentos, para que "funda" encuentre "Fúnda" y "iphone" encuentre "iPhone". */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function filterProducts(catalog: Catalog, f: CatalogFilters): PublicProduct[] {
  const categoryById = new Map(catalog.categories.map((c) => [c.id, c]))
  const unitsByProduct = new Map<string, Catalog['units']>()
  for (const u of catalog.units) unitsByProduct.set(u.product_id, [...(unitsByProduct.get(u.product_id) ?? []), u])
  const q = normalizeText(f.query)

  const result = catalog.products.filter((p) => {
    const category = categoryById.get(p.category_id)
    if (f.kind !== 'all' && p.kind !== f.kind) return false
    if (f.categorySlug && category?.slug !== f.categorySlug) return false
    if (f.onlyAvailable && p.available_count <= 0) return false
    if (f.maxPrice !== null && (p.price_from === null || p.price_from > f.maxPrice)) return false
    if (q !== '') {
      const haystack = normalizeText(`${p.name} ${p.description ?? ''} ${category?.name ?? ''}`)
      if (!haystack.includes(q)) return false
    }
    if (p.kind === 'iphone' && (f.condition !== 'all' || f.storage !== null)) {
      const units = unitsByProduct.get(p.id) ?? []
      const match = units.some(
        (u) => (f.condition === 'all' || u.condition === f.condition) && (f.storage === null || u.storage_gb === f.storage),
      )
      if (!match) return false
    }
    return true
  })

  const price = (p: PublicProduct) => p.price_from ?? Number.POSITIVE_INFINITY
  const sorters: Record<SortKey, (a: PublicProduct, b: PublicProduct) => number> = {
    recent: (a, b) => b.created_at.localeCompare(a.created_at),
    price_asc: (a, b) => price(a) - price(b),
    price_desc: (a, b) => (b.price_from ?? -1) - (a.price_from ?? -1),
    name: (a, b) => a.name.localeCompare(b.name, 'es'),
  }
  return [...result].sort(sorters[f.sort])
}

/** Capacidades disponibles entre las unidades publicadas, para el filtro. */
export function availableStorages(catalog: Catalog): number[] {
  return [...new Set(catalog.units.map((u) => u.storage_gb))].sort((a, b) => a - b)
}
