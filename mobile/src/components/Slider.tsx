/**
 * Slider — generic horizontal range input, RN replacement for `<input type="range">`.
 *
 * Built on react-native-gesture-handler (Pan + Tap) + reanimated for smooth drag.
 * No native module — keeps the dev client rebuild surface minimal.
 *
 * KEY DESIGN POINT — DO NOT REMOVE:
 *   The Pan/Tap gesture is created ONCE via `useMemo([])` and never recreated.
 *   All worklet inputs (width, min, max, step) live in shared values, and the
 *   onChange callback is read from a ref. This means parent re-renders during
 *   a drag (one per integer-step change of `value`) do NOT recreate the gesture
 *   instance — gesture-handler's native touch tracker stays continuous and the
 *   thumb tracks the finger 1:1 instead of stuttering on every commit.
 *
 *   Earlier versions of this component recreated the gesture on every render,
 *   which caused the thumb to lag/jitter even though x.value was a UI-thread
 *   shared value. The slider felt as choppy as the parent's render rate, not
 *   60fps. With the memoized gesture, the thumb is fully decoupled from JS.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated'
import { colors, palette, alpha } from '../theme'

const TRACK_HEIGHT = 4
const THUMB_SIZE   = 22

interface Props {
  value:    number
  min:      number
  max:      number
  step?:    number
  onChange: (v: number) => void
  /**
   * Optional UI-thread mirror of the current slider position. When provided,
   * the pan worklet writes the LIVE (per-frame) stepped value to it on every
   * gesture tick. Consumers can then drive other animated views from this
   * shared value via `useDerivedValue` / `useAnimatedProps` — e.g. the ROM
   * mannequin's joint rotations — without going through React state and
   * triggering paint storms.
   */
  liveValue?: SharedValue<number>
  /** Optional inline tick marker (e.g. clinical-vs-athletic boundary). */
  markerValue?: number
  markerColor?: string
  thumbColor?:  string
  fillColor?:   string
  trackColor?:  string
}

