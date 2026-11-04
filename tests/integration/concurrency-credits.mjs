import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Concurrencia REAL en créditos: varias conexiones simultáneas contra la misma base de datos.
// ¡Hace COMMIT de datos con prefijo "CC " y los limpia al final! Solo para desarrollo.
// Requiere SUPABASE_DB_URL.
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(2)
}
const dir = mkdtempSync(join(tmpdir(), 'novacell-cc2-'))
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
  const base = `35${String(run.replace(/\D/g, '2') + '000000').slice(0, 6)}${String(n).padStart(6, '0')}`
  let total = 0
  for (let i = base.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(base[i])
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    total += d
  }
  return base + ((10 - (total % 10)) % 10)
}

const ids = {
  cat: randomUUID(), prod: randomUUID(), cust: randomUUID(), units: Array.from({ length: 4 }, () => randomUUID()),
}
const setup = `
do $$
begin
  insert into public.categories (id, name, slug, kind) values ('${ids.cat}', 'CC iPhone2 ${run}', 'cc2-ip-${run}', 'iphone');
  insert into public.products (id, category_id, kind, name, slug) values ('${ids.prod}', '${ids.cat}', 'iphone', 'CC iPhone2 ${run}', 'cc2-ip-${run}');
  insert into public.customers (id, name) values ('${ids.cust}', 'CC Cliente2 ${run}');
  ${ids.units.map((u, i) => `insert into public.product_units (id, product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values ('${u}', '${ids.prod}', '${imei(i + 1)}', 128, 'Negro', 'new', 100, 2000);`).join('\n  ')}
end $$;`

const today = new Date().toISOString().slice(0, 10)
const credit = (unit, financed, down, n, key) =>
  `public.create_credit_sale('${ids.cust}', 'other', '[{"unit_id":"${unit}"}]'::jsonb, ${financed}, ${down}, 'weekly', ${n}, '${today}'::date + 30, null, '${key}')`
const pay = (creditId, kind, method, amount, ref, key) =>
  `public.record_credit_payment('${creditId}', '${kind}', '${method}', ${amount}, ${ref ? `'${ref}'` : 'null'}, '${key}')`

async function newCredit(unit, financed, down, n, tag) {
  const key = `cc2-${run}-${tag}`
  const r = await query(asAdmin(credit(unit, financed, down, n, key)))
  if (!r.ok) throw new Error(`No se pudo crear el crédito ${tag}: ${r.out.slice(0, 300)}`)
  return scalar(`select c.id as v from public.credits c join public.sales s on s.id = c.sale_id where s.idempotency_key = '${key}'`)
}

async function main() {
  console.log(`Corrida ${run}: preparando datos…`)
  // Protección: estas pruebas hacen COMMIT y luego borran por prefijo. Nunca contra producción.
  if ((await scalar("select count(*) as v from public.business_settings where key = 'environment' and value = '\"production\"'::jsonb")) !== '0') {
    throw new Error('La base está marcada como producción (business_settings.environment): no se ejecutan pruebas de concurrencia.')
  }
  const s = await query(setup)
  if (!s.ok) throw new Error(`Setup falló: ${s.out.slice(0, 400)}`)

  // G. Principal 1000 sin enganche; 8 abonos simultáneos de 300 → solo caben 3 (900 ≤ 1000; el 4.º excedería).
  const g = await newCredit(ids.units[0], 1000, 0, 4, 'G')
  const G = await Promise.all(Array.from({ length: 8 }, (_, i) => query(asAdmin(pay(g, 'installment', 'cash', 300, null, `cc2-${run}-G-${i}`)))))
  const okG = G.filter((r) => r.ok).length
  const allocG = await scalar(`select coalesce(sum(a.amount),0) as v from public.payment_allocations a join public.installments i on i.id = a.installment_id where i.credit_id = '${g}' and a.reversed_at is null`)
  const balG = await scalar(`select balance as v from public.credit_summaries where id = '${g}'`)
  check('G: 8 abonos simultáneos de 300 sobre un saldo de 1000 → exactamente 3 se aceptan', okG === 3, `${okG} aceptados`)
  check('G: lo aplicado nunca excede el principal y el saldo es coherente', Number(allocG) === 900 && Number(balG) === 100, `aplicado=${allocG}, saldo=${balG}`)

  // H. Una transferencia pendiente confirmada 4 veces a la vez → se aplica una sola vez.
  const h = await newCredit(ids.units[1], 1000, 0, 4, 'H')
  await query(asAdmin(pay(h, 'installment', 'transfer', 400, `CC-H-${run}`, `cc2-${run}-H-pay`)))
  const payH = await scalar(`select p.id as v from public.payments p where p.idempotency_key = 'cc2-${run}-H-pay'`)
  await Promise.all(Array.from({ length: 4 }, () => query(asAdmin(`public.confirm_payment('${payH}')`))))
  const allocH = await scalar(`select coalesce(sum(amount),0) as v from public.payment_allocations where payment_id = '${payH}'`)
  check('H: confirmar el mismo pago 4 veces simultáneas lo aplica una sola vez', Number(allocH) === 400, `aplicado=${allocH}`)

  // I. Confirmar contra rechazar el mismo pago pendiente → estado final consistente.
  const iCredit = await newCredit(ids.units[2], 1000, 0, 4, 'I')
  await query(asAdmin(pay(iCredit, 'installment', 'transfer', 500, `CC-I-${run}`, `cc2-${run}-I-pay`)))
  const payI = await scalar(`select p.id as v from public.payments p where p.idempotency_key = 'cc2-${run}-I-pay'`)
  await Promise.all([
    query(asAdmin(`public.confirm_payment('${payI}')`)),
    query(asAdmin(`public.reject_payment('${payI}', 'concurrencia')`)),
    query(asAdmin(`public.confirm_payment('${payI}')`)),
    query(asAdmin(`public.reject_payment('${payI}', 'concurrencia')`)),
  ])
  const stI = await scalar(`select status as v from public.payments where id = '${payI}'`)
  const allocI = await scalar(`select coalesce(sum(amount),0) as v from public.payment_allocations where payment_id = '${payI}'`)
  const consistentI = (stI === 'confirmed' && Number(allocI) === 500) || (stI === 'rejected' && Number(allocI) === 0)
  check('I: confirmar y rechazar a la vez deja un estado consistente', consistentI, `pago=${stI}, aplicado=${allocI}`)

  // J. Enganche de 500 en dos pagos de 250 simultáneos → el crédito se activa una sola vez (una sola salida de inventario).
  const j = await newCredit(ids.units[3], 2000, 500, 4, 'J')
  await Promise.all([
    query(asAdmin(pay(j, 'down_payment', 'cash', 250, null, `cc2-${run}-J-a`))),
    query(asAdmin(pay(j, 'down_payment', 'cash', 250, null, `cc2-${run}-J-b`))),
  ])
  const stJ = await scalar(`select status as v from public.credits where id = '${j}'`)
  const exitsJ = await scalar(`select count(*) as v from public.inventory_movements where product_unit_id = '${ids.units[3]}' and movement_type = 'exit'`)
  const unitJ = await scalar(`select status as v from public.product_units where id = '${ids.units[3]}'`)
  check('J: dos pagos de enganche simultáneos activan el crédito una sola vez', stJ === 'active' && exitsJ === '1' && unitJ === 'sold', `crédito=${stJ}, salidas=${exitsJ}, unidad=${unitJ}`)

  // Invariantes globales de la corrida
  const bad = await scalar(`select count(*) as v from public.installment_status where paid > amount or remaining < 0`)
  check('Invariante: ninguna cuota pagada de más', bad === '0')
  const diverge = await scalar(`select count(*) as v from public.credit_summaries s where s.status in ('active','settled') and s.balance <> s.principal - s.installments_paid`)
  check('Invariante: saldo = principal - aplicado', diverge === '0')
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
