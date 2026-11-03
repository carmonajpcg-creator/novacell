import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { PAYMENT_METHOD_LABEL } from '@/features/sales/types'
import { formatDate, formatMXN } from '@/lib/format'
import { useCredit, useCreditPayments, usePaymentAllocations } from './hooks'
import { PAYMENT_KIND_LABEL } from './types'

/** Recibo de enganche o abono confirmado, imprimible. Provisional (docs/PENDING_RULES.md, C12). */
export function PaymentReceiptPage() {
  const { id = '', paymentId = '' } = useParams()
  const credit = useCredit(id)
  const payments = useCreditPayments(credit.data?.sale_id ?? '')
  const allocations = usePaymentAllocations(paymentId)

  if (credit.isPending || payments.isPending || allocations.isPending) return <LoadingState label="Preparando recibo…" />
  const payment = (payments.data ?? []).find((p) => p.id === paymentId)
  if (credit.isError || payments.isError || !payment) return <ErrorState title="Pago no encontrado" />
  if (payment.status !== 'confirmed')
    return <ErrorState title="Recibo no disponible" message="El recibo se emite solo para pagos confirmados." />

  const c = credit.data
  const applied = (allocations.data ?? []).filter((a) => a.reversed_at === null)

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link to={`/admin/creditos/${id}`} className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Volver al crédito
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Imprimir
        </Button>
      </div>

      <article className="space-y-5 rounded-card border border-gray-200 bg-surface p-8 print:border-0 print:p-0" aria-label="Recibo de pago">
        <header className="flex items-start justify-between">
          <Wordmark className="text-2xl" />
          <div className="text-right">
            <p className="text-xs uppercase text-subtle">Recibo de {PAYMENT_KIND_LABEL[payment.kind].toLowerCase()}</p>
            <p className="font-mono text-lg font-semibold">{c.credit_number}</p>
            <p className="text-sm">{formatDate(payment.confirmed_at ?? payment.created_at)}</p>
          </div>
        </header>

        <section className="text-sm">
          <p className="text-xs uppercase text-subtle">Cliente</p>
          <p className="font-medium">{c.customer_name}</p>
        </section>

        <section className="rounded-xl bg-muted p-4">
          <p className="text-xs uppercase text-subtle">Importe recibido</p>
          <p className="text-3xl font-semibold">{formatMXN(payment.amount)}</p>
          <p className="text-sm text-subtle">
            {PAYMENT_METHOD_LABEL[payment.method]}
            {payment.reference ? ` · clave ${payment.reference}` : ''}
          </p>
        </section>

        {payment.kind === 'installment' && applied.length > 0 && (
          <section>
            <p className="mb-1 text-xs uppercase text-subtle">Aplicado a</p>
            <ul className="space-y-1 text-sm">
              {applied.map((a, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    Cuota {a.installment?.number} {a.installment ? `(vence ${formatDate(a.installment.due_date)})` : ''}
                  </span>
                  <span>{formatMXN(a.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-subtle">Saldo actual del crédito</p>
            <p className="text-lg font-semibold">{formatMXN(c.balance)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-subtle">Próximo pago</p>
            <p>{c.next_due_date ? formatDate(c.next_due_date) : '—'}</p>
          </div>
        </section>

        <footer className="border-t border-gray-200 pt-4 text-xs text-subtle">
          Recibo de pago. No es una factura fiscal. El saldo mostrado corresponde al momento de la consulta.
        </footer>
      </article>
    </div>
  )
}
