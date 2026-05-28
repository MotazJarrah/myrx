/**
 * Top-level error boundary.
 *
 * Catches any uncaught error thrown during render anywhere in the React
 * tree below it and renders a recovery UI instead of letting the tree
 * silently unmount (which is what produces the blank-screen dead ends).
 *
 * Why this is the universal fix for the recurring blank-page pattern:
 *
 *   1. **Lazy-chunk load failures after a deploy.** Cloudflare ships
 *      new bundles with hashed filenames. The previously-loaded
 *      index.html in the user's tab is allowed (and frequently does)
 *      reference chunk hashes that no longer exist on the CDN. When
 *      the user navigates and React `lazy()` tries to import that
 *      gone-missing chunk, the dynamic import rejects with a
 *      `ChunkLoadError`. Without a boundary, the Suspense reject
 *      propagates up and unmounts everything → blank screen until
 *      hard-refresh. This boundary catches that specific error class
 *      and force-reloads the page, which re-fetches index.html and
 *      gets the fresh chunk references.
 *
 *   2. **Render errors from stale state.** When a route transitions
 *      mid-mutation (e.g. hard-deleted user, signed-out user, etc.),
 *      components that were reading the now-gone state can throw a
 *      `Cannot read properties of null/undefined` on the first render
 *      after the unmount. Without a boundary, this also blanks the
 *      tree. With the boundary, the user sees a recoverable error
 *      card with a Reload button.
 *
 *   3. **Realtime subscription handlers throwing.** Supabase realtime
 *      callbacks that read deleted records can throw. Same fix.
 *
 * The boundary itself MUST be a class component — error catching via
 * componentDidCatch / getDerivedStateFromError is class-only API.
 * Everything inside can be functional / hooks-based.
 *
 * Placement: wraps `<AppRoutes />` so it sits inside the providers
 * (ThemeProvider, AuthProvider, ViewModeProvider) but above every
 * route. Errors in providers themselves are not caught (rare — those
 * components are minimal), but EVERY route component is covered.
 */

import { Component } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'

// ChunkLoadError is what React throws when a dynamic import (lazy
// chunk) fails to load. Detected by name OR by message-substring
// because some bundlers / browsers report it differently:
//   - Webpack:  error.name === 'ChunkLoadError'
//   - Vite:     error.message includes 'Failed to fetch dynamically imported module'
//   - Safari:   error.message includes 'Importing a module script failed'
//   - Generic:  error.message includes 'Loading chunk' / 'Loading CSS chunk'
function isChunkLoadError(error) {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  const msg = String(error.message || '')
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('error loading dynamically imported module')
  )
}

