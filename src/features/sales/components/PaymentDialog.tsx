import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatCents } from '@/lib/money'
import * as api from '../api'
import { saleKeys } from '../hooks'
import { paymentSchema, type PaymentValues } from '../schemas'

export function PaymentDialog({
  open,
  onOpenChange,
  saleId,
  remainingCents,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  saleId: string
  remainingCents: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Registrar pago"
          description={`Saldo por cobrar: ${formatCents(remainingCents)}. El efectivo se confirma al instante; una transferencia queda pendiente hasta verificar el depósito.`}
        >
          <PaymentForm saleId={saleId} remainingCents={remainingCents} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function PaymentForm({ saleId, remainingCents, onDone }: { saleId: string; remainingCents: number; onDone: () => void }) {
  // Clave estable mientras el diálogo esté abierto: un doble clic o reintento no duplica el pago.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: 'cash', amount: (remainingCents / 100).toFixed(2), reference: '' },
  })
  const method = useWatch({ control, name: 'method' })

  const pay = useInvalidatingMutation(
    (v: PaymentValues) =>
      api.recordPayment(
        client(),
        { saleId, method: v.method, amount: v.amount, reference: (v.reference ?? '').trim() || null },
        idempotencyKey,
      ),
    [saleKeys.one(saleId), saleKeys.payments(saleId), saleKeys.items(saleId), saleKeys.all],
  )

  async function onSubmit(values: PaymentValues) {
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
      <Field id="pay-method" label="Método de pago">
        <Select id="pay-method" {...register('method')}>
          <option value="cash">Efectivo</option>
          <option value="transfer">Transferencia</option>
        </Select>
      </Field>
      <Field id="pay-amount" label="Importe (MXN)" error={errors.amount?.message}>
        <Input id="pay-amount" inputMode="decimal" aria-invalid={!!errors.amount} {...register('amount')} />
      </Field>
      {method === 'transfer' && (
        <Field
          id="pay-ref"
          label="Clave de rastreo"
          error={errors.reference?.message}
          hint="Una captura de pantalla no basta: verifica el depósito en tu banco antes de confirmar."
        >
          <Input id="pay-ref" aria-invalid={!!errors.reference} {...register('reference')} />
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
