/**
 * Heart — daily HR + steps + workouts dashboard.
 *
 * Data source: Samsung Health Data SDK via the integration at
 * `mobile/src/lib/integrations/samsungHealth.ts`. Reads three Supabase tables:
 *
 *   • hr_samples         per-window HR readings (Samsung's ambient cadence ≈
 *                        hourly outside workouts; tighter during sessions)
 *   • step_samples       hourly step buckets (Samsung's STEPS data type is
 *                        aggregate-only — see the Kotlin module's `readSteps`)
 *   • wearable_workouts  one row per workout with pre-summarised avg/max/min HR
 *
 * Sync model: opening this tab triggers a foreground `samsungSyncRecent(1)`
 * via `useFocusEffect` so today's numbers are at most ~60 s stale (the
 * Samsung Health app on the phone polls the watch in near-real-time). Pull-
 * to-refresh re-runs a 7-day sync for backfill.
 *
 * Resting-HR definition (LOCKED): the lowest BPM reading on a given day among
 * samples NOT inside any logged workout. With ambient HR cadence around an
 * hour, this is a reasonable proxy for "lowest sustained reading during
 * inactive periods" until v2 unlocks dense SERIES_DATA from the SDK.
 *
 * Window default: last 7 days for charts + summary. Today's snapshot uses
 * today only (00:00 local → now).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Heart, Activity, TrendingUp, Footprints, RefreshCw } from 'lucide-react-native'

import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import AnimateRise from '../../src/components/AnimateRise'
import TickerNumber from '../../src/components/TickerNumber'
import HrRangeChart, { type HrDayPoint } from '../../src/components/HrRangeChart'
import RestingHrIndicator, {
  bandsForUser, classifyResting, type RestingBand,
} from '../../src/components/RestingHrIndicator'
import {
  syncRecent as samsungSyncRecent,
  getStatus  as samsungGetStatus,
  type ConnectionStatus as SamsungStatus,
} from '../../src/lib/integrations/samsungHealth'
import { formatLastSync } from '../../src/lib/lastSyncStorage'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha } from '../../src/theme'

// ── DB row shapes ────────────────────────────────────────────────────────────

interface HrSampleRow {
  id:           string
  measured_at:  string
  bpm:          number
  workout_id:   string | null
}

interface StepSampleRow {
  id:        string
  start_at:  string
  end_at:    string
  steps:     number
}

interface WorkoutRow {
  id:                string
  exercise_type:     string | null
  start_at:          string
  end_at:            string | null
  duration_s:        number | null
  distance_m:        number | null
  calories_kcal:     number | null
  avg_bpm:           number | null
  max_bpm:           number | null
  min_bpm:           number | null
  steps:             number | null
  // raw_meta JSON column. Pulled selectively so we can access hr_log
  // (per-second BPM readings) for time-in-zone computation in the chart.
  raw_meta:          { hr_log?: number[] } | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function nDaysAgoIso(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (n - 1))
  return d.toISOString()
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  if (r === 0) return `${m} min`
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtDistanceM(m: number | null | undefined): string {
  if (m == null || m === 0) return ''
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

function titleCase(s: string | null | undefined): string {
  if (!s) return 'Workout'
  return s.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Compact day label for the daily history rows. "Thu 5/22" — short
 * weekday + month/day, all on one line. Avoids the long "May" word
 * that would push the numeric columns off-screen on narrow phones.
 */
function fmtHistoryDate(ymd: string): string {
  // Anchor at noon so timezone DST shifts don't accidentally bump the
  // displayed day by one.
  const date = new Date(`${ymd}T12:00:00`)
  const dow  = date.toLocaleDateString('en-US', { weekday: 'short' })
  const md   = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  return `${dow} ${md}`
}

/**
 * Returns the HR training-zone colour for a BPM value — the same palette
 * the chart bands use. Used everywhere we show a numeric HR value on the
 * Heart page (stat highlight cards + every column in the daily history)
 * so the page reads with ONE consistent colour story.
 *
 *   • bpm < 50% HRmax  → darker slate (below Z1, resting territory)
 *   • 50–60%           → slate         (Z1 — recovery)
 *   • 60–70%           → emerald       (Z2 — easy aerobic)
 *   • 70–80%           → amber         (Z3 — tempo)
 *   • 80–90%           → orange        (Z4 — threshold)
 *   • 90–100%          → red           (Z5 — VO2 max)
 */
function colorForBpm(bpm: number, hrMax: number): string {
  const pct = bpm / hrMax
  if (pct >= 0.90) return palette.red[400]
  if (pct >= 0.80) return palette.orange[400]
  if (pct >= 0.70) return palette.amber[400]
  if (pct >= 0.60) return palette.emerald[400]
  if (pct >= 0.50) return palette.slate[400]
  return palette.slate[500]
}

