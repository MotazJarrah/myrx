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
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated'

// Pattern 5 — Inline expansion panel constants (LOCKED May 31 2026).
// Every info-pill expansion in this file uses DIRECT HEIGHT ANIMATION:
//   1. Hidden measurer renders the panel content off-screen and reports
//      natural layout height via onLayout.
//   2. SharedValue `animatedHeight` drives the visible panel's actual
//      `height` style — when the flag flips, withTiming animates from
//      0 → contentHeight (or reverse) over 240ms / 200ms close.
//   3. Sibling views below the panel reflow naturally via React Native's
//      normal layout pass — no LayoutAnimation, no LinearTransition,
//      no cross-system fighting. Frame-perfect cascade for free.
//   4. Opacity animates in parallel so the panel doesn't pop visually.
const PANEL_OPEN_DURATION  = 240
const PANEL_CLOSE_DURATION = 200
const PANEL_EASING         = Easing.bezier(0.16, 1, 0.3, 1)  // out-quint, same curve as AnimateRise
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler'
import { useLocalSearchParams, router } from 'expo-router'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react-native'
import Skeleton from '../../../../src/components/Skeleton'
import DeleteAction from '../../../../src/components/DeleteAction'
import TickerNumber from '../../../../src/components/TickerNumber'
import AnimateRise from '../../../../src/components/AnimateRise'
import LineChart from '../../../../src/components/LineChart'
import { useAuth } from '../../../../src/contexts/AuthContext'
import { supabase } from '../../../../src/lib/supabase'
import { scrollShellToTop } from '../../../../src/lib/shellScroll'
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
  // Air Bike calorie-mode helpers — air bike is programmed in calories
  // (not pace/distance) so it routes to AirBikeDetail with its own
  // cal/min anchoring and AEROBIC/THRESHOLD/SPRINT zone targets.
  AIR_BIKE_ACTIVITY,
  isAirBikeActivity,
  parseAirBikeLabel,
  calsPerMinFromEffort,
  calsPerMinToWatts,
  genderBaselineCalsPerMin,
  // Row Erg display helpers — distances render in meters, pace as
  // per-500m split (Concept2 convention). Detail page stays on
  // PaceDetail with conditional branching for rowing.
  isRowErgActivity,
  isConcept2ErgActivity,
  pacePer500mFromSecsPerKm,
  pacePer500mToWatts,
  // Rucking — cardio-tab activity with carry-style coaching surface.
  // Mirrors Atlas Stone Bear Hug Carry's design (abs-mode tier ladder +
  // load × distance hero) because rucking progresses on load + miles,
  // not pace. Distance locked to mi via unit_lock; pack weight locked
  // to lb in the detail/log code (the unit_lock column only holds one
  // unit). See "Rucking detail card — locked design spec" in CLAUDE.md.
  RUCKING_ACTIVITY,
  isRuckingActivity,
  // Cardio category pill label — every cardio detail page renders this
  // as a static badge below the "Best —" subtitle row. Mirrors strength's
  // equipmentPillLabel('carry') / equipmentPillLabel('barbell') tag pattern.
  cardioCategoryPillLabel,
  // StairMill — coaching surface anchored on floors per minute (FPM).
  // Mirrors Air Bike's rate-anchored architecture but uses floors as the
  // rate metric (every Step Mill console displays FLOORS as the most
  // prominent number). See "StairMill detail card — locked design spec"
  // in CLAUDE.md.
  STAIRMILL_ACTIVITY,
  isStairMillActivity,
  parseStairMillLabel,
  floorsPerMinFromEffort,
  genderBaselineFloorsPerMin,
  // Rucking ladder (single source of truth — used by both the log
  // form wheel and the detail page's zone math).
  RUCK_WEIGHT_LADDER_LB,
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

// Activity-aware distance formatter — used by buildPlanStep + PaceDetail
// so per-activity conventions override the default fmtDist behaviour:
//   • Concept2 ergs (Row Erg / Bike Erg / Ski Erg) — always metric,
//     regardless of the user's mi/km profile preference. The PM5
//     console displays everything in meters / km universally; rowers
//     and erg users worldwide think in metric regardless of locale.
//     Sub-1km in integer meters ("500 m"), ≥1km in km ("5 km",
//     "2.5 km"). Locked May 19 2026.
//   • Everything else → fmtDist (sub-1km/mi in meters, larger in km/mi).
function fmtDistForActivity(activity: string, distKm: number, distUnit: 'km' | 'mi'): string {
  if (isConcept2ErgActivity(activity)) {
    if (distKm < 1) return `${Math.round(distKm * 1000)} m`
    // ≥ 1 km: trim trailing zeros, max 2 decimals under 5 km, max 1 over.
    const decimals = distKm < 5 ? 2 : 1
    return `${distKm.toFixed(decimals).replace(/\.?0+$/, '')} km`
  }
  return fmtDist(distKm, distUnit)
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
  // "Ski Erg" must match BEFORE the bare-word "ski" check — the
  // outdoor cross-country `Skiing` movement was removed May 19 2026
  // (terrain + technique + snow conditions confound pace; can't coach
  // honestly without HR, niche audience).
  if (/ski erg/.test(lower))                                    return 'ski_erg'
  if (/row erg/.test(lower))                                    return 'rowing'
  if (/air bike|assault bike|airdyne/.test(lower))              return 'air_bike'
  if (/spin|stationary|recumbent|bike erg/.test(lower))         return 'stationary_bike'
  if (/ellipt/.test(lower))                                     return 'elliptical'
  // Mountain-bike outdoor was removed May 19 2026 — terrain confounds
  // pace zones. Only flat outdoor + stationary cycling remain.
  if (/cycl|bike/.test(lower))                                  return 'cycling'
  if (/ruck/.test(lower))                                       return 'rucking'

  // Duration-mode categories (StairMill only — Stair Climb outdoor was
  // removed in the May 2026 lifestyle-activity cleanup; Arc Trainer
  // was removed May 17 2026 as a niche gym machine).
  if (/stair/.test(lower))                                      return 'stair_climber'

  // Default for run / treadmill / anything unmatched. Hill Running and
  // Trail Running were removed May 19 2026 — terrain confounds pace
  // zones, recreational use for most users.
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
  'running', 'air_bike',
  'rowing', 'ski_erg', 'swimming',
]

function isEnduranceAthleteActivity(activityName: string): boolean {
  return ENDURANCE_ATHLETE_CATEGORIES.includes(categorizeActivity(activityName))
}

// Activities that route to the "Beat Your Best" simple-progression surface
// (L9 from docs/Layout Design.xlsx — locked May 19 2026). These are
// activities where we can't anchor on scientifically-honest zone coaching:
//
//   • cycling outdoor       — pace confounded by wind/gradient/drafting;
//                             cycling community programs by power (FTP),
//                             but we have no power telemetry.
//   • stationary_bike       — "distance" is FAKE (cadence × assumed
//                             resistance — varies by machine model);
//                             power meters not universal.
//   • elliptical            — fake distance, no canonical training
//                             methodology (elites don't train on it).
//
// For these, the right model is "beat your best time at this distance" —
// honest about what manual-logging data can support, sidesteps the false
// precision of zone prescriptions we can't validate. See L9 spec.
const BEAT_YOUR_BEST_CATEGORIES: ActivityCategory[] = [
  'cycling', 'stationary_bike', 'elliptical',
]

