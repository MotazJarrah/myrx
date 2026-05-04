/**
 * OpenNutrition → D1 diff-based sync
 *
 * Checks whether a new ON dataset version is available by comparing the
 * current SHA-256 checksum against the stored one. If different (or forced),
 * downloads the ZIP, extracts the TSV, diffs against the DB, and applies
 * inserts / updates / deletes. USDA entries always win over ON on the same UPC.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *   D1_DATABASE_ID
 *
 * Usage:
 *   node scripts/d1_migrate/sync_on.mjs
 */

import fs       from 'fs'
import os       from 'os'
import path     from 'path'
import https    from 'https'
import readline from 'readline'
import unzipper from 'unzipper'

import { createD1Client }                     from './lib/d1.mjs'
import { withRetry }                          from './lib/retry.mjs'
import { getState, setState, updateProgress,
         setFinalStatus }                     from './lib/sync-state.mjs'
import { normalizeUpc, parseNameByBrand,
         shouldSkip, foodsEqual }             from './lib/normalize.mjs'

// ── Env ───────────────────────────────────────────────────────────────────────

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID } = process.env
for (const [k, v] of Object.entries({ CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID })) {
  if (!v) { console.error(`❌ Missing env var: ${k}`); process.exit(1) }
}

// ── Config ────────────────────────────────────────────────────────────────────

const ON_DOWNLOAD_PAGE = 'https://www.opennutrition.app/download'
const ON_BASE_URL      = 'https://downloads.opennutrition.app'
const TMP_DIR          = path.join(os.tmpdir(), 'myrx_on_sync')
const BATCH_SIZE       = 100

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect the current ON version by scraping the download page */
async function detectOnVersion() {
  const res = await withRetry(() => fetch(ON_DOWNLOAD_PAGE), { label: 'ON version detect', retries: 3 })
  const html = await res.text()
  const match = html.match(/opennutrition-dataset-(\d{4}\.\d+)\.zip/)
  if (!match) throw new Error('Could not detect ON dataset version from download page')
  return match[1]  // e.g. "2025.1"
}

/** Fetch the SHA-256 checksum for a given ON version */
async function fetchChecksum(version) {
  const url = `${ON_BASE_URL}/opennutrition-dataset-${version}.zip.sha256`
  const res = await withRetry(() => fetch(url), { label: 'ON checksum', retries: 3 })
  if (!res.ok) throw new Error(`Checksum fetch failed: ${res.status}`)
  const text = await res.text()
  return text.trim().split(/\s+/)[0]  // first token is the hash
}

