/**
 * SleepConsistency — a 7-night sleep-window chart (Skia).
 *
 * One VERTICAL bar per night, oldest → newest across the last 7 nights. Each
 * column rises from that night's bedtime (bottom) up to its wake (top), so the
 * vertical axis is clock time (later = higher) and the bar length is how long
 * you slept. (Flipped Jun 2026 — bars now read the natural bottom→up way.)
 *
 * Reference lines (solid = target, dotted = your average):
 *   • Wake (SOLID)         — your average wake; it doubles as the target.
 *   • Target bedtime (SOLID) — wake − sleep-need; when you'd need to be asleep.
 *   • Avg bedtime (DOTTED)   — when you actually fall asleep on average.
 * A night lights up bright lime ("on target") when it lands within ±10 min of
 * BOTH targets — woke at your usual time AND got the full sleep-need.
 *
 * Rendered with Skia (the standing "always Skia for charts" rule): bars +
 * lines paint inside one <Canvas>; the few static labels are RN <Text>
 * overlays. Time axis = "minutes after 6 PM" (exported `minsAfter6pm`) so an
 * evening→morning night is monotonic; the page derives the lines in the same
 * basis so chart + Sleep-Targets numbers always agree.
 */

import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { BedDouble, Sunrise } from 'lucide-react-native'
import { Canvas, Path as SkiaPath, Skia } from '@shopify/react-native-skia'
import { colors, palette, fonts, withAlpha } from '../theme'

type Night = { start_at: string; end_at: string }

// ── Layout constants ──────────────────────────────────────────────────────
const PLOT_H      = 133  // 2/3 of the original 200 — shorter bars
const TOP_PAD     = 10
const BOTTOM_AXIS = 22
const LEFT_GUTTER = 70
const RIGHT_PAD   = 12
const DOMAIN_PAD  = 25
const COL_GAP     = 2
const ACHIEVED_TOL = 10  // ± minutes for an "on target" night

// Minutes after 18:00 (6 PM). Evening → morning becomes monotonic increasing.
export function minsAfter6pm(iso: string): number {
  const d = new Date(iso)
  return ((d.getHours() - 18 + 24) % 24) * 60 + d.getMinutes()
}

