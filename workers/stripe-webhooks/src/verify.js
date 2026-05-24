// Stripe webhook signature verification (Workers-compatible).
//
// Stripe sends every webhook with a `Stripe-Signature` header that looks like:
//   t=1492774577,v1=5257a869...,v0=...,v1=...
//
// We:
//   1. Parse `t` (timestamp) and ALL `v1` signatures from the header
//   2. Construct signed_payload = `${timestamp}.${rawBody}`
//   3. HMAC-SHA256 sign that payload with the webhook secret
//   4. Compare (constant-time) against each provided v1 signature
//   5. Verify the timestamp is within tolerance (default 5 minutes) to
//      reject replay attacks
//
// This is a Workers-native port of the official `stripe.webhooks.constructEvent`
// from the Node SDK — the Node SDK can't run in Workers because it uses Node
// crypto. We use Web Crypto (subtle.importKey + subtle.sign) here.

const TOLERANCE_SECONDS = 300  // 5 min replay-window tolerance

function parseHeader(header) {
  const parts = header.split(',').map(p => p.trim())
  let timestamp = null
  const v1signatures = []
  for (const p of parts) {
    const [k, v] = p.split('=', 2)
    if (k === 't') timestamp = Number(v)
    else if (k === 'v1') v1signatures.push(v)
  }
  return { timestamp, v1signatures }
}

async function hmacSha256Hex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Constant-time string comparison — defends against timing-attack inference
// of the expected signature.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Verifies a Stripe webhook payload + signature.
 * @param {string} rawBody  Raw request body text (must NOT be parsed before passing in)
 * @param {string} sigHeader  Value of `Stripe-Signature` request header
 * @param {string} secret  The whsec_... signing secret from Stripe dashboard
 * @returns {Promise<object>}  Parsed event object on success
 * @throws  On any verification failure
 */
export async function verifyWebhook(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header')
  if (!secret) throw new Error('Webhook secret not configured')

  const { timestamp, v1signatures } = parseHeader(sigHeader)
  if (!timestamp || v1signatures.length === 0) {
    throw new Error('Malformed Stripe-Signature header')
  }

  // Replay-window check
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - timestamp) > TOLERANCE_SECONDS) {
    throw new Error(`Webhook timestamp outside tolerance window (got ${timestamp}, now ${nowSec})`)
  }

  const signedPayload = `${timestamp}.${rawBody}`
  const expectedSig = await hmacSha256Hex(secret, signedPayload)

  // Stripe rotates signing secrets without invalidating in-flight requests —
  // the header can contain multiple v1 signatures, any match is valid.
  const anyMatch = v1signatures.some(sig => constantTimeEqual(sig, expectedSig))
  if (!anyMatch) {
    throw new Error('No valid signature match — payload may be tampered or wrong secret')
  }

  return JSON.parse(rawBody)
}
