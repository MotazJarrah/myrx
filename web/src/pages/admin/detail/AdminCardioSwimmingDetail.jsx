/**
 * AdminCardioSwimmingDetail — READ-ONLY (+ per-effort delete) coach mirror of
 * the athlete's SWIMMING CONSOLIDATED cardio detail screen.
 *
 * Covers all four swim strokes (Freestyle / Backstroke / Breaststroke /
 * Butterfly), which live as separate `Swimming [Stroke]` movement rows but
 * collapse into ONE detail page with a stroke selector. Mirrors the athlete
 * surface defined in:
 *   - CLAUDE.md → "Swimming detail card — locked design spec"
 *   - mobile/app/(app)/effort/cardio/[activity].tsx
 *       (SwimmingConsolidatedDetail wrapper + SwimmingDetail inner)
 *
 * Sections, top to bottom (matching the athlete, AMBER cardio accent):
 *   1. Header          — "Swimming" + "Best — m:ss/100m" (TickerNumber) for the
 *                        active stroke + SWIMMING category pill
 *   2. Stroke selector — clickable tabs (FREE / BACK / BREAST / FLY). On web we
 *                        use plain tabs instead of the mobile pill-swipe carousel.
 *                        Defaults to the most-recently-logged stroke (else Freestyle).
 *   3. Progression plan — NEXT-STEP hero (work + per-100m pace + leaving interval)
 *                        + COMING UP queue (8 upcoming steps, click to preview)
 *                        + tappable zone info pill (whyText) + full coaching cue
 *   4. Chart           — Recharts per-100m pace over time, Y-axis REVERSED so
 *                        faster (lower pace) reads as the line trending UP.
 *                        No "lower = better" copy (locked chart-direction rule).
 *   5. Efforts log     — chronological list across the active stroke only, with
 *                        per-effort DELETE retained (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach is
 * allowed to delete a client's efforts) — mirrors AdminCardioDetail.
 *
 * Works whether `activity` is the base "Swimming" or a bracketed
 * "Swimming [Stroke]" — both fetch ALL stroke efforts (or() across the four
 * stroke variants + legacy bare "Swimming · ...") and group by stroke.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * web/src/lib/formulas.js has no swim CSS / zone / plan-queue math (those live
 * only in mobile/app/(app)/effort/cardio/[activity].tsx + mobile/src/lib/
 * movements.ts). Rather than mutate the frozen web lib, every needed piece —
 * Riegel CSS projection, per-100m zone offsets, leaving-interval rounding,
 * SWIM_ZONE_SESSIONS, the polarized plan-queue generator, and the stroke
 * helpers — is reproduced here verbatim so projections match the athlete.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, ChevronRight, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ─────────────────────────────────────────────────────────────────────────────
// Stroke helpers (verbatim mirror of mobile/src/lib/movements.ts)
// ─────────────────────────────────────────────────────────────────────────────

const SWIMMING_BASE_NAME = 'Swimming'

// Slot order — HARDEST first (Butterfly → … → Freestyle), matching the mobile
// carousel order. The selector renders strokes in this order.
const SWIM_STROKE_ORDER = ['butterfly', 'breaststroke', 'backstroke', 'freestyle']

const SWIM_STROKE_LABELS = Object.freeze({
  freestyle:    { full: 'Freestyle',    short: 'FREE'   },
  backstroke:   { full: 'Backstroke',   short: 'BACK'   },
  breaststroke: { full: 'Breaststroke', short: 'BREAST' },
  butterfly:    { full: 'Butterfly',    short: 'FLY'    },
})

/**
 * True for base "Swimming" or any "Swimming [Stroke]" — the dispatch predicate
 * a parent router would use to route here (mirrors mobile isSwimActivity).
 * Kept here as the canonical predicate for whoever wires this component in;
 * not called inside the component itself (it always self-fetches all strokes).
 */
// eslint-disable-next-line no-unused-vars
function isSwimActivity(activity) {
  if (!activity) return false
  if (activity === SWIMMING_BASE_NAME) return true
  if (activity.startsWith('Swimming [')) return true
  return false
}

/** Map a bracketed "Swimming [Stroke]" name → its stroke key, else null. */
function strokeFromActivity(activity) {
  if (!activity) return null
  const m = activity.match(/^Swimming\s+\[(\w+)\]$/i)
  if (!m) return null
  const stroke = m[1].toLowerCase()
  return SWIM_STROKE_ORDER.includes(stroke) ? stroke : null
}

