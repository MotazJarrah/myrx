/**
 * Cloudflare Pages Function — OFF Search proxy
 *
 * Proxies requests to search.openfoodfacts.org/search which blocks
 * browser CORS requests from third-party origins.
 * By routing through our own Cloudflare edge function we avoid CORS entirely.
 *
 * Route: GET /api/off-search?q=...&page_size=...
 */

export async function onRequestGet(context) {
  const { request } = context
  const { searchParams } = new URL(request.url)

  const q        = searchParams.get('q')        || ''
  const pageSize = searchParams.get('page_size') || '40'

  if (!q.trim()) {
    return new Response(JSON.stringify({ hits: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const offUrl = new URL('https://search.openfoodfacts.org/search')
  offUrl.searchParams.set('q',         q.trim())
  offUrl.searchParams.set('page_size', pageSize)

  const upstream = await fetch(offUrl.toString(), {
    headers: {
      // OFF requires a User-Agent identifying the app
      'User-Agent': 'MyRX/1.0 (motaz.jarrah@hotmail.com)',
      'Accept':     'application/json',
    },
  })

  const body = await upstream.text()

  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=300', // cache results for 5 min at edge
    },
  })
}
