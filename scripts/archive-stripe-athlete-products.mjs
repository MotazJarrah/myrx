// scripts/archive-stripe-athlete-products.mjs
//
// T099: athletes subscribe ONLY via Apple/Google IAP (never Stripe), so the
// athlete Stripe products (CoreRX / FullRX, metadata myrx_audience=athlete)
// created in setup-stripe-sandbox-prices.mjs (T096 Step 1) are UNUSED. This
// archives them + their active prices (active=false) in TEST mode so they
// don't clutter the catalog. Coach products (myrx_audience=coach) are NOT
// touched. Fully reversible: re-run setup-stripe-sandbox-prices.mjs to revive.
//
// TEST MODE ONLY — refuses to run unless the key starts with sk_test_.
//
// Usage: node scripts/archive-stripe-athlete-products.mjs   (pulls key from .env.local)

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
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
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

async function listProducts(active) {
  const out = []
  let after = null
  while (true) {
    const qs = new URLSearchParams({ active: String(active), limit: '100' })
    if (after) qs.set('starting_after', after)
    const page = await stripeFetch(`/products?${qs}`)
    out.push(...(page.data || []))
    if (!page.has_more) break
    after = page.data[page.data.length - 1].id
  }
  return out
}

async function listActivePrices(productId) {
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

async function main() {
  console.log('Stripe TEST mode — archiving UNUSED athlete products (CoreRX / FullRX). Coach products are NOT touched.\n')
  const active = await listProducts(true)
  const athletes = active.filter(p => p.metadata?.myrx_audience === 'athlete')
  if (athletes.length === 0) {
    console.log('No ACTIVE athlete products found — already archived (or never created). Nothing to do.')
    return
  }
  for (const prod of athletes) {
    const prices = await listActivePrices(prod.id)
    for (const pr of prices) {
      await stripeFetch(`/prices/${pr.id}`, { method: 'POST', body: 'active=false' })
      console.log(`  price   ${(pr.lookup_key || pr.id).padEnd(22)} archived ${pr.id}`)
    }
    await stripeFetch(`/products/${prod.id}`, { method: 'POST', body: 'active=false' })
    console.log(`product   ${prod.name.padEnd(14)} archived ${prod.id} (tier=${prod.metadata?.myrx_tier})`)
  }
  const stillActive = (await listProducts(true)).filter(p => p.metadata?.myrx_audience === 'athlete')
  const coachActive = (await listProducts(true)).filter(p => p.metadata?.myrx_audience === 'coach')
  console.log(`\nDone. Active athlete products remaining: ${stillActive.length} (expect 0). Active coach products: ${coachActive.length} (untouched). Reversible via setup-stripe-sandbox-prices.mjs.`)
}

main().catch(err => { console.error('\nFAILED:', err.message); process.exit(2) })
