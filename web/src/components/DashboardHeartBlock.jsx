// Heart snapshot block for the client-detail Dashboard tab.
// Main graph = per-day resting (emerald) + avg (sky) HR over the last 7 days.
// Quick stats = latest HR, resting (today's low / 7-day avg), steps today.
// Wearable-sourced; shows a "no data synced" empty state. Click-through opens the
// full Heart tab. Mirrors AdminUserHeart's data sources (hr_samples, step_samples).

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Heart } from 'lucide-react'
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

function localDayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10) }
function nDaysAgoIso(n) { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (n - 1)); return x.toISOString() }
function startOfTodayIso() { const x = new Date(); x.setHours(0, 0, 0, 0); return x.toISOString() }

export default function DashboardHeartBlock({ userId, onViewAll }) {
  const [state, setState] = useState(null) // { hr: [], steps: [] }

  useEffect(() => {
    if (!userId) return
    let alive = true
    const since = nDaysAgoIso(7)
    Promise.all([
      supabase.from('hr_samples').select('measured_at, bpm').eq('user_id', userId).gte('measured_at', since).order('measured_at', { ascending: true }),
      supabase.from('step_samples').select('start_at, steps').eq('user_id', userId).gte('start_at', since).order('start_at', { ascending: true }),
    ]).then(([hrRes, stepRes]) => {
      if (!alive) return
      setState({ hr: hrRes.data || [], steps: stepRes.data || [] })
    })
    return () => { alive = false }
  }, [userId])

  const { chartData, stats, hasData } = useMemo(() => {
    if (!state) return { chartData: [], stats: [], hasData: false }
    const { hr, steps } = state
    const hasData = hr.length > 0 || steps.length > 0

    const byDay = new Map()
    for (const s of hr) {
      const k = localDayKey(s.measured_at)
      if (!byDay.has(k)) byDay.set(k, [])
      byDay.get(k).push(s.bpm)
    }
    const chartData = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, bpms]) => ({
        day,
        resting: Math.min(...bpms),
        avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      }))

    const latest = hr.length ? hr[hr.length - 1].bpm : null
    const todayBpms = byDay.get(localDayKey(new Date()))
    const restingToday = todayBpms ? Math.min(...todayBpms) : null
    const restings = chartData.map(d => d.resting)
    const restingAvg = restings.length ? Math.round(restings.reduce((a, b) => a + b, 0) / restings.length) : null
    const resting = restingToday ?? restingAvg
    const todayStart = startOfTodayIso()
    const stepsToday = steps.filter(r => r.start_at >= todayStart).reduce((s, r) => s + (r.steps || 0), 0) || null

    const stats = [
      { label: 'Latest', value: latest, unit: 'bpm', tint: 'text-red-400' },
      { label: 'Resting', value: resting, unit: 'bpm', tint: 'text-emerald-400' },
      { label: 'Steps today', value: stepsToday != null ? stepsToday.toLocaleString() : null, unit: '', tint: 'text-amber-400' },
    ]
    return { chartData, stats, hasData }
  }, [state])

  const domain = useMemo(() => {
    if (chartData.length < 2) return ['auto', 'auto']
    const vals = chartData.flatMap(d => [d.resting, d.avg]).filter(v => v != null)
    const min = Math.min(...vals), max = Math.max(...vals)
    const pad = (max - min) * 0.15 || 5
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [chartData])

  return (
    <SnapshotCard icon={Heart} iconTint="text-red-400" title="Heart" onViewAll={onViewAll}>
      {state === null ? (
        <SnapshotLoading />
      ) : !hasData ? (
        <SnapshotEmpty>No heart-rate data synced in the last 7 days.</SnapshotEmpty>
      ) : (
        <>
          {chartData.length >= 2 && (
            <div className="px-2 pt-3">
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={chartData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <YAxis hide domain={domain} />
                  <Line type="monotone" dataKey="avg" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="resting" stroke="#34d399" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
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
