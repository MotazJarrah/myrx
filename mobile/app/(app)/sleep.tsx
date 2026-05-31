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
  RefreshControl, Pressable,
} from 'react-native'
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated'
import { useFocusEffect } from 'expo-router'
import {
  Moon, Clock, Activity, BedDouble, Brain, Info,
} from 'lucide-react-native'
import Svg, { Path, Line as SvgLine } from 'react-native-svg'

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
  /** Raw current value (seconds for time dims, varies by dim). */
  current:  number | null
  /** Target value (matching units). */
  target:   number | null
  headline: string
  action:   string
  spark:    (number | null)[]
  /**
   * Y value of the target reference line drawn across the sparkline.
   * For Total/Deep/REM this equals `target` (spark values are in the same
   * units as target). For Schedule this is 0 because the spark values are
   * pre-normalized to "seconds earlier than target bedtime" so up = good.
   * Null = no target line drawn.
   */
  sparkTarget: number | null
  /**
   * Status of the most recent night, computed per-dim using the same
   * classifier as the dim itself. Drives the end-of-line dot color so the
   * user sees "where am I right now" at a glance. Null = no recent data.
   */
  lastNightStatus: Status | null
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

// ── CBT-I micro-target — Spielman 1987 Sleep Restriction Therapy ────────────
//
// Behavioural-sleep-medicine protocol: the circadian rhythm adapts to bedtime
// shifts in ~15-min weekly increments. Bigger jumps don't stick (acute
// circadian misalignment). Our coaching surface uses this for the "this week
// aim for X" line: we offer the user a 15-min nudge toward the age-banded
// target, capped so we never overshoot.
//
// Reference: Spielman, A. J. et al. (1987). 'A behavioral perspective on
// insomnia treatment.' Psychiatric Clinics of North America, 10(4), 541-553.
// Reinforced as CBT-I gold-standard by Edinger 2021 AASM clinical guideline.
const MICRO_TARGET_STEP_SEC = 15 * 60  // 15 min weekly increment

interface MicroTarget {
  /** Next week's target sleep duration in seconds. */
  microTargetSec: number
  /** Signed delta from current avg (positive = need more sleep). */
  deltaMin:       number
  /** 'increase' = need more, 'decrease' = need less, 'hold' = at target. */
  direction:      'increase' | 'decrease' | 'hold'
  /** True when this week's nudge would actually reach the age target. */
  reachesTarget:  boolean
}

function computeMicroTarget(avgSec: number, targetSec: number): MicroTarget {
  const gap = targetSec - avgSec  // positive → need more sleep
  // Inside ±15-min window of target → already on it; no nudge this week.
  if (Math.abs(gap) <= MICRO_TARGET_STEP_SEC) {
    return {
      microTargetSec: targetSec,
      deltaMin:       Math.round(gap / 60),
      direction:      'hold',
      reachesTarget:  true,
    }
  }
  const step = gap > 0 ? MICRO_TARGET_STEP_SEC : -MICRO_TARGET_STEP_SEC
  const next = avgSec + step
  // Clamp so we never overshoot the target in either direction.
  const microTargetSec = gap > 0 ? Math.min(next, targetSec) : Math.max(next, targetSec)
  return {
    microTargetSec,
    deltaMin:       Math.round((microTargetSec - avgSec) / 60),
    direction:      gap > 0 ? 'increase' : 'decrease',
    reachesTarget:  microTargetSec === targetSec,
  }
}

