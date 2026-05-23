/**
 * LineChart — react-native-svg port of the Recharts <LineChart> usage in
 * MyRX/src/pages/StrengthDetail.jsx (and later CardioDetail / BodyweightDetail).
 *
 * Visual parity with Recharts' shape:
 *   – 200px tall by default
 *   – y-axis (no axis line, no tick line) on the left, 48px wide
 *   – x-axis (no axis line, no tick line) on the bottom — first + last date
 *   – `type="monotone"` cubic-Bezier curve via Fritsch-Carlson tangents
 *   – Personal-best dashed reference line (`strokeDasharray="4 3"`, opacity 0.4)
 *   – Dots r=4, active dot r=8 with a tap-pinned tooltip
 *
 * On mobile we don't have hover, so the tooltip is *tap to pin*: tap anywhere
 * inside the plot area → snaps to the nearest point and shows a floating
 * value chip; tap again on empty space to dismiss.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native'
import Svg, { Path, Line as SvgLine, Circle, Text as SvgText } from 'react-native-svg'
import { colors, palette, fonts } from '../theme'
import { useChartTooltipScope, useRegisterChartDismiss } from '../lib/chartTooltipScope'

interface ChartPoint {
  ts: string  // ISO timestamp
  y:  number
}

interface Props {
  data: ChartPoint[]
  /** Personal best — drawn as a dashed horizontal line if data.length > 1. */
  referenceY?: number | null
  /** Total chart height in px. Default 200 (matches web). */
  height?: number
  /** Y-axis label area width. 48 default; reps charts pass 32. */
  yWidth?: number
  /** Y-tick label formatter. Default identity. */
  yTickFormatter?: (v: number) => string
  /** Tooltip body — what goes after the small "label:" line. */
  tooltipValueFormatter?: (v: number) => string
  /** Tooltip label e.g. "Hold time", "Est. 1RM", "Reps". */
  tooltipLabel?: string
  /** Force integer-only ticks (used by reps chart). */
  allowDecimals?: boolean
  /** Override y-domain bounds — receives raw min/max, returns adjusted bounds. */
  yDomain?: {
    min?: (dataMin: number) => number
    max?: (dataMax: number) => number
  }
  /**
   * Invert the Y-axis (matches Recharts' `reversed` prop). Used by pace charts
   * where lower seconds-per-km = better, so we want the smallest value at the
   * TOP of the chart (improving = trend goes up).
   */
  reversed?: boolean
  /** Caption shown beneath the chart (e.g. "Dashed line = personal best"). */
  caption?: ReactNode
  /**
   * Line + dot stroke colour. Defaults to web's strength/cardio blue
   * (`palette.blue[400]` = `#60a5fa`). Pass an emerald or amber to match the
   * web's per-page colour (Bodyweight uses `#34d399`, Calories uses amber).
   */
  lineColor?: string
  /** Active (tap-pinned) dot radius. Default 8; web uses 7 on Bodyweight. */
  activeDotRadius?: number
}

const PADDING_TOP    = 8
const PADDING_BOTTOM = 24              // 4 (web) + 20 for x-tick text
const PADDING_RIGHT  = 16

