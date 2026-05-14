/**
 * Title-case the food_library.name column for rows that are currently
 * all-uppercase. Optimised: large SELECT pages + parallel UPDATE batches.
 *
 * Strategy
 * ────────
 * Wrangler's --file mode has ~2s of cold-start overhead per call. The
 * naive page-then-write loop spends most of its wall time waiting on
 * subprocess starts. This version:
 *   1. Drains the entire target cohort with a few large SELECT pages
 *      (20K rows each).
 *   2. Title-cases all names in-process (cheap, JS string ops).
 *   3. Flushes UPDATEs in 5K-row batches, running CONCURRENCY batches at
 *      once. Wrangler subprocesses overlap; D1 happily serialises the
 *      individual UPDATE transactions.
 *
 * Target rows
 * ───────────
 * Only rows where `UPPER(name) = name AND name GLOB '*[A-Z]*'` are touched
 * (entirely-uppercase names with at least one ASCII uppercase letter).
 *
 * Title-case rule
 * ───────────────
 * Lowercase the whole string, then re-uppercase the first unicode letter
 * after start-of-string or any of: whitespace, comma, slash, paren, hyphen,
 * ampersand, period, opening bracket. Apostrophes are NOT word boundaries.
 *
 * Usage
 * ─────
 *   node --max-old-space-size=8192 scripts/d1_migrate/title_case_names.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_title_case')

const SELECT_PAGE_SIZE = 20_000  // rows per SELECT
const UPDATE_BATCH_SIZE = 5_000  // UPDATEs per --file
const UPDATE_CONCURRENCY = 4     // parallel --file invocations
const RETRY_ATTEMPTS  = 4
const RETRY_DELAY_MS  = 6_000

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Title-case helper ────────────────────────────────────────────────────────

const BOUNDARY = /(^|[\s,/()\-&.\[])(\p{L})/gu

function titleCase(s) {
  if (s == null) return s
  return String(s).toLowerCase().replace(BOUNDARY, (_, sep, c) => sep + c.toUpperCase())
}

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function fmt(n) { return n.toLocaleString() }
function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s` }

// ── Wrangler runners ─────────────────────────────────────────────────────────

function execWrangler(args, opts = {}) {
  return execSync(`npx wrangler ${args}`, {
    cwd:      ROOT_DIR,
    stdio:    ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
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
      const parsed = JSON.parse(out.slice(start))
      return parsed?.[0]?.results ?? []
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const msg = err.stderr?.toString().slice(0, 200) ?? err.message
      console.warn(`  [retry ${attempt}] select: ${msg}`)
      const delay = RETRY_DELAY_MS * attempt
      const end = Date.now() + delay
      while (Date.now() < end) { /* sleep */ }
    }
  }
  return []
}

function runFileSync(sqlFilePath) {
  const args = `d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --file "${sqlFilePath}"`
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      execWrangler(args)
      return
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const msg = err.stderr?.toString().slice(0, 200) ?? err.message
      console.warn(`  [retry ${attempt}] update: ${msg}`)
      const delay = RETRY_DELAY_MS * attempt
      const end = Date.now() + delay
      while (Date.now() < end) { /* sleep */ }
    }
  }
}

// Spawn wrangler --file in the background and return a Promise.
// Uses `shell: true` so the resolution of `npx` / `npx.cmd` works
// transparently on Windows (where spawn requires the .cmd extension or shell).
function runFileAsync(sqlFilePath) {
  return new Promise((resolve, reject) => {
    import('child_process').then(({ spawn }) => {
      // shell:true means we pass the command as one string and let cmd/sh
      // resolve `npx`. Quote the file path so spaces survive.
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
          console.warn(`  [retry ${attempt}] async update: ${err.slice(0, 120)}`)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
        p.on('error', e => {
          if (attempt >= RETRY_ATTEMPTS) return reject(e)
          console.warn(`  [retry ${attempt}] spawn err: ${e.message?.slice(0, 120)}`)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
      }
      try1()
    })
  })
}

// Worker pool helper — runs `task` over each item in `items` with at most
// `concurrency` in flight.
async function pmap(items, concurrency, task) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  console.log('Title-case sweep — food_library.name')
  console.log('────────────────────────────────────────────────────────────────')

  // Step 1 — count target
  const totalRow = runSelectJson(`SELECT COUNT(*) AS n FROM food_library WHERE UPPER(name) = name AND name GLOB '*[A-Z]*'`)
  const totalTarget = totalRow?.[0]?.n ?? 0
  console.log(`  Target: ${fmt(totalTarget)} all-uppercase rows`)
  if (totalTarget === 0) { console.log('  Nothing to do.'); return }

  // Step 2 — drain all rows in large pages
  console.log(`\n  Pulling rows (${SELECT_PAGE_SIZE.toLocaleString()} per page)…`)
  const allRows = []
  let lastId = 0
  while (true) {
    const sql = `
      SELECT id, name
      FROM food_library
      WHERE id > ${lastId}
        AND UPPER(name) = name
        AND name GLOB '*[A-Z]*'
      ORDER BY id ASC
      LIMIT ${SELECT_PAGE_SIZE}
    `
    const rows = runSelectJson(sql)
    if (!rows.length) break
    allRows.push(...rows)
    lastId = rows[rows.length - 1].id
    process.stdout.write(`\r    Pulled: ${fmt(allRows.length)}/${fmt(totalTarget)}`)
  }
  console.log('')
  console.log(`  Pulled ${fmt(allRows.length)} rows in ${fmtMs(Date.now() - t0)}`)

  // Step 3 — title-case in-process
  console.log(`\n  Transforming names…`)
  const updates = []
  let unchanged = 0
  for (const r of allRows) {
    const next = titleCase(r.name)
    if (next !== r.name) updates.push({ id: r.id, name: next })
    else unchanged++
  }
  console.log(`  Will update: ${fmt(updates.length)} rows (${fmt(unchanged)} no-ops)`)

  if (!updates.length) { console.log('  Nothing changed.'); return }

  // Step 4 — write back in parallel batches
  console.log(`\n  Writing updates (${UPDATE_BATCH_SIZE.toLocaleString()} per batch, concurrency ${UPDATE_CONCURRENCY})…`)
  const batches = []
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    batches.push(updates.slice(i, i + UPDATE_BATCH_SIZE))
  }

  // Pre-write SQL files for each batch.
  const batchFiles = batches.map((batch, idx) => {
    const fp = path.join(TMP_DIR, `batch_${idx}.sql`)
    const lines = batch.map(u => `UPDATE food_library SET name = ${esc(u.name)} WHERE id = ${u.id};`)
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
  console.log(`  Wrote ${fmt(updates.length)} updates in ${fmtMs(Date.now() - writeStart)}`)

  console.log('')
  console.log(`Done in ${fmtMs(Date.now() - t0)}: ${fmt(updates.length)} updated, ${fmt(unchanged)} unchanged.`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
