// Web SVG port of the mobile HrRangeChart (Skia). Per day it draws a resting dot
// (emerald), an avg dot (sky), and a vertical peak-zone gradient band from 50%
// HRmax up to that day's peak. The band's COLOURS are proportional to time spent
// in each zone (buildTimeInZoneStops) — ported 1:1 from mobile — falling back to
// an even HRmax->40% gradient (incl below-Z1 grey) when a day has no zone data.
// Hovering a day shows a resting/avg/peak readout. Used compact in the Heart
// dashboard block and full (grid + axis + legend) on the Heart detail page.
//
// data: [{ day:'YYYY-MM-DD', resting, avg, peak, timeInZone }] oldest -> newest,
// from web/src/lib/heartDaily.js (shared with the detail page so they match).

import { useState, useEffect, useRef, useId } from 'react'

const COLOR_RESTING = '#34d399'  // emerald-400
const COLOR_AVG = '#38bdf8'      // sky-400
const COLOR_PEAK = '#f87171'     // red-400 (tooltip peak value)
const ZONE = { z1: '#facc15', z2: '#fbbf24', z3: '#fb923c', z4: '#ea580c', z5: '#dc2626', belowZ1: '#64748b' }
const LEGEND = [
  ['Z1', 0.50, 0.60, ZONE.z1],
  ['Z2', 0.60, 0.70, ZONE.z2],
  ['Z3', 0.70, 0.80, ZONE.z3],
  ['Z4', 0.80, 0.90, ZONE.z4],
  ['Z5', 0.90, 1.00, ZONE.z5],
]

// Gradient stops proportional to time-in-zone (Z5 at top -> Z1 at bottom); two
// stops per slice = hard segment edges. Mirrors mobile buildTimeInZoneStops.
function buildTimeInZoneStops(t) {
  const total = t.z1 + t.z2 + t.z3 + t.z4 + t.z5
  if (total <= 0) return null
  const order = [['z5', t.z5], ['z4', t.z4], ['z3', t.z3], ['z2', t.z2], ['z1', t.z1]]
  const colors = [], positions = []
  let cum = 0
  for (const [id, time] of order) {
    if (time <= 0) continue
    colors.push(ZONE[id], ZONE[id])
    positions.push(cum / total, (cum + time) / total)
    cum += time
  }
  return { colors, positions }
}
// Even 6-segment fallback (Z5 -> belowZ1), used when a day has no zone data.
function buildFallbackStops() {
  const SEG = 1 / 6
  const segs = [ZONE.z5, ZONE.z4, ZONE.z3, ZONE.z2, ZONE.z1, ZONE.belowZ1]
  const colors = [], positions = []
  segs.forEach((c, i) => { colors.push(c, c); positions.push(i * SEG + 0.001, (i + 1) * SEG - 0.001) })
  return { colors, positions }
}

function niceTicks(min, max, n) {
  const step = (max - min) / n
  const out = []
  for (let i = 0; i <= n; i++) out.push(Math.round(min + step * i))
  return [...new Set(out)]
}
function fmtAxis(day) { const d = new Date(day + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}` }
function fmtDay(day) { return new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }

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

  const wrapClass = height == null ? 'w-full h-full relative' : 'w-full relative'
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

  // Per-band gradient: time-in-zone proportional (span = the band) else even
  // fallback (span = HRmax -> 40% HRmax in chart coords; the band clips it).
  const bands = days.map((d, i) => {
    if (d.peakHigh == null || d.peakLow == null) return null
    const top = yScale(d.peakHigh), bottom = yScale(d.peakLow)
    const tz = d.timeInZone
    const hasTz = tz && (tz.z1 + tz.z2 + tz.z3 + tz.z4 + tz.z5 + tz.belowZ1) > 0
    let stops = hasTz ? buildTimeInZoneStops(tz) : null
    let gy1, gy2
    if (stops) { gy1 = top; gy2 = bottom }
    else { stops = buildFallbackStops(); gy1 = yScale(hrMax); gy2 = yScale(hrMax * 0.40) }
    return { i, id: `${gradId}-${i}`, x: xCenter(i) - BAND_WIDTH / 2, top, height: Math.max(2, bottom - top), stops, gy1, gy2 }
  })

  return (
    <div ref={wrapRef} className={wrapClass} style={height != null ? { height } : undefined}>
      <svg width={W} height={H}>
        <defs>
          {bands.filter(Boolean).map(b => (
            <linearGradient key={b.id} id={b.id} gradientUnits="userSpaceOnUse" x1="0" y1={b.gy1} x2="0" y2={b.gy2}>
              {b.stops.positions.map((p, j) => <stop key={j} offset={p} stopColor={b.stops.colors[j]} />)}
            </linearGradient>
          ))}
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
          const b = bands[i]
          return (
            <g key={d.day}>
              {b && <rect x={b.x} y={b.top} width={BAND_WIDTH} height={b.height} rx={3} ry={3} fill={`url(#${b.id})`} opacity={active === i ? 1 : 0.9} />}
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
        const candidates = [d.peakHigh, d.avg, d.resting].filter(v => v != null)
        if (!candidates.length) return null
        const topY = Math.min(...candidates.map(yScale))
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