export default function Slider({
  value, min, max, step = 1, onChange, liveValue,
  markerValue, markerColor,
  thumbColor = palette.fuchsia[500],
  fillColor  = palette.fuchsia[500],
  trackColor,
}: Props) {
  const [width, setWidth] = useState(0)
  const x = useSharedValue(0)

  // ── Worklet inputs as shared values (always current, no closure capture) ──
  // The worklet inside the memoized gesture reads from these instead of from
  // React state/props, so the gesture instance never needs to be recreated.
  const widthSV = useSharedValue(0)
  const minSV   = useSharedValue(min)
  const maxSV   = useSharedValue(max)
  const stepSV  = useSharedValue(step)

  useEffect(() => { minSV.value = min   }, [min])
  useEffect(() => { maxSV.value = max   }, [max])
  useEffect(() => { stepSV.value = step }, [step])

  // ── onChange via ref so the stable callback always sees the latest fn ─────
  const onChangeRef    = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Tracks the integer value we last emitted via onChange. When the prop
  // re-renders with the same number, the useEffect below SKIPS resnapping
  // x.value — otherwise the thumb would jerk away from the finger as the
  // parent's value sync chases its own echo.
  const lastEmittedRef = useRef<number | null>(null)
  // Tracks the last stepped value we emitted during a drag, so we only fire
  // onChange (and trigger a parent re-render) when the integer actually
  // changes — not on every sub-step pixel.
  const lastStepRef    = useRef<number>(value)
  // Set to true between gesture-start and gesture-end. The value-sync
  // useEffect uses this to skip resnapping x.value during a live drag
  // (the worklet already owns x.value; resnapping from a stale prop
  // would fight the finger). External prop changes that arrive
  // outside a drag still resnap normally.
  const isDraggingRef  = useRef(false)
  const setDragging    = useCallback((v: boolean) => { isDraggingRef.current = v }, [])

  // Stable JS-thread callback the worklet calls via runOnJS. Dedupes by
  // stepped int and tags the emission so the prop-sync useEffect ignores the
  // echo (see lastEmittedRef).
  const callOnChange = useCallback((stepped: number) => {
    if (stepped === lastStepRef.current) return
    lastStepRef.current = stepped
    lastEmittedRef.current = stepped
    onChangeRef.current(stepped)
  }, [])

  // ── External value sync — only when:
  //   1. width first becomes known, OR
  //   2. the prop changes from a source OTHER than our own emit AND
  //      the user isn't currently dragging.
  //
  // The isDraggingRef guard is the fix for the slow-thumb bug: during
  // a drag, the worklet writes x.value on every gesture tick AND fires
  // onChange via runOnJS. The parent re-renders with the new value,
  // and this effect would then re-run and snap x.value back to the
  // position computed from the (already-emitted) value — fighting the
  // worklet that's about to advance again on the next tick. Net
  // result: the thumb crawls behind the finger. Skipping the snap
  // while dragging lets the worklet own x.value alone for the
  // duration of the gesture; the final onEnd commit + the next
  // external prop change resync after the user lifts. ────────────────
  useEffect(() => {
    if (width <= 0) return
    if (isDraggingRef.current) return
    if (lastEmittedRef.current === value) {
      lastEmittedRef.current = null
      return
    }
    x.value = ((value - min) / (max - min)) * width
    lastStepRef.current = value
    // Keep the live shared value (if subscribed) in sync with the external
    // prop change so consumer animated views jump to the new value too.
    if (liveValue) liveValue.value = value
  }, [value, min, max, width])

  // ── Gesture: created ONCE, never recreated ────────────────────────────────
  // PAN strategy: during the drag we ONLY update x.value (UI thread). We
  // don't fire onChange — that would trigger React state updates and SVG
  // repaints that compete for paint cycles on the emulator. The committed
  // integer is reported once, on gesture END. The thumb position itself
  // stays in perfect sync with the finger because it's a pure UI-thread
  // animated transform reading x.value.
  //
  // TAP strategy: a stationary tap commits immediately (matches web behaviour
  // where clicking the track jumps + commits in one motion).
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-2, 2])
      .onBegin(() => {
        'worklet'
        // Flip the JS-thread isDraggingRef on so the value-sync
        // useEffect stops fighting the worklet's x.value writes.
        runOnJS(setDragging)(true)
      })
      .onFinalize(() => {
        'worklet'
        // Drag ended (onEnd fired OR gesture was cancelled / failed).
        // Clear the flag so future external prop changes resync.
        runOnJS(setDragging)(false)
      })
      .onChange(e => {
        'worklet'
        const w = widthSV.value
        if (w <= 0) return
        const next = Math.max(0, Math.min(w, x.value + e.changeX))
        x.value = next
        // Fire onChange LIVE during drag so the parent's display number
        // updates in real time as the user slides — matches web's
        // <input type="range"> behavior. The callOnChange callback
        // dedupes by stepped int (see lastStepRef) so we only trigger
        // a parent re-render when the integer actually changes, not on
        // every sub-step pixel.
        //
        // Earlier versions deferred this to gesture-end to avoid
        // SVG repaint storms in the ROM editor on the emulator.
        // For the signup screens (simple number display, no SVG) the
        // live commit is the right behavior — and ROM editor still
        // commits on end via ROMVisualizer's own gesture handlers.
        const raw     = (next / w) * (maxSV.value - minSV.value) + minSV.value
        const stepped = Math.max(
          minSV.value,
          Math.min(maxSV.value, Math.round(raw / stepSV.value) * stepSV.value),
        )
        if (liveValue) liveValue.value = stepped
        runOnJS(callOnChange)(stepped)
      })
      // Final commit on gesture end — guarantees the JS state reflects
      // exactly where the thumb landed, even if the last onChange tick
      // was deduped (parent already at that value).
      .onEnd(() => {
        'worklet'
        const w = widthSV.value
        if (w <= 0) return
        const raw     = (x.value / w) * (maxSV.value - minSV.value) + minSV.value
        const stepped = Math.max(
          minSV.value,
          Math.min(maxSV.value, Math.round(raw / stepSV.value) * stepSV.value),
        )
        runOnJS(callOnChange)(stepped)
      })

    const tap = Gesture.Tap()
      .onEnd(e => {
        'worklet'
        const w = widthSV.value
        if (w <= 0) return
        const next = Math.max(0, Math.min(w, e.x))
        x.value = next
        const raw     = (next / w) * (maxSV.value - minSV.value) + minSV.value
        const stepped = Math.max(
          minSV.value,
          Math.min(maxSV.value, Math.round(raw / stepSV.value) * stepSV.value),
        )
        if (liveValue) liveValue.value = stepped
        runOnJS(callOnChange)(stepped)
      })

    return Gesture.Race(tap, pan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Animated styles (UI thread) ───────────────────────────────────────────
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - THUMB_SIZE / 2 }],
  }))
  const fillStyle = useAnimatedStyle(() => ({
    width: x.value,
  }))

  const markerLeft = markerValue != null && width > 0
    ? ((markerValue - min) / (max - min)) * width
    : null

  // onLayout sets BOTH the React state (for marker px math) AND the shared
  // value (so the worklet sees the new width). Fires once on mount.
  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setWidth(w)
    widthSV.value = w
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={s.touch} onLayout={handleLayout}>
        <View style={[s.track, { backgroundColor: trackColor ?? alpha(colors.border, 1) }]} />
        <Animated.View style={[s.fill, { backgroundColor: fillColor }, fillStyle]} />
        {markerLeft != null && (
          <View
            pointerEvents="none"
            style={[
              s.marker,
              { left: markerLeft, backgroundColor: markerColor ?? palette.amber[400] },
            ]}
          />
        )}
        <Animated.View style={[s.thumb, { backgroundColor: thumbColor }, thumbStyle]} />
      </View>
    </GestureDetector>
  )
}

const s = StyleSheet.create({
  touch: {
    height: THUMB_SIZE,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  marker: {
    position: 'absolute',
    top: (THUMB_SIZE - 14) / 2,
    width: 2,
    height: 14,
    borderRadius: 1,
    opacity: 0.6,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    // No elevation / shadow* on purpose — they trigger a shadow repaint
    // every frame the thumb moves, which on Android emulators with software
    // rendering can drop the frame rate below 60fps and make the thumb
    // visibly chase the finger. Add back only if a real device shows it's
    // not a problem there.
  },
})
