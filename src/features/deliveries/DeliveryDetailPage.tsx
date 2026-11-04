import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ReasonDialog } from '@/features/sales/components/ReasonDialog'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN, todayIso } from '@/lib/format'
import * as api from './api'
import { DeliveryStatusBadge } from './components/DeliveryStatusBadge'
import { deliveryKeys, useDelivery } from './hooks'
import { deliveryEditSchema, type DeliveryEditValues } from './schemas'
import { isTerminal, NEXT_STATUS, type DeliverySummary } from './types'

export function DeliveryDetailPage() {
  const { id = '' } = useParams()
  const delivery = useDelivery(id)
  if (delivery.isPending) return <LoadingState label="Cargando entrega…" />
  if (delivery.isError) return <ErrorState title="Entrega no encontrada" onRetry={() => void delivery.refetch()} />
  return <DeliveryView key={delivery.data.id + delivery.data.status} d={delivery.data} />
}

function DeliveryView({ d }: { d: DeliverySummary }) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terminal = isTerminal(d.status)
  const next = NEXT_STATUS[d.status]

  const invalidate = [deliveryKeys.all, deliveryKeys.one(d.id), deliveryKeys.bySale(d.sale_id), ['dashboard']]
  const advance = useInvalidatingMutation((to: Parameters<typeof api.setDeliveryStatus>[2]) => api.setDeliveryStatus(client(), d.id, to, null), invalidate)
  const cancel = useInvalidatingMutation((reason: string) => api.setDeliveryStatus(client(), d.id, 'cancelled', reason), invalidate)

  async function onAdvance() {
    if (!next) return
    if (next.to === 'delivered' && !window.confirm('¿Confirmas que el equipo ya fue entregado al cliente? Este estado es final.')) return
    setError(null)
    try {
      await advance.mutateAsync(next.to)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/admin/entregas" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Entregas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{d.delivery_number}</h1>
            <DeliveryStatusBadge status={d.status} />
          </div>
          {!terminal && (
            <div className="flex flex-wrap gap-2">
              {next && <Button onClick={() => void onAdvance()}>{next.label}</Button>}
              <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                Cancelar entrega
              </Button>
            </div>
          )}
        </div>
        <p className="text-sm text-subtle">
          <Link className="text-brand hover:underline" to={`/admin/clientes/${d.customer_id}`}>
            {d.customer_name}
          </Link>
          {d.customer_phone ? ` · ${d.customer_phone}` : ''} · venta{' '}
          <Link className="text-brand hover:underline" to={`/admin/ventas/${d.sale_id}`}>
            {d.sale_number}
          </Link>{' '}
          ({formatMXN(d.sale_total)})
        </p>
      </div>

      <FormError message={error} />

      {d.status === 'delivered' && d.delivered_at && (
        <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-success">
          Entregada el {formatDate(d.delivered_at)}.
        </p>
      )}
      {d.status === 'cancelled' && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Entrega cancelada{d.cancelled_at ? ` el ${formatDate(d.cancelled_at)}` : ''}: {d.cancel_reason}. Puedes programar otra desde la venta.
        </p>
      )}

      {terminal ? (
        <Card className="space-y-3 text-sm">
          <Info label="Dirección" value={d.address} />
          {d.reference_notes && <Info label="Referencias" value={d.reference_notes} />}
          <Info label="Fecha programada" value={d.scheduled_date ? formatDate(d.scheduled_date) : '—'} />
          <Info label="Costo de entrega" value={formatMXN(d.delivery_cost)} />
          {d.notes && <Info label="Observaciones" value={d.notes} />}
          <p className="text-xs text-subtle">Una entrega entregada o cancelada es historial: sus datos ya no se editan.</p>
        </Card>
      ) : (
        <EditForm d={d} invalidate={invalidate} />
      )}

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar entrega"
        description="El motivo queda registrado. Después podrás programar otra entrega para la misma venta."
        confirmLabel="Cancelar entrega"
        onConfirm={(reason) => cancel.mutateAsync(reason)}
      />
    </div>
  )
}

function EditForm({ d, invalidate }: { d: DeliverySummary; invalidate: readonly (readonly unknown[])[] }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeliveryEditValues>({
    resolver: zodResolver(deliveryEditSchema),
    defaultValues: {
      address: d.address,
      reference_notes: d.reference_notes ?? '',
      delivery_cost: String(d.delivery_cost),
      scheduled_date: d.scheduled_date ?? '',
      notes: d.notes ?? '',
    },
  })
  const save = useInvalidatingMutation((v: DeliveryEditValues) => api.updateDelivery(client(), d.id, v), invalidate)

  async function onSubmit(v: DeliveryEditValues) {
    setError(null)
    setSaved(false)
    try {
      await save.mutateAsync(v)
      setSaved(true)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field id="de-address" label="Dirección de entrega" error={errors.address?.message}>
          <Textarea id="de-address" aria-invalid={!!errors.address} {...register('address')} />
        </Field>
        <Field id="de-ref" label="Referencias" error={errors.reference_notes?.message}>
          <Input id="de-ref" {...register('reference_notes')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="de-date" label="Fecha programada" error={errors.scheduled_date?.message}>
            <Input id="de-date" type="date" min={todayIso()} {...register('scheduled_date')} />
          </Field>
          <Field id="de-cost" label="Costo de entrega (MXN)" error={errors.delivery_cost?.message} hint="Se registra aparte: no se suma a la venta">
            <Input id="de-cost" inputMode="decimal" aria-invalid={!!errors.delivery_cost} {...register('delivery_cost')} />
          </Field>
        </div>
        <Field id="de-notes" label="Observaciones" error={errors.notes?.message}>
          <Textarea id="de-notes" {...register('notes')} />
        </Field>
        <FormError message={error} />
        {saved && (
          <p role="status" className="text-sm text-success">
            Cambios guardados
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className="whitespace-pre-line">{value}</p>
    </div>
  )
}
