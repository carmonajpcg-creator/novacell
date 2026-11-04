import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, Td, Th } from '@/components/ui/table'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN } from '@/lib/format'
import { formatCents } from '@/lib/money'
import * as api from './api'
import { useCreditBySale } from '@/features/credits/hooks'
import { useLayawayBySale } from '@/features/layaways/hooks'
import { DeliveryFormDialog } from '@/features/deliveries/components/DeliveryFormDialog'
import { useActiveDeliveryBySale } from '@/features/deliveries/hooks'
import { PaymentDialog } from './components/PaymentDialog'
import { ReasonDialog } from './components/ReasonDialog'
import { PaymentStatusBadge, SaleStatusBadge } from './components/SaleStatusBadge'
import { saleKeys, usePayments, useSale, useSaleItems } from './hooks'
import { PAYMENT_METHOD_LABEL, type Payment } from './types'

type Reasoned = { kind: 'reject' | 'reverse'; payment: Payment } | { kind: 'cancel' } | null

const cents = (n: number) => Math.round(n * 100)

export function SaleDetailPage() {
  const { id = '' } = useParams()
  const sale = useSale(id)
  const items = useSaleItems(id)
  const payments = usePayments(id)
  const credit = useCreditBySale(id)
  const layaway = useLayawayBySale(id)
  const delivery = useActiveDeliveryBySale(id)
  const [showDelivery, setShowDelivery] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [reasoned, setReasoned] = useState<Reasoned>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = [saleKeys.one(id), saleKeys.payments(id), saleKeys.items(id), saleKeys.all, ['units'], ['sellable-variants'], ['movements']]
  const confirm = useInvalidatingMutation((paymentId: string) => api.confirmPayment(client(), paymentId), invalidate)
  const reject = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => api.rejectPayment(client(), v.paymentId, v.reason),
    invalidate,
  )
  const reverse = useInvalidatingMutation(
    (v: { paymentId: string; reason: string }) => api.reversePayment(client(), v.paymentId, v.reason),
    invalidate,
  )
  const cancel = useInvalidatingMutation((reason: string) => api.cancelSale(client(), id, reason), invalidate)

  if (sale.isPending || items.isPending || payments.isPending) return <LoadingState label="Cargando venta…" />
  if (sale.isError || items.isError || payments.isError)
    return <ErrorState title="Venta no encontrada" onRetry={() => void sale.refetch()} />

  const s = sale.data
  const remaining = cents(s.total) - cents(s.confirmed_paid) - cents(s.pending_paid)
  const revenue = (items.data ?? []).reduce((sum, i) => sum + cents(i.unit_price) * i.quantity, 0)
  const cost = (items.data ?? []).reduce((sum, i) => sum + cents(i.unit_cost) * i.quantity, 0)
  const isCredit = s.modality === 'credit'
  const isLayaway = s.modality === 'layaway'
  const isPending = s.status === 'pending' && !isCredit && !isLayaway

  async function onConfirm(p: Payment) {
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
        <Link to="/admin/ventas" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Ventas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{s.sale_number}</h1>
            <SaleStatusBadge status={s.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {isCredit && credit.data && (
              <Button asChild>
                <Link to={`/admin/creditos/${credit.data.id}`}>Ver crédito {credit.data.credit_number}</Link>
              </Button>
            )}
            {isLayaway && layaway.data && (
              <Button asChild variant="secondary">
                <Link to={`/admin/apartados/${layaway.data.id}`}>Ver apartado {layaway.data.layaway_number}</Link>
              </Button>
            )}
            {s.status === 'confirmed' && !isCredit && (
              <Button asChild variant="secondary">
                <Link to={`/admin/ventas/${s.id}/comprobante`}>
                  <Printer className="size-4" aria-hidden /> Comprobante
                </Link>
              </Button>
            )}
            {s.status === 'confirmed' && delivery.data && (
              <Button asChild variant="secondary">
                <Link to={`/admin/entregas/${delivery.data.id}`}>Ver entrega {delivery.data.delivery_number}</Link>
              </Button>
            )}
            {s.status === 'confirmed' && delivery.isSuccess && !delivery.data && (
              <Button variant="secondary" onClick={() => setShowDelivery(true)}>
                Programar entrega
              </Button>
            )}
            {isPending && remaining > 0 && <Button onClick={() => setShowPayment(true)}>Registrar pago</Button>}
            {isPending && (
              <Button variant="ghost" onClick={() => setReasoned({ kind: 'cancel' })}>
                Cancelar venta
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-subtle">
          <Link className="text-brand hover:underline" to={`/admin/clientes/${s.customer_id}`}>
            {s.customer_name}
          </Link>{' '}
          · {formatDate(s.created_at)}
        </p>
      </div>

      <FormError message={error} />

      {/* Distinción obligatoria: venta registrada ≠ dinero cobrado ≠ utilidad (CLAUDE.md §14). */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Venta registrada" value={formatMXN(s.total)} />
        <Metric label="Cobrado (confirmado)" value={formatMXN(s.confirmed_paid)} />
        <Metric
          label="Por verificar"
          value={formatMXN(s.pending_paid)}
          hint="Transferencias pendientes: aún no cuentan como cobradas"
        />
        <Metric label="Por cobrar" value={formatCents(isPending ? remaining : 0)} />
      </div>

      {isCredit && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Venta a crédito: el enganche, los abonos y el calendario se gestionan desde el crédito.
        </p>
      )}
      {isLayaway && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Venta por apartado: el anticipo, los abonos y la conversión en venta se gestionan desde el apartado.
        </p>
      )}
      {s.status === 'cancelled' && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Venta cancelada{s.cancelled_at ? ` el ${formatDate(s.cancelled_at)}` : ''}: {s.cancel_reason}
        </p>
      )}
      {s.notes && <p className="text-sm text-subtle">Notas: {s.notes}</p>}

      <section className="space-y-3" aria-label="Productos">
        <h2 className="text-lg font-semibold">Productos</h2>
        <Table>
          <thead>
            <tr>
              <Th>Descripción</Th>
              <Th className="text-right">Cant.</Th>
              <Th className="text-right">Precio</Th>
              <Th className="text-right">Importe</Th>
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
                <Td className="text-right">{formatCents(cents(i.unit_price) * i.quantity)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-sm text-subtle">
          Utilidad estimada de esta venta: <strong className="text-graphite">{formatCents(revenue - cost)}</strong> (venta menos costo histórico; no es dinero cobrado).
        </p>
      </section>

      <section className="space-y-3" aria-label="Pagos">
        <h2 className="text-lg font-semibold">Pagos</h2>
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
                    {p.status === 'pending' && isPending && (
                      <>
                        <Button size="sm" onClick={() => void onConfirm(p)}>
                          Confirmar pago
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReasoned({ kind: 'reject', payment: p })}>
                          Rechazar
                        </Button>
                      </>
                    )}
                    {p.status === 'confirmed' && isPending && (
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

      <DeliveryFormDialog open={showDelivery} onOpenChange={setShowDelivery} presetSaleId={id} onCreated={() => setShowDelivery(false)} />
      <PaymentDialog open={showPayment} onOpenChange={setShowPayment} saleId={id} remainingCents={Math.max(remaining, 0)} />

      <ReasonDialog
        open={reasoned !== null}
        onOpenChange={(open) => !open && setReasoned(null)}
        title={
          reasoned?.kind === 'cancel'
            ? 'Cancelar venta'
            : reasoned?.kind === 'reverse'
              ? 'Revertir pago confirmado'
              : 'Rechazar pago'
        }
        description={
          reasoned?.kind === 'cancel'
            ? 'Se liberará el inventario reservado. El motivo queda registrado.'
            : 'El registro del pago se conserva en el historial con su motivo.'
        }
        confirmLabel={reasoned?.kind === 'cancel' ? 'Cancelar venta' : reasoned?.kind === 'reverse' ? 'Revertir pago' : 'Rechazar pago'}
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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  )
}
