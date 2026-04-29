/**
 * TickerNumber — slot-machine digit animation.
 *
 * Each digit independently slides (alternating direction per position) and
 * performs a slot-machine inertia effect on arrival: the reel scrolls slightly
 * past the target digit before snapping back, mimicking the mechanical
 * overshoot of a physical slot drum.
 *
 * Uses the Web Animations API so the overshoot amount is a fixed fraction of
 * one digit height — not proportional to travel distance like CSS cubic-bezier.
 *
 * Usage:
 *   <TickerNumber value={42}              className="text-2xl font-bold" />
 *   <TickerNumber value="4:54/km"         className="font-mono text-amber-400" />
 *   <TickerNumber value={result.dailyTarget} className="text-6xl font-bold" />
 */

import { useEffect, useRef } from 'react'

const H        = 1.15  // em — digit cell height
const DURATION = 820   // ms — total animation duration (slower, more mechanical)
const OVERSHOOT_FRAC = 0.42  // fraction of one digit-height to overshoot by
const SNAP_OFFSET    = 0.80  // keyframe offset where overshoot is reached (0–1)

function TickerDigit({ digit, position }) {
  // Even positions scroll 0→9 (forward); odd positions scroll 9→0 (reverse).
  const forward   = position % 2 === 0
  const col       = forward ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
                             : [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  const d         = parseInt(digit, 10)
  const targetIdx = forward ? d : 9 - d

  const innerRef  = useRef(null)
  const prevIdx   = useRef(null) // last settled index (null = not yet mounted)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return

    const from = prevIdx.current ?? 0 // start from top of column on first run
    prevIdx.current = targetIdx

    // Cancel any in-flight WAAPI animation; lock the element at the start pos
    // so the new animation has a clean, known departure point.
    el.getAnimations().forEach(a => a.cancel())
    el.style.transform = `translateY(-${from * H}em)`

    if (from === targetIdx) return // already at target — no animation needed

    // Overshoot is always in the direction of travel, fixed at OVERSHOOT_FRAC
    // of one digit-height so a +1 move and a +7 move feel equally weighted.
    const dir      = targetIdx > from ? 1 : -1
    const overIdx  = targetIdx + dir * OVERSHOOT_FRAC

    // Two rAFs ensure the browser has committed the inline-style before we
    // queue the WAAPI animation (avoids the "starts at destination" glitch).
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        el.animate(
          [
            // Phase 1 — reel scrolls to slightly past the target (ease-out: decelerates in)
            {
              transform: `translateY(-${from * H}em)`,
              easing:    'ease-out',
              offset:    0,
            },
            // Phase 2 — reel is at overshoot position; now snap back (ease-out from here too)
            {
              transform: `translateY(-${overIdx * H}em)`,
              easing:    'ease-out',
              offset:    SNAP_OFFSET,
            },
            // Phase 3 — settled at target
            {
              transform: `translateY(-${targetIdx * H}em)`,
              offset:    1,
            },
          ],
          { duration: DURATION, fill: 'forwards' }
        )
      })
      return () => cancelAnimationFrame(raf2)
    })

    return () => cancelAnimationFrame(raf1)
  }, [targetIdx]) // re-runs whenever the resolved digit index changes

  return (
    <span
      style={{
        display:       'inline-block',
        overflow:      'hidden',
        height:        `${H}em`,
        verticalAlign: 'bottom',
      }}
    >
      <span
        ref={innerRef}
        style={{
          display:        'flex',
          flexDirection:  'column',
          willChange:     'transform',
          // Initial inline style — WAAPI fill:forwards takes over after first animation
          transform:      `translateY(0)`,
        }}
      >
        {col.map((n, i) => (
          <span
            key={i}
            style={{ display: 'block', height: `${H}em`, lineHeight: `${H}em` }}
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  )
}

export default function TickerNumber({ value, className = '' }) {
  const str = String(value ?? 0)
  let digitPos = 0

  return (
    <span
      className={`inline-flex items-baseline leading-none ${className}`}
      aria-label={str}
    >
      {[...str].map((ch, i) => {
        if (/\d/.test(ch)) {
          const pos = digitPos++
          return <TickerDigit key={i} digit={ch} position={pos} />
        }
        return (
          <span key={i} style={{ display: 'inline-block' }}>
            {ch}
          </span>
        )
      })}
    </span>
  )
}
