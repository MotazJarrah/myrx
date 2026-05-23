/**
 * HrRangeChart — per-day HR snapshot, three signals stacked vertically:
 *
 *   • RESTING (green dot, near the bottom) — the day's lowest non-workout HR
 *     sample. Pulled from `hr_samples` with `workout_id IS NULL`.
 *
 *   • AVERAGE (blue dot, middle) — the day's mean across all ambient HR
 *     samples. Skipped if the day has no ambient samples.
 *
 *   • PEAK RANGE (zone-coloured band, near the top) — the union of all
 *     workout HR ranges on that day. Drawn as a vertical band from
 *     min(workout.min_bpm) to max(workout.max_bpm) across the day's
 *     workouts. The band's fill is a vertical gradient mapped to the
 *     5-zone HR model so the colour at any point in the band tells you
 *     which training zone you were in at that bpm:
 *         Z1 Recovery  (50–60% HRmax) — slate
 *         Z2 Easy      (60–70%)        — emerald
 *         Z3 Tempo     (70–80%)        — amber
 *         Z4 Threshold (80–90%)        — orange
 *         Z5 VO2 Max   (90–100%)       — red
 *     The gradient is shared (one definition) and rendered with
 *     userSpaceOnUse so each band shows ONLY the colours that fall within
 *     its own bpm range — i.e. a band peaking at Z4 won't show any red.
 *
 * Tap a day's column to pin a tooltip with the underlying numbers and the
 * highest zone the peak reached.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import Svg, {
  Rect, Line as SvgLine, Circle, Text as SvgText, Defs, LinearGradient, Stop, G,
} from 'react-native-svg'
import { colors, palette, withAlpha, fonts } from '../theme'
import { useChartTooltipScope, useRegisterChartDismiss } from '../lib/chartTooltipScope'

export interface HrDayPoint {
  /** YYYY-MM-DD */
  day:           string
  /** Lowest non-workout HR sample of the day. null if no ambient samples. */
  resting:       number | null
  /** Mean of all ambient HR samples. null if no ambient samples. */
  avg:           number | null
  /** Lowest min_bpm across all workouts that day. null if no workouts. */
  peakRangeLow:  number | null
  /** Highest max_bpm across all workouts that day. null if no workouts. */
  peakRangeHigh: number | null
  /** How many workouts on the day — surfaced in the tooltip. */
  workoutCount:  number
  /**
   * Time-in-zone breakdown across ALL workouts on this day. Values are
   * sample counts (Samsung samples ~1 Hz, so count ≈ seconds). Used to
   * paint the band's vertical gradient with each zone's color
   * proportional to actual time spent. When null/empty (legacy workout
   * synced before per-second logging was wired), the band falls back to
   * a Y-position-anchored gradient.
   */
  timeInZone?:   { z1: number; z2: number; z3: number; z4: number; z5: number; belowZ1: number }
}

interface Props {
  data:     HrDayPoint[]
  /** Max heart rate (220 − age, or measured). Drives the zone boundaries. */
  hrMax:    number
  height?:  number
  caption?: ReactNode
}

const PADDING_TOP    = 12
const PADDING_BOTTOM = 28
const PADDING_RIGHT  = 12
const Y_WIDTH        = 32
const BAND_WIDTH     = 8
const DOT_R          = 4.5
const CORNER_RADIUS  = 3

const COLOR_RESTING = palette.emerald[400]
const COLOR_AVG     = palette.sky[400]

// Zone colours — used by the band gradient AND the tooltip / legend chips.
// Yellow → red "heat-map" spectrum: each step deepens within the warm
// palette (yellow → amber → orange → burnt orange → red).
const ZONE_COLORS = {
  z1:      palette.yellow[400],   // recovery   (50–60% HRmax)  — yellow
  z2:      palette.amber[400],    // easy       (60–70%)        — amber
  z3:      palette.orange[400],   // tempo      (70–80%)        — orange
  z4:      palette.orange[600],   // threshold  (80–90%)        — burnt orange
  z5:      palette.red[600],      // vo2 max    (90–100%)       — deep red
  belowZ1: palette.slate[500],    // resting territory, sub-Z1
} as const

