/**
 * Helpers for reading and writing the sync_state table in D1.
 * All mutations return new objects — no shared state.
 */

/**
 * Read a single key from sync_state.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @param {string} key
 * @returns {Promise<string>}
 */
export async function getState(db, key) {
  const { results } = await db.query(
    'SELECT value FROM sync_state WHERE key = ?', [key]
  )
  return results?.[0]?.value ?? ''
}

/**
 * Write a single key to sync_state.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @param {string} key
 * @param {string} value
 */
export async function setState(db, key, value) {
  await db.query(
    `INSERT INTO sync_state(key, value, updated_at) VALUES(?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, String(value)]
  )
}

/**
 * Merge a partial object into the sync_progress JSON blob.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @param {Record<string, unknown>} partial
 */
export async function updateProgress(db, partial) {
  const current = await getState(db, 'sync_progress')
  let parsed = {}
  try { parsed = JSON.parse(current) } catch {}
  const merged = { ...parsed, ...partial }
  await setState(db, 'sync_progress', JSON.stringify(merged))
}

/**
 * Mark sync as running — uses a conditional UPDATE to prevent double-starts.
 * Returns true if we successfully claimed the lock, false if already running.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @returns {Promise<boolean>}
 */
export async function claimSyncLock(db) {
  const { meta } = await db.query(
    `UPDATE sync_state SET value='running', updated_at=datetime('now')
     WHERE key='sync_status' AND value != 'running'`
  )
  return (meta?.changes ?? 0) > 0
}

/**
 * Set final sync status (completed or failed) with optional error message.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @param {'completed' | 'failed' | 'idle'} status
 * @param {string} [errorMsg]
 */
export async function setFinalStatus(db, status, errorMsg = '') {
  const tsKey = status === 'completed' ? 'sync_completed_at' : 'sync_completed_at'
  await db.batch([
    { sql: `UPDATE sync_state SET value=?, updated_at=datetime('now') WHERE key='sync_status'`, params: [status] },
    { sql: `UPDATE sync_state SET value=datetime('now'), updated_at=datetime('now') WHERE key='${tsKey}'` },
    { sql: `UPDATE sync_state SET value=?, updated_at=datetime('now') WHERE key='sync_error'`, params: [errorMsg] },
  ])
}

/**
 * Read all sync state keys at once and return as a plain object.
 * @param {ReturnType<import('./d1.mjs').createD1Client>} db
 * @returns {Promise<Record<string, string>>}
 */
export async function getAllState(db) {
  const { results } = await db.query('SELECT key, value FROM sync_state')
  return Object.fromEntries((results ?? []).map(r => [r.key, r.value]))
}
