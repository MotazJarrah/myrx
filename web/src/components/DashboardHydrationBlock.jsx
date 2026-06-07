// Hydration snapshot block for the client-detail Dashboard tab.
// Main graph = last-7-days intake bars (cyan) with a bodyweight-based daily-target
// reference line. Quick stats = today (cups), % of target, 7-day avg. Mirrors
// AdminUserHydration's data (water_logs + latest bodyweight), BHI milk x1.5
// weighting, and 35 mL/kg target; display in the COACH's fluid unit (useAuth).
// Click-through opens the full Hydration tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Droplet } from 'lucide-react'
import { BarChart, Bar, YAxis, ReferenceLine, Cell, ResponsiveContainer } from 'recharts'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

const ML_PER_OZ = 29.5735, LB_TO_KG = 0.45359237, ML_PER_CUP = 250, ML_PER_KG_TARGET = 35
const CYAN = 'hsl(189 94% 43%)'
const CYAN_FAINT = 'hsl(189 94% 43% / 0.18)'
function mlToOz(ml) { return ml / ML_PER_OZ }
function toKg(w, unit) { return unit === 'lb' ? Number(w) * LB_TO_KG : Number(w) }
function fmtVolume(ml, unit) { return unit === 'mL' ? Math.round(ml) : Math.round(mlToOz(ml)) }
function defaultTargetMl(gender) { return gender === 'male' ? 3000 : gender === 'female' ? 2200 : 2500 }
function multiplierFor(type) { return type === 'milk' ? 1.5 : 1 } // BHI: milk hydrates ~1.5x
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function dayKey(d) { return startOfDay(d).toISOString().slice(0, 10) }

export default function DashboardHydrationBlock({ userId, profile, onViewAll }) {
  const { profile: coach } = useAuth()
  const fluidUnit = coach?.fluid_unit === 'mL' ? 'mL' : 'oz'
  const [data, setData] = useState(null) // { logs, bwKg }

  useEffect(() => {
    if (!userId) return
    let alive = true
    const since = startOfDay(new Date()); since.setDate(since.getDate() - 6)
    Promise.all([
      supabase.from('water_logs').select('amount_ml, drink_type, logged_at').eq('user_id', userId).gte('logged_at', since.toISOString()).order('logged_at', { ascending: false }),
      supabase.from('bodyweight').select('weight, unit').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
    ]).then(([wRes, bwRes]) => {
      if (!alive) return
      const bw = (bwRes.data && bwRes.data[0]) || null
      setData({ logs: wRes.data || [], bwKg: bw ? toKg(bw.weight, bw.unit) : null })
    })
    return () => { alive = false }
  }, [userId])

  const targetMl = useMemo(() => {
    if (!data) return 0
    const profileKg = profile?.current_weight ? toKg(Number(profile.current_weight), profile.weight_unit || 'lb') : null
    const kg = data.bwKg ?? profileKg
    if (kg > 0) return Math.round(kg * ML_PER_KG_TARGET)
    return defaultTargetMl(profile?.gender)
  }, [data, profile])

  const { chartData, stats, hasData } = useMemo(() => {
    if (!data) return { chartData: [], stats: [], hasData: false }
    const buckets = []
    const base = startOfDay(new Date())
    for (let off = -6; off <= 0; off++) {
      const d = new Date(base); d.setDate(base.getDate() + off)
      buckets.push({ key: dayKey(d), label: off === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }), ml: 0 })
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]))
    for (const l of data.logs) {
      const k = dayKey(l.logged_at)
      if (byKey[k]) byKey[k].ml += Number(l.amount_ml || 0) * multiplierFor(l.drink_type)
    }
    const chartData = buckets.map(b => ({ key: b.key, label: b.label, value: fluidUnit === 'mL' ? Math.round(b.ml) : Math.round(mlToOz(b.ml)) }))

    const todayMl = byKey[dayKey(new Date())]?.ml || 0
    const cupsDone = Math.round(todayMl / ML_PER_CUP)
    const cupsTarget = Math.max(1, Math.round(targetMl / ML_PER_CUP))
    const pct = targetMl > 0 ? Math.min(100, Math.round((todayMl / targetMl) * 100)) : 0
    const avgMl = buckets.reduce((s, b) => s + b.ml, 0) / 7

    const stats = [
      { label: 'Today', value: `${cupsDone}/${cupsTarget}`, unit: 'cups', tint: 'text-cyan-400' },
      { label: '% target', value: pct, unit: '%', tint: 'text-foreground' },
      { label: '7-day avg', value: fmtVolume(avgMl, fluidUnit), unit: fluidUnit, tint: 'text-muted-foreground' },
    ]
    return { chartData, stats, hasData: data.logs.length > 0 }
  }, [data, targetMl, fluidUnit])

  const targetVal = fluidUnit === 'mL' ? Math.round(targetMl) : Math.round(mlToOz(targetMl))
  const yMax = useMemo(() => {
    const vals = chartData.map(d => d.value)
    return Math.ceil(Math.max(targetVal, ...vals, 1) * 1.1)
  }, [chartData, targetVal])

  return (
    <SnapshotCard icon={Droplet} iconTint="text-cyan-400" title="Hydration" onViewAll={onViewAll}>
      {data === null ? (
        <SnapshotLoading />
      ) : !hasData ? (
        <SnapshotEmpty>No water logged in the last 7 days.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                <YAxis hide domain={[0, yMax]} />
                <ReferenceLine y={targetVal} stroke={CYAN} strokeDasharray="3 3" strokeOpacity={0.55} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {chartData.map(d => <Cell key={d.key} fill={d.value > 0 ? CYAN : CYAN_FAINT} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
