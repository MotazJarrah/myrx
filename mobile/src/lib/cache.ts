/**
 * Persistent data cache backed by AsyncStorage.
 *
 * Direct port of MyRX/src/lib/cache.js. The web version uses synchronous
 * localStorage; React Native's AsyncStorage is async, so we expose an
 * in-memory shadow that's hydrated once at app start. After hydration, get()
 * is synchronous again — matching the web's call sites that seed React state
 * inline (e.g. `useState(cached?.efforts ?? [])`).
 *
 * TTL: 5 min, identical to web.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const NS     = 'myrx:'
const TTL_MS = 300_000  // 5 min

type Entry = { data: unknown; ts: number }

// In-memory shadow — populated on first hydrate(), updated on every set().
const memory = new Map<string, Entry>()
let hydrated = false

/** Call once on app start (e.g. from root _layout). Safe to call multiple times. */
export async function hydrateCache(): Promise<void> {
  if (hydrated) return
  try {
    const allKeys = await AsyncStorage.getAllKeys()
    const ours = allKeys.filter(k => k.startsWith(NS))
    if (ours.length > 0) {
      const pairs = await AsyncStorage.multiGet(ours)
      for (const [k, raw] of pairs) {
        if (!raw) continue
        try {
          const entry: Entry = JSON.parse(raw)
          if (Date.now() - entry.ts > TTL_MS) {
            AsyncStorage.removeItem(k)
            continue
          }
          memory.set(k.slice(NS.length), entry)
        } catch {
          // Corrupted entry — drop it.
          AsyncStorage.removeItem(k)
        }
      }
    }
  } catch {
    // Storage unavailable — keep memory shadow empty, app still works.
  }
  hydrated = true
}

export const dataCache = {
  /** Synchronous read against the in-memory shadow. Returns null if expired or missing. */
  get<T = unknown>(key: string): T | null {
    const entry = memory.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts > TTL_MS) {
      memory.delete(key)
      AsyncStorage.removeItem(NS + key)
      return null
    }
    return entry.data as T
  },

  /** Write synchronously to memory; persist asynchronously (fire-and-forget). */
  set(key: string, data: unknown): void {
    const entry: Entry = { data, ts: Date.now() }
    memory.set(key, entry)
    AsyncStorage.setItem(NS + key, JSON.stringify(entry)).catch(() => {})
  },

  /** Remove one entry (call after a mutation). */
  bust(key: string): void {
    memory.delete(key)
    AsyncStorage.removeItem(NS + key).catch(() => {})
  },

  /** Remove all entries whose key starts with prefix. */
  bustPrefix(prefix: string): void {
    for (const k of Array.from(memory.keys())) {
      if (k.startsWith(prefix)) memory.delete(k)
    }
    AsyncStorage.getAllKeys().then(keys => {
      const toRemove = keys.filter(k => k.startsWith(NS + prefix))
      if (toRemove.length > 0) AsyncStorage.multiRemove(toRemove)
    }).catch(() => {})
  },
}
