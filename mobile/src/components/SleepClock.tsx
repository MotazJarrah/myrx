/**
 * SleepClock — radial 12-hour visualization of the past 7 nights.
 *
 * Visual: a clock face with 12 at top, 3 right, 6 bottom, 9 left
 * (standard analog clock layout). All 12 hour numerals shown around
 * the rim. Around the face are 7 concentric rings, one per night in
 * the past week. Outermost ring = most recent night, innermost = 7
 * nights ago.
 *
 * Each ring shows the SLEEP ARC as a thick lime band; the awake
 * portion stays empty. When bedtimes are consistent across the week,
 * all sleep arcs line up at the same angular position — the pattern
 * looks like a target. When bedtimes drift, the arcs slip out of
 * alignment and the pattern looks chaotic.
 *
 * A separate translucent band shows the user's TYPICAL sleep window
 * — the circular mean of bedtime → wake time across all logged
 * nights. Drawn just outside the outermost ring so it never
 * occludes the per-night data. Tap it to read the exact average
 * times in the center label.
 *
 * Interactive: drag a finger across the rings to scrub through
 * nights — whichever ring the finger lands on becomes the active
 * ring; the center label updates live. Touch lands outside the ring
 * area (center hole or beyond the outermost label band) → clears
 * selection. Selection persists between touches until another ring
 * is touched or the user touches outside.
 *
 * Rendering — GPU-backed via @shopify/react-native-skia. The entire
 * clock draws in a single Skia <Canvas> at native speed; per-frame
 * animations (entrance rotation, dim-up/down on selection, avg-band
 * growth) run on the GPU thread without crossing the React Native
 * bridge. This is the Phase-1 port from `react-native-svg` (May 31
 * 2026) — same visual output, same gesture handling, same component
 * API. The Sleep page's draggy-scroll problem was caused by the
 * previous SVG implementation's per-prop bridge crossings; Skia
 * eliminates those entirely.
 *
 * Designed alongside the Sleep page rebuild (May 31 2026) — works
 * for both watch users (full data) and phone-only users (just
 * bedtime + wake times).
 */

import React, { useState, useMemo, useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  Canvas, Path, Circle, Line, Group, Skia, vec,
  type SkPath,
} from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  useSharedValue, useDerivedValue, withSpring, withTiming, withDelay,
  interpolateColor,
} from 'react-native-reanimated'
import { colors, palette, withAlpha, fonts } from '../theme'

export interface SleepClockNight {
  /** Display label for the tooltip — 'Mon', 'Tue', etc. */
  label:        string
  /** ISO timestamp of sleep onset. */
  startAt:      string
  /** ISO timestamp of wake. */
  endAt:        string
  /** True for the most-recent night — rendered brighter. */
  isMostRecent: boolean
}

/** Resolved readout for the currently selected ring (or default fallback). */
export interface SleepClockReadout {
  /** Day name — e.g. 'Sat', or 'Typical' for the average band. */
  title:    string
  /** Time range — e.g. '1:30 AM – 7:30 AM'. */
  time:     string
  /** Duration sub-label — e.g. '7h 30m'. Empty string when n/a. */
  sub:      string
  /** True when the active selection IS the average band, not a ring. */
  isAverage: boolean
}

interface Props {
  /** Most recent first (index 0 = tonight). Up to 7 nights. */
  nights:        SleepClockNight[]
  /** Outer diameter in pixels. */
  size?:         number
  /** Date format for the center label: 'mdy' = MM/DD, 'dmy' = DD/MM. */
  dateFormat?:   'mdy' | 'dmy'
  /**
   * Called every time the active selection changes. Parent uses this to
   * mirror the selection into its own below-clock readout so the bottom
   * row always shows the day's stats. Called with null only briefly
   * during the first paint (before useEffect fires).
   */
  onActiveChange?: (readout: SleepClockReadout | null) => void
}

// -- Special sentinel for the "average" band, which is selectable too.
const AVG_IDX = -1

