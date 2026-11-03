import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { describeDbError } from '@/lib/dbErrors'
import * as api from '../api'
import { client, keys, useInvalidatingMutation } from '../hooks'
import { MOVEMENT_KINDS, stockSchema, type StockValues } from '../schemas'
import type { ProductVariant } from '../types'

export function StockDialog({
  variant,
  onOpenChange,
}: {
  variant: ProductVariant | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={variant !== null} onOpenChange={onOpenChange}>
      {variant && (
        <DialogContent
          title="Movimiento de inventario"
          description={`${variant.sku} · existencias actuales: ${variant.stock_quantity}`}
        >
          <StockForm variant={variant} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function StockForm({ variant, onDone }: { variant: ProductVariant; onDone: () => void }) {
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StockValues>({
    resolver: zodResolver(stockSchema),
    defaultValues: { kind: 'entry', quantity: '', reason: '' },
  })

  const mutation = useInvalidatingMutation(
    (v: StockValues) => api.adjustVariantStock(client(), variant.id, v, idempotencyKey),
    [keys.variants(variant.product_id), keys.movements],
  )

  async function onSubmit(values: StockValues) {
    setError(null)
    try {
      await mutation.mutateAsync(values)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="kind" label="Tipo de movimiento">
        <Select id="kind" {...register('kind')}>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="quantity" label="Cantidad" error={errors.quantity?.message}>
        <Input id="quantity" inputMode="numeric" aria-invalid={!!errors.quantity} {...register('quantity')} />
      </Field>
      <Field id="reason" label="Motivo" error={errors.reason?.message} hint="Obligatorio en ajustes">
        <Textarea id="reason" {...register('reason')} />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Registrar movimiento'}
        </Button>
      </div>
    </form>
  )
}
