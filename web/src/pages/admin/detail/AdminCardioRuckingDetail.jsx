/**
 * AdminCardioRuckingDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's RUCKING cardio detail screen.
 *
 * Rucking sits on the cardio tab but its progression is CARRY-LIKE: you get
 * better by carrying HEAVIER or going FARTHER, not by getting FASTER. Pace is
 * too sensitive to load + terrain to be a useful coaching anchor, so this page
 * mirrors Atlas Stone Bear Hug Carry's abs-mode design: a 4-tier ladder
 * (BEGINNER/INTERMEDIATE/ADVANCED/TOUGH), 3 adaptation zones (MAX LOAD /
 * DISTANCE BUILD / CONDITIONING) anchored on the user's PB, and a dual-axis
 * hero (pack weight + distance) instead of a single pace target.
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - CLAUDE.md → "Rucking detail card — locked design spec" (May 19 2026)
 *   - mobile/app/(app)/effort/cardio/[activity].tsx → function RuckingDetail
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header  — "Rucking" + "Best — N lb · N mi" (TickerNumber) + RUCKING
 *                category pill + tier pill (when a tier is cleared)
 *   2. Zone card — MAX LOAD / DISTANCE BUILD / CONDITIONING pill (clickable to
 *                  switch) flanked by chevrons + tappable info panel (whyText)
 *                  + dual-target hero (weight + distance TickerNumbers + delta
 *                  strings) + cue line
 *   3. Charts  — two stacked Recharts lines: pack weight over time + distance
 *                over time. Higher = better → NOT reversed.
 *   4. Efforts log — chronological list ("N lb × N mi" + time), per-effort
 *                    DELETE kept (SwipeDelete)
 *
 * UNITS ARE HARD-LOCKED: pack weight = pounds (lb), distance = miles (mi).
 * No unit toggle, no profile unit needed — the rucking community (GoRuck, US
 * tactical fitness) is universally imperial. The athlete reinforces the
 * distance lock with movements.unit_lock = 'mi'; the weight lock lives in code.
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the RUCK_* math is re-implemented inline:
 * These constants + helpers (RUCK_TIER_THRESHOLDS, RUCK_WEIGHT_LADDER_LB,
 * RUCK_ZONE_CONFIG, parseRuckLabel, classifyRuckTier, snapDownToRuckLadder,
 * nextRuckLadderAbove) live only in the mobile codebase
 * (mobile/app/(app)/effort/cardio/[activity].tsx + mobile/src/lib/movements.ts)
 * and have no web-lib equivalent. Reproduced here verbatim so the tier
 * classification + zone targets match the athlete exactly.
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

// ── Tier ladder (verbatim mirror of mobile RUCK_TIER_*) ──────────────────────
// Civilian-friendly tier scale stepped from the GoRuck event ladder. TOUGH =
// the GoRuck Tough standard exactly (35 lb × 12 mi). Beginner / Intermediate /
// Advanced are progression stops below it. Heavy/Selection are excluded — they
// require multi-hour sessions beyond the app's 45-min session philosophy.
const RUCK_TIER_ORDER = ['beginner', 'intermediate', 'advanced', 'tough']
const RUCK_TIER_LABELS = {
  beginner: 'BEGINNER', intermediate: 'INTERMEDIATE', advanced: 'ADVANCED', tough: 'TOUGH',
}
const RUCK_TIER_RANK = {
  beginner: 1, intermediate: 2, advanced: 3, tough: 4,
}
// [minPackLb, minDistMi] — an effort qualifies when BOTH thresholds are met
// in the SAME effort (not cumulative).
const RUCK_TIER_THRESHOLDS = {
  beginner:     [10, 2],
  intermediate: [20, 4],
  advanced:     [30, 8],
  tough:        [35, 12],
}

// ── Pack weight ladder (verbatim mirror of mobile RUCK_WEIGHT_LADDER_LB) ──────
// Real plate sizes available to the rucking community: GoRuck Sand Plates
// (10/20/30/45 lb), Rogue Echo plates (10/15/20/25/30/35/40/45 lb), and
// realistic stacked combinations (50/60/70/80 lb). Starts at 10 lb so the
// CONDITIONING zone never prescribes "0 lb".
const RUCK_WEIGHT_LADDER_LB = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]

// ── Adaptation zones (verbatim mirror of mobile RUCK_ZONE_CONFIG) ────────────
// Each zone pushes one axis (or two for conditioning) anchored on the user's
// actual PB. Mirrors Carry's MAX LOAD / DISTANCE BUILD / CONDITIONING structure.
const RUCK_ZONE_ORDER = ['max_load', 'distance_build', 'conditioning']
const RUCK_ZONE_CONFIG = Object.freeze({
  max_load: {
    label: 'MAX LOAD',
    whyText:
      'Heavier pack, same distance. Trains posterior-chain strength, grip stamina, and the mental fortitude that defines GoRuck-style events.',
  },
  distance_build: {
    label: 'DISTANCE BUILD',
    whyText:
      'Same pack, longer distance. Builds cardiovascular base and foot durability — the foundation of every long ruck.',
  },
  conditioning: {
    label: 'CONDITIONING',
    whyText:
      'Lighter pack, longer distance. Trains aerobic capacity without the orthopedic stress of heavy loads. Ideal recovery between hard sessions.',
  },
})

// ── Parse / classify / ladder helpers (verbatim mirror of mobile) ────────────

// Parse a rucking effort label.
//   Current format:  "Rucking · 35 lb × 2.5 mi in 45:00"
//   Legacy format:   "Rucking · 2.5 mi in 45:00"  (packLb defaults to 0)
// Legacy labels remain valid — users who logged before the May 19 2026 spec
// see their old efforts with weight = 0 (bodyweight rucking).
function parseRuckLabel(label) {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  // Current format with pack weight.
  const m1 = part.match(/(\d+)\s*lb\s*[×x]\s*([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) {
    return { packLb: parseInt(m1[1], 10), distMi: parseFloat(m1[2]), timeSecs: parseTimeStr(m1[3]) ?? 0 }
  }
  // Legacy format without pack weight.
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) {
    return { packLb: 0, distMi: parseFloat(m2[1]), timeSecs: parseTimeStr(m2[2]) ?? 0 }
  }
  return null
}

// Classify the user's highest cleared tier from their effort history. An
// effort qualifies when packLb ≥ minLb AND distMi ≥ minMi in the SAME effort.
// Returns null when no effort meets even the beginner threshold.
function classifyRuckTier(parsedEfforts) {
  let highest = null
  for (const p of parsedEfforts) {
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

// Snap a value DOWN to the largest rung ≤ value. Returns ladder[0] when value
// is below the lowest rung (we never prescribe 0 lb).
function snapDownToRuckLadder(value, ladder) {
  let result = ladder[0]
  for (const v of ladder) {
    if (v <= value) result = v
    else break
  }
  return result
}

// Smallest rung above value, or null when value is ≥ the heaviest rung.
function nextRuckLadderAbove(value, ladder) {
  for (const v of ladder) {
    if (v > value) return v
  }
  return null
}

// ── Time + date helpers ──────────────────────────────────────────────────────
function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}
function fmtSecs(totalSecs) {
  if (!totalSecs && totalSecs !== 0) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
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

const RUCKING_ACTIVITY = 'Rucking'

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId   (string, required) — client's auth user id
//   activity (string)           — movement name; defaults to "Rucking"
//   onBack   (fn, optional)     — custom back handler. Defaults to returning to
//                                 the client's detail page (activity tab).
//
// Self-contained: fetches the client's rucking efforts itself. Units are
// hard-locked (lb × mi), so no profile-unit fetch is needed.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioRuckingDetail({
  userId,
  activity = RUCKING_ACTIVITY,
  onBack,
}) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  // Hard-locked units.
  const wUnit = 'lb'
  const dUnit = 'mi'

  // ── Zone + info-panel state. Default landing = MAX LOAD (slot 0). ──────────
  const [selZone, setSelZone]           = useState('max_load')
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  const pillRef = useRef(null) // for scroll-into-view continuity (web is simple)

  // ── Load efforts ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', 'cardio')
        .ilike('label', `${activity} ·%`)
        .order('created_at', { ascending: true })
      if (cancelled) return
      setEntries(data || [])
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

  // ── Parse efforts → { ts, packLb, distMi, timeSecs, id } ──────────────────
  const parsed = useMemo(() => entries.map(e => {
    const p = parseRuckLabel(e.label)
    if (!p) return null
    return { ts: e.created_at, packLb: p.packLb, distMi: p.distMi, timeSecs: p.timeSecs, id: e.id }
  }).filter(Boolean), [entries])

  // ── Best derivations ──────────────────────────────────────────────────────
  const bestWeight     = parsed.length ? Math.max(...parsed.map(p => p.packLb)) : 0
  const bestDistRaw     = parsed.length ? Math.max(...parsed.map(p => p.distMi)) : 0
  const bestDistDisplay = Math.round(bestDistRaw * 10) / 10
  const currentTier     = useMemo(() => classifyRuckTier(parsed), [parsed])
  const hasTargets      = bestWeight > 0 && bestDistDisplay > 0

  // ── Zone math (mirrors Carry/Rucking zoneMath exactly) ────────────────────
  // dInc = 1 mile (round-mile DISTANCE BUILD steps); ladder handles weight.
  const dInc = 1
  const zoneMath = useMemo(() => {
    const result = {}
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
      // Delta strings vs the user's best.
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
      let cueLine
      if (!hasTargets) {
        cueLine = 'No rucks logged yet'
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

  const selectedZone = zoneMath[selZone]
  const selectedCfg  = RUCK_ZONE_CONFIG[selZone]

  // ── Zone navigation (click chevrons / pill). Web stays simple — no swipe. ──
  const zoneIdx   = RUCK_ZONE_ORDER.indexOf(selZone)
  const canGoPrev = zoneIdx > 0
  const canGoNext = zoneIdx < RUCK_ZONE_ORDER.length - 1

  function navigateZone(dir) {
    const next = RUCK_ZONE_ORDER[zoneIdx + dir]
    if (!next || next === selZone) return
    setSelZone(next)
    setZoneInfoOpen(false) // auto-close info panel on zone change (Pattern 5)
  }

  // ── Chart data — two stacked single-axis series (weight + distance) ────────
  const weightChartData = useMemo(() => parsed.map(p => ({
    ts: p.ts, date: fmtShort(p.ts), value: p.packLb,
  })), [parsed])
  const distChartData = useMemo(() => parsed.map(p => ({
    ts: p.ts, date: fmtShort(p.ts), value: p.distMi,
  })), [parsed])

  // Weight chart axis bounds.
  const wVals = weightChartData.map(d => d.value)
  const wMin  = wVals.length ? Math.min(...wVals) : 0
  const wMax  = wVals.length ? Math.max(...wVals) : 10
  const wPad  = (wMax - wMin) * 0.15 || 1
  // Distance chart axis bounds.
  const dVals = distChartData.map(d => d.value)
  const dMin  = dVals.length ? Math.min(...dVals) : 0
  const dMax  = dVals.length ? Math.max(...dVals) : 1
  const dPad  = (dMax - dMin) * 0.15 || 0.5

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
        <h1 className="text-xl font-bold tracking-tight">{RUCKING_ACTIVITY}</h1>
        {hasTargets ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber value={`${bestWeight} ${wUnit}`} className="font-mono font-semibold text-amber-400" />
            <span className="text-amber-400">·</span>
            <TickerNumber value={`${bestDistDisplay} ${dUnit}`} className="font-mono font-semibold text-amber-400" />
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
        )}

        {/* Stacked tags: RUCKING category pill + tier pill (when cleared).
            Both use the same amber-tinted chrome so the tier reads as a
            sub-classification of the cardio category (mirrors Atlas Stone). */}
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
            RUCKING
          </span>
          {currentTier && (
            <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
              {RUCK_TIER_LABELS[currentTier]}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Adaptation zone card — pill + info panel + dual-target hero ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Adaptation zone</h2>

            {/* Zone pill row — single active pill flanked by chevrons.
                Web stays simple click-to-navigate (no swipe choreography). */}
            <div ref={pillRef} className="mt-3 mb-2 flex items-center justify-center gap-3">
              <div className="flex w-14 items-center justify-end">
                {canGoPrev && (
                  <button
                    onClick={() => navigateZone(-1)}
                    aria-label="Previous zone"
                    className="text-amber-400/80 hover:text-amber-400 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5 -mr-2" />
                    <ChevronLeft className="h-5 w-5 -mt-5" />
                  </button>
                )}
              </div>

              <div className="rounded-full border border-amber-500 bg-amber-500/15 px-4 py-2">
                <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-amber-400">
                  {selectedCfg.label}
                </span>
              </div>

              <div className="flex w-14 items-center">
                {canGoNext && (
                  <button
                    onClick={() => navigateZone(1)}
                    aria-label="Next zone"
                    className="text-amber-400/80 hover:text-amber-400 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5 -mr-2" />
                    <ChevronRight className="h-5 w-5 -mt-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Hero card — top-right info pill + 2 stacked TickerNumber rows
                (weight target + distance target, each with delta vs. best) +
                cue line below thin separator. */}
            <div
              className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4"
              style={{ minHeight: 220 }}
            >
              {/* Tappable zone info pill (right-aligned). */}
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

              {/* Two stacked target rows: weight (top) + distance (bottom). */}
              <div className="mt-3 flex flex-col gap-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1">
                    <TickerNumber value={`${selectedZone.W_target} ${wUnit}`} className="font-mono text-3xl font-bold text-amber-400" />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{selectedZone.weightDeltaText}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1">
                    <TickerNumber value={`${selectedZone.D_target} ${dUnit}`} className="font-mono text-3xl font-bold text-amber-400" />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{selectedZone.distDeltaText}</span>
                </div>
              </div>

              {/* Thin separator + cue line. */}
              <div className="mt-2.5 border-t border-amber-500/15 pt-2.5">
                <p className="text-sm text-foreground">{selectedZone.cueLine}</p>
              </div>
            </div>
          </AnimateRise>

          {/* ── 3. Progress charts — two stacked single-axis lines ── */}
          {parsed.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              {/* "Progress over time" is an h2 on mobile (s.h2 = 14px bold
                  foreground), same visual weight as "Adaptation zone". */}
              <h2 className="text-sm font-bold">Progress over time</h2>

              {/* Pack weight over time. Higher = better → NOT reversed. */}
              <p className="mb-2 mt-4 text-xs text-muted-foreground">Pack weight</p>
              {weightChartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={weightChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[wMin - wPad, wMax + wPad]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      tickFormatter={(v) => `${Math.round(v)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${Math.round(v)} ${wUnit}`, 'Weight']}
                    />
                    {bestWeight > 0 && (
                      <ReferenceLine y={bestWeight} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.5} />
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
                  Not enough data for the weight trend yet.
                </p>
              )}

              {/* Distance over time. Higher = better → NOT reversed. */}
              <p className="mb-2 mt-4 text-xs text-muted-foreground">Distance</p>
              {distChartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={distChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[dMin - dPad, dMax + dPad]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      tickFormatter={(v) => `${v.toFixed(1)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${Number(v).toFixed(1)} ${dUnit}`, 'Distance']}
                    />
                    {bestDistRaw > 0 && (
                      <ReferenceLine y={bestDistRaw} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.5} />
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
                  Not enough data for the distance trend yet.
                </p>
              )}
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log (chronological, with per-effort delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No entries found for {activity}.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">All entries</h2>
              </div>
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const p = parseRuckLabel(e.label)
                  const shape = p
                    ? (p.packLb > 0 ? `${p.packLb} lb × ${p.distMi} mi` : `${p.distMi} mi`)
                    : e.label.split(' · ').slice(1).join(' · ')
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{shape || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-amber-400">
                          {p ? fmtSecs(p.timeSecs) : '—'}
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
