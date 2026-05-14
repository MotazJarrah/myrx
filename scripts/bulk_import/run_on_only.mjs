#!/usr/bin/env node
/**
 * Standalone ON-only loader. Use when USDA has already landed and you just
 * need to add OpenNutrition without redoing the whole bulk import.
 *
 * Recommended invocation (extra heap for safety):
 *   node --max-old-space-size=8192 scripts/bulk_import/run_on_only.mjs
 */

import path from 'path'
import { fileURLToPath } from 'url'

import { loadOn } from './lib/on_loader.mjs'
import {
  bulkInsertRows,
  statsBySource,
  statsBySourceSubtype,
  rebuildFts,
  executeSql,
} from './lib/d1_writer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const ON_ROOT   = path.join(REPO_ROOT, 'scripts/bulk_import/data/on')

const fmt = n => n.toLocaleString()
const fmtMs = ms => `${(ms / 1000).toFixed(1)}s`

async function main() {
  const t0 = Date.now()
  console.log('═══ ON-only load ═══\n')

  console.log('Step 1/5 — Snapshot current state')
  const before = await statsBySource()
  for (const r of before) console.log(`  ${r.source}: ${fmt(r.n)}`)

  console.log('\nStep 2/5 — Wipe ON rows (USDA + MYRX preserved)')
  await executeSql(`DELETE FROM food_library WHERE source = 'on';`)
  console.log('  ✓ done')

  console.log('\nStep 3/5 — Load ON dataset')
  const t1 = Date.now()
  const { rows, version, stats } = await loadOn(ON_ROOT)
  console.log(`  Built ${fmt(rows.length)} rows in ${fmtMs(Date.now() - t1)}`)
  console.log('  By subtype:')
  for (const [k, v] of Object.entries(stats.by_subtype).sort()) {
    console.log(`    ${k}: ${fmt(v)}`)
  }

  console.log('\nStep 4/5 — Push to D1')
  const t2 = Date.now()
  await bulkInsertRows(rows, 'on')
  console.log(`  ✓ pushed in ${fmtMs(Date.now() - t2)}`)

  console.log('\nStep 5/5 — Rebuild FTS5 index')
  await rebuildFts()
  console.log('  ✓ done')

  console.log('\n═══ Final state ═══')
  const final = await statsBySourceSubtype()
  for (const r of final) {
    console.log(`  ${r.source}${r.source_subtype ? ` / ${r.source_subtype}` : ''}: ${fmt(r.n)}`)
  }

  console.log(`\nON version: ${version}`)
  console.log(`Runtime:    ${fmtMs(Date.now() - t0)}`)
}

main().catch(err => {
  console.error('\n❌ ON load failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
