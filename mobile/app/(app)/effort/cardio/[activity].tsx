/**
 * CardioDetail — direct port of MyRX/src/pages/CardioDetail.jsx to RN.
 *
 * Two rendering modes, dispatched off the movement record's `cardio_mode`:
 *
 *   1. PaceDetail     — distance + time efforts, pace projections via Riegel,
 *                       LineChart of pace over time (Y-axis reversed so
 *                       improving = trend up). Tap a projection row to see
 *                       the goal-panel "next target" for that distance.
 *   2. DurationDetail — time-only sessions, milestone tile grid (1m..30m),
 *                       LineChart of session length over time, tap a milestone
 *                       to see the next-target gap.
 *
 * Recharts → `src/components/LineChart.tsx` (react-native-svg).
 * `getCardioMode(name)` web helper → `cardio_mode` field on the DB record
 * (read via `useMovements`). `getCardioDistances` ported inline below.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import Animated, {
  FadeInUp,
  FadeOutUp,
  LinearTransition,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useLocalSearchParams, router } from 'expo-router'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react-native'
import Skeleton from '../../../../src/components/Skeleton'
import DeleteAction from '../../../../src/components/DeleteAction'
import TickerNumber from '../../../../src/components/TickerNumber'
import AnimateRise from '../../../../src/components/AnimateRise'
import LineChart from '../../../../src/components/LineChart'
import { useAuth } from '../../../../src/contexts/AuthContext'
import { supabase } from '../../../../src/lib/supabase'
import { useMovements } from '../../../../src/hooks/useMovements'
import {
  isSpeedMachine,
  formatSpeed,
  paceSecsPerKmToSpeedDisplay,
  // Swim stroke consolidation helpers — shared with cardio.tsx (log form +
  // index) so the 4 stroke variants stay in lockstep across surfaces.
  type SwimStroke,
  SWIM_STROKE_ORDER,
  SWIM_STROKE_LABELS,
  SWIMMING_BASE_NAME,
  parseSwimStroke,
  isSwimActivity,
} from '../../../../src/lib/movements'
import { colors, palette, alpha, withAlpha, fonts } from '../../../../src/theme'

// ── Effort row ───────────────────────────────────────────────────────────────
interface Effort {
  id:         string
  user_id:    string
  type:       string
  label:      string
  value:      string
  created_at: string
}

// ── Time helpers (1:1 with web) ──────────────────────────────────────────────

function parseTimeStr(str: string | null | undefined): number | null {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs: number | null | undefined): string {
  if (totalSecs == null) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceTick(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const KM_PER_MI = 1.60934

function fmtPaceStr(secsPerKm: number, distUnit: 'km' | 'mi' = 'km'): string {
  if (distUnit === 'mi') {
    const secsPerMi = secsPerKm * KM_PER_MI
    const m = Math.floor(secsPerMi / 60)
    const s = Math.round(secsPerMi % 60)
    return `${m}:${String(s).padStart(2, '0')}/mi`
  }
  const m = Math.floor(secsPerKm / 60)
  const s = Math.round(secsPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function convertStoredPace(storedPaceStr: string | null | undefined, distUnit: 'km' | 'mi'): string {
  if (!storedPaceStr) return '—'
  if (distUnit !== 'mi') return storedPaceStr
  const m = storedPaceStr.match(/^(\d+):(\d{2})\//)
  if (!m) return storedPaceStr
  const secsPerKm = parseInt(m[1]) * 60 + parseInt(m[2])
  return fmtPaceStr(secsPerKm, 'mi')
}

function parsePaceToSecs(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Render a distance in the user's preferred unit with sensible precision.
// Sub-1km values display in meters (e.g. 0.6 km → "600 m", 0.25 km → "250 m")
// because that's how runners / coaches actually talk about short intervals —
// "5 × 600 m" reads cleanly, "5 × 0.6 km" reads as decimal noise. Same for
// imperial: sub-1mi values fall back to meters since track-and-field uses
// metric for short distances universally.
function fmtDist(distKm: number, distUnit: 'km' | 'mi' = 'km'): string {
  if (distUnit === 'mi') {
    const mi = distKm / KM_PER_MI
    if (mi < 1) return `${Math.round(distKm * 1000)} m`
    return `${mi.toFixed(mi < 5 ? 2 : 1).replace(/\.?0+$/, '')} mi`
  }
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`
  return `${distKm < 5 ? distKm.toFixed(2).replace(/\.?0+$/, '') : distKm.toFixed(1).replace(/\.0$/, '')} km`
}

function parseEffortLabel(label: string | null | undefined): { distKm: number; timeSecs: number | null } | null {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * KM_PER_MI, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  // Swimming distance formats (May 17 2026 — swim distances are entered
  // in meters or yards, not km/mi). Order: try yd first because the
  // bare-'m' regex would otherwise match the 'm' in 'mi'... actually
  // it wouldn't (we require '\s+in\s+' after) but ordering yd-then-m
  // is safer in case someone logs an edge-case label.
  const m4 = part.match(/([\d.]+)\s*yd\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m4) return { distKm: parseFloat(m4[1]) * 0.0009144, timeSecs: parseTimeStr(m4[2]) }
  const m5 = part.match(/([\d.]+)\s*m\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m5) return { distKm: parseFloat(m5[1]) / 1000, timeSecs: parseTimeStr(m5[2]) }
  return null
}

// Swim stroke consolidation helpers (SwimStroke type, SWIM_STROKE_ORDER,
// SWIM_STROKE_LABELS, SWIMMING_BASE_NAME, parseSwimStroke, isSwimActivity)
// live in `mobile/src/lib/movements.ts` so the cardio log form, the index
// collapse logic, and this detail page can all import the same authoritative
// definitions. See that file for the full doc + rationale.

// ── Cardio adaptation zones — locked design spec (see CLAUDE.md) ─────────────
// THREE zones (May 2026 update): the app's job is to push you to get BETTER,
// not to babysit recovery or program "no-man's-land" tempo work. The 5-zone
// HR model is still the underlying science, but we expose only the three
// zones that actually drive progression for the average trainee:
//
//   • ENDURANCE (Z2)  — aerobic base. Most of your training. Builds the engine.
//   • THRESHOLD (Z4)  — lactate clearance. Race-time improvement.
//   • VO2 MAX  (Z5)   — top-end speed. Mile / 5K race-pace adaptation.
//
// Recovery (Z1) is not training — it's the absence of training. Tempo (Z3) is
// what polarized-training research calls "no man's land": too hard to be the
// efficient aerobic stimulus of Z2, too easy to drive the specific adaptations
// of Z4/Z5. Both dropped from the UI; the user can still log easy days, the
// system just won't prescribe them as workouts.
//
// This also gives us 1:1 parity with strength's 3-zone adp model:
//   Strength: STRENGTH    / HYPERTROPHY / ENDURANCE
//   Cardio:   ENDURANCE   / THRESHOLD   / VO2 MAX

type CardioZone = 'endurance' | 'threshold' | 'vo2'

const CARDIO_ZONE_ORDER: CardioZone[] = ['endurance', 'threshold', 'vo2']

interface CardioZoneCfg {
  label:        string
  shortLabel:   string
  hrPctRange:   string
  paceOffset:   number   // s/km offset from user's best pace (negative = faster)
  whyText:      string
}

const CARDIO_ZONE_CONFIG: Record<CardioZone, CardioZoneCfg> = Object.freeze({
  endurance: {
    label:      'ENDURANCE',
    shortLabel: 'ENDURANCE',
    hrPctRange: '60–70% HRmax',
    paceOffset: 60,
    whyText:    'Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine. Stay disciplined and conversational; resist the urge to push.',
  },
  threshold: {
    label:      'THRESHOLD',
    shortLabel: 'THRESHOLD',
    hrPctRange: '80–90% HRmax',
    paceOffset: 10,
    whyText:    'The single most productive zone for race times from 5K to half marathon. Cruise intervals teach your body to clear lactate faster, raising the speed you can sustain. 1–2 sessions per week max.',
  },
  vo2: {
    label:      'VO2 MAX',
    shortLabel: 'VO2 MAX',
    hrPctRange: '90–100% HRmax',
    paceOffset: -15,
    whyText:    'Top-end stress. Short intervals at max sustainable effort build VO2 max — your engine ceiling — and pull every zone below up with them. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between.',
  },
})

// Target pace at this zone in s/km, anchored on the user's fastest logged pace.
// VO2 zone is floored at 60 s/km to prevent absurd projections for slow users.
function getZonePaceSecPerKm(zone: CardioZone, bestPaceSecPerKm: number): number {
  const offset = CARDIO_ZONE_CONFIG[zone].paceOffset
  return Math.max(60, bestPaceSecPerKm + offset)
}

// ── Activity categorization ──────────────────────────────────────────────────
// Each cardio movement name maps to a coarse category. The category drives the
// per-zone session prescription (distance for pace mode, duration for duration
// mode). Order matters in the regex chain — more specific patterns (e.g.
// "Air Bike" matches "bike") must come BEFORE generic ones (e.g. "cycling").

type ActivityCategory =
  | 'running' | 'rucking'
  | 'cycling' | 'stationary_bike' | 'air_bike'
  | 'rowing' | 'ski_erg' | 'swimming' | 'elliptical'
  // Duration-mode category. Group C is just StairMill now — Arc Trainer
  // was removed in the May 17 2026 cleanup as a niche gym machine.
  | 'stair_climber'

function categorizeActivity(activityName: string): ActivityCategory {
  const lower = activityName.toLowerCase()

  // Pace-mode categories (order: most-specific first)
  if (/swim/.test(lower))                                       return 'swimming'
  // "Ski Erg" must match BEFORE "skiing" / "rowing" — the bare-word checks
  // below would otherwise swallow it.
  if (/ski erg/.test(lower))                                    return 'ski_erg'
  // Outdoor skiing shares the ski-erg motion and gets the same zone
  // prescriptions (Roller Skiing was removed May 17 2026 — niche to
  // competitive Nordic skiers off-season training only).
  if (/skiing/.test(lower))                                     return 'ski_erg'
  if (/row erg/.test(lower))                                    return 'rowing'
  if (/air bike|assault bike|airdyne/.test(lower))              return 'air_bike'
  if (/spin|stationary|recumbent|bike erg/.test(lower))         return 'stationary_bike'
  if (/ellipt/.test(lower))                                     return 'elliptical'
  if (/cycl|bike/.test(lower))                                  return 'cycling'
  if (/ruck/.test(lower))                                       return 'rucking'

  // Duration-mode categories (StairMill only — Stair Climb outdoor was
  // removed in the May 2026 lifestyle-activity cleanup; Arc Trainer
  // was removed May 17 2026 as a niche gym machine).
  if (/stair/.test(lower))                                      return 'stair_climber'

  // Default for run / treadmill / hill running / trail running / anything
  // unmatched. Hill / Trail Running route here even though terrain confounds
  // pace zones — accepted divergence until HR-zone integration lands.
  return 'running'
}

// Group A — Endurance Athletes. Only this group gets the full E/T/V
// progression plan. Rucking is also in the cardio list but uses a
// load + distance progression model rather than pace zones (deferred —
// see CLAUDE.md). StairMill keeps its simple duration-tracking page
// until a round-based progression model is designed for it. Tier-3
// lifestyle/recreational activities (Walking, Hiking, Canoeing, etc.)
// were removed from cardio entirely during the May 2026 cleanup — they
// weren't training surfaces. May 17 2026 also removed Aqua Jogging
// (rehab niche), Roller Skiing (Nordic-skier niche), and Arc Trainer
// (gym-equipment niche) for similar low-coverage / niche-only reasons.
const ENDURANCE_ATHLETE_CATEGORIES: ActivityCategory[] = [
  'running', 'cycling', 'stationary_bike', 'air_bike',
  'rowing', 'ski_erg', 'swimming', 'elliptical',
]

function isEnduranceAthleteActivity(activityName: string): boolean {
  return ENDURANCE_ATHLETE_CATEGORIES.includes(categorizeActivity(activityName))
}

// Classify a logged effort into one of the three zones based on its pace
// relative to the user's current best. Used by the plan-queue generator to
// detect what zone the user just trained, and to decide what zone is next.
//   • paceSecs ≤ bestPace + 5 s/km   → vo2 (faster than 5K race pace)
//   • paceSecs ≤ bestPace + 25 s/km  → threshold (between 10K and 5K pace)
//   • otherwise                       → endurance (conversational pace)
function classifyEffortZone(effortValue: string | null | undefined, bestPaceSecPerKm: number): CardioZone {
  const paceSecs = parsePaceToSecs(effortValue)
  if (paceSecs === null || bestPaceSecPerKm <= 0) return 'endurance'
  if (paceSecs <= bestPaceSecPerKm + 5)  return 'vo2'
  if (paceSecs <= bestPaceSecPerKm + 25) return 'threshold'
  return 'endurance'
}

// Days since the user's most recent effort in a given zone. Returns 999 if
// they've never logged anything in that zone. Drives the plan's "don't let
// any zone go stale" rule.
function daysSinceLastEffortInZone(efforts: Effort[], zone: CardioZone, bestPaceSecPerKm: number): number {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifyEffortZone(efforts[i].value, bestPaceSecPerKm) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

// ── Per-zone session prescriptions (locked design spec — see CLAUDE.md) ──────
// Each (activity, zone) maps to a FIXED distance (pace mode) or duration
// (duration mode). Pace adapts to the user's level via the zone offset; the
// computed time = distance × pace varies per user, but the prescribed distance
// stays the same. This is how coaches actually prescribe — the work is fixed,
// the speed is what scales with fitness.
//
// Distances chosen for "what a normal trainee would do in a session" — NOT for
// race-event distances. No 100 km bike, no marathon run, etc.

interface PaceZoneSession {
  /** Fixed total distance in km for this (activity, zone) combo. */
  distanceKm: number
  /** For interval zones (threshold, vo2): break total work into N reps. */
  intervalReps?: number
}

