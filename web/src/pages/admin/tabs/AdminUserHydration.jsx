import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  Droplet, GlassWater, Droplets, Coffee, Leaf, CupSoda, Milk,
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'

/**
 * AdminUserHydration — READ-ONLY admin mirror of the athlete's mobile Hydration
 * page (mobile/app/(app)/hydration.tsx). Shows the coach exactly what the
 * athlete sees: today's progress vs daily target (friendly cups readout),
 * today's logged drinks, a 7-day intake chart, and the science attribution.
 *
 * No inputs, no logging, no drink picker — display only. Coaching add-ons land
 * in a later phase.
 *
 * Data: water_logs (id, user_id, amount_ml, drink_type, logged_at, created_at).
 * Target derivation + Beverage-Hydration-Index weighting are reproduced from
 * the mobile page so the headline numbers (target, today's progress) match.
 */

// ── Volume / target constants (mirrored from mobile hydration.tsx) ────────────
const ML_PER_OZ = 29.5735
const LB_TO_KG = 0.45359237
// 35 mL per kg of bodyweight — National Academies / Mayo Clinic / EFSA basis.
const ML_PER_KG_TARGET = 35
const ML_PER_CUP = 250

function mlToOz(ml) { return ml / ML_PER_OZ }

/** Render `ml` in the user's display unit, rounded to whole numbers. */
function fmtVolume(ml, unit) {
  if (unit === 'mL') return String(Math.round(ml))
  return String(Math.round(mlToOz(ml)))
}

/** Convert a bodyweight reading to kg (rows store weight in their own unit). */
function toKg(weight, unit) {
  return unit === 'lb' ? weight * LB_TO_KG : weight
}

/** No logged weight — fall back to population beverage targets. */
function defaultTargetMl(gender) {
  if (gender === 'male') return 3000
  if (gender === 'female') return 2200
  return 2500
}

// ── Drink registry — eligible beverages + BHI multipliers (mirrored) ──────────
// water / sparkling / coffee / tea / diet-soda hydrate ~like water (1.0);
// milk's protein + fat + salts make it linger → 1.5.
const DRINKS = [
  { type: 'water',     label: 'Water',     multiplier: 1.0, Icon: GlassWater, color: 'text-cyan-400' },
  { type: 'sparkling', label: 'Sparkling', multiplier: 1.0, Icon: Droplets,   color: 'text-sky-400' },
  { type: 'coffee',    label: 'Coffee',    multiplier: 1.0, Icon: Coffee,     color: 'text-amber-400' },
  { type: 'tea',       label: 'Tea',       multiplier: 1.0, Icon: Leaf,       color: 'text-emerald-400' },
  { type: 'soda',      label: 'Diet soda', multiplier: 1.0, Icon: CupSoda,    color: 'text-violet-400' },
  { type: 'milk',      label: 'Milk',      multiplier: 1.5, Icon: Milk,       color: 'text-blue-300' },
]
const DRINK_BY_TYPE = DRINKS.reduce((m, d) => { m[d.type] = d; return m }, {})
function metaFor(type) { return DRINK_BY_TYPE[type] ?? DRINK_BY_TYPE.water }
function multiplierFor(type) { return DRINK_BY_TYPE[type]?.multiplier ?? 1 }

// ── Date helpers ──────────────────────────────────────────────────────────────
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function dateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ── 7-day chart ───────────────────────────────────────────────────────────────

