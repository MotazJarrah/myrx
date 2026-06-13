/**
 * AmbientBackground — the ONE ambient backdrop for public pages (T248).
 *
 * Subtle grid + a single lime brand glow (Option 2: "ambient everywhere").
 * The off-brand blue glow that the athlete landing + invite page carried is
 * gone — the brand color is lime. Used by PageShell (the simple pages) and
 * directly by the complex marketing pages that keep their own outer markup,
 * so the backdrop is byte-identical everywhere either way.
 *
 * Render as the FIRST child of a `relative overflow-hidden` parent, with the
 * real content in a `relative z-10` layer above it.
 */
export default function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />
    </>
  )
}
