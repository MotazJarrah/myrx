/**
 * AdminStrengthCarryDetail — READ-ONLY (+ delete) coach mirror of the athlete's
 * loaded-CARRY strength detail screen, INCLUDING the Sled Work consolidated
 * (PUSH / PULL) case.
 *
 * Covers:
 *   - Any movement whose `movements.equipment === 'carry'`
 *     (Farmer's Carry, Yoke Carry, Atlas Stone Bear Hug Carry, Husafell Stone
 *      Carry, Keg / Sandbag / Shield carries, Kettlebell / Single-Arm variants,
 *      Sled Work [Push] / [Drag] as standalone movements, …).
 *   - The CONSOLIDATED `exercise === 'Sled Work'` route, which has NO movement
 *     row under the base name — the real rows are `Sled Work [Push]` and
 *     `Sled Work [Drag]`. This component renders a PUSH | PULL toggle that
 *     filters efforts to the active variant and renders the carry surface for
 *     that variant (mirrors mobile `SledWorkConsolidatedDetail`).
 *
 * Faithfully reproduces the athlete surfaces defined in:
 *   - CLAUDE.md → "Carry detail card — locked design spec"
 *   - mobile/app/(app)/effort/strength/[exercise].tsx
 *       → CarryDetail               (~line 2381)
 *       → SledWorkConsolidatedDetail (~line 3320)
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header        — movement name + "Best — N <wUnit> · M <dUnit> · TIER"
 *                      (TickerNumber on both numbers) + CARRY category pill
 *                      + tier badge. For Sled Work: a PUSH | PULL toggle row.
 *   2. Bodyweight    — ratio-mode movements need a fresh (≤30-day) bodyweight;
 *      gate           missing → CTA card replaces the zone + hero. abs-mode
 *                      (stones / kegs / sandbag / shield) skip the gate.
 *   3. Zone card     — adaptation-zone pill row (MAX LOAD / DISTANCE BUILD /
 *                      CONDITIONING, click to switch) + dual-axis hero card
 *                      (two stacked targets: weight target + distance target,
 *                      each a TickerNumber, with delta strings vs. best) +
 *                      tappable zone info pill (whyText) + cue line.
 *   4. Charts        — two stacked Recharts line charts (weight + distance over
 *                      time) each with its own personal-best reference line.
 *   5. Efforts log   — chronological list (weight × distance rows), with
 *                      per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach is
 * allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why the math is re-implemented inline:
 * web/src/lib/formulas.js doesn't carry any carry-specific helpers
 * (CARRY_BENCHMARKS, CARRY_WEIGHT_LADDERS, tier classification, zone math).
 * Rather than mutate the frozen web lib, every needed piece is reproduced here
 * verbatim from mobile/app/(app)/effort/strength/[exercise].tsx so the tiers,
 * zones, ladders, and deltas match the athlete exactly.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Carry tier benchmarks (verbatim mirror of mobile CARRY_BENCHMARKS) ────────
// Tuple format: [minRatio_or_minKg, minDist_m]
//   mode 'ratio' → first element is weight / bodyweight (per hand / implement)
//   mode 'abs'   → first element is absolute weight in kg
// Unrecognized movements fall back to Farmer's Carry ratio thresholds.
const CARRY_BENCHMARKS = Object.freeze({
  "Farmer's Carry":              { mode: 'ratio', tiers: { beginner: [0.50, 15], intermediate: [1.00, 15], advanced: [1.50, 15], strongman: [2.00, 15] } },
  "Kettlebell Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.40, 15], intermediate: [0.75, 15], advanced: [1.25, 15], strongman: [1.75, 15] } },
  "Single Arm Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Suitcase Carry":             { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Yoke Carry":                 { mode: 'ratio', tiers: { beginner: [1.00,  7], intermediate: [1.50,  7], advanced: [2.00,  7], strongman: [2.50,  7] } },
  "Kettlebell Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.15, 15], intermediate: [0.25, 15], advanced: [0.40, 15], strongman: [0.50, 15] } },
  "Single Arm Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.10, 15], intermediate: [0.20, 15], advanced: [0.30, 15], strongman: [0.40, 15] } },
  "Atlas Stone Bear Hug Carry": { mode: 'abs',   tiers: { beginner: [40, 10],   intermediate: [70, 10],   advanced: [110, 10],  strongman: [140, 10] } },
  "D-Ball Bear Hug Carry":      { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [60, 10],   advanced: [ 90, 10],  strongman: [120, 10] } },
  "Husafell Stone Carry":       { mode: 'abs',   tiers: { beginner: [50, 10],   intermediate: [80, 10],   advanced: [120, 10],  strongman: [150, 10] } },
  "Keg Carry":                  { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [60, 10],   advanced: [100, 10],  strongman: [130, 10] } },
  "Sandbag Carry":              { mode: 'abs',   tiers: { beginner: [25, 10],   intermediate: [50, 10],   advanced: [ 80, 10],  strongman: [110, 10] } },
  "Shield Carry":               { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [50, 10],   advanced: [ 75, 10],  strongman: [100, 10] } },
  "Sled Work [Push]":           { mode: 'ratio', tiers: { beginner: [1.00, 15], intermediate: [1.50, 15], advanced: [2.00, 15], strongman: [2.50, 15] } },
  "Sled Work [Drag]":           { mode: 'ratio', tiers: { beginner: [0.75, 15], intermediate: [1.25, 15], advanced: [1.75, 15], strongman: [2.25, 15] } },
})

const CARRY_TIER_ORDER  = ['beginner', 'intermediate', 'advanced', 'strongman']
const CARRY_TIER_LABELS = { beginner: 'BEGINNER', intermediate: 'INTERMEDIATE', advanced: 'ADVANCED', strongman: 'STRONGMAN' }
const CARRY_TIER_RANK   = { beginner: 1, intermediate: 2, advanced: 3, strongman: 4 }

// ── Carry adaptation zones (verbatim mirror of mobile CARRY_ZONES) ────────────
const CARRY_ZONES = Object.freeze({
  max_load:       { label: 'MAX LOAD',       whyText: 'Heavier weight, same distance. Trains absolute strength and grip endurance under load.' },
  distance_build: { label: 'DISTANCE BUILD', whyText: 'Same weight, longer distance. Trains sustained postural control and grip stamina.' },
  conditioning:   { label: 'CONDITIONING',   whyText: 'Lighter weight, longer distance. Trains aerobic capacity and grip endurance under fatigue.' },
})
const CARRY_ZONE_ORDER = ['max_load', 'distance_build', 'conditioning']

// ── Per-movement weight ladders (verbatim mirror of mobile CARRY_WEIGHT_LADDERS) ─
// When present, the zone-math snap rounds to a valid ladder rung instead of a
// generic 2.5 kg / 5 lb increment, so displayed targets correspond to weights
// the user can actually find at a gym. Movements NOT in this map fall back to
// the generic increment snap.
const CARRY_WEIGHT_LADDERS = {
  'Atlas Stone Bear Hug Carry': { kg: [60, 80, 100, 120, 140, 160, 180, 200] },
  'D-Ball Bear Hug Carry':      { kg: [30, 40, 50, 60, 70, 80, 90, 100] },
  'Husafell Stone Carry':       { kg: [100, 120, 140, 160, 180, 200] },
  'Keg Carry':                  { kg: [40, 60, 80, 100, 120] },
  'Shield Carry':               { kg: [30, 40, 50, 60, 75, 100] },
  'Yoke Carry':                 { kg: [100, 140, 180, 220, 260, 300, 340] },
  'Sandbag Carry': {
    kg: [25, 35, 50, 65, 80, 100, 125],
    lb: [50, 75, 100, 125, 150, 175, 200, 250],
  },
  "Kettlebell Farmer's Carry": {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  'Kettlebell Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  'Single Arm Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
}

function carryBenchmarkFor(movementName) {
  return CARRY_BENCHMARKS[movementName] ?? CARRY_BENCHMARKS["Farmer's Carry"]
}

function carryLadderFor(movementName, unit) {
  const entry = CARRY_WEIGHT_LADDERS[movementName]
  if (!entry) return null
  return entry[unit] ?? null
}

// Snap DOWN to the nearest ladder rung ≤ value. Below the lowest rung → lowest.
function snapDownToLadder(value, ladder) {
  if (!ladder.length) return value
  let best = ladder[0]
  for (const rung of ladder) {
    if (rung <= value) best = rung
    else break
  }
  return best
}

// Smallest ladder rung > value, or null if value ≥ largest rung.
function nextLadderAbove(value, ladder) {
  for (const rung of ladder) {
    if (rung > value) return rung
  }
  return null
}

function snapDownToInc(value, inc) {
  return Math.floor(value / inc) * inc
}

// Highest tier the user qualifies for given parsed efforts + bodyweight.
// Returns null when nothing qualifies (ratio mode w/o bodyweight, or no effort
// long/heavy enough for beginner). Ratio normalises to LB; abs normalises to KG.
function computeCarryTier(movementName, efforts, bodyweightLb) {
  const cfg = carryBenchmarkFor(movementName)
  for (const tier of [...CARRY_TIER_ORDER].reverse()) {
    const [threshold, minDistM] = cfg.tiers[tier]
    const qualifies = efforts.some(e => {
      if (e.distM < minDistM) return false
      if (cfg.mode === 'ratio') {
        if (!bodyweightLb || bodyweightLb <= 0) return false
        const weightLb = e.unit === 'kg' ? e.weight / 0.453592 : e.weight
        return (weightLb / bodyweightLb) >= threshold
      }
      const weightKg = e.unit === 'lb' ? e.weight * 0.453592 : e.weight
      return weightKg >= threshold
    })
    if (qualifies) return tier
  }
  return null
}

// ── Effort label parser (verbatim mirror of mobile parseCarryFromLabel) ───────
// Distance is ALWAYS stored in meters in the label; we convert at render time.
//   "Farmer's Carry · 100 kg × 50 m"           → { weight: 100, unit: 'kg', dist: 50 }
//   "Sled Work [Push] · 200 lb × 20 m in ..."  → { weight: 200, unit: 'lb', dist: 20 }
function parseCarryFromLabel(label) {
  const weightM = label?.match(/·\s*([\d.]+)\s*(\w+)\s*×/)
  const distM   = label?.match(/×\s*([\d.]+)\s*m/)
  if (!weightM || !distM) return null
  return { weight: parseFloat(weightM[1]), unit: weightM[2], dist: parseFloat(distM[1]) }
}

// ── Misc helpers ──────────────────────────────────────────────────────────────
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

const KG_PER_LB = 0.453592
const M_PER_FT  = 0.3048

// The cue verb. "Carry" reads right for most carries; sled work is Push / Drag.
function carryVerbFor(exercise) {
  if (exercise === 'Sled Work [Push]') return 'Push'
  if (exercise === 'Sled Work [Drag]') return 'Drag'
  return 'Carry'
}

// Reusable single-axis line chart (weight OR distance over time). The athlete's
// mobile LineChart is single-axis too, so two stacked charts keep parity with
// the web's dual-axis intent without adding chart deps. Module-scoped so it's a
// stable component identity across renders (react-hooks/static-components).
function MiniChart({ data, label, best, unit, stroke }) {
  const values = data.map(d => d.value)
  const minV = values.length ? Math.min(...values) : 0
  const maxV = values.length ? Math.max(...values) : 10
  const pad  = (maxV - minV) * 0.15 || 1
  return (
    <>
      <div className="mb-2 mt-3 first:mt-0">
        <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
          {label}
        </span>
      </div>
      {data.length >= 2 ? (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[Math.max(0, Math.round(minV - pad)), Math.round(maxV + pad)]}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              tickCount={4}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => [`${v} ${unit}`, label]}
            />
            {best > 0 && (
              <ReferenceLine y={best} stroke={stroke} strokeDasharray="4 3" strokeOpacity={0.5} />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              dot={{ r: 3, fill: stroke, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-in-out"
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="py-5 text-center text-xs text-muted-foreground">
          Not enough data to show a trend yet.
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Dashed line = personal best {label.toLowerCase()}</p>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CarrySurface — the actual per-movement carry detail body. Both the standalone
// path (Farmer's Carry, Atlas Stone, …) and each Sled Work variant slot render
// this. It self-fetches the client's bodyweight (ratio mode) and the movement's
// unit_lock; efforts + profile unit are passed in from the page wrapper.
//
// Props:
//   exercise        (string) — the benchmark/label key, e.g. "Atlas Stone Bear
//                              Hug Carry" or "Sled Work [Push]".
//   displayName     (string) — h1 override (Sled Work uses "Sled Work").
//   efforts         (array)  — already-filtered efforts for THIS variant.
//   profileWeightU  ('lb'|'kg') — client's profile weight unit.
//   unitLock        ('lb'|'kg'|null) — movements.unit_lock for this movement.
//   userId          (string) — client auth id (for the bodyweight fetch).
//   onDelete        (fn)     — delete one effort by id.
//   hideHeader      (bool)   — skip the header (Sled wrapper draws its own).
// ─────────────────────────────────────────────────────────────────────────────
function CarrySurface({
  exercise, displayName, efforts, profileWeightU, unitLock, userId, onDelete, hideHeader,
}) {
  // Display units: unit_lock wins, else profile preference.
  const displayUnit = (unitLock === 'kg' || unitLock === 'lb')
    ? unitLock
    : (profileWeightU === 'kg' ? 'kg' : 'lb')
  // Distance display: meters for kg users, feet for lb users (matches athlete).
  const distUnit = displayUnit === 'kg' ? 'm' : 'ft'

  const cfg     = carryBenchmarkFor(exercise)
  const isRatio = cfg.mode === 'ratio'

  const wInc = displayUnit === 'kg' ? 2.5 : 5
  const dInc = distUnit === 'm' ? 5 : 10

  const [selZone, setSelZone]           = useState('max_load')
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  // ── Bodyweight gate (ratio mode only) ───────────────────────────────────────
  const [bwInfo, setBwInfo]     = useState(null)   // { bwKg, isStale } | null
  const [bwLoaded, setBwLoaded] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function loadBw() {
      const { data } = await supabase
        .from('bodyweight')
        .select('weight, unit, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      const row = data?.[0]
      const THIRTY_DAYS_MS = 30 * 86_400_000
      if (row && (Date.now() - new Date(row.created_at).getTime()) < THIRTY_DAYS_MS) {
        const rowKg = row.unit === 'lb' ? row.weight * KG_PER_LB : row.weight
        setBwInfo({ bwKg: rowKg, isStale: false })
      } else {
        // profiles fallback (treated as stale — fails the freshness gate)
        const { data: prof } = await supabase
          .from('profiles')
          .select('current_weight, weight_unit')
          .eq('id', userId)
          .maybeSingle()
        if (cancelled) return
        if (prof?.current_weight != null) {
          const pUnit = prof.weight_unit === 'kg' ? 'kg' : 'lb'
          const pKg   = pUnit === 'lb' ? prof.current_weight * KG_PER_LB : prof.current_weight
          setBwInfo({ bwKg: pKg, isStale: true })
        } else {
          setBwInfo(null)
        }
      }
      setBwLoaded(true)
    }
    loadBw()
    return () => { cancelled = true }
  }, [userId])

  const bwForMath = bwInfo && !bwInfo.isStale ? bwInfo : null
  const bwLb = bwForMath ? bwForMath.bwKg / KG_PER_LB : null

  // ── Parse efforts → { ts, weight, unit, distM, id } ─────────────────────────
  const parsed = useMemo(() => efforts
    .map(e => {
      const p = parseCarryFromLabel(e.label)
      return p ? { ts: e.created_at, weight: p.weight, unit: p.unit, distM: p.dist, id: e.id } : null
    })
    .filter(Boolean), [efforts])

  // ── Display converters ──────────────────────────────────────────────────────
  const weightInDisplayUnit = (e) => {
    if (e.unit === displayUnit) return e.weight
    if (e.unit === 'kg' && displayUnit === 'lb') return e.weight / KG_PER_LB
    if (e.unit === 'lb' && displayUnit === 'kg') return e.weight * KG_PER_LB
    return e.weight
  }
  const distInDisplayUnit = (e) => distUnit === 'ft' ? e.distM / M_PER_FT : e.distM

  const wUnit = displayUnit
  const dUnit = distUnit
  const verb  = carryVerbFor(exercise)

  // ── Tier classification ─────────────────────────────────────────────────────
  const currentTier = computeCarryTier(exercise, parsed, isRatio ? bwLb : null)
  void CARRY_TIER_RANK // rank table kept for parity; tier ladder card omitted (see notes)

  // ── PB derivations ──────────────────────────────────────────────────────────
  const bestWeight = parsed.length
    ? Math.round(Math.max(...parsed.map(weightInDisplayUnit)))
    : 0
  const bestDistDisplay = parsed.length
    ? Math.round(Math.max(...parsed.map(distInDisplayUnit)))
    : 0

  // Floor for conditioning weight when no ladder (carry wheel min, see athlete).
  const conditioningFloor = displayUnit === 'kg' ? 5 : 10

  // ── Per-zone math (verbatim mirror of mobile zoneMath) ──────────────────────
  const zoneMath = useMemo(() => {
    const ladder     = carryLadderFor(exercise, displayUnit)
    const hasTargets = bestWeight > 0 && bestDistDisplay > 0
    return CARRY_ZONE_ORDER.reduce((acc, zoneId) => {
      const cfgZone = CARRY_ZONES[zoneId]
      let W_target = 0
      let D_target = 0
      switch (zoneId) {
        case 'max_load':
          W_target = ladder
            ? (nextLadderAbove(bestWeight, ladder) ?? bestWeight)
            : bestWeight + wInc
          D_target = bestDistDisplay
          break
        case 'distance_build':
          W_target = bestWeight
          D_target = bestDistDisplay + dInc
          break
        case 'conditioning':
        default: {
          const W_raw = bestWeight * 0.60
          const W_snapped = ladder
            ? snapDownToLadder(W_raw, ladder)
            : snapDownToInc(W_raw, wInc)
          W_target = ladder ? W_snapped : Math.max(W_snapped, conditioningFloor)
          D_target = bestDistDisplay * 2
          break
        }
      }

      const weightDeltaText = hasTargets
        ? (W_target > bestWeight
            ? `+ ${W_target - bestWeight} ${wUnit}`
            : W_target < bestWeight
              ? `− ${bestWeight - W_target} ${wUnit}`
              : 'same as your best')
        : ''
      const distDeltaText = hasTargets
        ? (D_target > bestDistDisplay
            ? `+ ${D_target - bestDistDisplay} ${dUnit}`
            : 'same as your best')
        : ''

      let cueLine
      if (!hasTargets) {
        cueLine = ''
      } else if (zoneId === 'max_load') {
        cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — focus on grip and posture`
      } else if (zoneId === 'distance_build') {
        cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — maintain posture across the full distance`
      } else {
        cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — control your breathing through the burn`
      }

      acc[zoneId] = { cfgZone, W_target, D_target, weightDeltaText, distDeltaText, hasTargets, cueLine }
      return acc
    }, {})
  }, [exercise, displayUnit, bestWeight, bestDistDisplay, wInc, dInc, conditioningFloor, wUnit, dUnit, verb])

  // ── Gating ──────────────────────────────────────────────────────────────────
  const showZoneAndHero = isRatio ? (bwLoaded && bwForMath != null) : true
  const showBwGate      = isRatio && bwLoaded && !bwForMath
  const cascadeReady    = isRatio ? bwLoaded : true   // gates chart + log (cascade order)

  // ── Zone navigation ─────────────────────────────────────────────────────────
  const zoneIdx   = CARRY_ZONE_ORDER.indexOf(selZone)
  const canGoPrev = zoneIdx > 0
  const canGoNext = zoneIdx >= 0 && zoneIdx < CARRY_ZONE_ORDER.length - 1

  function goToZone(zone) {
    if (!zone || zone === selZone) return
    setSelZone(zone)
    setZoneInfoOpen(false)   // auto-close info panel on zone change (Pattern 5)
  }
  function navigateZone(dir) {
    const next = CARRY_ZONE_ORDER[zoneIdx + dir]
    if (next) goToZone(next)
  }

  const activeZone = zoneMath[selZone]

  // ── Chart data ──────────────────────────────────────────────────────────────
  const weightChartData = useMemo(() => parsed.map(e => ({
    ts: e.ts, date: fmtShort(e.ts), value: Math.round(weightInDisplayUnit(e)),
  })), [parsed, displayUnit]) // eslint-disable-line react-hooks/exhaustive-deps
  const distChartData = useMemo(() => parsed.map(e => ({
    ts: e.ts, date: fmtShort(e.ts), value: Math.round(distInDisplayUnit(e)),
  })), [parsed, distUnit]) // eslint-disable-line react-hooks/exhaustive-deps

  const tierBadge = currentTier ? CARRY_TIER_LABELS[currentTier] : null

  return (
    <div className="space-y-5">
      {/* ── 1. Header (skipped when the Sled wrapper draws its own) ── */}
      {!hideHeader && (
        <div>
          <h1 className="text-xl font-bold tracking-tight">{displayName ?? exercise}</h1>
          {parsed.length === 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
          ) : (
            <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
              <span>Best —</span>
              <TickerNumber value={bestWeight} className="font-mono font-semibold text-blue-400" />
              <span className="text-blue-400">{wUnit}</span>
              <span>·</span>
              <TickerNumber value={bestDistDisplay} className="font-mono font-semibold text-blue-400" />
              <span className="text-blue-400">{dUnit}</span>
            </p>
          )}
          <div className="mt-1.5 flex flex-col items-start gap-1">
            <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
              CARRY
            </span>
            {tierBadge && (
              <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
                {tierBadge}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 2. Bodyweight gate (ratio mode, no fresh log) ── */}
      {showBwGate && (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Recent bodyweight required</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            We need a recent bodyweight to compute this client's strongman tier accurately.
            They need to log their current weight.
          </p>
        </AnimateRise>
      )}

      {/* ── 3. Adaptation zone card + dual-axis hero ── */}
      {showZoneAndHero && (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Adaptation zone</h2>

          {/* Zone pill row — single active pill flanked by chevrons (click nav). */}
          <div className="mt-3 mb-1 flex items-center justify-center gap-3">
            <div className="flex w-14 items-center justify-end">
              {canGoPrev && (
                <button
                  onClick={() => navigateZone(-1)}
                  aria-label="Previous zone"
                  className="text-blue-400/80 hover:text-blue-400 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5 -mr-2" />
                  <ChevronLeft className="h-5 w-5 -mt-5" />
                </button>
              )}
            </div>

            <div className="rounded-full border border-blue-500 bg-blue-500/15 px-4 py-2">
              <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-blue-400">
                {CARRY_ZONES[selZone].label}
              </span>
            </div>

            <div className="flex w-14 items-center">
              {canGoNext && (
                <button
                  onClick={() => navigateZone(1)}
                  aria-label="Next zone"
                  className="text-blue-400/80 hover:text-blue-400 transition-colors"
                >
                  <ChevronRight className="h-5 w-5 -mr-2" />
                  <ChevronRight className="h-5 w-5 -mt-5" />
                </button>
              )}
            </div>
          </div>

          {/* Hero card — dual-axis (weight target + distance target). */}
          {activeZone && (
            <div
              className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] p-4"
              style={{ minHeight: 220 }}
            >
              {/* Tappable zone info pill (right-aligned). */}
              <div className="flex justify-end">
                <button
                  onClick={() => setZoneInfoOpen(o => !o)}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5"
                >
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-blue-400">
                    {activeZone.cfgZone.label}
                  </span>
                  <Info className="h-3 w-3 text-blue-400" />
                </button>
              </div>

              {/* Inline "why this zone" info panel. */}
              {zoneInfoOpen && (
                <div className="mt-1 rounded-md border border-blue-500/15 bg-card/60 px-2.5 py-2">
                  <p className="mb-1 text-xs font-bold text-foreground">{activeZone.cfgZone.label}</p>
                  <p className="text-[11px] leading-4 text-muted-foreground">{activeZone.cfgZone.whyText}</p>
                </div>
              )}

              {/* Two stacked targets. */}
              {activeZone.hasTargets ? (
                <div className="mt-1 flex flex-col gap-3">
                  {/* Weight row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-1">
                      <TickerNumber value={activeZone.W_target} className="font-mono text-3xl font-bold text-blue-400" />
                      <span className="text-blue-400">{wUnit}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{activeZone.weightDeltaText}</span>
                  </div>
                  {/* Distance row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-1">
                      <TickerNumber value={activeZone.D_target} className="font-mono text-3xl font-bold text-blue-400" />
                      <span className="text-blue-400">{dUnit}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{activeZone.distDeltaText}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No qualifying efforts in this zone yet.</p>
              )}

              {/* Thin separator + cue line (the prescription). */}
              {activeZone.cueLine && (
                <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                  <p className="text-sm text-foreground">{activeZone.cueLine}</p>
                </div>
              )}
            </div>
          )}
        </AnimateRise>
      )}

      {/* ── 4. Charts (weight + distance over time) ── */}
      {cascadeReady && parsed.length >= 1 && (
        <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Carry progress over time</h2>
          <MiniChart data={weightChartData} label="Weight"   best={bestWeight}      unit={wUnit} stroke="#60a5fa" />
          <MiniChart data={distChartData}   label="Distance" best={bestDistDisplay} unit={dUnit} stroke="#93c5fd" />
        </AnimateRise>
      )}

      {/* ── 5. Efforts log (chronological, with per-effort delete) ── */}
      {cascadeReady && (
        <AnimateRise delay={500}>
          {efforts.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No efforts found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="divide-y divide-border">
                {[...efforts].reverse().map(e => {
                  const p = parseCarryFromLabel(e.label)
                  const dDisplay = p
                    ? Math.round(distUnit === 'ft' ? p.dist / M_PER_FT : p.dist)
                    : null
                  const head = e.label.split(' · ')[0] ?? ''
                  let subLabel = 'carry'
                  if (head === 'Sled Work [Push]') subLabel = 'push'
                  else if (head === 'Sled Work [Drag]') subLabel = 'drag'
                  return (
                    <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {p ? `${p.weight} ${p.unit} × ${dDisplay} ${dUnit}` : (e.label || '—')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{subLabel}</span>
                          {p && (
                            <span className="font-mono text-xs font-semibold tabular-nums text-blue-400">
                              {p.weight} {p.unit}
                            </span>
                          )}
                        </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Sled Work consolidated header subtitle — re-derives the active variant's best
// weight × distance so the subtitle ticker-updates as the coach toggles
// PUSH / PULL. Mirrors the athlete's page-level header (which is static during
// the swipe but recomputes per active variant).
// ─────────────────────────────────────────────────────────────────────────────
function sledBestFor(variantEfforts, displayUnit, distUnit) {
  const list = variantEfforts.map(e => {
    const p = parseCarryFromLabel(e.label)
    if (!p) return null
    let w = p.weight
    if (p.unit === 'kg' && displayUnit === 'lb') w = p.weight / KG_PER_LB
    else if (p.unit === 'lb' && displayUnit === 'kg') w = p.weight * KG_PER_LB
    const d = distUnit === 'ft' ? p.dist / M_PER_FT : p.dist
    return { w, d }
  }).filter(Boolean)
  return {
    bestWeight: list.length ? Math.round(Math.max(...list.map(p => p.w))) : 0,
    bestDist:   list.length ? Math.round(Math.max(...list.map(p => p.d))) : 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminStrengthCarryDetail — page-level component.
//
// Handles BOTH:
//   - a normal carry movement (exercise === movement name, equipment carry)
//   - the consolidated Sled Work route (exercise === 'Sled Work', NO movement
//     row under the base name; real rows are 'Sled Work [Push]' / [Drag]).
//
// Self-fetches efforts + profile unit (+ movement row for unit_lock on the
// standalone path). The Sled path fetches BOTH variants via an or() query, just
// like the athlete page, and renders a PUSH | PULL toggle.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthCarryDetail({ userId, exercise, onBack }) {
  const isSledConsolidated = exercise === 'Sled Work'

  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [profileUnit, setProfileUnit] = useState('lb')
  const [unitLock, setUnitLock]   = useState(null)   // standalone path only

  // Sled toggle state. `null` = no explicit pick yet → fall back to slot 0 of
  // the logged list (derived below). Kept as the coach's explicit choice so we
  // don't need a set-state-in-effect to initialise or to snap after a delete.
  const [pickedVariant, setPickedVariant] = useState(null) // 'push' | 'drag' | null

  // ── Load efforts + profile unit (+ movement row for non-Sled) ───────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      const effortQuery = supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', 'strength')
        .order('created_at', { ascending: true })

      // Sled Work consolidated: pull BOTH variants in one or() query (mirrors
      // the athlete page). Otherwise an exact-movement ilike.
      const filtered = isSledConsolidated
        ? effortQuery.or([
            'label.ilike.Sled Work [Push] ·%',
            'label.ilike.Sled Work [Drag] ·%',
          ].join(','))
        : effortQuery.ilike('label', `${exercise} · %`)

      const queries = [
        filtered,
        supabase.from('profiles').select('weight_unit').eq('id', userId).maybeSingle(),
      ]
      // Only the standalone path has a real movement row to read unit_lock from.
      if (!isSledConsolidated) {
        queries.push(
          supabase.from('movements').select('unit_lock').eq('name', exercise).maybeSingle()
        )
      }

      const [efRes, profRes, movRes] = await Promise.all(queries)
      if (cancelled) return

      setEntries(efRes.data || [])
      setProfileUnit(profRes.data?.weight_unit || 'lb')
      if (!isSledConsolidated) setUnitLock(movRes?.data?.unit_lock ?? null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, exercise, isSledConsolidated])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Sled variant bookkeeping ────────────────────────────────────────────────
  const variantOf = (label) => {
    const head = label.split(' · ')[0]
    if (head === 'Sled Work [Push]') return 'push'
    if (head === 'Sled Work [Drag]') return 'drag'
    return null
  }
  const effortsByVariant = useMemo(() => {
    const map = { push: [], drag: [] }
    if (!isSledConsolidated) return map
    entries.forEach(e => {
      const v = variantOf(e.label)
      if (v) map[v].push(e)
    })
    return map
  }, [entries, isSledConsolidated])

  // Variants the client has actually logged (preserve push→drag order).
  const sledVariantOrder = useMemo(
    () => ['push', 'drag'].filter(v => effortsByVariant[v].length > 0),
    [effortsByVariant]
  )

  // Effective active variant — DERIVED (no effect, so no cascading set-state):
  //   - the coach's explicit pick if it's still in the logged set, else
  //   - slot 0 of the logged list (the default-landing rule from Pattern 4), else
  //   - 'push' as a final fallback (empty edge case).
  // This auto-snaps to a surviving variant when the picked one loses its last
  // effort after a delete, without writing state inside an effect.
  const activeVariant =
    (pickedVariant && sledVariantOrder.includes(pickedVariant))
      ? pickedVariant
      : (sledVariantOrder[0] ?? 'push')

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : isSledConsolidated ? (
        <SledConsolidatedView
          userId={userId}
          effortsByVariant={effortsByVariant}
          sledVariantOrder={sledVariantOrder}
          activeVariant={activeVariant}
          setActiveVariant={setPickedVariant}
          profileWeightU={profileUnit}
          onDelete={deleteEntry}
        />
      ) : (
        <CarrySurface
          exercise={exercise}
          efforts={entries}
          profileWeightU={profileUnit}
          unitLock={unitLock}
          userId={userId}
          onDelete={deleteEntry}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SledConsolidatedView — PUSH | PULL toggle + variant-filtered CarrySurface.
// Sled Work is ratio-mode but NOT unit-locked, so both variants follow the
// client's profile weight unit; distance follows the same lb→ft / kg→m rule.
// ─────────────────────────────────────────────────────────────────────────────
function SledConsolidatedView({
  userId, effortsByVariant, sledVariantOrder, activeVariant, setActiveVariant,
  profileWeightU, onDelete,
}) {
  const displayUnit = profileWeightU === 'kg' ? 'kg' : 'lb'
  const distUnit    = displayUnit === 'kg' ? 'm' : 'ft'

  const variantEfforts = effortsByVariant[activeVariant] ?? []
  const { bestWeight, bestDist } = sledBestFor(variantEfforts, displayUnit, distUnit)
  const hasBest = bestWeight > 0 && bestDist > 0

  // Which variants exist for the toggle. If neither has efforts (edge case),
  // still show both pills so the coach can see the empty state per side.
  const toggleVariants = sledVariantOrder.length > 0 ? sledVariantOrder : ['push', 'drag']

  return (
    <>
      {/* Page-level header (mirrors athlete SledWorkConsolidatedDetail). */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Sled Work</h1>
        {hasBest ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber value={bestWeight} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">{displayUnit}</span>
            <span>·</span>
            <TickerNumber value={bestDist} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">{distUnit}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            No {activeVariant === 'push' ? 'push' : 'drag'} efforts logged yet
          </p>
        )}
        <div className="mt-1.5">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            CARRY
          </span>
        </div>

        {/* PUSH | PULL toggle. */}
        <div className="mt-3 inline-flex rounded-full border border-border bg-card p-0.5">
          {toggleVariants.map(v => {
            const isActive = v === activeVariant
            return (
              <button
                key={v}
                onClick={() => setActiveVariant(v)}
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                  isActive
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v === 'push' ? 'PUSH' : 'DRAG'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Variant body. key={activeVariant} forces a clean remount on toggle
          (mirrors the athlete's per-variant key) so the inner zone selection,
          bodyweight gate, and info panel reset cleanly between PUSH and DRAG. */}
      <CarrySurface
        key={activeVariant}
        exercise={`Sled Work [${activeVariant === 'push' ? 'Push' : 'Drag'}]`}
        displayName="Sled Work"
        efforts={variantEfforts}
        profileWeightU={profileWeightU}
        unitLock={null}
        userId={userId}
        onDelete={onDelete}
        hideHeader
      />
    </>
  )
}
