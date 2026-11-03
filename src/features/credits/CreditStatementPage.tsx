import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { PAYMENT_METHOD_LABEL } from '@/features/sales/types'
import { formatDate, formatMXN } from '@/lib/format'
import { useCredit, useCreditPayments, useInstallments } from './hooks'
import { FREQUENCY_LABEL } from './schedule'
import { CREDIT_STATUS_LABEL, PAYMENT_KIND_LABEL } from './types'

/** Estado de cuenta imprimible. Provisional: sin requisitos contractuales ni fiscales (docs/PENDING_RULES.md, C12). */
export function CreditStatementPage() {
  const { id = '' } = useParams()
  const credit = useCredit(id)
  const installments = useInstallments(id)
  const payments = useCreditPayments(credit.data?.sale_id ?? '')

  if (credit.isPending || installments.isPending || payments.isPending) return <LoadingState label="Preparando estado de cuenta…" />
  if (credit.isError || installments.isError || payments.isError) return <ErrorState title="Crédito no encontrado" />

  const c = credit.data
  const confirmed = (payments.data ?? []).filter((p) => p.status === 'confirmed')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link to={`/admin/creditos/${id}`} className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Volver al crédito
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Imprimir
        </Button>
      </div>

      <article className="space-y-6 rounded-card border border-gray-200 bg-surface p-8 print:border-0 print:p-0" aria-label="Estado de cuenta">
        <header className="flex items-start justify-between">
          <div>
            <Wordmark className="text-2xl" />
            <p className="text-sm text-subtle">Tecnología que conecta contigo.</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-subtle">Estado de cuenta</p>
            <p className="font-mono text-lg font-semibold">{c.credit_number}</p>
            <p className="text-sm">Al {formatDate(new Date())}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-subtle">Cliente</p>
            <p className="font-medium">{c.customer_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-subtle">Condiciones pactadas</p>
            <p>
              {formatMXN(c.financed_total)} financiados · enganche {formatMXN(c.down_payment)} · {c.installments_count} cuotas {FREQUENCY_LABEL[c.frequency].toLowerCase()}s
            </p>
            <p className="text-subtle">Estado: {CREDIT_STATUS_LABEL[c.status]}</p>
          </div>
        </section>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-subtle">
              <th className="py-2 font-medium">Cuota</th>
              <th className="py-2 font-medium">Vence</th>
              <th className="py-2 text-right font-medium">Importe</th>
              <th className="py-2 text-right font-medium">Pagado</th>
              <th className="py-2 text-right font-medium">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {(installments.data ?? []).map((i) => (
              <tr key={i.id} className="border-b border-gray-100">
                <td className="py-1.5">{i.number}</td>
                <td className="py-1.5">
                  {formatDate(i.due_date)}
                  {i.is_overdue ? ` · vencida ${i.days_overdue} d` : ''}
                </td>
                <td className="py-1.5 text-right">{formatMXN(i.amount)}</td>
                <td className="py-1.5 text-right">{formatMXN(i.paid)}</td>
                <td className="py-1.5 text-right">{formatMXN(i.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-subtle">Abonado</p>
            <p className="font-semibold">{formatMXN(c.installments_paid)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-subtle">Saldo</p>
            <p className="text-lg font-semibold">{formatMXN(c.balance)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-subtle">Vencido</p>
            <p className="font-semibold">{formatMXN(c.overdue_amount)}</p>
          </div>
        </section>

        <section>
          <p className="mb-1 text-xs uppercase text-subtle">Pagos recibidos (confirmados)</p>
          <ul className="space-y-1 text-sm">
            {confirmed.length === 0 && <li className="text-subtle">Sin pagos confirmados.</li>}
            {confirmed.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {PAYMENT_KIND_LABEL[p.kind]} · {PAYMENT_METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {p.confirmed_at ? ` · ${formatDate(p.confirmed_at)}` : ''}
                </span>
                <span>{formatMXN(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-t border-gray-200 pt-4 text-xs text-subtle">
          Estado de cuenta informativo. Solo se incluyen pagos confirmados; los pagos pendientes de verificación no reducen el saldo.
          No es una factura fiscal.
        </footer>
      </article>
    </div>
  )
}
