import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, Td, Th } from '@/components/ui/table'
import * as salesApi from '@/features/sales/api'
import { ReasonDialog } from '@/features/sales/components/ReasonDialog'
import { PaymentStatusBadge } from '@/features/sales/components/SaleStatusBadge'
import { saleKeys } from '@/features/sales/hooks'
import { PAYMENT_METHOD_LABEL } from '@/features/sales/types'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN } from '@/lib/format'
import { CreditPaymentDialog } from './components/CreditPaymentDialog'
import { CreditStatusBadge, InstallmentBadge } from './components/CreditStatusBadge'
import { creditKeys, useCredit, useCreditPayments, useInstallments } from './hooks'
import { FREQUENCY_LABEL } from './schedule'
import { PAYMENT_KIND_LABEL, type CreditPayment } from './types'

type Reasoned = { kind: 'reject' | 'reverse'; payment: CreditPayment } | { kind: 'cancel' } | null
const cents = (n: number) => Math.round(n * 100)

export function CreditDetailPage() {
  const { id = '' } = useParams()
  const credit = useCredit(id)
  const saleId = credit.data?.sale_id ?? ''
  const installments = useInstallments(id)
  const payments = useCreditPayments(saleId)
  const [dialog, setDialog] = useState<'down_payment' | 'installment' | null>(null)
  const [reasoned, setReasoned] = useState<Reasoned>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = [
    creditKeys.all, creditKeys.one(id), creditKeys.installments(id), creditKeys.payments(saleId),
    saleKeys.all, saleKeys.one(saleId), saleKeys.payments(saleId), ['units'], ['movements'],
  ]
  const confirm = useInvalidatingMutation((paymentId: string) => salesApi.confirmPayment(client(), paymentId), invalidate)
  const reject = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => salesApi.rejectPayment(client(), v.paymentId, v.reason), invalidate)
  const reverse = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => salesApi.reversePayment(client(), v.paymentId, v.reason), invalidate)
  const cancel = useInvalidatingMutation((reason: string) => salesApi.cancelSale(client(), saleId, reason), invalidate)

  if (credit.isPending || installments.isPending || (saleId !== '' && payments.isPending))
    return <LoadingState label="Cargando crédito…" />
  if (credit.isError || installments.isError || payments.isError)
    return <ErrorState title="Crédito no encontrado" onRetry={() => void credit.refetch()} />

  const c = credit.data
  const downPending = cents(c.down_payment) - cents(c.down_paid)
  const downCommitted = (payments.data ?? [])
    .filter((p) => p.kind === 'down_payment' && p.status === 'pending')
    .reduce((s, p) => s + cents(p.amount), 0)
  const downRemaining = Math.max(downPending - downCommitted, 0)
  const balanceFree = Math.max(cents(c.balance) - cents(c.pending_verification), 0)
  const nextInstallment = (installments.data ?? []).find((i) => i.remaining > 0)
  const suggested = Math.min(nextInstallment ? cents(nextInstallment.remaining) : 0, balanceFree)

  async function onConfirm(p: CreditPayment) {
    if (!window.confirm(`¿Verificaste en tu banco el depósito de ${formatMXN(p.amount)} (clave ${p.reference ?? '—'})?`)) return
    setError(null)
    try {
      await confirm.mutateAsync(p.id)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/admin/creditos" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Créditos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{c.credit_number}</h1>
            <CreditStatusBadge status={c.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to={`/admin/creditos/${c.id}/estado-de-cuenta`}>
                <Printer className="size-4" aria-hidden /> Estado de cuenta
              </Link>
            </Button>
            {c.status === 'pending_down' && downRemaining > 0 && <Button onClick={() => setDialog('down_payment')}>Registrar enganche</Button>}
            {c.status === 'active' && balanceFree > 0 && <Button onClick={() => setDialog('installment')}>Registrar abono</Button>}
            {c.status === 'pending_down' && (
              <Button variant="ghost" onClick={() => setReasoned({ kind: 'cancel' })}>
                Cancelar crédito
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-subtle">
          <Link className="text-brand hover:underline" to={`/admin/clientes/${c.customer_id}`}>
            {c.customer_name}
          </Link>{' '}
          · venta{' '}
          <Link className="text-brand hover:underline" to={`/admin/ventas/${c.sale_id}`}>
            {c.sale_number}
          </Link>{' '}
          · {FREQUENCY_LABEL[c.frequency]}, {c.installments_count} cuotas
        </p>
      </div>

      <FormError message={error} />

      {/* Distinción obligatoria (CLAUDE.md §14): financiado ≠ cobrado ≠ por verificar ≠ saldo. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Precio financiado" value={formatMXN(c.financed_total)} />
        <Metric label="Enganche cobrado" value={`${formatMXN(c.down_paid)} de ${formatMXN(c.down_payment)}`} />
        <Metric label="Abonado (confirmado)" value={formatMXN(c.installments_paid)} />
        <Metric label="Saldo" value={formatMXN(c.balance)} hint="Solo pagos confirmados" />
        <Metric
          label="Vencido"
          value={formatMXN(c.overdue_amount)}
          hint={c.overdue_count > 0 ? `${c.overdue_count} cuota(s) vencida(s)` : 'Al corriente'}
          danger={c.overdue_count > 0}
        />
      </div>
      {c.pending_verification > 0 && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Hay {formatMXN(c.pending_verification)} por verificar. No reducen el saldo hasta que confirmes el depósito.
        </p>
      )}

      <section className="space-y-3" aria-label="Calendario de pagos">
        <h2 className="text-lg font-semibold">Calendario de pagos</h2>
        <Table>
          <thead>
            <tr>
              <Th>Cuota</Th>
              <Th>Vence</Th>
              <Th className="text-right">Importe</Th>
              <Th className="text-right">Pagado</Th>
              <Th className="text-right">Pendiente</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {(installments.data ?? []).map((i) => (
              <tr key={i.id}>
                <Td>{i.number}</Td>
                <Td className="whitespace-nowrap">{formatDate(i.due_date)}</Td>
                <Td className="text-right">{formatMXN(i.amount)}</Td>
                <Td className="text-right">{formatMXN(i.paid)}</Td>
                <Td className="text-right">{formatMXN(i.remaining)}</Td>
                <Td>
                  <InstallmentBadge i={i} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="space-y-3" aria-label="Pagos">
        <h2 className="text-lg font-semibold">Enganche y abonos</h2>
        {(payments.data ?? []).length === 0 ? (
          <Card className="text-sm text-subtle">Aún no hay pagos registrados.</Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th>Método</Th>
                <Th>Referencia</Th>
                <Th className="text-right">Importe</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{formatDate(p.created_at)}</Td>
                  <Td>{PAYMENT_KIND_LABEL[p.kind]}</Td>
                  <Td>{PAYMENT_METHOD_LABEL[p.method]}</Td>
                  <Td className="font-mono text-xs">{p.reference ?? '—'}</Td>
                  <Td className="text-right">{formatMXN(p.amount)}</Td>
                  <Td>
                    <PaymentStatusBadge status={p.status} />
                    {p.status_reason && <span className="block text-xs text-subtle">{p.status_reason}</span>}
                  </Td>
                  <Td className="space-x-1 whitespace-nowrap text-right">
                    {p.status === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => void onConfirm(p)}>
                          Confirmar pago
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReasoned({ kind: 'reject', payment: p })}>
                          Rechazar
                        </Button>
                      </>
                    )}
                    {p.status === 'confirmed' && (
                      <>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/admin/creditos/${c.id}/pago/${p.id}`}>Recibo</Link>
                        </Button>
                        {(p.kind === 'installment' || c.status === 'pending_down') && (
                          <Button size="sm" variant="ghost" onClick={() => setReasoned({ kind: 'reverse', payment: p })}>
                            Revertir
                          </Button>
                        )}
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {dialog && (
        <CreditPaymentDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          creditId={c.id}
          saleId={c.sale_id}
          kind={dialog}
          suggestedCents={dialog === 'down_payment' ? downRemaining : suggested}
          limitCents={dialog === 'down_payment' ? downRemaining : balanceFree}
        />
      )}

      <ReasonDialog
        open={reasoned !== null}
        onOpenChange={(open) => !open && setReasoned(null)}
        title={reasoned?.kind === 'cancel' ? 'Cancelar crédito' : reasoned?.kind === 'reverse' ? 'Revertir pago confirmado' : 'Rechazar pago'}
        description={
          reasoned?.kind === 'cancel'
            ? 'Se libera el iPhone reservado. Solo es posible si no hay pagos confirmados.'
            : 'El registro se conserva en el historial con su motivo. Al revertir un abono, el saldo se restituye.'
        }
        confirmLabel={reasoned?.kind === 'cancel' ? 'Cancelar crédito' : reasoned?.kind === 'reverse' ? 'Revertir pago' : 'Rechazar pago'}
        onConfirm={(reason) => {
          if (reasoned?.kind === 'cancel') return cancel.mutateAsync(reason)
          if (reasoned?.kind === 'reject') return reject.mutateAsync({ paymentId: reasoned.payment.id, reason })
          if (reasoned?.kind === 'reverse') return reverse.mutateAsync({ paymentId: reasoned.payment.id, reason })
          return Promise.resolve()
        }}
      />
    </div>
  )
}

function Metric({ label, value, hint, danger }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className={`text-xl font-semibold ${danger ? 'text-danger' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  )
}
