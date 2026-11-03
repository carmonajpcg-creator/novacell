import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, MessageCircle, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { formatCents } from '@/lib/money'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { buildOrderMessage, lineCents, reconcileCart } from './cart'
import { useCart } from './CartContext'
import { useBusinessInfo, useCatalog } from './hooks'

export function CartPage() {
  const cart = useCart()
  const catalog = useCatalog()
  const info = useBusinessInfo()
  const [copied, setCopied] = useState(false)
  const [opened, setOpened] = useState(false)

  const { lines, replace } = cart
  // El aviso se deriva del carrito con el que se entró a la página (instantánea inicial), no de un estado en un efecto.
  const [initialLines] = useState(lines)
  const notice = useMemo(() => (catalog.data ? reconcileCart(initialLines, catalog.data) : null), [catalog.data, initialLines])

  // Contrasta el carrito guardado con el catálogo actual: precios y disponibilidad pudieron cambiar.
  useEffect(() => {
    if (!catalog.data) return
    const r = reconcileCart(lines, catalog.data)
    if (r.removed.length > 0 || r.changed.length > 0) replace(r.lines)
  }, [catalog.data, lines, replace])
  const message = buildOrderMessage(lines, info.data?.business_name)
  const url = buildWhatsAppUrl(info.data?.whatsapp_number, message)

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">Tu carrito</h1>

      {notice && (notice.removed.length > 0 || notice.changed.length > 0) && (
        <div role="alert" className="space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {notice.removed.length > 0 && <p>Quitamos de tu carrito lo que ya no está disponible: {notice.removed.join('; ')}.</p>}
          {notice.changed.length > 0 && <p>Actualizamos el precio o la cantidad de: {notice.changed.join('; ')}.</p>}
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState
          title="Tu carrito está vacío"
          description="Explora el catálogo y agrega lo que te interese."
          action={
            <Button asChild>
              <Link to="/iphone">Ver iPhone</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-3">
          <ul className="space-y-3 lg:col-span-2" aria-label="Artículos del carrito">
            {lines.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-gray-200 bg-surface p-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/producto/${l.productSlug}`} className="font-medium hover:text-brand">
                    {l.label}
                  </Link>
                  <p className="text-sm text-subtle">{formatCents(l.unitPriceCents)} c/u</p>
                </div>
                <div className="flex items-center gap-3">
                  {l.kind === 'variant' ? (
                    <Select
                      className="h-10 w-20"
                      aria-label={`Cantidad de ${l.label}`}
                      value={l.quantity}
                      onChange={(e) => cart.setQty(l.key, Number(e.target.value))}
                    >
                      {Array.from({ length: l.maxQuantity }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-subtle">1 equipo</span>
                  )}
                  <span className="w-28 text-right font-semibold">{formatCents(lineCents(l))}</span>
                  <Button variant="ghost" size="sm" aria-label={`Quitar ${l.label}`} onClick={() => cart.remove(l.key)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <aside className="space-y-4" aria-label="Resumen del pedido">
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-subtle">Total estimado</span>
                <span className="text-2xl font-semibold" data-testid="cart-total">
                  {formatCents(cart.totalCents)}
                </span>
              </div>
              <p className="text-xs text-subtle">
                Es una estimación. El precio final y la disponibilidad se confirman por WhatsApp. Tu carrito no reserva los productos y no se
                registra ninguna compra hasta que lo confirmemos contigo. Por ahora no cobramos en línea.
              </p>
              {url ? (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    window.open(url, '_blank', 'noopener,noreferrer')
                    setOpened(true)
                  }}
                >
                  <MessageCircle className="size-5" aria-hidden /> Enviar pedido por WhatsApp
                </Button>
              ) : info.isPending ? null : (
                <p role="status" className="rounded-xl bg-muted p-3 text-sm text-subtle">
                  El contacto por WhatsApp aún no está disponible. Copia tu pedido y envíalo por el medio que prefieras.
                </p>
              )}
              <Button variant="secondary" className="w-full" onClick={() => void copy()}>
                <Copy className="size-4" aria-hidden /> {copied ? 'Pedido copiado' : 'Copiar pedido'}
              </Button>
              {opened && (
                <p role="status" className="text-xs text-subtle">
                  Se abrió WhatsApp con tu pedido. Aún no es una compra: envía el mensaje y te confirmaremos precio y disponibilidad.
                </p>
              )}
              <Button variant="ghost" className="w-full" onClick={() => cart.clear()}>
                Vaciar carrito
              </Button>
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}
