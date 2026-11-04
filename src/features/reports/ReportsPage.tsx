import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, Td, Th } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { client } from '@/hooks/data'
import { downloadCsv, toCsv } from '@/lib/csv'
import { formatDate, formatMXN, todayIso } from '@/lib/format'
import {
  fetchPaymentsReport, fetchReportSummary, fetchSalesReport, MODALITY_LABEL, PAYMENT_KIND_REPORT_LABEL, presetRange,
  type PaymentsReportRow, type ReportSummary, type SalesReportRow,
} from './api'

type View = 'sales' | 'payments'
const MAX_DAYS = 366

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

export function ReportsPage() {
  const today = todayIso()
  const [view, setView] = useState<View>('sales')
  const [range, setRange] = useState(() => presetRange(today, 'month'))

  const invalid =
    !/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)
      ? 'Selecciona las dos fechas'
      : range.from > range.to
        ? 'La fecha inicial no puede ser posterior a la final'
        : daysBetween(range.from, range.to) > MAX_DAYS
          ? `El rango máximo es de ${MAX_DAYS} días`
          : null

  const summary = useQuery({
    queryKey: ['report-summary', range.from, range.to],
    queryFn: () => fetchReportSummary(client(), range.from, range.to),
    enabled: invalid === null,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <Tabs
          label="Reporte"
          value={view}
          onChange={setView}
          items={[
            { value: 'sales', label: 'Ventas' },
            { value: 'payments', label: 'Cobros' },
          ]}
        />
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium">
            Desde
            <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Hasta
            <Input type="date" value={range.to} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rangos rápidos">
            {([['today', 'Hoy'], ['month', 'Este mes'], ['prev-month', 'Mes anterior'], ['last-30', 'Últimos 30 días']] as const).map(([p, label]) => (
              <Button key={p} variant="secondary" size="sm" onClick={() => setRange(presetRange(today, p))}>
                {label}
              </Button>
            ))}
          </div>
        </div>
        {invalid && (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        )}
        <p className="text-xs text-subtle">Fechas en hora de Ciudad de México. Cada cifra se calcula en la base de datos.</p>
      </Card>

      {invalid === null && (
        <>
          <SummaryCards summary={summary} />
          {view === 'sales' ? <SalesTable from={range.from} to={range.to} /> : <PaymentsTable from={range.from} to={range.to} />}
        </>
      )}
    </div>
  )
}

function SummaryCards({ summary }: { summary: ReturnType<typeof useQuery<ReportSummary>> }) {
  if (summary.isPending) return <LoadingState label="Calculando resumen…" />
  if (summary.isError) return <ErrorState message="No se pudo calcular el resumen." onRetry={() => void summary.refetch()} />
  const s = summary.data
  return (
    <section aria-label="Resumen" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Venta registrada" value={formatMXN(s.sales_total)} hint={`${s.sales_count} ${s.sales_count === 1 ? 'venta confirmada' : 'ventas confirmadas'}`} />
      <Stat label="Costo de lo vendido" value={formatMXN(s.cost_total)} />
      <Stat label="Utilidad estimada" value={formatMXN(s.sales_total - s.cost_total)} hint="Venta menos costo; no es dinero cobrado" />
      <Stat
        label="Dinero cobrado"
        value={formatMXN(s.collected_total)}
        hint={`Efectivo ${formatMXN(s.collected_cash)} · Transferencia ${formatMXN(s.collected_transfer)} · ${s.payments_count} pagos`}
      />
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  )
}

