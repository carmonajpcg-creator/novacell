import { useRef, useState } from 'react'
import { ImagePlus, Star, Trash2 } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'
import { FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { describeDbError } from '@/lib/dbErrors'
import * as api from '../api'
import { client, keys, useImages, useInvalidatingMutation } from '../hooks'
import type { ProductImage } from '../types'

export function ImagesSection({ productId }: { productId: string }) {
  const { data, isPending, isError, refetch } = useImages(productId)
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useInvalidatingMutation(
    (file: File) => api.uploadImage(client(), productId, file, (data ?? []).every((i) => !i.is_primary)),
    [keys.images(productId)],
  )
  const remove = useInvalidatingMutation((img: ProductImage) => api.deleteImage(client(), img), [keys.images(productId)])
  const primary = useInvalidatingMutation(
    (img: ProductImage) => api.setPrimaryImage(client(), productId, img.id),
    [keys.images(productId)],
  )

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeDbError(e))
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      const problem = api.validateImageFile(file)
      if (problem) {
        setError(`${file.name}: ${problem}`)
        continue
      }
      await run(() => upload.mutateAsync(file))
    }
    if (input.current) input.current.value = ''
  }

  return (
    <section className="space-y-4" aria-label="Fotografías">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Fotografías</h2>
        <Button variant="secondary" disabled={upload.isPending} onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" aria-hidden /> {upload.isPending ? 'Subiendo…' : 'Subir fotos'}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          aria-label="Seleccionar fotografías"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      <p className="text-xs text-subtle">JPG, PNG o WebP de hasta 5 MB. Usa fotografías reales del producto.</p>
      <FormError message={error} />
      {isPending ? (
        <LoadingState label="Cargando fotografías…" />
      ) : isError ? (
        <ErrorState message="No se pudieron cargar las fotografías." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="Sin fotografías" description="Sube al menos una foto real del producto." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((img) => (
            <li key={img.id} className="overflow-hidden rounded-card border border-gray-200 bg-surface">
              <img
                src={api.imageUrl(client(), img.storage_path)}
                alt={img.alt_text ?? 'Fotografía del producto'}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              <div className="flex items-center justify-between gap-1 p-2">
                {img.is_primary ? (
                  <Badge tone="brand">Principal</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => primary.mutateAsync(img))}>
                    <Star className="size-4" aria-hidden /> Principal
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Eliminar fotografía"
                  onClick={() => {
                    if (window.confirm('¿Eliminar esta fotografía?')) void run(() => remove.mutateAsync(img))
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
