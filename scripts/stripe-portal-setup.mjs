// scripts/stripe-portal-setup.mjs
//
// Activates the Stripe TEST-mode Customer Portal. The coach-billing-portal edge
// function creates portal sessions WITHOUT an explicit `configuration`, so Stripe
// requires a DEFAULT portal configuration to exist -- otherwise session.create
// 400s with "default configuration has not been created" and the coach
// "Manage plan" button errors. This creates that default config (invoice history
// + payment-method update + cancel-at-period-end, matching the legal "cancel
// forward" policy) and self-tests an end-to-end session exactly the way the edge
// function does (no `configuration` param), then cleans up the temp customer.
//
// Usage:
//   node scripts/stripe-portal-setup.mjs           # inspect (read-only)
//   node scripts/stripe-portal-setup.mjs --apply    # ensure default config + self-test

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '..', '.env.local')
if (existsSync(ENV_PATH)) {
  for (const raw of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}

const KEY = process.env.STRIPE_SECRET_KEY_TEST
if (!KEY) { console.error('FATAL: STRIPE_SECRET_KEY_TEST not found in env or .env.local'); process.exit(1) }
const AUTH = { Authorization: `Basic ${Buffer.from(KEY + ':').toString('base64')}` }
const APPLY = process.argv.includes('--apply')

async function stripe(method, path, formObj) {
  const opts = { method, headers: { ...AUTH } }
  if (formObj) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    opts.body = new URLSearchParams(formObj).toString()
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 400)}`)
  return data
}
const feat = (c) => `invoice=${c?.features?.invoice_history?.enabled} pmUpdate=${c?.features?.payment_method_update?.enabled} cancel=${c?.features?.subscription_cancel?.enabled}(${c?.features?.subscription_cancel?.mode || '-'})`

// 1. inspect existing configurations
const cfgs = await stripe('GET', '/billing_portal/configurations?limit=100')
const def = cfgs.data.find(c => c.is_default)
console.log(`\nportal configs: ${cfgs.data.length}   default: ${def ? def.id : 'NONE'}`)
if (def) console.log(`  default features: ${feat(def)}`)

if (!APPLY) { console.log('\n(read-only -- pass --apply to ensure the default config + self-test)\n'); process.exit(0) }

// 2. ensure a default config exists (create one if none)
let configId = def?.id
if (!configId) {
  const form = {
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',         // coach cancels FORWARD (matches legal: no mid-period refund)
    'features[subscription_cancel][proration_behavior]': 'none',
    'business_profile[privacy_policy_url]': 'https://myrxfit.com/privacy',
    'business_profile[terms_of_service_url]': 'https://myrxfit.com/terms',
    'default_return_url': 'https://coach.myrxfit.com/me',
  }
  const created = await stripe('POST', '/billing_portal/configurations', form)
  configId = created.id
  console.log(`  created config ${created.id}   is_default=${created.is_default}   ${feat(created)}`)
} else {
  console.log('  default already exists -- not creating another.')
}

// 3. self-test: temp customer -> portal session WITH NO `configuration` param (exactly like the edge fn) -> cleanup
const cust = await stripe('POST', '/customers', { description: 'MyRX portal self-test (safe to delete)' })
let sessionOk = false
try {
  const sess = await stripe('POST', '/billing_portal/sessions', { customer: cust.id, return_url: 'https://coach.myrxfit.com/me' })
  sessionOk = !!sess.url
  console.log(`  self-test (no-config session, like the edge fn): ${sessionOk ? 'OK -- default config resolves, Manage plan will work' : 'NO URL'}`)
} catch (e) {
  console.log(`  self-test FAILED: ${e.message}`)
  console.log('  -> the created config is NOT the account default; coach-billing-portal must pass `configuration` explicitly, OR set this config as default in the dashboard.')
} finally {
  try { await stripe('DELETE', `/customers/${cust.id}`); console.log(`  cleaned up temp customer ${cust.id}`) } catch {}
}

console.log(`\n${sessionOk ? 'DONE -- portal is live in test mode.' : 'INCOMPLETE -- see note above.'}\n`)
