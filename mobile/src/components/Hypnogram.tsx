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
 *
 * Rendering — GPU-backed via @shopify/react-native-skia (Pattern 9, see
 * CLAUDE.md). All shapes paint inside a single <Canvas> on the GPU thread
 * instead of nested <Svg>/<Rect>/<Line> primitives. Per-night a session may
 * produce 50–200 stage segments; the previous SVG implementation rendered
 * each Rect as its own native view + Yoga layout pass, which contributed
 * to the Sleep page's draggy-scroll problem. Skia paints the entire band
 * grid + segment array + row guides in one native draw call. No animations
 * here (static visualization), so the port skips Reanimated entirely —
 * the SkPath is built once per render via useMemo and handed to Skia.
 *
 * Axis labels (hour ticks) render as absolute-positioned RN <Text>
 * overlays above the canvas. Skia has a text-rendering API but loading
 * the Geist Mono font through it requires extra setup, and the labels
 * are static + few (≤12 ticks), so RN Text is the right tier here.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native'
import {
  Canvas, Path, Group, Skia,
  type SkPath,
} from '@shopify/react-native-skia'
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

/**
 * Build a Skia path for a rounded-rectangle segment block. Used in a
 * useMemo for the per-segment paths — the geometry is static once the
 * tap target / layout settles, so there's no per-frame work to push
 * into a worklet. Skia.Path.Make() returns a fresh mutable path.
 */
function buildRoundedRectPath(
  x: number, y: number, w: number, h: number, rx: number,
): SkPath {
  const path = Skia.Path.Make()
  path.addRRect({
    rect: { x, y, width: w, height: h },
    rx, ry: rx,
  })
  return path
}