function isBeatYourBestActivity(activityName: string): boolean {
  return BEAT_YOUR_BEST_CATEGORIES.includes(categorizeActivity(activityName))
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
  // Rowing — Row Erg specifically uses Concept2-canonical distances and
  // intervals. The 2K test, 5K piece, and 10K piece are the textbook
  // endurance distances; 4×500m / 5×1000m are the classic threshold
  // sets; 8×500m / 6×500m are the standard vo2 sprint sets. Distance
  // display is in meters on RowErg pages (5K shows as "5000 m" in the
  // tile), and pace is presented as per-500m split (Concept2 convention).
  rowing: {
    endurance: [{ distanceKm: 2 }, { distanceKm: 5 }, { distanceKm: 10 }],
    threshold: [{ distanceKm: 2, intervalReps: 4 }, { distanceKm: 5, intervalReps: 5 }],
    vo2:       [{ distanceKm: 3, intervalReps: 6 }, { distanceKm: 4, intervalReps: 8 }],
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
  const cue = `Swim ${shortWork} at ${shortPace} pace (${feelByZone[zone]}). Leave every ${shortLeaving} — about ${Math.round(restPerRep)}s rest between intervals.`

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
  /** Concept2 ergs ONLY (Row / Bike / Ski). When set, the hero card adds
   *  a 4th row showing the watts target derived from the zone pace via
   *  Concept2's official watts↔pace formula. Null for everyone else —
   *  the 4th row is hidden. Locked May 19 2026. */
  ergWattsTarget:   number | null
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

  // Row Erg uses split-time language ("split" instead of "pace") and
  // distances always display in meters. Helpers pull together the
  // per-500m display formatting once here so the cue construction below
  // stays readable.
  const isRowErg     = isRowErgActivity(activity)
  const splitDisplay = isRowErg ? pacePer500mFromSecsPerKm(zonePace) : null

  // Concept2 ergs (Row / Bike / Ski) — all three share the PM5 console
  // and the same Concept2 watts↔pace formula. Derive a watts target from
  // the prescribed zone pace and surface it as the hero card's 4th row
  // (NOT in the cue — the cue stays focused on workout structure +
  // checkpoint pacing; watts gets its own dedicated row to keep the
  // hero readable). Locked May 19 2026.
  const isC2Erg        = isConcept2ErgActivity(activity)
  const wattsTarget    = isC2Erg ? pacePer500mToWatts(zonePace) : 0
  const ergWattsTarget = isC2Erg && wattsTarget > 0 ? wattsTarget : null

  if (!isInterval) {
    const totalDist = fmtDistForActivity(activity, rx.totalKm, distUnit)
    const totalTime = fmtSecs(rx.totalSecs)
    // Speed-machine cue reads "set speed, run distance, time falls out"
    // (matching how the user actually operates the machine).
    // Row Erg cue references the per-500m split — the canonical rowing
    // pace metric — instead of generic "conversation pace" language.
    const cue = speedMachine
      ? `${verb.imperative} ${totalDist} at ${shortSpeed} — should take ${totalTime}.`
      : isRowErg
        ? `${verb.imperative} ${totalDist} in ${totalTime} at a steady ${splitDisplay} split${pacingSentence}.`
        : `${verb.imperative} ${totalDist} in ${totalTime} at steady conversation pace${pacingSentence}.`
    return {
      zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed, ergWattsTarget,
      shortWork: totalDist,
      shortTime: totalTime,
      cue,
      restLine: '',
    }
  }

  const repDist  = fmtDistForActivity(activity, rx.repKm, distUnit)
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
  // Row Erg interval cue uses "split" language and the rowing-standard
  // rest convention ("paddle easy between" instead of "jog between").
  const rowRestNote = isRowErg
    ? (zone === 'threshold'
        ? 'Paddle easy 60 sec between cruise intervals'
        : 'Equal-time paddle recovery between intervals')
    : restNote
  const cue = speedMachine
    ? `${verb.imperative} ${rx.numReps} × ${repDist} at ${shortSpeed} — should take ${repTime} each.`
    : isRowErg
      ? `${verb.imperative} ${rx.numReps} × ${repDist} at ${splitDisplay} split (${repTime} each).`
      : `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each${pacingSentence}.`
  return {
    zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed, ergWattsTarget,
    shortWork: `${rx.numReps} × ${repDist}`,
    shortTime: repTime,
    cue,
    restLine: `${rowRestNote} · ${restTail}`,
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
  //   • Threshold (T-pace) "Cruise Intervals" → 60 sec jog recovery between intervals
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
  if (/ski erg/.test(lower))                                      return { imperative: 'Ski',   lower: 'ski'   }
  if (/cycl|bike|spin|stationary/.test(lower))                    return { imperative: 'Pedal', lower: 'pedal' }
  if (/ruck/.test(lower))                                         return { imperative: 'Ruck',  lower: 'ruck'  }
  if (/ellipt/.test(lower))                                       return { imperative: 'Glide', lower: 'glide' }
  // Default: Running + Running (Treadmill). Hill / Trail / outdoor Skiing
  // were removed May 19 2026 (terrain-confounded, recreational).
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
    // Daniels' Cruise Intervals: 60 sec jog recovery between intervals at T-pace.
    return `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each — jog 60 sec between cruise intervals. After your session, log your best ${repDist}.`
  }
  // VO2: equal-time jog recovery between intervals at I-pace.
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

// ─────────────────────────────────────────────────────────────────────────────
// renderCardioInnerDetail — single source of truth for "given an activity +
// its efforts, render the right detail component". Used by both the
// standalone route AND the family wrapper, so a family slot is just this
// helper called with the variant's name + filtered efforts + hideHeader=true.
// New cardio detail components (or new dispatch rules) only need to be
// added here once.
// ─────────────────────────────────────────────────────────────────────────────

function renderCardioInnerDetail(params: {
  activity: string
  efforts: Effort[]
  distUnit: 'km' | 'mi'
  swimUnit: 'm' | 'yd'
  mode: 'pace' | 'duration'
  onDelete: (id: string) => void
  onAddEffort: (label: string, value: string) => Promise<void>
  hideHeader?: boolean
}) {
  const { activity, efforts, distUnit, swimUnit, mode, onDelete, onAddEffort, hideHeader } = params
  if (isStairMillActivity(activity)) {
    return <StairMillDetail efforts={efforts} onDelete={onDelete} hideHeader={hideHeader} />
  }
  if (mode === 'duration') {
    return <DurationDetail activity={activity} efforts={efforts} onDelete={onDelete} hideHeader={hideHeader} />
  }
  if (isAirBikeActivity(activity)) {
    return <AirBikeDetail efforts={efforts} onDelete={onDelete} hideHeader={hideHeader} />
  }
  if (isRuckingActivity(activity)) {
    return <RuckingDetail efforts={efforts} onDelete={onDelete} hideHeader={hideHeader} />
  }
  if (isBeatYourBestActivity(activity)) {
    return <BeatYourBestDetail activity={activity} efforts={efforts} distUnit={distUnit} onDelete={onDelete} hideHeader={hideHeader} />
  }
  if (isSwimActivity(activity)) {
    return <SwimmingConsolidatedDetail efforts={efforts} swimUnit={swimUnit} onDelete={onDelete} />
  }
  return <PaceDetail activity={activity} efforts={efforts} distUnit={distUnit} onDelete={onDelete} onAddEffort={onAddEffort} hideHeader={hideHeader} />
}

// Safety buffer absorbing any clipped-last-line on width-mismatch between
// the off-screen measurer and the visible panel (the panel's card chrome
// makes the extra space look like normal bottom padding).
const PANEL_HEIGHT_BUFFER_PX = 16

// ── ZoneInfoExpansionPanel ───────────────────────────────────────────────────
// Pattern 5 (LOCKED — direct-height-animation, hidden-measurer).
//
// Hidden-measurer is necessary because Fabric/new arch skips layout passes
// for children of 0-height Animated.Views — a single-tree inner-measurer
// fails to fire onLayout and the panel can never open. We proved this on
// June 1 2026; the inner-measurer attempt broke pill expansion entirely.
// The PANEL_HEIGHT_BUFFER_PX (16 px) absorbs the small width-mismatch clip
// that can happen in deeply-nested flex layouts where the absolute
// measurer's content width slightly differs from the visible panel's.
function ZoneInfoExpansionPanel({
  open, title, body,
}: {
  open:  boolean
  title: string
  body:  string
}) {
  const [contentHeight, setContentHeight] = useState(0)
  const animatedHeight  = useSharedValue(0)
  const animatedOpacity = useSharedValue(0)

  // Drive the animation off the open flag + measured height. We only
  // animate UP to contentHeight once we've measured it; before that
  // the measurer is still computing.
  if (open && contentHeight > 0) {
    animatedHeight.value  = withTiming(contentHeight, { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
    animatedOpacity.value = withTiming(1,             { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
  } else if (!open) {
    animatedHeight.value  = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
    animatedOpacity.value = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
  }

  const panelAnimatedStyle = useAnimatedStyle(() => ({
    height:   animatedHeight.value,
    opacity:  animatedOpacity.value,
    overflow: 'hidden',
  }))

  const onMeasurerLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + PANEL_HEIGHT_BUFFER_PX
    if (h > 0 && h !== contentHeight) setContentHeight(h)
  }

  const panelContent = (
    <View style={s.heroInfoPanel}>
      <Text style={s.heroInfoPanelTitle}>{title}</Text>
      <Text style={s.heroInfoPanelBody}>{body}</Text>
    </View>
  )

  return (
    <>
      <View
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: -9999 }}
        pointerEvents="none"
        onLayout={onMeasurerLayout}
      >
        {panelContent}
      </View>
      <Animated.View style={panelAnimatedStyle}>
        {panelContent}
      </Animated.View>
    </>
  )
}

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

  // ── Family detection (admin-added cardio variant families) ────────────
  // If the URL is a parent name with admin-added variants, route to
  // CardioFamilyConsolidatedDetail (mirror of strength's wrapper). Excludes
  // hardcoded cardio families (Swimming) because they have their own
  // dedicated consolidation path. The check is on `exerciseFromUrl`-
  // equivalent (the route param), NOT the family-aware activity, so the
  // detection is stable regardless of any downstream shadowing.
  const isHardcodedCardioFamilyRoute = activity === SWIMMING_BASE_NAME || activity.startsWith('Swimming [')
  const cardioFamilyParent = isHardcodedCardioFamilyRoute
    ? null
    : (dbMovements.find(m => m.name === activity && !m.parent_movement_id) ?? null)
  const cardioFamilyVariants = useMemo(
    () => cardioFamilyParent
      ? dbMovements
          .filter(m => m.parent_movement_id === cardioFamilyParent.id)
          .slice()
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      : [],
    [cardioFamilyParent, dbMovements],
  )

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

  // FAMILY ROUTE — if the URL is a parent name and it has variants, the
  // entire page dispatches to the consolidated wrapper. Early return
  // BEFORE the standalone fetch useEffect so the parent name never tries
  // to query its own non-existent efforts (efforts live under variant
  // names). The wrapper does its own family-wide fetch.
  if (cardioFamilyParent && cardioFamilyVariants.length >= 2) {
    return <CardioFamilyConsolidatedDetail parent={cardioFamilyParent} variants={cardioFamilyVariants} />
  }

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

  // All dispatch lives in `renderCardioInnerDetail` — single source of
  // truth shared with CardioFamilyConsolidatedDetail. New cardio detail
  // components / new dispatch rules only need to be added there once.
  return renderCardioInnerDetail({
    activity,
    efforts,
    distUnit,
    swimUnit,
    mode,
    onDelete: handleDeleteEffort,
    onAddEffort: handleAddEffort,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PaceDetail
// ─────────────────────────────────────────────────────────────────────────────

function PaceDetail({
  activity, efforts, distUnit, onDelete, onAddEffort, hideHeader,
}: {
  activity:    string
  efforts:     Effort[]
  distUnit:    'km' | 'mi'
  onDelete:    (id: string) => void
  onAddEffort: (label: string, value: string) => Promise<void>
  /** Suppresses page-level header when rendered as a slot inside
   *  CardioFamilyConsolidatedDetail. Wrapper provides one header for
   *  the whole family. */
  hideHeader?: boolean
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
          for Row Erg, show "Best split — m:ss/500m" (Concept2 standard);
          for everyone else, show "Best pace — m:ss/km" as before. */}
      {!hideHeader && (
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
          ) : isConcept2ErgActivity(activity) ? (
            // Row Erg, Bike Erg, Ski Erg — all Concept2 PM5-powered ergs
            // share the same physics. Show split per 500m (canonical Concept2
            // pace metric) AND derived watts (canonical power metric — what
            // the PM5 console reads natively and what coaches program in).
            <>
              <Text style={s.subText}>Best — </Text>
              <TickerNumber
                value={
                  bestPaceSecs > 0 && bestPaceSecs !== Infinity
                    ? pacePer500mFromSecsPerKm(bestPaceSecs)
                    : '—'
                }
                fontSize={14}
                color={palette.amber[400]}
                fontWeight="600"
              />
              {bestPaceSecs > 0 && bestPaceSecs !== Infinity && (
                <>
                  <Text style={[s.subText, { color: palette.amber[400] }]}> · </Text>
                  <TickerNumber
                    value={`${pacePer500mToWatts(bestPaceSecs)} W`}
                    fontSize={14}
                    color={palette.amber[400]}
                    fontWeight="600"
                  />
                </>
              )}
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
        {/* Cardio category tag — mirrors strength's equipment pill pattern. */}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(activity)}</Text>
        </View>
      </View>
      )}

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

            <ZoneInfoExpansionPanel
              open={zoneInfoOpen}
              title={`${CARDIO_ZONE_CONFIG[selectedStep.zone].label} · ${CARDIO_ZONE_CONFIG[selectedStep.zone].hrPctRange}`}
              body={CARDIO_ZONE_CONFIG[selectedStep.zone].whyText}
            />

            {/* Three rows — value on the left (big amber), descriptor on the
                right (small muted). Mirrors strength's "value + descriptor"
                pattern (where descriptors say things like "per side" or
                "each hand"). The descriptor for the work row is the zone's
                intensity feel ("conversation pace", "comfortably hard", "max
                sustainable"); for the time and per-unit rows it identifies
                the unit context. */}
            <View style={{ gap: 14 }}>
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
              {/* Row 4: Watts target — Concept2 ergs ONLY (Row / Bike / Ski).
                  All three have a PM5 console that reads watts directly off
                  the flywheel; the prescribed zone pace maps to a watts
                  target via Concept2's pace↔watts formula. Hidden on every
                  other activity. Locked May 19 2026. */}
              {selectedStep.ergWattsTarget != null && (
                <View style={s.heroValueRow}>
                  <TickerNumber value={`${selectedStep.ergWattsTarget} W`} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    watts target
                  </Text>
                </View>
              )}
            </View>

            {/* Cue — work + pace sentence on line 1. Rest descriptor on its
                own line below (only for threshold / vo2 — endurance has no
                rest line). Splitting them makes the rest cue much more
                visible than when it was buried mid-sentence. */}
            <View style={s.heroSep}>
              <Text style={s.heroCue}>{selectedStep.cue}</Text>
              {selectedStep.restLine ? (
                <Text style={s.heroRestLine}>{selectedStep.restLine}</Text>
              ) : null}
            </View>
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
            yTickFormatter={(v) =>
              chartIsSpeed       ? v.toFixed(1)
              : isRowErgActivity(activity) ? fmtPaceTick(v / 2)  // per-500m for rowing
              : fmtPaceTick(v)
            }
            tooltipValueFormatter={(v) =>
              chartIsSpeed       ? `${v.toFixed(1)} ${distUnit === 'mi' ? 'mph' : 'km/h'}`
              : isRowErgActivity(activity) ? pacePer500mFromSecsPerKm(v)
              : fmtPaceStr(v, distUnit)
            }
            tooltipLabel={
              chartIsSpeed       ? 'Speed'
              : isRowErgActivity(activity) ? 'Split'
              : 'Pace'
            }
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
          the speed equivalent of the stored pace; for Row Erg, the
          per-500m split (Concept2 standard); for everyone else, the
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
              : isRowErgActivity(activity)
                ? (paceSecs ? pacePer500mFromSecsPerKm(paceSecs) : '—')
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
// PlanStripScroll — horizontal scroller for the upcoming-plan tile row.
// Wrapped in a GestureDetector with a Native gesture so its native scroll
// can `blocksExternalGesture` the outer stroke pager (in
// SwimmingConsolidatedDetail). Without this, the outer pagingEnabled
// stroke pager intercepts every horizontal swipe inside the plan strip
// and the user can never scroll to plan steps 4–8.
// ─────────────────────────────────────────────────────────────────────────────
function PlanStripScroll({
  outerScrollGesture,
  children,
}: {
  outerScrollGesture?: ReturnType<typeof Gesture.Native>
  children: React.ReactNode
}) {
  const innerNative = useMemo(() => {
    let g = Gesture.Native()
    if (outerScrollGesture) {
      g = g.blocksExternalGesture(outerScrollGesture)
    }
    return g
  }, [outerScrollGesture])

  return (
    <GestureDetector gesture={innerNative}>
      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 }}
        style={{ marginHorizontal: -2 }}
      >
        {children}
      </GHScrollView>
    </GestureDetector>
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
// matches the BW tier carousel and Sled Work exactly:
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
  // Pre-filter efforts per stroke once so we don't re-filter inside every
  // ScrollView slot's SwimmingDetail. Each slot just looks up its own list.
  const effortsByStroke = useMemo(() => {
    const map: Record<SwimStroke, Effort[]> = {
      freestyle: [], backstroke: [], breaststroke: [], butterfly: [],
    }
    efforts.forEach(e => {
      const stroke = parseSwimStroke(e.label)
      map[stroke].push(e)
    })
    return map
  }, [efforts])

  // Only render strokes the user has actually logged — if the user deletes
  // every Butterfly effort, the FLY pill and slot disappear, the page
  // collapses to the remaining strokes. Same behaviour as Sled Work's
  // variant filter (CLAUDE.md Pattern 4 — strokes follow hardest-first
  // ordering, filtered by logged efforts). If NO efforts exist at all,
  // we fall back to the full SWIM_STROKE_ORDER so the page still renders
  // with discoverability empty-state cards (otherwise a user with zero
  // swim efforts would see a fully blank page).
  const STROKE_ORDER = useMemo(() => {
    const filtered = SWIM_STROKE_ORDER.filter(s => effortsByStroke[s].length > 0)
    return filtered.length > 0 ? filtered : SWIM_STROKE_ORDER
  }, [effortsByStroke])

  // Default active stroke = ALWAYS slot 0 of the FILTERED list — so when
  // the user deletes their last Butterfly entry, the page snaps to slot 0
  // of what remains (Breaststroke if logged, etc.). Universal "always slot
  // 0" rule across consolidated carousels — see CLAUDE.md Pattern 4.
  const defaultStroke: SwimStroke = STROKE_ORDER[0]

  const [activeStroke, setActiveStroke] = useState<SwimStroke>(defaultStroke)

  // If the active stroke disappears (user deleted its last effort while
  // viewing it), snap to slot 0 of the filtered list AND scroll the shell
  // back to top so the user sees the new active stroke's header.
  useEffect(() => {
    if (!STROKE_ORDER.includes(activeStroke)) {
      setActiveStroke(STROKE_ORDER[0])
      scrollShellToTop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STROKE_ORDER])

  // Header subtitle — show the ACTIVE stroke's CSS. Updates on swipe (just
  // a TickerNumber re-render, not a wrapper-level animation). The wrapper
  // header otherwise stays positionally static — only the body inside the
  // paged ScrollView physically slides. Mirrors the Sled Work consolidated
  // wrapper, which also surfaces the active variant's best in its subtitle.
  const activeStrokeCSS = useMemo(
    () => riegelProjectCSS(effortsByStroke[activeStroke]),
    [effortsByStroke, activeStroke],
  )
  const hasActiveCSS = activeStrokeCSS !== null && activeStrokeCSS > 0

  // ── Paged ScrollView — the BW "whole page slides" pattern ──────────────
  // Each stroke renders in its own slot inside a horizontal pagingEnabled
  // ScrollView. The pill row controls navigation via programmatic scrollTo
  // (smooth slide), and direct body swipes scroll natively then sync state
  // via onMomentumScrollEnd. Both gestures converge through navigateStroke.
  //
  // slotWidth pre-seed: the ScrollView wrapper below uses
  // `marginHorizontal: -PAGE_PADDING_HORIZONTAL` to bleed the slots edge-
  // to-edge, so its measured width is `windowWidth` (the full screen),
  // NOT `windowWidth − page padding`. Pre-seeding with the wrong value
  // (winWidth − 32) caused a ~32 px misalignment on first paint: the
  // slots rendered too narrow, scrollTo landed on a fractional position,
  // and the user saw a sliver of the previous slot on the left edge.
  // Pre-seeding with the FULL window width matches what onLayout will
  // eventually measure, so the initial scrollTo lands exactly on the
  // active slot's boundary.
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  const [slotWidth, setSlotWidth] = useState(winWidth)

  const scrollRef = useRef<ScrollView>(null)

  // Expose the outer pager's native scroll as a Gesture.Native() so the
  // inner SwimmingDetail's horizontal plan-tile ScrollView can claim its
  // own swipes via `simultaneousWithExternalGesture`. Without this, the
  // outer pagingEnabled pager grabs every horizontal swipe and the inner
  // plan strip can never scroll. Same pattern as Sled Work's pill swipe
  // fix in strength/[exercise].tsx.
  const outerScrollGesture = useMemo(() => Gesture.Native(), [])

  // On initial mount, scroll to the active stroke's slot (so the page
  // doesn't land on slot 0 if the user's most-recent stroke is e.g.
  // butterfly). animated:false because this is the initial landing.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!scrollRef.current) return
    const idx = STROKE_ORDER.indexOf(activeStroke)
    if (idx < 0) return
    scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    initialScrollDoneRef.current = true
  }, [slotWidth, activeStroke])

  // Navigate to a specific stroke index. Used by both the chevron Pressable
  // taps and the pill Pan gesture (via runOnJS). Updates state AND
  // programmatically scrolls the body, so the two animations are
  // synchronized (pill flies off → body slides → pill comes back in
  // from opposite side). Uses the FILTERED STROKE_ORDER so chevron taps
  // skip strokes the user hasn't logged.
  const navigateStroke = (direction: -1 | 1) => {
    const currentIdx = STROKE_ORDER.indexOf(activeStroke)
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= STROKE_ORDER.length) return
    setActiveStroke(STROKE_ORDER[newIdx])
    if (slotWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })
    }
  }

  const currentIdx = STROKE_ORDER.indexOf(activeStroke)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx < STROKE_ORDER.length - 1

  // ── Pill swipe gesture (BW-style choreography) ──────────────────────────
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
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > SWIM_SWIPE_THRESHOLD_PX

        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < STROKE_ORDER.length

        if (!past || !validDirection) {
          // Bounce back to center; chevrons re-appear.
          swimPillTranslateX.value = withTiming(0, { duration: 200 })
          swimChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }

        // Slide off, flip stroke (which also programmatically scrolls the
        // paged ScrollView via navigateStroke), teleport, slide back in.
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
    [activeStroke, currentIdx, slotWidth],
  )

  const swimPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: swimPillTranslateX.value }] }))
  const swimChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: swimChevronOpacityOverride.value }))

  return (
    <View style={s.page}>

      {/* Page-level header — stays positionally STATIC during stroke
          swipes. The subtitle's TickerNumber updates on stroke change
          (just digit roll, not a layout animation). The visible body
          below physically slides between strokes via the paged
          ScrollView. */}
      <View>
        <BackButton />
        <Text style={s.h1}>{SWIMMING_BASE_NAME}</Text>
        {hasActiveCSS ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best — </Text>
            <TickerNumber
              value={`${fmtPaceSecsPer100m(activeStrokeCSS!)}${swimPaceUnitLabel(swimUnit)}`}
              fontSize={14}
              color={palette.amber[400]}
              fontWeight="600"
            />
          </View>
        ) : (
          <Text style={s.subText}>No {SWIM_STROKE_LABELS[activeStroke].full.toLowerCase()} efforts logged yet</Text>
        )}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(SWIMMING_BASE_NAME)}</Text>
        </View>

        {/* Pill row — also static, sits between header and the paged
            body. The pill animates in-place during swipes (slide off /
            teleport / slide back); the paged ScrollView below is what
            carries the actual content slide. */}
        <GestureDetector gesture={swimPillSwipeGesture}>
          <View style={s.swimStrokeRow}>
            {hasPrev ? (
              <Animated.View style={[s.swimStrokeChevronSlotLeft, swimChevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateStroke(-1)}
                  style={s.swimStrokeChevronPressable}
                  hitSlop={8}
                  accessibilityLabel={`Switch to ${SWIM_STROKE_LABELS[STROKE_ORDER[currentIdx - 1]].full}`}
                >
                  <AmberAnimatedChevron direction="left" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <AmberAnimatedChevron direction="left" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.swimStrokeChevronSlotLeft} />
            )}

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
                {SWIM_STROKE_LABELS[activeStroke].full}
              </Text>
            </Animated.View>

            {hasNext ? (
              <Animated.View style={[s.swimStrokeChevronSlotRight, swimChevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateStroke(1)}
                  style={s.swimStrokeChevronPressable}
                  hitSlop={8}
                  accessibilityLabel={`Switch to ${SWIM_STROKE_LABELS[STROKE_ORDER[currentIdx + 1]].full}`}
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
      </View>

      {/* Paged ScrollView — the actual "whole page slides" mechanism.
          One slot per stroke; each slot is a full SwimmingDetail body
          (progression plan + chart + log list) with hideHeader=true.
          The 4 slots all render at mount; React Native ScrollView doesn't
          virtualize but the slot content is cheap (memoized CSS + plan
          computations per stroke). */}
      <View
        onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
        style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}
      >
        {/* GHScrollView (gesture-handler's drop-in replacement) participates
            in v2 gesture composition cleanly — combined with the Native
            gesture wrap below, the inner SwimmingDetail's plan-tile
            ScrollView can claim horizontal scrolls inside its own bounds
            without the outer stroke pager intercepting them. */}
        <GestureDetector gesture={outerScrollGesture}>
          <GHScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={e => {
              if (slotWidth === 0) return
              const x = e.nativeEvent.contentOffset.x
              const idx = Math.round(x / slotWidth)
              const targetStroke = STROKE_ORDER[idx]
              if (targetStroke && targetStroke !== activeStroke) {
                setActiveStroke(targetStroke)
              }
            }}
          >
            {STROKE_ORDER.map(stroke => (
              <View
                key={stroke}
                style={{
                  width: slotWidth,
                  paddingHorizontal: PAGE_PADDING_HORIZONTAL,
                }}
              >
                <SwimmingDetail
                  activity={`${SWIMMING_BASE_NAME} [${SWIM_STROKE_LABELS[stroke].full}]`}
                  displayName={SWIMMING_BASE_NAME}
                  efforts={effortsByStroke[stroke]}
                  swimUnit={swimUnit}
                  onDelete={onDelete}
                  emptyStateLabel={SWIM_STROKE_LABELS[stroke].full.toLowerCase()}
                  hideHeader
                  outerScrollGesture={outerScrollGesture}
                />
              </View>
            ))}
          </GHScrollView>
        </GestureDetector>
      </View>
    </View>
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
  hideHeader,
  outerScrollGesture,
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
   *  pill row with its swipe gesture. Same pattern as Sled Work's
   *  CarryDetail wrapper injecting the PUSH / PULL toggle. */
  extraHeaderContent?: React.ReactNode
  /** Override for the empty-state cue ("Log your first ___ effort and
   *  your personalized plan will appear here"). Used by the wrapper to
   *  say "backstroke effort" / "butterfly effort" rather than the
   *  generic activity name. */
  emptyStateLabel?:    string
  /** When true, skip rendering the page-level header (h1 + best subtitle).
   *  The consolidated wrapper renders that header itself OUTSIDE the
   *  paged ScrollView so it stays static while the body slides between
   *  strokes — matches BW's "whole page slides" pattern. */
  hideHeader?:         boolean
  /** When this SwimmingDetail is a slot inside the consolidated stroke
   *  pager (SwimmingConsolidatedDetail), the outer pager's native scroll
   *  is exposed as a Gesture.Native(). The inner plan-tile horizontal
   *  ScrollView wraps itself in a GestureDetector that
   *  `simultaneousWithExternalGesture`s on this so horizontal swipes
   *  inside the plan strip stay with the inner scroll (instead of the
   *  outer stroke pager intercepting them). No-op when SwimmingDetail
   *  is rendered standalone (currently unused but kept for symmetry). */
  outerScrollGesture?: ReturnType<typeof Gesture.Native>
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
          renders via `extraHeaderContent`. The whole header is omitted
          when `hideHeader` is true (consolidated wrapper renders its
          own header outside the paged ScrollView so it stays static
          during stroke transitions). */}
      {!hideHeader && (
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
      )}

      {/* Progression plan card */}
      {hasCSS && selectedStep && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Your progression plan</Text>
          <Text style={s.helpTextSm}>
            This is your personalized adaptation plan — follow it to see your results improve.
          </Text>

          {/* Tile row — 8 upcoming swim sessions. Each tile shows the zone
              label, the work shape (reps × distance), and the target pace.
              The leaving interval is on the hero card (too noisy for tiles).
              The inner ScrollView wraps itself in a Gesture.Native() that
              `blocksExternalGesture(outerScrollGesture)` — so when the user
              swipes horizontally on the plan tiles, this scroll wins over
              the outer stroke pager. Without this, the outer pagingEnabled
              pager grabs every horizontal swipe and the plan strip can never
              be scrolled to see steps 4-8. */}
          <PlanStripScroll outerScrollGesture={outerScrollGesture}>
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
          </PlanStripScroll>

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

            <ZoneInfoExpansionPanel
              open={zoneInfoOpen}
              title={`${CARDIO_ZONE_CONFIG[selectedStep.zone].label} · ${CARDIO_ZONE_CONFIG[selectedStep.zone].hrPctRange}`}
              body={CARDIO_ZONE_CONFIG[selectedStep.zone].whyText}
            />

            <View style={{ gap: 14 }}>
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
            </View>

            {/* Full coaching cue */}
            <View style={s.heroSep}>
              <Text style={s.heroCue}>{selectedStep.cue}</Text>
            </View>
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
// BeatYourBestDetail — L9 simple-progression surface (May 19 2026 lock).
// ─────────────────────────────────────────────────────────────────────────────
//
// For activities where we can't honestly coach with zones (no HR, no power,
// no canonical methodology): Cycling outdoor, Stationary Bike, Elliptical.
// Earlier May 19 we shipped a 3-zone L4 structural-prescription surface
// here, but the prescriptions ("4 × 5 min hard") were aspirational without
// effort validation — too much UI for what amounts to "do intervals if you
// feel like it." Replaced with a leaner model: just show the user their
// PR and a small push target.
//
// Hero card (no pill, no zones):
//   • Row 1 — Best: fastest time logged at the user's most-recent distance,
//     bucketed to the nearest km/mi for grouping (so 5.1 km and 5.0 km
//     count as the same PR).
//   • Row 2 — Next: Best minus a small delta (5 sec floor, ~0.5 % scaled).
//     When the user beats Next, it auto-becomes the new Best on next render.
//   • Cue line: "Beat your best — try X distance in Y time. About N sec
//     faster than your current PR."
//
// Most-recent effort is in the log list below, so we DON'T duplicate it
// in the hero — the only two numbers that matter are Best (your achievement)
// and Next (your target).
//
// Math anchors on the user's MOST-RECENT distance because that's what they
// just did and what they're most likely to do again. If their last session
// was 30 km, the page nudges them to beat their best 30 km time. If they
// shift to 50 km, the anchor floats with them.
//
// Empty state: < 1 effort → "Log your first session" message. No PR + Next
// to compute against.

// Canonical distances (kilometres) for the 5-row goal card. Same set
// across all three Beat-Your-Best activities (Cycling outdoor, Stationary
// Bike, Elliptical) — locked May 19 2026. These are globally-recognised
// race / interval distances; the user's per-row time targets are computed
// by Riegel-projecting EVERY logged effort to each distance and taking the
// minimum (the user's best pace × the canonical distance, accounting for
// pace decay at longer distances and pace gain at shorter ones).
const CANONICAL_DISTANCES_KM: readonly number[] = [0.5, 1, 3, 5, 10]

function fmtCanonicalDistance(distKm: number): string {
  // Always render the canonical distance in its natural form, regardless
  // of the user's unit preference. 500 m / 1 km / 3 km / 5 km / 10 km
  // are globally-recognised race distances; converting them to ugly mi
  // values (0.31 mi, 0.62 mi, etc.) would obscure that recognition.
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`
  return `${distKm} km`
}

function BeatYourBestDetail({
  activity, efforts, distUnit, onDelete, hideHeader,
}: {
  activity: string
  efforts:  Effort[]
  distUnit: 'km' | 'mi'
  onDelete: (id: string) => void
  /** Suppresses page-level header for family slot rendering. */
  hideHeader?: boolean
}) {
  const [infoOpen, setInfoOpen] = useState(false)

  // Best PACE overall — used for the header subtitle.
  let bestEffort:  Effort | null = null
  let bestPaceSecs = Infinity
  efforts.forEach(e => {
    const secs = parsePaceToSecs(e.value)
    if (secs !== null && secs < bestPaceSecs) { bestPaceSecs = secs; bestEffort = e }
  })
  const hasBestPace = bestPaceSecs > 0 && bestPaceSecs !== Infinity

  // Per-canonical-distance targets via Riegel projection.
  //
  // For each canonical distance D, project every logged effort (d, t) to
  // an equivalent time at D using Riegel's law:
  //
  //   T_D = t × (D / d)^1.06
  //
  // Take MIN across all efforts — that's the user's best demonstrated
  // ability at D. Because every effort gets projected to every canonical
  // distance, a 4.9 km effort and a 5.1 km effort both contribute to the
  // 5 km row with near-identical projected times (Riegel's exponent is
  // close to 1 for nearby distances, so small distance deltas cause small
  // time deltas). No explicit "tolerance" bucketing needed — the math
  // naturally normalises off-by-a-little logging.
  //
  // The push delta scales with distance — sec-floor of 2 / proportional
  // 0.5 % above. A 500 m row gets a ~2 sec push, a 10 km row gets ~20 sec.
  const distanceTargets = useMemo(() => {
    return CANONICAL_DISTANCES_KM.map(D => {
      let bestProjectedSecs = Infinity
      for (const e of efforts) {
        const p = parseEffortLabel(e.label)
        if (!p || p.distKm <= 0 || p.timeSecs == null || p.timeSecs <= 0) continue
        const projected = p.timeSecs * (D / p.distKm) ** 1.06
        if (projected < bestProjectedSecs) bestProjectedSecs = projected
      }
      if (bestProjectedSecs === Infinity) {
        return { distanceKm: D, bestSecs: null, nextSecs: null, pushSecs: 0 }
      }
      const bestRounded = Math.round(bestProjectedSecs)
      const push = Math.max(2, Math.round(bestRounded * 0.005))
      const nextRounded = Math.max(1, bestRounded - push)
      return { distanceKm: D, bestSecs: bestRounded, nextSecs: nextRounded, pushSecs: push }
    })
  }, [efforts])

  // Chart data — pace over time. The Y-axis is REVERSED in the chart
  // props so faster pace renders at the TOP — the line still trends
  // upward as the user improves, even though smaller-second values are
  // "better" mathematically. No "lower is better" caption text — the
  // visual direction speaks for itself.
  const chartData = efforts
    .map(e => {
      const paceSecs = parsePaceToSecs(e.value)
      if (paceSecs === null) return { ts: e.created_at, y: -1 }
      return { ts: e.created_at, y: paceSecs }
    })
    .filter(d => d.y >= 0)

  return (
    <View style={s.page}>

      {/* Header — h1 + "Best 1k" subtitle. The subtitle mirrors the
          1 km row's Best value (Riegel-projected) so the two never
          disagree numerically. Both pull from the same `distanceTargets`
          calc, just rendered in two places. 1 km is chosen as the
          headline distance because it's the most universal cycling /
          stationary reference. */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        {distanceTargets[1]?.bestSecs != null && (
          <View style={s.subRow}>
            <Text style={s.subText}>Best 1k — </Text>
            <TickerNumber
              value={fmtSecs(distanceTargets[1].bestSecs)}
              fontSize={14}
              color={palette.amber[400]}
              fontWeight="600"
            />
          </View>
        )}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(activity)}</Text>
        </View>
      </View>
      )}

      {/* Goal card — five stacked rows, one per canonical distance.
          Each row shows the user's projected Best time + Next-target
          (small push). Riegel projection means a 4.9 km effort and a
          5.1 km effort both contribute to the 5 km row with near-
          identical projected times — no explicit bucketing/tolerance
          needed. The detail page is only reachable when the user has
          at least one logged effort, so we never hit a fully-empty
          state here; the per-row guard handles the edge case of an
          effort row that failed to parse (shouldn't happen but
          defended). */}
      <AnimateRise delay={0} style={s.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.h2}>Your goals</Text>
          <Pressable
            onPress={() => setInfoOpen(o => !o)}
            style={s.heroZonePillButton}
          >
            <Text style={s.heroZonePillText} numberOfLines={1}>
              PROGRESSION
            </Text>
            <Info size={11} color={palette.amber[400]} />
          </Pressable>
        </View>

        <ZoneInfoExpansionPanel
          open={infoOpen}
          title="Beat your best"
          body="The simplest form of progression — go a little faster than your best at each canonical distance, every time you train. Small consistent improvements compound. Each row shows what to chase next."
        />

        <View style={{ marginTop: 12, gap: 6 }}>
          {distanceTargets.map(t => (
            <View key={t.distanceKm} style={s.canonicalDistanceRow}>
              <Text style={s.canonicalDistanceLabel}>
                {fmtCanonicalDistance(t.distanceKm)}
              </Text>
              {t.bestSecs != null && t.nextSecs != null ? (
                <View style={s.canonicalDistanceValuesInline}>
                  <Text style={s.canonicalDistanceSub}>Best</Text>
                  <TickerNumber
                    value={fmtSecs(t.bestSecs)}
                    fontSize={14}
                    color={palette.amber[400]}
                    fontWeight="700"
                  />
                  <Text style={[s.canonicalDistanceSub, { marginLeft: 8 }]}>Aim for</Text>
                  <TickerNumber
                    value={fmtSecs(t.nextSecs)}
                    fontSize={14}
                    color={palette.amber[400]}
                    fontWeight="700"
                  />
                  <Text style={s.canonicalDistanceDelta}>
                    ↓ {t.pushSecs}s
                  </Text>
                </View>
              ) : (
                <Text style={[s.subText, { fontSize: 12 }]}>—</Text>
              )}
            </View>
          ))}
        </View>

        {/* Attribution + projection-accuracy hint. Matches the
            attribution-line pattern from Running ("Riegel · Daniels' ·
            Seiler · pace zones & polarized 80/20"), Air Bike
            ("Cal/min anchored zones · watts derived (cal/min × 17.4) ·
            gender-calibrated baseline"), and Swimming. Names the
            methodology (Riegel) without explaining the formula. */}
        <Text style={[s.tinyText, { marginTop: 10 }]}>
          Riegel projection · 5 canonical distances
        </Text>
        <Text style={[s.tinyText, { marginTop: 4, fontStyle: 'italic' }]}>
          Log sessions at different distances to refine your targets — the more variety in your training history, the more accurate the projection.
        </Text>
      </AnimateRise>

      {/* Chart — pace over time, axis REVERSED so faster pace lands at
          the TOP. The line still trends upward as the user improves,
          which is how every other chart in the app reads. No "lower is
          better" framing in the caption — the visual handles it. */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Pace over time</Text>
          <LineChart
            data={chartData}
            referenceY={hasBestPace ? bestPaceSecs : null}
            yWidth={52}
            yTickFormatter={(v) => fmtPaceStr(v, distUnit)}
            tooltipValueFormatter={(v) => fmtPaceStr(v, distUnit)}
            tooltipLabel="Pace"
            lineColor={palette.amber[400]}
            reversed
            caption={
              <Text style={s.tinyText}>Dashed = your fastest pace</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History — each row shows pace on the right. */}
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
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={s.listRowName}>
                    {e.label.split(' · ').slice(1).join(' · ')}
                  </Text>
                  <Text style={s.listRowDate}>
                    {new Date(e.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={s.valAmber}>{convertStoredPace(e.value, distUnit)}</Text>
              </View>
            </DeleteAction>
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// StructuralCardioDetail — superseded by BeatYourBestDetail (May 19 2026).
// The original 3-zone L4 implementation lived here briefly before we agreed
// that aspirational prescriptions without effort validation weren't worth
// the UI complexity. Kept as a comment header so future readers searching
// for it find the trail. The component itself and its config table have
// been deleted; see git history if needed.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RuckingDetail — carry-style coaching surface (May 19 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
//
// Rucking is cardio by activity-tab placement but its progression is carry-like.
// You get better by carrying HEAVIER or going FARTHER, not by getting FASTER.
// Pace is too sensitive to load + terrain to be a useful coaching anchor.
// The detail page mirrors Atlas Stone Bear Hug Carry's design top-to-bottom
// (abs-mode tier ladder + load × distance hero + 3 adaptation zones).
//
// Unit locks are hard:
//   • Distance → MILES (movements.unit_lock = 'mi' on the Rucking row).
//   • Pack weight → POUNDS (hard-coded in code; unit_lock holds only one unit).
// The rucking community is universally imperial — GoRuck events, US tactical
// fitness programs, and every published ruck protocol use lb × mi worldwide.

type RuckTier = 'beginner' | 'intermediate' | 'advanced' | 'tough'
const RUCK_TIER_ORDER: readonly RuckTier[] = ['beginner', 'intermediate', 'advanced', 'tough']
const RUCK_TIER_LABELS: Record<RuckTier, string> = {
  beginner: 'BEGINNER', intermediate: 'INTERMEDIATE', advanced: 'ADVANCED', tough: 'TOUGH',
}
const RUCK_TIER_RANK: Record<RuckTier, number> = {
  beginner: 1, intermediate: 2, advanced: 3, tough: 4,
}

// Civilian-friendly tier scale stepped from the GoRuck event ladder.
// Reference points: GoRuck Light = 20 lb × 6 mi in 3 hours; GoRuck Tough =
// 35 lb × 12 mi in 3 hours; GoRuck Heavy = 45 lb × 20 mi in 12 hours; GoRuck
// Selection = 35 lb × 40 mi (extreme).
//
// The TOUGH tier here = the GoRuck Tough standard exactly (the universally
// recognized ruck benchmark). Beginner / Intermediate / Advanced are
// progression stops below it. We don't include Heavy/Selection because they
// require multi-hour sessions that exceed the app's 45-min total-session
// philosophy — when users hit Tough we surface congratulations, not push
// them toward Selection.
const RUCK_TIER_THRESHOLDS: Record<RuckTier, [number, number]> = {
  beginner:     [10, 2],
  intermediate: [20, 4],
  advanced:     [30, 8],
  tough:        [35, 12],
}

// RUCK_WEIGHT_LADDER_LB is imported from movements.ts — single source of
// truth shared between this detail page's zone snapping and the cardio log
// form's pack-weight wheel.

// Adaptation zones — mirror Carry's structure exactly. Each zone pushes one
// axis (or two for conditioning) anchored on the user's actual PB.
type RuckZone = 'max_load' | 'distance_build' | 'conditioning'
const RUCK_ZONE_ORDER: readonly RuckZone[] = ['max_load', 'distance_build', 'conditioning']

interface RuckZoneCfg { label: string; whyText: string }
const RUCK_ZONE_CONFIG: Record<RuckZone, RuckZoneCfg> = Object.freeze({
  max_load:       { label: 'MAX LOAD',       whyText: 'Heavier pack, same distance. Trains posterior-chain strength, grip stamina, and the mental fortitude that defines GoRuck-style events.' },
  distance_build: { label: 'DISTANCE BUILD', whyText: 'Same pack, longer distance. Builds cardiovascular base and foot durability — the foundation of every long ruck.' },
  conditioning:   { label: 'CONDITIONING',   whyText: 'Lighter pack, longer distance. Trains aerobic capacity without the orthopedic stress of heavy loads. Ideal recovery between hard sessions.' },
})

// Parse a rucking effort label.
//   Current format:  "Rucking · 35 lb × 2.5 mi in 45:00"
//   Legacy format:   "Rucking · 2.5 mi in 45:00"  (packLb defaults to 0)
// Legacy labels remain valid — users who logged before the May 19 2026 spec
// see their old efforts with weight = 0 (bodyweight rucking, which is just
// walking, but the parse still works).
function parseRuckLabel(label: string | null | undefined): { packLb: number; distMi: number; timeSecs: number } | null {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  // Current format with pack weight
  const m1 = part.match(/(\d+)\s*lb\s*[×x]\s*([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) {
    return { packLb: parseInt(m1[1], 10), distMi: parseFloat(m1[2]), timeSecs: parseTimeStr(m1[3]) ?? 0 }
  }
  // Legacy format without pack weight
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) {
    return { packLb: 0, distMi: parseFloat(m2[1]), timeSecs: parseTimeStr(m2[2]) ?? 0 }
  }
  return null
}

// Classify the user's highest cleared tier from their effort history.
// An effort qualifies for a tier when packLb ≥ minLb AND distMi ≥ minMi
// in the SAME effort (not cumulative across efforts). Returns null when
// no effort meets even the beginner threshold.
function classifyRuckTier(efforts: Effort[]): RuckTier | null {
  let highest: RuckTier | null = null
  for (const e of efforts) {
    const p = parseRuckLabel(e.label)
    if (!p) continue
    for (const tier of RUCK_TIER_ORDER) {
      const [minLb, minMi] = RUCK_TIER_THRESHOLDS[tier]
      if (p.packLb >= minLb && p.distMi >= minMi) {
        if (!highest || RUCK_TIER_RANK[tier] > RUCK_TIER_RANK[highest]) {
          highest = tier
        }
      }
    }
  }
  return highest
}

// Snap a value DOWN to the largest rung ≤ value. Returns ladder[0] when
// value is below the lowest rung (we never prescribe 0 lb).
function snapDownToRuckLadder(value: number, ladder: readonly number[]): number {
  let result = ladder[0]
  for (const v of ladder) {
    if (v <= value) result = v
    else break
  }
  return result
}

// Smallest rung above value, or null when value is ≥ heaviest rung.
function nextRuckLadderAbove(value: number, ladder: readonly number[]): number | null {
  for (const v of ladder) {
    if (v > value) return v
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// AirBikeDetail — calorie-anchored coaching surface (May 17 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
// Air bikes are fan-resistance machines (Assault, Echo, Rogue, Schwinn).
// Effort is exponential — push harder, get harder resistance — so the
// entire training methodology is built around short intense intervals
// measured in CALORIES, not pace or distance. The detail page anchors
// every zone target on the user's peak cal/min rate; the wheel input
// on the log form captures Calories + Time (no distance, no speed).
//
//   • Best metric: peak cal/min rate (cals ÷ minutes for the user's best
//     logged effort). Falls back to a gender-aware baseline (18 / 13 /
//     15 for male / female / other) if no efforts logged yet.
//   • Zones: AEROBIC (steady aerobic ride), THRESHOLD (sustained hard
//     intervals), SPRINT (max-effort sprint intervals). Names drawn
//     from CrossFit / HIIT coaching conventions where "sprint" is
//     significantly more associated than the generic "VO2 max".
//   • Calorie targets scale linearly with the user's rate so a faster
//     athlete gets more cals per interval (each rep stays roughly the
//     same wall-clock length).
//
// Famous benchmarks NOT yet shipped: 100-cal test, EMOM cal ladders,
// Death by Calories. v2 territory.

type AirBikeZone = 'aerobic' | 'threshold' | 'sprint'
const AIR_BIKE_ZONE_ORDER: readonly AirBikeZone[] = ['sprint', 'threshold', 'aerobic']

interface AirBikeZoneCfg {
  label:      string
  shortLabel: string
  whyText:    string
  /** Zone duration multiplier in minutes (per rep, or total for continuous). */
  durationMin: number
  /** Intensity factor relative to peak cal/min rate (0–1). */
  intensity:   number
  /** Number of reps (1 for continuous zones). */
  reps:        number
  /** Rest between intervals in seconds (0 for continuous). */
  restSecs:    number
}

const AIR_BIKE_ZONE_CONFIG: Record<AirBikeZone, AirBikeZoneCfg> = Object.freeze({
  sprint: {
    label:       'SPRINT',
    shortLabel:  'SPRINT',
    whyText:     'Max-effort calorie sprints with full recovery. Builds peak power output and trains the body to clear lactate during all-out work. The bread and butter of air bike training — Tabata-style intervals, EMOM cal sprints, and famous benchmark tests like the 100-cal time trial. 1–2 sessions per week with full recovery between.',
    durationMin: 0.5,    // ~30 sec per rep at peak intensity
    intensity:   1.0,    // 100% of peak rate
    reps:        8,
    restSecs:    45,
  },
  threshold: {
    label:       'THRESHOLD',
    shortLabel:  'THRESHOLD',
    whyText:     'Sustained hard intervals at the edge of what you can hold. Trains lactate clearance and the ability to maintain high output past the burn. Longer intervals than sprint, less rest. The most productive zone for improving the cal/min rate that anchors every other prescription.',
    durationMin: 1.0,    // ~1 min per rep
    intensity:   0.85,   // 85% of peak rate
    reps:        5,
    restSecs:    30,
  },
  aerobic: {
    label:       'AEROBIC',
    shortLabel:  'AEROBIC',
    whyText:     "Steady continuous ride at a comfortable pace — conversational on dry land. Builds the aerobic engine that supports the harder zones. Air bike doesn't really do 'easy' (fan resistance is exponential), but the lowest-intensity work the machine handles still has training value as recovery + base.",
    durationMin: 5.0,    // ~5 min continuous
    intensity:   0.65,   // 65% of peak rate
    reps:        1,
    restSecs:    0,
  },
})

interface AirBikeZoneRx {
  /** Cals per rep (for interval zones) or total cals (for continuous). */
  calsPerRep:        number
  /** Wattage floor — the user should sustain AT or ABOVE this watt value
   *  for the duration of each rep. Derived from cal/min × 0.85/0.65/1.0
   *  × 17.4 (Assault/Echo standard conversion). Floor-advisory, not
   *  a precise instantaneous target — ±10 % is fine. */
  wattsFloor:        number
  /** Estimated wall-clock time per rep in seconds. */
  estimatedSecsPerRep: number
  /** Number of reps (1 for continuous). */
  reps:              number
  /** Rest between intervals in seconds (0 for continuous). */
  restSecs:          number
  /** Short label for tile / pill display. */
  shortWork:         string  // "8 × 9 cal"
}

function buildAirBikeZoneRx(zone: AirBikeZone, peakCalsPerMin: number): AirBikeZoneRx {
  const cfg = AIR_BIKE_ZONE_CONFIG[zone]
  // Cal target per rep = peak rate × duration × intensity factor.
  // Rounded to nearest whole calorie (the machine display shows ints).
  const rawCals = peakCalsPerMin * cfg.durationMin * cfg.intensity
  const calsPerRep = Math.max(1, Math.round(rawCals))
  // Estimated time at the prescribed intensity. The user does each rep
  // "as fast as they can" but this gives them a rough wall-clock anchor.
  const estimatedSecsPerRep = Math.round((calsPerRep / (peakCalsPerMin * cfg.intensity)) * 60)
  // Watts floor for the zone — derived from the zone's effective cal/min
  // rate (peak × intensity) and the standard 17.4 W-per-cal/min conversion.
  // See `calsPerMinToWatts` for the formula derivation.
  const wattsFloor = calsPerMinToWatts(peakCalsPerMin * cfg.intensity)
  const shortWork = cfg.reps > 1
    ? `${cfg.reps} × ${calsPerRep} cal`
    : `${calsPerRep} cal`
  return {
    calsPerRep,
    wattsFloor,
    estimatedSecsPerRep,
    reps:     cfg.reps,
    restSecs: cfg.restSecs,
    shortWork,
  }
}

function getAirBikeZoneCue(zone: AirBikeZone, rx: AirBikeZoneRx): string {
  const cfg = AIR_BIKE_ZONE_CONFIG[zone]
  if (cfg.reps === 1) {
    // Continuous zone — no rest, one effort.
    return `Pedal ${rx.calsPerRep} cals at or above ${rx.wattsFloor} W — steady aerobic effort, about ${Math.round(cfg.durationMin)} min total.`
  }
  if (zone === 'sprint') {
    return `Sprint ${rx.calsPerRep} cals as fast as you can — hold at or above ${rx.wattsFloor} W. Rest ${rx.restSecs} sec, repeat ${rx.reps} times. Each interval should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
  }
  // threshold
  return `Hold ${rx.calsPerRep} cals at a sustained hard pace — keep watts at or above ${rx.wattsFloor} W. Rest ${rx.restSecs} sec, repeat ${rx.reps} times. Each interval should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
}

function AirBikeDetail({
  efforts, onDelete, hideHeader,
}: {
  efforts:  Effort[]
  onDelete: (id: string) => void
  /** Suppresses page-level header for family slot rendering. */
  hideHeader?: boolean
}) {
  const { profile } = useAuth()

  // Peak cal/min rate across all efforts. Each effort's rate is
  // calsPerMinFromEffort(cals, timeSecs) computed from the label. The
  // user's "best" is the MAX rate they've ever achieved.
  const peakCalsPerMin = useMemo(() => {
    let peak = 0
    for (const e of efforts) {
      const parsed = parseAirBikeLabel(e.label)
      if (!parsed || !parsed.timeSecs) continue
      const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
      if (rate > peak) peak = rate
    }
    return peak
  }, [efforts])

  // If the user hasn't logged any air bike efforts yet, bootstrap with
  // a gender-aware baseline cal/min so the zone prescriptions show
  // reasonable starting targets. Once they log any effort, their actual
  // rate replaces the baseline (peak > 0 takes precedence).
  const baselineCalsPerMin = useMemo(
    () => genderBaselineCalsPerMin(profile?.gender ?? null),
    [profile?.gender],
  )
  const effectiveRate = peakCalsPerMin > 0 ? peakCalsPerMin : baselineCalsPerMin
  const hasLoggedRate = peakCalsPerMin > 0

  // Chart data — cal/min over time. Y-axis NOT reversed (higher rate =
  // better progress = line trends UP) — distinct from pace charts where
  // lower-is-better and the axis is reversed.
  const chartData = useMemo(() => efforts
    .map(e => {
      const parsed = parseAirBikeLabel(e.label)
      if (!parsed || !parsed.timeSecs) return { ts: e.created_at, y: -1 }
      const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
      return { ts: e.created_at, y: rate }
    })
    .filter(d => d.y >= 0)
  , [efforts])

  // UI state — selected zone for hero card display. Default = SPRINT
  // (slot 0, hardest first per the carousel rule in Pattern 4).
  const [selectedZone, setSelectedZone] = useState<AirBikeZone>(AIR_BIKE_ZONE_ORDER[0])
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)
  const selectedCfg = AIR_BIKE_ZONE_CONFIG[selectedZone]
  const selectedRx  = useMemo(
    () => buildAirBikeZoneRx(selectedZone, effectiveRate),
    [selectedZone, effectiveRate],
  )
  const selectedCue = useMemo(
    () => getAirBikeZoneCue(selectedZone, selectedRx),
    [selectedZone, selectedRx],
  )

  // ── L4 swipe pill state (matches Carry / Settings / Sled Work patterns) ─
  const currentIdx = AIR_BIKE_ZONE_ORDER.indexOf(selectedZone)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx >= 0 && currentIdx < AIR_BIKE_ZONE_ORDER.length - 1
  const AIR_BIKE_SWIPE_THRESHOLD_PX = 20
  const AIR_BIKE_SLIDE_OFFSCREEN_PX = 220
  const AIR_BIKE_SLIDE_DURATION_MS  = 250
  const airBikePillTranslateX        = useSharedValue(0)
  const airBikeChevronOpacityOverride = useSharedValue(1)

  const navigateZone = (direction: -1 | 1) => {
    const target = currentIdx + direction
    if (target < 0 || target >= AIR_BIKE_ZONE_ORDER.length) return
    setSelectedZone(AIR_BIKE_ZONE_ORDER[target])
    setZoneInfoOpen(false)
  }

  const airBikePillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        airBikeChevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        airBikePillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > AIR_BIKE_SWIPE_THRESHOLD_PX
        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < AIR_BIKE_ZONE_ORDER.length
        if (!past || !validDirection) {
          airBikePillTranslateX.value = withTiming(0, { duration: 200 })
          airBikeChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }
        const slideOff = direction === 1 ? -AIR_BIKE_SLIDE_OFFSCREEN_PX : AIR_BIKE_SLIDE_OFFSCREEN_PX
        airBikePillTranslateX.value = withTiming(slideOff, { duration: AIR_BIKE_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateZone)(direction)
          airBikePillTranslateX.value = -slideOff
          airBikePillTranslateX.value = withTiming(0, { duration: AIR_BIKE_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) airBikeChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          })
        })
      })
      .onFinalize((_event, success) => {
        'worklet'
        if (!success) {
          airBikePillTranslateX.value = withTiming(0, { duration: 200 })
          airBikeChevronOpacityOverride.value = withTiming(1, { duration: 200 })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIdx],
  )

  const airBikePillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: airBikePillTranslateX.value }] }))
  const airBikeChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: airBikeChevronOpacityOverride.value }))

  return (
    <View style={s.page}>

      {/* Header — h1 + best cal/min subtitle + AIR BIKE category tag */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{AIR_BIKE_ACTIVITY}</Text>
        {hasLoggedRate ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best — </Text>
            <TickerNumber
              value={`${effectiveRate.toFixed(1)} cal/min`}
              fontSize={14}
              color={palette.amber[400]}
              fontWeight="600"
            />
          </View>
        ) : (
          <Text style={s.subText}>
            No efforts logged yet · using {baselineCalsPerMin} cal/min as a starting estimate
          </Text>
        )}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(AIR_BIKE_ACTIVITY)}</Text>
        </View>
      </View>
      )}

      {/* Progression plan card — L4 layout (in-frame variation swipe pill
          + hero + consolidated chart + log). */}
      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Your progression plan</Text>
        <Text style={s.helpTextSm}>
          Three zones to train, each anchored on your cal/min rate. Swipe the pill to switch zones.
        </Text>

        {/* Pill row + hero card share the SAME swipe gesture (May 19 2026).
            Wrapping both in a single GestureDetector means a horizontal
            swipe anywhere from the pill row down through the hero card
            drives the pill swipe. Pan still requires 15 px horizontal
            travel before activating, so taps on inner Pressables (info
            pill toggle, chevron buttons) fire normally; vertical drags
            > 25 px fail the gesture, allowing page scroll. */}
        <GestureDetector gesture={airBikePillSwipeGesture}>
          <View>
            <View style={s.airBikeZoneRow}>
              {hasPrev ? (
                <Animated.View style={[s.airBikeZoneChevronSlotLeft, airBikeChevronAnimatedStyle]}>
                  <Pressable
                    onPress={() => navigateZone(-1)}
                    style={s.airBikeZoneChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Previous zone"
                  >
                    <AmberAnimatedChevron direction="left" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <AmberAnimatedChevron direction="left" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                    </View>
                  </Pressable>
                </Animated.View>
              ) : (
                <View style={s.airBikeZoneChevronSlotLeft} />
              )}

              <Animated.View style={[s.airBikeZonePill, airBikePillAnimatedStyle]}>
                <Text style={s.airBikeZonePillText} numberOfLines={1}>
                  {AIR_BIKE_ZONE_CONFIG[selectedZone].label}
                </Text>
              </Animated.View>

              {hasNext ? (
                <Animated.View style={[s.airBikeZoneChevronSlotRight, airBikeChevronAnimatedStyle]}>
                  <Pressable
                    onPress={() => navigateZone(1)}
                    style={s.airBikeZoneChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Next zone"
                  >
                    <AmberAnimatedChevron direction="right" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <AmberAnimatedChevron direction="right" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                    </View>
                  </Pressable>
                </Animated.View>
              ) : (
                <View style={s.airBikeZoneChevronSlotRight} />
              )}
            </View>

            {/* Hero card — three stacked TickerNumber rows (May 19 2026 lock).
                Row 1 = work (reps × cals)
                Row 2 = watts floor ("at or above" coaching cue, derived from
                        cal/min × 0.65/0.85/1.0 × 17.4 watts/cal-per-min)
                Row 3 = estimated wall-clock time per rep (or total for AEROBIC)
                Rest moves to the cue line below. */}
            <View style={s.hero}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={() => setZoneInfoOpen(o => !o)}
                  style={s.heroZonePillButton}
                >
                  <Text style={s.heroZonePillText} numberOfLines={1}>
                    {selectedCfg.label}
                  </Text>
                  <Info size={11} color={palette.amber[400]} />
                </Pressable>
              </View>

              <ZoneInfoExpansionPanel
                open={zoneInfoOpen}
                title={selectedCfg.label}
                body={selectedCfg.whyText}
              />

              <View style={{ gap: 14 }}>
                <View style={s.heroValueRow}>
                  <TickerNumber
                    value={selectedRx.shortWork}
                    fontSize={30}
                    color={palette.amber[400]}
                    fontWeight="700"
                  />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    the work
                  </Text>
                </View>

                <View style={s.heroValueRow}>
                  <TickerNumber
                    value={`≥ ${selectedRx.wattsFloor} W`}
                    fontSize={30}
                    color={palette.amber[400]}
                    fontWeight="700"
                  />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    hold at or above
                  </Text>
                </View>

                <View style={s.heroValueRow}>
                  <TickerNumber
                    value={fmtSecs(selectedRx.estimatedSecsPerRep)}
                    fontSize={30}
                    color={palette.amber[400]}
                    fontWeight="700"
                  />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>
                    {selectedRx.reps > 1 ? 'est. per interval' : 'est. total'}
                  </Text>
                </View>
              </View>

              <View style={s.heroSep}>
                <Text style={s.heroCue}>{selectedCue}</Text>
              </View>
            </View>
          </View>
        </GestureDetector>

        <Text style={s.tinyText}>Cal/min anchored zones · watts derived (cal/min × 17.4) · gender-calibrated baseline</Text>
      </AnimateRise>

      {/* Chart — cal/min over time. Y-axis NOT reversed (higher = better;
          line trends UP as the user improves). Renders even with a single
          data point. */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Cal/min over time</Text>
          <LineChart
            data={chartData}
            referenceY={peakCalsPerMin > 0 ? peakCalsPerMin : null}
            yWidth={52}
            yTickFormatter={(v) => v.toFixed(1)}
            tooltipValueFormatter={(v) => `${v.toFixed(1)} cal/min`}
            tooltipLabel="Rate"
            lineColor={palette.amber[400]}
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.95 * 10) / 10),
              max: (mx) => Math.round(mx * 1.05 * 10) / 10,
            }}
            caption={
              <Text style={s.tinyText}>Dashed = personal best</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History — each row shows cal/min on the right (the air-bike
          canonical rate metric, derived from the stored label). */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => {
            const parsed = parseAirBikeLabel(e.label)
            const rate = parsed && parsed.timeSecs
              ? calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
              : 0
            const rightVal = rate > 0 ? `${rate.toFixed(1)} cal/min` : '—'
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
// RuckingDetail — carry-style coaching surface (May 19 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
//
// Top-to-bottom design mirrors Atlas Stone Bear Hug Carry's abs-mode
// CarryDetail. See "Rucking detail card — locked design spec" in CLAUDE.md
// for the full rationale.

function RuckingDetail({
  efforts, onDelete, hideHeader,
}: {
  efforts:  Effort[]
  onDelete: (id: string) => void
  /** Suppresses page-level header for family slot rendering. */
  hideHeader?: boolean
}) {
  // Hard-locked units. Distance lock is reinforced by the unit_lock column
  // on the Rucking movement row; weight lock lives only here in code.
  const wUnit: 'lb' = 'lb'
  const dUnit: 'mi' = 'mi'

  // ── Parse efforts → { packLb, distMi, timeSecs, ts, id } ──────────────────
  const parsed = useMemo(() => efforts.map(e => {
    const p = parseRuckLabel(e.label)
    if (!p) return null
    return { ts: e.created_at, packLb: p.packLb, distMi: p.distMi, timeSecs: p.timeSecs, id: e.id }
  }).filter((x): x is { ts: string; packLb: number; distMi: number; timeSecs: number; id: string } => x !== null), [efforts])

  // ── Best derivations ──────────────────────────────────────────────────────
  const bestWeight = parsed.length ? Math.max(...parsed.map(p => p.packLb)) : 0
  const bestDistRaw = parsed.length ? Math.max(...parsed.map(p => p.distMi)) : 0
  // Display with 1 decimal — miles have meaningful sub-mile precision
  const bestDistDisplay = Math.round(bestDistRaw * 10) / 10
  const currentTier = useMemo(() => classifyRuckTier(efforts), [efforts])
  const hasTargets = bestWeight > 0 && bestDistDisplay > 0

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selZone, setSelZone]           = useState<RuckZone>('max_load')
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  // ── Zone math (mirrors Carry's zoneMath exactly) ──────────────────────────
  // dInc = 1 mile (round-mile DISTANCE BUILD steps); ladder handles weight.
  const dInc = 1
  const zoneMath = useMemo(() => {
    const result: Record<RuckZone, { W_target: number; D_target: number; weightDeltaText: string; distDeltaText: string; cueLine: string }> = {} as Record<RuckZone, { W_target: number; D_target: number; weightDeltaText: string; distDeltaText: string; cueLine: string }>
    for (const zone of RUCK_ZONE_ORDER) {
      let W_target = 0
      let D_target = 0
      switch (zone) {
        case 'max_load':
          W_target = nextRuckLadderAbove(bestWeight, RUCK_WEIGHT_LADDER_LB) ?? bestWeight
          D_target = bestDistDisplay
          break
        case 'distance_build':
          W_target = bestWeight
          D_target = bestDistDisplay + dInc
          break
        case 'conditioning':
        default:
          W_target = snapDownToRuckLadder(bestWeight * 0.60, RUCK_WEIGHT_LADDER_LB)
          D_target = Math.round(bestDistDisplay * 2 * 10) / 10
          break
      }
      // Delta strings vs user's best
      const weightDeltaText = hasTargets
        ? (W_target > bestWeight
            ? `+ ${W_target - bestWeight} ${wUnit}`
            : W_target < bestWeight
              ? `− ${bestWeight - W_target} ${wUnit}`
              : 'same as your best')
        : ''
      const dDiff = Math.round((D_target - bestDistDisplay) * 10) / 10
      const distDeltaText = hasTargets
        ? (dDiff > 0
            ? `+ ${dDiff} ${dUnit}`
            : dDiff < 0
              ? `− ${Math.abs(dDiff)} ${dUnit}`
              : 'same as your best')
        : ''
      let cueLine: string
      if (!hasTargets) {
        cueLine = 'Log your first ruck to see a target.'
      } else {
        switch (zone) {
          case 'max_load':
            cueLine = `Ruck ${W_target} ${wUnit} for ${D_target} ${dUnit} — focus on posture and step under load`
            break
          case 'distance_build':
            cueLine = `Ruck ${W_target} ${wUnit} for ${D_target} ${dUnit} — steady cadence, manage your feet`
            break
          case 'conditioning':
          default:
            cueLine = `Ruck ${W_target} ${wUnit} for ${D_target} ${dUnit} — keep moving, build aerobic base`
            break
        }
      }
      result[zone] = { W_target, D_target, weightDeltaText, distDeltaText, cueLine }
    }
    return result
  }, [bestWeight, bestDistDisplay, hasTargets])

  // ── Pill swipe gesture (mirrors AirBikeDetail's pattern) ──────────────────
  const currentIdx = RUCK_ZONE_ORDER.indexOf(selZone)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx >= 0 && currentIdx < RUCK_ZONE_ORDER.length - 1

  const RUCK_SWIPE_THRESHOLD_PX = 20
  const RUCK_SLIDE_OFFSCREEN_PX = 220
  const RUCK_SLIDE_DURATION_MS  = 250

  const ruckPillTranslateX         = useSharedValue(0)
  const ruckChevronOpacityOverride = useSharedValue(1)

  const navigateZone = (direction: -1 | 1) => {
    const target = currentIdx + direction
    if (target < 0 || target >= RUCK_ZONE_ORDER.length) return
    setSelZone(RUCK_ZONE_ORDER[target])
    setZoneInfoOpen(false)
  }

  const ruckPillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => { 'worklet'; ruckChevronOpacityOverride.value = withTiming(0, { duration: 120 }) })
      .onUpdate((event) => { 'worklet'; ruckPillTranslateX.value = event.translationX })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > RUCK_SWIPE_THRESHOLD_PX
        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < RUCK_ZONE_ORDER.length
        if (!past || !validDirection) {
          ruckPillTranslateX.value = withTiming(0, { duration: 200 })
          ruckChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }
        const slideOff = direction === 1 ? -RUCK_SLIDE_OFFSCREEN_PX : RUCK_SLIDE_OFFSCREEN_PX
        ruckPillTranslateX.value = withTiming(slideOff, { duration: RUCK_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateZone)(direction)
          ruckPillTranslateX.value = -slideOff
          ruckPillTranslateX.value = withTiming(0, { duration: RUCK_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) ruckChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          })
        })
      })
      .onFinalize((_event, success) => {
        'worklet'
        if (!success) {
          ruckPillTranslateX.value = withTiming(0, { duration: 200 })
          ruckChevronOpacityOverride.value = withTiming(1, { duration: 200 })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIdx],
  )

  const ruckPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: ruckPillTranslateX.value }] }))
  const ruckChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: ruckChevronOpacityOverride.value }))

  // ── Chart data (two stacked single-axis charts) ───────────────────────────
  const weightChartData = useMemo(() => parsed.map(p => ({ ts: p.ts, y: p.packLb })), [parsed])
  const distChartData   = useMemo(() => parsed.map(p => ({ ts: p.ts, y: p.distMi })), [parsed])

  // ── Selected zone math ────────────────────────────────────────────────────
  const selectedZone = zoneMath[selZone]
  const selectedCfg  = RUCK_ZONE_CONFIG[selZone]

  return (
    <View style={s.page}>

      {/* Header — h1 + best subtitle (weight + distance) + category tag +
          tier tag (when achieved). Mirrors Atlas Stone Bear Hug Carry's
          header: subtitle text + small uppercase category pill below it +
          tier pill below that. Both pills use the same `categoryBadge`
          chrome (amber for cardio); they stack vertically so the tier
          reads as a sub-classification of the cardio category. */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{RUCKING_ACTIVITY}</Text>
        {hasTargets ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best — </Text>
            <TickerNumber value={`${bestWeight} ${wUnit}`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
            <Text style={[s.subText, { color: palette.amber[400] }]}> · </Text>
            <TickerNumber value={`${bestDistDisplay} ${dUnit}`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
          </View>
        ) : (
          <Text style={s.subText}>No efforts logged yet</Text>
        )}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(RUCKING_ACTIVITY)}</Text>
        </View>
        {currentTier && (
          <View style={s.categoryBadge}>
            <Text style={s.categoryBadgeText}>{RUCK_TIER_LABELS[currentTier]}</Text>
          </View>
        )}
      </View>
      )}

      {/* Adaptation zone card — pill swipe + hero card with 2 rows */}
      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Adaptation zone</Text>
        <Text style={s.helpTextSm}>Pick a training focus, then aim at the next target.</Text>

        {/* Pill row + hero card share the SAME swipe gesture (May 19 2026).
            Wrapping both in a single GestureDetector means a horizontal
            swipe anywhere from the pill row down through the hero card
            drives the pill swipe. Pan still requires 15 px horizontal
            travel before activating, so taps on inner Pressables (info
            pill toggle, chevron buttons) fire normally; vertical drags
            > 25 px fail the gesture, allowing page scroll. */}
        <GestureDetector gesture={ruckPillSwipeGesture}>
          <View>
            <View style={s.airBikeZoneRow}>
              {hasPrev ? (
                <Animated.View style={[s.airBikeZoneChevronSlotLeft, ruckChevronAnimatedStyle]}>
                  <Pressable onPress={() => navigateZone(-1)} style={s.airBikeZoneChevronPressable} hitSlop={8} accessibilityLabel="Previous zone">
                    <AmberAnimatedChevron direction="left" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <AmberAnimatedChevron direction="left" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                    </View>
                  </Pressable>
                </Animated.View>
              ) : <View style={s.airBikeZoneChevronSlotLeft} />}

              <Animated.View style={[s.airBikeZonePill, ruckPillAnimatedStyle]}>
                <Text style={s.airBikeZonePillText} numberOfLines={1}>{selectedCfg.label}</Text>
              </Animated.View>

              {hasNext ? (
                <Animated.View style={[s.airBikeZoneChevronSlotRight, ruckChevronAnimatedStyle]}>
                  <Pressable onPress={() => navigateZone(1)} style={s.airBikeZoneChevronPressable} hitSlop={8} accessibilityLabel="Next zone">
                    <AmberAnimatedChevron direction="right" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <AmberAnimatedChevron direction="right" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                    </View>
                  </Pressable>
                </Animated.View>
              ) : <View style={s.airBikeZoneChevronSlotRight} />}
            </View>

            {/* Hero card — top-right info pill + 2 stacked TickerNumber rows
                (weight target + distance target, each with delta string vs.
                user's best) + cue line below thin separator. */}
            <View style={s.hero}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable onPress={() => setZoneInfoOpen(o => !o)} style={s.heroZonePillButton}>
                  <Text style={s.heroZonePillText} numberOfLines={1}>{selectedCfg.label}</Text>
                  <Info size={11} color={palette.amber[400]} />
                </Pressable>
              </View>

              <ZoneInfoExpansionPanel
                open={zoneInfoOpen}
                title={selectedCfg.label}
                body={selectedCfg.whyText}
              />

              <View style={{ gap: 14 }}>
                <View style={s.heroValueRow}>
                  <TickerNumber value={`${selectedZone.W_target} ${wUnit}`} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>{selectedZone.weightDeltaText}</Text>
                </View>
                <View style={s.heroValueRow}>
                  <TickerNumber value={`${selectedZone.D_target} ${dUnit}`} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                  <Text style={s.heroValueDescriptor} numberOfLines={1}>{selectedZone.distDeltaText}</Text>
                </View>
              </View>

              <View style={s.heroSep}>
                <Text style={s.heroCue}>{selectedZone.cueLine}</Text>
              </View>
            </View>
          </View>
        </GestureDetector>

        <Text style={[s.tinyText, { marginTop: 10 }]}>
          Load + distance progression · GoRuck tier ladder
        </Text>
      </AnimateRise>

      {/* Tier ladder card removed (May 19 2026 — second pass). The rucking
          community already knows the GoRuck tier scale; surfacing it as
          an in-app card was redundant chrome. The user's current tier
          still appears as a small TIER pill in the header below the
          subtitle (mirrors Atlas Stone Bear Hug Carry's tier badge). */}

      {/* Progress charts — two stacked single-axis line charts (pack weight
          + distance over time). Mobile LineChart doesn't support dual axes
          natively, so we stack two charts — same pattern as Carry. */}
      {parsed.length >= 1 && (
        <AnimateRise delay={500} style={s.card}>
          <Text style={s.h2}>Progress over time</Text>
          <Text style={[s.helpTextSm, { marginBottom: 8, marginTop: 4 }]}>Pack weight</Text>
          <LineChart
            data={weightChartData}
            referenceY={bestWeight > 0 ? bestWeight : null}
            yWidth={42}
            yTickFormatter={(v) => `${Math.round(v)} lb`}
            tooltipValueFormatter={(v) => `${Math.round(v)} lb`}
            tooltipLabel="Weight"
            lineColor={palette.amber[400]}
          />
          <Text style={[s.helpTextSm, { marginTop: 16, marginBottom: 8 }]}>Distance</Text>
          <LineChart
            data={distChartData}
            referenceY={bestDistRaw > 0 ? bestDistRaw : null}
            yWidth={42}
            yTickFormatter={(v) => `${v.toFixed(1)} mi`}
            tooltipValueFormatter={(v) => `${v.toFixed(1)} mi`}
            tooltipLabel="Distance"
            lineColor={palette.amber[400]}
          />
        </AnimateRise>
      )}

      {/* History — each row shows the workout shape on the left (35 lb × 2.5 mi)
          and the wall-clock time on the right. */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => {
            const p = parseRuckLabel(e.label)
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
                      {p
                        ? (p.packLb > 0
                            ? `${p.packLb} lb × ${p.distMi} mi`
                            : `${p.distMi} mi`)
                        : e.label.split(' · ').slice(1).join(' · ')}
                    </Text>
                    <Text style={s.listRowDate}>{new Date(e.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={s.valAmber}>{p ? fmtSecs(p.timeSecs) : '—'}</Text>
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
// StairMillDetail — floors-per-minute coaching surface (May 19 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors Air Bike's rate-anchored architecture line-for-line:
//   • Rate metric: floors-per-minute (FPM) instead of cal/min.
//   • Cold-start: gender-aware baseline FPM until first effort logged.
//   • Zones: ENDURANCE / THRESHOLD / VO2 MAX (same names as running /
//     swimming / ergs — drops Air Bike's "SPRINT" naming because
//     stair-climbing protocols use the standard exercise-science vocab).
//   • Hardest-first slot order: VO2 → THRESHOLD → ENDURANCE.
//   • Hero card with 4 rows: workout shape, time, rate target, rest.
//   • Chart: FPM over time, axis NOT reversed (higher = better, mirrors
//     Air Bike — locked chart-direction rule).
//
// Science backing every zone is summarised in `STAIRMILL_ZONE_CONFIG`
// (whyText). See "StairMill detail card — locked design spec" in CLAUDE.md
// for the full citation list.

type StairMillZone = 'aerobic' | 'threshold' | 'vo2'
const STAIRMILL_ZONE_ORDER: readonly StairMillZone[] = ['vo2', 'threshold', 'aerobic']

interface StairMillZoneCfg {
  label:       string
  whyText:     string
  /** Continuous zone duration in minutes (per rep for intervals; total for AEROBIC). */
  durationMin: number
  /** Intensity factor relative to peak FPM (0–1.1). VO2 can exceed 1.0
   *  because short reps tolerate above-peak intensity. */
  intensity:   number
  /** Number of reps (1 for continuous AEROBIC zone). */
  reps:        number
  /** Rest between intervals in seconds (0 for continuous). */
  restSecs:    number
}

const STAIRMILL_ZONE_CONFIG: Record<StairMillZone, StairMillZoneCfg> = Object.freeze({
  vo2: {
    label:       'VO2 MAX',
    whyText:     "Short max-effort sprints at the ceiling of your aerobic capacity. The Allison protocol (2017 Med Sci Sports Exerc) showed 3 × 20-sec all-out stair climbs three times per week produced a 12 % VO2peak improvement in 6 weeks — among the most efficient cardio interventions ever published. Use sparingly: 1 session per week, full recovery between intervals.",
    durationMin: 1.0,    // ~60 sec per rep (Allison protocol used 20s, extended here for Step Mill console pacing)
    intensity:   1.10,   // 110 % of peak FPM — short reps tolerate above-peak
    reps:        3,
    restSecs:    180,    // 3 min full recovery between sprints
  },
  threshold: {
    label:       'THRESHOLD',
    whyText:     'Sustained hard intervals at the edge of what you can hold. Trains lactate clearance and the ability to maintain high climbing output past the initial burn. Honda et al. (2014) used 3-min stair-climbing intervals to drive metabolic adaptation; comparable to Pete Pfitzinger\'s cruise interval programming. 1–2 sessions per week max.',
    durationMin: 3.0,    // 3 min per rep — Honda protocol
    intensity:   0.85,   // 85 % of peak FPM — "comfortably hard sustained"
    reps:        4,
    restSecs:    90,
  },
  aerobic: {
    label:       'ENDURANCE',
    whyText:     'Continuous moderate climbing at conversational effort. Boreham et al. (2000) showed sustained moderate stair climbing produced a 17 % VO2max improvement in 8 weeks in previously sedentary adults — the foundation that supports every higher-intensity zone above it. Stay disciplined and steady; resist the urge to push.',
    durationMin: 20.0,   // 20 min continuous — Boreham protocol
    intensity:   0.65,   // 65 % of peak FPM — Zone 2 conversational
    reps:        1,
    restSecs:    0,
  },
})

interface StairMillZoneRx {
  /** Floors per rep (interval zones) or total floors (continuous). */
  floorsPerRep:       number
  /** Target FPM the user should hold for this zone. */
  targetFpm:          number
  /** Estimated wall-clock time per rep in seconds. */
  estimatedSecsPerRep: number
  /** Number of reps (1 for continuous). */
  reps:               number
  /** Rest between intervals in seconds (0 for continuous). */
  restSecs:           number
  /** Short label for hero row 1 (e.g. "4 × 30 floors" or "160 floors"). */
  shortWork:          string
}

function buildStairMillZoneRx(zone: StairMillZone, peakFpm: number): StairMillZoneRx {
  const cfg          = STAIRMILL_ZONE_CONFIG[zone]
  const targetFpm    = Math.max(1, peakFpm * cfg.intensity)
  const floorsPerRep = Math.max(1, Math.round(targetFpm * cfg.durationMin))
  const estimatedSecsPerRep = Math.round(cfg.durationMin * 60)
  return {
    floorsPerRep,
    targetFpm,
    estimatedSecsPerRep,
    reps:      cfg.reps,
    restSecs:  cfg.restSecs,
    // `shortWork` is rendered at 30px in the hero card row 1; "floors" is
    // 2× longer than every other detail page's unit ("lb", "cal", "W"),
    // so we abbreviate to "fl" here. Matches the log form's wheel which
    // also uses "fl". Spelled-out "floors" still appears in the cue line
    // (regular-size text), subtitle, chart tooltip, and live chip.
    shortWork: cfg.reps === 1 ? `${floorsPerRep} fl` : `${cfg.reps} × ${floorsPerRep} fl`,
  }
}

function getStairMillZoneCue(zone: StairMillZone, rx: StairMillZoneRx): string {
  const fpm = rx.targetFpm.toFixed(1)
  if (zone === 'aerobic') {
    return `Climb ${rx.floorsPerRep} floors continuously at a steady ${fpm} floors/min — should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
  }
  if (zone === 'threshold') {
    return `Climb ${rx.reps} × ${rx.floorsPerRep} floors at a hard sustained ${fpm} floors/min (~${fmtSecs(rx.estimatedSecsPerRep)} each). Rest ${rx.restSecs} sec between intervals.`
  }
  // vo2
  return `Climb ${rx.reps} × ${rx.floorsPerRep} floors at max effort (~${fmtSecs(rx.estimatedSecsPerRep)} each). Full recovery ${Math.round(rx.restSecs / 60)} min between intervals.`
}