/**
 * Classifies a bpm reading into one of the 5 HR zones (or 'below' if it
 * falls under Z1's lower bound, i.e. <50% HRmax — essentially resting).
 */
function zoneFor(bpm: number, hrMax: number): { id: 'below' | 'z1' | 'z2' | 'z3' | 'z4' | 'z5'; name: string } {
  const pct = bpm / hrMax
  if (pct < 0.50) return { id: 'below', name: 'Below Z1' }
  if (pct < 0.60) return { id: 'z1',    name: 'Z1 Recovery' }
  if (pct < 0.70) return { id: 'z2',    name: 'Z2 Easy' }
  if (pct < 0.80) return { id: 'z3',    name: 'Z3 Tempo' }
  if (pct < 0.90) return { id: 'z4',    name: 'Z4 Threshold' }
  return { id: 'z5', name: 'Z5 VO2 Max' }
}

/**
 * Builds the SVG gradient stops for a band whose colour proportions
 * mirror the workout's time-in-zone breakdown. Stops are computed
 * top-down (Z5 first → Z1 last) so the highest zone the user reached
 * sits at the top of the band. Zones with zero time are skipped — no
 * fake colour bands appear.
 *
 * Returns an array of { offset (0-1 string), color, opacity } stops
 * suitable for spreading into <Stop> elements.
 */
type ZoneTimes = NonNullable<HrDayPoint['timeInZone']>
type GradientStop = { offset: string; color: string; opacity: number }

function buildTimeInZoneStops(times: ZoneTimes, alpha: number): GradientStop[] {
  // Only training-zone time contributes to the band gradient. Time
  // below Z1 is resting territory and lives below the band entirely
  // (the band's bottom edge is anchored at the Z1 lower bound, so any
  // belowZ1 sample is outside the band's vertical extent).
  const total = times.z1 + times.z2 + times.z3 + times.z4 + times.z5
  if (total <= 0) return []
  // Walk zones top → bottom so the highest-intensity zone the user
  // actually touched gets painted at the band's TOP.
  const order: Array<{ time: number; color: string }> = [
    { time: times.z5, color: ZONE_COLORS.z5 },
    { time: times.z4, color: ZONE_COLORS.z4 },
    { time: times.z3, color: ZONE_COLORS.z3 },
    { time: times.z2, color: ZONE_COLORS.z2 },
    { time: times.z1, color: ZONE_COLORS.z1 },
  ]
  const stops: GradientStop[] = []
  let cum = 0
  for (let i = 0; i < order.length; i++) {
    const slice = order[i]
    if (slice.time <= 0) continue
    const startOffset = cum / total
    const endOffset   = (cum + slice.time) / total
    // Two stops per slice with the SAME color give a sharp segment.
    // The next slice's stops will create a sharp transition at the boundary.
    stops.push({ offset: startOffset.toFixed(4), color: slice.color, opacity: alpha })
    stops.push({ offset: endOffset.toFixed(4),   color: slice.color, opacity: alpha })
    cum += slice.time
  }
  return stops
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (max - min < 1e-9) return [min]
  const step = (max - min) / count
  const out: number[] = []
  for (let i = 0; i <= count; i++) out.push(Math.round(min + step * i))
  return Array.from(new Set(out))
}

