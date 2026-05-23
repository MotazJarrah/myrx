#!/usr/bin/env node
/**
 * MyRX Food Library — Bulk Import Orchestrator
 *
 * One-shot rebuild of food_library from local USDA + OpenNutrition source files.
 *
 * Usage (from repo root):
 *   node scripts/bulk_import/run.mjs
 *
 * Sequence:
 *   1. Pre-flight checks (files present, env set)
 *   2. Snapshot current D1 state
 *   3. Wipe USDA + ON rows (MYRX preserved)
 *   4. Backfill MYRX audit columns
 *   5. Load USDA into memory (5-pass CSV read)
 *   6. Push USDA to D1 in batches
 *   7. Load ON into memory (ZIP stream)
 *   8. Push ON to D1 in batches
 *   9. Rebuild FTS5 index
 *   10. Final verification report
 *
 * Total expected runtime: 5-15 minutes (mostly the USDA push step).
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { loadUsda } from './lib/usda_loader.mjs'
import { loadOn   } from './lib/on_loader.mjs'
import { applyDedup } from './lib/dedup_in_memory.mjs'
import {
  executeSql,
  bulkInsertRows,
  statsBySource,
  statsBySourceSubtype,
  wipeUsdaAndOn,
  backfillMyrxAuditColumns,
  rebuildFts,
  flattenPortions, bulkInsertPortions, wipePortionsUsdaAndOn,
} from './lib/d1_writer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

const USDA_ROOT = path.join(REPO_ROOT, 'scripts/bulk_import/data/usda')
const ON_ROOT   = path.join(REPO_ROOT, 'scripts/bulk_import/data/on')

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n)    { return n.toLocaleString() }
function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s` }

function banner(text) {
  const line = '═'.repeat(text.length + 4)
  console.log(`\n${line}`)
  console.log(`  ${text}  `)
  console.log(`${line}\n`)
}

function printStats(rows, label) {
  console.log(`\n  ${label}:`)
  for (const r of rows) {
    console.log(`    ${r.source}${r.source_subtype ? ` / ${r.source_subtype}` : ''}: ${fmt(r.n)}`)
  }
  const total = rows.reduce((s, r) => s + r.n, 0)
  console.log(`    ─────────`)
  console.log(`    TOTAL: ${fmt(total)}`)
}

// ── Pre-flight checks ─────────────────────────────────────────────────────────

function preflight() {
  const errors = []

  if (!fs.existsSync(USDA_ROOT)) {
    errors.push(`USDA data folder missing: ${USDA_ROOT}`)
  } else {
    const sub = fs.readdirSync(USDA_ROOT, { withFileTypes: true })
      .find(e => e.isDirectory() && /^FoodData_Central_csv_\d{4}-\d{2}-\d{2}$/.test(e.name))
    if (!sub) errors.push(`No FoodData_Central_csv_YYYY-MM-DD/ subfolder inside ${USDA_ROOT}`)
  }

  if (!fs.existsSync(ON_ROOT)) {
    errors.push(`ON data folder missing: ${ON_ROOT}`)
  } else {
    const zip = fs.readdirSync(ON_ROOT)
      .find(n => /^opennutrition-dataset-\d{4}\.\d+\.zip$/.test(n))
    if (!zip) errors.push(`No opennutrition-dataset-YYYY.N.zip inside ${ON_ROOT}`)
  }

  if (errors.length) {
    console.error('❌ Pre-flight checks failed:\n')
    for (const e of errors) console.error('  •', e)
    console.error('\nSee scripts/bulk_import/README.md for setup steps.')
    process.exit(1)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()

  banner('MyRX Food Library — Bulk Import')

  console.log('Step 1/10 — Pre-flight checks')
  preflight()
  console.log('  ✓ all required files present\n')

  console.log('Step 2/10 — Snapshot current state')
  const before = await statsBySource()
  printStats(before, 'Current row counts')

  console.log('\nStep 3/10 — Wipe USDA + ON rows (MYRX preserved)')
  await wipeUsdaAndOn()
  await wipePortionsUsdaAndOn()
  const afterWipe = await statsBySource()
  printStats(afterWipe, 'After wipe')

  console.log('\nStep 4/10 — Backfill MYRX audit columns')
  await backfillMyrxAuditColumns()
  console.log('  ✓ done')

  banner('USDA')
  console.log('Step 5/11 — Load USDA CSVs into memory (Rules 1-14 applied)')
  const tUsdaStart = Date.now()
  const { rows: usdaRows, version: usdaVersion, stats: usdaStats } = await loadUsda(USDA_ROOT)
  console.log(`\n  Built ${fmt(usdaRows.length)} USDA rows in ${fmtMs(Date.now() - tUsdaStart)}`)
  console.log('  By subtype:')
  for (const [k, v] of Object.entries(usdaStats.by_subtype).sort()) {
    console.log(`    ${k}: ${fmt(v)}`)
  }

  banner('OpenNutrition')
  console.log('Step 6/11 — Load ON dataset into memory (Rules 1-14 applied)')
  const tOnStart = Date.now()
  const { rows: onRows, version: onVersion, stats: onStats } = await loadOn(ON_ROOT)
  console.log(`  Built ${fmt(onRows.length)} ON rows in ${fmtMs(Date.now() - tOnStart)}`)
  console.log('  By subtype:')
  for (const [k, v] of Object.entries(onStats.by_subtype).sort()) {
    console.log(`    ${k}: ${fmt(v)}`)
  }

  // ── Step 7 — apply dedup IN MEMORY before D1 writes ─────────────────────
  // Rules 15-19 require cross-row comparison and were previously run as
  // a post-import SQL pass. At 2M+ rows that hit D1's 30-second per-query
  // budget on every monolithic DELETE. The right place to do dedup is
  // here — in Node, where we hold the combined array and can do it as
  // O(n) Map operations instead of D1's O(n²-ish) self-joins.
  banner('Dedup (in-memory)')
  console.log('Step 7/11 — Apply Rules 15-19 to combined USDA+ON in memory')
  const tDedupStart = Date.now()
  const combined = [...usdaRows, ...onRows]
  const { rows: dedupedRows, stats: dedupStats } = applyDedup(combined)
  console.log(`  ✓ Dedup finished in ${fmtMs(Date.now() - tDedupStart)}`)

  // Free the source arrays — combined holds all references we need now.
  usdaRows.length = 0
  onRows.length = 0

  // Split deduped rows back by source for clearer push logging.
  const finalUsda = dedupedRows.filter(r => r.source === 'usda')
  const finalOn   = dedupedRows.filter(r => r.source === 'on')

  banner('Push to D1')
  console.log(`Step 8/11 — Push ${fmt(dedupedRows.length)} deduped rows to D1`)
  console.log(`  USDA: ${fmt(finalUsda.length)} · ON: ${fmt(finalOn.length)}`)
  const tPushStart = Date.now()
  if (finalUsda.length) {
    console.log('\n  USDA push…')
    await bulkInsertRows(finalUsda, 'usda')
  }
  if (finalOn.length) {
    console.log('\n  ON push…')
    await bulkInsertRows(finalOn, 'on')
  }

  // Portions push — flatten each food's .portions[] into food_portions
  // rows. Always runs after food_library inserts so parent rows exist
  // (no FK enforced, but the order is cleaner).
  const allPortions = flattenPortions(dedupedRows)
  if (allPortions.length) {
    console.log(`\n  Portions push (${fmt(allPortions.length)} rows)…`)
    await bulkInsertPortions(allPortions, 'portions')
  }
  console.log(`  ✓ Push complete in ${fmtMs(Date.now() - tPushStart)}`)

  banner('Finalisation')
  console.log('Step 9/11 — Rebuild FTS5 search index')
  await rebuildFts()
  console.log('  ✓ done')

  // Set sync watermarks so the next incremental sync only fetches deltas
  // since this snapshot, NOT a full 2020-onward re-pull.
  //
  // USDA: extract the snapshot date from the source_version string
  //   "FoodData_Central_csv_2026-04-30" → "2026-04-30"
  // ON: write the version string so the diff-sync skips work when the
  //   published version hasn't changed.
  //
  // NOTE: `executeSql()` in d1_writer.mjs accepts only a SQL string,
  // not bound parameters — values must be inlined into the SQL. Both
  // values here are well-formed dates/version strings with no special
  // characters, so direct inlining is safe (still wrap in single
  // quotes for SQL literal syntax).
  console.log('\n  Setting sync watermarks for incremental sync…')
  const usdaDateMatch = /(\d{4}-\d{2}-\d{2})/.exec(usdaVersion || '')
  const usdaSnapshotDate = usdaDateMatch?.[1] || new Date().toISOString().slice(0, 10)
  // Escape any embedded single quotes defensively.
  const usdaSnapshotDateEsc = usdaSnapshotDate.replace(/'/g, "''")
  const onVersionEsc        = (onVersion || '').replace(/'/g, "''")
  await executeSql(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES ('usda_last_sync_date', '${usdaSnapshotDateEsc}', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
  )
  await executeSql(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES ('on_last_version', '${onVersionEsc}', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
  )
  console.log(`  ✓ usda_last_sync_date = ${usdaSnapshotDate}`)
  console.log(`  ✓ on_last_version    = ${onVersion}`)
  console.log('  Future syncs will fetch only deltas since this snapshot.')

  console.log('\nStep 10/11 — Final row count verification')
  const finalStats = await statsBySourceSubtype()
  printStats(finalStats, 'Final row counts (source / source_subtype)')

  console.log('\nStep 11/11 — Dedup summary')
  console.log('  Rows removed per rule (in-memory pass):')
  for (const [rule, removed] of Object.entries(dedupStats)) {
    console.log(`    ${rule.padEnd(30)} ${fmt(removed).padStart(10)}`)
  }

  banner('Complete')
  console.log(`Total runtime: ${fmtMs(Date.now() - t0)}`)
  console.log(`USDA version:  ${usdaVersion}`)
  console.log(`ON version:    ${onVersion}`)
  console.log('')
  console.log('Next: review docs/food_library_audit.md and start the audit pass.')
}

main().catch(err => {
  console.error('\n❌ Bulk import failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