// ─────────────────────────────────────────────────────────────────────────────
// StairMill plan queue — Seiler polarized sequencing (May 20 2026 lock)
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors running's `generatePlanQueue` rule-for-rule. The Allison / Boreham
// / Honda protocols describe SESSION shapes; Stephen Seiler's polarized
// training model describes how to ARRANGE those shapes across a week —
// applies to every steady-state aerobic discipline including stair climbing.
//
// Five rules (identical to running's queue):
//   1. No hard back-to-back — never schedule Threshold or VO2 right after
//      another hard session.
//   2. Don't let VO2 go stale — 10+ days since last Z5 → next is VO2.
//   3. Don't let Threshold go stale — 7+ days since last Z4 → next is Threshold.
//   4. Anti-stagnation interleave — after 3 Endurance steps in a row, drop in
//      a hard step (alternates T/V).
//   5. Default: Endurance — produces the ~80% Endurance / 20% T+V polarized
//      split.

/**
 * Classify a logged StairMill effort into one of the three adaptation zones.
 * Compares the effort's floors-per-minute rate against thresholds anchored
 * on the user's peak FPM:
 *   • fpm ≥ peak × 1.00  → vo2        (at-or-above-peak sprint pace)
 *   • fpm ≥ peak × 0.75  → threshold  (within ~10 % of the Honda T-pace)
 *   • otherwise          → aerobic    (Z2 conversational base)
 *
 * Thresholds intentionally sit BELOW each zone's intensity factor (1.10 / 0.85
 * / 0.65) so the user's actual effort doesn't have to hit the exact target to
 * count toward the queue's staleness clock.
 */
