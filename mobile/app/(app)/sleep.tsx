/**
 * Sleep — daily sleep quality dashboard.
 *
 * Reads two Supabase tables:
 *   • sleep_sessions  one row per overnight sleep
 *   • sleep_stages    one row per stage segment (drives hypnogram)
 *
 * Page goal (locked May 31 2026):
 *   "How well is my day-to-day sleep, and what can I do to improve it?"
 *
 * FOUR dimensions, each graded against time-based targets:
 *   1. Total sleep      — target 7.5h adults (age-adjusted)
 *   2. Deep sleep       — target 90 min (watch only; empty state otherwise)
 *   3. REM sleep        — target 90 min (watch only; empty state otherwise)
 *   4. Schedule         — bedtime + consistency rolled together
 *
 * Layout (top → bottom):
 *   Header → Verdict card → Sleep Clock → 2x2 dimension grid →
 *   Hypnogram (watch only) → 30-day total-sleep sparkline
 *
 * Status pills use TIME-BASED bands (not percentages — locked with user):
 *   Total sleep:  ≤30min off=✓  /  30-90min=⚠  /  >90min=✗
 *   Deep / REM:   ≤15min short=✓ /  15-30min short=⚠  /  >30min short=✗
 *   Bedtime:      ≤15min off=✓  /  15-45min=⚠  /  >45min=✗
 *   Consistency:  ≤30min stddev=✓  /  30-60min=⚠  /  >60min=✗
 *   Schedule combines bedtime + consistency — worst of the two wins.
 *
 * Data source: Samsung Health Data SDK (DataTypes.SLEEP) +
 * Apple HealthKit (sleepAnalysis). Same normalized shape for both.
 * Phone-only sessions (no worn watch) write awake_s/light_s/rem_s/deep_s = NULL —
 * UI shows Deep + REM cards as empty-state in that case, keeps the
 * Total and Schedule dimensions populated from the session timestamps.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  Moon, Clock, Activity, BedDouble, Brain,
} from 'lucide-react-native'
import Svg, { Path, Line as SvgLine } from 'react-native-svg'

import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import AnimateRise from '../../src/components/AnimateRise'
import TickerNumber from '../../src/components/TickerNumber'
import SleepClock, { type SleepClockNight } from '../../src/components/SleepClock'
import Hypnogram, {
  type HypnogramSegment, type SleepStage,
} from '../../src/components/Hypnogram'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── DB row shapes ────────────────────────────────────────────────────────────

interface SleepSessionRow {
  id:               string
  start_at:         string
  end_at:           string
  duration_s:       number
  efficiency_pct:   number | null
  awake_s:          number | null
  light_s:          number | null
  rem_s:            number | null
  deep_s:           number | null
}

interface SleepStageRow {
  id:          string
  session_id:  string
  stage:       SleepStage
  start_at:    string
  end_at:      string
  duration_s:  number
}

type Status = 'ok' | 'warn' | 'fail' | 'unknown'

interface DimensionResult {
  status:   Status
  /** Raw current value (seconds for time dims, varies by dim). */
  current:  number | null
  /** Target value (matching units). */
  target:   number | null
  headline: string
  action:   string
  spark:    (number | null)[]
}

// ── Time-based classifiers (locked May 31 2026) ──────────────────────────────

/**
 * Total sleep status — based on minutes off target.
 *   |delta| ≤ 30 min → ok
 *   |delta| ≤ 90 min → warn
 *   else            → fail
 */
function classifyTotal(actualS: number, targetS: number): Status {
  const offMin = Math.abs(actualS - targetS) / 60
  if (offMin <= 30) return 'ok'
  if (offMin <= 90) return 'warn'
  return 'fail'
}

/**
 * Deep / REM sleep status — based on minutes short of target.
 * Only the short-direction matters; if user gets MORE than target,
 * that's fine. So we don't penalize over-target values.
 *   short ≤ 15 min → ok
 *   short ≤ 30 min → warn
 *   else          → fail
 */
