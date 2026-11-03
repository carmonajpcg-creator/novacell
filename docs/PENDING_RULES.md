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

## Fase 4 — Créditos (propuestas C1 a C12, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| C1 | El **precio final financiado** lo fija el negocio a mano y puede ser distinto a la suma de las líneas (las líneas conservan precio de referencia y costo histórico). | `create_credit_sale` | Pendiente (¿cómo se presenta en comprobantes y márgenes?) |
| C2 | **Sin intereses ni recargos automáticos.** | todo el módulo | Pendiente (CLAUDE.md §10) |
| C3 | Cuotas **iguales en centavos**; el residuo va a la **última** cuota. Cuota mínima 0.01. | `create_credit_sale` | Pendiente |
| C4 | Frecuencias semanal, quincenal y mensual, configurables con la clave `credit_allowed_frequencies` de `business_settings` (aún sin pantalla). Límites técnicos, no políticas: de 1 a 260 cuotas y primera fecha entre hoy y un año. **No hay plazo máximo comercial definido.** | `create_credit_sale` | Pendiente (plazos y frecuencias definitivos) |
| C5 | El **enganche** reduce el monto financiado. El crédito pasa a *activo* (iPhone vendido) cuando el enganche confirmado cubre lo pactado. Mientras tanto el iPhone queda **reservado sin límite de tiempo**. | `activate_credit_if_ready` | Pendiente (¿plazo máximo de reserva?) |
| C6 | El **calendario se fija al crear** el crédito (condiciones originales pactadas). Si el enganche tarda, las cuotas pueden vencer antes de activarse. | `create_credit_sale` | Pendiente (¿calendario desde la activación?) |
| C7 | Los **abonos** se aplican a la **cuota más antigua primero**; se permiten parciales y anticipados; un abono no puede exceder el saldo (los pendientes cuentan para el tope). | `allocate_payment` | Pendiente (CLAUDE.md §10: definir y probar antes de activar) |
| C8 | Un pago **pendiente de verificación no baja el saldo**. | `confirm_payment` | Pendiente |
| C9 | Una cuota está **vencida** cuando tiene saldo y su fecha es anterior a hoy (hora de Ciudad de México). Sin días de gracia. | vista `installment_status` | Pendiente |
| C10 | El crédito se **liquida solo** al cubrir todas las cuotas. Sin descuento por pago anticipado. | `allocate_payment` | Pendiente |
| C11 | Un abono confirmado se puede **revertir** (se conserva el registro y sus aplicaciones; reabre un crédito liquidado). No se vuelven a repartir los abonos posteriores, por lo que puede quedar un hueco en una cuota anterior. **Bloqueado a propósito:** revertir el enganche de un crédito activo y cancelar o recuperar un crédito activo. | `reverse_payment`, `cancel_sale` | Pendiente (política de devoluciones y recuperación) |
| C12 | Comprobantes de crédito (estado de cuenta y recibo de abono) **provisionales**, sin requisitos contractuales ni fiscales. | Interfaz | Pendiente |