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