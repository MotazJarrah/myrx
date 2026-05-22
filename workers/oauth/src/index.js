// MyRX OAuth Worker
//
// Mounted on https://myrxfit.com/oauth/* (see wrangler.toml [[routes]]).
// Handles the direct-OAuth flow for Strava + Fitbit + Whoop + Polar + Garmin.
// Apple HealthKit / Samsung Health / Google Health Connect use native SDKs, not
// OAuth, so they don't route through here — they're listed in the supported
// platform set only so the user_integrations row writes from those code paths
// can reuse this worker's encrypt+store machinery if we ever expose one.
//
// Routes:
//   GET  /oauth/start/:platform        Mobile app calls with `Authorization: Bearer <supabase-jwt>`.
//                                      Returns { url, state } — mobile opens `url` in expo-web-browser.
//   GET  /oauth/callback/:platform     Provider redirects here after user consent.
//                                      State signature is the auth (no JWT). Worker exchanges code,
//                                      encrypts tokens, upserts user_integrations, 302s to
//                                      MOBILE_DEEP_LINK with ?platform=...&status=ok|error.
//   POST /oauth/refresh/:platform      Mobile app calls when access_token nears expiry.
//                                      Worker refreshes + updates the row, returns new expiry only.
//   POST /oauth/disconnect/:platform   Mobile app calls when user taps Disconnect.
//                                      Worker tries provider deauth, then deletes the row.
//   POST /oauth/webhooks/:platform     Provider event push (Strava activity created, etc.).
//                                      Currently 200-acks; full handler lands with 2c.
//
// Per OAuth 2.0 spec, Client IDs are embedded in the public authorize URL so
// they're not secrets — they live in wrangler.toml [vars]. Client SECRETS go
// through `wrangler secret put`.

import { encryptToken, decryptToken } from './crypto.js'
import { signState, verifyState } from './state.js'
import { SupabaseRest } from './supabase.js'
import * as strava from './strava.js'
import * as polar from './polar.js'

const SUPPORTED_PLATFORMS = new Set([
  'strava', 'fitbit', 'apple_healthkit', 'samsung_health',
  'garmin', 'whoop', 'polar', 'google_health_connect',
])

// Platforms with a wired OAuth handler in this worker. Others 501 for now.
const IMPLEMENTED_PLATFORMS = new Set(['strava', 'polar'])

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url, ...CORS } })
}

function callbackRedirect(env, query) {
  const url = new URL(env.MOBILE_DEEP_LINK)
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v))
  }
  return redirect(url.toString())
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return { error: json({ error: 'Missing Authorization header' }, 401) }
  }
  let supa
  try {
    supa = new SupabaseRest(env)
  } catch (err) {
    return { error: json({ error: 'Worker misconfigured', detail: String(err.message ?? err) }, 500) }
  }
  const user = await supa.getUserFromJwt(auth.slice(7))
  if (!user) return { error: json({ error: 'Invalid or expired token' }, 401) }
  return { user, supa }
}

function callbackUriFor(_env, platform) {
  // Must match exactly what's registered in the provider's OAuth app config.
  // Strava: register the domain `myrxfit.com` under Authorization Callback Domain.
  return `https://myrxfit.com/oauth/callback/${platform}`
}

// ─────────────── Route handlers ───────────────

async function handleStart(request, env, platform) {
  const ctx = await requireUser(request, env)
  if (ctx.error) return ctx.error
  if (!IMPLEMENTED_PLATFORMS.has(platform)) {
    return json({ error: `Platform ${platform} not yet implemented` }, 501)
  }

  const state = await signState({ userId: ctx.user.id, platform }, env.OAUTH_STATE_SIGNING_KEY)
  const redirectUri = callbackUriFor(env, platform)

  if (platform === 'strava') {
    if (!env.STRAVA_CLIENT_ID) {
      return json({ error: 'STRAVA_CLIENT_ID not configured' }, 500)
    }
    const url = strava.buildAuthorizeUrl({
      clientId: env.STRAVA_CLIENT_ID,
      redirectUri,
      state,
    })
    return json({ url, state })
  }

  if (platform === 'polar') {
    if (!env.POLAR_CLIENT_ID) {
      return json({ error: 'POLAR_CLIENT_ID not configured' }, 500)
    }
    const url = polar.buildAuthorizeUrl({
      clientId: env.POLAR_CLIENT_ID,
      redirectUri,
      state,
    })
    return json({ url, state })
  }

  return json({ error: 'unreachable' }, 500)
}

