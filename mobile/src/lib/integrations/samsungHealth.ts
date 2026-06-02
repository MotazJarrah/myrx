/**
 * Samsung Health Data SDK — mobile-side service module.
 *
 * Unlike Strava / Polar (OAuth via the workers/oauth/ worker), Samsung Health
 * is a native Android SDK that talks to the Samsung Health app on the device
 * over local IPC. There's no token to encrypt, no callback URL, no worker
 * round-trip — `connect()` triggers Samsung Health's consent UI directly via
 * the native module.
 *
 * The user_integrations row for `samsung_health` is bookkeeping ONLY (last
 * sync time, granted-scope tracking, status); the actual permission grant
 * lives in Samsung Health itself. If the user revokes via Samsung Health's
 * "Connected services" screen, our row goes stale — `getStatus()` re-queries
 * the native module on every call so we never present a false positive.
 *
 *   Connection flow:                Sync flow (Sync now / on-launch):
 *
 *   ┌──────────────────────┐         ┌──────────────────────────────┐
 *   │ requestConnect()     │         │ syncRecent(daysBack)         │
 *   ├──────────────────────┤         ├──────────────────────────────┤
 *   │ • native.isAvailable │         │ • native.readHeartRate(...)  │
 *   │ • native.requestPerms│         │ • native.readSteps(...)      │
 *   │ • upsert user_integ. │         │ • native.readWorkouts(...)   │
 *   │   row (status=active)│         │ • upsert into hr/step/workout│
 *   └──────────────────────┘         │ • update last_synced_at      │
 *                                    └──────────────────────────────┘
 */

import { NativeModules, Platform } from 'react-native'
import { supabase } from '../supabase'

type Bpm  = number
type Steps = number

// ── Native module typing ──────────────────────────────────────────────────

interface SamsungHealthNativeModule {
  isAvailable(): Promise<{ available: boolean; reason?: string; message?: string }>
  getPermissionStatus(): Promise<PermissionStatus>
  requestPermissions(): Promise<PermissionStatus>
  readHeartRate(startMs: number, endMs: number): Promise<NativeHeartRateSample[]>
  readSteps(startMs: number, endMs: number): Promise<NativeStepSample[]>
  readWorkouts(startMs: number, endMs: number): Promise<NativeWorkout[]>
  readSleep(startMs: number, endMs: number): Promise<NativeSleepSession[]>
}

export type PermissionStatus = {
  heartRate:       boolean
  steps:           boolean
  exercise:        boolean
  // Sleep added May 31 2026 (Sleep page Phase 3). Native module now
  // requests DataTypes.SLEEP alongside the other 4. Older APK builds
  // that don't yet have the rebuilt native module will return false
  // here, which the UI treats as "sleep not granted" gracefully.
  sleep:           boolean
  bodyComposition: boolean
}

type NativeHeartRateSample = {
  measuredAt:      string  // ISO8601 — window start
  endAt:           string | null  // ISO8601 — window end (null if Samsung didn't supply one)
  bpm:             Bpm
  minBpm:          number | null  // null if Samsung didn't expose a range for this point
  maxBpm:          number | null
  sourceRecordId:  string
  deviceUuid:      string
  packageName:     string
}

type NativeStepSample = {
  startAt:         string
  endAt:           string
  steps:           Steps
  sourceRecordId:  string
  packageName:     string
}

type NativeSleepStage = {
  type:    'awake' | 'light' | 'rem' | 'deep'
  startAt: string  // ISO8601
  endAt:   string  // ISO8601
}

type NativeSleepSession = {
  sourceRecordId: string
  packageName:    string
  startAt:        string
  endAt:          string | null
  durationS:      number
  scoreNative:    number | null  // Samsung's own 0-100 score; not surfaced in UI
  stages:         NativeSleepStage[]  // empty array for phone-only sessions
}

