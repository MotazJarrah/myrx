// OAuth state-token signing / verification.
//
// The `state` query parameter passed through the provider's authorize URL is
// signed by us so the callback handler can:
//   1. verify the request actually originated from our /oauth/start handler
//      (CSRF protection)
//   2. recover the user_id who initiated the flow (no need to persist it)
//   3. reject stale callbacks (TTL = 10 minutes)
//
// Format: base64url(payload).hex(hmac-sha256(payload, OAUTH_STATE_SIGNING_KEY))
// Payload: `${user_id}|${platform}|${timestamp_ms}|${nonce_hex}`

const STATE_TTL_MS = 10 * 60 * 1000

function b64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function b64urlEncode(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  return atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

function bytesToHex(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('hex string must have even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

async function importHmacKey(b64Key) {
  if (!b64Key) throw new Error('OAUTH_STATE_SIGNING_KEY is not set')
  const raw = b64ToBytes(b64Key)
  if (raw.length < 32) throw new Error('OAUTH_STATE_SIGNING_KEY must be >= 32 bytes')
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signState({ userId, platform }, b64Key) {
  const nonce = crypto.getRandomValues(new Uint8Array(8))
  const payload = `${userId}|${platform}|${Date.now()}|${bytesToHex(nonce)}`
  const key = await importHmacKey(b64Key)
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigHex = bytesToHex(new Uint8Array(sigBuf))
  return `${b64urlEncode(payload)}.${sigHex}`
}

export async function verifyState(state, b64Key) {
  if (typeof state !== 'string') return null
  const dot = state.indexOf('.')
  if (dot < 1) return null
  const b64Payload = state.slice(0, dot)
  const sigHex = state.slice(dot + 1)
  let payload
  try {
    payload = b64urlDecode(b64Payload)
  } catch {
    return null
  }
  let sigBytes
  try {
    sigBytes = hexToBytes(sigHex)
  } catch {
    return null
  }
  const key = await importHmacKey(b64Key)
  const sigOk = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  if (!sigOk) return null
  const [userId, platform, tsStr] = payload.split('|')
  const ts = Number(tsStr)
  if (!userId || !platform || !Number.isFinite(ts)) return null
  if (Date.now() - ts > STATE_TTL_MS) return null
  return { userId, platform, ts }
}
