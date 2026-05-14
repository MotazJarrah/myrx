/**
 * PhantomWheel — gesture-driven number picker with no idle chrome.
 *
 * Behaviour:
 *   • Idle:  only the current value is visible.
 *   • Touch + still: still nothing visible (touch captured but the halo
 *            doesn't appear until finger actually moves).
 *   • Drag:  halo of nearby values fades in above + below the centre.
 *            All rows slide continuously with the finger (iOS-style roll);
 *            integer-step values "settle" into the centre as the user
 *            crosses each row's pitch.
 *   • Release: halo fades out, scrollY snaps to the nearest committed
 *            step, leaving only the new centre value at rest.
 *
 * Two modes:
 *   • Uniform   — pass `step` + `min` + `max` (e.g. reps 1-50 step 1).
 *   • Ladder    — pass `ladder` array (e.g. atlas-stone weights). Each
 *                  swipe-tick navigates the ladder by one index.
 *
 * Implementation notes (read this before you edit the worklets):
 *   • The Pan worklet runs on the UI thread. It can ONLY use Math.*,
 *     primitive arithmetic, shared-value reads/writes, and runOnJS to
 *     call back into JS. **No array methods (.findIndex, .map, etc.)**
 *     and **no calls to non-worklet JS functions from inside the
 *     worklet** — both crash silently or hard, depending on Reanimated
 *     version. Direct indexed array access (`arr[i]`) IS safe as long
 *     as the array is captured at closure time.
 *   • The start ladder-index lookup uses `findIndex`, so it lives in a
 *     JS-side `captureStart` callback that the worklet `onBegin` calls
 *     via `runOnJS`.
 *   • The component is fully controlled — `value` is read from a ref
 *     so the gesture useMemo doesn't recreate per render. We only push
 *     `onChange` when the rounded step count actually changes (gates
 *     bridge crossings to the JS thread).
 *   • Continuous roll: `scrollY` (shared) tracks raw cumulative gesture
 *     translation. `committedSteps` (shared) tracks how many step-commits
 *     have been pushed to the parent. The visual `displayOffset` =
 *     scrollY − committedSteps × ROW_PITCH, which lives in roughly
 *     (−ROW_PITCH/2, ROW_PITCH/2) and drives every row's animated
 *     translateY + scale.
 *   • Per-row scale uses a PIECEWISE-LINEAR rank inverse of the static
 *     spacing (see `rankFromDistance` worklet). This guarantees that at
 *     integer rest positions the rendered size is EXACTLY
 *     `centerSize × 0.6^absOffset`, matching the pre-roll design. Each
 *     row is rendered at `fontSize: centerSize` and shrunk by the scale
 *     transform — that way the centre row has scale 1 when it lands at
 *     y=0 and rolls down to scale `0.6^t` as it moves to rank t.
 *
 *  Usage:
 *    <PhantomWheel value={reps} onChange={setReps} step={1} min={1} max={50} unit="reps" />
 *    <PhantomWheel value={stone} onChange={setStone} ladder={[100,135,150,180]} unit="lb" />
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { View, Text, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle, useAnimatedProps, useAnimatedReaction, useSharedValue,
  withTiming, withDecay, runOnJS, Easing, type SharedValue,
} from 'react-native-reanimated'
import { colors, fonts } from '../theme'

// AnimatedTextInput: a read-only TextInput whose `text` prop can be
// driven from a worklet via useAnimatedProps. Same pattern Reanimated
// uses for animated numerical readouts. Each wheel row uses this so
// its CONTENT can update on the UI thread in lockstep with its
// translateY/scale — eliminating the one-frame "labels updated but
// committedSteps lagged" glitch the previous React-driven `formatted`
// prop suffered at every step boundary mid-drag.
//
// In Reanimated 4 the `text` prop is auto-whitelisted on Fabric so no
// `addWhitelistedNativeProps` call is needed; on the legacy bridge a
// console warning will fire on first text update if the project is
// somehow not on the new architecture, harmless and once-only.
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

interface Props {
  /** Current value (controlled). */
  value: number
  /** Fires whenever the centre value changes during drag. */
  onChange: (value: number) => void

  // Uniform-step mode (use these OR `ladder`, not both)
  step?: number
  min?: number
  max?: number

  // Ladder mode — non-uniform increments (e.g. atlas stone weights)
  ladder?: readonly number[]

  // Display
  unit?: string
  format?: (v: number) => string

  // Sizing — only `centerSize` is configurable; halo row sizes are
  // derived from it (`centerSize × 0.6 ^ absOffset`) so the visual
  // hierarchy is consistent. `haloRadius` controls how many rows are
  // rendered above + below at peak fade.
  centerSize?: number
  haloRadius?: number
  /** Where each row anchors as it scales toward / away from rank 0.
   *
   * `'center'` (default) — content stays horizontally centred. Both edges
   *   sweep outward as the row grows, tracing `( )` brackets together.
   *   Used for ordinary numeric wheels (reps, weight, …).
   *
   * `'right'` — content's RIGHT edge stays pinned; the LEFT edge traces
   *   the `(` curve. Used for the minutes reel in a split time wheel so
   *   the digits hug the static colon's left side regardless of scale.
   *
   * `'left'`  — mirror of `'right'`: LEFT edge pinned, RIGHT edge traces
   *   the `)` curve. Used for the seconds reel.
   *
   * Implementation: `alignItems` on the row wrapper positions the in-flow
   * content at the chosen edge, and `transformOrigin` shifts the scale's
   * pivot to that same edge so growing/shrinking keeps that edge fixed in
   * place. No translate math needed (RN 0.81+ / Reanimated 4 support
   * `transformOrigin` on animated styles natively).
   */
  anchor?: 'center' | 'right' | 'left'
  /** When `true`, halo rows render at the same size as the centre row
   *  (no scale-down toward the periphery) and inter-row spacing becomes
   *  uniform `centerSize` (no overlap). Halo opacity still fades, so
   *  peripheral rows dim but don't shrink.
   *
   *  Used for the middle reel of an `hh:mm:ss` time wheel: the minutes
   *  digits sit between two static colons, so the usual "edges sweep
   *  outward" bracket motion has no room to play — instead the rows just
   *  translate vertically through the centre at full size.
   *
   *  Default `false` keeps the original geometric-shrink behaviour. */
  noScale?: boolean
  style?: StyleProp<ViewStyle>

  // ── Time-composition mode ──────────────────────────────────────────────
  // When `time` is set, the wheel renders as separated reels with static
  // `:` colons between them — minutes+seconds (`'mm:ss'`) or
  // hours+minutes+seconds (`'hh:mm:ss'`). `value` is total seconds.
  // The numeric-mode props above (step, min/max, ladder, unit, format,
  // anchor, noScale) are IGNORED in time mode — the composition wires
  // those per-reel itself.
  time?: 'mm:ss' | 'hh:mm:ss'
  /** mm:ss mode only — minimum minutes the user can scroll to (default 0). */
  minMinutes?: number
  /** mm:ss mode only — maximum minutes the user can scroll to (default 60).
   *  Ignored in hh:mm:ss mode. */
  maxMinutes?: number
  /** hh:mm:ss mode only — maximum hours the user can scroll to (default 23).
   *  Ignored in mm:ss mode. */
  maxHours?: number

  // ── Decimal-composition mode ───────────────────────────────────────────
  // When `decimal="XX.X"` is set, renders as TWO reels (whole + tenth)
  // around a static `.` decimal point, optionally followed by a static
  // `unit` suffix. The reels move just like time's mm:ss but separated
  // by a `.` instead of a `:`. `value` is in tenths (integer): 262 means
  // 26.2, 50 means 5.0. The numeric-mode props (step, ladder, format,
  // anchor, noScale) are ignored; the composition wires those per-reel.
  // `min` / `max` are in TENTHS (same unit as value). `unit` becomes the
  // static suffix Text after the right reel ("km" / "mi" / etc).
  decimal?: 'XX.X'
}

