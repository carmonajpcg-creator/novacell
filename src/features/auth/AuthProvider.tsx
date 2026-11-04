import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchRole, signInWithPassword, signOut as apiSignOut, type UserRole } from './api'
import { AuthContext, type AuthState } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthState['status']>(supabase ? 'loading' : 'anonymous')
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let cancelled = false

    async function apply(next: Session | null) {
      if (cancelled) return
      setSession(next)
      if (!next) {
        queryClient.clear()
        setRole(null)
        setStatus('anonymous')
        return
      }
      try {
        const r = await fetchRole(client, next.user.id)
        if (cancelled) return
        setRole(r)
        setStatus('authenticated')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    void client.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      // Diferido para no bloquear el cliente de Auth con llamadas dentro del callback.
      setTimeout(() => void apply(next), 0)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase no está configurado')
    await signInWithPassword(supabase, email, password)
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await apiSignOut(supabase)
    // Los datos privados no deben quedar en memoria de la pestaña tras cerrar sesión.
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<AuthState>(
    () => ({
      status,
      role,
      email: session?.user.email ?? null,
      isAdmin: role === 'admin',
      signIn,
      signOut,
    }),
    [status, role, session, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
