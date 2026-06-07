// Web SVG port of the mobile HrRangeChart (Skia). Per day it draws a resting
// dot (emerald), an average dot (sky), and a vertical peak-zone gradient band
// (yellow->red by HR zone) from 50% HRmax up to that day's peak. Hovering a day
// shows a floating resting/avg/peak readout. Used in the Heart dashboard block
// (compact) and the Heart detail page (full, with grid + axis + legend).
//
// data: [{ day: 'YYYY-MM-DD', resting: number|null, avg: number|null, peak: number|null }]
//       oldest -> newest. hrMax = 220 - age (caller computes from birthdate).

import { useState, useEffect, useRef, useId } from 'react'

const COLOR_RESTING = '#34d399'  // emerald-400
const COLOR_AVG = '#38bdf8'      // sky-400
const COLOR_PEAK = '#f87171'     // red-400 (tooltip peak value)
// Gradient zones, top -> bottom (z5 hardest at the top, z1 at the bottom).
const ZONES = [
  { color: '#dc2626' }, // z5  90-100%
  { color: '#ea580c' }, // z4  80-90%
  { color: '#fb923c' }, // z3  70-80%
  { color: '#fbbf24' }, // z2  60-70%
  { color: '#facc15' }, // z1  50-60%
]
const LEGEND = [
  ['Z1', 0.50, 0.60, '#facc15'],
  ['Z2', 0.60, 0.70, '#fbbf24'],
  ['Z3', 0.70, 0.80, '#fb923c'],
  ['Z4', 0.80, 0.90, '#ea580c'],
  ['Z5', 0.90, 1.00, '#dc2626'],
]

