import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2 } from 'lucide-react'
import CalorieTrendGraph, { statusFor } from './CalorieTrendGraph'

// ── Date helpers ─────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function buildDayWindow() {
  // 13 past days + today = 14 tiles, no future
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = isoDate(today)
  const days = []
  for (let offset = -13; offset <= 0; offset++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset)
    days.push({
      date:    d,
      iso:     isoDate(d),
      day:     DAY_LABELS[d.getDay()],
      num:     d.getDate(),
      isToday: isoDate(d) === todayIso,
    })
  }
  return days
}

const STATUS_DOT = {
  'on-target':   'bg-emerald-400',
  'near-target': 'bg-amber-400',
  'off-target':  'bg-red-400',
  'logged':      'bg-muted-foreground/40',
  'empty':       'bg-transparent',
}

// ── Component (read-only — coach review of a client's intake) ───────────────────
// Props:
//   userId       — whose food_logs to read (the client being viewed)
//   dailyTarget  — kcal target (number | null) — drives the status colours + line
// The trend graph under the tiles is the shared <CalorieTrendGraph>, the same
// component the dashboard Calories block renders, so the two can't drift.

export default function CalorieStrip({ userId, dailyTarget }) {
  const [logs, setLogs]       = useState({})   // { [iso]: { calories } }
  const [loading, setLoading] = useState(true)

  const days = useMemo(() => buildDayWindow(), [])

  // ── Load 14-day window sums from food_logs ───────────────────────────────
  useEffect(() => {
    if (!userId) return
    const fromIso = days[0].iso
    const toIso   = days[days.length - 1].iso
    setLoading(true)
    supabase
      .from('food_logs')
      .select('log_date, calories')
      .eq('user_id', userId)
      .gte('log_date', fromIso)
      .lte('log_date', toIso)
      .then(({ data, error }) => {
        if (error) { setLoading(false); return }
        const map = {}
        ;(data || []).forEach(r => {
          if (!map[r.log_date]) map[r.log_date] = { calories: 0 }
          map[r.log_date].calories += r.calories
        })
        setLogs(map)
        setLoading(false)
      })
  }, [userId, days])

  const targetText = dailyTarget ? `${dailyTarget} kcal` : null

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Daily intake log</h2>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Last 14 days</p>
        </div>
        {targetText && (
          <span className="text-[11px] text-muted-foreground">Target {targetText}</span>
        )}
      </div>

      {/* Day tiles — 14 equal columns; the graph below uses the same columns */}
      <div className="flex gap-1.5">
        {days.map(day => {
          const log    = logs[day.iso]
          const status = statusFor(log?.calories, dailyTarget)
          return (
            <div
              key={day.iso}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-between rounded-xl border px-1.5 py-2 h-[72px] ${
                day.isToday ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-muted/20'
              }`}
            >
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground leading-none">
                {day.day}
              </div>
              <div className={`text-base font-bold tabular-nums leading-none ${day.isToday ? 'text-red-400' : ''}`}>
                {day.num}
              </div>
              <div className="text-[10px] tabular-nums leading-none">
                {log
                  ? <span className="font-semibold">{Math.round(log.calories)}</span>
                  : <span className="text-muted-foreground/60">—</span>}
              </div>
              <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-5 rounded-full ${STATUS_DOT[status]}`} />
            </div>
          )
        })}
      </div>

      {/* Trend graph — the line chart under the days (shared with the dashboard) */}
      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-2">
          <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div className="pt-1">
          <CalorieTrendGraph days={days} logs={logs} dailyTarget={dailyTarget} />
        </div>
      )}
    </div>
  )
}
