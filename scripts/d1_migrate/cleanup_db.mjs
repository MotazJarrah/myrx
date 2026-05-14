/**
 * D1 Database Cleanup
 *
 * What this does (in order):
 *   1. Delete USDA duplicate UPC rows — keep only the most recent (max fdc_id) per UPC
 *   2. Delete ON rows whose UPC already exists in USDA
 *   3. Delete all 0-kcal rows (not useful for calorie tracking)
 *   4. Parse ON food names — "Product Name by Brand" → split into name + brand columns
 *   5. Rebuild FTS5 index
 *
 * SAFETY: every dedup step in this script targets rows with a UPC. Generic
 * USDA entries (Foundation Foods, SR Legacy) have no UPC and are NEVER
 * touched by the WHERE upc IS NOT NULL guards below. If you add a new
 * cleanup step, keep that invariant — generics are precious data, the
 * original sync filter killed them once already, do not let cleanup do it
 * a second time.
 *
 * Usage:
 *   node cleanup_db.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import readline     from 'readline'
import { execSync } from 'child_process'

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(import.meta.dirname, '../..')
const USDA_DIR = path.join(
  ROOT_DIR,
  'scripts/usda_import/FoodData_Central_csv_2026-04-30/FoodData_Central_csv_2026-04-30'
)
const WRANGLER_CONFIG  = path.resolve(import.meta.dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME          = 'myrx-food-library'
const TMP_DIR          = path.join(os.tmpdir(), 'd1_cleanup')
const DELETE_BATCH     = 500   // source_ids per DELETE IN (...) statement
const STMTS_PER_FILE   = 200   // DELETE statements per SQL file
const RETRY_ATTEMPTS   = 4
const RETRY_DELAY_MS   = 8_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === ',' && !inQ) { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  out.push(cur.trim())
  return out
}

function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const fp = path.join(USDA_DIR, filename)
    if (!fs.existsSync(fp)) { console.warn(`  [skip] ${filename} not found`); return resolve(0) }
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity })
    let headers = null, count = 0
    rl.on('line', line => {
      if (!line.trim()) return
      const cols = parseCsvLine(line)
      if (!headers) { headers = cols; return }
      const obj = {}
      headers.forEach((h, i) => { obj[h] = cols[i] ?? '' })
      onRow(obj)
      count++
    })
    rl.on('close', () => resolve(count))
    rl.on('error', reject)
  })
}

function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null
  return stripped.padStart(12, '0')
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function executeFile(fp) {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${fp}" --config="${WRANGLER_CONFIG}"`,
    { stdio: 'pipe' }
  )
}

async function executeFileWithRetry(fp, label = '') {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try { executeFile(fp); return }
    catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      process.stdout.write(` ⚠ retry ${attempt}…`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

async function executeSql(sql, label = '') {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp = path.join(TMP_DIR, `_cmd_${Date.now()}.sql`)
  fs.writeFileSync(fp, sql + '\n')
  try {
    await executeFileWithRetry(fp, label)
  } finally {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }
}

// ── Step 1: USDA UPC deduplication ───────────────────────────────────────────
// Read branded_food.csv → build upc → max_fdc_id map.
// Any fdc_id that is NOT the max for its UPC gets deleted.

async function step1_deleteUsdaDuplicates() {
  console.log('Step 1/5  Building UPC → max fdc_id map from branded_food.csv…')

  // upcMax: upc → max fdc_id (as integer)
  const upcMax = new Map()
  let scanned = 0

  await streamCsv('branded_food.csv', row => {
    if (row.discontinued_date?.trim()) return
    const market = (row.market_country || '').trim()
    if (market && market !== 'United States') return

    const upc   = normalizeUpc(row.gtin_upc)
    if (!upc) return
    const fdcId = parseInt(row.fdc_id, 10)
    if (isNaN(fdcId)) return

    const cur = upcMax.get(upc)
    if (cur === undefined || fdcId > cur) upcMax.set(upc, fdcId)
    scanned++
    if (scanned % 500_000 === 0) process.stdout.write(`\r  ${scanned.toLocaleString()} rows scanned…`)
  })
  console.log(`\r  → ${upcMax.size.toLocaleString()} unique UPCs mapped        `)

  // Second pass: collect fdc_ids to DELETE (non-max for their UPC)
  console.log('  Collecting duplicate fdc_ids to delete…')
  const toDelete = []
  let kept = 0, deleted = 0

  await streamCsv('branded_food.csv', row => {
    if (row.discontinued_date?.trim()) return
    const market = (row.market_country || '').trim()
    if (market && market !== 'United States') return

    const upc   = normalizeUpc(row.gtin_upc)
    if (!upc) return
    const fdcId = parseInt(row.fdc_id, 10)
    if (isNaN(fdcId)) return

    if (fdcId === upcMax.get(upc)) { kept++; return }
    toDelete.push(String(fdcId))
    deleted++
  })
  console.log(`  → ${kept.toLocaleString()} rows to keep, ${deleted.toLocaleString()} rows to delete`)

  if (toDelete.length === 0) {
    console.log('  ✓ No duplicates found — skipping.')
    return
  }

  // Write batched DELETE files
  console.log('  Writing and executing DELETE batches…')
  fs.mkdirSync(TMP_DIR, { recursive: true })

  let fileIndex = 0, totalDeleted = 0

  // The fdc_ids in `toDelete` come from branded_food.csv rows that had
  // a UPC (normalizeUpc + the gtin_upc filter above), so by construction
  // every row we touch here has a UPC. We add `AND upc IS NOT NULL` as a
  // belt-and-suspenders guard so that any future contributor who adds
  // ids from a different source can't accidentally wipe generic rows.
  for (let i = 0; i < toDelete.length; i += STMTS_PER_FILE * DELETE_BATCH) {
    const stmts = []
    for (let j = i; j < Math.min(i + STMTS_PER_FILE * DELETE_BATCH, toDelete.length); j += DELETE_BATCH) {
      const chunk = toDelete.slice(j, j + DELETE_BATCH)
      stmts.push(`DELETE FROM food_library WHERE source='usda' AND upc IS NOT NULL AND source_id IN (${chunk.map(esc).join(',')});`)
    }
    const fp = path.join(TMP_DIR, `step1_delete_${fileIndex}.sql`)
    fs.writeFileSync(fp, stmts.join('\n') + '\n')
    process.stdout.write(`\r  File ${fileIndex + 1}: ${stmts.length} DELETE statements… uploading…`)
    await executeFileWithRetry(fp)
    fs.unlinkSync(fp)
    totalDeleted += stmts.length * DELETE_BATCH  // approximate
    fileIndex++
    process.stdout.write(` ✓  (~${Math.min(totalDeleted, toDelete.length).toLocaleString()} / ${toDelete.length.toLocaleString()})`)
  }
  console.log(`\n  ✓ USDA duplicates removed.`)
}

// ── Step 2: Remove ON rows where UPC exists in USDA ──────────────────────────

async function step2_removeOnUsdaOverlap() {
  console.log('\nStep 2/5  Deleting ON rows whose UPC exists in USDA…')
  await executeSql(
    `DELETE FROM food_library
     WHERE source = 'on'
       AND upc IS NOT NULL
       AND upc IN (SELECT upc FROM food_library WHERE source = 'usda' AND upc IS NOT NULL);`
  )
  console.log('  ✓ Done.')
}

// ── Step 3: Remove 0-kcal rows ────────────────────────────────────────────────

async function step3_removeZeroKcal() {
  console.log('\nStep 3/5  Deleting 0-kcal rows…')
  await executeSql(`DELETE FROM food_library WHERE kcal = 0;`)
  console.log('  ✓ Done.')
}

// ── Step 4: Parse ON names  "Product Name by Brand" → name + brand ───────────

async function step4_parseOnNames() {
  console.log('\nStep 4/5  Parsing ON "Name by Brand" → separate name + brand columns…')
  // INSTR(name, ' by ') > 1 guards against the edge case where name = "by SomeBrand"
  // TRIM cleans up any stray whitespace
  await executeSql(`
    UPDATE food_library
    SET
      brand = TRIM(SUBSTR(name, INSTR(name, ' by ') + 4)),
      name  = TRIM(SUBSTR(name, 1, INSTR(name, ' by ') - 1))
    WHERE source = 'on'
      AND name LIKE '% by %'
      AND INSTR(name, ' by ') > 1;
  `)
  console.log('  ✓ Done.')
}

// ── Step 5: Rebuild FTS5 ──────────────────────────────────────────────────────

async function step5_rebuildFts() {
  console.log('\nStep 5/5  Rebuilding FTS5 index…')
  await executeSql(`INSERT INTO food_fts(food_fts) VALUES ('rebuild');`)
  console.log('  ✓ Done.')
}

// ── Final count ───────────────────────────────────────────────────────────────

async function printFinalStats() {
  console.log('\nFetching final row counts…')
  const fp = path.join(TMP_DIR, '_stats.sql')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  fs.writeFileSync(fp, `SELECT source, COUNT(*) as count FROM food_library GROUP BY source;\n`)
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${fp}" --config="${WRANGLER_CONFIG}"`,
    { encoding: 'utf8' }
  )
  fs.unlinkSync(fp)
  // Extract just the results table from the JSON output
  const match = out.match(/"results":\s*(\[.*?\])/s)
  if (match) {
    const rows = JSON.parse(match[1])
    console.log('\n  Final DB counts:')
    let total = 0
    for (const r of rows) { console.log(`    ${r.source.padEnd(6)} ${r.count.toLocaleString()}`); total += r.count }
    console.log(`    ${'TOTAL'.padEnd(6)} ${total.toLocaleString()}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' D1 Database Cleanup')
  console.log('══════════════════════════════════════════\n')

  await step1_deleteUsdaDuplicates()
  await step2_removeOnUsdaOverlap()
  await step3_removeZeroKcal()
  await step4_parseOnNames()
  await step5_rebuildFts()
  await printFinalStats()

  console.log('\n✅ Cleanup complete!')
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
