import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { describeDbError } from '@/lib/dbErrors'
import * as api from './api'
import { ImagesSection } from './components/ImagesSection'
import { UnitsSection } from './components/UnitsSection'
import { VariantsSection } from './components/VariantsSection'
import { client, keys, useInvalidatingMutation, useProduct } from './hooks'
import { productSchema, type ProductValues } from './schemas'
import { KIND_LABEL, type Product } from './types'

const editSchema = productSchema.pick({ name: true, description: true, is_published: true, is_active: true })
type EditValues = Pick<ProductValues, 'name' | 'description' | 'is_published' | 'is_active'>

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { data: product, isPending, isError, refetch } = useProduct(id)

  if (isPending) return <LoadingState label="Cargando producto…" />
  if (isError) return <ErrorState title="Producto no encontrado" onRetry={() => void refetch()} />

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/admin/productos" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-graphite">
          <ArrowLeft className="size-4" aria-hidden /> Productos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <Badge>{KIND_LABEL[product.kind]}</Badge>
          <Badge tone={product.is_active ? 'success' : 'neutral'}>{product.is_active ? 'Activo' : 'Inactivo'}</Badge>
        </div>
      </div>

      <ProductEditCard product={product} />
      {product.kind === 'iphone' ? <UnitsSection productId={product.id} /> : <VariantsSection productId={product.id} />}
      <ImagesSection productId={product.id} />
    </div>
  )
}

function ProductEditCard({ product }: { product: Product }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: product.name,
      description: product.description ?? '',
      is_published: product.is_published,
      is_active: product.is_active,
    },
  })
  const update = useInvalidatingMutation(
    (v: EditValues) => api.updateProduct(client(), product.id, v),
    [keys.products, keys.product(product.id)],
  )
  const remove = useInvalidatingMutation(() => api.deleteProduct(client(), product.id), [keys.products])

  async function onSubmit(values: EditValues) {
    setError(null)
    setSaved(false)
    try {
      await update.mutateAsync(values)
      setSaved(true)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  async function onDelete() {
    if (!window.confirm('¿Eliminar este producto? Solo es posible si no tiene unidades, variantes ni historial.')) return
    setError(null)
    try {
      await remove.mutateAsync()
      navigate('/admin/productos', { replace: true })
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field id="name" label="Nombre" error={errors.name?.message}>
          <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field id="description" label="Descripción" error={errors.description?.message} hint="Opcional">
          <Textarea id="description" {...register('description')} />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" {...register('is_active')} /> Activo
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" {...register('is_published')} /> Publicado en la tienda
          </label>
        </div>
        <FormError message={error} />
        {saved && (
          <p role="status" className="text-sm text-success">
            Cambios guardados
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => void onDelete()}>
            Eliminar producto
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
