import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../../lib/supabase'
import { useMovements } from '../../../hooks/useMovements'
import { Dumbbell, Activity, ChevronRight } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'

// Cardio direction-aware best parser — mirrors AdminUserDetail's parseCardioBest
// (and mobile dashboard's). Returns { val, lowerBetter } so the caller picks the
// right direction per activity:
//   • Pace activities ("5:30/km", "1:55/500m"): lower is better
//   • Speed / rate (cal/min, floors/min) / distance: higher is better
// The `\b` after the unit alternation stops "/min" being misread as pace via "/mi".
function parseCardioBest(v) {
  if (!v) return null
  const isPace = /\/(km|mi|500m|100m)\b/.test(v)
  if (isPace) {
    const m = v.match(/(\d+):(\d+)/)
    if (!m) return null
    return { val: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), lowerBetter: true }
  }
  const m = v.match(/(\d+(?:\.\d+)?)/)
  return m ? { val: parseFloat(m[1]), lowerBetter: false } : null
}

// ── Strength per-effort metric parsers ─────────────────────────────────────────
// Each mirrors the parse logic in the matching detail surface so the mini-graph
// plots the SAME progression metric the detail page plots.

// Est. 1RM — weighted / olympic / ballistic / weighted-bodyweight Full-RX.
// Effort value shape: "Est. 1RM 370 lb" (athlete also saves bare "1RM N unit").
function parseOneRM(value) {
  const m = value?.match(/(?:Est\. )?1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  return m ? { val: parseFloat(m[1]), unit: m[2] } : null
}
// Hold seconds — isometric / leverage / load. Value shape: "45 sec".
function parseHoldSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1], 10) : null
}
// Reps — bodyweight tiers / rep-only families. Label shapes:
//   "... × 8"  (band / band+knee / Full-RX weighted) OR "... · 8 reps" (knee).
function parseReps(label) {
  let m = label?.match(/×\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  m = label?.match(/·\s*(\d+)\s*reps?/)
  return m ? parseInt(m[1], 10) : null
}
// Carry weight + distance — "Farmer's Carry · 100 kg × 50 m" →
// { weight: 100, unit: 'kg', distM: 50 }. Carry/Sled progress is two-
// dimensional (heavier OR farther); the detail pages plot ONE workload score
// (weight × distance) so a distance-only PR still reads as progress, and the
// card mirrors that.
function parseCarryWD(label) {
  const w = label?.match(/·\s*([\d.]+)\s*(\w+)\s*×/)
  const d = label?.match(/×\s*([\d.]+)\s*m\b/)
  if (!w || !d) return null
  return { weight: parseFloat(w[1]), unit: w[2], distM: parseFloat(d[1]) }
}
// Rucking weight + distance — "Rucking · 35 lb × 2.5 mi in 45:00" →
// { packLb: 35, distMi: 2.5 }. Legacy "Rucking · 2.5 mi in 45:00" (no pack) →
// packLb 0. Workload = packLb × distMi.
function parseRuckWD(label) {
  let m = label?.match(/·\s*(\d+)\s*lb\s*×\s*([\d.]+)\s*mi/)
  if (m) return { packLb: parseInt(m[1], 10), distMi: parseFloat(m[2]) }
  m = label?.match(/·\s*([\d.]+)\s*mi/)
  if (m) return { packLb: 0, distMi: parseFloat(m[1]) }
  return null
}
// Workload "Best" line for carry/sled: "10 lb × 262 ft" (lb→ft) or
// "100 kg × 50 m" (kg→m). The card has no profile, so we infer the distance
// display unit from the logged weight unit (imperial logs → ft), matching how
// the carry detail derives its distance unit.
function fmtCarryWorkloadBest(weight, unit, distM) {
  const imperial = unit === 'lb'
  const dDisp = imperial ? Math.round(distM / 0.3048) : Math.round(distM)
  return `${weight} ${unit} × ${dDisp} ${imperial ? 'ft' : 'm'}`
}
// Assisted-machine assistance — "Assisted Pull Up · 60 lb assist · X × 8".
// LOWER is better (less help = harder), so the chart Y-axis is reversed.
function parseAssistance(label) {
  const m = label?.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
  return m ? { val: parseFloat(m[1]), unit: m[2] } : null
}

// fmtDurationLong → "30s", "1m 10s" for the hold-seconds PR line.
function fmtHold(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

// ── Variant-family collapse helpers (mirror the athlete index) ─────────────────
//
// The athlete's "Your movements" (mobile/app/(app)/strength.tsx) and "Your
// activities" (mobile/app/(app)/cardio.tsx) lists collapse variant families
// into a single row keyed by the BASE name, with a small badge for the
// most-recently-trained (or highest-reached) variant. We replicate that here
// so the coach sees the same shape. Navigation for a collapsed row targets the
// BASE / consolidated route — the admin detail dispatchers
// (AdminEffortDetail + AdminCardioDetail) already special-case those base
// names and self-fetch every variant's efforts.

// Bodyweight assist tiers — highest tier reached drives the badge.
// FULL RX (no assist) > BAND (band only) > KNEE (knee only) > B+K (both).
const BW_TIER_RANK = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }
const BW_TIER_BADGE = { 'band+knee': 'B+K', 'knee': 'KNEE', 'band': 'BAND', 'rx': 'FULL RX' }

function bwTierFromVariantName(name) {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwBaseName(name) {
  return name
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
}

// Sled Work — two parallel variants ([Push] / [Drag]) collapse into one
// "Sled Work" row, badge = best-load variant (parallel, no hardness ranking).
const SLED_WORK_BASE_NAME = 'Sled Work'
function sledVariantFromName(name) {
  if (name === 'Sled Work [Push]') return 'push'
  if (name === 'Sled Work [Drag]') return 'drag'
  return null
}

// Swimming — four stroke variants ([Freestyle] / [Backstroke] / [Breaststroke]
// / [Butterfly], plus legacy bare "Swimming") collapse into one "Swimming"
// row, badge = best-pace stroke (parallel, no hardness ranking).
const SWIMMING_BASE_NAME = 'Swimming'
const SWIM_STROKE_BADGE = {
  freestyle: 'FREE', backstroke: 'BACK', breaststroke: 'BREAST', butterfly: 'FLY',
}
function isSwimHead(head) {
  return head === SWIMMING_BASE_NAME || head.startsWith('Swimming [')
}
function swimStrokeFromHead(head) {
  // Bare "Swimming" (legacy effort labels) defaults to freestyle — same as the
  // athlete's parseSwimStroke read path.
  const m = head.match(/^Swimming\s+\[(\w+)\]$/i)
  if (!m) return 'freestyle'
  const stroke = m[1].toLowerCase()
  return SWIM_STROKE_BADGE[stroke] ? stroke : 'freestyle'
}

// ── Recency formatter ──────────────────────────────────────────────────────────
function fmtRecency(ts) {
  if (!ts || ts < 0) return null
  const now = new Date()
  const then = new Date(ts)
  // Compare calendar days so "today / yesterday" read naturally regardless of time.
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return 'Last trained today'
  if (days === 1) return 'Last trained yesterday'
  return `Last trained ${days} days ago`
}

// Short date for the card hover popup, e.g. "Jun 6".
function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Per-point value string for the card hover popup, matching the move's metric
// (mirrors the mobile tap-to-pin tooltip — e.g. "Workload: 2625", "225 lb 1RM",
// "12 reps", "1m 30s", "60 lb assist").
function fmtMetricDisp(kind, val, unit) {
  switch (kind) {
    case 'workload': return `Workload: ${val}`
    case 'onerm':    return `${val} ${unit} 1RM`
    case 'hold':     return fmtHold(val)
    case 'reps':     return `${val} reps`
    case 'assist':   return `${val} ${unit} assist`
    default:         return `${val}${unit ? ` ${unit}` : ''}`
  }
}

// Hover popup for the card mini-graph — date + the point's display value.
// Same role as the mobile chart's tap-to-pin tooltip.
function MiniTip({ active, payload, color }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-md">
      <div className="text-[11px] text-muted-foreground">{p.date}</div>
      <div className="text-xs font-semibold" style={{ color }}>{p.disp}</div>
    </div>
  )
}

// ── Mini progress sparkline ─────────────────────────────────────────────────────
// Compact Recharts line, sparkline-style (no axes). Plots `points` oldest→newest.
// `reversed` flips the Y-axis so lower-is-better metrics still read "up = better"
// (locked chart-direction rule). <2 points → single-dot or placeholder.
function MiniGraph({ points, color, reversed }) {
  if (!points || points.length === 0) {
    return (
      <div className="flex h-[90px] items-center justify-center text-[11px] text-muted-foreground/60">
        Not enough data yet
      </div>
    )
  }
  // Each point carries a ready-to-show `disp` string + a short date so the hover
  // popup matches the mobile chart's tap-to-pin tooltip ("Jun 6 / Workload: 2625").
  // Dots mark every logged session so the data points are visible.
  const mk = p => ({ v: p.val, date: fmtShortDate(p.ts), disp: p.disp ?? String(p.val) })
  if (points.length === 1) {
    const one = mk(points[0])
    const data = [one, one]
    return (
      <div className="h-[90px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={['dataMin', 'dataMax']} reversed={reversed} />
            <Tooltip content={<MiniTip color={color} />} cursor={false} />
            <Line
              type="monotone" dataKey="v" stroke={color} strokeWidth={2}
              dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }
  const data = points.map(mk)
  const vals = data.map(d => d.v)
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const pad = (maxV - minV) * 0.18 || 1
  return (
    <div className="h-[90px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[minV - pad, maxV + pad]} reversed={reversed} />
          <Tooltip content={<MiniTip color={color} />} cursor={{ stroke: color, strokeOpacity: 0.35, strokeDasharray: '3 3' }} />
          <Line
            type="monotone" dataKey="v" stroke={color} strokeWidth={2}
            dot={{ r: 2, fill: color, strokeWidth: 0 }} activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Move card (block) ──────────────────────────────────────────────────────────

function MoveCard({ move, onClick }) {
  const meta = {
    strength: { icon: Dumbbell, cls: 'bg-blue-500/10 text-blue-400',   chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   line: '#60a5fa' },
    cardio:   { icon: Activity, cls: 'bg-amber-500/10 text-amber-400', chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20', line: '#fbbf24' },
  }[move.type] ?? { icon: Dumbbell, cls: 'bg-muted text-muted-foreground', chip: 'bg-muted text-muted-foreground border-border', line: '#94a3b8' }
  const Icon = meta.icon

  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/30 transition-colors"
    >
      {/* Title row — icon + name + variant badge */}
      <div className="flex items-center gap-2.5">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{move.label}</p>
        {/* Variant badge — which variant the graph below represents (collapsed
            families: bodyweight tier, Sled PUSH/DRAG, Swimming stroke, admin
            family short label). */}
        {move.badge && (
          <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
            {move.badge}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>

      {/* Mini progress graph */}
      <MiniGraph points={move.points} color={meta.line} reversed={move.reversed} />

      {/* PR / best + recency, stacked under the graph */}
      <div className="flex flex-col gap-0.5">
        <p className={`text-xs font-semibold tabular-nums ${move.type === 'cardio' ? 'text-amber-400' : 'text-blue-400'}`}>
          {move.bestText || '—'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {move.recencyText || `${move.count} ${move.count === 1 ? 'entry' : 'entries'}`}
        </p>
      </div>
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserActivity({ userId }) {
  const [, navigate] = useLocation()
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [view,    setView]    = useState('strength')

  // Movements table (cached) — used to detect equipment / bodyweight tier
  // eligibility, exactly as the athlete index does via useMovements().
  const dbMovements = useMovements()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const efRes = await supabase.from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      setEfforts(efRes.data || [])
      setLoading(false)
    }
    load()
  }, [userId])

  // ── Admin-added variant families (parent → children) ──────────────────────
  // Build childName → { parentName, shortLabel } from the movements catalog so
  // we can collapse a family's children (e.g. "Planche Hold [Tuck]" /
  // "[Straddle]" / "[Full]") into ONE row keyed by the PARENT ("Planche Hold"),
  // mirroring the athlete strength index. The badge = variant_short_label of
  // the most-recently-logged child; the row routes to the PARENT name so the
  // AdminEffortDetail dispatch renders the consolidated family detail.
  const familyChildMap = useMemo(() => {
    const byId = {}
    dbMovements.forEach(m => { byId[m.id] = m })
    const map = {}
    dbMovements.forEach(m => {
      if (!m.parent_movement_id) return
      const parent = byId[m.parent_movement_id]
      if (!parent) return
      map[m.name] = { parentName: parent.name, shortLabel: m.variant_short_label || null }
    })
    return map
  }, [dbMovements])

  // Movement record lookup by name — for equipment detection (carry / assisted).
  const movementByName = useMemo(() => {
    const map = {}
    dbMovements.forEach(m => { map[m.name] = m })
    return map
  }, [dbMovements])

  // ── Group efforts into collapsed family rows ──────────────────────────────
  const { strengthMoves, cardioMoves } = useMemo(() => {
    const strengthMap = {}
    const cardioMap   = {}

    // Parse the progression metric for ONE strength effort, given the group's
    // equipment hint. Mirrors the matching detail surface:
    //   carry    → weight   (parseCarryWeight)
    //   assisted → assistance, LOWER better (parseAssistance)
    //   else     → 1RM if present, else hold-seconds, else reps
    // Returns { val, unit, kind } or null. `kind` drives the PR line formatter.
    function strengthMetric(e, equipment) {
      if (equipment === 'carry') {
        // Workload = weight × distance. Use the DISPLAY distance (lb logs → ft,
        // else m) so the card's workload numbers match the detail page's chart
        // and the athlete app. `val` drives the graph + best comparison; weight +
        // distM ride along for the "w × d" best line.
        const c = parseCarryWD(e.label)
        if (!c) return null
        const distDisp = c.unit === 'lb' ? c.distM / 0.3048 : c.distM
        return { val: Math.round(c.weight * distDisp), unit: c.unit, kind: 'workload', weight: c.weight, distM: c.distM }
      }
      if (equipment === 'assisted') {
        const a = parseAssistance(e.label)
        return a ? { val: a.val, unit: a.unit, kind: 'assist' } : null
      }
      const rm = parseOneRM(e.value)
      if (rm) return { val: rm.val, unit: rm.unit, kind: 'onerm' }
      const secs = parseHoldSecs(e.value)
      if (secs !== null) return { val: secs, unit: 'sec', kind: 'hold' }
      const reps = parseReps(e.label)
      if (reps !== null) return { val: reps, unit: 'reps', kind: 'reps' }
      return null
    }

    // efforts arrive newest-first; track the most-recent variant by comparing
    // created_at so the badge always reflects the latest logged variant
    // regardless of map insertion order.
    efforts.forEach(e => {
      // Exercise / activity name is everything before the first ' · '
      const head = e.label.split(' · ')[0]
      const ts   = new Date(e.created_at).getTime()

      if (e.type === 'strength') {
        // ── Sled Work consolidation ────────────────────────────────────────
        const sledVariant = sledVariantFromName(head)
        if (sledVariant !== null) {
          const key = SLED_WORK_BASE_NAME
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'sled', count: 0,
            maxTs: -1, metricKind: 'weight', unit: 'lb',
            byVariant: {}, // variant → { best, unit, points: [{ts,val}] }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const m = strengthMetric(e, 'carry') // sled is carry-equipment → workload (w × d)
          if (m) {
            const v = g.byVariant[sledVariant] ??= { best: null, unit: m.unit, points: [] }
            v.points.push({ ts, val: m.val, disp: `Workload: ${m.val}` })
            if (v.best === null || m.val > v.best) {
              v.best = m.val; v.unit = m.unit
              v.bestW = m.weight; v.bestWUnit = m.unit; v.bestDistM = m.distM
            }
          }
          return
        }

        // ── Admin-added variant family consolidation ───────────────────────
        // If this effort's movement head is a family CHILD, group it under the
        // PARENT name. Badge = variant_short_label of the HARDEST/best variant
        // (no known hardness order → best metric value). navName = PARENT so
        // tapping routes to the consolidated family detail. Runs AFTER the Sled
        // block (Sled is hardcoded, not catalog-driven).
        const family = familyChildMap[head]
        if (family) {
          const key = family.parentName
          // The family's metric kind comes from the PARENT movement's equipment.
          const parentEquip = movementByName[key]?.equipment
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'family', count: 0,
            maxTs: -1, parentEquip,
            byVariant: {}, // childShortLabel → { best, unit, kind, points }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const m = strengthMetric(e, parentEquip)
          if (m) {
            const vk = family.shortLabel || head // group by short label (fallback child name)
            const v = g.byVariant[vk] ??= { best: null, unit: m.unit, kind: m.kind, points: [], short: family.shortLabel }
            v.points.push({ ts, val: m.val, disp: fmtMetricDisp(m.kind, m.val, m.unit) })
            const better = v.best === null
              || (m.kind === 'assist' ? m.val < v.best : m.val > v.best)
            if (better) { v.best = m.val; v.unit = m.unit }
          }
          return
        }

        // ── Bodyweight assist-tier consolidation ───────────────────────────
        const tier      = bwTierFromVariantName(head)
        const isVariant = tier !== 'rx'
        const base      = isVariant ? bwBaseName(head) : head
        const rec       = movementByName[base]
        const isBodyweight = rec?.equipment === 'bodyweight'
        // Only Pull-Up / Dip / Chin-Up family (band/knee eligible) movements
        // actually have tier variants — gate the badge on that, mirroring the
        // athlete's `canHaveTiers`. A plain bodyweight movement (Plank, Leg
        // Raise) never shows a tier badge even though it's bodyweight.
        const canHaveTiers = !!(rec?.band_assist || rec?.knee_assist)
        if (isBodyweight && (isVariant || canHaveTiers)) {
          const key = base
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'bw', count: 0,
            maxTs: -1, highestTier: tier, canHaveTiers,
            byTier: {}, // tier → { best, points: [{ts,val}] } — reps metric
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          g.canHaveTiers = g.canHaveTiers || canHaveTiers
          if (BW_TIER_RANK[tier] > BW_TIER_RANK[g.highestTier]) g.highestTier = tier
          // Bodyweight tiers (and Full-RX) store rep-count efforts — plot reps,
          // matching the bodyweight detail's per-tier reps-over-time chart.
          const reps = parseReps(e.label)
          if (reps !== null) {
            const v = g.byTier[tier] ??= { best: 0, points: [] }
            v.points.push({ ts, val: reps, disp: `${reps} reps` })
            if (reps > v.best) v.best = reps
          }
          return
        }

        // ── Regular strength movement (no variants) ────────────────────────
        const key = head
        const equip = movementByName[key]?.equipment
        const g = strengthMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0,
          maxTs: -1, best: null, unit: null, metricKind: null, points: [], equip,
        }
        g.count++
        if (ts > g.maxTs) g.maxTs = ts
        const m = strengthMetric(e, equip)
        if (m) {
          g.metricKind = m.kind
          g.points.push({ ts, val: m.val, disp: fmtMetricDisp(m.kind, m.val, m.unit) })
          const better = g.best === null
            || (m.kind === 'assist' ? m.val < g.best : m.val > g.best)
          if (better) {
            g.best = m.val; g.unit = m.unit
            // Carry (workload): remember the best effort's weight + distance
            // for the "w × d" best line.
            if (m.kind === 'workload') { g.bestW = m.weight; g.bestWUnit = m.unit; g.bestDistM = m.distM }
          }
        }
      } else if (e.type === 'cardio') {
        // ── Swimming stroke consolidation ──────────────────────────────────
        if (isSwimHead(head)) {
          const key = SWIMMING_BASE_NAME
          const g = cardioMap[key] ??= {
            label: key, navName: key, kind: 'swim', count: 0,
            maxTs: -1, byStroke: {}, // stroke → { best, str, lowerBetter, points }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const stroke = swimStrokeFromHead(head)
          const parsed = parseCardioBest(e.value)
          if (parsed) {
            const v = g.byStroke[stroke] ??= { best: null, str: null, lowerBetter: parsed.lowerBetter, points: [] }
            v.lowerBetter = parsed.lowerBetter
            v.points.push({ ts, val: parsed.val, disp: e.value })
            const better = v.best === null
              || (parsed.lowerBetter ? parsed.val < v.best : parsed.val > v.best)
            if (better) { v.best = parsed.val; v.str = e.value }
          }
          return
        }

        // ── Rucking workload (cardio tab, but carry-like: pack × distance) ──
        // Rucking improves on two axes (heavier pack OR farther), so we plot a
        // workload score = packLb × distMi instead of pace — mirrors the
        // rucking detail's single workload chart.
        if (head === 'Rucking') {
          const key = head
          const g = cardioMap[key] ??= {
            label: key, navName: key, kind: 'ruck', count: 0,
            maxTs: -1, best: null, bestW: null, bestDistMi: null, points: [],
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const r = parseRuckWD(e.label)
          if (r) {
            const wl = r.packLb * r.distMi
            g.points.push({ ts, val: wl, disp: `Workload: ${Math.round(wl)}` })
            if (g.best === null || wl > g.best) { g.best = wl; g.bestW = r.packLb; g.bestDistMi = r.distMi }
          }
          return
        }

        // ── Regular cardio activity (no variants) ──────────────────────────
        const key = head
        const g = cardioMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0,
          maxTs: -1, best: null, str: null, lowerBetter: false, points: [],
        }
        g.count++
        if (ts > g.maxTs) g.maxTs = ts
        // Direction-aware best across ALL cardio formats (pace, speed, cal/min,
        // floors/min, distance) — not just "/km" pace.
        const parsed = parseCardioBest(e.value)
        if (parsed) {
          g.lowerBetter = parsed.lowerBetter
          g.points.push({ ts, val: parsed.val, disp: e.value })
          const better = g.best === null
            || (parsed.lowerBetter ? parsed.val < g.best : parsed.val > g.best)
          if (better) { g.best = parsed.val; g.str = e.value }
        }
      }
    })

    const sortAsc = pts => [...pts].sort((a, b) => a.ts - b.ts)

    // ── Build strength cards ──────────────────────────────────────────────
    const strengthMoves = Object.values(strengthMap).map(d => {
      let badge = null
      let points = []
      let bestText = '—'
      let reversed = false

      if (d.kind === 'sled') {
        // Best-load variant (parallel — no hardness order).
        const variants = Object.entries(d.byVariant)
        const winner = variants.reduce((best, [k, v]) =>
          (best === null || (v.best ?? -Infinity) > (best[1].best ?? -Infinity)) ? [k, v] : best, null)
        if (winner) {
          const [vk, v] = winner
          badge = vk === 'push' ? 'PUSH' : 'DRAG'
          points = sortAsc(v.points)
          bestText = v.bestW != null ? `Best ${fmtCarryWorkloadBest(v.bestW, v.bestWUnit, v.bestDistM)}` : '—'
        }
      } else if (d.kind === 'family') {
        // Hardest variant has no reliable order → pick best metric value.
        const variants = Object.entries(d.byVariant)
        const winner = variants.reduce((best, [k, v]) => {
          if (best === null) return [k, v]
          const bv = best[1].best, cv = v.best
          if (bv === null) return [k, v]
          if (cv === null) return best
          // assist lower-is-better; everything else higher-is-better.
          const cWins = v.kind === 'assist' ? cv < bv : cv > bv
          return cWins ? [k, v] : best
        }, null)
        if (winner) {
          const [, v] = winner
          badge = v.short || null
          points = sortAsc(v.points)
          reversed = v.kind === 'assist'
          bestText = formatStrengthBest(v.best, v.unit, v.kind)
        }
      } else if (d.kind === 'bw') {
        // Highest tier reached drives badge + graph (its reps series).
        badge = d.canHaveTiers ? BW_TIER_BADGE[d.highestTier] : null
        const v = d.byTier[d.highestTier]
        if (v) {
          points = sortAsc(v.points)
          bestText = v.best > 0 ? `Best ${v.best} reps` : '—'
        }
      } else {
        // plain
        points = sortAsc(d.points)
        reversed = d.metricKind === 'assist'
        bestText = d.metricKind === 'workload'
          ? (d.bestW != null ? `Best ${fmtCarryWorkloadBest(d.bestW, d.bestWUnit, d.bestDistM)}` : '—')
          : formatStrengthBest(d.best, d.unit, d.metricKind)
      }

      return {
        label: d.label, navName: d.navName, type: 'strength', count: d.count,
        badge, points, reversed, bestText,
        recencyText: fmtRecency(d.maxTs),
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    // ── Build cardio cards ────────────────────────────────────────────────
    const cardioMoves = Object.values(cardioMap).map(d => {
      let badge = null
      let points = []
      let bestText = '—'
      let reversed = false

      if (d.kind === 'swim') {
        // Best-pace stroke (parallel — no hardness order). Pace lowerBetter.
        const strokes = Object.entries(d.byStroke)
        const winner = strokes.reduce((best, [k, v]) => {
          if (best === null || v.best === null) return v.best === null ? best : (best === null ? [k, v] : best)
          const bv = best[1].best, cv = v.best
          const cWins = v.lowerBetter ? cv < bv : cv > bv
          return cWins ? [k, v] : best
        }, null)
        if (winner) {
          const [stroke, v] = winner
          badge = SWIM_STROKE_BADGE[stroke]
          points = sortAsc(v.points)
          reversed = v.lowerBetter
          bestText = v.str ? `Best ${v.str}` : '—'
        }
      } else if (d.kind === 'ruck') {
        // Workload (pack weight × distance) — higher = better, no reversal.
        points = sortAsc(d.points)
        reversed = false
        bestText = d.bestW != null ? `Best ${d.bestW} lb × ${d.bestDistMi} mi` : '—'
      } else {
        points = sortAsc(d.points)
        reversed = d.lowerBetter
        bestText = d.str ? `Best ${d.str}` : '—'
      }

      return {
        label: d.label, navName: d.navName, type: 'cardio', count: d.count,
        badge, points, reversed, bestText,
        recencyText: fmtRecency(d.maxTs),
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    return { strengthMoves, cardioMoves }
  }, [efforts, dbMovements, familyChildMap, movementByName])

  const visibleMoves = view === 'cardio' ? cardioMoves : strengthMoves

  function handleMoveClick(move) {
    // Navigate to the BASE / consolidated route. The admin detail dispatchers
    // (AdminEffortDetail / AdminCardioDetail) recognise "Sled Work",
    // "Swimming", and bodyweight base names and self-fetch every variant.
    navigate(`/admin/user/${userId}/effort/${move.type}/${encodeURIComponent(move.navName)}`)
  }

  return (
    <div className="space-y-4">

      {/* Segmented Strength ⇄ Cardio toggle */}
      <div className="border border-border rounded-lg p-0.5 inline-flex">
        {[
          { id: 'strength', label: 'Strength', icon: Dumbbell },
          { id: 'cardio',   label: 'Cardio',   icon: Activity },
        ].map(t => {
          const Icon = t.icon
          const active = view === t.id
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{t.label}
            </button>
          )
        })}
      </div>

      {/* Move cards for the selected type */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleMoves.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {view === 'cardio' ? 'No cardio logged yet' : 'No strength logged yet'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleMoves.map(move => (
            <MoveCard
              key={`${move.type}-${move.navName}`}
              move={move}
              onClick={() => handleMoveClick(move)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// PR-line formatter for strength metrics by kind.
function formatStrengthBest(val, unit, kind) {
  if (val === null || val === undefined) return '—'
  switch (kind) {
    case 'onerm':  return `Best ${val} ${unit} 1RM`
    case 'hold':   return `Best ${fmtHold(val)}`
    case 'reps':   return `Best ${val} reps`
    case 'weight': return `Best ${val} ${unit}`
    case 'assist': return `Best ${val} ${unit} assist`
    default:       return `Best ${val}${unit ? ` ${unit}` : ''}`
  }
}
