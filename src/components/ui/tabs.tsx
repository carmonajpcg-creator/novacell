import { cn } from '@/lib/utils'

export interface TabItem<T extends string> {
  value: T
  label: string
}

/** Pestañas simples (botones con aria-pressed) para alternar vistas en una misma página. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-muted p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            item.value === value ? 'bg-surface shadow-sm' : 'text-subtle hover:text-graphite',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
