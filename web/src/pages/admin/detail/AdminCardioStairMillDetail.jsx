/**
 * AdminCardioStairMillDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's StairMill cardio detail screen.
 *
 * Fires for the single activity `StairMill` (movements.cardio_mode = 'duration',
 * but StairMill short-circuits the generic duration route into its own
 * coaching surface). Progression is anchored on FLOORS PER MINUTE (FPM) —
 * floors ÷ minutes — across three science-backed adaptation zones
 * (ENDURANCE / THRESHOLD / VO2 MAX), arranged by Seiler's polarized model.
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - mobile/app/(app)/effort/cardio/[activity].tsx → function StairMillDetail
 *     (+ STAIRMILL_ZONE_CONFIG / buildStairMillZoneRx / getStairMillZoneCue /
 *      classifyStairMillEffortZone / daysSinceLastStairMillEffortInZone /
 *      generateStairMillPlanQueue)
 *   - mobile/src/lib/movements.ts (parseStairMillLabel /
 *     floorsPerMinFromEffort / genderBaselineFloorsPerMin / isStairMillActivity)
 *
 * The MOBILE CODE IS THE SOLE SOURCE OF TRUTH for this surface — the athlete
 * uses the SAME plan-queue tile model that running's PaceDetail does (NOT the
 * earlier zone-pill / 4-row-hero design). Mirrors:
 *
 * Sections, top to bottom (matching the athlete + AdminCardioPaceDetail):
 *   1. Header        — "StairMill" + "Best — N floors/min" (TickerNumber) +
 *                      STAIR CLIMBING category pill (or cold-start subtitle)
 *   2. Progression   — help text, then a horizontal 8-tile queue from
 *      plan card       generateStairMillPlanQueue (the tile row IS the
 *                      navigation), then the selected-step HERO below it
 *                      (zone info pill + workout / time / climb-rate rows +
 *                      full coaching cue). The hero shows the SELECTED tile's
 *                      prescription. Default selection = step 0 (the next
 *                      system-recommended session per Seiler's rules).
 *   3. Chart         — Recharts FPM-over-time line, NOT reversed (higher =
 *                      better progress = line trends up), peak-FPM dashed ref.
 *   4. Efforts log   — chronological list, per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * AMBER accent end-to-end (cardio theme), NOT blue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the FPM + zone + plan-queue math is re-implemented inline:
 * web/src/lib/movements.js does NOT export the StairMill helpers
 * (parseStairMillLabel / floorsPerMinFromEffort / genderBaselineFloorsPerMin)
 * or the zone config + queue generator (STAIRMILL_ZONE_CONFIG /
 * buildStairMillZoneRx / getStairMillZoneCue / generateStairMillPlanQueue) —
 * those all live mobile-side. Rather than mutate the frozen web lib, every
 * needed piece is reproduced here verbatim from mobile so the projections
 * match the athlete exactly.
 *
 * Web substitutions for mobile-only primitives:
 *   - Skia/Reanimated tile row → plain horizontal-scroll tile row +
 *     click-to-select (no physical pill slide). Mirrors AdminCardioPaceDetail.
 *   - LineChart (react-native-svg) → Recharts (matching AdminCardioPaceDetail).
 *   - DeleteAction (gesture-handler swipe) → SwipeDelete (web).
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import CueText from '../../../components/CueText'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Time helper (mirror of mobile fmtSecs) ────────────────────────────────────
function fmtSecs(totalSecs) {
  if (totalSecs == null) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── StairMill label parsing (verbatim mirror of mobile parseStairMillLabel) ───
// New format:    "StairMill · 245 floors in 20:00"
// Legacy format: "StairMill · 20:00"  (floors defaults to 0)
function parseStairMillLabel(label) {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  const m1 = part.match(/^(\d+)\s*floors?\s+in\s+(\d+:\d{2}(?::\d{2})?)$/)
  if (m1) {
    const floors = parseInt(m1[1], 10)
    const timeParts = m1[2].split(':').map(Number)
    let timeSecs = null
    if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
    else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
    return { floors, timeSecs }
  }
  const m2 = part.match(/^(\d+:\d{2}(?::\d{2})?)$/)
  if (m2) {
    const timeParts = m2[1].split(':').map(Number)
    let timeSecs = null
    if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
    else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
    return { floors: 0, timeSecs }
  }
  return null
}

// Floors-per-minute rate from (floors, timeSecs). 0 for invalid (mirror).
function floorsPerMinFromEffort(floors, timeSecs) {
  if (!floors || !timeSecs || timeSecs <= 0) return 0
  return floors / (timeSecs / 60)
}

// Gender-aware cold-start FPM baseline (verbatim mirror of mobile).
//   male → 12 floors/min · else (female / non-binary / unset) → 9 floors/min
function genderBaselineFloorsPerMin(gender) {
  return gender === 'male' ? 12 : 9
}

// ── Zone config (verbatim mirror of mobile STAIRMILL_ZONE_CONFIG) ─────────────
// Hardest-first slot order is VO2 → THRESHOLD → ENDURANCE; the plan-queue
// generator references zones by key, so no explicit ORDER constant is needed
// here (the athlete's STAIRMILL_ZONE_ORDER is only used by its zone-pill
// carousel, which the plan-queue tile model replaced).
const STAIRMILL_ZONE_CONFIG = Object.freeze({
  vo2: {
    label:       'VO2 MAX',
    whyText:
      'Short max-effort sprints at the ceiling of your aerobic capacity. The Allison protocol (2017 Med Sci Sports Exerc) showed 3 × 20-sec all-out stair climbs three times per week produced a 12 % VO2peak improvement in 6 weeks — among the most efficient cardio interventions ever published. Use sparingly: 1 session per week, full recovery between intervals.',
    durationMin: 1.0,    // ~60 sec per rep
    intensity:   1.10,   // 110 % of peak FPM — short reps tolerate above-peak
    reps:        3,
    restSecs:    180,    // 3 min full recovery between sprints
  },
  threshold: {
    label:       'THRESHOLD',
    whyText:
      'Sustained hard intervals at the edge of what you can hold. Trains lactate clearance and the ability to maintain high climbing output past the initial burn. Honda et al. (2014) used 3-min stair-climbing intervals to drive metabolic adaptation; comparable to Pete Pfitzinger\'s cruise interval programming. 1–2 sessions per week max.',
    durationMin: 3.0,    // 3 min per rep — Honda protocol
    intensity:   0.85,   // 85 % of peak FPM — "comfortably hard sustained"
    reps:        4,
    restSecs:    90,
  },
  aerobic: {
    label:       'ENDURANCE',
    whyText:
      'Continuous moderate climbing at conversational effort. Boreham et al. (2000) showed sustained moderate stair climbing produced a 17 % VO2max improvement in 8 weeks in previously sedentary adults — the foundation that supports every higher-intensity zone above it. Stay disciplined and steady; resist the urge to push.',
    durationMin: 20.0,   // 20 min continuous — Boreham protocol
    intensity:   0.65,   // 65 % of peak FPM — Zone 2 conversational
    reps:        1,
    restSecs:    0,
  },
})

/**
 * Build the per-zone prescription from the user's peak FPM. Verbatim mirror
 * of mobile `buildStairMillZoneRx`:
 *   targetFpm    = max(1, peakFpm × intensity)
 *   floorsPerRep = max(1, round(targetFpm × durationMin))
 *   estSecs      = round(durationMin × 60)
 * `shortWork` abbreviates "floors" → "fl" (matches the mobile hero row 1).
 */
