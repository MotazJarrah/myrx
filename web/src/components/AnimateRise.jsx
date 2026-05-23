/**
 * AnimateRise — staggered entrance cascade for detail pages.
 *
 * Mirror of mobile/src/components/AnimateRise.tsx. Locked spec
 * (Pattern 1 in CLAUDE.md):
 *
 *   - 500ms total
 *   - cubic-bezier(0.16, 1, 0.3, 1) easing
 *   - opacity 0 → 1 + translateY 8 → 0
 *   - delay (per-card) — 0 / 250 / 500 for the standard top-to-bottom
 *     detail-page cascade (main content / chart / log list)
 *
 * Wraps the existing `.animate-rise` CSS class from web/src/index.css
 * and just adds `animation-delay` inline. Pass `delay={0|250|500}` per
 * the locked detail-page convention. Defaults to 0.
 *
 * Usage:
 *   <AnimateRise>...</AnimateRise>
 *   <AnimateRise delay={250} className="rounded-2xl border">...</AnimateRise>
 */

export default function AnimateRise({
  delay = 0,
  className = '',
  children,
  ...rest
}) {
  return (
    <div
      className={`animate-rise ${className}`}
      style={{
        animationDelay: `${delay}ms`,
        // `both` is already in the .animate-rise base, but be explicit
        // so an inline `animation` override still gets fill-mode applied.
        animationFillMode: 'both',
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
