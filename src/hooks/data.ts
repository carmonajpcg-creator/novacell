import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Cliente de Supabase (solo anon key + sesión del usuario). Falla de forma clara si falta la configuración. */
export function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

/** Mutación que invalida las consultas indicadas al terminar con éxito. */
export function useInvalidatingMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  invalidate: readonly (readonly unknown[])[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  })
}