// PACE_ZONE_SESSIONS — each zone holds an ARRAY of variants. The queue
// generator cycles through them so consecutive same-zone steps look
// different (no more 5 Endurance tiles all showing "6 km / 45:30"). For
// slow users the 45-min cap may collapse some variants to the same display;
// variety opens up as the user gets faster.
const PACE_ZONE_SESSIONS: Record<string, Partial<Record<CardioZone, PaceZoneSession[]>>> = {
  running: {
    endurance: [
      { distanceKm: 5 },   // easy
      { distanceKm: 6 },   // steady
      { distanceKm: 8 },   // long (caps for slower runners)
    ],
    threshold: [
      { distanceKm: 3, intervalReps: 3 },  // short cruise
      { distanceKm: 4, intervalReps: 4 },  // standard cruise
    ],
    vo2: [
      { distanceKm: 2, intervalReps: 5 },  // 5 × 400 m short
      { distanceKm: 3, intervalReps: 5 },  // 5 × 600 m standard
    ],
  },
  rucking: {
    endurance: [{ distanceKm: 4 }, { distanceKm: 5 }, { distanceKm: 6 }],
    threshold: [{ distanceKm: 2, intervalReps: 3 }, { distanceKm: 3, intervalReps: 4 }],
    vo2:       [{ distanceKm: 1.5, intervalReps: 4 }, { distanceKm: 2, intervalReps: 5 }],
  },
  cycling: {
    endurance: [{ distanceKm: 15 }, { distanceKm: 25 }, { distanceKm: 30 }],
    threshold: [{ distanceKm: 9, intervalReps: 3 }, { distanceKm: 12, intervalReps: 4 }],
    vo2:       [{ distanceKm: 6, intervalReps: 5 }, { distanceKm: 8, intervalReps: 5 }],
  },
  stationary_bike: {
    endurance: [{ distanceKm: 10 }, { distanceKm: 15 }, { distanceKm: 20 }],
    threshold: [{ distanceKm: 6, intervalReps: 3 }, { distanceKm: 8, intervalReps: 4 }],
    vo2:       [{ distanceKm: 4, intervalReps: 5 }, { distanceKm: 5, intervalReps: 5 }],
  },
  air_bike: {
    endurance: [{ distanceKm: 1.5 }, { distanceKm: 2.5 }, { distanceKm: 3.5 }],
    threshold: [{ distanceKm: 1.2, intervalReps: 3 }, { distanceKm: 1.5, intervalReps: 3 }],
    vo2:       [{ distanceKm: 0.75, intervalReps: 5 }, { distanceKm: 1, intervalReps: 5 }],
  },
  rowing: {
    endurance: [{ distanceKm: 3 }, { distanceKm: 4 }, { distanceKm: 5 }],
    threshold: [{ distanceKm: 2, intervalReps: 2 }, { distanceKm: 3, intervalReps: 3 }],
    vo2:       [{ distanceKm: 1.5, intervalReps: 3 }, { distanceKm: 2, intervalReps: 4 }],
  },
  ski_erg: {
    endurance: [{ distanceKm: 3 }, { distanceKm: 4 }, { distanceKm: 5 }],
    threshold: [{ distanceKm: 2, intervalReps: 2 }, { distanceKm: 3, intervalReps: 3 }],
    vo2:       [{ distanceKm: 1.5, intervalReps: 3 }, { distanceKm: 2, intervalReps: 4 }],
  },
  // Swimming has its own session structure (reps × distance + leaving
  // interval on a pool clock — see SWIM_ZONE_SESSIONS below) and routes
  // through SwimmingDetail, NOT PaceDetail. The entry below is a
  // safety-net fallback in case the dispatcher ever misroutes a swim
  // effort into PaceDetail; the real prescription comes from
  // SWIM_ZONE_SESSIONS at the swimming detail component level.
  swimming: {
    endurance: [{ distanceKm: 0.8 }, { distanceKm: 1.0 }, { distanceKm: 1.5 }],
    threshold: [{ distanceKm: 1.0, intervalReps: 10 }, { distanceKm: 1.0, intervalReps: 5 }],
    vo2:       [{ distanceKm: 0.5, intervalReps: 10 }, { distanceKm: 0.6, intervalReps: 6 }],
  },
  elliptical: {
    endurance: [{ distanceKm: 3 }, { distanceKm: 5 }, { distanceKm: 7 }],
    threshold: [{ distanceKm: 2, intervalReps: 3 }, { distanceKm: 3, intervalReps: 4 }],
    vo2:       [{ distanceKm: 1.5, intervalReps: 4 }, { distanceKm: 2, intervalReps: 5 }],
  },
}

interface DurationZoneSession {
  /** Fixed total duration in seconds for this (activity, zone) combo. */
  durationSecs: number
  /** For interval zones: break total work into N reps. */
  intervalReps?: number
}

const DURATION_ZONE_SESSIONS: Record<string, Partial<Record<CardioZone, DurationZoneSession>>> = {
  stair_climber: {
    endurance: { durationSecs: 25 * 60 },
    threshold: { durationSecs: 12 * 60, intervalReps: 4 },
    vo2:       { durationSecs: 8 * 60,  intervalReps: 5 },
  },
}

// ── Swimming-specific zone sessions (science-backed defaults) ────────────────
// Swimming workouts are not "swim X km at Y pace" — they're interval SETS on
// a clock. The canonical structure: reps × distance, leave every (target time
// + rest). Distances come in 50m or 100m chunks because pool lengths are 25m
// or 50m. These defaults are from Maglischo "Swimming Even Faster" (1993),
// Doc Counsilman "Science of Swimming" (1968), and Costill's lactate-
// threshold research at Indiana — the same canonical sources every serious
// swim program (USA Swimming, NCAA, MySwimPro) draws from. The plan queue
// cycles through both variants per zone so consecutive same-zone steps look
// different (no five identical Endurance tiles in a row).
interface SwimZoneSession {
  /** Per-rep distance in meters. */
  repDistanceM: number
  /** Number of reps. */
  reps:         number
}

const SWIM_ZONE_SESSIONS: Record<CardioZone, readonly SwimZoneSession[]> = Object.freeze({
  endurance: [
    { repDistanceM: 100, reps: 8 },   // 8 × 100m — classic aerobic-base set
    { repDistanceM: 100, reps: 10 },  // 10 × 100m — more volume variant
  ],
  threshold: [
    { repDistanceM: 100, reps: 10 },  // 10 × 100m at T-pace — the canonical "T-pace test set" (Costill)
    { repDistanceM: 200, reps: 5 },   // 5 × 200m — longer-rep threshold variant
  ],
  vo2: [
    { repDistanceM: 50,  reps: 10 },  // 10 × 50m sprint — canonical short-rep VO2
    { repDistanceM: 100, reps: 6 },   // 6 × 100m at race pace — longer VO2 variant
  ],
})

// Per-100m pace offsets from CSS for each swimming zone. Same shape as
// the running offset table above, but tuned to swimming's narrower
// physiological window (water resistance means a 5 sec/100m pace change
// is a much bigger effort change than 5 sec/km on land). Offsets from
// Maglischo's training-zone tables.
const SWIM_ZONE_OFFSETS_SECS_PER_100M: Record<CardioZone, number> = Object.freeze({
  endurance: +12,  // 12 sec/100m slower than CSS — aerobic conversational pace
  threshold:  0,   // CSS itself — sustained moderate-hard
  vo2:        -7,  // 7 sec/100m faster than CSS — race-pace work
})

// Rest offset per zone — seconds added on top of target swim time to
// produce the leaving interval. Pool clocks tick at 5-second granularity,
// so leaving intervals get rounded to nearest 5s.
const SWIM_ZONE_REST_SECS: Record<CardioZone, number> = Object.freeze({
  endurance: 10,
  threshold: 10,
  vo2:       20,
})

const RIEGEL_EXPONENT = 1.06

// Lookup helpers — fall back to running / stair_climber if category is missing.
// Returns the FULL array of variants for the (activity, zone). The queue
// generator decides which variant to use based on its cycle counter.
function getPaceZoneSessionVariants(activity: string, zone: CardioZone): PaceZoneSession[] {
  const cat = categorizeActivity(activity)
  return PACE_ZONE_SESSIONS[cat]?.[zone]
      ?? PACE_ZONE_SESSIONS.running[zone]!
}

// ── Swimming CSS proxy (Riegel-projected 1000m-equivalent pace) ──────────────
//
// CSS = Critical Swim Speed = swimming's equivalent of a runner's threshold
// pace. The canonical formula requires a 400m time trial + 200m time trial:
// CSS = (400m time - 200m time) ÷ 200. That's friction we don't want at v1
// (forces an onboarding calibration session before the user sees a
// prescription). The Riegel-projection proxy below skips the calibration:
//
//   1. For each logged effort, project its time to a 1000m equivalent using
//      Riegel's law: T2 = T1 × (D2/D1)^1.06
//   2. Divide by 10 to get the projected pace per 100m
//   3. Take the MIN across all efforts — the user's best CSS-equivalent
//      fitness ever achieved
//
// Why MIN? An off-day at easy pace shouldn't downgrade the user's CSS — that
// would make next session's prescription artificially easy. CSS only improves
// when they swim faster than projected fitness. If the user genuinely detrains,
// the prescription will be too aggressive until they log a new harder effort —
// accepted divergence for v1. Each new effort can lower the CSS estimate
// (improve it), making the proxy more accurate over time.
//
// The MIN-of-projections approach also handles distance bias automatically:
// a 50m sprint projects to a SLOWER 1000m pace than a 1500m steady swim does,
// so cross-distance comparisons work without per-distance weighting.
function riegelProjectCSS(efforts: Effort[]): number | null {
  let bestCSS: number | null = null
  for (const e of efforts) {
    const parsed = parseEffortLabel(e.label)
    if (!parsed || parsed.timeSecs == null || parsed.timeSecs <= 0 || parsed.distKm <= 0) continue
    const distM = parsed.distKm * 1000
    const projected1000mTime = parsed.timeSecs * Math.pow(1000 / distM, RIEGEL_EXPONENT)
    const projectedPer100m   = projected1000mTime / 10
    if (bestCSS === null || projectedPer100m < bestCSS) {
      bestCSS = projectedPer100m
    }
  }
  return bestCSS
}

function getSwimZonePaceSecsPer100m(zone: CardioZone, cssSecsPer100m: number): number {
  // Floor at 40 s/100m — faster than the world record swim pace, so a
  // sanity guard against absurd projections for ultra-fast users.
  return Math.max(40, cssSecsPer100m + SWIM_ZONE_OFFSETS_SECS_PER_100M[zone])
}

