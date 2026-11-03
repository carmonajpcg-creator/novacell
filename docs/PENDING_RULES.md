# Reglas comerciales propuestas, pendientes de aprobación

Estas reglas **no las definió el negocio**: son valores razonables propuestos por el desarrollo para poder construir
la Fase 3. Hasta que el propietario las apruebe o las cambie, son provisionales (CLAUDE.md §21: no inventar políticas).
Cada una indica dónde está implementada para poder ajustarla.

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| P1 | Una venta pendiente **reserva** el iPhone (no puede venderse a otro) y **descuenta** el stock de accesorios. Cancelar lo libera. | `create_sale`, `cancel_sale` | Pendiente |
| P2 | El **efectivo** se confirma al registrarlo. La **transferencia** queda pendiente hasta que el administrador verifica el depósito; exige clave de rastreo (≥ 4 caracteres). | `record_payment`, `confirm_payment` | Pendiente |
| P3 | La venta se **confirma sola** cuando los pagos confirmados suman exactamente el total. No se puede cobrar más que el total (cuentan pagos pendientes y confirmados). | `complete_sale_if_paid`, `record_payment` | Pendiente |
| P4 | El precio de cada línea parte del catálogo y **puede ajustarse** (descuento o precio negociado). Todo precio distinto al del catálogo queda en `audit_logs`. No hay precio mínimo. | `create_sale` | Pendiente (¿precio mínimo = costo? ¿motivo obligatorio?) |
| P5 | Solo se **cancelan** ventas pendientes sin pagos confirmados. Los pagos confirmados se **revierten** (conservando el registro) solo mientras la venta siga pendiente. **Cancelar o devolver una venta ya confirmada no está implementado** (bloqueado con error). | `cancel_sale`, `reverse_payment` | Pendiente: política de devoluciones y cancelaciones |
| P6 | Folio `V-000001`. El comprobante muestra el **IMEI completo** del equipo vendido y la leyenda "Comprobante de venta, no es factura fiscal". Sin datos fiscales del negocio. | Comprobante en la interfaz | Pendiente (datos fiscales, formato, ¿IMEI completo o parcial?) |
| P7 | Teléfono del cliente **opcional**, de 10 dígitos (México). Nombre obligatorio. | `customers` | Pendiente |
| P8 | El **costo histórico** de cada línea se copia al **crear** la venta (no al confirmarla). | `create_sale` | Pendiente (CLAUDE.md §7 dice "al confirmar"; hoy la diferencia es mínima) |
| P9 | Reservar o liberar un iPhone **no** genera movimiento de inventario; solo la salida definitiva al confirmar. En accesorios, el descuento sí genera movimiento al crear la venta. | `create_sale`, `complete_sale_if_paid` | Pendiente |
| P10 | Una venta confirmada no tiene pagos parciales en espera: confirmada = totalmente cobrada. Los **pagos combinados** (efectivo + transferencia) son varios pagos de una misma venta. | `record_payment` | Pendiente |

## Aún sin definir (no implementado a propósito)
- Garantías, devoluciones, retención de anticipos y cancelación de ventas confirmadas.
- Información fiscal del negocio y facturación.
- Costo y zonas de entrega (Fase 7).
- Intereses, recargos y reglas de aplicación de abonos (Fase 4).
