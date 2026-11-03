import { cn } from '@/lib/utils'

/** Logotipo provisional de texto, hasta contar con el logotipo definitivo. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-xl font-semibold tracking-tight', className)}>
      Nova<span className="text-brand">Cell</span>
    </span>
  )
}
