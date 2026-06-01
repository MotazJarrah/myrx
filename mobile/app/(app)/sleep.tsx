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
  RefreshControl, Pressable, type LayoutChangeEvent,
} from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated'

// Animation timings for the pill expansion. The panel's HEIGHT animates
// from 0 → measured-content-height (and back), which means every view
// below it cascades naturally via React Native's normal layout flow —
// no layout-animation system needed. Sibling DimensionRows + Last Sleep
// Cycle card + Duration trend card all get pushed down by the panel's
// real height growing, not by a separate layout-animation pass.
const PANEL_OPEN_DURATION  = 240
const PANEL_CLOSE_DURATION = 200
const PANEL_EASING         = Easing.bezier(0.16, 1, 0.3, 1)  // out-quint, same curve as AnimateRise
import { useFocusEffect } from 'expo-router'
import {
  Moon, Clock, Activity, BedDouble, Brain, Info,
} from 'lucide-react-native'
// Skia-migrated 2026-05-31. The inline SparkLine + MonthlySparkline charts
// previously used react-native-svg <Svg>/<Path>/<Line>; they now render via
// @shopify/react-native-skia for GPU-backed paint, matching the rest of the
// Sleep page (SleepClock + Hypnogram already on Skia). See Pattern 9 in
// CLAUDE.md + mobile/src/components/SleepClock.tsx as the canonical reference.
import { Canvas, Path as SkiaPath, Skia } from '@shopify/react-native-skia'

import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import AnimateRise from '../../src/components/AnimateRise'
import TickerNumber from '../../src/components/TickerNumber'
import SleepClock, { type SleepClockNight, type SleepClockReadout } from '../../src/components/SleepClock'
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
  headline: string
  action:   string
  /**
   * Per-stat info pill expansion text. Strictly the SCIENCE/MECHANISM
   * behind this dimension — no target values, no current values, no
   * coaching actions (those live elsewhere on the row). Explains "what
   * this stat is and why it matters" only.
   */
  whyText:  string
  spark:    (number | null)[]
  /**
   * Y value of the target reference line drawn across the sparkline.
   * For Total/Deep/REM this equals `target` (spark values are in the same
   * units as target). For Schedule this is 0 because the spark values are
   * pre-normalized to "seconds earlier than target bedtime" so up = good.
   * Null = no target line drawn.
   */
  sparkTarget: number | null
}

// ── Time-based classifiers (locked May 31 2026) ──────────────────────────────

/**
 * Total sleep status — based on minutes off target.
 *
 * Thresholds grounded in chronic sleep-restriction dose-response data:
 *   - Belenky et al. 2003 (Sleep): 7h time-in-bed (≈30 min short of 7.5h
 *     adult target) showed reduced PVT response speed but no significant
 *     lapse increase — boundary between functional and degraded.
 *   - Van Dongen et al. 2003 (Sleep): chronic 6h sleep over 14 nights
 *     ( ≈60 min short) produced significant cumulative cognitive deficits.
 *     Chronic 4h sleep (≈180 min short) approached the cognitive deficit
 *     of total sleep deprivation.
 *
 * Mapped to OK/WARN/FAIL:
 *   |delta| ≤ 30 min → ok    (within Belenky's "still mostly functional")
 *   |delta| ≤ 90 min → warn  (Van Dongen 6h-chronic cumulative deficits)
 *   else            → fail   (approaching Van Dongen 4h-chronic territory)
 *
 * Symmetric (absolute value) because Li 2022 U-curve shows over-sleeping
 * harms cognition too — the +90 min FAIL band catches 9h+ on a 7h target.
 */
function classifyTotal(actualS: number, targetS: number): Status {
  const offMin = Math.abs(actualS - targetS) / 60
  if (offMin <= 30) return 'ok'
  if (offMin <= 90) return 'warn'
  return 'fail'
}

/**
 * Deep / REM sleep status — based on minutes short of target.
 *
 * Threshold grounded in MCI vs. cognitively-normal comparisons:
 *   - Yu et al. 2024 (PMC): MCI patients had ~4.3% LESS deep sleep than
 *     cognitively-normal controls. On a 7h night, 4.3% ≈ 18 minutes.
 *     So a 15-min deep deficit sits right at the MCI-distinguishing edge;
 *     >30 min is well into MCI-associated territory.
 *
 * Only the short-direction matters; getting MORE than target is fine.
 */
function classifyStage(actualS: number, targetS: number): Status {
  if (actualS >= targetS) return 'ok'  // at-or-above target
  const shortMin = (targetS - actualS) / 60
  if (shortMin <= 15) return 'ok'      // within MCI-distinguishing edge
  if (shortMin <= 30) return 'warn'    // approaching MCI deficit territory
  return 'fail'                         // well past MCI-distinguishing deficit
}

