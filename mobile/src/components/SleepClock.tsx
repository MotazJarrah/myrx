/**
 * SleepClock — radial 24-hour visualization of the past 7 nights.
 *
 * Visual: a clock face with midnight at top (12 o'clock position).
 * Around it are 7 concentric rings, one per night in the past week.
 * Outermost ring = most recent night, innermost = 7 nights ago.
 *
 * Each ring shows the SLEEP ARC as a thick lime band; the awake
 * portion of the 24-hour period stays empty. When bedtimes are
 * consistent across the week, all sleep arcs line up at the same
 * angular position — the pattern looks like a target. When bedtimes
 * drift, the arcs slip out of alignment and the pattern looks chaotic.
 *
 * Faint outer-boundary arc shows the user's TARGET sleep window
 * (derived from typical wake time minus target duration). When a
 * sleep arc sits inside that window, the user is hitting their goal.
 *
 * Interactive: tap a ring to see the night's bedtime / wake time /
 * total duration in a popover. Tonight (outermost ring) is rendered
 * slightly brighter to mark it as "live."
 *
 * Data needed per ring:
 *   start_at, end_at, label (e.g. 'Tue'), isMostRecent
 *
 * Designed alongside the Sleep page rebuild (May 31 2026) — works
 * for both watch users (full data) and phone-only users (just
 * bedtime + wake times).
 */

import React, { useState, useMemo } from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import Svg, { Circle, Path, Line, G, Text as SvgText } from 'react-native-svg'
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

interface Props {
  /** Most recent first (index 0 = tonight). Up to 7 nights. */
  nights:           SleepClockNight[]
  /** Target bedtime as 24h decimal hours (e.g. 23.0 = 11pm). Optional. */
  targetBedHour?:   number
  /** Target wake time as 24h decimal hours (e.g. 6.5 = 6:30am). Optional. */
  targetWakeHour?:  number
  /** Outer diameter in pixels. */
  size?:            number
}

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
  // Normalize so endAngle > startAngle (handling midnight wrap).
  let a1 = startAngleDeg
  let a2 = endAngleDeg
  while (a2 <= a1) a2 += 360
  const sweep   = a2 - a1
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

/** Hour-of-day (0-24) → degrees clockwise from 12 o'clock. */
function hourToAngle(h: number): number {
  return (h / 24) * 360
}