function classifyStage(actualS: number, targetS: number): Status {
  if (actualS >= targetS) return 'ok'  // at-or-above target
  const shortMin = (targetS - actualS) / 60
  if (shortMin <= 15) return 'ok'
  if (shortMin <= 30) return 'warn'
  return 'fail'
}

/**
 * Bedtime status — minutes late vs the target bedtime.
 * Going to bed EARLIER than target is fine (= ok).
 *   late ≤ 15 min → ok
 *   late ≤ 45 min → warn
 *   else        → fail
 */
function classifyBedtime(actualOffsetS: number, targetOffsetS: number): Status {
  const lateMin = (actualOffsetS - targetOffsetS) / 60
  if (lateMin <= 15) return 'ok'  // early or on time = ok
  if (lateMin <= 45) return 'warn'
  return 'fail'
}

/**
 * Consistency status — std-dev of bedtime offsets across the week.
 *   ≤ 30 min stddev → ok
 *   ≤ 60 min stddev → warn
 *   else           → fail
 */
function classifyConsistency(sdSeconds: number): Status {
  const sdMin = sdSeconds / 60
  if (sdMin <= 30) return 'ok'
  if (sdMin <= 60) return 'warn'
  return 'fail'
}

/** Worse of two statuses ('fail' > 'warn' > 'ok' > 'unknown'). */
function worseStatus(a: Status, b: Status): Status {
  const rank: Record<Status, number> = { unknown: -1, ok: 0, warn: 1, fail: 2 }
  return rank[a] >= rank[b] ? a : b
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nDaysAgoIso(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (n - 1))
  return d.toISOString()
}

function estimateAge(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  if (age < 5 || age > 120) return null
  return age
}

/**
 * Target sleep duration in HOURS, age-adjusted per locked product spec.
 *   Teens (13-17)  → 9.0 h
 *   Adults (18-64) → 7.5 h
 *   65+            → 7.5 h
 *   Fallback       → 7.5 h
 */
function targetHoursForAge(birthdate: string | null | undefined): number {
  const age = estimateAge(birthdate)
  if (age == null) return 7.5
  if (age >= 13 && age <= 17) return 9.0
  return 7.5
}

