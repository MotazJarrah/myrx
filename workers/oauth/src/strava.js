// Strava OAuth — authorize URL, code exchange, refresh, deauthorize.
// API docs: https://developers.strava.com/docs/authentication/
//
// Strava's token response includes `expires_at` as a Unix timestamp in SECONDS
// (not ms) — callers should multiply by 1000 before passing to `new Date()`.

const STRAVA_AUTHORIZE   = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN       = 'https://www.strava.com/oauth/token'
const STRAVA_DEAUTHORIZE = 'https://www.strava.com/oauth/deauthorize'

// Read-only scopes needed for cardio coaching:
//   - read                  basic public profile
//   - activity:read_all     ALL workouts including private (vs activity:read = public only)
//   - profile:read_all      additional profile metadata
export const STRAVA_SCOPES = 'read,activity:read_all,profile:read_all'

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(STRAVA_AUTHORIZE)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', STRAVA_SCOPES)
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('state', state)
  return url.toString()
}

async function tokenRequest(body) {
  const res = await fetch(STRAVA_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Strava token endpoint ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

export async function exchangeCode({ code, clientId, clientSecret }) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  })
  // { token_type, expires_at, expires_in, refresh_token, access_token, athlete: { id, ... } }
}

export async function refreshTokens({ refreshToken, clientId, clientSecret }) {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  // { token_type, access_token, expires_at, expires_in, refresh_token }
}

export async function deauthorize({ accessToken }) {
  const res = await fetch(STRAVA_DEAUTHORIZE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken }),
  })
  return res.ok
}
