// scripts/stripe-webhook-fix.mjs
//
// Repairs the Stripe TEST webhook -> Supabase auth. ROOT CAUSE (2026-06-12):
// STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_B2C were NEVER set in Supabase,
// so stripe-webhook read undefined and returned 400 ("Webhook secret not
// configured") on every event -> no coach/B2C subscription ever activated.
//
// The signing secret can't be READ back from Stripe (only returned at creation),
// so we ROTATE: create a fresh endpoint with identical config (Stripe returns a
// new whsec_), write it straight into the Supabase Edge Function secret via the
// CLI, then delete the old endpoint. Stale endpoints pointing at the retired
// Cloudflare-worker path (myrxfit.com/stripe-webhooks/*) are removed too.
//
// SAFE ORDERING: auth-check -> create-new -> set-secret (rollback on failure) ->
// delete-old + delete-stale -> signed self-test. whsec_ values are NEVER printed.
//
// Usage:
//   node scripts/stripe-webhook-fix.mjs           # inspect (read-only)
//   node scripts/stripe-webhook-fix.mjs --fix      # rotate + create secrets + cleanup + self-test

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

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
const PROJECT_REF = 'xtxzfhoxyyrlxslgzvty'
const FIX = process.argv.includes('--fix')
const SUPA_FN = '.supabase.co/functions/v1/stripe-webhook'

async function stripe(method, path, formObj) {
  const opts = { method, headers: { ...AUTH } }
  if (formObj) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    opts.body = new URLSearchParams(formObj).toString()
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 300)}`)
  return data
}
const sourceOf = (url) => { try { return new URL(url).searchParams.get('source') } catch { return null } }
const secretEnvFor = (src) => (src === 'b2c' ? 'STRIPE_WEBHOOK_SECRET_B2C' : 'STRIPE_WEBHOOK_SECRET')
// CLI runner — shell:true so npx.cmd resolves on Windows; output captured, never inherited.
const supa = (args) => spawnSync('npx', ['--yes', 'supabase', ...args], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 })

const list = await stripe('GET', '/webhook_endpoints?limit=100')
const real  = list.data.filter(e => e.url.includes(SUPA_FN))
const stale = list.data.filter(e => !e.url.includes(SUPA_FN))
console.log(`\nendpoints: ${list.data.length}  (real=${real.length}, stale=${stale.length})`)
real.forEach(e => console.log(`  REAL  ${sourceOf(e.url) || '?'}  ${e.id}`))
stale.forEach(e => console.log(`  STALE ${e.id}  ${e.url}`))

if (!FIX) { console.log('\n(read-only — pass --fix)\n'); process.exit(0) }
if (real.length === 0) { console.error('\nFATAL: no supabase.co endpoints to rotate.'); process.exit(1) }

// 0. auth pre-check — touch nothing if we can't read secrets
if (supa(['secrets', 'list', '--project-ref', PROJECT_REF]).status !== 0) {
  console.error('\nFATAL: supabase CLI not authenticated for this project. Run `npx supabase login`.\n'); process.exit(1)
}
console.log('\nsupabase auth: OK')

// 1. create fresh endpoints (originals still live)
const created = []
for (const e of real) {
  const src = sourceOf(e.url) || 'coach_subs'
  const events = (e.enabled_events && e.enabled_events.length) ? e.enabled_events : ['*']
  const form = { url: e.url, description: `MyRX ${src} (supabase fn)` }
  events.forEach((ev, i) => { form[`enabled_events[${i}]`] = ev })
  const c = await stripe('POST', '/webhook_endpoints', form)
  created.push({ src, url: e.url, newId: c.id, oldId: e.id, env: secretEnvFor(src), secret: c.secret })
  console.log(`  created fresh ${src} endpoint: ${c.id}`)
}

// 2. write secrets into Supabase (values never printed; rollback on failure)
const kv = created.map(c => `${c.env}=${c.secret}`)
if (supa(['secrets', 'set', ...kv, '--project-ref', PROJECT_REF]).status !== 0) {
  for (const c of created) { try { await stripe('DELETE', `/webhook_endpoints/${c.newId}`) } catch {} }
  console.error('\nFATAL: could not write Supabase secrets — rolled back the new endpoints; originals untouched.\n'); process.exit(1)
}
console.log(`  supabase secrets set: OK (${[...new Set(created.map(c => c.env))].join(', ')})`)

// 3. delete the old real endpoints + every stale endpoint
for (const c of created) { await stripe('DELETE', `/webhook_endpoints/${c.oldId}`); console.log(`  deleted old ${c.src}: ${c.oldId}`) }
for (const e of stale)   { await stripe('DELETE', `/webhook_endpoints/${e.id}`);   console.log(`  deleted stale: ${e.id}`) }

// 4. signed self-test — prove the function now verifies signatures (an ignored event type)
console.log('\nself-test (signed request to each endpoint):')
for (const c of created) {
  const payload = JSON.stringify({ id: 'evt_selftest', object: 'event', type: 'customer.updated', data: { object: { id: 'obj_selftest' } } })
  const t = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', c.secret).update(`${t}.${payload}`).digest('hex')
  const res = await fetch(c.url, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}`, 'Content-Type': 'application/json' }, body: payload })
  const body = (await res.text()).slice(0, 120)
  const sigFail = res.status === 400 && /signature/i.test(body)
  console.log(`  ${c.src}: HTTP ${res.status}  ${sigFail ? 'SIGNATURE STILL FAILING (function may need a redeploy to pick up the secret)' : 'signature VERIFIED'}`)
}

console.log('\nDONE.\n')
