import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Card } from '@/components/ui/card'
import { DeliveryStatusBadge } from '@/features/deliveries/components/DeliveryStatusBadge'
import { client } from '@/hooks/data'
import { formatDate, formatMXN } from '@/lib/format'
import { fetchDashboard } from './api'
import type { DashboardMetrics } from './types'

export function DashboardPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => fetchDashboard(client()), refetchOnWindowFocus: true })

  if (query.isPending) return <LoadingState label="Calculando métricas…" />
  if (query.isError) return <ErrorState message="No se pudieron calcular las métricas." onRetry={() => void query.refetch()} />
  return <Dashboard m={query.data} />
}

function Dashboard({ m }: { m: DashboardMetrics }) {
  const receivable = m.receivable_credits + m.receivable_layaways
  const overdue = m.overdue_installments.total + m.overdue_layaways.total
  const overdueCount = m.overdue_installments.count + m.overdue_layaways.count
  const max = Math.max(1, ...m.last_14_days.flatMap((d) => [d.sales_total, d.collected_total]))

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-subtle">
          Al {formatDate(m.today)}. Venta registrada, dinero cobrado y utilidad son cifras distintas: se muestran por separado.
        </p>
      </header>

      <Section title="Venta registrada" note="Ventas confirmadas, en la fecha en que se confirmaron. Un crédito se registra completo al activarse; un apartado, al convertirse en venta.">
        <Metric label="Ventas de hoy" value={formatMXN(m.sales_today.total)} hint={`${m.sales_today.count} ${m.sales_today.count === 1 ? 'venta' : 'ventas'}`} />
        <Metric label="Ventas del mes" value={formatMXN(m.sales_month.total)} hint={`${m.sales_month.count} ${m.sales_month.count === 1 ? 'venta' : 'ventas'}`} />
      </Section>

      <Section title="Dinero cobrado" note="Solo pagos confirmados, en la fecha en que se confirmaron. No incluye transferencias por verificar ni pagos revertidos.">
        <Metric label="Cobrado hoy" value={formatMXN(m.collected_today.total)} hint={`Efectivo ${formatMXN(m.collected_today.cash)} · Transferencia ${formatMXN(m.collected_today.transfer)}`} />
        <Metric label="Cobrado en el mes" value={formatMXN(m.collected_month.total)} hint={`Efectivo ${formatMXN(m.collected_month.cash)} · Transferencia ${formatMXN(m.collected_month.transfer)}`} />
        <Metric
          label="Por verificar"
          value={formatMXN(m.pending_verification.total)}
          hint={`${m.pending_verification.count} ${m.pending_verification.count === 1 ? 'pago pendiente' : 'pagos pendientes'} (aún no cobrado)`}
          to="/admin/abonos"
        />
      </Section>

      <Section title="Utilidad estimada" note="Total de cada venta confirmada menos su costo histórico. No es dinero cobrado ni descuenta gastos, entregas ni comisiones.">
        <Metric label="Utilidad estimada del mes" value={formatMXN(m.estimated_profit_month)} />
      </Section>

      <Section title="Por cobrar" note="Saldo de créditos activos y de apartados vigentes.">
        <Metric label="Cuentas por cobrar" value={formatMXN(receivable)} hint={`Créditos ${formatMXN(m.receivable_credits)} · Apartados ${formatMXN(m.receivable_layaways)}`} />
        <Metric label="Créditos activos" value={String(m.credits_active)} to="/admin/creditos" />
        <Metric
          label="Saldos vencidos"
          value={formatMXN(overdue)}
          hint={overdueCount > 0 ? `${overdueCount} ${overdueCount === 1 ? 'pago vencido' : 'pagos vencidos'}` : 'Al corriente'}
          tone={overdueCount > 0 ? 'danger' : 'default'}
          to="/admin/cobranza"
        />
      </Section>

      <Section title="Inventario">
        <Metric label="iPhone disponibles" value={String(m.available_units)} to="/admin/inventario" />
        <Metric label="Accesorios con existencias" value={String(m.accessory_variants_in_stock)} hint={`${m.accessory_pieces} piezas en total`} to="/admin/inventario" />
      </Section>

      <Section title="Entregas">
        <Metric label="Entregas en curso" value={String(m.deliveries_open)} to="/admin/entregas" />
        <Card className="space-y-2 p-4 sm:col-span-1 lg:col-span-2">
          <p className="text-xs uppercase text-subtle">Próximas entregas</p>
          {m.next_deliveries.length === 0 ? (
            <p className="text-sm text-subtle">No hay entregas pendientes.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {m.next_deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Link className="font-mono text-xs text-brand hover:underline" to={`/admin/entregas/${d.id}`}>
                      {d.delivery_number}
                    </Link>{' '}
                    · {d.customer_name}
                  </span>
                  <span className="flex items-center gap-2 text-subtle">
                    {d.scheduled_date ? formatDate(d.scheduled_date) : 'Sin fecha'}
                    <DeliveryStatusBadge status={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <section aria-labelledby="serie-title" className="space-y-3">
        <div>
          <h2 id="serie-title" className="text-lg font-semibold">
            Últimos 14 días
          </h2>
          <p className="text-sm text-subtle">Venta registrada frente a dinero cobrado, día por día.</p>
        </div>
        <Card className="space-y-2 overflow-x-auto p-4">
          <div className="flex gap-4 text-xs text-subtle" aria-hidden>
            <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-brand" /> Venta registrada</span>
            <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-graphite" /> Cobrado</span>
          </div>
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Venta registrada y dinero cobrado por día</caption>
            <thead>
              <tr className="text-xs uppercase text-subtle">
                <th scope="col" className="py-1 pr-3 font-medium">Día</th>
                <th scope="col" className="py-1 font-medium">Ventas y cobros</th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">Venta</th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {m.last_14_days.map((d) => (
                <tr key={d.date} className="border-t border-gray-100">
                  <td className="whitespace-nowrap py-1.5 pr-3">{formatDate(d.date)}</td>
                  <td className="w-full py-1.5">
                    <div className="space-y-1" aria-hidden>
                      <div className="h-2 rounded bg-brand" style={{ width: `${(d.sales_total / max) * 100}%` }} />
                      <div className="h-2 rounded bg-graphite" style={{ width: `${(d.collected_total / max) * 100}%` }} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatMXN(d.sales_total)}</td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatMXN(d.collected_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-subtle">{note}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function Metric({
  label,
  value,
  hint,
  to,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  to?: string
  tone?: 'default' | 'danger'
}) {
  const body = (
    <Card className="h-full space-y-1 p-4">
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className={`text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  )
  return to ? (
    <Link to={to} className="block rounded-card transition-shadow hover:shadow-md" aria-label={`${label}: ${value}`}>
      {body}
    </Link>
  ) : (
    body
  )
}