/**
 * Parse the stroke from an effort label's leading "Swimming [X] · ..." prefix.
 * Bare "Swimming · ..." labels (logged before the May 17 2026 stroke
 * consolidation) default to Freestyle on the read path.
 */
function parseSwimStroke(label) {
  if (!label) return 'freestyle'
  const first = label.split(' · ')[0] ?? ''
  const m = first.match(/^Swimming\s+\[(\w+)\]/i)
  if (!m) return 'freestyle'
  const stroke = m[1].toLowerCase()
  if (SWIM_STROKE_ORDER.includes(stroke)) return stroke
  return 'freestyle'
}

// ─────────────────────────────────────────────────────────────────────────────
// Time / pace helpers (mirror of [activity].tsx)
// ─────────────────────────────────────────────────────────────────────────────

const KM_PER_MI = 1.60934

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

// Pace is stored seconds-per-km in the effort `value` ("m:ss/km").
function parsePaceToSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Swim distance label parse — meters / yards (swim) plus km / mi for legacy
// safety. Returns distance normalized to km (so the Riegel projection works in
// one unit) + time in seconds.
function parseEffortLabel(label) {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * KM_PER_MI, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  // Swim distance formats (m / yd). yd first, then m (the bare-'m' regex
  // requires '\s+in\s+' after so it won't match the 'm' in 'mi', but ordering
  // yd-then-m is safer).
  const m4 = part.match(/([\d.]+)\s*yd\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m4) return { distKm: parseFloat(m4[1]) * 0.0009144, timeSecs: parseTimeStr(m4[2]) }
  const m5 = part.match(/([\d.]+)\s*m\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m5) return { distKm: parseFloat(m5[1]) / 1000, timeSecs: parseTimeStr(m5[2]) }
  return null
}

