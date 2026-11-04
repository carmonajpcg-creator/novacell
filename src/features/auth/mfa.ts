import type { SupabaseClient } from '@supabase/supabase-js'

/** Segundo factor (TOTP) con Supabase Auth. La exigencia real la impone la base de datos (is_admin + aal2). */
export interface TotpFactor {
  id: string
  friendlyName: string | null
}

export interface TotpEnrollment {
  factorId: string
  qrCode: string
  secret: string
}

export async function needsMfaChallenge(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return data.currentLevel !== 'aal2' && data.nextLevel === 'aal2'
}

export async function listVerifiedFactors(client: SupabaseClient): Promise<TotpFactor[]> {
  const { data, error } = await client.auth.mfa.listFactors()
  if (error) throw error
  return data.totp
    .filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null }))
}

export async function enrollTotp(client: SupabaseClient): Promise<TotpEnrollment> {
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `NovaCell ${new Date().toISOString().slice(0, 10)}`,
  })
  if (error) throw error
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

export async function verifyTotp(
  client: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw new Error('Código incorrecto o vencido')
}

/** Cancela un registro que nunca se verificó (p. ej. el usuario cerró el diálogo). */
export async function discardFactor(client: SupabaseClient, factorId: string): Promise<void> {
  await client.auth.mfa.unenroll({ factorId })
}

export async function removeFactor(client: SupabaseClient, factorId: string): Promise<void> {
  const { error } = await client.auth.mfa.unenroll({ factorId })
  if (error) throw error
}

export interface MfaStatus {
  required: boolean
  aal: 'aal1' | 'aal2'
}

export async function fetchMfaStatus(client: SupabaseClient): Promise<MfaStatus> {
  const { data, error } = await client.rpc('mfa_status')
  if (error) throw error
  return data as MfaStatus
}

export async function setRequireMfa(client: SupabaseClient, enabled: boolean): Promise<void> {
  const { error } = await client.rpc('set_require_mfa', { p_enabled: enabled })
  if (error) throw error
}

export const totpCodeSchemaPattern = /^\d{6}$/
