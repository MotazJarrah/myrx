// Shared "line chart under the days" — the 14-day intake mini-trend used by BOTH
// the Calories detail strip (CalorieStrip) and the dashboard Calories block, so
// they render identically. Per day: a status-coloured vertical band (dot -> base)
// + a connecting line + a status-coloured dot + a dashed daily-target line.
// Hovering a point shows a date + kcal readout.
//
// Props:
//   days        — [{ iso }]   (column order; objects so the strip can pass tiles)
//   logs        — { [iso]: { calories } }
//   dailyTarget — number | null (drives the status colours + dashed line)

import { useState, useEffect, useRef } from 'react'

export function statusFor(actual, target) {
  if (!actual) return 'empty'
  if (!target) return 'logged'
  const ratio = actual / target
  if (ratio >= 0.92 && ratio <= 1.08) return 'on-target'
  if (ratio >= 0.80 && ratio <= 1.20) return 'near-target'
  return 'off-target'
}

// Per-status fill (band) + dot colours.
const STATUS_GRAPH = {
  'on-target':   { fill: 'rgba(52,211,153,0.12)',  dot: 'rgb(52,211,153)'  },
  'near-target': { fill: 'rgba(251,191,36,0.12)',  dot: 'rgb(251,191,36)'  },
  'off-target':  { fill: 'rgba(248,113,113,0.12)', dot: 'rgb(248,113,113)' },
  'logged':      { fill: 'rgba(148,163,184,0.10)', dot: 'rgb(148,163,184)' },
  'empty':       { fill: 'transparent',            dot: 'transparent'      },
}

function fmtDay(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

export default function CalorieTrendGraph({ days, logs, dailyTarget }) {
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setW(el.clientWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 72, PADY = 12, innerH = H - PADY * 2
  const N = days.length, GAP = 6
  const colW = W > 0 ? (W - GAP * (N - 1)) / N : 0
  const colCenter = i => i * (colW + GAP) + colW / 2

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
  const span = maxCal - minCal || 200
  const toY = cal => PADY + (1 - (cal - minCal) / span) * innerH
  const targetY = dailyTarget != null ? toY(dailyTarget) : null
  const polyline = points.map(p => `${colCenter(p.idx)},${toY(p.cal)}`).join(' ')

  return (
    <div ref={wrapRef} className="w-full relative">
      {points.length === 0 ? (
        <div className="h-[72px] flex items-center justify-center">
          <p className="text-[11px] text-muted-foreground/40">No intake logged in the last 14 days</p>
        </div>
      ) : W > 0 ? (
        <svg width={W} height={H} className="block">
          {points.map(p => {
            const { fill } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
            const y = toY(p.cal)
            return <rect key={`b${p.iso}`} x={colCenter(p.idx) - colW / 2} y={y} width={colW} height={H - PADY - y} fill={fill} rx="3" />
          })}
          {targetY != null && (
            <line x1={colW / 2} y1={targetY} x2={W - colW / 2} y2={targetY} stroke="hsl(var(--muted-foreground) / 0.2)" strokeWidth="1" strokeDasharray="3 3" />
          )}
          {points.length > 1 && (
            <polyline points={polyline} fill="none" stroke="hsl(var(--muted-foreground) / 0.30)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {points.map(p => {
            const { dot } = STATUS_GRAPH[p.status] ?? STATUS_GRAPH.logged
            return <circle key={`d${p.iso}`} cx={colCenter(p.idx)} cy={toY(p.cal)} r="4" fill={dot} />
          })}
          {points.map(p => (
            <circle key={`h${p.iso}`} cx={colCenter(p.idx)} cy={toY(p.cal)} r="10" fill="transparent" style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
      ) : (
        <div className="h-[72px]" />
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2 py-1 shadow-md"
          style={{ left: colCenter(hover.idx), top: toY(hover.cal) - 6 }}
        >
          <div className="text-[10px] text-muted-foreground">{fmtDay(hover.iso)}</div>
          <div className="text-xs font-mono tabular-nums font-semibold text-foreground">{Math.round(hover.cal)} kcal</div>
        </div>
      )}
    </div>
  )
}
