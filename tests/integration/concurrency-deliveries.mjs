import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Concurrencia REAL en entregas: varias conexiones simultáneas contra la misma base de datos.
// ¡Hace COMMIT de datos con prefijo "CC " y los limpia al final! Solo para desarrollo.
// Requiere SUPABASE_DB_URL.
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(2)
}
const dir = mkdtempSync(join(tmpdir(), 'novacell-cc4-'))
const run = randomUUID().slice(0, 8)
let seq = 0

function query(sql, { readOnly = false } = {}) {
  return new Promise((resolve) => {
    const file = join(dir, `q${++seq}.sql`)
    writeFileSync(file, sql)
    const args = ['supabase', 'db', 'query', `--remote=${url}`, '--yes', '-f', file]
    if (readOnly) args.push('--read-only')
    const p = spawn('npx', args, { shell: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ ok: code === 0, out }))
  })
}

async function scalar(sql) {
  const r = await query(sql, { readOnly: true })
  const m = r.out.match(/"v":\s*"?([^",\s}]+)"?/)
  if (!m) throw new Error(`No se pudo leer el resultado: ${r.out.slice(0, 300)}`)
  return m[1]
}

const asAdmin = (call) => `
do $$
declare admin uuid;
begin
  select id into admin from public.profiles where role = 'admin' limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform ${call};
end $$;`

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok   ' : 'FAIL '}${name}${detail ? ` (${detail})` : ''}`)
  if (!cond) failures++
}

function imei(n) {
  const base = `35${String(run.replace(/\D/g, '4') + '000000').slice(0, 6)}${String(n).padStart(6, '0')}`
  let total = 0
  for (let i = base.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(base[i])
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    total += d
  }
  return base + ((10 - (total % 10)) % 10)
}

