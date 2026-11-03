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
import { saleKeys, useSaleItems } from '@/features/sales/hooks'
import { PAYMENT_METHOD_LABEL } from '@/features/sales/types'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN } from '@/lib/format'
import * as api from './api'
import { ExpiredBadge, LayawayStatusBadge } from './components/LayawayBadges'
import { LayawayPaymentDialog } from './components/LayawayPaymentDialog'
import { layawayKeys, useLayaway, useLayawayPayments } from './hooks'
import type { LayawayPayment } from './types'

type Reasoned = { kind: 'reject' | 'reverse'; payment: LayawayPayment } | { kind: 'cancel' } | null
const cents = (n: number) => Math.round(n * 100)

export function LayawayDetailPage() {
  const { id = '' } = useParams()
  const layaway = useLayaway(id)
  const saleId = layaway.data?.sale_id ?? ''
  const items = useSaleItems(saleId)
  const payments = useLayawayPayments(saleId)
  const [showPayment, setShowPayment] = useState(false)
  const [reasoned, setReasoned] = useState<Reasoned>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = [
    layawayKeys.all, layawayKeys.one(id), layawayKeys.payments(saleId), layawayKeys.bySale(saleId),
    saleKeys.all, saleKeys.one(saleId), saleKeys.payments(saleId), saleKeys.items(saleId), ['units'], ['sellable-variants'], ['movements'],
  ]
  const confirm = useInvalidatingMutation((paymentId: string) => salesApi.confirmPayment(client(), paymentId), invalidate)
  const reject = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => salesApi.rejectPayment(client(), v.paymentId, v.reason), invalidate)
  const reverse = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => salesApi.reversePayment(client(), v.paymentId, v.reason), invalidate)
  const cancel = useInvalidatingMutation((reason: string) => salesApi.cancelSale(client(), saleId, reason), invalidate)
  const convert = useInvalidatingMutation(() => api.convertLayaway(client(), id), invalidate)

  if (layaway.isPending || (saleId !== '' && (items.isPending || payments.isPending))) return <LoadingState label="Cargando apartado…" />
  if (layaway.isError || items.isError || payments.isError)
    return <ErrorState title="Apartado no encontrado" onRetry={() => void layaway.refetch()} />

  const l = layaway.data
  const free = Math.max(cents(l.balance) - cents(l.pending_verification), 0)
  const open = l.status === 'pending_down' || l.status === 'active'
  const downPending = Math.max(cents(l.down_payment) - cents(l.confirmed_paid), 0)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  async function onConfirm(p: LayawayPayment) {
    if (!window.confirm(`¿Verificaste en tu banco el depósito de ${formatMXN(p.amount)} (clave ${p.reference ?? '—'})?`)) return
    await run(() => confirm.mutateAsync(p.id))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/admin/apartados" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Apartados
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{l.layaway_number}</h1>
            <LayawayStatusBadge status={l.status} />
            {l.is_expired && <ExpiredBadge days={l.days_overdue} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {l.status === 'converted' && (
              <Button asChild variant="secondary">
                <Link to={`/admin/ventas/${l.sale_id}/comprobante`}>
                  <Printer className="size-4" aria-hidden /> Comprobante de venta
                </Link>
              </Button>
            )}
            {open && free > 0 && (
              <Button onClick={() => setShowPayment(true)}>{l.status === 'pending_down' ? 'Registrar anticipo' : 'Registrar abono'}</Button>
            )}
            {l.status === 'settled' && (
              <Button
                onClick={() => {
                  if (window.confirm('¿Convertir este apartado en venta? Se entrega el equipo y la venta queda confirmada.'))
                    void run(() => convert.mutateAsync())
                }}
              >
                Convertir en venta
              </Button>
            )}
            {open && (
              <Button variant="ghost" onClick={() => setReasoned({ kind: 'cancel' })}>
                Cancelar apartado
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-subtle">
          <Link className="text-brand hover:underline" to={`/admin/clientes/${l.customer_id}`}>
            {l.customer_name}
          </Link>{' '}
          · venta{' '}
          <Link className="text-brand hover:underline" to={`/admin/ventas/${l.sale_id}`}>
            {l.sale_number}
          </Link>{' '}
          · fecha límite {formatDate(l.due_date)}
        </p>
      </div>

      <FormError message={error} />

      {l.is_expired && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-danger">
          La fecha límite venció hace {l.days_overdue} día(s). El equipo sigue reservado: el sistema no libera reservas
          vencidas por sí solo. Decide con el cliente si continúa o se cancela.
        </p>
      )}

      {/* Distinción obligatoria (CLAUDE.md §14): total ≠ cobrado ≠ por verificar ≠ saldo. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Total del apartado" value={formatMXN(l.total)} />
        <Metric label="Anticipo pactado" value={formatMXN(l.down_payment)} />
        <Metric label="Cobrado (confirmado)" value={formatMXN(l.confirmed_paid)} />
        <Metric label="Por verificar" value={formatMXN(l.pending_verification)} hint="Aún no cuenta como cobrado" />
        <Metric label="Saldo" value={formatMXN(l.balance)} hint={l.status === 'pending_down' ? `Falta anticipo: ${formatMXN(downPending / 100)}` : undefined} />
      </div>
      {l.notes && <p className="text-sm text-subtle">Notas: {l.notes}</p>}

      <section className="space-y-3" aria-label="Productos">
        <h2 className="text-lg font-semibold">Productos apartados</h2>
        <Table>
          <thead>
            <tr>
              <Th>Descripción</Th>
              <Th className="text-right">Cant.</Th>
              <Th className="text-right">Precio</Th>
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((i) => (
              <tr key={i.id}>
                <Td>
                  {i.description}
                  {i.unit && <span className="block font-mono text-xs text-subtle">{i.unit.internal_code} · IMEI {i.unit.imei}</span>}
                </Td>
                <Td className="text-right">{i.quantity}</Td>
                <Td className="text-right">{formatMXN(i.unit_price)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="space-y-3" aria-label="Pagos">
        <h2 className="text-lg font-semibold">Anticipo y abonos</h2>
        {(payments.data ?? []).length === 0 ? (
          <Card className="text-sm text-subtle">Aún no hay pagos registrados.</Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
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
                  <Td>{PAYMENT_METHOD_LABEL[p.method]}</Td>
                  <Td className="font-mono text-xs">{p.reference ?? '—'}</Td>
                  <Td className="text-right">{formatMXN(p.amount)}</Td>
                  <Td>
                    <PaymentStatusBadge status={p.status} />
                    {p.status_reason && <span className="block text-xs text-subtle">{p.status_reason}</span>}
                  </Td>
                  <Td className="space-x-1 whitespace-nowrap text-right">
                    {p.status === 'pending' && open && (
                      <>
                        <Button size="sm" onClick={() => void onConfirm(p)}>
                          Confirmar pago
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReasoned({ kind: 'reject', payment: p })}>
                          Rechazar
                        </Button>
                      </>
                    )}
                    {p.status === 'confirmed' && (l.status === 'pending_down' || l.status === 'active' || l.status === 'settled') && (
                      <Button size="sm" variant="ghost" onClick={() => setReasoned({ kind: 'reverse', payment: p })}>
                        Revertir
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <LayawayPaymentDialog
        open={showPayment}
        onOpenChange={setShowPayment}
        layawayId={l.id}
        saleId={l.sale_id}
        suggestedCents={l.status === 'pending_down' ? Math.min(downPending, free) : free}
        limitCents={free}
        isDown={l.status === 'pending_down'}
      />

      <ReasonDialog
        open={reasoned !== null}
        onOpenChange={(o) => !o && setReasoned(null)}
        title={reasoned?.kind === 'cancel' ? 'Cancelar apartado' : reasoned?.kind === 'reverse' ? 'Revertir pago confirmado' : 'Rechazar pago'}
        description={
          reasoned?.kind === 'cancel'
            ? 'Se libera el equipo reservado. Con pagos confirmados no es posible: la devolución o retención del anticipo requiere una política aprobada.'
            : 'El registro se conserva en el historial con su motivo y el estado del apartado se recalcula.'
        }
        confirmLabel={reasoned?.kind === 'cancel' ? 'Cancelar apartado' : reasoned?.kind === 'reverse' ? 'Revertir pago' : 'Rechazar pago'}
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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  )
}
