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
 *   GET    /admin/sync/status       → read sync status from D1
 */

import { handleTriggerSync, handleSyncStatus } from './sync-admin.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SELECT_COLS = `source, source_id, name, brand, kcal, protein_g, fat_g,
  carbs_g, fiber_g, sodium_mg, serving_g, serving_label`

/**
 * Normalize any barcode format to 12-digit UPC-A.
 * Handles UPC-A (12), EAN-13 (13), GTIN-14 (14) by stripping leading zeros
 * and padding back to 12 digits. A scanner returning 12-digit UPC-A will
 * always produce the same result as USDA's 14-digit GTIN or ON's EAN-13.
 */
function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null  // too short to be a real barcode
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null  // all-zero GTIN = no barcode in USDA data
  return stripped.padStart(12, '0')
}

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
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined && body[f] !== null) {
      const n = Number(body[f])
      if (isNaN(n)) return `${f} must be a number`
      if (n < 0)    return `${f} must be >= 0`
    }
  }
  return null
}

function coerce(body) {
  const out = {}
  if (body.name  !== undefined) out.name  = String(body.name).trim()
  if (body.brand !== undefined) out.brand = body.brand ? String(body.brand).trim() : null
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

  const data      = coerce(body)
  const source_id = crypto.randomUUID()

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO food_library (source, source_id, name, brand, kcal, protein_g, fat_g,
        carbs_g, fiber_g, sodium_mg, serving_g, serving_label)
      VALUES ('myrx', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(source_id, data.name, data.brand ?? null, data.kcal ?? null,
        data.protein_g ?? null, data.fat_g ?? null, data.carbs_g ?? null,
        data.fiber_g ?? null, data.sodium_mg ?? null, data.serving_g ?? null,
        data.serving_label ?? null),
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

  // Fetch existing row
  const existing = await env.DB.prepare(
    `SELECT id, name, brand FROM food_library WHERE source='myrx' AND source_id=?`
  ).bind(source_id).first()
  if (!existing) return json({ error: 'Not found' }, 404)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const validErr = validateFood(body, { partial: true })
  if (validErr) return json({ error: validErr }, 400)

  const data = coerce(body)
  if (Object.keys(data).length === 0) return json({ error: 'No fields to update' }, 400)

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
    if (pathname === '/stats' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT source, COUNT(*) as count FROM food_library GROUP BY source`
      ).all()
      const stats = {}
      for (const r of results ?? []) stats[r.source] = r.count
      return json(stats)
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

      try {
        if (ftsQuery) {
          const stmt = env.DB.prepare(`
            SELECT f.${SELECT_COLS.replace(/,\s*/g, ', f.')}
            FROM food_fts
            JOIN food_library f ON food_fts.rowid = f.id
            WHERE food_fts MATCH ? ${srcClause}
            ORDER BY rank
            LIMIT ?
          `).bind(ftsQuery, ...srcArgs, limit)
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
        ORDER BY kcal
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

    return json({ error: 'Not found' }, 404)
  },
}