/**
 * Returns the user's current age from their stored birthdate, or null if
 * birthdate is missing/invalid.
 */
function estimateAge(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  if (age < 10 || age > 100) return null
  return age
}

/**
 * Estimate HRmax from profile birthdate using the standard `220 − age` rule.
 * Falls back to 180 (≈ 40-year-old) if the profile has no birthdate yet —
 * users can refine later by setting their birthdate in Profile → Settings.
 */
function estimateHrMax(birthdate: string | null | undefined): number {
  if (!birthdate) return 180
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return 180
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  if (age < 10 || age > 100) return 180
  return 220 - age
}

// ── Derived stats ────────────────────────────────────────────────────────────

interface DailySummary {
  day:           string      // YYYY-MM-DD
  avg:           number | null
  min:           number | null
  max:           number | null
  resting:       number | null    // lowest non-workout sample
  samples:       number
  /**
   * The vertical extent of the chart band for this day. Covers the day's
   * FULL HR range — union of ambient HR samples + workout HR aggregates.
   * Null only when the day has NO HR data of any kind. Renamed from the
   * older "peakRange*" names but kept on the same field for backwards
   * compatibility with the chart prop names.
   */
  peakRangeLow:  number | null
  peakRangeHigh: number | null
  workoutCount:  number
  /**
   * Sample-count per zone summed across BOTH ambient HR samples and all
   * of the day's workout per-second logs. Ambient samples are sparse
   * (~1/min from the watch when not in workout); workout logs are dense
   * (~1/sec). The naive sum biases workouts in the gradient, which is
   * desirable — workouts represent the HR-intensive part of the day.
   */
  timeInZone:    { z1: number; z2: number; z3: number; z4: number; z5: number; belowZ1: number } | null
}

type ZoneBuckets = { z1: number; z2: number; z3: number; z4: number; z5: number; belowZ1: number }

/**
 * Classifies a single BPM into a zone and adds `weight` to that bucket.
 * Mutates `buckets` in place. Used by both the per-sample bucketer and
 * the aggregate approximator.
 */
function addToZone(buckets: ZoneBuckets, bpm: number, hrMax: number, weight: number) {
  const z1Lo = hrMax * 0.50
  const z2Lo = hrMax * 0.60
  const z3Lo = hrMax * 0.70
  const z4Lo = hrMax * 0.80
  const z5Lo = hrMax * 0.90
  if      (bpm < z1Lo) buckets.belowZ1 += weight
  else if (bpm < z2Lo) buckets.z1      += weight
  else if (bpm < z3Lo) buckets.z2      += weight
  else if (bpm < z4Lo) buckets.z3      += weight
  else if (bpm < z5Lo) buckets.z4      += weight
  else                  buckets.z5      += weight
}

/** Buckets a per-second BPM array into the 5 HR zones. */
function bucketHrLog(hrLog: number[], hrMax: number): ZoneBuckets {
  const buckets: ZoneBuckets = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  for (const bpm of hrLog) addToZone(buckets, bpm, hrMax, 1)
  return buckets
}

/**
 * Approximate per-zone time from a workout's summary stats when no
 * per-second HR log is available (typical of phone-tracked workouts,
 * which only store the workout's min / avg / max / duration).
 *
 * Approach: distribute the workout's duration across three representative
 * BPM values (min, avg, max) with weights chosen so the synthetic log's
 * mean matches the reported avg:
 *
 *   w_avg = 0.50  (anchor — half of time at the average)
 *   w_min + w_max = 0.50
 *   solved so that the synthetic mean = avg
 *
 *     w_min = (max - avg) / (2 * (max - min))    clamped to [0, 0.5]
 *     w_max = 0.5 - w_min
 *
 * This gives the band a useful color tint (proportional to the actual
 * time the workout spent in each zone, to a first approximation) instead
 * of an all-slate band that hides the workout's intensity. Per-second
 * data (when available) is always preferred.
 */
function approximateZonesFromAggregates(
  minBpm: number,
  avgBpm: number,
  maxBpm: number,
  durationS: number,
  hrMax: number,
): ZoneBuckets {
  const buckets: ZoneBuckets = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  if (durationS <= 0) return buckets
  const range = maxBpm - minBpm
  if (range <= 0) {
    addToZone(buckets, avgBpm, hrMax, durationS)
    return buckets
  }
  const wMinRaw = (maxBpm - avgBpm) / (2 * range)
  const wMin = Math.max(0, Math.min(0.5, wMinRaw))
  const wMax = 0.5 - wMin
  addToZone(buckets, minBpm, hrMax, durationS * wMin)
  addToZone(buckets, avgBpm, hrMax, durationS * 0.5)
  addToZone(buckets, maxBpm, hrMax, durationS * wMax)
  return buckets
}