function fmtPaceSecsPer100m(secsPer100m: number): string {
  const m = Math.floor(secsPer100m / 60)
  const s = Math.round(secsPer100m % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Format a swim distance with the user's unit preference. Defaults to
// rounding to nearest integer (no decimals — swim distances always come
// in whole numbers of meters or yards on a pool clock).
function fmtSwimDist(distM: number, swimUnit: 'm' | 'yd'): string {
  if (swimUnit === 'yd') {
    return `${Math.round(distM / 0.9144)} yd`
  }
  return `${Math.round(distM)} m`
}

function swimPaceUnitLabel(swimUnit: 'm' | 'yd'): string {
  return swimUnit === 'yd' ? '/100yd' : '/100m'
}

// Build a single swim plan step (one entry in the queue). The plan queue
// generator below cycles through SWIM_ZONE_SESSIONS variants the same way
// running's generatePlanQueue cycles through PACE_ZONE_SESSIONS variants.
interface SwimPlanStep {
  zone:                 CardioZone
  reps:                 number
  repDistanceM:         number
  zonePaceSecsPer100m:  number
  repTimeSecs:          number
  leavingIntervalSecs:  number
  restPerRepSecs:       number
  shortWork:            string    // "8 × 100m"
  shortPace:            string    // "1:38/100m"
  shortLeaving:         string    // "1:50"
  cue:                  string
}

function buildSwimPlanStep(
  zone:           CardioZone,
  cssSecsPer100m: number,
  swimUnit:       'm' | 'yd',
  session:        SwimZoneSession,
): SwimPlanStep {
  const zonePace = getSwimZonePaceSecsPer100m(zone, cssSecsPer100m)
  const repTime  = zonePace * session.repDistanceM / 100
  const restSecs = SWIM_ZONE_REST_SECS[zone]
  // Round leaving interval to nearest 5 seconds — pool clocks tick at 5s
  // granularity (5/10 second-hand intervals), and swimmers think in those
  // units ("leave on the :30" / "leave on the :45").
  const leavingInterval = Math.max(5, Math.round((repTime + restSecs) / 5) * 5)
  const restPerRep      = Math.max(0, leavingInterval - repTime)

  const repDistFormatted = fmtSwimDist(session.repDistanceM, swimUnit)
  const shortWork    = `${session.reps} × ${repDistFormatted}`
  const shortPace    = `${fmtPaceSecsPer100m(zonePace)}${swimPaceUnitLabel(swimUnit)}`
  const shortLeaving = fmtSecs(leavingInterval)

  const feelByZone: Record<CardioZone, string> = {
    endurance: 'easy aerobic effort',
    threshold: 'comfortably hard',
    vo2:       'race pace',
  }
  const cue = `Swim ${shortWork} at ${shortPace} pace (${feelByZone[zone]}). Leave every ${shortLeaving} — about ${Math.round(restPerRep)}s rest between reps.`

  return {
    zone,
    reps: session.reps,
    repDistanceM: session.repDistanceM,
    zonePaceSecsPer100m: zonePace,
    repTimeSecs: repTime,
    leavingIntervalSecs: leavingInterval,
    restPerRepSecs: restPerRep,
    shortWork,
    shortPace,
    shortLeaving,
    cue,
  }
}

// Swim effort zone classification. Same shape as running's classifier but
// works in per-100m space instead of per-km.
function classifySwimEffortZone(effortValue: string | null | undefined, cssSecsPer100m: number): CardioZone {
  const paceSecsPerKm = parsePaceToSecs(effortValue)
  if (paceSecsPerKm === null || cssSecsPer100m <= 0) return 'endurance'
  const paceSecsPer100m = paceSecsPerKm / 10
  if (paceSecsPer100m <= cssSecsPer100m - 4) return 'vo2'
  if (paceSecsPer100m <= cssSecsPer100m + 5) return 'threshold'
  return 'endurance'
}

function daysSinceLastSwimEffortInZone(efforts: Effort[], zone: CardioZone, cssSecsPer100m: number): number {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifySwimEffortZone(efforts[i].value, cssSecsPer100m) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

// Plan queue generator for swimming. Same polarized rules as running's
// generatePlanQueue (no hard back-to-back, freshness checks at 7d/10d,
// anti-stagnation interleave at 3 endurance in a row, default to endurance
// for ~80% volume share), but operates on per-100m pace and pulls from
// SWIM_ZONE_SESSIONS instead of PACE_ZONE_SESSIONS.
function generateSwimPlanQueue(
  efforts:        Effort[],
  cssSecsPer100m: number,
  swimUnit:       'm' | 'yd',
  count:          number = 8,
): SwimPlanStep[] {
  if (cssSecsPer100m <= 0) return []

  const lastEffort  = efforts[efforts.length - 1]
  const lastZone    = lastEffort ? classifySwimEffortZone(lastEffort.value, cssSecsPer100m) : null
  const daysSinceT0 = daysSinceLastSwimEffortInZone(efforts, 'threshold', cssSecsPer100m)
  const daysSinceV0 = daysSinceLastSwimEffortInZone(efforts, 'vo2',       cssSecsPer100m)

  const zoneQueue: CardioZone[] = []
  let virtualLast    = lastZone
  let virtualDaysT   = daysSinceT0
  let virtualDaysV   = daysSinceV0
  let endurStreak    = 0
  let lastHard: CardioZone | null = null

  for (let i = 0; i < count; i++) {
    let next: CardioZone
    if (virtualLast === 'threshold' || virtualLast === 'vo2') {
      next = 'endurance'
    } else if (virtualDaysV >= 10) {
      next = 'vo2'
    } else if (virtualDaysT >= 7) {
      next = 'threshold'
    } else if (endurStreak >= 3) {
      next = lastHard === 'threshold' ? 'vo2' : 'threshold'
    } else {
      next = 'endurance'
    }
    zoneQueue.push(next)
    virtualLast = next
    if (next === 'endurance') {
      endurStreak++
    } else {
      endurStreak = 0
      lastHard = next
    }
    const gapDays = next === 'endurance' ? 1 : 2
    virtualDaysT = next === 'threshold' ? 0 : virtualDaysT + gapDays
    virtualDaysV = next === 'vo2'       ? 0 : virtualDaysV + gapDays
  }

  const variantIdxByZone: Record<CardioZone, number> = { endurance: 0, threshold: 0, vo2: 0 }
  return zoneQueue.map(zone => {
    const variants    = SWIM_ZONE_SESSIONS[zone]
    const variantIdx  = variantIdxByZone[zone] % variants.length
    variantIdxByZone[zone]++
    return buildSwimPlanStep(zone, cssSecsPer100m, swimUnit, variants[variantIdx])
  })
}

// ── Plan queue (the dynamic progression — locked, see CLAUDE.md) ─────────────
// A queue of 8 upcoming steps is generated live whenever a Group A movement's
// detail page renders. The queue is NOT stored — it's a pure function of
// (activity, efforts history, current best pace). Every effort the user logs
// regenerates the queue on next render, so it never goes stale.
//
// Rules (polarized model, in priority order):
//   1. After a hard session (Threshold or VO2), next step is Endurance.
//   2. If VO2 hasn't been done in 10+ days, next non-recovery step is VO2.
//   3. If Threshold hasn't been done in 7+ days, next non-recovery step is
//      Threshold.
//   4. After 3 Endurance steps in a row, insert a hard step (alternates
//      Threshold/VO2 so neither dominates).
//   5. Default: Endurance.
//
// This produces an ~80% Endurance / 20% T+V split — the polarized training
// model used by elite endurance athletes (Stephen Seiler's research).

interface PlanStep {
  zone:             CardioZone
  rx:               AdjustedPaceRx
  cue:              string   // work + pace/speed coaching sentence (no rest — rest lives on restLine)
  restLine:         string   // dedicated rest descriptor for its own line (empty for endurance)
  shortWork:        string   // tile row 1 + hero row 1 (e.g. "5 × 600 m" or "8 km")
  shortTime:        string   // hero row 2 (non-speed) or row 3 (speed). Format "3:00" or "37:30".
  /** Speed display for speed machines only — e.g. "12.0 km/h" / "7.5 mph".
   *  null for non-speed activities. Used in: tile row line 2 + hero row 2. */
  shortSpeed:       string | null
  restDays:         number   // 0 = next session whenever ready, 1 = next day, 2 = day after next
  restLabel:        string   // human-readable rest descriptor for the tile
  /** Pacing checkpoint for hero row 3 (NON-speed activities only). Speed
   *  machines don't need this row because the machine holds speed constant —
   *  there's no mid-interval drift to verify against a sub-distance split. */
  pacingCheckpoint: { value: string; descriptor: string } | null
}

function generatePlanQueue(
  activity:         string,
  efforts:          Effort[],
  bestPaceSecPerKm: number,
  distUnit:         'km' | 'mi',
  count:            number = 8,
): PlanStep[] {
  if (bestPaceSecPerKm <= 0) return []

  // Snapshot recent history.
  const lastEffort   = efforts[efforts.length - 1]
  const lastZone     = lastEffort ? classifyEffortZone(lastEffort.value, bestPaceSecPerKm) : null
  const daysSinceT0  = daysSinceLastEffortInZone(efforts, 'threshold', bestPaceSecPerKm)
  const daysSinceV0  = daysSinceLastEffortInZone(efforts, 'vo2',       bestPaceSecPerKm)

  // Walk the polarized rules to build a sequence of zones.
  const zoneQueue: CardioZone[] = []
  let virtualLast    = lastZone
  let virtualDaysT   = daysSinceT0
  let virtualDaysV   = daysSinceV0
  let endurStreak    = 0   // how many Endurance steps in a row
  let lastHard: CardioZone | null = null   // which hard zone we did last (for alternating)

  for (let i = 0; i < count; i++) {
    let next: CardioZone

    if (virtualLast === 'threshold' || virtualLast === 'vo2') {
      // Rule 1: no hard back-to-back
      next = 'endurance'
    } else if (virtualDaysV >= 10) {
      // Rule 2: VO2 stale
      next = 'vo2'
    } else if (virtualDaysT >= 7) {
      // Rule 3: Threshold stale
      next = 'threshold'
    } else if (endurStreak >= 3) {
      // Rule 4: too much easy — interleave a hard. Alternate so neither dominates.
      next = lastHard === 'threshold' ? 'vo2' : 'threshold'
    } else {
      // Rule 5: default to Endurance (most volume)
      next = 'endurance'
    }

    zoneQueue.push(next)

    // Update virtual state for the next iteration.
    virtualLast = next
    if (next === 'endurance') {
      endurStreak++
    } else {
      endurStreak = 0
      lastHard = next
    }
    // Each step ~1-2 days apart depending on intensity.
    const gapDays = next === 'endurance' ? 1 : 2
    virtualDaysT = next === 'threshold' ? 0 : virtualDaysT + gapDays
    virtualDaysV = next === 'vo2'       ? 0 : virtualDaysV + gapDays
  }

  // Convert zones to full PlanStep objects with prescriptions + cues. Each
  // zone cycles through its variants independently — so 5 Endurance steps in
  // a row produce 3 visually distinct variants (cycling) rather than 5
  // identical "6 km / 45:30" tiles. Faster users see more variant variety;
  // slower users see partial variety (some variants collapse to the same
  // display under the 45-min cap).
  const variantIdxByZone: Record<CardioZone, number> = { endurance: 0, threshold: 0, vo2: 0 }

  return zoneQueue.map(zone => {
    const variants    = getPaceZoneSessionVariants(activity, zone)
    const variantIdx  = variantIdxByZone[zone] % variants.length
    variantIdxByZone[zone]++
    return buildPlanStep(zone, activity, bestPaceSecPerKm, distUnit, variants[variantIdx])
  })
}

// Pacing checkpoint — answers "how long should each split take me?". The
// checkpoint distance scales with the interval size so the user always gets
// a non-redundant target they can verify mid-interval on their watch:
//   • continuous (≥1 km)         → per km (or per mile in imperial)
//   • intervals exactly 1 km     → per 500 m (mid-interval split)
//   • intervals 600–800 m        → per 200 m (third / quarter split)
//   • intervals 400–500 m        → per 100 m (track-standard split)
//   • intervals < 400 m          → no checkpoint (interval is short enough)
// Lives in buildPlanStep so the value flows through the PlanStep object
// (used by the hero pacing-checkpoint row AND the cue sentence).
function computePacingCheckpoint(
  rx:       AdjustedPaceRx,
  distUnit: 'km' | 'mi',
  zonePace: number,
): { value: string; descriptor: string } | null {
  const isInterval = rx.numReps > 1
  const repKm      = rx.repKm

  let checkpointKm: number
  let descriptor:   string

  if (!isInterval) {
    if (distUnit === 'mi') {
      checkpointKm = KM_PER_MI
      descriptor   = 'per mile'
    } else {
      checkpointKm = 1
      descriptor   = 'per km'
    }
  } else {
    const repMeters = repKm * 1000
    if (repMeters < 400) {
      return null
    } else if (repMeters >= 400 && repMeters < 600) {
      checkpointKm = 0.1
      descriptor   = 'per 100 m'
    } else if (repMeters >= 600 && repMeters <= 800) {
      checkpointKm = 0.2
      descriptor   = 'per 200 m'
    } else if (repMeters > 800 && repMeters <= 1000) {
      checkpointKm = 0.5
      descriptor   = 'per 500 m'
    } else {
      if (distUnit === 'mi') {
        checkpointKm = KM_PER_MI
        descriptor   = 'per mile'
      } else {
        checkpointKm = 1
        descriptor   = 'per km'
      }
    }
  }

  const secs = checkpointKm * zonePace
  return { value: fmtSecs(Math.round(secs)), descriptor }
}

// Build a single PlanStep from a zone — wraps prescription + cue + rest in one
// object so the UI doesn't have to know any of the zone math.
function buildPlanStep(
  zone:             CardioZone,
  activity:         string,
  bestPaceSecPerKm: number,
  distUnit:         'km' | 'mi',
  session:          PaceZoneSession,
): PlanStep {
  const zonePace   = getZonePaceSecPerKm(zone, bestPaceSecPerKm)
  const rx         = adjustPaceForTimeCap(zone, session, zonePace)
  const verb       = getActivityVerb(activity)
  const isInterval = zone === 'threshold' || zone === 'vo2'

  // Speed-mode machines: display "Speed (km/h)" as the prescription anchor
  // instead of "Pace (per km)". The user reads/sets speed directly on the
  // machine console. shortSpeed feeds the tile row line 2 AND hero row 2.
  const speedMachine = isSpeedMachine(activity)
  const shortSpeed   = speedMachine ? formatSpeed(zonePace, distUnit) : null

  // Pacing checkpoint feeds the hero's third row AND the cue sentence — but
  // ONLY for non-speed activities. Speed machines drop the checkpoint row
  // (constant speed → no mid-interval drift to verify against).
  const pacingCheckpoint = speedMachine ? null : computePacingCheckpoint(rx, distUnit, zonePace)
  const pacingSentence   = pacingCheckpoint
    ? ` — aim for ${pacingCheckpoint.value} ${pacingCheckpoint.descriptor}`
    : ''

  // Rest between this step and the next. Endurance steps have no rest
  // descriptor at all (the user does easy days as often as they want);
  // Threshold and VO2 explicitly call out a rest window because they're
  // hard sessions the body needs to recover from.
  const restDays   = zone === 'endurance' ? 0 : (zone === 'threshold' ? 1 : 2)
  const restLabel  = restDays === 0 ? '' : restDays === 1 ? '1 day rest' : '2 days rest'
  const restTail   = restDays === 1
    ? 'then take 1 day easy before your next step'
    : restDays === 2
      ? 'then take 2 days easy before your next step'
      : ''

  if (!isInterval) {
    const totalDist = fmtDist(rx.totalKm, distUnit)
    const totalTime = fmtSecs(rx.totalSecs)
    // Speed-machine cue reads "set speed, run distance, time falls out"
    // (matching how the user actually operates the machine).
    const cue = speedMachine
      ? `${verb.imperative} ${totalDist} at ${shortSpeed} — should take ${totalTime}.`
      : `${verb.imperative} ${totalDist} in ${totalTime} at steady conversation pace${pacingSentence}.`
    return {
      zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed,
      shortWork: totalDist,
      shortTime: totalTime,
      cue,
      restLine: '',
    }
  }

  const repDist  = fmtDist(rx.repKm, distUnit)
  const repTime  = fmtSecs(Math.round(rx.repKm * zonePace))
  // For speed machines, the between-interval recovery isn't "jog" (you can't
  // jog on a stationary machine) — it's an easy-pace continuation of the
  // same machine motion. Re-word accordingly.
  const restNote = speedMachine
    ? (zone === 'threshold'
        ? `Easy ${verb.lower} 60 sec between cruise intervals`
        : `Equal-time easy ${verb.lower} recovery between intervals`)
    : (zone === 'threshold'
        ? 'Jog 60 sec between cruise intervals'
        : 'Equal-time jog recovery between intervals')
  const cue = speedMachine
    ? `${verb.imperative} ${rx.numReps} × ${repDist} at ${shortSpeed} — should take ${repTime} each.`
    : `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each${pacingSentence}.`
  return {
    zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed,
    shortWork: `${rx.numReps} × ${repDist}`,
    shortTime: repTime,
    cue,
    restLine: `${restNote} · ${restTail}`,
  }
}

function getDurationZoneSession(activity: string, zone: CardioZone): DurationZoneSession {
  const cat = categorizeActivity(activity)
  return DURATION_ZONE_SESSIONS[cat]?.[zone]
      ?? DURATION_ZONE_SESSIONS.stair_climber[zone]!
}

// ── 45-min total-session cap (locked — see CLAUDE.md) ────────────────────────
// No prescribed session may exceed 45 minutes of total time (work + rest for
// intervals). Two adjustment strategies:
//   • Continuous zones: shrink the prescribed distance so distance × pace ≤ 45 min.
//   • Interval zones: reduce the rep count until total time ≤ 45 min.
const TIME_CAP_SECS = 45 * 60

// Round a "would-be" distance to a presentation-friendly value (0.1 km / 0.5 km /
// 1 km buckets depending on magnitude). Avoids "6.43 km" weirdness in the hero.
function niceCapKm(rawKm: number): number {
  if (rawKm < 1) return Math.max(0.1, Math.round(rawKm * 10) / 10)
  if (rawKm < 5) return Math.round(rawKm * 2) / 2
  return Math.max(1, Math.round(rawKm))
}

interface AdjustedPaceRx {
  numReps:    number   // 1 for continuous
  repKm:      number   // distance per rep (= full distance for continuous)
  totalKm:    number   // total distance covered (= repKm × numReps)
  workSecs:   number   // total work time (all reps)
  restSecs:   number   // total rest time (intervals only)
  totalSecs:  number   // workSecs + restSecs (≤ TIME_CAP_SECS)
  wasCapped:  boolean
}

function adjustPaceForTimeCap(
  zone: CardioZone,
  rawSession: PaceZoneSession,
  paceSecPerKm: number,
): AdjustedPaceRx {
  const isInterval = zone === 'threshold' || zone === 'vo2'

  if (!isInterval) {
    const rawWorkSecs = rawSession.distanceKm * paceSecPerKm
    if (rawWorkSecs <= TIME_CAP_SECS) {
      return {
        numReps:   1,
        repKm:     rawSession.distanceKm,
        totalKm:   rawSession.distanceKm,
        workSecs:  rawWorkSecs,
        restSecs:  0,
        totalSecs: rawWorkSecs,
        wasCapped: false,
      }
    }
    // Cap distance to fit 45 min
    const cappedRawKm = TIME_CAP_SECS / paceSecPerKm
    const cappedKm    = niceCapKm(cappedRawKm)
    const newWorkSecs = Math.round(cappedKm * paceSecPerKm)
    return {
      numReps:   1,
      repKm:     cappedKm,
      totalKm:   cappedKm,
      workSecs:  newWorkSecs,
      restSecs:  0,
      totalSecs: newWorkSecs,
      wasCapped: true,
    }
  }

  // Intervals — reduce rep count until total time ≤ 45 min.
  //
  // Rest values come from Jack Daniels' Running Formula (3rd ed.):
  //   • Threshold (T-pace) "Cruise Intervals" → 60 sec jog recovery between reps
  //   • VO2 (I-pace) "Intervals"               → equal-time jog recovery (1:1 work:rest)
  const rawReps    = rawSession.intervalReps ?? 4
  const repKm      = rawSession.distanceKm / rawReps
  const repSecs    = repKm * paceSecPerKm
  const restPerGap = zone === 'threshold' ? 60 : repSecs

  let reps = rawReps
  while (reps > 1) {
    const candidateSecs = reps * repSecs + (reps - 1) * restPerGap
    if (candidateSecs <= TIME_CAP_SECS) break
    reps--
  }

  const workSecs  = Math.round(reps * repSecs)
  const restSecs  = Math.round((reps - 1) * restPerGap)
  const totalSecs = workSecs + restSecs
  return {
    numReps:   reps,
    repKm:     repKm,
    totalKm:   repKm * reps,
    workSecs,
    restSecs,
    totalSecs,
    wasCapped: reps !== rawReps,
  }
}

interface AdjustedDurationRx {
  numReps:   number     // 1 for continuous
  repSecs:   number     // duration per rep (= full duration for continuous)
  workSecs:  number     // total work time
  restSecs:  number     // total rest (intervals only)
  totalSecs: number     // ≤ TIME_CAP_SECS
  wasCapped: boolean
}

function adjustDurationForTimeCap(
  zone: CardioZone,
  rawSession: DurationZoneSession,
): AdjustedDurationRx {
  const isInterval = zone === 'threshold' || zone === 'vo2'

  if (!isInterval) {
    const totalSecs = Math.min(rawSession.durationSecs, TIME_CAP_SECS)
    return {
      numReps:   1,
      repSecs:   totalSecs,
      workSecs:  totalSecs,
      restSecs:  0,
      totalSecs,
      wasCapped: totalSecs < rawSession.durationSecs,
    }
  }

  const rawReps    = rawSession.intervalReps ?? 4
  const repSecs    = Math.max(30, Math.round(rawSession.durationSecs / rawReps))
  const restPerGap = repSecs // equal recovery for duration intervals

  let reps = rawReps
  while (reps > 1) {
    const candidateSecs = reps * repSecs + (reps - 1) * restPerGap
    if (candidateSecs <= TIME_CAP_SECS) break
    reps--
  }

  const workSecs  = reps * repSecs
  const restSecs  = (reps - 1) * restPerGap
  return {
    numReps:   reps,
    repSecs,
    workSecs,
    restSecs,
    totalSecs: workSecs + restSecs,
    wasCapped: reps !== rawReps,
  }
}

// Activity-aware action verb for the hero card cue line. "Run easy at..."
// makes sense for running but is wrong for Air Bike, Rowing, Swimming, etc.
// Returns the imperative form ("Run", "Pedal", "Row") + a lowercase form for
// mid-sentence use ("tempo run", "tempo pedal", ...).
function getActivityVerb(activity: string): { imperative: string; lower: string } {
  const lower = activity.toLowerCase()
  if (/swim/.test(lower))                                         return { imperative: 'Swim',  lower: 'swim'  }
  if (/row erg/.test(lower))                                      return { imperative: 'Row',   lower: 'row'   }
  if (/ski erg|skiing/.test(lower))                               return { imperative: 'Ski',   lower: 'ski'   }
  if (/cycl|bike|spin|stationary/.test(lower))                    return { imperative: 'Pedal', lower: 'pedal' }
  if (/ruck/.test(lower))                                         return { imperative: 'Ruck',  lower: 'ruck'  }
  if (/ellipt/.test(lower))                                       return { imperative: 'Glide', lower: 'glide' }
  // Default: running (includes Hill Running, Trail Running, Running, Running (Treadmill))
  return { imperative: 'Run', lower: 'run' }
}

// Hero-card cue line per zone — the FULL workout descriptor as a single
// coaching sentence. Includes activity verb, distance, time target, rest
// pattern, and intensity feel. The user reads this and knows the entire
// session in one line. The dual rows above this line are a quick visual
// reference; this is the prescription in words.
function getZonePaceCue(
  zone:        CardioZone,
  activity:    string,
  rx:          AdjustedPaceRx,
  paceSecPerKm: number,
  distUnit:    'km' | 'mi',
): string {
  const verb = getActivityVerb(activity)

  if (zone === 'endurance') {
    const totalDist = fmtDist(rx.totalKm, distUnit)
    const totalTime = fmtSecs(rx.totalSecs)
    return `${verb.imperative} ${totalDist} in ${totalTime} — steady conversation pace, resist pushing`
  }

  // Intervals (threshold + vo2)
  const repDist = fmtDist(rx.repKm, distUnit)
  const repTime = fmtSecs(Math.round(rx.repKm * paceSecPerKm))

  if (zone === 'threshold') {
    // Daniels' Cruise Intervals: 60 sec jog recovery between reps at T-pace.
    return `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each — jog 60 sec between cruise intervals. After your session, log your best ${repDist}.`
  }
  // VO2: equal-time jog recovery between reps at I-pace.
  return `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each — equal-time jog recovery, max sustainable effort. After your session, log your best ${repDist}.`
}

// Hero-card cue line per zone for DURATION-MODE movements. Same idea —
// the full workout descriptor as one sentence.
function getZoneDurationCue(zone: CardioZone, rx: AdjustedDurationRx): string {
  if (zone === 'endurance') {
    const totalTime = fmtSecs(rx.totalSecs)
    return `${totalTime} — conversational intensity, steady rhythm throughout`
  }

  const repTime = fmtSecs(rx.repSecs)
  if (zone === 'threshold') {
    return `${rx.numReps} × ${repTime} hard — 60 sec rest between cruise intervals`
  }
  return `${rx.numReps} × ${repTime} max effort — equal-time rest between intervals`
}

// Pulsing chevron used to flank the zone pill — amber-toned version of the
// BwAnimatedChevron in strength's [exercise].tsx. Same 1.5s cycle:
//   • 0.00s – 0.25s: fade in
//   • 0.25s – 1.00s: visible
//   • 1.00s – 1.25s: fade out
//   • 1.25s – 1.50s: invisible gap, loop
function AmberAnimatedChevron({
  direction,
  delay,
  size = 16,
  color,
}: {
  direction: 'left' | 'right'
  delay:     number
  size?:     number
  color:     string
}) {
  const opacity = useSharedValue(0)
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 250 }),
          withTiming(1, { duration: 750 }),
          withTiming(0, { duration: 250 }),
          withTiming(0, { duration: 250 }),
        ),
        -1,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight
  return (
    <Animated.View style={animStyle}>
      <Icon size={size} color={color} />
    </Animated.View>
  )
}

