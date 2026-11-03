import { Link } from 'react-router-dom'
import { Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatMXN } from '@/lib/format'
import { imageUrl } from '../hooks'
import { AVAILABILITY_LABEL, type Availability, type PublicProduct } from '../types'

export function PriceLabel({ from, to }: { from: number | null; to: number | null }) {
  if (from === null) return <span className="text-sm text-subtle">No disponible por ahora</span>
  if (to === null || to === from) return <span className="text-lg font-semibold">{formatMXN(from)}</span>
  return (
    <span className="text-lg font-semibold">
      <span className="text-sm font-normal text-subtle">Desde </span>
      {formatMXN(from)}
    </span>
  )
}

const tone: Record<Availability, 'success' | 'warning' | 'neutral'> = { available: 'success', low: 'warning', out: 'neutral' }

export const AvailabilityBadge = ({ availability }: { availability: Availability }) => (
  <Badge tone={tone[availability]}>{AVAILABILITY_LABEL[availability]}</Badge>
)

export function ProductImage({ path, alt, className }: { path: string | null; alt: string; className?: string }) {
  if (!path) {
    return (
      <div className={`flex items-center justify-center bg-muted text-subtle ${className ?? ''}`} role="img" aria-label={`${alt} (sin fotografía)`}>
        <Smartphone className="size-10" aria-hidden />
      </div>
    )
  }
  return <img src={imageUrl(path)} alt={alt} loading="lazy" className={`object-cover ${className ?? ''}`} />
}

export function ProductCard({ product, categoryName }: { product: PublicProduct; categoryName?: string | undefined }) {
  const soldOut = product.available_count <= 0
  return (
    <Link
      to={`/producto/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-gray-200 bg-surface transition-shadow hover:shadow-md"
    >
      <ProductImage path={product.primary_image_path} alt={product.name} className="aspect-square w-full" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        {categoryName && <p className="text-xs uppercase text-subtle">{categoryName}</p>}
        <h3 className="font-medium leading-snug group-hover:text-brand">{product.name}</h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <PriceLabel from={product.price_from} to={product.price_to} />
          {soldOut ? <Badge>Agotado</Badge> : <Badge tone="success">Disponible</Badge>}
        </div>
      </div>
    </Link>
  )
}
