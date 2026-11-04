import type { SupabaseClient } from '@supabase/supabase-js'

export const PUBLIC_KEYS = [
  'business_name',
  'whatsapp_number',
  'business_hours',
  'business_address',
  'delivery_info',
] as const
export type PublicKey = (typeof PUBLIC_KEYS)[number]
export const RULE_KEYS = ['layaway_min_down_percent', 'credit_allowed_frequencies'] as const

export type SettingsMap = Partial<Record<PublicKey, string>> & {
  layaway_min_down_percent?: number
  credit_allowed_frequencies?: string[]
}

interface Row {
  key: string
  value: unknown
}

export async function loadSettings(c: SupabaseClient): Promise<SettingsMap> {
  const { data, error } = await c
    .from('business_settings')
    .select('key,value')
    .in('key', [...PUBLIC_KEYS, ...RULE_KEYS])
  if (error) throw error
  const out: SettingsMap = {}
  for (const row of (data ?? []) as Row[]) {
    if ((PUBLIC_KEYS as readonly string[]).includes(row.key) && typeof row.value === 'string') {
      out[row.key as PublicKey] = row.value
    } else if (row.key === 'layaway_min_down_percent' && typeof row.value === 'number') {
      out.layaway_min_down_percent = row.value
    } else if (row.key === 'credit_allowed_frequencies' && Array.isArray(row.value)) {
      out.credit_allowed_frequencies = row.value.filter((v): v is string => typeof v === 'string')
    }
  }
  return out
}

/** Guarda un ajuste; un valor vacío (null) elimina la fila. Los datos del negocio son públicos; las reglas, privadas. */
export async function saveSetting(
  c: SupabaseClient,
  key: string,
  value: unknown,
  isPublic: boolean,
) {
  if (value === null) {
    const { error } = await c.from('business_settings').delete().eq('key', key)
    if (error) throw error
    return
  }
  const { error } = await c
    .from('business_settings')
    .upsert({ key, value, is_public: isPublic }, { onConflict: 'key' })
  if (error) throw error
}