// ── Common navigation ───────────────────────────────────────────────────────

function goBack() {
  if (router.canGoBack()) router.back()
  else router.replace('/(app)/cardio' as any)
}

function BackButton() {
  // Native-style chevron-only back affordance. Web has a wordy "← Back" link;
  // on mobile, every modern app (Instagram, Spotify, Gmail, etc.) shows just a
  // chevron in the top-left. hitSlop expands the tappable area beyond the
  // visible icon so the small target is still easy to hit.
  return (
    <Pressable onPress={goBack} style={s.backBtn} hitSlop={12} accessibilityLabel="Go back">
      <ChevronLeft size={24} color={colors.foreground} />
    </Pressable>
  )
}

// ── Main route component ────────────────────────────────────────────────────

export default function CardioDetailRoute() {
  const { activity: rawActivity } = useLocalSearchParams<{ activity: string }>()
  const activity = typeof rawActivity === 'string' ? decodeURIComponent(rawActivity) : ''
  const { user, profile } = useAuth()
  const profileDistUnit = ((profile as any)?.distance_unit as 'km' | 'mi' | undefined) || 'km'
  // Swimming distance preference — separate from run/cycle distance unit
  // because someone running miles outdoors can still swim meters indoors.
  // Defaults to 'm' (international convention + Olympic / 25m pools).
  const swimUnit: 'm' | 'yd' = ((profile as any)?.swim_unit as 'm' | 'yd' | undefined) || 'm'

  const dbMovements = useMovements()
  const movementRecord = dbMovements.find(m => m.name === activity) ?? null

  // Movement-level unit lock overrides profile preference. Rucking is locked
  // to 'mi' (community-dominated unit — GoRuck and US tactical fitness use
  // miles universally; the 12-mile ruck is the canonical benchmark). Same
  // mechanism as the log form's unit-lock chip on `cardio.tsx`.
  const distUnitLock = (movementRecord?.unit_lock === 'km' || movementRecord?.unit_lock === 'mi')
    ? movementRecord.unit_lock as 'km' | 'mi'
    : null
  const distUnit: 'km' | 'mi' = distUnitLock ?? profileDistUnit
  const mode: 'pace' | 'duration' =
    movementRecord?.cardio_mode === 'duration' ? 'duration' : 'pace'

  const [efforts, setEfforts] = useState<Effort[]>([])
  const [loading, setLoading] = useState(true)

  async function handleDeleteEffort(id: string) {
    setEfforts(prev => prev.filter(e => e.id !== id))
    if (user) await supabase.from('efforts').delete().eq('id', id).eq('user_id', user.id)
  }

  // Add a new effort to local state + persist to Supabase. Used by the
  // "✓ Log this session" button on the NEXT STEP card — one-tap commit of
  // the prescribed step. The local-state update triggers an immediate
  // re-render, the queue regenerates, the new step appears.
  async function handleAddEffort(label: string, value: string) {
    if (!user) return
    const { data, error } = await supabase
      .from('efforts')
      .insert({ user_id: user.id, type: 'cardio', label, value })
      .select()
      .single()
    if (error || !data) return
    setEfforts(prev => [...prev, data as Effort])
  }

  // Swimming consolidates 4 stroke variants + legacy bare-Swimming labels.
  // The wrapper handles per-stroke filtering at render time, but the FETCH
  // needs to pull all swim efforts in one query. For other activities,
  // the standard `ilike` filter is fine.
  const swimMode = isSwimActivity(activity)

  useEffect(() => {
    if (!user || !activity) return
    let alive = true
    let query = supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'cardio')

    if (swimMode) {
      // Match all four stroke variants AND the legacy "Swimming · ..."
      // format (no brackets — labels from before the May 17 2026 stroke
      // consolidation default to Freestyle on the parse path).
      query = query.or([
        'label.ilike.Swimming [Freestyle] ·%',
        'label.ilike.Swimming [Backstroke] ·%',
        'label.ilike.Swimming [Breaststroke] ·%',
        'label.ilike.Swimming [Butterfly] ·%',
        'label.ilike.Swimming ·%',
      ].join(','))
    } else {
      query = query.ilike('label', `${activity} ·%`)
    }

    query
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        setEfforts((data ?? []) as Effort[])
        setLoading(false)
      })
    return () => { alive = false }
  }, [user, activity, swimMode])

  if (loading) {
    return (
      <View style={s.page}>
        <Skeleton style={{ height: 36, width: 36, borderRadius: 9999, marginBottom: 8 }} />
        <View style={{ gap: 8, marginBottom: 16 }}>
          <Skeleton style={{ height: 22, width: 200, borderRadius: 6 }} />
          <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
        </View>
        <View style={{ gap: 16 }}>
          {/* Projections */}
          <Skeleton style={{ height: 144, width: '100%', borderRadius: 16 }} />
          {/* Chart */}
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 16 }} />
          {/* Log list */}
          <Skeleton style={{ height: 320, width: '100%', borderRadius: 16 }} />
        </View>
      </View>
    )
  }

  // Swimming bypasses the page-level "no efforts" guard so the
  // consolidated wrapper can render its per-stroke empty state cards
  // (e.g., "Log your first backstroke effort..."). Every other activity
  // still short-circuits here.
  if (!swimMode && efforts.length === 0) {
    return (
      <View style={s.page}>
        <BackButton />
        <Text style={s.helpText}>No efforts found for {activity}.</Text>
      </View>
    )
  }

  if (mode === 'duration') {
    return <DurationDetail activity={activity} efforts={efforts} onDelete={handleDeleteEffort} />
  }
  // Swimming gets its own consolidated component because:
  //   • Hero card layout is fundamentally different (3 values not 2 —
  //     reps × distance + pace + leaving interval).
  //   • CSS-anchored zone math operates in per-100m space, not per-km.
  //   • 4 stroke variants (Freestyle / Backstroke / Breaststroke /
  //     Butterfly) collapse into one detail page with a stroke pill
  //     carousel at the top, mirroring Sled Drag's PUSH / PULL pattern.
  // Same outer chrome (header + plan card + chart + log list); the
  // wrapper injects the pill row, inner SwimmingDetail renders the rest.
  if (swimMode) {
    return <SwimmingConsolidatedDetail efforts={efforts} swimUnit={swimUnit} onDelete={handleDeleteEffort} />
  }
  return <PaceDetail activity={activity} efforts={efforts} distUnit={distUnit} onDelete={handleDeleteEffort} onAddEffort={handleAddEffort} />
}

