/**
 * Repair script — fix two patterns that Rule 3 (title-case) damaged:
 *
 *   1. NFS-family acronyms: `Nfs`, `Nfsmi`, contextual `Ns` (USDA's
 *      "Not Further Specified" / "National Food Service Management Institute"
 *      / "Not Specified" qualifiers — they're meaningful tokens, must stay
 *      uppercase).
 *
 *   2. Mc-prefix brand / product names where the original `McDonald's`,
 *      `McKee`, `McGriddles` etc. became `Mcdonald's`, `Mckee`, `Mcgriddles`
 *      after title-case lowercased + re-capitalised only the first letter.
 *
 * The root cause was the title-case helper in filters.mjs / Rule 2 wrapper
 * being too naive — it does `s.toLowerCase().replace(boundary, upper)`
 * without preserving known acronyms or Mc/Mac prefixes. That's been patched
 * in filters.mjs; this script repairs the rows that were already damaged.
 *
 * Usage:
 *   node scripts/d1_migrate/repair_title_case_damage.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_repair_titlecase')

const UPDATE_BATCH_SIZE  = 500
const UPDATE_CONCURRENCY = 4
const RETRY_ATTEMPTS     = 4
const RETRY_DELAY_MS     = 6_000

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      if (start < 0) throw new Error(`No JSON: ${out.slice(0, 200)}`)
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

function runCommand(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim()
  const args = `d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --command "${flat.replace(/"/g, '\\"')}" --json`
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const out = execWrangler(args)
      const start = out.indexOf('[')
      const parsed = JSON.parse(out.slice(start))
      return parsed?.[0]?.meta?.changes ?? 0
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const msg = err.stderr?.toString().slice(0, 200) ?? err.message
      console.warn(`  [retry ${attempt}] update: ${msg}`)
      const end = Date.now() + RETRY_DELAY_MS * attempt
      while (Date.now() < end) { /* spin */ }
    }
  }
  return 0
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

// ── Repair logic ─────────────────────────────────────────────────────────────

// Fix Mc/Mac prefix in a name by uppercasing the letter immediately after.
// Word-boundary-anchored so we don't touch "Macaroni" or "Machine".
//
// Whitelist approach: only fix known Mc/Mac brand fragments to avoid
// false-positiving on words that start with "Mc" but aren't surnames.
// USDA's lowercase-Mc damage is concentrated in McDonald's, McKee, and the
// Mc-product family (McGriddles, McMuffin, McNuggets, McFlurry, McChicken,
// McRib, etc.). Anything else stays untouched.
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

function repairMc(name) {
  let s = name
  for (const [re, sub] of MC_REPAIRS) s = s.replace(re, sub)
  return s
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  console.log('Repair title-case damage')
  console.log('────────────────────────────────────────────────────────────────')

  // ── Pass 1 — NFS-family acronyms via SQL REPLACE ─────────────────────────
  // Order matters: longest patterns first so REPLACE doesn't partially-match
  // a shorter pattern inside a longer one.
  console.log('\nPass 1 — NFS-family acronyms (SQL REPLACE):')

  // 1a: "Nfsmi" → "NFSMI" (USDA's National Food Service Management Institute)
  const c1a = runCommand(`UPDATE food_library SET name = REPLACE(name, 'Nfsmi', 'NFSMI') WHERE name LIKE '%Nfsmi%'`)
  console.log(`  Nfsmi  →  NFSMI :  ${fmt(c1a)} rows`)

  // 1b: standalone " Nfs" / ", Nfs" / "(Nfs" → uppercase
  //     Use boundary-aware REPLACE via three targeted patterns
  const c1b1 = runCommand(`UPDATE food_library SET name = REPLACE(name, ', Nfs', ', NFS') WHERE name LIKE '%, Nfs%'`)
  const c1b2 = runCommand(`UPDATE food_library SET name = REPLACE(name, ' Nfs', ' NFS') WHERE name LIKE '% Nfs%'`)
  const c1b3 = runCommand(`UPDATE food_library SET name = REPLACE(name, '(Nfs', '(NFS') WHERE name LIKE '%(Nfs%'`)
  console.log(`  Nfs    →  NFS   :  ${fmt(c1b1 + c1b2 + c1b3)} rows`)

  // 1c: standalone ", Ns " / ", Ns," / ", Ns)" → uppercase
  //     (USDA "NS" = Not Specified, contextual qualifier)
  const c1c1 = runCommand(`UPDATE food_library SET name = REPLACE(name, ', Ns ', ', NS ') WHERE name LIKE '%, Ns %'`)
  const c1c2 = runCommand(`UPDATE food_library SET name = REPLACE(name, ', Ns,', ', NS,') WHERE name LIKE '%, Ns,%'`)
  const c1c3 = runCommand(`UPDATE food_library SET name = REPLACE(name, ', Ns)', ', NS)') WHERE name LIKE '%, Ns)%'`)
  console.log(`  Ns     →  NS    :  ${fmt(c1c1 + c1c2 + c1c3)} rows`)

  // ── Pass 2 — Mc-prefix brand names (JS pull/transform/push) ──────────────
  console.log('\nPass 2 — Mc-prefix brand names (JS repair):')

  // Pull all rows with lowercase-Mc prefix.
  const rows = runSelectJson(`
    SELECT id, name FROM food_library
    WHERE name LIKE 'Mc%' OR name LIKE '% Mc%'
  `)
  console.log(`  Pulled ${fmt(rows.length)} candidate rows for Mc-repair`)

  const updates = []
  for (const r of rows) {
    const next = repairMc(r.name)
    if (next !== r.name) updates.push({ id: r.id, name: next })
  }
  console.log(`  Will repair: ${fmt(updates.length)} rows`)

  if (updates.length) {
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
    await pmap(batchFiles, UPDATE_CONCURRENCY, async (fp) => {
      await runFileAsync(fp)
      fs.unlinkSync(fp)
      completed++
      process.stdout.write(`\r  Batches: ${completed}/${batchFiles.length}`)
    })
    console.log('')
  }

  console.log(`\nDone in ${fmtMs(Date.now() - t0)}.`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
