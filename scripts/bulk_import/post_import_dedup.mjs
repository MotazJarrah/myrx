#!/usr/bin/env node
/**
 * Post-import dedup — applies Rules 2 + 3 from docs/food_library_filters.md.
 *
 * These rules can't run during the bulk import because they need cross-row
 * comparison. They run AFTER the import, against the already-filtered table.
 * Because Rules 1, 4, 5, 6, 7 dropped most junk during INSERT, this dedup
 * pass operates on a smaller table and runs cleanly without OOMs.
 *
 * Rule 2 — exact cross-source dedup
 *   Match key: LOWER(TRIM(name)), LOWER(TRIM(brand)), kcal, protein_g,
 *              fat_g, carbs_g, LOWER(TRIM(serving_label)), upc
 *              (NULL=NULL via COALESCE).
 *   Winner: MAX(id).
 *
 * Rule 3 — brand-product dedup
 *   Match key: LOWER(TRIM(name)), LOWER(TRIM(brand)), kcal, protein_g,
 *              fat_g, carbs_g, serving_g (NULL=NULL via COALESCE).
 *   Required (non-NULL): name, brand, kcal, protein_g, fat_g, carbs_g.
 *   Winner: CAST(source_id AS INTEGER) DESC, then source_id DESC.
 *
 * Usage:
 *   node scripts/bulk_import/post_import_dedup.mjs
 */

import path from 'path'
import { fileURLToPath } from 'url'
import {
  executeSql,
  querySql,
} from './lib/d1_writer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fmt   = n => n.toLocaleString()
const fmtMs = ms => `${(ms / 1000).toFixed(1)}s`

// ── Rule 2 ───────────────────────────────────────────────────────────────────

const RULE_2_SQL = `
DELETE FROM food_library
WHERE id NOT IN (
  SELECT MAX(id) FROM food_library
  GROUP BY COALESCE(LOWER(TRIM(name)),''), COALESCE(LOWER(TRIM(brand)),''),
           COALESCE(kcal,-1.0), COALESCE(protein_g,-1.0), COALESCE(fat_g,-1.0),
           COALESCE(carbs_g,-1.0), COALESCE(LOWER(TRIM(serving_label)),''),
           COALESCE(upc,'')
)
`.trim()

// ── Rule 3 ───────────────────────────────────────────────────────────────────

const RULE_3_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(brand)),
                   kcal, protein_g, fat_g, carbs_g,
                   COALESCE(serving_g, -1.0)
      ORDER BY CAST(source_id AS INTEGER) DESC, source_id DESC
    ) AS rn
    FROM food_library
    WHERE brand IS NOT NULL AND name IS NOT NULL
      AND kcal IS NOT NULL AND protein_g IS NOT NULL
      AND fat_g IS NOT NULL AND carbs_g IS NOT NULL
  ) ranked WHERE rn > 1
)
`.trim()

async function rowCount() {
  const r = await querySql('SELECT COUNT(*) AS n FROM food_library;')
  return r[0]?.n ?? 0
}

async function main() {
  console.log('═══════════════════════════════')
  console.log('  Post-import dedup (Rules 2+3)')
  console.log('═══════════════════════════════\n')

  const before = await rowCount()
  console.log(`  Starting row count: ${fmt(before)}`)

  console.log('\nRule 2 — exact cross-source dedup (name+brand+macros+serving_label+upc)…')
  const t2 = Date.now()
  await executeSql(RULE_2_SQL)
  const after2 = await rowCount()
  console.log(`  → ${fmt(before - after2)} rows removed in ${fmtMs(Date.now() - t2)}`)

  console.log('\nRule 3 — brand-product dedup (name+brand+macros+serving_g)…')
  const t3 = Date.now()
  await executeSql(RULE_3_SQL)
  const after3 = await rowCount()
  console.log(`  → ${fmt(after2 - after3)} rows removed in ${fmtMs(Date.now() - t3)}`)

  console.log('\n══════════════════════════════════')
  console.log(`  Final row count: ${fmt(after3)} (removed ${fmt(before - after3)} dups)`)
  console.log('══════════════════════════════════')
}

main().catch(err => {
  console.error('\n❌ Dedup failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
