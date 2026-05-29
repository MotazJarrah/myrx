/**
 * Hypnogram — last-night sleep architecture as a horizontal stage-stream.
 *
 * Signature visualization of the Sleep page. Stages (Awake / Light / REM /
 * Deep) stack vertically as horizontal bands across the night's timeline.
 * Each stage occupies a fixed row at a fixed Y; a coloured rectangle spans
 * the duration of each stage segment, producing the classic "hypnogram"
 * staircase pattern that sleep researchers recognise at a glance.
 *
 * Interaction: tap a stage segment to pin a tooltip showing the stage name,
 * the segment's clock-time range, and its duration. Pinning hooks into the
 * global ChartTooltipScope so a tap anywhere else on the page dismisses it
 * — same pattern as HrRangeChart / LineChart.
 *
 * Empty/sparse data: if `stages` is empty, renders an empty 60 px frame
 * (caller decides whether to surface an empty-state above it). If Samsung
 * Health reports gaps between stages (some sessions have a few unrecorded
 * minutes where the watch lost contact), the gaps render as background —
 * we deliberately don't paper over them with an interpolated Awake band.
 */

import { useCallback, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native'
import Svg, { Rect, Line as SvgLine, Text as SvgText } from 'react-native-svg'
import { colors, palette, withAlpha, fonts } from '../theme'
import { useChartTooltipScope, useRegisterChartDismiss } from '../lib/chartTooltipScope'

export type SleepStage = 'awake' | 'light' | 'rem' | 'deep'

export interface HypnogramSegment {
  stage:      SleepStage
  start_at:   string  // ISO timestamp
  end_at:     string  // ISO timestamp
  duration_s: number
}

interface Props {
  segments:        HypnogramSegment[]
  /** Overall window start (start of the sleep session). */
  sessionStart:    string
  /** Overall window end (end of the sleep session). */
  sessionEnd:      string
  /** Total chart height — band area only, not counting tooltip overlay. */
  height?:         number
}

const PADDING_TOP    = 6
const PADDING_BOTTOM = 18  // room for the X-axis hour labels
const PADDING_X      = 4

// Y-row order (top → bottom): Awake on top (most "outside" of sleep),
// then Light, REM in the middle (closer to deep — classic hypnogram
// arrangement), Deep at the bottom (deepest sleep = lowest row).
const ROW_ORDER: SleepStage[] = ['awake', 'light', 'rem', 'deep']

/**
 * Sleep stage palette — picked to read as a coherent "depth ladder":
 *   Awake → muted zinc/slate (absent state)
 *   Light → amber (transitional, warm but light)
 *   REM   → violet (dream territory — culturally associated)
 *   Deep  → indigo (deepest "down" state)
 */
const STAGE_COLOR: Record<SleepStage, string> = {
  awake: palette.slate[400],
  light: palette.amber[400],
  rem:   palette.violet[400],
  deep:  palette.indigo[400],
}

const STAGE_LABEL: Record<SleepStage, string> = {
  awake: 'Awake',
  light: 'Light',
  rem:   'REM',
  deep:  'Deep',
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtSegDuration(s: number): string {
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

export default function Hypnogram({
  segments,
  sessionStart,
  sessionEnd,
  height = 100,
}: Props) {
  const [width,    setWidth]    = useState(0)
  const [activeIx, setActiveIx] = useState<number | null>(null)

  // Register dismiss callback with the global chart-tooltip scope so taps
  // anywhere else on the page unpin this hypnogram's tooltip.
  const dismiss = useCallback(() => setActiveIx(null), [])
  useRegisterChartDismiss(dismiss)
  const { markChartTouch } = useChartTooltipScope()

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width)
  }

  if (segments.length === 0 || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  const startMs = new Date(sessionStart).getTime()
  const endMs   = new Date(sessionEnd).getTime()
  const totalMs = Math.max(1, endMs - startMs)

  const plotW = Math.max(0, width  - PADDING_X * 2)
  const plotH = Math.max(0, height - PADDING_TOP - PADDING_BOTTOM)

  const rowH  = plotH / ROW_ORDER.length

  function xForMs(ms: number): number {
    const t = (ms - startMs) / totalMs
    return PADDING_X + Math.max(0, Math.min(1, t)) * plotW
  }

  function yForStage(stage: SleepStage): number {
    const ix = ROW_ORDER.indexOf(stage)
    return PADDING_TOP + ix * rowH
  }

  // Pick the nearest segment for a tap X. Each segment owns its full
  // width window. If the tap falls in a gap between segments, returns
  // null (which dismisses the tooltip).
  function pickIx(x: number): number | null {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const x1 = xForMs(new Date(seg.start_at).getTime())
      const x2 = xForMs(new Date(seg.end_at).getTime())
      if (x >= x1 && x <= x2) return i
    }
    return null
  }

  function onChartPressIn(e: GestureResponderEvent) {
    markChartTouch()
    const ix = pickIx(e.nativeEvent.locationX)
    setActiveIx(prev => (ix === null || prev === ix) ? null : ix)
  }

  // Compute hour tick positions for the X-axis (every 2 hours or so).
  const hourTicks: { x: number; label: string }[] = []
  {
    const totalHours = totalMs / 3600_000
    const tickEvery  = totalHours > 9 ? 2 : 1   // 2-hour ticks for long sessions
    const startHour  = new Date(startMs)
    startHour.setMinutes(0, 0, 0)
    if (startHour.getTime() < startMs) startHour.setHours(startHour.getHours() + 1)
    for (let t = startHour.getTime(); t <= endMs; t += tickEvery * 3600_000) {
      const date  = new Date(t)
      const hour  = date.getHours()
      const label = `${((hour + 11) % 12) + 1}${hour < 12 ? 'a' : 'p'}`
      hourTicks.push({ x: xForMs(t), label })
    }
  }

  const active = activeIx != null ? segments[activeIx] : null

  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        <Svg width={width} height={height}>
          {/* Faint row guides — each stage row gets a horizontal hairline
              at the row's baseline so the eye can scan stages even where
              no segment is drawn. */}
          {ROW_ORDER.map((stage) => (
            <SvgLine
              key={`guide-${stage}`}
              x1={PADDING_X} x2={width - PADDING_X}
              y1={yForStage(stage) + rowH / 2}
              y2={yForStage(stage) + rowH / 2}
              stroke={withAlpha('#ffffff', 0.04)}
              strokeWidth={1}
            />
          ))}

          {/* Each segment renders as a coloured rounded rectangle in its
              stage's row. Active segment gets a brighter fill + thin
              outline so the user can see which one they tapped. */}
          {segments.map((seg, i) => {
            const x1 = xForMs(new Date(seg.start_at).getTime())
            const x2 = xForMs(new Date(seg.end_at).getTime())
            const w  = Math.max(1, x2 - x1)
            const y  = yForStage(seg.stage) + 2
            const h  = Math.max(1, rowH - 4)
            const color = STAGE_COLOR[seg.stage]
            const isActive = i === activeIx
            return (
              <Rect
                key={`seg-${i}`}
                x={x1} y={y} width={w} height={h} rx={2}
                fill={withAlpha(color, isActive ? 0.95 : 0.75)}
                stroke={isActive ? color : 'transparent'}
                strokeWidth={isActive ? 1.5 : 0}
              />
            )
          })}

          {/* X-axis hour ticks */}
          {hourTicks.map((t, i) => (
            <SvgText
              key={`ax-${i}`}
              x={t.x}
              y={height - 4}
              fill={colors.mutedForeground}
              fontSize={9}
              fontFamily={fonts.mono[500]}
              textAnchor="middle"
            >
              {t.label}
            </SvgText>
          ))}
        </Svg>

        {/* Touch overlay covers the band area only (not the axis row). */}
        <Pressable
          onPressIn={onChartPressIn}
          style={[
            StyleSheet.absoluteFill,
            { top: 0, bottom: PADDING_BOTTOM },
          ]}
        />
      </View>

      {/* Tooltip — pinned just above the bands when a segment is active. */}
      {active && (
        <View style={s.tooltip} pointerEvents="none">
          <View style={[s.tooltipDot, { backgroundColor: STAGE_COLOR[active.stage] }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.tooltipTitle}>{STAGE_LABEL[active.stage]}</Text>
            <Text style={s.tooltipSub}>
              {fmtClock(active.start_at)} – {fmtClock(active.end_at)}  ·  {fmtSegDuration(active.duration_s)}
            </Text>
          </View>
        </View>
      )}

      {/* Compact legend — one chip per stage in the SAME row order as the
          bands. Cosmetic only; matches the bands' colour to the label. */}
      <View style={s.legendRow}>
        {ROW_ORDER.map((stage) => (
          <View key={`leg-${stage}`} style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: STAGE_COLOR[stage] }]} />
            <Text style={s.legendLabel}>{STAGE_LABEL[stage]}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  tooltip: {
    marginTop:       6,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    backgroundColor: withAlpha('#000000', 0.55),
    borderColor:     colors.border,
    borderWidth:     1,
    borderRadius:    8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  tooltipDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
  },
  tooltipTitle: {
    color:      colors.foreground,
    fontSize:   12,
    fontWeight: '700',
  },
  tooltipSub: {
    color:    colors.mutedForeground,
    fontSize: 11,
    marginTop: 1,
  },
  legendRow: {
    marginTop:     8,
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
    justifyContent: 'flex-start',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  legendSwatch: {
    width:        8,
    height:       8,
    borderRadius: 2,
  },
  legendLabel: {
    color:    colors.mutedForeground,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
})
