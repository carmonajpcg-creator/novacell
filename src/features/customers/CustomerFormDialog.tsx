import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import * as api from './api'
import { customerKeys } from './hooks'
import { customerSchema, type CustomerValues } from './schemas'
import { CONTACT_METHOD_LABEL, SOURCE_LABEL, type Customer } from './types'

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer?: Customer | undefined
  onSaved?: (customer: Customer) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={customer ? 'Editar cliente' : 'Nuevo cliente'}
          description="Registra solo los datos necesarios para operar. Son privados."
        >
          <CustomerForm customer={customer} onDone={() => onOpenChange(false)} onSaved={onSaved} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function CustomerForm({
  customer,
  onDone,
  onSaved,
}: {
  customer?: Customer | undefined
  onDone: () => void
  onSaved?: ((customer: Customer) => void) | undefined
}) {
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer
      ? {
          name: customer.name,
          phone: customer.phone ?? '',
          contact_method: customer.contact_method,
          acquisition_source: customer.acquisition_source,
          notes: customer.notes ?? '',
        }
      : { name: '', phone: '', contact_method: 'whatsapp', acquisition_source: 'whatsapp', notes: '' },
  })

  const save = useInvalidatingMutation(
    (v: CustomerValues) =>
      customer ? api.updateCustomer(client(), customer.id, v) : api.createCustomer(client(), v),
    [customerKeys.all, ...(customer ? [customerKeys.one(customer.id)] : [])],
  )

  async function onSubmit(values: CustomerValues) {
    setError(null)
    try {
      const saved = await save.mutateAsync(values)
      onSaved?.(saved)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="c-name" label="Nombre" error={errors.name?.message}>
        <Input id="c-name" autoComplete="off" aria-invalid={!!errors.name} {...register('name')} />
      </Field>
      <Field id="c-phone" label="Teléfono" error={errors.phone?.message} hint="10 dígitos, opcional">
        <Input id="c-phone" inputMode="tel" autoComplete="off" aria-invalid={!!errors.phone} {...register('phone')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="c-contact" label="Medio de contacto">
          <Select id="c-contact" {...register('contact_method')}>
            {Object.entries(CONTACT_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="c-source" label="Origen">
          <Select id="c-source" {...register('acquisition_source')}>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="c-notes" label="Notas internas" error={errors.notes?.message} hint="Opcional">
        <Textarea id="c-notes" {...register('notes')} />
      </Field>
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
