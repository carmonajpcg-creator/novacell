import type { SupabaseClient } from '@supabase/supabase-js'

export type UserRole = 'admin' | 'employee'

export async function signInWithPassword(client: SupabaseClient, email: string, password: string) {
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Correo o contraseña incorrectos')
}

export async function signOut(client: SupabaseClient) {
  const { error } = await client.auth.signOut()
  if (error) throw error
}

/** El rol se lee de la base de datos (protegida por RLS); la UI no es la barrera de seguridad. */
export async function fetchRole(client: SupabaseClient, userId: string): Promise<UserRole | null> {
  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data?.role as UserRole | undefined) ?? null
}
