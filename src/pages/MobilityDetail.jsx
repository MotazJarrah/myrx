import { useEffect, useState } from 'react'
import { useRoute, useLocation } from 'wouter'
import { ArrowLeft } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// ── Time helpers ──────────────────────────────────────────────────────────────

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
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Milestone tiers: short holds/crawls vs long yoga/session moves
function getMilestones(movementName) {
  const lower = movementName.toLowerCase()
  if (/crawl|walk|inchworm|seal|monkey|scorpion|lizard walk|spider/.test(lower)) {
    return [
      { label: '30s',  secs: 30 },
      { label: '1 min', secs: 60 },
      { label: '2 min', secs: 120 },
      { label: '5 min', secs: 300 },
      { label: '10 min', secs: 600 },
      { label: '15 min', secs: 900 },
    ]
  }
  return [
    { label: '30s',  secs: 30 },
    { label: '1 min', secs: 60 },
    { label: '2 min', secs: 120 },
    { label: '3 min', secs: 180 },
    { label: '5 min', secs: 300 },
    { label: '10 min', secs: 600 },
  ]
}

export default function MobilityDetail() {
  const [, params] = useRoute('/mobility/:movement')
  const [, navigate] = useLocation()
  const { user } = useAuth()

  const movementName = params?.movement ? decodeURIComponent(params.movement) : ''
  const [entries, setEntries] = useState([]) // [{ date, secs }]
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !movementName) return
    setLoading(true)
    supabase
      .from('efforts')
      .select('label, created_at')
      .eq('user_id', user.id)
      .eq('type', 'mobility')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) { setLoading(false); return }
        const results = []
        data.forEach(row => {
          const movementsStr = row.label.replace(/^Mobility Session\s*·\s*/i, '')
          movementsStr.split(',').forEach(chunk => {
            const trimmed = chunk.trim()
            const lastSpace = trimmed.lastIndexOf(' ')
            if (lastSpace === -1) return
            const name = trimmed.slice(0, lastSpace).trim()
            const timeStr = trimmed.slice(lastSpace + 1).trim()
            const secs = parseTimeStr(timeStr)
            if (name === movementName && secs) {
              results.push({ date: row.created_at, secs })
            }
          })
        })
        setEntries(results)
        setLoading(false)
      })
  }, [user, movementName])

  const bestSecs = entries.length > 0 ? Math.max(...entries.map(e => e.secs)) : null
  const milestones = getMilestones(movementName)
  const nextMilestone = bestSecs !== null
    ? milestones.find(m => m.secs > bestSecs) ?? null
    : milestones[0]

  const chartData = entries.slice(-20).map(e => ({
    date: fmtDate(e.date),
    secs: e.secs,
    label: fmtSecs(e.secs),
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      <button
        onClick={() => navigate('/mobility')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{movementName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'session' : 'sessions'} logged
        </p>
      </div>

      {/* Best time card */}
      {bestSecs !== null && (
        <div className="animate-rise rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/8 px-5 py-4">
          <p className="text-xs text-muted-foreground mb-1">Personal best</p>
          <p className="font-mono text-3xl tabular-nums font-bold text-fuchsia-400">
            {fmtSecs(bestSecs)}
          </p>
          {nextMilestone && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next milestone: {nextMilestone.label} — {fmtSecs(nextMilestone.secs - bestSecs)} to go
            </p>
          )}
        </div>
      )}

      {/* Milestone tiles */}
      <div className="animate-rise rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Milestones</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {milestones.map(ms => {
            const reached = bestSecs !== null && bestSecs >= ms.secs
            return (
              <div
                key={ms.label}
                className={`flex flex-col items-center rounded-lg border py-3 px-2 text-center transition-colors ${
                  reached
                    ? 'border-fuchsia-500/40 bg-fuchsia-500/15'
                    : 'border-border bg-muted/20'
                }`}
              >
                <span className={`text-lg ${reached ? '✓' : ''}`}>
                  {reached ? '✓' : '○'}
                </span>
                <span className={`text-xs font-semibold mt-0.5 ${reached ? 'text-fuchsia-400' : 'text-muted-foreground'}`}>
                  {ms.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Progress chart */}
      {chartData.length > 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Progress</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={v => fmtSecs(v)}
                tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={v => [fmtSecs(v), 'Duration']}
              />
              <Bar dataKey="secs" fill="rgb(217 70 239 / 0.7)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* History list */}
      {entries.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">History</h2>
          </div>
          <div className="divide-y divide-border">
            {[...entries].reverse().slice(0, 20).map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">{fmtDate(entry.date)}</span>
                <span className="font-mono text-sm tabular-nums text-fuchsia-400 font-semibold">
                  {fmtSecs(entry.secs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