const ids = { cat: randomUUID(), prod: randomUUID(), cust: randomUUID(), units: Array.from({ length: 4 }, () => randomUUID()) }
const setup = `
do $$
begin
  insert into public.categories (id, name, slug, kind) values ('${ids.cat}', 'CC iPhone4 ${run}', 'cc4-ip-${run}', 'iphone');
  insert into public.products (id, category_id, kind, name, slug) values ('${ids.prod}', '${ids.cat}', 'iphone', 'CC iPhone4 ${run}', 'cc4-ip-${run}');
  insert into public.customers (id, name) values ('${ids.cust}', 'CC Cliente4 ${run}');
  ${ids.units.map((u, i) => `insert into public.product_units (id, product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values ('${u}', '${ids.prod}', '${imei(i + 1)}', 128, 'Negro', 'new', 100, 1000);`).join('\n  ')}
end $$;`

const delivery = (sale, key, addr = 'Calle de Concurrencia 123, CDMX') =>
  `public.create_delivery('${sale}', '${addr}', null, 0, null, null, '${key}')`

// Venta de contado ya cobrada (confirmada): las únicas que admiten entrega.
async function confirmedSale(unit, tag) {
  const key = `cc4-${run}-${tag}`
  const r = await query(asAdmin(`public.create_sale('${ids.cust}', 'other', '[{"unit_id":"${unit}"}]'::jsonb, null, '${key}')`))
  if (!r.ok) throw new Error(`No se pudo crear la venta ${tag}: ${r.out.slice(0, 300)}`)
  const sale = await scalar(`select id as v from public.sales where idempotency_key = '${key}'`)
  const p = await query(asAdmin(`public.record_payment('${sale}', 'cash', 1000, null, '${key}-pay')`))
  if (!p.ok) throw new Error(`No se pudo cobrar la venta ${tag}: ${p.out.slice(0, 300)}`)
  return sale
}

async function newDelivery(sale, tag) {
  const key = `cc4-${run}-d-${tag}`
  const r = await query(asAdmin(delivery(sale, key)))
  if (!r.ok) throw new Error(`No se pudo crear la entrega ${tag}: ${r.out.slice(0, 300)}`)
  return scalar(`select id as v from public.deliveries where idempotency_key = '${key}'`)
}

async function main() {
  console.log(`Corrida ${run}: preparando datos…`)
  // Protección: estas pruebas hacen COMMIT y luego borran por prefijo. Nunca contra producción.
  if ((await scalar("select count(*) as v from public.business_settings where key = 'environment' and value = '\"production\"'::jsonb")) !== '0') {
    throw new Error('La base está marcada como producción (business_settings.environment): no se ejecutan pruebas de concurrencia.')
  }
  const s = await query(setup)
  if (!s.ok) throw new Error(`Setup falló: ${s.out.slice(0, 400)}`)

  // A. Misma venta, 5 entregas simultáneas con claves distintas → solo 1 vigente.
  const saleA = await confirmedSale(ids.units[0], 'A')
  const A = await Promise.all(Array.from({ length: 5 }, (_, i) => query(asAdmin(delivery(saleA, `cc4-${run}-A-${i}`)))))
  const winners = A.filter((r) => r.ok).length
  const vigentes = await scalar(`select count(*) as v from public.deliveries where sale_id = '${saleA}' and status <> 'cancelled'`)
  check('A: 5 entregas simultáneas de la misma venta → solo 1 se crea', winners === 1 && vigentes === '1', `${winners} exitosas, ${vigentes} vigentes`)

  // B. Misma clave de idempotencia 4 veces a la vez → una sola fila y ningún error de integridad.
  const saleB = await confirmedSale(ids.units[1], 'B')
  const B = await Promise.all(Array.from({ length: 4 }, () => query(asAdmin(delivery(saleB, `cc4-${run}-B-same`)))))
  const rowsB = await scalar(`select count(*) as v from public.deliveries where sale_id = '${saleB}'`)
  check('B: la misma clave 4 veces a la vez → una sola entrega', rowsB === '1', `${B.filter((r) => r.ok).length} respuestas correctas`)

  // C. Entregada contra cancelada sobre la misma entrega → un solo estado terminal, con sus fechas coherentes.
  const saleC = await confirmedSale(ids.units[2], 'C')
  const c = await newDelivery(saleC, 'C')
  await Promise.all([
    query(asAdmin(`public.set_delivery_status('${c}', 'delivered', null)`)),
    query(asAdmin(`public.set_delivery_status('${c}', 'cancelled', 'concurrencia')`)),
    query(asAdmin(`public.set_delivery_status('${c}', 'delivered', null)`)),
    query(asAdmin(`public.set_delivery_status('${c}', 'cancelled', 'concurrencia')`)),
  ])
  const stC = await scalar(`select status as v from public.deliveries where id = '${c}'`)
  const datesC = await scalar(`select (delivered_at is not null)::int * 10 + (cancelled_at is not null)::int as v from public.deliveries where id = '${c}'`)
  check('C: entregar y cancelar a la vez deja un estado terminal único', (stC === 'delivered' && datesC === '10') || (stC === 'cancelled' && datesC === '1'), `estado=${stC}, fechas=${datesC}`)

  // D. Editar contra cancelar la misma entrega → una edición nunca modifica una entrega ya terminal.
  const saleD = await confirmedSale(ids.units[3], 'D')
  const d = await newDelivery(saleD, 'D')
  await Promise.all([
    query(asAdmin(`public.update_delivery('${d}', 'Direccion editada 456, CDMX', null, 50, null, null)`)),
    query(asAdmin(`public.set_delivery_status('${d}', 'cancelled', 'concurrencia')`)),
    query(asAdmin(`public.update_delivery('${d}', 'Direccion editada 789, CDMX', null, 70, null, null)`)),
  ])
  const stD = await scalar(`select status as v from public.deliveries where id = '${d}'`)
  const auditD = await scalar(`select count(*) as v from public.audit_logs where entity = 'deliveries' and entity_id = '${d}' and action = 'update_delivery'`)
  const lastEditAfterCancel = await scalar(`select count(*) as v from public.audit_logs a join public.deliveries x on x.id = a.entity_id where a.entity = 'deliveries' and a.entity_id = '${d}' and a.action = 'update_delivery' and x.cancelled_at is not null and a.created_at > x.cancelled_at`)
  check('D: editar y cancelar a la vez termina cancelada y ninguna edición ocurre después de cancelar', stD === 'cancelled' && lastEditAfterCancel === '0', `ediciones=${auditD}`)

  // Invariantes globales de la corrida
  const dup = await scalar(`select count(*) as v from (select sale_id from public.deliveries d join public.sales s on s.id = d.sale_id where s.customer_id = '${ids.cust}' and d.status <> 'cancelled' group by sale_id having count(*) > 1) t`)
  check('Invariante: nunca hay dos entregas vigentes para una venta', dup === '0')
  const bad = await scalar(`select count(*) as v from public.deliveries d join public.sales s on s.id = d.sale_id where s.customer_id = '${ids.cust}' and ((d.status = 'delivered' and d.delivered_at is null) or (d.status = 'cancelled' and d.cancelled_at is null) or (d.status not in ('delivered','cancelled') and (d.delivered_at is not null or d.cancelled_at is not null)))`)
  check('Invariante: las fechas de entrega/cancelación coinciden con el estado', bad === '0')
}

try {
  await main()
} catch (e) {
  console.error('ERROR:', e.message)
  failures++
} finally {
  const cleanup = spawnSync('npx', ['supabase', 'db', 'query', `--remote=${url}`, '--yes', '-f', 'tests/integration/cleanup-test-data.sql'], { shell: true, encoding: 'utf8' })
  console.log(cleanup.status === 0 ? 'Datos de prueba limpiados.' : `LIMPIEZA FALLÓ: ${cleanup.stdout}${cleanup.stderr}`)
}
process.exit(failures > 0 ? 1 : 0)
