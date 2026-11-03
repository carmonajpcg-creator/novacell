import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** Campo de formulario: etiqueta, control, ayuda y error accesibles. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string | undefined
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-subtle">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger">
      {message}
    </p>
  )
}
