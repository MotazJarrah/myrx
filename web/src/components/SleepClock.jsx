// Web SVG port of the mobile SleepClock — a 12-hour radial clock with the last
// 7 nights drawn as concentric sleep arcs (outermost = most recent). When
// bedtimes are consistent the arcs line up; when they drift they scatter. An
// indigo "average" band sits just outside the rings. Hovering a ring selects it
// (brightens + updates the center day/date + the below-clock time/duration).
// Used on the Sleep detail page.

import { useState, useMemo } from 'react'

const LIME = '#CAF240'
const INDIGO = '#818cf8'
const SLATE400 = '#94a3b8'
const SLATE500 = '#64748b'

function alphaHex(op) { return Math.round(Math.max(0, Math.min(1, op)) * 255).toString(16).padStart(2, '0') }
function hourOfDay(iso) { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 }
function hourToAngle(h) { return ((h % 12) / 12) * 360 }
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) } }
function arcPath(cx, cy, r, startDeg, endDeg, thickness) {
  let e = endDeg
  while (e <= startDeg) e += 360
  const rOut = r + thickness / 2, rIn = r - thickness / 2
  const p1 = polar(cx, cy, rOut, startDeg), p2 = polar(cx, cy, rOut, e)
  const p3 = polar(cx, cy, rIn, e), p4 = polar(cx, cy, rIn, startDeg)
  const large = e - startDeg > 180 ? 1 : 0
  return `M ${p1.x} ${p1.y} A ${rOut} ${rOut} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rIn} ${rIn} 0 ${large} 0 ${p4.x} ${p4.y} Z`
}
function circularMeanHours(hours) {
  if (!hours.length) return null
  let s = 0, c = 0
  for (const h of hours) { const a = (h / 24) * 2 * Math.PI; s += Math.sin(a); c += Math.cos(a) }
  let m = (Math.atan2(s, c) / (2 * Math.PI)) * 24
  if (m < 0) m += 24
  return m
}
function fmtDur(ms) { const m = Math.round(ms / 60000); const h = Math.floor(m / 60); const mm = m % 60; return h && mm ? `${h}h ${mm}m` : h ? `${h}h` : `${mm}m` }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }

