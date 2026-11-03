import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, Td, Th } from '@/components/ui/table'
import { CreditStatusBadge } from '@/features/credits/components/CreditStatusBadge'
import { useCustomerCredits } from '@/features/credits/hooks'
import { SaleStatusBadge } from '@/features/sales/components/SaleStatusBadge'
import { useCustomerSales } from '@/features/sales/hooks'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN } from '@/lib/format'
import * as api from './api'
import { CustomerFormDialog } from './CustomerFormDialog'
import { customerKeys, useCustomer } from './hooks'
import { CONTACT_METHOD_LABEL, SOURCE_LABEL } from './types'

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const customer = useCustomer(id)
  const sales = useCustomerSales(id)
  const credits = useCustomerCredits(id)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = useInvalidatingMutation(
    (active: boolean) => api.setCustomerActive(client(), id, active),
    [customerKeys.all, customerKeys.one(id)],
  )
  const remove = useInvalidatingMutation(() => api.deleteCustomer(client(), id), [customerKeys.all])

  if (customer.isPending) return <LoadingState label="Cargando cliente…" />
  if (customer.isError) return <ErrorState title="Cliente no encontrado" onRetry={() => void customer.refetch()} />
  const c = customer.data

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/admin/clientes" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Clientes
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Activo' : 'Inactivo'}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button variant="ghost" onClick={() => void run(() => toggle.mutateAsync(!c.is_active))}>
              {c.is_active ? 'Desactivar' : 'Activar'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!window.confirm('¿Eliminar este cliente? Solo es posible si no tiene ventas.')) return
                void run(async () => {
                  await remove.mutateAsync()
                  navigate('/admin/clientes', { replace: true })
                })
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      </div>
      <FormError message={error} />

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Teléfono" value={c.phone ?? '—'} />
        <Info label="Medio de contacto" value={CONTACT_METHOD_LABEL[c.contact_method]} />
        <Info label="Origen" value={SOURCE_LABEL[c.acquisition_source]} />
        <Info label="Cliente desde" value={formatDate(c.created_at)} />
        {c.notes && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Info label="Notas internas" value={c.notes} />
          </div>
        )}
      </Card>

      <section className="space-y-3" aria-label="Historial de compras">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Historial de compras</h2>
          {c.is_active && (
            <Button asChild variant="secondary">
              <Link to="/admin/ventas/nueva">Nueva venta</Link>
            </Button>
          )}
        </div>
        {sales.isPending ? (
          <LoadingState label="Cargando historial…" />
        ) : sales.isError ? (
          <ErrorState message="No se pudo cargar el historial." onRetry={() => void sales.refetch()} />
        ) : sales.data.length === 0 ? (
          <EmptyState title="Sin compras" description="Las ventas de este cliente aparecerán aquí." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th>Fecha</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Cobrado</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {sales.data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono text-xs">
                    <Link className="text-brand hover:underline" to={`/admin/ventas/${s.id}`}>
                      {s.sale_number}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(s.created_at)}</Td>
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
      </section>

      {(credits.data ?? []).length > 0 && (
        <section className="space-y-3" aria-label="Créditos">
          <h2 className="text-lg font-semibold">Créditos</h2>
          <Table>
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th className="text-right">Financiado</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="text-right">Vencido</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {(credits.data ?? []).map((cr) => (
                <tr key={cr.id}>
                  <Td className="font-mono text-xs">
                    <Link className="text-brand hover:underline" to={`/admin/creditos/${cr.id}`}>
                      {cr.credit_number}
                    </Link>
                  </Td>
                  <Td className="text-right">{formatMXN(cr.financed_total)}</Td>
                  <Td className="text-right">{formatMXN(cr.balance)}</Td>
                  <Td className="text-right">{cr.overdue_count > 0 ? formatMXN(cr.overdue_amount) : '—'}</Td>
                  <Td>
                    <CreditStatusBadge status={cr.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={c} />
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-subtle">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  )
}
