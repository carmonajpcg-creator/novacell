import { z } from 'zod'

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
})

export type AppEnv = z.infer<typeof schema>

/** Devuelve la configuración válida o null si faltan variables (la app muestra un aviso). */
export function readEnv(raw: Record<string, unknown> = import.meta.env): AppEnv | null {
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
