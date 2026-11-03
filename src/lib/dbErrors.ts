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
      if (text.includes('idempotencia')) return 'Esta operación ya se registró con otros datos. Recarga la página e inténtalo de nuevo.'
      if (text.includes('payments_transfer_ref')) return 'Esa clave de rastreo ya está registrada en otro pago vigente'
      if (text.includes('imei')) return 'Ya existe una unidad con ese IMEI'
      if (text.includes('serial')) return 'Ya existe una unidad con ese número de serie'
      if (text.includes('sku')) return 'Ya existe una variante con ese SKU'
      if (text.includes('slug')) return 'Ya existe un registro con ese nombre (identificador duplicado)'
      return 'Ya existe un registro con esos datos'
    case '23514':
      if (text.includes('existencias insuficientes')) return e.message ?? 'Existencias insuficientes'
      if (text.includes('imei')) return 'El IMEI no es válido'
      return e.message ?? 'Los datos no cumplen las reglas del sistema'
    case '22023':
      return e.message ?? 'Los datos enviados no son válidos'
    case '23503':
      return 'No se puede completar: el registro está relacionado con otros datos'
    case '0A000':
      return e.message ?? 'Esta operación requiere una política de negocio aún no aprobada'
    case '42501':
      return 'No tienes permisos para realizar esta acción'
    default:
      return 'No se pudo completar la operación. Intenta de nuevo.'
  }
}
