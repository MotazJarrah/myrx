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
 * Designed alongside the Sleep page rebuild (May 31 2026) — works
 * for both watch users (full data) and phone-only users (just
 * bedtime + wake times).
 */

import React, { useState, useMemo, useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, { Circle, Path, Line, G } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
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

/**
 * Convert a Date to its "hour of day" position (0-24 decimal) in the
 * user's local timezone. We anchor the clock face to local time so the
 * 12 o'clock position is the user's local midnight, not UTC midnight.
 */
function hourOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** Polar → cartesian. angleDeg measured clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** Build an SVG arc path between two angles at a given radius. */
function arcPath(
  cx: number, cy: number, r: number,
  startAngleDeg: number, endAngleDeg: number,
  thickness: number,
): string {
  let a1 = startAngleDeg
  let a2 = endAngleDeg
  while (a2 <= a1) a2 += 360
  const sweep    = a2 - a1
  const largeArc = sweep > 180 ? 1 : 0

  const rOut = r + thickness / 2
  const rIn  = r - thickness / 2

  const p1 = polar(cx, cy, rOut, a1)
  const p2 = polar(cx, cy, rOut, a2)
  const p3 = polar(cx, cy, rIn,  a2)
  const p4 = polar(cx, cy, rIn,  a1)

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOut.toFixed(2)} ${rOut.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rIn.toFixed(2)} ${rIn.toFixed(2)} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * Hour-of-day (0-24) → degrees clockwise from 12 o'clock on a
 * 12-hour clock face. Wraps automatically: hour 13 maps to the
 * same angle as hour 1, hour 22 maps to the same as hour 10, etc.
 */
function hourToAngle(h: number): number {
  const wrapped = ((h % 12) + 12) % 12
  return (wrapped / 12) * 360
}

/**
 * Circular mean of an array of hours-of-day. Naive arithmetic mean
 * breaks for values that straddle midnight (e.g. avg of [23.5, 0.5]
 * should be 0.0, not 12.0). This uses Mardia 1972's circular
 * statistics: project each hour onto the unit circle, sum the
 * vectors, take the resulting angle. Returns a value in [0, 24).
 */
function circularMeanHours(hours: number[]): number | null {
  if (hours.length === 0) return null
  let sx = 0
  let sy = 0
  for (const h of hours) {
    const theta = (h * 2 * Math.PI) / 24
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
  const ringCount     = Math.min(nights.length, 7)
  const innerR        = outerR - (ringCount * (ringThickness + ringGap)) + ringGap

  // Average band sits between outermost ring and hour numerals.
  const avgBandR         = outerR + ringThickness / 2 + 6
  const avgBandThickness = 4

  // Hour numerals positioned just outside the average band.
  const labelR = avgBandR + avgBandThickness / 2 + 11

  // Pre-compute each ring's arc data.
  const rings = useMemo(() => {
    return nights.slice(0, 7).map((n, i) => {
      const r          = outerR - i * (ringThickness + ringGap)
      const bedHour    = hourOfDay(n.startAt)
      const wakeHour   = hourOfDay(n.endAt)
      const bedAngle   = hourToAngle(bedHour)
      const wakeAngle  = hourToAngle(wakeHour)
      const path       = arcPath(cx, cy, r, bedAngle, wakeAngle, ringThickness)
      const durationMs = new Date(n.endAt).getTime() - new Date(n.startAt).getTime()
      // Date label for the center of the clock — derived from the BEDTIME
      // (start_at). Format follows user preference. Day name on the first
      // line, date below it.
      const startDate  = new Date(n.startAt)
      const dayName    = startDate.toLocaleDateString([], { weekday: 'short' })
      const dateLabel  = fmtShortDate(startDate, dateFormat)
      return {
        idx:         i,
        label:       n.label,
        isMostRecent: n.isMostRecent,
        r,
        path,
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
    return {
      bedHour:  avgBed,
      wakeHour: avgWake,
      path:     arcPath(
        cx, cy, avgBandR,
        hourToAngle(avgBed),
        hourToAngle(avgWake),
        avgBandThickness,
      ),
    }
  }, [nights, cx, cy, avgBandR])

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
  // Maps finger distance from center → which ring it's hovering.
  function indexFromDistance(dist: number): number | null {
    // Inside the central hole → nothing selected.
    if (dist < innerR - ringThickness / 2) return null
    // Beyond the average band's outer edge → nothing selected.
    if (dist > avgBandR + avgBandThickness / 2 + 4) return null
    // Inside the average-band slot?
    if (dist >= avgBandR - avgBandThickness / 2 - 2
        && dist <= avgBandR + avgBandThickness / 2 + 4
        && avg != null) {
      return AVG_IDX
    }
    // Otherwise find the nearest sleep ring.
    let bestIdx  = null as number | null
    let bestDist = Infinity
    for (const r of rings) {
      const d = Math.abs(dist - r.r)
      if (d <= ringThickness / 2 + ringGap / 2 && d < bestDist) {
        bestDist = d
        bestIdx  = r.idx
      }
    }
    return bestIdx
  }

  // Gesture rules:
  //  - onBegin fires on ANY initial touch (before activation). We set the
  //    active ring there so a simple tap immediately registers.
  //  - .activeOffsetX([-3, 3]) means the pan only ACTIVATES if the user
  //    drags ≥3px horizontally. That's enough to claim the gesture for
  //    scrub-mode without stealing all single-finger touches.
  //  - .failOffsetY([-8, 8]) means if the user drags ≥8px VERTICALLY first,
  //    the pan FAILS and the parent ScrollView takes over — page scrolls
  //    normally. The onBegin's setActiveIdx already fired, so the touch
  //    isn't wasted.
  //  - .runOnJS(true) avoids worklet hell — math is trivial (sqrt + 7-row
  //    linear scan), no UI-thread sync needed.
  // null from indexFromDistance means "touched outside the ring area"
  // (center hole or beyond the labels) — per spec, that resets selection
  // back to the most-recent day. Average band is selectable only if it
  // exists (avg != null).
  function resolveSelection(dist: number): number {
    const raw = indexFromDistance(dist)
    if (raw == null) return DEFAULT_IDX  // outside the rings → snap to most-recent
    return raw                            // ring idx or AVG_IDX
  }

  const gesture = Gesture.Pan()
    .activeOffsetX([-3, 3])
    .failOffsetY([-8, 8])
    .runOnJS(true)
    .onBegin(e => {
      const dx   = e.x - cx
      const dy   = e.y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      setActiveIdx(resolveSelection(dist))
    })
    .onUpdate(e => {
      const dx   = e.x - cx
      const dy   = e.y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      setActiveIdx(resolveSelection(dist))
    })

  // Readout always resolves to a value — never null. If the user hasn't
  // interacted yet (or dragged off the rings), activeIdx is DEFAULT_IDX
  // (= 0 = most-recent night) and the readout shows that night's data.
  // The center label inside the clock and the parent-mirrored readout
  // below the clock both consume this.
  const readoutCard: SleepClockReadout | null = (() => {
    if (activeIdx === AVG_IDX && avg) {
      // Range across the whole 7-night window. Endpoints in user's
      // preferred date format.
      const oldest = nights[nights.length - 1]
      const newest = nights[0]
      const rangeLabel = oldest && newest
        ? `${fmtShortDate(new Date(oldest.startAt), dateFormat)} – ${fmtShortDate(new Date(newest.startAt), dateFormat)}`
        : ''
      return {
        title:     'Average sleep time',
        time:      `${fmtClock(avg.bedHour)} – ${fmtClock(avg.wakeHour)}`,
        sub:       rangeLabel,
        isAverage: true,
      }
    }
    const idx = activeIdx >= 0 && rings[activeIdx] ? activeIdx : DEFAULT_IDX
    const r   = rings[idx]
    if (!r) return null  // no data at all
    return {
      title:     r.label,
      time:      `${fmtClock(r.bedHour)} – ${fmtClock(r.wakeHour)}`,
      sub:       fmtDurMs(r.durationMs),
      isAverage: false,
    }
  })()

  // Mirror selection up to the parent so the page can render its own
  // below-the-card readout from the same source of truth.
  useEffect(() => {
    if (onActiveChange) onActiveChange(readoutCard)
  }, [readoutCard?.title, readoutCard?.time, readoutCard?.sub, readoutCard?.isAverage])

  // Center label content — what shows inside the clock hole. Same source
  // as the bottom readout. For ring selections we show day + date; for
  // the average band the center stays empty — the below-clock readout
  // already names it and shows the date range, so duplicating in the
  // center adds noise.
  const centerCard = (() => {
    if (!readoutCard) return null
    if (readoutCard.isAverage) return null  // skip — readout-below carries it
    const idx = activeIdx >= 0 && rings[activeIdx] ? activeIdx : DEFAULT_IDX
    const r   = rings[idx]
    if (!r) return null
    return { line1: r.dayName, line2: r.dateLabel }
  })()

  return (
    <View style={s.wrap}>
      <GestureDetector gesture={gesture}>
        <View style={{ width: size, height: size }} collapsable={false}>
          <Svg width={size} height={size}>
            {/* Subtle background circle (the clock face) */}
            <Circle
              cx={cx} cy={cy} r={outerR + ringThickness / 2}
              fill={withAlpha(palette.slate[500], 0.04)}
            />

            {/* Hour spokes (every 3rd hour: 12, 3, 6, 9) — very faint */}
            <G>
              {[0, 3, 6, 9].map(h => {
                const angle = (h / 12) * 360
                const p1    = polar(cx, cy, innerR - 4, angle)
                const p2    = polar(cx, cy, outerR + ringThickness / 2 + 2, angle)
                return (
                  <Line
                    key={`spoke-${h}`}
                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={withAlpha(palette.slate[400], 0.18)}
                    strokeWidth={1}
                  />
                )
              })}
            </G>

            {/* Ring tracks (full circle, very faint) */}
            <G>
              {rings.map(r => (
                <Circle
                  key={`track-${r.idx}`}
                  cx={cx} cy={cy} r={r.r}
                  stroke={withAlpha(palette.slate[400], 0.10)}
                  strokeWidth={ringThickness}
                  fill="none"
                />
              ))}
            </G>

            {/* Sleep arcs. Only the ACTIVE ring renders bright; every other
                ring fades by recency (newer = slightly brighter than older).
                The isMostRecent boost was removed once we made activeIdx
                default to most-recent — the active highlight now does that
                job, and keeping the boost made the most-recent ring stay
                bright even after the user tapped a different day. */}
            <G>
              {rings.map(r => {
                const isActive = activeIdx === r.idx
                const fadedFill = withAlpha(palette.myrx.lime, 0.55 - r.idx * 0.05)
                const fill = isActive ? palette.myrx.lime : fadedFill
                return (
                  <Path
                    key={`arc-${r.idx}`}
                    d={r.path}
                    fill={fill}
                  />
                )
              })}
            </G>

            {/* Average sleep window band — outside outermost ring */}
            {avg && (
              <Path
                d={avg.path}
                fill={
                  activeIdx === AVG_IDX
                    ? withAlpha(palette.indigo[400], 0.85)
                    : withAlpha(palette.indigo[400], 0.50)
                }
              />
            )}
          </Svg>

          {/* Center label — day name + date (or 'Typical' + range) for the
              currently selected ring. Sits in the empty hole inside the
              innermost ring. Renders nothing if there's no data at all. */}
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

          {/* Hour numerals — all 12, absolutely positioned. */}
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
      {/* The below-clock readout is now rendered by the PARENT (sleep.tsx)
          via the onActiveChange callback. The center-of-clock label above
          remains owned by this component since it's geometrically tied
          to the clock's inner hole. */}
    </View>
  )
}

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
  // Center label — day name + date inside the clock's inner hole.
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