type NativeWorkout = {
  sourceRecordId:  string
  packageName:     string
  exerciseType:    string         // PredefinedExerciseType enum name (e.g. 'RUNNING')
  customTitle:     string | null  // user's custom name for the workout, if any
  startAt:         string
  endAt:           string | null
  durationS:       number
  distanceM:       number | null
  caloriesKcal:    number | null
  avgBpm:          number | null
  maxBpm:          number | null
  minBpm:          number | null
  steps:           number | null
  /**
   * Per-second BPM readings during the workout, in order. Length ≈
   * durationS for Galaxy Watch (1 Hz sampling). Used by the Heart page's
   * time-in-zone bucketing. Empty when Samsung didn't supply a log.
   */
  hrLog:           number[]
}

// Cast once; SamsungHealth is null on iOS.
const native: SamsungHealthNativeModule | null =
  Platform.OS === 'android'
    ? (NativeModules.SamsungHealth as SamsungHealthNativeModule | undefined) ?? null
    : null

// ── Public types ──────────────────────────────────────────────────────────

export type Availability =
  | { available: true }
  | { available: false; reason: string; message?: string }

export type ConnectResult =
  | { status: 'ok'; granted: PermissionStatus }
  | { status: 'cancelled' }
  | { status: 'error'; reason: string }

export type ConnectionStatus = {
  connected:        boolean
  permissions:      PermissionStatus
  connectedAt:      string | null
  lastSyncedAt:     string | null
}

export type SyncSummary = {
  hrSamples:        number
  stepSamples:      number
  workouts:         number
  sleepSessions:    number
  sleepStages:      number
  rangeStart:       string
  rangeEnd:         string
  errors:           string[]
}

// ── Availability + permission status (cheap, callable on render) ─────────

/**
 * Resolves whether the Samsung Health Data SDK is reachable on this device.
 * iOS resolves `{ available: false, reason: 'unsupported_platform' }` so
 * callers don't need to platform-check before calling.
 */
export async function availability(): Promise<Availability> {
  if (!native) return { available: false, reason: 'unsupported_platform' }
  try {
    const r = await native.isAvailable()
    if (r.available) return { available: true }
    return { available: false, reason: r.reason ?? 'error', message: r.message }
  } catch (e: unknown) {
    return { available: false, reason: 'error', message: errorMessage(e) }
  }
}

export async function permissionStatus(): Promise<PermissionStatus> {
  if (!native) return EMPTY_PERMISSIONS
  try {
    return await native.getPermissionStatus()
  } catch {
    return EMPTY_PERMISSIONS
  }
}

// ── Connect / disconnect ─────────────────────────────────────────────────

/**
 * Launches Samsung Health's consent UI and, if at least one permission is
 * granted, writes a `user_integrations` row marking the connection as active.
 *
 * Returns `cancelled` if the user dismissed without granting anything.
 */
export async function requestConnect(): Promise<ConnectResult> {
  if (!native) {
    return { status: 'error', reason: 'unsupported_platform' }
  }

  let granted: PermissionStatus
  try {
    granted = await native.requestPermissions()
  } catch (e: unknown) {
    return { status: 'error', reason: errorMessage(e) }
  }

  if (!hasAnyPermission(granted)) {
    return { status: 'cancelled' }
  }

  // Persist the connection. Tokens are N/A for Samsung — the grant lives on
  // the device side. We still write a row so the UI has somewhere to read
  // last_synced_at + status from.
  const grantedScopes = Object.entries(granted)
    .filter(([, v]) => v)
    .map(([k]) => k)

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return { status: 'error', reason: 'not_signed_in' }

  const { error } = await supabase
    .from('user_integrations')
    .upsert(
      {
        user_id:        userId,
        platform:       'samsung_health',
        scopes:         grantedScopes,
        status:         'active',
        connected_at:   new Date().toISOString(),
        access_token:   null,
        refresh_token:  null,
        expires_at:     null,
      },
      { onConflict: 'user_id,platform' },
    )

  if (error) return { status: 'error', reason: `db: ${error.message}` }
  return { status: 'ok', granted }
}