function HydrationChart({ buckets, targetMl, displayUnit }) {
  const data = buckets.map(b => ({
    key:   b.key,
    label: b.label,
    // Convert to the athlete's display unit so the axis matches their app.
    value: displayUnit === 'mL' ? Math.round(b.ml) : Math.round(mlToOz(b.ml)),
  }))
  const targetVal = displayUnit === 'mL' ? Math.round(targetMl) : Math.round(mlToOz(targetMl))
  const dataMax = Math.max(targetVal, ...data.map(d => d.value), 1)
  const yMax = Math.ceil(dataMax * 1.1)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground mb-3">
        Last 7 days <span className="font-normal">({displayUnit})</span>
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickCount={4}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.3 }}
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: 12,
            }}
            formatter={(v) => [`${v} ${displayUnit}`, 'Intake']}
          />
          <ReferenceLine
            y={targetVal}
            stroke="hsl(189 94% 43%)"
            strokeDasharray="3 3"
            strokeOpacity={0.55}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700}>
            {data.map(d => (
              <Cell key={d.key} fill={d.value > 0 ? 'hsl(189 94% 43%)' : 'hsl(189 94% 43% / 0.18)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-muted-foreground text-center mt-1">Dashed line = daily target</p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserHydration({ userId, profile }) {
  const [logs,    setLogs]    = useState([])
  const [bwKg,    setBwKg]    = useState(null)
  const [loading, setLoading] = useState(true)

  // The athlete's display unit preference ('oz' default, or 'mL').
  const fluidUnit = profile?.fluid_unit === 'mL' ? 'mL' : 'oz'

  // Window: today + 6 prior days (matches the mobile 7-day fetch).
  const sevenDaysAgo = useMemo(() => {
    const s = startOfDay(new Date())
    s.setDate(s.getDate() - 6)
    return s
  }, [])

  useEffect(() => { load() }, [userId])

  async function load() {
    setLoading(true)
    const [logsRes, bwRes] = await Promise.all([
      supabase
        .from('water_logs')
        .select('id, user_id, amount_ml, drink_type, logged_at, created_at')
        .eq('user_id', userId)
        .gte('logged_at', sevenDaysAgo.toISOString())
        .order('logged_at', { ascending: false }),
      supabase
        .from('bodyweight')
        .select('weight, unit, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    setLogs(logsRes.data || [])
    const bwRow = bwRes.data?.[0]
    if (bwRow?.weight) setBwKg(toKg(Number(bwRow.weight), bwRow.unit))
    else setBwKg(null)
    setLoading(false)
  }

  // ── Derived: daily target (latest bw → profile weight → sex estimate) ────────
  const targetMl = useMemo(() => {
    const profileKg = profile?.current_weight
      ? toKg(Number(profile.current_weight), profile.weight_unit)
      : null
    const kg = bwKg ?? profileKg
    if (kg && kg > 0) return Math.round(kg * ML_PER_KG_TARGET)
    return defaultTargetMl(profile?.gender)
  }, [bwKg, profile])

  const todayKey = useMemo(() => dateKey(new Date()), [])

  // Effective hydration = sum(raw mL × BHI multiplier). Milk over-counts 1.5×.
  const todayEffectiveMl = useMemo(() => {
    return logs
      .filter(l => dateKey(new Date(l.logged_at)) === todayKey)
      .reduce((s, l) => s + Number(l.amount_ml) * multiplierFor(l.drink_type), 0)
  }, [logs, todayKey])

  const todayLogs = useMemo(() => {
    return logs
      .filter(l => dateKey(new Date(l.logged_at)) === todayKey)
      .slice()
      .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
  }, [logs, todayKey])

  const sevenDayBuckets = useMemo(() => {
    const out = []
    const today = startOfDay(new Date())
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = dateKey(d)
      const label = i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
      out.push({ key, label, ml: 0 })
    }
    const idxByKey = {}
    out.forEach((b, i) => { idxByKey[b.key] = i })
    for (const l of logs) {
      const k = dateKey(new Date(l.logged_at))
      const idx = idxByKey[k]
      if (idx != null) out[idx].ml += Number(l.amount_ml) * multiplierFor(l.drink_type)
    }
    return out
  }, [logs])

  // Hero figures — friendly "cups" readout (a cup ≈ 250 mL effective).
  const cupsTarget  = Math.max(1, Math.round(targetMl / ML_PER_CUP))
  const cupsDone    = Math.round(todayEffectiveMl / ML_PER_CUP)
  const pct = targetMl > 0 ? Math.min(100, Math.round((todayEffectiveMl / targetMl) * 100)) : 0

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-4">

      {/* ── Today's progress vs target ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
            <Droplet className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-foreground">Today's hydration</p>
        </div>

        {/* Cups readout — the non-intimidating representation the athlete sees */}
        <div className="flex items-end justify-center gap-1.5">
          <span className="text-3xl font-bold font-mono tabular-nums text-cyan-400">{cupsDone}</span>
          <span className="text-sm text-muted-foreground pb-1">of {cupsTarget} cups</span>
        </div>

        {/* Cup glyphs — visual fill toward the daily target */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {Array.from({ length: cupsTarget }).map((_, i) => (
            <GlassWater
              key={i}
              className={`h-5 w-5 ${i < cupsDone ? 'text-cyan-400' : 'text-cyan-400/20'}`}
            />
          ))}
          {/* Bonus cups beyond target, if any */}
          {cupsDone > cupsTarget && Array.from({ length: cupsDone - cupsTarget }).map((_, i) => (
            <GlassWater key={`extra-${i}`} className="h-5 w-5 text-cyan-300" />
          ))}
        </div>

        {/* Progress bar + exact volume */}
        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-cyan-500/10">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono tabular-nums text-muted-foreground">
              {fmtVolume(todayEffectiveMl, fluidUnit)} / {fmtVolume(targetMl, fluidUnit)} {fluidUnit}
            </span>
            <span className="font-mono tabular-nums text-cyan-400">{pct}%</span>
          </div>
        </div>

        {/* Coach view: athlete helper / eligibility / attribution copy removed (T086) */}
      </div>

      {/* ── 7-day chart ── */}
      <HydrationChart buckets={sevenDayBuckets} targetMl={targetMl} displayUnit={fluidUnit} />

      {/* ── Today's log list ── */}
      {todayLogs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          No water logged yet today.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Today's log</p>
            <p className="text-xs text-muted-foreground">
              {todayLogs.length} {todayLogs.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          <div className="divide-y divide-border">
            {todayLogs.map(l => {
              const meta = metaFor(l.drink_type)
              const Icon = meta.Icon
              return (
                <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 bg-card">
                  <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                  <span className="text-sm text-foreground whitespace-nowrap">{meta.label}</span>
                  {meta.multiplier !== 1 && (
                    <span className="rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-blue-300">
                      ×{meta.multiplier}
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground flex-1">{fmtTime(l.logged_at)}</span>
                  <span className="text-sm font-medium tabular-nums font-mono text-foreground shrink-0">
                    {fmtVolume(Number(l.amount_ml), fluidUnit)} {fluidUnit}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
