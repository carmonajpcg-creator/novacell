import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { saleKeys } from '@/features/sales/hooks'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatCents } from '@/lib/money'
import * as api from '../api'
import { layawayKeys } from '../hooks'
import { layawayPaymentSchema, type LayawayPaymentValues } from '../schemas'

export function LayawayPaymentDialog({
  open,
  onOpenChange,
  layawayId,
  saleId,
  suggestedCents,
  limitCents,
  isDown,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layawayId: string
  saleId: string
  suggestedCents: number
  limitCents: number
  isDown: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={isDown ? 'Registrar anticipo' : 'Registrar abono'}
          description={`Saldo por cubrir: ${formatCents(limitCents)}. El efectivo se confirma al instante; una transferencia queda pendiente hasta verificar el depósito y no cuenta como cobrada.`}
        >
          <LayawayPaymentForm
            layawayId={layawayId}
            saleId={saleId}
            suggestedCents={suggestedCents}
            onDone={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

function LayawayPaymentForm({
  layawayId,
  saleId,
  suggestedCents,
  onDone,
}: {
  layawayId: string
  saleId: string
  suggestedCents: number
  onDone: () => void
}) {
  // Clave estable mientras el diálogo esté abierto: un doble clic o reintento no duplica el pago.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LayawayPaymentValues>({
    resolver: zodResolver(layawayPaymentSchema),
    defaultValues: { method: 'cash', amount: (Math.max(suggestedCents, 0) / 100).toFixed(2), reference: '' },
  })
  const method = useWatch({ control, name: 'method' })

  const pay = useInvalidatingMutation(
    (v: LayawayPaymentValues) =>
      api.recordLayawayPayment(
        client(),
        { layawayId, method: v.method, amount: v.amount, reference: (v.reference ?? '').trim() || null },
        idempotencyKey,
      ),
    [
      layawayKeys.all, layawayKeys.one(layawayId), layawayKeys.payments(saleId), layawayKeys.bySale(saleId),
      saleKeys.all, saleKeys.one(saleId), saleKeys.payments(saleId), ['units'], ['movements'],
    ],
  )

  async function onSubmit(values: LayawayPaymentValues) {
    setError(null)
    try {
      await pay.mutateAsync(values)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="lp-method" label="Método de pago">
        <Select id="lp-method" {...register('method')}>
          <option value="cash">Efectivo</option>
          <option value="transfer">Transferencia</option>
        </Select>
      </Field>
      <Field id="lp-amount" label="Importe (MXN)" error={errors.amount?.message}>
        <Input id="lp-amount" inputMode="decimal" aria-invalid={!!errors.amount} {...register('amount')} />
      </Field>
      {method === 'transfer' && (
        <Field
          id="lp-ref"
          label="Clave de rastreo"
          error={errors.reference?.message}
          hint="Verifica el depósito en tu banco antes de confirmar: una captura de pantalla no basta."
        >
          <Input id="lp-ref" aria-invalid={!!errors.reference} {...register('reference')} />
        </Field>
      )}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registrando…' : 'Registrar pago'}
        </Button>
      </div>
    </form>
  )
}