// ─────────────────────────────────────────────────────────────────────────────
// PaceDetail
// ─────────────────────────────────────────────────────────────────────────────

function PaceDetail({
  activity, efforts, distUnit, onDelete, onAddEffort,
}: {
  activity:    string
  efforts:     Effort[]
  distUnit:    'km' | 'mi'
  onDelete:    (id: string) => void
  onAddEffort: (label: string, value: string) => Promise<void>
}) {
  // Only Group A (endurance athletes) gets the progression plan. Rucking
  // is in cardio but progresses on load + distance rather than pace zones —
  // it falls through to the simple tracking page (header + chart + history)
  // until its own progression model is designed. See CLAUDE.md.
  const isGroupA = isEnduranceAthleteActivity(activity)

  // Best = fastest (lowest pace seconds-per-km)
  let bestEffort:  Effort | null = null
  let bestPaceSecs = Infinity
  efforts.forEach(e => {
    const secs = parsePaceToSecs(e.value)
    if (secs !== null && secs < bestPaceSecs) { bestPaceSecs = secs; bestEffort = e }
  })
  const hasBestPace = bestPaceSecs > 0 && bestPaceSecs !== Infinity

  // Chart data — for speed machines, plot SPEED over time (higher = better,
  // line trends UP as user improves); for everyone else plot pace (lower =
  // better, line trends DOWN, axis reversed). y in the (ts,y) tuple holds
  // whatever metric the chart's Y-axis is currently showing.
  const chartIsSpeed = isSpeedMachine(activity)
  const chartData = efforts
    .map(e => {
      const paceSecs = parsePaceToSecs(e.value)
      if (paceSecs === null) return { ts: e.created_at, y: -1 }
      const y = chartIsSpeed ? paceSecsPerKmToSpeedDisplay(paceSecs, distUnit) : paceSecs
      return { ts: e.created_at, y }
    })
    .filter(d => d.y >= 0)

  // ── Progression plan (Group A only) ──────────────────────────────────────
  // The queue is regenerated live from (activity, efforts, bestPace) every
  // time the component renders. Logging a new effort updates bestPace and
  // recent-zone history, which automatically reshapes the queue. The plan
  // never staleness-rots — it's a pure function of training data.
  const planQueue: PlanStep[] = useMemo(
    () => isGroupA && hasBestPace
      ? generatePlanQueue(activity, efforts, bestPaceSecs, distUnit, 8)
      : [],
    [isGroupA, hasBestPace, activity, efforts, bestPaceSecs, distUnit],
  )

  // UI state for the progression card. Default selection = step 0 (the
  // actual NEXT step). The tile row drives what the details card shows —
  // tap any tile to preview that step's prescription. Selection is never
  // null (always one tile is highlighted), mirroring strength's rep-max
  // tile pattern.
  const [zoneInfoOpen,    setZoneInfoOpen]    = useState(false)
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)

  // When the queue regenerates (after a new effort logs), reset to step 0.
  useEffect(() => {
    setZoneInfoOpen(false)
    setSelectedStepIdx(0)
  }, [planQueue.length, planQueue[0]?.zone])

  const selectedStep = planQueue[selectedStepIdx] ?? planQueue[0]
  const selectedIsInterval = selectedStep
    ? (selectedStep.zone === 'threshold' || selectedStep.zone === 'vo2')
    : false

  // Pacing checkpoint flows through PlanStep now — computed at buildPlanStep
  // time so the value can also live inside the cue sentence. The hero just
  // reads selectedStep.pacingCheckpoint directly.
  const pacingCheckpoint = selectedStep?.pacingCheckpoint ?? null

  return (
    <View style={s.page}>

      {/* Header — for speed machines, show "Best speed — N km/h" (matches
          what the user enters on the log form and reads off the console);
          for everyone else, show "Best pace — m:ss/km" as before. */}
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        <View style={s.subRow}>
          {isSpeedMachine(activity) ? (
            <>
              <Text style={s.subText}>Best speed — </Text>
              <TickerNumber
                value={
                  bestPaceSecs > 0 && bestPaceSecs !== Infinity
                    ? formatSpeed(bestPaceSecs, distUnit)
                    : '—'
                }
                fontSize={14}
                color={palette.amber[400]}
                fontWeight="600"
              />
            </>
          ) : (
            <>
              <Text style={s.subText}>Best pace — </Text>
              <TickerNumber
                value={convertStoredPace((bestEffort as Effort | null)?.value, distUnit)}
                fontSize={14}
                color={palette.amber[400]}
                fontWeight="600"
              />
            </>
          )}
        </View>
      </View>

      {/* Progression plan card. The tile row is the navigation; the details
          card below is driven by the SELECTED tile. Chevrons between tiles
          signal forward progression. No log buttons (logging happens via
          the Cardio tab). */}
      {isGroupA && hasBestPace && selectedStep && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Your progression plan</Text>
          <Text style={s.helpTextSm}>
            This is your personalized adaptation plan — follow it to see your results improve.
          </Text>

          {/* Tile row with chevrons between each pair, indicating forward
              direction. Selected tile (default: step 0) is highlighted. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 }}
            style={{ marginHorizontal: -2 }}
          >
            {planQueue.map((step, idx) => {
              const isSelected = selectedStepIdx === idx
              const isLast     = idx === planQueue.length - 1
              return (
                <Fragment key={idx}>
                  <Pressable
                    onPress={() => setSelectedStepIdx(idx)}
                    style={[s.queueTile, isSelected && s.queueTileSelected]}
                  >
                    <Text style={[s.queueTileZone, isSelected && s.queueTileZoneSelected]}>
                      {CARDIO_ZONE_CONFIG[step.zone].shortLabel}
                    </Text>
                    <Text style={[s.queueTileWork, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {step.shortWork}
                    </Text>
                    {/* Tile row line 2: speed for speed machines, time for
                        everyone else. Speed is the most distinguishing metric
                        at a glance when scanning upcoming tiles on a machine
                        (Endurance 8 km/h vs Threshold 11 km/h vs VO2 14 km/h). */}
                    <Text style={[s.queueTileTime, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {step.shortSpeed ?? step.shortTime}
                    </Text>
                  </Pressable>
                  {!isLast && (
                    <View style={s.queueChevron}>
                      <ChevronRight
                        size={22}
                        color={withAlpha(palette.amber[400], 0.7)}
                        strokeWidth={2.5}
                        style={{ transform: [{ scaleY: 1.3 }] }}
                      />
                    </View>
                  )}
                </Fragment>
              )
            })}
          </ScrollView>

          {/* Details card — shows the SELECTED step. Each big value sits on a
              row with a small right-aligned descriptor (intensity feel for the
              work row, "per interval" / "to complete", "per km"). No more
              small-caps labels above values — the descriptors say what each
              row is. */}
          <View style={s.hero}>
            {/* Zone info pill (top-right) — tappable for "why this zone". */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => setZoneInfoOpen(o => !o)}
                style={s.heroZonePillButton}
              >
                <Text style={s.heroZonePillText} numberOfLines={1}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].label}
                </Text>
                <Info size={11} color={palette.amber[400]} />
              </Pressable>
            </View>

            {zoneInfoOpen && (
              <Animated.View
                entering={FadeInUp.duration(200)}
                exiting={FadeOutUp.duration(180)}
                style={s.heroInfoPanel}
              >
                <Text style={s.heroInfoPanelTitle}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].label} · {CARDIO_ZONE_CONFIG[selectedStep.zone].hrPctRange}
                </Text>
                <Text style={s.heroInfoPanelBody}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].whyText}
                </Text>
              </Animated.View>
            )}

            {/* Three rows — value on the left (big amber), descriptor on the
                right (small muted). Mirrors strength's "value + descriptor"
                pattern (where descriptors say things like "per side" or
                "each hand"). The descriptor for the work row is the zone's
                intensity feel ("conversation pace", "comfortably hard", "max
                sustainable"); for the time and per-unit rows it identifies
                the unit context. */}
            <Animated.View layout={LinearTransition.duration(200)} style={{ gap: 14 }}>
              {/* Each big-value row uses TickerNumber so digits roll
                  slot-machine style when the selected step changes (e.g.,
                  tapping a different tile). Non-digit characters (×, m,
                  km/h, :, etc.) render as static Text inside the same row.
                  Style values mirror s.heroBigValue (fontSize 30, amber 400,
                  weight 700, JetBrainsMono Bold via TickerNumber's
                  monoForWeight resolver). */}
              <View style={s.heroValueRow}>
                <TickerNumber value={selectedStep.shortWork} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                <Text style={s.heroValueDescriptor} numberOfLines={2}>
                  {selectedStep.zone === 'endurance' ? 'conversation pace'
                    : selectedStep.zone === 'threshold' ? 'comfortably hard'
                    : 'max sustainable'}
                </Text>
              </View>
              {/* Row 2: Speed (for speed machines) OR Time (everyone else).
                  Speed is what the user sets on the machine console; Time
                  is what they read off it for outdoor / generic activities. */}
              {selectedStep.shortSpeed ? (
                <View style={s.heroValueRow}>
                  <TickerNumber value={selectedStep.shortSpeed} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={2}>
                    set on the console
                  </Text>
                </View>
              ) : (
                <View style={s.heroValueRow}>
                  <TickerNumber value={selectedStep.shortTime} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    {selectedIsInterval ? 'per interval' : 'to complete'}
                  </Text>
                </View>
              )}
              {/* Row 3: Time-derived display (speed machines) OR pacing
                  checkpoint (non-speed). Speed machines always show this
                  because the user wants to know how long their session
                  will be; non-speed activities only show it when the
                  computePacingCheckpoint helper produces a non-null target. */}
              {selectedStep.shortSpeed ? (
                <View style={s.heroValueRow}>
                  <TickerNumber value={selectedStep.shortTime} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    {selectedIsInterval ? 'per interval' : 'to complete'}
                  </Text>
                </View>
              ) : pacingCheckpoint ? (
                <View style={s.heroValueRow}>
                  <TickerNumber value={pacingCheckpoint.value} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    {pacingCheckpoint.descriptor}
                  </Text>
                </View>
              ) : null}
            </Animated.View>

            {/* Cue — work + pace sentence on line 1. Rest descriptor on its
                own line below (only for threshold / vo2 — endurance has no
                rest line). Splitting them makes the rest cue much more
                visible than when it was buried mid-sentence. */}
            <Animated.View
              layout={LinearTransition.duration(200)}
              style={s.heroSep}
            >
              <Text style={s.heroCue}>{selectedStep.cue}</Text>
              {selectedStep.restLine ? (
                <Text style={s.heroRestLine}>{selectedStep.restLine}</Text>
              ) : null}
            </Animated.View>
          </View>

          {/* Science attribution */}
          <Text style={s.tinyText}>Riegel · Daniels' · Seiler · pace zones & polarized 80/20</Text>
        </AnimateRise>
      )}

      {/* Empty-state hint for Group A users with no efforts logged yet. */}
      {isGroupA && !hasBestPace && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Progression plan</Text>
          <Text style={s.helpTextSm}>
            Log your first {activity} effort and your personalized plan will appear here.
            Every step adapts to your latest pace.
          </Text>
        </AnimateRise>
      )}

      {/* Progress chart over time. For speed machines: Y-axis = speed,
          non-reversed (higher = faster, line trends UP). For everyone
          else: Y-axis = pace, reversed (lower = faster, line trends DOWN).
          Amber line in either case (cardio's locked theme — strength's
          equivalent chart uses palette.blue[400]).

          Renders even with a single data point — LineChart centres it as a
          dot. The user sees their first effort plotted from day one rather
          than waiting for a second log to unlock the visual. */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>{chartIsSpeed ? 'Speed over time' : 'Pace over time'}</Text>
          <LineChart
            data={chartData}
            referenceY={
              bestPaceSecs !== Infinity
                ? (chartIsSpeed
                    ? paceSecsPerKmToSpeedDisplay(bestPaceSecs, distUnit)
                    : bestPaceSecs)
                : null
            }
            reversed={!chartIsSpeed}
            yWidth={chartIsSpeed ? 56 : 52}
            yTickFormatter={(v) => chartIsSpeed ? v.toFixed(1) : fmtPaceTick(v)}
            tooltipValueFormatter={(v) =>
              chartIsSpeed
                ? `${v.toFixed(1)} ${distUnit === 'mi' ? 'mph' : 'km/h'}`
                : fmtPaceStr(v, distUnit)
            }
            tooltipLabel={chartIsSpeed ? 'Speed' : 'Pace'}
            lineColor={palette.amber[400]}
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.95)),
              max: (mx) => Math.round(mx * 1.05),
            }}
            caption={
              <Text style={s.tinyText}>Dashed = personal best</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History — for speed machines, each row's right-side metric shows
          the speed equivalent of the stored pace; for everyone else, the
          stored pace value (converted to mi if needed). */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => {
            const paceSecs = parsePaceToSecs(e.value)
            const rightVal = isSpeedMachine(activity)
              ? (paceSecs ? formatSpeed(paceSecs, distUnit) : '—')
              : convertStoredPace(e.value, distUnit)
            return (
              <DeleteAction
                key={e.id}
                onDelete={() => onDelete(e.id)}
                style={i < arr.length - 1 ? s.listRowDivider : undefined}
                bg={colors.card}
              >
                <View style={s.listRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={s.listRowName}>
                      {e.label.split(' · ').slice(1).join(' · ')}
                    </Text>
                    <Text style={s.listRowDate}>
                      {new Date(e.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={s.valAmber}>{rightVal}</Text>
                </View>
              </DeleteAction>
            )
          })}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SwimmingConsolidatedDetail — 4-stroke wrapper around SwimmingDetail
// ─────────────────────────────────────────────────────────────────────────────
// The 4 stroke variants (Swimming [Freestyle/Backstroke/Breaststroke/
// Butterfly]) collapse into a single detail page with a stroke pill
// carousel at the top. Mirrors the SledDragConsolidatedDetail pattern
// from strength: the wrapper holds activeStroke state, filters efforts
// to that stroke, and renders the inner SwimmingDetail with
// `extraHeaderContent` (the pill row) injected. Pill swipe choreography
// matches the BW tier carousel and Sled Drag exactly:
//   • Single pill in the center showing the active stroke
//   • Pulsing chevrons on both sides (only present where there's a stroke
//     to navigate to — no wrap-around at the ends FREE / FLY)
//   • Pan gesture: chevrons fade out, pill follows finger, slides off
//     on commit, state flips via runOnJS, pill teleports + slides back in
// Default active stroke = whichever was logged most recently. If no
// efforts exist yet, defaults to Freestyle (the most common stroke).

function SwimmingConsolidatedDetail({
  efforts, swimUnit, onDelete,
}: {
  efforts:  Effort[]
  swimUnit: 'm' | 'yd'
  onDelete: (id: string) => void
}) {
  // Determine the most-recent stroke from the combined efforts list.
  // Falls back to freestyle if nothing's logged yet.
  const defaultStroke: SwimStroke = useMemo(() => {
    const sorted = [...efforts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    for (const e of sorted) {
      const stroke = parseSwimStroke(e.label)
      if (stroke) return stroke
    }
    return 'freestyle'
  }, [efforts])

  const [activeStroke, setActiveStroke] = useState<SwimStroke>(defaultStroke)

  // Filter efforts to the active stroke. SwimmingDetail computes
  // everything (CSS, plan queue, chart, history) from this filtered list,
  // so the stroke switch is the single trigger that drives the whole page.
  const filteredEfforts = useMemo(
    () => efforts.filter(e => parseSwimStroke(e.label) === activeStroke),
    [efforts, activeStroke],
  )

  const currentIdx = SWIM_STROKE_ORDER.indexOf(activeStroke)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx < SWIM_STROKE_ORDER.length - 1

  // Navigate one stroke in the requested direction. Bounded — no wrap.
  // Called via runOnJS from the gesture worklet, and directly from
  // chevron Pressables.
  const navigateStroke = (direction: -1 | 1) => {
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= SWIM_STROKE_ORDER.length) return
    setActiveStroke(SWIM_STROKE_ORDER[newIdx])
  }

  // ── Pill swipe gesture (BW-style choreography) ──────────────────────────
  // Same constants as Sled Drag's choreography. The reason both files
  // duplicate these magic numbers instead of sharing a constant: the
  // wrapper components own their own swipe behaviour and the values are
  // tuned per-page (mostly the same, but explicit-per-page leaves room
  // for divergence without a refactor).
  const SWIM_SWIPE_THRESHOLD_PX = 20
  const SWIM_SLIDE_OFFSCREEN_PX = 220
  const SWIM_SLIDE_DURATION_MS  = 250

  const swimPillTranslateX        = useSharedValue(0)
  const swimChevronOpacityOverride = useSharedValue(1)

  const swimPillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        swimChevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        swimPillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        // Finger swipes right (translationX positive) → expose what's on
        // the LEFT → navigate LEFT in the carousel (direction = -1).
        // Same convention as Sled Drag.
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > SWIM_SWIPE_THRESHOLD_PX

        // Check there's a valid stroke in the requested direction (no
        // wrap at the ends). Without this guard the swipe would commit
        // and the state-flip would be a no-op, leaving the pill
        // off-screen until next pan.
        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < SWIM_STROKE_ORDER.length

        if (!past || !validDirection) {
          // Bounce back to center; chevrons re-appear.
          swimPillTranslateX.value = withTiming(0, { duration: 200 })
          swimChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }

        // Slide off, flip stroke, teleport, slide back in.
        const slideOff = direction === 1 ? -SWIM_SLIDE_OFFSCREEN_PX : SWIM_SLIDE_OFFSCREEN_PX
        swimPillTranslateX.value = withTiming(slideOff, { duration: SWIM_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateStroke)(direction)
          swimPillTranslateX.value = -slideOff
          swimPillTranslateX.value = withTiming(0, { duration: SWIM_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) {
              swimChevronOpacityOverride.value = withTiming(1, { duration: 200 })
            }
          })
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStroke, currentIdx],
  )

  const swimPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: swimPillTranslateX.value }] }))
  const swimChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: swimChevronOpacityOverride.value }))

  const pillRow = (
    <GestureDetector gesture={swimPillSwipeGesture}>
      <View style={s.swimStrokeRow}>
        {/* Left chevron — only visible if there's a stroke to the left.
            Tappable to navigate directly without swiping. */}
        {hasPrev ? (
          <Animated.View style={[s.swimStrokeChevronSlotLeft, swimChevronAnimatedStyle]}>
            <Pressable
              onPress={() => navigateStroke(-1)}
              style={s.swimStrokeChevronPressable}
              hitSlop={8}
              accessibilityLabel={`Switch to ${SWIM_STROKE_LABELS[SWIM_STROKE_ORDER[currentIdx - 1]].full}`}
            >
              <AmberAnimatedChevron direction="left" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
              <View style={{ marginLeft: -6 }}>
                <AmberAnimatedChevron direction="left" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
              </View>
            </Pressable>
          </Animated.View>
        ) : (
          // Spacer of equal width so the pill stays centered in the row.
          <View style={s.swimStrokeChevronSlotLeft} />
        )}

        {/* Active stroke pill — follows finger during pan, slides off /
            back on commit. Same amber chrome as the cardio zone pill. */}
        <Animated.View
          style={[
            {
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
              borderWidth: 1, borderColor: palette.amber[500],
              backgroundColor: withAlpha(palette.amber[500], 0.15),
            },
            swimPillAnimatedStyle,
          ]}
        >
          <Text style={{
            fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
            letterSpacing: 0.5, color: palette.amber[400],
          }}>
            {SWIM_STROKE_LABELS[activeStroke].short}
          </Text>
        </Animated.View>

        {/* Right chevron — only visible if there's a stroke to the right. */}
        {hasNext ? (
          <Animated.View style={[s.swimStrokeChevronSlotRight, swimChevronAnimatedStyle]}>
            <Pressable
              onPress={() => navigateStroke(1)}
              style={s.swimStrokeChevronPressable}
              hitSlop={8}
              accessibilityLabel={`Switch to ${SWIM_STROKE_LABELS[SWIM_STROKE_ORDER[currentIdx + 1]].full}`}
            >
              <AmberAnimatedChevron direction="right" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
              <View style={{ marginLeft: -6 }}>
                <AmberAnimatedChevron direction="right" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
              </View>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={s.swimStrokeChevronSlotRight} />
        )}
      </View>
    </GestureDetector>
  )

  return (
    <SwimmingDetail
      key={activeStroke}
      activity={`${SWIMMING_BASE_NAME} [${SWIM_STROKE_LABELS[activeStroke].full}]`}
      displayName={SWIMMING_BASE_NAME}
      efforts={filteredEfforts}
      swimUnit={swimUnit}
      onDelete={onDelete}
      extraHeaderContent={pillRow}
      emptyStateLabel={`${SWIM_STROKE_LABELS[activeStroke].full.toLowerCase()}`}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SwimmingDetail — swim-native coaching surface (May 17 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
// Swimming has fundamentally different mechanics from running/cycling:
//
//   1. Workouts are INTERVAL SETS on a clock — "8 × 100m, leave every 1:50"
//      not "swim 1.5 km at 1:40/100m pace continuous".
//   2. Distances come in pool lengths (25m or 50m chunks) — so prescriptions
//      use 50/100/200m reps, never arbitrary km.
//   3. Pace is per 100m, not per km — universal swim convention.
//   4. CSS (Critical Swim Speed) anchors all zones, computed via Riegel
//      projection from the user's best effort to a 1000m-equivalent pace.
//   5. Hero card stacks THREE values (work + pace + leaving interval) not
//      two — the leaving interval is what the swimmer reads off the pool
//      clock to know when to push off for the next rep.
//
// Stroke selection IS supported in v1 via the SwimmingConsolidatedDetail
// wrapper above — 4 strokes (Freestyle, Backstroke, Breaststroke, Butterfly)
// stored as separate `Swimming [X]` movement rows in the DB. The wrapper
// filters efforts by stroke; SwimmingDetail itself is stroke-agnostic
// and operates on whatever filtered list it receives.
//
// See CLAUDE.md "Swimming detail card — locked design spec" for the full
// design rationale, science sources (Maglischo, Counsilman, Costill), and
// the locked decision history.

function SwimmingDetail({
  activity, efforts, swimUnit, onDelete,
  displayName,
  extraHeaderContent,
  emptyStateLabel,
}: {
  activity: string
  efforts:  Effort[]
  swimUnit: 'm' | 'yd'
  onDelete: (id: string) => void
  /** Override for the header h1 — used by the consolidated wrapper to
   *  show "Swimming" instead of "Swimming [Backstroke]". */
  displayName?:        string
  /** Optional content rendered directly under the subtitle. Used by the
   *  consolidated wrapper to inject the FREE / BACK / BREAST / FLY stroke
   *  pill row with its swipe gesture. Same pattern as Sled Drag's
   *  CarryDetail wrapper injecting the PUSH / PULL toggle. */
  extraHeaderContent?: React.ReactNode
  /** Override for the empty-state cue ("Log your first ___ effort and
   *  your personalized plan will appear here"). Used by the wrapper to
   *  say "backstroke effort" / "butterfly effort" rather than the
   *  generic activity name. */
  emptyStateLabel?:    string
}) {
  // CSS proxy via Riegel projection — the lowest projected per-100m pace
  // across all efforts. Improves automatically as the user logs faster
  // swims; never regresses on off-days. See riegelProjectCSS docstring.
  const cssSecsPer100m = useMemo(() => riegelProjectCSS(efforts), [efforts])
  const hasCSS         = cssSecsPer100m !== null && cssSecsPer100m > 0

  // Per-100m chart series. Pace is stored in seconds-per-km (legacy unit
  // for cardio); divide by 10 to convert to seconds-per-100m for display.
  const chartData = useMemo(() => efforts
    .map(e => {
      const paceSecsPerKm = parsePaceToSecs(e.value)
      if (paceSecsPerKm === null) return { ts: e.created_at, y: -1 }
      return { ts: e.created_at, y: paceSecsPerKm / 10 }
    })
    .filter(d => d.y >= 0)
  , [efforts])

  // Plan queue — same polarized rules as running's, but pulls from
  // SWIM_ZONE_SESSIONS and operates in per-100m pace space.
  const planQueue: SwimPlanStep[] = useMemo(
    () => hasCSS ? generateSwimPlanQueue(efforts, cssSecsPer100m!, swimUnit, 8) : [],
    [hasCSS, cssSecsPer100m, efforts, swimUnit],
  )

  // UI state — tile selection drives hero card; mirrors PaceDetail's pattern.
  const [zoneInfoOpen,    setZoneInfoOpen]    = useState(false)
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)
  useEffect(() => {
    setZoneInfoOpen(false)
    setSelectedStepIdx(0)
  }, [planQueue.length, planQueue[0]?.zone])

  const selectedStep = planQueue[selectedStepIdx] ?? planQueue[0]
  const paceUnitLabel = swimPaceUnitLabel(swimUnit)
  const bestSubtitle = hasCSS
    ? `${fmtPaceSecsPer100m(cssSecsPer100m!)}${paceUnitLabel}`
    : '—'

  return (
    <View style={s.page}>

      {/* Header — subtitle reads "Best — 1:38/100m" (per-100m, swim
          convention) rather than the per-km used for running/cycling.
          When `displayName` is provided by the consolidated wrapper, the
          h1 reads the base name ("Swimming") rather than the underlying
          bracketed movement name ("Swimming [Backstroke]"). The pill row
          (or any other content the wrapper wants under the subtitle)
          renders via `extraHeaderContent`. */}
      <View>
        <BackButton />
        <Text style={s.h1}>{displayName ?? activity}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Best — </Text>
          <TickerNumber
            value={bestSubtitle}
            fontSize={14}
            color={palette.amber[400]}
            fontWeight="600"
          />
        </View>
        {extraHeaderContent}
      </View>

      {/* Progression plan card */}
      {hasCSS && selectedStep && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Your progression plan</Text>
          <Text style={s.helpTextSm}>
            This is your personalized adaptation plan — follow it to see your results improve.
          </Text>

          {/* Tile row — 8 upcoming swim sessions. Each tile shows the zone
              label, the work shape (reps × distance), and the target pace.
              The leaving interval is on the hero card (too noisy for tiles). */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 }}
            style={{ marginHorizontal: -2 }}
          >
            {planQueue.map((step, idx) => {
              const isSelected = selectedStepIdx === idx
              const isLast     = idx === planQueue.length - 1
              return (
                <Fragment key={idx}>
                  <Pressable
                    onPress={() => setSelectedStepIdx(idx)}
                    style={[s.queueTile, isSelected && s.queueTileSelected]}
                  >
                    <Text style={[s.queueTileZone, isSelected && s.queueTileZoneSelected]}>
                      {CARDIO_ZONE_CONFIG[step.zone].shortLabel}
                    </Text>
                    <Text style={[s.queueTileWork, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {step.shortWork}
                    </Text>
                    <Text style={[s.queueTileTime, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {step.shortPace}
                    </Text>
                  </Pressable>
                  {!isLast && (
                    <View style={s.queueChevron}>
                      <ChevronRight
                        size={22}
                        color={withAlpha(palette.amber[400], 0.7)}
                        strokeWidth={2.5}
                        style={{ transform: [{ scaleY: 1.3 }] }}
                      />
                    </View>
                  )}
                </Fragment>
              )
            })}
          </ScrollView>

          {/* Hero card — three stacked TickerNumber rows. Row 1 = work
              (reps × distance), Row 2 = target pace per 100m, Row 3 =
              leaving interval on the pool clock. Same amber chrome as
              running's hero. */}
          <View style={s.hero}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => setZoneInfoOpen(o => !o)}
                style={s.heroZonePillButton}
              >
                <Text style={s.heroZonePillText} numberOfLines={1}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].label}
                </Text>
                <Info size={11} color={palette.amber[400]} />
              </Pressable>
            </View>

            {zoneInfoOpen && (
              <Animated.View
                entering={FadeInUp.duration(200)}
                exiting={FadeOutUp.duration(180)}
                style={s.heroInfoPanel}
              >
                <Text style={s.heroInfoPanelTitle}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].label} · {CARDIO_ZONE_CONFIG[selectedStep.zone].hrPctRange}
                </Text>
                <Text style={s.heroInfoPanelBody}>
                  {CARDIO_ZONE_CONFIG[selectedStep.zone].whyText}
                </Text>
              </Animated.View>
            )}

            <Animated.View layout={LinearTransition.duration(200)} style={{ gap: 14 }}>
              {/* Row 1 — Work (reps × distance, e.g. "8 × 100m") */}
              <View style={s.heroValueRow}>
                <TickerNumber
                  value={selectedStep.shortWork}
                  fontSize={30}
                  color={palette.amber[400]}
                  fontWeight="700"
                />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>
                  the work
                </Text>
              </View>

              {/* Row 2 — Target pace per 100m */}
              <View style={s.heroValueRow}>
                <TickerNumber
                  value={selectedStep.shortPace}
                  fontSize={30}
                  color={palette.amber[400]}
                  fontWeight="700"
                />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>
                  target pace
                </Text>
              </View>

              {/* Row 3 — Leaving interval (pool-clock time per rep) */}
              <View style={s.heroValueRow}>
                <TickerNumber
                  value={selectedStep.shortLeaving}
                  fontSize={30}
                  color={palette.amber[400]}
                  fontWeight="700"
                />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>
                  leave every
                </Text>
              </View>
            </Animated.View>

            {/* Full coaching cue */}
            <Animated.View
              layout={LinearTransition.duration(200)}
              style={s.heroSep}
            >
              <Text style={s.heroCue}>{selectedStep.cue}</Text>
            </Animated.View>
          </View>

          {/* Science attribution — Maglischo + Counsilman + Costill are the
              foundational swimming-science names. Riegel handles the CSS
              projection math. */}
          <Text style={s.tinyText}>Riegel · Maglischo · Counsilman · Costill — CSS-anchored zones</Text>
        </AnimateRise>
      )}

      {/* Empty-state hint when no efforts logged yet. `emptyStateLabel`
          lets the consolidated wrapper say "backstroke effort" rather
          than the generic "Swimming [Backstroke] effort". */}
      {!hasCSS && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Progression plan</Text>
          <Text style={s.helpTextSm}>
            Log your first {emptyStateLabel ?? activity} effort and your personalized plan will appear here.
            Every step adapts to your latest pace.
          </Text>
        </AnimateRise>
      )}

      {/* Per-100m pace chart. Y-axis reversed (lower pace = faster swim =
          line trends DOWN as the user improves). */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Pace per 100{swimUnit === 'yd' ? 'yd' : 'm'} over time</Text>
          <LineChart
            data={chartData}
            referenceY={cssSecsPer100m}
            reversed
            yWidth={52}
            yTickFormatter={(v) => fmtPaceSecsPer100m(v)}
            tooltipValueFormatter={(v) => `${fmtPaceSecsPer100m(v)}${paceUnitLabel}`}
            tooltipLabel="Pace"
            lineColor={palette.amber[400]}
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.95)),
              max: (mx) => Math.round(mx * 1.05),
            }}
            caption={<Text style={s.tinyText}>Dashed = personal best</Text>}
          />
        </AnimateRise>
      )}

      {/* History — each row shows per-100m pace on the right (swim
          convention, not per-km). */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => {
            const paceSecsPerKm = parsePaceToSecs(e.value)
            const rightVal = paceSecsPerKm !== null
              ? `${fmtPaceSecsPer100m(paceSecsPerKm / 10)}${paceUnitLabel}`
              : '—'
            return (
              <DeleteAction
                key={e.id}
                onDelete={() => onDelete(e.id)}
                style={i < arr.length - 1 ? s.listRowDivider : undefined}
                bg={colors.card}
              >
                <View style={s.listRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={s.listRowName}>
                      {e.label.split(' · ').slice(1).join(' · ')}
                    </Text>
                    <Text style={s.listRowDate}>
                      {new Date(e.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={s.valAmber}>{rightVal}</Text>
                </View>
              </DeleteAction>
            )
          })}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DurationDetail
// ─────────────────────────────────────────────────────────────────────────────

function DurationDetail({
  activity, efforts, onDelete,
}: { activity: string; efforts: Effort[]; onDelete: (id: string) => void }) {
  // Duration mode (Group C — StairMill, the only remaining machine without
  // a distance display) is a simple tracking page in v1. No zones, no
  // progression queue — those are Endurance-Athlete concepts that don't map
  // cleanly to step-based conditioning work. We'll design a separate
  // progression model for this group later. May 2026 cleanup removed Battle
  // Ropes / Shadow Boxing / Speed Bag / VersaClimber / Jacob's Ladder
  // entirely (not measurable in a useful way / too niche); May 17 2026
  // cleanup removed Arc Trainer for the same niche-equipment reason. See
  // CLAUDE.md.

  let bestSecs = 0
  efforts.forEach(e => {
    const secs = parseTimeStr(e.value)
    if (secs && secs > bestSecs) bestSecs = secs
  })

  const chartData = efforts
    .map(e => ({ ts: e.created_at, y: parseTimeStr(e.value) ?? 0 }))
    .filter(d => d.y > 0)

  return (
    <View style={s.page}>

      {/* Header */}
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Best session — </Text>
          <TickerNumber value={fmtSecs(bestSecs)} fontSize={14} color={palette.amber[400]} fontWeight="600" />
        </View>
      </View>

      {/* Session time chart — renders even with a single data point. */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Session time over time</Text>
          <LineChart
            data={chartData}
            referenceY={bestSecs > 0 ? bestSecs : null}
            yWidth={52}
            yTickFormatter={(v) => fmtSecs(Math.round(v))}
            tooltipValueFormatter={(v) => fmtSecs(Math.round(v))}
            tooltipLabel="Duration"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.85)),
              max: (mx) => Math.round(mx * 1.15),
            }}
            caption={
              <Text style={s.tinyText}>Dashed = personal best</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History (unchanged) */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => (
            <DeleteAction
              key={e.id}
              onDelete={() => onDelete(e.id)}
              style={i < arr.length - 1 ? s.listRowDivider : undefined}
              bg={colors.card}
            >
              <View style={s.listRow}>
                <Text style={s.listRowDate}>
                  {new Date(e.created_at).toLocaleDateString()}
                </Text>
                <Text style={s.valAmber}>{fmtSecs(parseTimeStr(e.value))}</Text>
              </View>
            </DeleteAction>
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { gap: 24 },

  // Back button
  // Native-style chevron-only back affordance. Negative marginLeft visually
  // aligns the chevron's stroke with the H1 below (chevrons have built-in
  // optical padding). marginBottom keeps spacing parity with the old
  // text-label version.
  backBtn:  { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 8, padding: 4 },

  // Swim stroke pill carousel (SwimmingConsolidatedDetail) — single pill
  // centered between two pulsing chevrons. Mirrors the sledVariantRow
  // pattern from strength's Sled Drag wrapper but uses amber chrome to
  // match the cardio theme.
  swimStrokeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 6,
    alignSelf: 'stretch',
  },
  swimStrokeChevronSlotLeft: {
    width: 56,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  swimStrokeChevronSlotRight: {
    width: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  swimStrokeChevronPressable: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Headings
  h1:      { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  h2:      { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  subRow:  { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 },
  subText: { color: colors.mutedForeground, fontSize: 14 },
  amberFg: { color: palette.amber[400] },
  boldFg:  { color: colors.foreground, fontWeight: '700' },
  monoNum: { fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },

  helpText:    { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  helpTextSm:  { color: colors.mutedForeground, fontSize: 12, marginTop: -8 },
  tinyText:    { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },

  card: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 20, gap: 16,
  },
  cardNoPad: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, overflow: 'hidden',
  },

  // History list
  listHeader: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  listHeaderText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },

  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.card,
  },
  listRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  listRowName:    { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  listRowDate:    { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  valAmber: {
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    fontSize: 14, color: palette.amber[400],
  },

  // ── Progression plan section heading (smaller than h2) ─────────────────
  h3: {
    color: colors.foreground, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 4,
  },

  // ── Coming-up queue tile (smaller than the strength rep-max tile, more
  // content). Tappable to preview. Selected state highlights amber. ───────
  queueTile: {
    minWidth: 110, paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 9, borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.4),
    gap: 4,
  },
  queueTileSelected: {
    borderColor: palette.amber[500],
    backgroundColor: withAlpha(palette.amber[500], 0.12),
  },
  queueTileZone: {
    fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  queueTileZoneSelected: {
    color: palette.amber[400],
  },
  queueTileWork: {
    fontSize: 14, fontWeight: '700',
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
    color: colors.foreground,
  },
  queueTileTime: {
    fontSize: 12, fontWeight: '500',
    fontFamily: fonts.mono[500], fontVariant: ['tabular-nums'],
    color: colors.mutedForeground,
  },
  queueTileRest: {
    fontSize: 10, fontWeight: '500',
    color: alpha(colors.mutedForeground, 0.7),
  },
  queueTileTextSelected: {
    color: colors.foreground,
  },

  // ── Small caps label above each big value in the hero card.
  // Mirrors strength's "per side" / "each hand" descriptor pattern —
  // tells the user what each number IS without cluttering the value itself.
  // Each big value row in the hero card — value on the left, small
  // descriptor on the right (the "info cue"). The right-side descriptor
  // tells the user what the value represents ("conversation pace", "per
  // rep", "per km") in context.
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroValueDescriptor: {
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: 'right',
    flexShrink: 1,
    maxWidth: '50%',
    paddingBottom: 4,
  },

  // Chevron between tiles in the progression-plan tile row. Indicates
  // forward direction of the plan (left → right flow).
  queueChevron: {
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hero card — AMBER end-to-end (cardio's locked theme color). Strength
  // keeps its blue, cardio keeps amber. The two domains are distinguished at
  // a glance by their accent color. ────────────────────────────────────────
  hero: {
    borderRadius: 9, paddingHorizontal: 16, paddingVertical: 16,
    backgroundColor: withAlpha(palette.amber[500], 0.08),
    borderColor:     withAlpha(palette.amber[500], 0.30),
    borderWidth: 1, gap: 8,
    minHeight: 220,
  },
  heroTitle: {
    color: palette.amber[400],
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },
  heroZonePillButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1,
    borderColor:     withAlpha(palette.amber[500], 0.4),
    backgroundColor: withAlpha(palette.amber[500], 0.10),
  },
  heroZonePillText: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    color: palette.amber[400],
  },
  heroInfoPanel: {
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.15),
    backgroundColor: alpha(colors.card, 0.6),
    borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    marginTop: 4,
  },
  heroInfoPanelTitle: {
    color: colors.foreground,
    fontSize: 12, fontWeight: '700',
    marginBottom: 4,
  },
  heroInfoPanelBody: {
    color: colors.mutedForeground,
    fontSize: 11, lineHeight: 16,
  },
  // ── Hero body values — clean single-column layout, one value per line.
  // PaceDetail uses two of these stacked (WORK + TIME); DurationDetail uses
  // just one. No right-side delta text, no descriptor text — the clutter
  // those caused was the original UX complaint. ───────────────────────────
  heroBigValue: {
    color: palette.amber[400],
    fontSize: 30,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
    lineHeight: 34,
    textAlign: 'left',
  },
  heroSep: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: withAlpha(palette.amber[500], 0.15),
    gap: 6,
  },
  heroCue: {
    color: colors.foreground, fontSize: 13, lineHeight: 18,
  },
  // Rest line sits below the cue on its own row. Amber-toned so it reads
  // as "do this between sessions" rather than blending into the cue body.
  heroRestLine: {
    color: palette.amber[400], fontSize: 12, lineHeight: 17, fontWeight: '600',
  },
})
