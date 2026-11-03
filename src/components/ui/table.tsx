import * as React from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-card border border-gray-200 bg-surface">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  )
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap bg-muted px-4 py-3 text-xs font-medium uppercase text-subtle', className)}
      {...props}
    />
  )
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-t border-gray-100 px-4 py-3 align-middle', className)} {...props} />
}
