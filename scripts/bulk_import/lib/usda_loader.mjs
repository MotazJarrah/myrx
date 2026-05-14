/**
 * USDA loader — reads the full FoodData Central CSV bundle and builds row
 * records for our food_library schema.
 *
 * Expects files at:
 *   data/usda/FoodData_Central_csv_YYYY-MM-DD/
 *     food.csv
 *     branded_food.csv
 *     food_nutrient.csv
 *     food_portion.csv
 *     food_category.csv
 *     nutrient.csv (not used directly — we look up by hardcoded nutrient_id)
 *
 * Strategy (multi-pass to keep memory bounded):
 *   1. food.csv          → Map<fdc_id, partial_record> with name + data_type + category_id
 *   2. food_category.csv → resolve category_id → category name on each row
 *   3. branded_food.csv  → enrich branded rows with brand, UPC, serving
 *   4. food_portion.csv  → enrich non-branded rows with serving
 *   5. food_nutrient.csv → stream-add macros (kcal, protein, fat, carbs, fiber, sodium)
 *
 * Filter philosophy: NO row-level filters during this pass. Every parseable food.csv
 * row makes it through to the returned array. Audit + filter design happen later.
 */

import fs   from 'fs'
import path from 'path'
import { parse } from 'csv-parse'

// ── USDA → our schema mappings ───────────────────────────────────────────────

// USDA's data_type column → our source_subtype (stored verbatim).
const SOURCE_SUBTYPE_MAP = Object.freeze({
  branded_food:             'branded_food',
  foundation_food:          'foundation_food',
  sr_legacy_food:           'sr_legacy_food',
  survey_fndds_food:        'survey_fndds_food',
  experimental_food:        'experimental_food',
  sub_sample_food:          'sub_sample_food',
  agricultural_acquisition: 'agricultural_acquisition',
  market_acquisition:       'market_acquisition',
  sample_food:              'sample_food',
})

// USDA source_subtype → our universal data_type.
// Note: branded_food rows get 'branded' EVEN IF they lack a UPC — the source
// itself classifies them as branded, so we honour that.
const DATA_TYPE_MAP = Object.freeze({
  branded_food:             'branded',
  foundation_food:          'generic',
  sr_legacy_food:           'generic',
  survey_fndds_food:        'aggregated',
  experimental_food:        'generic',
  sub_sample_food:          'generic',
  agricultural_acquisition: 'generic',
  market_acquisition:       'generic',
  sample_food:              'generic',
})

// Nutrient IDs we extract from food_nutrient.csv.
const NUTRIENT_KEY = Object.freeze({
  '1008': 'kcal',
  '1003': 'protein_g',
  '1004': 'fat_g',
  '1005': 'carbs_g',
  '1079': 'fiber_g',
  '1093': 'sodium_mg',
})
const TARGET_NUTRIENTS = new Set(Object.keys(NUTRIENT_KEY))

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) || !isFinite(n) ? null : Math.round(n * 100) / 100
}

function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null
  return stripped.padStart(12, '0')
}

/** Stream-parse a CSV file with proper handling of multi-line records. */
function streamCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`CSV not found: ${filePath}`))
    }
    let count = 0
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
      }))
      .on('data', row => { onRow(row); count++ })
      .on('end',  () => resolve(count))
      .on('error', reject)
  })
}

/** Find the FoodData_Central_csv_* subfolder inside data/usda/. */
function findUsdaFolder(usdaRoot) {
  if (!fs.existsSync(usdaRoot)) {
    throw new Error(`USDA data folder not found: ${usdaRoot}`)
  }
  const entries = fs.readdirSync(usdaRoot, { withFileTypes: true })
  const folder = entries.find(e =>
    e.isDirectory() && /^FoodData_Central_csv_\d{4}-\d{2}-\d{2}$/.test(e.name)
  )
  if (!folder) {
    throw new Error(
      `No FoodData_Central_csv_YYYY-MM-DD folder inside ${usdaRoot}. ` +
      `Extract the USDA zip there.`
    )
  }
  return path.join(usdaRoot, folder.name)
}

// ── Main loader ───────────────────────────────────────────────────────────────

/**
 * @param {string} usdaRoot — path to scripts/bulk_import/data/usda/
 * @returns {Promise<{ rows: Array<object>, version: string, stats: object }>}
 */
