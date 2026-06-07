// scripts/setup-stripe-sandbox-prices.mjs
//
// STEP 1 of the billing build (2026-06-06 pricing lock): create / align the
// Stripe TEST-mode product + price catalog to the final locked pricing.
//
// Final locked catalog (all RECURRING subscriptions; Free has no Stripe product):
//
//   Athlete:
//     CoreRX        $4.99 / mo   ($49.99 / yr)
//     FullRX        $6.99 / mo   ($69.99 / yr)
//   Coach (every tier grants FullRX to coach + linked athletes; differ by client cap):
//     Coach Starter $19 / mo     ($189 / yr)
//     Coach Pro     $39 / mo     ($389 / yr)
//     Coach Elite   $99 / mo     ($989 / yr)
//
// Stable lookup_keys the app references:  <tier>_monthly  /  <tier>_annual
//   corerx_monthly, corerx_annual, fullrx_monthly, fullrx_annual,
//   coach_starter_monthly, coach_starter_annual, coach_pro_monthly,
//   coach_pro_annual, coach_elite_monthly, coach_elite_annual
//
// Idempotent: re-running is a no-op once the catalog matches. A price's
// amount/interval are immutable in Stripe, so when a lookup_key points at a
// price with the WRONG amount/interval (or a one-time price), we create a new
// recurring price, move the lookup_key onto it (transfer_lookup_key), and
// archive the old one. The retired athlete one-time prices
// (corerx_onetime / fullrx_onetime) are archived.
//
// TEST MODE ONLY — refuses to run unless the key starts with sk_test_.
//
// Usage:
//   node scripts/setup-stripe-sandbox-prices.mjs            (pulls key from .env.local)
//   STRIPE_SECRET_KEY_TEST=sk_test_... node scripts/setup-stripe-sandbox-prices.mjs

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
  console.error(`ERROR: STRIPE_SECRET_KEY_TEST must start with sk_test_ (got prefix: ${STRIPE_KEY.slice(0, 8)}). Refusing to run against live mode.`)
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
  if (!res.ok) throw new Error(`Stripe ${init.method || 'GET'} ${path} -> ${res.status}\n${text}`)
  return json
}

// ── Desired catalog (amounts in cents) ─────────────────────────────
const CATALOG = [
  { name: 'CoreRX',        tier: 'corerx',        audience: 'athlete', monthly: 499,  annual: 4999  },
  { name: 'FullRX',        tier: 'fullrx',        audience: 'athlete', monthly: 699,  annual: 6999  },
  { name: 'Coach Starter', tier: 'coach_starter', audience: 'coach',   monthly: 1900, annual: 18900 },
  { name: 'Coach Pro',     tier: 'coach_pro',     audience: 'coach',   monthly: 3900, annual: 38900 },
  { name: 'Coach Elite',   tier: 'coach_elite',   audience: 'coach',   monthly: 9900, annual: 98900 },
]
const RETIRE_LOOKUP_KEYS = ['corerx_onetime', 'fullrx_onetime'] // old one-time athlete prices

const log = []

async function listAllProducts() {
  const out = []
  let after = null
  while (true) {
    const qs = new URLSearchParams({ active: 'true', limit: '100' })
    if (after) qs.set('starting_after', after)
    const page = await stripeFetch(`/products?${qs}`)
    out.push(...(page.data || []))
    if (!page.has_more) break
    after = page.data[page.data.length - 1].id
  }
  return out
}

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

async function findPriceByLookupKey(lk) {
  const qs = new URLSearchParams({ active: 'true', limit: '1' })
  qs.append('lookup_keys[]', lk)
  const page = await stripeFetch(`/prices?${qs}`)
  return (page.data && page.data[0]) || null
}

async function findOrCreateProduct(entry, allProducts) {
  let prod = allProducts.find(p => p.metadata?.myrx_tier === entry.tier)
            || allProducts.find(p => p.name.toLowerCase() === entry.name.toLowerCase())
  if (prod) {
    // Ensure metadata is set for stable future lookups.
    if (prod.metadata?.myrx_tier !== entry.tier || prod.metadata?.myrx_audience !== entry.audience) {
      const body = new URLSearchParams()
      body.set('metadata[myrx_tier]', entry.tier)
      body.set('metadata[myrx_audience]', entry.audience)
      prod = await stripeFetch(`/products/${prod.id}`, { method: 'POST', body: body.toString() })
      log.push(`product  ${entry.name.padEnd(14)} reused ${prod.id} (metadata set)`)
    } else {
      log.push(`product  ${entry.name.padEnd(14)} reused ${prod.id}`)
    }
    return prod
  }
  const body = new URLSearchParams()
  body.set('name', entry.name)
  body.set('metadata[myrx_tier]', entry.tier)
  body.set('metadata[myrx_audience]', entry.audience)
  prod = await stripeFetch('/products', { method: 'POST', body: body.toString() })
  log.push(`product  ${entry.name.padEnd(14)} CREATED ${prod.id}`)
  return prod
}

async function ensurePrice(product, lookupKey, amount, interval) {
  const existing = (await listPricesForProduct(product.id)).find(p => p.lookup_key === lookupKey)
  const ok = existing
    && existing.unit_amount === amount
    && existing.recurring
    && existing.recurring.interval === interval
    && existing.currency === 'usd'
  if (ok) {
    log.push(`  price  ${lookupKey.padEnd(22)} ok      ${existing.id}  $${(amount/100).toFixed(2)}/${interval}`)
    return existing
  }
  // Create the correct recurring price + move the lookup_key onto it.
  const body = new URLSearchParams()
  body.set('product', product.id)
  body.set('currency', 'usd')
  body.set('unit_amount', String(amount))
  body.set('recurring[interval]', interval)
  body.set('lookup_key', lookupKey)
  body.set('transfer_lookup_key', 'true')
  body.set('nickname', `${product.name} ${interval === 'month' ? 'Monthly' : 'Annual'}`)
  const created = await stripeFetch('/prices', { method: 'POST', body: body.toString() })
  // Archive the stale price the key used to live on (if any + different).
  if (existing && existing.id !== created.id) {
    await stripeFetch(`/prices/${existing.id}`, { method: 'POST', body: 'active=false' })
    log.push(`  price  ${lookupKey.padEnd(22)} CREATED ${created.id}  $${(amount/100).toFixed(2)}/${interval}  (archived old ${existing.id})`)
  } else {
    log.push(`  price  ${lookupKey.padEnd(22)} CREATED ${created.id}  $${(amount/100).toFixed(2)}/${interval}`)
  }
  return created
}

async function archiveRetired() {
  for (const lk of RETIRE_LOOKUP_KEYS) {
    const p = await findPriceByLookupKey(lk)
    if (p) {
      await stripeFetch(`/prices/${p.id}`, { method: 'POST', body: 'active=false' })
      log.push(`retire   ${lk.padEnd(22)} archived ${p.id}`)
    }
  }
}

async function main() {
  console.log('Stripe TEST mode — aligning product + price catalog to the locked pricing.\n')
  const allProducts = await listAllProducts()
  for (const entry of CATALOG) {
    const product = await findOrCreateProduct(entry, allProducts)
    await ensurePrice(product, `${entry.tier}_monthly`, entry.monthly, 'month')
    await ensurePrice(product, `${entry.tier}_annual`,  entry.annual,  'year')
  }
  await archiveRetired()

  console.log(log.join('\n'))
  console.log('\nDone. Final catalog is in Stripe TEST mode. Re-run anytime — it is idempotent.')
}

main().catch(err => { console.error('\nFAILED:', err.message); process.exit(2) })
