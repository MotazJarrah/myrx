/**
 * useScrollDrift — gives a `position: sticky` element a lerped "catch-up"
 * feel when the page scrolls. Instead of the element snapping to its
 * pinned position the instant sticky engages, it briefly drifts in the
 * direction of scroll and then eases back to the pinned position over
 * the next few frames. Reads as a subtle inertial follow.
 *
 * Mechanics:
 *   - We do NOT replace sticky. CSS position: sticky handles layout +
 *     scroll-tracking; we just add a transient `transform: translateY(N)`
 *     on top so the element looks like it's lagging.
 *   - Each scroll event adds the scroll delta to an internal `offset`
 *     value (capped to ±maxLag so very fast scrolls don't fling the
 *     element off-screen).
 *   - A requestAnimationFrame loop multiplies `offset` by (1 - factor)
 *     every frame until it falls below 0.5 px, then resets to 0 and
 *     stops the loop. Higher factor = quicker settle; lower factor =
 *     more inertia.
 *   - Idle when no scroll is happening — no perpetual rAF tax.
 *
 * Usage:
 *   const ref = useRef(null)
 *   useScrollDrift(ref)              // defaults: factor 0.18, maxLag 60
 *   useScrollDrift(ref, { factor: 0.12, maxLag: 80 })  // softer feel
 *   return <div ref={ref} className="lg:sticky lg:top-4">…</div>
 *
 * Respects prefers-reduced-motion — the hook is a no-op for users who
 * have requested reduced animation in their OS settings.
 */
import { useEffect } from 'react'

export function useScrollDrift(ref, opts = {}) {
  const { factor = 0.18, maxLag = 60 } = opts

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Respect users who opted out of motion at the OS level.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let offset = 0
    let lastScrollY = window.scrollY
    let rafId = null

    function applyTransform() {
      if (!ref.current) return
      // Round to whole pixels so we don't trigger sub-pixel reflows.
      const px = Math.round(offset)
      ref.current.style.transform = px === 0 ? '' : `translate3d(0, ${px}px, 0)`
    }

    function tick() {
      offset *= (1 - factor)
      if (Math.abs(offset) < 0.5) {
        offset = 0
        applyTransform()
        rafId = null
        return
      }
      applyTransform()
      rafId = requestAnimationFrame(tick)
    }

    function onScroll() {
      const y = window.scrollY
      const delta = y - lastScrollY
      lastScrollY = y
      // Drift in the direction the content is moving — i.e. OPPOSITE
      // of scrollY delta. When the user scrolls DOWN (delta > 0), page
      // content moves UP, and the sticky element should briefly drag
      // UP with the content (negative translateY) before settling back
      // to its pinned position. The previous version added +delta which
      // pushed the element DOWN on scroll-down — visually inverted
      // because it looked like the element was being "pushed" by the
      // scroll instead of "trying to keep up" with it.
      offset = Math.max(-maxLag, Math.min(maxLag, offset - delta * 0.5))
      if (rafId == null) rafId = requestAnimationFrame(tick)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId != null) cancelAnimationFrame(rafId)
      if (ref.current) ref.current.style.transform = ''
    }
  }, [factor, maxLag, ref])
}
