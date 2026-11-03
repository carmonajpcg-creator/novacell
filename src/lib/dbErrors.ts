interface PgLikeError {
  code?: string
  message?: string
  details?: string
}

/** Traduce errores de PostgREST/Postgres a mensajes comprensibles en español. */
export function describeDbError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError
  const text = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase()
  switch (e.code) {
    case '23505':
      if (text.includes('imei')) return 'Ya existe una unidad con ese IMEI'
      if (text.includes('serial')) return 'Ya existe una unidad con ese número de serie'
      if (text.includes('sku')) return 'Ya existe una variante con ese SKU'
      if (text.includes('slug')) return 'Ya existe un registro con ese nombre (identificador duplicado)'
      return 'Ya existe un registro con esos datos'
    case '23514':
      if (text.includes('existencias insuficientes')) return 'Existencias insuficientes'
      if (text.includes('imei')) return 'El IMEI no es válido'
      return e.message ?? 'Los datos no cumplen las reglas del sistema'
    case '23503':
      return 'No se puede completar: el registro está relacionado con otros datos'
    case '42501':
      return 'No tienes permisos para realizar esta acción'
    default:
      return 'No se pudo completar la operación. Intenta de nuevo.'
  }
}
