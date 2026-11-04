# Reglas comerciales (propuestas por el desarrollo y APROBADAS por el propietario el 2026-11-04)

El propietario aprobó las reglas tal como están escritas. Las notas entre paréntesis son preguntas que quedaron abiertas
y siguen siendo trabajo futuro (p. ej. datos fiscales, devoluciones de ventas confirmadas, retención de anticipos): aprobar
las reglas no define lo que no está escrito (CLAUDE.md §21: no inventar políticas).
Cada una indica dónde está implementada para poder ajustarla.

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| P1 | Una venta pendiente **reserva** el iPhone (no puede venderse a otro) y **descuenta** el stock de accesorios. Cancelar lo libera. | `create_sale`, `cancel_sale` | Aprobada 2026-11-04 |
| P2 | El **efectivo** se confirma al registrarlo. La **transferencia** queda pendiente hasta que el administrador verifica el depósito; exige clave de rastreo (≥ 4 caracteres). | `record_payment`, `confirm_payment` | Aprobada 2026-11-04 |
| P3 | La venta se **confirma sola** cuando los pagos confirmados suman exactamente el total. No se puede cobrar más que el total (cuentan pagos pendientes y confirmados). | `complete_sale_if_paid`, `record_payment` | Aprobada 2026-11-04 |
| P4 | El precio de cada línea parte del catálogo y **puede ajustarse** (descuento o precio negociado). Todo precio distinto al del catálogo queda en `audit_logs`. No hay precio mínimo. | `create_sale` | Aprobada 2026-11-04 (¿precio mínimo = costo? ¿motivo obligatorio?) |
| P5 | Solo se **cancelan** ventas pendientes sin pagos confirmados. Los pagos confirmados se **revierten** (conservando el registro) solo mientras la venta siga pendiente. **Cancelar o devolver una venta ya confirmada no está implementado** (bloqueado con error). | `cancel_sale`, `reverse_payment` | Pendiente: política de devoluciones y cancelaciones |
| P6 | Folio `V-000001`. El comprobante muestra el **IMEI completo** del equipo vendido y la leyenda "Comprobante de venta, no es factura fiscal". Sin datos fiscales del negocio. | Comprobante en la interfaz | Aprobada 2026-11-04 (datos fiscales, formato, ¿IMEI completo o parcial?) |
| P7 | Teléfono del cliente **opcional**, de 10 dígitos (México). Nombre obligatorio. | `customers` | Aprobada 2026-11-04 |
| P8 | El **costo histórico** de cada línea se copia al **crear** la venta (no al confirmarla). | `create_sale` | Aprobada 2026-11-04 (CLAUDE.md §7 dice "al confirmar"; hoy la diferencia es mínima) |
| P9 | Reservar o liberar un iPhone **no** genera movimiento de inventario; solo la salida definitiva al confirmar. En accesorios, el descuento sí genera movimiento al crear la venta. | `create_sale`, `complete_sale_if_paid` | Aprobada 2026-11-04 |
| P10 | Una venta confirmada no tiene pagos parciales en espera: confirmada = totalmente cobrada. Los **pagos combinados** (efectivo + transferencia) son varios pagos de una misma venta. | `record_payment` | Aprobada 2026-11-04 |

## Aún sin definir (no implementado a propósito)
- Garantías, devoluciones, retención de anticipos y cancelación de ventas confirmadas.
- Información fiscal del negocio y facturación.
- Costo y zonas de entrega (Fase 7).
- Intereses, recargos y reglas de aplicación de abonos (Fase 4).

