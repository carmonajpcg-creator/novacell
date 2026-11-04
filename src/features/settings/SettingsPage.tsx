import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { client } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { SecuritySection } from './SecuritySection'
import { loadSettings, PUBLIC_KEYS, saveSetting, type SettingsMap } from './api'

const optionalText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`)

export const settingsSchema = z.object({
  business_name: optionalText(80),
  whatsapp_number: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d{10}$/.test(v.replace(/[\s\-().]/g, '')),
      'Ingresa 10 dígitos (sin lada internacional)',
    ),
  business_hours: optionalText(600),
  business_address: optionalText(600),
  delivery_info: optionalText(600),
  layaway_min_down_percent: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100),
      'Debe ser un porcentaje de 0 a 100',
    ),
  freq_weekly: z.boolean(),
  freq_biweekly: z.boolean(),
  freq_monthly: z.boolean(),
})
export type SettingsValues = z.infer<typeof settingsSchema>

const ALL_FREQUENCIES = ['weekly', 'biweekly', 'monthly']

function toForm(s: SettingsMap): SettingsValues {
  const freqs = s.credit_allowed_frequencies ?? ALL_FREQUENCIES
  return {
    business_name: s.business_name ?? '',
    whatsapp_number: s.whatsapp_number ?? '',
    business_hours: s.business_hours ?? '',
    business_address: s.business_address ?? '',
    delivery_info: s.delivery_info ?? '',
    layaway_min_down_percent:
      s.layaway_min_down_percent === undefined ? '' : String(s.layaway_min_down_percent),
    freq_weekly: freqs.includes('weekly'),
    freq_biweekly: freqs.includes('biweekly'),
    freq_monthly: freqs.includes('monthly'),
  }
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: () => loadSettings(client()) })
  if (query.isPending) return <LoadingState label="Cargando configuración…" />
  if (query.isError)
    return (
      <ErrorState
        message="No se pudo cargar la configuración."
        onRetry={() => void query.refetch()}
      />
    )
  return <SettingsForm initial={toForm(query.data)} />
}

function SettingsForm({ initial }: { initial: SettingsValues }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: initial })

  async function onSubmit(v: SettingsValues) {
    setError(null)
    setSaved(false)
    const freqs = ALL_FREQUENCIES.filter((f) => v[`freq_${f}` as 'freq_weekly'])
    if (freqs.length === 0) {
      setError('Habilita al menos una frecuencia de pago para créditos')
      return
    }
    const c = client()
    try {
      for (const key of PUBLIC_KEYS) {
        const raw = v[key].trim()
        const value = key === 'whatsapp_number' ? raw.replace(/[\s\-().]/g, '') : raw
        await saveSetting(c, key, value === '' ? null : value, true)
      }
      const pct = v.layaway_min_down_percent.trim()
      await saveSetting(c, 'layaway_min_down_percent', pct === '' ? null : Number(pct), false)
      await saveSetting(
        c,
        'credit_allowed_frequencies',
        freqs.length === ALL_FREQUENCIES.length ? null : freqs,
        false,
      )
      await qc.invalidateQueries({ queryKey: ['settings'] })
      await qc.invalidateQueries({ queryKey: ['public-business-info'] })
      setSaved(true)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Datos del negocio (públicos)</h2>
            <p className="text-sm text-subtle">
              Se muestran en la tienda. Déjalos vacíos si aún no están definidos: no se inventan
              tarifas, zonas ni horarios.
            </p>
          </div>
          <Field id="s-name" label="Nombre del negocio" error={errors.business_name?.message}>
            <Input id="s-name" {...register('business_name')} />
          </Field>
          <Field
            id="s-wa"
            label="WhatsApp del negocio"
            error={errors.whatsapp_number?.message}
            hint="10 dígitos. A él llegan los pedidos del carrito."
          >
            <Input id="s-wa" inputMode="tel" {...register('whatsapp_number')} />
          </Field>
          <Field id="s-hours" label="Horario de atención" error={errors.business_hours?.message}>
            <Textarea id="s-hours" {...register('business_hours')} />
          </Field>
          <Field id="s-address" label="Ubicación" error={errors.business_address?.message}>
            <Textarea id="s-address" {...register('business_address')} />
          </Field>
          <Field
            id="s-delivery"
            label="Información de entregas"
            error={errors.delivery_info?.message}
            hint="Texto libre. No se muestran tarifas ni zonas si no las escribes tú."
          >
            <Textarea id="s-delivery" {...register('delivery_info')} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Reglas comerciales (privadas)</h2>
            <p className="text-sm text-subtle">
              Ajustes que usan los apartados y los créditos. Las políticas definitivas están
              pendientes de aprobación.
            </p>
          </div>
          <Field
            id="s-minpct"
            label="Anticipo mínimo de un apartado (%)"
            error={errors.layaway_min_down_percent?.message}
            hint="Vacío: solo se exige que el anticipo sea mayor a cero."
          >
            <Input id="s-minpct" inputMode="decimal" {...register('layaway_min_down_percent')} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Frecuencias de pago habilitadas para créditos
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...register('freq_weekly')} /> Semanal
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...register('freq_biweekly')} /> Quincenal
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...register('freq_monthly')} /> Mensual
            </label>
          </fieldset>
        </Card>

        <FormError message={error} />
        {saved && (
          <p role="status" className="text-sm text-success">
            Configuración guardada
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar configuración'}
          </Button>
        </div>
      </form>
      <SecuritySection />
    </div>
  )
}