export default function SleepClock({
  nights,
  targetBedHour,
  targetWakeHour,
  size = 280,
}: Props) {
  const [tappedIdx, setTappedIdx] = useState<number | null>(null)

  const cx = size / 2
  const cy = size / 2

  // Ring radii — outermost = most recent, innermost = 7 nights ago.
  // Leave room for the hour-label text outside the rings.
  const labelInset    = 18   // space for "12 / 6 / 12 / 18" labels around edge
  const outerR        = size / 2 - labelInset
  const ringThickness = 8
  const ringGap       = 3
  const ringCount     = Math.min(nights.length, 7)
  const innerR        = outerR - (ringCount * (ringThickness + ringGap)) + ringGap

  const targetBandThickness = 2

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
      return {
        idx:         i,
        label:       n.label,
        isMostRecent: n.isMostRecent,
        r,
        path,
        bedHour,
        wakeHour,
        durationMs,
      }
    })
  }, [nights, outerR, cx, cy])

  // Optional target window — a faint dashed arc just outside the outermost ring.
  const targetPath = useMemo(() => {
    if (targetBedHour == null || targetWakeHour == null) return null
    const r       = outerR + ringThickness / 2 + 6
    const bedDeg  = hourToAngle(targetBedHour)
    const wakeDeg = hourToAngle(targetWakeHour)
    return arcPath(cx, cy, r, bedDeg, wakeDeg, targetBandThickness)
  }, [outerR, cx, cy, targetBedHour, targetWakeHour])

  // Hour-marker labels around the rim: 12, 6, 12, 18 (top, right, bottom, left)
  const hourMarkers = [
    { h: 0,  label: '12am', x: cx,           y: 12 },
    { h: 6,  label: '6am',  x: size - 8,     y: cy + 4 },
    { h: 12, label: '12pm', x: cx,           y: size - 4 },
    { h: 18, label: '6pm',  x: 8,            y: cy + 4 },
  ]

  const tappedRing = tappedIdx != null ? rings[tappedIdx] : null

  return (
    <View style={s.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Subtle background circle (the clock face) */}
          <Circle
            cx={cx} cy={cy} r={outerR + ringThickness / 2}
            fill={withAlpha(palette.slate[500], 0.04)}
          />

          {/* Hour spokes (12 / 6 / 12 / 18) — very faint */}
          <G>
            {[0, 6, 12, 18].map(h => {
              const angle = hourToAngle(h)
              const p1 = polar(cx, cy, innerR - 4, angle)
              const p2 = polar(cx, cy, outerR + ringThickness / 2 + 2, angle)
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

          {/* Target window — faint dashed arc */}
          {targetPath && (
            <Path
              d={targetPath}
              fill={withAlpha(palette.indigo[400], 0.35)}
            />
          )}

          {/* Ring tracks (full circle, very faint) — gives the eye an
              alignment reference even on nights with no data */}
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

          {/* Sleep arcs (the actual data) */}
          <G>
            {rings.map(r => {
              const fill = r.isMostRecent
                ? palette.myrx.lime
                : withAlpha(palette.myrx.lime, 0.55 - r.idx * 0.05)
              return (
                <Path
                  key={`arc-${r.idx}`}
                  d={r.path}
                  fill={fill}
                />
              )
            })}
          </G>
        </Svg>

        {/* Hour-rim labels — positioned absolutely so they don't get
            clipped by the SVG viewbox math */}
        {hourMarkers.map(m => (
          <Text
            key={`lbl-${m.h}`}
            style={[
              s.hourLabel,
              {
                left: m.x - 18,
                top:  m.y - 7,
                width: 36,
              },
            ]}
          >
            {m.label}
          </Text>
        ))}

        {/* Invisible tap targets for each ring */}
        {rings.map(r => (
          <Pressable
            key={`tap-${r.idx}`}
            onPress={() => setTappedIdx(tappedIdx === r.idx ? null : r.idx)}
            style={[
              s.ringTap,
              {
                left:   cx - r.r - ringThickness,
                top:    cy - r.r - ringThickness,
                width:  (r.r + ringThickness) * 2,
                height: (r.r + ringThickness) * 2,
              },
            ]}
          />
        ))}

        {/* Center label + tooltip */}
        {tappedRing ? (
          <View style={s.center}>
            <Text style={s.centerLabel}>{tappedRing.label}</Text>
            <Text style={s.centerTime}>
              {fmtClock(tappedRing.bedHour)} – {fmtClock(tappedRing.wakeHour)}
            </Text>
            <Text style={s.centerDur}>
              {fmtDurMs(tappedRing.durationMs)}
            </Text>
          </View>
        ) : (
          <View style={s.center}>
            <Text style={s.centerLabel}>Last 7 nights</Text>
            <Text style={s.centerHint}>Tap a ring</Text>
          </View>
        )}
      </View>
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

const s = StyleSheet.create({
  wrap: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  hourLabel: {
    position:   'absolute',
    color:      colors.mutedForeground,
    fontSize:   10,
    textAlign:  'center',
    fontFamily: fonts.mono[500],
  },
  ringTap: {
    position: 'absolute',
    // invisible — only for tap detection
  },
  center: {
    position:       'absolute',
    left:           0,
    right:          0,
    top:            0,
    bottom:         0,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  centerLabel: {
    color:      colors.foreground,
    fontSize:   13,
    fontWeight: '600',
  },
  centerTime: {
    color:      palette.myrx.lime,
    fontSize:   14,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
  },
  centerDur: {
    color:      colors.mutedForeground,
    fontSize:   11,
    fontFamily: fonts.mono[500],
  },
  centerHint: {
    color:    colors.mutedForeground,
    fontSize: 10,
    opacity:  0.7,
  },
})