export async function getStatus(): Promise<ConnectionStatus> {
  const permissions = await permissionStatus()

  const { data: row } = await supabase
    .from('user_integrations')
    .select('connected_at, last_synced_at, status')
    .eq('platform', 'samsung_health')
    .maybeSingle()

  const connected = hasAnyPermission(permissions) && row?.status === 'active'

  return {
    connected,
    permissions,
    connectedAt:  row?.connected_at ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
  }
}

/**
 * Best-effort disconnect: deletes the user_integrations row so the UI shows
 * disconnected. Samsung Health itself can't be revoked from outside the
 * Samsung Health app — we leave a hint in the resolved value so callers can
 * present a "Also revoke in Samsung Health → Connected services" tip.
 */
export async function disconnect(): Promise<{ status: 'ok'; tipRevokeInSamsungHealth: true } | { status: 'error'; reason: string }> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return { status: 'error', reason: 'not_signed_in' }

  const { error } = await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('platform', 'samsung_health')

  if (error) return { status: 'error', reason: `db: ${error.message}` }
  return { status: 'ok', tipRevokeInSamsungHealth: true }
}

// ── Sync ──────────────────────────────────────────────────────────────────

/**
 * Pulls the last `daysBack` of HR + steps + workouts from Samsung Health
 * and upserts into hr_samples / step_samples / wearable_workouts.
 *
 * Idempotent — re-running over the same window only inserts new rows
 * (the unique constraint on (user_id, source, source_record_id) drops
 * duplicates). Default daysBack is 7; the user can chain syncs to backfill
 * further if needed.
 */
