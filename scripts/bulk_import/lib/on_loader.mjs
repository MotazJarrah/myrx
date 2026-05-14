/**
 * OpenNutrition loader — reads the dataset ZIP and builds row records.
 *
 * Expects:
 *   data/on/opennutrition-dataset-YYYY.N.zip
 *
 * The ZIP contains one TSV file (opennutrition_foods.tsv). We stream-extract
 * + line-read it without writing the full TSV to disk.
 *
 * Filter philosophy: NO row-level filters during this pass. Every parseable
 * TSV row makes it through.
 *
 * source_subtype assignment:
 *   - has ean_13 (barcode)         → 'on_branded' (data_type='branded')
 *   - no ean_13, name has " by X"  → 'on_branded' (still has brand info)
 *   - no ean_13, no brand pattern  → 'on_generic' (data_type='generic')
 * We'll refine these classifications during audit if needed.
 */

import fs       from 'fs'
import path     from 'path'
import readline from 'readline'
import unzipper from 'unzipper'
import { shouldKeepFood, getFilterReason, enrichFood } from '../../d1_migrate/lib/filters.mjs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(str, fallback = null) {
  try { return JSON.parse(str) } catch { return fallback }
}

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

/** Parse "Product Name by Brand" → { name, brand }. */
function parseNameByBrand(str) {
  const trimmed = String(str ?? '').trim()
  const idx = trimmed.lastIndexOf(' by ')
  if (idx <= 0) return { name: trimmed, brand: null }
  return {
    name:  trimmed.slice(0, idx).trim(),
    brand: trimmed.slice(idx + 4).trim() || null,
  }
}

/** Find the opennutrition-dataset-*.zip inside data/on/. */
function findOnZip(onRoot) {
  if (!fs.existsSync(onRoot)) {
    throw new Error(`ON data folder not found: ${onRoot}`)
  }
  const entries = fs.readdirSync(onRoot)
  const zip = entries.find(name =>
    /^opennutrition-dataset-\d{4}\.\d+\.zip$/.test(name)
  )
  if (!zip) {
    throw new Error(
      `No opennutrition-dataset-YYYY.N.zip inside ${onRoot}. ` +
      `Download the dataset and put the zip there.`
    )
  }
  return path.join(onRoot, zip)
}

function versionFromZipName(zipPath) {
  const base = path.basename(zipPath)
  const match = base.match(/opennutrition-dataset-(\d{4}\.\d+)\.zip/)
  return match ? match[1] : 'unknown'
}

// ── Stream the TSV out of the ZIP ────────────────────────────────────────────

function streamOnTsv(zipPath, onRow) {
  return new Promise((resolve, reject) => {
    let count = 0
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        if (entry.path !== 'opennutrition_foods.tsv') {
          entry.autodrain()
          return
        }
        let headers = null
        const rl = readline.createInterface({ input: entry, crlfDelay: Infinity })
        rl.on('line', line => {
          if (!line.trim()) return
          const cols = line.split('\t')
          if (!headers) { headers = cols; return }
          const obj = {}
          headers.forEach((h, i) => { obj[h] = cols[i] ?? '' })
          onRow(obj)
          count++
          if (count % 50_000 === 0) {
            process.stdout.write(`\r    Streaming ON rows: ${count.toLocaleString()}…`)
          }
        })
        rl.on('close', () => resolve(count))
        rl.on('error', reject)
      })
      .on('error', reject)
  })
}

// ── Main loader ──────────────────────────────────────────────────────────────

/**
 * @param {string} onRoot — path to scripts/bulk_import/data/on/
 * @returns {Promise<{ rows: Array<object>, version: string, stats: object }>}
 */
