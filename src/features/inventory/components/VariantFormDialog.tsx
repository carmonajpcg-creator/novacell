import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { describeDbError } from '@/lib/dbErrors'
import * as api from '../api'
import { client, keys, useInvalidatingMutation } from '../hooks'
import { variantSchema, type VariantValues } from '../schemas'
import type { ProductVariant } from '../types'

export function VariantFormDialog({
  open,
  onOpenChange,
  productId,
  variant,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  variant?: ProductVariant | undefined
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={variant ? 'Editar variante' : 'Nueva variante'}
          description="Las existencias se modifican solo con movimientos de inventario."
        >
          <VariantForm productId={productId} variant={variant} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function VariantForm({
  productId,
  variant,
  onDone,
}: {
  productId: string
  variant?: ProductVariant | undefined
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VariantValues>({
    resolver: zodResolver(variantSchema),
    defaultValues: variant
      ? {
          sku: variant.sku,
          color: variant.color ?? '',
          compatible_model: variant.compatible_model ?? '',
          price: String(variant.price),
          cost: String(variant.cost),
          is_active: variant.is_active,
        }
      : { sku: '', color: '', compatible_model: '', price: '', cost: '', is_active: true },
  })

  const mutation = useInvalidatingMutation(
    (v: VariantValues) =>
      variant ? api.updateVariant(client(), variant.id, v) : api.createVariant(client(), productId, v),
    [keys.variants(productId)],
  )

  async function onSubmit(values: VariantValues) {
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
      <Field id="sku" label="SKU" error={errors.sku?.message}>
        <Input id="sku" aria-invalid={!!errors.sku} {...register('sku')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="color" label="Color" error={errors.color?.message} hint="Opcional">
          <Input id="color" {...register('color')} />
        </Field>
        <Field id="compatible_model" label="Modelo compatible" error={errors.compatible_model?.message} hint="Opcional">
          <Input id="compatible_model" {...register('compatible_model')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="price" label="Precio (MXN)" error={errors.price?.message}>
          <Input id="price" inputMode="decimal" aria-invalid={!!errors.price} {...register('price')} />
        </Field>
        <Field id="cost" label="Costo (MXN)" error={errors.cost?.message}>
          <Input id="cost" inputMode="decimal" aria-invalid={!!errors.cost} {...register('cost')} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register('is_active')} /> Variante activa
      </label>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}