export async function loadUsda(usdaRoot) {
  const folder  = findUsdaFolder(usdaRoot)
  const version = path.basename(folder)
  const now     = new Date().toISOString()
  console.log(`  Using bundle: ${version}`)

  // ── Pass 1: food.csv ────────────────────────────────────────────────────────
  console.log('  Pass 1/5 — food.csv (master list)…')
  const foods = new Map()  // fdc_id → record
  let skipped_no_name = 0

  await streamCsv(path.join(folder, 'food.csv'), row => {
    const fdcId       = row.fdc_id
    const description = row.description?.trim()
    if (!fdcId || !description) { skipped_no_name++; return }

    const usdaType  = row.data_type?.trim()
    const subtype   = SOURCE_SUBTYPE_MAP[usdaType] ?? usdaType ?? null
    const dataType  = DATA_TYPE_MAP[usdaType] ?? 'generic'

    foods.set(fdcId, {
      source:          'usda',
      source_id:       fdcId,
      source_subtype:  subtype,
      name:            description,
      brand:           null,
      kcal:            null,
      protein_g:       null,
      fat_g:           null,
      carbs_g:         null,
      fiber_g:         null,
      sodium_mg:       null,
      serving_g:       null,
      serving_label:   null,
      servings_per_container: null,
      data_type:       dataType,
      upc:             null,
      imported_at:     now,
      last_synced_at:  now,
      source_version:  version,
      food_category:   null,
      _food_category_id: row.food_category_id?.trim() || null,  // resolved in pass 2
    })
  })
  console.log(`    → ${foods.size.toLocaleString()} foods loaded · ${skipped_no_name.toLocaleString()} skipped (no name)`)

  // ── Pass 2: food_category.csv ──────────────────────────────────────────────
  console.log('  Pass 2/5 — food_category.csv (resolve category names)…')
  const categories = new Map()  // id → description
  await streamCsv(path.join(folder, 'food_category.csv'), row => {
    if (row.id && row.description) categories.set(row.id, row.description.trim())
  })
  for (const food of foods.values()) {
    if (food._food_category_id && categories.has(food._food_category_id)) {
      food.food_category = categories.get(food._food_category_id)
    }
    delete food._food_category_id
  }
  console.log(`    → ${categories.size.toLocaleString()} categories resolved`)

  // ── Pass 3: branded_food.csv ───────────────────────────────────────────────
  console.log('  Pass 3/5 — branded_food.csv (brand, UPC, serving for branded)…')
  let brandedEnriched = 0
  await streamCsv(path.join(folder, 'branded_food.csv'), row => {
    const food = foods.get(row.fdc_id)
    if (!food) return

    food.brand = (row.brand_owner || row.brand_name || '').trim() || null
    food.upc   = normalizeUpc(row.gtin_upc)

    // Serving conversion to grams
    const sz = parseFloat(row.serving_size)
    if (!isNaN(sz) && sz > 0) {
      const unit = (row.serving_size_unit || '').toLowerCase()
      if (unit === 'g')  food.serving_g = Math.round(sz * 10) / 10
      if (unit === 'ml') food.serving_g = Math.round(sz * 10) / 10
      if (unit === 'oz') food.serving_g = Math.round(sz * 28.3495 * 10) / 10
    }
    food.serving_label = row.household_serving_fulltext?.trim() || null

    brandedEnriched++
  })
  console.log(`    → ${brandedEnriched.toLocaleString()} branded rows enriched`)

  // ── Pass 4: food_portion.csv ───────────────────────────────────────────────
  console.log('  Pass 4/5 — food_portion.csv (serving for non-branded)…')
  let portionEnriched = 0
  await streamCsv(path.join(folder, 'food_portion.csv'), row => {
    const food = foods.get(row.fdc_id)
    if (!food) return
    if (food.serving_g != null) return  // branded already set it

    food.serving_g     = num(row.gram_weight)
    food.serving_label = (row.portion_description || row.modifier || '').trim() || null
    portionEnriched++
  })
  console.log(`    → ${portionEnriched.toLocaleString()} non-branded portion rows applied`)

  // ── Pass 5: food_nutrient.csv (the big one) ────────────────────────────────
  console.log('  Pass 5/5 — food_nutrient.csv (kcal / macros — this is the slow pass)…')
  let nutrientRowsProcessed = 0
  let nutrientRowsApplied   = 0
  await streamCsv(path.join(folder, 'food_nutrient.csv'), row => {
    nutrientRowsProcessed++
    if (nutrientRowsProcessed % 2_000_000 === 0) {
      process.stdout.write(`\r    Streaming nutrient rows: ${nutrientRowsProcessed.toLocaleString()}…`)
    }
    if (!TARGET_NUTRIENTS.has(row.nutrient_id)) return

    const food = foods.get(row.fdc_id)
    if (!food) return

    const key = NUTRIENT_KEY[row.nutrient_id]
    food[key] = num(row.amount)
    nutrientRowsApplied++
  })
  console.log(`\r    → ${nutrientRowsProcessed.toLocaleString()} streamed · ${nutrientRowsApplied.toLocaleString()} applied to foods`)

  // ── Final stats ────────────────────────────────────────────────────────────
  const stats = {
    total:       foods.size,
    by_subtype:  {},
  }
  for (const food of foods.values()) {
    stats.by_subtype[food.source_subtype] = (stats.by_subtype[food.source_subtype] ?? 0) + 1
  }

  return { rows: [...foods.values()], version, stats }
}
