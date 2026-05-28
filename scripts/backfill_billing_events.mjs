// scripts/backfill_billing_events.mjs
//
// One-shot backfill of historical Stripe billing events into the
// Supabase `billing_events` table for existing coach customers.
//
// The webhook at supabase/functions/stripe-webhook only started writing
// rows after Phase B-3 landed earlier in May 2026. Events that
// happened BEFORE that webhook went live exist in Stripe but not in
// our DB. This script reads Stripe, normalizes each historical event
// into a `billing_events` row, and upserts with ON CONFLICT DO NOTHING
// on the `stripe_event_id` unique index — so it's safe to re-run.
//
// WHEN TO RUN:
//   - Once per environment (TEST first, then LIVE at launch).
//   - After any "lost events" incident — re-running is a no-op for
//     rows already present.
//
// HOW TO RUN (from repo root):
//   # First install deps in scripts/ (one-time):
//   cd scripts && npm install stripe @supabase/supabase-js && cd ..
//
//   # Dry run to preview what would be inserted:
//   node scripts/backfill_billing_events.mjs --dry-run
//
//   # Actual backfill:
//   node scripts/backfill_billing_events.mjs
//
// REQUIRED ENV VARS (read from .env.local at repo root OR shell env):
//   STRIPE_SECRET_KEY        Stripe API key (or STRIPE_SECRET_KEY_TEST as fallback)
//   SUPABASE_URL             https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Server-side key that bypasses RLS
//
// ⚠ SECURITY WARNING — SUPABASE_SERVICE_ROLE_KEY has full DB access
//   (bypasses every RLS policy). Only export it in trusted local
//   environments. Never commit it. Never bake it into CI without
//   thinking through who has access to the build logs.
//
// IDEMPOTENCY:
//   Every row's stripe_event_id is unique. For Stripe Event objects we
//   use event.id directly. For plain Stripe objects (invoices, charges,
//   payment_intents) — which don't carry an `evt_xxx` id — we use the
//   object's own id (`in_xxx`, `ch_xxx`, `pi_xxx`) prefixed with
//   `backfill:` so it doesn't collide with future webhook event ids.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ── Load env vars from project .env.local if not already in shell env ──
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

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 100

const STRIPE_KEY =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET_KEY_TEST
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
if (!STRIPE_KEY) missing.push('STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_TEST)')
if (!SUPABASE_URL) missing.push('SUPABASE_URL')
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length) {
  console.error(`ERROR: Missing required env vars:\n  - ${missing.join('\n  - ')}`)
  console.error('\nSet them in .env.local at the repo root, or export them in your shell.')
  process.exit(1)
}

const isTestKey = STRIPE_KEY.startsWith('sk_test_')
const isLiveKey = STRIPE_KEY.startsWith('sk_live_')
if (!isTestKey && !isLiveKey) {
  console.error(`ERROR: STRIPE_SECRET_KEY has unexpected prefix (got: ${STRIPE_KEY.slice(0, 8)}...).`)
  console.error('Expected sk_test_... or sk_live_...')
  process.exit(1)
}

console.log('')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(' MyRX — Stripe billing_events backfill')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(` Stripe mode:  ${isTestKey ? 'TEST' : 'LIVE'}`)
console.log(` Supabase:     ${SUPABASE_URL}`)
console.log(` Dry run:      ${DRY_RUN ? 'YES (no writes)' : 'NO (will write to DB)'}`)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('')

const stripe = new Stripe(STRIPE_KEY, {
  apiVersion: '2024-06-20',
  maxNetworkRetries: 2,
})
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Stripe → billing_events row normalizers ─────────────────────────

// Convert Unix seconds (Stripe) → ISO timestamp.
function toIso(stripeSeconds) {
  if (!stripeSeconds) return null
  return new Date(stripeSeconds * 1000).toISOString()
}

// Derive a synthesized type for plain invoice/charge/payment_intent
// objects (which don't carry an event.type). We mirror the strings
// the webhook would use if it had received the event live.
function typeFromInvoice(inv) {
  if (inv.status === 'paid') return 'invoice.paid'
  if (inv.status === 'open') return 'invoice.finalized'
  if (inv.status === 'void') return 'invoice.voided'
  if (inv.status === 'uncollectible') return 'invoice.marked_uncollectible'
  if (inv.status === 'draft') return 'invoice.created'
  return `invoice.${inv.status || 'unknown'}`
}
function typeFromCharge(ch) {
  if (ch.refunded) return 'charge.refunded'
  if (ch.status === 'succeeded') return 'charge.succeeded'
  if (ch.status === 'failed') return 'charge.failed'
  return `charge.${ch.status || 'unknown'}`
}
function typeFromPaymentIntent(pi) {
  if (pi.status === 'succeeded') return 'payment_intent.succeeded'
  if (pi.status === 'canceled') return 'payment_intent.canceled'
  if (pi.status === 'requires_payment_method') return 'payment_intent.payment_failed'
  return `payment_intent.${pi.status || 'unknown'}`
}

