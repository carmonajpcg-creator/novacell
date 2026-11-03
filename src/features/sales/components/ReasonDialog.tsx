import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { describeDbError } from '@/lib/dbErrors'
import { reasonSchema, type ReasonValues } from '../schemas'

/** Diálogo genérico que pide un motivo obligatorio antes de ejecutar una acción sensible. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  onConfirm: (reason: string) => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={title} {...(description ? { description } : {})}>
          <ReasonForm confirmLabel={confirmLabel} onConfirm={onConfirm} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function ReasonForm({
  confirmLabel,
  onConfirm,
  onDone,
}: {
  confirmLabel: string
  onConfirm: (reason: string) => Promise<unknown>
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' } })

  async function onSubmit(values: ReasonValues) {
    setError(null)
    try {
      await onConfirm(values.reason)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="reason" label="Motivo" error={errors.reason?.message}>
        <Textarea id="reason" aria-invalid={!!errors.reason} {...register('reason')} />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Volver
        </Button>
        <Button type="submit" variant="dark" disabled={isSubmitting}>
          {isSubmitting ? 'Procesando…' : confirmLabel}
        </Button>
      </div>
    </form>
  )
}
