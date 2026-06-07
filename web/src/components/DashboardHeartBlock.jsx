// Heart snapshot block for the client-detail Dashboard tab.
// Main graph = the mobile HrRangeChart zone-band design (per day: resting dot,
// avg dot, peak-zone gradient band) via the shared HrZoneChart. Data comes from
// the shared summariseHeartDays helper (hr_samples + wearable_workouts) so the
// chart is IDENTICAL to the Heart detail page. Quick stats = avg resting, latest
// peak, steps today. Click-through opens the full Heart tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Heart } from 'lucide-react'
import HrZoneChart from './HrZoneChart'
import { summariseHeartDays } from '../lib/heartDaily'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

function nDaysAgoIso(n) { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (n - 1)); return x.toISOString() }
function startOfTodayIso() { const x = new Date(); x.setHours(0, 0, 0, 0); return x.toISOString() }
// HRmax = 220 - age (caller's birthdate); fallbacks mirror the mobile heart page.
function estimateHrMax(birthdate) {
  if (!birthdate) return 180
  const b = new Date(birthdate)
  if (isNaN(b)) return 180
  const t = new Date()
  let age = t.getFullYear() - b.getFullYear()
  const md = t.getMonth() - b.getMonth()
  if (md < 0 || (md === 0 && t.getDate() < b.getDate())) age--
  if (age < 10 || age > 100) return 180
  return 220 - age
}

export default function DashboardHeartBlock({ userId, profile, onViewAll }) {
  const [state, setState] = useState(null) // { hr, steps, workouts }
  const hrMax = estimateHrMax(profile?.birthdate)

  useEffect(() => {
    if (!userId) return
    let alive = true
    const since = nDaysAgoIso(7)
    Promise.all([
      supabase.from('hr_samples').select('measured_at, bpm, workout_id').eq('user_id', userId).gte('measured_at', since).order('measured_at', { ascending: true }),
      supabase.from('step_samples').select('start_at, steps').eq('user_id', userId).gte('start_at', since).order('start_at', { ascending: true }),
      supabase.from('wearable_workouts').select('start_at, max_bpm').eq('user_id', userId).gte('start_at', since),
    ]).then(([hrRes, stepRes, woRes]) => {
      if (!alive) return
      setState({ hr: hrRes.data || [], steps: stepRes.data || [], workouts: woRes.data || [] })
    })
    return () => { alive = false }
  }, [userId])

  const { chartData, stats, hasData } = useMemo(() => {
    if (!state) return { chartData: [], stats: [], hasData: false }
    const { hr, steps, workouts } = state
    const hasData = hr.length > 0 || steps.length > 0

    const chartData = summariseHeartDays(hr, workouts)

    const restings = chartData.map(d => d.resting).filter(v => v != null)
    const restingAvg = restings.length ? Math.round(restings.reduce((a, b) => a + b, 0) / restings.length) : null
    const latestPeak = chartData.length ? chartData[chartData.length - 1].peak : null
    const todayStart = startOfTodayIso()
    const stepsToday = steps.filter(r => r.start_at >= todayStart).reduce((s, r) => s + (r.steps || 0), 0) || null

    const stats = [
      { label: 'Avg resting', value: restingAvg, unit: 'bpm', tint: 'text-emerald-400' },
      { label: 'Latest peak', value: latestPeak, unit: 'bpm', tint: 'text-red-400' },
      { label: 'Steps today', value: stepsToday != null ? stepsToday.toLocaleString() : null, unit: '', tint: 'text-amber-400' },
    ]
    return { chartData, stats, hasData }
  }, [state])

  return (
    <SnapshotCard icon={Heart} iconTint="text-red-400" title="Heart" onViewAll={onViewAll}>
      {state === null ? (
        <SnapshotLoading />
      ) : !hasData ? (
        <SnapshotEmpty>No heart-rate data synced in the last 7 days.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-2 pt-3 pb-1">
            {chartData.length >= 1 && <HrZoneChart data={chartData} hrMax={hrMax} compact />}
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
