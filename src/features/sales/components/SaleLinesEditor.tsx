import { Plus, Trash2 } from 'lucide-react'
import { Field } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import type { ProductUnit } from '@/features/inventory/types'
import { formatMXN } from '@/lib/format'
import { formatCents, isMoney, toCents } from '@/lib/money'
import type { SaleLineInput, SellableVariant } from '../api'

export interface Line {
  id: string
  kind: 'unit' | 'variant'
  refId: string
  label: string
  price: string
  quantity: string
  maxQuantity: number
}

export const lineCents = (l: Line) => (isMoney(l.price) ? toCents(l.price) * Number(l.quantity || 0) : 0)

export const linesTotalCents = (lines: Line[]) => lines.reduce((sum, l) => sum + lineCents(l), 0)

export const linesAreValid = (lines: Line[]) =>
  lines.length > 0 &&
  lines.every((l) => isMoney(l.price) && /^[1-9]\d*$/.test(l.quantity) && Number(l.quantity) <= l.maxQuantity)

/** Convierte las líneas del formulario al formato que esperan las RPC de venta. */
export const linesToItems = (lines: Line[]): SaleLineInput[] =>
  lines.map((l) =>
    l.kind === 'unit'
      ? { unit_id: l.refId, unit_price: l.price }
      : { variant_id: l.refId, quantity: Number(l.quantity), unit_price: l.price },
  )

export const linesSignature = (lines: Line[]) => lines.map((l) => [l.kind, l.refId, l.price, l.quantity])

/** Selector de iPhone disponibles y accesorios con existencias, más la tabla de líneas editables. */
export function SaleLinesEditor({
  lines,
  onChange,
  units,
  variants,
}: {
  lines: Line[]
  onChange: (lines: Line[]) => void
  units: ProductUnit[]
  variants: SellableVariant[]
}) {
  const usedUnitIds = new Set(lines.filter((l) => l.kind === 'unit').map((l) => l.refId))
  const usedVariantIds = new Set(lines.filter((l) => l.kind === 'variant').map((l) => l.refId))
  const availableUnits = units.filter((u) => u.status === 'available' && !usedUnitIds.has(u.id))
  const availableVariants = variants.filter((v) => !usedVariantIds.has(v.id))

  function addUnit(id: string) {
    const u = availableUnits.find((x) => x.id === id)
    if (!u) return
    onChange([
      ...lines,
      {
        id: crypto.randomUUID(),
        kind: 'unit',
        refId: u.id,
        label: `${u.product?.name ?? 'iPhone'} ${u.storage_gb} GB ${u.color} · ${u.internal_code}`,
        price: String(u.sale_price),
        quantity: '1',
        maxQuantity: 1,
      },
    ])
  }

  function addVariant(id: string) {
    const v = availableVariants.find((x) => x.id === id)
    if (!v) return
    onChange([
      ...lines,
      {
        id: crypto.randomUUID(),
        kind: 'variant',
        refId: v.id,
        label: `${v.product?.name ?? 'Accesorio'}${v.color ? ` — ${v.color}` : ''} [${v.sku}]`,
        price: String(v.price),
        quantity: '1',
        maxQuantity: v.stock_quantity,
      },
    ])
  }

  const patchLine = (id: string, patch: Partial<Line>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="add-unit" label="Agregar iPhone disponible">
          <Select id="add-unit" value="" disabled={availableUnits.length === 0} onChange={(e) => addUnit(e.target.value)}>
            <option value="">{availableUnits.length === 0 ? 'Sin iPhone disponibles' : 'Selecciona…'}</option>
            {availableUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.internal_code} · {u.product?.name} {u.storage_gb} GB {u.color} · {formatMXN(u.sale_price)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="add-variant" label="Agregar accesorio con existencias">
          <Select
            id="add-variant"
            value=""
            disabled={availableVariants.length === 0}
            onChange={(e) => addVariant(e.target.value)}
          >
            <option value="">{availableVariants.length === 0 ? 'Sin accesorios con stock' : 'Selecciona…'}</option>
            {availableVariants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.sku} · {v.product?.name}
                {v.color ? ` — ${v.color}` : ''} · {formatMXN(v.price)} ({v.stock_quantity} en stock)
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {lines.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-subtle">
          <Plus className="size-4" aria-hidden /> Agrega al menos un producto.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th className="w-28">Cantidad</Th>
              <Th className="w-36">Precio unitario</Th>
              <Th className="text-right">Importe</Th>
              <Th className="w-12">
                <span className="sr-only">Quitar</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.label}</Td>
                <Td>
                  {l.kind === 'unit' ? (
                    <span>1</span>
                  ) : (
                    <Input
                      inputMode="numeric"
                      aria-label={`Cantidad de ${l.label}`}
                      aria-invalid={!/^[1-9]\d*$/.test(l.quantity) || Number(l.quantity) > l.maxQuantity}
                      value={l.quantity}
                      onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                    />
                  )}
                </Td>
                <Td>
                  <Input
                    inputMode="decimal"
                    aria-label={`Precio de ${l.label}`}
                    aria-invalid={!isMoney(l.price)}
                    value={l.price}
                    onChange={(e) => patchLine(l.id, { price: e.target.value })}
                  />
                </Td>
                <Td className="text-right">{formatCents(lineCents(l))}</Td>
                <Td>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Quitar ${l.label}`}
                    onClick={() => onChange(lines.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
