import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { useCustomers } from '@/features/customers/hooks'
import { useUnits } from '@/features/inventory/hooks'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatCents } from '@/lib/money'
import * as api from './api'
import {
  linesAreValid,
  linesSignature,
  linesToItems,
  linesTotalCents,
  SaleLinesEditor,
  type Line,
} from './components/SaleLinesEditor'
import { saleKeys, useSellableVariants } from './hooks'
import { SALE_SOURCES } from './schemas'

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
        { customerId, source, notes: notes.trim() || null, items: linesToItems(lines) },
        vars.key,
      ),
    [saleKeys.all, ['units'], ['sellable-variants'], ['movements']],
  )

  if (customers.isPending || units.isPending || variants.isPending) return <LoadingState label="Cargando…" />
  if (customers.isError || units.isError || variants.isError)
    return <ErrorState message="No se pudieron cargar los datos para la venta." />

  const activeCustomers = (customers.data ?? []).filter((c) => c.is_active)
  const totalCents = linesTotalCents(lines)
  const canSubmit = customerId !== '' && linesAreValid(lines) && totalCents > 0 && !create.isPending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    const payload = JSON.stringify({ customerId, source, notes: notes.trim(), lines: linesSignature(lines) })
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
          <SaleLinesEditor lines={lines} onChange={setLines} units={units.data ?? []} variants={variants.data ?? []} />

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
