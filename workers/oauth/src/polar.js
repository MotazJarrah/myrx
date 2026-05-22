// Polar AccessLink OAuth — authorize URL, code exchange, user registration, deauthorize.
// API docs: https://www.polar.com/accesslink-api/
//
// Polar's flow has TWO quirks vs the standard OAuth 2.0 / Strava pattern:
//
//   1. NO refresh tokens. Polar access tokens are long-lived (~years) and the
//      token response includes only `access_token` + `expires_in` + `x_user_id`.
//      We treat tokens as permanent until the user disconnects or Polar invalidates.
//
//   2. After token exchange, we MUST register the user at /v3/users with the
//      polar-user-id. Without this step, all subsequent /v3/users/{id}/... data
//      reads return 404. Per Polar docs:
//      https://www.polar.com/accesslink-api/#register-user
//
// Scopes (coarse-grained per Polar; we enabled all three at registration):
//   - Exercise data (workouts + HR streams) — needed for cardio coaching
//   - Daily activity data (steps, calories)
//   - Physical information data (weight, height, etc.)
//
// Auth model: OAuth 2.0 + Basic auth on the token endpoint (clientId:clientSecret
// in the Authorization header, NOT in the body — different from Strava).

const POLAR_AUTHORIZE     = 'https://flow.polar.com/oauth2/authorization'
const POLAR_TOKEN         = 'https://polarremote.com/v2/oauth2/token'
const POLAR_REGISTER_USER = 'https://www.polaraccesslink.com/v3/users'
const POLAR_DEAUTHORIZE   = 'https://www.polaraccesslink.com/v3/users' // DELETE /{user-id}

// Polar's scope value is `accesslink.read_all` per their docs — granted via the
// per-data-type toggles set at client registration time (Exercise / Daily / Physical).
export const POLAR_SCOPES = 'accesslink.read_all'

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(POLAR_AUTHORIZE)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', POLAR_SCOPES)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

// Polar's token endpoint expects HTTP Basic auth (base64(clientId:clientSecret))
// and the code in a form-encoded body. Returns:
//   { access_token, token_type: "bearer", expires_in: seconds, x_user_id: number }
export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const basic = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch(POLAR_TOKEN, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      Accept:         'application/json;charset=UTF-8',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Polar token endpoint ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

// Register the Polar user against our app's AccessLink client. MUST be called
// once after token exchange — without it, downstream data reads 404.
//
// Body: { "member-id": "<our-stable-id>" }
// We use the Polar-supplied x_user_id stringified as the member-id; this gives
// a 1:1 mapping our backend can audit later.
//
// 200 OK: returned on success
// 409 Conflict: user already registered (idempotent — treat as success)
export async function registerUser({ accessToken, polarUserId }) {
  const res = await fetch(POLAR_REGISTER_USER, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      Accept:         'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 'member-id': String(polarUserId) }),
  })
  if (res.status === 409) return true  // already registered — idempotent success
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Polar user registration ${res.status}: ${text.slice(0, 200)}`)
  }
  return true
}

// Polar deauthorize: DELETE /v3/users/{user-id} with the Bearer access_token.
// The {user-id} in the path is the Polar-supplied x_user_id, NOT our member-id.
// 204 No Content on success, 404 if already gone (treat as success).
export async function deauthorize({ accessToken, polarUserId }) {
  const res = await fetch(`${POLAR_DEAUTHORIZE}/${polarUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.ok || res.status === 404
}
