/**
 * useIsDesktop — true when the viewport is at the Tailwind `md` breakpoint
 * or wider (>= 768 px). Reactively updates on resize.
 *
 * Used by the protected route layouts to switch coach/admin users into the
 * client app when they open the site on a phone:
 *
 *   • Desktop: coach → /portal, admin → /admin/overview
 *   • Mobile : same coach/admin → /dashboard (the regular client app)
 *
 * Rationale: the admin and coach portals are dense, multi-column dashboards
 * that don't make sense on a 360 px-wide screen. A coach who pulls out
 * their phone is almost always there to log their OWN training (i.e. use
 * the client app), not to manage their roster. The portal surfaces stay
 * desktop-only by design (per CLAUDE.md Lock 7 / coach platform spec).
 *
 * Server-side: the user's profile flags (is_coach, is_superuser) are
 * unchanged. This hook only affects which UI shell renders. Manual
 * navigation to /portal or /admin/* from mobile still hits the
 * protected layout's mobile-redirect to /dashboard.
 */

import { useEffect, useState } from 'react'

const MD_BREAKPOINT = 768

function read() {
  if (typeof window === 'undefined') return true   // SSR-safe default
  return window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(read)

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    function onChange(e) { setIsDesktop(e.matches) }
    // Modern API; falls back to deprecated addListener for old Safari.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else                       mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else                          mql.removeListener(onChange)
    }
  }, [])

  return isDesktop
}
