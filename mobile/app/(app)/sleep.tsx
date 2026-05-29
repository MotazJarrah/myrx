/**
 * Sleep — daily sleep quality dashboard.
 *
 * Reads two Supabase tables:
 *
 *   • sleep_sessions  one row per overnight sleep. Aggregate stats
 *                     (total, awake, light, REM, deep durations).
 *   • sleep_stages    one row per stage segment. Drives the hypnogram
 *                     visualisation. 1:N off sleep_sessions.
 *
 * Page goal (locked, see CLAUDE.md "Sleep page" spec): answer ONE
 * question — "How well is my day-to-day sleep, and what can I do to
 * improve it?" — by grading FOUR dimensions (Duration, Quality, Bedtime,
 * Consistency) against personal targets and naming a concrete next step
 * for each.
 *
 * Data source (locked May 29 2026): ATHLETE INPUT ONLY. An earlier
 * draft pulled from Samsung Health; that path has been retired. Athletes
 * will log nights through an in-app entry form once that form ships.
 * Until then the page renders an empty state telling them sleep logging
 * is coming. All downstream UI — dimension cards, hypnogram, sparklines,
 * 30-day chart — is preserved so the page lights up automatically the
 * moment rows start landing in sleep_sessions / sleep_stages from the
 * athlete-input flow. No rewiring needed when the form lands.
 *
 * Intentionally NOT included (per the spec):
 *   – No composite "sleep score" number. The 4 dimensions ARE the score.
 *   – No daily history table. Sparklines + 30-day trend handle history.
 *   – No generic tips card. Action lines are data-driven per dimension.
 *   – No stat-tiles grid (different from Heart page intentionally — sleep
 *     is multi-dimensional in a way HR snapshot stats aren't).
 *
 * Empty states: a coach-voice "logging coming soon" empty card when no
 * sessions exist; per-dimension "—" with helper text when partial data
 * lands (e.g. duration-only sessions without stage detail).
 */

import { useCallback, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  Moon, Clock, Activity, BedDouble, Repeat,
} from 'lucide-react-native'
import Svg, { Path, Line as SvgLine } from 'react-native-svg'

import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import AnimateRise from '../../src/components/AnimateRise'
import TickerNumber from '../../src/components/TickerNumber'
import Hypnogram, {
  type HypnogramSegment, type SleepStage,
} from '../../src/components/Hypnogram'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── DB row shapes ────────────────────────────────────────────────────────────
// Optional/nullable across the board because not every entry comes with
// stage breakdowns — some logged sessions will be duration-only. We
// treat missing stage data as "can't compute quality" rather than
// crashing.

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

// ── Status types ─────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'fail' | 'unknown'

