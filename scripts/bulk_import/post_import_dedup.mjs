#!/usr/bin/env node
/**
 * Post-import dedup — applies Rules 15-19 from docs/food_library_filters.md.
 *
 * Cross-row comparison rules that can't run at INSERT time. Designed to
 * scale to a multi-million-row food_library by chunking EVERY DELETE
 * via a LIMIT 50000 inner SELECT — no monolithic queries.
 *
 * Strategy summary:
 *   - All UPC-based rules (17, 18, 19) leverage the (source, upc)
 *     composite index that Rule 17 creates up front. With that index,
 *     self-joins via EXISTS / JOIN ... WHERE id < id finish in ~2s per
 *     50k-row chunk.
 *   - Rules 15 + 16 (exact-match dedups without UPC) build a small
 *     "delete list" staging table FIRST (scoped to rows that pass the
 *     rule's pre-conditions — name, brand, macros all non-NULL — which
 *     reduces the GROUP BY to a much smaller subset of the table),
 *     then loop-DELETE rows whose ids appear in that staging.
 *
 * Why this version exists:
 *   v1 used monolithic DELETE WHERE id NOT IN (SELECT MAX(id) GROUP BY ...)
 *   patterns. At ~470K rows that worked; at 2M+ rows the GROUP BY scan
 *   exceeded D1's 30-second per-query budget and every wrangler call
 *   failed after 3 retries.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rowCount() {
  const r = await querySql('SELECT COUNT(*) AS n FROM food_library;')
  return r[0]?.n ?? 0
}

/**
 * Run a chunked DELETE in a loop until it stops removing rows.
 * Returns the chunk count.
 */
async function chunkedLoop(label, chunkSql, maxChunks = 200) {
  let prev = await rowCount()
  let chunks = 0
  while (chunks < maxChunks) {
    await executeSql(chunkSql)
    const next = await rowCount()
    chunks++
    if (next === prev) return chunks
    prev = next
  }
  console.warn(`  ⚠ ${label} hit ${maxChunks}-chunk safety cap; bailing`)
  return chunks
}

/**
 * Two-phase dedup for rules whose dedup key isn't covered by an index.
 *
 *   1. Build a `_dedup_targets` table containing the IDs we want to
 *      DELETE. The query is scoped to the rule's pre-condition (e.g.,
 *      "rows where name AND brand AND macros are all non-NULL") so the
 *      GROUP BY operates on a fraction of food_library, not the whole
 *      thing. The staging-table CREATE finishes well within D1's 30s
 *      budget even on multi-million-row tables when scoped tightly.
 *   2. Chunked DELETE FROM food_library WHERE id IN (SELECT id FROM
 *      _dedup_targets LIMIT 50000) — looped until 0 rows removed.
 *   3. DROP _dedup_targets.
 */
async function runStagingDedup(label, deleteTargetsSql) {
  const tName = `_dedup_t_${Date.now()}`
  await executeSql(`CREATE TABLE ${tName} AS ${deleteTargetsSql};`)
  await executeSql(`CREATE INDEX ${tName}_idx ON ${tName}(target_id);`)

  const beforeCount = await rowCount()
  const chunkSql = `
    DELETE FROM food_library
    WHERE id IN (
      SELECT target_id FROM ${tName} LIMIT 50000
    );
    DELETE FROM ${tName} WHERE target_id IN (
      SELECT id FROM food_library
      UNION ALL
      SELECT target_id FROM ${tName} LIMIT 50000
    );
  `.trim()

  // Simpler chunked loop: just keep deleting from food_library where id
  // is in our staging table. The staging table doesn't need to shrink —
  // we just stop when food_library stops shrinking.
  const simpleChunkSql = `
    DELETE FROM food_library
    WHERE id IN (SELECT target_id FROM ${tName} LIMIT 50000);
  `.trim()
  const chunks = await chunkedLoop(label, simpleChunkSql)
  const afterCount = await rowCount()

  await executeSql(`DROP TABLE ${tName};`)
  return { removed: beforeCount - afterCount, chunks }
}

// ── Rule 15 — exact cross-source dedup ────────────────────────────────────────
// Match key: name + brand + 4 macros + serving_label + upc.
// Scope it to rows with at least name AND kcal set — pure-NULL rows are
// already handled by Rules 6 + 8. This cuts the GROUP BY input dramatically.

const RULE_15_DELETE_TARGETS_SQL = `
SELECT id AS target_id FROM food_library
WHERE name IS NOT NULL AND kcal IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id) FROM food_library
    WHERE name IS NOT NULL AND kcal IS NOT NULL
    GROUP BY LOWER(TRIM(name)), COALESCE(LOWER(TRIM(brand)),''),
             kcal, COALESCE(protein_g,-1.0), COALESCE(fat_g,-1.0),
             COALESCE(carbs_g,-1.0), COALESCE(LOWER(TRIM(serving_label)),''),
             COALESCE(upc,'')
  )
`.trim()

// ── Rule 16 — brand-product dedup (no UPC needed) ────────────────────────────
// Scope: rows where brand+name+all-4-macros are non-NULL.
// Winner: source_id DESC (newest reading per product).

const RULE_16_DELETE_TARGETS_SQL = `
SELECT id AS target_id FROM food_library
WHERE brand IS NOT NULL AND name IS NOT NULL
  AND kcal IS NOT NULL AND protein_g IS NOT NULL
  AND fat_g IS NOT NULL AND carbs_g IS NOT NULL
  AND id NOT IN (
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
    ) ranked WHERE rn = 1
  )
`.trim()

// ── Rule 17 — cross-source UPC dedup (chunked, prefer ON over USDA) ──────────