export default class ErrorBoundary extends Component {
  state = { error: null, reloading: false, resetting: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  // Stale-flag cleanup — if the throttle flag was set MORE than 5 minutes
  // ago, treat it as a leftover from a prior session and clear it. This
  // lets the next legitimate chunk-load error trigger a fresh recovery
  // reload, without the auto-clear-on-every-mount pattern that caused
  // the May 25 2026 infinite-reload loop (where the flag was cleared
  // before each render, defeating the throttle's purpose of preventing
  // rapid reload loops when a chunk is genuinely broken).
  componentDidMount() {
    const FIVE_MIN = 5 * 60 * 1000
    try {
      const ts = Number(sessionStorage.getItem('myrx_chunk_reload_at') || 0)
      if (ts && Date.now() - ts > FIVE_MIN) sessionStorage.removeItem('myrx_chunk_reload_at')
    } catch { /* */ }
    try {
      const ts2 = Number(sessionStorage.getItem('myrx_safety_nuke_at') || 0)
      if (ts2 && Date.now() - ts2 > FIVE_MIN) sessionStorage.removeItem('myrx_safety_nuke_at')
    } catch { /* */ }
  }

  componentDidCatch(error, info) {
    // Log to console so developers see the real stack trace. In
    // production we could ship this to Sentry / a remote logger.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught render error:', error, info?.componentStack)

    // Chunk-load failures auto-recover via a hard reload. The
    // previous-deploy chunk references in the cached HTML get
    // replaced with the current-deploy ones on the way back. We set
    // a sessionStorage flag so we don't infinite-reload if the new
    // bundle also has a fundamental render error.
    if (isChunkLoadError(error)) {
      try {
        const reloadKey = 'myrx_chunk_reload_at'
        const lastReload = Number(sessionStorage.getItem(reloadKey) || 0)
        // Only auto-reload if we haven't tried in the last 10 seconds.
        // Without this guard, a genuinely broken deploy would put the
        // user in an endless reload loop.
        if (Date.now() - lastReload > 10_000) {
          sessionStorage.setItem(reloadKey, String(Date.now()))
          this.setState({ reloading: true })
          // Small defer so React commits the "Reloading…" UI before
          // we blow the page away — otherwise the user briefly sees
          // the generic error UI flicker before the reload.
          setTimeout(() => window.location.reload(), 100)
        }
      } catch { /* sessionStorage unavailable — fall through to manual reload UI */ }
    }
  }

  handleReload = () => {
    // Clear any sessionStorage marker so the next render attempt
    // isn't gated by the chunk-reload throttle.
    try { sessionStorage.removeItem('myrx_chunk_reload_at') } catch { /* */ }
    window.location.reload()
  }

  handleGoHome = () => {
    try { sessionStorage.removeItem('myrx_chunk_reload_at') } catch { /* */ }
    window.location.replace('/')
  }

  // Worst-case escape hatch — unregister all service workers, delete all
  // CacheStorage entries, wipe session + local storage, then hard reload.
  // For when a user lands here in a poisoned-cache state and the regular
  // Reload button can't get past the bad SW (because the SW intercepts
  // the reload's fetches).
  handleResetApp = async () => {
    this.setState({ resetting: true })
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
    } catch { /* */ }
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } catch { /* */ }
    try { sessionStorage.clear() } catch { /* */ }
    // Keep localStorage (auth tokens etc.) but clear our app-internal flags
    try {
      ['myrx_chunk_reload_at', 'myrx_safety_nuke_at'].forEach(k => {
        try { localStorage.removeItem(k) } catch { /* */ }
      })
    } catch { /* */ }
    setTimeout(() => {
      window.location.replace(window.location.pathname + '?_reset=' + Date.now())
    }, 300)
  }

  render() {
    if (!this.state.error) return this.props.children

    const isChunk = isChunkLoadError(this.state.error)

    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <div className="max-w-md w-full text-center space-y-5">
          {this.state.reloading || this.state.resetting ? (
            <>
              <RefreshCw className="h-10 w-10 text-primary mx-auto animate-spin" />
              <div>
                <h1 className="text-xl font-semibold mb-1">
                  {this.state.resetting ? 'Resetting MyRX…' : 'Updating MyRX…'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {this.state.resetting
                    ? 'Clearing cache and reloading. One second.'
                    : 'A newer version is loading. This will just take a second.'}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="p-3 rounded-full bg-destructive/15 w-fit mx-auto">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <h1 className="text-xl font-semibold mb-1">Something went wrong</h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isChunk
                    ? 'A newer version of MyRX is available. Reload the page to pick it up.'
                    : 'MyRX hit an unexpected error. Reloading the page should clear it. If it keeps happening, contact team@myrxfit.com.'}
                </p>
              </div>
              <div className="space-y-2 pt-2">
                <button
                  onClick={this.handleReload}
                  className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <RefreshCw className="h-4 w-4" /> Reload
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="w-full h-11 rounded-lg border border-border text-foreground font-medium hover:bg-card transition-colors"
                >
                  Go to home
                </button>
                {/* Worst-case escape hatch — for poisoned-cache states
                    where Reload won't get past the bad service worker. */}
                <button
                  onClick={this.handleResetApp}
                  className="w-full h-9 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> Reset app (clear all cache)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
}
