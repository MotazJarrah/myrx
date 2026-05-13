/**
 * PhantomWheel (web) — gesture-driven number picker, mirror of
 * MyRX-Mobile/src/components/PhantomWheel.tsx.
 *
 * Behaviour (1:1 with mobile):
 *   • Idle:  only the current value is visible. No wheel chrome.
 *   • Drag:  a halo of nearby values fades in above + below the centre.
 *            Velocity-aware — faster drag = bigger jumps per pixel.
 *   • Release: halo fades out, leaving only the new centre value.
 *
 * Two modes:
 *   • Uniform — pass `step` + `min` + `max` (e.g. reps 1–50).
 *   • Ladder  — pass `ladder` array (e.g. atlas-stone weights).
 *
 * Sizing:
 *   • Centre:  `centerSize` px (default 28).
 *   • ±1:      centerSize × 0.6   (60 % of centre).
 *   • ±2:      centerSize × 0.36  (60 % of ±1).
 *   • ±N:      centerSize × 0.6 ^ N
 *   • Spacing  derived from sizes so each row's centre sits at the outer
 *              edge of the previous row minus `OVERLAP_PX` (immediate
 *              neighbours tuck under the centre value).
 *
 * Web vs mobile differences:
 *   • Pointer events instead of `react-native-gesture-handler`'s Pan.
 *   • CSS `transition: opacity` for halo fade (vs Reanimated `withTiming`).
 *   • `requestAnimationFrame` not needed — pointermove fires plenty
 *     fast on modern browsers.
 *   • No haptics on web. Same accuracy and feel otherwise.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ── Gesture-tuning constants (must match mobile) ─────────────────────────
const PIXELS_PER_STEP_SLOW       = 12
const VELOCITY_RAMP_THRESHOLD    = 600
const VELOCITY_MAX_MULTIPLIER    = 5
const PAN_ACTIVATION_PX          = 3
const FADE_IN_MS                 = 140
const FADE_OUT_MS                = 220

// ── Visual constants (must match mobile) ────────────────────────────────
const SIZE_RATIO       = 0.6
const HALF_HEIGHT_FRAC = 0.6
const OVERLAP_PX       = 6

function findLadderIndex(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) return i
  }
  return -1
}

function getValueAtOffset(current, offset, ladder, step, min, max) {
  if (ladder && ladder.length > 0) {
    const idx = findLadderIndex(ladder, current)
    if (idx < 0) return null
    const ni = idx + offset
    if (ni < 0 || ni >= ladder.length) return null
    return ladder[ni]
  }
  const nv = current + offset * step
  if (nv < min || nv > max) return null
  return nv
}

export default function PhantomWheel({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  ladder,
  unit,
  format,
  centerSize = 28,
  haloRadius = 2,
  className = '',
  style,
}) {
  // ── Refs (fresh JS reads, no re-render trigger) ──────────────────────
  const valueRef    = useRef(value)
  const onChangeRef = useRef(onChange)
  const ladderRef   = useRef(ladder)
  useEffect(() => {
    valueRef.current    = value
    onChangeRef.current = onChange
    ladderRef.current   = ladder
  })

  // ── Drag state ────────────────────────────────────────────────────────
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startY: 0,
    startTimestamp: 0,
    lastY: 0,
    lastTimestamp: 0,
    startValue: 0,
    startIndex: 0,
    accumulatedSteps: 0,
    lastEmittedSteps: 0,
    activated: false,  // movement exceeded PAN_ACTIVATION_PX
  })
  const [haloVisible, setHaloVisible] = useState(false)

  const containerRef = useRef(null)

  // ── Pointer handlers ──────────────────────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    if (dragRef.current.active) return
    e.target.setPointerCapture?.(e.pointerId)
    dragRef.current.active = true
    dragRef.current.pointerId = e.pointerId
    dragRef.current.startY = e.clientY
    dragRef.current.startTimestamp = e.timeStamp
    dragRef.current.lastY = e.clientY
    dragRef.current.lastTimestamp = e.timeStamp
    dragRef.current.startValue = valueRef.current
    const lad = ladderRef.current
    if (lad && lad.length > 0) {
      const idx = findLadderIndex(lad, valueRef.current)
      dragRef.current.startIndex = idx >= 0 ? idx : 0
    } else {
      dragRef.current.startIndex = 0
    }
    dragRef.current.accumulatedSteps = 0
    dragRef.current.lastEmittedSteps = 0
    dragRef.current.activated = false
  }, [])

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current.active || e.pointerId !== dragRef.current.pointerId) return

    // Per-frame delta + velocity (px/sec).
    const dy = e.clientY - dragRef.current.lastY
    const dt = e.timeStamp - dragRef.current.lastTimestamp
    const velocity = dt > 0 ? (dy / dt) * 1000 : 0
    dragRef.current.lastY = e.clientY
    dragRef.current.lastTimestamp = e.timeStamp

    // Activation threshold — wait until the user has moved at least
    // PAN_ACTIVATION_PX before showing the halo or registering steps.
    const totalDy = Math.abs(e.clientY - dragRef.current.startY)
    if (!dragRef.current.activated && totalDy < PAN_ACTIVATION_PX) return
    if (!dragRef.current.activated) {
      dragRef.current.activated = true
      setHaloVisible(true)
    }

    // Velocity-aware step rate (matches mobile worklet logic exactly).
    const speed = Math.abs(velocity)
    const accel = speed <= VELOCITY_RAMP_THRESHOLD
      ? 1
      : Math.min(speed / VELOCITY_RAMP_THRESHOLD, VELOCITY_MAX_MULTIPLIER)
    const pixelsPerStep = PIXELS_PER_STEP_SLOW / accel

    // Drag DOWN visually = increase value (matches iOS picker / mobile).
    dragRef.current.accumulatedSteps += -dy / pixelsPerStep

    const stepsRounded = Math.round(dragRef.current.accumulatedSteps)
    if (stepsRounded === dragRef.current.lastEmittedSteps) return
    dragRef.current.lastEmittedSteps = stepsRounded

    let nextVal
    const lad = ladderRef.current
    if (lad && lad.length > 0) {
      let idx = dragRef.current.startIndex + stepsRounded
      if (idx < 0) idx = 0
      if (idx > lad.length - 1) idx = lad.length - 1
      nextVal = lad[idx]
    } else {
      let v = dragRef.current.startValue + stepsRounded * step
      if (v < min) v = min
      if (v > max) v = max
      nextVal = v
    }

    if (nextVal !== valueRef.current) {
      onChangeRef.current(nextVal)
    }
  }, [step, min, max])

  const handlePointerEnd = useCallback((e) => {
    if (!dragRef.current.active) return
    if (e && e.pointerId !== dragRef.current.pointerId) return
    dragRef.current.active = false
    dragRef.current.pointerId = null
    setHaloVisible(false)
  }, [])

  // ── Halo rows (the values immediately above + below the centre) ───────
  const haloRows = useMemo(() => {
    const rows = []
    for (let i = -haloRadius; i <= haloRadius; i++) {
      if (i === 0) continue
      const v = getValueAtOffset(value, i, ladder, step, min, max)
      if (v != null) rows.push({ offset: i, value: v })
    }
    return rows
  }, [value, ladder, step, min, max, haloRadius])

  // ── Helpers ──────────────────────────────────────────────────────────
  const fmt = useCallback((v) => (format ? format(v) : `${v}`), [format])
  const display = fmt(value) + (unit ? ` ${unit}` : '')

  const sizeAt  = (n) => centerSize * Math.pow(SIZE_RATIO, n)
  const halfHAt = (n) => sizeAt(n) * HALF_HEIGHT_FRAC

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center justify-center select-none ${className}`}
      style={{
        minHeight: 44,
        // Disable browser's default pan/zoom on this element so the
        // pointermove drag isn't interrupted by the page scrolling.
        touchAction: 'none',
        cursor: 'ns-resize',
        ...style,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {/* Halo — absolutely positioned, opacity-faded via CSS transition.
          Each row's centre is anchored at top:50% + translateY of the
          spacing accumulated walking outward from the centre. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: haloVisible ? 1 : 0,
          transition: `opacity ${haloVisible ? FADE_IN_MS : FADE_OUT_MS}ms ease-out`,
        }}
      >
        {haloRows.map(({ offset, value: v }) => {
          const absOffset = Math.abs(offset)
          const sign      = offset < 0 ? -1 : 1
          const fontSize  = sizeAt(absOffset)

          let spacing = 0
          for (let i = 1; i <= absOffset; i++) {
            spacing += halfHAt(i - 1) + halfHAt(i) - OVERLAP_PX
          }
          const offsetPx = sign * spacing
          const distFade = 1 - (absOffset - 1) / haloRadius * 0.75

          return (
            <div
              key={offset}
              className="absolute left-0 right-0 flex items-center justify-center text-muted-foreground font-medium tabular-nums"
              style={{
                top: '50%',
                height: fontSize,
                lineHeight: `${fontSize}px`,
                fontSize,
                transform: `translateY(${offsetPx - fontSize / 2}px)`,
                opacity: distFade,
              }}
            >
              {fmt(v)}{unit ? ` ${unit}` : ''}
            </div>
          )
        })}
      </div>

      {/* Centre text — paints above the halo via z-index so the immediate
          ±1 neighbours visibly tuck UNDER it via the OVERLAP_PX. */}
      <span
        className="text-foreground font-bold tabular-nums text-center whitespace-nowrap"
        style={{
          fontSize: centerSize,
          lineHeight: `${centerSize}px`,
          zIndex: 10,
          position: 'relative',
        }}
      >
        {display}
      </span>
    </div>
  )
}
