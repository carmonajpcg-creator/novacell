# Decisiones técnicas

## 2026-11-02 — Fase 1

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | `HashRouter` | GitHub Pages no soporta rutas de historial; el hash garantiza enlaces profundos y recargas sin truco de `404.html`. Cambiable a `BrowserRouter` con dominio propio. |
| 2 | `base` de Vite vía `VITE_BASE_PATH` | Migrar a dominio propio es cambiar una variable. |
| 3 | npm como gestor | Ya instalado, sin dependencias adicionales. |
| 4 | Tailwind v4 con tokens en `@theme` | Paleta aprobada centralizada en `src/styles/index.css`. |
| 5 | Componentes UI al estilo shadcn, escritos a mano | Basados en Radix + cva; se añaden bajo demanda en lugar de generar todos por adelantado. |
| 6 | `detectSessionInUrl: false` en el cliente Supabase | El hash de la URL lo usa HashRouter; el login es con correo/contraseña y no requiere procesar la URL. |
| 7 | Rol en `profiles`, sin políticas de escritura | Impide auto-asignarse privilegios; el admin se crea con el proceso de `ADMIN_SETUP.md`. |
| 8 | `business_settings.is_public` | Permite exponer solo datos publicables (p. ej. WhatsApp de contacto) al visitante. |
| 9 | `audit_logs` de solo inserción | Sin UPDATE/DELETE concedidos. |
| 10 | Despliegue solo por `workflow_dispatch` | CLAUDE.md prohíbe desplegar sin autorización. |
| 11 | Wordmark de texto provisional | No hay logotipo definitivo. |

## Infraestructura (2026-11-02)
- Proyecto Supabase `novacell` (ref `fwxetxedxutklgnfitzn`, us-east-1, plan free) en la organización del propietario.
- Migración `20261102000001_foundations` aplicada. Registro público desactivado (`disable_signup`).
- Administrador creado con el proceso de `ADMIN_SETUP.md` (usuario en Auth + fila en `profiles` con rol admin).
- Los secretos viven solo en `.env.local` (ignorado por git).

## Limitaciones conocidas
- Docker no está instalado en la máquina de desarrollo: las pruebas pgTAP (`supabase/tests`) se ejecutan en CI, no localmente.
  Las políticas RLS se verificaron manualmente contra el proyecto real (visitante, empleado y admin).
- Las pruebas E2E de login con Supabase real se activan con `E2E_ADMIN_EMAIL` y `E2E_ADMIN_PASSWORD`; sin ellas se omiten.
- Pendiente: URL de redirección de Auth para GitHub Pages cuando exista el sitio publicado.

## Fase 2 — Productos e inventario (2026-11-03)

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Cada iPhone es una unidad identificada por IMEI único (15 dígitos + Luhn, validado en BD y UI) | Pedido del propietario. Número de serie opcional y único. |
| 2 | Un iPhone es un producto "modelo"; capacidad, color, condición, batería y precios viven en la unidad | Precio y costo varían por equipo (seminuevos). |
| 3 | Accesorios: producto + variantes (SKU, color, modelo compatible, precio, costo, existencias) | Pedido del propietario. |
| 4 | `stock_quantity` y `status` no son escribibles por el cliente (privilegios por columna); solo RPC `register_unit`, `set_unit_active`, `adjust_variant_stock` | Evita stock negativo y cambios sin historial. Las RPC bloquean la fila (`FOR UPDATE`). |
| 5 | Idempotencia con `idempotency_key` único en `inventory_movements`; el formulario genera la clave al abrirse | Doble clic o reintento no duplica. |
| 6 | `inventory_movements` solo inserción (sin privilegios + trigger) | Historial inalterable. |
| 7 | Todo el inventario es solo-admin hasta la Fase 6 | IMEI y costos nunca deben ser públicos; la tienda usará vistas sin esos campos. |
| 8 | Productos y categorías se desactivan; solo se pueden borrar si están vacíos (FK `RESTRICT`) | Conserva el historial. |
| 9 | Bucket `product-images` público para lectura, escritura solo admin, JPG/PNG/WebP ≤ 5 MB, rutas con UUID | Las fotos se mostrarán en la tienda. Las URL son difíciles de adivinar pero no secretas. |
| 10 | Dinero como `string` en formularios, enviado como texto a `NUMERIC(14,2)` | Nunca floats (CLAUDE.md §15). |
| 11 | Pruebas SQL como un bloque `DO` que revierte todo (`supabase/tests/*.test.sql` + `tests/integration/run-db-tests.mjs`) | `supabase db query` solo ejecuta una sentencia y no hay Docker/pgTAP. Corren igual contra el proyecto real, sin dejar datos. |

Pendientes de negocio (CLAUDE.md §21): ninguno nuevo introducido. No se definió política de garantías, ni catálogo ni precios reales.
No cubierto aún: prueba de concurrencia real (varias conexiones simultáneas); las RPC usan `FOR UPDATE` pero solo se probaron secuencialmente.

## Fase 3 — Clientes y ventas de contado (2026-11-03)