/**
 * Bedtime status — minutes late vs the target bedtime.
 *
 * Threshold grounded in the social-jetlag literature:
 *   - Wittmann et al. 2006 (Chronobiology International): coined "social
 *     jetlag" as ≥1h offset between work-day and free-day sleep midpoints,
 *     associated with BMI, smoking, cardiometabolic markers.
 *   - Roenneberg et al. 2012: each 1h of social jetlag → ~33% increase in
 *     overweight risk.
 *
 * Mapped to OK/WARN/FAIL on a single bedtime drift:
 *   late ≤ 15 min → ok    (within natural day-to-day variation)
 *   late ≤ 60 min → warn  (drift toward but below social-jetlag threshold)
 *   else        → fail   (≥1h late = clinically meaningful misalignment)
 *
 * Going to bed EARLIER than target is fine.
 */
function classifyBedtime(actualOffsetS: number, targetOffsetS: number): Status {
  const lateMin = (actualOffsetS - targetOffsetS) / 60
  if (lateMin <= 15) return 'ok'
  if (lateMin <= 60) return 'warn'     // social-jetlag boundary (Wittmann 2006)
  return 'fail'
}

/**
 * Consistency status — std-dev of bedtime offsets across the week.
 *
 * Thresholds grounded in sleep-regularity actigraphy research:
 *   - Lunsford-Avery et al. 2018 (Scientific Reports): bedtime SD ≤30 min
 *     classified as "regular sleeper"; >60 min strongly associated with
 *     glucose intolerance, BMI, depression.
 *   - Windred et al. 2024 (Sleep): UK Biobank N≈88k, sleep-regularity
 *     index (SRI) showed 20-48% lower all-cause mortality in top-4
 *     quintiles vs least-regular quintile — confirming the dose-response
 *     of bedtime variability on hard health outcomes.
 *
 *   ≤ 30 min stddev → ok    (Lunsford-Avery "regular sleeper")
 *   ≤ 60 min stddev → warn  (between regular and irregular thresholds)
 *   else           → fail   (Lunsford-Avery clinically irregular zone)
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
  if (age < 0 || age > 120) return null
  return age
}

/**
 * Target sleep duration in HOURS, age-banded per published consensus.
 *
 * Sources:
 *   - AASM Paruthi et al. 2016 (Journal of Clinical Sleep Medicine)
 *     covers 4 months to 18 years (range midpoints used as targets).
 *   - NSF Hirshkowitz et al. 2015 (Sleep Health) handles newborns
 *     (0-3 months) which AASM excluded, and provides the 18+ baseline.
 *   - Li et al. 2022 (Nature Aging) — UK Biobank cohort N≈500k aged
 *     38-73 — establishes 7h as the cognitive + mental-health optimum
 *     for adults, refining NSF's 7-9h range to a more precise center.
 *
 * Band edges chosen so each year-of-age has exactly one assigned target.
 * Young-adult value (18-25) sits at the upper end of NSF's range because
 * the brain is still maturing until ~25; Li's cohort started at 38 so
 * the 7h optimum doesn't strictly apply to younger adults yet.
 */