function buildStairMillZoneRx(zone, peakFpm) {
  const cfg          = STAIRMILL_ZONE_CONFIG[zone]
  const targetFpm    = Math.max(1, peakFpm * cfg.intensity)
  const floorsPerRep = Math.max(1, Math.round(targetFpm * cfg.durationMin))
  const estimatedSecsPerRep = Math.round(cfg.durationMin * 60)
  return {
    floorsPerRep,
    targetFpm,
    estimatedSecsPerRep,
    reps:     cfg.reps,
    restSecs: cfg.restSecs,
    shortWork: cfg.reps === 1 ? `${floorsPerRep} fl` : `${cfg.reps} × ${floorsPerRep} fl`,
  }
}

/** Full coaching cue line for a zone (verbatim mirror of mobile getStairMillZoneCue). */
function getStairMillZoneCue(zone, rx) {
  const fpm = rx.targetFpm.toFixed(1)
  if (zone === 'aerobic') {
    return `Climb ${rx.floorsPerRep} floors continuously at a steady ${fpm} floors/min, should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
  }
  if (zone === 'threshold') {
    return `Climb ${rx.reps} × ${rx.floorsPerRep} floors at a hard sustained ${fpm} floors/min (~${fmtSecs(rx.estimatedSecsPerRep)} each). Rest ${rx.restSecs} sec between intervals.`
  }
  // vo2
  return `Climb ${rx.reps} × ${rx.floorsPerRep} floors at max effort (~${fmtSecs(rx.estimatedSecsPerRep)} each). Full recovery ${Math.round(rx.restSecs / 60)} min between intervals.`
}

// ── Plan queue — Seiler polarized sequencing (verbatim mirror of mobile) ───────
// classifyStairMillEffortZone / daysSinceLastStairMillEffortInZone /
// generateStairMillPlanQueue reproduced exactly so the queue matches the
// athlete. Same five polarized rules running's queue uses:
//   1. No hard back-to-back
//   2. Don't let VO2 go stale (10+ days)
//   3. Don't let Threshold go stale (7+ days)
//   4. Anti-stagnation interleave after 3 Endurance steps
//   5. Default Endurance (→ ~80/20 polarized split)

function classifyStairMillEffortZone(label, peakFpm) {
  const parsed = parseStairMillLabel(label)
  if (!parsed || !parsed.timeSecs || peakFpm <= 0) return 'aerobic'
  const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
  if (fpm <= 0) return 'aerobic'
  if (fpm >= peakFpm * 1.00) return 'vo2'
  if (fpm >= peakFpm * 0.75) return 'threshold'
  return 'aerobic'
}

function daysSinceLastStairMillEffortInZone(efforts, zone, peakFpm) {
  for (let i = efforts.length - 1; i >= 0; i--) {
    if (classifyStairMillEffortZone(efforts[i].label, peakFpm) === zone) {
      return (Date.now() - new Date(efforts[i].created_at).getTime()) / 86_400_000
    }
  }
  return 999
}

function generateStairMillPlanQueue(efforts, peakFpm, count = 8) {
  if (peakFpm <= 0) return []

  const lastEffort  = efforts[efforts.length - 1]
  const lastZone    = lastEffort ? classifyStairMillEffortZone(lastEffort.label, peakFpm) : null
  const daysSinceT0 = daysSinceLastStairMillEffortInZone(efforts, 'threshold', peakFpm)
  const daysSinceV0 = daysSinceLastStairMillEffortInZone(efforts, 'vo2',       peakFpm)

  const zoneQueue  = []
  let virtualLast  = lastZone
  let virtualDaysT = daysSinceT0
  let virtualDaysV = daysSinceV0
  let endurStreak  = 0
  let lastHard     = null

  for (let i = 0; i < count; i++) {
    let next
    if (virtualLast === 'threshold' || virtualLast === 'vo2') {
      next = 'aerobic'                                        // Rule 1: no hard back-to-back
    } else if (virtualDaysV >= 10) {
      next = 'vo2'                                            // Rule 2: VO2 stale
    } else if (virtualDaysT >= 7) {
      next = 'threshold'                                      // Rule 3: Threshold stale
    } else if (endurStreak >= 3) {
      next = lastHard === 'threshold' ? 'vo2' : 'threshold'   // Rule 4: interleave a hard
    } else {
      next = 'aerobic'                                        // Rule 5: default to Endurance
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
    const rx        = buildStairMillZoneRx(zone, peakFpm)
    const cue       = getStairMillZoneCue(zone, rx)
    const zoneLabel = STAIRMILL_ZONE_CONFIG[zone].label
    return { zone, rx, cue, shortWork: rx.shortWork, zoneLabel }
  })
}

// ── Misc date helpers ──────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId    (string, required) — client's auth user id
//   activity  (string)           — defaults to "StairMill" (the only activity
//                                   this component handles)
//   onBack    (fn)               — optional custom back handler. Defaults to
//                                   returning to the client's detail page.
//
// Self-contained: fetches the client's StairMill efforts + profile.gender
// (gender drives the cold-start FPM baseline shown before any effort exists).
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioStairMillDetail({
  userId,
  activity = 'StairMill',
  onBack,
}) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [gender, setGender]   = useState(null)

  // Progression-plan UI state — same model as AdminCardioPaceDetail:
  //   selectedStepIdx → which queue tile drives the hero (default 0 = next step)
  //   zoneInfoOpen    → inline "why this zone" panel toggle
  const [selectedStepIdx, setSelectedStepIdx] = useState(0)
  const [zoneInfoOpen, setZoneInfoOpen]       = useState(false)

  const tileEls = useRef({})   // step idx → DOM node, for scroll-into-view

  // ── Load efforts + profile gender ────────────────────────────────────────────
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
          .ilike('label', `${activity} ·%`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('gender')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setEntries(efRes.data || [])
      setGender(profRes.data?.gender ?? null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, activity])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  // ── Peak FPM across all efforts (rate anchor) ────────────────────────────────
  const peakFpm = useMemo(() => {
    let peak = 0
    for (const e of entries) {
      const parsed = parseStairMillLabel(e.label)
      if (!parsed || !parsed.timeSecs) continue
      const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
      if (fpm > peak) peak = fpm
    }
    return peak
  }, [entries])

  const baselineFpm   = genderBaselineFloorsPerMin(gender)
  const effectiveRate = peakFpm > 0 ? peakFpm : baselineFpm
  const hasLoggedRate = peakFpm > 0

  // ── Plan queue (Seiler polarized sequencing) — regenerated live per render. ──
  // Mirrors the athlete: tile 0 is the next system-recommended session, and
  // the tile row is the navigation. The hero below shows the SELECTED tile.
  const planQueue = useMemo(
    () => generateStairMillPlanQueue(entries, effectiveRate, 8),
    [entries, effectiveRate],
  )

  // When the queue regenerates (e.g. after a delete), reset the selection to
  // step 0 and close the info panel. Done at RENDER time via React's
  // "adjust state when a prop changes" pattern (store previous value, compare
  // during render, setState during render) — NOT in an effect. Mirrors the
  // identical guard in AdminCardioPaceDetail.
  const queueSig = `${planQueue.length}:${planQueue[0]?.zone ?? ''}`
  const [seenQueueSig, setSeenQueueSig] = useState(queueSig)
  if (seenQueueSig !== queueSig) {
    setSeenQueueSig(queueSig)
    if (selectedStepIdx !== 0) setSelectedStepIdx(0)
    if (zoneInfoOpen) setZoneInfoOpen(false)
  }

  const selectedStep = planQueue[selectedStepIdx] ?? planQueue[0] ?? null
  const selectedRx   = selectedStep?.rx ?? null
  const selectedCfg  = selectedStep ? STAIRMILL_ZONE_CONFIG[selectedStep.zone] : null

  // ── Chart data — FPM over time (NOT reversed: higher = better progress) ──────
  const chartData = useMemo(() => entries
    .map(e => {
      const parsed = parseStairMillLabel(e.label)
      if (!parsed || !parsed.timeSecs) return null
      const fpm = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
      return fpm > 0 ? { ts: e.created_at, date: fmtShort(e.created_at), value: fpm } : null
    })
    .filter(Boolean), [entries])

  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const pad    = (maxV - minV) * 0.15 || 1
  const bestForChart = peakFpm > 0 ? peakFpm : null

  function selectStep(idx) {
    setSelectedStepIdx(idx)
    setZoneInfoOpen(false)
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
        <h1 className="text-xl font-bold tracking-tight">{activity}</h1>
        {hasLoggedRate ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber value={`${effectiveRate.toFixed(1)} floors/min`} className="font-mono font-semibold text-amber-400" />
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            No efforts logged yet · using {baselineFpm} floors/min as a starting estimate
          </p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
          STAIR CLIMBING
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Progression plan card ── */}
          {selectedStep && selectedRx && selectedCfg && (
            <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Your progression plan</h2>

              {/* Tile row with chevrons between each pair, indicating forward
                  direction. The tile row IS both the navigation and the
                  upcoming queue (mobile has no separate "Coming up" section).
                  Selected tile (default: step 0 = the actual NEXT step) is
                  highlighted; tapping any tile drives the hero card below.
                  Each tile shows zone / work / time only (no rest line). */}
              <div className="mt-2 flex items-center gap-1 overflow-x-auto py-1 px-0.5 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                {planQueue.map((step, idx) => {
                  const isSelected = selectedStepIdx === idx
                  const isLast     = idx === planQueue.length - 1
                  return (
                    <div key={idx} className="flex items-center">
                      <button
                        ref={el => { tileEls.current[idx] = el }}
                        onClick={() => selectStep(idx)}
                        className={`flex shrink-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2.5 transition-colors ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/[0.12]'
                            : 'border-border bg-card/40 hover:border-amber-500/40'
                        }`}
                        style={{ minWidth: 110 }}
                      >
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${isSelected ? 'text-amber-400' : 'text-muted-foreground'}`}>
                          {step.zoneLabel}
                        </span>
                        <span className={`whitespace-nowrap font-mono text-sm font-bold tabular-nums ${isSelected ? 'text-amber-400' : 'text-foreground'}`}>
                          {step.shortWork}
                        </span>
                        <span className={`whitespace-nowrap font-mono text-xs tabular-nums ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {fmtSecs(step.rx.estimatedSecsPerRep)}
                        </span>
                      </button>
                      {!isLast && (
                        <span
                          className="px-1 text-amber-400/70 select-none"
                          style={{ transform: 'scaleY(1.3)' }}
                          aria-hidden="true"
                        >
                          ›
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* NEXT STEP hero — driven by the SELECTED tile (default: step 0).
                  3 stacked rows (workout / time / climb rate). Rest lives in
                  the cue line, mirroring the athlete (no separate rest row). */}
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
                      {selectedCfg.label}
                    </span>
                    <Info className="h-3 w-3 text-amber-400" />
                  </button>
                </div>

                {/* Inline "why this zone" info panel (the WHY, not the prescription). */}
                {zoneInfoOpen && (
                  <div className="mt-1 rounded-md border border-amber-500/15 bg-card/60 px-2.5 py-2">
                    <p className="mb-1 text-xs font-bold text-foreground">{selectedCfg.label}</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">{selectedCfg.whyText}</p>
                  </div>
                )}

                {/* Three big rows: value (TickerNumber) on the left, descriptor right. */}
                <div className="mt-2 space-y-3.5">
                  {/* Row 1 — workout shape (floors). */}
                  <div className="flex items-end justify-between gap-3">
                    <TickerNumber value={selectedRx.shortWork} className="font-mono text-3xl font-bold text-amber-400" />
                    <span className="shrink pb-1 text-right text-xs text-muted-foreground">
                      {selectedRx.reps === 1 ? 'total climb' : 'per interval'}
                    </span>
                  </div>
                  {/* Row 2 — estimated time. */}
                  <div className="flex items-end justify-between gap-3">
                    <TickerNumber value={fmtSecs(selectedRx.estimatedSecsPerRep)} className="font-mono text-3xl font-bold text-amber-400" />
                    <span className="shrink pb-1 text-right text-xs text-muted-foreground">
                      {selectedRx.reps === 1 ? 'to complete' : 'per interval'}
                    </span>
                  </div>
                  {/* Row 3 — target FPM (climb rate). */}
                  <div className="flex items-end justify-between gap-3">
                    <TickerNumber value={`${selectedRx.targetFpm.toFixed(1)} fl/min`} className="font-mono text-3xl font-bold text-amber-400" />
                    <span className="shrink pb-1 text-right text-xs text-muted-foreground">climb rate</span>
                  </div>
                </div>

                {/* Thin separator + full coaching cue. */}
                <div className="mt-2.5 border-t border-amber-500/15 pt-2.5">
                  <CueText className="text-sm text-foreground">{selectedStep.cue}</CueText>
                </div>
              </div>
            </AnimateRise>
          )}

          {/* ── 3. FPM-over-time chart (higher = better, NOT reversed) ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Climb rate over time</p>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[Math.max(0, minV - pad), maxV + pad]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      tickFormatter={(v) => v.toFixed(1)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v.toFixed(1)} floors/min`, 'Climb rate']}
                    />
                    {bestForChart && (
                      <ReferenceLine y={bestForChart} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
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
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed = peak climb rate</p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log (chronological, with per-effort delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No efforts found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">All entries</h2>
              </div>
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const p   = parseStairMillLabel(e.label)
                  const fpm = p && p.timeSecs ? floorsPerMinFromEffort(p.floors, p.timeSecs) : 0
                  const detail = p
                    ? (p.floors > 0
                        ? `${p.floors} floors in ${fmtSecs(p.timeSecs ?? 0)}`
                        : fmtSecs(p.timeSecs ?? 0))
                    : e.label.split(' · ').slice(1).join(' · ')
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{detail || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-amber-400">
                          {fpm > 0 ? `${fpm.toFixed(1)} fl/min` : '—'}
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
