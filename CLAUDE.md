# NovaCell — CLAUDE.md

## 1. Identidad del proyecto

Nombre provisional: NovaCell
Eslogan: Tecnología que conecta contigo.
Idioma: Español de México.
Moneda: MXN.
Estado: Desarrollo inicial.

NovaCell es una plataforma web para comercializar iPhone nuevos, seminuevos y accesorios, acompañada de un sistema administrativo para controlar inventario, ventas, clientes, créditos, apartados, abonos, cobranza y entregas.

El objetivo es construir una aplicación profesional, segura, escalable, minimalista y fácil de utilizar.

El proyecto está destinado inicialmente a un negocio con un solo administrador. Su arquitectura debe permitir incorporar empleados y nuevas funcionalidades posteriormente.

No inventar reglas comerciales que aún no hayan sido aprobadas.

## 2. Stack tecnológico obligatorio

Frontend:
- React
- Vite
- TypeScript con tipado estricto
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- Tipografía Inter

Backend:
- Supabase Cloud
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Funciones PostgreSQL/RPC para operaciones transaccionales

Hosting:
- GitHub Pages inicialmente
- GitHub Actions para despliegues
- Dominio personalizado posteriormente

Pruebas:
- Vitest
- React Testing Library
- Playwright
- Pruebas de integración con PostgreSQL
- Pruebas de seguridad RLS

Control de versiones:
- Git
- GitHub

No incorporar otro framework, ORM o backend sin justificación y autorización.

## 3. Reglas generales para Claude Code

1. Leer este archivo antes de trabajar.
2. Revisar la estructura y el estado actual del repositorio.
3. Trabajar una fase a la vez.
4. Antes de implementar, explicar el objetivo y los archivos afectados.
5. No modificar funcionalidades ajenas a la tarea.
6. Mantener arquitectura modular y componentes reutilizables.
7. Evitar código duplicado.
8. Utilizar TypeScript estrictamente.
9. Implementar validaciones tanto en frontend como en backend.
10. No confiar en cálculos financieros realizados únicamente en el navegador.
11. Crear pruebas para cada funcionalidad importante.
12. Ejecutar las pruebas relevantes después de cada implementación.
13. No afirmar que algo funciona sin verificarlo.
14. Documentar decisiones técnicas importantes.
15. No desplegar cambios sin autorización.
16. No realizar operaciones destructivas sin autorización.
17. Solicitar aclaraciones cuando falten reglas de negocio.
18. Presentar un resumen de cambios y pruebas al terminar cada tarea.
19. Mantener actualizado este documento conforme evolucione NovaCell.
20. Priorizar seguridad, rendimiento, accesibilidad y facilidad de mantenimiento.

## 4. Diseño visual

Estilo:
- Minimalista
- Elegante
- Premium
- Moderno
- Profesional
- Mobile-first

Paleta:
- Grafito: #15171B
- Blanco: #FFFFFF
- Gris claro: #F2F3F5
- Gris medio: #667085
- Azul: #3563E9

Reglas:
- Utilizar espacios amplios y una jerarquía visual clara.
- Evitar colores excesivos.
- Priorizar fotografías reales de los productos.
- Utilizar animaciones discretas.
- Respetar preferencias de movimiento reducido.
- Diseñar interfaces accesibles.
- Implementar estados de carga, error y ausencia de datos.
- Mantener coherencia entre todas las pantallas.
- Utilizar componentes compartidos.
- Evitar interfaces saturadas.
- Utilizar modo claro inicialmente.
- Considerar modo oscuro posteriormente.

La tienda debe transmitir confianza y calidad.

El panel administrativo debe priorizar productividad y claridad.

## 5. Arquitectura de frontend

Estructura recomendada:

src/
  app/
  components/
    ui/
    layout/
    shared/
  features/
    catalog/
    inventory/
    customers/
    sales/
    credits/
    layaways/
    payments/
    collections/
    deliveries/
    dashboard/
  hooks/
  lib/
  types/
  styles/

supabase/
  migrations/
  functions/
  tests/