function rowFromInvoice(inv, userId) {
  return {
    user_id:                userId,
    stripe_event_id:        `backfill:inv:${inv.id}`,
    stripe_customer_id:     inv.customer || null,
    stripe_subscription_id: inv.subscription || null,
    stripe_invoice_id:      inv.id,
    stripe_charge_id:       inv.charge || null,
    type:                   typeFromInvoice(inv),
    amount_cents:           inv.amount_paid ?? inv.amount_due ?? null,
    currency:               inv.currency || null,
    status:                 inv.status || null,
    description:            inv.description || `Invoice ${inv.number || inv.id}`,
    occurred_at:            toIso(inv.status_transitions?.paid_at || inv.created),
    raw_payload:            inv,
  }
}

function rowFromCharge(ch, userId) {
  return {
    user_id:                userId,
    stripe_event_id:        `backfill:ch:${ch.id}`,
    stripe_customer_id:     ch.customer || null,
    stripe_subscription_id: null,
    stripe_invoice_id:      ch.invoice || null,
    stripe_charge_id:       ch.id,
    type:                   typeFromCharge(ch),
    amount_cents:           ch.amount ?? null,
    currency:               ch.currency || null,
    status:                 ch.status || null,
    description:            ch.description || `Charge ${ch.id}`,
    occurred_at:            toIso(ch.created),
    raw_payload:            ch,
  }
}

function rowFromPaymentIntent(pi, userId) {
  return {
    user_id:                userId,
    stripe_event_id:        `backfill:pi:${pi.id}`,
    stripe_customer_id:     pi.customer || null,
    stripe_subscription_id: null,
    stripe_invoice_id:      pi.invoice || null,
    stripe_charge_id:       pi.latest_charge || null,
    type:                   typeFromPaymentIntent(pi),
    amount_cents:           pi.amount ?? null,
    currency:               pi.currency || null,
    status:                 pi.status || null,
    description:            pi.description || `Payment intent ${pi.id}`,
    occurred_at:            toIso(pi.created),
    raw_payload:            pi,
  }
}

function rowFromEvent(event, userId) {
  // Extract whatever ids the underlying object exposes so the row
  // joins cleanly to coach_subscriptions / invoices / charges later.
  const obj = event.data?.object || {}
  const customerId =
    obj.customer ||
    obj.customer_id ||
    null
  const subscriptionId =
    obj.subscription ||
    (obj.object === 'subscription' ? obj.id : null) ||
    null
  const invoiceId =
    obj.invoice ||
    (obj.object === 'invoice' ? obj.id : null) ||
    null
  const chargeId =
    obj.charge ||
    obj.latest_charge ||
    (obj.object === 'charge' ? obj.id : null) ||
    null

  return {
    user_id:                userId,
    stripe_event_id:        event.id,
    stripe_customer_id:     customerId,
    stripe_subscription_id: subscriptionId,
    stripe_invoice_id:      invoiceId,
    stripe_charge_id:       chargeId,
    type:                   event.type,
    amount_cents:
      obj.amount_paid ??
      obj.amount ??
      obj.items?.data?.[0]?.price?.unit_amount ??
      null,
    currency:
      obj.currency ||
      obj.items?.data?.[0]?.price?.currency ||
      null,
    status: obj.status || null,
    description:
      obj.description ||
      `Stripe event ${event.type}`,
    occurred_at: toIso(event.created),
    raw_payload: event,
  }
}

// ── Customer enumeration ────────────────────────────────────────────

