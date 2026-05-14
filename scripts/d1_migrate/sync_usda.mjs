/**
 * USDA FoodData Central → D1 incremental sync
 *
 * Fetches three USDA data types in separate passes:
 *   1. Branded Food   — packaged products with UPCs                → data_type='branded'
 *   2. Foundation     — lab-tested canonical ingredients, no UPC   → data_type='generic'
 *   3. SR Legacy      — older USDA Standard Reference, no UPC      → data_type='generic'
 *
 * The previous implementation hardcoded `dataType: ['Branded Food']` and
 * filtered every row through a `shouldSkip` that required a UPC, which is
 * why generic ingredients like "Lettuce, romaine, raw" disappeared from
 * search. Foundation Foods and SR Legacy don't have UPCs by design — they're
 * lab/reference data, not packaged products — so the UPC-or-skip rule was
 * eating them whole. The fix: per-data-type passes, with UPC dedup only on
 * branded.
 *
 * Required env vars:
 *   USDA_API_KEY              — api.data.gov free key
 *   CLOUDFLARE_API_TOKEN      — D1 write access
 *   CLOUDFLARE_ACCOUNT_ID
 *   D1_DATABASE_ID
 *
 * Usage:
 *   node scripts/d1_migrate/sync_usda.mjs
 */

import { createD1Client }                            from './lib/d1.mjs'
import { withRetry }                                 from './lib/retry.mjs'
import { getState, setState, updateProgress,
         setFinalStatus }                            from './lib/sync-state.mjs'
import { normalizeUpc, extractMacros,
         extractServing, shouldSkip,
         dataTypeFromUpc }                           from './lib/normalize.mjs'

// ── Env ───────────────────────────────────────────────────────────────────────

const {
  USDA_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
} = process.env

for (const [k, v] of Object.entries({ USDA_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID })) {
  if (!v) { console.error(`❌ Missing env var: ${k}`); process.exit(1) }
}

// ── Config ────────────────────────────────────────────────────────────────────

