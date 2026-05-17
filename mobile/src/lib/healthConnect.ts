/**
 * Health Connect service — Android wearable data source.
 *
 * Bridges the Android Health Connect SDK (which aggregates Samsung
 * Health, Fitbit, Garmin Connect, Whoop, Polar Flow, Strava, etc.)
 * into MyRX. Every Android wearable that has a Samsung-style HC
 * sync writes through this single funnel, so this is the only
 * integration module we need for the entire Android wearable
 * ecosystem. iOS HealthKit is a separate module (deferred).
 *
 * The shape of this module:
 *
 *   - All exported functions are async, all return safe defaults on
 *     iOS (no-op / empty list / null status) so the rest of the app
 *     can call them unconditionally without platform checks at every
 *     call site.
 *
 *   - `availability()` is the single source of truth for "is this
 *     usable right now." Returns one of:
 *       'unavailable'        — wrong OS or device too old (Android < 9)
 *       'provider-required'  — user needs to install/update Health Connect
 *       'available'          — SDK is ready, can request permissions
 *
 *   - Read-only for v1 (no insertRecords). Bidirectional sync (write
 *     MyRX efforts back to HC so they appear in Samsung Health /
 *     Fitbit / etc.) is v2.
 *
 *   - Permissions are declared in AndroidManifest.xml via the
 *     `plugins/withHealthConnectPermissions.js` config plugin. The
 *     runtime SDK requests THE SUBSET we list in PERMISSIONS_TO_REQUEST
 *     below — the user grants per-data-type in Health Connect's
 *     system UI.
 *
 * See https://developer.android.com/health-connect/develop for the
 * underlying SDK reference and CLAUDE.md for the integration spec.
 */

import { Platform } from 'react-native'

// react-native-health-connect is Android-only — importing on iOS will
// throw at runtime because there's no native module. We import lazily
// inside each function so iOS doesn't blow up on module load.
type HCModule = typeof import('react-native-health-connect')

let _hcModuleCache: HCModule | null = null
function getHC(): HCModule | null {
  if (Platform.OS !== 'android') return null
  if (_hcModuleCache) return _hcModuleCache
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _hcModuleCache = require('react-native-health-connect')
    return _hcModuleCache
  } catch {
    // Native module isn't installed in the current APK (e.g. user is
    // on an old build of the dev client). Treat as iOS — no-op.
    return null
  }
}

// SdkAvailabilityStatus from constants.ts:
//   1 = SDK_UNAVAILABLE
//   2 = SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
//   3 = SDK_AVAILABLE
const SDK_AVAILABLE = 3
const SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED = 2

export type HealthConnectAvailability =
  | 'unavailable'
  | 'provider-required'
  | 'available'

/**
 * Check whether Health Connect is usable on this device.
 *
 *   - On iOS, always 'unavailable' (use HealthKit instead — not yet
 *     wired).
 *   - On Android 9+, returns 'available' if Health Connect is
 *     installed and ready. Returns 'provider-required' if the system
 *     prompts the user to install/update Health Connect first.
 */