function classifyStairMillEffortZone(label: string | null | undefined, peakFpm: number): StairMillZone {
  const parsed = parseStairMillLabel(label)
  if (!parsed || !parsed.timeSecs || peakFpm <= 0) return 'aerobic'
  const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
  if (fpm <= 0) return 'aerobic'
  if (fpm >= peakFpm * 1.00) return 'vo2'
  if (fpm >= peakFpm * 0.75) return 'threshold'
  return 'aerobic'
}

/**
 * Days since the user's most recent effort classified into a given zone.
 * Returns 999 when they've never logged anything in that zone — that's the
 * "stale" sentinel the queue uses to force VO2 / Threshold sessions back
 * into rotation.
 */
function daysSinceLastStairMillEffortInZone(efforts: Effort[], zone: StairMillZone, peakFpm: number): number {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifyStairMillEffortZone(efforts[i].label, peakFpm) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

interface StairMillPlanStep {
  zone:          StairMillZone
  rx:            StairMillZoneRx
  cue:           string
  /** Short label for the queue tile — e.g., "3 × 29 fl" / "160 fl". */
  shortWork:     string
  /** "VO2 MAX" / "THRESHOLD" / "ENDURANCE" for the tile header. */
  zoneLabel:     string
}

function generateStairMillPlanQueue(
  efforts:  Effort[],
  peakFpm:  number,
  count:    number = 8,
): StairMillPlanStep[] {
  if (peakFpm <= 0) return []

  const lastEffort = efforts[efforts.length - 1]
  const lastZone   = lastEffort ? classifyStairMillEffortZone(lastEffort.label, peakFpm) : null
  const daysSinceT0 = daysSinceLastStairMillEffortInZone(efforts, 'threshold', peakFpm)
  const daysSinceV0 = daysSinceLastStairMillEffortInZone(efforts, 'vo2',       peakFpm)

  const zoneQueue: StairMillZone[] = []
  let virtualLast  = lastZone
  let virtualDaysT = daysSinceT0
  let virtualDaysV = daysSinceV0
  let endurStreak  = 0
  let lastHard: StairMillZone | null = null

  for (let i = 0; i < count; i++) {
    let next: StairMillZone
    if (virtualLast === 'threshold' || virtualLast === 'vo2') {
      next = 'aerobic'
    } else if (virtualDaysV >= 10) {
      next = 'vo2'
    } else if (virtualDaysT >= 7) {
      next = 'threshold'
    } else if (endurStreak >= 3) {
      next = lastHard === 'threshold' ? 'vo2' : 'threshold'
    } else {
      next = 'aerobic'
    }

    zoneQueue.push(next)

    virtualLast = next
    if (next === 'aerobic') {
      endurStreak++
    } else {
      endurStreak = 0
      lastHard = next
    }
    const gapDays = next === 'aerobic' ? 1 : 2
    virtualDaysT = next === 'threshold' ? 0 : virtualDaysT + gapDays
    virtualDaysV = next === 'vo2'       ? 0 : virtualDaysV + gapDays
  }

  return zoneQueue.map(zone => {
    const rx       = buildStairMillZoneRx(zone, peakFpm)
    const cue      = getStairMillZoneCue(zone, rx)
    const zoneLabel = STAIRMILL_ZONE_CONFIG[zone].label
    return { zone, rx, cue, shortWork: rx.shortWork, zoneLabel }
  })
}

function StairMillDetail({
  efforts, onDelete, hideHeader,
}: {
  efforts:  Effort[]
  onDelete: (id: string) => void
  /** Suppresses page-level header for family slot rendering. */
  hideHeader?: boolean
}) {
  const { profile } = useAuth()

  // ── Peak FPM across all efforts (rate anchor) ─────────────────────────────
  const peakFpm = useMemo(() => {
    let peak = 0
    for (const e of efforts) {
      const parsed = parseStairMillLabel(e.label)
      if (!parsed || !parsed.timeSecs) continue
      const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
      if (fpm > peak) peak = fpm
    }
    return peak
  }, [efforts])

  const baselineFpm = useMemo(
    () => genderBaselineFloorsPerMin(profile?.gender ?? null),
    [profile?.gender],
  )
  const effectiveRate = peakFpm > 0 ? peakFpm : baselineFpm
  const hasLoggedRate = peakFpm > 0

  // ── Chart data — FPM over time, NOT reversed ──────────────────────────────
  // Mirrors Air Bike's chart direction — higher rate = better progress =
  // line trends UP. Cardio chart-direction rule (locked in CLAUDE.md).
  const chartData = useMemo(() => efforts
    .map(e => {
      const parsed = parseStairMillLabel(e.label)
      if (!parsed || !parsed.timeSecs) return { ts: e.created_at, y: -1 }
      const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
      return { ts: e.created_at, y: fpm }
    })
    .filter(d => d.y >= 0)
  , [efforts])

  // ── Plan queue (polarized sequencing — Seiler model) ─────────────────────
  // Computed per render from training history. Walks the polarized rules
  // (no hard back-to-back, anti-staleness, anti-stagnation, default
  // Endurance) to produce the next 8 prescribed sessions. Regenerates
  // every time a new effort lands. Same shape running's queue uses —
  // the tile row is the navigation, the hero card below shows the
  // SELECTED tile's prescription.
  const planQueue = useMemo(
    () => generateStairMillPlanQueue(efforts, effectiveRate, 8),
    [efforts, effectiveRate],
  )

  // ── UI state ──────────────────────────────────────────────────────────────
  // Single piece of state — the index of the tile the user is currently
  // viewing. Default 0 (= next system-recommended session). Same model
  // as running's PaceDetail.
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)
  const [zoneInfoOpen, setZoneInfoOpen]       = useState(false)

  const selectedStep = planQueue[selectedStepIdx] ?? planQueue[0] ?? null
  const selectedCfg  = selectedStep ? STAIRMILL_ZONE_CONFIG[selectedStep.zone] : null
  const selectedRx   = selectedStep?.rx ?? null
  const selectedCue  = selectedStep?.cue ?? ''

  return (
    <View style={s.page}>

      {/* Header — h1 + best FPM subtitle + STAIR CLIMBING category tag */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{STAIRMILL_ACTIVITY}</Text>
        {hasLoggedRate ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best — </Text>
            <TickerNumber
              value={`${effectiveRate.toFixed(1)} floors/min`}
              fontSize={14}
              color={palette.amber[400]}
              fontWeight="600"
            />
          </View>
        ) : (
          <Text style={s.subText}>
            No efforts logged yet · using {baselineFpm} floors/min as a starting estimate
          </Text>
        )}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(STAIRMILL_ACTIVITY)}</Text>
        </View>
      </View>
      )}

      {/* Progression plan card — mirrors running's PaceDetail design
          exactly: tile row at the top is the navigation, hero card below
          shows the SELECTED tile's prescription. Default selection is
          tile 0 (the next system-recommended session per Seiler's
          polarized rules). The swipe pill was removed in favour of this
          unified tile-driven model — keeps every progression-plan
          surface in the app consistent. */}
      {selectedStep && selectedRx && selectedCfg && (
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
                    onPress={() => { setSelectedStepIdx(idx); setZoneInfoOpen(false) }}
                    style={[s.queueTile, isSelected && s.queueTileSelected]}
                  >
                    <Text style={[s.queueTileZone, isSelected && s.queueTileZoneSelected]} numberOfLines={1}>
                      {step.zoneLabel}
                    </Text>
                    <Text style={[s.queueTileWork, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {step.shortWork}
                    </Text>
                    <Text style={[s.queueTileTime, isSelected && s.queueTileTextSelected]} numberOfLines={1}>
                      {fmtSecs(step.rx.estimatedSecsPerRep)}
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

          {/* Hero card — driven by the selected tile. Same 3-row shape
              (workout / time / climb rate) as before, just sourced from
              planQueue[selectedStepIdx] instead of a manually-picked
              zone. Rest still lives in the cue line. */}
          <View style={s.hero}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setZoneInfoOpen(o => !o)} style={s.heroZonePillButton}>
                <Text style={s.heroZonePillText} numberOfLines={1}>{selectedCfg.label}</Text>
                <Info size={11} color={palette.amber[400]} />
              </Pressable>
            </View>

            <ZoneInfoExpansionPanel
              open={zoneInfoOpen}
              title={selectedCfg.label}
              body={selectedCfg.whyText}
            />

            <View style={{ gap: 14 }}>
              <View style={s.heroValueRow}>
                <TickerNumber value={selectedRx.shortWork} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>
                  {selectedRx.reps === 1 ? 'total climb' : 'per interval'}
                </Text>
              </View>
              <View style={s.heroValueRow}>
                <TickerNumber value={fmtSecs(selectedRx.estimatedSecsPerRep)} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>
                  {selectedRx.reps === 1 ? 'to complete' : 'per interval'}
                </Text>
              </View>
              <View style={s.heroValueRow}>
                <TickerNumber value={`${selectedRx.targetFpm.toFixed(1)} fl/min`} fontSize={30} color={palette.amber[400]} fontWeight="700" />
                <Text style={s.heroValueDescriptor} numberOfLines={1}>climb rate</Text>
              </View>
            </View>

            <View style={s.heroSep}>
              <Text style={s.heroCue}>{selectedCue}</Text>
            </View>
          </View>

          <Text style={[s.tinyText, { marginTop: 10 }]}>
            Seiler polarized 80/20 · session shapes from Allison / Honda / Boreham · ACSM
          </Text>
        </AnimateRise>
      )}

      {/* FPM-over-time chart */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Climb rate over time</Text>
          <LineChart
            data={chartData}
            referenceY={peakFpm > 0 ? peakFpm : null}
            yWidth={52}
            yTickFormatter={(v) => `${v.toFixed(1)}`}
            tooltipValueFormatter={(v) => `${v.toFixed(1)} floors/min`}
            tooltipLabel="Climb rate"
            lineColor={palette.amber[400]}
            caption={
              <Text style={s.tinyText}>Dashed = your peak climb rate</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History — each row shows floors + time + FPM rate */}
      <AnimateRise delay={500} style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => {
            const p = parseStairMillLabel(e.label)
            const fpm = p && p.timeSecs ? floorsPerMinFromEffort(p.floors, p.timeSecs) : 0
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
                      {p
                        ? (p.floors > 0
                            ? `${p.floors} floors in ${fmtSecs(p.timeSecs ?? 0)}`
                            : fmtSecs(p.timeSecs ?? 0))
                        : e.label.split(' · ').slice(1).join(' · ')}
                    </Text>
                    <Text style={s.listRowDate}>{new Date(e.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={s.valAmber}>
                    {fpm > 0 ? `${fpm.toFixed(1)} fl/min` : '—'}
                  </Text>
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
  activity, efforts, onDelete, hideHeader,
}: {
  activity: string
  efforts: Effort[]
  onDelete: (id: string) => void
  /** Suppresses page-level header for family slot rendering. */
  hideHeader?: boolean
}) {
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
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Best session — </Text>
          <TickerNumber value={fmtSecs(bestSecs)} fontSize={14} color={palette.amber[400]} fontWeight="600" />
        </View>
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(activity)}</Text>
        </View>
      </View>
      )}

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
  // pattern from strength's Sled Work wrapper but uses amber chrome to
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

  // Canonical-distance row in the Beat-Your-Best goal card. Five rows
  // stacked vertically. Each row is itself TWO STACKED lines (May 19 2026):
  // distance label on top, Best/Aim-for/delta on the bottom. The two-line
  // stack guarantees the longest labels ("10 KM" + "3:28:30" + "↓ 63s")
  // never overlap on narrow phones — a single-line layout breaks at the
  // 10 km row because the distance label is wider than the others.
  // BG + border match the hero card chrome (amber 8 % fill, amber 30 %
  // border) so the rows feel like mini-hero cards rather than separate chrome.
  canonicalDistanceRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: withAlpha(palette.amber[500], 0.30),
    backgroundColor: withAlpha(palette.amber[500], 0.08),
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  canonicalDistanceLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: palette.amber[400],
  },
  canonicalDistanceValuesInline: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 4,
  },
  canonicalDistanceSub: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.mutedForeground,
  },
  canonicalDistanceDelta: {
    fontSize: 10,
    color: withAlpha(palette.amber[400], 0.75),
    marginLeft: 6,
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

  // ── Air Bike L4 in-frame swipe pill (zone selector) ──────────────────────
  // Same shape as Carry's carryZoneRow + pill — see strength/[exercise].tsx.
  // Amber chrome instead of blue (cardio theme), wider vertical padding so
  // the GestureDetector hit area extends comfortably above/below the pill.
  airBikeZoneRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginBottom: 4, paddingVertical: 14,
  },
  airBikeZoneChevronSlotLeft: {
    width: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
  },
  airBikeZoneChevronSlotRight: {
    width: 56, flexDirection: 'row', alignItems: 'center',
  },
  airBikeZoneChevronPressable: {
    flexDirection: 'row', alignItems: 'center',
  },
  airBikeZonePill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
    borderWidth: 1, borderColor: palette.amber[500],
    backgroundColor: withAlpha(palette.amber[500], 0.15),
  },
  airBikeZonePillText: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, color: palette.amber[400],
  },

  // Cardio category badge — small amber pill rendered under the "Best —"
  // subtitle row on every cardio detail page (RUNNING, SWIMMING, ROWING,
  // CYCLING, etc.). Mirrors strength's `carryTierBadge` chrome but tinted
  // amber so cardio surfaces stay visually distinct. Same shape used for
  // the Rucking TIER badge — they're stacked vertically when both apply.
  categoryBadge: {
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.3),
    backgroundColor: withAlpha(palette.amber[500], 0.1),
    borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    marginTop: 4, alignSelf: 'flex-start',
  },
  categoryBadgeText: {
    color: palette.amber[400],
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },

  // Rucking tier ladder rows — tier-badge + criteria text on the left,
  // checkmark on the right when achieved. Mirrors Atlas's tier-badge
  // styling but tinted amber (cardio theme).
  ruckTierRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.15),
    backgroundColor: alpha(colors.card, 0.4),
  },
  ruckTierRowCurrent: {
    borderColor: withAlpha(palette.amber[500], 0.5),
    backgroundColor: withAlpha(palette.amber[500], 0.08),
  },
  ruckTierBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.3),
    backgroundColor: withAlpha(palette.amber[500], 0.08),
  },
  ruckTierBadgeAchieved: {
    borderColor: palette.amber[500],
    backgroundColor: withAlpha(palette.amber[500], 0.20),
  },
  ruckTierBadgeText: {
    color: withAlpha(palette.amber[400], 0.6),
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },
  ruckTierBadgeTextAchieved: {
    color: palette.amber[400],
  },
  ruckTierCriteria: {
    color: colors.foreground, fontSize: 13, fontWeight: '500',
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

// ─────────────────────────────────────────────────────────────────────────────
// renderCardioFamilyBestSubtitle — equipment-aware "Best …" subtitle helper.
// Single source of truth for the per-variant header subtitle on cardio
// family pages. Dispatches on the variant's activity type:
//   - StairMill → "Best — N.N floors/min"
//   - Air Bike → "Best — N.N cal/min"
//   - Rucking → "Best — N lb · M mi"
//   - Beat Your Best (Cycling outdoor, Stationary Bike, Elliptical) →
//     "Best 1k — m:ss"
//   - Speed-input machines → "Best speed — N.N km/h"
//   - Concept2 ergs → "Best — m:ss/500m"
//   - Duration mode → "Best session — m:ss"
//   - Default (pace) → "Best pace — m:ss/km"
// ─────────────────────────────────────────────────────────────────────────────

function renderCardioFamilyBestSubtitle(
  variant: { name: string; cardio_mode?: string | null } | null,
  efforts: Effort[],
  distUnit: 'km' | 'mi',
): React.ReactNode {
  if (!variant) return <Text style={s.subText}>No efforts logged yet</Text>
  if (efforts.length === 0) return <Text style={s.subText}>No efforts logged yet</Text>

  const activity = variant.name

  // StairMill — best floors-per-min rate
  if (isStairMillActivity(activity)) {
    let maxFpm = 0
    efforts.forEach(e => {
      const parsed = parseStairMillLabel(e.label)
      if (!parsed?.timeSecs) return
      const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
      if (fpm > maxFpm) maxFpm = fpm
    })
    if (maxFpm <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best — </Text>
        <TickerNumber value={`${maxFpm.toFixed(1)} floors/min`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
      </View>
    )
  }

  // Air Bike — best cal-per-min rate
  if (isAirBikeActivity(activity)) {
    let maxRate = 0
    efforts.forEach(e => {
      const parsed = parseAirBikeLabel(e.label)
      if (!parsed?.timeSecs) return
      const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
      if (rate > maxRate) maxRate = rate
    })
    if (maxRate <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best — </Text>
        <TickerNumber value={`${maxRate.toFixed(1)} cal/min`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
      </View>
    )
  }

  // Rucking — best weight + best distance
  if (isRuckingActivity(activity)) {
    let maxW = 0, maxD = 0
    efforts.forEach(e => {
      const parsed = parseRuckLabel(e.label)
      if (!parsed) return
      if (parsed.packLb > maxW) maxW = parsed.packLb
      if (parsed.distMi > maxD) maxD = parsed.distMi
    })
    if (maxW <= 0 && maxD <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best — </Text>
        <TickerNumber value={`${maxW} lb`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
        <Text style={[s.subText, { color: palette.amber[400] }]}> · </Text>
        <TickerNumber value={`${maxD.toFixed(1)} mi`} fontSize={14} color={palette.amber[400]} fontWeight="600" />
      </View>
    )
  }

  // Duration-mode activities — best session time
  if (variant.cardio_mode === 'duration') {
    let bestSecs = 0
    efforts.forEach(e => {
      const secs = parseTimeStr(e.value)
      if (secs && secs > bestSecs) bestSecs = secs
    })
    if (bestSecs <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best session — </Text>
        <TickerNumber value={fmtSecs(bestSecs)} fontSize={14} color={palette.amber[400]} fontWeight="600" />
      </View>
    )
  }

  // Default pace activities — best per-km pace (lowest secs-per-km)
  let bestPace = Infinity
  efforts.forEach(e => {
    const secs = parsePaceToSecs(e.value)
    if (secs && secs > 0 && secs < bestPace) bestPace = secs
  })
  if (!Number.isFinite(bestPace)) return <Text style={s.subText}>No efforts logged yet</Text>
  return (
    <View style={s.subRow}>
      <Text style={s.subText}>Best pace — </Text>
      <TickerNumber value={fmtPaceTick(bestPace)} fontSize={14} color={palette.amber[400]} fontWeight="600" />
      <Text style={[s.subText, { color: palette.amber[400] }]}>/{distUnit}</Text>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CardioFamilyConsolidatedDetail
//
// Sled Work / Swimming-mirror wrapper for admin-added cardio variant
// families. Same outer chrome (header + amber pill row + paged ScrollView)
// as strength's FamilyConsolidatedDetail, just amber-themed and routing
// through renderCardioInnerDetail per slot.
// ─────────────────────────────────────────────────────────────────────────────

function CardioFamilyConsolidatedDetail({
  parent,
  variants,
}: {
  parent: { id: string; name: string; cardio_mode?: string | null; unit_lock?: string | null }
  variants: ReadonlyArray<{
    id: string
    name: string
    cardio_mode?: string | null
    unit_lock?: string | null
    variant_short_label?: string | null
    created_at?: string
  }>
}) {
  const { user, profile } = useAuth()
  const profileDistUnit = ((profile as any)?.distance_unit as 'km' | 'mi' | undefined) || 'km'
  const swimUnit: 'm' | 'yd' = ((profile as any)?.swim_unit as 'm' | 'yd' | undefined) || 'm'
  const parentDistUnit: 'km' | 'mi' = (parent.unit_lock === 'km' || parent.unit_lock === 'mi')
    ? (parent.unit_lock as 'km' | 'mi')
    : profileDistUnit

  // Per-variant raw efforts — single query covers the whole family.
  const [effortsByVariant, setEffortsByVariant] = useState<Record<string, Effort[]>>({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!user || variants.length === 0) return
    let alive = true
    const labelFilters = variants.map(v => `label.ilike.${v.name} ·%`).join(',')
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'cardio')
      .or(labelFilters)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        const sortedVariants = variants.slice().sort((a, b) => b.name.length - a.name.length)
        const map: Record<string, Effort[]> = {}
        ;(data || []).forEach((e: Effort) => {
          const v = sortedVariants.find(sv => e.label.startsWith(`${sv.name} ·`))
          if (!v) return
          ;(map[v.id] ??= []).push(e)
        })
        setEffortsByVariant(map)
        setLoading(false)
      })
    return () => { alive = false }
  }, [user, variants])

  // Only render pill + slot for variants with logged efforts (mirrors
  // Sled Work / Swimming filter). Fallback to all variants if none have
  // efforts (defensive — shouldn't happen because the index row wouldn't
  // appear in the first place).
  const loggedVariants = useMemo(() => {
    const filtered = variants.filter(v => (effortsByVariant[v.id]?.length ?? 0) > 0)
    return filtered.length > 0 ? filtered : variants
  }, [variants, effortsByVariant])
  const variantOrder = loggedVariants
  const [activeId, setActiveId] = useState<string>('')
  useEffect(() => {
    if (variantOrder.length === 0) return
    if (!activeId || !variantOrder.some(v => v.id === activeId)) {
      setActiveId(variantOrder[0].id)
    }
  }, [variantOrder, activeId])

  const activeVariant = variantOrder.find(v => v.id === activeId) ?? variantOrder[0] ?? null
  const activeEfforts = effortsByVariant[activeId] ?? []
  const currentIdx = Math.max(0, variantOrder.findIndex(v => v.id === activeId))
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < variantOrder.length - 1

  // ── Paged ScrollView + pill swipe ─────────────────────────────────────
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  const [slotWidth, setSlotWidth] = useState(winWidth)
  const scrollRef = useRef<ScrollView>(null)
  const outerScrollGesture = useMemo(() => Gesture.Native(), [])

  // Initial scrollTo — runs once after slotWidth is measured.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!scrollRef.current) return
    const idx = variantOrder.findIndex(v => v.id === activeId)
    if (idx < 0) return
    scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    initialScrollDoneRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWidth])

  // Pill swipe choreography (amber chrome, same timing as strength).
  const pillTranslateX = useSharedValue(0)
  const chevronOpacityOverride = useSharedValue(1)
  const SWIPE_THRESHOLD_PX = 20
  const SLIDE_OFFSCREEN_PX = 220
  const SLIDE_DURATION_MS  = 250

  const navigateVariant = (direction: -1 | 1) => {
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= variantOrder.length) return
    setActiveId(variantOrder[newIdx].id)
    if (slotWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })
    }
  }

  const pillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        chevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate(e => {
        'worklet'
        pillTranslateX.value = e.translationX
      })
      .onEnd(e => {
        'worklet'
        const passed = Math.abs(e.translationX) >= SWIPE_THRESHOLD_PX
        const direction: -1 | 1 = e.translationX < 0 ? 1 : -1
        const canMove = (direction === 1 && hasNext) || (direction === -1 && hasPrev)
        if (!passed || !canMove) {
          pillTranslateX.value = withTiming(0, { duration: 200 })
          chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }
        const slideOff = direction === 1 ? -SLIDE_OFFSCREEN_PX : SLIDE_OFFSCREEN_PX
        pillTranslateX.value = withTiming(slideOff, { duration: SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateVariant)(direction)
          pillTranslateX.value = -slideOff
          pillTranslateX.value = withTiming(0, { duration: SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          })
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIdx, hasPrev, hasNext, variantOrder.length, slotWidth],
  )

  const pillAnimStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: pillTranslateX.value }] }))
  const chevronAnimStyle = useAnimatedStyle(() => ({ opacity: chevronOpacityOverride.value }))

  const variantBracket = (name: string): string => {
    const m = name.match(/\[(.+)\]\s*$/)
    return m ? m[1] : name
  }

  // Loading state — skeleton mirrors the standalone route.
  if (loading) {
    return (
      <View style={s.page}>
        <Skeleton style={{ height: 36, width: 36, borderRadius: 9999, marginBottom: 8 }} />
        <View style={{ gap: 8, marginBottom: 16 }}>
          <Skeleton style={{ height: 22, width: 200, borderRadius: 6 }} />
          <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
        </View>
        <View style={{ gap: 16 }}>
          <Skeleton style={{ height: 144, width: '100%', borderRadius: 16 }} />
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 16 }} />
          <Skeleton style={{ height: 320, width: '100%', borderRadius: 16 }} />
        </View>
      </View>
    )
  }

  return (
    <View style={s.page}>
      {/* Static header — BackButton + parent name + per-variant subtitle */}
      <View>
        <BackButton />
        <Text style={s.h1}>{parent.name}</Text>
        {renderCardioFamilyBestSubtitle(activeVariant, activeEfforts, parentDistUnit)}
        <View style={s.categoryBadge}>
          <Text style={s.categoryBadgeText}>{cardioCategoryPillLabel(activeVariant?.name ?? parent.name)}</Text>
        </View>

        {/* Pill row — amber chrome mirroring Swimming consolidated. Only
            renders when ≥ 2 variants have logged efforts (single-variant
            families don't get a pill carousel — nothing to switch to). */}
        {variantOrder.length >= 2 && activeVariant && (
          <GestureDetector gesture={pillSwipeGesture}>
            <View style={s.swimStrokeRow}>
              {hasPrev ? (
                <Animated.View style={[s.swimStrokeChevronSlotLeft, chevronAnimStyle]}>
                  <Pressable
                    onPress={() => navigateVariant(-1)}
                    style={s.swimStrokeChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Previous variant"
                  >
                    <AmberAnimatedChevron direction="left" delay={250} color={withAlpha(palette.amber[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <AmberAnimatedChevron direction="left" delay={0} color={withAlpha(palette.amber[400], 0.8)} />
                    </View>
                  </Pressable>
                </Animated.View>
              ) : (
                <View style={s.swimStrokeChevronSlotLeft} />
              )}

              <Animated.View
                style={[
                  {
                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                    borderWidth: 1, borderColor: palette.amber[500],
                    backgroundColor: withAlpha(palette.amber[500], 0.15),
                  },
                  pillAnimStyle,
                ]}
              >
                <Text style={{
                  fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                  letterSpacing: 0.5, color: palette.amber[400],
                }}>
                  {variantBracket(activeVariant.name)}
                </Text>
              </Animated.View>

              {hasNext ? (
                <Animated.View style={[s.swimStrokeChevronSlotRight, chevronAnimStyle]}>
                  <Pressable
                    onPress={() => navigateVariant(1)}
                    style={s.swimStrokeChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Next variant"
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
        )}
      </View>

      {/* Paged horizontal ScrollView — one slot per variant. */}
      <View
        onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
        style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}
      >
        <GestureDetector gesture={outerScrollGesture}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={e => {
              if (slotWidth === 0) return
              const x = e.nativeEvent.contentOffset.x
              const idx = Math.round(x / slotWidth)
              const target = variantOrder[idx]
              if (target && target.id !== activeId) setActiveId(target.id)
            }}
          >
            {variantOrder.map(variant => {
              const slotEfforts = effortsByVariant[variant.id] ?? []
              const variantMode: 'pace' | 'duration' = variant.cardio_mode === 'duration' ? 'duration' : 'pace'
              const variantDistUnit: 'km' | 'mi' = (variant.unit_lock === 'km' || variant.unit_lock === 'mi')
                ? (variant.unit_lock as 'km' | 'mi')
                : profileDistUnit
              return (
                <View
                  key={variant.id}
                  style={{ width: slotWidth, paddingHorizontal: PAGE_PADDING_HORIZONTAL }}
                >
                  {renderCardioInnerDetail({
                    activity: variant.name,
                    efforts: slotEfforts,
                    distUnit: variantDistUnit,
                    swimUnit,
                    mode: variantMode,
                    onDelete: () => { /* family-mode delete handled at slot level if needed */ },
                    onAddEffort: async () => { /* family-mode add not wired — admin families don't show NEXT STEP CTA */ },
                    hideHeader: true,
                  })}
                </View>
              )
            })}
          </ScrollView>
        </GestureDetector>
      </View>
    </View>
  )
}
