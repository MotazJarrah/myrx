/**
 * D1 write helper for bulk import.
 *
 * Uses `npx wrangler d1 execute --file=...` to push SQL in batches — bypasses
 * the D1 HTTP API's per-request body limit and is the fastest path for large
 * inserts (no per-row round-trips).
 *
 * Each batch is written to a temporary .sql file, executed, and deleted.
 * Retries on transient wrangler failures with exponential backoff.
 */

import fs        from 'fs'
import os        from 'os'
import path      from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const WRANGLER_CONFIG = path.resolve(__dirname, '../../../workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'

const ROWS_PER_FILE  = 25_000   // rows per SQL batch file
const INSERT_BATCH   = 100      // rows per INSERT VALUES statement
const RETRY_ATTEMPTS = 4
const RETRY_DELAY_MS = 5_000

const TMP_DIR = path.join(os.tmpdir(), 'myrx_bulk_import')

// Column list — must match the order in `toValues()` below.
const COLS = [
  'source', 'source_id', 'source_subtype', 'name', 'brand',
  'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sodium_mg',
  'serving_g', 'serving_label', 'servings_per_container',
  'data_type', 'upc',
  'imported_at', 'last_synced_at', 'source_version', 'food_category',
].join(', ')

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number')         return isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function toValues(r) {
  return `(${[
    esc(r.source),
    esc(String(r.source_id)),
    esc(r.source_subtype),
    esc(r.name),
    esc(r.brand),
    esc(r.kcal),
    esc(r.protein_g),
    esc(r.fat_g),
    esc(r.carbs_g),
    esc(r.fiber_g),
    esc(r.sodium_mg),
    esc(r.serving_g),
    esc(r.serving_label),
    esc(r.servings_per_container),
    esc(r.data_type),
    esc(r.upc),
    esc(r.imported_at),
    esc(r.last_synced_at),
    esc(r.source_version),
    esc(r.food_category),
  ].join(',')})`
}

async function executeFile(filePath) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      execSync(
        `npx wrangler d1 execute ${DB_NAME} --remote --file="${filePath}" --config="${WRANGLER_CONFIG}" --json`,
        { stdio: 'pipe' }
      )
      return
    } catch (err) {
      const remaining = RETRY_ATTEMPTS - attempt
      if (remaining === 0) throw err
      process.stdout.write(` ⚠ retry ${attempt}/${RETRY_ATTEMPTS - 1}…`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Execute an arbitrary SQL string against D1. */
export async function executeSql(sql) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp = path.join(TMP_DIR, `_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sql`)
  fs.writeFileSync(fp, sql + '\n')
  try {
    await executeFile(fp)
  } finally {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }
}

/**
 * Execute a single SQL query and return its rows.
 *
 * Uses `wrangler d1 execute --command --json` rather than `--file --json` —
 * the latter returns only a summary, while `--command --json` returns the
 * actual rows for SELECT statements. Authentication uses wrangler's stored
 * Cloudflare credentials (no env-var dependency).
 *
 * @param {string} sql  — short single SQL statement (fits in CLI arg length)
 * @returns {Promise<Array<object>>}
 */
export async function querySql(sql) {
  // Flatten to single line + escape double-quotes so the SQL survives shell
  // argument parsing. Multi-line SQL via --command gets mangled.
  const flat    = sql.replace(/\s+/g, ' ').trim()
  const escaped = flat.replace(/"/g, '\\"')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --command="${escaped}" --config="${WRANGLER_CONFIG}" --json`

  const output = execSync(cmd, {
    encoding: 'utf8',
    stdio:    ['ignore', 'pipe', 'pipe'],
  })
  // wrangler --json sometimes prepends an upload-progress line before the
  // actual JSON when run with --file; with --command it's typically clean,
  // but be defensive: find the first '[' and parse from there.
  const start = output.indexOf('[')
  if (start === -1) return []
  const parsed = JSON.parse(output.slice(start).trim())
  return parsed?.[0]?.results ?? []
}

/**
 * Bulk-insert an array of row records to D1.
 * Splits into ROWS_PER_FILE-sized SQL files, each containing batched INSERT statements.
 * Returns the number of rows actually pushed.
 */
export async function bulkInsertRows(rows, label = 'rows') {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const totalFiles = Math.ceil(rows.length / ROWS_PER_FILE)
  let written = 0

  for (let f = 0; f < totalFiles; f++) {
    const start = f * ROWS_PER_FILE
    const end   = Math.min(start + ROWS_PER_FILE, rows.length)
    const slice = rows.slice(start, end)

    const fp = path.join(TMP_DIR, `bulk_${label}_${f}.sql`)
    const lines = []
    for (let i = 0; i < slice.length; i += INSERT_BATCH) {
      const chunk  = slice.slice(i, i + INSERT_BATCH)
      const values = chunk.map(toValues).join(',\n  ')
      lines.push(`INSERT OR IGNORE INTO food_library (${COLS}) VALUES\n  ${values};`)
    }
    fs.writeFileSync(fp, lines.join('\n') + '\n')

    process.stdout.write(`\r    File ${f + 1}/${totalFiles}: ${slice.length.toLocaleString()} rows… uploading…`)
    await executeFile(fp)
    fs.unlinkSync(fp)
    written += slice.length
    process.stdout.write(` ✓  (${written.toLocaleString()} / ${rows.length.toLocaleString()})`)
  }
  console.log('')
  return written
}

/** Get count of rows by (source, source_subtype). */
export async function statsBySourceSubtype() {
  return querySql(
    `SELECT source, source_subtype, COUNT(*) AS n
     FROM food_library
     GROUP BY source, source_subtype
     ORDER BY source, source_subtype;`
  )
}

/** Get top-level counts by source only. */
export async function statsBySource() {
  return querySql(
    `SELECT source, COUNT(*) AS n
     FROM food_library
     GROUP BY source
     ORDER BY source;`
  )
}

/** DELETE all USDA + ON rows. Preserves MYRX. */
export async function wipeUsdaAndOn() {
  await executeSql(`DELETE FROM food_library WHERE source IN ('usda', 'on');`)
}

/** Backfill audit columns on MYRX rows that lack them. */
export async function backfillMyrxAuditColumns() {
  await executeSql(`
    UPDATE food_library
    SET source_subtype = COALESCE(source_subtype, 'admin_custom'),
        imported_at    = COALESCE(imported_at,    datetime('now')),
        last_synced_at = COALESCE(last_synced_at, datetime('now'))
    WHERE source = 'myrx';
  `)
}

/** Rebuild the FTS5 virtual table from scratch. */
export async function rebuildFts() {
  await executeSql(`INSERT INTO food_fts(food_fts) VALUES ('rebuild');`)
}