/** Build a 1px horizontal line path at (x1,y) → (x2,y). */
function buildHLinePath(x1: number, x2: number, y: number): SkPath {
  const path = Skia.Path.Make()
  path.moveTo(x1, y)
  path.lineTo(x2, y)
  return path
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

  // ─── Geometry pre-compute (memoized so canvas paths don't rebuild
  // on every tap — only on data / size changes). ──────────────────────
  const geom = useMemo(() => {
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

    return { startMs, endMs, totalMs, plotW, plotH, rowH, xForMs, yForStage }
  }, [sessionStart, sessionEnd, width, height])

  // Segment geometry — recomputed only when segments / size change.
  // Each entry carries the path + raw bounds (for hit testing) + colour.
  const segGeom = useMemo(() => {
    if (width === 0 || segments.length === 0) return []
    return segments.map((seg) => {
      const x1 = geom.xForMs(new Date(seg.start_at).getTime())
      const x2 = geom.xForMs(new Date(seg.end_at).getTime())
      const w  = Math.max(1, x2 - x1)
      const y  = geom.yForStage(seg.stage) + 2
      const h  = Math.max(1, geom.rowH - 4)
      const color = STAGE_COLOR[seg.stage]
      return {
        x1, x2, y, h, w, color,
        // Two paths per segment: fill + stroke (Skia draws each as a
        // separate <Path>, so we precompute both shapes once).
        path: buildRoundedRectPath(x1, y, w, h, 2),
      }
    })
  }, [segments, width, geom])

  // Row-guide paths — one horizontal hairline at the center of each row.
  const guidePaths = useMemo(() => {
    if (width === 0) return []
    return ROW_ORDER.map((stage) => ({
      stage,
      path: buildHLinePath(
        PADDING_X,
        width - PADDING_X,
        geom.yForStage(stage) + geom.rowH / 2,
      ),
    }))
  }, [width, geom])

  // Hour tick positions for the X-axis (every 2 hours or so).
  const hourTicks = useMemo(() => {
    if (width === 0 || segments.length === 0) return []
    const out: { x: number; label: string }[] = []
    const totalHours = geom.totalMs / 3600_000
    const tickEvery  = totalHours > 9 ? 2 : 1   // 2-hour ticks for long sessions
    const startHour  = new Date(geom.startMs)
    startHour.setMinutes(0, 0, 0)
    if (startHour.getTime() < geom.startMs) startHour.setHours(startHour.getHours() + 1)
    for (let t = startHour.getTime(); t <= geom.endMs; t += tickEvery * 3600_000) {
      const date  = new Date(t)
      const hour  = date.getHours()
      const label = `${((hour + 11) % 12) + 1}${hour < 12 ? 'a' : 'p'}`
      out.push({ x: geom.xForMs(t), label })
    }
    return out
  }, [segments, width, geom])

  if (segments.length === 0 || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />
  }

  // Pick the nearest segment for a tap X. Each segment owns its full
  // width window. If the tap falls in a gap between segments, returns
  // null (which dismisses the tooltip).
  function pickIx(x: number): number | null {
    for (let i = 0; i < segGeom.length; i++) {
      const g = segGeom[i]
      if (x >= g.x1 && x <= g.x2) return i
    }
    return null
  }

  function onChartPressIn(e: GestureResponderEvent) {
    markChartTouch()
    const ix = pickIx(e.nativeEvent.locationX)
    setActiveIx(prev => (ix === null || prev === ix) ? null : ix)
  }

  const active = activeIx != null ? segments[activeIx] : null

  // Static colors — Skia accepts CSS-style color strings directly.
  const guideColor = withAlpha('#ffffff', 0.04)

  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        {/* Single Skia canvas paints the entire band grid + segments in
            one native draw call. Replaces the per-segment <Rect> + per-
            row <Line> tree from the old react-native-svg implementation.
            See Pattern 9 in CLAUDE.md. */}
        <Canvas style={{ width, height }}>
          {/* Faint row guides — each stage row gets a horizontal hairline
              at the row's baseline so the eye can scan stages even where
              no segment is drawn. */}
          <Group>
            {guidePaths.map((g) => (
              <Path
                key={`guide-${g.stage}`}
                path={g.path}
                color={guideColor}
                style="stroke"
                strokeWidth={1}
              />
            ))}
          </Group>

          {/* Each segment renders as a coloured rounded rectangle in its
              stage's row. Active segment gets a brighter fill + thin
              outline so the user can see which one they tapped. Every
              block gets a visible edge so the user can count + size-
              compare segments at a glance. Active block bumps to the
              full colour at 1.5px; idle blocks render a thinner inset
              border in the same hue at ~60% alpha for outline definition. */}
          <Group>
            {segGeom.map((g, i) => {
              const isActive = i === activeIx
              return (
                <Group key={`seg-${i}`}>
                  {/* Fill */}
                  <Path
                    path={g.path}
                    color={withAlpha(g.color, isActive ? 0.95 : 0.75)}
                  />
                  {/* Stroke outline (drawn over the fill) */}
                  <Path
                    path={g.path}
                    color={isActive ? g.color : withAlpha(g.color, 0.6)}
                    style="stroke"
                    strokeWidth={isActive ? 1.5 : 1}
                  />
                </Group>
              )
            })}
          </Group>
        </Canvas>

        {/* X-axis hour ticks — RN <Text> overlays above the canvas.
            Static labels (≤12 ticks), no per-frame animation, so RN
            Text is the right tier vs. loading a Skia text shaper.
            Centered on each tick's x via width=24 + left = x-12. */}
        {hourTicks.map((t, i) => (
          <Text
            key={`ax-${i}`}
            style={[
              s.tickLabel,
              {
                left:  t.x - 12,
                top:   height - 14,
                width: 24,
              },
            ]}
          >
            {t.label}
          </Text>
        ))}

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
  tickLabel: {
    position:   'absolute',
    color:      colors.mutedForeground,
    fontSize:   9,
    fontFamily: fonts.mono[500],
    textAlign:  'center',
  },
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