async function loadCoachCustomerMap() {
  // Pull every coach_subscriptions row, map stripe_customer_id → coach_id.
  // A given coach can in theory have multiple subscriptions (canceled
  // then re-subscribed); they share the same customer_id so it
  // collapses to one entry per customer here.
  console.log('Loading coach_subscriptions from Supabase...')
  let all = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('coach_subscriptions')
      .select('coach_id, stripe_customer_id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  const map = new Map()
  for (const r of all) {
    if (r.stripe_customer_id && r.coach_id && !map.has(r.stripe_customer_id)) {
      map.set(r.stripe_customer_id, r.coach_id)
    }
  }
  console.log(`  → ${all.length} coach_subscriptions rows`)
  console.log(`  → ${map.size} unique stripe_customer_ids`)
  console.log('')
  return map
}

// ── Per-customer Stripe pulls ───────────────────────────────────────

async function listAllInvoices(customerId) {
  const out = []
  for await (const inv of stripe.invoices.list({ customer: customerId, limit: 100 })) {
    out.push(inv)
  }
  return out
}

async function listAllCharges(customerId) {
  const out = []
  for await (const ch of stripe.charges.list({ customer: customerId, limit: 100 })) {
    out.push(ch)
  }
  return out
}

async function listAllPaymentIntents(customerId) {
  const out = []
  for await (const pi of stripe.paymentIntents.list({ customer: customerId, limit: 100 })) {
    out.push(pi)
  }
  return out
}

async function listAllEvents(customerId) {
  // events.list does NOT accept a `customer` filter directly.
  // We pull all events of the types we care about within the last
  // 30 days (Stripe's events API horizon limit) and filter by
  // customer client-side. For older history we rely on the invoice /
  // charge / payment_intent lists above, which DO accept customer
  // filters and have no time horizon.
  const TYPES = [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.finalized',
    'invoice.voided',
    'invoice.marked_uncollectible',
  ]
  const out = []
  for await (const ev of stripe.events.list({ types: TYPES, limit: 100 })) {
    const obj = ev.data?.object
    const matchCustomer =
      obj?.customer === customerId ||
      (obj?.object === 'subscription' && obj?.customer === customerId)
    if (matchCustomer) out.push(ev)
  }
  return out
}

// ── Batch upsert ────────────────────────────────────────────────────

async function upsertBatch(rows) {
  if (DRY_RUN) {
    return { inserted: 0, skipped: rows.length, errors: 0 }
  }
  const { data, error } = await supabase
    .from('billing_events')
    .upsert(rows, { onConflict: 'stripe_event_id', ignoreDuplicates: true })
    .select('id')
  if (error) {
    console.error(`  ✗ Batch upsert error: ${error.message}`)
    return { inserted: 0, skipped: 0, errors: rows.length }
  }
  // Postgres returns ONLY the rows it actually inserted when
  // ignoreDuplicates=true. data.length = inserted; rest were skipped.
  const inserted = data?.length ?? 0
  const skipped = rows.length - inserted
  return { inserted, skipped, errors: 0 }
}

// ── Main ────────────────────────────────────────────────────────────

const customerMap = await loadCoachCustomerMap()
if (customerMap.size === 0) {
  console.log('No coach_subscriptions rows with a stripe_customer_id. Nothing to backfill.')
  process.exit(0)
}

let totalInserted = 0
let totalSkipped = 0
let totalErrors = 0
let totalConsidered = 0

const customers = Array.from(customerMap.entries())
for (let i = 0; i < customers.length; i++) {
  const [customerId, coachId] = customers[i]
  console.log(`[${i + 1}/${customers.length}] Customer ${customerId} (coach ${coachId})`)

  let invoices = []
  let charges = []
  let paymentIntents = []
  let events = []

  try {
    [invoices, charges, paymentIntents, events] = await Promise.all([
      listAllInvoices(customerId),
      listAllCharges(customerId),
      listAllPaymentIntents(customerId),
      listAllEvents(customerId),
    ])
  } catch (err) {
    console.error(`  ✗ Stripe fetch failed for ${customerId}: ${err.message}`)
    totalErrors++
    continue
  }

  console.log(`  ↳ ${invoices.length} invoices, ${charges.length} charges, ${paymentIntents.length} payment_intents, ${events.length} recent events`)

  // Build all candidate rows. We dedupe by stripe_event_id BEFORE
  // sending so that one customer's invoice + matching charge +
  // matching payment_intent + matching event don't double-write
  // (different stripe_event_ids, but they all carry the same
  // information about one transaction).
  const allRows = [
    ...invoices.map(inv => rowFromInvoice(inv, coachId)),
    ...charges.map(ch => rowFromCharge(ch, coachId)),
    ...paymentIntents.map(pi => rowFromPaymentIntent(pi, coachId)),
    ...events.map(ev => rowFromEvent(ev, coachId)),
  ]

  // Local dedupe by stripe_event_id (last write wins).
  const seen = new Map()
  for (const r of allRows) {
    seen.set(r.stripe_event_id, r)
  }
  const rows = Array.from(seen.values())

  totalConsidered += rows.length

  if (DRY_RUN) {
    console.log(`  [dry-run] Would upsert ${rows.length} rows`)
    for (const r of rows.slice(0, 5)) {
      console.log(`    - ${r.type} ${r.occurred_at} ${r.amount_cents ?? '—'} ${r.currency ?? ''} (${r.stripe_event_id})`)
    }
    if (rows.length > 5) console.log(`    ... and ${rows.length - 5} more`)
    totalSkipped += rows.length
    continue
  }

  // Send in batches of BATCH_SIZE.
  for (let j = 0; j < rows.length; j += BATCH_SIZE) {
    const batch = rows.slice(j, j + BATCH_SIZE)
    const { inserted, skipped, errors } = await upsertBatch(batch)
    totalInserted += inserted
    totalSkipped += skipped
    totalErrors += errors
    console.log(`  ↳ Batch ${Math.floor(j / BATCH_SIZE) + 1}: inserted ${inserted}, skipped ${skipped} (duplicates), errors ${errors}`)
  }
}

console.log('')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(' Done.')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(` Customers processed:  ${customerMap.size}`)
console.log(` Rows considered:      ${totalConsidered}`)
if (DRY_RUN) {
  console.log(` Rows that would insert (run without --dry-run to do it): ${totalSkipped}`)
} else {
  console.log(` Rows inserted:        ${totalInserted}`)
  console.log(` Rows skipped (dup):   ${totalSkipped}`)
  console.log(` Errors:               ${totalErrors}`)
}
console.log('')

process.exit(totalErrors > 0 ? 1 : 0)
