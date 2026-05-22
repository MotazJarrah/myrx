/**
 * Polar AccessLink — mobile-side OAuth client.
 *
 * The actual OAuth handshake is brokered by the Cloudflare Worker at
 * `https://myrxfit.com/oauth/*` (see `workers/oauth/`). This module is just the
 * RN-side glue:
 *
 *   1. `startConnect()` — asks the worker for an authorize URL (signed state +
 *      our user id baked in), opens it via expo-web-browser, waits for the
 *      worker's `myrx://oauth/done?platform=polar&status=ok|error` redirect.
 *      Returns { status, reason? }.
 *
 *   2. `getStatus()` — reads the `user_integrations` row directly from
 *      Supabase (RLS-scoped to the current user — see migration
 *      `restrict_user_integrations_token_columns_select`). Only non-secret
 *      columns are pulled (no access_token / refresh_token).
 *
 *   3. `disconnect()` — POSTs to `/oauth/disconnect/polar` so the worker can
 *      revoke at Polar's end (DELETE /v3/users/{id}) and delete the DB row.
 *
 * The actual data-pull from Polar AccessLink — fetching exercises and
 * mapping them into MyRX `efforts` — lands in a separate `polarSync.ts`
 * module + a `/oauth/sync/polar` worker endpoint. v1 of this module is
 * connection-only.
 */

import * as WebBrowser from 'expo-web-browser'
import { supabase } from '../supabase'

const WORKER_BASE = 'https://myrxfit.com/oauth'
const RETURN_URL  = 'myrx://oauth/done'

export type ConnectResult =
  | { status: 'ok' }
  | { status: 'cancelled' }
  | { status: 'error'; reason: string }

export type ConnectionStatus = {
  connected:    boolean
  connectedAt:  string | null
  expiresAt:    string | null
  providerUserId: string | null
}

/**
 * Drive the full OAuth flow. Awaits the deep-link return from the worker —
 * resolves to { status: 'ok' } only after a successful token exchange.
 */
export async function startConnect(): Promise<ConnectResult> {
  // 1. Verify the user has an active Supabase session
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr || !session?.access_token) {
    return { status: 'error', reason: 'not_signed_in' }
  }

  // 2. Request the authorize URL from our worker
  let startBody: { url?: string; error?: string }
  try {
    const res = await fetch(`${WORKER_BASE}/start/polar`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    startBody = await res.json().catch(() => ({}))
    if (!res.ok || !startBody.url) {
      return { status: 'error', reason: startBody.error ?? `start_${res.status}` }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', reason: `network: ${msg.slice(0, 60)}` }
  }

  // 3. Open the provider's authorize URL in an in-app browser. expo-web-browser
  //    auto-resolves when the worker's 302 hits our `myrx://oauth/done` scheme
  //    (Android intent filter + iOS Universal Link both handle this).
  let result: WebBrowser.WebBrowserAuthSessionResult
  try {
    result = await WebBrowser.openAuthSessionAsync(startBody.url!, RETURN_URL, {
      showInRecents: false,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', reason: `browser: ${msg.slice(0, 60)}` }
  }

  // 4. Parse the deep-link return URL — the worker redirects to
  //    `myrx://oauth/done?platform=polar&status=ok|error[&reason=...]`
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { status: 'cancelled' }
  }
  if (result.type !== 'success' || !result.url) {
    return { status: 'error', reason: 'unexpected_browser_result' }
  }

  const url = new URL(result.url)
  const status = url.searchParams.get('status')
  if (status === 'ok') return { status: 'ok' }
  return { status: 'error', reason: url.searchParams.get('reason') ?? 'unknown' }
}

/**
 * Read the connection row from Supabase. Non-secret columns only — the
 * encrypted access_token / refresh_token columns are service-role-only per RLS.
 */
export async function getStatus(): Promise<ConnectionStatus> {
  const { data, error } = await supabase
    .from('user_integrations')
    .select('connected_at, expires_at, provider_user_id, status')
    .eq('platform', 'polar')
    .maybeSingle()

  if (error || !data || data.status !== 'active') {
    return { connected: false, connectedAt: null, expiresAt: null, providerUserId: null }
  }
  return {
    connected:      true,
    connectedAt:    data.connected_at,
    expiresAt:      data.expires_at,
    providerUserId: data.provider_user_id,
  }
}

/**
 * Revoke at Polar's end (best-effort) and delete the local row.
 * Idempotent — calling disconnect on an already-disconnected account returns ok.
 */
export async function disconnect(): Promise<{ status: 'ok' } | { status: 'error'; reason: string }> {
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr || !session?.access_token) {
    return { status: 'error', reason: 'not_signed_in' }
  }

  try {
    const res = await fetch(`${WORKER_BASE}/disconnect/polar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { status: 'error', reason: body.error ?? `disconnect_${res.status}` }
    }
    return { status: 'ok' }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', reason: `network: ${msg.slice(0, 60)}` }
  }
}
