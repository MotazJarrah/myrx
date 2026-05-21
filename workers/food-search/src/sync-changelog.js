/**
 * Sync changelog operations — shared between the sync-admin endpoints
 * and the cleanup endpoints. All four staged-sync verbs live here:
 *
 *   commit(env, runId)         apply pending changelog rows to food_library
 *   discard(env, runId)        drop pending changelog rows (no-op on food_library)
 *   undo(env, runId)           reverse a committed run's changes
 *   listChanges(env, runId)    pull the changelog for review/download
 *
 * Operations on food_library are batched in groups of 100 to stay inside
 * D1's per-request limit and inside the Worker CPU budget. For very large
 * change sets the caller invokes commit/undo multiple times with cursor
 * pagination — every operation is idempotent because we filter on
 * committed/reverted flags that flip after each batch.
 */

const BATCH_SIZE = 100

// Columns we serialize into before_data / after_data.
const FOOD_COLS = [
  'source', 'source_id', 'source_subtype', 'name', 'brand',
  'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sodium_mg',
  'serving_g', 'serving_label', 'servings_per_container',
  'data_type', 'upc', 'imported_at', 'last_synced_at', 'source_version',
]

function rowToJson(row) {
  if (!row) return null
  const out = {}
  for (const c of FOOD_COLS) out[c] = row[c] ?? null
  return JSON.stringify(out)
}

function jsonToRow(json) {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

// ── COMMIT ────────────────────────────────────────────────────────────────────
// Applies a single batch of pending changelog rows. Returns
// { applied, remaining } so the caller can loop until remaining = 0.
export async function commitBatch(env, runId) {
  const { results: pending } = await env.DB.prepare(
    `SELECT id, operation, food_source, food_source_id, before_data, after_data
     FROM sync_changelog
     WHERE run_id = ? AND committed = 0 AND reverted = 0
     ORDER BY id ASC
     LIMIT ?`
  ).bind(runId, BATCH_SIZE).all()

  if (!pending?.length) return { applied: 0, remaining: 0, done: true }

  const stmts = []
  for (const c of pending) {
    if (c.operation === 'insert') {
      const after = jsonToRow(c.after_data)
      if (!after) continue
      stmts.push(env.DB.prepare(
        `INSERT OR REPLACE INTO food_library
         (source, source_id, source_subtype, name, brand,
          kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg,
          serving_g, serving_label, servings_per_container,
          data_type, upc, imported_at, last_synced_at, source_version)
         VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?)`
      ).bind(
        after.source, after.source_id, after.source_subtype, after.name, after.brand,
        after.kcal, after.protein_g, after.fat_g, after.carbs_g, after.fiber_g, after.sodium_mg,
        after.serving_g, after.serving_label, after.servings_per_container,
        after.data_type, after.upc, after.imported_at, after.last_synced_at, after.source_version,
      ))
    } else if (c.operation === 'update') {
      const after = jsonToRow(c.after_data)
      if (!after) continue
      stmts.push(env.DB.prepare(
        `UPDATE food_library SET
           source_subtype=?, name=?, brand=?,
           kcal=?, protein_g=?, fat_g=?, carbs_g=?, fiber_g=?, sodium_mg=?,
           serving_g=?, serving_label=?, servings_per_container=?,
           data_type=?, upc=?, last_synced_at=?, source_version=?
         WHERE source=? AND source_id=?`
      ).bind(
        after.source_subtype, after.name, after.brand,
        after.kcal, after.protein_g, after.fat_g, after.carbs_g, after.fiber_g, after.sodium_mg,
        after.serving_g, after.serving_label, after.servings_per_container,
        after.data_type, after.upc, after.last_synced_at, after.source_version,
        c.food_source, c.food_source_id,
      ))
    } else if (c.operation === 'delete') {
      stmts.push(env.DB.prepare(
        `DELETE FROM food_library WHERE source=? AND source_id=?`
      ).bind(c.food_source, c.food_source_id))
    }
    // Flip committed flag.
    stmts.push(env.DB.prepare(
      `UPDATE sync_changelog SET committed = 1 WHERE id = ?`
    ).bind(c.id))
  }

  if (stmts.length) await env.DB.batch(stmts)

  // Count remaining.
  const { results: r } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sync_changelog
     WHERE run_id = ? AND committed = 0 AND reverted = 0`
  ).bind(runId).all()
  const remaining = r?.[0]?.n ?? 0

  return { applied: pending.length, remaining, done: remaining === 0 }
}

// ── DISCARD ───────────────────────────────────────────────────────────────────
// Drop all pending (uncommitted) rows for a run_id. Food_library untouched.
export async function discardRun(env, runId) {
  const { meta } = await env.DB.prepare(
    `DELETE FROM sync_changelog
     WHERE run_id = ? AND committed = 0`
  ).bind(runId).run()
  return { deleted: meta?.changes ?? 0 }
}

// ── UNDO ──────────────────────────────────────────────────────────────────────
// Reverse a committed run's changes. Inserts become deletes, deletes become
// inserts (restoring the row from before_data), updates revert to before_data.
// Processes in REVERSE order so we restore in the correct logical sequence.
export async function undoBatch(env, runId) {
  const { results: committed } = await env.DB.prepare(
    `SELECT id, operation, food_source, food_source_id, before_data, after_data
     FROM sync_changelog
     WHERE run_id = ? AND committed = 1 AND reverted = 0
     ORDER BY id DESC
     LIMIT ?`
  ).bind(runId, BATCH_SIZE).all()

  if (!committed?.length) return { applied: 0, remaining: 0, done: true }

  const stmts = []
  for (const c of committed) {
    if (c.operation === 'insert') {
      // Undo an insert = delete the row we inserted.
      stmts.push(env.DB.prepare(
        `DELETE FROM food_library WHERE source=? AND source_id=?`
      ).bind(c.food_source, c.food_source_id))
    } else if (c.operation === 'update') {
      // Undo an update = restore the before_data.
      const before = jsonToRow(c.before_data)
      if (before) {
        stmts.push(env.DB.prepare(
          `UPDATE food_library SET
             source_subtype=?, name=?, brand=?,
             kcal=?, protein_g=?, fat_g=?, carbs_g=?, fiber_g=?, sodium_mg=?,
             serving_g=?, serving_label=?, servings_per_container=?,
             data_type=?, upc=?, last_synced_at=?, source_version=?
           WHERE source=? AND source_id=?`
        ).bind(
          before.source_subtype, before.name, before.brand,
          before.kcal, before.protein_g, before.fat_g, before.carbs_g, before.fiber_g, before.sodium_mg,
          before.serving_g, before.serving_label, before.servings_per_container,
          before.data_type, before.upc, before.last_synced_at, before.source_version,
          c.food_source, c.food_source_id,
        ))
      }
    } else if (c.operation === 'delete') {
      // Undo a delete = re-insert the row from before_data.
      const before = jsonToRow(c.before_data)
      if (before) {
        stmts.push(env.DB.prepare(
          `INSERT OR REPLACE INTO food_library
           (source, source_id, source_subtype, name, brand,
            kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg,
            serving_g, serving_label, servings_per_container,
            data_type, upc, imported_at, last_synced_at, source_version)
           VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?)`
        ).bind(
          before.source, before.source_id, before.source_subtype, before.name, before.brand,
          before.kcal, before.protein_g, before.fat_g, before.carbs_g, before.fiber_g, before.sodium_mg,
          before.serving_g, before.serving_label, before.servings_per_container,
          before.data_type, before.upc, before.imported_at, before.last_synced_at, before.source_version,
        ))
      }
    }
    stmts.push(env.DB.prepare(
      `UPDATE sync_changelog SET reverted = 1 WHERE id = ?`
    ).bind(c.id))
  }

  if (stmts.length) await env.DB.batch(stmts)

  const { results: r } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sync_changelog
     WHERE run_id = ? AND committed = 1 AND reverted = 0`
  ).bind(runId).all()
  const remaining = r?.[0]?.n ?? 0

  return { applied: committed.length, remaining, done: remaining === 0 }
}

