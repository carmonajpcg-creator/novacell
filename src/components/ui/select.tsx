import * as React from 'react'
import { cn } from '@/lib/utils'

/** Select nativo con estilo del sistema: accesible y óptimo en móvil. */
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-xl border border-gray-300 bg-surface px-3 text-sm disabled:opacity-50 aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  )
}