## Fase 4 — Créditos (propuestas C1 a C12, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| C1 | El **precio final financiado** lo fija el negocio a mano y puede ser distinto a la suma de las líneas (las líneas conservan precio de referencia y costo histórico). | `create_credit_sale` | Aprobada 2026-11-04 (¿cómo se presenta en comprobantes y márgenes?) |
| C2 | **Sin intereses ni recargos automáticos.** | todo el módulo | Aprobada 2026-11-04 (CLAUDE.md §10) |
| C3 | Cuotas **iguales en centavos**; el residuo va a la **última** cuota. Cuota mínima 0.01. | `create_credit_sale` | Aprobada 2026-11-04 |
| C4 | Frecuencias semanal, quincenal y mensual, configurables con la clave `credit_allowed_frequencies` de `business_settings` (aún sin pantalla). Límites técnicos, no políticas: de 1 a 260 cuotas y primera fecha entre hoy y un año. **No hay plazo máximo comercial definido.** | `create_credit_sale` | Aprobada 2026-11-04 (plazos y frecuencias definitivos) |
| C5 | El **enganche** reduce el monto financiado. El crédito pasa a *activo* (iPhone vendido) cuando el enganche confirmado cubre lo pactado. Mientras tanto el iPhone queda **reservado sin límite de tiempo**. | `activate_credit_if_ready` | Aprobada 2026-11-04 (¿plazo máximo de reserva?) |
| C6 | El **calendario se fija al crear** el crédito (condiciones originales pactadas). Si el enganche tarda, las cuotas pueden vencer antes de activarse. | `create_credit_sale` | Aprobada 2026-11-04 (¿calendario desde la activación?) |
| C7 | Los **abonos** se aplican a la **cuota más antigua primero**; se permiten parciales y anticipados; un abono no puede exceder el saldo (los pendientes cuentan para el tope). | `allocate_payment` | Aprobada 2026-11-04 (CLAUDE.md §10: definir y probar antes de activar) |
| C8 | Un pago **pendiente de verificación no baja el saldo**. | `confirm_payment` | Aprobada 2026-11-04 |
| C9 | Una cuota está **vencida** cuando tiene saldo y su fecha es anterior a hoy (hora de Ciudad de México). Sin días de gracia. | vista `installment_status` | Aprobada 2026-11-04 |
| C10 | El crédito se **liquida solo** al cubrir todas las cuotas. Sin descuento por pago anticipado. | `allocate_payment` | Aprobada 2026-11-04 |
| C11 | Un abono confirmado se puede **revertir** (se conserva el registro y sus aplicaciones; reabre un crédito liquidado). No se vuelven a repartir los abonos posteriores, por lo que puede quedar un hueco en una cuota anterior. **Bloqueado a propósito:** revertir el enganche de un crédito activo y cancelar o recuperar un crédito activo. | `reverse_payment`, `cancel_sale` | Aprobada 2026-11-04 (política de devoluciones y recuperación) |
| C12 | Comprobantes de crédito (estado de cuenta y recibo de abono) **provisionales**, sin requisitos contractuales ni fiscales. | Interfaz | Aprobada 2026-11-04 |
## Fase 5 — Apartados (propuestas L1 a L10, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| L1 | Un apartado es una venta **pendiente** (modalidad `layaway`) con anticipo pactado y fecha límite. **Reserva el inventario desde que se crea** (iPhone reservado; accesorios descontados). | `create_layaway` | Aprobada 2026-11-04 |
| L2 | El anticipo debe ser mayor a cero. Un **porcentaje mínimo** es configurable con la clave `layaway_min_down_percent` de `business_settings` (sin valor definido solo se exige > 0; aún sin pantalla de configuración). | `create_layaway` | Aprobada 2026-11-04 (¿qué porcentaje mínimo?) |
| L3 | La fecha límite se elige por apartado; límite técnico: entre hoy y un año. | `create_layaway` | Aprobada 2026-11-04 (plazo máximo comercial) |
| L4 | El apartado pasa a *activo* cuando los pagos **confirmados** cubren el anticipo y a *liquidado* cuando cubren el total. No se puede pagar más que el saldo (los pendientes cuentan para el tope). | `refresh_layaway_status` | Aprobada 2026-11-04 |
| L5 | Una transferencia pendiente de verificar **no cuenta** como cobrada ni activa el apartado. | `confirm_payment` | Aprobada 2026-11-04 |
| L6 | Una reserva **vencida se marca como vencida, pero NO se libera sola**: sigue reservada hasta que el negocio decida (CLAUDE.md §11). Un apartado vencido **sigue aceptando pagos y puede convertirse en venta**. | vista `layaway_summaries` | Aprobada 2026-11-04 (regla de liberación de reservas vencidas y qué pasa con un apartado vencido) |
| L7 | Convertir un apartado liquidado en venta es una **acción explícita** (la entrega): las unidades pasan a vendidas, la venta queda confirmada y se emite el comprobante de venta. | `convert_layaway` | Aprobada 2026-11-04 |
| L8 | **Cancelar** un apartado sin pagos confirmados libera el inventario. Con pagos confirmados está **bloqueado**: la devolución o retención del anticipo no está definida (CLAUDE.md §11). Tampoco se puede cancelar si hay pagos **revertidos** (así «revertir y luego cancelar» no evade el bloqueo), ni mientras haya un pago **pendiente de verificar** (puede ser dinero ya recibido: hay que confirmarlo o rechazarlo antes). | `cancel_sale` | Aprobada 2026-11-04 (política de devolución/retención de anticipos; mientras tanto un apartado con cobros no se puede cancelar) |
| L9 | Los pagos de un apartado se pueden revertir (conservando el registro) mientras no esté convertido ni cancelado; el estado se recalcula. | `reverse_payment` | Aprobada 2026-11-04 |
| L10 | Precio y costo de las líneas se fijan al crear el apartado (precio histórico). | `reserve_sale_items` | Aprobada 2026-11-04 |