// ── LIST ──────────────────────────────────────────────────────────────────────
// Paginated read of changelog entries. Used by the review dialog + download.
export async function listChanges(env, runId, { limit = 1000, cursor = 0, op = null } = {}) {
  const where = ['run_id = ?', 'id > ?']
  const binds = [runId, cursor]
  if (op) { where.push('operation = ?'); binds.push(op) }

  const { results } = await env.DB.prepare(
    `SELECT id, operation, food_source, food_source_id,
            before_data, after_data, committed, reverted
     FROM sync_changelog
     WHERE ${where.join(' AND ')}
     ORDER BY id ASC
     LIMIT ?`
  ).bind(...binds, limit).all()

  return results ?? []
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
// Per-operation row counts for a run_id. Used by the review dialog header
// and the sync history list.
export async function summarize(env, runId) {
  const { results } = await env.DB.prepare(
    `SELECT operation, committed, reverted, COUNT(*) AS n
     FROM sync_changelog
     WHERE run_id = ?
     GROUP BY operation, committed, reverted`
  ).bind(runId).all()

  const out = {
    inserts:        0,
    updates:        0,
    deletes:        0,
    inserts_committed: 0,
    updates_committed: 0,
    deletes_committed: 0,
    reverted:       0,
    total_pending:  0,
    total_committed: 0,
  }
  for (const r of results ?? []) {
    const n = r.n ?? 0
    if (r.reverted) {
      out.reverted += n
      continue
    }
    if (r.committed) {
      out[`${r.operation}s_committed`] = (out[`${r.operation}s_committed`] || 0) + n
      out.total_committed += n
    } else {
      out[`${r.operation}s`] = (out[`${r.operation}s`] || 0) + n
      out.total_pending += n
    }
  }
  return out
}