// ── Bedtime-anchored hygiene cue registry ───────────────────────────────────
//
// Every cue references the user's ACTUAL average bedtime / wake time computed
// from logs — not a generic clock time. So a user with a 2 AM bedtime gets
// "no caffeine after 8 PM" instead of the useless "no caffeine after 2 PM".
//
// Each cue text is paired with the published-study mechanism in one sentence
// so the user reads WHY the cue exists, not just "do this".
//
// Sources for each cue:
//   - caffeine 6h cutoff:    Drake et al. 2013 (J Clin Sleep Med) — 6h
//                             caffeine before bed still disrupts sleep onset.
//   - alcohol 3h cutoff:     Roehrs & Roth 2001 — alcohol's #1 sleep effect
//                             is REM suppression, especially the first half.
//   - heavy meals 3h cutoff: Park et al. 2020 — late meals delay deep stage.
//   - screens dim 60min:     Burgess 2013 — light suppresses melatonin onset.
//   - screens off 30min:     Burgess 2013 — phasic blue-light triggers wake.
//   - morning sunlight:      Wright et al. 2013, Khalsa 2003 — strongest
//                             circadian phase anchor; within 30 min of wake.
//   - bedroom temp ≤67°F:    Okamoto-Mizuno 2012 — thermoregulation drop
//                             triggers deep-stage entry.
//   - wake anchor:           Czeisler 1999 — wake time is the DOMINANT
//                             zeitgeber (stronger than bedtime).
//   - REM tail protection:   Carskadon & Dement — REM cycles lengthen across
//                             the night; the last 90 min is mostly REM.
type CueId =
  | 'caffeine' | 'alcohol' | 'meals'
  | 'screens_dim' | 'screens_off' | 'sunlight'
  | 'temp' | 'wake_anchor' | 'rem_tail'

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

function makeCue(id: CueId, avgBedHour: number, avgWakeHour: number): string {
  // Helper: shift a decimal-hour value by H hours and format. Bed-1h means
  // "1 hour before bedtime". Wraps correctly across midnight.
  const shift = (base: number, deltaHours: number) =>
    fmtClock12(((base + deltaHours) % 24 + 24) % 24)
  const bed   = avgBedHour
  const wake  = avgWakeHour
  switch (id) {
    case 'caffeine':
      return `No caffeine after ${shift(bed, -6)} — caffeine has a 6-hour half-life and disrupts sleep onset even when you don't feel wired.`
    case 'alcohol':
      return `No alcohol after ${shift(bed, -3)} — alcohol within 3 hours of bed suppresses REM more than any other dietary factor.`
    case 'meals':
      return `No heavy meals after ${shift(bed, -3)} — late digestion delays deep-stage entry by raising core temperature.`
    case 'screens_dim':
      return `Dim screens by ${shift(bed, -1)} — bright light within an hour of bed suppresses melatonin.`
    case 'screens_off':
      return `Screens off by ${shift(bed, -0.5)} — blue light delays sleep onset more than ambient room light.`
    case 'sunlight':
      return `Get 10+ min of sunlight by ${shift(wake, 0.5)} — morning light sets your body's daily clock.`
    case 'temp':
      return `Cool the bedroom to ≤67°F before bed — your body's core-temp drop triggers deep-stage entry.`
    case 'wake_anchor':
      return `Hold your alarm at ${fmtClock12(wake)} — a steady wake time matters more than a steady bedtime.`
    case 'rem_tail':
      return `Protect your last 90 minutes of sleep — most of your nightly REM happens in that window.`
  }
}

/**
 * Pick a primary or alternate cue based on the calendar week, so a user
 * who's chronically off on the same dim doesn't read the same advice for
 * weeks in a row. Week parity flips every 7 days.
 */
