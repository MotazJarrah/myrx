import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { supabase } from './lib/supabase.js'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  // One-time cleanup for users who installed sw.js v3 BEFORE we removed
  // clients.claim() — the old SW is still registered with the
  // claim-on-activate behavior, and until it's purged it will keep
  // evicting bfcache. Forcing the registration to update on page load
  // triggers the install + activate of the new v4 SW which no longer
  // claim()s. Safe to leave in indefinitely; subsequent calls are
  // cheap (the browser short-circuits when no update is available).
  navigator.serviceWorker.getRegistration('/sw.js').then(reg => {
    if (reg) reg.update().catch(() => {})
  }).catch(() => {})
}

// ── Supabase realtime WebSocket — bfcache compatibility shim ──────────────
// On Chrome 148 and earlier (which is most installs as of May 2026 since
// Chrome 149 just launched), an open WebSocket is a hard bfcache blocker
// (notRestoredReasons emits `websocket`). MyRX uses Supabase realtime
// channels for chat + suggestions, which keep a persistent WebSocket open.
//
// Fix: cleanly disconnect the realtime socket when the page is about to
// enter bfcache, and reconnect when it's restored. The channels stay
// registered in JS — Supabase's client auto-resubscribes them after
// reconnect, so chat/suggestion realtime keeps working transparently.
//
// Chrome 149+ closes WebSockets automatically on bfcache entry, making
// this shim redundant on the newest Chrome — but the calls are no-ops
// on already-disconnected/already-connected sockets, so leaving it on
// is harmless and forward-compatible.
window.addEventListener('pagehide', () => {
  try { supabase.realtime.disconnect() } catch { /* no-op */ }
})

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    try { supabase.realtime.connect() } catch { /* no-op */ }
  }
})

// ── Page lifecycle diagnostic logger ──────────────────────────────────────
// Catches BOTH scenarios:
//   (1) bfcache restore on within-Chrome navigation (back/forward button)
//       → pageshow event with e.persisted = true
//   (2) Tab visibility changes from app-switching (Chrome ↔ Claude desktop)
//       → visibilitychange events; tab stays loaded the whole time
//
// Most app-switching scenarios do NOT trigger pageshow because the page
// never navigates away — only its visibility changes. We log every
// visibility change too, with the elapsed hidden duration, plus a
// session-load counter that proves whether or not the page actually
// reloaded between visits.
//
// Read the console after switching apps:
//   "[lifecycle] hidden"          — you switched AWAY
//   "[lifecycle] visible (idle Xs, load #N)" — you switched BACK
//     - N unchanged = no reload happened (good — tab just regained focus)
//     - N incremented = page actually reloaded (bad — bug we need to fix)

// Session-scoped load counter. Increments once per actual page load.
// sessionStorage persists across reload, NOT across tab close.
const SESSION_LOAD_KEY = 'myrx_session_load_count'
const loadCount = parseInt(sessionStorage.getItem(SESSION_LOAD_KEY) || '0', 10) + 1
sessionStorage.setItem(SESSION_LOAD_KEY, String(loadCount))

console.log(
  `%c[lifecycle] page loaded — load #${loadCount} (this session)`,
  'color: #3b82f6; font-weight: bold'
)
if (loadCount > 1) {
  console.log(
    `%c[lifecycle] ⚠ load count went up — the page actually reloaded since last visit`,
    'color: #f59e0b'
  )
}

let lastHiddenAt = null

document.addEventListener('visibilitychange', () => {
  const now = Date.now()
  if (document.visibilityState === 'hidden') {
    lastHiddenAt = now
    console.log('%c[lifecycle] hidden (switched away)', 'color: #6b7280')
  } else if (document.visibilityState === 'visible') {
    const idleMs = lastHiddenAt ? now - lastHiddenAt : 0
    const idleS = (idleMs / 1000).toFixed(1)
    const currentLoad = parseInt(sessionStorage.getItem(SESSION_LOAD_KEY) || '1', 10)
    if (currentLoad === loadCount) {
      console.log(
        `%c[lifecycle] ✓ visible again — idle ${idleS}s — load #${loadCount} (NO reload)`,
        'color: #10b981'
      )
    } else {
      console.log(
        `%c[lifecycle] ✗ visible again — idle ${idleS}s — load count ${loadCount} → ${currentLoad} (RELOADED)`,
        'color: #ef4444; font-weight: bold'
      )
    }
  }
})

// bfcache-specific logger (only fires on actual back/forward navigations
// within Chrome — won't fire on app-switching, but kept for completeness).
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    console.log('%c[bfcache] ✓ restored from cache (no reload)', 'color: #10b981; font-weight: bold')
    return
  }
  try {
    const nav = performance.getEntriesByType('navigation')[0]
    const navType = nav?.type
    const reasons = nav?.notRestoredReasons

    if (navType === 'back_forward' && reasons) {
      const flatten = (node, out = []) => {
        if (!node) return out
        if (node.reasons) for (const r of node.reasons) out.push(r.reason)
        if (node.children) for (const c of node.children) flatten(c, out)
        return out
      }
      const flat = flatten(reasons)
      console.log('%c[bfcache] ✗ blocked — reasons:', 'color: #ef4444; font-weight: bold', flat)
    } else if (navType === 'reload') {
      console.log('%c[bfcache] reload (user hit refresh)', 'color: #6b7280')
    }
  } catch { /* silent */ }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
