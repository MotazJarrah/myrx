/**
 * MyRX Food Search Worker
 * Cloudflare D1 + FTS5 — food search + MYRX custom food CRUD
 *
 * Public (no auth):
 *   GET /search?q=&limit=&source=   → FTS5 search
 *   GET /food/:source_id            → single food lookup
 *   GET /barcode/:upc               → barcode lookup
 *
 * Protected (Bearer FOOD_ADMIN_KEY):
 *   POST   /food                    → create MYRX food
 *   PUT    /food/:source_id         → update MYRX food
 *   DELETE /food/:source_id         → delete MYRX food
 *   POST   /admin/sync              → trigger food library sync (GitHub Actions)
 *                                     body: { staged: bool } — staged=true writes
 *                                     to changelog only; staged=false auto-commits.
 *   GET    /admin/sync/status       → read sync status + active run_id from D1
 *   GET    /admin/sync/summary      → per-run summary (insert/update/delete counts)
 *                                     ?run_id=X (defaults to most recent)
 *   GET    /admin/sync/changes      → paginated changelog rows
 *                                     ?run_id=X&cursor=N&op=insert|update|delete
 *   GET    /admin/sync/changes/csv  → CSV download of all changelog rows
 *   POST   /admin/sync/commit       → apply pending changelog for a staged run
 *                                     body: { run_id } — iterates batches until done
 *   POST   /admin/sync/discard      → drop pending changelog (no food_library write)
 *                                     body: { run_id }
 *   POST   /admin/sync/undo         → reverse a committed run (last-sync only)
 *                                     body: { run_id }
 *   POST   /admin/sync/cancel       → flag a running sync to abort cleanly
 *   GET    /admin/sync/history      → last N runs from sync_history
 *
 * Internal (Bearer FOOD_ADMIN_KEY — called from GitHub Actions sync scripts):
 *   POST   /admin/sync/changelog/append   bulk-insert changelog rows from sync
 *   POST   /admin/sync/state              update sync_state (status/progress/run_id)
 *   GET    /admin/sync/cancel/check       read cancel flag (sync scripts poll this)
 */

