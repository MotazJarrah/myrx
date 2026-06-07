// Bodyweight snapshot block for the client-detail Dashboard tab.
// Main graph = weight-over-time line (emerald). Quick stats = current weight,
// 30-day trend, BMI. Mirrors AdminUserBody's data + math; numbers display in the
// COACH's weight unit (useAuth). Click-through opens the full Bodyweight tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Scale } from 'lucide-react'
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

const LB_PER_KG = 2.2046226218
function toKg(w, unit) { return unit === 'kg' ? Number(w) : Number(w) / LB_PER_KG }
function toDisplayUnit(kg, unit) { return unit === 'kg' ? Math.round(kg * 10) / 10 : Math.round(kg * LB_PER_KG * 10) / 10 }
function convertWeight(w, from, to) { return from === to ? Math.round(Number(w) * 10) / 10 : toDisplayUnit(toKg(w, from), to) }
function getHeightM(profile) {
  if (!profile) return null
  const h = Number(profile.current_height)
  if (!h) return null
  return profile.height_unit === 'imperial' ? h * 0.0254 : h / 100 // imperial stored as total inches; metric as cm
}
function calcBMI(kg, m) { return kg && m ? kg / (m * m) : null }
function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Underweight', tint: 'text-sky-400' }
  if (bmi < 25)   return { label: 'Normal',      tint: 'text-emerald-400' }
  if (bmi < 30)   return { label: 'Overweight',  tint: 'text-amber-400' }
  return { label: 'Obese', tint: 'text-red-400' }
}

export default function DashboardBodyweightBlock({ userId, profile, onViewAll }) {
  const { profile: coach } = useAuth()
  const coachUnit = coach?.weight_unit === 'kg' ? 'kg' : 'lb'
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase
      .from('bodyweight')
      .select('id, weight, unit, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => { if (alive) setEntries(data || []) })
    return () => { alive = false }
  }, [userId])

  const chartData = useMemo(() => {
    if (!entries) return []
    return [...entries]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(e => ({ ts: e.created_at, weight: convertWeight(e.weight, e.unit, coachUnit) }))
  }, [entries, coachUnit])

  const domain = useMemo(() => {
    if (chartData.length < 2) return ['auto', 'auto']
    const ws = chartData.map(d => d.weight)
    const minW = Math.min(...ws), maxW = Math.max(...ws)
    const pad = (maxW - minW) * 0.15 || 1
    return [minW - pad, maxW + pad]
  }, [chartData])

  const stats = useMemo(() => {
    if (!entries || entries.length === 0) return []
    const latest = entries[0]
    const currentVal = profile?.current_weight != null
      ? convertWeight(profile.current_weight, profile.weight_unit || 'lb', coachUnit)
      : convertWeight(latest.weight, latest.unit, coachUnit)

    const out = [{ label: 'Current', value: currentVal, unit: coachUnit, tint: 'text-emerald-400' }]

    // 30-day trend (latest vs the entry ~30d ago, else oldest).
    const thirty = Date.now() - 30 * 86400000
    const ref = entries.find(l => new Date(l.created_at).getTime() <= thirty) ?? entries[entries.length - 1]
    if (ref && ref.id !== latest.id) {
      const deltaKg = toKg(latest.weight, latest.unit) - toKg(ref.weight, ref.unit)
      const disp = toDisplayUnit(Math.abs(deltaKg), coachUnit)
      const sign = deltaKg < -0.05 ? '−' : deltaKg > 0.05 ? '+' : '±'
      const tint = deltaKg < -0.05 ? 'text-emerald-400' : deltaKg > 0.05 ? 'text-amber-400' : 'text-foreground'
      out.push({ label: '30-day', value: `${sign}${disp}`, unit: coachUnit, tint })
    }

    // BMI from latest weight (profile.current_weight preferred) + height.
    const latestKg = profile?.current_weight != null
      ? toKg(profile.current_weight, profile.weight_unit || 'lb')
      : toKg(latest.weight, latest.unit)
    const m = getHeightM(profile)
    const bmi = calcBMI(latestKg, m)
    if (bmi) {
      const cat = bmiCategory(bmi)
      out.push({ label: `BMI · ${cat.label}`, value: bmi.toFixed(1), unit: '', tint: cat.tint })
    }
    return out
  }, [entries, profile, coachUnit])

  return (
    <SnapshotCard icon={Scale} iconTint="text-emerald-400" title="Bodyweight" onViewAll={onViewAll}>
      {entries === null ? (
        <SnapshotLoading />
      ) : entries.length === 0 ? (
        <SnapshotEmpty>No weigh-ins logged yet.</SnapshotEmpty>
      ) : (
        <>
          {chartData.length >= 2 && (
            <div className="px-2 pt-3">
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={chartData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <YAxis hide domain={domain} />
                  <Line type="monotone" dataKey="weight" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