async function handleCallback(request, env, platform) {
  // No JWT — the user's browser is following a provider redirect.
  // Authentication is via the signed state token.
  const incomingUrl = new URL(request.url)
  const code  = incomingUrl.searchParams.get('code')
  const state = incomingUrl.searchParams.get('state')
  const errorParam = incomingUrl.searchParams.get('error')

  if (errorParam) {
    return callbackRedirect(env, { platform, status: 'error', reason: errorParam })
  }
  if (!code || !state) {
    return callbackRedirect(env, { platform, status: 'error', reason: 'missing_code_or_state' })
  }

  const verified = await verifyState(state, env.OAUTH_STATE_SIGNING_KEY)
  if (!verified) {
    return callbackRedirect(env, { platform, status: 'error', reason: 'invalid_state' })
  }
  if (verified.platform !== platform) {
    return callbackRedirect(env, { platform, status: 'error', reason: 'platform_mismatch' })
  }
  if (!IMPLEMENTED_PLATFORMS.has(platform)) {
    return callbackRedirect(env, { platform, status: 'error', reason: 'not_implemented' })
  }

  try {
    if (platform === 'strava') {
      if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
        return callbackRedirect(env, { platform, status: 'error', reason: 'worker_misconfigured' })
      }
      const tokens = await strava.exchangeCode({
        code,
        clientId: env.STRAVA_CLIENT_ID,
        clientSecret: env.STRAVA_CLIENT_SECRET,
      })
      const supa = new SupabaseRest(env)
      await supa.upsertIntegration({
        user_id: verified.userId,
        platform: 'strava',
        access_token: await encryptToken(tokens.access_token, env.OAUTH_TOKEN_ENC_KEY),
        refresh_token: await encryptToken(tokens.refresh_token, env.OAUTH_TOKEN_ENC_KEY),
        expires_at: tokens.expires_at
          ? new Date(tokens.expires_at * 1000).toISOString()
          : null,
        scopes: strava.STRAVA_SCOPES.split(','),
        provider_user_id: tokens.athlete?.id ? String(tokens.athlete.id) : null,
        connected_at: new Date().toISOString(),
        status: 'active',
      })
      return callbackRedirect(env, { platform, status: 'ok' })
    }

    if (platform === 'polar') {
      if (!env.POLAR_CLIENT_ID || !env.POLAR_CLIENT_SECRET) {
        return callbackRedirect(env, { platform, status: 'error', reason: 'worker_misconfigured' })
      }
      const redirectUri = callbackUriFor(env, platform)
      const tokens = await polar.exchangeCode({
        code,
        clientId: env.POLAR_CLIENT_ID,
        clientSecret: env.POLAR_CLIENT_SECRET,
        redirectUri,
      })
      // Polar requires a one-time user registration before subsequent data reads
      // work. Without this, /v3/users/{id}/... endpoints return 404.
      await polar.registerUser({
        accessToken: tokens.access_token,
        polarUserId: tokens.x_user_id,
      })
      const supa = new SupabaseRest(env)
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null
      await supa.upsertIntegration({
        user_id: verified.userId,
        platform: 'polar',
        access_token: await encryptToken(tokens.access_token, env.OAUTH_TOKEN_ENC_KEY),
        refresh_token: null,  // Polar tokens are long-lived; no refresh token issued
        expires_at: expiresAt,
        scopes: polar.POLAR_SCOPES.split(','),
        provider_user_id: tokens.x_user_id ? String(tokens.x_user_id) : null,
        connected_at: new Date().toISOString(),
        status: 'active',
      })
      return callbackRedirect(env, { platform, status: 'ok' })
    }
  } catch (err) {
    return callbackRedirect(env, {
      platform,
      status: 'error',
      reason: 'exchange_failed',
      detail: String(err.message ?? err).slice(0, 200),
    })
  }
  return callbackRedirect(env, { platform, status: 'error', reason: 'unhandled' })
}