import { handleTriggerSync, handleSyncStatus } from './sync-admin.js'
import { enrichFood, getFilterReason }         from './filters.mjs'
import {
  commitBatch, discardRun, undoBatch,
  listChanges, summarize,
} from './sync-changelog.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SELECT_COLS = `source, source_id, name, brand, kcal, protein_g, fat_g,
  carbs_g, fiber_g, sodium_mg, serving_g, serving_label`

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function requireAuth(request, env) {
  const header = request.headers.get('Authorization') ?? ''
  const expected = env.FOOD_ADMIN_KEY
  if (!expected) return json({ error: 'Server misconfigured' }, 500)
  if (!header.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const token = header.slice(7)
  if (token.length !== expected.length) return json({ error: 'Unauthorized' }, 401)
  let diff = 0
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return json({ error: 'Unauthorized' }, 401)
  return null // ok
}

// ── Validation ────────────────────────────────────────────────────────────────

const NUMERIC_FIELDS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sodium_mg', 'serving_g']

function validateFood(body, { partial = false } = {}) {
  if (!partial && !body.name?.trim()) return 'name is required'
  if (body.name !== undefined && typeof body.name !== 'string') return 'name must be a string'
  if (body.brand !== undefined && body.brand !== null && typeof body.brand !== 'string') return 'brand must be a string or null'
  if (body.upc !== undefined && body.upc !== null && typeof body.upc !== 'string') return 'upc must be a string or null'
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined && body[f] !== null) {
      const n = Number(body[f])
      if (isNaN(n)) return `${f} must be a number`
      if (n < 0)    return `${f} must be >= 0`
    }
  }
  return null
}

function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null
  return stripped.padStart(12, '0')
}

function coerce(body) {
  const out = {}
  if (body.name  !== undefined) out.name  = String(body.name).trim()
  if (body.brand !== undefined) out.brand = body.brand ? String(body.brand).trim() : null
  if (body.upc   !== undefined) out.upc   = body.upc   ? (normalizeUpc(body.upc) ?? null) : null
  if (body.serving_label !== undefined) out.serving_label = body.serving_label ? String(body.serving_label).trim() : null
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f] === null ? null : Math.round(Number(body[f]) * 100) / 100
  }
  return out
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Sanitize query into safe FTS5 MATCH expression with prefix matching */
function buildFtsQuery(raw) {
  const terms = raw
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .slice(0, 6)
  if (terms.length === 0) return null
  return terms.map(t => `"${t}"*`).join(' ')
}

// ── CRUD handlers ─────────────────────────────────────────────────────────────

async function handleCreate(request, env) {
  const authErr = requireAuth(request, env)
  if (authErr) return authErr

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const validErr = validateFood(body)
  if (validErr) return json({ error: validErr }, 400)

  const coerced   = coerce(body)
  const source_id = crypto.randomUUID()
  // Universal rule: branded if EITHER upc OR brand is present.
  // Generic only when both are missing (canonical ingredient / custom entry).
  // Matches the rule used by the USDA + ON sync scripts.
  const data_type = (coerced.upc || coerced.brand) ? 'branded' : 'generic'

  // ── 19-rule filter pipeline (same rules sync + bulk import use) ─────────
  // Server-side enforcement: even if a malicious client bypasses the
  // frontend warning, the worker WILL reject rows that fail any reject
  // rule. Returns 422 with the specific rule name so the frontend can
  // show the admin exactly why the save was blocked.
  //
  // source_subtype = 'admin_custom' — branded category for Rule 14
  // (negligible branded entries) to fire correctly.
  const candidate = enrichFood({
    ...coerced,
    source:         'myrx',
    source_subtype: 'admin_custom',
  })
  const reason = getFilterReason(candidate)
  if (reason) {
    return json({
      error:  'Failed filter pipeline',
      rule:   reason,
      detail: `Row rejected by ${reason}. Fix the offending field and try again.`,
    }, 422)
  }

  // Use the ENRICHED row in the INSERT so Tier 1 repairs (title-case name,
  // kcal backfill, etc.) are persisted.
  const data = candidate

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO food_library (source, source_id, name, brand, kcal, protein_g, fat_g,
        carbs_g, fiber_g, sodium_mg, serving_g, serving_label, upc, data_type, source_subtype)
      VALUES ('myrx', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin_custom')
    `).bind(source_id, data.name, data.brand ?? null, data.kcal ?? null,
        data.protein_g ?? null, data.fat_g ?? null, data.carbs_g ?? null,
        data.fiber_g ?? null, data.sodium_mg ?? null, data.serving_g ?? null,
        data.serving_label ?? null, data.upc ?? null, data_type),
    env.DB.prepare(`
      INSERT INTO food_fts(rowid, name, brand)
      SELECT id, name, brand FROM food_library WHERE source='myrx' AND source_id=?
    `).bind(source_id),
  ])

  const { results } = await env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM food_library WHERE source='myrx' AND source_id=?`
  ).bind(source_id).all()

  return json(results[0], 201)
}

async function handleUpdate(request, env, source_id) {
  const authErr = requireAuth(request, env)
  if (authErr) return authErr

  // Fetch existing row — include upc so the data_type re-derivation can fall
  // back to the existing value when only `brand` was provided in the update
  // payload (and vice versa).
  const existing = await env.DB.prepare(
    `SELECT id, name, brand, upc FROM food_library WHERE source='myrx' AND source_id=?`
  ).bind(source_id).first()
  if (!existing) return json({ error: 'Not found' }, 404)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const validErr = validateFood(body, { partial: true })
  if (validErr) return json({ error: validErr }, 400)

  const data = coerce(body)
  if (Object.keys(data).length === 0) return json({ error: 'No fields to update' }, 400)

  // If UPC or brand changed, re-derive data_type (universal rule).
  if (data.upc !== undefined || data.brand !== undefined) {
    const nextUpc   = data.upc   !== undefined ? data.upc   : existing.upc
    const nextBrand = data.brand !== undefined ? data.brand : existing.brand
    data.data_type  = (nextUpc || nextBrand) ? 'branded' : 'generic'
  }

  const setClauses = Object.keys(data).map(k => `${k}=?`).join(', ')
  const setValues  = Object.values(data)

  const newName  = data.name  ?? existing.name
  const newBrand = data.brand ?? existing.brand

  await env.DB.batch([
    env.DB.prepare(`UPDATE food_library SET ${setClauses} WHERE source='myrx' AND source_id=?`)
      .bind(...setValues, source_id),
    // Remove old FTS entry
    env.DB.prepare(`INSERT INTO food_fts(food_fts, rowid, name, brand) VALUES('delete', ?, ?, ?)`)
      .bind(existing.id, existing.name, existing.brand ?? ''),
    // Insert new FTS entry
    env.DB.prepare(`INSERT INTO food_fts(rowid, name, brand) VALUES(?, ?, ?)`)
      .bind(existing.id, newName, newBrand ?? ''),
  ])

  const { results } = await env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM food_library WHERE source='myrx' AND source_id=?`
  ).bind(source_id).all()

  return json(results[0])
}

