/**
 * USDA CSV + OpenNutrition TSV → Cloudflare D1 direct import
 *
 * Reads directly from local files — no Supabase, no network timeouts.
 *
 * Sources:
 *   USDA:  scripts/usda_import/FoodData_Central_csv_2026-04-30/…
 *   ON:    opennutrition/opennutrition_foods.tsv
 *
 * Usage:
 *   node d1_import_from_csv.mjs
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
const ON_TSV = path.join(ROOT_DIR, 'opennutrition/opennutrition_foods.tsv')

const WRANGLER_CONFIG = path.resolve(import.meta.dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'

const ROWS_PER_FILE  = 50_000
const INSERT_BATCH   = 200
const TMP_DIR        = path.join(os.tmpdir(), 'd1_csv_import')
const PROGRESS_FILE  = path.join(import.meta.dirname, 'csv_progress.json')
const RETRY_ATTEMPTS = 4
const RETRY_DELAY_MS = 8_000

const NUTRIENT_IDS = new Set(['1008','1003','1004','1005','1079','1093'])
const NUTRIENT_KEY = { '1008':'kcal','1003':'protein_g','1004':'fat_g',
                       '1005':'carbs_g','1079':'fiber_g','1093':'sodium_mg' }

// ── CSV / TSV streaming ───────────────────────────────────────────────────────

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

function num(v) { const n = parseFloat(v); return isNaN(n) || !isFinite(n) ? null : Math.round(n * 100) / 100 }

// ── SQL helpers ───────────────────────────────────────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number')         return isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

const COLS = 'source,source_id,name,brand,kcal,protein_g,fat_g,carbs_g,fiber_g,sodium_mg,serving_g,serving_label'

function toValues(r) {
  return `(${[
    esc(r.source), esc(String(r.source_id)), esc(r.name), esc(r.brand),
    esc(r.kcal), esc(r.protein_g), esc(r.fat_g), esc(r.carbs_g),
    esc(r.fiber_g), esc(r.sodium_mg), esc(r.serving_g), esc(r.serving_label),
  ].join(',')})`
}

async function writeSqlFile(rows, fileIndex) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp  = path.join(TMP_DIR, `import_${fileIndex}.sql`)
  const out = fs.createWriteStream(fp)
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk  = rows.slice(i, i + INSERT_BATCH)
    const values = chunk.map(toValues).join(',\n  ')
    out.write(`INSERT OR IGNORE INTO food_library (${COLS}) VALUES\n  ${values};\n`)
  }
  out.end()
  return new Promise((resolve, reject) => { out.on('finish', () => resolve(fp)); out.on('error', reject) })
}

// ── Progress ──────────────────────────────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) }
  catch { return { phase: 'usda', rowsDone: 0 } }
}
function saveProgress(phase, rowsDone) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ phase, rowsDone }))
}
function clearProgress() {
  try { fs.unlinkSync(PROGRESS_FILE) } catch {}
}

// ── Upload helpers ─────────────────────────────────────────────────────────────

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
      process.stdout.write(` ⚠ retry ${attempt}/${RETRY_ATTEMPTS - 1}…`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

async function uploadBatch(rows, fileIndex) {
  process.stdout.write(`\n  File ${fileIndex + 1}: ${rows.length.toLocaleString()} rows… uploading…`)
  const fp = await writeSqlFile(rows, fileIndex)
  await executeFileWithRetry(fp)
  fs.unlinkSync(fp)
  process.stdout.write(` ✓`)
  return fileIndex + 1
}

async function uploadAll(allRows, label, phase, startRow = 0) {
  const remaining = allRows.slice(startRow)
  const startFile = Math.floor(startRow / ROWS_PER_FILE)
  if (startRow > 0) console.log(`  ↪ Resuming ${label} from row ${startRow.toLocaleString()} (file ${startFile + 1})`)
  console.log(`  → ${remaining.length.toLocaleString()} ${label} rows to upload`)
  let fileIndex = startFile
  for (let i = 0; i < remaining.length; i += ROWS_PER_FILE) {
    fileIndex = await uploadBatch(remaining.slice(i, i + ROWS_PER_FILE), fileIndex)
    const done = startRow + Math.min(i + ROWS_PER_FILE, remaining.length)
    process.stdout.write(`  (${done.toLocaleString()} / ${allRows.length.toLocaleString()})`)
    saveProgress(phase, done)
  }
  return fileIndex
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' USDA + OpenNutrition  →  Cloudflare D1')
  console.log('══════════════════════════════════════════\n')

  // ════════════════════════════════════════
  // PART 1 — USDA
  // ════════════════════════════════════════
  console.log('── USDA ──────────────────────────────────\n')

  console.log('Step 1/4  Streaming food_nutrient.csv…')
  const nutrientMap = new Map()
  let nCount = 0
  await streamCsv('food_nutrient.csv', row => {
    if (!NUTRIENT_IDS.has(row.nutrient_id)) return
    const key = NUTRIENT_KEY[row.nutrient_id]
    if (!nutrientMap.has(row.fdc_id)) nutrientMap.set(row.fdc_id, {})
    nutrientMap.get(row.fdc_id)[key] = num(row.amount)
    nCount++
    if (nCount % 2_000_000 === 0) process.stdout.write(`\r  ${nCount.toLocaleString()} rows…`)
  })
  console.log(`\r  → ${nutrientMap.size.toLocaleString()} foods with nutrients        `)

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
    })
    bCount++
    if (bCount % 500_000 === 0) process.stdout.write(`\r  ${bCount.toLocaleString()} rows…`)
  })
  console.log(`\r  → ${brandedMap.size.toLocaleString()} active branded foods        `)

  console.log('\nStep 3/4  Streaming food_portion.csv…')
  const portionMap = new Map()
  await streamCsv('food_portion.csv', row => {
    if (!portionMap.has(row.fdc_id))
      portionMap.set(row.fdc_id, {
        serving_g:     num(row.gram_weight),
        serving_label: (row.portion_description || row.modifier || '').trim() || null,
      })
  })
  console.log(`  → ${portionMap.size.toLocaleString()} portion entries`)

  console.log('\nStep 4/4  Building USDA rows…')
  const VALID_TYPES = new Set(['branded_food','sr_legacy_food','foundation_food'])
  const dedupSeen   = new Set()
  const usdaRows    = []
  let skipped = 0

  await streamCsv('food.csv', row => {
    if (!VALID_TYPES.has(row.data_type)) { skipped++; return }
    const name = row.description?.trim()
    if (!name) { skipped++; return }
    const fdcId     = row.fdc_id
    const nutr      = nutrientMap.get(fdcId) || {}
    const isBranded = row.data_type === 'branded_food'
    if (nutr.kcal == null || nutr.kcal <= 0)  { skipped++; return }
    if (isBranded && !brandedMap.has(fdcId))   { skipped++; return }

    const b = isBranded ? brandedMap.get(fdcId) : null
    const p = !isBranded ? portionMap.get(fdcId) : null

    const dedupeKey = `${name.toLowerCase()}|${((b?.brand) ?? '').toLowerCase()}`
    if (dedupSeen.has(dedupeKey)) { skipped++; return }
    dedupSeen.add(dedupeKey)

    usdaRows.push({
      source: 'usda', source_id: fdcId, name,
      brand:         b?.brand         ?? null,
      kcal:          nutr.kcal,
      protein_g:     nutr.protein_g   ?? null,
      fat_g:         nutr.fat_g       ?? null,
      carbs_g:       nutr.carbs_g     ?? null,
      fiber_g:       nutr.fiber_g     ?? null,
      sodium_mg:     nutr.sodium_mg   ?? null,
      serving_g:     b?.serving_g     ?? p?.serving_g     ?? null,
      serving_label: b?.serving_label ?? p?.serving_label ?? null,
    })
  })

  console.log(`  → ${usdaRows.length.toLocaleString()} unique USDA rows (${skipped.toLocaleString()} skipped)`)

  const prog = loadProgress()
  const usdaStartRow = (prog.phase === 'usda') ? prog.rowsDone : 0
  console.log('\nUploading USDA to D1…')
  await uploadAll(usdaRows, 'USDA', 'usda', usdaStartRow)
  usdaRows.length = 0  // free memory

  // ════════════════════════════════════════
  // PART 2 — OpenNutrition
  // ════════════════════════════════════════
  console.log('\n\n── OpenNutrition ─────────────────────────\n')
  console.log('Streaming opennutrition_foods.tsv…')

  const onRows = []
  let onSkipped = 0
  let onCount   = 0

  await streamTsv(ON_TSV, row => {
    const name = row.name?.trim()
    if (!name) { onSkipped++; return }

    let nutr = {}
    let srv  = {}
    try { nutr = JSON.parse(row.nutrition_100g || '{}') } catch { onSkipped++; return }
    try { srv  = JSON.parse(row.serving        || '{}') } catch {}

    const kcal      = num(nutr.calories)
    const protein_g = num(nutr.protein)
    const fat_g     = num(nutr.total_fat)
    const carbs_g   = num(nutr.carbohydrates)
    const fiber_g   = num(nutr.dietary_fiber)
    const sodium_mg = num(nutr.sodium)

    if (!kcal || kcal <= 0) { onSkipped++; return }

    // Serving from metric (prefer grams)
    let serving_g    = null
    let serving_label = null
    const metric = srv.metric
    if (metric?.unit === 'g' && metric?.quantity > 0) serving_g = metric.quantity
    const common = srv.common
    if (common?.quantity && common?.unit)
      serving_label = `${common.quantity} ${common.unit}`

    // Deduplicate against USDA by (name)
    const dedupeKey = name.toLowerCase() + '|'
    if (dedupSeen.has(dedupeKey)) { onSkipped++; return }
    dedupSeen.add(dedupeKey)

    onRows.push({
      source: 'on', source_id: row.id, name, brand: null,
      kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg,
      serving_g, serving_label,
    })
    onCount++
    if (onCount % 50_000 === 0) process.stdout.write(`\r  ${onCount.toLocaleString()} ON rows…`)
  })

  console.log(`\r  → ${onRows.length.toLocaleString()} unique ON rows (${onSkipped.toLocaleString()} skipped)`)
  if (onRows.length > 0) {
    const onStartRow = (prog.phase === 'on') ? prog.rowsDone : 0
    console.log('\nUploading OpenNutrition to D1…')
    await uploadAll(onRows, 'ON', 'on', onStartRow)
  }

  // ════════════════════════════════════════
  // PART 3 — Build FTS5 index
  // ════════════════════════════════════════
  // ════════════════════════════════════════
  // PART 3 — Build FTS5 index
  // ════════════════════════════════════════
  console.log('\n\n── Building FTS5 search index… ───────────')
  const ftsSql = path.join(TMP_DIR, 'fts_rebuild.sql')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  fs.writeFileSync(ftsSql, `INSERT INTO food_fts(food_fts) VALUES ('rebuild');\n`)
  await executeFileWithRetry(ftsSql)
  fs.unlinkSync(ftsSql)

  clearProgress()
  console.log('\n✅ All done! D1 food library ready with USDA + OpenNutrition data.')
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
