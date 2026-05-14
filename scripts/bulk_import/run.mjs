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
import {
  executeSql,
  bulkInsertRows,
  statsBySource,
  statsBySourceSubtype,
  wipeUsdaAndOn,
  backfillMyrxAuditColumns,
  rebuildFts,
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
  const afterWipe = await statsBySource()
  printStats(afterWipe, 'After wipe')

  console.log('\nStep 4/10 — Backfill MYRX audit columns')
  await backfillMyrxAuditColumns()
  console.log('  ✓ done')

  banner('USDA')
  console.log('Step 5/10 — Load USDA CSVs into memory')
  const tUsdaStart = Date.now()
  const { rows: usdaRows, version: usdaVersion, stats: usdaStats } = await loadUsda(USDA_ROOT)
  console.log(`\n  Built ${fmt(usdaRows.length)} USDA rows in ${fmtMs(Date.now() - tUsdaStart)}`)
  console.log('  By subtype:')
  for (const [k, v] of Object.entries(usdaStats.by_subtype).sort()) {
    console.log(`    ${k}: ${fmt(v)}`)
  }

  console.log('\nStep 6/10 — Push USDA rows to D1')
  const tUsdaPushStart = Date.now()
  await bulkInsertRows(usdaRows, 'usda')
  console.log(`  ✓ USDA pushed in ${fmtMs(Date.now() - tUsdaPushStart)}`)

  banner('OpenNutrition')
  console.log('Step 7/10 — Load ON dataset into memory')
  const tOnStart = Date.now()
  const { rows: onRows, version: onVersion, stats: onStats } = await loadOn(ON_ROOT)
  console.log(`  Built ${fmt(onRows.length)} ON rows in ${fmtMs(Date.now() - tOnStart)}`)
  console.log('  By subtype:')
  for (const [k, v] of Object.entries(onStats.by_subtype).sort()) {
    console.log(`    ${k}: ${fmt(v)}`)
  }

  console.log('\nStep 8/10 — Push ON rows to D1')
  const tOnPushStart = Date.now()
  await bulkInsertRows(onRows, 'on')
  console.log(`  ✓ ON pushed in ${fmtMs(Date.now() - tOnPushStart)}`)

  banner('Finalisation')
  console.log('Step 9/10 — Rebuild FTS5 search index')
  await rebuildFts()
  console.log('  ✓ done')

  console.log('\nStep 10/10 — Final verification')
  const finalStats = await statsBySourceSubtype()
  printStats(finalStats, 'Final row counts (source / source_subtype)')

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