export async function availability(): Promise<HealthConnectAvailability> {
  const hc = getHC()
  if (!hc) return 'unavailable'
  try {
    const status = await hc.getSdkStatus()
    if (status === SDK_AVAILABLE) return 'available'
    if (status === SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'provider-required'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Initialize the SDK. Must be called before any permission /
 * read API. Safe to call multiple times — it's a no-op after first
 * success. Returns true on success.
 */
export async function initialize(): Promise<boolean> {
  const hc = getHC()
  if (!hc) return false
  try {
    return await hc.initialize()
  } catch {
    return false
  }
}

// The set of read permissions MyRX wants. The native manifest declares
// all of these in `plugins/withHealthConnectPermissions.js`; the user
// grants per-type at runtime through Health Connect's system UI, and
// can revoke any of them later.
//
// v1 focus: workouts + heart rate (what powers the cardio coaching
// surface). Steps/distance/calories/weight come along for the ride
// because requesting them upfront means we don't have to re-prompt
// later when those features ship.
const PERMISSIONS_TO_REQUEST = [
  { accessType: 'read' as const, recordType: 'ExerciseSession' as const },
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'Distance' as const },
  { accessType: 'read' as const, recordType: 'TotalCaloriesBurned' as const },
  { accessType: 'read' as const, recordType: 'Weight' as const },
]

/**
 * Request the standard MyRX permission set. Opens the Health Connect
 * system UI where the user grants per-data-type. Returns the list of
 * permissions ACTUALLY GRANTED (which may be a subset of what we
 * asked for, or empty if the user said no to everything).
 */
export async function requestPermissions(): Promise<string[]> {
  const hc = getHC()
  if (!hc) return []
  try {
    await hc.initialize()
    const granted = await hc.requestPermission(PERMISSIONS_TO_REQUEST as any)
    // Returned permissions have shape { accessType, recordType }; convert
    // to a flat list of recordType strings for the caller (UI just
    // needs to know which data types we can read).
    return granted
      .map((p: any) => p?.recordType as string | undefined)
      .filter((s): s is string => !!s)
  } catch {
    return []
  }
}

/**
 * Return the list of CURRENTLY granted record types (e.g.
 * ['ExerciseSession', 'HeartRate']). Empty list = not connected.
 * Used by the ConnectTab to show the "Connected" / "Connect" state
 * without forcing the permission prompt.
 */
export async function grantedPermissions(): Promise<string[]> {
  const hc = getHC()
  if (!hc) return []
  try {
    await hc.initialize()
    const granted = await hc.getGrantedPermissions()
    return granted
      .map((p: any) => p?.recordType as string | undefined)
      .filter((s): s is string => !!s)
  } catch {
    return []
  }
}

/**
 * Revoke all previously granted Health Connect permissions for MyRX.
 * On Android 14+ the actual revocation happens on next app restart
 * (system limitation); we still wipe our last-sync timestamp
 * immediately so the UI flips back to "Connect".
 */
export async function disconnect(): Promise<void> {
  const hc = getHC()
  if (!hc) return
  try {
    await hc.revokeAllPermissions()
  } catch {
    /* ignore — best effort */
  }
}

// ── Data fetch helpers ──────────────────────────────────────────────────────
//
// All time-range filters use ISO-8601 strings (Health Connect SDK's
// preferred input). We default to "last 7 days" — that's a reasonable
// initial sync window, balances "show me my recent stuff" against
// "don't choke on multi-year history on first connect." Adjust the
// `daysBack` argument to widen / narrow.

function isoNDaysAgo(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toISOString()
}

function isoNow(): string {
  return new Date().toISOString()
}

export interface RecentWorkout {
  uuid:               string
  /** Sport / exercise type (numeric enum value — see ExerciseType in HC SDK). */
  exerciseType:       number
  /** Optional title set by the source app (e.g. "Morning Run"). */
  title:              string | null
  /** ISO timestamp. */
  startTime:          string
  /** ISO timestamp. */
  endTime:            string
  /** Total duration in seconds (computed from start/end). */
  durationSecs:       number
  /** Source app package name (e.g. "com.samsung.android.health") — handy for debugging. */
  sourcePackage:      string | null
}

/**
 * Pull recent workouts (ExerciseSession records) from Health Connect.
 * Returns an empty array on iOS / no permission / fetch error.
 *
 * Caller is responsible for mapping ExerciseSession → MyRX effort
 * (different sports get logged differently — running → cardio,
 * weight training → strength, etc.). v1 just returns the raw
 * records so the user can verify the plumbing works.
 */
export async function fetchRecentWorkouts(daysBack = 7): Promise<RecentWorkout[]> {
  const hc = getHC()
  if (!hc) return []
  try {
    await hc.initialize()
    const result = await hc.readRecords('ExerciseSession', {
      timeRangeFilter: {
        operator: 'between',
        startTime: isoNDaysAgo(daysBack),
        endTime:   isoNow(),
      },
    })
    return (result.records || []).map((r: any) => {
      const startTime = r.startTime as string
      const endTime   = r.endTime as string
      const startMs   = new Date(startTime).getTime()
      const endMs     = new Date(endTime).getTime()
      return {
        uuid:          r.metadata?.id ?? '',
        exerciseType:  r.exerciseType ?? 0,
        title:         r.title ?? null,
        startTime,
        endTime,
        durationSecs:  Math.max(0, Math.round((endMs - startMs) / 1000)),
        sourcePackage: r.metadata?.dataOrigin ?? null,
      }
    })
  } catch {
    return []
  }
}

export interface RecentHeartRateSample {
  /** ISO timestamp. */
  time: string
  bpm:  number
}

/**
 * Pull individual heart-rate samples from Health Connect across the
 * requested window. Health Connect returns HR samples in "series"
 * (a single record can contain many timestamped samples), so we
 * flatten to a list of {time, bpm} for easy charting / aggregation.
 *
 * For a typical Samsung-watch wearer, expect dozens to hundreds of
 * samples per day. Don't fetch huge windows without paging.
 */
export async function fetchRecentHeartRate(daysBack = 7): Promise<RecentHeartRateSample[]> {
  const hc = getHC()
  if (!hc) return []
  try {
    await hc.initialize()
    const result = await hc.readRecords('HeartRate', {
      timeRangeFilter: {
        operator: 'between',
        startTime: isoNDaysAgo(daysBack),
        endTime:   isoNow(),
      },
    })
    const samples: RecentHeartRateSample[] = []
    for (const record of result.records || []) {
      const series = (record as any).samples || []
      for (const sample of series) {
        samples.push({
          time: sample.time as string,
          bpm:  sample.beatsPerMinute as number,
        })
      }
    }
    return samples
  } catch {
    return []
  }
}
