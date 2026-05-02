/**
 * Supabase food_library → Cloudflare D1 migration
 *
 * Uses KEYSET pagination (WHERE id > lastId) — no OFFSET, no timeouts.
 * Resumes from progress.json if interrupted.
 *
 * Usage:
 *   node migrate.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'
import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_KEY = 'sb_publishable_roSzL0VOILmeVZLN-mdLSQ_G5-zOpu8'

const WRANGLER_CONFIG = path.resolve(import.meta.dirname, '../../workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const PAGE_SIZE       = 1000    // rows per Supabase fetch (Supabase free-tier cap)
const ROWS_PER_FILE   = 50_000  // rows per SQL file sent to D1
const INSERT_BATCH    = 200     // rows per INSERT VALUES (...),(...),...

const PROGRESS_FILE = path.join(import.meta.dirname, 'progress.json')
const TMP_DIR       = path.join(os.tmpdir(), 'd1_migrate')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Progress ──────────────────────────────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) }
  catch { return { lastId: null, inserted: 0 } }
}
function saveProgress(lastId, inserted) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastId, inserted }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number')         return isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

const COLS = 'source,source_id,name,brand,kcal,protein_g,fat_g,carbs_g,fiber_g,sodium_mg,serving_g,serving_label'

function toValues(r) {
  return `(${[
    esc(r.source ?? 'usda'),
    esc(String(r.source_id)),
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
  ].join(',')})`
}

async function writeSqlFile(rows, fileIndex) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const fp  = path.join(TMP_DIR, `batch_${fileIndex}.sql`)
  const out = fs.createWriteStream(fp)
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk  = rows.slice(i, i + INSERT_BATCH)
    const values = chunk.map(toValues).join(',\n  ')
    out.write(`INSERT OR IGNORE INTO food_library (${COLS}) VALUES\n  ${values};\n`)
  }
  out.end()
  return new Promise((resolve, reject) => { out.on('finish', () => resolve(fp)); out.on('error', reject) })
}

function executeFile(fp) {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --file="${fp}" --config="${WRANGLER_CONFIG}"`,
    { stdio: 'pipe' }   // suppress wrangler chatter; errors still throw
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' food_library  →  Cloudflare D1')
  console.log('══════════════════════════════════════════\n')

  let { lastId, inserted } = loadProgress()
  // UUID table: use null-UUID as the "before everything" sentinel
  if (!lastId) lastId = '00000000-0000-0000-0000-000000000000'
  else console.log(`  Resuming from id > ${lastId} (${inserted.toLocaleString()} rows already done)\n`)

  let fileIndex  = Math.floor(inserted / ROWS_PER_FILE)
  let fileBuffer = []
  let done       = false

  while (!done) {
    // Keyset pagination: WHERE id > lastId ORDER BY id LIMIT PAGE_SIZE
    const { data, error } = await supabase
      .from('food_library')
      .select('id,source,source_id,name,brand,kcal,protein_g,fat_g,carbs_g,fiber_g,sodium_mg,serving_g,serving_label')
      .gt('id', lastId)
      .order('id')
      .limit(PAGE_SIZE)

    if (error) {
      saveProgress(lastId, inserted)
      console.error(`\n❌ Supabase error: ${error.message}`)
      process.exit(1)
    }

    if (!data?.length) { done = true; break }

    fileBuffer.push(...data)
    lastId   = data[data.length - 1].id
    inserted += data.length

    // Flush a full file to D1 once buffer reaches threshold
    while (fileBuffer.length >= ROWS_PER_FILE) {
      const batch = fileBuffer.splice(0, ROWS_PER_FILE)
      process.stdout.write(`\n  File ${fileIndex + 1}: writing ${batch.length.toLocaleString()} rows…`)
      const fp = await writeSqlFile(batch, fileIndex)
      process.stdout.write(` uploading to D1…`)
      try {
        executeFile(fp)
        fs.unlinkSync(fp)
        fileIndex++
        saveProgress(lastId, inserted)
        process.stdout.write(` ✓  (${inserted.toLocaleString()} / ~2M)`)
      } catch (err) {
        saveProgress(lastId, inserted)
        console.error(`\n❌ wrangler failed on file ${fileIndex}: ${err.message}`)
        process.exit(1)
      }
    }

    process.stdout.write(`\r  Fetching… ${inserted.toLocaleString()} rows (buffer: ${fileBuffer.length.toLocaleString()})`)
  }

  // Flush any remaining rows in buffer
  if (fileBuffer.length > 0) {
    process.stdout.write(`\n  File ${fileIndex + 1}: writing ${fileBuffer.length.toLocaleString()} rows (final)…`)
    const fp = await writeSqlFile(fileBuffer, fileIndex)
    process.stdout.write(` uploading to D1…`)
    try {
      executeFile(fp)
      fs.unlinkSync(fp)
      fileIndex++
      saveProgress(lastId, inserted)
      process.stdout.write(` ✓`)
    } catch (err) {
      saveProgress(lastId, inserted)
      console.error(`\n❌ wrangler failed on final file: ${err.message}`)
      process.exit(1)
    }
  }

  // Rebuild FTS5 index from all inserted rows
  console.log('\n\n  Rebuilding FTS5 search index…')
  const ftsSql = path.join(TMP_DIR, 'fts_rebuild.sql')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  fs.writeFileSync(ftsSql, `INSERT INTO food_fts(food_fts) VALUES ('rebuild');\n`)
  executeFile(ftsSql)
  fs.unlinkSync(ftsSql)
  console.log('  ✅ FTS5 index built')

  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE)
  console.log(`\n✅ Done! ${inserted.toLocaleString()} rows in D1. FTS search ready.`)
}

run().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1) })
