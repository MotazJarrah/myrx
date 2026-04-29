/**
 * Persistent data cache backed by localStorage.
 *
 * Survives tab suspension, app minimise/reopen, and PWA relaunch.
 * Pages seed their initial state from cache → instant render on revisit,
 * then re-fetch in the background to stay fresh.
 *
 * Keys are namespaced with "myrx:" to avoid collisions.
 * TTL: 90 seconds — stale data is shown at most 90 s after it was written.
 */

const NS      = 'myrx:'
const TTL_MS  = 90_000   // 90 s

export const dataCache = {
  get(key) {
    try {
      const raw = localStorage.getItem(NS + key)
      if (!raw) return null
      const entry = JSON.parse(raw)
      if (Date.now() - entry.ts > TTL_MS) {
        localStorage.removeItem(NS + key)
        return null
      }
      return entry.data
    } catch {
      return null
    }
  },

  set(key, data) {
    try {
      localStorage.setItem(NS + key, JSON.stringify({ data, ts: Date.now() }))
    } catch {
      // Ignore quota errors (private browsing / full storage)
    }
  },

  /** Remove one entry immediately (call after a mutation) */
  bust(key) {
    try { localStorage.removeItem(NS + key) } catch { /* */ }
  },

  /** Remove all entries whose key starts with prefix */
  bustPrefix(prefix) {
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(NS + prefix)) keys.push(k)
      }
      keys.forEach(k => localStorage.removeItem(k))
    } catch { /* */ }
  },
}
