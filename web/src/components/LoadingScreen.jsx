/**
 * LoadingScreen — brand logo with a neon-lime pulsing glow.
 *
 * Used everywhere the app shows a loading state:
 *   – Cold start (no shell rendered yet) → `<LoadingScreen fullscreen />`
 *     overlays the entire viewport with `fixed inset-0` so it covers any
 *     unstyled root content while React hydrates.
 *   – In-page (inside AppShell, Suspense fallback, page data fetch) →
 *     `<LoadingScreen />` (default) renders inline at `min-h-[40vh]` so
 *     the navbar stays visible and the loader fits the page area.
 *
 * Animation lives entirely in CSS (`@keyframes neon-pulse` in `src/index.css`)
 * — the `drop-shadow` filter pulses through low → bright → low opacity,
 * following the alpha mask of the logo so the glow hugs its silhouette.
 *
 * Theme-aware: uses `myrx-wordmark-dark.png` (no slogan) in dark mode,
 * `myrx-wordmark-light.png` in light. Slogan version is reserved for the
 * signup welcome screen as a one-shot brand intro.
 */

import { useTheme } from '../contexts/ThemeContext'

export default function LoadingScreen({ fullscreen = false }) {
  const { theme } = useTheme()
  const src = theme === 'dark' ? '/myrx-wordmark-dark.png' : '/myrx-wordmark-light.png'

  const cls = fullscreen
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-background'
    : 'flex min-h-[40vh] items-center justify-center w-full'

  return (
    <div className={cls}>
      <img
        src={src}
        alt="MyRX"
        className="h-16 w-auto object-contain animate-neon-pulse"
      />
    </div>
  )
}
