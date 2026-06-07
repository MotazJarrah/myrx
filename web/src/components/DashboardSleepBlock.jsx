// Sleep snapshot block for the client-detail Dashboard tab.
// Main graph = the mobile 7-night SleepConsistency chart (each night's bedtime->
// wake window vs bedtime/wake targets). Quick stats = last night, 7-night avg,
// bedtime target. Mirrors AdminUserSleep's data (sleep_sessions) + age-target
// math. Click-through opens the full Sleep tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Moon } from 'lucide-react'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'
import SleepConsistencyChart, { minsAfter6pm, fmtClock } from './SleepConsistencyChart'

function estimateAge(birthdate) {
  if (!birthdate) return null
  const b = new Date(birthdate)
  if (isNaN(b)) return null
  const a = (Date.now() - b.getTime()) / (365.25 * 86400000)
  return a > 0 && a < 120 ? Math.floor(a) : null
}
function targetHoursForAge(birthdate) {
  const age = estimateAge(birthdate)
  if (age == null) return 7.0
  if (age <= 0) return 15
  if (age <= 1) return 13
  if (age <= 2) return 12
  if (age <= 5) return 11
  if (age <= 12) return 10
  if (age <= 17) return 9
  if (age <= 25) return 7.5
  return 7.0
}
function fmtHoursMinutes(s) {
  if (s == null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export default function DashboardSleepBlock({ userId, profile, onViewAll }) {
  const [sessions, setSessions] = useState(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 29)
    supabase
      .from('sleep_sessions')
      .select('id, start_at, end_at, duration_s')
      .eq('user_id', userId)
      .gte('start_at', since.toISOString())
      .order('start_at', { ascending: false })
      .limit(60)
      .then(({ data }) => { if (alive) setSessions(data || []) })
    return () => { alive = false }
  }, [userId])

  const targetHours = targetHoursForAge(profile?.birthdate)

  const calc = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const last7 = sessions.slice(0, 7)
    const beds = last7.map(s => minsAfter6pm(s.start_at))
    const wakes = last7.map(s => minsAfter6pm(s.end_at))
    const avgBedMin = beds.reduce((a, b) => a + b, 0) / beds.length
    const avgWakeMin = wakes.reduce((a, b) => a + b, 0) / wakes.length
    const targetBedMin = avgWakeMin - targetHours * 60
    const avgDur = last7.reduce((a, s) => a + s.duration_s, 0) / last7.length
    return { last7, avgBedMin, avgWakeMin, targetBedMin, avgDur, latest: sessions[0] }
  }, [sessions, targetHours])

  const stats = useMemo(() => {
    if (!calc) return []
    return [
      { label: 'Last night', value: fmtHoursMinutes(calc.latest.duration_s), unit: '', tint: 'text-indigo-400' },
      { label: '7-night avg', value: fmtHoursMinutes(calc.avgDur), unit: '', tint: 'text-foreground' },
      { label: 'Bedtime target', value: fmtClock(calc.targetBedMin), unit: '', tint: 'text-muted-foreground' },
    ]
  }, [calc])

  return (
    <SnapshotCard icon={Moon} iconTint="text-indigo-400" title="Sleep" onViewAll={onViewAll}>
      {sessions === null ? (
        <SnapshotLoading />
      ) : sessions.length === 0 ? (
        <SnapshotEmpty>No sleep data yet.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-2 pt-3 pb-1">
            {calc && (
              <SleepConsistencyChart
                nights={calc.last7}
                targetBedMin={calc.targetBedMin}
                targetWakeMin={calc.avgWakeMin}
                avgBedMin={calc.avgBedMin}
                compact
              />
            )}
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
