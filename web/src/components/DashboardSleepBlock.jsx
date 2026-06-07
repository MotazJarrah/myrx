// Sleep snapshot block for the client-detail Dashboard tab.
// Main graph = sleep-duration-per-night line (indigo) with an age-based target
// reference line. Quick stats = last night, 7-night avg, target. Mirrors
// AdminUserSleep's data (sleep_sessions) + age-target math. Click-through opens
// the full Sleep tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Moon } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'

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
// Minutes after 6pm (so bedtimes that cross midnight stay monotonic).
function minsAfter6pm(iso) {
  const d = new Date(iso)
  let m = d.getHours() * 60 + d.getMinutes() - 18 * 60
  if (m < 0) m += 24 * 60
  return m
}
// minutes-after-6pm -> "h:mm AM/PM" clock string.
function fmtClock(minsAfter6) {
  let ma = Math.round(minsAfter6)
  ma = ((ma % 1440) + 1440) % 1440
  const clock = (ma + 18 * 60) % 1440
  let h = Math.floor(clock / 60)
  const m = clock % 60
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${period}`
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

  const chartData = useMemo(() => {
    if (!sessions) return []
    return [...sessions]
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
      .map(s => ({ ts: s.start_at, hours: Math.round((s.duration_s / 3600) * 10) / 10 }))
  }, [sessions])

  const domain = useMemo(() => {
    if (chartData.length < 2) return ['auto', 'auto']
    const hs = [...chartData.map(d => d.hours), targetHours]
    const min = Math.min(...hs), max = Math.max(...hs)
    const pad = (max - min) * 0.15 || 1
    return [min - pad, max + pad]
  }, [chartData, targetHours])

  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const latest = sessions[0]
    const last7 = sessions.slice(0, 7)
    const avg = last7.reduce((a, s) => a + s.duration_s, 0) / last7.length
    const wakeMins = last7.filter(s => s.end_at).map(s => minsAfter6pm(s.end_at))
    const avgWake = wakeMins.length ? wakeMins.reduce((a, b) => a + b, 0) / wakeMins.length : null
    const bedtimeTarget = avgWake != null ? fmtClock(avgWake - targetHours * 60) : '—'
    return [
      { label: 'Last night', value: fmtHoursMinutes(latest.duration_s), unit: '', tint: 'text-indigo-400' },
      { label: '7-night avg', value: fmtHoursMinutes(avg), unit: '', tint: 'text-foreground' },
      { label: 'Bedtime target', value: bedtimeTarget, unit: '', tint: 'text-muted-foreground' },
    ]
  }, [sessions, targetHours])

  return (
    <SnapshotCard icon={Moon} iconTint="text-indigo-400" title="Sleep" onViewAll={onViewAll}>
      {sessions === null ? (
        <SnapshotLoading />
      ) : sessions.length === 0 ? (
        <SnapshotEmpty>No sleep data yet.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-2 pt-3">
            {chartData.length >= 2 && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <XAxis dataKey="ts" hide />
                  <YAxis hide domain={domain} />
                  <ReferenceLine y={targetHours} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={1} />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--muted-foreground) / 0.3)' }}
                    labelFormatter={ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    formatter={v => [`${v} h`, 'Sleep']}
                  />
                  <Line type="monotone" dataKey="hours" stroke="#818cf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
