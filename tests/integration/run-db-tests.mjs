import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// Ejecuta supabase/tests/*.test.sql. Cada archivo es un bloque DO que revierte todo y
// termina con la excepción "TESTS_DONE failures=N" seguida del reporte.
// Requiere SUPABASE_DB_URL (local: postgresql://postgres:postgres@127.0.0.1:54322/postgres).
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Falta SUPABASE_DB_URL')
  process.exit(2)
}

const dir = 'supabase/tests'
const files = readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort()
let failed = 0

for (const file of files) {
  const res = spawnSync(
    'npx',
    ['supabase', 'db', 'query', `--remote=${url}`, '--yes', '-f', join(dir, file)],
    { encoding: 'utf8', shell: true },
  )
  const out = `${res.stdout}\n${res.stderr}`
  // La CLI imprime el error como JSON (local) o texto plano (CI): se acepta cualquiera de los dos.
  const match = out.match(/TESTS_DONE failures=(\d+)([\s\S]*)/)
  console.log(`\n== ${file}`)
  if (!match) {
    console.log(out.trim())
    failed++
    continue
  }
  let report = match[2].replace(/\\n/g, '\n')
  const cut = report.search(/Try rerunning|"\}\}|\{"target/)
  if (cut >= 0) report = report.slice(0, cut)
  console.log(report.replace(/"\s*$/, '').trim())
  if (Number(match[1]) > 0) failed++
}

process.exit(failed > 0 ? 1 : 0)
