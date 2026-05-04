/**
 * USDA FoodData Central → D1 incremental sync
 *
 * Fetches branded foods published/updated since the last sync date,
 * applies upsert rules, removes discontinued products, and rebuilds FTS.
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

import { createD1Client }                        from './lib/d1.mjs'
import { withRetry }                             from './lib/retry.mjs'
import { getState, setState, updateProgress,
         setFinalStatus }                        from './lib/sync-state.mjs'
import { normalizeUpc, extractMacros,
         extractServing, shouldSkip }            from './lib/normalize.mjs'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10) }

function buildFoodRecord(food) {
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
    ...macros,
    ...serving,
  }
}

async function fetchPage(db, pageNumber, dateBegin, dateEnd) {
  return withRetry(async () => {
    const res = await fetch(FDC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataType:    ['Branded Food'],
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
  }, { label: `USDA page ${pageNumber}`, retries: 4, baseMs: 3_000 })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' USDA Incremental Sync → D1')
  console.log('══════════════════════════════════════════\n')

  const db = createD1Client({
    accountId:  CLOUDFLARE_ACCOUNT_ID,
    databaseId: D1_DATABASE_ID,
    apiToken:   CLOUDFLARE_API_TOKEN,
  })

  // ── Date range ──────────────────────────────────────────────────────────────
  const dateBegin = (await getState(db, 'usda_last_sync_date')) || '2020-01-01'
  const dateEnd   = today()
  console.log(`Fetching USDA branded foods published ${dateBegin} → ${dateEnd}\n`)

  await updateProgress(db, { phase: 'usda', page: 0, processed: 0, inserted: 0, updated: 0, removed: 0 })

  let page       = 1
  let totalPages = 1
  let processed  = 0
  let inserted   = 0
  let updated    = 0
  let removed    = 0

  // ── Pagination loop ─────────────────────────────────────────────────────────
  while (page <= totalPages) {
    process.stdout.write(`\r  Page ${page}/${totalPages}…`)
    const data = await fetchPage(db, page, dateBegin, dateEnd)

    totalPages = data.totalPages ?? 1
    const foods = data.foods ?? []
    if (foods.length === 0) break

    // Build upsert + delete batches
    const upsertStmts  = []
    const deleteStmts  = []

    for (const rawFood of foods) {
      const food = buildFoodRecord(rawFood)

      if (food.discontinued) {
        deleteStmts.push({
          sql:    `DELETE FROM food_library WHERE source='usda' AND source_id=?`,
          params: [food.source_id],
        })
        removed++
        continue
      }

      if (shouldSkip(food)) continue

      // Check existing row for this UPC
      const { results: existing } = await db.query(
        `SELECT source, source_id FROM food_library WHERE upc=? LIMIT 1`, [food.upc]
      )
      const row = existing?.[0]

      if (!row) {
        // New — insert
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            food.upc,
          ],
        })
        inserted++
      } else if (row.source === 'usda' && parseInt(food.source_id) > parseInt(row.source_id)) {
        // Newer USDA submission — replace
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source_id=?, name=?, brand=?, kcal=?, protein_g=?, fat_g=?,
                  carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?
                WHERE upc=? AND source='usda'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label,
            food.upc,
          ],
        })
        updated++
      } else if (row.source === 'on') {
        // USDA wins over ON — replace
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source='usda', source_id=?, name=?, brand=?, kcal=?, protein_g=?,
                  fat_g=?, carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?
                WHERE upc=? AND source='on'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label,
            food.upc,
          ],
        })
        updated++
      }
      // else: same or older USDA — skip
    }

    // Flush batches
    if (deleteStmts.length)  await db.batch(deleteStmts)
    if (upsertStmts.length)  await db.batch(upsertStmts)

    processed += foods.length
    await updateProgress(db, { page, processed, inserted, updated, removed })
    page++
  }

  console.log(`\n\n  → ${processed.toLocaleString()} foods processed`)
  console.log(`     ${inserted.toLocaleString()} inserted · ${updated.toLocaleString()} updated · ${removed.toLocaleString()} removed`)

  // ── Rebuild FTS ─────────────────────────────────────────────────────────────
  console.log('\n  Rebuilding FTS5 index…')
  await db.query(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`)
  console.log('  ✓ FTS rebuilt')

  // ── Save sync date ──────────────────────────────────────────────────────────
  await setState(db, 'usda_last_sync_date', dateEnd)
  await updateProgress(db, { phase: 'usda_done', processed, inserted, updated, removed })
  console.log(`\n✅ USDA sync complete. Last sync date saved: ${dateEnd}`)
}

run().catch(async err => {
  console.error('\n❌ USDA sync failed:', err.message)
  // Write failure status to D1 so the Worker status endpoint reflects it
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
