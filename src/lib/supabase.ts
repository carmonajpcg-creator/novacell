import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readEnv } from './env'

const env = readEnv()

/** Cliente con anon key únicamente. Nunca usar service_role en el navegador. */
export const supabase: SupabaseClient | null = env
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      // HashRouter usa el hash de la URL; evitamos que Auth lo interprete.
      auth: { detectSessionInUrl: false },
    })
  : null

export const isSupabaseConfigured = supabase !== null

