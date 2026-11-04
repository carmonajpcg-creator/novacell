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

## Fase 5 — Apartados y cobranza (2026-11-03)

Reglas comerciales **propuestas y pendientes de aprobación**: L1 a L10 y B1 a B6 en [PENDING_RULES.md](PENDING_RULES.md).

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Un apartado **es una venta pendiente** (modalidad `layaway`) más una fila en `layaways` (anticipo pactado, fecha límite, estado). Reutiliza `reserve_sale_items` y `finalize_sale`. | Una sola implementación del inventario y de la entrega; los pagos siguen en `payments` (`kind = 'layaway'`). |
| 2 | El estado del apartado nunca se escribe a mano: `refresh_layaway_status` lo recalcula desde los pagos **confirmados** (pendiente de anticipo / vigente / liquidado). | Pagos que llegan, se rechazan o se revierten no pueden dejar un estado incoherente. |
| 3 | Convertir en venta es una acción explícita (`convert_layaway`) y idempotente: unidades vendidas, venta confirmada, una sola salida de inventario. | CLAUDE.md §11: "convertir apartado liquidado en venta". |
| 4 | **Una reserva vencida se marca pero no se libera sola.** | CLAUDE.md §11 lo prohíbe hasta aprobar reglas comerciales. |
| 5 | Cancelar un apartado con pagos cobrados **o revertidos** está bloqueado (error `0A000`), y también mientras haya un pago pendiente de verificar. | §11: no inventar política de devolución o retención de anticipos. Sin el bloqueo de "revertidos", revertir y cancelar la evadiría. |
| 6 | La cobranza **nunca** tiene un estado "enviado" o "entregado": solo *preparado*, *WhatsApp abierto (no confirma el envío)* y *contactado* (declarado por el administrador). Las marcas de tiempo las fija un trigger en el servidor; el estado solo avanza; un contacto registrado no se reescribe. | CLAUDE.md §12. Verificado también en pruebas de interfaz y E2E. |
| 7 | El mensaje usa plantillas provisionales que **no mencionan recargos, penalizaciones ni consecuencias**; hay una prueba que lo exige. | No existe política aprobada. |
| 8 | El enlace es `wa.me/52<10 dígitos>` abierto por una acción del usuario; sin teléfono válido solo se permite copiar el mensaje. | El envío es siempre manual. |
| 9 | `business_settings` valida las claves con efecto comercial (`layaway_min_down_percent` entre 0 y 100, `credit_allowed_frequencies`) con un trigger. | Un ajuste erróneo no debe romper ni relajar reglas. |

## Revisión adversarial con Opus (Fase 5)
Sin defectos críticos ni altos. Se corrigieron (migración `…0010`): cancelar rechazaba en silencio una transferencia pendiente y liberaba el equipo (M1),
el anticipo mínimo configurado no se validaba (M2), la cola no mostraba lo pendiente de verificar, se podían preparar recordatorios para apartados/créditos no vigentes,
un contacto registrado se podía reescribir y la huella de idempotencia no incluía las notas (también en créditos). Además se cerró el hueco «revertir y luego cancelar».
Decisiones de negocio que quedaron documentadas sin cambiar el comportamiento: un apartado vencido sigue aceptando pagos (L6) y los créditos que esperan enganche no figuran en la cobranza (B1).

## Pruebas de la Fase 5
SQL: 246 comprobaciones en total (50 de apartados, 33 de cobranza). Concurrencia real (`concurrency-layaways.mjs`): 5 apartados simultáneos de una unidad → 1; 6 pagos que excederían el total → 2;
convertir 4 veces a la vez → una salida; pagar contra cancelar, confirmar contra rechazar y convertir contra revertir dejan estados consistentes.
E2E contra Supabase real: apartados completo y cobranza (esta última necesita `E2E_DB_URL` para simular una cuota vencida, porque una cuota no puede crearse en el pasado).

## Fase 6 — Tienda pública (2026-11-03)

