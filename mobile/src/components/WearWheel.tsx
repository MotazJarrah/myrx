/**
 * WearWheel — always-visible scroll-list picker styled after Wear OS pickers.
 *
 * Implementation:
 *   • Reanimated-driven Pan gesture (NOT FlatList — same-axis nesting in
 *     parent ScrollView eats the gesture on Android otherwise).
 *   • All rows rendered into a single Animated.View; we translate it via
 *     a `scrollOffset` shared value as the user drags.
 *   • Per-row scale + opacity is also UI-thread-driven via the SAME
 *     scrollOffset shared value — each row reads its own distance to the
 *     wheel centre via useAnimatedStyle and reacts INSTANTLY (zero JS
 *     bridge lag, so the centred-row emphasis tracks the finger
 *     frame-perfect even on long fast flicks).
 *   • Single `withSpring` snap on release, seeded with the gesture's
 *     release velocity → smooth one-stage settle (no decay-then-spring
 *     handoff that causes the jerky/bouncy feel).
 *   • Top + bottom gradient fade overlays.
 *
 * Two modes:
 *   • Uniform — pass `step` + `min` + `max`.
 *   • Ladder  — pass `ladder` array of allowed values.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, runOnJS, cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated'
import { colors } from '../theme'

interface Props {
  value: number
  onChange: (value: number) => void

  step?: number
  min?: number
  max?: number
  ladder?: readonly number[]

  unit?: string
  format?: (v: number) => string

  rowHeight?: number
  visibleRowsEachSide?: number
  centerSize?: number
  neighbourSize?: number
  fadeStrength?: number
  fadeBackground?: string
  showCenterIndicator?: boolean

  style?: StyleProp<ViewStyle>
}

const FADE_STEPS = 10
// How long (in seconds) the user's release velocity should "carry" past
// the release point before snapping. Larger = bigger flicks land further.
// 0.18 lands close to native iOS picker feel in informal testing.
const FLICK_PROJECTION_S = 0.18

export default function WearWheel({
  value, onChange,
  step = 1, min = 0, max = 9999,
  ladder,
  unit, format,
  rowHeight = 40,
  visibleRowsEachSide = 2,
  centerSize = 22,
  neighbourSize = 18,
  fadeStrength = 0.95,
  fadeBackground,
  showCenterIndicator = false,
  style,
}: Props) {
  // ── Build the data array ──────────────────────────────────────────────
  const data = useMemo(() => {
    if (ladder && ladder.length > 0) return [...ladder]
    const arr: number[] = []
    for (let v = min; v <= max; v += step) arr.push(v)
    return arr
  }, [ladder, step, min, max])

  // ── Find current value's index ────────────────────────────────────────
  const indexOfValue = useCallback((v: number): number => {
    for (let i = 0; i < data.length; i++) if (data[i] === v) return i
    return 0
  }, [data])

  const currentIndex = useMemo(() => indexOfValue(value), [value, indexOfValue])

  // ── Shared values (UI thread) ─────────────────────────────────────────
  const scrollOffset       = useSharedValue(currentIndex * rowHeight)
  const dragStartOffset    = useSharedValue(0)
  const lastEmittedIndex   = useSharedValue(currentIndex)
  const lastEmittedRef     = useRef<number>(value)

  // Sync upstream value → wheel position when value changes externally.
  useEffect(() => {
    if (lastEmittedRef.current === value) return
    lastEmittedRef.current = value
    cancelAnimation(scrollOffset)
    scrollOffset.value = withSpring(currentIndex * rowHeight, {
      damping: 20, stiffness: 220, mass: 1,
    })
  }, [value, currentIndex, rowHeight, scrollOffset])

  // ── JS-side handler called from worklet via runOnJS ───────────────────
  const emitValue = useCallback((idx: number) => {
    const safe = idx < 0 ? 0 : idx > data.length - 1 ? data.length - 1 : idx
    const next = data[safe]
    if (next !== value) {
      lastEmittedRef.current = next
      onChange(next)
    }
  }, [data, value, onChange])

  // ── Pan gesture ────────────────────────────────────────────────────────
  const pan = useMemo(() => {
    const ROW          = rowHeight
    const MAX_OFFSET   = (data.length - 1) * ROW

    return Gesture.Pan()
      .activeOffsetY([-3, 3])
      .failOffsetX([-30, 30])
      .onBegin(() => {
        'worklet'
        cancelAnimation(scrollOffset)
        dragStartOffset.value = scrollOffset.value
      })
      .onUpdate((e) => {
        'worklet'
        // Drag DOWN visually moves smaller numbers down (and the centre
        // value increases) — match iOS picker by INVERTING translationY.
        let next = dragStartOffset.value - e.translationY
        // Soft rubber-band at edges.
        if (next < 0)            next = next * 0.4
        if (next > MAX_OFFSET)   next = MAX_OFFSET + (next - MAX_OFFSET) * 0.4
        scrollOffset.value = next

        // Live emit so consumers (and any JS-side display) update as the
        // user scrolls — gated to fire only when the centred row changes.
        let snap = Math.round(next / ROW)
        if (snap < 0)                  snap = 0
        if (snap > data.length - 1)    snap = data.length - 1
        if (snap !== lastEmittedIndex.value) {
          lastEmittedIndex.value = snap
          runOnJS(emitValue)(snap)
        }
      })
      .onEnd((e) => {
        'worklet'
        // Project where the wheel would naturally land based on release
        // velocity (treats velocity as if it should carry for
        // FLICK_PROJECTION_S seconds), then snap to nearest row centre.
        // Using a SINGLE withSpring (seeded with release velocity)
        // produces a smooth one-stage settle — no decay→spring handoff.
        const projected = scrollOffset.value - e.velocityY * FLICK_PROJECTION_S
        let snapped = Math.round(projected / ROW) * ROW
        if (snapped < 0)          snapped = 0
        if (snapped > MAX_OFFSET) snapped = MAX_OFFSET

        // Critically-damped, stiff spring → settles in ~150ms with no
        // overshoot. Seeded with release velocity so a fast flick still
        // feels like one continuous motion. Higher stiffness (was 140)
        // means the wheel reaches the snap target quickly — eliminates
        // the "half-second catch-up" feel where the bold styling seems
        // to be lagging the wheel during the post-release settle.
        scrollOffset.value = withSpring(snapped, {
          velocity: -e.velocityY,
          damping: 30,
          stiffness: 280,
          mass: 0.7,
          overshootClamping: true,
        })

        const finalIdx = snapped / ROW
        if (finalIdx !== lastEmittedIndex.value) {
          lastEmittedIndex.value = finalIdx
          runOnJS(emitValue)(finalIdx)
        }
      })
      .onFinalize(() => {
        'worklet'
        // Defensive snap if onEnd didn't fire (parent claimed the gesture).
        let snapped = Math.round(scrollOffset.value / ROW) * ROW
        if (snapped < 0)          snapped = 0
        if (snapped > MAX_OFFSET) snapped = MAX_OFFSET
        scrollOffset.value = withSpring(snapped, {
          damping: 22, stiffness: 180,
        })
      })
  }, [data, rowHeight, scrollOffset, dragStartOffset, lastEmittedIndex, emitValue])

  // ── Animated style — translates the entire row column ─────────────────
  const colAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollOffset.value }],
  }))

  // ── Layout maths ──────────────────────────────────────────────────────
  const totalHeight    = rowHeight * (1 + 2 * visibleRowsEachSide)
  const fadeZoneHeight = rowHeight * visibleRowsEachSide

  const fmt = (v: number) => (format ? format(v) : `${v}`)
  const bg  = fadeBackground ?? colors.background

  // Pre-compute the centre-emphasis scale factor — applied as a transform
  // so font size doesn't actually animate (which would be janky).
  const centerScale = centerSize / neighbourSize

  return (
    <GestureDetector gesture={pan}>
      <View style={[s.container, { height: totalHeight, width: '100%' }, style]}>
        <Animated.View style={[{ paddingTop: fadeZoneHeight }, colAnimStyle]}>
          {data.map((item, idx) => (
            <WheelRow
              key={item}
              idx={idx}
              text={`${fmt(item)}${unit ? ' ' + unit : ''}`}
              scrollOffset={scrollOffset}
              rowHeight={rowHeight}
              centerScale={centerScale}
              neighbourSize={neighbourSize}
            />
          ))}
        </Animated.View>

        {/* ── Top fade ──────────────────────────────────────────────── */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: fadeZoneHeight }}
        >
          {Array.from({ length: FADE_STEPS }).map((_, i) => {
            const stripHeight = fadeZoneHeight / FADE_STEPS
            const distFromCenter = (FADE_STEPS - i) / FADE_STEPS
            const opacity = distFromCenter * fadeStrength
            return (
              <View
                key={`top-${i}`}
                style={{
                  position: 'absolute',
                  top: i * stripHeight,
                  left: 0, right: 0,
                  height: stripHeight + 0.5,
                  backgroundColor: bg,
                  opacity,
                }}
              />
            )
          })}
        </View>

        {/* ── Bottom fade ────────────────────────────────────────────── */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: fadeZoneHeight }}
        >
          {Array.from({ length: FADE_STEPS }).map((_, i) => {
            const stripHeight = fadeZoneHeight / FADE_STEPS
            const distFromCenter = (i + 1) / FADE_STEPS
            const opacity = distFromCenter * fadeStrength
            return (
              <View
                key={`bot-${i}`}
                style={{
                  position: 'absolute',
                  top: i * stripHeight,
                  left: 0, right: 0,
                  height: stripHeight + 0.5,
                  backgroundColor: bg,
                  opacity,
                }}
              />
            )
          })}
        </View>

        {showCenterIndicator && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: fadeZoneHeight,
              left: 0, right: 0,
              height: rowHeight,
              borderTopWidth: 1, borderBottomWidth: 1,
              borderColor: colors.border,
            }}
          />
        )}
      </View>
    </GestureDetector>
  )
}