tests/
  unit/
  integration/
  e2e/

docs/
  DECISIONS.md
  ROADMAP.md

CLAUDE.md

Separar lógica de negocio, acceso a datos, componentes visuales y validaciones.

## 6. Tienda pública

Funciones aprobadas:

- Página principal.
- Catálogo de iPhone.
- Catálogo de accesorios.
- Categorías.
- Buscador.
- Filtros.
- Fotografías.
- Fichas de productos.
- Precio.
- Disponibilidad.
- Carrito.
- Pedidos por WhatsApp.
- Información de contacto.
- Información sobre entregas.

El carrito preparará un mensaje con productos, cantidades e importes para WhatsApp.

Abrir WhatsApp NO significa confirmar una venta.

No disminuir inventario cuando un cliente únicamente envíe una consulta.

No integrar pagos electrónicos inicialmente.

## 7. Inventario

Los iPhone se administrarán individualmente.

Información posible:
- Identificador interno.
- Modelo.
- Capacidad.
- Color.
- Estado físico.
- Condición: nuevo o seminuevo.
- Salud de batería cuando corresponda.
- Número de serie.
- IMEI privado.
- Costo de adquisición.
- Precio de venta.
- Fotografías.
- Disponibilidad.

Los accesorios podrán manejarse por SKU, variante y cantidad.

Estados de unidad:
- Disponible.
- Reservada.
- Vendida.
- Inactiva.

Reglas:
- No permitir existencias negativas.
- No vender dos veces la misma unidad.
- No vender unidades reservadas.
- Registrar entradas y salidas.
- Conservar historial de movimientos.
- Proteger el costo y el IMEI.
- Guardar el precio y costo histórico al confirmar una venta.

## 8. Clientes

Registrar únicamente información necesaria para operar el negocio.

Información:
- Identificador.
- Nombre.
- Teléfono.
- Medio de contacto.
- Origen de captación.
- Historial de compras.
- Créditos.
- Apartados.
- Notas internas necesarias.

Orígenes de venta:
- Facebook.
- WhatsApp.
- Presencial.
- Otros.

Los datos de clientes serán privados.

No implementar registro público de clientes en la primera versión.

## 9. Ventas

Modalidades:
- Contado.
- Crédito.

Métodos de cobro:
- Efectivo.
- Transferencia.
- Pagos combinados cuando sea necesario.

Estados:
- Pendiente.
- Confirmada.
- Cancelada.

Reglas:
- Registrar productos y precios históricos.
- Actualizar inventario mediante operaciones transaccionales.
- Generar comprobantes.
- Registrar usuario y fecha.
- No confirmar transferencias únicamente por una captura de pantalla.
- Conservar historial de cancelaciones.
- No eliminar operaciones financieras confirmadas.

## 10. Créditos

Funciones:
- Seleccionar cliente.
- Seleccionar productos.
- Establecer precio final financiado.
- Registrar enganche.
- Definir frecuencia y plazo.
- Generar calendario de pagos.
- Registrar abonos.
- Consultar saldo.
- Consultar pagos pendientes.
- Detectar vencimientos.
- Generar comprobantes.
- Liquidar crédito.
- Consultar historial completo.

Frecuencias propuestas:
- Semanal.
- Quincenal.
- Mensual.

Estas frecuencias deben ser configurables; la política definitiva se confirmará con el negocio.

No aplicar intereses ni recargos automáticos hasta aprobar las reglas correspondientes.

Cada crédito debe conservar las condiciones originales pactadas.

El saldo deberá calcularse usando pagos confirmados y correctamente aplicados.

Los pagos pendientes de verificación no disminuyen el saldo confirmado.

Permitir abonos parciales y anticipados.

La forma de distribuir los abonos entre cuotas deberá definirse y probarse antes de activarla.

Nunca borrar pagos confirmados.

Las correcciones deben registrarse como reversos o ajustes auditables.

## 11. Apartados

