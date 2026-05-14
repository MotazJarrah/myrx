#!/usr/bin/env node
/**
 * Drop + recreate the food_library tables in D1.
 *
 * Used as the first step of the clean rebuild. Drops both the food_fts virtual
 * table (must go first because it depends on food_library) and food_library
 * itself, then creates them fresh with the post-audit schema:
 *   - source_subtype column kept (for filtering)
 *   - imported_at / last_synced_at / source_version kept (for sync)
 *   - food_category DROPPED — coarse USDA category, more detail in name
 *   - per_serving_kcal NOT created — use the formula at query time
 *
 * Why DROP TABLE works when DROP COLUMN didn't:
 *   DROP COLUMN forces SQLite to rewrite every row of the table without
 *   that column → ~526 MB rewrite → OOM. DROP TABLE just marks pages as
 *   free in the file, no row-by-row work → fits in memory budget.
 *
 * Usage:
 *   node scripts/bulk_import/drop_and_recreate.mjs
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WRANGLER_CONFIG = path.resolve(__dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME = 'myrx-food-library'
const TMP_DIR = path.join(os.tmpdir(), 'myrx_bulk_import')

const SQL_DROP_AND_CREATE = `
-- Drop FTS5 first (it references food_library)
DROP TABLE IF EXISTS food_fts;
DROP TABLE IF EXISTS food_library;

-- Recreate food_library with clean post-audit schema
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

-- Recreate FTS5 virtual table for search
CREATE VIRTUAL TABLE food_fts USING fts5(
  name,
  brand,
  content = food_library,
  content_rowid = id,
  tokenize = 'unicode61 remove_diacritics 1'
);
`.trim()

function executeFile(filePath) {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${filePath}" --config="${WRANGLER_CONFIG}"`,
    { stdio: 'inherit' }
  )
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  Drop + recreate food_library tables  ')
  console.log('═══════════════════════════════════════\n')

  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp = path.join(TMP_DIR, '_drop_and_create.sql')
  fs.writeFileSync(fp, SQL_DROP_AND_CREATE)

  try {
    console.log('Executing DROP + CREATE…')
    executeFile(fp)
    console.log('\n✓ Tables dropped and recreated.')
  } finally {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }
}

main().catch(err => {
  console.error('\n❌ drop_and_recreate failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