const FDC_URL    = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`
const PAGE_SIZE  = 200
const BATCH_SIZE = 100   // D1 batch limit

// USDA API dataType labels in their canonical form (what we send in the
// request body). Foundation + SR Legacy together are ~8K rows, branded is
// ~420K. The branded pass dominates runtime.
const PASSES = Object.freeze([
  { apiLabel: 'Branded Food', shortName: 'branded',    dataType: 'branded' },
  { apiLabel: 'Foundation',   shortName: 'foundation', dataType: 'generic' },
  { apiLabel: 'SR Legacy',    shortName: 'sr_legacy',  dataType: 'generic' },
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10) }

function buildFoodRecord(food, dataType) {
  const upc     = normalizeUpc(food.gtinUpc)
  const macros  = extractMacros(food.foodNutrients)
  const serving = extractServing(food)
  const disc    = !!(food.discontinuedDate)

  return {
    source:        'usda',
    source_id:     String(food.fdcId),
    name:          food.description?.trim() || null,
    brand:         (food.brandOwner || food.brandName || '').trim() || null,
    upc,
    discontinued:  disc,
    // Generics from USDA never have UPCs, but we honour the universal rule:
    // whatever the dataType label says, if a UPC somehow shows up we still
    // classify by the data_type pass we're inside (USDA's enum wins for USDA).
    data_type:     dataType,
    ...macros,
    ...serving,
  }
}

async function fetchPage(apiLabel, pageNumber, dateBegin, dateEnd) {
  return withRetry(async () => {
    const res = await fetch(FDC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataType:    [apiLabel],
        pageSize:    PAGE_SIZE,
        pageNumber,
        dateFilters: { publishedDateBegin: dateBegin, publishedDateEnd: dateEnd },
      }),
    })
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10)
      throw new Error(`USDA rate limited — Retry-After ${retryAfter}s`)
    }
    if (!res.ok) throw new Error(`USDA API ${res.status}: ${await res.text()}`)
    return res.json()
  }, { label: `USDA ${apiLabel} page ${pageNumber}`, retries: 4, baseMs: 3_000 })
}

// ── Branded pass ──────────────────────────────────────────────────────────────
// Branded foods have UPCs. Use UPC-based dedup so the same product submitted by
// multiple brand owners doesn't duplicate, and so newer fdc_ids replace older.

async function syncBranded(db, dateBegin, dateEnd) {
  console.log('\n── Branded Food ─────────────────────────────────')
  let page       = 1
  let totalPages = 1
  let processed  = 0
  let inserted   = 0
  let updated    = 0
  let removed    = 0

  while (page <= totalPages) {
    process.stdout.write(`\r  Page ${page}/${totalPages}…`)
    const data = await fetchPage('Branded Food', page, dateBegin, dateEnd)

    totalPages = data.totalPages ?? 1
    const foods = data.foods ?? []
    if (foods.length === 0) break

    const upsertStmts = []
    const deleteStmts = []

    for (const rawFood of foods) {
      const food = buildFoodRecord(rawFood, 'branded')

      if (food.discontinued) {
        deleteStmts.push({
          sql:    `DELETE FROM food_library WHERE source='usda' AND source_id=?`,
          params: [food.source_id],
        })
        removed++
        continue
      }

      if (shouldSkip(food)) continue   // branded must have UPC + non-zero kcal

      const { results: existing } = await db.query(
        `SELECT source, source_id FROM food_library WHERE upc=? LIMIT 1`, [food.upc]
      )
      const row = existing?.[0]

      if (!row) {
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            food.upc, food.data_type,
          ],
        })
        inserted++
      } else if (row.source === 'myrx') {
        console.log(`  ↳ MYRX superseded by USDA: UPC ${food.upc} (${food.name})`)
        deleteStmts.push({
          sql:    `DELETE FROM food_library WHERE source='myrx' AND upc=?`,
          params: [food.upc],
        })
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            food.upc, food.data_type,
          ],
        })
        inserted++
      } else if (row.source === 'usda' && parseInt(food.source_id) > parseInt(row.source_id)) {
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source_id=?, name=?, brand=?, kcal=?, protein_g=?, fat_g=?,
                  carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?,
                  data_type=?
                WHERE upc=? AND source='usda'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label, food.data_type,
            food.upc,
          ],
        })
        updated++
      } else if (row.source === 'on') {
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source='usda', source_id=?, name=?, brand=?, kcal=?, protein_g=?,
                  fat_g=?, carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?,
                  serving_label=?, data_type=?
                WHERE upc=? AND source='on'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label, food.data_type,
            food.upc,
          ],
        })
        updated++
      }
    }

    if (deleteStmts.length)  await db.batch(deleteStmts)
    if (upsertStmts.length)  await db.batch(upsertStmts)

    processed += foods.length
    await updateProgress(db, { phase: 'usda_branded', page, processed, inserted, updated, removed })
    page++
  }

  console.log(`\n  → ${processed.toLocaleString()} processed · ${inserted.toLocaleString()} new · ${updated.toLocaleString()} updated · ${removed.toLocaleString()} removed`)
  return { processed, inserted, updated, removed }
}

// ── Generic pass (Foundation + SR Legacy) ─────────────────────────────────────
// Generics don't have UPCs, so dedup is by (source, source_id) which the
// table's UNIQUE constraint enforces. INSERT OR IGNORE handles repeats.

async function syncGeneric(db, apiLabel, shortName, dateBegin, dateEnd) {
  console.log(`\n── ${apiLabel} ──────────────────────────────`)
  let page       = 1
  let totalPages = 1
  let processed  = 0
  let inserted   = 0
  let updated    = 0

  while (page <= totalPages) {
    process.stdout.write(`\r  Page ${page}/${totalPages}…`)
    const data = await fetchPage(apiLabel, page, dateBegin, dateEnd)

    totalPages = data.totalPages ?? 1
    const foods = data.foods ?? []
    if (foods.length === 0) break

    const upsertStmts = []

    for (const rawFood of foods) {
      const food = buildFoodRecord(rawFood, 'generic')

      // For generics: name + non-zero kcal required. UPC is NOT required.
      if (!food.name)        continue
      if (food.kcal === 0)   continue

      // Check if this fdc_id already exists. If so, update; otherwise insert.
      const { results: existing } = await db.query(
        `SELECT source_id FROM food_library WHERE source='usda' AND source_id=? LIMIT 1`,
        [food.source_id]
      )
      if (existing?.length) {
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  name=?, brand=?, kcal=?, protein_g=?, fat_g=?, carbs_g=?,
                  fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?, data_type=?
                WHERE source='usda' AND source_id=?`,
          params: [
            food.name, food.brand, food.kcal, food.protein_g, food.fat_g,
            food.carbs_g, food.fiber_g, food.sodium_mg, food.serving_g,
            food.serving_label, food.data_type, food.source_id,
          ],
        })
        updated++
      } else {
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            null, food.data_type,    // generics: upc is null
          ],
        })
        inserted++
      }
    }

    if (upsertStmts.length) await db.batch(upsertStmts)

    processed += foods.length
    await updateProgress(db, { phase: `usda_${shortName}`, page, processed, inserted, updated })
    page++
  }

  console.log(`\n  → ${processed.toLocaleString()} processed · ${inserted.toLocaleString()} new · ${updated.toLocaleString()} updated`)
  return { processed, inserted, updated, removed: 0 }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' USDA Sync → D1 (Branded + Foundation + SR Legacy)')
  console.log('══════════════════════════════════════════')

  const db = createD1Client({
    accountId:  CLOUDFLARE_ACCOUNT_ID,
    databaseId: D1_DATABASE_ID,
    apiToken:   CLOUDFLARE_API_TOKEN,
  })

  const dateBegin = (await getState(db, 'usda_last_sync_date')) || '2020-01-01'
  const dateEnd   = today()
  console.log(`\nFetching USDA foods published ${dateBegin} → ${dateEnd}`)

  await updateProgress(db, {
    phase:     'usda_start',
    page:      0,
    processed: 0,
    inserted:  0,
    updated:   0,
    removed:   0,
  })

  // Run each pass sequentially. Branded is by far the heaviest (~420K rows);
  // Foundation + SR Legacy are quick (~8K rows combined).
  const branded    = await syncBranded(db,             dateBegin, dateEnd)
  const foundation = await syncGeneric(db, 'Foundation', 'foundation', dateBegin, dateEnd)
  const srLegacy   = await syncGeneric(db, 'SR Legacy',  'sr_legacy',  dateBegin, dateEnd)

  const totals = {
    processed: branded.processed + foundation.processed + srLegacy.processed,
    inserted:  branded.inserted  + foundation.inserted  + srLegacy.inserted,
    updated:   branded.updated   + foundation.updated   + srLegacy.updated,
    removed:   branded.removed   + foundation.removed   + srLegacy.removed,
  }

  console.log('\n══════════════════════════════════════════')
  console.log(` Total: ${totals.processed.toLocaleString()} processed · ${totals.inserted.toLocaleString()} new · ${totals.updated.toLocaleString()} updated · ${totals.removed.toLocaleString()} removed`)

  console.log('\n  Rebuilding FTS5 index…')
  await db.query(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`)
  console.log('  ✓ FTS rebuilt')

  await setState(db, 'usda_last_sync_date', dateEnd)
  await updateProgress(db, { phase: 'usda_done', ...totals })
  console.log(`\n✅ USDA sync complete. Last sync date saved: ${dateEnd}`)
}

run().catch(async err => {
  console.error('\n❌ USDA sync failed:', err.message)
  try {
    const db = createD1Client({
      accountId:  CLOUDFLARE_ACCOUNT_ID,
      databaseId: D1_DATABASE_ID,
      apiToken:   CLOUDFLARE_API_TOKEN,
    })
    await setFinalStatus(db, 'failed', `USDA: ${err.message}`)
  } catch {}
  process.exit(1)
})