## Fase 5 — Cobranza (propuestas B1 a B6, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| B1 | La cola de cobranza reúne cuotas con saldo de créditos **activos** y apartados vigentes con saldo, y muestra lo **pendiente de verificar** para no reclamar un pago ya hecho. Los créditos que esperan enganche (`pending_down`) no aparecen aunque tengan cuotas vencidas (ver C6). «Próximos» es una ventana elegida en pantalla (7 días por defecto). | vista `collection_queue` | Aprobada 2026-11-04 |
| B2 | **El envío es siempre manual.** El sistema prepara el mensaje y abre WhatsApp (`wa.me`, lada +52 y teléfono de 10 dígitos). | Interfaz | Aprobada 2026-11-04 |
| B3 | Estados de un recordatorio: *preparado* → *WhatsApp abierto* → *contactado* (declarado por el administrador, con resultado). **No existe «enviado» ni «entregado»**: abrir WhatsApp no demuestra el envío (CLAUDE.md §12). | `collection_reminders` | Aprobada 2026-11-04 |
| B4 | Las plantillas de mensaje son provisionales y **no mencionan recargos, penalizaciones ni consecuencias** (no hay política aprobada). | Interfaz | Aprobada 2026-11-04 (redacción) |
| B5 | Sin mensajes automáticos ni programados. | — | Aprobada 2026-11-04 |
| B6 | Un cliente sin teléfono permite copiar el mensaje pero no abrir WhatsApp. | Interfaz | Aprobada 2026-11-04 |

## Fase 6 — Tienda pública (propuestas S1 a S9, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| S1 | Solo se publican productos **publicados y activos**, de categorías activas. De los iPhone solo las unidades **disponibles** (no reservadas, vendidas ni inactivas). | vistas `public_*` | Aprobada 2026-11-04 |
| S2 | El precio mostrado es el **precio de venta de contado vigente**. Un producto con varias unidades o variantes muestra «desde» y el rango. No se muestran precios de crédito ni de apartado. | `public_products`, `public_units`, `public_variants` | Aprobada 2026-11-04 |
| S3 | La disponibilidad de los accesorios es un **estado** (Disponible / Pocas piezas / Agotado), nunca una cantidad exacta. Umbral de «pocas piezas»: **3** o menos. | `public_variants` | Aprobada 2026-11-04 (¿qué umbral?) |
| S4 | De un iPhone se muestran condición (nuevo/seminuevo), capacidad, color, salud de batería y estado físico. **Nunca** IMEI, número de serie, costo, notas ni código interno. El campo «estado físico» es público: debe redactarse pensando en el cliente. También son públicos el SKU de los accesorios y la fecha de alta del producto. Recomendación: no subir fotografías donde se vea el IMEI (caja o pantalla de Ajustes), porque las URL de las fotos son públicas y siguen sirviendo aunque se despublique el producto. | `public_units` | Aprobada 2026-11-04 (¿SKU y fecha de alta públicos?) |
| S5 | Cada unidad tiene un **código público aleatorio** de 6 caracteres para identificarla en el pedido; es distinto del código interno secuencial. | `product_units.public_code` | Aprobada 2026-11-04 |
| S6 | El pedido por WhatsApp es un **mensaje con productos, cantidades e importes**. No reserva el equipo, no descuenta inventario y no registra nada: los precios y la disponibilidad se confirman por WhatsApp (CLAUDE.md §6). Sin pagos electrónicos. | Interfaz | Aprobada 2026-11-04 |
| S7 | Los datos de contacto, horario, dirección y entregas son **configurables** (Configuración) y públicos. Si faltan, la tienda lo indica. **No se inventan tarifas, zonas de cobertura ni tiempos de entrega.** | `business_settings` | Aprobada 2026-11-04 (datos reales del negocio) |
| S8 | El carrito vive solo en el navegador del visitante; no se recopilan datos personales ni se guarda el pedido en el servidor. | Interfaz | Aprobada 2026-11-04 |
| S9 | No se publican garantías, devoluciones, financiamiento ni apartados hasta que existan políticas aprobadas. | Interfaz | Aprobada 2026-11-04 |