function summariseByDay(hrSamples: HrSampleRow[], workouts: WorkoutRow[], hrMax: number): DailySummary[] {
  const buckets = new Map<string, { hr: HrSampleRow[]; wo: WorkoutRow[] }>()

  // Seed with HR sample days
  for (const s of hrSamples) {
    const day = s.measured_at.slice(0, 10)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.hr.push(s)
    buckets.set(day, cell)
  }
  // Merge in workout days
  for (const w of workouts) {
    const day = w.start_at.slice(0, 10)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.wo.push(w)
    buckets.set(day, cell)
  }

  const out: DailySummary[] = []
  for (const [day, cell] of buckets.entries()) {
    const bpms       = cell.hr.map(r => r.bpm)
    const nonWorkout = cell.hr.filter(r => r.workout_id == null).map(r => r.bpm)

    const avg     = bpms.length       > 0 ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null
    const min     = bpms.length       > 0 ? Math.min(...bpms) : null
    const max     = bpms.length       > 0 ? Math.max(...bpms) : null
    const resting = nonWorkout.length > 0 ? Math.min(...nonWorkout)
                  : min

    // Band range — anchored at the Z1 lower bound (50% HRmax) so the
    // band represents "training zone time" only. Anything below Z1 is
    // resting territory and surfaces via the green resting dot, not the
    // band. The band's top is the highest HR the day reached (ambient
    // samples + workout max). If the day never crossed into Z1, no
    // band is drawn at all (both fields stay null).
    const z1Lo         = hrMax * 0.50
    const workoutHighs = cell.wo.map(w => w.max_bpm).filter((v): v is number => v != null && v > 0)
    const allHighs     = [max, ...workoutHighs].filter((v): v is number => v != null)
    const dayMaxHr     = allHighs.length > 0 ? Math.max(...allHighs) : null
    const peakRangeHigh = dayMaxHr != null && dayMaxHr >= z1Lo ? dayMaxHr     : null
    const peakRangeLow  = peakRangeHigh != null               ? Math.round(z1Lo) : null

    // Time-in-zone — sum sample counts across BOTH ambient HR samples
    // AND each workout's per-second log. Workouts produce hundreds of
    // samples per session (1 Hz); ambient is ~1 sample/min so it
    // contributes mostly to the resting/Z1 buckets. The combined
    // bucketing means non-workout days STILL get a gradient (just
    // dominated by slate Z1) instead of falling back to the Y-position
    // gradient.
    let totalZones: { z1: number; z2: number; z3: number; z4: number; z5: number; belowZ1: number } | null = null
    function ensureBuckets() {
      if (totalZones == null) totalZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, belowZ1: 0 }
      return totalZones
    }
    function addBuckets(b: { z1: number; z2: number; z3: number; z4: number; z5: number; belowZ1: number }) {
      const t = ensureBuckets()
      t.z1      += b.z1
      t.z2      += b.z2
      t.z3      += b.z3
      t.z4      += b.z4
      t.z5      += b.z5
      t.belowZ1 += b.belowZ1
    }
    // Workout zones — prefer per-second hr_log when present; fall back
    // to the avg/min/max approximator when Samsung didn't provide one
    // (e.g. phone-tracked workouts without continuous HR sampling).
    for (const w of cell.wo) {
      const log = w.raw_meta?.hr_log
      if (Array.isArray(log) && log.length > 0) {
        addBuckets(bucketHrLog(log, hrMax))
      } else if (
        w.min_bpm    != null && w.min_bpm > 0 &&
        w.avg_bpm    != null && w.avg_bpm > 0 &&
        w.max_bpm    != null && w.max_bpm > 0 &&
        w.duration_s != null && w.duration_s > 0
      ) {
        addBuckets(approximateZonesFromAggregates(
          w.min_bpm, w.avg_bpm, w.max_bpm, w.duration_s, hrMax,
        ))
      }
    }
    // Ambient HR samples (sparse — give non-workout days their gradient)
    if (cell.hr.length > 0) {
      addBuckets(bucketHrLog(cell.hr.map(r => r.bpm), hrMax))
    }

    out.push({
      day,
      avg,
      min,
      max,
      resting,
      samples:       bpms.length,
      peakRangeLow,
      peakRangeHigh,
      workoutCount:  cell.wo.length,
      timeInZone:    totalZones,
    })
  }
  out.sort((a, b) => (a.day < b.day ? -1 : 1))
  return out
}