export async function syncRecent(daysBack: number = 7): Promise<SyncSummary> {
  if (!native) {
    return {
      hrSamples:     0,
      stepSamples:   0,
      workouts:      0,
      sleepSessions: 0,
      sleepStages:   0,
      rangeStart:    new Date().toISOString(),
      rangeEnd:      new Date().toISOString(),
      errors:        ['unsupported_platform'],
    }
  }

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) {
    return blankSummary(daysBack, ['not_signed_in'])
  }

  // Cross-user bleed guard (May 30 2026, task #346).
  // The native Samsung Health SDK reads from the device's Samsung Health
  // app regardless of which Supabase user is signed in. If the user
  // signs in as a DIFFERENT account on the same phone (e.g. Test Client
  // on a device where the primary account granted Samsung Health), the
  // sync would otherwise attribute HR / steps / workouts to that other
  // user — polluting their dashboards with bleed-through data they
  // never authorized. Only sync when this user has explicitly granted
  // Samsung Health (their user_integrations row exists). When absent,
  // return early without touching any read or write path.
  const { data: integ, error: integErr } = await supabase
    .from('user_integrations')
    .select('user_id')
    .eq('user_id', userId)
    .eq('platform', 'samsung_health')
    .maybeSingle()
  if (integErr) {
    return blankSummary(daysBack, [`integration_check: ${errorMessage(integErr)}`])
  }
  if (!integ) {
    return blankSummary(daysBack, ['not_authorized_for_this_user'])
  }

  const endMs   = Date.now()
  const startMs = endMs - daysBack * 24 * 60 * 60 * 1000
  const startIso = new Date(startMs).toISOString()
  const endIso   = new Date(endMs).toISOString()

  const errors: string[] = []
  let hrCount     = 0
  let stepCount   = 0
  let woCount     = 0
  let sleepSessCount  = 0
  let sleepStageCount = 0

  // 1) Workouts FIRST so HR samples can be linked back to them by ts overlap.
  const workouts: NativeWorkout[] = await native
    .readWorkouts(startMs, endMs)
    .catch((e) => {
      errors.push(`workouts: ${errorMessage(e)}`)
      return [] as NativeWorkout[]
    })

  let workoutIdByRecord: Record<string, string> = {}
  if (workouts.length > 0) {
    const rows = workouts
      .filter((w) => w.sourceRecordId)
      .map((w) => ({
        user_id:          userId,
        source:           'samsung_health',
        source_record_id: w.sourceRecordId,
        exercise_type:    w.exerciseType || null,
        start_at:         w.startAt,
        end_at:           w.endAt,
        duration_s:       w.durationS || null,
        distance_m:       w.distanceM,
        calories_kcal:    w.caloriesKcal,
        avg_bpm:          w.avgBpm,
        max_bpm:          w.maxBpm,
        min_bpm:          w.minBpm,
        steps:            w.steps,
        raw_meta:         {
          package_name: w.packageName,
          custom_title: w.customTitle,
          // Per-second BPM log used by the Heart page to compute
          // time-in-zone breakdown. Stored as an integer array (small
          // payload — 1 KB per 20-min workout) inside raw_meta so we
          // don't need a separate table.
          hr_log:       w.hrLog,
        },
      }))

    if (rows.length > 0) {
      const { data, error } = await supabase
        .from('wearable_workouts')
        .upsert(rows, { onConflict: 'user_id,source,source_record_id' })
        .select('id, source_record_id')
      if (error) {
        errors.push(`workouts_upsert: ${error.message}`)
      } else {
        woCount = data?.length ?? rows.length
        for (const row of data ?? []) {
          if (row.source_record_id) workoutIdByRecord[row.source_record_id] = row.id
        }
      }
    }
  }

  // 2) Heart rate samples. Galaxy Watch continuous mode can be 10k+ samples
  //    over 7 days — chunk into 1000-row batches.
  const hr: NativeHeartRateSample[] = await native
    .readHeartRate(startMs, endMs)
    .catch((e) => {
      errors.push(`hr: ${errorMessage(e)}`)
      return [] as NativeHeartRateSample[]
    })

  if (hr.length > 0) {
    const hrRows = hr
      .filter((s) => s.sourceRecordId && s.bpm > 20 && s.bpm < 250)
      .map((s) => ({
        user_id:          userId,
        source:           'samsung_health',
        source_record_id: s.sourceRecordId,
        measured_at:      s.measuredAt,
        bpm:              Math.round(s.bpm),
        context:          'auto' as const,
        workout_id:       findOverlappingWorkout(s.measuredAt, workouts, workoutIdByRecord),
        raw_meta:         {
          device_uuid:  s.deviceUuid,
          package_name: s.packageName,
          end_at:       s.endAt,
          min_bpm:      s.minBpm,
          max_bpm:      s.maxBpm,
        },
      }))
    hrCount += await chunkedUpsert(
      'hr_samples',
      hrRows,
      'user_id,source,source_record_id',
      errors,
    )
  }

  // 3) Step samples.
  const steps: NativeStepSample[] = await native
    .readSteps(startMs, endMs)
    .catch((e) => {
      errors.push(`steps: ${errorMessage(e)}`)
      return [] as NativeStepSample[]
    })

  if (steps.length > 0) {
    const stepRows = steps
      .filter((s) => s.sourceRecordId && s.steps >= 0 && s.steps < 100000)
      .map((s) => ({
        user_id:          userId,
        source:           'samsung_health',
        source_record_id: s.sourceRecordId,
        start_at:         s.startAt,
        end_at:           s.endAt,
        steps:            s.steps,
        raw_meta:         { package_name: s.packageName },
      }))
    stepCount += await chunkedUpsert(
      'step_samples',
      stepRows,
      'user_id,source,source_record_id',
      errors,
    )
  }

  // 4) Sleep sessions + stages — extracted to syncSleepRange() (below) so the
  //    Sleep page can run a sleep-only sync over a wider 30-night window.
  {
    const r = await syncSleepRange(userId, startMs, endMs, errors)
    sleepSessCount  = r.sessions
    sleepStageCount = r.stages
  }

  // 5) Update last_synced_at unconditionally so the UI shows progress even on partial failure.
  await supabase
    .from('user_integrations')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('platform', 'samsung_health')

  return {
    hrSamples:     hrCount,
    stepSamples:   stepCount,
    workouts:      woCount,
    sleepSessions: sleepSessCount,
    sleepStages:   sleepStageCount,
    rangeStart:    startIso,
    rangeEnd:      endIso,
    errors,
  }
}

