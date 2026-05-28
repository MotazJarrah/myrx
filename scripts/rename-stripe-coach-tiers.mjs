// scripts/rename-stripe-coach-tiers.mjs
//
// One-shot rename of the coach-platform Stripe products + prices in
// TEST mode so the lookup_keys match the canonical naming we use
// everywhere else in the app (per CLAUDE.md, May 24 2026 lock):
//
//   Tier:  starter / pro / elite          (NOT "unlimited")
//   Cadence: monthly / annual             (NOT "yearly")
//
// What this rewrites:
//
//   Product:   "Coach Unlimited"        → "Coach Elite"
//   Price LK:  coach_unlimited_monthly  → coach_elite_monthly
//   Price LK:  coach_unlimited_yearly   → coach_elite_annual
//   Price LK:  coach_starter_yearly     → coach_starter_annual
//   Price LK:  coach_pro_yearly         → coach_pro_annual
//
// Idempotent: re-running after a successful pass is a no-op (each step
// reads current state + only writes when a delta exists).
//
// Stripe is the source of truth here — we're NOT renaming any IDs
// (prices/products keep their `price_XXX` IDs unchanged), so any
// existing subscriptions / customers / payment_methods tied to the
// old IDs continue to work without interruption. Only the
// developer-facing aliases (lookup_keys + product name) change.
//
// Usage:
//   STRIPE_SECRET_KEY_TEST=sk_test_... node scripts/rename-stripe-coach-tiers.mjs
// OR (auto-pulls from project root .env.local):
//   node scripts/rename-stripe-coach-tiers.mjs

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Load STRIPE_SECRET_KEY_TEST from project .env.local if not in env ──
const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '..', '.env.local')
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
if (!STRIPE_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY_TEST not set. Add it to .env.local or export it.')
  process.exit(1)
}
if (!STRIPE_KEY.startsWith('sk_test_')) {
  console.error(`ERROR: STRIPE_SECRET_KEY_TEST should start with sk_test_ (got prefix: ${STRIPE_KEY.slice(0,8)}). Refusing to run against live mode.`)
  process.exit(1)
}

const STRIPE_API = 'https://api.stripe.com/v1'
const authHeader = `Basic ${Buffer.from(STRIPE_KEY + ':').toString('base64')}`

async function stripeFetch(path, init = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  if (!res.ok) {
    throw new Error(`Stripe ${init.method || 'GET'} ${path} → ${res.status}\n${text}`)
  }
  return json
}

// ── Step 1: find the coach products by name ──────────────────────
//
// We can't search by lookup_key on Products — lookup_key is a Price
// concept. So we list active products and filter by name.
async function listCoachProducts() {
  const out = []
  let after = null
  while (true) {
    const qs = new URLSearchParams({ active: 'true', limit: '100' })
    if (after) qs.set('starting_after', after)
    const page = await stripeFetch(`/products?${qs}`)
    for (const p of page.data || []) {
      if (/^Coach /i.test(p.name)) out.push(p)
    }
    if (!page.has_more) break
    after = page.data[page.data.length - 1].id
  }
  return out
}

// ── Step 2: list all prices on a product ─────────────────────────
async function listPricesForProduct(productId) {
  const out = []
  let after = null
  while (true) {
    const qs = new URLSearchParams({ product: productId, active: 'true', limit: '100' })
    if (after) qs.set('starting_after', after)
    const page = await stripeFetch(`/prices?${qs}`)
    out.push(...(page.data || []))
    if (!page.has_more) break
    after = page.data[page.data.length - 1].id
  }
  return out
}

// ── Step 3: rename helpers ───────────────────────────────────────
function newLookupKeyFor(oldKey) {
  if (!oldKey) return null
  // Map old → new in two passes: unlimited → elite, then yearly → annual.
  return oldKey
    .replace(/^coach_unlimited_/, 'coach_elite_')
    .replace(/_yearly$/, '_annual')
}

async function updatePriceLookupKey(priceId, newLookupKey) {
  // Stripe requires `lookup_key` to be unique across active prices.
  // If a price with the new key already exists (e.g. a previous half-
  // run), we'd collide. The library handles this via transfer_lookup_key:
  // we set the new key on this price AND pass transfer_lookup_key=true
  // to move it off any conflicting price.
  const body = new URLSearchParams({
    lookup_key: newLookupKey,
    transfer_lookup_key: 'true',
  })
  return stripeFetch(`/prices/${priceId}`, { method: 'POST', body: body.toString() })
}

async function updateProductName(productId, newName) {
  const body = new URLSearchParams({ name: newName })
  return stripeFetch(`/products/${productId}`, { method: 'POST', body: body.toString() })
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('Listing coach products in TEST mode…')
  const products = await listCoachProducts()
  console.log(`  Found ${products.length} coach-* product(s):`)
  for (const p of products) console.log(`    • ${p.id}  ${p.name}`)

  let nameRenames = 0
  let lookupKeyRenames = 0

  for (const product of products) {
    // Rename product if it's still "Coach Unlimited"
    if (/^Coach Unlimited\b/i.test(product.name)) {
      const newName = product.name.replace(/^Coach Unlimited/i, 'Coach Elite')
      console.log(`\nRenaming product ${product.id}: "${product.name}" → "${newName}"`)
      await updateProductName(product.id, newName)
      nameRenames++
    }

    // Rename each price's lookup_key
    const prices = await listPricesForProduct(product.id)
    for (const price of prices) {
      const oldKey = price.lookup_key
      const newKey = newLookupKeyFor(oldKey)
      if (!oldKey || !newKey || oldKey === newKey) continue
      console.log(`\n  Updating price ${price.id} lookup_key: ${oldKey} → ${newKey}`)
      await updatePriceLookupKey(price.id, newKey)
      lookupKeyRenames++
    }
  }

  console.log(`\nDone. Renamed ${nameRenames} product name(s), ${lookupKeyRenames} price lookup_key(s).`)
}

main().catch(err => {
  console.error('\nFAILED:', err.message)
  process.exit(2)
})
