import { z } from 'zod'
import { formatCents } from '@/lib/money'
import { MAX_QUANTITY, CONDITION_LABEL, type Catalog, type PublicUnit, type PublicVariant } from './types'

/**
 * Carrito del visitante. Vive solo en su navegador (localStorage): no se envía al servidor ni reserva inventario.
 * Los importes se guardan en centavos enteros (nunca floats).
 */
export interface CartLine {
  key: string
  kind: 'unit' | 'variant'
  refId: string
  productSlug: string
  label: string
  unitPriceCents: number
  quantity: number
  maxQuantity: number
}

const lineSchema = z.object({
  key: z.string(),
  kind: z.enum(['unit', 'variant']),
  refId: z.string(),
  productSlug: z.string(),
  label: z.string().max(300),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().min(1).max(99),
  maxQuantity: z.number().int().min(1).max(99),
})

/** Lee un carrito guardado ignorando cualquier dato que no tenga la forma esperada. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const r = lineSchema.safeParse(item)
      return r.success ? [r.data] : []
    })
  } catch {
    return []
  }
}

export const toCartCents = (price: number) => Math.round(price * 100)

export function unitLine(productName: string, productSlug: string, u: PublicUnit): CartLine {
  const detail = [
    CONDITION_LABEL[u.condition],
    u.condition === 'used' && u.battery_health !== null ? `batería ${u.battery_health}%` : null,
  ].filter(Boolean)
  return {
    key: `unit:${u.public_code}`,
    kind: 'unit',
    refId: u.public_code,
    productSlug,
    label: `${productName} ${u.storage_gb} GB ${u.color} (${detail.join(', ')}) · Ref. ${u.public_code}`,
    unitPriceCents: toCartCents(u.price),
    quantity: 1,
    maxQuantity: 1,
  }
}

export function variantLine(productName: string, productSlug: string, v: PublicVariant, quantity: number): CartLine {
  const parts = [v.color, v.compatible_model ? `para ${v.compatible_model}` : null].filter(Boolean)
  const max = Math.max(MAX_QUANTITY[v.availability], 1)
  return {
    key: `variant:${v.id}`,
    kind: 'variant',
    refId: v.id,
    productSlug,
    label: `${productName}${parts.length ? ` — ${parts.join(' ')}` : ''}`,
    unitPriceCents: toCartCents(v.price),
    quantity: Math.min(Math.max(quantity, 1), max),
    maxQuantity: max,
  }
}

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const existing = lines.find((l) => l.key === line.key)
  if (!existing) return [...lines, line]
  if (line.kind === 'unit') return lines // un iPhone es una unidad física: no se duplica
  return lines.map((l) =>
    l.key === line.key ? { ...l, quantity: Math.min(l.quantity + line.quantity, l.maxQuantity) } : l,
  )
}

export function setQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(Math.max(Math.trunc(quantity), 1), l.maxQuantity) } : l))
}

export const removeLine = (lines: CartLine[], key: string) => lines.filter((l) => l.key !== key)

export const lineCents = (l: CartLine) => l.unitPriceCents * l.quantity
export const cartTotalCents = (lines: CartLine[]) => lines.reduce((sum, l) => sum + lineCents(l), 0)
export const cartCount = (lines: CartLine[]) => lines.reduce((sum, l) => sum + l.quantity, 0)

export interface Reconciliation {
  lines: CartLine[]
  removed: string[]
  changed: string[]
}

/** Contrasta el carrito guardado con el catálogo actual: quita lo que ya no está disponible y actualiza precios. */
export function reconcileCart(lines: CartLine[], catalog: Catalog): Reconciliation {
  const unitsByCode = new Map(catalog.units.map((u) => [u.public_code, u]))
  const variantsById = new Map(catalog.variants.map((v) => [v.id, v]))
  const productsById = new Map(catalog.products.map((p) => [p.id, p]))
  const kept: CartLine[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const l of lines) {
    if (l.kind === 'unit') {
      const u = unitsByCode.get(l.refId)
      const p = u ? productsById.get(u.product_id) : undefined
      if (!u || !p) {
        removed.push(l.label)
        continue
      }
      const fresh = unitLine(p.name, p.slug, u)
      if (fresh.unitPriceCents !== l.unitPriceCents) changed.push(fresh.label)
      kept.push(fresh)
    } else {
      const v = variantsById.get(l.refId)
      const p = v ? productsById.get(v.product_id) : undefined
      if (!v || !p || v.availability === 'out') {
        removed.push(l.label)
        continue
      }
      const fresh = variantLine(p.name, p.slug, v, l.quantity)
      if (fresh.unitPriceCents !== l.unitPriceCents || fresh.quantity !== l.quantity) changed.push(fresh.label)
      kept.push(fresh)
    }
  }
  return { lines: kept, removed, changed }
}

/**
 * Mensaje del pedido para WhatsApp. Es una CONSULTA: no confirma ninguna venta ni reserva nada, y el texto lo dice.
 */
export function buildOrderMessage(lines: CartLine[], businessName?: string): string {
  const intro = `Hola${businessName ? ` ${businessName}` : ''}, quisiera hacer este pedido:`
  const items = lines.map((l, i) =>
    l.quantity > 1
      ? `${i + 1}. ${l.label} × ${l.quantity} — ${formatCents(lineCents(l))}`
      : `${i + 1}. ${l.label} — ${formatCents(lineCents(l))}`,
  )
  return [
    intro,
    '',
    ...items,
    '',
    `Total estimado: ${formatCents(cartTotalCents(lines))}`,
    '',
    'Por favor confírmenme disponibilidad, precio final y forma de entrega. ¡Gracias!',
  ].join('\n')
}