/**
 * Shared sleep read + upsert. Reads sleep sessions (and stages, when a watch
 * supplied them) over [startMs, endMs] and upserts into sleep_sessions /
 * sleep_stages. Idempotent. Used by both syncRecent and syncSleepRecent.
 *
 * Phone-only sessions (Samsung's accelerometer detection without a watch)
 * arrive with stages: [] — we still write the parent session so the user
 * gets Total / Schedule / Consistency; the UI shows an empty-state for
 * Deep/REM when stages are missing. Defensive against older APKs whose
 * native module lacks readSleep (skips cleanly).
 */
async function syncSleepRange(
  userId: string,
  startMs: number,
  endMs: number,
  errors: string[],
): Promise<{ sessions: number; stages: number }> {
  if (!native || typeof (native as any).readSleep !== 'function') {
    return { sessions: 0, stages: 0 }
  }

  let sleepSessCount  = 0
  let sleepStageCount = 0

  const sleep: NativeSleepSession[] = await native
    .readSleep(startMs, endMs)
    .catch((e) => {
      errors.push(`sleep: ${errorMessage(e)}`)
      return [] as NativeSleepSession[]
    })

  if (sleep.length > 0) {
    const sessionRows = sleep
      .filter((s) => s.sourceRecordId && s.startAt && s.endAt && s.durationS > 0)
      .map((s) => {
        // Aggregate per-stage seconds for the session-level summary
        let awakeS = 0, lightS = 0, remS = 0, deepS = 0
        let anyStage = false
        for (const st of s.stages) {
          anyStage = true
          const start = Date.parse(st.startAt)
          const end   = Date.parse(st.endAt)
          const dur   = Number.isFinite(start) && Number.isFinite(end)
            ? Math.max(0, Math.floor((end - start) / 1000))
            : 0
          if (st.type === 'awake') awakeS += dur
          else if (st.type === 'light') lightS += dur
          else if (st.type === 'rem')   remS   += dur
          else if (st.type === 'deep')  deepS  += dur
        }
        return {
          user_id:          userId,
          source:           'samsung_health',
          source_record_id: s.sourceRecordId,
          start_at:         s.startAt,
          end_at:           s.endAt,
          duration_s:       s.durationS,
          efficiency_pct:   null,  // Samsung's SDK doesn't expose efficiency stably
          awake_s:          anyStage ? awakeS : null,
          light_s:          anyStage ? lightS : null,
          rem_s:            anyStage ? remS   : null,
          deep_s:           anyStage ? deepS  : null,
          score_samsung:    s.scoreNative,
          raw_meta:         { package_name: s.packageName },
        }
      })

    if (sessionRows.length > 0) {
      const { data: insertedSessions, error: sessErr } = await supabase
        .from('sleep_sessions')
        .upsert(sessionRows, { onConflict: 'user_id,source,source_record_id' })
        .select('id, source_record_id')
      if (sessErr) {
        errors.push(`sleep_sessions_upsert: ${sessErr.message}`)
      } else {
        sleepSessCount = insertedSessions?.length ?? sessionRows.length

        const sessIdByRecord: Record<string, string> = {}
        for (const row of insertedSessions ?? []) {
          if (row.source_record_id) sessIdByRecord[row.source_record_id] = row.id
        }

        // Delete-then-insert stages keyed on session_id (stages have no
        // (source, source_record_id) of their own — parent id is the key).
        const sessIds = Object.values(sessIdByRecord)
        if (sessIds.length > 0) {
          await supabase.from('sleep_stages').delete().in('session_id', sessIds)
        }

        const stageRows: Array<Record<string, unknown>> = []
        for (const s of sleep) {
          const sessionId = sessIdByRecord[s.sourceRecordId]
          if (!sessionId) continue
          for (const st of s.stages) {
            const start = Date.parse(st.startAt)
            const end   = Date.parse(st.endAt)
            if (!Number.isFinite(start) || !Number.isFinite(end)) continue
            const dur = Math.max(0, Math.floor((end - start) / 1000))
            if (dur <= 0) continue
            stageRows.push({
              session_id: sessionId,
              stage:      st.type,
              start_at:   st.startAt,
              end_at:     st.endAt,
              duration_s: dur,
            })
          }
        }
        if (stageRows.length > 0) {
          sleepStageCount = await chunkedUpsert(
            'sleep_stages',
            stageRows,
            'session_id,start_at',  // no formal unique constraint; OK — we deleted first
            errors,
          )
        }
      }
    }
  }

  return { sessions: sleepSessCount, stages: sleepStageCount }
}

