# Lanzamiento de NovaCell (Fase 8)

Estado de cada punto: **Hecho** (verificado en el repo), **Tuyo** (requiere tu cuenta/decisión) o **Abierto**.

## 1. Seguridad
| Punto | Estado |
|-------|--------|
| RLS en todas las tablas, vistas `public_*` sin IMEI/costos/notas, funciones `SECURITY DEFINER` con `search_path=''` y `assert_admin()` | Hecho (revisión de Opus, fases 3–8) |
| IMEI, serie, costo y precio de una unidad reservada/vendida no se cambian; todo cambio queda en bitácora | Hecho (migración 0016) |
| La bitácora (`audit_logs`) solo la escribe el sistema | Hecho (0016) |
| Funciones nuevas ya no heredan EXECUTE para `PUBLIC` | Hecho (0016) |
| CSP en el build (`script-src 'self'`, `connect-src` solo Supabase) y `referrer: no-referrer` | Hecho (vite.config.ts) |
| Caché de datos privados se borra al cerrar sesión | Hecho |
| CI con permisos mínimos y CLI de Supabase fijado | Hecho |
| Verificación en dos pasos (TOTP): pantalla de alta en Configuración → Seguridad, paso de código al iniciar sesión, e interruptor en la base (`set_require_mfa`, solo desde una sesión aal2 y con un factor verificado; `is_admin()` exige aal2 cuando está encendido) | **Hecho el código; falta activarlo TÚ**: entrar a Configuración → Seguridad, escanear el QR con tu app y pulsar «Exigir verificación en dos pasos». Yo no puedo hacerlo porque requiere tu teléfono. |
| Contraseña del admin de 12+ caracteres, protección contra contraseñas filtradas, límites de intentos, registro de usuarios desactivado, URLs de redirección | **Tuyo** (panel de Supabase → Authentication). No verificable desde el código. |
| `max_rows` en 100–200 (panel de Supabase → API) | **Tuyo** |
| Clickjacking: GitHub Pages no permite `X-Frame-Options`; se resuelve al pasar a dominio propio con CDN/proxy | Abierto (aceptado para la etapa inicial) |

## 2. Separar pruebas de producción (hallazgo ALTO de la revisión)
Hoy existe **un solo proyecto Supabase** y las pruebas E2E/concurrencia/limpieza escriben ahí con prefijos `E2E ` / `CC `.
Antes de cargar datos reales:
1. Crear un segundo proyecto (desarrollo) y correr ahí las pruebas; o **marcar este como producción**:
   `insert into public.business_settings (key, value) values ('environment', '"production"');`
   Con esa marca, `cleanup-test-data.sql` y los scripts de concurrencia se niegan a ejecutarse.
2. No correr `npm run test:e2e` con credenciales reales de producción; usar datos de un proyecto de desarrollo.
3. Las pruebas SQL (`npm run test:db`) revierten todo y son seguras en cualquier base.

## 3. Respaldos (CLAUDE.md §17)
- El plan gratuito de Supabase **no incluye respaldos automáticos**. Opciones: plan Pro (respaldos diarios) o un `pg_dump` programado fuera de GitHub (los datos de clientes y pagos son personales; evitar guardarlos como artefactos de Actions).
- **Abierto / Tuyo**: elegir opción. En este equipo no hay `pg_dump` ni Docker, por lo que no pude generar ni **restaurar** un respaldo de prueba; la restauración debe comprobarse en un proyecto vacío antes del lanzamiento.
- Las migraciones versionadas (`supabase/migrations`) reconstruyen el esquema completo; los datos solo se recuperan con respaldo.

## 4. Publicación en GitHub Pages
- Workflow manual `deploy.yml` (`workflow_dispatch`), construye con `VITE_BASE_PATH=/<repo>/` y las variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (públicas) del repositorio.
- Pendiente de **tu autorización explícita** (CLAUDE.md §15). Requisitos: repositorio con Pages habilitado (un repo privado exige un plan que lo permita; si no, hacerlo público expone solo código, nunca claves secretas), variables configuradas en Settings → Variables, y en Supabase → Authentication → URL Configuration el sitio publicado.
- Navegación: `HashRouter`; enlaces profundos y recargas probados en E2E sobre el build.

## 5. Legal y datos del negocio (CLAUDE.md §17, §21)
Sin definir por el negocio (no se inventaron): datos fiscales, garantías, devoluciones de ventas confirmadas, retención de anticipos, aviso de privacidad, tarifas y zonas de entrega, precios y catálogo reales. Revisar obligaciones legales, fiscales y de privacidad antes de abrir.