interface DimensionResult {
  status: Status
  /** Raw current value (units depend on dimension). */
  current: number | null
  /** Target value (units match current). */
  target: number | null
  /** Headline text — "6h 48m → 7h 30m" or similar. */
  headline: string
  /** Data-driven action line (coach voice). */
  action: string
  /** 14-day history (most recent last). Null entries = no data that day. */
  spark: (number | null)[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nDaysAgoIso(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (n - 1))
  return d.toISOString()
}

/**
 * Age in years from a birthdate, or null if missing/invalid. Mirrors the
 * Heart page's estimateAge so the two surfaces use the same age math.
 */
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
 *
 *   Teens (13–17)  → 9.0 h     (NSF / AASM growth-stage recommendation)
 *   Adults (18–64) → 7.0 h     (CDC / AASM adult floor)
 *   65+            → 7.5 h     (slight uptick — broader optimal window)
 *
 * Fallback (no birthdate) → 7.0 h. birthdate is required at signup so
 * this path shouldn't fire in practice; defensive guard only.
 */
function targetHoursForAge(birthdate: string | null | undefined): number {
  const age = estimateAge(birthdate)
  if (age == null)       return 7.0
  if (age >= 13 && age <= 17) return 9.0
  if (age >= 65)         return 7.5
  return 7.0
}

/**
 * Classifies a numeric metric vs. its target, using a two-band tolerance.
 *
 *   |delta| / target ≤ warnPct → 'ok'    (✓)
 *   |delta| / target ≤ failPct → 'warn'  (⚠)
 *   otherwise                  → 'fail'  (✗)
 *
 * Per locked product decision, the Duration / Bedtime / Consistency
 * dimensions all use warnPct=0.10 / failPct=0.25. Quality has its own
 * built-in three-state classifier (split metric).
 */
function classifyDimension(
  value:    number,
  target:   number,
  warnPct:  number = 0.10,
  failPct:  number = 0.25,
): Status {
  if (target <= 0) return 'unknown'
  const offPct = Math.abs(value - target) / target
  if (offPct <= warnPct) return 'ok'
  if (offPct <= failPct) return 'warn'
  return 'fail'
}

/**
 * Sleep-quality classifier (split metric, locked):
 *   deep / total ≥ 18%  AND  rem / total ≥ 20%   → 'ok'
 *   exactly ONE of the two passes                → 'warn'
 *   neither passes                               → 'fail'
 *
 * Returns 'unknown' if any of the inputs is null/missing/zero (the
 * session didn't report stage breakdown).
 */
function classifyQuality(
  deep_s: number | null,
  rem_s:  number | null,
  total_s: number,
): { status: Status; deepPct: number | null; remPct: number | null } {
  if (deep_s == null || rem_s == null || total_s <= 0) {
    return { status: 'unknown', deepPct: null, remPct: null }
  }
  const deepPct = deep_s / total_s
  const remPct  = rem_s  / total_s
  const deepOK = deepPct >= 0.18
  const remOK  = remPct  >= 0.20
  if (deepOK && remOK) return { status: 'ok',   deepPct, remPct }
  if (deepOK || remOK) return { status: 'warn', deepPct, remPct }
  return { status: 'fail', deepPct, remPct }
}

/**
 * Combines four dimension statuses into one verdict — drives the
 * edge-stripe colour on the top verdict card and the secondary count
 * line ("X of 4 dimensions need attention").
 */
function computeVerdict(statuses: Status[]): {
  color:        string
  offCount:     number
  knownCount:   number
} {
  const known = statuses.filter(s => s !== 'unknown')
  const off   = known.filter(s => s === 'warn' || s === 'fail').length
  let color: string
  if (off === 0)      color = palette.emerald[400]
  else if (off <= 2)  color = palette.amber[400]
  else                color = palette.red[400]
  return { color, offCount: off, knownCount: known.length }
}

/** Format a duration in seconds → "Nh Mm" (e.g. "7h 30m") or "Nm". */
function fmtHoursMinutes(s: number | null): string {
  if (s == null) return '—'
  const totalMin = Math.round(s / 60)
  const h        = Math.floor(totalMin / 60)
  const m        = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Format hours-only (1 dec). "7h", "7.5h". */
function fmtHoursOnly(h: number): string {
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

/**
 * Convert seconds-since-midnight (anchored to "previous day") to a
 * human-friendly clock string. Bedtime values can wrap past midnight
 * (a bedtime at 25.5 means 1:30 AM next day) so we mod by 24 h before
 * formatting.
 */
function fmtBedtime(secsFromMidnight: number | null): string {
  if (secsFromMidnight == null) return '—'
  const wrapped = ((secsFromMidnight % 86_400) + 86_400) % 86_400
  const h24     = Math.floor(wrapped / 3600)
  const m       = Math.floor((wrapped % 3600) / 60)
  const h12     = ((h24 + 11) % 12) + 1
  const period  = h24 < 12 ? 'AM' : 'PM'
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * Compute a session's "bedtime offset" — seconds from local midnight,
 * with the convention that sleep onset after 6 PM the previous day
 * maps to NEGATIVE seconds (so 10 PM = -7200, 12 AM = 0, 2 AM = +7200).
 * This gives us a continuous axis to average / compute std-dev on
 * without the wrap-around at midnight confounding the math.
 */
function bedtimeOffsetSeconds(iso: string): number {
  const d        = new Date(iso)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let offset = (d.getTime() - midnight.getTime()) / 1000
  // If sleep started after 6 PM, treat it as previous-day evening.
  if (offset >= 18 * 3600) offset -= 86_400
  return offset
}

/** Standard deviation of a numeric series. Returns 0 for <2 points. */
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

function statusLabel(s: Status): string {
  switch (s) {
    case 'ok':      return 'On target'
    case 'warn':    return 'Slightly off'
    case 'fail':    return 'Off target'
    case 'unknown': return 'No data'
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

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

    // Two windows + latest-night stages. All gated by user_id; RLS does
    // the actual enforcement on the server.
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

    // PGRST205 = relation does not exist (sibling agent hasn't shipped
    // the migration yet). Treat as "no data" rather than crashing.
    const ok7  = !r7.error  || r7.error.code  === 'PGRST205'
    const ok30 = !r30.error || r30.error.code === 'PGRST205'
    if (ok7)  setSessions7(r7.data  ?? [])
    if (ok30) setSessions30(r30.data ?? [])

    // Most recent night's stage timeline for the hypnogram. Skipped
    // when no sessions exist.
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

  // ── Sync-on-focus ──────────────────────────────────────────────────────────
  // Same pattern as Heart page — fetch fresh data every time the tab is
  // opened. No background sync — sleep data lands when the athlete logs
  // a session (input form is pending).

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

  // ── Derived dimensions ─────────────────────────────────────────────────────

  const targetHours = useMemo(
    () => targetHoursForAge(profile?.birthdate),
    [profile?.birthdate],
  )
  const targetSecs = targetHours * 3600

  // 14-day spark window (subset of the 30-day fetch)
  const sparkWindowSecs = useMemo(() => {
    const cutoff = nDaysAgoIso(14)
    const inWin  = sessions30
      .filter(s => s.start_at >= cutoff)
      .slice()
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
    return inWin
  }, [sessions30])

  // ── Dimension 1: Total sleep ───────────────────────────────────────────────

  const durationDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   targetSecs,
        headline: `Target ${fmtHoursOnly(targetHours)} — no data yet`,
        action:   'Sleep logging is coming. Once the in-app entry form ships, your duration shows up here as soon as you log a night.',
        spark:    [],
      }
    }
    const avg = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const status = classifyDimension(avg, targetSecs)
    const diffMin = Math.round((targetSecs - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → ${fmtHoursOnly(targetHours)}`

    let action: string
    if (status === 'ok') {
      action = `You're averaging ${fmtHoursMinutes(avg)} — within range. Keep your bedtime consistent and your body keeps banking this duration.`
    } else if (avg < targetSecs) {
      action = `You're averaging ${fmtHoursMinutes(avg)}, target is ${fmtHoursOnly(targetHours)}. Going to bed ${Math.abs(diffMin)} minutes earlier each night closes the gap in about two weeks — your body adapts faster than you'd think.`
    } else {
      action = `You're averaging ${fmtHoursMinutes(avg)} — slightly above target. Not harmful, but check whether the extra time reflects fatigue or recovery from a hard week.`
    }
    return {
      status,
      current: avg,
      target:  targetSecs,
      headline,
      action,
      spark:   sparkWindowSecs.map(s => s.duration_s),
    }
  }, [sessions7, sparkWindowSecs, targetSecs, targetHours])

  // ── Dimension 2: Sleep quality (split deep+REM) ───────────────────────────

  const qualityDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   null,
        headline: 'Deep ≥18%  ·  REM ≥20%',
        action:   'Quality numbers appear once at least one full night with stage detail is logged.',
        spark:    [],
      }
    }
    // Aggregate across the 7-day window — sum stages then take ratio.
    let deepSum = 0, remSum = 0, totalSum = 0
    let stageBearing = 0
    for (const s of sessions7) {
      if (s.deep_s != null && s.rem_s != null && s.duration_s > 0) {
        deepSum  += s.deep_s
        remSum   += s.rem_s
        totalSum += s.duration_s
        stageBearing += 1
      }
    }
    if (stageBearing === 0 || totalSum === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   null,
        headline: 'Deep ≥18%  ·  REM ≥20%',
        action:   'Your logged sessions are duration-only so far. Stage detail (deep / REM / light / awake) unlocks the quality grade here.',
        spark:    [],
      }
    }
    const { status, deepPct, remPct } = classifyQuality(deepSum, remSum, totalSum)
    const deepLabel = deepPct != null ? `Deep ${Math.round(deepPct * 100)}%` : 'Deep —'
    const remLabel  = remPct  != null ? `REM ${Math.round(remPct * 100)}%`   : 'REM —'
    const headline  = `${deepLabel}  ·  ${remLabel}`

    let action: string
    if (status === 'ok') {
      action = "Stage balance is solid — deep and REM both meet the targets that drive physical recovery and memory consolidation."
    } else if (deepPct != null && deepPct < 0.18 && remPct != null && remPct >= 0.20) {
      action = `Deep sleep is below 18% — physical recovery suffers when this stage is short. Try a cooler bedroom (≤67°F) and avoid heavy meals within 3 hours of bed.`
    } else if (remPct != null && remPct < 0.20 && deepPct != null && deepPct >= 0.18) {
      action = `REM is consistently below 20% — REM is when memory and emotional processing happen. Cutting alcohol within 3 hours of bed is the single biggest lever; alcohol suppresses REM directly.`
    } else {
      action = `Both deep and REM are below target — this usually points at fragmented sleep. The two highest-leverage moves are: hold a consistent bedtime within a 30-minute window, and avoid alcohol within 3 hours of bed.`
    }
    // Spark — per-night quality score (deep+rem)/total
    const spark = sparkWindowSecs.map(s =>
      s.deep_s != null && s.rem_s != null && s.duration_s > 0
        ? (s.deep_s + s.rem_s) / s.duration_s
        : null,
    )
    return {
      status,
      current: deepPct != null && remPct != null ? deepPct + remPct : null,
      target:  null,
      headline,
      action,
      spark,
    }
  }, [sessions7, sparkWindowSecs])

  // ── Dimension 3: Bedtime ────────────────────────────────────────────────────
  // We don't know the user's TARGET bedtime explicitly. Derive it from the
  // user's typical wake time and the targetHours: target_bed = wake - target.

  const bedtimeDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        current:  null,
        target:   null,
        headline: 'No bedtime data yet',
        action:   "Once you log a few nights, we'll compute your target bedtime from your typical wake time.",
        spark:    [],
      }
    }
    // Average bedtime offset (seconds from local midnight, negative for
    // before-midnight starts).
    const offsets = sessions7.map(s => bedtimeOffsetSeconds(s.start_at))
    const avgOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length

    // Average wake time (seconds since midnight on the wake day).
    const wakeOffsets = sessions7.map(s => {
      const d        = new Date(s.end_at)
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      return (d.getTime() - midnight.getTime()) / 1000
    })
    const avgWake = wakeOffsets.reduce((a, b) => a + b, 0) / wakeOffsets.length

    // Target bedtime offset = avgWake - targetSecs (may be negative).
    const targetOffset = avgWake - targetSecs

    // Classify on absolute minutes-off rather than percentage (bedtime
    // doesn't have a natural ratio). 30 min tolerance for ok, 60 min for warn.
    const offsetDiffMin = Math.abs(avgOffset - targetOffset) / 60
    const status: Status =
      offsetDiffMin <= 30 ? 'ok' :
      offsetDiffMin <= 60 ? 'warn' :
      'fail'

    const currentLabel = fmtBedtime(avgOffset)
    const targetLabel  = fmtBedtime(targetOffset)
    const wakeLabel    = fmtBedtime(avgWake)
    const headline     = `${currentLabel} → ${targetLabel}`

    let action: string
    if (status === 'ok') {
      action = `Your average bedtime is ${currentLabel} — aligned with your ${wakeLabel} wake time and ${fmtHoursOnly(targetHours)} target.`
    } else if (avgOffset > targetOffset) {
      const diff = Math.round(offsetDiffMin)
      action = `Your average bedtime is ${currentLabel}. Shifting it to ${targetLabel} (${diff} minutes earlier) puts you on target with your ${wakeLabel} wake time.`
    } else {
      const diff = Math.round(offsetDiffMin)
      action = `Your average bedtime is ${currentLabel} — earlier than the ${targetLabel} target. That's fine if you wake naturally feeling rested, but consider shifting ${diff} minutes later if mornings feel rushed.`
    }
    return {
      status,
      current: avgOffset,
      target:  targetOffset,
      headline,
      action,
      spark:   sparkWindowSecs.map(s => bedtimeOffsetSeconds(s.start_at)),
    }
  }, [sessions7, sparkWindowSecs, targetSecs, targetHours])

  // ── Dimension 4: Consistency (std-dev of bedtimes) ────────────────────────

  const consistencyDim: DimensionResult = useMemo(() => {
    if (sessions7.length < 3) {
      return {
        status:   'unknown',
        current:  null,
        target:   30 * 60,
        headline: 'Log 3+ nights to see consistency',
        action:   'Consistency needs at least three logged nights. Log a few more and this card lights up.',
        spark:    [],
      }
    }
    const offsets = sessions7.map(s => bedtimeOffsetSeconds(s.start_at))
    const sd = stdDev(offsets)
    const sdMin = sd / 60
    // Target: std-dev under 30 min. warn under 60 min. fail beyond.
    const status: Status =
      sdMin <= 30 ? 'ok' :
      sdMin <= 60 ? 'warn' :
      'fail'
    const headline = `±${Math.round(sdMin)} min  →  ±30 min`
    let action: string
    if (status === 'ok') {
      action = `Your bedtimes cluster within ±${Math.round(sdMin)} minutes — that consistency is what teaches your circadian rhythm when to release melatonin.`
    } else {
      action = `Your bedtimes vary by ±${Math.round(sdMin)} minutes night-to-night. Pick one bedtime and hold it within a 30-minute window — your body's clock learns fastest from a stable schedule, not from "average" times.`
    }
    return {
      status,
      current: sd,
      target:  30 * 60,
      headline,
      action,
      spark:   sparkWindowSecs.map(s => bedtimeOffsetSeconds(s.start_at)),
    }
  }, [sessions7, sparkWindowSecs])

  // ── Verdict (top card) ─────────────────────────────────────────────────────

  const verdict = useMemo(() => {
    return computeVerdict([
      durationDim.status, qualityDim.status,
      bedtimeDim.status, consistencyDim.status,
    ])
  }, [durationDim, qualityDim, bedtimeDim, consistencyDim])

  // Verdict headline text. Picks the dimension most off-target for the
  // lead sentence; falls back to a generic "you're on track" message
  // when nothing is off.
  const verdictText = useMemo(() => {
    if (sessions7.length === 0) {
      return 'No nights logged yet. Once you log a few, your weekly verdict shows here.'
    }
    const avgSec = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const avgLabel = fmtHoursMinutes(avgSec)
    if (verdict.offCount === 0) {
      return `Your sleep is averaging ${avgLabel} — on track across all four dimensions. Keep your rhythm steady.`
    }
    // Identify the lead dimension (most off): pick first 'fail', else first 'warn'.
    const items: Array<{ name: string; status: Status }> = [
      { name: 'duration',     status: durationDim.status },
      { name: 'quality',      status: qualityDim.status },
      { name: 'bedtime',      status: bedtimeDim.status },
      { name: 'consistency',  status: consistencyDim.status },
    ]
    const lead = items.find(i => i.status === 'fail')
              ?? items.find(i => i.status === 'warn')
    const offCountStr = `${verdict.offCount} of ${verdict.knownCount} dimensions need attention`
    if (!lead) return `Your sleep is averaging ${avgLabel} — ${offCountStr}.`
    return `Your sleep is averaging ${avgLabel} — ${offCountStr}, starting with ${lead.name}.`
  }, [sessions7, verdict, durationDim, qualityDim, bedtimeDim, consistencyDim])

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

  // ── 30-day sparkline ───────────────────────────────────────────────────────

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
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.h1}>Sleep</Text>
        <Text style={s.h1Sub}>
          {hasAnyData
            ? `Target ${fmtHoursOnly(targetHours)}  ·  ${sessions7.length} ${sessions7.length === 1 ? 'night' : 'nights'} logged this week`
            : 'Sleep logging is coming. Log nights manually for now to see this page populate.'}
        </Text>
      </View>

      {/* Loading skeleton — placeholder cards while the initial Supabase
          fetch resolves on cold-start. Approximates the rendered surface:
          verdict card + 2x2 dimension grid + hypnogram + sparkline. Only
          shown when there's no cached sleep data yet. */}
      {loading && !hasAnyData && (
        <View style={{ gap: 16 }}>
          <Skeleton style={{ height: 90, width: '100%', borderRadius: 12 }} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 140, flex: 1, borderRadius: 12 }} />
          </View>
          <Skeleton style={{ height: 100, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 180, width: '100%', borderRadius: 12 }} />
        </View>
      )}

      {/* ── Empty state — no sleep data yet ──────────────────────────────── */}
      {/*
        Sleep logging is coming as an in-app entry form (not a wearable
        pull). Until the form ships, every athlete lands on this card.
        The CTA is intentionally absent — there's nothing actionable
        for the user to do right now. Once the input form lands, this
        empty state gains a "Log last night" button that opens the
        form, and the rest of the page (verdict / dimensions / chart)
        starts populating from sleep_sessions + sleep_stages.
      */}
      {!loading && !hasAnyData && (
        <AnimateRise delay={0} style={s.card}>
          <Moon size={20} color={palette.indigo[400]} />
          <Text style={s.emptyTitle}>Sleep logging is coming</Text>
          <Text style={s.emptyBody}>
            Sleep is one of the four levers that decide how you train, recover, and feel. We're building the entry form so you can log last night's duration, stage detail, and bedtime in a few taps — then this page grades you across duration, quality, bedtime, and consistency, with a concrete next step for whichever dimension's off.
          </Text>
        </AnimateRise>
      )}

      {/* ── Verdict card ─────────────────────────────────────────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={0}>
          <View style={[
            s.verdictCard,
            { borderLeftColor: verdict.color },
          ]}>
            <View style={s.verdictHead}>
              <Moon size={16} color={verdict.color} />
              <Text style={[s.verdictBadge, { color: verdict.color }]}>
                THIS WEEK
              </Text>
            </View>
            <Text style={s.verdictText}>{verdictText}</Text>
          </View>
        </AnimateRise>
      )}

      {/* ── 2×2 dimension grid ───────────────────────────────────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={250}>
          <View style={s.dimGrid}>
            <DimensionCard
              icon={<Clock size={14} color={statusColor(durationDim.status)} />}
              label="Duration"
              dim={durationDim}
            />
            <DimensionCard
              icon={<Activity size={14} color={statusColor(qualityDim.status)} />}
              label="Quality"
              dim={qualityDim}
            />
            <DimensionCard
              icon={<BedDouble size={14} color={statusColor(bedtimeDim.status)} />}
              label="Bedtime"
              dim={bedtimeDim}
            />
            <DimensionCard
              icon={<Repeat size={14} color={statusColor(consistencyDim.status)} />}
              label="Consistency"
              dim={consistencyDim}
            />
          </View>
        </AnimateRise>
      )}

      {/* ── Last night hypnogram ─────────────────────────────────────────── */}
      {!loading && hasAnyData && latestSession && (
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
          {hypnoSegments.length > 0 ? (
            <Hypnogram
              segments={hypnoSegments}
              sessionStart={latestSession.start_at}
              sessionEnd={latestSession.end_at}
            />
          ) : (
            <Text style={s.hypnoFallback}>
              Stage detail wasn’t captured for this session — only total duration is available.
            </Text>
          )}
        </AnimateRise>
      )}

      {/* ── 30-day duration trend ────────────────────────────────────────── */}
      {!loading && hasAnyData && monthSeries.length > 0 && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.cardLabel}>Duration — last 30 days</Text>
          <Text style={s.cardSub}>
            Each bar is one night. Dashed line is your {fmtHoursOnly(targetHours)} target.
          </Text>
          <MonthlySparkline
            values={monthSeries}
            target={targetHours}
          />
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
  // Filter out nulls but preserve original x-positions so gaps render
  // as gaps (broken line) rather than collapsed.
  const valid = values
    .map((v, i) => v == null ? null : { x: i, v })
    .filter((p): p is { x: number; v: number } => p != null)
  if (valid.length < 2) {
    return <View style={{ width, height, opacity: 0.4 }} />
  }
  const xs = valid.map(p => p.x)
  const vs = valid.map(p => p.v)
  const xMin = 0
  const xMax = values.length - 1
  const yMin = Math.min(...vs)
  const yMax = Math.max(...vs)
  const yRange = Math.max(1e-6, yMax - yMin)
  function tx(x: number) { return (x - xMin) / Math.max(1, xMax - xMin) * width }
  function ty(v: number) { return height - 2 - ((v - yMin) / yRange) * (height - 4) }

  // Build path with gap support: 'M' for first point and after gaps,
  // 'L' otherwise. Walk the ORIGINAL index sequence.
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
// 30-day vertical-bar chart with a dashed target reference line.

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
          {/* Bars */}
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
          {/* Dashed target line */}
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
  cardLabel: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  cardSub:   { color: colors.mutedForeground, fontSize: 12, marginTop: -6 },

  emptyTitle:    { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  emptyBody:     { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },

  // Verdict card — accent edge stripe on the left tells the user at-a-glance
  // whether the week is on-track / partially-off / mostly-off.
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

  // 2×2 dimension grid — flexBasis 46% means two columns with a 10px gap.
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
    fontSize:   16,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
  },
  dimAction: {
    color:      colors.mutedForeground,
    fontSize:   11,
    lineHeight: 16,
  },

  // Hypnogram card meta-row — clock range + total duration
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
  hypnoFallback: {
    color:    colors.mutedForeground,
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
})