export default function SleepClock({ nights, size = 240 }) {
  const rings = useMemo(() => {
    const list = (nights || []).slice(0, 7)
    if (!list.length) return []
    const anchorMid = (() => { const d = new Date(list[0].start_at); d.setHours(0, 0, 0, 0); return d.getTime() })()
    return list.map(n => {
      const nm = (() => { const d = new Date(n.start_at); d.setHours(0, 0, 0, 0); return d.getTime() })()
      const off = Math.round((anchorMid - nm) / 86400000)
      return { ...n, off, bedHour: hourOfDay(n.start_at), wakeHour: hourOfDay(n.end_at) }
    }).filter(r => r.off >= 0 && r.off < 7)
  }, [nights])

  const [active, setActive] = useState(0)

  const avg = useMemo(() => {
    if (!rings.length) return null
    const bh = circularMeanHours(rings.map(r => r.bedHour))
    const wh = circularMeanHours(rings.map(r => r.wakeHour))
    return bh != null && wh != null ? { bedHour: bh, wakeHour: wh } : null
  }, [rings])

  if (!rings.length) return null

  const k = size / 320
  const cx = size / 2, cy = size / 2
  const labelInset = 32 * k
  const outerR = size / 2 - labelInset
  const ringThickness = 11 * k
  const ringGap = 2 * k
  const innerR = outerR - 7 * (ringThickness + ringGap) + ringGap
  const ringR = i => outerR - i * (ringThickness + ringGap)
  const avgBandThickness = 4 * k
  const avgBandR = outerR + ringThickness / 2 + 6 * k
  const labelR = avgBandR + avgBandThickness / 2 + 11 * k

  let readout
  if (active === -1 && avg) {
    readout = { title: 'Average', date: null, time: `${fmtClockH(avg.bedHour)} – ${fmtClockH(avg.wakeHour)}`, sub: 'avg bed–wake' }
  } else {
    const r = rings.find(x => x.off === active) || rings[0]
    readout = {
      title: new Date(r.start_at).toLocaleDateString(undefined, { weekday: 'short' }),
      date: new Date(r.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      time: `${fmtTime(r.start_at)} – ${fmtTime(r.end_at)}`,
      sub: fmtDur(new Date(r.end_at) - new Date(r.start_at)),
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={cx} cy={cy} r={outerR + ringThickness / 2} fill={`${SLATE500}${alphaHex(0.04)}`} />
          {Array.from({ length: 7 }).map((_, i) => (
            <circle key={`t${i}`} cx={cx} cy={cy} r={ringR(i)} fill="none" stroke={`${SLATE400}${alphaHex(0.10)}`} strokeWidth={ringThickness} />
          ))}
          {[0, 3, 6, 9].map(h => {
            const ang = (h / 12) * 360
            const a = polar(cx, cy, innerR - 4 * k, ang), b = polar(cx, cy, outerR + ringThickness / 2 + 2 * k, ang)
            return <line key={`s${h}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={`${SLATE400}${alphaHex(0.18)}`} strokeWidth={1} />
          })}
          {rings.map(r => {
            const sel = active === r.off
            const fill = sel ? LIME : `${LIME}${alphaHex(0.55 - r.off * 0.05)}`
            return <path key={`a${r.off}`} d={arcPath(cx, cy, ringR(r.off), hourToAngle(r.bedHour), hourToAngle(r.wakeHour), ringThickness)} fill={fill} />
          })}
          {avg && (
            <path d={arcPath(cx, cy, avgBandR, hourToAngle(avg.bedHour), hourToAngle(avg.wakeHour), avgBandThickness)} fill={`${INDIGO}${alphaHex(active === -1 ? 0.85 : 0.50)}`} />
          )}
          {Array.from({ length: 12 }).map((_, h) => {
            const ang = (h / 12) * 360
            const p = polar(cx, cy, labelR, ang)
            const card = h === 0 || h === 3 || h === 6 || h === 9
            return (
              <text key={`n${h}`} x={p.x} y={p.y + 4 * k} textAnchor="middle" fontSize={(card ? 13 : 12) * k} className={card ? 'fill-foreground' : 'fill-muted-foreground'} style={{ fontVariant: 'tabular-nums' }}>
                {h === 0 ? 12 : h}
              </text>
            )
          })}
          {rings.map(r => (
            <circle key={`h${r.off}`} cx={cx} cy={cy} r={ringR(r.off)} fill="none" stroke="transparent" strokeWidth={ringThickness + ringGap} style={{ cursor: 'pointer', pointerEvents: 'stroke' }} onMouseEnter={() => setActive(r.off)} />
          ))}
          {avg && <circle cx={cx} cy={cy} r={avgBandR} fill="none" stroke="transparent" strokeWidth={avgBandThickness + 6 * k} style={{ cursor: 'pointer', pointerEvents: 'stroke' }} onMouseEnter={() => setActive(-1)} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none" style={{ gap: 2 }}>
          <div className="text-sm font-semibold text-foreground">{readout.title}</div>
          {readout.date && <div className="text-[11px] font-mono tabular-nums text-muted-foreground">{readout.date}</div>}
        </div>
      </div>
      <div className="mt-1 text-center">
        <div className="text-[13px] font-mono tabular-nums" style={{ color: LIME }}>{readout.time}</div>
        <div className="text-[11px] text-muted-foreground">{readout.sub}</div>
      </div>
    </div>
  )
}

function fmtClockH(hourFloat) {
  const total = Math.round(hourFloat * 60) % 1440
  const h24 = Math.floor(total / 60), m = total % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}
