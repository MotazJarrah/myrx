/**
 * Changelog recorder for staged-sync support.
 *
 * Buffers insert/update/delete operations during a sync run, then flushes
 * them to the worker's /admin/sync/changelog/append endpoint in batches.
 *
 * Two execution modes (controlled by SYNC_MODE env var):
 *
 *   SYNC_MODE = 'commit' (default — the "dry-run toggle OFF" path)
 *     The sync script writes to food_library AS NORMAL via its existing
 *     D1 batch operations. The recorder ALSO captures every op into the
 *     changelog so the user can undo the whole run from the admin UI.
 *     Both paths run; the live DB sees changes immediately.
 *
 *   SYNC_MODE = 'staged' (the "dry-run toggle ON" path)
 *     The sync script SKIPS the D1 writes — only the changelog gets
 *     populated. The user reviews + commits manually from the admin UI,
 *     which calls /admin/sync/commit to apply the changelog to food_library.
 *
 * The sync scripts check `shouldApplyToLiveDb()` before running INSERT/
 * UPDATE/DELETE batches. They call `recordInsert/Update/Delete` at the
 * point they would have written.
 *
 * The recorder is a no-op when SYNC_RUN_ID is unset (back-compat — running
 * sync_usda.mjs manually from a dev box without changelog env vars works
 * the same as before).
 */

import { withRetry } from './retry.mjs'

// ── Env ───────────────────────────────────────────────────────────────────────

const {
  SYNC_RUN_ID,
  SYNC_MODE,
  FOOD_ADMIN_KEY,
  WORKER_URL,
} = process.env

const ENABLED  = !!SYNC_RUN_ID
const MODE     = (SYNC_MODE === 'staged') ? 'staged' : 'commit'
const WORKER   = WORKER_URL || 'https://myrx-food-search.motaz-jarrah.workers.dev'

const FLUSH_THRESHOLD = 100  // entries to buffer before auto-flush

let buffer  = []
let flushing = false  // serialize concurrent flushes

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Whether the sync script should apply its operations to food_library
 * directly. False in staged mode — only the changelog gets written.
 */
export function shouldApplyToLiveDb() {
  if (!ENABLED) return true           // not a worker-driven run; behave as before
  return MODE === 'commit'
}

/** Are we in a worker-driven run at all? */
export function isChangelogEnabled() {
  return ENABLED
}

export function getRunId() { return SYNC_RUN_ID }
export function getMode()  { return MODE }

/**
 * Record an insert. `row` should be the full food_library row object
 * that's about to be inserted.
 */
export function recordInsert(row) {
  if (!ENABLED) return
  buffer.push({
    operation:      'insert',
    food_source:    row.source,
    food_source_id: row.source_id,
    before_data:    null,
    after_data:     JSON.stringify(row),
  })
  maybeFlush()
}

/**
 * Record an update. `before` is the existing food_library row (the one
 * the UPDATE statement will overwrite); `after` is the new state.
 */
export function recordUpdate(before, after) {
  if (!ENABLED) return
  buffer.push({
    operation:      'update',
    food_source:    after.source,
    food_source_id: after.source_id,
    before_data:    JSON.stringify(before),
    after_data:     JSON.stringify(after),
  })
  maybeFlush()
}

/**
 * Record a delete. `before` is the row that's about to be removed.
 */
export function recordDelete(before) {
  if (!ENABLED) return
  buffer.push({
    operation:      'delete',
    food_source:    before.source,
    food_source_id: before.source_id,
    before_data:    JSON.stringify(before),
    after_data:     null,
  })
  maybeFlush()
}

/** Flush remaining buffered entries. Call this at the end of every sync run. */
export async function flushAll() {
  if (!ENABLED) return
  while (buffer.length) {
    await flush()
  }
}

// ── Internals ─────────────────────────────────────────────────────────────────

async function maybeFlush() {
  if (buffer.length < FLUSH_THRESHOLD) return
  await flush()
}

async function flush() {
  if (flushing) return
  if (!buffer.length) return
  flushing = true
  try {
    const batch = buffer.splice(0, FLUSH_THRESHOLD)
    await withRetry(async () => {
      const res = await fetch(`${WORKER}/admin/sync/changelog/append`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FOOD_ADMIN_KEY}`,
        },
        body: JSON.stringify({ run_id: SYNC_RUN_ID, entries: batch }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`changelog append failed ${res.status}: ${txt}`)
      }
    }, { label: 'changelog flush', retries: 3, baseMs: 1_000 })
  } finally {
    flushing = false
  }
}

// ── Cancel polling ────────────────────────────────────────────────────────────
// Sync scripts call this between batches to abort cleanly if the admin
// clicked "Cancel mid-sync" in the UI.
//
// Throttling: at most one HTTP check per 2 seconds. The previous 5s
// throttle made cancel feel sluggish — a USDA branded page round-trip
// takes ~1.5–3s, so cancel could miss the next page check entirely
// and not stop until the page after that, putting total cancel latency
// at 8–10s. 2s throttle catches the next page boundary almost always
// while still keeping worker traffic minimal (~30 checks/min worst case).
let lastCancelCheck = 0
let cachedCancel = false  // sticky — once true, always returns true
export async function isCancelRequested() {
  if (!ENABLED) return false
  if (cachedCancel) return true
  const now = Date.now()
  if (now - lastCancelCheck < 2_000) return false
  lastCancelCheck = now
  try {
    const res = await fetch(`${WORKER}/admin/sync/cancel/check`, {
      headers: { 'Authorization': `Bearer ${FOOD_ADMIN_KEY}` },
    })
    if (!res.ok) return false
    const { cancel } = await res.json()
    if (cancel) cachedCancel = true  // remember; no need to re-check
    return !!cancel
  } catch {
    return false
  }
}

// ── State reporting ───────────────────────────────────────────────────────────
// Used by sync scripts to push status updates the admin UI polls.
export async function pushSyncState(patch) {
  if (!ENABLED) return
  try {
    await fetch(`${WORKER}/admin/sync/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FOOD_ADMIN_KEY}`,
      },
      body: JSON.stringify({
        run_id: SYNC_RUN_ID,
        mode:   MODE,
        ...patch,
      }),
    })
  } catch {
    /* silent — state updates are best-effort */
  }
}