function todayStepsTotal(stepRows: StepSampleRow[]): number {
  const cutoff = startOfTodayIso()
  return stepRows
    .filter(r => r.start_at >= cutoff)
    .reduce((sum, r) => sum + r.steps, 0)
}

function latestHr(hrSamples: HrSampleRow[]): number | null {
  if (hrSamples.length === 0) return null
  return hrSamples[hrSamples.length - 1].bpm
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HeartPage() {
  const { profile } = useAuth()

  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncBusy,   setSyncBusy]   = useState(false)
  const [samsung,    setSamsung]    = useState<SamsungStatus | null>(null)

  const [hrSamples,  setHrSamples]  = useState<HrSampleRow[]>([])
  const [stepRows,   setStepRows]   = useState<StepSampleRow[]>([])
  const [workouts,   setWorkouts]   = useState<WorkoutRow[]>([])

  // Chart tooltip dismiss-on-tap-outside is now handled globally by the
  // ChartTooltipProvider in (app)/_layout.tsx — every tap anywhere on this
  // page that isn't on the chart's interactive band area will dismiss the
  // pinned tooltip automatically. No per-card plumbing needed.

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!profile?.id) return
    const since = nDaysAgoIso(7)
    const [hrRes, stepRes, woRes, statusRes] = await Promise.all([
      supabase
        .from('hr_samples')
        .select('id, measured_at, bpm, workout_id')
        .eq('user_id', profile.id)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true }),
      supabase
        .from('step_samples')
        .select('id, start_at, end_at, steps')
        .eq('user_id', profile.id)
        .gte('start_at', since)
        .order('start_at', { ascending: true }),
      supabase
        .from('wearable_workouts')
        .select('id, exercise_type, start_at, end_at, duration_s, distance_m, calories_kcal, avg_bpm, max_bpm, min_bpm, steps, raw_meta')
        .eq('user_id', profile.id)
        .gte('start_at', since)
        .order('start_at', { ascending: false }),
      samsungGetStatus(),
    ])
    if (!hrRes.error)   setHrSamples(hrRes.data ?? [])
    if (!stepRes.error) setStepRows(stepRes.data ?? [])
    if (!woRes.error)   setWorkouts(woRes.data ?? [])
    setSamsung(statusRes)
  }, [profile?.id])

  // ── Sync-on-focus (the "real-time" lever) ─────────────────────────────────
  // Re-fetches DB rows every time the tab is opened, and ALSO kicks off a
  // 1-day Samsung sync in the background. The Samsung sync upserts new rows
  // then we re-fetch once it returns, so within ~10 s of opening this tab
  // the numbers reflect what's on the watch right now.

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        setLoading(true)
        await fetchData()
        if (cancelled) return
        setLoading(false)
        // Foreground sync of today's data. Don't block the initial render —
        // if it surfaces new rows we re-fetch and the page reactively updates.
        try {
          const summary = await samsungSyncRecent(1)
          if (cancelled) return
          if (summary.hrSamples > 0 || summary.stepSamples > 0 || summary.workouts > 0) {
            await fetchData()
          }
        } catch { /* swallow — non-fatal */ }
      })()
      return () => { cancelled = true }
    }, [fetchData]),
  )

  // ── Pull-to-refresh — runs the 7-day backfill ─────────────────────────────
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await samsungSyncRecent(7)
      await fetchData()
    } finally {
      setRefreshing(false)
    }
  }, [fetchData])

  // ── Manual "Sync now" button (mirrors the Connect tab's pattern) ──────────
  const onManualSync = useCallback(async () => {
    if (syncBusy) return
    setSyncBusy(true)
    try {
      await samsungSyncRecent(1)
      await fetchData()
    } finally {
      setSyncBusy(false)
    }
  }, [fetchData, syncBusy])

  // ── Derived ───────────────────────────────────────────────────────────────

  // HRmax drives the zone colour boundaries in the chart band gradient.
  // Computed BEFORE `daily` because `summariseByDay` now buckets HR logs
  // into zones using it.
  const hrMax = useMemo(() => estimateHrMax(profile?.birthdate), [profile?.birthdate])
  const daily = useMemo(() => summariseByDay(hrSamples, workouts, hrMax), [hrSamples, workouts, hrMax])
  const todaySummary = useMemo(() => {
    const today = startOfTodayIso().slice(0, 10)
    return daily.find(d => d.day === today) ?? null
  }, [daily])

  const todaySteps   = useMemo(() => todayStepsTotal(stepRows), [stepRows])
  const latestSample = useMemo(() => latestHr(hrSamples),       [hrSamples])

  // 7-day stats fall back to the whole week when there's no data for today
  const restingThisWeek = useMemo(() => {
    const restings = daily.map(d => d.resting).filter((v): v is number => v != null)
    return restings.length > 0 ? Math.min(...restings) : null
  }, [daily])

  const avgThisWeek = useMemo(() => {
    const avgs = daily.map(d => d.avg).filter((v): v is number => v != null)
    return avgs.length > 0 ? Math.round(avgs.reduce((s, v) => s + v, 0) / avgs.length) : null
  }, [daily])

  // Chart series — per-day resting dot + avg dot + workout-driven peak band
  const chartData = useMemo<HrDayPoint[]>(
    () => daily.map(d => ({
      day:           d.day,
      resting:       d.resting,
      avg:           d.avg,
      peakRangeLow:  d.peakRangeLow,
      peakRangeHigh: d.peakRangeHigh,
      workoutCount:  d.workoutCount,
      timeInZone:    d.timeInZone ?? undefined,
    })),
    [daily],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  const hasSamsung = samsung?.connected === true
  const lastSyncLabel = samsung?.lastSyncedAt ? formatLastSync(samsung.lastSyncedAt) : null

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={palette.red[400]} />
      }
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.h1}>Heart</Text>
        <Text style={s.h1Sub}>
          {hasSamsung
            ? `${restingThisWeek != null ? `Resting ${restingThisWeek} bpm` : 'No data yet'}${avgThisWeek != null ? `  ·  Avg ${avgThisWeek} bpm` : ''}`
            : 'Connect a wearable to start tracking'}
        </Text>
      </View>

      {/* Loading skeleton — placeholder cards while the initial Supabase
          fetch resolves on cold-start. Heights approximate the rendered
          surface: 2x2 stat tiles + resting HR indicator + HR range chart
          + history list. Only shown when there's no cached data yet. */}
      {loading && hrSamples.length === 0 && (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 110, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 110, flex: 1, borderRadius: 12 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 110, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 110, flex: 1, borderRadius: 12 }} />
          </View>
          <Skeleton style={{ height: 200, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 260, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 12 }} />
        </View>
      )}

      {/* Empty state — no Samsung connection */}
      {!loading && !hasSamsung && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.emptyTitle}>No wearable connected</Text>
          <Text style={s.emptyBody}>
            Connect Samsung Health (Settings → Connect tab) so MyRX can read heart rate, steps, and workouts from your Galaxy Watch / Fit / Ring.
          </Text>
        </AnimateRise>
      )}

      {/* Empty state — connected but no data */}
      {!loading && hasSamsung && hrSamples.length === 0 && stepRows.length === 0 && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.emptyTitle}>No data yet</Text>
          <Text style={s.emptyBody}>
            Wear your Galaxy Watch (or carry your phone for step tracking) and tap “Sync now” to pull in the latest readings.
          </Text>
          <Pressable onPress={onManualSync} disabled={syncBusy} style={[s.primaryBtn, syncBusy ? { opacity: 0.5 } : null]}>
            {syncBusy
              ? <ActivityIndicator size="small" color={colors.primaryForeground} />
              : <Text style={s.primaryBtnText}>Sync now</Text>}
          </Pressable>
        </AnimateRise>
      )}

      {/* ── Today's snapshot — four stat cards in a 2×2 grid ─────────────── */}
      {!loading && hasSamsung && (hrSamples.length > 0 || stepRows.length > 0) && (
        <AnimateRise delay={0}>
          <View style={s.statsGrid}>
            <StatCard
              icon={<Heart size={16} color={palette.red[400]} />}
              label="Latest HR"
              value={latestSample ?? 0}
              unit="bpm"
              hint={latestSample != null && hrSamples.length > 0
                ? fmtTime(hrSamples[hrSamples.length - 1].measured_at)
                : '—'}
              accent={palette.red[400]}
            />
            <StatCard
              icon={<Activity size={16} color={palette.emerald[400]} />}
              label="Resting (today)"
              value={todaySummary?.resting ?? restingThisWeek ?? 0}
              unit="bpm"
              hint={todaySummary ? 'today’s low' : 'last 7 days'}
              accent={palette.emerald[400]}
            />
            <StatCard
              icon={<TrendingUp size={16} color={palette.sky[400]} />}
              label="Avg today"
              value={todaySummary?.avg ?? 0}
              unit="bpm"
              hint={todaySummary ? `${todaySummary.samples} readings` : 'no data today'}
              accent={palette.sky[400]}
            />
            <StatCard
              icon={<Footprints size={16} color={palette.amber[400]} />}
              label="Steps today"
              value={todaySteps}
              unit=""
              hint={lastSyncLabel ? `synced ${lastSyncLabel}` : 'synced just now'}
              accent={palette.amber[400]}
            />
          </View>
        </AnimateRise>
      )}

      {/* ── Resting HR assessment ───────────────────────────────────────
          Classifies the user's avg-of-daily-lows against age/gender-banded
          norms and surfaces a spectrum gauge + three actionable tips for
          lowering the number. Sits right after the stat tiles so it's the
          first thing the user sees after the at-a-glance numbers. */}
      {!loading && hasSamsung && daily.length > 0 && (() => {
        const restings = daily.map(d => d.resting).filter((v): v is number => v != null)
        if (restings.length === 0) return null
        const avgOfRestings = Math.round(restings.reduce((a, b) => a + b, 0) / restings.length)
        const age = estimateAge(profile?.birthdate) ?? 40
        const gender = profile?.gender ?? 'male'
        return (
          <AnimateRise delay={150}>
            <RestingHrIndicator
              bpm={avgOfRestings}
              age={age}
              gender={gender}
            />
          </AnimateRise>
        )
      })()}

      {/* ── 7-day HR range chart ────────────────────────────────────────── */}
      {!loading && hasSamsung && chartData.length > 0 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.cardLabel}>Heart rate — last 7 days</Text>
          <Text style={s.cardSub}>
            Dots show your resting low and daily average. Bands show the time you spent in each zone. Tap a day for details.
          </Text>
          <HrRangeChart data={chartData} hrMax={hrMax} />
        </AnimateRise>
      )}

      {/* ── Daily history — low / avg / peak per day ─────────────────────
          One row per day (newest first). Three numeric columns colour-
          matched to the chart's dot/band scheme:
            Low  → emerald (resting low; falls back to daily min)
            Avg  → sky blue (daily mean of ambient samples)
            Peak → red    (the day's highest reading; the daily max OR
                           the workout-peak, whichever is higher).
       */}
      {!loading && hasSamsung && daily.length > 0 && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.cardLabel}>Daily history — last 7 days</Text>

          {/* Weekly resting-end highlights — both metrics trend DOWN as
              cardiovascular fitness improves, so surfacing them at the
              top gives the user a concrete target to watch drop over
              time. Both use emerald (matches the resting-low dot on
              the chart and the Low column below).
                • Week's lowest resting = absolute floor any single day
                • Average resting        = mean of the 7 daily lows
                                            (the typical resting level) */}
          {(() => {
            const restings = daily
              .map(d => (d.resting != null ? { value: d.resting, day: d.day } : null))
              .filter((v): v is { value: number; day: string } => v != null)
            if (restings.length === 0) return null

            let bestResting = restings[0]
            for (const r of restings) {
              if (r.value < bestResting.value) bestResting = r
            }
            const avgOfRestings = Math.round(
              restings.reduce((sum, r) => sum + r.value, 0) / restings.length,
            )

            // Colour each chip by where its value falls on the resting-HR
            // band table (Athlete → High). This is the same classifier
            // the spectrum gauge above uses, so the colours mean the
            // same thing across the whole page.
            const ageForBands    = estimateAge(profile?.birthdate) ?? 40
            const genderForBands = profile?.gender ?? 'male'
            const bands          = bandsForUser(ageForBands, genderForBands)
            const bestColor = classifyResting(bestResting.value, bands).color
            const avgColor  = classifyResting(avgOfRestings,     bands).color

            return (
              <View style={s.highlightRow}>
                <View style={[s.highlightChip, { borderColor: withAlpha(bestColor, 0.55) }]}>
                  {/* Forced two-line break so both highlight chips have
                      identical label heights, keeping the value rows below
                      perfectly aligned. */}
                  <Text style={s.highlightLabel}>WEEK'S{'\n'}LOWEST RESTING</Text>
                  <View style={s.highlightValueRow}>
                    <Text style={[s.highlightValue, { color: bestColor }]}>{bestResting.value}</Text>
                    <Text style={[s.highlightUnit,  { color: bestColor }]}>bpm</Text>
                  </View>
                  <Text style={s.highlightDay}>{fmtHistoryDate(bestResting.day)}</Text>
                </View>
                <View style={[s.highlightChip, { borderColor: withAlpha(avgColor, 0.55) }]}>
                  {/* Forced two-line break so this label takes the same
                      vertical space as the longer "WEEK'S LOWEST RESTING"
                      label — keeps both chip's interiors aligned regardless
                      of how Text's natural wrapping decides to break. */}
                  <Text style={s.highlightLabel}>AVG OF{'\n'}DAILY LOWS</Text>
                  <View style={s.highlightValueRow}>
                    <Text style={[s.highlightValue, { color: avgColor }]}>{avgOfRestings}</Text>
                    <Text style={[s.highlightUnit,  { color: avgColor }]}>bpm</Text>
                  </View>
                  <Text style={s.highlightDay}>last 7 days</Text>
                </View>
              </View>
            )
          })()}

          <View style={s.historyHeader}>
            <Text style={[s.historyHeaderCell, s.colDay]}>Day</Text>
            <Text style={[s.historyHeaderCell, s.colVal]}>Low</Text>
            <Text style={[s.historyHeaderCell, s.colVal]}>Avg</Text>
            <Text style={[s.historyHeaderCell, s.colVal]}>Peak</Text>
          </View>
          {(() => {
            // Single resting-band table used by every row + the highlight
            // chips above — guarantees the colour for a given bpm is
            // identical no matter where it appears on the card.
            const ageForRows    = estimateAge(profile?.birthdate) ?? 40
            const genderForRows = profile?.gender ?? 'male'
            const bandsRows     = bandsForUser(ageForRows, genderForRows)
            const classify      = (v: number) => classifyResting(v, bandsRows).color

            return daily.slice().reverse().map((d, idx) => {
              const peak = Math.max(d.max ?? 0, d.peakRangeHigh ?? 0) || null
              const low  = d.resting ?? d.min ?? null

              const lowColor  = low   != null ? classify(low)   : palette.slate[400]
              const avgColor  = d.avg != null ? classify(d.avg) : palette.slate[400]
              const peakColor = peak  != null ? classify(peak)  : palette.slate[400]

              return (
                <View
                  key={d.day}
                  style={[s.historyRow, idx === 0 ? null : s.historyRowDivider]}
                >
                  <Text style={[s.historyDayLabel, s.colDay]} numberOfLines={1}>
                    {fmtHistoryDate(d.day)}
                  </Text>
                  <HistoryValueChip value={low}   color={lowColor}  flexCol={s.colVal} />
                  <HistoryValueChip value={d.avg} color={avgColor}  flexCol={s.colVal} />
                  <HistoryValueChip value={peak}  color={peakColor} flexCol={s.colVal} />
                </View>
              )
            })
          })()}
          <Text style={s.historyFooterNote}>All values in bpm</Text>
        </AnimateRise>
      )}

      {/* ── Source attribution footer ───────────────────────────────────── */}
      {hasSamsung && (
        <View style={s.attribution}>
          <Text style={s.attrText}>
            Samsung Health · {lastSyncLabel ? `synced ${lastSyncLabel}` : 'syncing…'}
          </Text>
          <Pressable onPress={onManualSync} disabled={syncBusy} hitSlop={6} style={s.attrBtn}>
            {syncBusy
              ? <ActivityIndicator size="small" color={palette.red[400]} />
              : <>
                  <RefreshCw size={12} color={palette.red[400]} />
                  <Text style={s.attrBtnText}>Sync now</Text>
                </>}
          </Pressable>
        </View>
      )}
    </ScrollView>
  )
}

