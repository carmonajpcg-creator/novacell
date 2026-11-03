import { MapPin, MessageCircle, Clock, Truck } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { useBusinessInfo } from './hooks'

export function ContactPage() {
  const info = useBusinessInfo()

  if (info.isPending) return <LoadingState label="Cargando información…" />
  if (info.isError) return <ErrorState message="No pudimos cargar la información de contacto." onRetry={() => void info.refetch()} />

  const d = info.data
  const wa = buildWhatsAppUrl(d.whatsapp_number, 'Hola, quisiera más información.')
  const empty = !d.whatsapp_number && !d.business_hours && !d.business_address && !d.delivery_info

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Contacto y entregas</h1>
        <p className="text-subtle">Escríbenos y te ayudamos a elegir.</p>
      </header>

      {empty ? (
        <Card className="text-subtle">Estamos preparando nuestra información de contacto. Vuelve pronto.</Card>
      ) : (
        <div className="space-y-4">
          {wa && (
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <MessageCircle className="size-6 text-brand" aria-hidden />
                <div>
                  <p className="font-medium">WhatsApp</p>
                  <p className="text-sm text-subtle">Respuesta directa con precio y disponibilidad.</p>
                </div>
              </div>
              <Button asChild>
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  Escribir por WhatsApp
                </a>
              </Button>
            </Card>
          )}
          {d.business_hours && (
            <Card className="flex gap-3">
              <Clock className="size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="font-medium">Horario de atención</p>
                <p className="whitespace-pre-line text-sm text-subtle">{d.business_hours}</p>
              </div>
            </Card>
          )}
          {d.business_address && (
            <Card className="flex gap-3">
              <MapPin className="size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="font-medium">Ubicación</p>
                <p className="whitespace-pre-line text-sm text-subtle">{d.business_address}</p>
              </div>
            </Card>
          )}
          {d.delivery_info && (
            <Card className="flex gap-3">
              <Truck className="size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="font-medium">Entregas</p>
                <p className="whitespace-pre-line text-sm text-subtle">{d.delivery_info}</p>
              </div>
            </Card>
          )}
        </div>
      )}

      <p className="text-xs text-subtle">
        Los pedidos se confirman por WhatsApp. Por ahora no cobramos en línea.
      </p>
    </div>
  )
}