function weekParity(): 0 | 1 {
  // Math.floor(Date.now() / WEEK_MS) is monotonic + globally consistent.
  // Stable inside a single render but flips at the weekly boundary.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  return (Math.floor(Date.now() / WEEK_MS) % 2) as 0 | 1
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
  // "How we compute" inline info panel toggle — Pattern 5 from CLAUDE.md
  // (FadeInUp / FadeOutUp + LinearTransition for sibling layout reflow).
  const [howOpen, setHowOpen] = useState(false)

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

  // CBT-I weekly micro-target — shipped to the banner as "this week aim for X".
  // Computed against the AGE-BANDED target, not user input. Captures whether
  // user needs more sleep, less sleep, or is already on track.
  const microTarget = useMemo(() => {
    if (sessions7.length === 0) return null
    const avg = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    return computeMicroTarget(avg, targetSecs)
  }, [sessions7, targetSecs])

  // Week parity for cue rotation. Stable within a render, flips weekly.
  const cueWeek = useMemo(() => weekParity(), [])

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
        sparkTarget: null,
        lastNightStatus: null,
      }
    }
    const avg = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const status = classifyTotal(avg, targetSecs)
    const diffMin = Math.round((targetSecs - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → ${fmtHoursOnly(targetHours)}`

    // Concise per-dim action — one sentence, just "what to do". The broader
    // coaching narrative lives in the top banner (verdictText). Cue rotates
    // between primary (sunlight anchor) and alternate (wake anchor) weekly
    // so chronically-short users don't read the same line every week.
    let action: string
    if (status === 'ok') {
      action = `Hold this rhythm — your ${fmtHoursOnly(targetHours)} target is met.`
    } else {
      action = cueWeek === 0
        ? makeCue('sunlight', avgBedHour, avgWakeHour)
        : makeCue('wake_anchor', avgBedHour, avgWakeHour)
    }
    const lastNight = sparkWindow[sparkWindow.length - 1]
    return {
      status, current: avg, target: targetSecs, headline, action,
      spark: sparkWindow.map(s => s.duration_s),
      sparkTarget: targetSecs,
      lastNightStatus: lastNight ? classifyTotal(lastNight.duration_s, targetSecs) : null,
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
        sparkTarget: null,
        lastNightStatus: null,
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.deep_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, DEEP_TARGET_S)
    const shortMin = Math.round((DEEP_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    // Concise per-dim action — one sentence, just "what to do". Cue rotates
    // weekly between primary (temp) and alternate (meals) so chronically-
    // deep-short users see variation. Both cues are bedtime-anchored.
    let action: string
    if (status === 'ok') {
      action = `On target — your body's repair window is covered.`
    } else if (shortMin > 0) {
      action = cueWeek === 0
        ? makeCue('temp',  avgBedHour, avgWakeHour)
        : makeCue('meals', avgBedHour, avgWakeHour)
    } else {
      action = `At target.`
    }
    const lastNight = sparkWindow[sparkWindow.length - 1]
    return {
      status, current: avg, target: DEEP_TARGET_S, headline, action,
      spark: sparkWindow.map(s => s.deep_s),
      sparkTarget: DEEP_TARGET_S,
      lastNightStatus: lastNight && lastNight.deep_s != null && lastNight.deep_s > 0
        ? classifyStage(lastNight.deep_s, DEEP_TARGET_S)
        : null,
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
        sparkTarget: null,
        lastNightStatus: null,
      }
    }
    const avg = sessionsWithStages.reduce((a, s) => a + (s.rem_s ?? 0), 0) / sessionsWithStages.length
    const status = classifyStage(avg, REM_TARGET_S)
    const shortMin = Math.round((REM_TARGET_S - avg) / 60)
    const headline = `${fmtHoursMinutes(avg)} → 90 min`

    // Cue rotates weekly between primary (alcohol cutoff) and alternate
    // (REM-tail protection) so users see different angles.
    let action: string
    if (status === 'ok') {
      action = `On target — memory + mood consolidation covered.`
    } else if (shortMin > 0) {
      action = cueWeek === 0
        ? makeCue('alcohol',  avgBedHour, avgWakeHour)
        : makeCue('rem_tail', avgBedHour, avgWakeHour)
    } else {
      action = `At target.`
    }
    const lastNight = sparkWindow[sparkWindow.length - 1]
    return {
      status, current: avg, target: REM_TARGET_S, headline, action,
      spark: sparkWindow.map(s => s.rem_s),
      sparkTarget: REM_TARGET_S,
      lastNightStatus: lastNight && lastNight.rem_s != null && lastNight.rem_s > 0
        ? classifyStage(lastNight.rem_s, REM_TARGET_S)
        : null,
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
        sparkTarget: null,
        lastNightStatus: null,
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
    // Schedule's PRIMARY lever is the wake anchor (Czeisler — wake is the
    // dominant zeitgeber). All variants of "off" lead with that. Specific
    // bedtime offset still surfaces when the user is significantly late,
    // but the wake-anchor framing comes first.
    let action: string
    if (status === 'ok') {
      action = `On target — your sleep timing is steady.`
    } else if (bedStatus !== 'ok' && consistencyStatus === 'fail') {
      // Both off — wake-anchor is the highest-leverage fix.
      action = makeCue('wake_anchor', avgBedHour, avgWakeHour)
    } else if (bedStatus !== 'ok') {
      // Bedtime drift only — name the actual time AND the wake anchor.
      action = `Shift bedtime to ${targetBedLabel} (${fmtMin(Math.abs(lateMin))} ${lateMin > 0 ? 'earlier' : 'later'}) — and hold ${fmtClock12(avgWakeHour)} as your alarm anchor.`
    } else {
      // Consistency only — pure wake-anchor framing.
      action = makeCue('wake_anchor', avgBedHour, avgWakeHour)
    }

    // Spark values inverted so UP = went to bed earlier (better). Each value
    // is "seconds earlier than target bedtime". The sparkTarget line is at 0
    // (= exactly on target). Positive = early, negative = late.
    const lastNight = sparkWindow[sparkWindow.length - 1]
    const lastNightBedStatus = lastNight
      ? classifyBedtime(bedtimeOffsetSeconds(lastNight.start_at), targetBed)
      : null
    return {
      status, current: avgBed, target: targetBed, headline, action,
      spark: sparkWindow.map(s => targetBed - bedtimeOffsetSeconds(s.start_at)),
      sparkTarget: 0,
      lastNightStatus: lastNightBedStatus,
    }
  }, [sessions7, sparkWindow, targetSecs, targetHours])

  // ── Verdict ────────────────────────────────────────────────────────────────
  //
  // The banner names the dim the user should focus on first AND uses that
  // dim's status color so the colour matches the dim card's pill. Picking
  // the lead by worst-status-first (FAIL before WARN) guarantees the banner
  // always points at the most severe item. Color tracks lead.status (NOT
  // the old off-count threshold which could turn the banner red even when
  // the named item was only amber).

  const lead = useMemo(() => {
    const items: Array<{ name: string; status: Status }> = [
      { name: 'total sleep', status: totalDim.status },
      { name: 'deep sleep',  status: deepDim.status },
      { name: 'REM sleep',   status: remDim.status },
      { name: 'schedule',    status: scheduleDim.status },
    ]
    return items.find(i => i.status === 'fail')
        ?? items.find(i => i.status === 'warn')
        ?? null
  }, [totalDim, deepDim, remDim, scheduleDim])

  const verdict = useMemo(() => {
    const statuses = [totalDim.status, deepDim.status, remDim.status, scheduleDim.status]
    const known    = statuses.filter(s => s !== 'unknown')
    const offCount = known.filter(s => s === 'warn' || s === 'fail').length
    // Color tracks the LEAD item's status — when banner says "start with X"
    // its colour matches X's dim-card pill. Falls back to emerald when no
    // lead exists (all OK or no data).
    const color = lead ? statusColor(lead.status) : palette.emerald[400]
    return { color, offCount, knownCount: known.length }
  }, [totalDim, deepDim, remDim, scheduleDim, lead])

  // Consolidated coaching cue — woven from three pieces:
  //
  //   1. STATE — current avg + age-banded target.
  //   2. MICRO-TARGET — CBT-I 15-min weekly nudge ("this week aim for X").
  //   3. LEVER — concrete action keyed off lead-dim status. Distinguishes
  //      "sleep more" (move wake later or pull bedtime earlier) vs
  //      "sleep earlier" (bedtime is the specific gap). Always anchors
  //      on the wake time as the dominant zeitgeber (Czeisler).
  //
  // When 2+ dims are off, a brief cascade sentence explains why fixing
  // the lead usually pulls the others along.
  //
  // Per-dim cards keep ONLY a concise "what to do" line. This banner is
  // the integrative narrative.
  const verdictText = useMemo(() => {
    if (sessions7.length === 0) {
      return 'No nights tracked yet. Once data starts landing, your weekly verdict shows here.'
    }
    const avgSec   = sessions7.reduce((a, s) => a + s.duration_s, 0) / sessions7.length
    const avgLabel = fmtHoursMinutes(avgSec)

    // All-on-track → simple hold message.
    if (verdict.offCount === 0 || !lead) {
      return `Sleep is averaging ${avgLabel} — on track across the board. Hold ${fmtClock12(avgWakeHour)} as your alarm and let bedtime follow.`
    }

    // --- 1. STATE ----------------------------------------------------------
    const stateLine = `Sleep is averaging ${avgLabel}.`

    // --- 2. MICRO-TARGET --------------------------------------------------
    // Only show when total sleep is off-target AND a non-trivial nudge
    // exists. Otherwise the micro-target line just confuses (e.g. user
    // hitting target but bedtime drifts — micro-target says "hold" which
    // doesn't help the schedule discussion).
    let microLine = ''
    if (microTarget && microTarget.direction !== 'hold') {
      const nextLabel = fmtHoursMinutes(microTarget.microTargetSec)
      const sign      = microTarget.deltaMin > 0 ? '+' : ''
      microLine = ` This week, aim for ${nextLabel} (${sign}${microTarget.deltaMin} min) — small 15-min weekly shifts stick; big jumps don't.`
    }

    // --- 3. LEVER --------------------------------------------------------
    // Wake time = the dominant zeitgeber. Every lever sentence anchors on it.
    let leverLine = ''
    if (lead.name === 'total sleep') {
      const totalCur = totalDim.current ?? 0
      if (totalCur < targetSecs) {
        // Determine the lever. If bedtime is at-or-before the target
        // bedtime (avgWake - target_duration), the user is already going
        // to bed early enough — needs to wake later OR extend total via
        // additional bedtime shift. Otherwise, pull bedtime earlier.
        const targetBedHour     = ((avgWakeHour - targetHours) % 24 + 24) % 24
        const bedtimeAlreadyEarly = Math.abs(((avgBedHour - targetBedHour + 24) % 24) - 12) > 11.7
          ? false  // wrap edge case — treat as not-early to avoid weird math
          : avgBedHour <= targetBedHour || avgBedHour > 18  // 6 PM-midnight bedtimes count as "before target"
        if (bedtimeAlreadyEarly) {
          leverLine = ` Hold ${fmtClock12(avgWakeHour)} as your wake target — or extend it later if your schedule allows. Bedtime is already on track.`
        } else {
          // Pull bedtime to: wake - microTarget (this week's smaller nudge)
          const microSec = microTarget?.microTargetSec ?? targetSecs
          const newBedHour = ((avgWakeHour - microSec / 3600) % 24 + 24) % 24
          leverLine = ` Hold ${fmtClock12(avgWakeHour)} as your alarm and pull bedtime to ${fmtClock12(newBedHour)}.`
        }
      } else {
        // Over-target — cap by holding wake, drifting bedtime later.
        leverLine = ` Hold ${fmtClock12(avgWakeHour)} as your alarm and let bedtime drift later — too much sleep past ${fmtHoursOnly(targetHours)} usually means recovery debt.`
      }
    } else if (lead.name === 'schedule') {
      leverLine = ` ${makeCue('wake_anchor', avgBedHour, avgWakeHour)}`
    } else if (lead.name === 'deep sleep') {
      leverLine = ` ${cueWeek === 0 ? makeCue('temp', avgBedHour, avgWakeHour) : makeCue('meals', avgBedHour, avgWakeHour)}`
    } else {
      // REM
      leverLine = ` ${cueWeek === 0 ? makeCue('alcohol', avgBedHour, avgWakeHour) : makeCue('rem_tail', avgBedHour, avgWakeHour)}`
    }

    // --- CASCADE (only when 2+ dims off) ---------------------------------
    let cascadeLine = ''
    const dimsOffOther = verdict.offCount - 1
    if (dimsOffOther >= 1) {
      if (lead.name === 'schedule') {
        cascadeLine = ' Once your wake anchor holds, total and stage time usually follow.'
      } else if (scheduleDim.status === 'fail' || scheduleDim.status === 'warn') {
        cascadeLine = ` Locking your wake time also fixes the other ${dimsOffOther === 1 ? 'stat that is' : 'stats that are'} off.`
      } else if (totalDim.status === 'fail' || totalDim.status === 'warn') {
        cascadeLine = ' Adding total sleep typically lifts deep + REM proportionally.'
      }
    }

    return `${stateLine}${microLine}${leverLine}${cascadeLine}`
  }, [sessions7, verdict, lead, totalDim, scheduleDim, targetSecs, targetHours, avgBedHour, avgWakeHour, microTarget, cueWeek])

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

      {!loading && hasAnyData && (
        <AnimateRise delay={0}>
          <Animated.View
            layout={LinearTransition.duration(200)}
            style={[s.verdictCard, { borderLeftColor: verdict.color }]}
          >
            <View style={s.verdictHead}>
              <Moon size={16} color={verdict.color} />
              <Text style={[s.verdictBadge, { color: verdict.color }]}>HOW TO IMPROVE YOUR SLEEP</Text>
            </View>
            <Text style={s.verdictText}>{verdictText}</Text>
            {/* Sleep-targets info pill — copied verbatim from strength's
                adp-zone info pill ([exercise].tsx:4747-4763). Right-aligned
                in a flex row, tight padding, fully rounded, light alpha
                border + bg. Tap → expansion panel below. */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <Pressable
                onPress={() => setHowOpen(o => !o)}
                hitSlop={8}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: 8, paddingVertical: 2,
                  borderRadius: 999, borderWidth: 1,
                  borderColor: withAlpha(verdict.color, 0.4),
                  backgroundColor: withAlpha(verdict.color, 0.1),
                }}
              >
                <Text
                  style={{
                    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 1, color: verdict.color,
                  }}
                  numberOfLines={1}
                >
                  Sleep targets
                </Text>
                <Info size={11} color={verdict.color} />
              </Pressable>
            </View>
            {howOpen && (
              <Animated.View
                entering={FadeInUp.duration(200)}
                exiting={FadeOutUp.duration(180)}
                style={{
                  borderWidth: 1, borderColor: withAlpha(verdict.color, 0.15),
                  backgroundColor: alpha(colors.card, 0.6), borderRadius: 6,
                  paddingHorizontal: 10, paddingVertical: 8, marginTop: 4,
                }}
              >
                <Text style={s.howBody}>
                  <Text style={s.howBold}>Target: </Text>
                  {fmtHoursOnly(targetHours)} based on your age (AASM, NSF, Li 2022).
                  {'\n'}
                  <Text style={s.howBold}>Your averages: </Text>
                  bedtime {fmtClock12(avgBedHour)}, wake {fmtClock12(avgWakeHour)}, total {fmtHoursMinutes(sessions7.reduce((a, s) => a + s.duration_s, 0) / Math.max(1, sessions7.length))} — from the last 7 nights.
                  {'\n'}
                  <Text style={s.howBold}>This week's nudge: </Text>
                  ±15 min toward your target. Small weekly shifts stick; large jumps don't.
                  {'\n'}
                  <Text style={s.howBold}>Cue timings: </Text>
                  caffeine, alcohol, meals and screen cutoffs are calculated from your bedtime ({fmtClock12(avgBedHour)}), not generic clock times.
                  {'\n'}
                  <Text style={s.howBold}>Wake-time first: </Text>
                  A steady wake time matters more than a steady bedtime.
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        </AnimateRise>
      )}

      {/* ── Sleep Clock ──────────────────────────────────────────────────── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={150} style={s.card}>
          <Text style={s.cardLabel}>Last 7 nights</Text>
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

      {/* ── Unified dimension breakdown (single card, 4 stacked rows) ───── */}
      {!loading && hasAnyData && (
        <AnimateRise delay={300} style={s.card}>
          <Text style={s.cardLabel}>Sleep stats</Text>
          <DimensionRow
            icon={<Clock size={14} color={statusColor(totalDim.status)} />}
            label="Total sleep"
            dim={totalDim}
            isFirst
          />
          <DimensionRow
            icon={<BedDouble size={14} color={statusColor(scheduleDim.status)} />}
            label="Schedule"
            dim={scheduleDim}
          />
          <DimensionRow
            icon={<Activity size={14} color={statusColor(deepDim.status)} />}
            label="Deep sleep"
            dim={deepDim}
          />
          <DimensionRow
            icon={<Brain size={14} color={statusColor(remDim.status)} />}
            label="REM sleep"
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

// ── DimensionRow ─────────────────────────────────────────────────────────────
//
// One row inside the unified Dimension Breakdown card. Replaces the previous
// 2×2 grid of standalone cards (which forced narrow ~150px sparklines and
// duplicated chrome four times). All four metrics now stack vertically inside
// a single parent card — sparklines get full row width, status colors share
// a visual rhythm, no per-card borders compete for the user's eye.

function DimensionRow({
  icon, label, dim, isFirst,
}: {
  icon:    React.ReactNode
  label:   string
  dim:     DimensionResult
  isFirst?: boolean
}) {
  const color = statusColor(dim.status)
  return (
    <View style={[s.dimRow, isFirst && s.dimRowFirst]}>
      <View style={s.dimRowHead}>
        {icon}
        <Text style={s.dimRowLabel}>{label}</Text>
        <View style={s.dimRowHeadFill} />
        <View style={[s.dimPill, { borderColor: withAlpha(color, 0.55), backgroundColor: withAlpha(color, 0.12) }]}>
          <Text style={[s.dimPillText, { color }]}>{statusGlyph(dim.status)}</Text>
        </View>
      </View>
      <Text style={s.dimHeadline}>{dim.headline}</Text>
      <SparkLine
        values={dim.spark}
        accent={color}
        target={dim.sparkTarget}
        width={300}
        height={30}
      />
      <Text style={s.dimAction}>{dim.action}</Text>
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
  const valid = values
    .map((v, i) => v == null ? null : { x: i, v })
    .filter((p): p is { x: number; v: number } => p != null)
  if (valid.length < 2) {
    return <View style={{ width, height, opacity: 0.4 }} />
  }
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
  function tx(x: number) { return (x - xMin) / Math.max(1, xMax - xMin) * width }
  function ty(v: number) { return height - 2 - ((v - yMin) / yRange) * (height - 4) }

  // Build the data line.
  const segments: string[] = []
  let lastWasNull = true
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) { lastWasNull = true; continue }
    const cmd = lastWasNull ? 'M' : 'L'
    segments.push(`${cmd}${tx(i).toFixed(1)},${ty(v).toFixed(1)}`)
    lastWasNull = false
  }

  // Target line: dashed horizontal, slightly dimmed accent color.
  const targetY = target != null ? ty(target) : null

  return (
    <View style={{ height, marginVertical: 2 }}>
      <Svg width={width} height={height}>
        {targetY != null && (
          <Path
            d={`M0,${targetY.toFixed(1)} L${width},${targetY.toFixed(1)}`}
            stroke={withAlpha(accent, 0.45)}
            strokeWidth={1}
            strokeDasharray="3,3"
            fill="none"
          />
        )}
        <Path d={segments.join(' ')} stroke={accent} strokeWidth={1.75} fill="none" />
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

  verdictCard: {
    backgroundColor: alpha(colors.card, 0.7),
    borderColor:     colors.border,
    borderWidth:     1,
    borderLeftWidth: 4,
    borderRadius:    12,
    padding:         14,
    gap:             8,
  },
  howBody: {
    color:      colors.mutedForeground,
    fontSize:   12,
    lineHeight: 18,
  },
  howBold: {
    color:      colors.foreground,
    fontWeight: '600',
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
