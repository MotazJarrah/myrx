/**
 * usePersistedState — useState that mirrors its value to localStorage.
 *
 * Drop-in replacement for `useState(initial)` when you want the value to
 * survive specific kinds of page lifecycle events but reset on others.
 *
 * The interesting case is the settings-tab use: the user expects the
 * active tab to survive an accidental reload (browser ↔ desktop app
 * switch evicts bfcache → full reload) but to RESET on sign-out or
 * navigation away from settings. This hook handles that asymmetry by
 * tying "should reset" to React's unmount lifecycle.
 *
 * The clearOnUnmount flag works because:
 *   • Explicit React Router nav (away from /profile, etc.) →
 *     React unmounts the component → cleanup fires → localStorage
 *     cleared → next visit loads the initial value. ✓ reset case.
 *   • Sign-out → window.location.replace('/auth') → page navigates →
 *     React unmounts → cleanup fires → cleared. ✓ reset case.
 *   • Bfcache evict-and-restore (browser ↔ desktop app) → the page is
 *     terminated and re-initialized, never giving React a chance to
 *     run cleanup. localStorage still has the previous value, so the
 *     next mount restores it. ✓ preserve case.
 *
 * Usage:
 *   const [tab, setTab] = usePersistedState('myrx:coach_profile_tab', 'profile', { clearOnUnmount: true })
 *
 * Notes:
 *   • Keys are namespaced by the caller. Prefer `myrx:<surface>_<scope>`.
 *   • Only string values are stored cleanly. JSON.stringify other types.
 *   • Reads localStorage exactly once on mount. Silent fallback to
 *     memory-only state when localStorage isn't writable (private
 *     browsing quota errors, etc.).
 *   • SSR-safe: `window` is checked before access.
 */

import { useEffect, useState } from 'react'

function read(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

export function usePersistedState(key, initialValue, { clearOnUnmount = false } = {}) {
  const [value, setValue] = useState(() => read(key, initialValue))

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(key, value) } catch { /* quota / private mode — silent */ }
  }, [key, value])

  useEffect(() => {
    if (!clearOnUnmount) return
    return () => {
      // Fires on real React unmount only — NOT on bfcache evict-and-restore
      // (which terminates the page abruptly). That asymmetry is exactly
      // what gives us "survive reload, reset on nav-away" behaviour.
      try { localStorage.removeItem(key) } catch { /* silent */ }
    }
  }, [key, clearOnUnmount])

  return [value, setValue]
}
