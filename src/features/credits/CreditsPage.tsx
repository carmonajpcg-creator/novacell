import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { formatDate, formatMXN } from '@/lib/format'
import { CreditStatusBadge } from './components/CreditStatusBadge'
import { useCredits } from './hooks'
import { CREDIT_STATUS_LABEL, type CreditStatus } from './types'

type Filter = CreditStatus | 'all' | 'overdue'

export function CreditsPage() {
  const { data, isPending, isError, refetch } = useCredits()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (c) =>
        (filter === 'all' || (filter === 'overdue' ? c.overdue_count > 0 : c.status === filter)) &&
        (q === '' || c.credit_number.toLowerCase().includes(q) || c.customer_name.toLowerCase().includes(q)),
    )
  }, [data, filter, query])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Créditos</h1>
        <Button asChild>
          <Link to="/admin/creditos/nuevo">
            <Plus className="size-4" aria-hidden /> Nuevo crédito
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por folio o cliente"
          aria-label="Buscar créditos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select className="max-w-[14rem]" aria-label="Filtrar créditos" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Todos</option>
          <option value="overdue">Con pagos vencidos</option>
          {Object.entries(CREDIT_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {isPending ? (
        <LoadingState label="Cargando créditos…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los créditos." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={data.length === 0 ? 'Aún no hay créditos' : 'Sin resultados'}
          description={data.length === 0 ? 'Crea tu primer crédito.' : 'Cambia los filtros.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Folio</Th>
              <Th>Cliente</Th>
              <Th className="text-right">Financiado</Th>
              <Th className="text-right">Saldo</Th>
              <Th>Próximo pago</Th>
              <Th className="text-right">Vencido</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">
                  <Link className="text-brand hover:underline" to={`/admin/creditos/${c.id}`}>
                    {c.credit_number}
                  </Link>
                </Td>
                <Td>{c.customer_name}</Td>
                <Td className="text-right">{formatMXN(c.financed_total)}</Td>
                <Td className="text-right">{formatMXN(c.balance)}</Td>
                <Td className="whitespace-nowrap">{c.next_due_date ? formatDate(c.next_due_date) : '—'}</Td>
                <Td className="text-right">
                  {c.overdue_count > 0 ? (
                    <Badge tone="danger">
                      {formatMXN(c.overdue_amount)} · {c.overdue_count}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <CreditStatusBadge status={c.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
