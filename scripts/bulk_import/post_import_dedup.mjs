#!/usr/bin/env node
/**
 * Post-import dedup — applies Rules 2, 3, 14, 16 from
 * docs/food_library_filters.md.
 *
 * These rules can't run during the bulk import because they need cross-row
 * comparison. They run AFTER the import, against the already-filtered table.
 * Because Rules 1, 4, 5, 6, 7, 12, 13 dropped most junk during INSERT, this
 * dedup pass operates on a smaller table and runs cleanly without OOMs.
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
 * Rule 14 — cross-source UPC dedup
 *   Match key: upc AND ROUND(kcal,0) match across USDA + ON.
 *   Winner:    ON over USDA (ON has cleaner names like "Sea Salt Potato
 *              Chips" vs USDA's "POTATO CHIPS, SEA SALT").
 *   Method:    DELETE USDA rows when an ON row with the same UPC + kcal
 *              exists. Requires composite index on (source, upc); created
 *              here if missing.
 *
 * Rule 16 — intra-source UPC dedup
 *   Match key: upc AND ROUND(kcal,0) match within a single source.
 *   Catches:   The same UPC listed under multiple brand_owner records in
 *              USDA (real brand + co-packer + distributor), all with
 *              identical macros. Worst observed cluster had 18 rows per UPC.
 *   Winner:    MAX(id) per (source, upc, rounded_kcal) group.
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

// ── Rule 14 — cross-source UPC dedup (prefer ON over USDA) ─────────────────

const RULE_14_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_food_library_source_upc
  ON food_library(source, upc)
`.trim()

// Chunked to stay under D1's per-query CPU budget. Caller loops until 0
// changes. LIMIT 50000 was the largest size we observed running cleanly
// against a 1M-row table on 2026-05-14 (~2s per chunk).
const RULE_14_CHUNK_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT u.id
  FROM food_library u
  JOIN food_library o ON o.upc = u.upc AND o.source = 'on'
  WHERE u.source = 'usda'
    AND u.upc IS NOT NULL
    AND ROUND(COALESCE(o.kcal,-1),0) = ROUND(COALESCE(u.kcal,-1),0)
  LIMIT 50000
)
`.trim()

// ── Rule 16 — intra-source UPC dedup (keep highest id per kcal match) ──────

const RULE_16_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY source, upc, ROUND(COALESCE(kcal,-1), 0)
      ORDER BY id DESC
    ) AS rn
    FROM food_library
    WHERE upc IS NOT NULL
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

  console.log('\nRule 14 — cross-source UPC dedup (prefer ON, kcal match)…')
  const t14 = Date.now()
  await executeSql(RULE_14_INDEX_SQL)
  // Loop until the chunked DELETE drains.
  let after14 = after3
  let chunkRun = 0
  while (true) {
    const beforeChunk = await rowCount()
    await executeSql(RULE_14_CHUNK_SQL)
    const afterChunk = await rowCount()
    chunkRun++
    if (beforeChunk === afterChunk) break
    if (chunkRun > 100) {
      console.warn('  ⚠ chunked DELETE ran 100 times — bailing to avoid infinite loop')
      break
    }
    after14 = afterChunk
  }
  console.log(`  → ${fmt(after3 - after14)} rows removed in ${fmtMs(Date.now() - t14)} (${chunkRun} chunks)`)

  console.log('\nRule 16 — intra-source UPC dedup (kcal match within source)…')
  const t16 = Date.now()
  await executeSql(RULE_16_SQL)
  const after16 = await rowCount()
  console.log(`  → ${fmt(after14 - after16)} rows removed in ${fmtMs(Date.now() - t16)}`)

  console.log('\n══════════════════════════════════')
  console.log(`  Final row count: ${fmt(after16)} (removed ${fmt(before - after16)} dups)`)
  console.log('══════════════════════════════════')
}

main().catch(err => {
  console.error('\n❌ Dedup failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