function targetHoursForAge(birthdate: string | null | undefined): number {
  const age = estimateAge(birthdate)
  if (age == null) return 7.0  // unknown age → use the adult optimum (Li 2022)
  if (age <= 0)    return 15.0 // 0-3 months   — NSF 2015 (range 14-17h)
  if (age <= 1)    return 13.0 // 4-11 months  — AASM 2016 (range 12-16h)
  if (age <= 2)    return 12.0 // 1-2 years    — AASM 2016 (range 11-14h)
  if (age <= 5)    return 11.0 // 3-5 years    — AASM 2016 (range 10-13h)
  if (age <= 12)   return 10.0 // 6-12 years   — AASM 2016 (range 9-12h)
  if (age <= 17)   return 9.0  // 13-17 years  — AASM 2016 (range 8-10h)
  if (age <= 25)   return 7.5  // 18-25 years  — NSF 2015 (range 7-9h)
  return 7.0                    // 26+ years    — Li 2022 Nature Aging
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


/** Hour-of-day decimal → 12h clock string like "8:00 PM". */
function fmtClock12(h: number): string {
  const wrapped = ((h % 24) + 24) % 24
  const hr      = Math.floor(wrapped)
  const min     = Math.floor((wrapped - hr) * 60)
  const period  = hr < 12 ? 'AM' : 'PM'
  const h12     = ((hr + 11) % 12) + 1
  return min === 0
    ? `${h12} ${period}`
    : `${h12}:${String(min).padStart(2, '0')} ${period}`
}

export default function SleepPage() {
  const { profile } = useAuth()

  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sessions7,  setSessions7]  = useState<SleepSessionRow[]>([])
  const [sessions30, setSessions30] = useState<SleepSessionRow[]>([])
  const [latestStages, setLatestStages] = useState<SleepStageRow[]>([])
  // SleepClock pushes its currently-selected ring (day + time + duration)
  // up here via onActiveChange. We re-render this in a row directly under
  // the clock so the user always sees the selected day's details.
  const [clockReadout, setClockReadout] = useState<SleepClockReadout | null>(null)
  // (Removed May 31 2026) — the "How we compute" panel state lived
  // here but its corresponding UI was deleted when the verdict banner
  // was retired. Per-row info pills now live inside each DimensionRow
  // and own their own state.

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

  // Computed avg bedtime + wake time (decimal hours, local TZ). Used by
  // both the Schedule dim AND the bedtime-anchored cue registry. Derived
  // from logs — no settings input required. When the user has no nights
  // yet, falls back to 0 (caller checks sessions7.length before using).
  const avgBedHour = useMemo(() => {
    if (sessions7.length === 0) return 0
    const offsets = sessions7.map(s => bedtimeOffsetSeconds(s.start_at))
    return offsets.reduce((a, b) => a + b, 0) / offsets.length / 3600
  }, [sessions7])
  const avgWakeHour = useMemo(() => {
    if (sessions7.length === 0) return 0
    const offsets = sessions7.map(s => wakeOffsetSeconds(s.end_at))
    return offsets.reduce((a, b) => a + b, 0) / offsets.length / 3600
  }, [sessions7])

  // ── Dimension 1: Total sleep ───────────────────────────────────────────────

  const totalDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        headline: `Target ${fmtHoursOnly(targetHours)}`,
        action:   "Log a few nights and your average shows up here.",
        whyText:  "How long you sleep each night. It's the foundation under cognition, mood, immunity, and hormones — when this slips, everything else slips with it. Push bedtime earlier in small steps and protect it.",
        spark:    [],
        sparkTarget: null,
      }
    }
    const avg = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const status = classifyTotal(avg, targetSecs)
    const diffMin = Math.round((targetSecs - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → ${fmtHoursOnly(targetHours)}`

    // Terse "do this" — no explanation, no protocol names, and
    // intentionally avoids the word "bedtime" so it doesn't duplicate
    // the Bedtime row's action (that row owns the bedtime lever).
    // Sleep duration owns the DURATION outcome — the lever named here
    // is the wake side or total-hours framing.
    let action: string
    if (status === 'ok') {
      action = `On target — hold this.`
    } else if (avg < targetSecs) {
      action = `Sleep 15 minutes earlier this week.`
    } else {
      action = `Cap at your target — wake 15 minutes earlier.`
    }
    return {
      status, headline, action,
      whyText: "How long you sleep each night. It's the foundation under cognition, mood, immunity, and hormones — when this slips, everything else slips with it. Push bedtime earlier in small steps and protect it.",
      spark: sparkWindow.map(s => s.duration_s),
      sparkTarget: targetSecs,
    }
  }, [sessions7, sparkWindow, targetSecs, targetHours])

  // ── Dimension 2: Deep sleep ────────────────────────────────────────────────

  const deepDim: DimensionResult = useMemo(() => {
    const sessionsWithStages = sessions7.filter(s => s.deep_s != null)
    if (sessionsWithStages.length === 0) {
      return {
        status:   'unknown',
        headline: `Target 90 min`,
        action:   "Wear your watch overnight to track this.",
        whyText:  "The non-dreaming stage where your body does its physical repairs — growth hormone release, immune maintenance, brain waste clearance. A cool, dark room and an earlier bedtime push more of it through.",
        spark:    [],
        sparkTarget: null,
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.deep_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, DEEP_TARGET_S)
    const shortMin = Math.round((DEEP_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    // Terse "do this" — no explanation, no overlap with whyText.
    let action: string
    if (status === 'ok') {
      action = `On target — hold this.`
    } else if (shortMin > 0) {
      action = `Drop the bedroom temperature a few degrees tonight.`
    } else {
      action = `At target.`
    }
    return {
      status, headline, action,
      whyText: "The non-dreaming stage where your body does its physical repairs — growth hormone release, immune maintenance, brain waste clearance. A cool, dark room and an earlier bedtime push more of it through.",
      spark: sparkWindow.map(s => s.deep_s),
      sparkTarget: DEEP_TARGET_S,
    }
  }, [sessions7, sparkWindow])

  // ── Dimension 3: REM sleep ─────────────────────────────────────────────────

  const remDim: DimensionResult = useMemo(() => {
    const sessionsWithStages = sessions7.filter(s => s.rem_s != null)
    if (sessionsWithStages.length === 0) {
      return {
        status:   'unknown',
        headline: `Target 90 min`,
        action:   "Wear your watch overnight to track this.",
        whyText:  "The dream stage where your brain consolidates learning, regulates emotion, and processes memory. It clusters in the back half of the night, so sleeping the full duration is what unlocks it. Skip evening alcohol and you'll see more of it.",
        spark:    [],
        sparkTarget: null,
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.rem_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, REM_TARGET_S)
    const shortMin = Math.round((REM_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    // Terse "do this" — no overlap with whyText.
    let action: string
    if (status === 'ok') {
      action = `On target — hold this.`
    } else if (shortMin > 0) {
      action = `Skip alcohol within 4 hours of bed tonight.`
    } else {
      action = `At target.`
    }
    return {
      status, headline, action,
      whyText: "The dream stage where your brain consolidates learning, regulates emotion, and processes memory. It clusters in the back half of the night, so sleeping the full duration is what unlocks it. Skip evening alcohol and you'll see more of it.",
      spark: sparkWindow.map(s => s.rem_s),
      sparkTarget: REM_TARGET_S,
    }
  }, [sessions7, sparkWindow])

  // ── Dimension 4: Schedule (bedtime + consistency rolled) ───────────────────

  const scheduleDim: DimensionResult = useMemo(() => {
    if (sessions7.length === 0) {
      return {
        status:   'unknown',
        headline: 'No data yet',
        action:   "Log a few nights and your bedtime + consistency grade appear here.",
        whyText:  "When you fall asleep, and how steady it stays night to night. Your body anchors its internal rhythm to when you wake — drift the wake time and hormones, body temperature, and digestion drift with it. Lock the wake time first; bedtime falls in behind it.",
        spark:    [],
        sparkTarget: null,
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
    const headline = consistencyStatus === 'unknown'
      ? `${currentBedLabel} → ${targetBedLabel}`
      : `${currentBedLabel} · ±${Math.round(sdMin)}m`

    // Terse "do this" — no explanation, no overlap with whyText.
    let action: string
    if (status === 'ok') {
      action = `On target — hold this.`
    } else if (bedStatus !== 'ok' && consistencyStatus === 'fail') {
      action = `Lock your alarm at ${fmtClock12(avgWakeHour)} every day.`
    } else if (bedStatus !== 'ok') {
      action = `Move bedtime to ${targetBedLabel}.`
    } else {
      action = `Lock your alarm at ${fmtClock12(avgWakeHour)} every day.`
    }

    // Spark values inverted so UP = went to bed earlier (better). Each value
    // is "seconds earlier than target bedtime". The sparkTarget line is at 0
    // (= exactly on target). Positive = early, negative = late.
    return {
      status, headline, action,
      whyText: "When you fall asleep, and how steady it stays night to night. Your body anchors its internal rhythm to when you wake — drift the wake time and hormones, body temperature, and digestion drift with it. Lock the wake time first; bedtime falls in behind it.",
      spark: sparkWindow.map(s => targetBed - bedtimeOffsetSeconds(s.start_at)),
      sparkTarget: 0,
    }
  }, [sessions7, sparkWindow, targetSecs, targetHours])

  // ── Sleep Clock data ───────────────────────────────────────────────────────
  // (Verdict + verdictText + lead useMemos lived here until May 31 2026 —
  //  they fed the now-removed "How to improve your sleep" banner. Their
  //  content was decomposed into per-stat `action` + `whyText` fields
  //  on each DimensionResult, which is where it actually belongs.)

  const clockNights: SleepClockNight[] = useMemo(() => {
    // Most recent first, max 7 nights
    return sessions7.slice(0, 7).map((s, idx) => ({
      label: new Date(s.start_at).toLocaleDateString([], { weekday: 'short' }),
      startAt: s.start_at,
      endAt:   s.end_at,
      isMostRecent: idx === 0,
    }))
  }, [sessions7])

  // (Earlier draft had a synthetic "target window" arc on the clock — removed
  // because users were misreading it as "average sleep window". The clock now
  // computes its OWN circular-mean average band internally; sleep.tsx doesn't
  // need to pass any target hints in.)

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

      {/* ── Sleep rhythm (clock visualization of the week) ───────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.cardLabel}>Sleep Rhythm</Text>
          <SleepClock
            nights={clockNights}
            size={320}
            dateFormat={(profile?.date_format as 'mdy' | 'dmy' | undefined) ?? 'mdy'}
            onActiveChange={setClockReadout}
          />
          {/* Always-visible readout below the clock — shows the selected
              day's details. Defaults to the most-recent day per the
              SleepClock's default selection. Empty space rendered when
              there's no data at all (shouldn't happen here since the
              parent already gates on hasAnyData). */}
          {clockReadout && (
            <View style={s.clockReadout}>
              <Text style={s.clockReadoutTitle}>{clockReadout.title}</Text>
              <Text style={s.clockReadoutTime}>{clockReadout.time}</Text>
              {clockReadout.sub ? (
                <Text style={s.clockReadoutSub}>{clockReadout.sub}</Text>
              ) : null}
            </View>
          )}
        </AnimateRise>
      )}

      {/* ── Unified dimension breakdown (single card, 4 stacked rows) ─────
          The old "How to improve your sleep" verdict banner was REMOVED
          May 31 2026 — its cues + Sleep-target pill were redundant with
          this card. Each row now carries its own per-stat info pill
          (dim.whyText) exposing the science scoped to that single
          metric, and dim.action provides the per-stat coaching cue.
          Sibling-card reflow when a row's pill expands is automatic —
          the panel's REAL height animates from 0 → measured-content via
          Reanimated useSharedValue + withTiming, so every sibling row
          inside this card AND every card below cascades through React
          Native's normal layout flow (no layout-animation system
          needed). See DimensionRow for the mechanic. */}
      {!loading && hasAnyData && (
        <AnimateRise delay={300} style={s.card}>
          <Text style={s.cardLabel}>Sleep Stats</Text>
          <DimensionRow
            icon={<Clock size={14} color={statusColor(totalDim.status)} />}
            label="Sleep Duration"
            pillLabel="Sleep Duration"
            dim={totalDim}
            isFirst
          />
          <DimensionRow
            icon={<BedDouble size={14} color={statusColor(scheduleDim.status)} />}
            label="Bedtime"
            pillLabel="Bedtime"
            dim={scheduleDim}
          />
          <DimensionRow
            icon={<Activity size={14} color={statusColor(deepDim.status)} />}
            label="Deep Sleep"
            pillLabel="Deep Sleep"
            dim={deepDim}
          />
          <DimensionRow
            icon={<Brain size={14} color={statusColor(remDim.status)} />}
            label="REM Cycle"
            pillLabel="Rapid Eye Movement"
            dim={remDim}
          />
          {/* Science attribution — same line treatment as cardio/strength
              detail pages (Riegel · Daniels' · Seiler, Epley · Brzycki ·
              Lombardi, etc.). Sources behind every target value above. */}
          <Text style={s.attribution}>
            AASM · NSF · Li 2022 · Belenky · Van Dongen · Wittmann · Windred · Spielman · Czeisler · Wright · Roehrs · Okamoto-Mizuno · Burgess · Drake · Park — targets by age, science-backed cutoffs, weekly nudges, cues timed to your bedtime
          </Text>
        </AnimateRise>
      )}

      {/* ── Last night hypnogram ─────────────────────────────────────────── */}
      {!loading && hasAnyData && latestSession && latestHasStages && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.cardLabel}>Last Sleep Cycle</Text>
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
          <Text style={s.cardLabel}>Duration — Last 30 Days</Text>
          <Text style={s.cardSub}>
            Each bar is one night. Dashed line is your {fmtHoursOnly(targetHours)} target.
          </Text>
          <MonthlySparkline values={monthSeries} target={targetHours} />
        </AnimateRise>
      )}
    </ScrollView>
  )
}

// ── DimensionRow ─────────────────────────────────────────────────────────────
//
// One row inside the unified Dimension Breakdown card. Replaces the previous
// 2×2 grid of standalone cards (which forced narrow ~150px sparklines and
// duplicated chrome four times). All four metrics now stack vertically inside
// a single parent card — sparklines get full row width, status colors share
// a visual rhythm, no per-card borders compete for the user's eye.

function DimensionRow({
  icon, label, pillLabel, dim, isFirst,
}: {
  icon:      React.ReactNode
  /** Row title (e.g. "Sleep duration", "Bedtime", "Deep sleep", "REM cycle"). */
  label:     string
  /** Pill label — may differ from row label (e.g. REM row → "Rapid eye movement" pill). */
  pillLabel: string
  dim:       DimensionResult
  isFirst?:  boolean
}) {
  const color = statusColor(dim.status)
  // Pill expansion uses DIRECT HEIGHT ANIMATION (locked May 31 2026):
  //   1. Hidden measurer renders the panel content off-screen at full size
  //      and reports its layout via onLayout. We capture the real
  //      height once (memoized in `contentHeight`).
  //   2. A SharedValue `animatedHeight` drives the visible panel's
  //      actual `height` style via useAnimatedStyle. When `whyOpen`
  //      flips, we withTiming the shared value from 0 → contentHeight
  //      (or reverse) over 240ms with an out-quint easing.
  //   3. Because the visible panel's REAL height is changing, every
  //      view below it (the variables block in this row, every other
  //      DimensionRow, Last Sleep Cycle card, Duration trend card)
  //      reflows automatically through React Native's natural layout
  //      pass. No LayoutAnimation, no LinearTransition wrappers, no
  //      cross-system fighting — just frame-perfect layout cascade.
  //   4. Opacity animates in parallel so the panel doesn't pop in/out
  //      visually at the height boundaries.
  // This was the "everything below a pill needs to slide, not snap"
  // ask from the user. Pure native layout flow gives us that for free
  // once the panel's height is genuinely animating.
  const [whyOpen, setWhyOpen] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)
  const animatedHeight  = useSharedValue(0)
  const animatedOpacity = useSharedValue(0)

  // Drive the animation off the open flag + measured height. We only
  // animate UP to contentHeight once we've measured it; before that
  // the measurer is still computing.
  if (whyOpen && contentHeight > 0) {
    animatedHeight.value  = withTiming(contentHeight, { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
    animatedOpacity.value = withTiming(1,             { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
  } else if (!whyOpen) {
    animatedHeight.value  = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
    animatedOpacity.value = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
  }

  const panelAnimatedStyle = useAnimatedStyle(() => ({
    height:   animatedHeight.value,
    opacity:  animatedOpacity.value,
    overflow: 'hidden',
  }))

  // Safety buffer (16 px) absorbs any width-mismatch clip between the
  // off-screen measurer and the visible panel. Fabric/new arch skips
  // child layout for 0-height Animated.Views, so a single-tree
  // inner-measurer can't work — the hidden-measurer is necessary.
  const onMeasurerLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + 16
    if (h > 0 && h !== contentHeight) setContentHeight(h)
  }

  // The panel content — rendered TWICE so the hidden measurer can
  // report its natural size while the visible copy lives inside the
  // height-animated wrapper.
  const panelContent = (
    <View
      style={{
        borderWidth: 1, borderColor: withAlpha(color, 0.15),
        backgroundColor: alpha(colors.card, 0.6), borderRadius: 6,
        paddingHorizontal: 10, paddingVertical: 8, marginTop: 4,
      }}
    >
      <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
        {pillLabel}
      </Text>
      <Text style={[s.howBody, { lineHeight: 16 }]}>{dim.whyText}</Text>
    </View>
  )

  return (
    <View style={[s.dimRow, isFirst && s.dimRowFirst]}>
      {/* Row 1: icon + label on the left, status pill on the right.
          The status pill stays in line with the title — same row, far
          right — as the user asked. */}
      <View style={s.dimRowHead}>
        {icon}
        <Text style={s.dimRowLabel}>{label}</Text>
        <View style={s.dimRowHeadFill} />
        <View style={[s.dimPill, { borderColor: withAlpha(color, 0.55), backgroundColor: withAlpha(color, 0.12) }]}>
          <Text style={[s.dimPillText, { color }]}>{statusGlyph(dim.status)}</Text>
        </View>
      </View>

      {/* Row 2: info pill RIGHT-aligned on its own line, between the
          title row above and the variables block below. Mirrors
          strength's adp-zone pill placement
          ({flexDirection:'row', justifyContent:'flex-end'}). */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 }}>
        <Pressable
          onPress={() => setWhyOpen(o => !o)}
          hitSlop={8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 2,
            borderRadius: 999, borderWidth: 1,
            borderColor: withAlpha(color, 0.4),
            backgroundColor: withAlpha(color, 0.1),
          }}
        >
          <Text
            style={{
              fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
              letterSpacing: 1, color,
            }}
            numberOfLines={1}
          >
            {pillLabel}
          </Text>
          <Info size={11} color={color} />
        </Pressable>
      </View>

      {/* Hidden measurer — renders the panel off-screen at natural size.
          We tried inner-measurer June 1 2026 to fix a clipped-last-line
          bug, but Fabric/new arch skips layout passes for children of
          0-height Animated.Views — onLayout never fired and pill
          expansion broke entirely. Reverted; the +16 px buffer in
          onMeasurerLayout absorbs the original clip instead. */}
      <View
        style={{
          position: 'absolute', opacity: 0, left: 0, right: 0,
          top: -9999,
        }}
        pointerEvents="none"
        onLayout={onMeasurerLayout}
      >
        {panelContent}
      </View>

      {/* Visible panel — height animates 0 ↔ contentHeight. Because
          this is the REAL height (not a fade-in overlay), all sibling
          views below reflow naturally through layout. */}
      <Animated.View style={panelAnimatedStyle}>
        {panelContent}
      </Animated.View>

      {/* Variables block — plain View. The panel's height growing
          above this view automatically pushes it down via React
          Native's normal layout flow. No animation wrapper needed
          here; that's the whole point of the height-anim approach. */}
      <View>
        <Text style={[s.dimHeadline, { marginTop: 6 }]}>{dim.headline}</Text>
        <SparkLine
          values={dim.spark}
          accent={color}
          target={dim.sparkTarget}
          width={300}
          height={30}
        />
        <Text style={s.dimAction}>{dim.action}</Text>
      </View>
    </View>
  )
}

// ── SparkLine ────────────────────────────────────────────────────────────────

function SparkLine({
  values, accent, width = 120, height = 24, target,
}: {
  values:  (number | null)[]
  accent:  string
  width?:  number
  height?: number
  /** Y value of the dashed reference line. Null = no target line. */
  target?: number | null
}) {
  // Skia path memoization: rebuild only when inputs change. Paths are
  // static (no per-frame animation here), so useMemo + plain props on
  // the <SkiaPath> work fine — no useDerivedValue/sharedValue needed.
  const built = useMemo(() => {
    const valid = values
      .map((v, i) => v == null ? null : { x: i, v })
      .filter((p): p is { x: number; v: number } => p != null)
    if (valid.length < 2) return null

    const vs   = valid.map(p => p.v)
    const xMin = 0
    const xMax = values.length - 1
    // Expand the y-range to include the target line so it always renders
    // inside the spark frame even when every recent night is below (or
    // above) target.
    const dataMin = Math.min(...vs)
    const dataMax = Math.max(...vs)
    const yMin = target != null ? Math.min(dataMin, target) : dataMin
    const yMax = target != null ? Math.max(dataMax, target) : dataMax
    const yRange = Math.max(1e-6, yMax - yMin)
    const tx = (x: number) => (x - xMin) / Math.max(1, xMax - xMin) * width
    const ty = (v: number) => height - 2 - ((v - yMin) / yRange) * (height - 4)

    // Data line — Skia path built command-by-command (skips null gaps
    // with moveTo just like the prior SVG version's 'M' command).
    const dataPath = Skia.Path.Make()
    let lastWasNull = true
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v == null) { lastWasNull = true; continue }
      const px = tx(i)
      const py = ty(v)
      if (lastWasNull) dataPath.moveTo(px, py)
      else             dataPath.lineTo(px, py)
      lastWasNull = false
    }

    // Target line — horizontal dashed line at the target Y. Skia dashes
    // are applied per-shape (no Defs scope) so we mark the path via a
    // sibling <SkiaPath> with strokeWidth + a dashed PathEffect would
    // normally be set, BUT Skia's <Path> accepts a `strokeWidth` prop;
    // for dashing we instead build the dashes as discrete sub-paths
    // (3 px dash, 3 px gap) to match the SVG `strokeDasharray="3,3"`
    // pattern exactly.
    let targetPath: ReturnType<typeof Skia.Path.Make> | null = null
    if (target != null) {
      targetPath = Skia.Path.Make()
      const targetY = ty(target)
      const DASH = 3
      const GAP  = 3
      let x = 0
      while (x < width) {
        const x2 = Math.min(x + DASH, width)
        targetPath.moveTo(x, targetY)
        targetPath.lineTo(x2, targetY)
        x += DASH + GAP
      }
    }

    return { dataPath, targetPath }
  }, [values, target, width, height])

  if (!built) {
    return <View style={{ width, height, opacity: 0.4 }} />
  }

  return (
    <View style={{ height, marginVertical: 2 }}>
      <Canvas style={{ width, height }}>
        {built.targetPath && (
          <SkiaPath
            path={built.targetPath}
            style="stroke"
            strokeWidth={1}
            color={withAlpha(accent, 0.45)}
          />
        )}
        <SkiaPath
          path={built.dataPath}
          style="stroke"
          strokeWidth={1.75}
          color={accent}
        />
      </Canvas>
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

  // Build all Skia geometry up-front. One path per color bucket (ok /
  // amber) so the canvas only emits two stroked/filled shapes for the
  // bars + one for the target dashes — fewer draw calls than per-bar
  // <Path> nodes. Recomputes only when values/target/width/height
  // change.
  const built = useMemo(() => {
    if (values.length === 0 || width <= 0) return null
    const yMax  = Math.max(target * 1.2, Math.max(...values, target) + 0.5)
    const yMin  = 0
    const plotH = height - 12
    const ty    = (v: number) =>
      4 + plotH - ((v - yMin) / (yMax - yMin)) * plotH

    // Bars grouped by color bucket. addRect / Skia.XYWHRect mirrors the
    // SVG path's `M x,y h w v h h-w z` rectangle exactly.
    const okPath    = Skia.Path.Make()
    const amberPath = Skia.Path.Make()
    for (let i = 0; i < values.length; i++) {
      const v    = values[i]
      const barW = Math.max(1, (width / values.length) - 2)
      const x    = (i / values.length) * width + 1
      const y    = ty(v)
      const h    = Math.max(1, height - 8 - y)
      const ok   = v >= target * 0.9 && v <= target * 1.2
      const rect = Skia.XYWHRect(x, y, barW, h)
      if (ok) okPath.addRect(rect)
      else    amberPath.addRect(rect)
    }

    // Target line — same 3px dash, 3px gap pattern as SparkLine. Skia
    // doesn't take a strokeDasharray prop, so we build the dash run as
    // discrete moveTo/lineTo sub-paths.
    const targetPath = Skia.Path.Make()
    const targetY    = ty(target)
    const DASH       = 3
    const GAP        = 3
    let x = 0
    while (x < width) {
      const x2 = Math.min(x + DASH, width)
      targetPath.moveTo(x, targetY)
      targetPath.lineTo(x2, targetY)
      x += DASH + GAP
    }

    return { okPath, amberPath, targetPath }
  }, [values, target, width, height])

  if (values.length === 0) return null

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{ height }}
    >
      {built && width > 0 && (
        <Canvas style={{ width, height }}>
          <SkiaPath
            path={built.okPath}
            color={withAlpha(palette.emerald[400], 0.65)}
          />
          <SkiaPath
            path={built.amberPath}
            color={withAlpha(palette.amber[400], 0.65)}
          />
          <SkiaPath
            path={built.targetPath}
            style="stroke"
            strokeWidth={1}
            color={palette.slate[400]}
          />
        </Canvas>
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

  // Selected-day readout below the SleepClock — mirrors the in-clock
  // center label with full time-range + duration. Always rendered when
  // a day is selected (SleepClock defaults to most-recent).
  clockReadout: {
    marginTop:         12,
    paddingTop:        12,
    borderTopWidth:    1,
    borderTopColor:    alpha(colors.border, 0.4),
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: 16,
  },
  clockReadoutTitle: {
    color:      colors.foreground,
    fontSize:   14,
    fontWeight: '700',
    textAlign:  'center',
  },
  clockReadoutTime: {
    color:      palette.myrx.lime,
    fontSize:   16,
    fontFamily: fonts.mono[700],
    textAlign:  'center',
  },
  clockReadoutSub: {
    color:     colors.mutedForeground,
    fontSize:  12,
    fontFamily: fonts.mono[500],
    opacity:    0.85,
    textAlign: 'center',
  },
  cardSub:   { color: colors.mutedForeground, fontSize: 12, marginTop: -6 },

  emptyTitle: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  emptyBody:  { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },

  // howBody = body text inside the per-row info-pill expansion panel.
  // The banner-related verdict styles (verdictCard / Head / Badge / Text)
  // and howBold were removed May 31 2026 with the banner itself.
  howBody: {
    color:      colors.mutedForeground,
    fontSize:   12,
    lineHeight: 18,
  },

  // Unified dimension breakdown — one row per metric inside a single card.
  dimRow: {
    paddingTop:    14,
    marginTop:     14,
    borderTopWidth: 1,
    borderTopColor: alpha(colors.border, 0.5),
    gap:           8,
  },
  dimRowFirst: {
    // First row sits flush against the card label — no top border.
    paddingTop:     0,
    marginTop:      6,
    borderTopWidth: 0,
  },
  dimRowHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  dimRowLabel: {
    color:    colors.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dimRowHeadFill: { flex: 1 },

  // Science attribution — mirrors cardio/strength's `tinyText` row.
  attribution: {
    color:        colors.mutedForeground,
    fontSize:     11,
    lineHeight:   16,
    marginTop:    16,
    paddingTop:   12,
    borderTopWidth: 1,
    borderTopColor: alpha(colors.border, 0.4),
    textAlign:    'center',
  },
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