function SalesTable({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-sales', from, to], queryFn: () => fetchSalesReport(client(), from, to) })
  if (q.isPending) return <LoadingState label="Cargando ventas…" />
  if (q.isError) return <ErrorState message="No se pudo cargar el reporte." onRetry={() => void q.refetch()} />
  const rows: SalesReportRow[] = q.data
  if (rows.length === 0) return <EmptyState title="Sin ventas en este periodo" description="Solo cuentan las ventas confirmadas." />

  function exportCsv() {
    downloadCsv(
      `ventas_${from}_a_${to}.csv`,
      toCsv(
        ['Folio', 'Fecha de confirmación', 'Cliente', 'Modalidad', 'Total', 'Costo', 'Utilidad estimada', 'Cobrado a la fecha', 'Saldo'],
        rows.map((r) => [r.sale_number, r.confirmed_on, r.customer_name, MODALITY_LABEL[r.modality], r.total, r.cost, r.estimated_profit, r.confirmed_paid, r.balance]),
      ),
    )
  }

  return (
    <section aria-label="Detalle de ventas" className="space-y-3">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={exportCsv}>
          <Download className="size-4" aria-hidden /> Exportar CSV
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Folio</Th>
            <Th>Fecha</Th>
            <Th>Cliente</Th>
            <Th>Modalidad</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Costo</Th>
            <Th className="text-right">Utilidad</Th>
            <Th className="text-right">Cobrado</Th>
            <Th className="text-right">Saldo</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sale_id}>
              <Td className="font-mono text-xs">{r.sale_number}</Td>
              <Td className="whitespace-nowrap">{formatDate(r.confirmed_on)}</Td>
              <Td>{r.customer_name}</Td>
              <Td>{MODALITY_LABEL[r.modality]}</Td>
              <Td className="text-right">{formatMXN(r.total)}</Td>
              <Td className="text-right">{formatMXN(r.cost)}</Td>
              <Td className="text-right">{formatMXN(r.estimated_profit)}</Td>
              <Td className="text-right">{formatMXN(r.confirmed_paid)}</Td>
              <Td className="text-right">{formatMXN(r.balance)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-subtle">«Cobrado» y «Saldo» son lo confirmado a la fecha de consulta, aunque parte se haya cobrado fuera del periodo.</p>
    </section>
  )
}

function PaymentsTable({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-payments', from, to], queryFn: () => fetchPaymentsReport(client(), from, to) })
  if (q.isPending) return <LoadingState label="Cargando cobros…" />
  if (q.isError) return <ErrorState message="No se pudo cargar el reporte." onRetry={() => void q.refetch()} />
  const rows: PaymentsReportRow[] = q.data
  if (rows.length === 0) return <EmptyState title="Sin cobros en este periodo" description="Solo cuentan los pagos confirmados." />

  function exportCsv() {
    downloadCsv(
      `cobros_${from}_a_${to}.csv`,
      toCsv(
        ['Fecha de confirmación', 'Folio de venta', 'Cliente', 'Tipo', 'Método', 'Importe', 'Referencia'],
        rows.map((r) => [r.confirmed_on, r.sale_number, r.customer_name, PAYMENT_KIND_REPORT_LABEL[r.kind], r.method === 'cash' ? 'Efectivo' : 'Transferencia', r.amount, r.reference ?? '']),
      ),
    )
  }

  return (
    <section aria-label="Detalle de cobros" className="space-y-3">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={exportCsv}>
          <Download className="size-4" aria-hidden /> Exportar CSV
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Venta</Th>
            <Th>Cliente</Th>
            <Th>Tipo</Th>
            <Th>Método</Th>
            <Th className="text-right">Importe</Th>
            <Th>Referencia</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.payment_id}>
              <Td className="whitespace-nowrap">{formatDate(r.confirmed_on)}</Td>
              <Td className="font-mono text-xs">{r.sale_number}</Td>
              <Td>{r.customer_name}</Td>
              <Td>{PAYMENT_KIND_REPORT_LABEL[r.kind]}</Td>
              <Td>{r.method === 'cash' ? 'Efectivo' : 'Transferencia'}</Td>
              <Td className="text-right">{formatMXN(r.amount)}</Td>
              <Td className="font-mono text-xs">{r.reference ?? '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}
