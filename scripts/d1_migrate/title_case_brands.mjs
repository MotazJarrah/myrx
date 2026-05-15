/**
 * Title-case the food_library.brand column for rows that are currently
 * all-uppercase. Mirrors title_case_names.mjs but targets the brand field.
 *
 * Target rows
 * ───────────
 * Rows where `UPPER(brand) = brand AND brand GLOB '*[A-Z]*'`
 * (entirely-uppercase brand strings with at least one ASCII letter).
 *
 * Transformation
 * ──────────────
 * Same `titleCaseAllCaps()` helper as Rule 3, with preservation for:
 *   - USDA name acronyms (NFS, NS, NFSMI) — rarely in brands but safe
 *   - Corporate suffixes (LLC, USA, US, GmbH)
 *   - Mc/Mac brand prefixes (McDonald's, McKee, etc.)
 *   - Period-boundary handles Inc., Co., Ltd., Corp., S.A. naturally
 *
 * Usage
 * ─────
 *   node --max-old-space-size=8192 scripts/d1_migrate/title_case_brands.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_title_case_brands')

const SELECT_PAGE_SIZE   = 20_000
const UPDATE_BATCH_SIZE  = 5_000
const UPDATE_CONCURRENCY = 4
const RETRY_ATTEMPTS     = 4
const RETRY_DELAY_MS     = 6_000

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Title-case logic (mirrors filters.mjs) ───────────────────────────────────

const TITLE_CASE_BOUNDARY = /(^|[\s,/()\-&.\[])(\p{L})/gu

const PRESERVE_ACRONYMS = [
  [/(^|[\s,(])Nfsmi(\b)/g, '$1NFSMI$2'],
  [/(^|[\s,(])Nfs(\b)/g,   '$1NFS$2'],
  [/(^|[\s,(])Ns(\b)/g,    '$1NS$2'],
  [/(^|[\s,(])Llc(\b)/g,   '$1LLC$2'],
  [/(^|[\s,(])Usa(\b)/g,   '$1USA$2'],
  [/(^|[\s,(])Us(\b)/g,    '$1US$2'],
  [/(^|[\s,(])Gmbh(\b)/g,  '$1GmbH$2'],
]

const MC_REPAIRS = [
  [/\bMcdonald\b/g,    'McDonald'],
  [/\bMckee\b/g,       'McKee'],
  [/\bMcgriddles?\b/g, 'McGriddles'],
  [/\bMcmuffin\b/g,    'McMuffin'],
  [/\bMcnuggets\b/g,   'McNuggets'],
  [/\bMcflurry\b/g,    'McFlurry'],
  [/\bMcchicken\b/g,   'McChicken'],
  [/\bMcrib\b/g,       'McRib'],
]

function titleCaseAllCaps(s) {
  if (s == null) return s
  const str = String(s)
  if (str.toUpperCase() !== str) return s
  if (!/[A-Z]/.test(str)) return s
  let out = str.toLowerCase().replace(TITLE_CASE_BOUNDARY, (_, sep, c) => sep + c.toUpperCase())
  for (const [re, sub] of PRESERVE_ACRONYMS) out = out.replace(re, sub)
  for (const [re, sub] of MC_REPAIRS)        out = out.replace(re, sub)
  return out
}

// ── Plumbing (same pattern as title_case_names.mjs) ──────────────────────────

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function fmt(n)    { return n.toLocaleString() }
function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s` }

function execWrangler(args) {
  return execSync(`npx wrangler ${args}`, {
    cwd:       ROOT_DIR,
    stdio:     ['ignore', 'pipe', 'pipe'],
    encoding:  'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function runSelectJson(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim()
  const args = `d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --command "${flat.replace(/"/g, '\\"')}" --json`
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const out = execWrangler(args)
      const start = out.indexOf('[')
      if (start < 0) throw new Error(`No JSON in wrangler output: ${out.slice(0, 200)}`)
      return JSON.parse(out.slice(start))?.[0]?.results ?? []
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const msg = err.stderr?.toString().slice(0, 200) ?? err.message
      console.warn(`  [retry ${attempt}] select: ${msg}`)
      const end = Date.now() + RETRY_DELAY_MS * attempt
      while (Date.now() < end) { /* spin */ }
    }
  }
  return []
}