// ── Date formatter (matches web's fmtDate) ─────────────────────────────────
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Fritsch-Carlson monotone cubic interpolation ──────────────────────────
// Produces an SVG `d` string with cubic Beziers between points such that the
// curve is monotone whenever the input is monotone (no overshoot).
function buildMonotonePath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`

  const n = pts.length
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])

  // Secant slopes Δ_k
  const dx: number[] = []
  const ms: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const _dx = xs[i+1] - xs[i] || 1e-9
    dx.push(_dx)
    ms.push((ys[i+1] - ys[i]) / _dx)
  }

  // Initial tangents at each point
  const ts: number[] = new Array(n)
  ts[0]     = ms[0]
  ts[n - 1] = ms[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (ms[i - 1] * ms[i] <= 0) ts[i] = 0
    else                        ts[i] = (ms[i - 1] + ms[i]) / 2
  }

  // Constrain to ensure monotonicity (Fritsch-Carlson 1980)
  for (let i = 0; i < n - 1; i++) {
    if (ms[i] === 0) { ts[i] = 0; ts[i+1] = 0; continue }
    const a = ts[i]   / ms[i]
    const b = ts[i+1] / ms[i]
    const h = a * a + b * b
    if (h > 9) {
      const tau = 3 / Math.sqrt(h)
      ts[i]     = tau * a * ms[i]
      ts[i+1]   = tau * b * ms[i]
    }
  }

  // Cubic Bezier control points
  let d = `M ${xs[0]} ${ys[0]}`
  for (let i = 0; i < n - 1; i++) {
    const cp1x = xs[i]   + dx[i] / 3
    const cp1y = ys[i]   + ts[i] * dx[i] / 3
    const cp2x = xs[i+1] - dx[i] / 3
    const cp2y = ys[i+1] - ts[i+1] * dx[i] / 3
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${xs[i+1]} ${ys[i+1]}`
  }
  return d
}

// ── Round-down nice-looking tick value (for integer reps axes) ────────────
function niceTicks(min: number, max: number, count: number, allowDecimals: boolean): number[] {
  if (max - min < 1e-9) return [min]
  const step = (max - min) / count
  const out: number[] = []
  for (let i = 0; i <= count; i++) {
    const v = min + step * i
    out.push(allowDecimals ? Math.round(v * 10) / 10 : Math.round(v))
  }
  // De-dup integer ticks if rounding collapses them
  return Array.from(new Set(out))
}

