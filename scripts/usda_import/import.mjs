/**
 * USDA FoodData Central → food_library importer
 *
 * Features:
 *   - Streams large CSVs (no OOM)
 *   - Filters: requires kcal > 0, skips discontinued branded foods
 *   - Retry logic (3 attempts per batch with backoff)
 *   - Resume from last saved progress (progress.json)
 *   - Upsert safe: re-running updates existing rows, adds new ones
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<key> node import.mjs
 *
 * Nutrient IDs:
 *   1008=kcal  1003=protein  1004=fat  1005=carbs  1079=fiber  1093=sodium
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_SERVICE_KEY) { console.error('❌  Set SUPABASE_SERVICE_KEY'); process.exit(1) }

const CSV_DIR = path.join(
  import.meta.dirname,
  'FoodData_Central_csv_2026-04-30',
  'FoodData_Central_csv_2026-04-30'
)
const PROGRESS_FILE = path.join(import.meta.dirname, 'progress.json')
const BATCH         = 300       // smaller batch = less likely to hit payload limit
const MAX_RETRIES   = 3
const RETRY_DELAY   = 2000      // ms between retries

const NUTRIENT_IDS = new Set(['1008', '1003', '1004', '1005', '1079', '1093'])
const NUTRIENT_KEY = { '1008': 'kcal', '1003': 'protein_g', '1004': 'fat_g',
                       '1005': 'carbs_g', '1079': 'fiber_g', '1093': 'sodium_mg' }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Stream helpers ─────────────────────────────────────────────────────────────

function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const fp = path.join(CSV_DIR, filename)
    if (!fs.existsSync(fp)) { console.warn(`  [skip] ${filename} not found`); return resolve(0) }
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity })
    let headers = null, count = 0
    rl.on('line', line => {
      if (!line.trim()) return
      const cols = parseLine(line)
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

function parseLine(line) {
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

function num(v) { const n = parseFloat(v); return isNaN(n) || !isFinite(n) ? null : Math.round(n * 100) / 100 }

// ── Retry upsert ───────────────────────────────────────────────────────────────

async function upsertWithRetry(rows, attempt = 1) {
  const { error } = await supabase
    .from('food_library')
    .upsert(rows, { onConflict: 'source,source_id', ignoreDuplicates: false })
  if (!error) return

  if (attempt >= MAX_RETRIES) throw new Error(`Upsert failed after ${MAX_RETRIES} attempts: ${error.message}`)
  await new Promise(r => setTimeout(r, RETRY_DELAY * attempt))
  return upsertWithRetry(rows, attempt + 1)
}

// ── Progress ───────────────────────────────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) } catch { return { startIndex: 0 } }
}
function saveProgress(startIndex) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ startIndex }))
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' USDA FoodData Central → food_library')
  console.log('══════════════════════════════════════════\n')

  // ── 1. Nutrient map ────────────────────────────────────────────────────────
  console.log('Step 1/4  Streaming food_nutrient.csv (1.7 GB)…')
  const nutrientMap = new Map()
  let nCount = 0
  await streamCsv('food_nutrient.csv', row => {
    if (!NUTRIENT_IDS.has(row.nutrient_id)) return
    const key = NUTRIENT_KEY[row.nutrient_id]
    if (!nutrientMap.has(row.fdc_id)) nutrientMap.set(row.fdc_id, {})
    nutrientMap.get(row.fdc_id)[key] = num(row.amount)
    nCount++
    if (nCount % 2_000_000 === 0) process.stdout.write(`\r  ${nCount.toLocaleString()} nutrient rows…`)
  })
  console.log(`\r  → ${nutrientMap.size.toLocaleString()} foods with nutrient data        `)

  // ── 2. Branded map (skip discontinued) ────────────────────────────────────
  console.log('\nStep 2/4  Streaming branded_food.csv (910 MB)…')
  const brandedMap = new Map()
  let bCount = 0
  await streamCsv('branded_food.csv', row => {
    // Skip discontinued branded foods
    if (row.discontinued_date && row.discontinued_date.trim() !== '') return

    let servingG = null
    const sz = parseFloat(row.serving_size)
    if (!isNaN(sz) && sz > 0) {
      const u = (row.serving_size_unit || '').toLowerCase()
      if (u === 'g')  servingG = sz
      if (u === 'oz') servingG = Math.round(sz * 28.3495 * 10) / 10
      if (u === 'ml') servingG = sz
    }
    // Only keep US or blank market (filters out UK, AU, etc. duplicates)
    const market = (row.market_country || '').trim()
    if (market && market !== 'United States') return

    brandedMap.set(row.fdc_id, {
      brand:         (row.brand_owner || row.brand_name || '').trim() || null,
      serving_g:     servingG,
      serving_label: row.household_serving_fulltext?.trim() || null,
    })
    bCount++
    if (bCount % 500_000 === 0) process.stdout.write(`\r  ${bCount.toLocaleString()} branded rows…`)
  })
  console.log(`\r  → ${brandedMap.size.toLocaleString()} active branded foods              `)

  // ── 3. Portion map ─────────────────────────────────────────────────────────
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

  // ── 4. Build rows from food.csv ───────────────────────────────────────────
  console.log('\nStep 4/4  Building rows from food.csv…')
  const VALID_TYPES = new Set(['branded_food', 'sr_legacy_food', 'foundation_food'])
  const allRows = []
  let skipped = 0

  await streamCsv('food.csv', row => {
    if (!VALID_TYPES.has(row.data_type)) { skipped++; return }
    const name = row.description?.trim()
    if (!name) { skipped++; return }

    const fdcId     = row.fdc_id
    const nutr      = nutrientMap.get(fdcId) || {}
    const isBranded = row.data_type === 'branded_food'

    // Require calorie data (skip empty shells)
    if (nutr.kcal == null || nutr.kcal <= 0) { skipped++; return }
    // For branded foods, skip if not in active branded map
    if (isBranded && !brandedMap.has(fdcId)) { skipped++; return }

    const b = isBranded ? brandedMap.get(fdcId) : null
    const p = !isBranded ? portionMap.get(fdcId) : null

    allRows.push({
      source:                'usda',
      source_id:             fdcId,
      name,
      brand:                 b?.brand         ?? null,
      kcal:                  nutr.kcal        ?? null,
      protein_g:             nutr.protein_g   ?? null,
      fat_g:                 nutr.fat_g       ?? null,
      carbs_g:               nutr.carbs_g     ?? null,
      fiber_g:               nutr.fiber_g     ?? null,
      sodium_mg:             nutr.sodium_mg   ?? null,
      serving_g:             b?.serving_g     ?? p?.serving_g     ?? null,
      serving_label:         b?.serving_label ?? p?.serving_label ?? null,
      servings_per_container: null,
    })
  })

  // Deduplicate by (name, brand) — keep only the first occurrence per unique food
  // This removes the same product appearing multiple times with different serving sizes
  const dedupSeen = new Set()
  const dedupedRows = allRows.filter(r => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (dedupSeen.has(key)) return false
    dedupSeen.add(key)
    return true
  })

  console.log(`  → ${dedupedRows.length.toLocaleString()} unique rows after dedup (${allRows.length - dedupedRows.length} duplicates removed, ${skipped.toLocaleString()} skipped)\n`)
  allRows.length = 0   // free memory
  const finalRows = dedupedRows

  // ── 5. Upsert with resume support ─────────────────────────────────────────
  const { startIndex } = loadProgress()
  if (startIndex > 0) console.log(`  Resuming from row ${startIndex.toLocaleString()}…`)

  let inserted = startIndex
  for (let i = startIndex; i < finalRows.length; i += BATCH) {
    const chunk = finalRows.slice(i, i + BATCH)
    try {
      await upsertWithRetry(chunk)
    } catch (err) {
      saveProgress(i)
      console.error(`\n❌ Failed at batch starting row ${i}. Progress saved. Re-run to resume.\n   ${err.message}`)
      process.exit(1)
    }
    inserted += chunk.length
    if (inserted % 5000 === 0 || i + BATCH >= finalRows.length)
      process.stdout.write(`\r  Upserted ${inserted.toLocaleString()} / ${finalRows.length.toLocaleString()}`)
  }

  // Clear progress file on success
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE)

  console.log(`\n\n✅ Done! ${inserted.toLocaleString()} USDA rows upserted.`)
  console.log('   Re-running is safe — new foods added, existing foods updated.')
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
