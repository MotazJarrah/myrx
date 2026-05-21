/**
 * USDA FoodData Central → D1 incremental sync
 *
 * Fetches three USDA data types in separate passes:
 *   1. Branded Food   — packaged products with UPCs                → data_type='branded'
 *   2. Foundation     — lab-tested canonical ingredients, no UPC   → data_type='generic'
 *   3. SR Legacy      — older USDA Standard Reference, no UPC      → data_type='generic'
 *
 * The previous implementation hardcoded `dataType: ['Branded']` and
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
         extractServing,
         dataTypeFromUpc }                           from './lib/normalize.mjs'
import { enrichFood, getFilterReason }               from './lib/filters.mjs'
import { shouldApplyToLiveDb, isChangelogEnabled,
         recordInsert, recordUpdate, recordDelete,
         flushAll, isCancelRequested,
         pushSyncState }                             from './lib/changelog-recorder.mjs'

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
// ~455K. The branded pass dominates runtime.
//
// IMPORTANT: these strings are the literal values USDA's /foods/search
// endpoint accepts. The API does NOT canonicalise variants — "Branded Food"
// returns zero hits, only "Branded" works. Same for "Foundation" (not
// "Foundation Food"). This was the source of a months-long invisible bug
// where the sync's branded pass quietly returned 0 results.
const PASSES = Object.freeze([
  { apiLabel: 'Branded',    shortName: 'branded',    dataType: 'branded', subtype: 'branded_food'    },
  { apiLabel: 'Foundation', shortName: 'foundation', dataType: 'generic', subtype: 'foundation_food' },
  { apiLabel: 'SR Legacy',  shortName: 'sr_legacy',  dataType: 'generic', subtype: 'sr_legacy_food'  },
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10) }

function buildFoodRecord(food, dataType, subtype) {
  const upc     = normalizeUpc(food.gtinUpc)
  const macros  = extractMacros(food.foodNutrients)
  const serving = extractServing(food)
  const disc    = !!(food.discontinuedDate)

  return {
    source:         'usda',
    source_id:      String(food.fdcId),
    name:           food.description?.trim() || null,
    brand:          (food.brandOwner || food.brandName || '').trim() || null,
    upc,
    discontinued:   disc,
    // Generics from USDA never have UPCs, but we honour the universal rule:
    // whatever the dataType label says, if a UPC somehow shows up we still
    // classify by the data_type pass we're inside (USDA's enum wins for USDA).
    data_type:      dataType,
    // source_subtype is REQUIRED for filter Rules 5 + 14 to fire correctly
    // (Rule 5 rejects research artifacts, Rule 14 rejects negligible
    // branded entries). Without it, those rules silently pass everything.
    source_subtype: subtype,
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
  // filterStats accumulates rule-rejection counts across all pages so the
  // end-of-pass log + admin UI can see exactly which rules dropped what.
  const filterStats = {}

  while (page <= totalPages) {
    process.stdout.write(`\r  Page ${page}/${totalPages}…`)
    const data = await fetchPage('Branded', page, dateBegin, dateEnd)

    totalPages = data.totalPages ?? 1
    const foods = data.foods ?? []
    if (foods.length === 0) break

    const upsertStmts = []
    const deleteStmts = []

    for (const rawFood of foods) {
      let food = buildFoodRecord(rawFood, 'branded', 'branded_food')

      if (food.discontinued) {
        // Need before-state for changelog. SELECT before adding the
        // delete to the batch.
        if (isChangelogEnabled()) {
          const { results: prev } = await db.query(
            `SELECT * FROM food_library WHERE source='usda' AND source_id=? LIMIT 1`,
            [food.source_id]
          )
          if (prev?.[0]) recordDelete(prev[0])
        }
        deleteStmts.push({
          sql:    `DELETE FROM food_library WHERE source='usda' AND source_id=?`,
          params: [food.source_id],
        })
        removed++
        continue
      }

      // Branded entries must have a UPC — non-branded USDA gets caught by
      // shouldSkip's universal "branded needs UPC" check in the legacy
      // pipeline. Preserving that check here as a precondition for the
      // filter pipeline so we don't waste cycles on rows with no UPC.
      if (!food.upc) { filterStats.no_upc = (filterStats.no_upc || 0) + 1; continue }

      // ── 19-rule filter pipeline (same as bulk import) ─────────────────
      food = enrichFood(food)
      const reason = getFilterReason(food)
      if (reason) {
        filterStats[reason] = (filterStats[reason] || 0) + 1
        continue
      }

      // Fetch the existing row by UPC. We need the full row (not just
      // source + source_id) when changelog recording is enabled, because
      // updates need before_data. When NOT enabled, we still only need
      // the two columns — a thin SELECT is fine.
      const selectCols = isChangelogEnabled()
        ? '*'
        : 'source, source_id'
      const { results: existing } = await db.query(
        `SELECT ${selectCols} FROM food_library WHERE upc=? LIMIT 1`,
        [food.upc]
      )
      const row = existing?.[0]

      if (!row) {
        recordInsert(food)
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type, source_subtype)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            food.upc, food.data_type, food.source_subtype,
          ],
        })
        inserted++
      } else if (row.source === 'myrx') {
        console.log(`  ↳ MYRX superseded by USDA: UPC ${food.upc} (${food.name})`)
        if (isChangelogEnabled()) recordDelete(row)
        deleteStmts.push({
          sql:    `DELETE FROM food_library WHERE source='myrx' AND upc=?`,
          params: [food.upc],
        })
        recordInsert(food)
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type, source_subtype)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            food.upc, food.data_type, food.source_subtype,
          ],
        })
        inserted++
      } else if (row.source === 'usda' && parseInt(food.source_id) > parseInt(row.source_id)) {
        if (isChangelogEnabled()) recordUpdate(row, food)
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source_id=?, name=?, brand=?, kcal=?, protein_g=?, fat_g=?,
                  carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?,
                  data_type=?, source_subtype=?
                WHERE upc=? AND source='usda'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label, food.data_type,
            food.source_subtype, food.upc,
          ],
        })
        updated++
      } else if (row.source === 'on') {
        if (isChangelogEnabled()) recordUpdate(row, food)
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  source='usda', source_id=?, name=?, brand=?, kcal=?, protein_g=?,
                  fat_g=?, carbs_g=?, fiber_g=?, sodium_mg=?, serving_g=?,
                  serving_label=?, data_type=?, source_subtype=?
                WHERE upc=? AND source='on'`,
          params: [
            food.source_id, food.name, food.brand, food.kcal,
            food.protein_g, food.fat_g, food.carbs_g, food.fiber_g,
            food.sodium_mg, food.serving_g, food.serving_label, food.data_type,
            food.source_subtype, food.upc,
          ],
        })
        updated++
      }
    }

    // In staged mode the changelog already has every change — we skip
    // the live D1 writes. The user's manual Commit click will apply
    // them via /admin/sync/commit.
    if (shouldApplyToLiveDb()) {
      if (deleteStmts.length)  await db.batch(deleteStmts)
      if (upsertStmts.length)  await db.batch(upsertStmts)
    }

    // Honor cancel requests between pages.
    if (await isCancelRequested()) {
      console.log('\n  ⚠ Cancel requested — aborting branded pass')
      await flushAll()
      return { processed, inserted, updated, removed, filterStats, cancelled: true }
    }

    processed += foods.length
    await updateProgress(db, { phase: 'usda_branded', page, total_pages: totalPages, processed, inserted, updated, removed, filterStats })
    page++
  }

  const totalFiltered = Object.values(filterStats).reduce((a, b) => a + b, 0)
  console.log(`\n  → ${processed.toLocaleString()} processed · ${inserted.toLocaleString()} new · ${updated.toLocaleString()} updated · ${removed.toLocaleString()} removed · ${totalFiltered.toLocaleString()} filtered`)
  if (totalFiltered > 0) {
    const breakdown = Object.entries(filterStats)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `${rule}=${n}`)
      .join(', ')
    console.log(`     filter breakdown: ${breakdown}`)
  }
  return { processed, inserted, updated, removed, filterStats }
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
  const filterStats = {}
  // PASSES table maps apiLabel → subtype. For Foundation that's
  // 'foundation_food', for SR Legacy that's 'sr_legacy_food'.
  const subtype = PASSES.find(p => p.apiLabel === apiLabel)?.subtype ?? null

  while (page <= totalPages) {
    process.stdout.write(`\r  Page ${page}/${totalPages}…`)
    const data = await fetchPage(apiLabel, page, dateBegin, dateEnd)

    totalPages = data.totalPages ?? 1
    const foods = data.foods ?? []
    if (foods.length === 0) break

    const upsertStmts = []

    for (const rawFood of foods) {
      let food = buildFoodRecord(rawFood, 'generic', subtype)

      // ── 19-rule filter pipeline (same as bulk import + branded) ──────
      // Replaces the legacy `if (!food.name) / if (food.kcal === 0)` skip
      // pair. The rules catch those (Rule 6 for short names, Rule 8 for
      // all-zero macros) AND apply the full Tier 1-4 hierarchy.
      food = enrichFood(food)
      const reason = getFilterReason(food)
      if (reason) {
        filterStats[reason] = (filterStats[reason] || 0) + 1
        continue
      }

      // Check if this fdc_id already exists. If so, update; otherwise insert.
      const selectCols = isChangelogEnabled() ? '*' : 'source_id'
      const { results: existing } = await db.query(
        `SELECT ${selectCols} FROM food_library WHERE source='usda' AND source_id=? LIMIT 1`,
        [food.source_id]
      )
      if (existing?.length) {
        if (isChangelogEnabled()) recordUpdate(existing[0], food)
        upsertStmts.push({
          sql: `UPDATE food_library SET
                  name=?, brand=?, kcal=?, protein_g=?, fat_g=?, carbs_g=?,
                  fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?, data_type=?,
                  source_subtype=?
                WHERE source='usda' AND source_id=?`,
          params: [
            food.name, food.brand, food.kcal, food.protein_g, food.fat_g,
            food.carbs_g, food.fiber_g, food.sodium_mg, food.serving_g,
            food.serving_label, food.data_type, food.source_subtype, food.source_id,
          ],
        })
        updated++
      } else {
        recordInsert(food)
        upsertStmts.push({
          sql: `INSERT OR IGNORE INTO food_library
                  (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
                   fiber_g, sodium_mg, serving_g, serving_label, upc, data_type, source_subtype)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            food.source, food.source_id, food.name, food.brand,
            food.kcal, food.protein_g, food.fat_g, food.carbs_g,
            food.fiber_g, food.sodium_mg, food.serving_g, food.serving_label,
            null, food.data_type, food.source_subtype,    // generics: upc is null
          ],
        })
        inserted++
      }
    }

    if (shouldApplyToLiveDb() && upsertStmts.length) await db.batch(upsertStmts)

    processed += foods.length
    await updateProgress(db, { phase: `usda_${shortName}`, page, total_pages: totalPages, processed, inserted, updated, filterStats })

    if (await isCancelRequested()) {
      console.log(`\n  ⚠ Cancel requested — aborting ${apiLabel} pass`)
      await flushAll()
      return { processed, inserted, updated, removed: 0, filterStats, cancelled: true }
    }
    page++
  }

  const totalFiltered = Object.values(filterStats).reduce((a, b) => a + b, 0)
  console.log(`\n  → ${processed.toLocaleString()} processed · ${inserted.toLocaleString()} new · ${updated.toLocaleString()} updated · ${totalFiltered.toLocaleString()} filtered`)
  if (totalFiltered > 0) {
    const breakdown = Object.entries(filterStats)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `${rule}=${n}`)
      .join(', ')
    console.log(`     filter breakdown: ${breakdown}`)
  }
  return { processed, inserted, updated, removed: 0, filterStats }
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
  //
  // Cancellation: each pass returns `cancelled: true` if it noticed the
  // cancel flag mid-stream. Once we see that, skip remaining passes,
  // push a 'cancelled' state to the worker so the UI reflects it, and
  // exit early (process.exit(0) — cleanly cancelled, not failed).
  const branded = await syncBranded(db, dateBegin, dateEnd)
  if (branded.cancelled) {
    console.log('\n⚠ Sync cancelled — skipping remaining passes')
    await flushAll()
    await pushSyncState({ status: 'cancelled', error: 'Cancelled by admin' })
    process.exit(0)
  }
  const foundation = await syncGeneric(db, 'Foundation', 'foundation', dateBegin, dateEnd)
  if (foundation.cancelled) {
    console.log('\n⚠ Sync cancelled — skipping remaining passes')
    await flushAll()
    await pushSyncState({ status: 'cancelled', error: 'Cancelled by admin' })
    process.exit(0)
  }
  const srLegacy = await syncGeneric(db, 'SR Legacy',  'sr_legacy',  dateBegin, dateEnd)
  if (srLegacy.cancelled) {
    console.log('\n⚠ Sync cancelled — skipping remaining passes')
    await flushAll()
    await pushSyncState({ status: 'cancelled', error: 'Cancelled by admin' })
    process.exit(0)
  }

  const totals = {
    processed: branded.processed + foundation.processed + srLegacy.processed,
    inserted:  branded.inserted  + foundation.inserted  + srLegacy.inserted,
    updated:   branded.updated   + foundation.updated   + srLegacy.updated,
    removed:   branded.removed   + foundation.removed   + srLegacy.removed,
  }

  console.log('\n══════════════════════════════════════════')
  console.log(` Total: ${totals.processed.toLocaleString()} processed · ${totals.inserted.toLocaleString()} new · ${totals.updated.toLocaleString()} updated · ${totals.removed.toLocaleString()} removed`)

  // Flush remaining changelog entries before declaring success.
  await flushAll()

  // FTS5 rebuild only makes sense if we actually wrote to food_library.
  // In staged mode the data isn't there yet, so the FTS rebuild happens
  // on commit instead (the worker's /admin/sync/commit endpoint takes
  // care of it after applying the changelog).
  if (shouldApplyToLiveDb()) {
    console.log('\n  Rebuilding FTS5 index…')
    await db.query(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`)
    console.log('  ✓ FTS rebuilt')
    await setState(db, 'usda_last_sync_date', dateEnd)
  }

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
