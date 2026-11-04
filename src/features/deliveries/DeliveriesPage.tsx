import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { formatDate, formatMXN } from '@/lib/format'
import { DeliveryFormDialog } from './components/DeliveryFormDialog'
import { DeliveryStatusBadge } from './components/DeliveryStatusBadge'
import { useDeliveries } from './hooks'
import { DELIVERY_STATUS_LABEL, type DeliveryStatus } from './types'

type Filter = DeliveryStatus | 'all' | 'open'

export function DeliveriesPage() {
  const { data, isPending, isError, refetch } = useDeliveries()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? [])
      .filter((d) => {
        if (filter === 'open' && (d.status === 'delivered' || d.status === 'cancelled')) return false
        if (filter !== 'open' && filter !== 'all' && d.status !== filter) return false
        return q === '' || d.customer_name.toLowerCase().includes(q) || d.delivery_number.toLowerCase().includes(q) || d.sale_number.toLowerCase().includes(q)
      })
      .sort((a, b) => (a.scheduled_date ?? '9999').localeCompare(b.scheduled_date ?? '9999') || b.created_at.localeCompare(a.created_at))
  }, [data, filter, query])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Entregas</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Programar entrega
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por cliente, folio de entrega o de venta"
          aria-label="Buscar entregas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select className="max-w-[14rem]" aria-label="Filtrar entregas" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="open">En curso</option>
          <option value="all">Todas</option>
          {Object.entries(DELIVERY_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isPending ? (
        <LoadingState label="Cargando entregas…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las entregas." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={data.length === 0 ? 'Aún no hay entregas' : 'Sin resultados'}
          description={data.length === 0 ? 'Programa la primera entrega de una venta confirmada.' : 'Cambia los filtros.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Entrega</Th>
              <Th>Cliente</Th>
              <Th>Venta</Th>
              <Th>Programada</Th>
              <Th className="text-right">Costo</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id}>
                <Td className="font-mono text-xs">
                  <Link className="text-brand hover:underline" to={`/admin/entregas/${d.id}`}>
                    {d.delivery_number}
                  </Link>
                </Td>
                <Td>{d.customer_name}</Td>
                <Td className="font-mono text-xs">
                  <Link className="text-brand hover:underline" to={`/admin/ventas/${d.sale_id}`}>
                    {d.sale_number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{d.scheduled_date ? formatDate(d.scheduled_date) : '—'}</Td>
                <Td className="text-right">{formatMXN(d.delivery_cost)}</Td>
                <Td>
                  <DeliveryStatusBadge status={d.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <DeliveryFormDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate(`/admin/entregas/${id}`)} />
    </div>
  )
}
