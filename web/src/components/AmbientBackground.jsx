/**
 * AmbientBackground — the ONE ambient backdrop for public pages (T248/T249/T251).
 *
 * A subtle grid + two lime brand glows (Option 2: "ambient everywhere").
 * Used by PageShell (every public page) + the signup journey + /welcome,
 * so the backdrop is identical site-wide.
 *
 * T251 — VIEWPORT-ANCHORED (fixed), not page-anchored (absolute). The earlier
 * `absolute inset-0` version sized to the whole SCROLLABLE page, so:
 *   • the grid's radial mask centered on the middle of the full page height —
 *     on a long marketing page that visible band sat far below the fold, so
 *     the top looked faint, while a short page (sign-in) showed it crisply;
 *   • the glows used `top-[-20%]` / `top-[10%]` — percentages of the full page
 *     height, so they drifted down-page on tall pages.
 * That made the "same" ambient look different per page. `fixed` pins all of
 * it to the viewport, so every page renders the exact same ambient regardless
 * of height or scroll position. (overflow-hidden on the parent does NOT clip
 * fixed descendants — their containing block is the viewport.)
 *
 * Render inside any page root; content sits in a `relative z-10` layer above.
 */
export default function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 ambient-grid opacity-60" aria-hidden />
      {/* Top-left glow — sits behind the wordmark. Fixed to the viewport. */}
      <div
        className="pointer-events-none fixed -left-40 -top-40 h-[500px] w-[500px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)' }}
        aria-hidden
      />
      {/* Top-right glow — balances the composition (lime, not the old blue). */}
      <div
        className="pointer-events-none fixed -right-40 -top-24 h-[500px] w-[500px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.22), transparent 70%)' }}
        aria-hidden
      />
    </>
  )
}
