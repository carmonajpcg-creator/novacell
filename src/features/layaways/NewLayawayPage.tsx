import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { useCustomers } from '@/features/customers/hooks'
import { useUnits } from '@/features/inventory/hooks'
import {
  linesAreValid,
  linesSignature,
  linesToItems,
  linesTotalCents,
  SaleLinesEditor,
  type Line,
} from '@/features/sales/components/SaleLinesEditor'
import { saleKeys, useSellableVariants } from '@/features/sales/hooks'
import { SALE_SOURCES } from '@/features/sales/schemas'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { todayIso } from '@/lib/format'
import { formatCents, isMoney, toCents } from '@/lib/money'
import * as api from './api'
import { layawayKeys } from './hooks'

const addDaysIso = (iso: string, days: number) => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function NewLayawayPage() {
  const navigate = useNavigate()
  const customers = useCustomers()
  const units = useUnits()
  const variants = useSellableVariants()

  const today = todayIso()
  const [customerId, setCustomerId] = useState('')
  const [source, setSource] = useState<string>('whatsapp')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [down, setDown] = useState('')
  const [dueDate, setDueDate] = useState(addDaysIso(today, 30))
  const [error, setError] = useState<string | null>(null)
  const [showCustomer, setShowCustomer] = useState(false)
  const submitted = useRef<{ payload: string; key: string } | null>(null)

  const totalCents = linesTotalCents(lines)
  const downCents = isMoney(down) ? toCents(down) : 0

  const create = useInvalidatingMutation(
    (vars: { payload: string; key: string }) =>
      api.createLayaway(
        client(),
        { customerId, source, notes: notes.trim() || null, items: linesToItems(lines), downPayment: down, dueDate },
        vars.key,
      ),
    [layawayKeys.all, saleKeys.all, ['units'], ['sellable-variants'], ['movements']],
  )

  if (customers.isPending || units.isPending || variants.isPending) return <LoadingState label="Cargando…" />
  if (customers.isError || units.isError || variants.isError)
    return <ErrorState message="No se pudieron cargar los datos para el apartado." />

  const activeCustomers = (customers.data ?? []).filter((c) => c.is_active)
  const termsError =
    totalCents <= 0 ? null
      : downCents <= 0 ? 'Indica el anticipo (mayor a cero)'
        : downCents > totalCents ? 'El anticipo no puede exceder el total'
          : dueDate < today ? 'La fecha límite no puede ser anterior a hoy'
            : null
  const canSubmit =
    customerId !== '' && linesAreValid(lines) && totalCents > 0 && downCents > 0 && termsError === null && dueDate !== '' && !create.isPending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    const payload = JSON.stringify({ customerId, source, notes: notes.trim(), down, dueDate, lines: linesSignature(lines) })
    if (submitted.current?.payload !== payload) submitted.current = { payload, key: crypto.randomUUID() }
    try {
      const id = await create.mutateAsync(submitted.current)
      navigate(`/admin/apartados/${id}`, { replace: true })
    } catch (err) {
      setError(describeDbError(err))
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="space-y-2">
          <Link to="/admin/apartados" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
            <ArrowLeft className="size-4" aria-hidden /> Apartados
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo apartado</h1>
          <p className="text-sm text-subtle">
            El equipo queda reservado desde que se crea. Una reserva vencida se marca, pero no se libera sola
            (reglas pendientes de aprobación: docs/PENDING_RULES.md).
          </p>
        </div>

        <Card className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="ly-customer" label="Cliente">
              <div className="flex gap-2">
                <Select id="ly-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
            <Field id="ly-source" label="Origen">
              <Select id="ly-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {SALE_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="ly-notes" label="Notas" hint="Opcional">
            <Textarea id="ly-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Productos a apartar</h2>
          <SaleLinesEditor lines={lines} onChange={setLines} units={units.data ?? []} variants={variants.data ?? []} />
          <p className="text-sm text-subtle">
            Total del apartado: <strong className="text-graphite" data-testid="layaway-total">{formatCents(totalCents)}</strong>{' '}
            (el servidor calcula y confirma el total definitivo).
          </p>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Anticipo y fecha límite</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="ly-down" label="Anticipo pactado (MXN)" hint="Mayor a cero. Puede haber un mínimo configurado por el negocio.">
              <Input id="ly-down" inputMode="decimal" aria-invalid={down !== '' && !isMoney(down)} value={down} onChange={(e) => setDown(e.target.value)} />
            </Field>
            <Field id="ly-due" label="Fecha límite">
              <Input id="ly-due" type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          {termsError && <p className="text-sm text-danger">{termsError}</p>}
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {create.isPending ? 'Creando…' : 'Crear apartado'}
            </Button>
          </div>
        </Card>
      </form>
      <CustomerFormDialog open={showCustomer} onOpenChange={setShowCustomer} onSaved={(c) => setCustomerId(c.id)} />
    </>
  )
}