/** Full day label used in the tooltip — "Mon 5/18". */
function fmtDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow  = date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${dow} ${m}/${d}`
}

/** Compact X-axis tick label — "5/18". Long-form label stays in the tooltip. */
function fmtAxisLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

export default function HrRangeChart({
  data,
  hrMax,
  height  = 240,
  caption,
}: Props) {
  const [width,    setWidth]    = useState(0)
  const [activeIx, setActiveIx] = useState<number | null>(null)

  // Register with the global chart-tooltip scope so any tap on the page
  // outside this chart's interactive area dismisses the pinned tooltip.
  // The dismiss callback is memoised so the scope's effect only re-runs
  // when the setter identity changes (which it doesn't, in practice).
  const dismiss = useCallback(() => setActiveIx(null), [])
  useRegisterChartDismiss(dismiss)
  const { markChartTouch } = useChartTooltipScope()

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width)
  }

  if (data.length === 0 || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  // ── Y-domain ───────────────────────────────────────────────────────────
  const allValues: number[] = []
  for (const d of data) {
    if (d.resting       != null) allValues.push(d.resting)
    if (d.avg           != null) allValues.push(d.avg)
    if (d.peakRangeLow  != null) allValues.push(d.peakRangeLow)
    if (d.peakRangeHigh != null) allValues.push(d.peakRangeHigh)
  }
  if (allValues.length === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const pad    = Math.max(4, Math.round((rawMax - rawMin) * 0.10))
  const yMin   = Math.max(30, rawMin - pad)
  const yMax   = Math.min(220, rawMax + pad)

  const plotW = Math.max(0, width  - Y_WIDTH - PADDING_RIGHT)
  const plotH = Math.max(0, height - PADDING_TOP - PADDING_BOTTOM)

  const xCenter = (i: number) =>
    Y_WIDTH + (data.length === 1 ? plotW / 2 : (i + 0.5) * (plotW / data.length))
  const yScale  = (y: number) =>
    PADDING_TOP + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const yTicks = niceTicks(yMin, yMax, 4)

  // ── Zone gradient — anchored in chart coordinates so each band's slice
  //    of the gradient matches its actual bpm range. ─────────────────────
  // y1 = top of Z5 (hrMax), y2 = bottom of Z1 (0.5 * hrMax).
  const gradTopY    = yScale(hrMax)           // small Y = chart top
  const gradBottomY = yScale(hrMax * 0.5)     // large Y = chart bottom
  // Zone boundaries' OFFSET positions within the gradient (0 = top, 1 = bottom):
  //   Z5 top    →   0.0
  //   Z4 top    →   0.2
  //   Z3 top    →   0.4
  //   Z2 top    →   0.6
  //   Z1 top    →   0.8
  //   Z1 bottom →   1.0

  /**
   * Returns the nearest day index for a touch X, OR `null` if the tap is
   * "far away" from any band's centre. The threshold (BAND_WIDTH * 2.5)
   * gives the user a generous hit zone around each column but still lets
   * a tap on the chart's empty side margins or axis area count as
   * "tapped nothing" — which dismisses the tooltip below.
   */
  function pickIx(x: number): number | null {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < data.length; i++) {
      const cx = xCenter(i)
      const d  = Math.abs(x - cx)
      if (d < bestD) { bestD = d; best = i }
    }
    if (bestD > BAND_WIDTH * 2.5) return null
    return best
  }

  /**
   * Tap handler attached to the Pressable overlay covering the chart area.
   *   • Tap a different day's column → pin that day.
   *   • Tap the currently-pinned column → unpin (toggle off).
   *   • Tap far from any column (axis, side margins) → unpin.
   *
   * Calls `markChartTouch()` first so the global ChartTooltipProvider's
   * onTouchEnd listener knows "this touch was for a chart, don't dismiss".
   * Without that, the bubbling touch-end on the page-level provider would
   * unpin the tooltip we just pinned.
   */
  function onChartPressIn(e: GestureResponderEvent) {
    markChartTouch()
    const ix = pickIx(e.nativeEvent.locationX)
    setActiveIx(prev => (ix === null || prev === ix) ? null : ix)
  }

  // The global ChartTooltipProvider handles dismiss for any tap outside
  // the chart's interactive Pressable — including the legend below, other
  // cards on the page, and any padding around. No local outer-View
  // responder needed.
  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        <Svg width={width} height={height}>
          {/* Per-band gradients: each day's band gets its own gradient whose
              colour stops mirror that day's TIME-IN-ZONE distribution.
              `objectBoundingBox` (the SVG default) maps the gradient to
              the band's own local coords — top = 0, bottom = 1. The
              highest-intensity zone the user touched paints the top of
              the band; lower zones stack below in proportion to time.
              We pre-render gradients here in <Defs> and reference them by
              id in each <Rect>'s fill. */}
          <Defs>
            {/* Y-position-anchored fallback. Used for legacy workouts
                synced before per-second HR logging was wired. The Z1
                boundary at 50% HRmax (yScale(hrMax*0.5)) sits inside the
                gradient — anything below it gets the darker
                belowZ1 colour so the visual transition is honest. */}
            {(() => {
              // Six even segments (0.0 - 0.166 - 0.333 - 0.5 - 0.666 - 0.833 - 1.0)
              // map to Z5 → Z4 → Z3 → Z2 → Z1 → belowZ1 from top to bottom.
              const SEG = 1 / 6
              const segs = [
                { c: ZONE_COLORS.z5      },
                { c: ZONE_COLORS.z4      },
                { c: ZONE_COLORS.z3      },
                { c: ZONE_COLORS.z2      },
                { c: ZONE_COLORS.z1      },
                { c: ZONE_COLORS.belowZ1 },
              ]
              // y2 anchors at hrMax*0.40 (well below 50% so the belowZ1
              // colour reaches all the way to the bottom of any band)
              const yBottom = yScale(hrMax * 0.40)
              const buildStops = (alpha: number) => segs.flatMap((s, i) => {
                const start = i * SEG
                const end   = (i + 1) * SEG
                return [
                  { offset: (start + 0.001).toFixed(4), color: s.c, opacity: alpha },
                  { offset: (end   - 0.001).toFixed(4), color: s.c, opacity: alpha },
                ]
              })
              const idleStops   = buildStops(0.90)
              const activeStops = buildStops(1.00)
              return (
                <G>
                  <LinearGradient
                    id="zoneGrad-fallback"
                    x1="0" y1={gradTopY} x2="0" y2={yBottom}
                    gradientUnits="userSpaceOnUse"
                  >
                    {idleStops.map((s, j) => (
                      <Stop key={`fbi-${j}`} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                    ))}
                  </LinearGradient>
                  <LinearGradient
                    id="zoneGrad-fallback-active"
                    x1="0" y1={gradTopY} x2="0" y2={yBottom}
                    gradientUnits="userSpaceOnUse"
                  >
                    {activeStops.map((s, j) => (
                      <Stop key={`fba-${j}`} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                    ))}
                  </LinearGradient>
                </G>
              )
            })()}
            {/* Per-day time-in-zone gradients.
                Stops at 0.90 idle / 1.00 active so the band colours match
                the saturated look of the legend swatches. Lower alphas
                (0.55) made bands look washed out against the dark chart
                background. */}
            {data.map((d, i) => {
              if (!d.timeInZone) return null
              const idleStops   = buildTimeInZoneStops(d.timeInZone, 0.90)
              const activeStops = buildTimeInZoneStops(d.timeInZone, 1.00)
              if (idleStops.length === 0) return null
              return (
                <G key={`grad-${i}`}>
                  <LinearGradient
                    id={`zoneGrad-${i}`}
                    x1="0" y1="0" x2="0" y2="1"
                  >
                    {idleStops.map((s, j) => (
                      <Stop key={`is-${j}`} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                    ))}
                  </LinearGradient>
                  <LinearGradient
                    id={`zoneGrad-${i}-active`}
                    x1="0" y1="0" x2="0" y2="1"
                  >
                    {activeStops.map((s, j) => (
                      <Stop key={`as-${j}`} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                    ))}
                  </LinearGradient>
                </G>
              )
            })}
          </Defs>

          {/* Y-axis grid + tick labels.
              Use <G> rather than nested <Svg> — nested <Svg> creates a new
              SVG context that can't see the parent's <Defs>, which made our
              `url(#zoneGrad)` references resolve to nothing (bands rendered
              black). <G> is just a transform/grouping element so the parent
              Defs stays in scope. */}
          {yTicks.map((t, i) => {
            const y = yScale(t)
            return (
              <G key={`yt-${i}`}>
                <SvgLine
                  x1={Y_WIDTH}
                  x2={width - PADDING_RIGHT}
                  y1={y}
                  y2={y}
                  stroke={withAlpha(palette.slate[500], 0.12)}
                  strokeWidth={1}
                />
                <SvgText
                  x={Y_WIDTH - 6}
                  y={y + 4}
                  fontSize={10}
                  fontFamily={fonts.mono[500]}
                  fill={colors.mutedForeground}
                  textAnchor="end"
                >
                  {String(t)}
                </SvgText>
              </G>
            )
          })}

          {/* Per-day glyphs */}
          {data.map((d, i) => {
            const cx       = xCenter(i)
            const isActive = activeIx === i

            const peakBand =
              d.peakRangeLow != null && d.peakRangeHigh != null
                ? (() => {
                    const top    = yScale(d.peakRangeHigh)
                    const bottom = yScale(d.peakRangeLow)
                    const h      = Math.max(2, bottom - top)
                    return { top, bottom, h }
                  })()
                : null

            return (
              <G key={`col-${d.day}`}>
                {/* PEAK RANGE — band fill uses the day's per-band
                    time-in-zone gradient if we have per-second HR data;
                    otherwise falls back to the Y-position-anchored
                    gradient (legacy workouts synced before HR logging). */}
                {peakBand && (() => {
                  const hasTimeInZone =
                    d.timeInZone != null &&
                    (d.timeInZone.z1 + d.timeInZone.z2 + d.timeInZone.z3 +
                     d.timeInZone.z4 + d.timeInZone.z5 + d.timeInZone.belowZ1) > 0
                  const fillUrl = hasTimeInZone
                    ? (isActive ? `url(#zoneGrad-${i}-active)` : `url(#zoneGrad-${i})`)
                    : (isActive ? 'url(#zoneGrad-fallback-active)' : 'url(#zoneGrad-fallback)')
                  // No stroke — the gray slate outline previously used was
                  // narrowing the visible fill area on these thin (8px) bands
                  // and muddying the colours. Active state still pops via
                  // the higher-opacity active gradient + the day pill above.
                  return (
                    <Rect
                      x={cx - BAND_WIDTH / 2}
                      y={peakBand.top}
                      width={BAND_WIDTH}
                      height={peakBand.h}
                      rx={CORNER_RADIUS}
                      ry={CORNER_RADIUS}
                      fill={fillUrl}
                    />
                  )
                })()}

                {/* AVG DOT — sky blue */}
                {d.avg != null && (
                  <Circle
                    cx={cx}
                    cy={yScale(d.avg)}
                    r={isActive ? DOT_R + 1 : DOT_R}
                    fill={COLOR_AVG}
                    stroke={colors.background}
                    strokeWidth={1.5}
                  />
                )}

                {/* RESTING DOT — emerald */}
                {d.resting != null && (
                  <Circle
                    cx={cx}
                    cy={yScale(d.resting)}
                    r={isActive ? DOT_R + 1 : DOT_R}
                    fill={COLOR_RESTING}
                    stroke={colors.background}
                    strokeWidth={1.5}
                  />
                )}

                {/* Day label — compact M/D form so 7-8 labels fit. The
                    full "Mon 5/18" version stays in the tooltip. */}
                <SvgText
                  x={cx}
                  y={height - 10}
                  fontSize={10}
                  fontFamily={fonts.sans[500]}
                  fill={isActive ? colors.foreground : colors.mutedForeground}
                  textAnchor="middle"
                >
                  {fmtAxisLabel(d.day)}
                </SvgText>
              </G>
            )
          })}
        </Svg>

        {/* Tap overlay — captures all taps inside the chart area. Same
            pattern LineChart uses, which the SVG-responder approach
            doesn't reliably match on Android because react-native-svg
            swallows some responder lifecycle events. */}
        <Pressable
          onPressIn={onChartPressIn}
          style={StyleSheet.absoluteFill}
        />

        {/* Small "selected-day" hint anchored over the active band so the
            user has a visual link between the pinned column and the
            details panel that appears below the chart. Just the date,
            kept tiny so it doesn't crowd the bands. */}
        {activeIx != null && (() => {
          const d        = data[activeIx]
          const cx       = xCenter(activeIx)
          const topGlyphY =
            d.peakRangeHigh != null ? yScale(d.peakRangeHigh)
            : d.avg           != null ? yScale(d.avg)
            : d.resting       != null ? yScale(d.resting)
            : PADDING_TOP
          const pillW = 72
          const tx    = Math.max(4, Math.min(width - pillW - 4, cx - pillW / 2))
          const ty    = Math.max(4, topGlyphY - 22)
          return (
            <View
              pointerEvents="none"
              style={[styles.dayPill, { left: tx, top: ty, width: pillW }]}
            >
              <Text style={styles.dayPillText}>{fmtDayLabel(d.day)}</Text>
            </View>
          )
        })()}
      </View>

      {/* Below the chart: swap the legend for an inline "active day details"
          panel when a band is pinned. Same vertical space either way, no
          layout shift. The details panel can run the full chart width so
          it never needs to hide bands or truncate text. */}
      {activeIx == null ? (
        // ── Default: zone + dot legend ──────────────────────────────────
        <View style={styles.legendContainer}>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLOR_RESTING }]} />
              <Text style={styles.legendText}>Resting</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLOR_AVG }]} />
              <Text style={styles.legendText}>Avg</Text>
            </View>
          </View>
          <View style={styles.zoneLegendRow}>
            {([
              { id: 'z1', label: 'Z1', lo: Math.round(hrMax * 0.50), hi: Math.round(hrMax * 0.60), color: ZONE_COLORS.z1 },
              { id: 'z2', label: 'Z2', lo: Math.round(hrMax * 0.60), hi: Math.round(hrMax * 0.70), color: ZONE_COLORS.z2 },
              { id: 'z3', label: 'Z3', lo: Math.round(hrMax * 0.70), hi: Math.round(hrMax * 0.80), color: ZONE_COLORS.z3 },
              { id: 'z4', label: 'Z4', lo: Math.round(hrMax * 0.80), hi: Math.round(hrMax * 0.90), color: ZONE_COLORS.z4 },
              { id: 'z5', label: 'Z5', lo: Math.round(hrMax * 0.90), hi: Math.round(hrMax),        color: ZONE_COLORS.z5 },
            ] as const).map(z => (
              <View key={z.id} style={styles.zoneChip}>
                <View style={[styles.zoneSwatch, { backgroundColor: withAlpha(z.color, 0.55), borderColor: z.color }]} />
                <Text style={styles.zoneChipLabel}>{z.label}</Text>
                <Text style={styles.zoneChipRange}>{z.lo}–{z.hi}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        // ── Pinned: active day's full details ────────────────────────────
        (() => {
          const d        = data[activeIx]
          const peakZone = d.peakRangeHigh != null ? zoneFor(d.peakRangeHigh, hrMax) : null
          const lowZone  = d.peakRangeLow  != null ? zoneFor(d.peakRangeLow,  hrMax) : null
          const zoneLabel = lowZone && peakZone
            ? (lowZone.name === peakZone.name
                ? lowZone.name
                : `${lowZone.name.split(' ')[0]}–${peakZone.name.split(' ')[0]}`)
            : null

          return (
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsHeader}>
                {fmtDayLabel(d.day)}
                {d.workoutCount > 0 ? `  ·  ${d.workoutCount} workout${d.workoutCount === 1 ? '' : 's'}` : ''}
              </Text>
              <View style={styles.detailsRowGroup}>
                {d.resting != null && (
                  <View style={styles.detailsRow}>
                    <View style={[styles.detailsDot, { backgroundColor: COLOR_RESTING }]} />
                    <Text style={styles.detailsKey}>Resting</Text>
                    <Text style={[styles.detailsVal, { color: COLOR_RESTING }]}>{d.resting} <Text style={styles.detailsUnit}>bpm</Text></Text>
                  </View>
                )}
                {d.avg != null && (
                  <View style={styles.detailsRow}>
                    <View style={[styles.detailsDot, { backgroundColor: COLOR_AVG }]} />
                    <Text style={styles.detailsKey}>Avg</Text>
                    <Text style={[styles.detailsVal, { color: COLOR_AVG }]}>{d.avg} <Text style={styles.detailsUnit}>bpm</Text></Text>
                  </View>
                )}
                {d.peakRangeHigh != null && d.peakRangeLow != null && peakZone && (
                  <View style={styles.detailsRow}>
                    <View style={[styles.detailsDot, { backgroundColor: ZONE_COLORS[peakZone.id === 'below' ? 'z1' : peakZone.id] }]} />
                    <Text style={styles.detailsKey}>Peak</Text>
                    <Text style={[styles.detailsVal, { color: ZONE_COLORS[peakZone.id === 'below' ? 'z1' : peakZone.id] }]}>
                      {d.peakRangeLow}–{d.peakRangeHigh} <Text style={styles.detailsUnit}>bpm</Text>
                    </Text>
                  </View>
                )}
              </View>
              {zoneLabel && (
                <Text style={styles.detailsZoneLine}>
                  Workout zone: <Text style={styles.detailsZoneEmphasis}>{zoneLabel}</Text>
                </Text>
              )}
            </View>
          )
        })()
      )}
      {caption}
    </View>
  )
}