Reglas comerciales **propuestas y pendientes de aprobación**: S1 a S9 en [PENDING_RULES.md](PENDING_RULES.md).

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | El visitante (`anon`) solo lee cinco **vistas** `public_*` y las filas públicas de `business_settings`. Las tablas privadas no se tocan. | Denegar por defecto (CLAUDE.md §17). Una vista con columnas explícitas no puede filtrar IMEI, costos ni notas ni con `select=*`. |
| 2 | Cada unidad tiene un `public_code` aleatorio (6 hex) distinto del código interno secuencial. | El código interno (`NC-000123`) revelaría el tamaño del inventario. |
| 3 | La disponibilidad de accesorios es un estado (disponible / pocas piezas ≤ 3 / agotado), nunca una cantidad. | No exponer existencias exactas. |
| 4 | El cliente pide columnas explícitas (nunca `select *`). | Una columna futura en una vista no llega al navegador por accidente. |
| 5 | El carrito vive solo en `localStorage`, se valida con zod al leerlo y se contrasta con el catálogo vigente al abrir el carrito (quita lo no disponible, actualiza precios). | Datos del navegador no son confiables; el catálogo cambia. Nada se envía al servidor. |
| 6 | El pedido es un mensaje `wa.me/52…` abierto por una acción del visitante. No reserva, no descuenta, no registra. Una prueba E2E verifica que unidad y stock quedan intactos. | CLAUDE.md §6: abrir WhatsApp no confirma una venta. |
| 7 | Los datos de contacto son `business_settings` públicos y editables en **Configuración**; un trigger acepta públicas solo cinco claves. Si faltan, la tienda lo dice y no inventa datos. | No inventar tarifas, zonas ni horarios (§21). |
| 8 | Los privilegios por defecto de `postgres` ya no conceden nada a `anon` sobre tablas ni secuencias nuevas. Una prueba falla si `anon` obtiene acceso a cualquier otro objeto. | Cada migración debía acordarse de hacer `REVOKE`. Ahora olvidarlo es seguro. |
| 9 | Borrar un producto o una foto elimina primero los archivos de Storage y no ignora errores; `tests/integration/cleanup-storage.mjs` detecta y limpia huérfanos. | Los archivos de un producto borrado seguirían públicos por URL. |

## Revisión adversarial con Opus (Fase 6)
Sin fugas críticas ni altas: `anon` solo puede leer las vistas públicas y `business_settings`; las RPC, secuencias y tablas privadas le están negadas. Se corrigieron (migración `…0012`):
privilegios por defecto aún abiertos para objetos futuros (M1), claves arbitrarias podían hacerse públicas (M2, incluida una variante con otras mayúsculas), fotos huérfanas en Storage (M3),
una foto ligada a la unidad de otro producto (B1), `is_valid_imei` ejecutable por `anon` (B2) y un índice para el catálogo (B3).
Limitaciones conocidas: los valores por defecto de objetos creados por `supabase_admin` (herramienta interna de Supabase) no se pueden cambiar desde las migraciones; no los usa este proyecto.
`max_rows` del servidor no se pudo verificar: conviene fijarlo en 100–200 en el panel de Supabase. Las URL de las fotos ya publicadas siguen sirviendo tras despublicar (decisión aceptada; se recomienda no subir fotos donde se vea el IMEI).

## Pruebas de la Fase 6
SQL: 294 comprobaciones en total (incluyen la lista permitida de objetos que `anon` puede tocar). Unitarias: 103. E2E con el visitante sin sesión: catálogo, filtros, ficha, carrito, pedido por WhatsApp,
despublicar, contacto, y la comprobación de que **ninguna respuesta de la API** contiene IMEI, número de serie, costos, notas ni códigos internos; recorrido móvil sin desbordes; y la pantalla de Configuración.
## Fase 7 — Entregas, dashboard y reportes (2026-11-03)
- **Entregas** (`deliveries`): una entrega vigente por venta confirmada (índice único parcial; tras cancelar se puede reprogramar y el historial conserva ambas). Estados `pending → preparing → on_the_way → delivered`, `cancelled` con motivo; solo avanzan, y un estado terminal es historial inmutable (trigger). Se permite saltar de pendiente a entregada (entrega en mostrador). Alta, cambios de estado y edición pasan por RPC (`create_delivery`, `set_delivery_status`, `update_delivery`) con `assert_admin()`, bloqueo de fila, idempotencia y bitácora; no hay INSERT/UPDATE/DELETE directo. El costo de entrega se registra aparte: **no** se suma al total de la venta. No se inventaron tarifas ni zonas (el costo lo captura el dueño).
- **Dashboard** (`dashboard_metrics()`): todo se calcula en la base de datos y se muestra separado: venta registrada, dinero cobrado, utilidad estimada, por cobrar, vencidos, inventario, entregas, reversos y serie de 14 días. Definiciones R1–R9 en docs/PENDING_RULES.md.
- **Reportes**: `report_sales`, `report_payments`, `report_summary`, `report_reversals` (rango máximo 366 días, fechas en hora de Ciudad de México). Exportación CSV en el navegador con BOM UTF-8, CRLF y neutralización de celdas que empiecen con `= + - @` (inyección CSV); sin teléfonos ni direcciones.

