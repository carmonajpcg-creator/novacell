import { useEffect, useState } from 'react'
import { Field, FormError } from '@/components/shared/Field'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthContext'
import { listVerifiedFactors, totpCodeSchemaPattern, verifyTotp } from './mfa'

/** Segundo paso del inicio de sesión: código de 6 dígitos de la app de autenticación. */
export function MfaChallenge() {
  const { signOut } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void listVerifiedFactors(supabase)
      .then((f) => setFactorId(f[0]?.id ?? null))
      .catch(() => setError('No se pudo cargar tu factor de autenticación'))
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase || !factorId) return
    if (!totpCodeSchemaPattern.test(code)) {
      setError('Ingresa los 6 dígitos de tu app')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await verifyTotp(supabase, factorId, code)
      // AuthProvider detecta el cambio de nivel (aal2) por onAuthStateChange.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Wordmark className="text-2xl" />
          <h1 className="text-sm text-subtle">Verificación en dos pasos</h1>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <Field
            id="mfa-code"
            label="Código de tu app de autenticación"
            hint="6 dígitos; cambia cada 30 segundos"
          >
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy || !factorId}>
            {busy ? 'Verificando…' : 'Verificar'}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
            Cerrar sesión
          </Button>
        </form>
      </Card>
    </main>
  )
}
