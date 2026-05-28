// scripts/rename-stripe-semirx-to-corerx.mjs
//
// One-shot Stripe rename for the B2C middle tier:
//
//   Product:   "SemiRX Unlock"     → "CoreRX Unlock"
//   Price LK:  semirx_onetime      → corerx_onetime
//
// CLAUDE.md lock (May 25 2026): "renamed to CoreRX — reads as 'the
// essential prescription' instead of 'half a prescription'. Code
// references use `corerx` as the tier id."
//
// Idempotent. Stripe IDs (prod_/price_) are NOT changed, so any
// existing purchases / payment intents / metadata tied to the old
// IDs continue to work. Only developer-facing aliases change.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH  = resolve(__dirname, '..', '.env.local')
function loadEnvFromFile() {
  if (!existsSync(ENV_PATH)) return
  const text = readFileSync(ENV_PATH, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvFromFile()

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST
if (!STRIPE_KEY?.startsWith('sk_test_')) {
  console.error('ERROR: STRIPE_SECRET_KEY_TEST must be sk_test_*. Refusing to run against live mode.')
  process.exit(1)
}

const STRIPE_API = 'https://api.stripe.com/v1'
const authHeader = `Basic ${Buffer.from(STRIPE_KEY + ':').toString('base64')}`

async function sf(path, init = {}) {
  const res  = await fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}\n${text}`)
  return JSON.parse(text)
}

async function main() {
  // ── Find the SemiRX product by name ──────────────────────────
  let after = null
  let target = null
  while (!target) {
    const qs = new URLSearchParams({ active: 'true', limit: '100' })
    if (after) qs.set('starting_after', after)
    const page = await sf(`/products?${qs}`)
    for (const p of page.data || []) {
      if (/^SemiRX\b/i.test(p.name)) { target = p; break }
      // Already renamed? Skip silently — idempotent.
      if (/^CoreRX\b/i.test(p.name)) { console.log(`Product already CoreRX (${p.id}). No rename needed.`); break }
    }
    if (target || !page.has_more) break
    after = page.data[page.data.length - 1].id
  }

  if (target) {
    const newName = target.name.replace(/^SemiRX/i, 'CoreRX')
    console.log(`Renaming product ${target.id}: "${target.name}" → "${newName}"`)
    await sf(`/products/${target.id}`, {
      method: 'POST',
      body: new URLSearchParams({ name: newName }).toString(),
    })

    // Rename each price's lookup_key
    const prices = await sf(`/prices?product=${target.id}&active=true&limit=100`)
    for (const price of prices.data || []) {
      if (!price.lookup_key) continue
      const newKey = price.lookup_key.replace(/^semirx_/, 'corerx_')
      if (newKey === price.lookup_key) continue
      console.log(`  Updating price ${price.id} lookup_key: ${price.lookup_key} → ${newKey}`)
      await sf(`/prices/${price.id}`, {
        method: 'POST',
        body: new URLSearchParams({
          lookup_key: newKey,
          transfer_lookup_key: 'true',
        }).toString(),
      })
    }
  }

  console.log('\nDone.')
}

main().catch(err => { console.error('\nFAILED:', err.message); process.exit(2) })