function runFileAsync(sqlFilePath) {
  return new Promise((resolve, reject) => {
    import('child_process').then(({ spawn }) => {
      const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --file "${sqlFilePath}"`
      let attempt = 0
      const try1 = () => {
        attempt++
        const p = spawn(cmd, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
        let err = ''
        p.stderr.on('data', d => { err += d.toString() })
        p.on('close', code => {
          if (code === 0) return resolve()
          if (attempt >= RETRY_ATTEMPTS) return reject(new Error(`wrangler exited ${code}: ${err.slice(0, 200)}`))
          console.warn(`  [retry ${attempt}] update: ${err.slice(0, 120)}`)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
        p.on('error', e => {
          if (attempt >= RETRY_ATTEMPTS) return reject(e)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
      }
      try1()
    })
  })
}

async function pmap(items, concurrency, task) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  console.log('Title-case sweep — food_library.brand')
  console.log('────────────────────────────────────────────────────────────────')

  const totalRow = runSelectJson(`SELECT COUNT(*) AS n FROM food_library WHERE brand IS NOT NULL AND UPPER(brand) = brand AND brand GLOB '*[A-Z]*'`)
  const target = totalRow?.[0]?.n ?? 0
  console.log(`  Target: ${fmt(target)} all-uppercase brand rows`)
  if (target === 0) { console.log('  Nothing to do.'); return }

  console.log(`\n  Pulling rows (${fmt(SELECT_PAGE_SIZE)} per page)…`)
  const allRows = []
  let lastId = 0
  while (true) {
    const rows = runSelectJson(`
      SELECT id, brand FROM food_library
      WHERE id > ${lastId}
        AND brand IS NOT NULL
        AND UPPER(brand) = brand
        AND brand GLOB '*[A-Z]*'
      ORDER BY id ASC
      LIMIT ${SELECT_PAGE_SIZE}
    `)
    if (!rows.length) break
    allRows.push(...rows)
    lastId = rows[rows.length - 1].id
    process.stdout.write(`\r    Pulled: ${fmt(allRows.length)}/${fmt(target)}`)
  }
  console.log('')

  console.log(`\n  Transforming brand strings…`)
  const updates = []
  let unchanged = 0
  for (const r of allRows) {
    const next = titleCaseAllCaps(r.brand)
    if (next !== r.brand) updates.push({ id: r.id, brand: next })
    else unchanged++
  }
  console.log(`  Will update: ${fmt(updates.length)} (${fmt(unchanged)} no-ops)`)

  console.log('\n  Sample transformations:')
  for (let i = 0; i < Math.min(10, updates.length); i++) {
    const before = allRows.find(r => r.id === updates[i].id)?.brand
    console.log(`    "${before}"  →  "${updates[i].brand}"`)
  }

  if (!updates.length) return

  console.log(`\n  Writing updates (${fmt(UPDATE_BATCH_SIZE)} per batch, concurrency ${UPDATE_CONCURRENCY})…`)
  const batches = []
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    batches.push(updates.slice(i, i + UPDATE_BATCH_SIZE))
  }
  const batchFiles = batches.map((batch, idx) => {
    const fp = path.join(TMP_DIR, `batch_${idx}.sql`)
    const lines = batch.map(u => `UPDATE food_library SET brand = ${esc(u.brand)} WHERE id = ${u.id};`)
    fs.writeFileSync(fp, lines.join('\n'))
    return fp
  })

  let completed = 0
  const writeStart = Date.now()
  await pmap(batchFiles, UPDATE_CONCURRENCY, async (fp) => {
    await runFileAsync(fp)
    fs.unlinkSync(fp)
    completed++
    process.stdout.write(`\r    Batches: ${completed}/${batchFiles.length}`)
  })
  console.log('')

  console.log(`\nDone in ${fmtMs(Date.now() - t0)}: ${fmt(updates.length)} updated, ${fmt(unchanged)} unchanged.`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
