/**
 * RestingHrIndicator — assesses a user's resting heart rate against
 * age/gender-banded norms and surfaces:
 *   • The current band (Athlete / Excellent / Good / Above avg /
 *     Average / Below avg / High) with a colour-coded chip
 *   • A horizontal spectrum gauge that marks where the user sits
 *   • Three actionable tips for lowering resting HR over weeks/months
 *
 * Bands are derived from peer-reviewed normative tables (Topend Sports /
 * Cooper Clinic / ACSM compilations). They differ by ~1 bpm between
 * sources; this implementation uses median values.
 *
 * Skia-migrated 2026-05-31. Gauge rendering moved off `react-native-svg`
 * onto `@shopify/react-native-skia` (single GPU-backed <Canvas>) to
 * follow Pattern 9 (see CLAUDE.md). Reference: mobile/src/components/SleepClock.tsx.
 * The tap-to-pin band popover + diagonal labels stay as RN overlays
 * above the canvas — no animation, no need for Skia text.
 */

import { useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native'
import {
  Canvas, Path, Skia, Group,
  type SkPath,
} from '@shopify/react-native-skia'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { colors, palette, withAlpha, alpha, fonts } from '../theme'
import { useChartTooltipScope, useRegisterChartDismiss } from '../lib/chartTooltipScope'

// ── Band model ────────────────────────────────────────────────────────────

export type RestingBandKey =
  | 'athlete' | 'excellent' | 'good' | 'aboveAvg'
  | 'average' | 'belowAvg' | 'high'

export interface RestingBand {
  key:     RestingBandKey
  label:   string          // "Good"
  short:   string          // "G" — used as the segment tick label
  color:   string
  /** Upper inclusive bpm bound for this band. */
  upperBpm: number
}

// Gender + age-bucket → upper bounds (inclusive) for each band.
// Lower bounds are implicit (one above the previous band's upper bound).
// Values are the median of widely-cited normative tables. Source:
// Topend Sports rating chart, ACSM compilations.
type AgeBucket = '18-25' | '26-35' | '36-45' | '46-55' | '56-65' | '65+'

const MALE_TABLE: Record<AgeBucket, [number, number, number, number, number, number]> = {
  // [athlete-max, excellent-max, good-max, aboveAvg-max, average-max, belowAvg-max]
  // Anything above belowAvg-max → 'high'
  '18-25': [55, 61, 65, 69, 73, 81],
  '26-35': [54, 61, 65, 70, 74, 81],
  '36-45': [56, 62, 66, 70, 75, 82],
  '46-55': [57, 63, 67, 71, 76, 83],
  '56-65': [56, 61, 67, 71, 75, 81],
  '65+':   [55, 61, 65, 69, 73, 79],
}

const FEMALE_TABLE: Record<AgeBucket, [number, number, number, number, number, number]> = {
  '18-25': [60, 65, 69, 73, 78, 84],
  '26-35': [59, 64, 68, 72, 76, 82],
  '36-45': [59, 64, 69, 73, 78, 84],
  '46-55': [60, 65, 69, 73, 77, 83],
  '56-65': [59, 64, 68, 73, 77, 83],
  '65+':   [59, 64, 68, 72, 76, 84],
}

function ageBucket(age: number): AgeBucket {
  if (age < 26) return '18-25'
  if (age < 36) return '26-35'
  if (age < 46) return '36-45'
  if (age < 56) return '46-55'
  if (age < 66) return '56-65'
  return '65+'
}

/** Returns the seven bands for this user, in best→worst order.
 *
 * Uniform "male / else=female" rule across every gender-driven calc in
 * the system (see mobile/src/lib/calorieFormulas.ts calcBMR for the
 * canonical comment). Non-binary / prefer-not-to-say / null → female
 * bands. Decided May 23 2026 to replace the earlier averaging compromise.
 */
export function bandsForUser(age: number, gender: string | null | undefined): RestingBand[] {
  const bucket = ageBucket(age)
  const t = gender === 'male' ? MALE_TABLE[bucket] : FEMALE_TABLE[bucket]
  return [
    { key: 'athlete',   label: 'Athlete',      short: 'Ath',  color: palette.emerald[500], upperBpm: t[0] },
    { key: 'excellent', label: 'Excellent',    short: 'Exc',  color: palette.emerald[400], upperBpm: t[1] },
    { key: 'good',      label: 'Good',         short: 'Good', color: palette.teal[400],    upperBpm: t[2] },
    { key: 'aboveAvg',  label: 'Above avg',    short: 'Abv',  color: palette.sky[400],     upperBpm: t[3] },
    { key: 'average',   label: 'Average',      short: 'Avg',  color: palette.amber[400],   upperBpm: t[4] },
    { key: 'belowAvg',  label: 'Below avg',    short: 'Blw',  color: palette.orange[400],  upperBpm: t[5] },
    { key: 'high',      label: 'High',         short: 'High', color: palette.red[400],     upperBpm: 999 },
  ]
}

/** Classifies a bpm value into one of the seven bands. */
export function classifyResting(bpm: number, bands: RestingBand[]): RestingBand {
  for (const b of bands) {
    if (bpm <= b.upperBpm) return b
  }
  return bands[bands.length - 1]
}

// ── Skia helpers ──────────────────────────────────────────────────────────
//
// Per Pattern 9 / SleepClock.tsx, we build Skia paths programmatically
// rather than parsing SVG strings. These two helpers cover all the shapes
// the gauge needs: a (possibly per-corner-rounded) rect for each segment,
// and a triangle marker for the user's exact-bpm position.

/**
 * Build a Skia path for an axis-aligned rect with per-corner rounding.
 * Used for the 7 spectrum segments — only the very first segment rounds
 * its left corners (rx=4), only the very last rounds its right corners
 * (ry=4 in SVG terms, which is functionally "round the right side").
 * Middle segments are squared on both sides.
 */
function buildRectPath(
  x: number, y: number, w: number, h: number,
  rTL: number, rTR: number, rBR: number, rBL: number,
): SkPath {
  const path = Skia.Path.Make()
  // No rounding → straight rectangle.
  if (rTL === 0 && rTR === 0 && rBR === 0 && rBL === 0) {
    path.addRect({ x, y, width: w, height: h })
    return path
  }
  // Per-corner rounding via manual move+arc construction. Skia's
  // addRRect accepts uniform corner radii; for per-corner we build it
  // by hand so the SVG's selective rounding pattern is preserved.
  path.moveTo(x + rTL, y)
  path.lineTo(x + w - rTR, y)
  if (rTR > 0) {
    path.arcToOval(
      { x: x + w - 2 * rTR, y: y, width: 2 * rTR, height: 2 * rTR },
      -90, 90, false,
    )
  }
  path.lineTo(x + w, y + h - rBR)
  if (rBR > 0) {
    path.arcToOval(
      { x: x + w - 2 * rBR, y: y + h - 2 * rBR, width: 2 * rBR, height: 2 * rBR },
      0, 90, false,
    )
  }
  path.lineTo(x + rBL, y + h)
  if (rBL > 0) {
    path.arcToOval(
      { x: x, y: y + h - 2 * rBL, width: 2 * rBL, height: 2 * rBL },
      90, 90, false,
    )
  }
  path.lineTo(x, y + rTL)
  if (rTL > 0) {
    path.arcToOval(
      { x: x, y: y, width: 2 * rTL, height: 2 * rTL },
      180, 90, false,
    )
  }
  path.close()
  return path
}

/** Triangle marker path — apex at (cx, apexY), base at (cx ± halfWidth, baseY). */
function buildTrianglePath(cx: number, apexY: number, baseY: number, halfWidth: number): SkPath {
  const path = Skia.Path.Make()
  path.moveTo(cx - halfWidth, baseY)
  path.lineTo(cx + halfWidth, baseY)
  path.lineTo(cx, apexY)
  path.close()
  return path
}

// ── Spectrum gauge ────────────────────────────────────────────────────────

function SpectrumGauge({
  bands, bpm, height = 36,
}: {
  bands: RestingBand[]
  bpm:   number
  height?: number
}) {
  const [width, setWidth]                 = useGaugeWidth()
  const [activeBandIx, setActiveBandIx]   = useState<number | null>(null)

  // Register a dismiss callback so the global ChartTooltipScope can clear
  // the band-range popover on any tap outside this component.
  const dismiss = useCallback(() => setActiveBandIx(null), [])
  useRegisterChartDismiss(dismiss)
  const { markChartTouch } = useChartTooltipScope()

  // Pre-build static segment paths. Each rect's rounding mirrors the
  // original SVG: first segment rounds its left edge (rx=4 in SVG),
  // last segment rounds its right edge (ry=4 in SVG). The earlier SVG
  // used a slightly weird rx/ry combo (rx on first, ry on last) — we
  // preserve the visual effect: rounded outer-left + rounded outer-right
  // on the spectrum, square in between.
  const segmentPaths = useMemo(() => {
    if (width === 0) return [] as SkPath[]
    const segW = width / bands.length
    return bands.map((_, i) => {
      const isFirst = i === 0
      const isLast  = i === bands.length - 1
      // Match original: rx={i === 0 ? 4 : 0}, ry={i === bands.length - 1 ? 4 : 0}.
      // Translated to per-corner: first rect → round its left corners,
      // last rect → round its right corners.
      const rTL = isFirst ? 4 : 0
      const rBL = isFirst ? 4 : 0
      const rTR = isLast  ? 4 : 0
      const rBR = isLast  ? 4 : 0
      return buildRectPath(i * segW, 8, segW - 1, height, rTL, rTR, rBR, rBL)
    })
  }, [width, bands, height])

  // Highlight stroke paths — same geometry as segments but stroked
  // inside the segment by 1 px on each side (matches SVG x+1 / y+1).
  const highlightPaths = useMemo(() => {
    if (width === 0) return [] as SkPath[]
    const segW = width / bands.length
    return bands.map((_, i) => {
      const isFirst = i === 0
      const isLast  = i === bands.length - 1
      const rTL = isFirst ? 2 : 0
      const rBL = isFirst ? 2 : 0
      const rTR = isLast  ? 2 : 0
      const rBR = isLast  ? 2 : 0
      // Inset by 1 px on each side, height by 2 px → matches the
      // original SVG's inset (+1 x/y, width-3, height-2).
      return buildRectPath(i * segW + 1, 9, segW - 3, height - 2, rTL, rTR, rBR, rBL)
    })
  }, [width, bands, height])

  if (width === 0) {
    return (
      <View style={{ height: height + 70 }} onLayout={e => setWidth(e.nativeEvent.layout.width)} />
    )
  }
  const segW = width / bands.length
  const userBand = classifyResting(bpm, bands)
  const userIx   = bands.findIndex(b => b.key === userBand.key)

  // Marker x = exact bpm position within the user's band, not the band's
  // midpoint. We interpolate linearly between the band's lower and upper
  // bpm bounds. Edge segments (the open-ended bottom + top bands) get
  // pragmatic 20-bpm extents so the marker still has somewhere to sit.
  const segLow  = userIx === 0
    ? Math.max(30, bands[0].upperBpm - 20)
    : bands[userIx - 1].upperBpm + 1
  const segHigh = userIx === bands.length - 1
    ? bands[userIx - 1].upperBpm + 20
    : userBand.upperBpm
  const segRange = Math.max(1, segHigh - segLow)
  const tInSeg   = Math.max(0, Math.min(1, (bpm - segLow) / segRange))
  const markerX  = (userIx + tInSeg) * segW

  // Triangle marker — apex at (markerX, 8) pointing down toward the
  // segment top, base spans 12 px at y=0.
  const markerPath = buildTrianglePath(markerX, 8, 0, 6)

  // Tap handler — converts touch X into a band index. Toggles off when
  // the same segment is tapped twice. markChartTouch() prevents the
  // page-level dismisser from firing on this same touch.
  function onSegmentPress(e: GestureResponderEvent) {
    markChartTouch()
    const x  = e.nativeEvent.locationX
    const ix = Math.min(bands.length - 1, Math.max(0, Math.floor(x / segW)))
    setActiveBandIx(prev => prev === ix ? null : ix)
  }

  // Band-range string for the popover. Lower bound is one above the
  // previous band's upper. Top band is open-ended ("83+ bpm").
  function rangeText(ix: number): string {
    const b = bands[ix]
    const lo = ix === 0 ? 0 : bands[ix - 1].upperBpm + 1
    if (ix === bands.length - 1) return `${lo}+ bpm`
    return `${lo}–${b.upperBpm} bpm`
  }

  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ position: 'relative' }}>
        {/* Single Skia canvas paints the entire gauge natively. No
            <Defs> needed — colours are passed inline per <Path>. */}
        <Canvas style={{ width, height: height + 8 }}>
          {/* Seven coloured segments — matched to the chart band colours
              (0.90 idle / 1.00 highlighted). No dimming overlay; the
              gradient drop-shadow was previously washing the colours
              into "dull pastel" territory. */}
          <Group>
            {bands.map((b, i) => {
              const isCurrent  = i === userIx
              const isSelected = activeBandIx === i
              const fillAlpha  = isCurrent || isSelected ? 1.00 : 0.90
              return (
                <Path
                  key={b.key}
                  path={segmentPaths[i]}
                  color={withAlpha(b.color, fillAlpha)}
                />
              )
            })}
          </Group>
          {/* Inset white border on the current / selected band — gives a
              subtle "lit-up" feel without changing the segment's colour
              identity. */}
          <Group>
            {bands.map((b, i) => {
              const isCurrent  = i === userIx
              const isSelected = activeBandIx === i
              if (!isCurrent && !isSelected) return null
              return (
                <Path
                  key={`hl-${b.key}`}
                  path={highlightPaths[i]}
                  color={`rgba(255,255,255,${isSelected ? 0.55 : 0.30})`}
                  style="stroke"
                  strokeWidth={1}
                />
              )
            })}
          </Group>
          {/* Triangle marker — points down at the user's exact bpm position. */}
          <Path path={markerPath} color={colors.foreground} />
        </Canvas>

        {/* Invisible tap overlay — clicks anywhere on the bar select that
            band's segment. Single Pressable + locationX math is simpler
            than 7 individual Pressables and indistinguishable to the user. */}
        <Pressable
          onPressIn={onSegmentPress}
          style={[StyleSheet.absoluteFill, { top: 8, height }]}
        />

        {/* Popover — animated fade in/out. Uses Reanimated's `entering` /
            `exiting` props so we get GPU-driven 150 ms fades without
            managing Animated.Value state ourselves. Positioned above the
            tapped segment and clamped to stay within the gauge width. */}
        {activeBandIx != null && (() => {
          const b   = bands[activeBandIx]
          const cx  = (activeBandIx + 0.5) * segW
          const tooltipW = 112
          const tx  = Math.max(0, Math.min(width - tooltipW, cx - tooltipW / 2))
          return (
            <Animated.View
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(120)}
              pointerEvents="none"
              style={[
                ss.bandPopover,
                {
                  left: tx,
                  top:  -54,
                  width: tooltipW,
                  borderColor: withAlpha(b.color, 0.50),
                },
              ]}
            >
              <Text style={[ss.bandPopoverName, { color: b.color }]}>{b.label}</Text>
              <Text style={ss.bandPopoverRange}>{rangeText(activeBandIx)}</Text>
            </Animated.View>
          )
        })()}
      </View>

      {/* Diagonal labels (+45° = "left up, right down" / backslash shape).
          Anchored at each segment's top-centre, just below the gauge, with
          `transformOrigin: top left` so the label "starts" at its segment
          and extends down-right. Dropped further from the gauge so the
          rotated baseline doesn't clip into the bar. */}
      <View style={[ss.segLabelsDiagBox, { width }]}>
        {bands.map((b, i) => {
          const cx = (i + 0.5) * segW
          return (
            <Text
              key={`lbl-${b.key}`}
              style={[
                ss.segLabelDiag,
                { left: cx },
                i === userIx ? ss.segLabelDiagActive : null,
              ]}
              numberOfLines={1}
            >
              {b.label}
            </Text>
          )
        })}
      </View>
    </View>
  )
}

