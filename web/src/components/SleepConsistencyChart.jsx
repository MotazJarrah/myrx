// Web SVG port of the mobile SleepConsistency chart. Each of the last 7 nights
// is a vertical "sleep window" bar (bedtime -> wake), plotted on a minutes-after-
// 6pm axis so windows crossing midnight stay monotonic. Three reference lines:
// target bedtime + target wake (indigo solid) and avg bedtime (white dotted).
// On-target nights (within +-10 min of both targets) paint bright lime; off paint
// faint lime. Hovering a night shows its bed->wake window. Used compact in the
// Sleep dashboard block and full (with gutter time labels) on the detail page.

import { useState, useEffect, useRef } from 'react'
import { BedDouble, Sunrise } from 'lucide-react'

const LIME = '#CAF240'
const INDIGO = '#818cf8'
const ACHIEVED_TOL = 10

// Minutes after 6pm (so a bedtime of 11pm = 300, a wake of 7am = 780).
export function minsAfter6pm(iso) {
  const d = new Date(iso)
  return ((d.getHours() - 18 + 24) % 24) * 60 + d.getMinutes()
}
// minutes-after-6pm -> "h:mm AM/PM".
export function fmtClock(minsAfter) {
  const total = (((Math.round(minsAfter) + 18 * 60) % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60), m = total % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}
function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

export default function SleepConsistencyChart({ nights, targetBedMin, targetWakeMin, avgBedMin, height, compact = false }) {
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  const [measuredH, setMeasuredH] = useState(0)
  const [active, setActive] = useState(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => { setW(el.clientWidth); setMeasuredH(el.clientHeight) })
    setW(el.clientWidth); setMeasuredH(el.clientHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = height ?? measuredH
  const fillParent = height == null
  const wrapClass = fillParent ? 'w-full h-full relative' : 'w-full relative'

  const sorted = [...(nights || [])].sort((a, b) => new Date(a.start_at) - new Date(b.start_at))

  const TOP_PAD = 8
  const BOTTOM_AXIS = compact ? 4 : 20
  const LEFT_GUTTER = compact ? 6 : 68
  const RIGHT_PAD = 10
  const DOMAIN_PAD = 25
  const COL_GAP = 3

  if (W === 0 || H === 0 || sorted.length === 0 || targetBedMin == null) {
    return <div ref={wrapRef} className={wrapClass} style={height != null ? { height } : undefined} />
  }

  const plotH = Math.max(0, H - TOP_PAD - BOTTOM_AXIS)
  const plotW = Math.max(0, W - LEFT_GUTTER - RIGHT_PAD)

  const beds = sorted.map(s => minsAfter6pm(s.start_at))
  const wakes = sorted.map(s => minsAfter6pm(s.end_at))
  const lo = Math.min(...beds, targetBedMin, avgBedMin) - DOMAIN_PAD
  const hi = Math.max(...wakes, targetWakeMin) + DOMAIN_PAD
  // Flipped: later times sit HIGHER, so bars rise from bedtime (bottom) up to
  // wake (top) — the natural bottom→up reading (mirrors mobile SleepConsistency).
  const yOf = v => TOP_PAD + (1 - (v - lo) / (hi - lo)) * plotH

  const slot = plotW / sorted.length
  const colW = Math.max(3, slot - COL_GAP)
  const xOf = i => LEFT_GUTTER + i * slot + COL_GAP / 2

  const yBed = yOf(targetBedMin), yWake = yOf(targetWakeMin), yAvg = yOf(avgBedMin)
  const yAvgLabel = Math.abs(yAvg - yBed) < 14 ? (yAvg <= yBed ? yBed - 14 : yBed + 14) : yAvg

  return (
    <div ref={wrapRef} className={wrapClass} style={height != null ? { height } : undefined}>
      <svg width={W} height={H}>
        <line x1={LEFT_GUTTER} x2={LEFT_GUTTER + plotW} y1={yAvg} y2={yAvg} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} strokeDasharray="2 3" />
        <line x1={LEFT_GUTTER} x2={LEFT_GUTTER + plotW} y1={yBed} y2={yBed} stroke={INDIGO} strokeWidth={1.5} />
        <line x1={LEFT_GUTTER} x2={LEFT_GUTTER + plotW} y1={yWake} y2={yWake} stroke={INDIGO} strokeWidth={1.5} />

        {sorted.map((s, i) => {
          const top = Math.min(yOf(beds[i]), yOf(wakes[i]))
          const h = Math.max(3, Math.abs(yOf(wakes[i]) - yOf(beds[i])))
          const onTarget = Math.abs(beds[i] - targetBedMin) <= ACHIEVED_TOL && Math.abs(wakes[i] - targetWakeMin) <= ACHIEVED_TOL
          const op = onTarget ? (active === i ? 1 : 0.95) : (active === i ? 0.5 : 0.30)
          return (
            <g key={s.start_at}>
              <rect x={xOf(i)} y={top} width={colW} height={h} rx={3} ry={3} fill={LIME} opacity={op} />
              <rect x={xOf(i)} y={0} width={slot} height={H} fill="transparent" style={{ cursor: 'pointer' }} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
            </g>
          )
        })}

        {!compact && (
          <>
            <text x={LEFT_GUTTER} y={H - 6} fontSize={10} className="fill-muted-foreground">{fmtDate(sorted[0].start_at)}</text>
            <text x={LEFT_GUTTER + plotW} y={H - 6} textAnchor="end" fontSize={10} className="fill-muted-foreground">{fmtDate(sorted[sorted.length - 1].start_at)}</text>
          </>
        )}
      </svg>

      {!compact && (
        <>
          <GutterLabel y={yBed} icon={<BedDouble className="h-3 w-3" style={{ color: INDIGO }} />} text={fmtClock(targetBedMin)} color={INDIGO} />
          <GutterLabel y={yWake} icon={<Sunrise className="h-3 w-3" style={{ color: INDIGO }} />} text={fmtClock(targetWakeMin)} color={INDIGO} />
          <GutterLabel y={yAvgLabel} text={fmtClock(avgBedMin)} color="rgba(255,255,255,0.6)" />
        </>
      )}

      {active != null && sorted[active] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2 py-1 shadow-md"
          style={{ left: xOf(active) + colW / 2, top: Math.min(yOf(beds[active]), yOf(wakes[active])) - 6 }}
        >
          <div className="text-[10px] text-muted-foreground">{fmtDate(sorted[active].start_at)}</div>
          <div className="text-[11px] font-mono tabular-nums text-foreground">{fmtClock(beds[active])} – {fmtClock(wakes[active])}</div>
        </div>
      )}
    </div>
  )
}

function GutterLabel({ y, icon, text, color }) {
  return (
    <div className="absolute flex items-center justify-end gap-1" style={{ top: y - 8, left: 0, width: 62 }}>
      {icon}
      <span className="font-mono tabular-nums text-[10px]" style={{ color }}>{text}</span>
    </div>
  )
}
