/**
 * MyRX Food Search Worker
 * Cloudflare D1 + FTS5 — replaces Supabase food_library queries
 *
 * GET /search?q=<query>&limit=<n>
 *   Returns JSON array of food items matching the query.
 *
 * GET /food/<source_id>
 *   Returns a single food item by source_id.
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** Sanitize query into safe FTS5 MATCH expression with prefix matching */
function buildFtsQuery(raw) {
  // Strip special FTS5 chars, split on whitespace
  const terms = raw
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .slice(0, 6)          // cap at 6 terms to avoid overly narrow AND queries

  if (terms.length === 0) return null
  return terms.map(t => `"${t}"*`).join(' ')
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url      = new URL(request.url)
    const pathname = url.pathname

    // ── GET /search?q=...&limit=... ───────────────────────────────────────────
    if (pathname === '/search') {
      const raw   = url.searchParams.get('q')?.trim() ?? ''
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 50)

      if (raw.length < 2) return json([])

      const ftsQuery = buildFtsQuery(raw)

      try {
        if (ftsQuery) {
          const { results } = await env.DB.prepare(`
            SELECT
              f.source_id,
              f.name,
              f.brand,
              f.kcal,
              f.protein_g,
              f.fat_g,
              f.carbs_g,
              f.fiber_g,
              f.sodium_mg,
              f.serving_g,
              f.serving_label
            FROM food_fts
            JOIN food_library f ON food_fts.rowid = f.id
            WHERE food_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).bind(ftsQuery, limit).all()

          return json(results ?? [])
        }
      } catch {
        // FTS parse error — fall through to LIKE fallback
      }

      // Fallback: simple LIKE (handles edge cases, slower but safe)
      const { results } = await env.DB.prepare(`
        SELECT
          source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
          fiber_g, sodium_mg, serving_g, serving_label
        FROM food_library
        WHERE name LIKE ?
        ORDER BY kcal
        LIMIT ?
      `).bind(`%${raw}%`, limit).all()

      return json(results ?? [])
    }

    // ── GET /food/<source_id> ─────────────────────────────────────────────────
    const match = pathname.match(/^\/food\/([^/]+)$/)
    if (match) {
      const sourceId = decodeURIComponent(match[1])
      const { results } = await env.DB.prepare(`
        SELECT source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
               fiber_g, sodium_mg, serving_g, serving_label
        FROM food_library
        WHERE source_id = ?
        LIMIT 1
      `).bind(sourceId).all()

      if (!results?.length) return json({ error: 'Not found' }, 404)
      return json(results[0])
    }

    return json({ error: 'Not found' }, 404)
  },
}