function niceTicks(min, max, n) {
  const step = (max - min) / n
  const out = []
  for (let i = 0; i <= n; i++) out.push(Math.round(min + step * i))
  return [...new Set(out)]
}
function fmtAxis(day) {
  const d = new Date(day + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function fmtDay(day) {
  const d = new Date(day + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function HrZoneChart({ data, hrMax, height, compact = false }) {
  const wrapRef = useRef(null)
  const [W, setW] = useState(0)
  const [measuredH, setMeasuredH] = useState(0)
  const [active, setActive] = useState(null)
  const gradId = useId()

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

  const PADDING_TOP = 12
  const PADDING_BOTTOM = compact ? 8 : 26
  const PADDING_RIGHT = 12
  const Y_WIDTH = compact ? 6 : 30
  const BAND_WIDTH = 8
  const DOT_R = compact ? 3.5 : 4.5

  const z1Lo = Math.round(hrMax * 0.5)
  const days = (data || []).map(d => ({
    ...d,
    peakHigh: d.peak != null && d.peak >= z1Lo ? d.peak : null,
    peakLow: d.peak != null && d.peak >= z1Lo ? z1Lo : null,
  }))

  const vals = []
  for (const d of days) for (const v of [d.resting, d.avg, d.peakLow, d.peakHigh]) if (v != null) vals.push(v)

  const wrapClass = fillParent ? 'w-full h-full relative' : 'w-full relative'
  if (W === 0 || H === 0 || vals.length === 0 || days.length === 0) {
    return <div ref={wrapRef} className={wrapClass} style={height != null ? { height } : undefined} />
  }

  const rawMin = Math.min(...vals), rawMax = Math.max(...vals)
  const pad = Math.max(4, Math.round((rawMax - rawMin) * 0.10))
  const yMin = Math.max(30, rawMin - pad)
  const yMax = Math.min(220, rawMax + pad)
  const plotW = Math.max(0, W - Y_WIDTH - PADDING_RIGHT)
  const plotH = Math.max(0, H - PADDING_TOP - PADDING_BOTTOM)
  const n = days.length
  const xCenter = i => Y_WIDTH + (n === 1 ? plotW / 2 : (i + 0.5) * (plotW / n))
  const yScale = y => PADDING_TOP + plotH - ((y - yMin) / (yMax - yMin)) * plotH
  const ticks = niceTicks(yMin, yMax, compact ? 3 : 4)

  const gTop = yScale(hrMax)
  const gBot = yScale(hrMax * 0.5)

  return (
    <div ref={wrapRef} className={wrapClass} style={height != null ? { height } : undefined}>
      <svg width={W} height={H}>
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="0" y1={gTop} x2="0" y2={gBot}>
            {ZONES.flatMap((z, i) => {
              const a = i / ZONES.length, b = (i + 1) / ZONES.length
              return [
                <stop key={`${i}a`} offset={a} stopColor={z.color} />,
                <stop key={`${i}b`} offset={b} stopColor={z.color} />,
              ]
            })}
          </linearGradient>
        </defs>

        {!compact && ticks.map(t => (
          <g key={t}>
            <line x1={Y_WIDTH} x2={W - PADDING_RIGHT} y1={yScale(t)} y2={yScale(t)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
            <text x={Y_WIDTH - 6} y={yScale(t) + 3} textAnchor="end" fontSize={10} className="fill-muted-foreground" style={{ fontVariant: 'tabular-nums' }}>{t}</text>
          </g>
        ))}

        {days.map((d, i) => {
          const cx = xCenter(i)
          const colW = plotW / n
          return (
            <g key={d.day}>
              {d.peakHigh != null && d.peakLow != null && (() => {
                const top = yScale(d.peakHigh), bottom = yScale(d.peakLow)
                return <rect x={cx - BAND_WIDTH / 2} y={top} width={BAND_WIDTH} height={Math.max(2, bottom - top)} rx={3} ry={3} fill={`url(#${gradId})`} opacity={active === i ? 1 : 0.9} />
              })()}
              {d.resting != null && <circle cx={cx} cy={yScale(d.resting)} r={DOT_R + (active === i ? 1 : 0)} fill={COLOR_RESTING} stroke="hsl(var(--card))" strokeWidth={1.5} />}
              {d.avg != null && <circle cx={cx} cy={yScale(d.avg)} r={DOT_R + (active === i ? 1 : 0)} fill={COLOR_AVG} stroke="hsl(var(--card))" strokeWidth={1.5} />}
              {!compact && <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} className={active === i ? 'fill-foreground' : 'fill-muted-foreground'}>{fmtAxis(d.day)}</text>}
              <rect x={cx - colW / 2} y={0} width={colW} height={H} fill="transparent" style={{ cursor: 'pointer' }} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
            </g>
          )
        })}
      </svg>

      {active != null && days[active] && (() => {
        const d = days[active]
        const cx = xCenter(active)
        const topY = Math.min(...[d.peakHigh, d.avg, d.resting].filter(v => v != null).map(yScale))
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2 py-1 shadow-md"
            style={{ left: cx, top: topY - 6 }}
          >
            <div className="text-[10px] text-muted-foreground">{fmtDay(d.day)}</div>
            <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
              {d.resting != null && <span style={{ color: COLOR_RESTING }}>{d.resting}</span>}
              {d.avg != null && <span style={{ color: COLOR_AVG }}>{d.avg}</span>}
              {d.peakHigh != null && <span style={{ color: COLOR_PEAK }}>{d.peakHigh}</span>}
              <span className="text-muted-foreground">bpm</span>
            </div>
          </div>
        )
      })()}

      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" style={{ paddingLeft: Y_WIDTH }}>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLOR_RESTING }} />Resting</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLOR_AVG }} />Avg</span>
          {LEGEND.map(([lbl, lo, hi, c]) => (
            <span key={lbl} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `${c}8c`, border: `1px solid ${c}` }} />
              <span className="text-foreground">{lbl}</span>
              <span className="font-mono tabular-nums">{Math.round(hrMax * lo)}–{Math.round(hrMax * hi)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
