import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, Td, Th } from '@/components/ui/table'
import { CustomerFormDialog } from './CustomerFormDialog'
import { useCustomers } from './hooks'
import { CONTACT_METHOD_LABEL, SOURCE_LABEL } from './types'

export function CustomersPage() {
  const { data, isPending, isError, refetch } = useCustomers()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter((c) => q === '' || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q))
  }, [data, query])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nuevo cliente
        </Button>
      </div>
      <Input
        className="max-w-xs"
        placeholder="Buscar por nombre o teléfono"
        aria-label="Buscar clientes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {isPending ? (
        <LoadingState label="Cargando clientes…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los clientes." onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? 'Sin resultados' : 'Aún no hay clientes'}
          description={query ? 'Prueba con otro nombre o teléfono.' : 'Registra a tu primer cliente.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Teléfono</Th>
              <Th>Contacto</Th>
              <Th>Origen</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">
                  <Link className="text-brand hover:underline" to={`/admin/clientes/${c.id}`}>
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.phone ?? '—'}</Td>
                <Td>{CONTACT_METHOD_LABEL[c.contact_method]}</Td>
                <Td>{SOURCE_LABEL[c.acquisition_source]}</Td>
                <Td>
                  <Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Activo' : 'Inactivo'}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <CustomerFormDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
