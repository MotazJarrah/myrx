// __SW_BUILD_VERSION__ placeholder gets replaced with a build-time
// timestamp by scripts/stamp-sw.mjs in the postbuild hook. Source
// (this file in public/) carries `dev` so local dev works without the
// stamping step. Production builds get e.g. `2026-05-25T12-34-56`.
const BUILD_VERSION = '__SW_BUILD_VERSION__' === '__SW_BUILD_' + 'VERSION__' ? 'dev' : '__SW_BUILD_VERSION__'
const CACHE = 'myrx-assets-' + BUILD_VERSION
const SHELL_CACHE = 'myrx-shell-' + BUILD_VERSION

// IMPORTANT — bfcache compatibility (LOCKED May 27 2026):
//   - `self.skipWaiting()` is OK: it controls how fast a NEW SW takes
//     over its first install. No bfcache impact.
//   - `self.clients.claim()` IS BANNED. NO EXCEPTIONS. Calling it forces
//     the new SW to take control of every existing client immediately,
//     which fires `serviceworker-claimed` in Chrome's bfcache machinery
//     and evicts every cached page. The practical symptom: every tab-
//     switch back to the app reloads from scratch.
//     Because BUILD_VERSION bumps on every deploy, EVERY deploy ships a
//     new SW; if that SW calls claim() on activate, every active tab
//     gets its bfcache nuked once per deploy. The user QAs against the
//     live URL constantly, so claim() = constant-reload misery.
//   - `clients.matchAll()` followed by `c.navigate(c.url)` is ALSO
//     BANNED for the same reason — it forces all controlled tabs to
//     reload, which is exactly the symptom we're trying to prevent.
//
//   We do NOT need either of these because:
//     1. The SW's only job is stale-while-revalidate caching of static
//        assets. Old SW handles existing tabs fine; new SW takes over
//        naturally on the next cold navigation.
//     2. Cache-poisoning protection (see CACHE-POISONING FIX below) is
//        enforced by `shouldCacheAsset()` in the fetch handler — runs
//        every fetch, doesn't need claim().
//     3. If a user IS poisoned from a pre-fix version, the self-heal
//        in index.html (MIME-mismatch detector → cache clear + reload)
//        catches it on the next page load.
//
//   Regression history: claim() was reintroduced May 25 2026 during
//   the cache-poisoning recovery as a "ONE-TIME" measure. That rationale
//   was wrong — BUILD_VERSION bumps every deploy, so it fired every
//   deploy. Removed permanently May 27 2026.
// References:
//   https://web.dev/articles/bfcache (search "serviceworker-claimed")
//   https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons
//
// CACHE-POISONING FIX (locked May 25 2026):
//   Earlier versions cached anything where `res.ok === true`. That
//   silently cached the SPA fallback HTML (200 + text/html) for any
//   /assets/* path that 404'd on the CDN — e.g. an old chunk hash
//   from a previous deploy. Subsequent fetches hit the SW cache and
//   returned HTML for a path the browser expected to be JS, producing
//   the dreaded "Failed to load module script: Expected a JavaScript
//   module script but the server responded with a MIME type of
//   'text/html'" + blank page.
//
//   Fix: validate Content-Type before caching ANY /assets/* response.
//   Only cache scripts, stylesheets, fonts, images. HTML responses
//   are passed through to the browser (which then triggers React's
//   ChunkLoadError → ErrorBoundary → force-reload, the right
//   recovery path).
function shouldCacheAsset(res) {
  if (!res.ok) return false
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  // Anything that looks like a script, stylesheet, font, image — OK.
  // HTML, JSON, text/plain etc — REJECT (means it's the SPA fallback).
  return (
    ct.includes('javascript') ||
    ct.includes('css')        ||
    ct.includes('font')       ||
    ct.includes('image')      ||
    ct.includes('woff')       ||
    ct.includes('json')          // /manifest.json hits the shell branch, but JSON in /assets/ is also safe
  ) && !ct.includes('text/html')
}

// CACHED-RESPONSE MIME VALIDATION (added May 27 2026)
//
// Defense-in-depth check on READ from cache. shouldCacheAsset() above
// prevents POISONING the cache going forward, but if a user has a stale
// poisoned cache from a pre-fix SW (e.g. May 25 2026 regression), that
// cache STILL contains HTML at /assets/*.css URLs. When the new SW takes
// over (e.g. after the user closes all tabs), it inherits the previous
// SW's cache namespace via cache key reuse OR via stale entries that
// somehow survived activate's wipe.
//
// To kill that footgun: validate the cached response's content-type
// against the URL extension EVERY time we serve from cache. If the cache
// has HTML stored at a .css path, evict it and refetch from network.
//
// This catches the failure mode where Path B in index.html (post-load
// CSS check) would have triggered self-heal — but does it at the SW
// layer so we never even need to do a full reload.
function cachedResponseMatchesUrlExtension(url, cachedRes) {
  const ct = (cachedRes.headers.get('content-type') || '').toLowerCase()
  // HTML response should never be served from /assets/ — that's the
  // SPA fallback that means "this asset doesn't exist." Always evict.
  if (ct.includes('text/html')) return false
  // Per-extension MIME sanity check
  if (url.pathname.endsWith('.js')   && !ct.includes('javascript')) return false
  if (url.pathname.endsWith('.css')  && !ct.includes('css'))        return false
  if (url.pathname.endsWith('.woff2') && !ct.includes('font') && !ct.includes('woff')) return false
  if (url.pathname.endsWith('.json') && !ct.includes('json'))       return false
  return true
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Wipe old caches (any stale-version BUILD_VERSION entries from prior
    // deploys, plus any poisoned-HTML-as-JS entries from pre-shouldCacheAsset
    // versions). New SW takes over naturally on next cold navigation — we
    // do NOT call clients.claim() or matchAll().navigate() here. See the
    // bfcache compatibility comment block above for the rationale.
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(k => k !== CACHE && k !== SHELL_CACHE).map(k => caches.delete(k))
    )
  })())
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return

  // Hashed assets: cache-first (filename changes on deploy, safe to cache forever).
  // On cache HIT, validate the cached MIME against the URL extension before
  // serving — if the cached entry is HTML at a .css/.js path (poisoned cache
  // from a pre-fix SW), evict and fall through to network. See
  // cachedResponseMatchesUrlExtension comment block above for full rationale.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) {
          if (cachedResponseMatchesUrlExtension(url, cached)) return cached
          // Poisoned entry — evict and refetch from network. Don't await
          // the delete; the fetch can race ahead.
          cache.delete(e.request)
        }
        const res = await fetch(e.request)
        if (shouldCacheAsset(res)) cache.put(e.request, res.clone())
        return res
      })
    )
    return
  }

  // App shell (index.html + static assets): stale-while-revalidate
  // Serve cached immediately, refresh in background — instant iOS resume
  if (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.startsWith('/logo') ||
    url.pathname === '/manifest.json' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico')
  ) {
    e.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        const fetchPromise = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone())
          return res
        }).catch(() => null)
        return cached || fetchPromise
      })
    )
  }
})