// ─── Skia helpers ────────────────────────────────────────────────────────────
//
// Skia's `Path` accepts a Skia path OBJECT, not an SVG string. We could call
// Skia.Path.MakeFromSVGString(...) every frame, but that's expensive (parses
// the string on each tick). Faster: build the path programmatically using
// Skia's path commands. Both arcPathSkia / arcPathSkiaWorklet build the
// same crescent-shape path used by the SVG version, but using Skia's API
// directly so the result is a native path object ready to draw.

/**
 * Build a Skia path for the crescent arc between two angles at radius `r`
 * with a given thickness. Worklet-safe — used inside useDerivedValue on
 * the UI thread for per-frame animations.
 */
function buildArcPath(
  cx: number, cy: number, r: number,
  startAngleDeg: number, endAngleDeg: number,
  thickness: number,
): SkPath {
  'worklet'
  let a1 = startAngleDeg
  let a2 = endAngleDeg
  while (a2 <= a1) a2 += 360

  const rOut    = r + thickness / 2
  const rIn     = r - thickness / 2
  const deg2rad = Math.PI / 180

  const p1x = cx + rOut * Math.cos((a1 - 90) * deg2rad)
  const p1y = cy + rOut * Math.sin((a1 - 90) * deg2rad)
  const p2x = cx + rOut * Math.cos((a2 - 90) * deg2rad)
  const p2y = cy + rOut * Math.sin((a2 - 90) * deg2rad)
  const p3x = cx + rIn  * Math.cos((a2 - 90) * deg2rad)
  const p3y = cy + rIn  * Math.sin((a2 - 90) * deg2rad)
  const p4x = cx + rIn  * Math.cos((a1 - 90) * deg2rad)
  const p4y = cy + rIn  * Math.sin((a1 - 90) * deg2rad)

  // Skia.Path.Make() returns a fresh mutable path. Build the crescent in
  // the same order as the SVG version: outer arc → inner radial → reverse
  // inner arc → close.
  const path = Skia.Path.Make()
  path.moveTo(p1x, p1y)
  // arcToOval(rect, startAngle, sweepAngle, forceMoveTo)
  //   - rect:        bounding rect of the OUTER circle (centered on cx,cy radius rOut)
  //   - startAngle:  measured from +x axis (3 o'clock), CCW negative; we use the angle
  //                  we already computed in screen-space "12-o'clock-up" terms — but
  //                  Skia uses standard math angles (0 = right, 90 = down on screen).
  //   - We computed our angles as "degrees clockwise from 12". Convert to Skia:
  //     skiaAngle = mathAngle = (ourAngle - 90)
  //   - sweepAngle: positive = clockwise (matches our sweep direction).
  const outerRect = {
    x: cx - rOut, y: cy - rOut, width: rOut * 2, height: rOut * 2,
  }
  const innerRect = {
    x: cx - rIn,  y: cy - rIn,  width: rIn  * 2, height: rIn  * 2,
  }
  const sweep = a2 - a1
  path.arcToOval(outerRect, a1 - 90, sweep, false)
  path.lineTo(p3x, p3y)
  path.arcToOval(innerRect, a2 - 90, -sweep, false)
  path.lineTo(p1x, p1y)
  path.close()
  return path
}

/**
 * Single animated sleep arc (Skia version).
 *
 * Two animations layered on the same Skia <Path>:
 *
 * 1. ENTRANCE (fires once on mount). The arc starts at a random
 *    rotation offset of ±150° around the clock center and spring-falls
 *    into its final position with light damping for a slight overshoot
 *    + settle. Each ring rolls in with a per-ring stagger so the set
 *    feels organic. Combined with a fast opacity fade-in so the random
 *    starting angle isn't visible as a hard jump.
 *
 * 2. SELECTION DIM (re-runs whenever isActive flips). The arc's fill
 *    color is interpolated between the per-ring fadedFill and the
 *    bright brightFill, with a 220 ms timing curve. Dim-up when
 *    selected, dim-down when deselected — no hard on/off swap.
 *
 * Per-frame work runs entirely on the Skia GPU thread via Reanimated
 * `useDerivedValue`. No bridge crossings per prop update.
 */
