/**
 * Rule 18 — Drop redundant tail-comma variant duplication.
 *
 * Many USDA / ON branded names concatenate the description with a flavor
 * variant or subBrand string, producing redundant tail segments:
 *
 *   "Italian Style Meatballs, Italian Style"
 *      → "Italian Style Meatballs"
 *
 *   "Mango, Carrot & Banana Smoothie Blends, Mango, Carrot & Banana"
 *      → "Mango, Carrot & Banana Smoothie Blends"
 *
 *   "Tomato, Basil & Garlic Pasta Sauce, Tomato, Basil & Garlic"
 *      → "Tomato, Basil & Garlic Pasta Sauce"
 *
 * Algorithm
 * ─────────
 * Scan the name left-to-right for the leftmost ", " position where the
 * tail (everything after) appears as a substring of the head (everything
 * before). When found, truncate at that comma. First match wins, which
 * yields the LARGEST tail dropped (since earlier commas yield longer tails).
 *
 * Pure substring check — safer than Rule 17's whitelist-driven rotation
 * because there's no brand-vs-category ambiguity. If the head genuinely
 * contains the tail, it's redundant.
 *
 * Safeguards
 * ──────────
 *   - Tail length must be > 4 chars (avoid trivial coincidental matches
 *     like a comma followed by a 2-letter abbreviation).
 *   - Case-insensitive substring check.
 *   - No-op if the input has no `, ` at all.
 *
 * Usage:
 *   node --max-old-space-size=4096 scripts/d1_migrate/drop_redundant_tail.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_drop_tail')

const SELECT_PAGE_SIZE   = 5_000
const UPDATE_BATCH_SIZE  = 500
const UPDATE_CONCURRENCY = 4
const RETRY_ATTEMPTS     = 4
const RETRY_DELAY_MS     = 6_000

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Transformation ───────────────────────────────────────────────────────────

function dropRedundantTail(name) {
  if (name == null) return name
  const s = String(name)
  const lower = s.toLowerCase()
  let pos = lower.indexOf(', ')
  while (pos !== -1) {
    const head = lower.substring(0, pos)
    const tail = lower.substring(pos + 2)
    // Require:
    //   tail > 4 chars (avoid trivial coincidental matches)
    //   head > 6 chars (don't truncate result to near-nothing)
    //   head contains tail as substring
    if (tail.length > 4 && head.length > 6 && head.includes(tail)) {
      return s.substring(0, pos)
    }
    pos = lower.indexOf(', ', pos + 1)
  }
  return s
}

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function fmt(n)    { return n.toLocaleString() }
function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s` }

// ── Wrangler runners ─────────────────────────────────────────────────────────

function execWrangler(args, opts = {}) {
  return execSync(`npx wrangler ${args}`, {
    cwd:       ROOT_DIR,
    stdio:     ['ignore', 'pipe', 'pipe'],
    encoding:  'utf8',
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
  console.log('Rule 18 — Drop redundant tail-comma duplication')
  console.log('────────────────────────────────────────────────────────────────')

  const targetSql = `
    SELECT COUNT(*) AS n FROM food_library
    WHERE name LIKE '%, %'
    `
  const targetRow = runSelectJson(targetSql)
  const target = targetRow?.[0]?.n ?? 0
  console.log(`  Target (SQL pre-filter): ${fmt(target)} rows`)
  if (target === 0) { console.log('  Nothing to do.'); return }

  // Pull rows. SQL pre-filter is approximate; we re-check in JS.
  console.log(`\n  Pulling rows (${fmt(SELECT_PAGE_SIZE)} per page)…`)
  const allRows = []
  let lastId = 0
  while (true) {
    const rows = runSelectJson(`
      SELECT id, name FROM food_library
      WHERE id > ${lastId}
        AND name LIKE '%, %'
          ORDER BY id ASC
      LIMIT ${SELECT_PAGE_SIZE}
    `)
    if (!rows.length) break
    allRows.push(...rows)
    lastId = rows[rows.length - 1].id
    process.stdout.write(`\r    Pulled: ${fmt(allRows.length)}/${fmt(target)}`)
  }
  console.log('')

  // Compute updates
  console.log(`\n  Transforming names…`)
  const updates = []
  let unchanged = 0
  for (const r of allRows) {
    const next = dropRedundantTail(r.name)
    if (next !== r.name) updates.push({ id: r.id, name: next })
    else unchanged++
  }
  console.log(`  Will update: ${fmt(updates.length)} (${fmt(unchanged)} no-ops)`)

  // Sample
  console.log('\n  Sample transformations:')
  for (let i = 0; i < Math.min(10, updates.length); i++) {
    const before = allRows.find(r => r.id === updates[i].id)?.name
    console.log(`    "${before}"`)
    console.log(`        →  "${updates[i].name}"`)
  }

  if (!updates.length) return

  // Flush
  console.log(`\n  Writing updates (${fmt(UPDATE_BATCH_SIZE)} per batch, concurrency ${UPDATE_CONCURRENCY})…`)
  const batches = []
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    batches.push(updates.slice(i, i + UPDATE_BATCH_SIZE))
  }
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

  console.log(`\nDone in ${fmtMs(Date.now() - t0)}: ${fmt(updates.length)} updated, ${fmt(unchanged)} unchanged.`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
