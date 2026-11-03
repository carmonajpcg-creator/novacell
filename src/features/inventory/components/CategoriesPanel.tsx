import { useState } from 'react'
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
import { describeDbError } from '@/lib/dbErrors'
import * as api from '../api'
import { client, keys, useCategories, useInvalidatingMutation } from '../hooks'
import { categorySchema, type CategoryValues } from '../schemas'
import { KIND_LABEL } from '../types'

export function CategoriesPanel() {
  const { data, isPending, isError, refetch } = useCategories()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = useInvalidatingMutation(
    ({ id, is_active }: { id: string; is_active: boolean }) => api.updateCategory(client(), id, { is_active }),
    [keys.categories],
  )
  const remove = useInvalidatingMutation((id: string) => api.deleteCategory(client(), id), [keys.categories])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <section className="space-y-4" aria-label="Categorías">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nueva categoría
        </Button>
      </div>
      <FormError message={error} />
      {isPending ? (
        <LoadingState label="Cargando categorías…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las categorías." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="Aún no hay categorías" description="Crea una categoría para organizar tus productos." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Tipo</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>{KIND_LABEL[c.kind]}</Td>
                <Td>
                  <Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Activa' : 'Inactiva'}</Badge>
                </Td>
                <Td className="space-x-1 text-right">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void run(() => toggle.mutateAsync({ id: c.id, is_active: !c.is_active }))}
                  >
                    {c.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Eliminar ${c.name}`}
                    onClick={() => {
                      if (window.confirm(`¿Eliminar la categoría "${c.name}"? Solo es posible si no tiene productos.`))
                        void run(() => remove.mutateAsync(c.id))
                    }}
                  >
                    Eliminar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title="Nueva categoría">
            <CategoryForm onDone={() => setOpen(false)} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}

function CategoryForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CategoryValues>({ resolver: zodResolver(categorySchema), defaultValues: { name: '', kind: 'iphone' } })
  const create = useInvalidatingMutation((v: CategoryValues) => api.createCategory(client(), v), [keys.categories])

  async function onSubmit(values: CategoryValues) {
    setError(null)
    try {
      await create.mutateAsync(values)
      onDone()
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="cat-name" label="Nombre" error={errors.name?.message}>
        <Input id="cat-name" aria-invalid={!!errors.name} {...register('name')} />
      </Field>
      <Field id="cat-kind" label="Tipo">
        <Select id="cat-kind" {...register('kind')}>
          <option value="iphone">iPhone</option>
          <option value="accessory">Accesorio</option>
        </Select>
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Crear'}
        </Button>
      </div>
    </form>
  )
}
