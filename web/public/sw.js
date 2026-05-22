const CACHE = 'myrx-assets-v4'
const SHELL_CACHE = 'myrx-shell-v4'

// IMPORTANT — bfcache compatibility:
//   - `self.skipWaiting()` is OK: it controls how fast a NEW SW takes
//     over its first install. No bfcache impact.
//   - `self.clients.claim()` IS NOT OK on a SPA that wants bfcache.
//     Calling it forces the new SW to take control of every existing
//     client immediately, which fires `serviceworker-claimed` in
//     Chrome's bfcache machinery and evicts every cached page. The
//     practical symptom: every tab-switch back to the app reloads from
//     scratch. We DO NOT need claim() because the SW's only job here is
//     stale-while-revalidate caching of static assets — old SW handles
//     existing tabs fine; new SW takes over on the next cold navigation.
// References:
//   https://web.dev/articles/bfcache (search "serviceworker-claimed")
//   https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== SHELL_CACHE).map(k => caches.delete(k)))
    )
  )
  // DO NOT call self.clients.claim() — see comment above.
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return

  // Hashed assets: cache-first (filename changes on deploy, safe to cache forever)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        const res = await fetch(e.request)
        if (res.ok) cache.put(e.request, res.clone())
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
