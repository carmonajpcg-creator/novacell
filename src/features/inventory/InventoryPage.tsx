import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { formatDate, formatMXN } from '@/lib/format'
import { maskImei } from '@/lib/imei'
import { UnitStatusBadge } from './components/UnitsSection'
import { useMovements, useProducts, useUnits } from './hooks'
import { CONDITION_LABEL, MOVEMENT_LABEL, type UnitStatus } from './types'

type View = 'iphone' | 'accessories' | 'movements'

export function InventoryPage() {
  const [view, setView] = useState<View>('iphone')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
        <Tabs
          label="Vista"
          value={view}
          onChange={setView}
          items={[
            { value: 'iphone', label: 'iPhone' },
            { value: 'accessories', label: 'Accesorios' },
            { value: 'movements', label: 'Movimientos' },
          ]}
        />
      </div>
      {view === 'iphone' && <UnitsOverview />}
      {view === 'accessories' && <AccessoriesOverview />}
      {view === 'movements' && <MovementsOverview />}
    </div>
  )
}

function UnitsOverview() {
  const { data, isPending, isError, refetch } = useUnits()
  const [status, setStatus] = useState<UnitStatus | 'all'>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter(
      (u) =>
        (status === 'all' || u.status === status) &&
        (q === '' ||
          u.imei.includes(q) ||
          u.internal_code.toLowerCase().includes(q) ||
          (u.product?.name ?? '').toLowerCase().includes(q)),
    )
  }, [data, status, query])

  if (isPending) return <LoadingState label="Cargando unidades…" />
  if (isError) return <ErrorState message="No se pudo cargar el inventario." onRetry={() => void refetch()} />

  return (
    <section className="space-y-4" aria-label="Unidades iPhone">
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por IMEI, código o modelo"
          aria-label="Buscar unidades"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select className="max-w-[12rem]" aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value as UnitStatus | 'all')}>
          <option value="all">Todos los estados</option>
          <option value="available">Disponible</option>
          <option value="reserved">Reservada</option>
          <option value="sold">Vendida</option>
          <option value="inactive">Inactiva</option>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="Sin unidades" description="Registra iPhone desde la ficha de cada producto." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Modelo</Th>
              <Th>IMEI</Th>
              <Th>Equipo</Th>
              <Th>Condición</Th>
              <Th className="text-right">Precio</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <Td className="font-mono text-xs">{u.internal_code}</Td>
                <Td>
                  <Link className="text-brand hover:underline" to={`/admin/productos/${u.product_id}`}>
                    {u.product?.name ?? '—'}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{maskImei(u.imei)}</Td>
                <Td>
                  {u.storage_gb} GB · {u.color}
                </Td>
                <Td>{CONDITION_LABEL[u.condition]}</Td>
                <Td className="text-right">{formatMXN(u.sale_price)}</Td>
                <Td>
                  <UnitStatusBadge status={u.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

function AccessoriesOverview() {
  const products = useProducts()
  const accessories = (products.data ?? []).filter((p) => p.kind === 'accessory')

  if (products.isPending) return <LoadingState label="Cargando accesorios…" />
  if (products.isError) return <ErrorState message="No se pudo cargar el inventario." onRetry={() => void products.refetch()} />
  if (accessories.length === 0)
    return <EmptyState title="Sin accesorios" description="Crea un producto de tipo accesorio y agrega sus variantes." />

  return (
    <Table>
      <thead>
        <tr>
          <Th>Accesorio</Th>
          <Th>Categoría</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {accessories.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link className="text-brand hover:underline" to={`/admin/productos/${p.id}`}>
                {p.name}
              </Link>
            </Td>
            <Td>{p.category?.name ?? '—'}</Td>
            <Td>
              <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Activo' : 'Inactivo'}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function MovementsOverview() {
  const { data, isPending, isError, refetch } = useMovements()
  if (isPending) return <LoadingState label="Cargando movimientos…" />
  if (isError) return <ErrorState message="No se pudo cargar el historial." onRetry={() => void refetch()} />
  if (data.length === 0)
    return <EmptyState title="Sin movimientos" description="Aquí aparecerá cada entrada, salida y ajuste de inventario." />

  return (
    <Table>
      <thead>
        <tr>
          <Th>Fecha</Th>
          <Th>Tipo</Th>
          <Th>Producto</Th>
          <Th className="text-right">Cantidad</Th>
          <Th className="text-right">Existencias</Th>
          <Th>Motivo</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap">{formatDate(m.created_at)}</Td>
            <Td>{MOVEMENT_LABEL[m.movement_type]}</Td>
            <Td>
              {m.unit ? `${m.unit.product?.name ?? ''} · ${m.unit.internal_code}` : `${m.variant?.product?.name ?? ''} · ${m.variant?.sku ?? ''}`}
            </Td>
            <Td className="text-right font-medium">{m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}</Td>
            <Td className="text-right">{m.stock_after ?? '—'}</Td>
            <Td>{m.reason ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
