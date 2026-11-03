const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

/** Formatea un importe como MXN. Solo para mostrar: el cálculo financiero vive en el backend. */
export function formatMXN(amount: number): string {
  return mxn.format(amount)
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(date)
}
