#!/usr/bin/env node
/**
 * MyRX Food Library — Clean Rebuild Orchestrator
 *
 * End-of-audit clean rebuild. Drops the existing food_library + food_fts
 * tables, recreates them with the post-audit schema, runs the bulk import
 * with all per-row filter rules applied at INSERT time, restores myrx from
 * a JSON backup, then runs the post-import dedup passes.
 *
 * Expected final state: ~1M rows, ~300 MB D1 size, all 7 filter rules
 * baked into the source code so future syncs maintain the clean state.
 *
 * Pre-flight requirements (verified before destructive ops):
 *   - scripts/bulk_import/data/usda/FoodData_Central_csv_YYYY-MM-DD/*.csv
 *   - scripts/bulk_import/data/on/opennutrition-dataset-YYYY.N.zip
 *   - scripts/bulk_import/myrx_backup.json (6 myrx admin rows)
 *
 * Usage:
 *   node --max-old-space-size=8192 scripts/bulk_import/clean_rebuild.mjs
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

import { loadUsda } from './lib/usda_loader.mjs'
import { loadOn   } from './lib/on_loader.mjs'
import {
  bulkInsertRows,
  executeSql,
  statsBySource,
  statsBySourceSubtype,
} from './lib/d1_writer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

const USDA_ROOT       = path.join(REPO_ROOT, 'scripts/bulk_import/data/usda')
const ON_ROOT         = path.join(REPO_ROOT, 'scripts/bulk_import/data/on')
const MYRX_BACKUP     = path.join(REPO_ROOT, 'scripts/bulk_import/myrx_backup.json')
const WRANGLER_CONFIG = path.resolve(REPO_ROOT, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'myrx_bulk_import')

const fmt   = n => n.toLocaleString()
const fmtMs = ms => `${(ms / 1000).toFixed(1)}s`

function banner(text) {
  const line = '═'.repeat(text.length + 4)
  console.log(`\n${line}\n  ${text}  \n${line}\n`)
}

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

  if (!fs.existsSync(MYRX_BACKUP)) {
    errors.push(`MYRX backup missing: ${MYRX_BACKUP}`)
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(MYRX_BACKUP, 'utf8'))
      const rows = raw?.[0]?.results
      if (!Array.isArray(rows) || rows.length === 0) {
        errors.push(`MYRX backup exists but has no rows: ${MYRX_BACKUP}`)
      }
    } catch (e) {
      errors.push(`MYRX backup unreadable: ${e.message}`)
    }
  }

  if (errors.length) {
    console.error('❌ Pre-flight failed:\n')
    for (const e of errors) console.error('  •', e)
    process.exit(1)
  }
}

function dropAndRecreate() {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp = path.join(TMP_DIR, '_drop_recreate.sql')
  fs.writeFileSync(fp, `
DROP TABLE IF EXISTS food_fts;
DROP TABLE IF EXISTS food_library;

CREATE TABLE food_library (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT    NOT NULL DEFAULT 'usda',
  source_id      TEXT    NOT NULL,
  source_subtype TEXT,
  name           TEXT    NOT NULL,
  brand          TEXT,
  kcal           REAL,
  protein_g      REAL,
  fat_g          REAL,
  carbs_g        REAL,
  fiber_g        REAL,
  sodium_mg      REAL,
  serving_g      REAL,
  serving_label  TEXT,
  servings_per_container REAL,
  data_type      TEXT,
  upc            TEXT,
  imported_at    TEXT,
  last_synced_at TEXT,
  source_version TEXT,
  UNIQUE(source, source_id)
);

CREATE VIRTUAL TABLE food_fts USING fts5(
  name, brand,
  content = food_library, content_rowid = id,
  tokenize = 'unicode61 remove_diacritics 1'
);
`.trim())

  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --file="${fp}" --config="${WRANGLER_CONFIG}"`,
      { stdio: 'inherit' }
    )
  } finally {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }
}

function insertMyrx() {
  const raw = JSON.parse(fs.readFileSync(MYRX_BACKUP, 'utf8'))
  const rows = raw[0].results
  const now = new Date().toISOString()

  // Re-shape the backed-up rows for the new schema (drop food_category etc.)
  const reshaped = rows.map(r => ({
    source:          'myrx',
    source_id:       r.source_id,
    source_subtype:  r.source_subtype ?? 'admin_custom',
    name:            r.name,
    brand:           r.brand,
    kcal:            r.kcal,
    protein_g:       r.protein_g,
    fat_g:           r.fat_g,
    carbs_g:         r.carbs_g,
    fiber_g:         r.fiber_g,
    sodium_mg:       r.sodium_mg,
    serving_g:       r.serving_g,
    serving_label:   r.serving_label,
    servings_per_container: r.servings_per_container,
    data_type:       r.data_type ?? (r.upc || r.brand ? 'branded' : 'generic'),
    upc:             r.upc,
    imported_at:     r.imported_at ?? now,
    last_synced_at:  now,
    source_version:  null,
  }))

  return reshaped
}

async function main() {
  const t0 = Date.now()

  banner('MyRX Food Library — Clean Rebuild')

  console.log('Step 1/9 — Pre-flight')
  preflight()
  console.log('  ✓ all assets present\n')

  console.log('Step 2/9 — Drop + recreate tables')
  dropAndRecreate()
  console.log('  ✓ food_library + food_fts recreated with new schema\n')

  banner('USDA load')
  console.log('Step 3/9 — Load USDA CSVs (with filter rules applied at INSERT)')
  const tUsdaStart = Date.now()
  const { rows: usdaRows, version: usdaVersion } = await loadUsda(USDA_ROOT)
  console.log(`  Built ${fmt(usdaRows.length)} filtered USDA rows in ${fmtMs(Date.now() - tUsdaStart)}\n`)

  console.log('Step 4/9 — Push USDA to D1')
  const tUsdaPush = Date.now()
  await bulkInsertRows(usdaRows, 'usda')
  console.log(`  ✓ USDA pushed in ${fmtMs(Date.now() - tUsdaPush)}`)

  banner('OpenNutrition load')
  console.log('Step 5/9 — Load ON dataset (with filter rules applied at INSERT)')
  const tOnStart = Date.now()
  const { rows: onRows, version: onVersion } = await loadOn(ON_ROOT)
  console.log(`  Built ${fmt(onRows.length)} filtered ON rows in ${fmtMs(Date.now() - tOnStart)}\n`)

  console.log('Step 6/9 — Push ON to D1')
  const tOnPush = Date.now()
  await bulkInsertRows(onRows, 'on')
  console.log(`  ✓ ON pushed in ${fmtMs(Date.now() - tOnPush)}`)

  banner('MYRX restore')
  console.log('Step 7/9 — Re-insert 6 myrx admin rows from backup')
  const myrx = insertMyrx()
  await bulkInsertRows(myrx, 'myrx')
  console.log(`  ✓ ${myrx.length} myrx rows restored`)

  banner('Post-import dedup')
  console.log('Step 8/9 — Apply Rules 2 + 3 (dedup passes)')
  // Use the dedup module directly
  const { default: depmod } = await import('child_process')
  depmod.execSync(`node "${path.resolve(__dirname, 'post_import_dedup.mjs')}"`, { stdio: 'inherit' })

  banner('Finalisation')
  console.log('Step 9/9 — Rebuild FTS5 index')
  await executeSql(`INSERT INTO food_fts(food_fts) VALUES ('rebuild');`)
  console.log('  ✓ done')

  console.log('\n── Final state ───────────────────')
  const final = await statsBySourceSubtype()
  let total = 0
  for (const r of final) {
    total += r.n
    console.log(`  ${r.source}${r.source_subtype ? ` / ${r.source_subtype}` : ''}: ${fmt(r.n)}`)
  }
  console.log(`  ─────────────`)
  console.log(`  TOTAL: ${fmt(total)}`)

  banner('Complete')
  console.log(`Total runtime: ${fmtMs(Date.now() - t0)}`)
  console.log(`USDA version:  ${usdaVersion}`)
  console.log(`ON version:    ${onVersion}`)
}

main().catch(err => {
  console.error('\n❌ Clean rebuild failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
