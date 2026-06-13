/**
 * AmbientBackground — the ONE ambient backdrop for public pages (T248/T249).
 *
 * A subtle grid + two lime brand glows (Option 2: "ambient everywhere").
 * The off-brand blue glow the athlete landing + invite page used to carry
 * is gone — both glows are lime now. Used by PageShell (every public page),
 * so the backdrop is identical site-wide.
 *
 * T249: the first cut was too faint (grid opacity-50, a single centered
 * glow at hsl(primary/0.2)), and the glow sat in the page center — so there
 * was no hue behind the logo and it read as "the ambient got removed." This
 * restores the visible composition the athlete landing originally had: a
 * brighter grid + a strong glow in the top-LEFT (behind the wordmark) + a
 * balancing glow top-right. Clearly present on every page.
 *
 * Render as the FIRST child of a `relative overflow-hidden` parent, with the
 * real content in a `relative z-10` layer above it.
 */
export default function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-60" aria-hidden />
      {/* Top-left glow — sits behind the wordmark. */}
      <div
        className="pointer-events-none absolute -left-40 top-[-20%] h-[500px] w-[500px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)' }}
        aria-hidden
      />
      {/* Top-right glow — balances the composition (lime, not the old blue). */}
      <div
        className="pointer-events-none absolute -right-40 top-[10%] h-[500px] w-[500px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.22), transparent 70%)' }}
        aria-hidden
      />
    </>
  )
}