// ── Gesture-tuning constants ─────────────────────────────────────────────
const PAN_ACTIVATION_PX     = 3
const FADE_IN_MS            = 140
const FADE_OUT_MS           = 220
const SETTLE_MS             = 180   // snap-to-rest after gesture end

// ── Inertia tuning ───────────────────────────────────────────────────────
// Below this finger speed at release, no inertia — we just snap to the
// last committed step (gives the "drag-and-place" feel of a slow drag).
// At or above it, the wheel coasts via `withDecay`. 250 px/s is roughly
// "a deliberate flick" — slower than that reads as positioning, not
// flinging, on a Samsung-sized screen.
const INERTIA_MIN_VELOCITY  = 250

// withDecay deceleration constant. iOS scroll views use 0.998 (long
// glide); for a stepped picker that's too lazy — the user expects the
// roll to settle within a second or so, not coast across the whole
// range. 0.993 lands a typical flick at ~6-10 steps before resting,
// which feels right for reps/seconds/weight wheels.
const INERTIA_DECELERATION  = 0.993

// ── Visual constants (must mirror the per-row sizing helpers below) ──────
const SIZE_RATIO       = 0.6
const HALF_HEIGHT_FRAC = 0.6  // approx cap-height fraction of fontSize
const OVERLAP_PX       = 6    // how much each row underlaps the next-closer one

// Extra integer ranks rendered beyond `haloRadius` so a fast scroll
// always has a fresh row buffered (its low opacity makes the buffer
// invisible at rest; it grows + fades up as it approaches the centre).
const HALO_BUFFER_ROWS = 2

/** Pure-JS helper: find index of `target` in `arr`, or -1. */
function findLadderIndex(arr: readonly number[], target: number): number {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) return i
  }
  return -1
}

/** Pure helpers — used at component init to seed worklet-captured arrays. */
function sizeAt(centerSize: number, n: number): number {
  return centerSize * Math.pow(SIZE_RATIO, n)
}
function halfHAt(centerSize: number, n: number): number {
  return sizeAt(centerSize, n) * HALF_HEIGHT_FRAC
}
/** Cumulative static spacing (px) from centre to integer rank n. */
function staticSpacing(centerSize: number, n: number): number {
  let s = 0
  for (let i = 1; i <= n; i++) {
    s += halfHAt(centerSize, i - 1) + halfHAt(centerSize, i) - OVERLAP_PX
  }
  return s
}

/**
 * Pre-format every visible row's value+unit string into a single flat
 * array indexed by `offset + renderRadius` (so index 0 is the lowest
 * rendered offset, index 2*renderRadius is the highest, and the centre
 * sits at index renderRadius). Out-of-range slots — those past min/max
 * or past the ladder ends — carry an empty string, which renders as a
 * 0-px-wide TextInput and is therefore invisible.
 *
 * Called both at first-mount (to seed the SharedValue's initial value
 * so there's no empty paint) and from useLayoutEffect on every prop
 * change. The result is written to a SharedValue ALONGSIDE the
 * `committedSteps` update so the UI thread sees both updates land on
 * the same frame — that's what makes the step-boundary commit visually
 * invisible.
 */
function computeFormattedTexts(
  value: number,
  ladder: readonly number[] | undefined,
  step: number,
  min: number,
  max: number,
  format: ((v: number) => string) | undefined,
  unit: string | undefined,
  renderRadius: number,
): readonly string[] {
  const arr: string[] = []
  const unitSuffix = unit ? ` ${unit}` : ''
  for (let i = -renderRadius; i <= renderRadius; i++) {
    let v: number | null = null
    if (ladder && ladder.length > 0) {
      const idx = findLadderIndex(ladder, value)
      if (idx >= 0) {
        const ni = idx + i
        if (ni >= 0 && ni < ladder.length) v = ladder[ni]
      }
    } else {
      const nv = value + i * step
      if (nv >= min && nv <= max) v = nv
    }
    if (v != null) {
      const text = format ? format(v) : `${v}`
      arr.push(text + unitSuffix)
    } else {
      arr.push('')
    }
  }
  return arr
}

// ─────────────────────────────────────────────────────────────────────────
//  HaloRow — one non-centre row in the wheel halo. Each row's value is
//  determined by JS (passed in `formatted`); its visual position, scale,
//  and opacity are driven entirely by the shared `scrollY` /
//  `committedSteps` on the UI thread via useAnimatedStyle.
//
//  Rendering trick: every row is laid out at `fontSize = centerSize`,
//  then the animated `scale` transform shrinks it to the size it should
//  appear at its current visual rank. This keeps the at-rest size
//  pixel-identical to the pre-roll design (where ±n was rendered at
//  centerSize × SIZE_RATIO^n directly) — because the rank inverse is
//  exact at integer offsets — while letting scale interpolate smoothly
//  between ranks during the roll.
// ─────────────────────────────────────────────────────────────────────────
interface HaloRowProps {
  offset: number               // integer row offset (...-2,-1,1,2...)
  scrollY: SharedValue<number>
  committedSteps: SharedValue<number>
  rowPitch: number             // pixels between row centres (offset 0 → 1)
  centerSize: number
  haloRadius: number
  /** Static |offsetPx| at each integer rank 0..maxRank. */
  spacings: readonly number[]
  maxRank: number
  /** Pre-formatted value+unit strings, indexed by `offset + textsIdxBase`.
   *  Owned + written by the parent in a useLayoutEffect that also writes
   *  `committedSteps` — so the new text and the new position propagate
   *  to the UI thread atomically. Replaces the old per-row `formatted`
   *  React prop, which travelled through Fabric on a different timeline
   *  than the SharedValue updates and caused a one-frame label-shift
   *  glitch at every step boundary. */
  formattedTextsSV: SharedValue<readonly string[]>
  textsIdxBase: number         // add to `offset` to get the array index
  /** See PhantomWheel `anchor` prop doc. Controls where each row's edge
   *  is pinned during scale (default 'center'). */
  anchor: 'center' | 'right' | 'left'
  /** See PhantomWheel `noScale` prop doc. When true, the scale step in
   *  the worklet is forced to 1 so every row renders at centre size. */
  noScale: boolean
}

