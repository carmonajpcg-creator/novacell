import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-gray-200 bg-surface p-6 shadow-sm', className)}
      {...props}
    />
  )
}
