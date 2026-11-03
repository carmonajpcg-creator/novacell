import { formatMXN } from '@/lib/format'
import { readEnv } from '@/lib/env'

describe('formatMXN', () => {
  it('formatea importes en pesos mexicanos', () => {
    expect(formatMXN(12999.5)).toBe('$12,999.50')
  })
})

describe('readEnv', () => {
  it('devuelve null si faltan variables', () => {
    expect(readEnv({})).toBeNull()
  })
  it('rechaza una URL inválida', () => {
    expect(readEnv({ VITE_SUPABASE_URL: 'x', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull()
  })
  it('acepta configuración válida', () => {
    const env = readEnv({ VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })
    expect(env?.VITE_SUPABASE_ANON_KEY).toBe('k')
  })
})