Funciones:
- Seleccionar producto.
- Seleccionar cliente.
- Registrar anticipo.
- Establecer fecha límite.
- Reservar inventario.
- Registrar abonos.
- Mostrar saldo pendiente.
- Liquidar apartado.
- Convertir apartado liquidado en venta.

El anticipo y la fecha límite serán configurables.

Un producto apartado no podrá venderse a otro cliente mientras su reserva siga vigente.

No liberar automáticamente una reserva vencida hasta aprobar las reglas comerciales.

No inventar políticas de devolución o retención de anticipos.

## 12. Cobranza

Funciones:
- Consultar pagos próximos.
- Consultar pagos vencidos.
- Filtrar clientes.
- Registrar seguimiento.
- Preparar recordatorios personalizados.
- Abrir WhatsApp con el mensaje preparado.

El envío inicial será manual.

No afirmar que un recordatorio fue entregado si solamente se abrió WhatsApp.

No automatizar mensajes sin autorización.

## 13. Entregas

El negocio realiza entregas a domicilio.

Registrar:
- Venta relacionada.
- Dirección necesaria.
- Costo de entrega.
- Estado.
- Fecha programada.
- Fecha de entrega.
- Observaciones.

Estados:
- Pendiente.
- En preparación.
- En camino.
- Entregada.
- Cancelada.

No asumir tarifas ni zonas de cobertura.

## 14. Panel administrativo

Acceso inicial: únicamente el dueño.

Secciones:
- Dashboard.
- Productos.
- Inventario.
- Clientes.
- Ventas.
- Créditos.
- Apartados.
- Abonos.
- Cobranza.
- Entregas.
- Reportes.
- Configuración.

Métricas:
- Ventas del día.
- Ventas del mes.
- Cobros confirmados.
- Créditos activos.
- Cuentas por cobrar.
- Saldos vencidos.
- Productos disponibles.
- Ganancia estimada.

Distinguir siempre entre venta registrada, dinero cobrado y utilidad.

Preparar arquitectura para futuros roles sin implementar cuentas adicionales inicialmente.

## 15. Modelo de datos

Tablas propuestas:

business_settings
profiles
categories
products
product_variants
product_images
product_units
inventory_movements
customers
sales
sale_items
credits
installments
layaways
layaway_items
payments
payment_allocations
deliveries
collection_reminders
audit_logs

Requisitos:
- UUID como identificadores principales.
- Claves foráneas.
- Restricciones CHECK.
- Índices necesarios.
- Fechas de creación y actualización.
- Importes con NUMERIC(14,2).
- No utilizar números flotantes para dinero.
- Migraciones SQL versionadas.
- Integridad referencial.
- Operaciones transaccionales.
- Prevención de duplicados e inconsistencias.

Separar:
- Acuerdo de crédito.
- Calendario de cuotas.
- Pagos recibidos.
- Aplicación de pagos.

Evitar duplicación innecesaria de datos financieros.

## 16. Operaciones transaccionales

Diseñar funciones seguras para:

- Confirmar ventas de contado.
- Confirmar ventas a crédito.
- Reservar inventario.
- Registrar pagos pendientes.
- Confirmar pagos.
- Aplicar abonos.
- Revertir pagos.
- Convertir apartados en ventas.

Una operación debe completarse íntegramente o revertirse.

Evitar condiciones de carrera al vender o reservar inventario.

Utilizar claves de idempotencia para evitar duplicar operaciones por doble clic o reintentos.

Las operaciones financieras deben validar autorización en backend.

## 17. Seguridad

Reglas obligatorias:

- Habilitar Row Level Security.
- Denegar acceso por defecto.
- Permitir acceso público solo a información publicable del catálogo.
- No exponer datos personales.
- No exponer IMEI completo.
- No exponer costos internos.
- No exponer créditos o pagos.
- No incluir claves secretas en frontend.
- No utilizar service_role en el navegador.
- No subir archivos .env al repositorio.
- Proteger comprobantes en almacenamiento privado.
- Validar permisos en base de datos.
- Mantener registros de auditoría.
- Proteger operaciones contra duplicación.
- Minimizar datos personales.
- Preparar respaldos y comprobar restauración.

