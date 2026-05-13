/**
 * Import OpenNutrition TSV into Supabase opennutrition_foods table.
 * Run: node scripts/import-opennutrition.mjs
 *
 * Columns used (0-based index):
 *   0: id, 1: name, 4: type, 6: serving (JSON), 7: nutrition_100g (JSON)
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_KEY = 'sb_publishable_roSzL0VOILmeVZLN-mdLSQ_G5-zOpu8'
const TSV_PATH    = join(dirname(fileURLToPath(import.meta.url)), '..', 'opennutrition', 'opennutrition_foods.tsv')
const BATCH_SIZE  = 1000

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractBrand(name) {
  const idx = name.lastIndexOf(' by ')
  if (idx < 2) return null
  const brand = name.slice(idx + 4).trim()
  return brand || null
}

function parseServing(raw) {
  try {
    const s = JSON.parse(raw)
    const unit = s?.common?.unit  ?? null
    const qty  = Number(s?.common?.quantity) || null
    let g = null
    const mu = s?.metric?.unit
    if (mu === 'g' || mu === 'ml') g = Number(s.metric.quantity) || null
    return { serving_unit: unit, serving_qty: qty, serving_g: g }
  } catch {
    return { serving_unit: null, serving_qty: null, serving_g: null }
  }
}

function parseNutrition(raw) {
  try {
    const n = JSON.parse(raw)
    return {
      calories: Number(n.calories)        || 0,
      protein:  Number(n.protein)         || 0,
      fat:      Number(n.total_fat)       || 0,
      carbs:    Number(n.carbohydrates)   || 0,
    }
  } catch {
    return { calories: 0, protein: 0, fat: 0, carbs: 0 }
  }
}

async function upsertBatch(rows) {
  const url = `${SUPABASE_URL}/rest/v1/opennutrition_foods?on_conflict=id`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`Reading: ${TSV_PATH}`)
console.log('Starting import…\n')

const rl = createInterface({
  input:      createReadStream(TSV_PATH),
  crlfDelay:  Infinity,
})

let lineNum = 0
let batch   = []
let total   = 0
let skipped = 0
let errors  = 0
const start = Date.now()

for await (const line of rl) {
  lineNum++
  if (lineNum === 1) continue  // skip header

  const cols = line.split('\t')
  const id   = cols[0]?.trim()
  const name = cols[1]?.trim()
  const type = cols[4]?.trim()

  if (!id || !name) { skipped++; continue }

  const brand     = extractBrand(name)
  const serving   = parseServing(cols[6]  ?? '')
  const nutrition = parseNutrition(cols[7] ?? '')

  // Skip entries with no macronutrient data at all
  if (
    nutrition.calories === 0 &&
    nutrition.protein  === 0 &&
    nutrition.fat      === 0 &&
    nutrition.carbs    === 0
  ) { skipped++; continue }

  batch.push({ id, name, brand, type, ...serving, ...nutrition })

  if (batch.length >= BATCH_SIZE) {
    try {
      await upsertBatch(batch)
      total += batch.length
    } catch (e) {
      errors++
      console.error(`\n  ✗ Batch error near line ${lineNum}: ${e.message}`)
    }
    batch = []
    const elapsed = ((Date.now() - start) / 1000).toFixed(0)
    process.stdout.write(
      `\r  ✓ ${total.toLocaleString()} imported · ${skipped.toLocaleString()} skipped · ${errors} errors · ${elapsed}s elapsed`
    )
  }
}

// Flush remaining rows
if (batch.length > 0) {
  try {
    await upsertBatch(batch)
    total += batch.length
  } catch (e) {
    errors++
    console.error(`\nFinal batch error: ${e.message}`)
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(`\n\n──────────────────────────────────────`)
console.log(`  Done in ${elapsed}s`)
console.log(`  Imported : ${total.toLocaleString()}`)
console.log(`  Skipped  : ${skipped.toLocaleString()} (no nutrition data)`)
console.log(`  Errors   : ${errors}`)
console.log(`──────────────────────────────────────`)