// Inverse: minutes-after-6pm → wall-clock "h:mm AM/PM" (wrap-safe).
export function fmtClock(minsAfter: number): string {
  const total = (((Math.round(minsAfter) + 18 * 60) % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60)
  const m   = total % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function SleepConsistency({
  nights, targetWakeMin, targetBedMin, avgBedMin,
}: {
  nights:        Night[]
  targetWakeMin: number  // = average wake (the anchor/target), mins after 6pm
  targetBedMin:  number  // = targetWakeMin − sleep-need, mins after 6pm
  avgBedMin:     number  // = your actual average bedtime, mins after 6pm
}) {
  const [w, setW] = useState(0)

  const model = useMemo(() => {
    if (nights.length === 0) return null
    const sorted = nights
      .slice()
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1)) // oldest → newest
    const cols = sorted.map(n => {
      const bed  = minsAfter6pm(n.start_at)
      const wake = minsAfter6pm(n.end_at)
      const onTarget =
        Math.abs(bed - targetBedMin) <= ACHIEVED_TOL &&
        Math.abs(wake - targetWakeMin) <= ACHIEVED_TOL
      return { bed, wake, onTarget }
    })
    const lo = Math.min(...cols.map(c => c.bed), targetBedMin, avgBedMin) - DOMAIN_PAD
    const hi = Math.max(...cols.map(c => c.wake), targetWakeMin) + DOMAIN_PAD
    return {
      cols, lo, hi,
      firstDate: fmtDate(sorted[0].start_at),
      lastDate:  fmtDate(sorted[sorted.length - 1].start_at),
    }
  }, [nights, targetWakeMin, targetBedMin, avgBedMin])

  const plotW = Math.max(0, w - LEFT_GUTTER - RIGHT_PAD)
  const canvasH = TOP_PAD + PLOT_H + BOTTOM_AXIS

  const built = useMemo(() => {
    if (!model || w <= 0) return null
    const { cols, lo, hi } = model
    // Flipped: later times sit HIGHER, so bars rise from bedtime (bottom) up
    // to wake (top) — the natural bottom→up reading direction.
    const yOf  = (v: number) => TOP_PAD + (hi > lo ? (1 - (v - lo) / (hi - lo)) : 0) * PLOT_H
    const slot = cols.length > 0 ? plotW / cols.length : plotW
    const colW = Math.max(3, slot - COL_GAP)
    const xOf  = (i: number) => LEFT_GUTTER + i * slot + COL_GAP / 2

    const onPath  = Skia.Path.Make()
    const offPath = Skia.Path.Make()
    cols.forEach((c, i) => {
      const yBed  = yOf(c.bed)
      const yWake = yOf(c.wake)
      const top   = Math.min(yBed, yWake)
      const h     = Math.max(3, Math.abs(yWake - yBed))
      const rrect = { rect: { x: xOf(i), y: top, width: colW, height: h }, rx: 3, ry: 3 }
      ;(c.onTarget ? onPath : offPath).addRRect(rrect)
    })

    // Solid line (targets).
    const mkSolid = (y: number) => {
      const p = Skia.Path.Make()
      p.moveTo(LEFT_GUTTER, y)
      p.lineTo(LEFT_GUTTER + plotW, y)
      return p
    }
    // Dotted line (your average) — short 2px-dash / 3px-gap run.
    const mkDots = (y: number) => {
      const p = Skia.Path.Make()
      const end = LEFT_GUTTER + plotW
      let x = LEFT_GUTTER
      while (x < end) { const x2 = Math.min(x + 2, end); p.moveTo(x, y); p.lineTo(x2, y); x += 5 }
      return p
    }
    return {
      onPath, offPath,
      bedLine:  mkSolid(yOf(targetBedMin)),
      wakeLine: mkSolid(yOf(targetWakeMin)),
      avgLine:  mkDots(yOf(avgBedMin)),
      yBed:  yOf(targetBedMin),
      yWake: yOf(targetWakeMin),
      yAvg:  yOf(avgBedMin),
    }
  }, [model, w, plotW, targetBedMin, targetWakeMin, avgBedMin])

  if (!model) return null

  // Avg-bedtime label y — nudged clear of the target-bedtime label when the
  // two lines sit within a label height of each other, so neither is hidden.
  const avgLabelTop =
    built == null
      ? 0
      : Math.abs(built.yAvg - built.yBed) < 16
        ? (built.yAvg <= built.yBed ? built.yBed - 8 - 16 : built.yBed - 8 + 16)
        : built.yAvg - 8

  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View style={{ height: canvasH }}>
        {built && w > 0 && (
          <>
            <Canvas style={{ width: w, height: canvasH }}>
              <SkiaPath path={built.offPath} color={withAlpha(palette.myrx.lime, 0.30)} />
              <SkiaPath path={built.onPath}  color={palette.myrx.lime} />
              {/* Dotted average bedtime — drawn FIRST (under the solid
                  targets) and in a distinct slate so that when it coincides
                  with the target bedtime, the solid target wins on top. */}
              <SkiaPath path={built.avgLine}  color={withAlpha('#ffffff', 0.7)} style="stroke" strokeWidth={1.5} />
              {/* Solid targets */}
              <SkiaPath path={built.bedLine}  color={palette.indigo[400]} style="stroke" strokeWidth={1.5} />
              <SkiaPath path={built.wakeLine} color={palette.indigo[400]} style="stroke" strokeWidth={1.5} />
            </Canvas>

            {/* Target-time labels in the left gutter, centered on each line */}
            <View style={[s.axisLabel, { top: built.yBed - 8 }]}>
              <BedDouble size={12} color={palette.indigo[400]} />
              <Text style={s.axisText} numberOfLines={1}>{fmtClock(targetBedMin)}</Text>
            </View>
            <View style={[s.axisLabel, { top: built.yWake - 8 }]}>
              <Sunrise size={12} color={palette.indigo[400]} />
              <Text style={s.axisText} numberOfLines={1}>{fmtClock(targetWakeMin)}</Text>
            </View>
            {/* Avg bedtime time — white, matches the dotted line. Always shown;
                nudged clear of the target-bedtime label when the lines are close. */}
            <View style={[s.axisLabel, { top: avgLabelTop }]}>
              <Text style={[s.axisText, s.axisTextAvg]} numberOfLines={1}>{fmtClock(avgBedMin)}</Text>
            </View>

            {/* Date span under the plot */}
            <Text style={[s.dateLabel, { left: LEFT_GUTTER, top: TOP_PAD + PLOT_H + 5 }]}>
              {model.firstDate}
            </Text>
            <Text style={[s.dateLabel, { right: RIGHT_PAD, top: TOP_PAD + PLOT_H + 5 }]}>
              {model.lastDate}
            </Text>
          </>
        )}
      </View>

      {/* Legend — always below the graph */}
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendBar, { backgroundColor: palette.myrx.lime }]} />
          <Text style={s.legendText}>On target</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendBar, { backgroundColor: withAlpha(palette.myrx.lime, 0.30) }]} />
          <Text style={s.legendText}>Off target</Text>
        </View>
        <View style={s.legendItem}>
          <View style={s.legendSolid} />
          <Text style={s.legendText}>Targets</Text>
        </View>
        <View style={s.legendItem}>
          <View style={s.legendDots}>
            <View style={s.legendDot} />
            <View style={s.legendDot} />
            <View style={s.legendDot} />
          </View>
          <Text style={s.legendText}>Avg bedtime</Text>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  axisLabel: {
    position: 'absolute',
    left: 0,
    width: LEFT_GUTTER - 2,
    height: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 3,
  },
  // Fixed-width, right-aligned time so "12:31 AM" and "7:30 AM" line up at
  // the AM/PM — which keeps both gutter icons at the same x.
  axisText: {
    color: palette.indigo[400],
    fontSize: 10,
    fontFamily: fonts.mono[600],
    width: 50,
    textAlign: 'right',
  },
  axisTextAvg: { color: withAlpha('#ffffff', 0.7) },
  dateLabel: {
    position: 'absolute',
    color: colors.mutedForeground,
    fontSize: 10,
    fontFamily: fonts.mono[500],
  },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendBar: { width: 8, height: 14, borderRadius: 3 },
  legendSolid: { width: 16, height: 2, borderRadius: 1, backgroundColor: palette.indigo[400] },
  legendDots: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  legendDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: withAlpha('#ffffff', 0.7) },
  legendText: { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.sans[500] },
})