El administrador será creado mediante un proceso controlado.

No permitir que usuarios públicos se asignen privilegios administrativos.

Antes de lanzar el sistema, revisar las obligaciones legales, fiscales, comerciales y de privacidad aplicables.

## 18. GitHub Pages

La aplicación debe ser compatible con alojamiento estático.

Requisitos:
- Configurar correctamente la base de Vite.
- Utilizar navegación compatible con GitHub Pages.
- Probar enlaces profundos y recargas.
- Configurar GitHub Actions.
- Mantener secretos fuera del código público.
- Configurar correctamente redirecciones de Supabase Auth.
- Preparar migración futura a dominio propio.

No desplegar automáticamente sin aprobación.

## 19. Pruebas

Utilizar:
- Vitest.
- React Testing Library.
- Playwright.
- Pruebas SQL.
- Pruebas RLS.
- Pruebas de concurrencia.

Casos críticos:

1. Vender un iPhone descuenta inventario.
2. No se puede vender dos veces el mismo equipo.
3. Apartar un equipo impide venderlo.
4. Registrar un abono confirmado actualiza el saldo.
5. Un pago duplicado es rechazado.
6. Una transferencia pendiente no cuenta como cobrada.
7. Un crédito liquidado cambia de estado.
8. Un visitante no puede acceder a datos privados.
9. Abrir WhatsApp no confirma una venta.
10. El sistema funciona en dispositivos móviles.
11. La navegación funciona en GitHub Pages.
12. Un reverso conserva el historial financiero.

No avanzar de fase con errores críticos conocidos.

## 20. Roadmap

### Fase 1 — Fundamentos
- Configurar React, Vite y TypeScript.
- Configurar Tailwind y shadcn/ui.
- Crear sistema de diseño.
- Configurar rutas.
- Configurar Supabase.
- Implementar autenticación administrativa.
- Preparar pruebas y CI.

### Fase 2 — Productos e inventario
- Categorías.
- Productos.
- Fotografías.
- Unidades iPhone.
- Variantes de accesorios.
- Movimientos de inventario.

### Fase 3 — Clientes y ventas
- Registro de clientes.
- Ventas de contado.
- Efectivo y transferencias.
- Comprobantes.
- Historial.

### Fase 4 — Créditos
- Crear créditos.
- Calendarios de pago.
- Enganches.
- Abonos.
- Saldos.
- Vencimientos.
- Liquidaciones.

### Fase 5 — Apartados y cobranza
- Crear apartados.
- Reservas de inventario.
- Anticipos.
- Seguimiento.
- Recordatorios por WhatsApp.

### Fase 6 — Tienda pública
- Página principal.
- Catálogo.
- Filtros.
- Fichas de producto.
- Carrito.
- Pedidos por WhatsApp.

### Fase 7 — Entregas y reportes
- Seguimiento de entregas.
- Dashboard.
- Indicadores financieros.
- Reportes de ventas y cobranza.

### Fase 8 — Lanzamiento
- Pruebas integrales.
- Revisión de seguridad.
- Accesibilidad.
- Optimización.
- Respaldos.
- Publicación en GitHub Pages.

## 21. Decisiones pendientes

No inventar:
- Precios reales.
- Catálogo real.
- Tasas de interés.
- Penalizaciones.
- Políticas de cancelación.
- Reglas de devolución de anticipos.
- Plazos máximos de crédito.
- Reglas de aplicación de abonos.
- Tarifas de entrega.
- Política de garantías.
- Requisitos contractuales.
- Información fiscal del negocio.

Consultar al propietario antes de implementar cualquiera de estas reglas.

## 22. Definición de terminado

Una tarea se considera terminada cuando:

1. Cumple los requisitos aprobados.
2. Tiene código claro y tipado.
3. Incluye validaciones.
4. Respeta permisos y seguridad.
5. Tiene las pruebas necesarias.
6. Las pruebas relevantes pasan.
7. El build funciona.
8. La interfaz es responsive.
9. No introduce errores conocidos.
10. Se documentan los cambios y pendientes.