// ── Row sub-component ────────────────────────────────────────────────────
// Each row computes its own emphasis (scale + opacity + colour) on the UI
// thread directly from `scrollOffset`. Zero JS-thread roundtrip — the
// centred-row styling tracks the wheel position frame-perfect even
// during fast flicks.
// How tight the bold→non-bold transition is. Smaller = faster handoff.
// 0.10 means: the transition completes in 10% of a rowHeight (~4 px).
// Combined with the way two adjacent rows hand off the centre, this
// makes the bold "follow" the scroll position frame-perfect — by the
// time the user's eye registers the row crossing the centre line, the
// transition is already done. Larger fractions (e.g. 0.5) made the
// emphasis "trail" the scroll because the visual transition was
// physically slower than the scroll itself at fast flick speeds.
const HANDOFF_FRACTION = 0.10

function WheelRow({
  idx, text, scrollOffset, rowHeight, centerScale, neighbourSize,
}: {
  idx: number
  text: string
  scrollOffset: SharedValue<number>
  rowHeight: number
  centerScale: number
  neighbourSize: number
}) {
  // Continuous interpolation, but completed in a tight window around the
  // centre line (HANDOFF_FRACTION × rowHeight). This makes the bold/large
  // emphasis hand off between adjacent rows quickly enough that it tracks
  // the scroll speed visually — no perceived lag during fast flicks.
  const animStyle = useAnimatedStyle(() => {
    const distAbs = scrollOffset.value - idx * rowHeight
    const dist    = distAbs < 0 ? -distAbs : distAbs
    // Distance is normalised to the handoff window, NOT a full rowHeight.
    const tRaw    = dist / (rowHeight * HANDOFF_FRACTION)
    const t       = tRaw > 1 ? 1 : tRaw
    const scale   = centerScale + (1 - centerScale) * t
    const opacity = 1 - 0.4 * t
    return {
      transform: [{ scale }],
      opacity,
    }
  })

  return (
    <View style={{ height: rowHeight, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={animStyle}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontSize: neighbourSize,
            fontWeight: '600',
            fontVariant: ['tabular-nums'],
          }}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { overflow: 'hidden' },
})