const styles = StyleSheet.create({
  legendContainer: {
    marginTop:   8,
    paddingLeft: Y_WIDTH,
    gap:         6,
  },
  legendRow: {
    flexDirection: 'row',
    gap:           14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  legendDot: {
    width:        9,
    height:       9,
    borderRadius: 5,
  },
  legendText: {
    color:    colors.mutedForeground,
    fontSize: 10,
  },

  // Zone strip: five compact chips in a row — colour swatch + Z label + bpm range.
  zoneLegendRow: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
  },
  zoneSwatch: {
    width:        10,
    height:       10,
    borderRadius: 2,
    borderWidth:  1,
  },
  zoneChipLabel: {
    color:      colors.foreground,
    fontSize:   10,
    fontWeight: '600',
  },
  zoneChipRange: {
    color:      colors.mutedForeground,
    fontSize:   9,
    fontFamily: fonts.mono[500],
  },

  // Small floating "Mon 5/18" pill over the active band — visual anchor
  // for the details panel below.
  dayPill: {
    position:        'absolute',
    backgroundColor: withAlpha('#000000', 0.85),
    borderColor:     withAlpha(palette.slate[400], 0.25),
    borderWidth:     1,
    borderRadius:    10,
    paddingVertical: 2,
    paddingHorizontal: 6,
    alignItems:      'center',
  },
  dayPillText: {
    color:      colors.foreground,
    fontSize:   10,
    fontWeight: '700',
    fontFamily: fonts.sans[600],
  },

  // Inline details panel that replaces the legend when a day is pinned.
  detailsContainer: {
    marginTop:       8,
    paddingLeft:     Y_WIDTH,
    gap:             4,
  },
  detailsHeader: {
    color:      colors.foreground,
    fontSize:   12,
    fontWeight: '700',
    marginBottom: 2,
  },
  detailsRowGroup: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    columnGap:     14,
    rowGap:        4,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  detailsDot: {
    width:        9,
    height:       9,
    borderRadius: 5,
  },
  detailsKey: {
    color:    colors.mutedForeground,
    fontSize: 11,
  },
  detailsVal: {
    fontSize:   13,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
  },
  detailsUnit: {
    fontSize:   10,
    fontWeight: '600',
    opacity:    0.7,
  },
  detailsZoneLine: {
    color:    colors.mutedForeground,
    fontSize: 11,
    marginTop: 2,
  },
  detailsZoneEmphasis: {
    color:      colors.foreground,
    fontWeight: '700',
  },
})