## Revisión adversarial con Opus (Fase 7)
Sin fallas críticas. Se corrigieron (migración `…0015`): UPDATE directo sobre `deliveries` (el trigger recibía el costo ya redondeado y no podía detectar 3 decimales; ahora `update_delivery` valida y audita, y se revocó el UPDATE), la serie de 14 días tipada como `date`, reversos invisibles (R9), productos inactivos contados como disponibles (R6), idempotencia de `create_delivery` que comparaba pocos campos, estado nulo en `set_delivery_status`, límite del rango (366 días incluyendo ambos extremos) e índices por `(status, confirmed_at)`.

## Pruebas de la Fase 7
SQL: 385 comprobaciones en total (entregas, edición por RPC, permisos, reportes con deltas, cambio de zona horaria, reversos). Unitarias: 111. Concurrencia real (`tests/integration/concurrency-deliveries.mjs`): 5 altas simultáneas de la misma venta → 1; misma clave ×4 → 1 fila; entregar vs cancelar y editar vs cancelar → estado terminal único, sin ediciones posteriores. E2E: programar desde la venta con validaciones, avanzar estados, entrega final inmutable, dashboard, reporte y descarga CSV; recorrido móvil sin desbordes (/admin, entregas, reportes).

## Fase 8 — Lanzamiento (2026-11-04)
- **Rendimiento:** rutas con carga diferida; el bundle principal bajó de 934 kB a ~352 kB (+ ~376 kB de datos/Supabase compartido) y cada pantalla es un fragmento aparte; el visitante de la tienda no descarga el panel.
- **Revisión de seguridad global con Opus:** sin hallazgos críticos. Aplicado (migración `…0016` y front): IMEI/serie/costo/precio de unidades reservadas o vendidas inmutables y auditados (M3), bitácora solo escrita por el sistema (B5), funciones nuevas sin EXECUTE para PUBLIC (B1), CSP + `referrer` en el build (M2), caché de React Query limpia al cerrar sesión (B2), CI con permisos mínimos y CLI fijo (B4), y protección `business_settings.environment = "production"` que bloquea limpieza y pruebas de concurrencia (A1). Abiertos: MFA (M1, requiere pantalla de alta), clickjacking (B3, depende del hosting), separar proyecto de pruebas (ver docs/LAUNCH.md).
- **Accesibilidad:** pruebas axe (WCAG A/AA) en tienda, login y 13 pantallas del panel (`tests/e2e/a11y.spec.ts`). Corregido: contraste de `text-subtle` (el gris medio pasó de `#667085` a `#5a6475` porque no alcanzaba 4.5:1 sobre el gris claro), el login sin `<h1>` y etiquetas ARIA que no coincidían con el texto visible. La prueba se hizo con la base casi vacía: conviene repetirla con datos reales y una revisión manual con lector de pantalla.
- **Pruebas:** SQL 394, unitarias 111 (timeout subido a 20 s por intermitencia bajo carga), E2E completo 25 ok / 11 omitidos por diseño / 0 fallas, concurrencia de entregas ok.
- `npm audit`: 0 vulnerabilidades en dependencias de producción; 11 moderadas en herramientas de desarrollo (minimatch), no se publican.

## MFA del administrador (2026-11-04)
- TOTP con Supabase Auth. El interruptor `require_mfa` (business_settings) solo cambia con `set_require_mfa()`: exige sesión aal2 y un factor verificado, y un trigger bloquea INSERT/UPDATE/DELETE directos; así es imposible dejarse fuera por accidente. Con el interruptor encendido, `is_admin()` exige `aal2`, de modo que una contraseña robada no opera el panel ni la base. Apagado, todo funciona como antes.
- Al iniciar sesión con un factor registrado, el panel pide el código (estado `mfa_required`); no se muestra nada privado antes.
- Recuperación: si se pierde el dispositivo, hay que quitar el factor desde el panel de Supabase (Authentication → Users) con acceso al proyecto, y apagar el interruptor con SQL como propietario. Guarda la clave manual que muestra el QR.
- Corregido de paso: carrera entre el login y la navegación (el guard mandaba un instante al login) y contraste de las insignias azules (4.1:1 → ≥4.5:1).
- Pruebas: SQL 412, unitarias 113. El flujo de alta del TOTP no tiene E2E automático (requiere generar códigos de un teléfono); se prueba a mano al activarlo.
