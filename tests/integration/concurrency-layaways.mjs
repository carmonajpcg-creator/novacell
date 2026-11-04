import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Concurrencia REAL en apartados: varias conexiones simultáneas contra la misma base de datos.
// ¡Hace COMMIT de datos con prefijo "CC " y los limpia al final! Solo para desarrollo.
// Requiere SUPABASE_DB_URL.
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(2)
}
const dir = mkdtempSync(join(tmpdir(), 'novacell-cc3-'))
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
  const base = `35${String(run.replace(/\D/g, '3') + '000000').slice(0, 6)}${String(n).padStart(6, '0')}`
  let total = 0
  for (let i = base.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(base[i])
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    total += d
  }
  return base + ((10 - (total % 10)) % 10)
}

const ids = { cat: randomUUID(), prod: randomUUID(), cust: randomUUID(), units: Array.from({ length: 6 }, () => randomUUID()) }
const setup = `
do $$
begin
  insert into public.categories (id, name, slug, kind) values ('${ids.cat}', 'CC iPhone3 ${run}', 'cc3-ip-${run}', 'iphone');
  insert into public.products (id, category_id, kind, name, slug) values ('${ids.prod}', '${ids.cat}', 'iphone', 'CC iPhone3 ${run}', 'cc3-ip-${run}');
  insert into public.customers (id, name) values ('${ids.cust}', 'CC Cliente3 ${run}');
  ${ids.units.map((u, i) => `insert into public.product_units (id, product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values ('${u}', '${ids.prod}', '${imei(i + 1)}', 128, 'Negro', 'new', 100, 1000);`).join('\n  ')}
end $$;`

const today = new Date().toISOString().slice(0, 10)
const layaway = (unit, down, key) =>
  `public.create_layaway('${ids.cust}', 'other', '[{"unit_id":"${unit}"}]'::jsonb, ${down}, '${today}'::date + 30, null, '${key}')`
const pay = (id, method, amount, ref, key) =>
  `public.record_layaway_payment('${id}', '${method}', ${amount}, ${ref ? `'${ref}'` : 'null'}, '${key}')`

async function newLayaway(unit, down, tag) {
  const key = `cc3-${run}-${tag}`
  const r = await query(asAdmin(layaway(unit, down, key)))
  if (!r.ok) throw new Error(`No se pudo crear el apartado ${tag}: ${r.out.slice(0, 300)}`)
  return scalar(`select l.id as v from public.layaways l join public.sales s on s.id = l.sale_id where s.idempotency_key = '${key}'`)
}

async function main() {
  console.log(`Corrida ${run}: preparando datos…`)
  // Protección: estas pruebas hacen COMMIT y luego borran por prefijo. Nunca contra producción.
  if ((await scalar("select count(*) as v from public.business_settings where key = 'environment' and value = '\"production\"'::jsonb")) !== '0') {
    throw new Error('La base está marcada como producción (business_settings.environment): no se ejecutan pruebas de concurrencia.')
  }
  const s = await query(setup)
  if (!s.ok) throw new Error(`Setup falló: ${s.out.slice(0, 400)}`)

  // A. Misma unidad, 5 apartados simultáneos con claves distintas → solo 1 gana.
  const A = await Promise.all(Array.from({ length: 5 }, (_, i) => query(asAdmin(layaway(ids.units[0], 100, `cc3-${run}-A-${i}`)))))
  const winners = A.filter((r) => r.ok).length
  check('A: 5 apartados simultáneos de la misma unidad → solo 1 se crea', winners === 1, `${winners} exitosos`)
  check('A: la unidad queda reservada una sola vez', (await scalar(`select count(*) as v from public.sale_items where product_unit_id = '${ids.units[0]}'`)) === '1')

  // B. Total 1000, 6 pagos simultáneos de 400 → solo caben 2 (800 ≤ 1000; un tercero excedería).
  const b = await newLayaway(ids.units[1], 100, 'B')
  const B = await Promise.all(Array.from({ length: 6 }, (_, i) => query(asAdmin(pay(b, 'cash', 400, null, `cc3-${run}-B-${i}`)))))
  const okB = B.filter((r) => r.ok).length
  const paidB = await scalar(`select confirmed_paid as v from public.layaway_summaries where id = '${b}'`)
  check('B: 6 pagos simultáneos de 400 sobre un saldo de 1000 → exactamente 2 se aceptan', okB === 2, `${okB} aceptados`)
  check('B: lo cobrado nunca excede el total y el estado es coherente', Number(paidB) === 800 && (await scalar(`select status as v from public.layaways where id = '${b}'`)) === 'active', `cobrado=${paidB}`)

  // C. Convertir 4 veces a la vez un apartado liquidado → una sola entrega (una salida de inventario).
  const c = await newLayaway(ids.units[2], 1000, 'C')
  await query(asAdmin(pay(c, 'cash', 1000, null, `cc3-${run}-C-pay`)))
  const stC = await scalar(`select status as v from public.layaways where id = '${c}'`)
  await Promise.all(Array.from({ length: 4 }, () => query(asAdmin(`public.convert_layaway('${c}')`))))
  const exitsC = await scalar(`select count(*) as v from public.inventory_movements where product_unit_id = '${ids.units[2]}' and movement_type = 'exit'`)
  check('C: el apartado quedó liquidado antes de convertir', stC === 'settled')
  check('C: convertir 4 veces a la vez → una sola salida y unidad vendida', exitsC === '1' && (await scalar(`select status as v from public.product_units where id = '${ids.units[2]}'`)) === 'sold', `salidas=${exitsC}`)

  // D. Pago en efectivo contra cancelación del mismo apartado → estado final consistente.
  const d = await newLayaway(ids.units[3], 100, 'D')
  const saleD = await scalar(`select sale_id as v from public.layaways where id = '${d}'`)
  await Promise.all([
    query(asAdmin(pay(d, 'cash', 100, null, `cc3-${run}-D-pay`))),
    query(asAdmin(`public.cancel_sale('${saleD}', 'concurrencia')`)),
    query(asAdmin(`public.cancel_sale('${saleD}', 'concurrencia')`)),
  ])
  const stD = await scalar(`select status as v from public.layaways where id = '${d}'`)
  const confirmedD = await scalar(`select count(*) as v from public.payments where sale_id = '${saleD}' and status = 'confirmed'`)
  const unitD = await scalar(`select status as v from public.product_units where id = '${ids.units[3]}'`)
  const consistentD =
    (stD === 'cancelled' && confirmedD === '0' && unitD === 'available') ||
    (stD !== 'cancelled' && confirmedD === '1' && unitD === 'reserved')
  check('D: pagar y cancelar a la vez deja un estado consistente (nunca un anticipo cobrado con el equipo liberado)', consistentD, `apartado=${stD}, cobrados=${confirmedD}, unidad=${unitD}`)

  // E. Confirmar contra rechazar la misma transferencia pendiente → estado consistente.
  const e = await newLayaway(ids.units[4], 500, 'E')
  await query(asAdmin(pay(e, 'transfer', 500, `CC3-E-${run}`, `cc3-${run}-E-pay`)))
  const payE = await scalar(`select p.id as v from public.payments p where p.idempotency_key = 'cc3-${run}-E-pay'`)
  await Promise.all([
    query(asAdmin(`public.confirm_payment('${payE}')`)),
    query(asAdmin(`public.reject_payment('${payE}', 'concurrencia')`)),
    query(asAdmin(`public.confirm_payment('${payE}')`)),
    query(asAdmin(`public.reject_payment('${payE}', 'concurrencia')`)),
  ])
  const stE = await scalar(`select status as v from public.payments where id = '${payE}'`)
  const layE = await scalar(`select status as v from public.layaways where id = '${e}'`)
  const consistentE = (stE === 'confirmed' && layE === 'active') || (stE === 'rejected' && layE === 'pending_down')
  check('E: confirmar y rechazar a la vez deja pago y apartado coherentes', consistentE, `pago=${stE}, apartado=${layE}`)

  // F. Liquidado: convertir contra revertir el pago → o se convierte (y el reverso se bloquea) o se reabre (y no se convierte).
  const f = await newLayaway(ids.units[5], 1000, 'F')
  await query(asAdmin(pay(f, 'cash', 1000, null, `cc3-${run}-F-pay`)))
  const payF = await scalar(`select p.id as v from public.payments p where p.idempotency_key = 'cc3-${run}-F-pay'`)
  await Promise.all([
    query(asAdmin(`public.convert_layaway('${f}')`)),
    query(asAdmin(`public.reverse_payment('${payF}', 'concurrencia')`)),
  ])
  const layF = await scalar(`select status as v from public.layaways where id = '${f}'`)
  const payStF = await scalar(`select status as v from public.payments where id = '${payF}'`)
  const unitF = await scalar(`select status as v from public.product_units where id = '${ids.units[5]}'`)
  const consistentF =
    (layF === 'converted' && payStF === 'confirmed' && unitF === 'sold') ||
    (layF === 'active' && payStF === 'reversed' && unitF === 'reserved') ||
    (layF === 'pending_down' && payStF === 'reversed' && unitF === 'reserved')
  check('F: convertir y revertir a la vez nunca vende un equipo sin dinero cobrado', consistentF, `apartado=${layF}, pago=${payStF}, unidad=${unitF}`)

  // Invariantes globales de la corrida
  const bad = await scalar(`select count(*) as v from public.layaway_summaries s where s.customer_id = '${ids.cust}' and ((s.status = 'pending_down' and s.confirmed_paid >= s.down_payment) or (s.status = 'active' and (s.confirmed_paid < s.down_payment or s.confirmed_paid >= s.total)) or (s.status in ('settled','converted') and s.confirmed_paid <> s.total))`)
  check('Invariante: el estado del apartado coincide con lo cobrado', bad === '0')
  const orphan = await scalar(`select count(*) as v from public.product_units u where u.product_id = '${ids.prod}' and u.status in ('reserved','sold') and not exists (select 1 from public.sale_items i join public.sales s on s.id = i.sale_id where i.product_unit_id = u.id and s.status <> 'cancelled')`)
  check('Invariante: ninguna unidad reservada/vendida sin venta vigente', orphan === '0', `huérfanas=${orphan}`)
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
