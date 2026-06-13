import { useTheme } from '../contexts/ThemeContext'

/**
 * Wordmark — the ONE MyRX wordmark. One canonical size, one source of truth.
 *
 * Why this exists (T246): the wordmark had drifted to four different sizes
 * across the site — 20px (Auth / AuthConfirm), 22px (Admin / Coach shells),
 * 28px (ForCoaches / Pricing / AcceptInvite / DownloadApp), and a responsive
 * 20→28px (Legal) — plus inconsistent `?v=` cache-busts and only some pages
 * theme-aware. That reads as "different looks," not one brand. Every page now
 * renders THIS component, so the size can never diverge again.
 *
 * Brand rules (CLAUDE.md): never render the brand name as JSX text — always
 * the image asset; the no-slogan variant on every surface EXCEPT the signup
 * welcome hero (which keeps its own larger slogan treatment — the one
 * deliberate exception, not chrome).
 *
 * Theme-aware: the dark asset is "Logo Clean White" (light text, for dark
 * surfaces); the light asset is dark text, for light surfaces. Picking by
 * theme keeps the wordmark legible in both modes (the old hardcoded-dark
 * usages went invisible on light surfaces).
 *
 * Sizing: ALWAYS 28px tall. Callers pass `className` for POSITIONING only
 * (margins / alignment) — never a height/`h-*` class. To change the brand
 * wordmark size, change WORDMARK_HEIGHT here, in one place, on purpose.
 */
export const WORDMARK_HEIGHT = 28 // px — the canonical brand wordmark height.

export default function Wordmark({ className = '', alt = 'MyRX' }) {
  const { theme } = useTheme()
  const src = theme === 'light' ? '/myrx-wordmark-light.png' : '/myrx-wordmark-dark.png'
  return (
    <img
      src={src}
      alt={alt}
      style={{ height: WORDMARK_HEIGHT, width: 'auto' }}
      className={`object-contain ${className}`.trim()}
    />
  )
}