/** Download a URL to a local file, returning the file path */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode} ${url}`)); return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
    }).on('error', reject)
  })
}

/** Parse a JSON field safely, returning a fallback on error */
function safeJson(str, fallback = null) {
  try { return JSON.parse(str) } catch { return fallback }
}

/** Extract kcal from ON nutrition_100g JSON string */
function extractKcal(nutrition100gStr) {
  const n = safeJson(nutrition100gStr, {})
  const val = n?.calories ?? n?.energy_kcal ?? null
  if (val == null || !isFinite(val)) return null
  return Math.round(val * 100) / 100
}

/** Extract all macros from ON nutrition_100g JSON string */
function extractOnMacros(nutrition100gStr) {
  const n = safeJson(nutrition100gStr, {})
  const num = v => (v != null && isFinite(v)) ? Math.round(v * 100) / 100 : null
  return {
    kcal:       num(n?.calories ?? n?.energy_kcal),
    protein_g:  num(n?.protein),
    fat_g:      num(n?.total_fat),
    carbs_g:    num(n?.carbohydrates),
    fiber_g:    num(n?.dietary_fiber),
    sodium_mg:  num(n?.sodium != null ? n.sodium * 1000 : null),  // ON sodium is in g
  }
}

/** Extract serving info from ON serving JSON string */
function extractOnServing(servingStr) {
  const s = safeJson(servingStr, {})
  if (!s) return { serving_g: null, serving_label: null }
  const g = s.serving_size_g ?? s.weight_g ?? null
  return {
    serving_g:     g != null && isFinite(g) ? Math.round(g * 10) / 10 : null,
    serving_label: s.description?.trim() || null,
  }
}

/** Stream and parse the ON TSV from a ZIP, calling onRow for each data row */
function streamOnTsv(zipPath, onRow) {
  return new Promise((resolve, reject) => {
    let count = 0
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        if (entry.path !== 'opennutrition_foods.tsv') { entry.autodrain(); return }
        let headers = null
        const rl = readline.createInterface({ input: entry, crlfDelay: Infinity })
        rl.on('line', line => {
          if (!line.trim()) return
          const cols = line.split('\t')
          if (!headers) { headers = cols; return }
          const obj = {}
          headers.forEach((h, i) => { obj[h] = cols[i] ?? '' })
          onRow(obj)
          count++
          if (count % 50_000 === 0) process.stdout.write(`\r  ${count.toLocaleString()} rows parsed…`)
        })
        rl.on('close', () => resolve(count))
        rl.on('error', reject)
      })
      .on('error', reject)
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' OpenNutrition Diff Sync → D1')
  console.log('══════════════════════════════════════════\n')

  const db = createD1Client({
    accountId:  CLOUDFLARE_ACCOUNT_ID,
    databaseId: D1_DATABASE_ID,
    apiToken:   CLOUDFLARE_API_TOKEN,
  })

  // ── Version + checksum check ────────────────────────────────────────────────
  console.log('Step 1/5  Detecting current ON version…')
  const version      = await detectOnVersion()
  const newChecksum  = await fetchChecksum(version)
  const lastChecksum = await getState(db, 'on_last_checksum')
  const lastVersion  = await getState(db, 'on_last_version')

  console.log(`  Current: ${version} (${newChecksum.slice(0, 12)}…)`)
  console.log(`  Stored:  ${lastVersion || 'none'} (${lastChecksum.slice(0, 12) || 'none'}…)`)

  if (newChecksum === lastChecksum && version === lastVersion) {
    console.log('\n✅ ON dataset unchanged — nothing to sync.')
    await updateProgress(db, { on_status: 'up_to_date', on_version: version })
    return
  }

  // ── Download ────────────────────────────────────────────────────────────────
  console.log('\nStep 2/5  Downloading ON dataset…')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const zipUrl  = `${ON_BASE_URL}/opennutrition-dataset-${version}.zip`
  const zipPath = path.join(TMP_DIR, `opennutrition-dataset-${version}.zip`)
  await withRetry(() => downloadFile(zipUrl, zipPath), { label: 'ON download', retries: 3 })
  console.log(`  ✓ Downloaded to ${zipPath}`)

  // ── Load existing ON rows + USDA UPCs from D1 ───────────────────────────────
  console.log('\nStep 3/5  Loading existing DB state…')
  const { results: existingRows } = await db.query(
    `SELECT source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
            fiber_g, sodium_mg, serving_g, serving_label, upc
     FROM food_library WHERE source='on'`
  )
  const existingOn = new Map(existingRows.map(r => [r.source_id, r]))

  const { results: usdaUpcRows } = await db.query(
    `SELECT upc FROM food_library WHERE source='usda' AND upc IS NOT NULL`
  )
  const usdaUpcs = new Set(usdaUpcRows.map(r => r.upc))

  const { results: myrxUpcRows } = await db.query(
    `SELECT upc, source_id FROM food_library WHERE source='myrx' AND upc IS NOT NULL`
  )
  const myrxByUpc = new Map(myrxUpcRows.map(r => [r.upc, r.source_id]))

  console.log(`  ${existingOn.size.toLocaleString()} existing ON rows loaded`)
  console.log(`  ${usdaUpcs.size.toLocaleString()} USDA UPCs loaded`)
  console.log(`  ${myrxByUpc.size.toLocaleString()} MYRX UPCs loaded`)

  // ── Parse TSV and build diff ─────────────────────────────────────────────────
  console.log('\nStep 4/5  Parsing TSV and computing diff…')
  await updateProgress(db, { phase: 'on_diff', on_version: version })

  const seenIds       = new Set()
  const toInsert      = []
  const toUpdate      = []
  const myrxSuperseded = []  // source_ids of MYRX items superseded by ON

  await streamOnTsv(zipPath, row => {
    const upc = normalizeUpc(row.ean_13)
    if (!upc) return                     // no barcode
    if (usdaUpcs.has(upc)) return        // USDA wins

    // MYRX item with same UPC → will be deleted after inserts
    if (myrxByUpc.has(upc)) {
      myrxSuperseded.push({ upc, source_id: myrxByUpc.get(upc) })
    }

    const macros  = extractOnMacros(row.nutrition_100g)
    if (macros.kcal === 0) return        // zero-cal excluded

    const serving = extractOnServing(row.serving)
    const parsed  = parseNameByBrand(row.name ?? '')

    const candidate = {
      source_id:     row.id,
      name:          parsed.name  || row.name?.trim() || null,
      brand:         parsed.brand || null,
      upc,
      ...macros,
      ...serving,
    }

    if (shouldSkip({ upc: candidate.upc, kcal: candidate.kcal })) return

    seenIds.add(row.id)
    const existing = existingOn.get(row.id)

    if (!existing) {
      toInsert.push(candidate)
    } else if (!foodsEqual(existing, candidate)) {
      toUpdate.push(candidate)
    }
  })

  // Rows in DB but not in new TSV → delete
  const toDelete = [...existingOn.keys()].filter(id => !seenIds.has(id))

  const myrxSupersededUniq = [...new Map(myrxSuperseded.map(r => [r.source_id, r])).values()]
  console.log(`\n  → ${toInsert.length.toLocaleString()} to insert, ${toUpdate.length.toLocaleString()} to update, ${toDelete.length.toLocaleString()} to delete, ${myrxSupersededUniq.length} MYRX superseded`)

  // ── Apply changes ───────────────────────────────────────────────────────────
  console.log('\nStep 5/5  Applying changes to D1…')

  // Inserts
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)
    await db.batch(batch.map(r => ({
      sql: `INSERT OR IGNORE INTO food_library
              (source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
               fiber_g, sodium_mg, serving_g, serving_label, upc)
            VALUES ('on',?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [r.source_id, r.name, r.brand, r.kcal, r.protein_g, r.fat_g,
               r.carbs_g, r.fiber_g, r.sodium_mg, r.serving_g, r.serving_label, r.upc],
    })))
    process.stdout.write(`\r  Inserted ${Math.min(i + BATCH_SIZE, toInsert.length).toLocaleString()} / ${toInsert.length.toLocaleString()}`)
  }

  // Updates
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE)
    await db.batch(batch.map(r => ({
      sql: `UPDATE food_library SET
              name=?, brand=?, kcal=?, protein_g=?, fat_g=?, carbs_g=?,
              fiber_g=?, sodium_mg=?, serving_g=?, serving_label=?, upc=?
            WHERE source='on' AND source_id=?`,
      params: [r.name, r.brand, r.kcal, r.protein_g, r.fat_g, r.carbs_g,
               r.fiber_g, r.sodium_mg, r.serving_g, r.serving_label, r.upc, r.source_id],
    })))
    process.stdout.write(`\r  Updated ${Math.min(i + BATCH_SIZE, toUpdate.length).toLocaleString()} / ${toUpdate.length.toLocaleString()}`)
  }

  // Deletes (ON rows no longer in TSV)
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE)
    await db.batch(batch.map(id => ({
      sql:    `DELETE FROM food_library WHERE source='on' AND source_id=?`,
      params: [id],
    })))
  }

  // Delete MYRX items superseded by ON
  if (myrxSupersededUniq.length > 0) {
    console.log(`\n  Removing ${myrxSupersededUniq.length} MYRX item(s) superseded by ON…`)
    for (const { upc, source_id } of myrxSupersededUniq) {
      console.log(`    ↳ MYRX source_id=${source_id} UPC=${upc}`)
    }
    for (let i = 0; i < myrxSupersededUniq.length; i += BATCH_SIZE) {
      const batch = myrxSupersededUniq.slice(i, i + BATCH_SIZE)
      await db.batch(batch.map(r => ({
        sql:    `DELETE FROM food_library WHERE source='myrx' AND source_id=?`,
        params: [r.source_id],
      })))
    }
  }

  console.log('\n  ✓ Changes applied')

  // ── Rebuild FTS ─────────────────────────────────────────────────────────────
  console.log('\n  Rebuilding FTS5 index…')
  await db.query(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`)
  console.log('  ✓ FTS rebuilt')

  // ── Save state ──────────────────────────────────────────────────────────────
  await setState(db, 'on_last_checksum', newChecksum)
  await setState(db, 'on_last_version',  version)
  await updateProgress(db, {
    phase:      'on_done',
    on_version: version,
    on_inserted: toInsert.length,
    on_updated:  toUpdate.length,
    on_deleted:  toDelete.length,
  })

  // Cleanup temp file
  try { fs.unlinkSync(zipPath) } catch {}

  console.log(`\n✅ ON sync complete. Version ${version} saved.`)
  console.log(`   +${toInsert.length} / ~${toUpdate.length} / -${toDelete.length}`)
}

run().catch(async err => {
  console.error('\n❌ ON sync failed:', err.message)
  try {
    const db = createD1Client({
      accountId:  CLOUDFLARE_ACCOUNT_ID,
      databaseId: D1_DATABASE_ID,
      apiToken:   CLOUDFLARE_API_TOKEN,
    })
    await setFinalStatus(db, 'failed', `ON: ${err.message}`)
  } catch {}
  process.exit(1)
})
