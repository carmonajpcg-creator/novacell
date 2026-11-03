import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
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
import { formatDate, todayIso } from '@/lib/format'
import { formatCents, isMoney, toCents } from '@/lib/money'
import * as api from './api'
import { creditKeys } from './hooks'
import { buildSchedule, FREQUENCY_LABEL, type Frequency } from './schedule'

const addDaysIso = (iso: string, days: number) => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function NewCreditPage() {
  const navigate = useNavigate()
  const customers = useCustomers()
  const units = useUnits()
  const variants = useSellableVariants()

  const today = todayIso()
  const [customerId, setCustomerId] = useState('')
  const [source, setSource] = useState<string>('whatsapp')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [financedInput, setFinancedInput] = useState<string | null>(null) // null = sugerir la suma de productos
  const [down, setDown] = useState('0')
  const [frequency, setFrequency] = useState<Frequency>('weekly')
  const [count, setCount] = useState('4')
  const [firstDue, setFirstDue] = useState(addDaysIso(today, 7))
  const [error, setError] = useState<string | null>(null)
  const [showCustomer, setShowCustomer] = useState(false)
  const submitted = useRef<{ payload: string; key: string } | null>(null)

  const itemsCents = linesTotalCents(lines)
  const financed = financedInput ?? (itemsCents > 0 ? (itemsCents / 100).toFixed(2) : '')
  const financedCents = isMoney(financed) ? toCents(financed) : 0
  const downCents = isMoney(down) ? toCents(down) : -1
  const principalCents = financedCents - Math.max(downCents, 0)
  const n = /^[1-9]\d{0,2}$/.test(count) ? Number(count) : 0

  const schedule = useMemo(
    () => (n >= 1 && n <= 260 && principalCents >= n ? buildSchedule(principalCents, n, frequency, firstDue) : []),
    [n, principalCents, frequency, firstDue],
  )

  const create = useInvalidatingMutation(
    (vars: { payload: string; key: string }) =>
      api.createCreditSale(
        client(),
        {
          customerId, source, notes: notes.trim() || null, items: linesToItems(lines),
          financedTotal: financed, downPayment: down, frequency, installments: n, firstDueDate: firstDue,
        },
        vars.key,
      ),
    [creditKeys.all, saleKeys.all, ['units'], ['sellable-variants'], ['movements']],
  )

  if (customers.isPending || units.isPending || variants.isPending) return <LoadingState label="Cargando…" />
  if (customers.isError || units.isError || variants.isError)
    return <ErrorState message="No se pudieron cargar los datos para el crédito." />

  const activeCustomers = (customers.data ?? []).filter((c) => c.is_active)
  const termsError =
    financedCents <= 0 ? 'Indica el precio financiado'
      : downCents < 0 ? 'El enganche no es válido'
        : downCents >= financedCents ? 'El enganche debe ser menor al precio financiado'
          : n < 1 || n > 260 ? 'Indica de 1 a 260 cuotas'
            : principalCents < n ? 'El saldo es demasiado pequeño para ese número de cuotas'
              : firstDue < today ? 'La primera fecha no puede ser anterior a hoy'
                : null
  const canSubmit = customerId !== '' && linesAreValid(lines) && termsError === null && !create.isPending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    const payload = JSON.stringify({ customerId, source, notes: notes.trim(), financed, down, frequency, n, firstDue, lines: linesSignature(lines) })
    if (submitted.current?.payload !== payload) submitted.current = { payload, key: crypto.randomUUID() }
    try {
      const creditId = await create.mutateAsync(submitted.current)
      navigate(`/admin/creditos/${creditId}`, { replace: true })
    } catch (err) {
      setError(describeDbError(err))
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="space-y-2">
          <Link to="/admin/creditos" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
            <ArrowLeft className="size-4" aria-hidden /> Créditos
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo crédito</h1>
          <p className="text-sm text-subtle">
            Las condiciones son propuestas pendientes de aprobación (docs/PENDING_RULES.md): sin intereses ni recargos automáticos.
          </p>
        </div>

        <Card className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="cr-customer" label="Cliente">
              <div className="flex gap-2">
                <Select id="cr-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
            <Field id="cr-source" label="Origen">
              <Select id="cr-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {SALE_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="cr-notes" label="Notas" hint="Opcional">
            <Textarea id="cr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Productos</h2>
          <SaleLinesEditor lines={lines} onChange={setLines} units={units.data ?? []} variants={variants.data ?? []} />
          <p className="text-sm text-subtle">Suma de productos (referencia): {formatCents(itemsCents)}</p>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Condiciones del crédito</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="cr-financed" label="Precio final financiado (MXN)" hint="Lo fija el negocio; puede diferir de la suma de productos.">
              <Input id="cr-financed" inputMode="decimal" aria-invalid={financed !== '' && !isMoney(financed)} value={financed} onChange={(e) => setFinancedInput(e.target.value)} />
            </Field>
            <Field id="cr-down" label="Enganche (MXN)" hint="0 si no hay enganche">
              <Input id="cr-down" inputMode="decimal" aria-invalid={downCents < 0} value={down} onChange={(e) => setDown(e.target.value)} />
            </Field>
            <Field id="cr-frequency" label="Frecuencia de pago">
              <Select id="cr-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cr-count" label="Número de cuotas">
              <Input id="cr-count" inputMode="numeric" aria-invalid={n === 0} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field id="cr-first" label="Fecha del primer pago">
              <Input id="cr-first" type="date" min={today} value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
            </Field>
          </div>

          {schedule.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-subtle">
                A financiar tras el enganche: <strong className="text-graphite">{formatCents(principalCents)}</strong>. Vista previa del calendario
                (el servidor genera el definitivo; el residuo de centavos va a la última cuota):
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Cuota</Th>
                    <Th>Fecha</Th>
                    <Th className="text-right">Importe</Th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.slice(0, 12).map((s) => (
                    <tr key={s.number}>
                      <Td>{s.number}</Td>
                      <Td>{formatDate(s.due)}</Td>
                      <Td className="text-right">{formatCents(s.cents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {schedule.length > 12 && <p className="text-xs text-subtle">… y {schedule.length - 12} cuotas más.</p>}
            </div>
          )}

          {termsError && financedCents > 0 && <p className="text-sm text-danger">{termsError}</p>}
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {create.isPending ? 'Creando…' : 'Crear crédito'}
            </Button>
          </div>
        </Card>
      </form>
      <CustomerFormDialog open={showCustomer} onOpenChange={setShowCustomer} onSaved={(c) => setCustomerId(c.id)} />
    </>
  )
}