function HaloRow({
  offset, scrollY, committedSteps, rowPitch, centerSize, haloRadius,
  spacings, maxRank, formattedTextsSV, textsIdxBase, anchor, noScale,
}: HaloRowProps) {
  // Drive this row's text content from the SharedValue on the UI thread.
  // Reads atomically with committedSteps inside the same paint, so when
  // the wheel crosses a step boundary mid-drag the new label and the new
  // position arrive together — the label that was at "offset+1" before
  // the commit shows up at the same screen position after, with no
  // intervening frame in which only one of the two has updated.
  const animatedTextProps = useAnimatedProps(() => {
    'worklet'
    const arr = formattedTextsSV.value
    const i   = offset + textsIdxBase
    const t   = (i >= 0 && i < arr.length) ? arr[i] : ''
    return { text: t, defaultValue: t }
  })
  const animatedStyle = useAnimatedStyle(() => {
    'worklet'
    // Forward rank → position mapping (no inverse interpolation).
    //
    // The row's logical "rank" — its continuous distance from the visual
    // centre — is a LINEAR function of scrollY: each rowPitch worth of
    // drag shifts every row's rank by exactly 1. The PIXEL y, on the
    // other hand, is looked up from the non-uniform `spacings` table so
    // rows at rest sit at the same OVERLAP_PX "tucked under" positions as
    // the original wheel.
    //
    // Why forward (rank → y) instead of inverse (y → rank): the static
    // table is non-uniform (rank 0→1 is wider than 1→2 because of
    // OVERLAP_PX). With the inverse approach, all rows would translate at
    // the same pixel rate, so a row at rank 1 would over-shoot its rank 2
    // target by the gap difference (~10 px) at every commit boundary —
    // visible as the row "popping back" right after a commit. Going
    // forward keeps each row's pixel velocity matched to its current
    // segment, so positions are continuous through commits.
    const progress      = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const effectiveRank = offset - progress
    const absRank       = effectiveRank < 0 ? -effectiveRank : effectiveRank
    const rankSign      = effectiveRank < 0 ? -1 : 1

    // Piecewise-linear lookup into the spacings table.
    let y: number
    if (absRank <= 0) {
      y = 0
    } else if (absRank >= maxRank) {
      // Linear extrapolation past the table's right edge (buffer-row
      // territory, where opacity is already 0).
      const last     = spacings[maxRank]
      const prevLast = spacings[maxRank - 1]
      const slope    = last - prevLast
      y = rankSign * (last + (absRank - maxRank) * slope)
    } else {
      const floorRank = Math.floor(absRank)
      const frac      = absRank - floorRank
      const a         = spacings[floorRank]
      const b         = spacings[floorRank + 1]
      y = rankSign * (a + (b - a) * frac)
    }

    // Flat-row mode (noScale) keeps every halo at centre size; otherwise
    // each row shrinks geometrically by SIZE_RATIO per rank step.
    const scale = noScale ? 1 : Math.pow(SIZE_RATIO, absRank)

    // Opacity: 1 until rank crosses 1, then dims using the original
    // `distFade` formula. Hard-clamps to 0 once rank > haloRadius so the
    // buffer rows (offsets ±3, ±4 that we render to keep fast scrolls
    // smooth) stay invisible until they enter the haloRadius window —
    // matches the original wheel's "only ±haloRadius visible" look at rest.
    let opacity: number
    if (absRank < 1) {
      opacity = 1
    } else if (absRank > haloRadius) {
      opacity = 0
    } else {
      const o = 1 - ((absRank - 1) / haloRadius) * 0.75
      opacity = o < 0 ? 0 : o
    }

    return {
      transform: [
        // The row's bounding box is centerSize tall (View height below).
        // translateY = -y - centerSize/2 places the box's CENTRE at -y
        // relative to the container's vertical centre. The NEGATION flips
        // the wheel's visual axis: a row with positive `offset` (higher
        // value than the centre) sits ABOVE the geometric centre, not
        // below. As scrollY climbs (drag DOWN), every row's translateY
        // grows positive — they all roll DOWNWARD, and the row formerly
        // above the centre slides INTO the centre. Net effect: higher
        // values "come from above going down" instead of from below going
        // up. Scale is applied after, around the box's centre.
        { translateY: -y - centerSize / 2 },
        { scale },
      ],
      opacity,
    }
  })

  // Cross-fade between halo and centre styling as the row passes through
  // the visual centre. Drives two stacked Text layers: at rank 0 the
  // centre layer (bold + foreground colour) is fully visible; at rank ≥ 1
  // the halo layer (regular + muted) is fully visible. Linear interpolation
  // between makes the bold/bright "highlight" smoothly transfer from one
  // row to the next as the wheel rolls — instead of snapping at each commit
  // boundary the way it used to (the highlight "teleporting" from the
  // outgoing CenterRow to the incoming HaloRow at the rank-0 handoff).
  const haloLayerStyle = useAnimatedStyle(() => {
    'worklet'
    const progress      = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const effectiveRank = offset - progress
    const absRank       = effectiveRank < 0 ? -effectiveRank : effectiveRank
    return { opacity: absRank >= 1 ? 1 : absRank }
  })
  const centerLayerStyle = useAnimatedStyle(() => {
    'worklet'
    const progress      = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const effectiveRank = offset - progress
    const absRank       = effectiveRank < 0 ? -effectiveRank : effectiveRank
    return { opacity: absRank >= 1 ? 0 : 1 - absRank }
  })

  // Resolve anchor → (in-flow alignment, scale pivot).
  //   center: keep current behaviour (alignItems center, pivot at element centre).
  //   right : pin the row's right edge to the wrapper's right edge — used by
  //           the minutes reel of a split time wheel so the digits hug the
  //           colon's left side regardless of scale.
  //   left  : mirror of right, used by the seconds reel.
  const anchorAlign  = anchor === 'right' ? 'flex-end'
                     : anchor === 'left'  ? 'flex-start'
                     : 'center'
  const anchorOrigin = anchor === 'right' ? '100% 50%'
                     : anchor === 'left'  ? '0% 50%'
                     : '50% 50%'

  return (
    <Animated.View
      style={[
        s.haloRow,
        {
          top: '50%',
          height: centerSize,
          alignItems: anchorAlign,
          transformOrigin: anchorOrigin,
        },
        animatedStyle,
      ]}
    >
      {/* Inner relative wrapper sized to the halo Text's content — same
          pattern CenterRow uses. The previous structure had both layers
          absolutely positioned with `left:0, right:0`, so each layer was
          constrained to the container's content area (~87px after all the
          paddings). When the formatted text exceeded that width (e.g. the
          row carrying "100 lb" rolling up from below at the 95→100 commit),
          the Text wrapped to a second line and the trailing " lb" was
          clipped by the wrapper's centerSize height — visible as "100"
          rolling up with the unit suffix missing until the row crossed
          into the CenterRow's territory.
          Switching the halo layer to in-flow makes the inner View size
          itself to the text's natural width (overflowing the column
          visually if needed, just like CenterRow does), and `numberOfLines:1`
          guarantees no wrap. The centre overlay is still absolute and
          fills the inner View so the two layers cross-fade pixel-for-pixel. */}
      <View style={s.centerInner} pointerEvents="none">
        {/* Halo (regular/muted) layer — in flow, sizes the inner View.
            Uses AnimatedTextInput so the rendered string can be driven
            from a worklet via `animatedTextProps`, keeping the label
            change synchronized with the position change at step
            boundaries (see comment on `formattedTextsSV`).
            Wrapped in a plain `<View pointerEvents="none">` because
            `pointerEvents` on the TextInput element itself isn't
            respected on Android — the native touch handler runs before
            React Native's hit-testing and would intermittently swallow
            the Pan gesture's first event, making the wheel feel
            unresponsive on every other swipe. The wrapping View blocks
            the touch BEFORE it reaches the input, so the gesture wins
            every time. */}
        <Animated.View style={haloLayerStyle} pointerEvents="none">
          <View pointerEvents="none">
            <AnimatedTextInput
              style={[
                s.haloText,
                s.textInputReset,
                { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
              ]}
              animatedProps={animatedTextProps}
              editable={false}
              scrollEnabled={false}
              multiline={false}
              caretHidden
              selectTextOnFocus={false}
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          </View>
        </Animated.View>
        {/* Centre (bold/foreground) layer — absolute overlay, fills the inner. */}
        <Animated.View style={[s.rowLayer, centerLayerStyle]} pointerEvents="none">
          <View pointerEvents="none">
            <AnimatedTextInput
              style={[
                s.centerText,
                s.textInputReset,
                { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
              ]}
              animatedProps={animatedTextProps}
              editable={false}
              scrollEnabled={false}
              multiline={false}
              caretHidden
              selectTextOnFocus={false}
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  CenterRow — the bold "selected" value. Lives in normal flow (not
//  absolutely positioned) so the container's flex centring keeps it on
//  the geometric centre at rest. During drag, the same shared values
//  drive its translation and scale so it rolls smoothly off-centre to
//  make room for the next row sliding in.
//
//  Rendered at fontSize = centerSize with scale 1 at rest, identical to
//  the pre-roll design.
// ─────────────────────────────────────────────────────────────────────────
interface CenterRowProps {
  scrollY: SharedValue<number>
  committedSteps: SharedValue<number>
  rowPitch: number
  centerSize: number
  haloRadius: number
  spacings: readonly number[]
  maxRank: number
  /** Same SharedValue + base index pair the HaloRows use — this row
   *  reads the centre slot (`offset = 0` → array index `textsIdxBase`).
   *  See HaloRow's comment for why text is driven from a SharedValue
   *  rather than from a React prop. */
  formattedTextsSV: SharedValue<readonly string[]>
  textsIdxBase: number
  /** See PhantomWheel `anchor` prop doc. */
  anchor: 'center' | 'right' | 'left'
  /** See PhantomWheel `noScale` prop doc. */
  noScale: boolean
}

function CenterRow({
  scrollY, committedSteps, rowPitch, centerSize, haloRadius,
  spacings, maxRank, formattedTextsSV, textsIdxBase, anchor, noScale,
}: CenterRowProps) {
  // Drive the centre label from the SharedValue on the UI thread (mirror
  // of HaloRow's animatedTextProps). Reads `arr[textsIdxBase]` since the
  // centre row's logical offset is 0.
  const animatedTextProps = useAnimatedProps(() => {
    'worklet'
    const arr = formattedTextsSV.value
    const i   = textsIdxBase
    const t   = (i >= 0 && i < arr.length) ? arr[i] : ''
    return { text: t, defaultValue: t }
  })
  const animatedStyle = useAnimatedStyle(() => {
    'worklet'
    // Forward rank → position mapping (matches HaloRow — see the long
    // comment there for why this beats inverse y→rank). The centre row's
    // logical offset is 0, so its effective rank is simply −progress: as
    // scrollY climbs through one rowPitch (drag down), the centre rolls
    // up to rank +1, where the next halo row is sliding in to replace it.
    const progress      = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const effectiveRank = -progress
    const absRank       = effectiveRank < 0 ? -effectiveRank : effectiveRank
    const rankSign      = effectiveRank < 0 ? -1 : 1

    // Piecewise-linear lookup into the spacings table (identical to HaloRow).
    let y: number
    if (absRank <= 0) {
      y = 0
    } else if (absRank >= maxRank) {
      const last     = spacings[maxRank]
      const prevLast = spacings[maxRank - 1]
      const slope    = last - prevLast
      y = rankSign * (last + (absRank - maxRank) * slope)
    } else {
      const floorRank = Math.floor(absRank)
      const frac      = absRank - floorRank
      const a         = spacings[floorRank]
      const b         = spacings[floorRank + 1]
      y = rankSign * (a + (b - a) * frac)
    }

    // Flat-row mode (noScale) keeps every row at centre size.
    const scale = noScale ? 1 : Math.pow(SIZE_RATIO, absRank)

    // Centre text stays fully opaque until it crosses the first row-pitch
    // boundary; past that it dims like a halo row, and hard-clamps to 0
    // once it rolls past the halo radius (same three-branch logic as
    // HaloRow). Without the clamp, a fast drag rolled the centre to
    // rank 3+ where the linear fade-out formula still yields ~0.25
    // opacity — visible as a tiny ghost number sneaking past the halo
    // edge. With the clamp it disappears cleanly the moment it leaves
    // the visible halo, matching the buffer-row behaviour.
    let opacity: number
    if (absRank < 1) {
      opacity = 1
    } else if (absRank > haloRadius) {
      opacity = 0
    } else {
      const o = 1 - ((absRank - 1) / haloRadius) * 0.75
      opacity = o < 0 ? 0 : o
    }

    return {
      // No `- centerSize/2` here (unlike HaloRow): the centre row lives in
      // normal flow with `alignItems: 'center'` on the parent, so its own
      // origin already coincides with the geometric centre.
      //
      // translateY is `-y` (not `y`) so the centre row rolls DOWN as the
      // user drags down — matching the HaloRow flip. The next-higher value
      // arrives from above sliding into the centre line.
      transform: [
        { translateY: -y },
        { scale },
      ],
      opacity,
    }
  })

  // Cross-fade between halo and centre styling (same idea as HaloRow,
  // but offset is implicitly 0 so absRank = |progress|). Without this,
  // the bold/bright styling would teleport off the centre the moment the
  // wheel commits — visible as a "highlight snap" at every step boundary.
  // Now the highlight smoothly fades out of THIS row as it rolls away,
  // and the incoming HaloRow's centre layer fades in at the same rate
  // (their opacities are exact complements at every progress value).
  const haloLayerStyle = useAnimatedStyle(() => {
    'worklet'
    const progress = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const absRank  = progress < 0 ? -progress : progress
    return { opacity: absRank >= 1 ? 1 : absRank }
  })
  const centerLayerStyle = useAnimatedStyle(() => {
    'worklet'
    const progress = (scrollY.value - committedSteps.value * rowPitch) / rowPitch
    const absRank  = progress < 0 ? -progress : progress
    return { opacity: absRank >= 1 ? 0 : 1 - absRank }
  })

  // Resolve anchor → (in-flow alignment, scale pivot). Same logic as HaloRow.
  const anchorAlign  = anchor === 'right' ? 'flex-end'
                     : anchor === 'left'  ? 'flex-start'
                     : 'center'
  const anchorOrigin = anchor === 'right' ? '100% 50%'
                     : anchor === 'left'  ? '0% 50%'
                     : '50% 50%'

  return (
    <Animated.View
      style={[
        s.centerWrap,
        { alignItems: anchorAlign, transformOrigin: anchorOrigin },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      {/* Inner relative wrapper so the absolute halo overlay can size to
          the centre text's bounding box. The centre layer stays in flow to
          establish that box (numbers vary in width — "1" vs "100" — so we
          can't hardcode a size); the halo overlay is absolutely positioned
          on top of it and fades in as the row rolls away from rank 0.
          Both layers wrap an `AnimatedTextInput` (driven by a SharedValue
          via `useAnimatedProps`) inside a plain `<View pointerEvents="none">`.
          The wrapping View is critical — `pointerEvents` on the input
          itself isn't honoured on Android, and without the wrapper the
          centre's TextInput swallowed the first Pan event maybe one
          swipe in three, making the wheel feel broken. The whole
          `centerWrap` is also pointerEvents="none" so the gesture
          detector wrapping the wheel container reliably claims every
          touch that lands on the centre value. */}
      <View style={s.centerInner} pointerEvents="none">
        <Animated.View style={centerLayerStyle} pointerEvents="none">
          <View pointerEvents="none">
            <AnimatedTextInput
              style={[
                s.centerText,
                s.textInputReset,
                { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
              ]}
              animatedProps={animatedTextProps}
              editable={false}
              scrollEnabled={false}
              multiline={false}
              caretHidden
              selectTextOnFocus={false}
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          </View>
        </Animated.View>
        <Animated.View style={[s.rowLayer, haloLayerStyle]} pointerEvents="none">
          <View pointerEvents="none">
            <AnimatedTextInput
              style={[
                s.haloText,
                s.textInputReset,
                { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
              ]}
              animatedProps={animatedTextProps}
              editable={false}
              scrollEnabled={false}
              multiline={false}
              caretHidden
              selectTextOnFocus={false}
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  PhantomWheel (default export) — DISPATCHER. Picks rendering mode:
//    • If `time` prop is set ('mm:ss' or 'hh:mm:ss'), renders the
//      split-reel time picker (TimePhantomWheel internally — composes 2
//      or 3 NumericPhantomWheel reels with static `:` colons between
//      them). `value` is total seconds in this mode.
//    • Otherwise, renders a single numeric wheel (NumericPhantomWheel
//      internally — one rolling reel showing the value, optionally with
//      a unit suffix or custom `format` function applied).
//
//  This used to be two separate files (PhantomWheel.tsx + TimeWheel.tsx).
//  Merged so every time / numeric input across the app uses the same
//  component, picking the look via a single prop. The dispatcher itself
//  is trivially thin; all the gesture logic lives in NumericPhantomWheel
//  below.
// ─────────────────────────────────────────────────────────────────────────
export default function PhantomWheel(props: Props) {
  if (props.time)    return <TimePhantomWheel {...props} />
  if (props.decimal) return <DecimalPhantomWheel {...props} />
  return <NumericPhantomWheel {...props} />
}

// Pad to two digits with a leading zero. Used by the time reels for
// "07" instead of "7". Pure JS (not a worklet) — called on JS thread
// inside `useLayoutEffect` and passed to each reel as its `format`.
const pad2 = (n: number) => String(n).padStart(2, '0')

// ─────────────────────────────────────────────────────────────────────────
//  TimePhantomWheel — the split-reel time picker. 2 reels for 'mm:ss'
//  (minutes + seconds) or 3 reels for 'hh:mm:ss' (hours + minutes +
//  seconds), with static `:` colons between them.
//
//  Each reel is an independent NumericPhantomWheel. The composed
//  `onChange(totalSecs)` fires whenever any reel commits — reassembles
//  the total from the current (hours, minutes, seconds) tuple and pushes
//  it upstream. The reels themselves never share state directly.
//
//  Reel anchoring:
//    • Outer reels (hours / minutes-in-mm:ss / seconds) anchor to the
//      colon's edge so the digits hug the colon as they scale.
//    • Middle reel (minutes-in-hh:mm:ss) uses `noScale` so it doesn't
//      shrink — it sits sandwiched between two static colons and the
//      usual edge-sweep would have nowhere to go.
// ─────────────────────────────────────────────────────────────────────────
function TimePhantomWheel({
  value, onChange,
  time = 'mm:ss',
  minMinutes = 0,
  maxMinutes = 60,
  maxHours = 23,
  centerSize = 28,
  haloRadius = 2,
  style,
}: Props) {
  // Defensive floor — guard against the (unlikely) negative-totalSecs case.
  const totalSecs = Math.max(0, Math.floor(value))

  const Colon = (
    <Text
      style={[
        s.timeColon,
        { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
      ]}
      pointerEvents="none"
    >
      :
    </Text>
  )

  if (time === 'hh:mm:ss') {
    const hours       = Math.floor(totalSecs / 3600)
    const minutes     = Math.floor((totalSecs % 3600) / 60)
    const seconds     = totalSecs % 60
    const setHours   = (h: number)   => onChange(h * 3600 + minutes * 60 + seconds)
    const setMinutes = (m: number)   => onChange(hours * 3600 + m * 60 + seconds)
    const setSeconds = (sec: number) => onChange(hours * 3600 + minutes * 60 + sec)

    return (
      <View style={[s.timeRow, style]}>
        <NumericPhantomWheel
          value={hours} onChange={setHours}
          step={1} min={0} max={maxHours}
          anchor="right" format={pad2}
          centerSize={centerSize} haloRadius={haloRadius}
        />
        {Colon}
        <NumericPhantomWheel
          value={minutes} onChange={setMinutes}
          step={1} min={0} max={59}
          anchor="center" noScale format={pad2}
          centerSize={centerSize} haloRadius={haloRadius}
        />
        {Colon}
        <NumericPhantomWheel
          value={seconds} onChange={setSeconds}
          step={1} min={0} max={59}
          anchor="left" format={pad2}
          centerSize={centerSize} haloRadius={haloRadius}
        />
      </View>
    )
  }

  // Default mm:ss — two reels, one colon.
  const minutes = Math.floor(totalSecs / 60)
  const seconds = totalSecs % 60
  const setMinutes = (m: number)   => onChange(m * 60 + seconds)
  const setSeconds = (sec: number) => onChange(minutes * 60 + sec)

  return (
    <View style={[s.timeRow, style]}>
      <NumericPhantomWheel
        value={minutes} onChange={setMinutes}
        step={1} min={minMinutes} max={maxMinutes}
        anchor="right" format={pad2}
        centerSize={centerSize} haloRadius={haloRadius}
      />
      {Colon}
      <NumericPhantomWheel
        value={seconds} onChange={setSeconds}
        step={1} min={0} max={59}
        anchor="left" format={pad2}
        centerSize={centerSize} haloRadius={haloRadius}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  DecimalPhantomWheel — split-reel decimal picker. Same pattern as
//  TimePhantomWheel but with a `.` instead of `:` and an optional static
//  unit suffix after the right reel ("km" / "mi" / etc).
//
//  Two reels:
//    • Left reel — whole number, anchored RIGHT, formatted with pad2 so
//      the digits hug the dot's left side and stay aligned (`05.5 km`
//      instead of `5.5 km` shifting the dot leftward).
//    • Right reel — single tenths digit, anchored LEFT, no padding (it's
//      always a single digit anyway).
//
//  `value` is in TENTHS (integer). `min` / `max` are also in tenths.
//  Pass cardio's 5.0 km as `value={50}` with `max={500}`. The unit
//  suffix is static — doesn't roll, doesn't scale, doesn't receive
//  touches.
//
//  Clamp behaviour (LOCKED — see CLAUDE.md "PhantomWheel decimal mode"):
//  each reel runs INDEPENDENTLY within its own range. Whole reel spans
//  `[Math.floor(min/10), Math.floor(max/10)]`. Tenth reel always spans
//  `[0, 9]`. No combined clamp — the effective scrollable range is
//  `[minWhole.0, maxWhole.9]`, NOT `[min, max]`. E.g. `min=0 max=500`
//  → user can reach 0.0 up to 50.9 (one extra tenth beyond 50.0). The
//  parent's save-validation is expected to enforce any business cap
//  separately if the literal `max` is meant as a hard ceiling.
// ─────────────────────────────────────────────────────────────────────────
function DecimalPhantomWheel({
  value, onChange,
  min = 0, max = 999,
  unit,
  centerSize = 28,
  haloRadius = 2,
  style,
}: Props) {
  // Decompose tenths → (whole, tenth).
  const whole = Math.floor(value / 10)
  const tenth = value % 10

  // Reel bounds — whole spans the integer range derived from min/max
  // (treated as tenths); tenths always 0–9 since carry-over isn't
  // supported. NO combined clamp — each reel runs free within its own
  // range. Effective scrollable range becomes [minWhole.0, maxWhole.9]
  // — e.g. cardio's `min=0 max=500` makes the wheel reachable from
  // 0.0 km up to 50.9 km (one extra tenth past the nominal 50.0 cap).
  // This is intentional per spec: "values should go as low as 0.0 and
  // up to x.9, where x is the highest available number".
  const minWhole = Math.floor(min / 10)
  const maxWhole = Math.floor(max / 10)

  const setWhole = (w: number) => onChange(w * 10 + tenth)
  const setTenth = (t: number) => onChange(whole * 10 + t)

  const Dot = (
    <Text
      style={[
        s.timeColon,
        { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
      ]}
      pointerEvents="none"
    >
      .
    </Text>
  )

  const UnitSuffix = unit ? (
    <Text
      style={[
        s.decimalUnit,
        { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
      ]}
      pointerEvents="none"
    >
      {' '}{unit}
    </Text>
  ) : null

  return (
    <View style={[s.timeRow, style]}>
      <NumericPhantomWheel
        value={whole} onChange={setWhole}
        step={1} min={minWhole} max={maxWhole}
        anchor="right" format={pad2}
        centerSize={centerSize} haloRadius={haloRadius}
      />
      {Dot}
      <NumericPhantomWheel
        value={tenth} onChange={setTenth}
        step={1} min={0} max={9}
        anchor="left"
        centerSize={centerSize} haloRadius={haloRadius}
      />
      {UnitSuffix}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  NumericPhantomWheel — the single rolling-reel implementation. All the
//  gesture / inertia / SharedValue-driven text logic lives here. Used
//  directly for plain numeric inputs (reps, weight, distance, …) AND
//  internally by TimePhantomWheel for each of its reels.
// ─────────────────────────────────────────────────────────────────────────
function NumericPhantomWheel({
  value, onChange,
  step = 1, min = 0, max = 9999,
  ladder,
  unit, format,
  centerSize = 28,
  // 2 rows above + 2 below at peak fade. Tightens the visual cluster so
  // the user's eye stays on the centre + immediate neighbours instead of
  // tracking values 3 rungs away that they're not currently considering.
  haloRadius = 2,
  anchor = 'center',
  noScale = false,
  style,
}: Props) {
  // ── Refs (always-fresh JS-side reads, no re-render trigger) ───────────
  const valueRef    = useRef(value)
  const onChangeRef = useRef(onChange)
  const ladderRef   = useRef(ladder)
  useEffect(() => {
    valueRef.current    = value
    onChangeRef.current = onChange
    ladderRef.current   = ladder
  })

  // ── Drag-state shared values (UI thread) ──────────────────────────────
  const startValue       = useSharedValue(0)
  const startIndex       = useSharedValue(0)
  const scrollY          = useSharedValue(0)
  /** Snapshot of (parent value − startValue) / step, used to rebase the
   *  visual offset so the currently-shown value always sits at the
   *  geometric centre at rest. Written from the JS thread inside the
   *  useLayoutEffect AFTER React commits a new `value` prop. */
  const committedSteps   = useSharedValue(0)
  /** Step count we've already pushed via runOnJS — throttles redundant
   *  bridge crossings while the user drags within the same row-pitch
   *  bucket. Lives entirely on the UI thread. */
  const lastEmittedSteps = useSharedValue(0)
  const haloOpacity      = useSharedValue(0)

  /** Pre-formatted text for every row we render, indexed by
   *  `offset + renderRadius`. Owned by the parent, READ by each
   *  `HaloRow` / `CenterRow` via `useAnimatedProps`. Written in the
   *  same `useLayoutEffect` callback that writes `committedSteps`, so
   *  the two updates leave the JS thread in a single synchronous block
   *  and reach the UI thread on the same animation frame — the wheel's
   *  step-boundary commit is then visually invisible because the new
   *  text labels and the new row positions appear together. The old
   *  approach (text via a React prop, position via a SharedValue)
   *  travelled through Fabric and JSI on slightly different timelines,
   *  which is why every commit used to flash one frame of "labels
   *  shifted up by one digit" before settling.
   *
   *  Seeded with the initial render's values so the first paint never
   *  shows empty rows. */
  const renderRadius = haloRadius + HALO_BUFFER_ROWS
  const formattedTextsSV = useSharedValue<readonly string[]>(
    computeFormattedTexts(value, ladder, step, min, max, format, unit, renderRadius),
  )

  // Tracks the step-count corresponding to the most recent `onChange`
  // we dispatched. The worklet writes to this ref via runOnJS each time
  // a step commits; the useLayoutEffect below copies it to the UI-thread
  // `committedSteps` shared value in the same synchronous block as the
  // `formattedTextsSV` write, keeping the two in lockstep on the UI
  // thread — eliminating the one-frame label-shift glitch that the old
  // React-prop-driven text path used to exhibit at every step boundary.
  const pendingStepsRef = useRef(0)

  // ── Derived constants ──────────────────────────────────────────────────
  // Spacings table: precomputed cumulative pixel distances from the
  // centre to each integer rank. Captured by the per-row worklets so the
  // UI thread can invert the spacing → rank mapping without recomputing
  // the geometric series every frame.
  //
  // Ranks 0..haloRadius use the original `staticSpacing` (so visible halo
  // rows sit pixel-identical to the pre-roll design). Ranks beyond that
  // are extrapolated at a constant `rowPitch` increment — this both
  // guarantees strict monotonicity (the rank inverse needs monotonic
  // spacings to interpolate cleanly) and avoids the cumulative-overlap
  // bug where `halfHAt(n) − OVERLAP_PX` eventually turns negative and
  // collapses far rows on top of each other.
  const { spacings, maxRank, rowPitch } = useMemo(() => {
    const r = haloRadius + HALO_BUFFER_ROWS
    const sp: number[] = []
    if (noScale) {
      // Flat-row mode: every row is centerSize tall and sits one full
      // centerSize away from its neighbour (no overlap). Used by the
      // middle reel of an hh:mm:ss time wheel where the digits don't
      // shrink toward the periphery — they just translate vertically.
      for (let i = 0; i <= r; i++) sp.push(i * centerSize)
      return { spacings: sp as readonly number[], maxRank: r, rowPitch: centerSize }
    }
    for (let i = 0; i <= haloRadius; i++) sp.push(staticSpacing(centerSize, i))
    const pitch = sp[1]   // distance from rank 0 to rank 1
    for (let i = haloRadius + 1; i <= r; i++) {
      sp.push(sp[i - 1] + pitch)
    }
    return { spacings: sp as readonly number[], maxRank: r, rowPitch: pitch }
  }, [centerSize, haloRadius, noScale])

  // ── JS-side handlers called from worklets via runOnJS ─────────────────
  /** Snapshot starting value + ladder index when the gesture begins. */
  const captureStart = useCallback(() => {
    const v = valueRef.current
    startValue.value = v
    pendingStepsRef.current = 0
    const lad = ladderRef.current
    if (lad && lad.length > 0) {
      const idx = findLadderIndex(lad, v)
      startIndex.value = idx >= 0 ? idx : 0
    }
  }, [startValue, startIndex])

  /**
   * Commit a step boundary: record the new step count and push the new
   * value upstream. The matching `committedSteps` write happens in the
   * useLayoutEffect below, AFTER React commits the new value — so the
   * UI thread sees `haloRows` and `committedSteps` updated atomically
   * on the same frame.
   *
   * Special case: when `next === valueRef.current` (e.g., clamped at
   * min/max), no React re-render fires, so the useLayoutEffect won't
   * run. Sync `committedSteps` directly so `displayOffset` doesn't
   * accumulate beyond ±PITCH/2 against the same value (which would let
   * the user "scroll past" the clamp visually).
   */
  const commitValue = useCallback((next: number, steps: number) => {
    pendingStepsRef.current = steps
    if (next !== valueRef.current) {
      onChangeRef.current(next)
    } else {
      committedSteps.value = steps
    }
  }, [committedSteps])

  // Atomic sync after React commits a new `value` (or any prop that
  // affects formatting / range): recompute the row-text array AND push
  // the matching committedSteps update in a single synchronous block.
  // Both writes leave the JS thread together, so the UI thread picks
  // them up on the same frame and the wheel's step-boundary roll stays
  // visually continuous — no more one-frame "labels shifted up by 1"
  // flash at every commit.
  //
  // Runs on every value change including external setters; in those
  // cases pendingStepsRef holds the last value we set (initially 0,
  // or reset on gesture start), so this writes a stale-but-consistent
  // step count and the at-rest visual (haloOpacity = 0) is unaffected.
  useLayoutEffect(() => {
    formattedTextsSV.value =
      computeFormattedTexts(value, ladder, step, min, max, format, unit, renderRadius)
    committedSteps.value = pendingStepsRef.current
  }, [
    value, ladder, step, min, max, format, unit, renderRadius,
    formattedTextsSV, committedSteps,
  ])

  // ── Pan gesture (UI-thread worklets) ──────────────────────────────────
  // Captures primitive props (step/min/max/ladder length, row pitch) so
  // the worklet closure has stable values without needing JS-thread reads.
  const pan = useMemo(() => {
    const LADDER     = ladder ?? []
    const LADDER_LEN = LADDER.length
    const STEP       = step
    const MIN        = min
    const MAX        = max
    const PITCH      = rowPitch

    return Gesture.Pan()
      .activeOffsetY([-PAN_ACTIVATION_PX, PAN_ACTIVATION_PX])
      .onBegin(() => {
        'worklet'
        // Reset `lastEmittedSteps` BEFORE we touch `scrollY`. The
        // useAnimatedReaction below fires whenever scrollY changes, and
        // its first check is `Math.round(scrollY/PITCH) !== lastEmittedSteps`.
        // If we wrote scrollY = 0 first while lastEmittedSteps still held
        // the previous gesture's step count, the reaction would fire a
        // stray commit on this frame — momentarily snapping the wheel's
        // value back to startValue before the new gesture even moved.
        lastEmittedSteps.value = 0
        // Assigning a non-animated value to scrollY ALSO cancels any
        // in-flight `withDecay` / `withTiming` animation on it — this is
        // what makes a tap mid-inertia stop the wheel at its current
        // position. The gesture handler intercepts the touch BEFORE
        // anything else can react to it, so the next drag starts cleanly
        // from a rest position.
        scrollY.value          = 0
        committedSteps.value   = 0
        // captureStart runs on JS thread; by the first onUpdate (which
        // requires real finger movement) the index + pendingStepsRef are set.
        runOnJS(captureStart)()
      })
      .onUpdate((e) => {
        'worklet'
        // Halo materialises on first real movement.
        if (haloOpacity.value < 1) {
          haloOpacity.value = withTiming(1, { duration: FADE_IN_MS })
        }

        // Raw cumulative gesture translation — never reset mid-drag.
        // Drag DOWN (positive translationY) → scrollY increases → value
        // INCREASES. Visually the rows translate DOWN with the finger —
        // the row that was ABOVE the centre (carrying the next higher
        // value) slides INTO the centre, and the previous centre row
        // rolls down off the bottom. The visual flip from "row goes
        // opposite to finger" to "row goes WITH finger" is achieved by
        // negating `y` in each row's translateY (see HaloRow/CenterRow
        // animatedStyle).
        //
        // Clamp scrollY to the range of step-counts that map to valid
        // values reachable from the gesture's starting position. Past
        // these bounds the visual rolling stops (instead of continuing
        // to slide while the underlying value sits clamped at MIN/MAX,
        // which looked like the wheel was "scrolling on nothing"). The
        // user can still swipe back in the opposite direction normally.
        let maxAllowedSteps: number
        let minAllowedSteps: number
        if (LADDER_LEN > 0) {
          maxAllowedSteps = LADDER_LEN - 1 - startIndex.value
          minAllowedSteps = -startIndex.value
        } else {
          maxAllowedSteps = Math.floor((MAX - startValue.value) / STEP)
          minAllowedSteps = Math.ceil((MIN - startValue.value) / STEP)
        }
        const maxScrollY = maxAllowedSteps * PITCH
        const minScrollY = minAllowedSteps * PITCH
        let next = e.translationY
        if (next > maxScrollY) next = maxScrollY
        if (next < minScrollY) next = minScrollY
        scrollY.value = next

        // Step-boundary detection (the `Math.round(scrollY/PITCH)` check
        // that fires `commitValue`) now lives in the useAnimatedReaction
        // below — it watches scrollY directly so commits fire both
        // during the user's drag AND during the post-release inertia
        // `withDecay`. The old inline detection here only ran during the
        // drag, so inertia rolls would visually pass through values
        // without ever committing them.
      })
      .onEnd((e) => {
        'worklet'
        // Slow drag → no inertia, just snap to the last committed step.
        // The threshold (250 px/s) distinguishes a "place me here"
        // movement from a "fling" flick. Halo fades out immediately
        // here because there's no further animation to watch.
        const vy = e.velocityY
        const speed = vy < 0 ? -vy : vy
        if (speed < INERTIA_MIN_VELOCITY) {
          haloOpacity.value = withTiming(0, { duration: FADE_OUT_MS })
          const target = lastEmittedSteps.value * PITCH
          scrollY.value = withTiming(target, {
            duration: SETTLE_MS,
            easing: Easing.out(Easing.cubic),
          })
          return
        }

        // Fast flick → inertia. `withDecay` continues the finger's
        // momentum, decelerating geometrically; the useAnimatedReaction
        // below fires `commitValue` as the rolling wheel crosses each
        // step boundary, so the parent's `value` and the displayed
        // labels stay in sync throughout the coast.
        //
        // IMPORTANT: do NOT fade `haloOpacity` here. The halo is what
        // makes the inertia visible — it shows the next/previous values
        // sliding through. If we fade it on release, the entire roll
        // happens behind an invisible curtain and the wheel appears to
        // "teleport" to its final number with no animation. Fade only
        // when the decay actually finishes, in the callback below.
        //
        // Clamps mirror the `onUpdate` clamps so the wheel can't coast
        // past MIN/MAX (or past the ladder ends). When the decay hits
        // the clamp it stops there, then the snap-back below settles
        // it onto the boundary step.
        let maxAllowedSteps: number
        let minAllowedSteps: number
        if (LADDER_LEN > 0) {
          maxAllowedSteps = LADDER_LEN - 1 - startIndex.value
          minAllowedSteps = -startIndex.value
        } else {
          maxAllowedSteps = Math.floor((MAX - startValue.value) / STEP)
          minAllowedSteps = Math.ceil((MIN - startValue.value) / STEP)
        }
        const maxScrollY = maxAllowedSteps * PITCH
        const minScrollY = minAllowedSteps * PITCH

        scrollY.value = withDecay(
          {
            velocity: vy,
            deceleration: INERTIA_DECELERATION,
            clamp: [minScrollY, maxScrollY],
          },
          (finished) => {
            'worklet'
            // `finished` is false if the animation was cancelled (e.g.
            // by a new touch's onBegin reset). Don't snap or fade in
            // that case — onBegin already put the wheel into the new
            // gesture's rest state and will manage halo fade on its
            // own.
            if (!finished) return
            // Inertia is over → fade the halo and snap to the nearest
            // committed step. Both animations run together.
            haloOpacity.value = withTiming(0, { duration: FADE_OUT_MS })
            const finalSteps = Math.round(scrollY.value / PITCH)
            scrollY.value = withTiming(finalSteps * PITCH, {
              duration: SETTLE_MS,
              easing: Easing.out(Easing.cubic),
            })
          },
        )
      })
      .onFinalize((_e, success) => {
        'worklet'
        // For a successful release, onEnd has already decided whether
        // to fade the halo immediately (slow drag) or defer until the
        // decay completes (fast flick). Touching either here would
        // either kill the inertia visibility or double-write the same
        // animation. So fade + settle ONLY for cancellations (parent
        // ScrollView claimed the gesture, app backgrounded, etc.).
        if (!success) {
          haloOpacity.value = withTiming(0, { duration: FADE_OUT_MS })
          const target = lastEmittedSteps.value * PITCH
          scrollY.value = withTiming(target, {
            duration: SETTLE_MS,
            easing: Easing.out(Easing.cubic),
          })
        }
      })
  }, [
    // Recreate the gesture only when these primitives change.
    ladder, step, min, max, rowPitch,
    // Stable callbacks (refs internally).
    captureStart, commitValue,
    // Shared values (referentially stable).
    scrollY, committedSteps, lastEmittedSteps, startValue, startIndex, haloOpacity,
  ])

  // ── Continuous step-crossing detector ─────────────────────────────────
  // Single source of truth for "the wheel has rolled past a step
  // boundary — push the new value upstream." Watches scrollY directly so
  // commits fire BOTH during the user's active drag AND during the
  // post-release `withDecay` inertia. The old design ran this logic
  // inline inside `onUpdate`, which meant an inertia roll could visually
  // sweep through ten values without committing any of them — the
  // parent's `value` only caught up when the wheel finally settled.
  //
  // Reads everything it needs from worklet-safe closures (LADDER index
  // via direct `[]` access, primitives as captured constants) and
  // `runOnJS`-es the actual `commitValue` JS callback. Re-created when
  // the same prop set as the pan gesture changes, so they stay in sync.
  useAnimatedReaction(
    () => scrollY.value,
    (current) => {
      'worklet'
      const stepsRounded = Math.round(current / rowPitch)
      if (stepsRounded === lastEmittedSteps.value) return
      lastEmittedSteps.value = stepsRounded
      const lad = ladder ?? []
      const lLen = lad.length
      let nextVal: number
      if (lLen > 0) {
        let idx = startIndex.value + stepsRounded
        if (idx < 0)            idx = 0
        if (idx > lLen - 1)     idx = lLen - 1
        nextVal = lad[idx]
      } else {
        let v = startValue.value + stepsRounded * step
        if (v < min) v = min
        if (v > max) v = max
        nextVal = v
      }
      runOnJS(commitValue)(nextVal, stepsRounded)
    },
    [ladder, step, min, max, rowPitch, commitValue],
  )

  // ── Halo row offsets (fixed integer list) ─────────────────────────────
  // We always render the same set of offsets — the per-row TEXT is now
  // driven from `formattedTextsSV` on the UI thread, so the rendered
  // React tree no longer needs to change when `value` changes. Out-of-
  // range slots carry an empty string in the SharedValue and therefore
  // render as a 0-width AnimatedTextInput — invisible without needing
  // to be unmounted. Memoised on `haloRadius` only because the offset
  // list is purely structural.
  const renderOffsets = useMemo(() => {
    const offsets: number[] = []
    for (let i = -renderRadius; i <= renderRadius; i++) {
      if (i !== 0) offsets.push(i)
    }
    return offsets
  }, [renderRadius])

  // ── Animated styles ────────────────────────────────────────────────────
  const haloAnimStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value,
  }))

  // ── Render ─────────────────────────────────────────────────────────────
  // The centre row's text-index is `renderRadius` (offset 0 lands at the
  // middle of the formattedTexts array). Halo rows use the same base
  // and add their own offset.
  return (
    <GestureDetector gesture={pan}>
      <View style={[s.container, style]}>
        {/* Halo — absolutely positioned, anchored to the container's
            vertical centre via top:50% + translateY. Each row's CENTRE
            (not top) sits at a live offset from the wheel centre. All
            rows share the wrapper's fade-in/out opacity. */}
        <Animated.View pointerEvents="none" style={[s.halo, haloAnimStyle]}>
          {renderOffsets.map((offset) => (
            <HaloRow
              key={offset}
              offset={offset}
              scrollY={scrollY}
              committedSteps={committedSteps}
              rowPitch={rowPitch}
              centerSize={centerSize}
              haloRadius={haloRadius}
              spacings={spacings}
              maxRank={maxRank}
              formattedTextsSV={formattedTextsSV}
              textsIdxBase={renderRadius}
              anchor={anchor}
              noScale={noScale}
            />
          ))}
        </Animated.View>

        {/* Centre row — rendered AFTER the halo and given an explicit
            zIndex/elevation so it paints ON TOP of the immediate
            neighbours, which sneak underneath via the OVERLAP_PX. At
            rest (scrollY=0, committedSteps=0) the animated transform
            is the identity, so the layout matches the pre-roll design. */}
        <CenterRow
          scrollY={scrollY}
          committedSteps={committedSteps}
          rowPitch={rowPitch}
          centerSize={centerSize}
          haloRadius={haloRadius}
          spacings={spacings}
          maxRank={maxRank}
          formattedTextsSV={formattedTextsSV}
          textsIdxBase={renderRadius}
          anchor={anchor}
          noScale={noScale}
        />
      </View>
    </GestureDetector>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    // Fill the parent's full width via alignSelf:stretch — without this,
    // the container sized itself to CenterRow's in-flow text content (so
    // a centre value of "95 lb" left the container only ~90dp wide).
    // Halo rows inherit that width via their absolute `left:0/right:0`
    // wrapper, so any halo carrying a WIDER text (like "100 lb" rolling up
    // from below at 95→100) was constrained to the centre's bounding box
    // and truncated. Stretching the container decouples the halo-row width
    // from whatever the centre value happens to be.
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 0,
    // Establish a z-index context so the centre Text's elevation lands
    // above the halo's absolutely-positioned children.
    position: 'relative',
  },
  halo: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    // No flex centring — children are absolute-positioned via top:'50%'.
  },
  haloRow: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  // Used by the two stacked text layers (halo + centre styling) inside
  // both HaloRow and CenterRow. Fills the parent and centres its single
  // Text child so the two layers overlap exactly — the cross-fade then
  // works pixel-for-pixel with no positional drift between styles.
  rowLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inner wrapper inside CenterRow's centerWrap: position:relative so the
  // absolute halo overlay (s.rowLayer) has bounds to fill, while the
  // in-flow centre Animated.Text establishes those bounds by its own size.
  centerInner: {
    position: 'relative',
  },
  haloText: {
    color: colors.mutedForeground,
    // Weight is encoded in the fontFamily name (JetBrainsMono_500Medium).
    // Don't set fontWeight alongside — Android doesn't auto-resolve weight
    // when the family is custom, and the dual hint can fall back to the
    // system default. Same pattern used everywhere else in the app (see
    // sign-up.tsx's heading styles).
    fontFamily: fonts.mono[500],
    fontVariant: ['tabular-nums'],
  },
  centerWrap: {
    // In-flow centring: flex-centred by the container at rest, then the
    // animated transform translates/scales it during drag. zIndex +
    // elevation keep the bold glyph painting above the halo's absolutely
    // positioned neighbour rows that overlap via OVERLAP_PX.
    zIndex: 10,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    color: colors.foreground,
    // Weight encoded in fontFamily (JetBrainsMono_700Bold). See note on
    // haloText above — fontWeight + custom fontFamily on Android falls
    // back to system default, which was leaving the main centre number
    // in Geist Bold instead of JetBrainsMono Bold like the halo rows.
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  // Strip the platform defaults that distinguish a TextInput from a Text
  // node. Android adds internal vertical padding and a font-padding line
  // gap; iOS adds a couple of dp of margin around the editable bounds.
  // Without these, swapping `<Text>` → `<AnimatedTextInput>` would shift
  // every digit upward by a few pixels and add a phantom caret column on
  // some Android devices. Applied alongside `s.haloText`/`s.centerText`
  // so the colour + font weight still come from the original styles.
  textInputReset: {
    padding: 0,
    margin: 0,
    // Android: kill the extra ascender-area pixel padding the framework
    // injects by default. Combined with explicit `lineHeight === fontSize`
    // on the inline style, this is enough to land the glyph at the same
    // baseline a `<Text>` would.
    textAlignVertical: 'center',
  },

  // Container for the time-composition mode (TimePhantomWheel). Row of
  // reels + static colons, centred. Each reel is its own NumericPhantomWheel
  // so they each handle their own gestures + animations independently.
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Static `:` colon between two reels. Same fontFamily / weight as the
  // centre digits so the colon sits visually balanced with the digits
  // beside it. Doesn't roll, doesn't scale, doesn't receive touches.
  // Also reused by DecimalPhantomWheel for the `.` between whole and
  // tenth reels.
  timeColon: {
    color: colors.foreground,
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  // Static unit suffix ("km" / "mi" / etc) used by DecimalPhantomWheel.
  // Same weight + family as the centre digits — visually treated as
  // part of the value display, just non-interactive. The leading space
  // is included inline in the Text child for breathing room from the
  // right reel.
  decimalUnit: {
    color: colors.foreground,
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
  },
})