async function handleDelete(request, env, source_id) {
  const authErr = requireAuth(request, env)
  if (authErr) return authErr

  const existing = await env.DB.prepare(
    `SELECT id, name, brand FROM food_library WHERE source_id=?`
  ).bind(source_id).first()
  if (!existing) return json({ error: 'Not found' }, 404)

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO food_fts(food_fts, rowid, name, brand) VALUES('delete', ?, ?, ?)`)
      .bind(existing.id, existing.name, existing.brand ?? ''),
    env.DB.prepare(`DELETE FROM food_library WHERE id=?`)
      .bind(existing.id),
  ])

  return new Response(null, { status: 204, headers: CORS })
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url      = new URL(request.url)
    const pathname = url.pathname
    const method   = request.method

    // ── GET /stats ────────────────────────────────────────────────────────────
    // Per-source counts + total. Shape:
    //   { usda: N, on: N, myrx: N,                  (back-compat — old admin UI reads these)
    //     total: N, by_source: { usda, on, myrx } } (new shape used by OperationsPanel)
    if (pathname === '/stats' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT source, COUNT(*) as count FROM food_library GROUP BY source`
      ).all()
      const bySource = {}
      let total = 0
      for (const r of results ?? []) {
        bySource[r.source] = r.count
        total += r.count
      }
      return json({ ...bySource, total, by_source: bySource })
    }

    // ── GET /list?source=&limit=&offset= ─────────────────────────────────────
    if (pathname === '/list' && method === 'GET') {
      const source = url.searchParams.get('source')?.trim() ?? ''
      const limit  = Math.min(parseInt(url.searchParams.get('limit')  ?? '50', 10), 200)
      const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0',  10), 0)
      const where  = source ? 'WHERE source = ?' : ''
      const args   = source ? [source, limit, offset] : [limit, offset]
      const { results } = await env.DB.prepare(
        `SELECT ${SELECT_COLS} FROM food_library ${where} ORDER BY name LIMIT ? OFFSET ?`
      ).bind(...args).all()
      return json(results ?? [])
    }

    // ── GET /barcode/:upc ─────────────────────────────────────────────────────
    const barcodeMatch = pathname.match(/^\/barcode\/([^/]+)$/)
    if (barcodeMatch && method === 'GET') {
      const upc = normalizeUpc(decodeURIComponent(barcodeMatch[1]))
      if (!upc) return json({ error: 'Invalid barcode' }, 400)
      const { results } = await env.DB.prepare(
        `SELECT ${SELECT_COLS} FROM food_library WHERE upc = ? ORDER BY CAST(source_id AS INTEGER) DESC LIMIT 1`
      ).bind(upc).all()
      if (!results?.length) return json({ error: 'Not found' }, 404)
      return json(results[0])
    }

    // ── POST /food ────────────────────────────────────────────────────────────
    if (pathname === '/food' && method === 'POST') {
      return handleCreate(request, env)
    }

    // ── PUT /food/:source_id  /  DELETE /food/:source_id ─────────────────────
    const foodMatch = pathname.match(/^\/food\/([^/]+)$/)
    if (foodMatch) {
      const source_id = decodeURIComponent(foodMatch[1])
      if (method === 'PUT')    return handleUpdate(request, env, source_id)
      if (method === 'DELETE') return handleDelete(request, env, source_id)

      // ── GET /food/:source_id ─────────────────────────────────────────────
      if (method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT ${SELECT_COLS} FROM food_library WHERE source_id=? LIMIT 1`
        ).bind(source_id).all()
        if (!results?.length) return json({ error: 'Not found' }, 404)
        return json(results[0])
      }

      return json({ error: 'Method not allowed' }, 405)
    }

    // ── GET /search?q=...&limit=...&source=... ────────────────────────────────
    if (pathname === '/search' && method === 'GET') {
      const raw    = url.searchParams.get('q')?.trim() ?? ''
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 50)
      const source = url.searchParams.get('source')?.trim() ?? ''

      if (raw.length < 2) return json([])

      const ftsQuery  = buildFtsQuery(raw)
      const srcClause = source ? 'AND f.source = ?' : ''
      const srcArgs   = source ? [source] : []

      // ── Ranking heuristics ────────────────────────────────────────────────
      //
      // The audit observed two systemic search-result problems:
      //   1. Generic ingredient queries (e.g. "lettuce") were dominated by
      //      branded products that repeated the word multiple times in the
      //      name. Pure foods like "Romaine Lettuce" got buried.
      //   2. Searches for a food (e.g. "grilled chicken breast") returned
      //      composite dishes containing that food (pasta-with-chicken,
      //      chicken-salads, wraps) ahead of the food itself.
      //
      // Four ranking signals address these, applied as ORDER BY tiers:
      //   0. MYRX always leads — any row with source='myrx' (admin-curated
      //      custom food) ranks above everything else. Coach overrides the
      //      database. Only fires if MYRX has a textual match for the query;
      //      otherwise the rest of the ranking takes over naturally.
      //   A. Composite-dish demotion — if the name contains a dish marker
      //      word (with, and, salad, pasta, wrap, sandwich, etc.) AND the
      //      query itself doesn't have that marker, push the row to the end.
      //      A user searching "pasta" still sees pasta dishes; a user
      //      searching "chicken" doesn't see "pasta with chicken" first.
      //   B. Canonical subtype priority — foundation_food (lab-tested
      //      reference) > sr_legacy_food (older reference) > survey_fndds_food
      //      (aggregated meal estimates) > everything else.
      //   C. Short-query generics-first — for 1-2 term queries (likely a
      //      generic ingredient search), prefer data_type='generic'. For 3+
      //      term queries, trust the BM25 textual match.
      //
      // Final tiebreak: FTS5 `rank` (BM25).

      const termCount = raw
        .replace(/[^\w\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length >= 2)
        .length

      // Detect dish-marker words in the query so we can disable demotion when
      // they're what the user is searching for.
      const queryHasDishMarker = /\b(with|and|salad|pasta|wrap|sandwich|burrito|pizza|patty|soup|stew|casserole|taco|burger|bowl)\b/i.test(raw)
      const demoteCompound = queryHasDishMarker ? 0 : 1  // 1 = enable demotion

      const genericsFirstClause = termCount <= 2
        ? `CASE WHEN f.data_type = 'generic' THEN 0 ELSE 1 END,`
        : ''

      const orderBy = `
        ORDER BY
          -- 0. MYRX always leads — coach-curated foods override everything
          CASE WHEN f.source = 'myrx' THEN 0 ELSE 1 END,
          -- A. Composite-dish demotion (skipped if query has dish-marker words)
          CASE
            WHEN ? = 1 AND (
              LOWER(f.name) LIKE '% with %'   OR
              LOWER(f.name) LIKE '% and %'    OR
              LOWER(f.name) LIKE '%salad%'    OR
              LOWER(f.name) LIKE '%pasta%'    OR
              LOWER(f.name) LIKE '%wrap%'     OR
              LOWER(f.name) LIKE '%sandwich%' OR
              LOWER(f.name) LIKE '%burrito%'  OR
              LOWER(f.name) LIKE '%pizza%'    OR
              LOWER(f.name) LIKE '%patty%'    OR
              LOWER(f.name) LIKE '%soup%'     OR
              LOWER(f.name) LIKE '%stew%'     OR
              LOWER(f.name) LIKE '%casserole%' OR
              LOWER(f.name) LIKE '%taco%'     OR
              LOWER(f.name) LIKE '%burger%'   OR
              LOWER(f.name) LIKE '% bowl%'
            ) THEN 1 ELSE 0
          END,
          -- B. Canonical subtype priority
          CASE f.source_subtype
            WHEN 'foundation_food'    THEN 0
            WHEN 'sr_legacy_food'     THEN 1
            WHEN 'survey_fndds_food'  THEN 2
            ELSE                           3
          END,
          -- C. Short-query generics-first
          ${genericsFirstClause}
          -- Final tiebreak: FTS5 BM25 rank
          rank
      `

      try {
        if (ftsQuery) {
          const stmt = env.DB.prepare(`
            SELECT f.${SELECT_COLS.replace(/,\s*/g, ', f.')}
            FROM food_fts
            JOIN food_library f ON food_fts.rowid = f.id
            WHERE food_fts MATCH ? ${srcClause}
            ${orderBy}
            LIMIT ?
          `).bind(ftsQuery, ...srcArgs, demoteCompound, limit)
          const { results } = await stmt.all()
          return json(results ?? [])
        }
      } catch {
        // FTS parse error — fall through to LIKE fallback
      }

      const likeClause = source ? 'AND source = ?' : ''
      const { results } = await env.DB.prepare(`
        SELECT ${SELECT_COLS}
        FROM food_library
        WHERE name LIKE ? ${likeClause}
        ORDER BY
          -- MYRX always leads (same rule as the FTS path)
          CASE WHEN source = 'myrx' THEN 0 ELSE 1 END,
          kcal
        LIMIT ?
      `).bind(`%${raw}%`, ...(source ? [source] : []), limit).all()

      return json(results ?? [])
    }

    // ── POST /admin/sync ──────────────────────────────────────────────────────
    if (pathname === '/admin/sync' && method === 'POST') {
      return handleTriggerSync(request, env)
    }

    // ── GET /admin/sync/status ────────────────────────────────────────────────
    if (pathname === '/admin/sync/status' && method === 'GET') {
      return handleSyncStatus(request, env)
    }

    // ── GET /admin/sync/summary ───────────────────────────────────────────────
    // Per-operation counts + meta for a sync run. Defaults to the most
    // recent run (sync_state.sync_run_id). Used by the review dialog and
    // sync history rows.
    if (pathname === '/admin/sync/summary' && method === 'GET') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      let runId = url.searchParams.get('run_id')
      if (!runId) {
        const { results } = await env.DB.prepare(
          `SELECT value FROM sync_state WHERE key = 'sync_run_id'`
        ).all()
        runId = results?.[0]?.value || ''
      }
      if (!runId) return json({ run_id: null, total: 0 })
      const summary = await summarize(env, runId)
      return json({ run_id: runId, ...summary })
    }

    // ── GET /admin/sync/changes ───────────────────────────────────────────────
    // Paginated changelog rows. Cursor-based via id > cursor. Optionally
    // filter to a single operation type.
    if (pathname === '/admin/sync/changes' && method === 'GET') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const runId  = url.searchParams.get('run_id')
      const cursor = Number(url.searchParams.get('cursor') ?? 0) || 0
      const limit  = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') ?? 1000) || 1000))
      const op     = url.searchParams.get('op') || null
      if (!runId) return json({ error: 'run_id required' }, 400)
      const rows = await listChanges(env, runId, { limit, cursor, op })
      const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
      return json({ run_id: runId, rows, next_cursor: nextCursor, done: nextCursor === null })
    }

    // ── GET /admin/sync/changes/csv ───────────────────────────────────────────
    // CSV download of every changelog row for a run. Streams in one shot —
    // typical sync has <10k changes which fits well under D1's limits.
    if (pathname === '/admin/sync/changes/csv' && method === 'GET') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const runId = url.searchParams.get('run_id')
      if (!runId) return json({ error: 'run_id required' }, 400)

      const rows = []
      let cursor = 0
      while (true) {
        const batch = await listChanges(env, runId, { limit: 1000, cursor })
        if (!batch.length) break
        rows.push(...batch)
        cursor = batch[batch.length - 1].id
        if (batch.length < 1000) break
      }

      const esc = s => '"' + String(s ?? '').replace(/"/g, '""') + '"'
      const lines = ['id,operation,source,source_id,name,brand,kcal,protein_g,fat_g,carbs_g,committed,reverted']
      for (const r of rows) {
        let after = null
        try { after = JSON.parse(r.after_data || 'null') } catch {}
        let before = null
        try { before = JSON.parse(r.before_data || 'null') } catch {}
        const data = after || before || {}
        lines.push([
          r.id, r.operation, r.food_source, r.food_source_id,
          esc(data.name), esc(data.brand),
          data.kcal ?? '', data.protein_g ?? '', data.fat_g ?? '', data.carbs_g ?? '',
          r.committed, r.reverted,
        ].join(','))
      }

      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="sync-changelog-${runId}.csv"`,
        },
      })
    }

    // ── POST /admin/sync/commit ───────────────────────────────────────────────
    // Apply pending (committed=0) changelog entries for run_id. Loops
    // batches until done. On final batch, flips sync_state to record
    // last_committed_run_id and clears the staged-review flag.
    if (pathname === '/admin/sync/commit' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const body = await request.json().catch(() => ({}))
      const runId = body.run_id
      if (!runId) return json({ error: 'run_id required' }, 400)

      let totalApplied = 0
      let safetyCounter = 0
      while (safetyCounter++ < 1000) {
        const r = await commitBatch(env, runId)
        totalApplied += r.applied
        if (r.done) break
      }

      // Mark as last-committed and clear staged-review flag.
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE sync_state SET value = ?, updated_at = datetime('now') WHERE key = 'last_committed_run_id'`
        ).bind(runId),
        env.DB.prepare(
          `UPDATE sync_state SET value = '0', updated_at = datetime('now') WHERE key = 'sync_staged_review'`
        ),
      ])

      // Rebuild FTS5 index so search picks up the newly committed rows.
      try {
        await env.DB.prepare(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`).run()
      } catch (e) { /* non-fatal */ }

      return json({ applied: totalApplied, run_id: runId, done: true })
    }

    // ── POST /admin/sync/discard ──────────────────────────────────────────────
    // Drop pending changelog rows. Live food_library untouched.
    if (pathname === '/admin/sync/discard' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const body = await request.json().catch(() => ({}))
      const runId = body.run_id
      if (!runId) return json({ error: 'run_id required' }, 400)
      const result = await discardRun(env, runId)
      await env.DB.prepare(
        `UPDATE sync_state SET value = '0', updated_at = datetime('now') WHERE key = 'sync_staged_review'`
      ).run()
      return json({ ...result, run_id: runId })
    }

    // ── POST /admin/sync/undo ─────────────────────────────────────────────────
    // Reverse a committed run. Only allowed for the most-recent committed
    // run (last_committed_run_id). After undo, the run becomes unrecoverable.
    if (pathname === '/admin/sync/undo' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const body = await request.json().catch(() => ({}))
      const runId = body.run_id
      if (!runId) return json({ error: 'run_id required' }, 400)

      // Safety check — only allow undo on the most-recent committed run.
      const { results } = await env.DB.prepare(
        `SELECT value FROM sync_state WHERE key = 'last_committed_run_id'`
      ).all()
      const lastRun = results?.[0]?.value || ''
      if (lastRun !== runId) {
        return json({ error: 'Can only undo the most recent committed sync' }, 400)
      }

      let totalApplied = 0
      let safetyCounter = 0
      while (safetyCounter++ < 1000) {
        const r = await undoBatch(env, runId)
        totalApplied += r.applied
        if (r.done) break
      }

      await env.DB.prepare(
        `UPDATE sync_state SET value = '', updated_at = datetime('now') WHERE key = 'last_committed_run_id'`
      ).run()

      // Rebuild FTS5 index after restoring rows.
      try {
        await env.DB.prepare(`INSERT INTO food_fts(food_fts) VALUES ('rebuild')`).run()
      } catch (e) { /* non-fatal */ }

      return json({ reversed: totalApplied, run_id: runId, done: true })
    }

    // ── POST /admin/sync/cancel ───────────────────────────────────────────────
    // Set the cancel flag. Sync scripts poll /admin/sync/cancel/check and
    // abort cleanly when they see it.
    if (pathname === '/admin/sync/cancel' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      await env.DB.prepare(
        `UPDATE sync_state SET value = '1', updated_at = datetime('now') WHERE key = 'sync_cancel_requested'`
      ).run()
      return json({ ok: true })
    }

    // ── GET /admin/sync/cancel/check ──────────────────────────────────────────
    // Sync scripts poll this between batches to know if the user has
    // requested cancellation.
    if (pathname === '/admin/sync/cancel/check' && method === 'GET') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const { results } = await env.DB.prepare(
        `SELECT value FROM sync_state WHERE key = 'sync_cancel_requested'`
      ).all()
      return json({ cancel: (results?.[0]?.value || '0') === '1' })
    }

    // ── POST /admin/sync/changelog/append ─────────────────────────────────────
    // Internal: called by sync scripts during a run. Bulk-inserts a batch
    // of changelog rows. Body: { run_id, entries: [{operation, food_source,
    // food_source_id, before_data, after_data}, ...] }
    if (pathname === '/admin/sync/changelog/append' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const body = await request.json().catch(() => ({}))
      const { run_id, entries } = body
      if (!run_id || !Array.isArray(entries) || !entries.length) {
        return json({ error: 'run_id + entries[] required' }, 400)
      }

      const stmts = entries.map(e => env.DB.prepare(
        `INSERT INTO sync_changelog
         (run_id, operation, food_source, food_source_id, before_data, after_data, committed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      ).bind(
        run_id, e.operation, e.food_source, e.food_source_id,
        e.before_data ?? null, e.after_data ?? null,
      ))

      await env.DB.batch(stmts)
      return json({ appended: entries.length })
    }

    // ── POST /admin/sync/state ────────────────────────────────────────────────
    // Internal: sync scripts call this to update status + progress + run_id.
    // Body: { status?, run_id?, mode?, progress?, error?, started_at?, completed_at? }
    if (pathname === '/admin/sync/state' && method === 'POST') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const body = await request.json().catch(() => ({}))

      const updates = []
      const stateMap = {
        status:       'sync_status',
        run_id:       'sync_run_id',
        mode:         'sync_mode',
        progress:     'sync_progress',
        error:        'sync_error',
        started_at:   'sync_started_at',
        completed_at: 'sync_completed_at',
      }

      for (const [key, dbKey] of Object.entries(stateMap)) {
        if (body[key] !== undefined) {
          const value = typeof body[key] === 'object' ? JSON.stringify(body[key]) : String(body[key])
          updates.push(env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind(dbKey, value))
        }
      }

      // If status transitioned to 'completed' AND mode === 'staged',
      // set the review flag so the UI knows to show the review dialog.
      if (body.status === 'completed' && body.mode === 'staged') {
        updates.push(env.DB.prepare(
          `UPDATE sync_state SET value = '1', updated_at = datetime('now') WHERE key = 'sync_staged_review'`
        ))
      }
      // If status transitioned to 'completed' AND mode === 'commit',
      // record last_committed_run_id for undo support.
      if (body.status === 'completed' && body.mode === 'commit' && body.run_id) {
        updates.push(env.DB.prepare(
          `UPDATE sync_state SET value = ?, updated_at = datetime('now') WHERE key = 'last_committed_run_id'`
        ).bind(body.run_id))
      }
      // If status transitioned to 'running', clear the cancel flag
      // from any prior cancellation.
      if (body.status === 'running') {
        updates.push(env.DB.prepare(
          `UPDATE sync_state SET value = '0', updated_at = datetime('now') WHERE key = 'sync_cancel_requested'`
        ))
      }

      if (updates.length) await env.DB.batch(updates)
      return json({ ok: true })
    }

    // ── GET /admin/sync/history ───────────────────────────────────────────────
    // Last N sync runs grouped from the changelog. Lightweight — uses
    // GROUP BY run_id without storing a separate history table.
    if (pathname === '/admin/sync/history' && method === 'GET') {
      const authErr = requireAuth(request, env)
      if (authErr) return authErr
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10))
      const { results } = await env.DB.prepare(
        `SELECT run_id,
                MIN(created_at) AS started_at,
                MAX(created_at) AS ended_at,
                SUM(CASE WHEN operation = 'insert' THEN 1 ELSE 0 END) AS inserts,
                SUM(CASE WHEN operation = 'update' THEN 1 ELSE 0 END) AS updates,
                SUM(CASE WHEN operation = 'delete' THEN 1 ELSE 0 END) AS deletes,
                SUM(CASE WHEN committed = 1 THEN 1 ELSE 0 END) AS committed,
                SUM(CASE WHEN reverted  = 1 THEN 1 ELSE 0 END) AS reverted
         FROM sync_changelog
         GROUP BY run_id
         ORDER BY MAX(id) DESC
         LIMIT ?`
      ).bind(limit).all()
      return json(results ?? [])
    }

    return json({ error: 'Not found' }, 404)
  },
}
