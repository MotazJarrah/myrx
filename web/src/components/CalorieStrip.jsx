import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2 } from 'lucide-react'

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

function statusFor(actual, target) {
  if (!actual)  return 'empty'
  if (!target)  return 'logged'
  const ratio = actual / target
  if (ratio >= 0.92 && ratio <= 1.08) return 'on-target'
  if (ratio >= 0.80 && ratio <= 1.20) return 'near-target'
  return 'off-target'
}

const STATUS_DOT = {
  'on-target':   'bg-emerald-400',
  'near-target': 'bg-amber-400',
  'off-target':  'bg-red-400',
  'logged':      'bg-muted-foreground/40',
  'empty':       'bg-transparent',
}

// Per-status fill colours for the graph (RGBA for SVG)
const STATUS_GRAPH = {
  'on-target':   { fill: 'rgba(52,211,153,0.12)',  dot: 'rgb(52,211,153)'  },
  'near-target': { fill: 'rgba(251,191,36,0.12)',  dot: 'rgb(251,191,36)'  },
  'off-target':  { fill: 'rgba(248,113,113,0.12)', dot: 'rgb(248,113,113)' },
  'logged':      { fill: 'rgba(148,163,184,0.10)', dot: 'rgb(148,163,184)' },
  'empty':       { fill: 'transparent',             dot: 'transparent'      },
}

// ── Mini trend graph (the line chart UNDER the day tiles) ──────────────────────

function CalorieGraph({ days, logs, dailyTarget }) {
  // Measure the real pixel width so the SVG renders 1:1 (round dots, no
  // preserveAspectRatio stretch) AND so the X columns line up exactly with the
  // tile row above (both are N equal columns separated by GAP px).
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setW(el.clientWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H      = 72
  const PADY   = 12
  const innerH = H - PADY * 2
  const N      = days.length
  const GAP    = 6   // must match the tile row's gap-1.5 (0.375rem = 6px)
  const colW   = W > 0 ? (W - GAP * (N - 1)) / N : 0
  const colCenter = (i) => i * (colW + GAP) + colW / 2

  const points = days
    .map((d, i) => {
      const log = logs[d.iso]
      if (!log) return null
      return { idx: i, iso: d.iso, cal: log.calories, status: statusFor(log.calories, dailyTarget) }
    })
    .filter(Boolean)

  const allCal = points.map(p => p.cal)
  const minCal = Math.min(...allCal, dailyTarget ?? Infinity)
  const maxCal = Math.max(...allCal, dailyTarget ?? 0)
  const span   = maxCal - minCal || 200
  const toY    = (cal) => PADY + (1 - (cal - minCal) / span) * innerH
  const targetY = dailyTarget != null ? toY(dailyTarget) : null
  const polyline = points.map(p => `${colCenter(p.idx)},${toY(p.cal)}`).join(' ')

  return (
    <div ref={wrapRef} className="w-full">
      {points.length === 0 ? (
        <div className="h-[72px] flex items-center justify-center">
          <p className="text-[11px] text-muted-foreground/40">No intake logged in the last 14 days</p>
        </div>
      ) : W > 0 ? (
        <svg width={W} height={H} className="block" aria-hidden="true">
          {/* Per-day status-coloured vertical bands */}
          {points.map(p => {
            const { fill } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
            const y = toY(p.cal)
            return (
              <rect
                key={p.iso}
                x={colCenter(p.idx) - colW / 2}
                y={y}
                width={colW}
                height={H - PADY - y}
                fill={fill}
                rx="3"
              />
            )
          })}

          {/* Target dashed line */}
          {targetY != null && (
            <line
              x1={colW / 2} y1={targetY}
              x2={W - colW / 2} y2={targetY}
              stroke="hsl(var(--muted-foreground) / 0.2)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* Connecting line */}
          {points.length > 1 && (
            <polyline
              points={polyline}
              fill="none"
              stroke="hsl(var(--muted-foreground) / 0.30)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Dots — coloured by status */}
          {points.map(p => {
            const { dot } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
            return <circle key={p.iso} cx={colCenter(p.idx)} cy={toY(p.cal)} r="4" fill={dot} />
          })}
        </svg>
      ) : (
        <div className="h-[72px]" />
      )}
    </div>
  )
}

// ── Component (read-only — coach review of a client's intake) ───────────────────
// Props:
//   userId       — whose food_logs to read (the client being viewed)
//   dailyTarget  — kcal target (number | null) — drives the status colours + line

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

      {/* Trend graph — the line chart under the days */}
      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-2">
          <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div className="pt-1">
          <CalorieGraph days={days} logs={logs} dailyTarget={dailyTarget} />
        </div>
      )}
    </div>
  )
}
