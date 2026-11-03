import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { formatDate, formatMXN } from '@/lib/format'
import { SaleStatusBadge } from './components/SaleStatusBadge'
import { useSales } from './hooks'
import { SALE_STATUS_LABEL, type SaleStatus } from './types'

export function SalesPage() {
  const { data, isPending, isError, refetch } = useSales()
  const [status, setStatus] = useState<SaleStatus | 'all'>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (s) =>
        (status === 'all' || s.status === status) &&
        (q === '' || s.sale_number.toLowerCase().includes(q) || s.customer_name.toLowerCase().includes(q)),
    )
  }, [data, status, query])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <Button asChild>
          <Link to="/admin/ventas/nueva">
            <Plus className="size-4" aria-hidden /> Nueva venta
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por folio o cliente"
          aria-label="Buscar ventas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="max-w-[12rem]"
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value as SaleStatus | 'all')}
        >
          <option value="all">Todos los estados</option>
          {Object.entries(SALE_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {isPending ? (
        <LoadingState label="Cargando ventas…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las ventas." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={data.length === 0 ? 'Aún no hay ventas' : 'Sin resultados'}
          description={data.length === 0 ? 'Registra tu primera venta.' : 'Cambia los filtros de búsqueda.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Folio</Th>
              <Th>Fecha</Th>
              <Th>Cliente</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Cobrado</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <Td className="font-mono text-xs">
                  <Link className="text-brand hover:underline" to={`/admin/ventas/${s.id}`}>
                    {s.sale_number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(s.created_at)}</Td>
                <Td>{s.customer_name}</Td>
                <Td className="text-right">{formatMXN(s.total)}</Td>
                <Td className="text-right">{formatMXN(s.confirmed_paid)}</Td>
                <Td>
                  <SaleStatusBadge status={s.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
