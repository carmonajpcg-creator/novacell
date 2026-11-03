import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { formatDate, formatMXN } from '@/lib/format'
import { useCollectionQueue } from './hooks'
import { dueLabel } from './messages'
import { ReminderDialog } from './ReminderDialog'
import { OUTCOME_LABEL, REMINDER_STATUS_LABEL, type QueueItem } from './types'

type View = 'overdue' | 'upcoming' | 'all'

const cents = (n: number) => Math.round(n * 100)

export function CollectionsPage() {
  const { data, isPending, isError, refetch } = useCollectionQueue()
  const [view, setView] = useState<View>('overdue')
  const [windowDays, setWindowDays] = useState(7)
  const [customer, setCustomer] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<QueueItem | null>(null)

  const customers = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of data ?? []) map.set(i.customer_id, i.customer_name)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? [])
      .filter((i) => {
        if (view === 'overdue' && i.days_overdue <= 0) return false
        if (view === 'upcoming' && !(i.days_overdue <= 0 && i.days_overdue >= -windowDays)) return false
        if (customer && i.customer_id !== customer) return false
        return q === '' || i.customer_name.toLowerCase().includes(q) || i.folio.toLowerCase().includes(q)
      })
      .sort((a, b) => b.days_overdue - a.days_overdue)
  }, [data, view, windowDays, customer, query])

  const overdueItems = (data ?? []).filter((i) => i.days_overdue > 0)
  const overdueTotal = overdueItems.reduce((s, i) => s + cents(i.amount_due), 0)
  const overdueCustomers = new Set(overdueItems.map((i) => i.customer_id)).size

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Cobranza</h1>
        <Tabs
          label="Vista"
          value={view}
          onChange={setView}
          items={[
            { value: 'overdue', label: 'Vencidos' },
            { value: 'upcoming', label: 'Próximos' },
            { value: 'all', label: 'Todos' },
          ]}
        />
      </div>
      <p className="text-sm text-subtle">
        El envío es manual: el sistema prepara el mensaje y abre WhatsApp. Abrir WhatsApp no confirma que el mensaje se haya enviado.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="space-y-1 p-4">
          <p className="text-xs uppercase text-subtle">Vencido por cobrar</p>
          <p className="text-xl font-semibold text-danger">{formatMXN(overdueTotal / 100)}</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs uppercase text-subtle">Pagos vencidos</p>
          <p className="text-xl font-semibold">{overdueItems.length}</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs uppercase text-subtle">Clientes con atraso</p>
          <p className="text-xl font-semibold">{overdueCustomers}</p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por cliente o folio"
          aria-label="Buscar en cobranza"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select className="max-w-[14rem]" aria-label="Filtrar por cliente" value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">Todos los clientes</option>
          {customers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        {view === 'upcoming' && (
          <Select className="max-w-[12rem]" aria-label="Ventana de próximos" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            <option value={7}>Próximos 7 días</option>
            <option value={15}>Próximos 15 días</option>
            <option value={30}>Próximos 30 días</option>
          </Select>
        )}
      </div>

      {isPending ? (
        <LoadingState label="Cargando cobranza…" />
      ) : isError ? (
        <ErrorState message="No se pudo cargar la cobranza." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={view === 'overdue' ? 'No hay pagos vencidos' : 'Sin pagos en esta vista'}
          description="Los pagos aparecen aquí según los créditos activos y los apartados vigentes."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Concepto</Th>
              <Th>Vence</Th>
              <Th className="text-right">Importe</Th>
              <Th>Seguimiento</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={`${i.kind}-${i.ref_id}`}>
                <Td className="font-medium">
                  <Link className="text-brand hover:underline" to={`/admin/clientes/${i.customer_id}`}>
                    {i.customer_name}
                  </Link>
                </Td>
                <Td>
                  <Link
                    className="font-mono text-xs text-brand hover:underline"
                    to={i.kind === 'installment' ? `/admin/creditos/${i.credit_id}` : `/admin/apartados/${i.layaway_id}`}
                  >
                    {i.folio}
                  </Link>
                  {i.installment_number ? <span className="text-subtle"> · cuota {i.installment_number}</span> : <span className="text-subtle"> · apartado</span>}
                </Td>
                <Td className="space-x-1 whitespace-nowrap">
                  {formatDate(i.due_date)}
                  <Badge tone={i.days_overdue > 0 ? 'danger' : i.days_overdue === 0 ? 'warning' : 'neutral'}>{dueLabel(i.days_overdue)}</Badge>
                </Td>
                <Td className="text-right">{formatMXN(i.amount_due)}</Td>
                <Td className="text-xs">
                  {i.last_reminder_status ? (
                    <>
                      <span className="block">{REMINDER_STATUS_LABEL[i.last_reminder_status]}</span>
                      {i.last_outcome && (
                        <span className="block text-subtle">
                          {OUTCOME_LABEL[i.last_outcome]}
                          {i.last_promised_date ? ` · ${formatDate(i.last_promised_date)}` : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-subtle">Sin seguimiento</span>
                  )}
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="secondary" onClick={() => setSelected(i)}>
                    Recordatorio
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ReminderDialog item={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  )
}
