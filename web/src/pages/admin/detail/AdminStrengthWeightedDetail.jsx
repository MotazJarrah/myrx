/**
 * AdminStrengthWeightedDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's WEIGHTED STANDARD strength detail screen.
 *
 * Covers movements whose `movements.equipment` is one of:
 *   barbell · dumbbell · kettlebell · machine · strongman
 * (Bodyweight / assisted / carry / isometric / sled get their own mirrors —
 *  this file is the FIRST of several variants, written to be the reusable
 *  pattern for the rest.)
 *
 * This faithfully reproduces the athlete surface as RENDERED by the mobile
 * component (the sole source of truth for the visual — CLAUDE.md's "locked
 * design spec" sections are stale in places, e.g. they claim the hero title
 * was removed when the code still renders it):
 *   - mobile/app/(app)/effort/strength/[exercise].tsx
 *     (StrengthDetail → weighted-standard branch, ~lines 4647-4960)
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header        — movement name + "Best Est. 1RM — N <unit>" (TickerNumber) + equipment category pill
 *   2. Rep-max card  — adp-zone pill row (STRENGTH/HYPERTROPHY/ENDURANCE, click to switch)
 *                      + horizontal 1RM…20RM tile row + source attribution
 *   3. Hero card     — "Your next training target" title + tappable adp-zone
 *                      info pill (whyText) + big target weight (TickerNumber)
 *                      + equipment footer + single coaching cue
 *   4. Chart         — Recharts est-1RM-over-time line + personal-best reference line
 *   5. Efforts log   — chronological list, with per-effort DELETE kept (SwipeDelete)
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * web/src/lib/formulas.js is the OLDER, simpler web copy and does NOT export
 * loadableWeight / nextLoadableAbove / getLadder / EQUIPMENT_LADDERS /
 * platesForBarbellWeight / adpZoneFor / ADP_ZONE_CONFIG. Its `projectAllRMs`
 * is also hard-capped at 10 tiles (1RM…10RM), whereas the athlete shows
 * 1RM…20RM. Rather than mutate the frozen web lib, every needed piece is
 * reproduced here verbatim from mobile/src/lib/formulas.ts so the projections
 * match the athlete exactly (including the 20-tile rep-max grid).
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Equipment ladders (verbatim mirror of mobile EQUIPMENT_LADDERS) ──────────
// Fixed, non-uniform weight progressions matching physically-available
// implements (you can't add a 2.5 lb plate to an atlas stone).
const EQUIPMENT_LADDERS = Object.freeze({
  atlasStone: {
    lb: [100, 135, 150, 180, 220, 260, 300, 330, 365],
    kg: [45,  60,  70,  80,  100, 120, 135, 150, 165],
  },
  dBall: {
    lb: [50, 70,  100, 125, 150, 175, 200],
    kg: [25, 30,  45,  55,  70,  80,  90],
  },
  sandbag: {
    lb: [50, 75,  100, 125, 150, 175, 200, 250, 300],
    kg: [25, 35,  45,  55,  70,  80,  90,  115, 135],
  },
  kettlebell: {
    lb: [9, 18, 26, 35, 44, 53, 62, 70, 80, 88, 97, 106],
    kg: [4, 8,  12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
  },
})

const BAR_WEIGHT    = { lb: 45, kg: 20 }
const MIN_INCREMENT = { lb: 5, kg: 2.5 }
const PLATE_SIZES   = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
}

/**
 * Resolve a movement's ladder array based on equipment + unit. Returns null
 * if the equipment isn't ladder-style (barbell / dumbbell / machine). Pass a
 * `weight_ladder_override` (array OR { lb, kg }) to use the row's custom
 * ladder instead of the equipment-wide default.
 */
function getLadder(equipment, unit = 'lb', override = null) {
  if (override && Array.isArray(override) && override.length > 0) {
    return [...override].sort((a, b) => a - b)
  }
  if (override && !Array.isArray(override) && Array.isArray(override[unit])) {
    return [...override[unit]].sort((a, b) => a - b)
  }
  switch (equipment) {
    case 'atlasStone': return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
    case 'dBall':      return EQUIPMENT_LADDERS.dBall[unit] ?? null
    case 'sandbag':    return EQUIPMENT_LADDERS.sandbag[unit] ?? null
    case 'kettlebell': return EQUIPMENT_LADDERS.kettlebell[unit] ?? null
    case 'strongman':  return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
    default:           return null
  }
}