// Local hook to manage gauge width (extracted so the layout state doesn't
// pollute the variant components).
function useGaugeWidth() {
  const [w, setW] = useState(0)
  return [w, setW] as const
}

// ── Indicator card ────────────────────────────────────────────────────────

interface Props {
  /** The bpm value the classification is run on — typically the avg of daily lows. */
  bpm:     number
  age:     number
  gender:  string | null | undefined
  /** Small helper line under the big number — e.g. "avg of daily lows, last 7 days". */
  sourceLabel?: string
}

export default function RestingHrIndicator({
  bpm, age, gender, sourceLabel = 'avg of daily lows',
}: Props) {
  const bands = bandsForUser(age, gender)
  const band  = classifyResting(bpm, bands)

  // Short coaching tip line above the actionable list — frames why the
  // bullets matter.
  const oneLineTip =
    band.key === 'athlete' || band.key === 'excellent'
      ? 'Excellent cardio fitness. Maintain with consistent Z2 work.'
      : band.key === 'good' || band.key === 'aboveAvg'
        ? 'You’re in healthy territory. Lower it further with Z2 cardio 3–5×/week.'
        : 'Lower resting HR comes from consistent Z2 cardio, good sleep, and hydration.'

  return (
    <View style={ss.card}>
      <Text style={ss.cardTitle}>Your resting heart rate</Text>

      <View style={ss.valueRow}>
        <Text style={ss.valueBig}>{bpm}</Text>
        <Text style={ss.valueUnit}>bpm</Text>
        <View style={[ss.bandChip, { backgroundColor: withAlpha(band.color, 0.18), borderColor: withAlpha(band.color, 0.5) }]}>
          <Text style={[ss.bandChipText, { color: band.color }]}>{band.label}</Text>
        </View>
      </View>
      <Text style={ss.sourceLabel}>{sourceLabel}</Text>

      <View style={{ marginTop: 8 }}>
        <SpectrumGauge bands={bands} bpm={bpm} />
      </View>

      <Text style={ss.oneLineTip}>{oneLineTip}</Text>

      <View style={ss.tipsList}>
        <TipRow
          color={palette.emerald[400]}
          title="Easy aerobic cardio (Z2)"
          body="30–60 min at a conversational pace, 3–5×/week. The single biggest driver of lower resting HR — improves cardiac stroke volume."
        />
        <TipRow
          color={palette.sky[400]}
          title="Sleep 7–9 hours"
          body="Poor sleep can raise resting HR 5–10 bpm. Track over weeks — bad-sleep weeks usually show up as a bump in this number."
        />
        <TipRow
          color={palette.amber[400]}
          title="Hydration + caffeine"
          body="Dehydration adds 5–10 bpm; heavy caffeine adds 5–15. Aim for ~3 L water/day and watch coffee timing in the afternoon."
        />
      </View>
    </View>
  )
}

