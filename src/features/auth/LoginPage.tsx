import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Wordmark } from '@/components/shared/Wordmark'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from './AuthContext'
import { loginSchema, type LoginValues } from './schema'

export function LoginPage() {
  const { signIn, signOut, isAdmin, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const denied = (location.state as { denied?: boolean } | null)?.denied === true
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  if ((status === 'authenticated' && isAdmin) || status === 'mfa_required')
    return <Navigate to="/admin" replace />

  async function onSubmit(values: LoginValues) {
    setError(null)
    try {
      await signIn(values.email, values.password)
      navigate('/admin', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <Wordmark className="text-2xl" />
          <h1 className="text-sm text-subtle">Acceso administrativo</h1>
        </div>

        {!isSupabaseConfigured && (
          <p role="alert" className="rounded-xl bg-muted p-3 text-sm">
            Falta configurar Supabase (ver .env.example).
          </p>
        )}
        {denied && (
          <p role="alert" className="text-sm text-danger">
            Esta cuenta no tiene permisos de administrador.{' '}
            <button type="button" className="underline" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            {errors.email && <p className="text-sm text-danger">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && <p className="text-sm text-danger">{errors.password.message}</p>}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting || !isSupabaseConfigured}>
            {isSubmitting ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