/** Plates per side needed to load a SPECIFIC barbell weight. */
function platesForBarbellWeight(weight, unit = 'lb') {
  const bar     = BAR_WEIGHT[unit]
  const plates  = PLATE_SIZES[unit]
  const perSide = Math.max(0, weight - bar) / 2
  const used = []
  let rem = perSide
  for (const p of plates) {
    while (rem >= p - 0.001) {
      used.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return used
}

/** Smallest LOADABLE weight ≥ `raw` for a given equipment type. */
function loadableWeight(raw, equipment, unit = 'lb', override = null) {
  const ladder = getLadder(equipment, unit, override)
  if (ladder) {
    for (const w of ladder) if (w >= raw) return w
    return ladder[ladder.length - 1]
  }
  if (equipment === 'barbell') {
    const bar = BAR_WEIGHT[unit]
    const inc = MIN_INCREMENT[unit]
    const above = Math.max(0, raw - bar)
    return bar + Math.ceil(above / inc) * inc
  }
  if (equipment === 'dumbbell') {
    const inc = unit === 'kg' ? 2 : 5
    return Math.max(inc, Math.ceil(raw / inc) * inc)
  }
  if (equipment === 'machine') {
    const inc = unit === 'kg' ? 2.5 : 5
    return Math.max(inc, Math.ceil(raw / inc) * inc)
  }
  return raw
}

/** Smallest loadable weight STRICTLY ABOVE `current` for a given equipment. */
function nextLoadableAbove(current, equipment, unit = 'lb', override = null) {
  const ladder = getLadder(equipment, unit, override)
  if (ladder) {
    for (const w of ladder) if (w > current) return w
    return null
  }
  if (equipment === 'barbell') {
    const bar = BAR_WEIGHT[unit]
    const inc = MIN_INCREMENT[unit]
    const above = Math.max(0, current - bar)
    const next  = (above % inc === 0) ? above + inc : Math.ceil(above / inc) * inc
    return bar + next
  }
  if (equipment === 'dumbbell') {
    const inc = unit === 'kg' ? 2 : 5
    return (current % inc === 0) ? current + inc : Math.ceil(current / inc) * inc
  }
  if (equipment === 'machine') {
    const inc = unit === 'kg' ? 2.5 : 5
    return (current % inc === 0) ? current + inc : Math.ceil(current / inc) * inc
  }
  return null
}

/**
 * Project rep-max weights for 1RM…maxReps from a known 1RM. Verbatim mirror of
 * mobile `projectAllRMs(oneRM, 1, maxReps)` — the per-rep weight is the average
 * of inverse Epley / Brzycki / Lombardi. (The web lib's projectAllRMs caps at
 * 10 tiles and is NOT used here because the athlete shows 1RM…20RM.)
 */
function projectRMs(oneRM, maxReps = 20) {
  return Array.from({ length: maxReps }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    const brzycki  = oneRM * (37 - r) / 36     // inverse Brzycki
    const epley    = oneRM / (1 + r / 30)       // inverse Epley
    const lombardi = oneRM / Math.pow(r, 0.1)  // inverse Lombardi
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

// ── adp-zone (adaptation zone) classification + locked defaults ──────────────
// Verbatim mirror of mobile ADP_ZONE_CONFIG. Per-movement overrides NOT allowed.
function adpZoneFor(reps) {
  if (reps <= 5)  return 'strength'
  if (reps <= 12) return 'hypertrophy'
  return 'endurance'
}

const ADP_ZONE_ORDER = ['strength', 'hypertrophy', 'endurance']

const ADP_ZONE_CONFIG = Object.freeze({
  strength: {
    label:        'Build Strength',
    repRangeText: 'reps 1-5',
    setsText:     '4-5 sets',
    rirText:      'stop 1 rep short of failure',
    restText:     '3-5 min',
    whyText:
      'Heavy loads at low reps recruit your biggest motor units and train them to fire harder and faster. The adaptation is neural — you get stronger without adding muscle size.',
  },
  hypertrophy: {
    label:        'Increase Hypertrophy',
    repRangeText: 'reps 6-12',
    setsText:     '3-4 sets',
    rirText:      'stop 2 reps short of failure',
    restText:     '2-3 min',
    whyText:
      'Moderate loads taken close to failure put muscle fibers under sustained mechanical tension and metabolic stress. Both signals trigger growth of the fibers themselves.',
  },
  endurance: {
    label:        'Boost Endurance',
    repRangeText: 'reps 13+',
    setsText:     '2-3 sets',
    rirText:      'stop 3 reps short of failure',
    restText:     '45-60 sec',
    whyText:
      'Lighter loads at high reps drive capillary and mitochondrial growth inside the muscle. The adaptation is in stamina and waste clearance, not raw force — your muscles work longer before fatigue.',
  },
})

// ── Equipment → category pill label (mirror of mobile equipmentPillLabel) ─────
function equipmentPillLabel(equipment) {
  switch (equipment) {
    case 'barbell':    return 'BARBELL'
    case 'dumbbell':   return 'DUMBBELL'
    case 'kettlebell': return 'KETTLEBELL'
    case 'machine':    return 'RESISTANCE MACHINE'
    case 'strongman':  return 'STRONGMAN'
    default:           return (equipment || '').toUpperCase()
  }
}

// The five equipment kinds this component handles. The dispatcher in
// AdminEffortDetail decides whether to route here with the same membership
// test (kept un-exported so this file only exports the component — Fast
// Refresh requirement). See the wiring notes returned with this task.
const WEIGHTED_STANDARD_EQUIPMENT = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'strongman']

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

// Matches the stored effort `value` shape: "Est. 1RM 370 lb" / "1RM 370 lb".
function parseOneRM(value) {
  const m = value?.match(/(?:Est\. )?1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props (all optional except userId + exercise):
//   userId            (string, required) — client's auth user id
//   exercise          (string, required) — movement name, e.g. "Back Squat"
//   equipment         (string)           — barbell|dumbbell|kettlebell|machine|strongman.
//                                           If omitted, the movement row is fetched by name.
//   unitLock          ('lb'|'kg'|null)   — movements.unit_lock, forces the unit when set.
//   usesPair          (boolean)          — movements.uses_pair (kettlebell pairs).
//   ladderOverride    (array|{lb,kg})    — movements.weight_ladder_override JSONB.
//   onBack            (fn)               — optional custom back handler. Defaults to
//                                           returning to the client's detail page.
//
// Self-contained: if `equipment` isn't passed, the component fetches the
// `movements` row by name (equipment / unit_lock / uses_pair / ladder override)
// itself, so wiring is just <AdminStrengthWeightedDetail userId exercise />.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthWeightedDetail({
  userId,
  exercise,
  equipment: equipmentProp = null,
  unitLock: unitLockProp = undefined,
  usesPair: usesPairProp = undefined,
  ladderOverride: ladderOverrideProp = undefined,
  onBack,
}) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileUnit, setProfileUnit] = useState('lb')

  // Movement metadata fetched from the `movements` row (only when the
  // dispatcher didn't pass it). Props always take precedence — see the
  // derived values below. Keeping fetched data in one object means no
  // prop→state sync effects (which trip react-hooks/set-state-in-effect).
  const [fetchedMeta, setFetchedMeta] = useState(null)

  // Resolved metadata: prop wins, else fetched, else sensible default.
  const equipment      = equipmentProp      ?? fetchedMeta?.equipment ?? null
  const unitLock       = unitLockProp       ?? fetchedMeta?.unit_lock ?? null
  const usesPair       = usesPairProp       ?? fetchedMeta?.uses_pair ?? false
  const ladderOverride = ladderOverrideProp ?? fetchedMeta?.weight_ladder_override ?? null

  // adp-zone + selected tile state. Default landing tile = 1RM (matches the
  // athlete's "always open on 1RM"), so these are plain constant initial
  // values — no init effect needed.
  const [selZone, setSelZone]           = useState('strength')
  const [selectedRM, setSelectedRM]     = useState(1)
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  const tileEls = useRef({})       // reps → DOM node, for scroll-into-view

  // ── Load efforts + profile unit (+ movement row if equipment not given) ──────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      const queries = [
        supabase
          .from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'strength')
          .ilike('label', `${exercise} · %`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('weight_unit')
          .eq('id', userId)
          .maybeSingle(),
      ]

      // Only hit the movements table when the dispatcher didn't pass equipment.
      const needMovement = equipmentProp == null
      if (needMovement) {
        queries.push(
          supabase
            .from('movements')
            .select('equipment, unit_lock, uses_pair, weight_ladder_override')
            .eq('name', exercise)
            .maybeSingle()
        )
      }

      const results = await Promise.all(queries)
      if (cancelled) return

      const [efRes, profRes, movRes] = results
      setEntries(efRes.data || [])
      setProfileUnit(profRes.data?.weight_unit || 'lb')
      if (needMovement) setFetchedMeta(movRes?.data ?? null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, exercise, equipmentProp])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  // ── Best 1RM (never goes down) + resolved unit ──────────────────────────────
  const best = useMemo(() => entries.reduce((acc, e) => {
    const parsed = parseOneRM(e.value)
    if (!parsed) return acc
    return parsed.oneRM > acc.val ? { val: parsed.oneRM, unit: parsed.unit } : acc
  }, { val: 0, unit: null }), [entries])

  const bestOneRM = best.val
  // Unit precedence: movement unit_lock → unit parsed off the effort → profile pref → lb.
  const unit = unitLock || best.unit || profileUnit || 'lb'

  // Equipment used for ladder/jump math. `strongman` resolves through getLadder
  // to the atlas-stone ladder (mirrors mobile). Default to barbell if unknown
  // so a misconfigured movement still renders something sensible.
  const equipForMath = equipment || 'barbell'

  // ── Rep-max projections (1RM…20RM) off the best 1RM ──────────────────────────
  const projections = useMemo(
    () => (bestOneRM > 0 ? projectRMs(bestOneRM, 20) : []),
    [bestOneRM]
  )
  const selectedProjection = projections.find(p => p.reps === selectedRM) ?? null

  // ── Big-weight algorithm (CLAUDE.md "Weighted Standard next-target card") ────
  //   current_1RM = bestOneRM (max ever)
  //   selProj     = eff-curve projection at selRepRange
  //   selCueWeight  = round_up(projection, smallest_jump)            (today's capability)
  //   selBigWeight  = round_up(projection + smallest_jump, jump)     (next milestone)
  //   1RM tile      = next loadable above current_1RM (PR attempt)
  const selRepRange = selectedRM
  const selProj     = selectedProjection?.weight ?? 0
  const selRawForBig = selRepRange === 1 ? Math.max(bestOneRM, selProj) : selProj

  const selCueWeight = selRepRange === 1
    ? loadableWeight(bestOneRM, equipForMath, unit, ladderOverride)
    : loadableWeight(selRawForBig, equipForMath, unit, ladderOverride)

  const selBigWeightRaw = nextLoadableAbove(selRawForBig, equipForMath, unit, ladderOverride)
  const selBigWeight    = selBigWeightRaw ?? selCueWeight
  const targetWeight    = selBigWeight

  const selZoneCfg = ADP_ZONE_CONFIG[selZone]

  const targetPlatesBarbell = equipForMath === 'barbell'
    ? platesForBarbellWeight(targetWeight, unit)
    : []

  // ── Zone navigation (click chevrons / pills). On commit, center the first
  //    tile of the new zone in the tile row & make it the selected tile. ───────
  const zoneIdx     = ADP_ZONE_ORDER.indexOf(selZone)
  const canGoPrev   = zoneIdx > 0
  const canGoNext   = zoneIdx < ADP_ZONE_ORDER.length - 1
  const zoneFirstRep = { strength: 1, hypertrophy: 6, endurance: 13 }

  function goToZone(zone) {
    if (!zone || zone === selZone) return
    const firstRep = zoneFirstRep[zone]
    setSelZone(zone)
    setZoneInfoOpen(false)        // auto-close info panel on zone change (Pattern 5)
    setSelectedRM(firstRep)
    // Center that tile in the horizontal scroll row.
    requestAnimationFrame(() => {
      const el = tileEls.current[firstRep]
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })
  }
  function navigateZone(dir) {
    const next = ADP_ZONE_ORDER[zoneIdx + dir]
    if (next) goToZone(next)
  }

  function onTilePress(reps) {
    setSelectedRM(reps)
    setSelZone(adpZoneFor(reps))
  }

  // ── Chart data — est-1RM over time ───────────────────────────────────────────
  const chartData = useMemo(() => entries
    .map(e => {
      const parsed = parseOneRM(e.value)
      return parsed ? { ts: e.created_at, date: fmtShort(e.created_at), value: parsed.oneRM } : null
    })
    .filter(Boolean), [entries])

  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const pad    = (maxV - minV) * 0.15 || 1
  const bestForChart = bestOneRM > 0 ? bestOneRM : null

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
        <h1 className="text-xl font-bold tracking-tight">{exercise}</h1>
        {bestOneRM > 0 ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best Est. 1RM —</span>
            <TickerNumber value={bestOneRM} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">{unit}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
          {equipmentPillLabel(equipment)}
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : bestOneRM <= 0 ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            This client hasn't logged any efforts for this movement yet.
          </p>
        </AnimateRise>
      ) : (
        <>
          {/* ── 2. Rep-max projections card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Rep-max projections</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick an adaptation zone, then tap a rep target.
            </p>

            {/* adp-zone pill row — single active pill flanked by chevrons.
                Web stays simple click-to-navigate (no swipe choreography). */}
            <div className="mt-3 mb-2 flex items-center justify-center gap-3">
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
                  {ADP_ZONE_CONFIG[selZone].label}
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

            {/* Horizontal scrollable tile row 1RM…20RM with fading edges. */}
            <div className="relative">
              <div
                className="flex gap-2 overflow-x-auto py-1 px-0.5 scrollbar-hide"
                style={{ scrollbarWidth: 'none' }}
              >
                {projections.map(({ reps: r, weight: w }) => {
                  const isSelected = selectedRM === r
                  const pct = bestOneRM > 0 ? Math.round((w / bestOneRM) * 100) : 0
                  return (
                    <button
                      key={r}
                      ref={el => { tileEls.current[r] = el }}
                      onClick={() => onTilePress(r)}
                      className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/15'
                          : 'border-border bg-card/40 hover:border-blue-500/40'
                      }`}
                      style={{ minWidth: 68 }}
                    >
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-blue-400' : 'text-muted-foreground'}`}>
                        {r}RM
                      </span>
                      <span className={`mt-0.5 font-mono text-base font-bold tabular-nums ${isSelected ? 'text-blue-400' : 'text-foreground'}`}>
                        {w}
                      </span>
                      <span className={`mt-0.5 font-mono text-[9px] tabular-nums leading-none ${isSelected ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
                        {pct}%
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* Fading edges signaling more content off-screen. */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              Epley · Brzycki · Lombardi averaged · % of 1RM
            </p>

            {/* ── 3. Next-target hero card ── */}
            {selectedProjection && (
              <div
                className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] p-4"
                style={{ minHeight: 220 }}
              >
                {/* Card title — the athlete's NextTargetCallout renders this
                    "Your next training target" header at the top of the hero
                    card. (The CLAUDE.md spec claims the title was removed, but
                    the actual mobile component still renders it via
                    NextTargetCallout's `title` prop — code is source of truth.) */}
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-blue-400">
                  Your next training target
                </p>

                {/* Tappable adp-zone info pill (right-aligned). */}
                <div className="flex justify-end">
                  <button
                    onClick={() => setZoneInfoOpen(o => !o)}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5"
                  >
                    <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-blue-400">
                      {selZoneCfg.label}
                    </span>
                    <Info className="h-3 w-3 text-blue-400" />
                  </button>
                </div>

                {/* Inline "why this adaptation" info panel (the WHY, not the prescription). */}
                {zoneInfoOpen && (
                  <div className="mt-1 rounded-md border border-blue-500/15 bg-card/60 px-2.5 py-2">
                    <p className="mb-1 text-xs font-bold text-foreground">{selZoneCfg.label}</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">{selZoneCfg.whyText}</p>
                  </div>
                )}

                {/* Big weight + equipment-specific RHS. */}
                <div className="mt-1">
                  {equipForMath === 'barbell' && (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex items-baseline gap-1">
                          <TickerNumber value={targetWeight} className="font-mono text-3xl font-bold text-blue-400" />
                          <span className="text-blue-400">{unit}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="mb-1 text-[11px] text-muted-foreground">per side</span>
                          <div className="flex flex-wrap justify-end gap-1">
                            {targetPlatesBarbell.map((p, i) => (
                              <span key={i} className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-400">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {unit === 'kg' ? 20 : 45} {unit} bar + {targetPlatesBarbell.join(' + ') || '—'} {unit} per side
                      </p>
                    </>
                  )}

                  {equipForMath === 'dumbbell' && (
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1">
                          <TickerNumber value={targetWeight} className="font-mono text-3xl font-bold text-blue-400" />
                          <span className="text-blue-400">{unit}</span>
                        </div>
                        <span className="text-blue-400">each hand</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Pick the {targetWeight} {unit} dumbbells — one in each hand
                      </p>
                    </>
                  )}

                  {equipForMath === 'kettlebell' && (
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1">
                          <TickerNumber value={targetWeight} className="font-mono text-3xl font-bold text-blue-400" />
                          <span className="text-blue-400">{unit}</span>
                        </div>
                        <span className="text-blue-400">{usesPair ? 'each hand' : 'kettlebell'}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {usesPair
                          ? `Pick a pair of ${targetWeight} ${unit} kettlebells`
                          : `Pick the ${targetWeight} ${unit} kettlebell`}
                      </p>
                    </>
                  )}

                  {equipForMath === 'machine' && (
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1">
                          <TickerNumber value={targetWeight} className="font-mono text-3xl font-bold text-blue-400" />
                          <span className="text-blue-400">{unit}</span>
                        </div>
                        <span className="text-blue-400">pin setting</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Set the pin to {targetWeight} {unit}
                      </p>
                    </>
                  )}

                  {equipForMath === 'strongman' && (
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1">
                          <TickerNumber value={targetWeight} className="font-mono text-3xl font-bold text-blue-400" />
                          <span className="text-blue-400">{unit}</span>
                        </div>
                        <span className="text-blue-400">load</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Use the {targetWeight} {unit} stone, sandbag, or D-ball (or closest available)
                      </p>
                    </>
                  )}
                </div>

                {/* Thin separator + single coaching cue. */}
                <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                  {selRepRange === 1 ? (
                    <>
                      <p className="flex flex-wrap items-baseline text-sm">
                        <span className="text-foreground">Hit one clean rep at&nbsp;</span>
                        <TickerNumber value={targetWeight} className="font-mono font-bold text-blue-400" />
                        <span className="font-mono font-bold text-blue-400">&nbsp;{unit}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">Benchmark attempt</p>
                    </>
                  ) : (
                    <>
                      <p className="flex flex-wrap items-baseline text-sm">
                        <span className="text-foreground">Do&nbsp;</span>
                        <span className="font-mono font-bold text-foreground">{selZoneCfg.setsText}</span>
                        <span className="text-foreground">&nbsp;of&nbsp;</span>
                        <TickerNumber value={selRepRange} className="font-mono font-bold text-foreground" />
                        <span className="font-mono font-bold text-foreground">&nbsp;reps</span>
                        <span className="text-foreground">&nbsp;at&nbsp;</span>
                        <TickerNumber value={targetWeight} className="font-mono font-bold text-blue-400" />
                        <span className="font-mono font-bold text-blue-400">&nbsp;{unit}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">Rest {selZoneCfg.restText} between sets</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </AnimateRise>

          {/* ── 4. Est-1RM chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Est. 1RM over time</p>
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
                      domain={[minV - pad, maxV + pad]}
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
                      formatter={(v) => [`${v} ${unit}`, 'Est. 1RM']}
                    />
                    {bestForChart && (
                      <ReferenceLine y={bestForChart} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }}
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
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 5. Efforts log (chronological, with per-effort delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No efforts found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const detail = e.label.split(' · ').slice(1).join(' · ')
                  const parsed = parseOneRM(e.value)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{detail || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        {parsed && (
                          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-blue-400">
                            {parsed.oneRM} {parsed.unit} 1RM
                          </span>
                        )}
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
