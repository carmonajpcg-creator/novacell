import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { PaymentStatusBadge } from '@/features/sales/components/SaleStatusBadge'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, type PaymentStatus } from '@/features/sales/types'
import { formatDate, formatMXN } from '@/lib/format'
import { useAllCreditPayments } from './hooks'
import { PAYMENT_KIND_LABEL } from './types'

/** Sección "Abonos": todos los enganches y abonos de crédito, con la cola de pagos por verificar. */
export function PaymentsPage() {
  const { data, isPending, isError, refetch } = useAllCreditPayments()
  const [status, setStatus] = useState<PaymentStatus | 'all'>('pending')

  const filtered = useMemo(() => (data ?? []).filter((p) => status === 'all' || p.status === status), [data, status])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Abonos</h1>
        <Select
          className="max-w-[14rem]"
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value as PaymentStatus | 'all')}
        >
          <option value="all">Todos</option>
          {Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-sm text-subtle">
        Una transferencia pendiente no reduce el saldo hasta que se confirma. Abre el crédito para confirmarla o rechazarla.
      </p>
      {isPending ? (
        <LoadingState label="Cargando abonos…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los abonos." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin movimientos" description={status === 'pending' ? 'No hay pagos por verificar.' : 'No hay pagos con ese estado.'} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Crédito</Th>
              <Th>Cliente</Th>
              <Th>Tipo</Th>
              <Th>Método</Th>
              <Th className="text-right">Importe</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{formatDate(p.created_at)}</Td>
                <Td className="font-mono text-xs">
                  {p.sale?.credit ? (
                    <Link className="text-brand hover:underline" to={`/admin/creditos/${p.sale.credit.id}`}>
                      {p.sale.credit.credit_number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>{p.sale?.customer?.name ?? '—'}</Td>
                <Td>{PAYMENT_KIND_LABEL[p.kind]}</Td>
                <Td>{PAYMENT_METHOD_LABEL[p.method]}</Td>
                <Td className="text-right">{formatMXN(p.amount)}</Td>
                <Td>
                  <PaymentStatusBadge status={p.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