function fmtHoursMinutes(s: number | null): string {
  if (s == null) return '—'
  const totalMin = Math.round(s / 60)
  const h        = Math.floor(totalMin / 60)
  const m        = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtHoursOnly(h: number): string {
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function fmtMin(min: number): string {
  return `${Math.round(min)} min`
}

/**
 * Bedtime offset: seconds from local midnight. Sleep onset after 6PM the
 * previous day maps to NEGATIVE seconds (so 10PM = -7200, 2AM = +7200).
 * Continuous axis for averaging / std-dev without midnight wrap confusion.
 */
function bedtimeOffsetSeconds(iso: string): number {
  const d        = new Date(iso)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let offset = (d.getTime() - midnight.getTime()) / 1000
  if (offset >= 18 * 3600) offset -= 86_400
  return offset
}

function wakeOffsetSeconds(iso: string): number {
  const d        = new Date(iso)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return (d.getTime() - midnight.getTime()) / 1000
}

function fmtBedtime(secsFromMidnight: number | null): string {
  if (secsFromMidnight == null) return '—'
  const wrapped = ((secsFromMidnight % 86_400) + 86_400) % 86_400
  const h24     = Math.floor(wrapped / 3600)
  const m       = Math.floor((wrapped % 3600) / 60)
  const h12     = ((h24 + 11) % 12) + 1
  const period  = h24 < 12 ? 'AM' : 'PM'
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const v    = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(v)
}

function statusColor(s: Status): string {
  switch (s) {
    case 'ok':      return palette.emerald[400]
    case 'warn':    return palette.amber[400]
    case 'fail':    return palette.red[400]
    case 'unknown': return palette.slate[400]
  }
}

function statusGlyph(s: Status): string {
  switch (s) {
    case 'ok':      return '✓'
    case 'warn':    return '!'
    case 'fail':    return '×'
    case 'unknown': return '—'
  }
}

/**
 * Combine 4 dimension statuses into a colour-coded verdict for the
 * top-of-page edge stripe + the off-count line.
 */
function computeVerdict(statuses: Status[]) {
  const known    = statuses.filter(s => s !== 'unknown')
  const offCount = known.filter(s => s === 'warn' || s === 'fail').length
  let color: string
  if (offCount === 0)     color = palette.emerald[400]
  else if (offCount <= 2) color = palette.amber[400]
  else                    color = palette.red[400]
  return { color, offCount, knownCount: known.length }
}

// ── Page ─────────────────────────────────────────────────────────────────────

const DEEP_TARGET_S = 90 * 60   // 90 min adult target
const REM_TARGET_S  = 90 * 60   // 90 min adult target

export default function SleepPage() {
  const { profile } = useAuth()

  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sessions7,  setSessions7]  = useState<SleepSessionRow[]>([])
  const [sessions30, setSessions30] = useState<SleepSessionRow[]>([])
  const [latestStages, setLatestStages] = useState<SleepStageRow[]>([])

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!profile?.id) return
    const since7  = nDaysAgoIso(7)
    const since30 = nDaysAgoIso(30)

    const [r7, r30] = await Promise.all([
      supabase
        .from('sleep_sessions')
        .select('id, start_at, end_at, duration_s, efficiency_pct, awake_s, light_s, rem_s, deep_s')
        .eq('user_id', profile.id)
        .gte('start_at', since7)
        .order('start_at', { ascending: false }),
      supabase
        .from('sleep_sessions')
        .select('id, start_at, end_at, duration_s, efficiency_pct, awake_s, light_s, rem_s, deep_s')
        .eq('user_id', profile.id)
        .gte('start_at', since30)
        .order('start_at', { ascending: false }),
    ])

    const ok7  = !r7.error  || r7.error.code  === 'PGRST205'
    const ok30 = !r30.error || r30.error.code === 'PGRST205'
    if (ok7)  setSessions7(r7.data  ?? [])
    if (ok30) setSessions30(r30.data ?? [])

    const latest = (r7.data ?? [])[0]
    if (latest) {
      const sRes = await supabase
        .from('sleep_stages')
        .select('id, session_id, stage, start_at, end_at, duration_s')
        .eq('session_id', latest.id)
        .order('start_at', { ascending: true })
      const okStages = !sRes.error || sRes.error.code === 'PGRST205'
      if (okStages) setLatestStages(sRes.data ?? [])
    } else {
      setLatestStages([])
    }
  }, [profile?.id])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        setLoading(true)
        await fetchData()
        if (cancelled) return
        setLoading(false)
      })()
      return () => { cancelled = true }
    }, [fetchData]),
  )

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await fetchData() } finally { setRefreshing(false) }
  }, [fetchData])

  // ── Derived ────────────────────────────────────────────────────────────────

  const targetHours = useMemo(
    () => targetHoursForAge(profile?.birthdate),
    [profile?.birthdate],
  )
  const targetSecs  = targetHours * 3600

  // Spark window — last 14 nights chronologically
  const sparkWindow = useMemo(() => {
    const cutoff = nDaysAgoIso(14)
    return sessions30
      .filter(s => s.start_at >= cutoff)
      .slice()
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
  }, [sessions30])

  // ── Dimension 1: Total sleep ───────────────────────────────────────────────

  const totalDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   targetSecs,
        headline: `Target ${fmtHoursOnly(targetHours)}`,
        action:   "Once a few nights are tracked, your average sleep duration shows here with a status against your age-adjusted target.",
        spark:    [],
      }
    }
    const avg = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const status = classifyTotal(avg, targetSecs)
    const diffMin = Math.round((targetSecs - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → ${fmtHoursOnly(targetHours)}`

    let action: string
    if (status === 'ok') {
      action = `Averaging ${fmtHoursMinutes(avg)} — within ${fmtMin(Math.abs(diffMin))} of your ${fmtHoursOnly(targetHours)} target. Keep your bedtime steady and your body banks this duration consistently.`
    } else if (avg < targetSecs) {
      action = `Averaging ${fmtHoursMinutes(avg)} — ${fmtMin(Math.abs(diffMin))} short of your ${fmtHoursOnly(targetHours)} target. Going to bed ${fmtMin(Math.abs(diffMin))} earlier each night closes the gap; the circadian rhythm adapts in about two weeks.`
    } else {
      action = `Averaging ${fmtHoursMinutes(avg)} — ${fmtMin(Math.abs(diffMin))} above target. Not harmful, but check whether the extra time reflects fatigue or recovery from a hard week.`
    }
    return {
      status, current: avg, target: targetSecs, headline, action,
      spark: sparkWindow.map(s => s.duration_s),
    }
  }, [sessions7, sparkWindow, targetSecs, targetHours])

  // ── Dimension 2: Deep sleep ────────────────────────────────────────────────

  const deepDim: DimensionResult = useMemo(() => {
    const sessionsWithStages = sessions7.filter(s => s.deep_s != null)
    if (sessionsWithStages.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   DEEP_TARGET_S,
        headline: `Target 90 min`,
        action:   "Deep sleep needs a worn watch to measure. Wear yours overnight (with Sleep Focus on) and the deep stage shows up here.",
        spark:    [],
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.deep_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, DEEP_TARGET_S)
    const shortMin = Math.round((DEEP_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    let action: string
    if (status === 'ok') {
      action = `Averaging ${fmtHoursMinutes(avg)} of deep sleep — meeting the 90-minute physical-recovery target. Deep is when your body rebuilds muscle and releases growth hormone.`
    } else if (shortMin > 0) {
      action = `Averaging ${fmtHoursMinutes(avg)} — ${fmtMin(shortMin)} short of the 90-minute target. Deep responds to a cool bedroom (≤67°F) and avoiding heavy meals or alcohol within 3 hours of bed.`
    } else {
      action = `Averaging ${fmtHoursMinutes(avg)} — at target.`
    }
    return {
      status, current: avg, target: DEEP_TARGET_S, headline, action,
      spark: sparkWindow.map(s => s.deep_s),
    }
  }, [sessions7, sparkWindow])

  // ── Dimension 3: REM sleep ─────────────────────────────────────────────────

  const remDim: DimensionResult = useMemo(() => {
    const sessionsWithStages = sessions7.filter(s => s.rem_s != null)
    if (sessionsWithStages.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   REM_TARGET_S,
        headline: `Target 90 min`,
        action:   "REM sleep needs a worn watch to measure. Wear yours overnight and the REM stage shows up here.",
        spark:    [],
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.rem_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, REM_TARGET_S)
    const shortMin = Math.round((REM_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    let action: string
    if (status === 'ok') {
      action = `Averaging ${fmtHoursMinutes(avg)} of REM — meeting the 90-minute target. REM is when memory consolidates and emotional processing happens.`
    } else if (shortMin > 0) {
      action = `Averaging ${fmtHoursMinutes(avg)} — ${fmtMin(shortMin)} short of the 90-minute target. Alcohol within 3 hours of bed is the single biggest REM-suppressor; that's usually the first lever to pull.`
    } else {
      action = `Averaging ${fmtHoursMinutes(avg)} — at target.`
    }
    return {
      status, current: avg, target: REM_TARGET_S, headline, action,
      spark: sparkWindow.map(s => s.rem_s),
    }
  }, [sessions7, sparkWindow])

  // ── Dimension 4: Schedule (bedtime + consistency rolled) ───────────────────

  const scheduleDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   null,
        headline: 'No data yet',
        action:   "Once you log a few nights, your bedtime + consistency show up here together as your schedule grade.",
        spark:    [],
      }
    }

    const bedOffsets  = sessions7.map(s => bedtimeOffsetSeconds(s.start_at))
    const wakeOffsets = sessions7.map(s => wakeOffsetSeconds(s.end_at))
    const avgBed      = bedOffsets.reduce((a, b) => a + b, 0) / bedOffsets.length
    const avgWake     = wakeOffsets.reduce((a, b) => a + b, 0) / wakeOffsets.length
    const targetBed   = avgWake - targetSecs

    const bedStatus = classifyBedtime(avgBed, targetBed)

    // Consistency: only meaningful with 3+ nights
    let consistencyStatus: Status = 'unknown'
    let sdMin = 0
    if (sessions7.length >= 3) {
      const sd = stdDev(bedOffsets)
      sdMin = sd / 60
      consistencyStatus = classifyConsistency(sd)
    }

    const status = consistencyStatus === 'unknown'
      ? bedStatus
      : worseStatus(bedStatus, consistencyStatus)

    const currentBedLabel = fmtBedtime(avgBed)
    const targetBedLabel  = fmtBedtime(targetBed)
    const wakeLabel       = fmtBedtime(avgWake)
    const headline = consistencyStatus === 'unknown'
      ? `${currentBedLabel} → ${targetBedLabel}`
      : `${currentBedLabel} · ±${Math.round(sdMin)}m`

    const lateMin = (avgBed - targetBed) / 60
    let action: string
    if (status === 'ok') {
      action = `Your bedtime averages ${currentBedLabel}, holding steady within ${sessions7.length >= 3 ? `±${Math.round(sdMin)} minutes` : 'range'} — aligned with your ${wakeLabel} wake time.`
    } else if (bedStatus !== 'ok' && consistencyStatus === 'fail') {
      action = `Bedtime averages ${currentBedLabel} (${fmtMin(Math.abs(lateMin))} ${lateMin > 0 ? 'late' : 'early'}) AND varies ±${Math.round(sdMin)} minutes. Pick one bedtime, hold it within a 30-minute window — your circadian rhythm learns fastest from a stable schedule.`
    } else if (bedStatus !== 'ok') {
      action = `Bedtime averages ${currentBedLabel}. Shifting to ${targetBedLabel} (${fmtMin(Math.abs(lateMin))} ${lateMin > 0 ? 'earlier' : 'later'}) aligns with your ${wakeLabel} wake time and your ${fmtHoursOnly(targetHours)} duration target.`
    } else {
      action = `Bedtime is on target but varies by ±${Math.round(sdMin)} minutes night-to-night. Holding it within a 30-minute window helps your body lock its melatonin release time.`
    }

    return {
      status, current: avgBed, target: targetBed, headline, action,
      spark: sparkWindow.map(s => bedtimeOffsetSeconds(s.start_at)),
    }
  }, [sessions7, sparkWindow, targetSecs, targetHours])

  // ── Verdict ────────────────────────────────────────────────────────────────

  const verdict = useMemo(
    () => computeVerdict([totalDim.status, deepDim.status, remDim.status, scheduleDim.status]),
    [totalDim, deepDim, remDim, scheduleDim],
  )

  const verdictText = useMemo(() => {
    if (sessions7.length === 0) {
      return 'No nights tracked yet. Once data starts landing, your weekly verdict shows here.'
    }
    const avgSec = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const avgLabel = fmtHoursMinutes(avgSec)
    if (verdict.offCount === 0) {
      return `Sleep is averaging ${avgLabel} — on track across all ${verdict.knownCount} dimensions. Keep your rhythm steady.`
    }
    const items: Array<{ name: string; status: Status }> = [
      { name: 'total sleep', status: totalDim.status },
      { name: 'deep sleep',  status: deepDim.status },
      { name: 'REM sleep',   status: remDim.status },
      { name: 'schedule',    status: scheduleDim.status },
    ]
    const lead = items.find(i => i.status === 'fail') ?? items.find(i => i.status === 'warn')
    const offStr = `${verdict.offCount} of ${verdict.knownCount} dimensions need attention`
    if (!lead) return `Sleep is averaging ${avgLabel} — ${offStr}.`
    return `Sleep is averaging ${avgLabel} — ${offStr}, starting with ${lead.name}.`
  }, [sessions7, verdict, totalDim, deepDim, remDim, scheduleDim])

  // ── Sleep Clock data ───────────────────────────────────────────────────────

  const clockNights: SleepClockNight[] = useMemo(() => {
    // Most recent first, max 7 nights
    return sessions7.slice(0, 7).map((s, idx) => ({
      label: new Date(s.start_at).toLocaleDateString([], { weekday: 'short' }),
      startAt: s.start_at,
      endAt:   s.end_at,
      isMostRecent: idx === 0,
    }))
  }, [sessions7])

  // Target window (for the faint outer arc on the clock)
  const targetBedHour  = useMemo(() => {
    if (sessions7.length === 0) return undefined
    const avgWake = sessions7.reduce((a, s) => a + wakeOffsetSeconds(s.end_at), 0) / sessions7.length
    const targetBed = avgWake - targetSecs
    // Convert seconds-from-midnight (possibly negative) → 24h hour
    const wrapped = ((targetBed % 86_400) + 86_400) % 86_400
    return wrapped / 3600
  }, [sessions7, targetSecs])

  const targetWakeHour = useMemo(() => {
    if (sessions7.length === 0) return undefined
    const avgWake = sessions7.reduce((a, s) => a + wakeOffsetSeconds(s.end_at), 0) / sessions7.length
    return avgWake / 3600
  }, [sessions7])

  // ── Hypnogram data ─────────────────────────────────────────────────────────

  const hypnoSegments: HypnogramSegment[] = useMemo(
    () => latestStages.map(r => ({
      stage:      r.stage,
      start_at:   r.start_at,
      end_at:     r.end_at,
      duration_s: r.duration_s,
    })),
    [latestStages],
  )
  const latestSession = sessions7[0] ?? null
  const latestHasStages = latestSession?.deep_s != null && hypnoSegments.length > 0

  // ── 30-day series ──────────────────────────────────────────────────────────

  const monthSeries = useMemo(() => {
    const sorted = sessions30
      .slice()
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
    return sorted.map(s => s.duration_s / 3600)  // hours
  }, [sessions30])

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasAnyData = sessions7.length > 0

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={palette.indigo[400]} />
      }
    >
      <View style={s.header}>
        <Text style={s.h1}>Sleep</Text>
        <Text style={s.h1Sub}>
          {hasAnyData
            ? `Target ${fmtHoursOnly(targetHours)}  ·  ${sessions7.length} ${sessions7.length === 1 ? 'night' : 'nights'} this week`
            : 'Pair your watch or keep your phone on the bed at night to start tracking.'}
        </Text>
      </View>

      {loading && !hasAnyData && (
        <View style={{ gap: 16 }}>
          <Skeleton style={{ height: 90, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 300, width: '100%', borderRadius: 12 }} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
          </View>
        </View>
      )}

      {!loading && !hasAnyData && (
        <AnimateRise delay={0} style={s.card}>
          <Moon size={20} color={palette.indigo[400]} />
          <Text style={s.emptyTitle}>No sleep tracked yet</Text>
          <Text style={s.emptyBody}>
            Two ways to get data flowing: keep your phone on or near the bed overnight (Samsung detects total sleep + bedtime from phone movement), or wear your Galaxy Watch overnight for the full picture including deep and REM stages.
          </Text>
        </AnimateRise>
      )}

      {!loading && hasAnyData && (
        <AnimateRise delay={0}>
          <View style={[s.verdictCard, { borderLeftColor: verdict.color }]}>
            <View style={s.verdictHead}>
              <Moon size={16} color={verdict.color} />
              <Text style={[s.verdictBadge, { color: verdict.color }]}>THIS WEEK</Text>
            </View>
            <Text style={s.verdictText}>{verdictText}</Text>
          </View>
        </AnimateRise>
      )}

      {/* ── Sleep Clock ──────────────────────────────────────────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={150} style={s.card}>
          <Text style={s.cardLabel}>Last 7 nights</Text>
          <Text style={s.cardSub}>
            Each ring is one night. Aligned arcs = consistent schedule. Tap a ring for detail.
          </Text>
          <SleepClock
            nights={clockNights}
            targetBedHour={targetBedHour}
            targetWakeHour={targetWakeHour}
            size={280}
          />
        </AnimateRise>
      )}

      {/* ── 2×2 dimension grid ───────────────────────────────────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={300}>
          <View style={s.dimGrid}>
            <DimensionCard
              icon={<Clock size={14} color={statusColor(totalDim.status)} />}
              label="Total sleep"
              dim={totalDim}
            />
            <DimensionCard
              icon={<BedDouble size={14} color={statusColor(scheduleDim.status)} />}
              label="Schedule"
              dim={scheduleDim}
            />
            <DimensionCard
              icon={<Activity size={14} color={statusColor(deepDim.status)} />}
              label="Deep sleep"
              dim={deepDim}
            />
            <DimensionCard
              icon={<Brain size={14} color={statusColor(remDim.status)} />}
              label="REM sleep"
              dim={remDim}
            />
          </View>
        </AnimateRise>
      )}

      {/* ── Last night hypnogram ─────────────────────────────────────────── */}
      {!loading && hasAnyData && latestSession && latestHasStages && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.cardLabel}>Last night</Text>
          <View style={s.hypnoMetaRow}>
            <Text style={s.hypnoMeta}>
              {new Date(latestSession.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(latestSession.end_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </Text>
            <Text style={s.hypnoMetaDot}>•</Text>
            <View style={s.hypnoTotalRow}>
              <TickerNumber
                value={Math.floor(latestSession.duration_s / 3600)}
                style={s.hypnoTotalNum}
              />
              <Text style={s.hypnoTotalUnit}>h </Text>
              <TickerNumber
                value={Math.round((latestSession.duration_s % 3600) / 60)}
                style={s.hypnoTotalNum}
              />
              <Text style={s.hypnoTotalUnit}>m</Text>
            </View>
          </View>
          <Hypnogram
            segments={hypnoSegments}
            sessionStart={latestSession.start_at}
            sessionEnd={latestSession.end_at}
          />
        </AnimateRise>
      )}

      {/* ── 30-day duration trend ────────────────────────────────────────── */}
      {!loading && hasAnyData && monthSeries.length > 0 && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.cardLabel}>Duration — last 30 days</Text>
          <Text style={s.cardSub}>
            Each bar is one night. Dashed line is your {fmtHoursOnly(targetHours)} target.
          </Text>
          <MonthlySparkline values={monthSeries} target={targetHours} />
        </AnimateRise>
      )}
    </ScrollView>
  )
}

