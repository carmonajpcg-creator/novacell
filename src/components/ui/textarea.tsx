import * as React from 'react'
import { cn } from '@/lib/utils'

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xl border border-gray-300 bg-surface px-4 py-3 text-sm placeholder:text-subtle disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
