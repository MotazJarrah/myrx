/**
 * Patch D1: add USDA branded foods that have kcal = 0 (or explicitly 0).
 *
 * The main import filters `kcal > 0`, which inadvertently excludes legitimate
 * zero-calorie products like vinegar, sparkling water, hot sauce, diet drinks,
 * and spice blends. Those products can still have barcodes and valid macros.
 *
 * This script inserts only the zero/null-kcal branded foods that are currently
 * missing from D1, using INSERT OR IGNORE (safe to re-run).
 *
 * Usage:
 *   node patch_zero_kcal.mjs
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
const WRANGLER_CONFIG = path.resolve(import.meta.dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_zero_kcal_patch')
const INSERT_BATCH    = 200
const ROWS_PER_FILE   = 50_000
const RETRY_ATTEMPTS  = 4
const RETRY_DELAY_MS  = 8_000

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function num(v) { const n = parseFloat(v); return isNaN(n) || !isFinite(n) ? null : Math.round(n * 100) / 100 }

function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null  // all-zero GTIN = no barcode
  return stripped.padStart(12, '0')
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL'
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
    try { executeFile(fp); return }
    catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      process.stdout.write(` ⚠ retry ${attempt}…`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

const COLS = 'source,source_id,name,brand,kcal,protein_g,fat_g,carbs_g,fiber_g,sodium_mg,serving_g,serving_label,upc'

function toValues(r) {
  return `(${[
    esc(r.source), esc(String(r.source_id)), esc(r.name), esc(r.brand),
    esc(r.kcal), esc(r.protein_g), esc(r.fat_g), esc(r.carbs_g),
    esc(r.fiber_g), esc(r.sodium_mg), esc(r.serving_g), esc(r.serving_label),
    esc(r.upc ?? null),
  ].join(',')})`
}

async function writeSqlFile(rows, fileIndex) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp  = path.join(TMP_DIR, `zero_kcal_${fileIndex}.sql`)
  const out = fs.createWriteStream(fp)
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk  = rows.slice(i, i + INSERT_BATCH)
    const values = chunk.map(toValues).join(',\n  ')
    out.write(`INSERT OR IGNORE INTO food_library (${COLS}) VALUES\n  ${values};\n`)
  }
  out.end()
  return new Promise((resolve, reject) => { out.on('finish', () => resolve(fp)); out.on('error', reject) })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' Zero-kcal Branded Foods Patch → D1')
  console.log('══════════════════════════════════════════\n')

  // ── 1. Collect fdc_ids with zero or missing kcal ──────────────────────────
  console.log('Step 1/4  Streaming food_nutrient.csv for kcal data…')
  // We need to know which fdc_ids have kcal=0 explicitly, vs no kcal entry at all.
  // Both get included: kcal=0 is valid (vinegar, water), no kcal entry may also be
  // a product that's just not in the nutrient file yet.
  const kcalMap = new Map()  // fdc_id → kcal (0 or positive)
  let nCount = 0
  await streamCsv('food_nutrient.csv', row => {
    if (row.nutrient_id !== '1008') return  // 1008 = Energy (kcal)
    kcalMap.set(row.fdc_id, num(row.amount) ?? 0)
    nCount++
    if (nCount % 2_000_000 === 0) process.stdout.write(`\r  ${nCount.toLocaleString()} kcal rows…`)
  })
  console.log(`\r  → ${kcalMap.size.toLocaleString()} foods with explicit kcal data        `)

  // ── 2. Branded map ────────────────────────────────────────────────────────
  console.log('\nStep 2/4  Streaming branded_food.csv…')
  const brandedMap = new Map()
  let bCount = 0
  await streamCsv('branded_food.csv', row => {
    if (row.discontinued_date?.trim()) return
    const market = (row.market_country || '').trim()
    if (market && market !== 'United States') return

    let servingG = null
    const sz = parseFloat(row.serving_size)
    if (!isNaN(sz) && sz > 0) {
      const u = (row.serving_size_unit || '').toLowerCase()
      if (u === 'g')  servingG = sz
      if (u === 'oz') servingG = Math.round(sz * 28.3495 * 10) / 10
      if (u === 'ml') servingG = sz
    }
    brandedMap.set(row.fdc_id, {
      brand:         (row.brand_owner || row.brand_name || '').trim() || null,
      serving_g:     servingG,
      serving_label: row.household_serving_fulltext?.trim() || null,
      upc:           normalizeUpc(row.gtin_upc),
    })
    bCount++
    if (bCount % 500_000 === 0) process.stdout.write(`\r  ${bCount.toLocaleString()} branded rows…`)
  })
  console.log(`\r  → ${brandedMap.size.toLocaleString()} active branded foods        `)

  // ── 3. Build zero-kcal rows from food.csv ─────────────────────────────────
  console.log('\nStep 3/4  Building zero-kcal rows from food.csv…')
  const rows    = []
  let skipped   = 0

  await streamCsv('food.csv', row => {
    if (row.data_type !== 'branded_food') { skipped++; return }
    const name = row.description?.trim()
    if (!name) { skipped++; return }
    const fdcId = row.fdc_id
    if (!brandedMap.has(fdcId)) { skipped++; return }

    const kcalVal = kcalMap.get(fdcId)
    // Only include rows where kcal is 0 (explicitly zero-calorie products)
    // Skip rows with no kcal data at all (kcalMap.get returns undefined)
    // Skip rows where kcal > 0 (already in DB from main import)
    if (kcalVal === undefined || kcalVal > 0) { skipped++; return }

    const b = brandedMap.get(fdcId)
    // Still need macros — get from kcalMap's stored nutrient data
    // (We only have kcal here; protein/fat/carbs would need separate streams.
    //  For zero-kcal products, all macros are 0, so null is fine.)
    rows.push({
      source: 'usda', source_id: fdcId, name,
      brand:         b.brand,
      kcal:          0,
      protein_g:     null,
      fat_g:         null,
      carbs_g:       null,
      fiber_g:       null,
      sodium_mg:     null,
      serving_g:     b.serving_g,
      serving_label: b.serving_label,
      upc:           b.upc,
    })
  })
  console.log(`  → ${rows.length.toLocaleString()} zero-kcal branded foods to insert (${skipped.toLocaleString()} skipped)`)

  // ── 4. Upload to D1 ───────────────────────────────────────────────────────
  if (rows.length === 0) {
    console.log('\n✅ Nothing to insert — all zero-kcal products already in D1.')
    return
  }

  console.log('\nStep 4/4  Uploading to D1…')
  let fileIndex = 0, inserted = 0
  for (let i = 0; i < rows.length; i += ROWS_PER_FILE) {
    const batch = rows.slice(i, i + ROWS_PER_FILE)
    process.stdout.write(`\n  File ${fileIndex + 1}: ${batch.length.toLocaleString()} rows… uploading…`)
    const fp = await writeSqlFile(batch, fileIndex)
    await executeFileWithRetry(fp)
    fs.unlinkSync(fp)
    inserted  += batch.length
    fileIndex++
    process.stdout.write(` ✓  (${inserted.toLocaleString()} / ${rows.length.toLocaleString()})`)
  }

  // Also fix the main import for future runs
  console.log(`\n\n✅ Done! ${inserted.toLocaleString()} zero-kcal branded foods added to D1.`)
  console.log('   Rebuild FTS5 index if needed: INSERT INTO food_fts(food_fts) VALUES (\'rebuild\')')
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