// Per-100m pace formatting + unit label (swim convention).
function fmtPaceSecsPer100m(secsPer100m) {
  const m = Math.floor(secsPer100m / 60)
  const s = Math.round(secsPer100m % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function swimPaceUnitLabel(swimUnit) {
  return swimUnit === 'yd' ? '/100yd' : '/100m'
}

function fmtSwimDist(distM, swimUnit) {
  if (swimUnit === 'yd') return `${Math.round(distM / 0.9144)} yd`
  return `${Math.round(distM)} m`
}

// ─────────────────────────────────────────────────────────────────────────────
// Cardio adaptation zones (mirror of CARDIO_ZONE_CONFIG in [activity].tsx)
// ─────────────────────────────────────────────────────────────────────────────

const CARDIO_ZONE_CONFIG = Object.freeze({
  endurance: {
    label:      'ENDURANCE',
    shortLabel: 'ENDURANCE',
    hrPctRange: '60–70% HRmax',
    whyText:    'Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine. Stay disciplined and conversational; resist the urge to push.',
  },
  threshold: {
    label:      'THRESHOLD',
    shortLabel: 'THRESHOLD',
    hrPctRange: '80–90% HRmax',
    whyText:    'The single most productive zone for race times from 5K to half marathon. Cruise intervals teach your body to clear lactate faster, raising the speed you can sustain. 1–2 sessions per week max.',
  },
  vo2: {
    label:      'VO2 MAX',
    shortLabel: 'VO2 MAX',
    hrPctRange: '90–100% HRmax',
    whyText:    'Top-end stress. Short intervals at max sustainable effort build VO2 max — your engine ceiling — and pull every zone below up with them. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between.',
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Swim-specific math (verbatim mirror of [activity].tsx)
// ─────────────────────────────────────────────────────────────────────────────

// Reps × distance per (zone) — the canonical swim interval sets. The plan
// queue cycles through both variants per zone so consecutive same-zone steps
// look different. (Maglischo / Counsilman / Costill.)
const SWIM_ZONE_SESSIONS = Object.freeze({
  endurance: [
    { repDistanceM: 100, reps: 8 },
    { repDistanceM: 100, reps: 10 },
  ],
  threshold: [
    { repDistanceM: 100, reps: 10 },
    { repDistanceM: 200, reps: 5 },
  ],
  vo2: [
    { repDistanceM: 50,  reps: 10 },
    { repDistanceM: 100, reps: 6 },
  ],
})

// Per-100m pace offsets from CSS per zone.
const SWIM_ZONE_OFFSETS_SECS_PER_100M = Object.freeze({
  endurance: +12,
  threshold:  0,
  vo2:        -7,
})

// Rest seconds added on top of target swim time to produce the leaving
// interval (rounded to nearest 5s — pool clocks tick at 5s granularity).
const SWIM_ZONE_REST_SECS = Object.freeze({
  endurance: 10,
  threshold: 10,
  vo2:       20,
})

const RIEGEL_EXPONENT = 1.06

/**
 * CSS proxy via Riegel projection — the LOWEST projected per-100m pace across
 * all efforts. For each effort, project its time to a 1000m equivalent
 * (T2 = T1 × (1000/D)^1.06), divide by 10 for per-100m, take MIN. Improves
 * automatically as the user logs faster swims; never regresses on off-days.
 */
function riegelProjectCSS(efforts) {
  let bestCSS = null
  for (const e of efforts) {
    const parsed = parseEffortLabel(e.label)
    if (!parsed || parsed.timeSecs == null || parsed.timeSecs <= 0 || parsed.distKm <= 0) continue
    const distM = parsed.distKm * 1000
    const projected1000mTime = parsed.timeSecs * Math.pow(1000 / distM, RIEGEL_EXPONENT)
    const projectedPer100m   = projected1000mTime / 10
    if (bestCSS === null || projectedPer100m < bestCSS) bestCSS = projectedPer100m
  }
  return bestCSS
}

function getSwimZonePaceSecsPer100m(zone, cssSecsPer100m) {
  // Floor at 40 s/100m — faster than the world record swim pace.
  return Math.max(40, cssSecsPer100m + SWIM_ZONE_OFFSETS_SECS_PER_100M[zone])
}

// Build a single swim plan step (one queue entry).
function buildSwimPlanStep(zone, cssSecsPer100m, swimUnit, session) {
  const zonePace = getSwimZonePaceSecsPer100m(zone, cssSecsPer100m)
  const repTime  = zonePace * session.repDistanceM / 100
  const restSecs = SWIM_ZONE_REST_SECS[zone]
  const leavingInterval = Math.max(5, Math.round((repTime + restSecs) / 5) * 5)
  const restPerRep      = Math.max(0, leavingInterval - repTime)

  const repDistFormatted = fmtSwimDist(session.repDistanceM, swimUnit)
  const shortWork    = `${session.reps} × ${repDistFormatted}`
  const shortPace    = `${fmtPaceSecsPer100m(zonePace)}${swimPaceUnitLabel(swimUnit)}`
  const shortLeaving = fmtSecs(leavingInterval)

  const feelByZone = {
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

// Swim effort zone classification (per-100m space).
function classifySwimEffortZone(effortValue, cssSecsPer100m) {
  const paceSecsPerKm = parsePaceToSecs(effortValue)
  if (paceSecsPerKm === null || cssSecsPer100m <= 0) return 'endurance'
  const paceSecsPer100m = paceSecsPerKm / 10
  if (paceSecsPer100m <= cssSecsPer100m - 4) return 'vo2'
  if (paceSecsPer100m <= cssSecsPer100m + 5) return 'threshold'
  return 'endurance'
}

function daysSinceLastSwimEffortInZone(efforts, zone, cssSecsPer100m) {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifySwimEffortZone(efforts[i].value, cssSecsPer100m) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

/**
 * Plan queue generator for swimming — polarized rules (no hard back-to-back,
 * freshness checks at 7d/10d, anti-stagnation interleave at 3 endurance in a
 * row, default to endurance for ~80% volume), operating on per-100m pace and
 * pulling from SWIM_ZONE_SESSIONS. Pure function of training history; never
 * stored. Verbatim mirror of generateSwimPlanQueue in [activity].tsx.
 */
function generateSwimPlanQueue(efforts, cssSecsPer100m, swimUnit, count = 8) {
  if (cssSecsPer100m <= 0) return []

  const lastEffort  = efforts[efforts.length - 1]
  const lastZone    = lastEffort ? classifySwimEffortZone(lastEffort.value, cssSecsPer100m) : null
  const daysSinceT0 = daysSinceLastSwimEffortInZone(efforts, 'threshold', cssSecsPer100m)
  const daysSinceV0 = daysSinceLastSwimEffortInZone(efforts, 'vo2',       cssSecsPer100m)

  const zoneQueue = []
  let virtualLast  = lastZone
  let virtualDaysT = daysSinceT0
  let virtualDaysV = daysSinceV0
  let endurStreak  = 0
  let lastHard     = null

  for (let i = 0; i < count; i++) {
    let next
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

  const variantIdxByZone = { endurance: 0, threshold: 0, vo2: 0 }
  return zoneQueue.map(zone => {
    const variants   = SWIM_ZONE_SESSIONS[zone]
    const variantIdx = variantIdxByZone[zone] % variants.length
    variantIdxByZone[zone]++
    return buildSwimPlanStep(zone, cssSecsPer100m, swimUnit, variants[variantIdx])
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

function fmtShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner stroke surface — one stroke's full coaching body (plan + chart + log)
// ─────────────────────────────────────────────────────────────────────────────

function SwimStrokeBody({ strokeEfforts, swimUnit, onDelete, emptyStateLabel }) {
  // CSS proxy from this stroke's efforts only — strokes are physiologically
  // independent, no cross-stroke estimation.
  const cssSecsPer100m = useMemo(() => riegelProjectCSS(strokeEfforts), [strokeEfforts])
  const hasCSS = cssSecsPer100m !== null && cssSecsPer100m > 0

  const planQueue = useMemo(
    () => (hasCSS ? generateSwimPlanQueue(strokeEfforts, cssSecsPer100m, swimUnit, 8) : []),
    [hasCSS, cssSecsPer100m, strokeEfforts, swimUnit],
  )

  const [zoneInfoOpen, setZoneInfoOpen]       = useState(false)
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)

  // Clamp the selected index into the current queue's range rather than
  // resetting via an effect (avoids react-hooks/set-state-in-effect). The
  // parent remounts this component via `key={stroke}` on stroke switch, so
  // selection naturally resets per stroke; the only in-place change is a
  // delete shrinking the queue, which this clamp absorbs gracefully.
  const safeStepIdx  = Math.min(selectedStepIdx, Math.max(0, planQueue.length - 1))
  const selectedStep = planQueue[safeStepIdx] ?? planQueue[0] ?? null
  const paceUnitLabel = swimPaceUnitLabel(swimUnit)

  // Chart series — per-100m pace over time (stored per-km ÷ 10).
  const chartData = useMemo(() => strokeEfforts
    .map(e => {
      const paceSecsPerKm = parsePaceToSecs(e.value)
      if (paceSecsPerKm === null) return null
      return { date: fmtShort(e.created_at), y: paceSecsPerKm / 10 }
    })
    .filter(Boolean), [strokeEfforts])

  const yVals = chartData.map(d => d.y)
  const minY  = yVals.length ? Math.min(...yVals) : 0
  const maxY  = yVals.length ? Math.max(...yVals) : 100
  const yDomainMin = Math.max(0, Math.round(minY * 0.95))
  const yDomainMax = Math.round(maxY * 1.05)
  const cssForChart = hasCSS ? Math.round(cssSecsPer100m) : null

  const selZoneCfg = selectedStep ? CARDIO_ZONE_CONFIG[selectedStep.zone] : null

  return (
    <div className="space-y-5">

      {/* ── 3. Progression plan card ── */}
      {hasCSS && selectedStep ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Your progression plan</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This is the client's personalized adaptation plan — follow it to see their results improve.
          </p>

          {/* COMING UP queue — 8 upcoming steps, horizontal scroll with chevrons.
              Click a tile to preview it in the hero card. */}
          <div className="relative mt-3">
            <div
              className="flex items-stretch gap-1 overflow-x-auto py-1 px-0.5 scrollbar-hide"
              style={{ scrollbarWidth: 'none' }}
            >
              {planQueue.map((step, idx) => {
                const isSelected = safeStepIdx === idx
                const isLast     = idx === planQueue.length - 1
                return (
                  <div key={idx} className="flex items-center">
                    <button
                      onClick={() => setSelectedStepIdx(idx)}
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
                      <span className={`mt-0.5 font-mono text-xs font-bold tabular-nums ${isSelected ? 'text-amber-400' : 'text-foreground'}`}>
                        {step.shortWork}
                      </span>
                      <span className={`mt-0.5 font-mono text-[9px] tabular-nums leading-none ${isSelected ? 'text-amber-400/70' : 'text-muted-foreground/60'}`}>
                        {step.shortPace}
                      </span>
                    </button>
                    {!isLast && (
                      <ChevronRight className="mx-0.5 h-4 w-4 shrink-0 text-amber-400/60" />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
          </div>

          {/* NEXT-STEP hero card — three stacked TickerNumber rows
              (work / pace / leaving interval) + tappable zone info pill. */}
          <div
            className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4"
            style={{ minHeight: 220 }}
          >
            {/* Zone info pill (right-aligned). */}
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

            {/* Inline "why this zone" info panel. */}
            {zoneInfoOpen && (
              <div className="mt-1 rounded-md border border-amber-500/15 bg-card/60 px-2.5 py-2">
                <p className="mb-1 text-xs font-bold text-foreground">
                  {selZoneCfg.label} · {selZoneCfg.hrPctRange}
                </p>
                <p className="text-[11px] leading-4 text-muted-foreground">{selZoneCfg.whyText}</p>
              </div>
            )}

            {/* Three stacked value rows. */}
            <div className="mt-2 space-y-3.5">
              {/* Row 1 — Work (reps × distance) */}
              <div className="flex items-baseline gap-2">
                <TickerNumber value={selectedStep.shortWork} className="font-mono text-3xl font-bold text-amber-400" />
                <span className="text-xs text-muted-foreground">the work</span>
              </div>
              {/* Row 2 — Target pace per 100m */}
              <div className="flex items-baseline gap-2">
                <TickerNumber value={selectedStep.shortPace} className="font-mono text-3xl font-bold text-amber-400" />
                <span className="text-xs text-muted-foreground">target pace</span>
              </div>
              {/* Row 3 — Leaving interval (pool-clock time per rep) */}
              <div className="flex items-baseline gap-2">
                <TickerNumber value={selectedStep.shortLeaving} className="font-mono text-3xl font-bold text-amber-400" />
                <span className="text-xs text-muted-foreground">leave every</span>
              </div>
            </div>

            {/* Thin separator + full coaching cue. */}
            <div className="mt-2.5 border-t border-amber-500/15 pt-2.5">
              <p className="text-sm text-foreground">{selectedStep.cue}</p>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Riegel · Maglischo · Counsilman · Costill — CSS-anchored zones
          </p>
        </AnimateRise>
      ) : (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Progression plan</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No {emptyStateLabel} efforts logged yet. Once this client logs a {emptyStateLabel} swim,
            their personalized plan appears here.
          </p>
        </AnimateRise>
      )}

      {/* ── 4. Per-100m pace chart. Y-axis REVERSED so faster (lower pace)
             reads as the line trending UP. No "lower = better" copy. ── */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">
            Pace per 100{swimUnit === 'yd' ? 'yd' : 'm'} over time
          </p>
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[yDomainMin, yDomainMax]}
                  reversed
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => fmtPaceSecsPer100m(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${fmtPaceSecsPer100m(v)}${paceUnitLabel}`, 'Pace']}
                />
                {cssForChart && (
                  <ReferenceLine y={cssForChart} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
                )}
                <Line
                  type="monotone"
                  dataKey="y"
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

      {/* ── 5. Efforts log (chronological, with per-effort delete) ── */}
      <AnimateRise delay={500}>
        {strokeEfforts.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
            No {emptyStateLabel} entries found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">All entries</h2>
            </div>
            <div className="divide-y divide-border">
              {[...strokeEfforts].reverse().map(e => {
                const detail = e.label.split(' · ').slice(1).join(' · ')
                const paceSecsPerKm = parsePaceToSecs(e.value)
                const rightVal = paceSecsPerKm !== null
                  ? `${fmtPaceSecsPer100m(paceSecsPerKm / 10)}${paceUnitLabel}`
                  : '—'
                return (
                  <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{detail || e.label}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-amber-400">
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId    (string, required) — client's auth user id
//   activity  (string)           — "Swimming" or "Swimming [Stroke]". Either way
//                                   ALL stroke efforts are fetched + grouped.
//   onBack    (fn)               — optional custom back handler. Defaults to
//                                   returning to the client's detail page.
//
// Self-contained: fetches all four stroke variants' efforts (+ legacy bare
// "Swimming · ...") in one query AND the client's profile.swim_unit.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioSwimmingDetail({ userId, activity, onBack }) {
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [swimUnit, setSwimUnit] = useState('m')

  // ── Load all swim efforts (across strokes + legacy) + profile.swim_unit ──────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [efRes, profRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'cardio')
          .or([
            'label.ilike.Swimming [Freestyle] ·%',
            'label.ilike.Swimming [Backstroke] ·%',
            'label.ilike.Swimming [Breaststroke] ·%',
            'label.ilike.Swimming [Butterfly] ·%',
            'label.ilike.Swimming ·%',
          ].join(','))
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('swim_unit')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setEfforts(efRes.data || [])
      setSwimUnit(profRes.data?.swim_unit === 'yd' ? 'yd' : 'm')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEfforts(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  // ── Group efforts by stroke ──────────────────────────────────────────────────
  const effortsByStroke = useMemo(() => {
    const map = { freestyle: [], backstroke: [], breaststroke: [], butterfly: [] }
    efforts.forEach(e => { map[parseSwimStroke(e.label)].push(e) })
    return map
  }, [efforts])

  // Only render strokes the client has actually logged; if none, fall back to
  // the full stroke order so the page still shows discoverability empty-states.
  const strokeOrder = useMemo(() => {
    const filtered = SWIM_STROKE_ORDER.filter(s => effortsByStroke[s].length > 0)
    return filtered.length > 0 ? filtered : SWIM_STROKE_ORDER
  }, [effortsByStroke])

  // Default active stroke. Precedence:
  //   1. If `activity` is a bracketed "Swimming [Stroke]" name AND that stroke
  //      has logged efforts → land on it (deep-link from a stroke-specific route).
  //   2. Else the MOST-RECENTLY-LOGGED stroke.
  //   3. Else Freestyle.
  // The selector lets the coach switch freely afterward.
  const preferredStroke = useMemo(() => {
    const fromRoute = strokeFromActivity(activity)
    if (fromRoute && effortsByStroke[fromRoute]?.length > 0) return fromRoute
    if (efforts.length === 0) return 'freestyle'
    // efforts are sorted ascending; last entry is the most recent overall.
    return parseSwimStroke(efforts[efforts.length - 1].label)
  }, [activity, efforts, effortsByStroke])

  const [activeStroke, setActiveStroke] = useState(null)

  // Resolve the active stroke without a prop→state sync warning: when the
  // active stroke is unset or no longer present in strokeOrder, fall back to
  // the preferred stroke (if present) else slot 0.
  const resolvedStroke = (activeStroke && strokeOrder.includes(activeStroke))
    ? activeStroke
    : (strokeOrder.includes(preferredStroke) ? preferredStroke : strokeOrder[0])

  // Active stroke's CSS for the header subtitle.
  const activeStrokeCSS = useMemo(
    () => riegelProjectCSS(effortsByStroke[resolvedStroke] || []),
    [effortsByStroke, resolvedStroke],
  )
  const hasActiveCSS = activeStrokeCSS !== null && activeStrokeCSS > 0
  const paceUnitLabel = swimPaceUnitLabel(swimUnit)

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
        <h1 className="text-xl font-bold tracking-tight">{SWIMMING_BASE_NAME}</h1>
        {hasActiveCSS ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber
              value={`${fmtPaceSecsPer100m(activeStrokeCSS)}${paceUnitLabel}`}
              className="font-mono font-semibold text-amber-400"
            />
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            No {SWIM_STROKE_LABELS[resolvedStroke].full.toLowerCase()} efforts logged yet
          </p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
          SWIMMING
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Stroke selector — clickable tabs (web replaces the mobile
                 pill-swipe carousel). ── */}
          <div className="flex flex-wrap gap-1.5">
            {strokeOrder.map(stroke => {
              const isActive = resolvedStroke === stroke
              const count = effortsByStroke[stroke].length
              return (
                <button
                  key={stroke}
                  onClick={() => setActiveStroke(stroke)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                      : 'border-border bg-card/40 text-muted-foreground hover:border-amber-500/40'
                  }`}
                >
                  {SWIM_STROKE_LABELS[stroke].full}
                  {count > 0 && (
                    <span className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-amber-400/70' : 'text-muted-foreground/60'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── 3-5. Active stroke's body (plan + chart + log). `key` forces a
                 clean remount on stroke change so all internal selection /
                 info-panel state resets per stroke. ── */}
          <SwimStrokeBody
            key={resolvedStroke}
            strokeEfforts={effortsByStroke[resolvedStroke] || []}
            swimUnit={swimUnit}
            onDelete={deleteEntry}
            emptyStateLabel={SWIM_STROKE_LABELS[resolvedStroke].full.toLowerCase()}
          />
        </>
      )}
    </div>
  )
}
