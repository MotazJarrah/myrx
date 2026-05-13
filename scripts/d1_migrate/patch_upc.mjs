/**
 * Patch existing D1 food_library rows with UPC barcode data.
 *
 * Reads branded_food.csv (USDA) and opennutrition_foods.tsv (ON)
 * and generates UPDATE statements to populate the upc column.
 *
 * Run AFTER adding the upc column via:
 *   npx wrangler d1 execute myrx-food-library --remote \
 *     --command "ALTER TABLE food_library ADD COLUMN upc TEXT;" \
 *     --config ../../workers/food-search/wrangler.toml
 *
 * Usage:
 *   node patch_upc.mjs
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
const ON_TSV         = path.join(ROOT_DIR, 'opennutrition/opennutrition_foods.tsv')
const WRANGLER_CONFIG = path.resolve(import.meta.dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_upc_patch')
const UPDATES_PER_FILE = 5_000
const RETRY_ATTEMPTS   = 4
const RETRY_DELAY_MS   = 8_000

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize any barcode to 12-digit UPC-A */
function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null  // all-zero GTIN = no barcode
  return stripped.padStart(12, '0')
}

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
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

function streamTsv(fp, onRow) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(fp)) { console.warn(`  [skip] ${fp} not found`); return resolve(0) }
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity })
    let headers = null, count = 0
    rl.on('line', line => {
      if (!line.trim()) return
      const cols = line.split('\t')
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

async function executeFileWithRetry(fp) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      executeFile(fp)
      return
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      process.stdout.write(` ⚠ retry ${attempt}…`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

async function flushUpdates(updates, fileIndex) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp  = path.join(TMP_DIR, `upc_patch_${fileIndex}.sql`)
  const sql = updates.map(u =>
    `UPDATE food_library SET upc=${esc(u.upc)} WHERE source=${esc(u.source)} AND source_id=${esc(u.source_id)};`
  ).join('\n')
  fs.writeFileSync(fp, sql + '\n')
  process.stdout.write(`\n  File ${fileIndex + 1}: ${updates.length.toLocaleString()} updates… uploading…`)
  await executeFileWithRetry(fp)
  fs.unlinkSync(fp)
  process.stdout.write(` ✓`)
  return fileIndex + 1
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' UPC Barcode Patch  →  Cloudflare D1')
  console.log('══════════════════════════════════════════\n')

  const updates    = []
  let   fileIndex  = 0
  let   totalSent  = 0

  async function maybeFlush(force = false) {
    while (updates.length >= UPDATES_PER_FILE || (force && updates.length > 0)) {
      const batch = updates.splice(0, UPDATES_PER_FILE)
      fileIndex = await flushUpdates(batch, fileIndex)
      totalSent += batch.length
    }
  }

  // ── USDA branded_food.csv ─────────────────────────────────────────────────
  console.log('Step 1/2  Streaming branded_food.csv for UPC data…')
  let usdaFound = 0
  await streamCsv('branded_food.csv', row => {
    // Skip discontinued
    if (row.discontinued_date?.trim()) return
    const market = (row.market_country || '').trim()
    if (market && market !== 'United States') return

    const upc = normalizeUpc(row.gtin_upc)
    if (!upc) return

    updates.push({ source: 'usda', source_id: row.fdc_id, upc })
    usdaFound++
    if (usdaFound % 100_000 === 0) process.stdout.write(`\r  ${usdaFound.toLocaleString()} USDA UPCs collected…`)
  })
  console.log(`\r  → ${usdaFound.toLocaleString()} USDA rows with UPC data        `)
  await maybeFlush()

  // ── OpenNutrition TSV ─────────────────────────────────────────────────────
  console.log('\nStep 2/2  Streaming opennutrition_foods.tsv for EAN-13 data…')
  let onFound = 0
  await streamTsv(ON_TSV, row => {
    const upc = normalizeUpc(row.ean_13)
    if (!upc) return
    updates.push({ source: 'on', source_id: row.id, upc })
    onFound++
  })
  console.log(`  → ${onFound.toLocaleString()} ON rows with EAN-13 data`)
  await maybeFlush(true)

  console.log(`\n\n✅ Done! ${totalSent.toLocaleString()} rows patched with UPC data.`)
  console.log('   Run the Worker barcode endpoint to verify: GET /barcode/078742043890')
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
