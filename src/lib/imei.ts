/** IMEI válido: 15 dígitos con dígito verificador (algoritmo de Luhn). Debe coincidir con public.is_valid_imei(). */
export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false
  let total = 0
  let double = false
  for (let i = value.length - 1; i >= 0; i--) {
    let digit = Number(value[i])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    total += digit
    double = !double
  }
  return total % 10 === 0
}

/** Oculta el IMEI salvo los últimos 4 dígitos. */
export function maskImei(value: string): string {
  return value.length <= 4 ? value : `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
}
