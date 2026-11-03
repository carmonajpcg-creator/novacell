import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, Td, Th } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { describeDbError } from '@/lib/dbErrors'
import * as api from './api'
import { CategoriesPanel } from './components/CategoriesPanel'
import { client, keys, useCategories, useInvalidatingMutation, useProducts } from './hooks'
import { productSchema, type ProductValues } from './schemas'
import { KIND_LABEL } from './types'

type View = 'products' | 'categories'

export function ProductsPage() {
  const [view, setView] = useState<View>('products')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
        <Tabs
          label="Vista"
          value={view}
          onChange={setView}
          items={[
            { value: 'products', label: 'Productos' },
            { value: 'categories', label: 'Categorías' },
          ]}
        />
      </div>
      {view === 'products' ? <ProductsList /> : <CategoriesPanel />}
    </div>
  )
}

function ProductsList() {
  const { data, isPending, isError, refetch } = useProducts()
  const [open, setOpen] = useState(false)

  return (
    <section className="space-y-4" aria-label="Productos">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nuevo producto
        </Button>
      </div>
      {isPending ? (
        <LoadingState label="Cargando productos…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los productos." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="Aún no hay productos"
          description="Crea una categoría y después tu primer producto."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>Tipo</Th>
              <Th>Categoría</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">
                  <Link className="text-brand hover:underline" to={`/admin/productos/${p.id}`}>
                    {p.name}
                  </Link>
                </Td>
                <Td>{KIND_LABEL[p.kind]}</Td>
                <Td>{p.category?.name ?? '—'}</Td>
                <Td className="space-x-1">
                  <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Activo' : 'Inactivo'}</Badge>
                  <Badge tone={p.is_published ? 'brand' : 'neutral'}>{p.is_published ? 'Publicado' : 'Borrador'}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title="Nuevo producto" description="Un iPhone se crea por modelo; las unidades se registran después.">
            <ProductForm onDone={() => setOpen(false)} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}

function ProductForm({ onDone }: { onDone: () => void }) {
  const categories = useCategories()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: '', category_id: '', description: '', is_published: false, is_active: true },
  })
  const create = useInvalidatingMutation(
    (v: ProductValues) => {
      const kind = categories.data?.find((c) => c.id === v.category_id)?.kind
      if (!kind) throw new Error('Selecciona una categoría')
      return api.createProduct(client(), v, kind)
    },
    [keys.products],
  )

  async function onSubmit(values: ProductValues) {
    setError(null)
    try {
      await create.mutateAsync(values)
      onDone()
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeDbError(e))
    }
  }

  const activeCategories = (categories.data ?? []).filter((c) => c.is_active)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="p-name" label="Nombre" error={errors.name?.message}>
        <Input id="p-name" placeholder="iPhone 15 Pro" aria-invalid={!!errors.name} {...register('name')} />
      </Field>
      <Field id="p-cat" label="Categoría" error={errors.category_id?.message} hint={activeCategories.length === 0 ? 'Primero crea una categoría activa' : undefined}>
        <Select id="p-cat" aria-invalid={!!errors.category_id} {...register('category_id')}>
          <option value="">Selecciona…</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({KIND_LABEL[c.kind]})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="p-desc" label="Descripción" error={errors.description?.message} hint="Opcional">
        <Textarea id="p-desc" {...register('description')} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register('is_published')} /> Publicar en la tienda (disponible desde la Fase 6)
      </label>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Crear producto'}
        </Button>
      </div>
    </form>
  )
}