// ── HistoryValueChip ─────────────────────────────────────────────────────────
//
// Single value cell rendered as a colour-coded chip: numeric text in the
// classifier's colour, soft tinted background, 1 px border of the same
// hue. Colour decision lives in the caller (resting-band classifier for
// Low / Avg, training-zone classifier for Peak) so this component stays
// scale-agnostic.

function HistoryValueChip({
  value, color, flexCol,
}: {
  value:   number | null
  color:   string
  flexCol: object
}) {
  if (value == null) {
    return (
      <View style={[flexCol, { alignItems: 'flex-end' }]}>
        <Text style={[s.historyValue, { color: colors.mutedForeground }]}>—</Text>
      </View>
    )
  }
  return (
    <View style={[flexCol, { alignItems: 'flex-end' }]}>
      <View style={[
        s.historyValueChip,
        {
          borderColor:     withAlpha(color, 0.50),
          backgroundColor: withAlpha(color, 0.12),
        },
      ]}>
        <Text style={[s.historyValue, { color }]}>{value}</Text>
      </View>
    </View>
  )
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, unit, hint, accent,
}: {
  icon:   React.ReactNode
  label:  string
  value:  number
  unit:   string
  hint:   string
  accent: string
}) {
  return (
    <View style={[s.statCard, { borderColor: withAlpha(accent, 0.20) }]}>
      <View style={s.statHead}>
        {icon}
        <Text style={s.statLabel}>{label}</Text>
      </View>
      <View style={s.statValueRow}>
        <TickerNumber value={value} style={[s.statValue, { color: accent }]} />
        {!!unit && <Text style={[s.statUnit, { color: accent }]}>{unit}</Text>}
      </View>
      <Text style={s.statHint}>{hint}</Text>
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:        { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 96, gap: 16 },

  header:        { gap: 4, marginBottom: 4 },
  h1:            { color: colors.foreground, fontSize: 24, fontWeight: '700' },
  h1Sub:         { color: colors.mutedForeground, fontSize: 13 },

  loaderRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loaderText:    { color: colors.mutedForeground, fontSize: 13 },

  card: {
    backgroundColor: alpha(colors.card, 0.5),
    borderColor:     colors.border,
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    gap:             12,
  },
  cardLabel:     { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  cardSub:       { color: colors.mutedForeground, fontSize: 12, marginTop: -6 },

  emptyTitle:    { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  emptyBody:     { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius:    8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf:       'flex-start',
    marginTop:       8,
  },
  primaryBtnText:{ color: colors.primaryForeground, fontWeight: '600', fontSize: 13 },

  statsGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
  },
  statCard: {
    flexGrow:        1,
    flexBasis:       '46%',
    backgroundColor: alpha(colors.card, 0.5),
    borderWidth:     1,
    borderRadius:    12,
    padding:         12,
    gap:             6,
  },
  statHead:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel:     { color: colors.mutedForeground, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  statValueRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue:     { fontSize: 28, fontWeight: '700' },
  statUnit:      { fontSize: 13, fontWeight: '600', opacity: 0.7 },
  statHint:      { color: colors.mutedForeground, fontSize: 11 },

  captionDim:    { color: colors.mutedForeground, fontSize: 11 },

  // Weekly low-end highlights — two chips above the daily-history table.
  // Surface the values that should trend DOWN as cardio fitness improves
  // so the user has a concrete target to watch.
  highlightRow: {
    flexDirection: 'row',
    gap:           10,
    marginBottom:  6,
  },
  highlightChip: {
    flex:            1,
    backgroundColor: alpha(colors.card, 0.6),
    borderWidth:     1,
    borderRadius:    10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap:             4,
  },
  highlightLabel: {
    color:        colors.mutedForeground,
    fontSize:     9,
    fontWeight:   '700',
    letterSpacing: 0.5,
  },
  highlightValueRow: {
    flexDirection: 'row',
    alignItems:    'baseline',
    gap:           4,
  },
  highlightValue: {
    fontSize:   24,
    fontWeight: '700',
    fontFamily: 'JetBrainsMono_700Bold',
  },
  highlightUnit: {
    fontSize:   11,
    fontWeight: '600',
    opacity:    0.7,
  },
  highlightDay: {
    color:    colors.mutedForeground,
    fontSize: 10,
  },

  // Daily-history table styles. Three numeric columns on the right
  // (Low / Avg / Peak), one wider day label on the left. Numbers use
  // tabular-nums so they align cleanly between rows.
  historyHeader: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingBottom:   6,
    borderBottomColor: alpha(colors.border, 0.6),
    borderBottomWidth: 1,
  },
  historyHeaderCell: {
    color:      colors.mutedForeground,
    fontSize:   10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  historyRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 8,
  },
  historyRowDivider: {
    borderTopColor: alpha(colors.border, 0.4),
    borderTopWidth: 1,
  },
  historyDayLabel: {
    color:    colors.foreground,
    fontSize: 13,
    fontWeight: '600',
  },
  historyValue: {
    fontSize:   14,
    fontWeight: '700',
    fontFamily: 'JetBrainsMono_700Bold',
  },
  // Colour-coded value chip used by both the daily history rows. Matches
  // the visual treatment of the highlight cards above so the page reads
  // as one consistent colour story.
  historyValueChip: {
    borderWidth:       1,
    borderRadius:      6,
    paddingVertical:   2,
    paddingHorizontal: 8,
    minWidth:          44,
    alignItems:        'center',
  },
  colDay: {
    flex:      1.6,
    textAlign: 'left',
  },
  colVal: {
    flex:      1,
    textAlign: 'right',
  },
  historyFooterNote: {
    color:      colors.mutedForeground,
    fontSize:   10,
    marginTop:  6,
    textAlign:  'right',
  },

  attribution: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingTop:     4,
  },
  attrText:      { color: colors.mutedForeground, fontSize: 11 },
  attrBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  attrBtnText:   { color: palette.red[400], fontSize: 12, fontWeight: '600' },
})
