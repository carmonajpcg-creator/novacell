import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { useCustomers } from '@/features/customers/hooks'
import { useUnits } from '@/features/inventory/hooks'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatMXN } from '@/lib/format'
import { formatCents, isMoney, toCents } from '@/lib/money'
import * as api from './api'
import { saleKeys, useSellableVariants } from './hooks'
import { SALE_SOURCES } from './schemas'

interface Line {
  id: string
  kind: 'unit' | 'variant'
  refId: string
  label: string
  price: string
  quantity: string
  maxQuantity: number
}

const lineCents = (l: Line) => (isMoney(l.price) ? toCents(l.price) * Number(l.quantity || 0) : 0)

export function NewSalePage() {
  const navigate = useNavigate()
  const customers = useCustomers()
  const units = useUnits()
  const variants = useSellableVariants()

  const [customerId, setCustomerId] = useState('')
  const [source, setSource] = useState<string>('whatsapp')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showCustomer, setShowCustomer] = useState(false)
  // La clave de idempotencia solo cambia cuando cambia el contenido de la venta: un reintento idéntico la reutiliza.
  const submitted = useRef<{ payload: string; key: string } | null>(null)

  const create = useInvalidatingMutation(
    (vars: { payload: string; key: string }) =>
      api.createSale(
        client(),
        {
          customerId,
          source,
          notes: notes.trim() || null,
          items: lines.map((l) =>
            l.kind === 'unit'
              ? { unit_id: l.refId, unit_price: l.price }
              : { variant_id: l.refId, quantity: Number(l.quantity), unit_price: l.price },
          ),
        },
        vars.key,
      ),
    [saleKeys.all, ['units'], ['sellable-variants'], ['movements']],
  )

  if (customers.isPending || units.isPending || variants.isPending) return <LoadingState label="Cargando…" />
  if (customers.isError || units.isError || variants.isError)
    return <ErrorState message="No se pudieron cargar los datos para la venta." />

  const activeCustomers = (customers.data ?? []).filter((c) => c.is_active)
  const usedUnitIds = new Set(lines.filter((l) => l.kind === 'unit').map((l) => l.refId))
  const usedVariantIds = new Set(lines.filter((l) => l.kind === 'variant').map((l) => l.refId))
  const availableUnits = (units.data ?? []).filter((u) => u.status === 'available' && !usedUnitIds.has(u.id))
  const availableVariants = (variants.data ?? []).filter((v) => !usedVariantIds.has(v.id))

  const totalCents = lines.reduce((sum, l) => sum + lineCents(l), 0)
  const linesValid =
    lines.length > 0 &&
    lines.every(
      (l) =>
        isMoney(l.price) &&
        /^[1-9]\d*$/.test(l.quantity) &&
        Number(l.quantity) <= l.maxQuantity,
    )
  const canSubmit = customerId !== '' && linesValid && totalCents > 0 && !create.isPending

  function addUnit(id: string) {
    const u = availableUnits.find((x) => x.id === id)
    if (!u) return
    setLines((ls) => [
      ...ls,
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
    setLines((ls) => [
      ...ls,
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
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    const payload = JSON.stringify({
      customerId,
      source,
      notes: notes.trim(),
      lines: lines.map((l) => [l.kind, l.refId, l.price, l.quantity]),
    })
    if (submitted.current?.payload !== payload) submitted.current = { payload, key: crypto.randomUUID() }
    try {
      const saleId = await create.mutateAsync(submitted.current)
      navigate(`/admin/ventas/${saleId}`, { replace: true })
    } catch (err) {
      setError(describeDbError(err))
    }
  }

  return (
    <>
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="space-y-2">
        <Link to="/admin/ventas" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Ventas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva venta de contado</h1>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="sale-customer" label="Cliente">
            <div className="flex gap-2">
              <Select id="sale-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Selecciona…</option>
                {activeCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="secondary" onClick={() => setShowCustomer(true)}>
                Nuevo
              </Button>
            </div>
          </Field>
          <Field id="sale-source" label="Origen de la venta">
            <Select id="sale-source" value={source} onChange={(e) => setSource(e.target.value)}>
              {SALE_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="sale-notes" label="Notas" hint="Opcional">
          <Textarea id="sale-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Productos</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field id="add-unit" label="Agregar iPhone disponible">
            <Select
              id="add-unit"
              value=""
              disabled={availableUnits.length === 0}
              onChange={(e) => addUnit(e.target.value)}
            >
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
            <Plus className="size-4" aria-hidden /> Agrega al menos un producto a la venta.
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
                      onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <div>
            <p className="text-sm text-subtle">Total estimado</p>
            <p className="text-2xl font-semibold" data-testid="sale-total">
              {formatCents(totalCents)}
            </p>
            <p className="text-xs text-subtle">El servidor calcula y confirma el total definitivo.</p>
          </div>
          <Button type="submit" size="lg" disabled={!canSubmit}>
            {create.isPending ? 'Creando…' : 'Crear venta'}
          </Button>
        </div>
        <FormError message={error} />
      </Card>

    </form>
    {/* Fuera del <form>: los eventos de un portal burbujean por el árbol de React y enviarían la venta. */}
    <CustomerFormDialog open={showCustomer} onOpenChange={setShowCustomer} onSaved={(c) => setCustomerId(c.id)} />
    </>
  )
}