// ── DimensionCard ────────────────────────────────────────────────────────────

function DimensionCard({
  icon, label, dim,
}: {
  icon:  React.ReactNode
  label: string
  dim:   DimensionResult
}) {
  const color = statusColor(dim.status)
  return (
    <View style={[s.dimCard, { borderColor: withAlpha(color, 0.25) }]}>
      <View style={s.dimHead}>
        {icon}
        <Text style={s.dimLabel}>{label}</Text>
        <View style={s.dimStatusFill} />
        <View style={[s.dimPill, { borderColor: withAlpha(color, 0.55), backgroundColor: withAlpha(color, 0.12) }]}>
          <Text style={[s.dimPillText, { color }]}>{statusGlyph(dim.status)}</Text>
        </View>
      </View>
      <Text style={s.dimHeadline}>{dim.headline}</Text>
      <SparkLine values={dim.spark} accent={color} />
      <Text style={s.dimAction}>{dim.action}</Text>
    </View>
  )
}

// ── SparkLine ────────────────────────────────────────────────────────────────

function SparkLine({
  values, accent, width = 120, height = 24,
}: {
  values: (number | null)[]
  accent: string
  width?:  number
  height?: number
}) {
  const valid = values
    .map((v, i) => v == null ? null : { x: i, v })
    .filter((p): p is { x: number; v: number } => p != null)
  if (valid.length < 2) {
    return <View style={{ width, height, opacity: 0.4 }} />
  }
  const xs   = valid.map(p => p.x)
  const vs   = valid.map(p => p.v)
  const xMin = 0
  const xMax = values.length - 1
  const yMin = Math.min(...vs)
  const yMax = Math.max(...vs)
  const yRange = Math.max(1e-6, yMax - yMin)
  function tx(x: number) { return (x - xMin) / Math.max(1, xMax - xMin) * width }
  function ty(v: number) { return height - 2 - ((v - yMin) / yRange) * (height - 4) }

  const segments: string[] = []
  let lastWasNull = true
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) { lastWasNull = true; continue }
    const cmd = lastWasNull ? 'M' : 'L'
    segments.push(`${cmd}${tx(i).toFixed(1)},${ty(v).toFixed(1)}`)
    lastWasNull = false
  }
  return (
    <View style={{ height, marginVertical: 2 }}>
      <Svg width={width} height={height}>
        <Path d={segments.join(' ')} stroke={accent} strokeWidth={1.5} fill="none" />
      </Svg>
    </View>
  )
}

