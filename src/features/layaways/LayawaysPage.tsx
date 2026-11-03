import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { formatDate, formatMXN } from '@/lib/format'
import { ExpiredBadge, LayawayStatusBadge } from './components/LayawayBadges'
import { useLayaways } from './hooks'
import { LAYAWAY_STATUS_LABEL, type LayawayStatus } from './types'

type Filter = LayawayStatus | 'all' | 'expired'

export function LayawaysPage() {
  const { data, isPending, isError, refetch } = useLayaways()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (l) =>
        (filter === 'all' || (filter === 'expired' ? l.is_expired : l.status === filter)) &&
        (q === '' || l.layaway_number.toLowerCase().includes(q) || l.customer_name.toLowerCase().includes(q)),
    )
  }, [data, filter, query])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Apartados</h1>
        <Button asChild>
          <Link to="/admin/apartados/nuevo">
            <Plus className="size-4" aria-hidden /> Nuevo apartado
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por folio o cliente"
          aria-label="Buscar apartados"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select className="max-w-[15rem]" aria-label="Filtrar apartados" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Todos</option>
          <option value="expired">Con reserva vencida</option>
          {Object.entries(LAYAWAY_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {isPending ? (
        <LoadingState label="Cargando apartados…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los apartados." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={data.length === 0 ? 'Aún no hay apartados' : 'Sin resultados'}
          description={data.length === 0 ? 'Registra tu primer apartado.' : 'Cambia los filtros.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Folio</Th>
              <Th>Cliente</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Cobrado</Th>
              <Th className="text-right">Saldo</Th>
              <Th>Fecha límite</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono text-xs">
                  <Link className="text-brand hover:underline" to={`/admin/apartados/${l.id}`}>
                    {l.layaway_number}
                  </Link>
                </Td>
                <Td>{l.customer_name}</Td>
                <Td className="text-right">{formatMXN(l.total)}</Td>
                <Td className="text-right">{formatMXN(l.confirmed_paid)}</Td>
                <Td className="text-right">{formatMXN(l.balance)}</Td>
                <Td className="space-x-1 whitespace-nowrap">
                  {formatDate(l.due_date)}
                  {l.is_expired && <ExpiredBadge days={l.days_overdue} />}
                </Td>
                <Td>
                  <LayawayStatusBadge status={l.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
