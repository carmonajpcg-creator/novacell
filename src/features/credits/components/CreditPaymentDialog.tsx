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
import { creditKeys } from '../hooks'
import { creditPaymentSchema, type CreditPaymentValues } from '../schemas'

export function CreditPaymentDialog({
  open,
  onOpenChange,
  creditId,
  saleId,
  kind,
  suggestedCents,
  limitCents,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  creditId: string
  saleId: string
  kind: 'down_payment' | 'installment'
  suggestedCents: number
  limitCents: number
}) {
  const title = kind === 'down_payment' ? 'Registrar enganche' : 'Registrar abono'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={title}
          description={`${kind === 'down_payment' ? 'Enganche por cubrir' : 'Saldo por cubrir'}: ${formatCents(limitCents)}. El efectivo se confirma al instante; una transferencia queda pendiente hasta verificar el depósito y no baja el saldo.`}
        >
          <CreditPaymentForm
            creditId={creditId}
            saleId={saleId}
            kind={kind}
            suggestedCents={suggestedCents}
            onDone={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

function CreditPaymentForm({
  creditId,
  saleId,
  kind,
  suggestedCents,
  onDone,
}: {
  creditId: string
  saleId: string
  kind: 'down_payment' | 'installment'
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
  } = useForm<CreditPaymentValues>({
    resolver: zodResolver(creditPaymentSchema),
    defaultValues: { kind, method: 'cash', amount: (Math.max(suggestedCents, 0) / 100).toFixed(2), reference: '' },
  })
  const method = useWatch({ control, name: 'method' })

  const pay = useInvalidatingMutation(
    (v: CreditPaymentValues) =>
      api.recordCreditPayment(
        client(),
        { creditId, kind, method: v.method, amount: v.amount, reference: (v.reference ?? '').trim() || null },
        idempotencyKey,
      ),
    [
      creditKeys.all, creditKeys.one(creditId), creditKeys.installments(creditId), creditKeys.payments(saleId),
      saleKeys.all, saleKeys.one(saleId), saleKeys.payments(saleId), ['units'], ['movements'],
    ],
  )

  async function onSubmit(values: CreditPaymentValues) {
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
      <Field id="cp-method" label="Método de pago">
        <Select id="cp-method" {...register('method')}>
          <option value="cash">Efectivo</option>
          <option value="transfer">Transferencia</option>
        </Select>
      </Field>
      <Field id="cp-amount" label="Importe (MXN)" error={errors.amount?.message}>
        <Input id="cp-amount" inputMode="decimal" aria-invalid={!!errors.amount} {...register('amount')} />
      </Field>
      {method === 'transfer' && (
        <Field
          id="cp-ref"
          label="Clave de rastreo"
          error={errors.reference?.message}
          hint="Verifica el depósito en tu banco antes de confirmar: una captura de pantalla no basta."
        >
          <Input id="cp-ref" aria-invalid={!!errors.reference} {...register('reference')} />
        </Field>
      )}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registrando…' : kind === 'down_payment' ? 'Registrar enganche' : 'Registrar abono'}
        </Button>
      </div>
    </form>
  )
}