const RULE_17_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_food_library_source_upc
  ON food_library(source, upc)
`.trim()

const RULE_17_CHUNK_SQL = `
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

// ── Rule 18 — intra-source UPC dedup (chunked self-join via index) ───────────
// Uses the (source, upc) index from Rule 17. The self-join finds pairs
// where the same (source, upc, rounded_kcal) exists at two different
// ids, and DELETEs the smaller-id one (losers). Loops until empty.

const RULE_18_CHUNK_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT u1.id
  FROM food_library u1
  JOIN food_library u2
    ON u1.source = u2.source
   AND u1.upc = u2.upc
   AND ROUND(COALESCE(u1.kcal,-1),0) = ROUND(COALESCE(u2.kcal,-1),0)
   AND u2.id > u1.id
  WHERE u1.upc IS NOT NULL
  LIMIT 50000
)
`.trim()

// ── Rule 19a — cross-source UPC dedup with ≤5 kcal tolerance (chunked) ───────

const RULE_19A_CHUNK_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT u.id
  FROM food_library u
  JOIN food_library o ON o.upc = u.upc AND o.source = 'on'
  WHERE u.source = 'usda'
    AND u.upc IS NOT NULL
    AND u.kcal IS NOT NULL AND o.kcal IS NOT NULL
    AND ABS(o.kcal - u.kcal) <= 5
  LIMIT 50000
)
`.trim()

// ── Rule 19b — intra-source UPC dedup with ≤5 kcal spread (chunked) ──────────
// Self-join on (source, upc) where abs(kcal diff) ≤ 5 and id < id. Same
// pattern as Rule 18, just relaxed kcal match.

const RULE_19B_CHUNK_SQL = `
DELETE FROM food_library
WHERE id IN (
  SELECT u1.id
  FROM food_library u1
  JOIN food_library u2
    ON u1.source = u2.source
   AND u1.upc = u2.upc
   AND u1.kcal IS NOT NULL AND u2.kcal IS NOT NULL
   AND ABS(u2.kcal - u1.kcal) <= 5
   AND u2.id > u1.id
  WHERE u1.upc IS NOT NULL
  LIMIT 50000
)
`.trim()

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════')
  console.log('  Post-import dedup (Rules 15-19)')
  console.log('═══════════════════════════════\n')

  const before = await rowCount()
  console.log(`  Starting row count: ${fmt(before)}`)

  // Index FIRST — required by Rules 17, 18, 19 self-joins for speed.
  console.log('\n  Creating (source, upc) index for UPC-based rules…')
  await executeSql(RULE_17_INDEX_SQL)
  console.log('  ✓ index ready')

  // Run UPC-based rules first — they catch the BIG categories (mostly
  // USDA brand_owner duplicates). After this the table will be much
  // smaller, making the staging-table rules 15+16 feasible.

  console.log('\nRule 18 — intra-source UPC dedup (kcal match within source)…')
  const t18 = Date.now()
  const c18 = await rowCount()
  const chunks18 = await chunkedLoop('Rule 18', RULE_18_CHUNK_SQL)
  const after18 = await rowCount()
  console.log(`  → ${fmt(c18 - after18)} rows removed in ${fmtMs(Date.now() - t18)} (${chunks18} chunks)`)

  console.log('\nRule 17 — cross-source UPC dedup (prefer ON, kcal match)…')
  const t17 = Date.now()
  const c17 = await rowCount()
  const chunks17 = await chunkedLoop('Rule 17', RULE_17_CHUNK_SQL)
  const after17 = await rowCount()
  console.log(`  → ${fmt(c17 - after17)} rows removed in ${fmtMs(Date.now() - t17)} (${chunks17} chunks)`)

  console.log('\nRule 19a — cross-source UPC dedup (≤5 kcal tolerance)…')
  const t19a = Date.now()
  const c19a = await rowCount()
  const chunks19a = await chunkedLoop('Rule 19a', RULE_19A_CHUNK_SQL)
  const after19a = await rowCount()
  console.log(`  → ${fmt(c19a - after19a)} rows removed in ${fmtMs(Date.now() - t19a)} (${chunks19a} chunks)`)

  console.log('\nRule 19b — intra-source UPC dedup (≤5 kcal spread)…')
  const t19b = Date.now()
  const c19b = await rowCount()
  const chunks19b = await chunkedLoop('Rule 19b', RULE_19B_CHUNK_SQL)
  const after19b = await rowCount()
  console.log(`  → ${fmt(c19b - after19b)} rows removed in ${fmtMs(Date.now() - t19b)} (${chunks19b} chunks)`)

  console.log('\nRule 15 — exact cross-source dedup (name+brand+macros+serving_label+upc)…')
  const t15 = Date.now()
  const r15 = await runStagingDedup('Rule 15', RULE_15_DELETE_TARGETS_SQL)
  console.log(`  → ${fmt(r15.removed)} rows removed in ${fmtMs(Date.now() - t15)} (${r15.chunks} chunks)`)

  console.log('\nRule 16 — brand-product dedup (name+brand+macros+serving_g)…')
  const t16 = Date.now()
  const r16 = await runStagingDedup('Rule 16', RULE_16_DELETE_TARGETS_SQL)
  console.log(`  → ${fmt(r16.removed)} rows removed in ${fmtMs(Date.now() - t16)} (${r16.chunks} chunks)`)

  const after = await rowCount()
  console.log('\n══════════════════════════════════')
  console.log(`  Final row count: ${fmt(after)} (removed ${fmt(before - after)} dups)`)
  console.log('══════════════════════════════════')
}

main().catch(err => {
  console.error('\n❌ Dedup failed:')
  console.error(err.stack || err.message || err)
  process.exit(1)
})