## Fase 7 — Entregas (propuestas D1 a D8, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| D1 | Una entrega solo se programa para una venta **confirmada** (cobrada por completo, crédito activo o apartado ya convertido). | `create_delivery` | Aprobada 2026-11-04 |
| D2 | Una venta tiene **una sola entrega vigente**. Si se cancela, se puede programar otra (el historial conserva ambas). | índice único parcial | Aprobada 2026-11-04 |
| D3 | Estados: pendiente → en preparación → en camino → entregada. Solo avanzan (se puede saltar pasos, p. ej. entrega en mostrador) y nunca retroceden. Entregada y cancelada son finales. | `set_delivery_status` | Aprobada 2026-11-04 |
| D4 | El **costo de entrega** lo captura el administrador. **No hay tarifas ni zonas de cobertura.** Se registra aparte: **no se suma** al total de la venta, a los pagos ni a la utilidad. | `deliveries.delivery_cost` | Aprobada 2026-11-04 (¿se cobra al cliente o lo absorbe el negocio? ¿se suma a la venta?) |
| D5 | La dirección es obligatoria y es un dato personal: solo la ve el administrador. Se conserva como historial. | `deliveries`, RLS | Aprobada 2026-11-04 (¿cuánto tiempo conservarla?) |
| D6 | Cancelar una entrega exige motivo. La fecha de entrega la fija el servidor. | `set_delivery_status` | Aprobada 2026-11-04 |
| D7 | No se avisa automáticamente al cliente: cualquier mensaje sería manual. | — | Aprobada 2026-11-04 |
| D8 | La fecha programada no puede ser pasada (límite técnico: hasta un año). | `create_delivery` | Aprobada 2026-11-04 |

## Fase 7 — Dashboard y reportes (propuestas R1 a R8, pendientes de aprobación)

| # | Regla propuesta | Dónde vive | Estado |
|---|-----------------|------------|--------|
| R1 | **Venta registrada** = venta **confirmada**, en la fecha de su confirmación (contado: al cobrarse por completo; crédito: al activarse; apartado: al convertirse en venta). Las ventas pendientes, canceladas y los apartados sin entregar no cuentan. | `dashboard_metrics`, `report_*` | Aprobada 2026-11-04 |
| R2 | **Dinero cobrado** = pagos **confirmados**, en la fecha de su confirmación. No cuentan los pendientes de verificar, rechazados ni revertidos. Se desglosa por método. | `dashboard_metrics`, `report_*` | Aprobada 2026-11-04 |
| R3 | **Utilidad estimada** = total de la venta − costo histórico de sus líneas, por venta confirmada. **No es dinero cobrado**: un crédito registra su utilidad completa aunque se cobre por abonos. No descuenta costos de entrega, comisiones ni gastos. | `dashboard_metrics`, `report_sales` | Aprobada 2026-11-04 |
| R4 | **Cuentas por cobrar** = saldo de créditos activos + saldo de apartados vigentes. No incluye ventas de contado pendientes ni créditos que esperan enganche. | `dashboard_metrics` | Aprobada 2026-11-04 |
| R5 | **Saldo vencido** = cuotas vencidas con saldo + saldo de apartados con fecha límite vencida (hora de Ciudad de México, sin días de gracia). | `dashboard_metrics` | Aprobada 2026-11-04 |
| R6 | **Productos disponibles** = iPhone disponibles (unidades) y accesorios con existencias, solo de productos **activos** (un producto desactivado no cuenta como disponible). | `dashboard_metrics` | Aprobada 2026-11-04 |
| R7 | «Hoy» y «mes» son día y mes calendario en hora de Ciudad de México. Los reportes admiten rangos de hasta 366 días (inicio y fin incluidos). | todo el módulo | Aprobada 2026-11-04 |
| R9 | **Reversos**: un pago confirmado que luego se revierte deja de contar como cobrado en su fecha original (el pasado se corrige), y el reverso se informa aparte, en la fecha en que ocurrió (dashboard: hoy y mes; reportes: total y listado con motivo). | `dashboard_metrics`, `report_summary`, `report_reversals` | Aprobada 2026-11-04 |
| R8 | La exportación CSV contiene lo que muestra el reporte (nombre del cliente, sin teléfonos ni direcciones) y neutraliza celdas que un programa de hojas de cálculo podría interpretar como fórmulas. | Interfaz | Aprobada 2026-11-04 |