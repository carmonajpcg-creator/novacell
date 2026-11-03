import { useState } from 'react'
import { Eye, EyeOff, Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, Td, Th } from '@/components/ui/table'
import { describeDbError } from '@/lib/dbErrors'
import { formatMXN } from '@/lib/format'
import { maskImei } from '@/lib/imei'
import * as api from '../api'
import { client, keys, useInvalidatingMutation, useUnitsByProduct } from '../hooks'
import { CONDITION_LABEL, UNIT_STATUS_LABEL, type ProductUnit, type UnitStatus } from '../types'
import { UnitFormDialog } from './UnitFormDialog'

const statusTone: Record<UnitStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  available: 'success',
  reserved: 'warning',
  sold: 'neutral',
  inactive: 'danger',
}

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  return <Badge tone={statusTone[status]}>{UNIT_STATUS_LABEL[status]}</Badge>
}

export function UnitsSection({ productId }: { productId: string }) {
  const { data, isPending, isError, refetch } = useUnitsByProduct(productId)
  const [dialog, setDialog] = useState<{ open: boolean; unit?: ProductUnit }>({ open: false })
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const toggleActive = useInvalidatingMutation(
    ({ unit }: { unit: ProductUnit }) =>
      api.setUnitActive(
        client(),
        unit.id,
        unit.status === 'inactive',
        unit.status === 'inactive' ? 'Reactivada manualmente' : 'Desactivada manualmente',
        crypto.randomUUID(),
      ),
    [keys.units, keys.unitsByProduct(productId), keys.movements],
  )

  async function onToggle(unit: ProductUnit) {
    setError(null)
    try {
      await toggleActive.mutateAsync({ unit })
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="space-y-4" aria-label="Unidades">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Unidades (por IMEI)</h2>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="size-4" aria-hidden /> Registrar iPhone
        </Button>
      </div>
      <FormError message={error} />
      {isPending ? (
        <LoadingState label="Cargando unidades…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las unidades." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="Sin unidades registradas" description="Registra cada equipo con su IMEI." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>IMEI</Th>
              <Th>Equipo</Th>
              <Th>Condición</Th>
              <Th className="text-right">Costo</Th>
              <Th className="text-right">Precio</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <Td className="font-mono text-xs">{u.internal_code}</Td>
                <Td className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {revealed.has(u.id) ? u.imei : maskImei(u.imei)}
                    <button
                      type="button"
                      className="rounded p-1 text-subtle hover:bg-muted"
                      aria-label={revealed.has(u.id) ? 'Ocultar IMEI' : 'Mostrar IMEI'}
                      onClick={() => toggleReveal(u.id)}
                    >
                      {revealed.has(u.id) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </span>
                </Td>
                <Td>
                  {u.storage_gb} GB · {u.color}
                  {u.battery_health !== null && <span className="text-subtle"> · batería {u.battery_health}%</span>}
                </Td>
                <Td>{CONDITION_LABEL[u.condition]}</Td>
                <Td className="text-right">{formatMXN(u.acquisition_cost)}</Td>
                <Td className="text-right">{formatMXN(u.sale_price)}</Td>
                <Td>
                  <UnitStatusBadge status={u.status} />
                </Td>
                <Td className="space-x-1 whitespace-nowrap text-right">
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ open: true, unit: u })}>
                    Editar
                  </Button>
                  {(u.status === 'available' || u.status === 'inactive') && (
                    <Button size="sm" variant="ghost" onClick={() => void onToggle(u)}>
                      {u.status === 'inactive' ? 'Activar' : 'Desactivar'}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <UnitFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        productId={productId}
        unit={dialog.unit}
      />
    </section>
  )
}
