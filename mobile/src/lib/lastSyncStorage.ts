/**
 * Per-integration last-sync timestamp store.
 *
 * Each external integration (Health Connect, Apple HealthKit, Strava,
 * Garmin, Whoop, Polar — once they ship) needs to remember when it
 * last successfully pulled data. The Connect tab surfaces this as
 * "Last synced 2 min ago" so the user can tell if a sync ran recently.
 *
 * Stored in AsyncStorage as key `myrx.lastSync.<integration>` →
 * ISO-8601 string. Per-device, not per-user — these are local UX
 * conveniences, not server-of-record data. Clearing the value when
 * the user disconnects is part of the disconnect flow so the UI
 * flips back to a clean "Connect" state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

export type IntegrationKey =
  | 'healthConnect'
  | 'appleHealthKit'
  | 'strava'
  | 'garmin'
  | 'whoop'
  | 'polar'

function storageKey(integration: IntegrationKey): string {
  return `myrx.lastSync.${integration}`
}

/**
 * Read the last-sync ISO timestamp for the given integration.
 * Returns null if never synced (or storage is empty).
 */
export async function getLastSync(integration: IntegrationKey): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(storageKey(integration))
  } catch {
    return null
  }
}

/**
 * Stamp the current time as the most recent successful sync for
 * the given integration. Called from the integration's sync handler
 * AFTER the fetch returns successfully.
 */
export async function setLastSyncNow(integration: IntegrationKey): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(integration), new Date().toISOString())
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Wipe the last-sync marker. Called from the integration's disconnect
 * flow so the UI flips back to "Connect" state without a stale
 * timestamp lingering.
 */
export async function clearLastSync(integration: IntegrationKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(integration))
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Human-friendly "5 minutes ago" / "yesterday" style string from a
 * stored ISO timestamp. Returns null if the input is null/invalid.
 * Caller can fall back to "Never" when this returns null.
 */
export function formatLastSync(iso: string | null): string | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return null
  const diffMs = Date.now() - ts
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60)            return 'Just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60)            return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24)             return `${diffHr} hr ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7)             return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  // For older than a week, just show the date.
  return new Date(iso).toLocaleDateString()
}
