import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
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

// ── Mini trend graph ──────────────────────────────────────────────────────────

function CalorieGraph({ days, logs, dailyTarget, onDotClick }) {
  const W   = 320
  const H   = 72
  const PAD = { top: 10, right: 12, bottom: 10, left: 12 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top  - PAD.bottom

  const points = days
    .map((d, i) => {
      const log = logs[d.iso]
      if (!log) return null
      return { idx: i, iso: d.iso, cal: log.calories, status: statusFor(log.calories, dailyTarget) }
    })
    .filter(Boolean)

  if (points.length === 0) {
    return (
      <div className="h-[72px] flex items-center justify-center">
        <p className="text-[11px] text-muted-foreground/40">Log food to see your intake trend</p>
      </div>
    )
  }

  const maxX   = days.length - 1
  const allCal = points.map(p => p.cal)
  const minCal = Math.min(...allCal, dailyTarget ?? Infinity)
  const maxCal = Math.max(...allCal, dailyTarget ?? 0)
  const span   = maxCal - minCal || 200

  const toX = (idx) => PAD.left + (idx / maxX) * innerW
  const toY = (cal) => PAD.top  + (1 - (cal - minCal) / span) * innerH

  const bandW = innerW / maxX

  // Target line Y
  const targetY = dailyTarget != null ? toY(dailyTarget) : null

  const polyline = points.map(p => `${toX(p.idx)},${toY(p.cal)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-[72px]"
      aria-hidden="true"
    >
      {/* Per-day status-coloured vertical bands */}
      {points.map(p => {
        const { fill } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
        const x = toX(p.idx) - bandW / 2
        const y = toY(p.cal)
        return (
          <rect
            key={p.iso}
            x={Math.max(PAD.left, x)}
            y={y}
            width={Math.min(bandW, W - PAD.right - Math.max(PAD.left, x))}
            height={H - PAD.bottom - y}
            fill={fill}
            rx="2"
          />
        )
      })}

      {/* Target dashed line */}
      {targetY != null && (
        <line
          x1={PAD.left} y1={targetY}
          x2={W - PAD.right} y2={targetY}
          stroke="hsl(var(--muted-foreground) / 0.2)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}

      {/* Connecting line (always neutral) */}
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

      {/* Clickable dots — coloured by status */}
      {points.map(p => {
        const { dot } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
        const cx = toX(p.idx)
        const cy = toY(p.cal)
        return (
          <g key={p.iso} style={{ cursor: 'pointer' }} onClick={() => onDotClick(p.iso)}>
            {/* Invisible larger hit target */}
            <circle cx={cx} cy={cy} r="10" fill="transparent" />
            {/* Visible dot */}
            <circle cx={cx} cy={cy} r="4" fill={dot} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
// Props:
//   dailyTarget  — coach-set kcal target (number | null)
//   onDayClick   — (isoDateStr) => void — called when a tile or graph dot is clicked
//   selectedIso  — which tile is highlighted (controlled from parent)
//   refreshKey   — increment to force a data refresh

export default function CalorieStrip({ dailyTarget, onDayClick, selectedIso, refreshKey = 0 }) {
  const { user } = useAuth()
  const [logs, setLogs]     = useState({})   // { [iso]: { calories } }
  const [loading, setLoading] = useState(true)
  const stripRef  = useRef(null)
  const todayRef  = useRef(null)

  const days = useMemo(() => buildDayWindow(), [])

  // ── Load 14-day window sums from food_logs ───────────────────────────────
  useEffect(() => {
    if (!user) return
    const fromIso = days[0].iso
    const toIso   = days[days.length - 1].iso
    setLoading(true)
    supabase
      .from('food_logs')
      .select('log_date, calories')
      .eq('user_id', user.id)
      .gte('log_date', fromIso)
      .lte('log_date', toIso)
      .then(({ data, error }) => {
        if (error) { setLoading(false); return }
        // Sum calories per day
        const map = {}
        ;(data || []).forEach(r => {
          if (!map[r.log_date]) map[r.log_date] = { calories: 0 }
          map[r.log_date].calories += r.calories
        })
        setLogs(map)
        setLoading(false)
      })
  }, [user, days, refreshKey])

  // ── Auto-scroll today into view ──────────────────────────────────────────
  useEffect(() => {
    if (todayRef.current && stripRef.current) {
      const tile  = todayRef.current
      const strip = stripRef.current
      const left  = tile.offsetLeft - strip.clientWidth / 2 + tile.clientWidth / 2
      strip.scrollTo({ left, behavior: 'instant' })
    }
  }, [loading])

  const targetText = dailyTarget ? `${dailyTarget} kcal` : null

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Daily intake log</h2>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Tap a day to log food</p>
        </div>
        {targetText && (
          <span className="text-[11px] text-muted-foreground">Target {targetText}</span>
        )}
      </div>

      {/* Day tiles — 14 days back including today */}
      <div
        ref={stripRef}
        className="flex gap-1.5 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1 -mx-1 px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {days.map(day => {
          const log       = logs[day.iso]
          const status    = statusFor(log?.calories, dailyTarget)
          const isSelected = selectedIso === day.iso

          return (
            <button
              key={day.iso}
              ref={day.isToday ? todayRef : null}
              type="button"
              data-iso={day.iso}
              onClick={() => onDayClick?.(day.iso)}
              className={`relative shrink-0 snap-center flex flex-col items-center justify-between rounded-xl border transition-all px-2 py-2 w-[58px] h-[72px]
                ${isSelected
                  ? 'border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30'
                  : day.isToday
                    ? 'border-red-500/40 bg-red-500/5'
                    : 'border-border bg-muted/20'}
                hover:border-red-500/40 hover:bg-red-500/5 active:scale-95
              `}
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
            </button>
          )
        })}
      </div>

      {/* Trend graph */}
      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-2">
          <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div className="pt-1">
          <CalorieGraph
            days={days}
            logs={logs}
            dailyTarget={dailyTarget}
            onDotClick={iso => onDayClick?.(iso)}
          />
        </div>
      )}
    </div>
  )
}