export async function loadOn(onRoot) {
  const zipPath = findOnZip(onRoot)
  const version = versionFromZipName(zipPath)
  const now     = new Date().toISOString()
  console.log(`  Using ZIP: ${path.basename(zipPath)} (version ${version})`)

  const rows = []
  let skipped_no_name = 0

  await streamOnTsv(zipPath, row => {
    const rawName = row.name?.trim()
    if (!rawName) { skipped_no_name++; return }

    const upc          = normalizeUpc(row.ean_13)
    const macros100g   = safeJson(row.nutrition_100g, {})
    const serving      = safeJson(row.serving,        {})
    const parsed       = parseNameByBrand(rawName)
    const onCategory   = row.category?.trim() || null

    // source_subtype rule (we'll refine in audit if needed)
    let source_subtype, data_type
    if (upc) {
      source_subtype = 'on_branded'
      data_type      = 'branded'
    } else if (parsed.brand) {
      source_subtype = 'on_branded'
      data_type      = 'branded'
    } else {
      source_subtype = 'on_generic'
      data_type      = 'generic'
    }

    // Macros from nutrition_100g JSON. ON's keys vary; we accept a few common spellings.
    const kcal = num(macros100g?.calories ?? macros100g?.energy_kcal)
    const protein_g = num(macros100g?.protein)
    const fat_g     = num(macros100g?.total_fat ?? macros100g?.fat)
    const carbs_g   = num(macros100g?.carbohydrates ?? macros100g?.carbs)
    const fiber_g   = num(macros100g?.dietary_fiber ?? macros100g?.fiber)
    // ON sodium is in grams; convert to mg
    const sodium_g_raw = macros100g?.sodium
    const sodium_mg = sodium_g_raw != null && isFinite(sodium_g_raw)
      ? Math.round(sodium_g_raw * 1000 * 100) / 100
      : null

    // Serving info from serving JSON
    let serving_g = null
    let serving_label = null
    const metric = serving?.metric
    if (metric?.unit === 'g' && metric?.quantity > 0) serving_g = Math.round(metric.quantity * 10) / 10
    const common = serving?.common
    if (common?.quantity && common?.unit) {
      serving_label = `${common.quantity} ${common.unit}`
    } else if (serving?.description) {
      serving_label = String(serving.description).trim() || null
    }

    rows.push({
      source:          'on',
      source_id:       row.id,
      source_subtype,
      name:            parsed.name || rawName,
      brand:           parsed.brand,
      kcal,
      protein_g,
      fat_g,
      carbs_g,
      fiber_g,
      sodium_mg,
      serving_g,
      serving_label,
      servings_per_container: null,
      data_type,
      upc,
      imported_at:     now,
      last_synced_at:  now,
      source_version:  version,
      food_category:   onCategory,
    })
  })

  console.log('')
  console.log(`  Raw parsed: ${rows.length.toLocaleString()} ON rows · ${skipped_no_name.toLocaleString()} skipped (no name)`)

  // ── Filter pass — apply per-row audit rules at INSERT time ────────────────
  // Same shared filter library as the USDA loader. See
  // scripts/d1_migrate/lib/filters.mjs.
  console.log('  Applying enrichment + filter rules…')
  const kept     = []
  const rejected = {}
  let enriched_count = 0
  for (const rawRow of rows) {
    // Rule 9 — backfill missing kcal from macros BEFORE running rejection rules
    const row = enrichFood(rawRow)
    if (row !== rawRow) enriched_count++

    if (shouldKeepFood(row)) {
      kept.push(row)
    } else {
      const reason = getFilterReason(row) ?? 'unknown'
      rejected[reason] = (rejected[reason] ?? 0) + 1
    }
  }
  if (enriched_count > 0) console.log(`    ⓘ Rule 9 backfilled kcal on ${enriched_count.toLocaleString()} rows`)
  const droppedTotal = rows.length - kept.length
  console.log(`    → ${kept.length.toLocaleString()} kept · ${droppedTotal.toLocaleString()} filtered out`)
  for (const [reason, n] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) {
    console.log(`        ${reason}: ${n.toLocaleString()}`)
  }

  const stats = {
    total:      kept.length,
    filtered:   droppedTotal,
    by_reason:  rejected,
    by_subtype: {},
  }
  for (const r of kept) {
    stats.by_subtype[r.source_subtype] = (stats.by_subtype[r.source_subtype] ?? 0) + 1
  }

  return { rows: kept, version, stats }
}