## 23. Primera instrucción para Claude Code

Lee completamente CLAUDE.md.

Estamos comenzando el desarrollo de NovaCell.

Quiero iniciar con la Fase 1.

Primero inspecciona el repositorio y propón:
- Estructura inicial.
- Dependencias.
- Configuración de Vite.
- Sistema de diseño.
- Configuración de GitHub Pages.
- Configuración inicial de Supabase.
- Autenticación del administrador.
- Estrategia de pruebas.

No implementes todavía.

Preséntame el plan, las decisiones pendientes y los criterios de aceptación.

Espera mi aprobación antes de empezar.

## 24. Comandos y estado (actualizado en Fase 7)

- `npm run dev` · `build` · `lint` · `typecheck` · `test` (Vitest) · `test:e2e` (Playwright)
- Pruebas SQL/RLS: `npm run test:db` con `SUPABASE_DB_URL` (bloques DO que revierten todo; corren contra cualquier Postgres, también en CI).
- Migraciones: `npx supabase db push --db-url <url> --yes` (sin Docker ni token, con la contraseña de BD de `.env.local`).
- E2E con Supabase real: definir `E2E_ADMIN_EMAIL` y `E2E_ADMIN_PASSWORD` en el entorno; los datos de prueba llevan prefijo `E2E`.
- Variables: copiar `.env.example` a `.env.local`. `VITE_BASE_PATH` define la base (Pages: `/<repo>/`).
- Enrutado: `HashRouter` (ver `docs/DECISIONS.md`). Creación del admin: `docs/ADMIN_SETUP.md`.
- Despliegue: solo manual vía workflow `deploy.yml` (`workflow_dispatch`).
- Concurrencia real: `SUPABASE_DB_URL=<url> node tests/integration/concurrency.mjs` (ventas) `concurrency-credits.mjs` (créditos) y `concurrency-layaways.mjs` (apartados) (hace COMMIT de datos `CC ` y los limpia). Limpieza manual: `tests/integration/cleanup-test-data.sql`.
- Reglas comerciales propuestas y aún no aprobadas por el negocio: `docs/PENDING_RULES.md` (revisar antes de la Fase 7).
- Tienda pública: el visitante solo lee las vistas `public_*` (columnas explícitas, nunca `select *`). Toda tabla, vista o función nueva debe recibir sus permisos de forma explícita; hay una prueba que falla si `anon` obtiene acceso a algo fuera de la lista permitida.
- Fotos huérfanas en Storage: `node tests/integration/cleanup-storage.mjs` informa y `--apply` elimina (usa la sesión del admin, nunca service_role).
- Pendiente en el panel de Supabase: fijar `max_rows` en 100–200 (no verificable desde el código).
- Funciones nuevas: conceder `EXECUTE` solo a `authenticated` (los privilegios por defecto ya no se heredan) y exigir `assert_admin()`.
- E2E de cobranza: además de las variables habituales requiere `E2E_DB_URL` (Postgres de desarrollo) para simular una cuota vencida.
- Entregas y reportes (Fase 7): toda escritura de `deliveries` es por RPC (`create_delivery`, `set_delivery_status`, `update_delivery`); no hay UPDATE directo. Las métricas del dashboard y de los reportes salen de `dashboard_metrics()` / `report_*` (nunca se recalculan en el navegador). Concurrencia: `SUPABASE_DB_URL=<url> node tests/integration/concurrency-deliveries.mjs`. Reglas D1-D8 y R1-R9 propuestas y aún no aprobadas: `docs/PENDING_RULES.md`.
- Lanzamiento (Fase 8): checklist en `docs/LAUNCH.md`. Accesibilidad: `tests/e2e/a11y.spec.ts` (axe). Antes de cargar datos reales marcar la base con `business_settings.environment = "production"` (bloquea limpieza y concurrencia). La CSP se inyecta solo en el build (`vite.config.ts`): si se añade un dominio externo (imágenes, fuentes, API) hay que agregarlo ahí.
