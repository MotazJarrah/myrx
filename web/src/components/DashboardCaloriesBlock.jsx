// Calories snapshot block for the client-detail Dashboard tab.
// Main graph = the 14-day intake mini-trend (the "line + dots + dashed-target"
// chart the user cares about, lifted from CalorieStrip's CalorieGraph, minus the
// day tiles). Quick stats = today's intake, 14-day avg, days on target.
// Receives the already-fetched calorie plan (existingPlan) so the target matches
// the Calories tab exactly. Click-through opens the full Calories tab.

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Apple } from 'lucide-react'
import { calcFullPlan } from '../lib/calorieFormulas'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

function isoDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10) }
function buildWindow(n = 14) {
  const out = []
  const base = new Date(); base.setHours(0, 0, 0, 0)
  for (let off = -(n - 1); off <= 0; off++) { const d = new Date(base); d.setDate(base.getDate() + off); out.push(isoDay(d)) }
  return out
}
function statusFor(cal, t) {
  if (cal == null) return 'empty'
  if (t == null) return 'logged'
  const r = cal / t
  if (r >= 0.92 && r <= 1.08) return 'on'
  if (r >= 0.80 && r <= 1.20) return 'near'
  return 'off'
}
const DOT = { on: 'rgb(52,211,153)', near: 'rgb(251,191,36)', off: 'rgb(248,113,113)', logged: 'rgb(148,163,184)' }

function fmtDayLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The line-chart-under-days, standalone (no tiles). Measures its own width so
// the dots stay round (1:1, no preserveAspectRatio stretch). Hovering a dot
// shows a floating date + kcal tooltip (matches the Recharts tooltip look).
function CaloriesMiniGraph({ days, logs, target }) {
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    setW(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 72, PADY = 12, innerH = H - PADY * 2, N = days.length, GAP = 6
  const colW = N > 0 ? (W - GAP * (N - 1)) / N : 0
  const colCenter = i => i * (colW + GAP) + colW / 2

  const present = days.map(iso => logs[iso] ?? null).filter(c => c != null)
  if (present.length === 0) {
    return (
      <div ref={wrapRef} className="w-full text-center text-[11px] text-muted-foreground/50">
        No intake logged in the last 14 days
      </div>
    )
  }

  const allCal = [...present, ...(target != null ? [target] : [])]
  const minCal = Math.min(...allCal), maxCal = Math.max(...allCal)
  const span = (maxCal - minCal) || 200
  const toY = c => PADY + (1 - (c - minCal) / span) * innerH
  const pts = days
    .map((iso, i) => ({ iso, i, cal: logs[iso] ?? null }))
    .filter(p => p.cal != null)
    .map(p => ({ x: colCenter(p.i), y: toY(p.cal), st: statusFor(p.cal, target), iso: p.iso, cal: p.cal }))
  const targetY = target != null ? toY(target) : null
  const poly = pts.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div ref={wrapRef} className="w-full relative">
      {W > 0 && (
        <svg width={W} height={H}>
          {targetY != null && (
            <line x1={colW / 2} x2={W - colW / 2} y1={targetY} y2={targetY} stroke="hsl(var(--muted-foreground) / 0.2)" strokeDasharray="3 3" />
          )}
          {pts.length > 1 && (
            <polyline points={poly} fill="none" stroke="hsl(var(--muted-foreground) / 0.30)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {pts.map((p, i) => <circle key={`d${i}`} cx={p.x} cy={p.y} r={4} fill={DOT[p.st]} />)}
          {pts.map((p, i) => (
            <circle
              key={`h${i}`} cx={p.x} cy={p.y} r={10} fill="transparent" style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2 py-1 shadow-md"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="text-[10px] text-muted-foreground">{fmtDayLabel(hover.iso)}</div>
          <div className="text-xs font-mono tabular-nums font-semibold text-foreground">{Math.round(hover.cal)} kcal</div>
        </div>
      )}
    </div>
  )
}

export default function DashboardCaloriesBlock({ userId, profile, plan, onViewAll }) {
  const [logsByDay, setLogsByDay] = useState(null)
  const days = useMemo(() => buildWindow(14), [])

  useEffect(() => {
    if (!userId) return
    let alive = true
    const from = days[0], to = days[days.length - 1]
    supabase
      .from('food_logs')
      .select('log_date, calories')
      .eq('user_id', userId)
      .gte('log_date', from)
      .lte('log_date', to)
      .then(({ data }) => {
        if (!alive) return
        const map = {}
        for (const r of (data || [])) { map[r.log_date] = (map[r.log_date] || 0) + Number(r.calories || 0) }
        setLogsByDay(map)
      })
    return () => { alive = false }
  }, [userId, days])

  // Full plan (BMR/TDEE/target/energy) from the already-fetched calorie plan.
  const result = useMemo(() => {
    if (!plan || !profile) return null
    try { return calcFullPlan(profile, plan) } catch { return null }
  }, [plan, profile])
  const target = result?.dailyTarget ?? null

  const stats = useMemo(() => {
    if (!result) return []
    const eb = Math.round(result.energyAdj)
    return [
      { label: 'Daily target', value: result.dailyTarget, unit: 'kcal', tint: 'text-amber-400' },
      { label: 'BMR', value: Math.round(result.bmr), unit: 'kcal', tint: 'text-foreground' },
      { label: 'TDEE', value: Math.round(result.tdee), unit: 'kcal', tint: 'text-foreground' },
      { label: 'Energy balance', value: `${eb > 0 ? '+' : ''}${eb}`, unit: 'kcal', tint: eb < 0 ? 'text-emerald-400' : eb > 0 ? 'text-amber-400' : 'text-foreground' },
    ]
  }, [result])

  const hasLogs = logsByDay && Object.keys(logsByDay).length > 0

  return (
    <SnapshotCard icon={Apple} iconTint="text-amber-400" title="Calories" onViewAll={onViewAll}>
      {logsByDay === null ? (
        <SnapshotLoading />
      ) : !hasLogs ? (
        <SnapshotEmpty>No food logged in the last 14 days.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-3 flex items-center">
            <CaloriesMiniGraph days={days} logs={logsByDay} target={target} />
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
