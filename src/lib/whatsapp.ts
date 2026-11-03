/** Quita espacios, guiones y paréntesis; acepta un prefijo +52 / 52. Devuelve 10 dígitos o null. */
export function normalizeMxPhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('52') ? digits.slice(2) : digits
  return /^\d{10}$/.test(local) ? local : null
}

/**
 * Enlace `wa.me` con el mensaje preparado (lada de México +52). Solo ABRE la conversación: no envía nada.
 * Devuelve null si el cliente no tiene un teléfono válido.
 */
export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const local = normalizeMxPhone(phone)
  if (!local) return null
  return `https://wa.me/52${local}?text=${encodeURIComponent(message)}`
}