function RingArc({
  idx, isActive, cx, cy, r, bedAngle, wakeAngle, thickness,
  brightFill, fadedFill,
}: {
  idx:        number
  isActive:   boolean
  cx:         number
  cy:         number
  r:          number
  bedAngle:   number
  wakeAngle:  number
  thickness:  number
  brightFill: string
  fadedFill:  string
}) {
  // Random ±150° starting angle. useMemo so the value is stable across
  // re-renders — without it, Math.random() would re-roll on every parent
  // re-render and the spring would keep restarting from new angles.
  const initialRot = useMemo(() => (Math.random() - 0.5) * 300, [])
  const rotation   = useSharedValue(initialRot)
  const opacity    = useSharedValue(0)
  const intensity  = useSharedValue(isActive ? 1 : 0)

  // Entrance — fires once per mount of this instance. Slower, bouncier
  // spring + per-ring stagger so the cascade is unmistakable.
  useEffect(() => {
    const stagger = idx * 110
    rotation.value = withDelay(stagger, withSpring(0, {
      damping:   8,
      stiffness: 40,
      mass:      1.4,
    }))
    opacity.value = withDelay(stagger, withTiming(1, { duration: 520 }))
  // mount-only — re-running on dep changes would replay the entrance
  // animation every time the parent re-renders, which is wrong.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dim up / down whenever the active flag flips.
  useEffect(() => {
    intensity.value = withTiming(isActive ? 1 : 0, { duration: 220 })
  }, [isActive])

  // Path geometry — recomputes when rotation shared value changes. Runs
  // entirely on the UI thread; the returned SkPath is rendered by Skia
  // natively without any React Native re-render cycle.
  const path = useDerivedValue(() => {
    return buildArcPath(
      cx, cy, r,
      bedAngle  + rotation.value,
      wakeAngle + rotation.value,
      thickness,
    )
  })

  // Color — interpolates between faded and bright as intensity rises.
  const color = useDerivedValue(() => {
    return interpolateColor(intensity.value, [0, 1], [fadedFill, brightFill])
  })

  return <Path path={path} color={color} opacity={opacity} />
}

/**
 * Animated average sleep band (Skia version) — the indigo arc outside the
 * outermost ring showing the user's circular-mean sleep window.
 *
 * When selected (activeIdx === AVG_IDX):
 *  • intensity 0→1 (fade dim → bright)
 *  • growth   0→1 (thickness scales from base to 1.75×)
 *
 * Both animate together over 220 ms timing so the band visibly "puffs
 * up" + brightens in one motion. Deselect reverses both. The path
 * itself is rebuilt inside useDerivedValue when growth changes so the
 * thickness morph is smooth.
 */
function AvgBand({
  cx, cy, r, baseThickness, bedAngle, wakeAngle, isActive,
  fadedFill, brightFill,
}: {
  cx:            number
  cy:            number
  r:             number
  baseThickness: number
  bedAngle:      number
  wakeAngle:     number
  isActive:      boolean
  fadedFill:     string
  brightFill:    string
}) {
  const intensity = useSharedValue(isActive ? 1 : 0)
  const growth    = useSharedValue(isActive ? 1 : 0)

  useEffect(() => {
    intensity.value = withTiming(isActive ? 1 : 0, { duration: 220 })
    growth.value    = withTiming(isActive ? 1 : 0, { duration: 220 })
  }, [isActive])

  const path = useDerivedValue(() => {
    // 1× when unselected, 1.75× when selected — clearly visible bump.
    const thickness = baseThickness * (1 + growth.value * 0.75)
    return buildArcPath(cx, cy, r, bedAngle, wakeAngle, thickness)
  })

  const color = useDerivedValue(() => {
    return interpolateColor(intensity.value, [0, 1], [fadedFill, brightFill])
  })

  return <Path path={path} color={color} />
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a Date to its "hour of day" position (0-24 decimal) in the
 * user's local timezone. We anchor the clock face to local time so the
 * 12 o'clock position is the user's local midnight, not UTC midnight.
 */
function hourOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** Inverse of hourOfDay — converts 0–24 hour back to clockwise angle (12 = 0°). */
function hourToAngle(h: number): number {
  return (h / 24) * 360
}

/** Polar → cartesian. Angle in degrees, clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/**
 * Circular mean of a list of hour-of-day values (0–24). Returns the
 * angular center of mass — handles wrap-around (e.g. 23:30 + 00:30
 * averages to 00:00, not 12:00 like a naive arithmetic mean).
 */
function circularMeanHours(hours: number[]): number | null {
  if (hours.length === 0) return null
  let sx = 0, sy = 0
  for (const h of hours) {
    const theta = (h / 24) * 2 * Math.PI
    sx += Math.cos(theta)
    sy += Math.sin(theta)
  }
  if (sx === 0 && sy === 0) return null
  const meanTheta = Math.atan2(sy, sx)
  const meanH = (meanTheta * 24) / (2 * Math.PI)
  return ((meanH % 24) + 24) % 24
}

/** Default selected ring is the most-recent night (idx 0). Drag-outside
 *  resets the selection back to 0 (not null) so the readout + center
 *  label always show something. AVG_IDX is only entered by tapping the
 *  outer indigo band; it doesn't survive across mount/data changes. */
const DEFAULT_IDX = 0

export default function SleepClock({
  nights,
  size = 320,
  dateFormat = 'mdy',
  onActiveChange,
}: Props) {
  // Active selection: always a valid value, never null. Defaults to most
  // recent night (idx 0). Touching outside the rings snaps back to 0.
  const [activeIdx, setActiveIdx] = useState<number>(DEFAULT_IDX)

  const cx = size / 2
  const cy = size / 2

  // Ring radii — outermost = most recent, innermost = 7 nights ago.
  // Leave room for hour numerals AND average-window band outside rings.
  const labelInset    = 32
  const outerR        = size / 2 - labelInset
  const ringThickness = 11
  const ringGap       = 2
  // ALWAYS reserve 7 ring slots, regardless of how many nights have data.
  // Empty slots render their track but no arc / no center label / no gesture
  // target — the clock's overall geometry stays constant week-over-week so
  // adding a night doesn't shrink the inner hole and reflow the page.
  const TOTAL_SLOTS   = 7
  const innerR        = outerR - (TOTAL_SLOTS * (ringThickness + ringGap)) + ringGap

  // Average band sits between outermost ring and hour numerals.
  const avgBandR         = outerR + ringThickness / 2 + 6
  const avgBandThickness = 4

  // Hour numerals positioned just outside the average band.
  const labelR = avgBandR + avgBandThickness / 2 + 11

  // Pre-compute all 7 ring slots — slots with data carry full per-night
  // info; empty slots carry only their geometry (idx + radius) and a
  // hasData=false flag.
  //
  // CALENDAR-ANCHORED INDEXING (not array-position):
  //   ring 0 = most-recent night's bed-date (the "today" anchor)
  //   ring N = N calendar days before the anchor
  // A missing date in the middle of the week leaves a HOLE at that ring
  // (the visual stack stays date-aligned), instead of all populated nights
  // collapsing into the outer slots and empties piling at the bottom.
  type RingSlot =
    | { idx: number; r: number; hasData: false }
    | {
        idx: number; r: number; hasData: true
        label: string; isMostRecent: boolean
        bedAngle: number; wakeAngle: number
        bedHour: number; wakeHour: number
        durationMs: number; dayName: string; dateLabel: string
      }
  const rings: RingSlot[] = useMemo(() => {
    // Anchor on the most-recent night's bed-date so ring 0 always has data
    // (preserves the default-select-most-recent contract). Each older ring
    // is N days back from there. Without any nights, all 7 slots are empty.
    const anchorRaw = nights[0] ? new Date(nights[0].startAt) : null
    const anchorMid = anchorRaw
      ? new Date(anchorRaw.getFullYear(), anchorRaw.getMonth(), anchorRaw.getDate())
      : null
    // Map: dayOffset (0..6, days back from anchor) → SleepClockNight
    const byOffset = new Map<number, SleepClockNight>()
    if (anchorMid) {
      for (const n of nights) {
        const d   = new Date(n.startAt)
        const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        const off = Math.round((anchorMid.getTime() - mid.getTime()) / 86_400_000)
        if (off >= 0 && off < TOTAL_SLOTS) byOffset.set(off, n)
      }
    }
    return Array.from({ length: TOTAL_SLOTS }, (_, i): RingSlot => {
      const r = outerR - i * (ringThickness + ringGap)
      const n = byOffset.get(i)
      if (!n) {
        return { idx: i, r, hasData: false }
      }
      const bedHour    = hourOfDay(n.startAt)
      const wakeHour   = hourOfDay(n.endAt)
      const bedAngle   = hourToAngle(bedHour)
      const wakeAngle  = hourToAngle(wakeHour)
      const durationMs = new Date(n.endAt).getTime() - new Date(n.startAt).getTime()
      const startDate  = new Date(n.startAt)
      const dayName    = startDate.toLocaleDateString([], { weekday: 'short' })
      const dateLabel  = fmtShortDate(startDate, dateFormat)
      return {
        idx:         i,
        r,
        hasData:     true,
        label:       n.label,
        isMostRecent: n.isMostRecent,
        bedAngle,
        wakeAngle,
        bedHour,
        wakeHour,
        durationMs,
        dayName,
        dateLabel,
      }
    })
  }, [nights, outerR, cx, cy, dateFormat])

  // Average sleep window — circular mean across all logged nights.
  const avg = useMemo(() => {
    if (nights.length === 0) return null
    const bedHours  = nights.map(n => hourOfDay(n.startAt))
    const wakeHours = nights.map(n => hourOfDay(n.endAt))
    const avgBed    = circularMeanHours(bedHours)
    const avgWake   = circularMeanHours(wakeHours)
    if (avgBed == null || avgWake == null) return null
    return { bedHour: avgBed, wakeHour: avgWake }
  }, [nights])

  // All 12 hour numerals around the rim.
  const hourNumerals = useMemo(() => {
    const out: Array<{ h: number; x: number; y: number }> = []
    for (let h = 0; h < 12; h++) {
      const angle = (h / 12) * 360
      const pos   = polar(cx, cy, labelR, angle)
      out.push({ h: h === 0 ? 12 : h, x: pos.x, y: pos.y })
    }
    return out
  }, [cx, cy, labelR])

  // -- Gesture handler: scrub finger across rings to update active.
  // Three-way return: number / 'keep' / null.
  function indexFromDistance(dist: number): number | 'keep' | null {
    if (dist < innerR - ringThickness / 2) return null
    if (dist > avgBandR + avgBandThickness / 2 + 4) return null
    if (dist >= avgBandR - avgBandThickness / 2 - 2
        && dist <= avgBandR + avgBandThickness / 2 + 4
        && avg != null) {
      return AVG_IDX
    }
    let bestIdx  = null as number | null
    let bestDist = Infinity
    for (const r of rings) {
      if (!r.hasData) continue
      const d = Math.abs(dist - r.r)
      if (d <= ringThickness / 2 + ringGap / 2 && d < bestDist) {
        bestDist = d
        bestIdx  = r.idx
      }
    }
    if (bestIdx != null) return bestIdx
    const outermostR = rings[0]?.r ?? outerR
    const innermostR = rings[rings.length - 1]?.r ?? innerR
    if (dist >= innermostR - ringThickness / 2
        && dist <= outermostR + ringThickness / 2) {
      return 'keep'
    }
    return null
  }

  function resolveSelection(dist: number): number | 'keep' {
    const raw = indexFromDistance(dist)
    if (raw === 'keep') return 'keep'
    if (raw == null) return DEFAULT_IDX
    return raw
  }

  // Gesture rules:
  //  - .activeOffsetX([-3, 3]) → pan activates after 3 px horizontal drag
  //  - .failOffsetY([-8, 8]) → if vertical drag passes 8 px first, the
  //    gesture FAILS and the parent ScrollView takes over. The 8 px
  //    threshold is the original design tuned to feel "natural" — wide
  //    enough that tap-then-tiny-drift on the clock area still counts
  //    as a clock tap, not an accidental scroll. The Skia migration
  //    removed the scroll-perf reason to tighten this further.
  const gesture = Gesture.Pan()
    .activeOffsetX([-3, 3])
    .failOffsetY([-8, 8])
    .runOnJS(true)
    .onBegin(e => {
      const dx   = e.x - cx
      const dy   = e.y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const next = resolveSelection(dist)
      if (next === 'keep') return
      setActiveIdx(next)
    })
    .onUpdate(e => {
      const dx   = e.x - cx
      const dy   = e.y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const next = resolveSelection(dist)
      if (next === 'keep') return
      setActiveIdx(next)
    })

  // ─── Readout for parent + center label ─────────────────────────────────────
  const readoutCard: SleepClockReadout | null = (() => {
    if (activeIdx === AVG_IDX && avg) {
      // For the average band, surface a friendly date-range subtitle:
      // "May 25 – May 31 · ~6h 45m" so the user knows what's being averaged.
      const minDate = nights.reduce<Date | null>((acc, n) => {
        const d = new Date(n.startAt)
        return !acc || d < acc ? d : acc
      }, null)
      const maxDate = nights.reduce<Date | null>((acc, n) => {
        const d = new Date(n.startAt)
        return !acc || d > acc ? d : acc
      }, null)
      const rangeLabel = minDate && maxDate
        ? `${minDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${maxDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
        : ''
      const avgDurMs = nights.length > 0
        ? nights.reduce((acc, n) => acc + (new Date(n.endAt).getTime() - new Date(n.startAt).getTime()), 0) / nights.length
        : 0
      const avgDurLabel = avgDurMs > 0 ? `~${fmtDurMs(avgDurMs)}` : ''
      const subParts = [avgDurLabel, rangeLabel].filter(Boolean)
      return {
        title:     'Average sleep time',
        time:      `${fmtClock(avg.bedHour)} – ${fmtClock(avg.wakeHour)}`,
        sub:       subParts.join(' · '),
        isAverage: true,
      }
    }
    const candidate = activeIdx >= 0 ? rings[activeIdx] : undefined
    const r = (candidate && candidate.hasData) ? candidate : rings[DEFAULT_IDX]
    if (!r || !r.hasData) return null
    return {
      title:     r.label,
      time:      `${fmtClock(r.bedHour)} – ${fmtClock(r.wakeHour)}`,
      sub:       fmtDurMs(r.durationMs),
      isAverage: false,
    }
  })()

  useEffect(() => {
    if (onActiveChange) onActiveChange(readoutCard)
  }, [readoutCard?.title, readoutCard?.time, readoutCard?.sub, readoutCard?.isAverage])

  const centerCard = (() => {
    if (!readoutCard) return null
    if (readoutCard.isAverage) return null
    const candidate = activeIdx >= 0 ? rings[activeIdx] : undefined
    const r = (candidate && candidate.hasData) ? candidate : rings[DEFAULT_IDX]
    if (!r || !r.hasData) return null
    return { line1: r.dayName, line2: r.dateLabel }
  })()

  // ─── Skia-painted static elements ──────────────────────────────────────────
  // Pre-computed colors for the static layers (background, spokes, tracks)
  // — passed as plain strings since Skia accepts CSS-style colors directly.
  const bgColor     = withAlpha(palette.slate[500], 0.04)
  const spokeColor  = withAlpha(palette.slate[400], 0.18)
  const trackColor  = withAlpha(palette.slate[400], 0.10)

  return (
    <View style={s.wrap}>
      <GestureDetector gesture={gesture}>
        <View style={{ width: size, height: size }} collapsable={false}>
          {/* Single Skia canvas paints the entire clock natively. One
              native view, no per-prop bridge crossings, no SVG layout
              passes. All animations are GPU-driven via Reanimated
              shared values feeding useDerivedValue chains. */}
          <Canvas style={{ width: size, height: size }}>
            {/* Background clock face */}
            <Circle
              cx={cx} cy={cy} r={outerR + ringThickness / 2}
              color={bgColor}
            />

            {/* Hour spokes — 12, 3, 6, 9 */}
            <Group>
              {[0, 3, 6, 9].map(h => {
                const angle = (h / 12) * 360
                const p1    = polar(cx, cy, innerR - 4, angle)
                const p2    = polar(cx, cy, outerR + ringThickness / 2 + 2, angle)
                return (
                  <Line
                    key={`spoke-${h}`}
                    p1={vec(p1.x, p1.y)}
                    p2={vec(p2.x, p2.y)}
                    color={spokeColor}
                    strokeWidth={1}
                  />
                )
              })}
            </Group>

            {/* Ring tracks (full-circle outlines, very faint) */}
            <Group>
              {rings.map(r => (
                <Circle
                  key={`track-${r.idx}`}
                  cx={cx} cy={cy} r={r.r}
                  color={trackColor}
                  style="stroke"
                  strokeWidth={ringThickness}
                />
              ))}
            </Group>

            {/* Sleep arcs — animated entrance + dim-up/down per ring */}
            <Group>
              {rings.map(slot => {
                if (!slot.hasData) return null
                return (
                  <RingArc
                    key={`arc-${slot.idx}`}
                    idx={slot.idx}
                    isActive={activeIdx === slot.idx}
                    cx={cx}
                    cy={cy}
                    r={slot.r}
                    bedAngle={slot.bedAngle}
                    wakeAngle={slot.wakeAngle}
                    thickness={ringThickness}
                    fadedFill={withAlpha(palette.myrx.lime, 0.55 - slot.idx * 0.05)}
                    brightFill={palette.myrx.lime}
                  />
                )
              })}
            </Group>

            {/* Average sleep window band */}
            {avg && (
              <AvgBand
                cx={cx}
                cy={cy}
                r={avgBandR}
                baseThickness={avgBandThickness}
                bedAngle={hourToAngle(avg.bedHour)}
                wakeAngle={hourToAngle(avg.wakeHour)}
                isActive={activeIdx === AVG_IDX}
                fadedFill={withAlpha(palette.indigo[400], 0.50)}
                brightFill={withAlpha(palette.indigo[400], 0.85)}
              />
            )}
          </Canvas>

          {/* Center label (day name + date) — RN Text overlay above the
              canvas. Skia has its own text-rendering API but loading the
              Geist font through it requires extra setup; RN Text is fine
              for a static label that doesn't animate per frame. */}
          {centerCard && (
            <View
              pointerEvents="none"
              style={[s.centerLabel, {
                left:   cx - 80,
                top:    cy - 26,
                width:  160,
                height: 52,
              }]}
            >
              <Text style={s.centerLine1}>{centerCard.line1}</Text>
              {centerCard.line2 ? (
                <Text style={s.centerLine2}>{centerCard.line2}</Text>
              ) : null}
            </View>
          )}

          {/* Hour numerals — all 12, RN Text overlay, no animation */}
          {hourNumerals.map(m => {
            const isCardinal = m.h === 12 || m.h === 3 || m.h === 6 || m.h === 9
            return (
              <Text
                key={`num-${m.h}`}
                style={[
                  s.numeral,
                  isCardinal && s.numeralBold,
                  {
                    left:  m.x - 12,
                    top:   m.y - 9,
                    width: 24,
                  },
                ]}
              >
                {m.h}
              </Text>
            )
          })}
        </View>
      </GestureDetector>
    </View>
  )
}

// ─── Formatters (JS-thread, used in readouts + center label) ─────────────────

function fmtClock(h: number): string {
  const wrapped = ((h % 24) + 24) % 24
  const hr      = Math.floor(wrapped)
  const min     = Math.floor((wrapped - hr) * 60)
  const period  = hr < 12 ? 'AM' : 'PM'
  const h12     = ((hr + 11) % 12) + 1
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

function fmtDurMs(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  const h        = Math.floor(totalMin / 60)
  const m        = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Short date formatter — MM/DD (imperial) or DD/MM (metric). */
function fmtShortDate(d: Date, format: 'mdy' | 'dmy'): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return format === 'dmy' ? `${day}/${m}` : `${m}/${day}`
}

const s = StyleSheet.create({
  wrap: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  numeral: {
    position:   'absolute',
    color:      colors.mutedForeground,
    fontSize:   12,
    textAlign:  'center',
    fontFamily: fonts.mono[500],
  },
  numeralBold: {
    color:      colors.foreground,
    fontFamily: fonts.mono[700],
    fontSize:   13,
  },
  centerLabel: {
    position:       'absolute',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  centerLine1: {
    color:      colors.foreground,
    fontSize:   16,
    fontWeight: '700',
    textAlign:  'center',
  },
  centerLine2: {
    color:      colors.mutedForeground,
    fontSize:   13,
    fontFamily: fonts.mono[600],
    textAlign:  'center',
  },
})
