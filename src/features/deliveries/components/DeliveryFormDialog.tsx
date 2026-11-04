import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { client } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatMXN, todayIso } from '@/lib/format'
import * as api from '../api'
import { deliveryKeys, useConfirmedSales, useDeliveries } from '../hooks'
import { deliveryFormSchema, type DeliveryFormValues } from '../schemas'

export function DeliveryFormDialog({
  open,
  onOpenChange,
  presetSaleId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetSaleId?: string
  onCreated?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Programar entrega"
          description="Solo se programan entregas de ventas confirmadas. El costo de entrega se registra aparte: no se suma a la venta."
        >
          <DeliveryForm presetSaleId={presetSaleId ?? ''} onDone={() => onOpenChange(false)} onCreated={onCreated} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function DeliveryForm({ presetSaleId, onDone, onCreated }: { presetSaleId: string; onDone: () => void; onCreated?: ((id: string) => void) | undefined }) {
  const sales = useConfirmedSales()
  const deliveries = useDeliveries()
  const qc = useQueryClient()
  // La clave de idempotencia es estable mientras el diálogo esté abierto: un doble clic o reintento no duplica.
  const [key] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeliveryFormValues>({
    resolver: zodResolver(deliveryFormSchema),
    defaultValues: { saleId: presetSaleId, address: '', reference_notes: '', delivery_cost: '', scheduled_date: '', notes: '' },
  })

  const available = useMemo(() => {
    const busy = new Set((deliveries.data ?? []).filter((d) => d.status !== 'cancelled').map((d) => d.sale_id))
    return (sales.data ?? []).filter((s) => !busy.has(s.id))
  }, [sales.data, deliveries.data])

  async function onSubmit(values: DeliveryFormValues) {
    setError(null)
    try {
      const id = await api.createDelivery(client(), values, key)
      await Promise.all([
        qc.invalidateQueries({ queryKey: deliveryKeys.all }),
        qc.invalidateQueries({ queryKey: deliveryKeys.bySale(values.saleId) }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
      onCreated?.(id)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  if (sales.isPending || deliveries.isPending) return <LoadingState label="Cargando ventas…" />
  if (sales.isError || deliveries.isError) return <ErrorState message="No se pudieron cargar las ventas." />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="dl-sale" label="Venta" error={errors.saleId?.message} hint={available.length === 0 ? 'No hay ventas confirmadas sin entrega vigente' : undefined}>
        <Select id="dl-sale" aria-invalid={!!errors.saleId} disabled={presetSaleId !== ''} {...register('saleId')}>
          <option value="">Selecciona…</option>
          {(presetSaleId ? (sales.data ?? []).filter((s) => s.id === presetSaleId) : available).map((s) => (
            <option key={s.id} value={s.id}>
              {s.sale_number} · {s.customer_name} · {formatMXN(s.total)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="dl-address" label="Dirección de entrega" error={errors.address?.message} hint="Dato personal: solo la ve el administrador.">
        <Textarea id="dl-address" aria-invalid={!!errors.address} {...register('address')} />
      </Field>
      <Field id="dl-ref" label="Referencias" error={errors.reference_notes?.message} hint="Opcional">
        <Input id="dl-ref" {...register('reference_notes')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="dl-date" label="Fecha programada" error={errors.scheduled_date?.message} hint="Opcional">
          <Input id="dl-date" type="date" min={todayIso()} {...register('scheduled_date')} />
        </Field>
        <Field id="dl-cost" label="Costo de entrega (MXN)" error={errors.delivery_cost?.message} hint="Lo capturas tú; no se suma a la venta">
          <Input id="dl-cost" inputMode="decimal" aria-invalid={!!errors.delivery_cost} {...register('delivery_cost')} />
        </Field>
      </div>
      <Field id="dl-notes" label="Observaciones" error={errors.notes?.message} hint="Opcional">
        <Textarea id="dl-notes" {...register('notes')} />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Programar entrega'}
        </Button>
      </div>
    </form>
  )
}