Reglas comerciales **propuestas y pendientes de aprobación**: ver [PENDING_RULES.md](PENDING_RULES.md).

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Ventas, líneas y pagos solo se escriben mediante RPC (`create_sale`, `record_payment`, `confirm_payment`, `reject_payment`, `reverse_payment`, `cancel_sale`); el cliente solo lee | El total, el inventario y los estados los decide la base de datos, nunca el navegador (CLAUDE.md §3.10, §16). |
| 2 | La venta se confirma automáticamente cuando los pagos confirmados suman el total (`complete_sale_if_paid`, interna) | No existe un "confirmar venta" manual que pueda desalinearse del dinero cobrado. |
| 3 | Orden de bloqueo fijo: venta → pago, y unidades/variantes por UUID | Evita interbloqueos entre confirmar, cancelar y crear ventas. |
| 4 | Idempotencia estricta: misma clave con datos distintos es error (huella `request_hash` en ventas; comparación de campos en pagos e inventario) | Un reintento idéntico es seguro; reutilizar una clave por error no devuelve la operación equivocada. |
| 5 | `EXECUTE` revocado a `anon` en todas las RPC y a `anon`/`authenticated` en funciones internas; `ALTER DEFAULT PRIVILEGES` para funciones futuras | Supabase concede EXECUTE por defecto; `REVOKE ... FROM PUBLIC` no basta. Hallazgo de la revisión adversarial. |
| 6 | Restricciones `<> 'NaN'` en todas las columnas monetarias y validación en las RPC | `NaN` pasa `>= 0` y cabe en `NUMERIC(14,2)`; dejaba ventas imposibles de cobrar. |
| 7 | Dinero en formularios como string y sumas en centavos enteros; el total mostrado es solo orientativo | Sin floats (CLAUDE.md §15). |
| 8 | Los diálogos (portales) van **fuera** de los `<form>` | Los eventos de un portal burbujean por el árbol de React y enviarían el formulario padre. |
| 9 | La pantalla separa siempre venta registrada, cobrado, por verificar y por cobrar; la utilidad estimada se muestra aparte | CLAUDE.md §14. |
| 10 | Comprobante imprimible (`window.print()` + estilos `print:`), sin PDF generado | Sin dependencias nuevas; el formato definitivo está pendiente (P6). |

## Revisión adversarial con Opus (Fase 3)
Se delegó a un subagente Opus la revisión de las RPC. Confirmó y se corrigieron (migración `…0004` y `…0005`):
EXECUTE de `anon` sobre funciones sin control de admin, precios `NaN`, clave de idempotencia reutilizada con otros datos,
reintento simultáneo de pagos, productos inactivos, orden de bloqueos y coherencia de estados de pagos.
No se implementó (documentado): movimientos de inventario para reservas de iPhone (P9) y precio mínimo (P4).

## Pruebas de concurrencia real
`tests/integration/concurrency.mjs` lanza conexiones simultáneas y hace COMMIT (con prefijo `CC `, luego limpia):
misma unidad vendida por 6 clientes → 1 gana; stock 3 con 8 ventas → 3 ganan y nunca negativo; misma clave de idempotencia ×4 → 1 venta;
5 pagos simultáneos que excederían el total → solo caben 2; misma referencia de transferencia → 1; confirmar vs. cancelar → estado consistente.

## Fase 4 — Créditos (2026-11-03)

Reglas comerciales **propuestas y pendientes de aprobación**: C1 a C12 en [PENDING_RULES.md](PENDING_RULES.md).

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Separación estricta: `credits` (acuerdo, inmutable) / `installments` (calendario, inmutable) / `payments` (pagos recibidos, con `kind`) / `payment_allocations` (aplicación) | CLAUDE.md §15. Sin privilegios de escritura sobre las tres primeras; solo RPC. |
| 2 | El saldo nunca se guarda: se calcula en vistas (`credit_summaries`, `installment_status`) desde pagos confirmados y aplicaciones vigentes | Evita desalinearse; los pagos pendientes jamás bajan el saldo (§10). |
| 3 | Un reverso marca `reversed_at` en las aplicaciones y deja el pago en `reversed`; nada se borra | "Nunca borrar pagos confirmados" (§10). |
| 4 | Orden de bloqueo único: venta → crédito → pago → cuotas; y cada función que activa o liquida vuelve a bloquear la venta | Evita interbloqueos entre abonos, confirmaciones, reversos y cancelaciones. |
| 5 | El tope de un abono cuenta pagos pendientes y confirmados (no solo lo aplicado) | Impide cobrar de más con transferencias pendientes. Verificado con 8 abonos simultáneos. |
| 6 | La lógica de reservar inventario se extrajo a `reserve_sale_items` y la de confirmar a `finalize_sale`, compartidas por contado y crédito | Una sola implementación del inventario; las 89 pruebas previas siguieron pasando. |
| 7 | La vista previa del calendario en el navegador usa el mismo algoritmo que la base (en centavos) y es solo informativa | El calendario definitivo lo genera `create_credit_sale`. Hay pruebas que fijan los mismos casos en ambos lados. |
| 8 | `formatDate` interpreta fechas sin hora como día calendario local | `new Date('2026-11-10')` es medianoche UTC y mostraría el día anterior en México. |
| 9 | Pruebas SQL herméticas (acotadas a los datos de cada prueba) | Fallaban si quedaban datos E2E sobrantes en la base. |

## Revisión adversarial con Opus (Fase 4)
Sin defectos críticos. Se corrigieron (migración `…0007`): reglas de reparto activadas sin documentar (A1), saldo demasiado pequeño para el número de cuotas (M1),
saldo y próximo vencimiento mostrados en créditos cancelados (M2), precios con más de 2 decimales redondeados en silencio (B1), huella de idempotencia inestable (B2),
reutilización de clave entre pago de contado y abono (B3), fecha absurda (B4), coherencia de estados y tipo de pago vs modalidad (B5), orden de bloqueo en la activación (B6) e idempotencia sin `reference` (B7).
Decisiones de negocio que quedaron documentadas, sin cambiar el comportamiento: huecos tras un reverso (C11), calendario fijado al crear (C6), total de la venta distinto a la suma de líneas (C1).