export default function LineChart({
  data,
  referenceY,
  height = 200,
  yWidth = 48,
  yTickFormatter = String,
  tooltipValueFormatter,
  tooltipLabel,
  allowDecimals = true,
  yDomain,
  reversed = false,
  caption,
  lineColor = palette.blue[400],   // matches web's `stroke="#60a5fa"` (Strength/Cardio default)
  activeDotRadius = 8,
}: Props) {
  const LINE_COLOR = lineColor
  const [width,    setWidth]     = useState(0)
  const [activeIx, setActiveIx]  = useState<number | null>(null)

  // Register with the global chart-tooltip scope so a tap anywhere on the
  // surrounding page (other cards, header, scroll) dismisses this chart's
  // pinned tooltip. markChartTouch in onPressIn prevents the scope from
  // unpinning the tooltip the chart just pinned.
  const dismiss = useCallback(() => setActiveIx(null), [])
  useRegisterChartDismiss(dismiss)
  const { markChartTouch } = useChartTooltipScope()

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width)
  }

  // No data → empty placeholder so the card still has size
  if (data.length === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  if (width === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  // ── Domain ──────────────────────────────────────────────────────────────
  const ys = data.map(p => p.y)
  const rawMin = Math.min(...ys)
  const rawMax = Math.max(...ys)
  const yMin = yDomain?.min ? yDomain.min(rawMin) : rawMin
  const yMaxRaw = yDomain?.max ? yDomain.max(rawMax) : rawMax
  // Avoid yMin === yMax (single-point series)
  const yMax = (yMaxRaw - yMin < 1e-9) ? yMin + 1 : yMaxRaw

  // ── Layout dims ─────────────────────────────────────────────────────────
  const plotW = Math.max(0, width  - yWidth - PADDING_RIGHT)
  const plotH = Math.max(0, height - PADDING_TOP - PADDING_BOTTOM)

  const xScale = (i: number) =>
    yWidth + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  // Default: yMax at top, yMin at bottom (so higher values appear higher).
  // Reversed: yMin at top (so lower-is-better metrics like pace point upward
  // for "improving").
  const yScale = reversed
    ? (y: number) => PADDING_TOP + ((y - yMin) / (yMax - yMin)) * plotH
    : (y: number) => PADDING_TOP + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const points: Array<[number, number]> = data.map((d, i) => [xScale(i), yScale(d.y)])
  const pathD = buildMonotonePath(points)

  // ── Y-axis ticks (4 segments → 5 ticks max) ──────────────────────────────
  const yTicks = niceTicks(yMin, yMax, 4, allowDecimals)

  // ── X-axis ticks: first + last (matches Recharts interval="preserveStartEnd") ──
  const xTickIxs = data.length === 1 ? [0] : [0, data.length - 1]

  // ── Touch handling: nearest point by x distance ─────────────────────────
  function onPressIn(e: GestureResponderEvent) {
    markChartTouch()
    const x = e.nativeEvent.locationX
    let bestIx = 0
    let bestDist = Infinity
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i][0] - x)
      if (dist < bestDist) { bestDist = dist; bestIx = i }
    }
    setActiveIx(bestIx === activeIx ? null : bestIx)
  }

  // ── Tooltip placement (clamped inside chart) ────────────────────────────
  const tooltip = activeIx != null ? (() => {
    const [px, py] = points[activeIx]
    const tipW = 120
    const tipH = 44
    let left = px - tipW / 2
    if (left < 4) left = 4
    if (left + tipW > width - 4) left = width - 4 - tipW
    const top = Math.max(0, py - tipH - 12)
    const dt = data[activeIx]
    return { left, top, dt, tipW, tipH }
  })() : null

  // Tap-anywhere-outside dismiss is handled globally by the
  // ChartTooltipProvider at the (app)/_layout level — no local outer
  // responder needed. Tap-same-point-to-deselect logic stays in onPressIn.
  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        <Svg width={width} height={height}>
          {/* Y-axis tick labels */}
          {yTicks.map((t, i) => (
            <SvgText
              key={`yt-${i}`}
              x={yWidth - 6}
              y={yScale(t) + 4}
              fill={colors.mutedForeground}
              fontSize={11}
              textAnchor="end"
            >
              {yTickFormatter(t)}
            </SvgText>
          ))}

          {/* X-axis tick labels (first + last) */}
          {xTickIxs.map(i => (
            <SvgText
              key={`xt-${i}`}
              x={xScale(i)}
              y={PADDING_TOP + plotH + 16}
              fill={colors.mutedForeground}
              fontSize={11}
              textAnchor={i === 0 ? 'start' : (i === data.length - 1 ? 'end' : 'middle')}
            >
              {fmtDate(data[i].ts)}
            </SvgText>
          ))}

          {/* Personal-best reference line */}
          {referenceY != null && data.length > 1 && (
            <SvgLine
              x1={yWidth}
              y1={yScale(referenceY)}
              x2={yWidth + plotW}
              y2={yScale(referenceY)}
              stroke={LINE_COLOR}
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeOpacity={0.4}
            />
          )}

          {/* Curve */}
          <Path d={pathD} stroke={LINE_COLOR} strokeWidth={2} fill="none" />

          {/* Dots */}
          {points.map(([x, y], i) => (
            <Circle
              key={`dot-${i}`}
              cx={x}
              cy={y}
              r={i === activeIx ? activeDotRadius : 4}
              fill={LINE_COLOR}
            />
          ))}
        </Svg>

        {/* Tap-to-pin tooltip overlay */}
        <Pressable
          onPressIn={onPressIn}
          style={StyleSheet.absoluteFill}
        />

        {tooltip && (
          <View
            pointerEvents="none"
            style={[
              s.tooltip,
              { left: tooltip.left, top: tooltip.top, width: tooltip.tipW, minHeight: tooltip.tipH },
            ]}
          >
            <Text style={s.tooltipDate}>{fmtDate(tooltip.dt.ts)}</Text>
            <Text style={s.tooltipValue}>
              {tooltipLabel ? `${tooltipLabel}: ` : ''}
              {(tooltipValueFormatter ?? String)(tooltip.dt.y)}
            </Text>
          </View>
        )}
      </View>

      {caption && <View style={{ marginTop: 8 }}>{caption}</View>}
    </View>
  )
}

const s = StyleSheet.create({
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tooltipDate: {
    color: colors.mutedForeground,
    fontSize: 11,
  },
  tooltipValue: {
    color: colors.foreground,
    fontSize: 12,
    fontFamily: fonts.mono[600],
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
})
