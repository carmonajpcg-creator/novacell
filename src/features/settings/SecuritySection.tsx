import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Field, FormError } from '@/components/shared/Field'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  discardFactor,
  enrollTotp,
  fetchMfaStatus,
  listVerifiedFactors,
  removeFactor,
  setRequireMfa,
  totpCodeSchemaPattern,
  verifyTotp,
  type TotpEnrollment,
} from '@/features/auth/mfa'
import { client } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'

/** Verificación en dos pasos (TOTP). La exigencia la aplica la base de datos; esta pantalla solo la configura. */
export function SecuritySection() {
  const qc = useQueryClient()
  const factors = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: () => listVerifiedFactors(client()),
  })
  const status = useQuery({ queryKey: ['mfa-status'], queryFn: () => fetchMfaStatus(client()) })
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['mfa-factors'] }),
      qc.invalidateQueries({ queryKey: ['mfa-status'] }),
    ])

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeDbError(e))
    } finally {
      setBusy(false)
    }
  }

  if (factors.isPending || status.isPending) return <LoadingState label="Cargando seguridad…" />
  if (factors.isError || status.isError)
    return <ErrorState message="No se pudo cargar la configuración de seguridad." />

  const hasFactor = factors.data.length > 0
  const required = status.data.required

  return (
    <section aria-labelledby="seguridad-title">
      <Card className="space-y-4">
        <div>
          <h2 id="seguridad-title" className="text-lg font-semibold">
            Seguridad: verificación en dos pasos
          </h2>
          <p className="text-sm text-subtle">
            Además de la contraseña, el acceso pide un código de 6 dígitos de una app de
            autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).
          </p>
        </div>

        {!hasFactor && !enrollment && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => setEnrollment(await enrollTotp(client())))}
          >
            Configurar app de autenticación
          </Button>
        )}

        {enrollment && (
          <div className="space-y-3">
            <p className="text-sm">
              1. Escanea este código QR con tu app. 2. Escribe el código de 6 dígitos que muestra.
            </p>
            <img
              src={enrollment.qrCode}
              alt="Código QR para tu app de autenticación"
              className="size-44 rounded-xl border border-gray-200 bg-white p-2"
            />
            <p className="break-all text-xs text-subtle">
              ¿No puedes escanear? Clave manual:{' '}
              <span className="font-mono">{enrollment.secret}</span>
            </p>
            <Field id="mfa-enroll-code" label="Código de 6 dígitos">
              <Input
                id="mfa-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!totpCodeSchemaPattern.test(code))
                      throw new Error('Ingresa los 6 dígitos de tu app')
                    await verifyTotp(client(), enrollment.factorId, code)
                    setEnrollment(null)
                    setCode('')
                  })
                }
              >
                Verificar y activar
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void discardFactor(client(), enrollment.factorId)
                  setEnrollment(null)
                  setCode('')
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {hasFactor && (
          <div className="space-y-3">
            <p className="text-sm">
              App de autenticación registrada. Estado de la exigencia:{' '}
              <strong>
                {required ? 'obligatoria para operar el panel' : 'aún no obligatoria'}
              </strong>
              .
            </p>
            {!required ? (
              <div className="space-y-2">
                <p className="text-sm text-subtle">
                  Al exigirla, una sesión que solo tenga contraseña dejará de operar el panel.
                  Guarda la clave manual o respaldos de tu app antes de continuar: si pierdes el
                  dispositivo, la recuperación requiere acceso al proyecto de Supabase.
                </p>
                <Button
                  type="button"
                  disabled={busy || status.data.aal !== 'aal2'}
                  onClick={() => void run(() => setRequireMfa(client(), true))}
                >
                  Exigir verificación en dos pasos
                </Button>
                {status.data.aal !== 'aal2' && (
                  <p className="text-xs text-subtle">
                    Cierra sesión y vuelve a entrar con tu código para poder activar esta exigencia.
                  </p>
                )}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || status.data.aal !== 'aal2'}
                    onClick={() => {
                      const f = factors.data[0]
                      if (f && window.confirm('¿Quitar la app de autenticación?'))
                        void run(() => removeFactor(client(), f.id))
                    }}
                  >
                    Quitar app de autenticación
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => setRequireMfa(client(), false))}
                >
                  Dejar de exigirla
                </Button>
                <p className="text-xs text-subtle">
                  Para quitar la app primero deja de exigirla (así no puedes quedarte fuera por
                  accidente).
                </p>
              </div>
            )}
          </div>
        )}
        <FormError message={error} />
      </Card>
    </section>
  )
}
