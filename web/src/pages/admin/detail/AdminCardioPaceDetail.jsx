/**
 * AdminCardioPaceDetail — READ-ONLY (+ delete) coach mirror of the athlete's
 * cardio PACE / PROGRESSION-PLAN detail screen.
 *
 * Covers Group A "endurance athlete" activities — the ELSE / default cardio
 * case — i.e. activities that get the full Endurance / Threshold / VO2 Max
 * progression plan:
 *   running · running (treadmill) · cycling-as-pace · stationary bike ·
 *   elliptical · rowing (Row Erg) · ski erg · AND the Concept2 ergs
 *   (Row Erg / Bike Erg / Ski Erg).
 *
 * NOT routed here (each has its own admin mirror / spec):
 *   air bike (cal/min) · stairmill (floors/min, duration mode) ·
 *   rucking (load × distance, carry-style) · swimming (CSS, leaving
 *   intervals) · "beat your best" cycling/stationary/elliptical surfaces.
 * This component intentionally implements the BROAD Group-A path; if a
 * sibling Beat-Your-Best / Swimming / AirBike / StairMill / Rucking mirror
 * exists, the dispatcher should route those activities there FIRST and only
 * fall through to this file for the remaining Group-A endurance activities.
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - CLAUDE.md → "Cardio coaching-surface detail card — locked design spec"
 *   - CLAUDE.md → "Concept2 ergs (Row Erg / Bike Erg / Ski Erg) — locked spec"
 *   - mobile/app/(app)/effort/cardio/[activity].tsx → function PaceDetail
 *     (+ generatePlanQueue / buildPlanStep / adjustPaceForTimeCap and the
 *      Concept2 watts/split helpers)
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header        — activity name + "Best —"/"Best pace —" subtitle
 *                      (TickerNumber) + cardio category pill. Concept2 ergs
 *                      show "Best — m:ss/500m · NNN W" (split + watts).
 *   2. Progression   — NEXT STEP hero (zone info pill + work / time /
 *      plan card       checkpoint rows + full coaching cue) and a COMING UP
 *                      8-tile horizontal queue from generatePlanQueue.
 *                      Concept2 ergs add a 4th hero row (watts target).
 *   3. Chart         — pace-over-time (Y-axis REVERSED so improvement trends
 *                      UP). Never "lower = better" copy — caption is
 *                      "Dashed = personal best" only.
 *   4. Efforts log   — chronological list, per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * The athlete's progression-plan math (zone config, PACE_ZONE_SESSIONS,
 * generatePlanQueue, buildPlanStep, adjustPaceForTimeCap, the Concept2
 * watts/split helpers, the activity categorizer) lives ONLY in the mobile
 * file — the web lib (`web/src/lib/formulas.js`) just has `projectPaces`.
 * Rather than mutate the frozen web lib, every needed piece is reproduced
 * here verbatim from the mobile source so the prescriptions match the
 * athlete exactly. `projectPaces` is the one piece imported from the web lib
 * (identical Riegel implementation).
 *
 * Web substitutions for mobile-only primitives:
 *   - Skia/Reanimated swipe pill choreography → plain horizontal-scroll tile
 *     row + click-to-select (no physical pill slide). Mirrors how
 *     AdminStrengthWeightedDetail simplified the strength pill row.
 *   - LineChart (react-native-svg) → Recharts (matching AdminCardioDetail).
 *   - DeleteAction (gesture-handler swipe) → SwipeDelete (web).
 *   - ZoneInfoExpansionPanel (height-animated) → simple conditional panel.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { projectPaces } from '../../../lib/formulas'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const KM_PER_MI = 1.60934

// ── Time / pace helpers (1:1 with mobile [activity].tsx) ──────────────────────

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs) {
  if (totalSecs == null) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceTick(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceStr(secsPerKm, distUnit = 'km') {
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

function convertStoredPace(storedPaceStr, distUnit) {
  if (!storedPaceStr) return '—'
  if (distUnit !== 'mi') return storedPaceStr
  const m = storedPaceStr.match(/^(\d+):(\d{2})\//)
  if (!m) return storedPaceStr
  const secsPerKm = parseInt(m[1]) * 60 + parseInt(m[2])
  return fmtPaceStr(secsPerKm, 'mi')
}

function parsePaceToSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Default distance formatter (sub-1km/mi → meters, larger → km/mi).
function fmtDist(distKm, distUnit = 'km') {
  if (distUnit === 'mi') {
    const mi = distKm / KM_PER_MI
    if (mi < 1) return `${Math.round(distKm * 1000)} m`
    return `${mi.toFixed(mi < 5 ? 2 : 1).replace(/\.?0+$/, '')} mi`
  }
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`
  return `${distKm < 5 ? distKm.toFixed(2).replace(/\.?0+$/, '') : distKm.toFixed(1).replace(/\.0$/, '')} km`
}

// ── Concept2 erg helpers (verbatim mirror of mobile src/lib/movements.ts) ─────
const CONCEPT2_ERG_ACTIVITIES = new Set(['Row Erg', 'Bike Erg', 'Ski Erg'])
const ROW_ERG_ACTIVITY = 'Row Erg'

function isConcept2ErgActivity(activity) {
  return !!activity && CONCEPT2_ERG_ACTIVITIES.has(activity)
}
function isRowErgActivity(activity) {
  return activity === ROW_ERG_ACTIVITY
}

// secs/km → per-500m split string ("4:00/km" → "2:00/500m").
function pacePer500mFromSecsPerKm(secsPerKm) {
  if (!secsPerKm || secsPerKm <= 0) return '—'
  const secsPer500m = secsPerKm / 2
  const m = Math.floor(secsPer500m / 60)
  const s = Math.round(secsPer500m % 60)
  return `${m}:${String(s).padStart(2, '0')}/500m`
}

// secs/km → mechanical watts via Concept2's official formula:
//   pace_m_per_s = 1000 / pace_sec_per_km;  watts = 2.80 × (pace_m_per_s)³
function pacePer500mToWatts(secsPerKm) {
  if (!secsPerKm || secsPerKm <= 0) return 0
  const paceMps = 1000 / secsPerKm
  return Math.round(2.80 * paceMps ** 3)
}

// Activity-aware distance formatter — Concept2 ergs ALWAYS render metric
// (the PM5 console is metric worldwide), ignoring the user's mi/km pref.
function fmtDistForActivity(activity, distKm, distUnit) {
  if (isConcept2ErgActivity(activity)) {
    if (distKm < 1) return `${Math.round(distKm * 1000)} m`
    const decimals = distKm < 5 ? 2 : 1
    return `${distKm.toFixed(decimals).replace(/\.?0+$/, '')} km`
  }
  return fmtDist(distKm, distUnit)
}

// ── Effort label parsing (1:1 with mobile) ────────────────────────────────────
function parseEffortLabel(label) {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * KM_PER_MI, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  const m4 = part.match(/([\d.]+)\s*yd\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m4) return { distKm: parseFloat(m4[1]) * 0.0009144, timeSecs: parseTimeStr(m4[2]) }
  const m5 = part.match(/([\d.]+)\s*m\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m5) return { distKm: parseFloat(m5[1]) / 1000, timeSecs: parseTimeStr(m5[2]) }
  return null
}

// ── Activity categorization (verbatim mirror of mobile categorizeActivity) ────
function categorizeActivity(activityName) {
  const lower = (activityName || '').toLowerCase()
  if (/swim/.test(lower))                                       return 'swimming'
  if (/ski erg/.test(lower))                                    return 'ski_erg'
  if (/row erg/.test(lower))                                    return 'rowing'
  if (/air bike|assault bike|airdyne/.test(lower))              return 'air_bike'
  if (/spin|stationary|recumbent|bike erg/.test(lower))         return 'stationary_bike'
  if (/ellipt/.test(lower))                                     return 'elliptical'
  if (/cycl|bike/.test(lower))                                  return 'cycling'
  if (/ruck/.test(lower))                                       return 'rucking'
  if (/stair/.test(lower))                                      return 'stair_climber'
  return 'running'
}

// Group A — Endurance Athletes. Only this group gets the full E/T/V plan.
const ENDURANCE_ATHLETE_CATEGORIES = ['running', 'air_bike', 'rowing', 'ski_erg', 'swimming']
function isEnduranceAthleteActivity(activityName) {
  return ENDURANCE_ATHLETE_CATEGORIES.includes(categorizeActivity(activityName))
}

// ── Cardio category pill label (mirror of mobile cardioCategoryPillLabel) ──────
function cardioCategoryPillLabel(activity) {
  if (!activity) return 'CARDIO'
  const lower = activity.toLowerCase()
  if (/air bike|assault bike|airdyne/.test(lower)) return 'AIR BIKE'
  if (isRowErgActivity(activity))                  return 'ROWING'
  if (activity === 'Ski Erg')                      return 'SKIING'
  if (activity === 'Bike Erg')                     return 'CYCLING'
  if (/swim/.test(lower))                          return 'SWIMMING'
  if (/ruck/.test(lower))                          return 'RUCKING'
  if (lower.includes('elliptical'))                return 'ELLIPTICAL'
  if (lower.includes('stair'))                     return 'STAIR CLIMBING'
  if (/run|jog/.test(lower))                       return 'RUNNING'
  if (/cycl|bike/.test(lower))                     return 'CYCLING'
  return 'CARDIO'
}

// ── Cardio adaptation zones (3 zones — verbatim mirror of CARDIO_ZONE_CONFIG) ──
const CARDIO_ZONE_ORDER = ['endurance', 'threshold', 'vo2']

const CARDIO_ZONE_CONFIG = Object.freeze({
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
function getZonePaceSecPerKm(zone, bestPaceSecPerKm) {
  return Math.max(60, bestPaceSecPerKm + CARDIO_ZONE_CONFIG[zone].paceOffset)
}

// Classify a logged effort into a zone based on its pace vs the user's best.
function classifyEffortZone(effortValue, bestPaceSecPerKm) {
  const paceSecs = parsePaceToSecs(effortValue)
  if (paceSecs === null || bestPaceSecPerKm <= 0) return 'endurance'
  if (paceSecs <= bestPaceSecPerKm + 5)  return 'vo2'
  if (paceSecs <= bestPaceSecPerKm + 25) return 'threshold'
  return 'endurance'
}

// Days since the user's most recent effort in a given zone (999 = never).
function daysSinceLastEffortInZone(efforts, zone, bestPaceSecPerKm) {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifyEffortZone(efforts[i].value, bestPaceSecPerKm) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

// ── Per-zone session prescriptions (verbatim mirror of PACE_ZONE_SESSIONS) ─────
const PACE_ZONE_SESSIONS = {
  running: {
    endurance: [{ distanceKm: 5 }, { distanceKm: 6 }, { distanceKm: 8 }],
    threshold: [{ distanceKm: 3, intervalReps: 3 }, { distanceKm: 4, intervalReps: 4 }],
    vo2:       [{ distanceKm: 2, intervalReps: 5 }, { distanceKm: 3, intervalReps: 5 }],
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
    endurance: [{ distanceKm: 2 }, { distanceKm: 5 }, { distanceKm: 10 }],
    threshold: [{ distanceKm: 2, intervalReps: 4 }, { distanceKm: 5, intervalReps: 5 }],
    vo2:       [{ distanceKm: 3, intervalReps: 6 }, { distanceKm: 4, intervalReps: 8 }],
  },
  ski_erg: {
    endurance: [{ distanceKm: 3 }, { distanceKm: 4 }, { distanceKm: 5 }],
    threshold: [{ distanceKm: 2, intervalReps: 2 }, { distanceKm: 3, intervalReps: 3 }],
    vo2:       [{ distanceKm: 1.5, intervalReps: 3 }, { distanceKm: 2, intervalReps: 4 }],
  },
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

function getPaceZoneSessionVariants(activity, zone) {
  const cat = categorizeActivity(activity)
  return PACE_ZONE_SESSIONS[cat]?.[zone] ?? PACE_ZONE_SESSIONS.running[zone]
}

// ── 45-min total-session cap (verbatim mirror of adjustPaceForTimeCap) ─────────
const TIME_CAP_SECS = 45 * 60

function niceCapKm(rawKm) {
  if (rawKm < 1) return Math.max(0.1, Math.round(rawKm * 10) / 10)
  if (rawKm < 5) return Math.round(rawKm * 2) / 2
  return Math.max(1, Math.round(rawKm))
}

function adjustPaceForTimeCap(zone, rawSession, paceSecPerKm) {
  const isInterval = zone === 'threshold' || zone === 'vo2'

  if (!isInterval) {
    const rawWorkSecs = rawSession.distanceKm * paceSecPerKm
    if (rawWorkSecs <= TIME_CAP_SECS) {
      return {
        numReps: 1, repKm: rawSession.distanceKm, totalKm: rawSession.distanceKm,
        workSecs: rawWorkSecs, restSecs: 0, totalSecs: rawWorkSecs, wasCapped: false,
      }
    }
    const cappedKm    = niceCapKm(TIME_CAP_SECS / paceSecPerKm)
    const newWorkSecs = Math.round(cappedKm * paceSecPerKm)
    return {
      numReps: 1, repKm: cappedKm, totalKm: cappedKm,
      workSecs: newWorkSecs, restSecs: 0, totalSecs: newWorkSecs, wasCapped: true,
    }
  }

  // Intervals — reduce rep count until total time ≤ 45 min.
  //   Threshold (T-pace cruise) → 60 sec jog recovery between reps
  //   VO2 (I-pace)              → equal-time jog recovery (1:1 work:rest)
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
  return {
    numReps: reps, repKm, totalKm: repKm * reps,
    workSecs, restSecs, totalSecs: workSecs + restSecs, wasCapped: reps !== rawReps,
  }
}

// ── Activity-aware action verb (verbatim mirror of getActivityVerb) ────────────
function getActivityVerb(activity) {
  const lower = (activity || '').toLowerCase()
  if (/swim/.test(lower))                      return { imperative: 'Swim',  lower: 'swim'  }
  if (/row erg/.test(lower))                   return { imperative: 'Row',   lower: 'row'   }
  if (/ski erg/.test(lower))                   return { imperative: 'Ski',   lower: 'ski'   }
  if (/cycl|bike|spin|stationary/.test(lower)) return { imperative: 'Pedal', lower: 'pedal' }
  if (/ruck/.test(lower))                      return { imperative: 'Ruck',  lower: 'ruck'  }
  if (/ellipt/.test(lower))                    return { imperative: 'Glide', lower: 'glide' }
  return { imperative: 'Run', lower: 'run' }
}

// ── Pacing checkpoint (verbatim mirror of computePacingCheckpoint) ─────────────
function computePacingCheckpoint(rx, distUnit, zonePace) {
  const isInterval = rx.numReps > 1
  const repKm      = rx.repKm

  let checkpointKm
  let descriptor

  if (!isInterval) {
    if (distUnit === 'mi') { checkpointKm = KM_PER_MI; descriptor = 'per mile' }
    else                   { checkpointKm = 1;         descriptor = 'per km' }
  } else {
    const repMeters = repKm * 1000
    if (repMeters < 400) {
      return null
    } else if (repMeters >= 400 && repMeters < 600) {
      checkpointKm = 0.1; descriptor = 'per 100 m'
    } else if (repMeters >= 600 && repMeters <= 800) {
      checkpointKm = 0.2; descriptor = 'per 200 m'
    } else if (repMeters > 800 && repMeters <= 1000) {
      checkpointKm = 0.5; descriptor = 'per 500 m'
    } else if (distUnit === 'mi') {
      checkpointKm = KM_PER_MI; descriptor = 'per mile'
    } else {
      checkpointKm = 1; descriptor = 'per km'
    }
  }

  return { value: fmtSecs(Math.round(checkpointKm * zonePace)), descriptor }
}

// ── Build one PlanStep (verbatim mirror of buildPlanStep) ──────────────────────
// Note: web does NOT handle speed-machine input mode (the admin speed-mode
// surface, if it exists, belongs to the Beat-Your-Best mirror). So shortSpeed
// is always null here and the speed branches are intentionally dropped — the
// Group-A activities that route here all use pace, not console speed.
function buildPlanStep(zone, activity, bestPaceSecPerKm, distUnit, session) {
  const zonePace   = getZonePaceSecPerKm(zone, bestPaceSecPerKm)
  const rx         = adjustPaceForTimeCap(zone, session, zonePace)
  const verb       = getActivityVerb(activity)
  const isInterval = zone === 'threshold' || zone === 'vo2'

  const pacingCheckpoint = computePacingCheckpoint(rx, distUnit, zonePace)
  const pacingSentence   = pacingCheckpoint
    ? ` — aim for ${pacingCheckpoint.value} ${pacingCheckpoint.descriptor}`
    : ''

  const restDays   = zone === 'endurance' ? 0 : (zone === 'threshold' ? 1 : 2)
  const restLabel  = restDays === 0 ? '' : restDays === 1 ? '1 day rest' : '2 days rest'
  const restTail   = restDays === 1
    ? 'then take 1 day easy before your next step'
    : restDays === 2
      ? 'then take 2 days easy before your next step'
      : ''

  const isRowErg     = isRowErgActivity(activity)
  const splitDisplay = isRowErg ? pacePer500mFromSecsPerKm(zonePace) : null

  const isC2Erg        = isConcept2ErgActivity(activity)
  const wattsTarget    = isC2Erg ? pacePer500mToWatts(zonePace) : 0
  const ergWattsTarget = isC2Erg && wattsTarget > 0 ? wattsTarget : null

  if (!isInterval) {
    const totalDist = fmtDistForActivity(activity, rx.totalKm, distUnit)
    const totalTime = fmtSecs(rx.totalSecs)
    const cue = isRowErg
      ? `${verb.imperative} ${totalDist} in ${totalTime} at a steady ${splitDisplay} split${pacingSentence}.`
      : `${verb.imperative} ${totalDist} in ${totalTime} at steady conversation pace${pacingSentence}.`
    return {
      zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed: null, ergWattsTarget,
      shortWork: totalDist, shortTime: totalTime, cue, restLine: '',
    }
  }

  const repDist = fmtDistForActivity(activity, rx.repKm, distUnit)
  const repTime = fmtSecs(Math.round(rx.repKm * zonePace))
  const restNote = zone === 'threshold'
    ? 'Jog 60 sec between cruise intervals'
    : 'Equal-time jog recovery between intervals'
  const rowRestNote = isRowErg
    ? (zone === 'threshold'
        ? 'Paddle easy 60 sec between cruise intervals'
        : 'Equal-time paddle recovery between intervals')
    : restNote
  const cue = isRowErg
    ? `${verb.imperative} ${rx.numReps} × ${repDist} at ${splitDisplay} split (${repTime} each).`
    : `${verb.imperative} ${rx.numReps} × ${repDist} in ${repTime} each${pacingSentence}.`
  return {
    zone, rx, restDays, restLabel, pacingCheckpoint, shortSpeed: null, ergWattsTarget,
    shortWork: `${rx.numReps} × ${repDist}`, shortTime: repTime, cue,
    restLine: `${rowRestNote} · ${restTail}`,
  }
}

// ── Plan-queue generator (verbatim mirror of generatePlanQueue) ────────────────
// Pure function of training history. Walks the polarized-training rules to
// build a sequence of upcoming zones, then converts each to a full PlanStep.
function generatePlanQueue(activity, efforts, bestPaceSecPerKm, distUnit, count = 8) {
  if (bestPaceSecPerKm <= 0) return []

  const lastEffort   = efforts[efforts.length - 1]
  const lastZone     = lastEffort ? classifyEffortZone(lastEffort.value, bestPaceSecPerKm) : null
  const daysSinceT0  = daysSinceLastEffortInZone(efforts, 'threshold', bestPaceSecPerKm)
  const daysSinceV0  = daysSinceLastEffortInZone(efforts, 'vo2', bestPaceSecPerKm)

  const zoneQueue  = []
  let virtualLast  = lastZone
  let virtualDaysT = daysSinceT0
  let virtualDaysV = daysSinceV0
  let endurStreak  = 0
  let lastHard     = null

  for (let i = 0; i < count; i++) {
    let next
    if (virtualLast === 'threshold' || virtualLast === 'vo2') {
      next = 'endurance'                                        // Rule 1: no hard back-to-back
    } else if (virtualDaysV >= 10) {
      next = 'vo2'                                              // Rule 2: VO2 stale
    } else if (virtualDaysT >= 7) {
      next = 'threshold'                                        // Rule 3: Threshold stale
    } else if (endurStreak >= 3) {
      next = lastHard === 'threshold' ? 'vo2' : 'threshold'     // Rule 4: interleave a hard
    } else {
      next = 'endurance'                                        // Rule 5: default to Endurance
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

  // Each zone cycles through its variants independently so consecutive
  // same-zone steps look different.
  const variantIdxByZone = { endurance: 0, threshold: 0, vo2: 0 }
  return zoneQueue.map(zone => {
    const variants   = getPaceZoneSessionVariants(activity, zone)
    const variantIdx = variantIdxByZone[zone] % variants.length
    variantIdxByZone[zone]++
    return buildPlanStep(zone, activity, bestPaceSecPerKm, distUnit, variants[variantIdx])
  })
}

// ── Component ──────────────────────────────────────────────────────────────
//
// Props:
//   userId   (string, required) — client's auth user id
//   activity (string, required) — cardio movement name, e.g. "Running" / "Row Erg"
//   onBack   (fn, optional)     — custom back handler; defaults to the
//                                 client detail page (activity tab).
//
// Self-contained: fetches the client's efforts for `activity` and
// profile.distance_unit itself, so wiring is just
//   <AdminCardioPaceDetail userId activity />.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioPaceDetail({ userId, activity, onBack }) {
  const [efforts,  setEfforts]  = useState([])
  const [distUnit, setDistUnit] = useState('km')
  const [loading,  setLoading]  = useState(true)

  // Progression-plan UI state.
  const [zoneInfoOpen,    setZoneInfoOpen]    = useState(false)
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)

  const tileEls = useRef({})   // step idx → DOM node, for scroll-into-view

  // ── Load efforts + profile distance unit ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [efRes, profRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('id, user_id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'cardio')
          .ilike('label', `${activity} ·%`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('distance_unit')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setEfforts(efRes.data || [])
      setDistUnit(profRes.data?.distance_unit || 'km')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, activity])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEfforts(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  const isGroupA  = isEnduranceAthleteActivity(activity)
  const isC2Erg   = isConcept2ErgActivity(activity)
  const isRowErg  = isRowErgActivity(activity)

  // ── Best = fastest (lowest pace seconds-per-km) ───────────────────────────
  const { bestEffort, bestPaceSecs } = useMemo(() => {
    let be = null
    let bp = Infinity
    efforts.forEach(e => {
      const secs = parsePaceToSecs(e.value)
      if (secs !== null && secs < bp) { bp = secs; be = e }
    })
    return { bestEffort: be, bestPaceSecs: bp }
  }, [efforts])
  const hasBestPace = bestPaceSecs > 0 && bestPaceSecs !== Infinity

  // ── Progression plan (Group A only) — regenerated live every render. ───────
  const planQueue = useMemo(
    () => (isGroupA && hasBestPace)
      ? generatePlanQueue(activity, efforts, bestPaceSecs, distUnit, 8)
      : [],
    [isGroupA, hasBestPace, activity, efforts, bestPaceSecs, distUnit],
  )

  // When the queue regenerates (after a delete), reset the selection to step 0
  // and close the info panel. Done at RENDER time via React's documented
  // "adjust state when a prop changes" pattern (store the previous value in
  // state, compare during render, setState during render) — NOT in an effect.
  // Calling setState in an effect trips react-hooks/set-state-in-effect, and a
  // ref-based compare trips react-hooks/refs. The signature is the queue
  // length + the first step's zone; either changing means the queue reshaped
  // under the user, so any held selection is stale.
  const queueSig = `${planQueue.length}:${planQueue[0]?.zone ?? ''}`
  const [seenQueueSig, setSeenQueueSig] = useState(queueSig)
  if (seenQueueSig !== queueSig) {
    setSeenQueueSig(queueSig)
    if (selectedStepIdx !== 0) setSelectedStepIdx(0)
    if (zoneInfoOpen) setZoneInfoOpen(false)
  }

  const selectedStep = planQueue[selectedStepIdx] ?? planQueue[0] ?? null
  const selectedIsInterval = selectedStep
    ? (selectedStep.zone === 'threshold' || selectedStep.zone === 'vo2')
    : false
  const pacingCheckpoint = selectedStep?.pacingCheckpoint ?? null
  const selZoneCfg = selectedStep ? CARDIO_ZONE_CONFIG[selectedStep.zone] : null

  // ── Chart data — pace over time. ──────────────────────────────────────────
  const chartData = useMemo(() => efforts
    .map(e => {
      const secs = parsePaceToSecs(e.value)
      return secs === null
        ? null
        : { date: new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), secs }
    })
    .filter(Boolean), [efforts])

  function selectStep(idx) {
    setSelectedStepIdx(idx)
    requestAnimationFrame(() => {
      const el = tileEls.current[idx]
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })
  }

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // Header subtitle — Concept2 ergs show split + watts; everyone else pace.
  function renderHeaderBest() {
    if (!hasBestPace) {
      return <span className="text-sm text-muted-foreground">No efforts logged yet</span>
    }
    if (isC2Erg) {
      return (
        <span className="flex items-baseline gap-1 text-sm text-muted-foreground">
          <span>Best —</span>
          <TickerNumber value={pacePer500mFromSecsPerKm(bestPaceSecs)} className="font-mono font-semibold text-amber-400" />
          <span className="text-amber-400"> · </span>
          <TickerNumber value={`${pacePer500mToWatts(bestPaceSecs)} W`} className="font-mono font-semibold text-amber-400" />
        </span>
      )
    }
    return (
      <span className="flex items-baseline gap-1 text-sm text-muted-foreground">
        <span>Best pace —</span>
        <TickerNumber value={convertStoredPace(bestEffort?.value, distUnit)} className="font-mono font-semibold text-amber-400" />
      </span>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* ── 1. Header ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{activity}</h1>
        <p className="mt-0.5">{renderHeaderBest()}</p>
        {/* Cardio category tag — amber, mirrors strength's equipment pill. */}
        <span className="mt-1.5 inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
          {cardioCategoryPillLabel(activity)}
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Progression plan card (Group A + has a best pace) ── */}
          {isGroupA && hasBestPace && selectedStep && selZoneCfg && (
            <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Your progression plan</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your next step is below. After that, here's what's coming up.
              </p>

              {/* NEXT STEP hero — driven by the SELECTED tile (default: step 0). */}
              <div
                className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4"
                style={{ minHeight: 220 }}
              >
                {/* Zone info pill (top-right) — tappable for "why this zone". */}
                <div className="flex justify-end">
                  <button
                    onClick={() => setZoneInfoOpen(o => !o)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5"
                  >
                    <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-amber-400">
                      {selZoneCfg.label}
                    </span>
                    <Info className="h-3 w-3 text-amber-400" />
                  </button>
                </div>

                {/* Inline "why this zone" info panel (the WHY, not the prescription). */}
                {zoneInfoOpen && (
                  <div className="mt-1 rounded-md border border-amber-500/15 bg-card/60 px-2.5 py-2">
                    <p className="mb-1 text-xs font-bold text-foreground">
                      {selZoneCfg.label} · {selZoneCfg.hrPctRange}
                    </p>
                    <p className="text-[11px] leading-4 text-muted-foreground">{selZoneCfg.whyText}</p>
                  </div>
                )}

                {/* Stacked value rows — value (big amber, TickerNumber) on the
                    left, descriptor (small muted) on the right. */}
                <div className="mt-2 space-y-3.5">
                  {/* Row 1 — WORK */}
                  <div className="flex items-center justify-between gap-3">
                    <TickerNumber value={selectedStep.shortWork} className="font-mono text-3xl font-bold text-amber-400" />
                    <span className="max-w-[40%] text-right text-[11px] text-muted-foreground">
                      {selectedStep.zone === 'endurance' ? 'conversation pace'
                        : selectedStep.zone === 'threshold' ? 'comfortably hard'
                        : 'max sustainable'}
                    </span>
                  </div>

                  {/* Row 2 — TIME */}
                  <div className="flex items-center justify-between gap-3">
                    <TickerNumber value={selectedStep.shortTime} className="font-mono text-3xl font-bold text-amber-400" />
                    <span className="text-right text-[11px] text-muted-foreground">
                      {selectedIsInterval ? 'per interval' : 'to complete'}
                    </span>
                  </div>

                  {/* Row 3 — pacing checkpoint (when present) */}
                  {pacingCheckpoint && (
                    <div className="flex items-center justify-between gap-3">
                      <TickerNumber value={pacingCheckpoint.value} className="font-mono text-3xl font-bold text-amber-400" />
                      <span className="text-right text-[11px] text-muted-foreground">
                        {pacingCheckpoint.descriptor}
                      </span>
                    </div>
                  )}

                  {/* Row 4 — watts target (Concept2 ergs ONLY). */}
                  {selectedStep.ergWattsTarget != null && (
                    <div className="flex items-center justify-between gap-3">
                      <TickerNumber value={`${selectedStep.ergWattsTarget} W`} className="font-mono text-3xl font-bold text-amber-400" />
                      <span className="text-right text-[11px] text-muted-foreground">watts target</span>
                    </div>
                  )}
                </div>

                {/* Thin separator + full coaching cue + rest line. */}
                <div className="mt-2.5 border-t border-amber-500/15 pt-2.5">
                  <p className="text-sm text-foreground">{selectedStep.cue}</p>
                  {selectedStep.restLine && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{selectedStep.restLine}</p>
                  )}
                </div>
              </div>

              {/* COMING UP — 8-tile horizontal scroll queue. Tap a tile to
                  preview that step's prescription in the hero above. */}
              <p className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Coming up
              </p>
              <div className="relative">
                <div
                  className="flex items-center gap-1 overflow-x-auto py-1 px-0.5 scrollbar-hide"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {planQueue.map((step, idx) => {
                    const isSelected = selectedStepIdx === idx
                    const isLast     = idx === planQueue.length - 1
                    return (
                      <div key={idx} className="flex items-center">
                        <button
                          ref={el => { tileEls.current[idx] = el }}
                          onClick={() => selectStep(idx)}
                          className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 transition-colors ${
                            isSelected
                              ? 'border-amber-500 bg-amber-500/15'
                              : 'border-border bg-card/40 hover:border-amber-500/40'
                          }`}
                          style={{ minWidth: 84 }}
                        >
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${isSelected ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {CARDIO_ZONE_CONFIG[step.zone].shortLabel}
                          </span>
                          <span className={`mt-0.5 whitespace-nowrap font-mono text-sm font-bold tabular-nums ${isSelected ? 'text-amber-400' : 'text-foreground'}`}>
                            {step.shortWork}
                          </span>
                          <span className={`mt-0.5 whitespace-nowrap font-mono text-[10px] tabular-nums leading-none ${isSelected ? 'text-amber-400/70' : 'text-muted-foreground/60'}`}>
                            {step.shortTime}
                          </span>
                          {step.restLabel && (
                            <span className={`mt-0.5 whitespace-nowrap text-[8px] ${isSelected ? 'text-amber-400/60' : 'text-muted-foreground/50'}`}>
                              {step.restLabel}
                            </span>
                          )}
                        </button>
                        {!isLast && (
                          <span className="px-0.5 text-amber-400/60 select-none" aria-hidden="true">›</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
              </div>

              {/* Science attribution. */}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Riegel · Daniels' · Seiler · pace zones &amp; polarized 80/20
              </p>
            </AnimateRise>
          )}

          {/* Empty-state hint for Group A users with no efforts yet. */}
          {isGroupA && !hasBestPace && (
            <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Progression plan</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Log a first {activity} effort and the personalized plan will appear here.
                Every step adapts to the client's latest pace.
              </p>
            </AnimateRise>
          )}

          {/* Fallback projections card for NON-Group-A pace activities that
              somehow route here (defensive — those should normally hit the
              Beat-Your-Best mirror). Shows simple Riegel pace projections. */}
          {!isGroupA && hasBestPace && (() => {
            const bestData = bestEffort ? parseEffortLabel(bestEffort.label) : null
            const projections = bestData?.distKm && bestData?.timeSecs
              ? projectPaces(bestData.distKm, bestData.timeSecs)
              : []
            if (projections.length === 0) return null
            return (
              <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-bold">Pace projections</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Based on best effort: {bestEffort?.label?.split(' · ')[1]}
                </p>
                <div className="mt-3 space-y-2">
                  {projections.map(({ name, time, paceSecPerKm }) => (
                    <div key={name} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-4 py-3">
                      <span className="text-sm text-muted-foreground">{name}</span>
                      <div className="text-right">
                        <div className="font-mono text-sm tabular-nums">{time}</div>
                        <div className="font-mono text-xs tabular-nums text-amber-400">{fmtPaceStr(paceSecPerKm, distUnit)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </AnimateRise>
            )
          })()}

          {/* ── 3. Pace-over-time chart (Y-axis reversed → improvement up) ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Pace over time</p>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      reversed
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => (isRowErg ? fmtPaceTick(v / 2) : fmtPaceTick(v))}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [
                        isRowErg ? pacePer500mFromSecsPerKm(v) : fmtPaceStr(v, distUnit),
                        isRowErg ? 'Split' : 'Pace',
                      ]}
                    />
                    <ReferenceLine y={bestPaceSecs} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
                    <Line
                      type="monotone"
                      dataKey="secs"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#fbbf24', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-in-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Log a second effort to see the trend.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed = personal best</p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log (chronological, with per-effort delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {efforts.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No entries found for {activity}.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">All entries</h2>
              </div>
              <div className="divide-y divide-border">
                {[...efforts].reverse().map(e => {
                  const detail   = e.label.split(' · ').slice(1).join(' · ')
                  const paceSecs = parsePaceToSecs(e.value)
                  const rightVal = isRowErg
                    ? (paceSecs ? pacePer500mFromSecsPerKm(paceSecs) : '—')
                    : convertStoredPace(e.value, distUnit)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{detail || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(e.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-amber-400">
                          {rightVal}
                        </span>
                      </div>
                    </SwipeDelete>
                  )
                })}
              </div>
            </div>
          )}
        </AnimateRise>
      )}
    </div>
  )
}
