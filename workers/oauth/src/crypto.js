// AES-256-GCM helpers for OAuth-token encryption at rest in user_integrations.
// Stored format: base64(nonce(12B) || ciphertext || gcm_tag(16B)).
// Key: env.OAUTH_TOKEN_ENC_KEY — base64 of a 32-byte secret (256-bit AES key).

const NONCE_LEN = 12

function b64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToB64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

async function importKey(b64Key) {
  if (!b64Key) throw new Error('OAUTH_TOKEN_ENC_KEY is not set')
  const raw = b64ToBytes(b64Key)
  if (raw.length !== 32) {
    throw new Error(`OAUTH_TOKEN_ENC_KEY must be 32 bytes (base64-decoded); got ${raw.length}`)
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptToken(plaintext, b64Key) {
  if (plaintext == null) return null
  const key = await importKey(b64Key)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  )
  const ct = new Uint8Array(ctBuf)
  const combined = new Uint8Array(NONCE_LEN + ct.length)
  combined.set(nonce, 0)
  combined.set(ct, NONCE_LEN)
  return bytesToB64(combined)
}

export async function decryptToken(b64, b64Key) {
  if (b64 == null) return null
  const key = await importKey(b64Key)
  const combined = b64ToBytes(b64)
  if (combined.length <= NONCE_LEN) throw new Error('ciphertext too short')
  const nonce = combined.slice(0, NONCE_LEN)
  const ct    = combined.slice(NONCE_LEN)
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct)
  return new TextDecoder().decode(ptBuf)
}