function TipRow({ color, title, body }: { color: string; title: string; body: string }) {
  return (
    <View style={ss.tipRow}>
      <View style={[ss.tipDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={ss.tipTitle}>{title}</Text>
        <Text style={ss.tipBody}>{body}</Text>
      </View>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  card: {
    backgroundColor: alpha(colors.card, 0.5),
    borderColor:     colors.border,
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    gap:             6,
  },
  cardTitle: {
    color:      colors.foreground,
    fontSize:   14,
    fontWeight: '700',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems:    'baseline',
    gap:           6,
    marginTop:     4,
  },
  valueBig: {
    color:      palette.emerald[400],
    fontSize:   34,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
  },
  valueUnit: {
    color:      palette.emerald[400],
    fontSize:   13,
    fontWeight: '600',
    opacity:    0.7,
  },
  bandChip: {
    marginLeft:        8,
    borderRadius:      999,
    borderWidth:       1,
    paddingVertical:   3,
    paddingHorizontal: 10,
    alignSelf:         'flex-end',
    marginBottom:      6,
  },
  bandChipText: {
    fontSize:   11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sourceLabel: {
    color:    colors.mutedForeground,
    fontSize: 11,
    marginTop: -4,
  },
  // Diagonal-label layout (+45° / backslash). Each label is absolutely
  // positioned with its top-left corner anchored at the segment's centre,
  // then rotated +45° around that corner via `transformOrigin: top left`.
  // The label appears to "start" from the bottom of its segment and
  // extends down-right. Dropped 14 px below the gauge so the rotated
  // glyph tops don't clip into the bar.
  segLabelsDiagBox: {
    position:  'relative',
    height:    60,
    marginTop: 14,
  },
  segLabelDiag: {
    position:        'absolute',
    top:             0,
    color:           colors.mutedForeground,
    fontSize:        10,
    width:           80,
    textAlign:       'left',
    transform:       [{ rotate: '45deg' }],
    transformOrigin: 'top left',
  },
  segLabelDiagActive: {
    color:      colors.foreground,
    fontWeight: '700',
  },

  // Popover that appears above the gauge when a band segment is tapped.
  bandPopover: {
    position:        'absolute',
    backgroundColor: withAlpha('#000000', 0.92),
    borderWidth:     1,
    borderRadius:    8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems:      'center',
    gap:             2,
    // Small downward-pointing tail rendered visually via the inverted
    // border-bottom-left/right pattern would be nice; skipped for v1 to
    // keep the implementation simple — the popover sits clearly above
    // the tapped segment which is enough visual association.
  },
  bandPopoverName: {
    fontSize:   12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  bandPopoverRange: {
    color:      colors.foreground,
    fontSize:   11,
    fontFamily: fonts.mono[600],
    fontVariant: ['tabular-nums'],
  },
  oneLineTip: {
    color:    colors.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  tipsList: {
    marginTop: 10,
    gap:       10,
  },
  tipRow: {
    flexDirection: 'row',
    gap:           10,
    alignItems:    'flex-start',
  },
  tipDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    marginTop:    5,
  },
  tipTitle: {
    color:      colors.foreground,
    fontSize:   12,
    fontWeight: '700',
  },
  tipBody: {
    color:    colors.mutedForeground,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
})
