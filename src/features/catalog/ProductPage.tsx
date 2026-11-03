import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, MessageCircle } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatMXN } from '@/lib/format'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { unitLine, variantLine } from './cart'
import { useCart } from './CartContext'
import { AvailabilityBadge, PriceLabel, ProductImage } from './components/ProductCard'
import { useBusinessInfo, useCatalog } from './hooks'
import { CONDITION_LABEL, MAX_QUANTITY, type PublicImage } from './types'

export function ProductPage() {
  const { slug = '' } = useParams()
  const catalog = useCatalog()
  const info = useBusinessInfo()
  const cart = useCart()
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [imageId, setImageId] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [added, setAdded] = useState<string | null>(null)

  const product = catalog.data?.products.find((p) => p.slug === slug)
  const units = useMemo(
    () => (catalog.data?.units ?? []).filter((u) => u.product_id === product?.id).sort((a, b) => a.price - b.price),
    [catalog.data, product?.id],
  )
  const variants = useMemo(
    () => (catalog.data?.variants ?? []).filter((v) => v.product_id === product?.id).sort((a, b) => a.price - b.price),
    [catalog.data, product?.id],
  )
  const images: PublicImage[] = useMemo(() => {
    const all = (catalog.data?.images ?? []).filter((i) => i.product_id === product?.id)
    const general = all.filter((i) => i.unit_code === null).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    const ofUnit = selectedCode ? all.filter((i) => i.unit_code === selectedCode) : []
    return [...ofUnit, ...general]
  }, [catalog.data, product?.id, selectedCode])

  if (catalog.isPending) return <LoadingState label="Cargando producto…" />
  if (catalog.isError) return <ErrorState message="No pudimos cargar el producto." onRetry={() => void catalog.refetch()} />
  if (!product) {
    return (
      <EmptyState
        title="Este producto ya no está disponible"
        description="Puede que se haya vendido o retirado del catálogo."
        action={
          <Button asChild>
            <Link to="/">Volver a la tienda</Link>
          </Button>
        }
      />
    )
  }

  const category = catalog.data?.categories.find((c) => c.id === product.category_id)
  const mainImage = images.find((i) => i.id === imageId) ?? images[0]
  const waUrl = buildWhatsAppUrl(info.data?.whatsapp_number, `Hola, me interesa ${product.name}. ¿Me pueden dar más información?`)
  const backTo = product.kind === 'iphone' ? '/iphone' : '/accesorios'

  function notify(key: string) {
    setAdded(key)
  }

  return (
    <div className="space-y-8">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
        <ArrowLeft className="size-4" aria-hidden /> {product.kind === 'iphone' ? 'iPhone' : 'Accesorios'}
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <ProductImage path={mainImage?.storage_path ?? null} alt={mainImage?.alt_text ?? product.name} className="aspect-square w-full rounded-card" />
          {images.length > 1 && (
            <ul className="flex gap-2 overflow-x-auto" aria-label="Fotografías">
              {images.map((img, i) => (
                <li key={img.id}>
                  <button
                    type="button"
                    aria-label={`Ver fotografía ${i + 1}`}
                    aria-pressed={mainImage?.id === img.id}
                    onClick={() => setImageId(img.id)}
                    className={`block overflow-hidden rounded-xl border-2 ${mainImage?.id === img.id ? 'border-brand' : 'border-transparent'}`}
                  >
                    <ProductImage path={img.storage_path} alt="" className="size-16" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            {category && <p className="text-sm uppercase text-subtle">{category.name}</p>}
            <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
            <PriceLabel from={product.price_from} to={product.price_to} />
          </div>
          {product.description && <p className="whitespace-pre-line text-subtle">{product.description}</p>}

          {added && (
            <p role="status" className="flex items-center justify-between gap-3 rounded-xl bg-green-50 p-3 text-sm text-success">
              <span className="flex items-center gap-2">
                <Check className="size-4" aria-hidden /> Agregado al carrito
              </span>
              <Link to="/carrito" className="font-medium underline">
                Ver carrito
              </Link>
            </p>
          )}

          {product.kind === 'iphone' ? (
            <section aria-label="Equipos disponibles" className="space-y-3">
              <h2 className="text-lg font-semibold">Equipos disponibles</h2>
              {units.length === 0 ? (
                <p className="rounded-xl bg-muted p-4 text-sm text-subtle">Por ahora no hay equipos disponibles de este modelo.</p>
              ) : (
                <ul className="space-y-3">
                  {units.map((u) => {
                    const inCart = cart.lines.some((l) => l.key === `unit:${u.public_code}`)
                    return (
                      <li
                        key={u.public_code}
                        className={`rounded-card border p-4 ${selectedCode === u.public_code ? 'border-brand' : 'border-gray-200'}`}
                      >
                        <button type="button" className="w-full text-left" onClick={() => setSelectedCode(u.public_code)} aria-label={`Ver fotos de ${u.storage_gb} GB ${u.color}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">
                              {u.storage_gb} GB · {u.color}
                            </p>
                            <Badge tone={u.condition === 'new' ? 'brand' : 'neutral'}>{CONDITION_LABEL[u.condition]}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-subtle">
                            {u.condition === 'used' && u.battery_health !== null ? `Batería ${u.battery_health}%` : ''}
                            {u.condition === 'used' && u.battery_health !== null && u.physical_grade ? ' · ' : ''}
                            {u.physical_grade ?? ''}
                          </p>
                          <p className="text-xs text-subtle">Ref. {u.public_code}</p>
                        </button>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-lg font-semibold">{formatMXN(u.price)}</span>
                          <Button
                            disabled={inCart}
                            onClick={() => {
                              cart.add(unitLine(product.name, product.slug, u))
                              notify(`unit:${u.public_code}`)
                            }}
                          >
                            {inCart ? 'En el carrito' : 'Agregar al carrito'}
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ) : (
            <section aria-label="Variantes" className="space-y-3">
              <h2 className="text-lg font-semibold">Opciones</h2>
              {variants.length === 0 ? (
                <p className="rounded-xl bg-muted p-4 text-sm text-subtle">Por ahora no hay opciones disponibles.</p>
              ) : (
                <ul className="space-y-3">
                  {variants.map((v) => {
                    const max = MAX_QUANTITY[v.availability]
                    const qty = quantities[v.id] ?? 1
                    const label = [v.color, v.compatible_model ? `para ${v.compatible_model}` : null].filter(Boolean).join(' · ')
                    return (
                      <li key={v.id} className="rounded-card border border-gray-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{label || 'Estándar'}</p>
                          <AvailabilityBadge availability={v.availability} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <span className="text-lg font-semibold">{formatMXN(v.price)}</span>
                          <div className="flex items-center gap-2">
                            {max > 0 && (
                              <Select
                                className="h-11 w-20"
                                aria-label={`Cantidad de ${label || 'esta opción'}`}
                                value={qty}
                                onChange={(e) => setQuantities((q) => ({ ...q, [v.id]: Number(e.target.value) }))}
                              >
                                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </Select>
                            )}
                            <Button
                              disabled={max === 0}
                              onClick={() => {
                                cart.add(variantLine(product.name, product.slug, v, qty))
                                notify(`variant:${v.id}`)
                              }}
                            >
                              {max === 0 ? 'Agotado' : 'Agregar al carrito'}
                            </Button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          <p className="text-xs text-subtle">
            El precio y la disponibilidad se confirman por WhatsApp. Agregar al carrito no reserva el producto.
          </p>
          {waUrl && (
            <Button asChild variant="secondary">
              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" aria-hidden /> Preguntar por WhatsApp
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