// ── MonthlySparkline ─────────────────────────────────────────────────────────

function MonthlySparkline({
  values, target, height = 80,
}: {
  values: number[]   // hours per night
  target: number     // target hours
  height?: number
}) {
  const [width, setWidth] = useState(0)
  if (values.length === 0) return null
  const yMax  = Math.max(target * 1.2, Math.max(...values, target) + 0.5)
  const yMin  = 0
  const plotH = height - 12

  function ty(v: number) {
    return 4 + plotH - ((v - yMin) / (yMax - yMin)) * plotH
  }

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{ height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          {values.map((v, i) => {
            const barW = Math.max(1, (width / values.length) - 2)
            const x    = (i / values.length) * width + 1
            const y    = ty(v)
            const h    = Math.max(1, height - 8 - y)
            const ok   = v >= target * 0.9 && v <= target * 1.2
            const color = ok ? palette.emerald[400] : palette.amber[400]
            return (
              <Path
                key={`bar-${i}`}
                d={`M${x.toFixed(1)},${y.toFixed(1)} h${barW.toFixed(1)} v${h.toFixed(1)} h-${barW.toFixed(1)} z`}
                fill={withAlpha(color, 0.65)}
              />
            )
          })}
          <SvgLine
            x1={0} x2={width}
            y1={ty(target)} y2={ty(target)}
            stroke={palette.slate[400]}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        </Svg>
      )}
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

  card: {
    backgroundColor: alpha(colors.card, 0.5),
    borderColor:     colors.border,
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    gap:             12,
  },
  cardLabel: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  cardSub:   { color: colors.mutedForeground, fontSize: 12, marginTop: -6 },

  emptyTitle: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  emptyBody:  { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },

  verdictCard: {
    backgroundColor: alpha(colors.card, 0.7),
    borderColor:     colors.border,
    borderWidth:     1,
    borderLeftWidth: 4,
    borderRadius:    12,
    padding:         14,
    gap:             8,
  },
  verdictHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  verdictBadge: {
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 0.8,
  },
  verdictText: {
    color:      colors.foreground,
    fontSize:   14,
    lineHeight: 20,
  },

  dimGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
  },
  dimCard: {
    flexGrow:        1,
    flexBasis:       '46%',
    backgroundColor: alpha(colors.card, 0.5),
    borderWidth:     1,
    borderRadius:    12,
    padding:         12,
    gap:             6,
  },
  dimHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  dimLabel: {
    color:    colors.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dimStatusFill: { flex: 1 },
  dimPill: {
    minWidth:        18,
    height:          18,
    paddingHorizontal: 5,
    borderWidth:     1,
    borderRadius:    9,
    alignItems:      'center',
    justifyContent:  'center',
  },
  dimPillText: {
    fontSize:   11,
    fontWeight: '800',
    fontFamily: fonts.mono[700],
    lineHeight: 12,
  },
  dimHeadline: {
    color:      colors.foreground,
    fontSize:   15,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
  },
  dimAction: {
    color:      colors.mutedForeground,
    fontSize:   11,
    lineHeight: 16,
  },

  hypnoMetaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginTop:     -4,
    marginBottom:  4,
  },
  hypnoMeta: {
    color:    colors.mutedForeground,
    fontSize: 12,
    fontFamily: fonts.mono[500],
  },
  hypnoMetaDot: {
    color:    colors.mutedForeground,
    fontSize: 12,
  },
  hypnoTotalRow: {
    flexDirection: 'row',
    alignItems:    'baseline',
  },
  hypnoTotalNum: {
    color:      palette.indigo[400],
    fontSize:   18,
    fontWeight: '700',
  },
  hypnoTotalUnit: {
    color:    palette.indigo[400],
    fontSize: 12,
    fontWeight: '600',
    opacity:  0.7,
  },
})
