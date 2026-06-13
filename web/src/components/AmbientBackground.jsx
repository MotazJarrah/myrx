/**
 * AmbientBackground — the ONE ambient backdrop for public pages
 * (T248/T249/T251/T254).
 *
 * Two lime brand glows, viewport-anchored (fixed) so they render the exact
 * same on every page regardless of height or scroll. Used by PageShell (every
 * public page). Render inside any page root; content sits in a `relative z-10`
 * layer above it.
 *
 * T254: the grid was removed (user: "take out the grid lines from everywhere")
 * and the glows were toned down a notch (user: "the ambient is very strong").
 * Off-brand blue was already gone (T249); fixed positioning fixed the
 * per-page-height inconsistency (T251).
 */
export default function AmbientBackground() {
  return (
    <>
      {/* Top-left lime glow — sits behind the wordmark. */}
      <div
        className="pointer-events-none fixed -left-40 -top-40 h-[500px] w-[500px] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.26), transparent 70%)' }}
        aria-hidden
      />
      {/* Top-right lime glow — balances the composition. */}
      <div
        className="pointer-events-none fixed -right-40 -top-24 h-[500px] w-[500px] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.16), transparent 70%)' }}
        aria-hidden
      />
    </>
  )
}
