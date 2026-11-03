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
import { client, keys, useInvalidatingMutation } from '../hooks'
import * as api from '../api'
import { unitSchema, type UnitValues } from '../schemas'
import type { ProductUnit } from '../types'

const empty: UnitValues = {
  imei: '',
  serial_number: '',
  storage_gb: '',
  color: '',
  condition: 'used',
  physical_grade: '',
  battery_health: '',
  acquisition_cost: '',
  sale_price: '',
  notes: '',
}

function fromUnit(u: ProductUnit): UnitValues {
  return {
    imei: u.imei,
    serial_number: u.serial_number ?? '',
    storage_gb: String(u.storage_gb),
    color: u.color,
    condition: u.condition,
    physical_grade: u.physical_grade ?? '',
    battery_health: u.battery_health === null ? '' : String(u.battery_health),
    acquisition_cost: String(u.acquisition_cost),
    sale_price: String(u.sale_price),
    notes: u.notes ?? '',
  }
}

export function UnitFormDialog({
  open,
  onOpenChange,
  productId,
  unit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  unit?: ProductUnit | undefined
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={unit ? 'Editar unidad' : 'Registrar iPhone'}
          description="Cada equipo se identifica por su IMEI. El IMEI y el costo son privados."
        >
          <UnitForm productId={productId} unit={unit} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function UnitForm({ productId, unit, onDone }: { productId: string; unit?: ProductUnit | undefined; onDone: () => void }) {
  // La clave de idempotencia es estable mientras el formulario esté abierto: un doble clic o reintento no duplica.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnitValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: unit ? fromUnit(unit) : empty,
  })

  const invalidate = [keys.units, keys.unitsByProduct(productId), keys.movements]
  const mutation = useInvalidatingMutation(
    (v: UnitValues) =>
      unit ? api.updateUnit(client(), unit.id, v) : api.registerUnit(client(), productId, v, idempotencyKey),
    invalidate,
  )

  async function onSubmit(values: UnitValues) {
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
      <Field id="imei" label="IMEI" error={errors.imei?.message} hint="15 dígitos">
        <Input id="imei" inputMode="numeric" maxLength={15} aria-invalid={!!errors.imei} {...register('imei')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="storage_gb" label="Capacidad (GB)" error={errors.storage_gb?.message}>
          <Input id="storage_gb" inputMode="numeric" aria-invalid={!!errors.storage_gb} {...register('storage_gb')} />
        </Field>
        <Field id="color" label="Color" error={errors.color?.message}>
          <Input id="color" aria-invalid={!!errors.color} {...register('color')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="condition" label="Condición">
          <Select id="condition" {...register('condition')}>
            <option value="new">Nuevo</option>
            <option value="used">Seminuevo</option>
          </Select>
        </Field>
        <Field id="battery_health" label="Batería (%)" error={errors.battery_health?.message} hint="Opcional">
          <Input id="battery_health" inputMode="numeric" aria-invalid={!!errors.battery_health} {...register('battery_health')} />
        </Field>
      </div>
      <Field id="physical_grade" label="Estado físico" error={errors.physical_grade?.message} hint="Opcional. Se muestra al público en la tienda: redáctalo pensando en el cliente.">
        <Input id="physical_grade" {...register('physical_grade')} />
      </Field>
      <Field id="serial_number" label="Número de serie" error={errors.serial_number?.message} hint="Opcional">
        <Input id="serial_number" {...register('serial_number')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="acquisition_cost" label="Costo de adquisición (MXN)" error={errors.acquisition_cost?.message}>
          <Input id="acquisition_cost" inputMode="decimal" aria-invalid={!!errors.acquisition_cost} {...register('acquisition_cost')} />
        </Field>
        <Field id="sale_price" label="Precio de venta (MXN)" error={errors.sale_price?.message}>
          <Input id="sale_price" inputMode="decimal" aria-invalid={!!errors.sale_price} {...register('sale_price')} />
        </Field>
      </div>
      <Field id="notes" label="Notas internas" error={errors.notes?.message} hint="Opcional">
        <Textarea id="notes" {...register('notes')} />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : unit ? 'Guardar cambios' : 'Registrar'}
        </Button>
      </div>
    </form>
  )
}
