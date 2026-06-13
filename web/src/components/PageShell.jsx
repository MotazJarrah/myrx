import AmbientBackground from './AmbientBackground'
import PublicFooter from './PublicFooter'

/**
 * PageShell — the ONE page frame for every public-facing page (T248).
 *
 * User directive (June 12 2026): "every page needs to look the same across
 * all the website, the elements inside the page doesn't matter, the layout
 * needs to be the same across all." So the FRAME — background + (the page's
 * own) header sitting on it + the shared footer — is identical everywhere;
 * only the content inside differs. This is the chrome equivalent of the
 * Wordmark component: one source of truth so the frame can't drift again.
 *
 * What it provides:
 *   • the root surface (relative, min-h-dvh, overflow-hidden, bg-background)
 *   • the shared AMBIENT background — subtle grid + lime brand glow (Option 2,
 *     "ambient everywhere"; the off-brand blue glow some pages had is gone)
 *   • a z-10 content layer so the page's header + main always sit ABOVE the
 *     absolute ambient (the layering the flat pages were missing)
 *   • the shared PublicFooter
 *
 * Pages render their OWN <header> + <main> as children — same header bar
 * spec everywhere (h-16, items-center, px-6 md:px-10, border-b border-border/40,
 * wordmark left) — and PageShell wraps them in the identical frame.
 */
export default function PageShell({ children }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Shared ambient — same grid + lime glow on every page. */}
      <AmbientBackground />
      {/* Content layer — header + main live here, always above the ambient. */}
      <div className="relative z-10 flex flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  )
}