/**
 * Sleep-only sync over a wider window (default 30 days). The Sleep page's
 * Consistency chart spans 30 nights, so it needs a deeper backfill than
 * Heart's 7-day window — but it doesn't need the heavy HR / steps / workouts
 * pull, so this reads sleep alone. Mirrors syncRecent's auth + bleed guard.
 */
export async function syncSleepRecent(daysBack: number = 30): Promise<SyncSummary> {
  if (!native) return blankSummary(daysBack, ['unsupported_platform'])

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return blankSummary(daysBack, ['not_signed_in'])

  const { data: integ, error: integErr } = await supabase
    .from('user_integrations')
    .select('user_id')
    .eq('user_id', userId)
    .eq('platform', 'samsung_health')
    .maybeSingle()
  if (integErr) return blankSummary(daysBack, [`integration_check: ${errorMessage(integErr)}`])
  if (!integ)   return blankSummary(daysBack, ['not_authorized_for_this_user'])

  const endMs   = Date.now()
  const startMs = endMs - daysBack * 24 * 60 * 60 * 1000
  const errors: string[] = []
  const { sessions, stages } = await syncSleepRange(userId, startMs, endMs, errors)

  await supabase
    .from('user_integrations')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('platform', 'samsung_health')

  return {
    hrSamples:     0,
    stepSamples:   0,
    workouts:      0,
    sleepSessions: sessions,
    sleepStages:   stages,
    rangeStart:    new Date(startMs).toISOString(),
    rangeEnd:      new Date(endMs).toISOString(),
    errors,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

const EMPTY_PERMISSIONS: PermissionStatus = {
  heartRate:       false,
  steps:           false,
  exercise:        false,
  sleep:           false,
  bodyComposition: false,
}

function hasAnyPermission(p: PermissionStatus): boolean {
  return p.heartRate || p.steps || p.exercise || p.sleep || p.bodyComposition
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function blankSummary(daysBack: number, errors: string[]): SyncSummary {
  const endMs   = Date.now()
  const startMs = endMs - daysBack * 24 * 60 * 60 * 1000
  return {
    hrSamples:     0,
    stepSamples:   0,
    workouts:      0,
    sleepSessions: 0,
    sleepStages:   0,
    rangeStart:    new Date(startMs).toISOString(),
    rangeEnd:      new Date(endMs).toISOString(),
    errors,
  }
}

/**
 * Supabase REST limits bulk inserts; large arrays are split into 1000-row
 * batches. Returns the cumulative successful-insert count.
 */
async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  errors: string[],
): Promise<number> {
  const CHUNK = 1000
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from(table)
      .upsert(slice, { onConflict, ignoreDuplicates: true })
      .select('id')
    if (error) {
      errors.push(`${table}_upsert: ${error.message}`)
    } else {
      inserted += data?.length ?? 0
    }
  }
  return inserted
}

/**
 * If an HR sample's timestamp falls inside a workout interval, return that
 * workout's row id so the sample is tagged. Otherwise return null.
 *
 * O(samples * workouts). For 7-day windows workouts are typically <20, so
 * this stays cheap — no need to build an interval tree.
 */
function findOverlappingWorkout(
  measuredAt: string,
  workouts: NativeWorkout[],
  idByRecord: Record<string, string>,
): string | null {
  const t = Date.parse(measuredAt)
  if (!Number.isFinite(t)) return null
  for (const w of workouts) {
    const start = Date.parse(w.startAt)
    const end   = w.endAt ? Date.parse(w.endAt) : start + w.durationS * 1000
    if (Number.isFinite(start) && Number.isFinite(end) && t >= start && t <= end) {
      const id = idByRecord[w.sourceRecordId]
      if (id) return id
    }
  }
  return null
}