async function handleRefresh(request, env, platform) {
  const ctx = await requireUser(request, env)
  if (ctx.error) return ctx.error
  if (!IMPLEMENTED_PLATFORMS.has(platform)) return json({ error: 'not_implemented' }, 501)

  const row = await ctx.supa.getIntegration(ctx.user.id, platform)
  if (!row || !row.refresh_token) return json({ error: 'No integration found' }, 404)

  if (platform === 'strava') {
    if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
      return json({ error: 'Worker misconfigured' }, 500)
    }
    const refreshToken = await decryptToken(row.refresh_token, env.OAUTH_TOKEN_ENC_KEY)
    let tokens
    try {
      tokens = await strava.refreshTokens({
        refreshToken,
        clientId: env.STRAVA_CLIENT_ID,
        clientSecret: env.STRAVA_CLIENT_SECRET,
      })
    } catch (err) {
      // Refresh failure → user revoked us on Strava's side, or refresh-token was
      // rotated. Mark expired so the mobile app surfaces a Reconnect prompt.
      await ctx.supa.upsertIntegration({
        user_id: ctx.user.id,
        platform: 'strava',
        status: 'expired',
      })
      return json({ error: 'refresh_failed', detail: String(err.message ?? err).slice(0, 200) }, 502)
    }
    await ctx.supa.upsertIntegration({
      user_id: ctx.user.id,
      platform: 'strava',
      access_token: await encryptToken(tokens.access_token, env.OAUTH_TOKEN_ENC_KEY),
      refresh_token: await encryptToken(tokens.refresh_token, env.OAUTH_TOKEN_ENC_KEY),
      expires_at: tokens.expires_at
        ? new Date(tokens.expires_at * 1000).toISOString()
        : null,
      status: 'active',
    })
    return json({ status: 'ok', expires_at: tokens.expires_at })
  }

  if (platform === 'polar') {
    // Polar tokens are long-lived (years); they don't issue refresh tokens.
    // If mobile calls refresh anyway, just no-op and report current expiry.
    return json({ status: 'no_refresh_supported', expires_at: row.expires_at })
  }

  return json({ error: 'unreachable' }, 500)
}

async function handleDisconnect(request, env, platform) {
  const ctx = await requireUser(request, env)
  if (ctx.error) return ctx.error
  if (!SUPPORTED_PLATFORMS.has(platform)) return json({ error: 'unsupported_platform' }, 400)

  const row = await ctx.supa.getIntegration(ctx.user.id, platform)
  if (!row) return json({ status: 'ok' })  // idempotent

  // Best-effort revoke at the provider. If it fails, still delete locally —
  // disconnecting from the user's perspective is more important than upstream cleanup.
  if (platform === 'strava' && row.access_token) {
    try {
      const accessToken = await decryptToken(row.access_token, env.OAUTH_TOKEN_ENC_KEY)
      await strava.deauthorize({ accessToken })
    } catch {
      // swallow
    }
  }

  if (platform === 'polar' && row.access_token && row.provider_user_id) {
    try {
      const accessToken = await decryptToken(row.access_token, env.OAUTH_TOKEN_ENC_KEY)
      await polar.deauthorize({ accessToken, polarUserId: row.provider_user_id })
    } catch {
      // swallow
    }
  }

  await ctx.supa.deleteIntegration(ctx.user.id, platform)
  return json({ status: 'ok' })
}

function handleWebhook(_request, _env, _platform) {
  // Provider event push lands in 2c (Strava activity-created, etc.). Acknowledge
  // 200 so providers don't retry.
  return new Response('ok', { status: 200, headers: CORS })
}

// ─────────────── Router ───────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const m = url.pathname.match(/^\/oauth\/(start|callback|refresh|disconnect|webhooks)\/([a-z_]+)$/)
    if (!m) return json({ error: 'Not found' }, 404)

    const [, action, platform] = m
    if (!SUPPORTED_PLATFORMS.has(platform)) {
      return json({ error: `Unknown platform: ${platform}` }, 400)
    }

    try {
      if (action === 'start'      && request.method === 'GET' ) return await handleStart(request, env, platform)
      if (action === 'callback'   && request.method === 'GET' ) return await handleCallback(request, env, platform)
      if (action === 'refresh'    && request.method === 'POST') return await handleRefresh(request, env, platform)
      if (action === 'disconnect' && request.method === 'POST') return await handleDisconnect(request, env, platform)
      if (action === 'webhooks'                                ) return handleWebhook(request, env, platform)
      return json({ error: 'Method not allowed' }, 405)
    } catch (err) {
      return json({ error: 'Internal error', detail: String(err.message ?? err).slice(0, 200) }, 500)
    }
  },
}
