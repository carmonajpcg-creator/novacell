import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Prueba de concurrencia REAL: varias conexiones simultáneas contra la misma base de datos.
// ¡Hace COMMIT de datos con prefijo "CC " y los limpia al final! Solo para desarrollo.
// Requiere SUPABASE_DB_URL.
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(2)
}
const dir = mkdtempSync(join(tmpdir(), 'novacell-cc-'))
const run = randomUUID().slice(0, 8)
let seq = 0

function sqlFile(sql) {
  const file = join(dir, `q${++seq}.sql`)
  writeFileSync(file, sql)
  return file
}

function query(sql, { readOnly = false } = {}) {
  return new Promise((resolve) => {
    const args = ['supabase', 'db', 'query', `--remote=${url}`, '--yes', '-f', sqlFile(sql)]
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

const ids = {
  cat: randomUUID(), prod: randomUUID(), pacc: randomUUID(), cust: randomUUID(), catAcc: randomUUID(),
  variant: randomUUID(),
  units: Array.from({ length: 6 }, () => randomUUID()),
}
// IMEIs válidos distintos (Luhn): se generan a partir de un prefijo y se calcula el dígito verificador.
function imei(n) {
  const base = `35${String(run.replace(/\D/g, '1') + '000000').slice(0, 6)}${String(n).padStart(6, '0')}`
  let total = 0
  for (let i = base.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(base[i])
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    total += d
  }
  return base + ((10 - (total % 10)) % 10)
}

const setup = `
do $$
begin
  insert into public.categories (id, name, slug, kind) values ('${ids.cat}', 'CC iPhone ${run}', 'cc-ip-${run}', 'iphone');
  insert into public.categories (id, name, slug, kind) values ('${ids.catAcc}', 'CC Acc ${run}', 'cc-acc-${run}', 'accessory');
  insert into public.products (id, category_id, kind, name, slug) values ('${ids.prod}', '${ids.cat}', 'iphone', 'CC iPhone ${run}', 'cc-ip-${run}');
  insert into public.products (id, category_id, kind, name, slug) values ('${ids.pacc}', '${ids.catAcc}', 'accessory', 'CC Funda ${run}', 'cc-fun-${run}');
  insert into public.product_variants (id, product_id, sku, price, cost, stock_quantity) values ('${ids.variant}', '${ids.pacc}', 'CC-${run}', 100, 40, 3);
  insert into public.customers (id, name) values ('${ids.cust}', 'CC Cliente ${run}');
  ${ids.units.map((u, i) => `insert into public.product_units (id, product_id, imei, storage_gb, color, condition, acquisition_cost, sale_price) values ('${u}', '${ids.prod}', '${imei(i + 1)}', 128, 'Negro', 'new', 100, 200);`).join('\n  ')}
end $$;`

const sale = (items, key) =>
  `public.create_sale('${ids.cust}', 'other', '${JSON.stringify(items)}'::jsonb, null, '${key}')`

async function main() {
  console.log(`Corrida ${run}: preparando datos…`)
  const s = await query(setup)
  if (!s.ok) throw new Error(`Setup falló: ${s.out.slice(0, 400)}`)

  // A. Misma unidad, 6 ventas simultáneas con claves distintas → exactamente 1 gana.
  const A = await Promise.all(
    Array.from({ length: 6 }, (_, i) => query(asAdmin(sale([{ unit_id: ids.units[0] }], `cc-${run}-A-${i}`)))),
  )
  const winnersA = A.filter((r) => r.ok).length
  check('A: 6 ventas simultáneas de la misma unidad → solo 1 se crea', winnersA === 1, `${winnersA} exitosas`)
  check('A: la unidad queda reservada una sola vez',
    (await scalar(`select count(*) as v from public.sale_items where product_unit_id = '${ids.units[0]}'`)) === '1')

  // B. Stock 3, 8 ventas simultáneas de 1 unidad → exactamente 3 ganan y el stock llega a 0 (nunca negativo).
  const B = await Promise.all(
    Array.from({ length: 8 }, (_, i) => query(asAdmin(sale([{ variant_id: ids.variant, quantity: 1 }], `cc-${run}-B-${i}`)))),
  )
  const winnersB = B.filter((r) => r.ok).length
  const stock = await scalar(`select stock_quantity as v from public.product_variants where id = '${ids.variant}'`)
  check('B: 8 ventas simultáneas con stock 3 → exactamente 3 se crean', winnersB === 3, `${winnersB} exitosas`)
  check('B: el stock final es 0 y no negativo', stock === '0', `stock=${stock}`)

  // C. Misma clave de idempotencia en 4 solicitudes simultáneas → una sola venta.
  const keyC = `cc-${run}-C-same`
  const C = await Promise.all(Array.from({ length: 4 }, () => query(asAdmin(sale([{ unit_id: ids.units[1] }], keyC)))))
  const salesC = await scalar(`select count(*) as v from public.sales where idempotency_key = '${keyC}'`)
  check('C: 4 solicitudes simultáneas con la misma clave → 1 sola venta', salesC === '1', `ventas=${salesC}`)
  check('C: ninguna de las 4 falla (devuelven la misma venta)', C.every((r) => r.ok), `${C.filter((r) => !r.ok).length} fallas`)

  // D. Cobro simultáneo: venta de 200, 5 pagos en efectivo de 80 al mismo tiempo → como máximo 2 caben (160 ≤ 200).
  await query(asAdmin(sale([{ unit_id: ids.units[2] }], `cc-${run}-D-sale`)))
  const saleDid = await scalar(`select id as v from public.sales where idempotency_key = 'cc-${run}-D-sale'`)
  const D = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      query(asAdmin(`public.record_payment('${saleDid}', 'cash', 80, null, 'cc-${run}-D-pay-${i}')`))),
  )
  const paid = await scalar(`select coalesce(sum(amount),0) as v from public.payments where sale_id = '${saleDid}' and status = 'confirmed'`)
  check('D: pagos simultáneos nunca exceden el total de la venta', Number(paid) <= 200, `cobrado=${paid}, exitosos=${D.filter((r) => r.ok).length}`)
  check('D: se aceptan exactamente 2 pagos de 80', D.filter((r) => r.ok).length === 2)

  // E. Misma referencia de transferencia en 2 ventas distintas simultáneas → solo 1 se registra.
  await query(asAdmin(sale([{ unit_id: ids.units[3] }], `cc-${run}-E-sale1`)))
  await query(asAdmin(sale([{ unit_id: ids.units[4] }], `cc-${run}-E-sale2`)))
  const getId = (k) => scalar(`select id as v from public.sales where idempotency_key = '${k}'`)
  const e1 = await getId(`cc-${run}-E-sale1`)
  const e2 = await getId(`cc-${run}-E-sale2`)
  const E = await Promise.all([
    query(asAdmin(`public.record_payment('${e1}', 'transfer', 200, 'CC-REF-${run}', 'cc-${run}-E-pay1')`)),
    query(asAdmin(`public.record_payment('${e2}', 'transfer', 200, 'CC-REF-${run}', 'cc-${run}-E-pay2')`)),
  ])
  check('E: la misma referencia de transferencia simultánea solo se acepta una vez', E.filter((r) => r.ok).length === 1)

  // F. Confirmar y cancelar al mismo tiempo la misma venta → estado final consistente.
  const payE = await scalar(`select id as v from public.payments where sale_id in ('${e1}','${e2}') and status = 'pending'`)
  const saleF = await scalar(`select sale_id as v from public.payments where id = '${payE}'`)
  await Promise.all([
    query(asAdmin(`public.confirm_payment('${payE}')`)),
    query(asAdmin(`public.cancel_sale('${saleF}', 'concurrencia')`)),
    query(asAdmin(`public.confirm_payment('${payE}')`)),
    query(asAdmin(`public.cancel_sale('${saleF}', 'concurrencia')`)),
  ])
  const st = await scalar(`select status as v from public.sales where id = '${saleF}'`)
  const unitSt = await scalar(`select u.status as v from public.sale_items i join public.product_units u on u.id = i.product_unit_id where i.sale_id = '${saleF}'`)
  const payStatus = await scalar(`select status as v from public.payments where id = '${payE}'`)
  const exits = await scalar(`select count(*) as v from public.inventory_movements m join public.sale_items i on i.product_unit_id = m.product_unit_id where i.sale_id = '${saleF}' and m.movement_type = 'exit'`)
  const consistent =
    (st === 'confirmed' && unitSt === 'sold' && payStatus === 'confirmed' && exits === '1') ||
    (st === 'cancelled' && unitSt === 'available' && payStatus === 'rejected' && exits === '0')
  check('F: confirmar y cancelar simultáneamente deja un estado consistente', consistent, `venta=${st}, unidad=${unitSt}, pago=${payStatus}, salidas=${exits}`)

  // Invariantes globales de los datos de esta corrida.
  const orphans = await scalar(`select count(*) as v from public.product_units u where u.product_id = '${ids.prod}' and u.status in ('reserved','sold') and not exists (select 1 from public.sale_items i join public.sales s on s.id = i.sale_id where i.product_unit_id = u.id and s.status <> 'cancelled')`)
  check('Invariante: ninguna unidad reservada/vendida sin venta vigente', orphans === '0', `huérfanas=${orphans}`)
  const neg = await scalar(`select count(*) as v from public.product_variants where stock_quantity < 0`)
  check('Invariante: ninguna existencia negativa', neg === '0')
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
