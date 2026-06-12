/**
 * useIsPhone — true only when the device is genuinely a phone:
 *   (a) viewport narrower than the Tailwind `md` breakpoint (768 px), AND
 *   (b) primary pointer is "coarse" (i.e. touch, not mouse/trackpad).
 *
 * Use this for routing gates that want to bounce phone users to the
 * client app (because the admin / coach portals are dense, multi-column
 * dashboards that don't make sense on a 360 px screen).
 *
 * DO NOT use `useIsDesktop()` for those gates — that's pure viewport
 * width, which flips false the moment a desktop user opens DevTools
 * (DevTools panel narrows the available viewport). Symptom: the user
 * is on /portal, opens DevTools to inspect something, and gets
 * silently redirected to /dashboard. Closing DevTools doesn't reverse
 * it because /dashboard has no gate. Locked May 27 2026 after exactly
 * that bug bit a coach during invite testing.
 *
 * `useIsDesktop()` is still the right hook for COMPONENT-level
 * responsive layout decisions (e.g., switching from 3-column to 1-column
 * card grid). Just not for ROUTE-level redirects, because route changes
 * are destructive (lose state, scroll position, modal stacks).
 */

import { useEffect, useState } from 'react'

const PHONE_QUERY = '(max-width: 767px) and (pointer: coarse)'

function read() {
  if (typeof window === 'undefined') return false   // SSR-safe default
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE_QUERY).matches
}

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(PHONE_QUERY)
    function onChange(e) { setIsPhone(e.matches) }
    // Modern API; fall back to deprecated addListener for old Safari.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else                       mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else                          mql.removeListener(onChange)
    }
  }, [])

  return isPhone
}
