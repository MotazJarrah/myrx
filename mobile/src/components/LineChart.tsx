/**
 * LineChart — Skia-migrated 2026-05-31. Originally a react-native-svg port of
 * the Recharts <LineChart> usage in MyRX/src/pages/StrengthDetail.jsx (and
 * later CardioDetail / BodyweightDetail).
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
 *
 * Rendering — GPU-backed via @shopify/react-native-skia. All shape work
 * (curve, dashed reference line, dots) draws inside a single Skia <Canvas>.
 * Text labels (axis ticks, tooltip body) remain absolute-positioned RN
 * <Text>/<View> overlays above the canvas — Skia's text-rendering API
 * would require loading Geist through it, and these labels are static
 * (no per-frame animation), so the overlay path is fine. See Pattern 9
 * of CLAUDE.md and SleepClock.tsx for the canonical Skia patterns this
 * file follows.
 */

import { useCallback, useEffect, useState, useMemo, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native'
import { Canvas, Path, Circle, Skia, Group, DashPathEffect, type SkPath } from '@shopify/react-native-skia'
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
// Produces a Skia path with cubic Beziers between points such that the curve
// is monotone whenever the input is monotone (no overshoot). Math unchanged
// from the SVG version — it's the curve-shape contract, not a render concern.
function buildMonotoneSkiaPath(pts: Array<[number, number]>): SkPath {
  const path = Skia.Path.Make()
  if (pts.length === 0) return path
  if (pts.length === 1) {
    path.moveTo(pts[0][0], pts[0][1])
    return path
  }

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
  path.moveTo(xs[0], ys[0])
  for (let i = 0; i < n - 1; i++) {
    const cp1x = xs[i]   + dx[i] / 3
    const cp1y = ys[i]   + ts[i] * dx[i] / 3
    const cp2x = xs[i+1] - dx[i] / 3
    const cp2y = ys[i+1] - ts[i+1] * dx[i] / 3
    path.cubicTo(cp1x, cp1y, cp2x, cp2y, xs[i+1], ys[i+1])
  }
  return path
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
  // Clear a pinned tooltip whenever the dataset size changes (e.g. the bodyweight
  // chart re-filtering to a different tier on pill swipe) — a stale index would
  // otherwise point past the end of the new `points` array and crash the
  // destructure below.
  useEffect(() => { setActiveIx(null) }, [data.length])

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

  // ── Domain ──────────────────────────────────────────────────────────────
  // Computed before any early returns so useMemo hooks below can depend on
  // the same scalars without conditional-hook headaches.
  const ys      = data.map(p => p.y)
  const rawMin  = data.length > 0 ? Math.min(...ys) : 0
  const rawMax  = data.length > 0 ? Math.max(...ys) : 1
  const yMin    = yDomain?.min ? yDomain.min(rawMin) : rawMin
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

  // Skia path for the monotone-cubic curve. Memoised so we don't rebuild it
  // on every render — only when layout or data changes. The path is a native
  // Skia object; rebuilding it allocates GPU resources, so caching matters.
  const curvePath = useMemo(
    () => buildMonotoneSkiaPath(points),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, yWidth, data.length, yMin, yMax, reversed,
     // Include the actual point values so a same-length-different-data update
     // (e.g. swiping to a different exercise) rebuilds the path:
     data.map(d => `${d.ts}:${d.y}`).join('|')],
  )

  // Skia path for the dashed personal-best reference line. Null when no
  // reference line is shown (single-point series, or no PB provided).
  const referencePath = useMemo<SkPath | null>(() => {
    if (referenceY == null || data.length <= 1) return null
    const p = Skia.Path.Make()
    p.moveTo(yWidth, yScale(referenceY))
    p.lineTo(yWidth + plotW, yScale(referenceY))
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceY, data.length, yWidth, plotW, yMin, yMax, reversed, height])

  // No data → empty placeholder so the card still has size
  if (data.length === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  if (width === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

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
  const tooltip = (activeIx != null && activeIx >= 0 && activeIx < points.length) ? (() => {
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
        {/* Skia canvas paints the chart shapes (reference line, curve,
            dots) at native speed. Text labels overlay above as
            absolute-positioned RN <Text>. */}
        <Canvas style={{ width, height }}>
          {/* Personal-best reference line — dashed, 40% opacity. The
              DashPathEffect is a CHILD of the <Path> per Skia's scoping
              rules (NOT a top-level <Defs> like SVG). intervals=[4,3]
              mirrors the original strokeDasharray="4 3". */}
          {referencePath && (
            <Path
              path={referencePath}
              color={LINE_COLOR}
              style="stroke"
              strokeWidth={1}
              opacity={0.4}
            >
              <DashPathEffect intervals={[4, 3]} />
            </Path>
          )}

          {/* Curve — Fritsch-Carlson monotone cubic. */}
          <Path
            path={curvePath}
            color={LINE_COLOR}
            style="stroke"
            strokeWidth={2}
          />

          {/* Dots — one per data point, with the active one larger. */}
          <Group>
            {points.map(([x, y], i) => (
              <Circle
                key={`dot-${i}`}
                cx={x}
                cy={y}
                r={i === activeIx ? activeDotRadius : 4}
                color={LINE_COLOR}
              />
            ))}
          </Group>
        </Canvas>

        {/* Y-axis tick labels — RN Text overlay. Static, no per-frame
            animation, so Skia text rendering isn't necessary. Matches
            SVG's textAnchor="end" via right-aligned text inside a box
            ending at yWidth - 6. */}
        {yTicks.map((t, i) => (
          <Text
            key={`yt-${i}`}
            style={[
              s.yTickLabel,
              {
                left:  0,
                top:   yScale(t) - 7,
                width: yWidth - 6,
              },
            ]}
          >
            {yTickFormatter(t)}
          </Text>
        ))}

        {/* X-axis tick labels (first + last) — RN Text overlay. */}
        {xTickIxs.map(i => {
          const isLast  = i === data.length - 1
          const isFirst = i === 0 && data.length > 1
          // Match SVG's textAnchor: first = start, last = end, single = middle
          const align: 'left' | 'right' | 'center' =
            isFirst ? 'left' : (isLast ? 'right' : 'center')
          const x = xScale(i)
          const TICK_W = 80
          let left: number
          if (align === 'left')       left = x
          else if (align === 'right') left = x - TICK_W
          else                        left = x - TICK_W / 2
          return (
            <Text
              key={`xt-${i}`}
              style={[
                s.xTickLabel,
                {
                  left,
                  top:       PADDING_TOP + plotH + 6,
                  width:     TICK_W,
                  textAlign: align,
                },
              ]}
            >
              {fmtDate(data[i].ts)}
            </Text>
          )
        })}

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
  yTickLabel: {
    position:  'absolute',
    color:     colors.mutedForeground,
    fontSize:  11,
    textAlign: 'right',
  },
  xTickLabel: {
    position: 'absolute',
    color:    colors.mutedForeground,
    fontSize: 11,
  },
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
