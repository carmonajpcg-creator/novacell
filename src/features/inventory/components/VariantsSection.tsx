import { useState } from 'react'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, Td, Th } from '@/components/ui/table'
import { formatMXN } from '@/lib/format'
import { useVariants } from '../hooks'
import type { ProductVariant } from '../types'
import { StockDialog } from './StockDialog'
import { VariantFormDialog } from './VariantFormDialog'

export function VariantsSection({ productId }: { productId: string }) {
  const { data, isPending, isError, refetch } = useVariants(productId)
  const [form, setForm] = useState<{ open: boolean; variant?: ProductVariant }>({ open: false })
  const [stockFor, setStockFor] = useState<ProductVariant | null>(null)

  return (
    <section className="space-y-4" aria-label="Variantes">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Variantes</h2>
        <Button onClick={() => setForm({ open: true })}>
          <Plus className="size-4" aria-hidden /> Nueva variante
        </Button>
      </div>
      {isPending ? (
        <LoadingState label="Cargando variantes…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las variantes." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="Sin variantes" description="Agrega variantes por color o modelo compatible, cada una con su SKU." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Color</Th>
              <Th>Compatible con</Th>
              <Th className="text-right">Costo</Th>
              <Th className="text-right">Precio</Th>
              <Th className="text-right">Existencias</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr key={v.id}>
                <Td className="font-mono text-xs">{v.sku}</Td>
                <Td>{v.color ?? '—'}</Td>
                <Td>{v.compatible_model ?? '—'}</Td>
                <Td className="text-right">{formatMXN(v.cost)}</Td>
                <Td className="text-right">{formatMXN(v.price)}</Td>
                <Td className="text-right font-medium">{v.stock_quantity}</Td>
                <Td>
                  <Badge tone={v.is_active ? 'success' : 'neutral'}>{v.is_active ? 'Activa' : 'Inactiva'}</Badge>
                </Td>
                <Td className="space-x-1 whitespace-nowrap text-right">
                  <Button size="sm" variant="secondary" onClick={() => setStockFor(v)}>
                    Mover stock
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, variant: v })}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <VariantFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        productId={productId}
        variant={form.variant}
      />
      <StockDialog variant={stockFor} onOpenChange={(open) => !open && setStockFor(null)} />
    </section>
  )
}
