import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { useCustomer } from '@/features/customers/hooks'
import { formatDate, formatMXN } from '@/lib/format'
import { formatCents } from '@/lib/money'
import { usePayments, useSale, useSaleItems } from './hooks'
import { PAYMENT_METHOD_LABEL } from './types'

/** Comprobante de venta imprimible. Valores provisionales pendientes de aprobación: ver docs/PENDING_RULES.md (P6). */
export function ReceiptPage() {
  const { id = '' } = useParams()
  const sale = useSale(id)
  const items = useSaleItems(id)
  const payments = usePayments(id)
  const customer = useCustomer(sale.data?.customer_id ?? '')

  if (sale.isPending || items.isPending || payments.isPending) return <LoadingState label="Preparando comprobante…" />
  if (sale.isError || items.isError || payments.isError) return <ErrorState title="Venta no encontrada" />

  const s = sale.data
  if (s.status !== 'confirmed') {
    return (
      <ErrorState
        title="Comprobante no disponible"
        message="El comprobante se emite cuando la venta está confirmada (totalmente cobrada)."
      />
    )
  }

  const confirmedPayments = (payments.data ?? []).filter((p) => p.status === 'confirmed')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link to={`/admin/ventas/${id}`} className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Volver a la venta
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Imprimir
        </Button>
      </div>

      <article className="space-y-6 rounded-card border border-gray-200 bg-surface p-8 print:border-0 print:p-0" aria-label="Comprobante de venta">
        <header className="flex items-start justify-between">
          <div>
            <Wordmark className="text-2xl" />
            <p className="text-sm text-subtle">Tecnología que conecta contigo.</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-subtle">Comprobante de venta</p>
            <p className="font-mono text-lg font-semibold">{s.sale_number}</p>
            <p className="text-sm">{formatDate(s.confirmed_at ?? s.created_at)}</p>
          </div>
        </header>

        <section>
          <p className="text-xs uppercase text-subtle">Cliente</p>
          <p className="font-medium">{s.customer_name}</p>
          {customer.data?.phone && <p className="text-sm text-subtle">{customer.data.phone}</p>}
        </section>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-subtle">
              <th className="py-2 font-medium">Descripción</th>
              <th className="py-2 text-right font-medium">Cant.</th>
              <th className="py-2 text-right font-medium">Precio</th>
              <th className="py-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((i) => (
              <tr key={i.id} className="border-b border-gray-100 align-top">
                <td className="py-2">
                  {i.description}
                  {i.unit && <span className="block font-mono text-xs text-subtle">IMEI {i.unit.imei}</span>}
                </td>
                <td className="py-2 text-right">{i.quantity}</td>
                <td className="py-2 text-right">{formatMXN(i.unit_price)}</td>
                <td className="py-2 text-right">{formatCents(Math.round(i.unit_price * 100) * i.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right font-medium">
                Total
              </td>
              <td className="pt-3 text-right text-lg font-semibold">{formatMXN(s.total)}</td>
            </tr>
          </tfoot>
        </table>

        <section>
          <p className="mb-1 text-xs uppercase text-subtle">Pagos recibidos</p>
          <ul className="space-y-1 text-sm">
            {confirmedPayments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {PAYMENT_METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {p.confirmed_at ? ` · ${formatDate(p.confirmed_at)}` : ''}
                </span>
                <span>{formatMXN(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-t border-gray-200 pt-4 text-xs text-subtle">
          Comprobante de venta. No es una factura fiscal. Conserva este documento como constancia de tu compra.
        </footer>
      </article>
    </div>
  )
}
