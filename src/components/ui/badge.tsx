import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-muted text-graphite',
      brand: 'bg-brand/10 text-brand',
      success: 'bg-green-100 text-success',
      danger: 'bg-red-100 text-danger',
      warning: 'bg-amber-100 text-amber-800',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
