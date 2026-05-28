// stripe-webhook
//
// Public Supabase Edge Function (verify_jwt=false) — Stripe sends webhook
// events here directly. Replaces the Cloudflare Worker we initially built
// because edge functions automatically have SUPABASE_SERVICE_ROLE_KEY
// injected as an env var (workers don't), eliminating one manual setup
// step. Signature verification + DB writes happen here.
//
// Handles BOTH coach subscriptions and B2C one-time purchases via a single
// endpoint, dispatched internally by event.type:
//
//   customer.subscription.created    → upsert coach_subscriptions + mirror to profiles
//   customer.subscription.updated    → upsert coach_subscriptions + mirror to profiles
//   customer.subscription.deleted    → cancel coach_subscriptions + mirror to profiles
//   invoice.paid                     → mark coach_subscriptions active + mirror
//   invoice.payment_failed           → mark coach_subscriptions past_due + mirror
//   checkout.session.completed       → if mode=payment (B2C), insert b2c_purchases
//
// Stripe sends the webhook signature in the `Stripe-Signature` header.
// We verify HMAC-SHA256 using STRIPE_WEBHOOK_SECRET (and STRIPE_WEBHOOK_SECRET_B2C
// if the request URL has ?source=b2c — we registered TWO Stripe endpoints
// for forward compatibility, each with its own signing secret).
//
// Auto-injected by Supabase:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Must be set manually via Supabase Dashboard → Edge Functions → Secrets:
//   STRIPE_WEBHOOK_SECRET            whsec_... for the coach-subs endpoint
//   STRIPE_WEBHOOK_SECRET_B2C        whsec_... for the b2c-purchases endpoint
//   STRIPE_MODE                      'test' or 'live' (defaults to 'test')
//   STRIPE_SECRET_KEY_TEST           sk_test_... (needed for price lookup on subscription events)
//   STRIPE_SECRET_KEY_LIVE           sk_live_... (set at launch only)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const STRIPE_MODE          = Deno.env.get("STRIPE_MODE") ?? "test"
const STRIPE_SECRET        = STRIPE_MODE === "live"
  ? Deno.env.get("STRIPE_SECRET_KEY_LIVE")!
  : Deno.env.get("STRIPE_SECRET_KEY_TEST")!
const WEBHOOK_SECRET       = Deno.env.get("STRIPE_WEBHOOK_SECRET")!
const WEBHOOK_SECRET_B2C   = Deno.env.get("STRIPE_WEBHOOK_SECRET_B2C") ?? WEBHOOK_SECRET

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Stripe-Signature, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function txt(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain" } })
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

// ── Stripe signature verification (Web Crypto / Deno-compatible) ────
const SIG_TOLERANCE_SECONDS = 300  // 5 min replay window

function parseSigHeader(header: string) {
  const parts = header.split(",").map(p => p.trim())
  let timestamp: number | null = null
  const v1signatures: string[] = []
  for (const p of parts) {
    const [k, v] = p.split("=", 2)
    if (k === "t") timestamp = Number(v)
    else if (k === "v1") v1signatures.push(v)
  }
  return { timestamp, v1signatures }
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function verifyWebhook(rawBody: string, sigHeader: string, secret: string): Promise<any> {
  if (!sigHeader) throw new Error("Missing Stripe-Signature header")
  if (!secret) throw new Error("Webhook secret not configured")
  const { timestamp, v1signatures } = parseSigHeader(sigHeader)
  if (!timestamp || v1signatures.length === 0) {
    throw new Error("Malformed Stripe-Signature header")
  }
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - timestamp) > SIG_TOLERANCE_SECONDS) {
    throw new Error(`Webhook timestamp outside tolerance window`)
  }
  const signedPayload = `${timestamp}.${rawBody}`
  const expectedSig = await hmacSha256Hex(secret, signedPayload)
  if (!v1signatures.some(sig => constantTimeEqual(sig, expectedSig))) {
    throw new Error("No valid signature match")
  }
  return JSON.parse(rawBody)
}

// ── Stripe API helper (just for price lookup_key resolution) ────────
async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Basic ${btoa(STRIPE_SECRET + ":")}` },
  })
  if (!res.ok) throw new Error(`Stripe GET ${path}: ${res.status} ${await res.text()}`)
  return await res.json()
}

// ── Tier + status mappers ───────────────────────────────────────────
function tierFromLookupKey(lookupKey: string | null) {
  if (!lookupKey) return null
  // Stripe lookup_keys use canonical tier + interval names per CLAUDE.md
  // (May 24 2026 lock): starter/pro/elite × monthly/annual. Renamed
  // from legacy unlimited/yearly via scripts/rename-stripe-coach-tiers.mjs.
  // We map 'annual' → 'year' here because coach_subscriptions.interval
  // stores Stripe's standard recurring values ('month'/'year').
  const m = lookupKey.match(/^coach_(starter|pro|elite)_(monthly|annual)$/)
  if (!m) return null
  return { tier: m[1], interval: m[2] === "monthly" ? "month" : "year" }
}

function mapStatus(stripeStatus: string): string {
  const map: Record<string, string> = {
    trialing: "trialing",
    active: "active",
    past_due: "past_due",
    unpaid: "lapsed",
    canceled: "cancelled",
    incomplete_expired: "cancelled",
    incomplete: "past_due",
    paused: "suspended",
  }
  return map[stripeStatus] ?? "lapsed"
}

// ── billing_events writer ───────────────────────────────────────────
// Idempotent local mirror of every relevant Stripe event. Each call
// inserts one row into `billing_events`; stripe_event_id is UNIQUE so
// re-deliveries (Stripe's at-least-once semantics) are silently
// dropped. Row content is the same regardless of source (coach subs OR
// B2C purchases) — the type field plus stripe_invoice_id /
// stripe_subscription_id / stripe_charge_id disambiguates downstream.
//
// Trigger `billing_events_to_activity_events_trg` on this table mirrors
// each insert into `activity_events` so the user's Activity Feed
// surface picks the event up automatically.
//
// userId resolution priority:
//   1. Explicit caller-passed userId (subscription handlers know it from
//      coach_subscriptions lookup).
//   2. Look up by stripe_customer_id from existing coach_subscriptions
//      or b2c_purchases rows (charges + refunds rarely carry user
//      metadata; they reference the customer).
//   3. NULL — orphan billing row. We still log it so we don't lose tax
//      records; admin can manually reconcile via Stripe Dashboard.
async function logBillingEvent({
  event, supabase, userId,
  type, amountCents, currency, status, description,
  stripeCustomerId, stripeSubscriptionId, stripeInvoiceId, stripeChargeId,
}: {
  event: any
  supabase: any
  userId: string | null
  type: string
  amountCents: number | null
  currency: string | null
  status: string | null
  description: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeInvoiceId: string | null
  stripeChargeId: string | null
}) {
  // If userId not provided, try to resolve from stripe_customer_id.
  let resolvedUserId = userId
  if (!resolvedUserId && stripeCustomerId) {
    const { data: sub } = await supabase
      .from('coach_subscriptions')
      .select('coach_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle()
    resolvedUserId = sub?.coach_id ?? null
    if (!resolvedUserId) {
      // B2C purchase fallback — b2c_purchases.meta might carry the
      // customer linkage. Defensive; may not exist yet for charge-only
      // flows.
      const { data: b2c } = await supabase
        .from('b2c_purchases')
        .select('user_id')
        .filter('meta->>stripe_customer_id', 'eq', stripeCustomerId)
        .limit(1)
        .maybeSingle()
      resolvedUserId = b2c?.user_id ?? null
    }
  }

  const row = {
    user_id:                resolvedUserId,
    stripe_event_id:        event.id,
    stripe_customer_id:     stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_invoice_id:      stripeInvoiceId,
    stripe_charge_id:       stripeChargeId,
    type,
    amount_cents:           amountCents,
    currency,
    status,
    description,
    occurred_at:            new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    raw_payload:            event,
  }

  // Idempotent insert — UNIQUE(stripe_event_id) silently rejects
  // duplicates (Stripe sometimes re-delivers). Use onConflict to
  // explicitly ignore rather than throwing on the constraint violation.
  const { error } = await supabase
    .from('billing_events')
    .upsert(row, { onConflict: 'stripe_event_id', ignoreDuplicates: true })
  if (error) {
    console.error(`[billing] write failed for event ${event.id}:`, error.message)
  } else {
    console.log(`[billing] wrote ${type} for user=${resolvedUserId ?? '(unresolved)'} event=${event.id}`)
  }
}

// ── Event handlers ──────────────────────────────────────────────────
async function handleSubscriptionUpsert(sub: any, supabase: any) {
  const item = sub.items?.data?.[0]
  if (!item?.price?.id) {
    console.warn(`[webhook] No price item on sub ${sub.id}`)
    return
  }
  const price = await stripeGet(`/prices/${item.price.id}`)
  const tierInfo = tierFromLookupKey(price.lookup_key)
  if (!tierInfo) {
    console.warn(`[webhook] Unknown lookup_key ${price.lookup_key}`)
    return
  }
  // Find coach_id from sub.metadata (set during checkout session creation)
  // or from an existing coach_subscriptions row.
  let coachId = sub.metadata?.coach_id
  if (!coachId) {
    const { data: existing } = await supabase
      .from("coach_subscriptions")
      .select("coach_id")
      .eq("stripe_subscription_id", sub.id)
      .single()
    coachId = existing?.coach_id
  }
  if (!coachId) {
    console.error(`[webhook] Cannot resolve coach_id for sub ${sub.id}`)
    return
  }
  const row = {
    coach_id: coachId,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    stripe_price_id: item.price.id,
    tier: tierInfo.tier,
    interval: tierInfo.interval,
    status: mapStatus(sub.status),
    trial_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    trial_end:   sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
    current_period_end:   sub.current_period_end   ? new Date(sub.current_period_end   * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  // Upsert on stripe_subscription_id (unique)
  await supabase.from("coach_subscriptions").upsert(row, { onConflict: "stripe_subscription_id" })
  // Mirror status/tier onto profiles for fast denormalized reads.
  await supabase.from("profiles").update({
    coach_subscription_status: row.status,
    coach_subscription_tier:   row.tier,
    coach_trial_ends_at:       row.trial_end,
  }).eq("id", coachId)
  console.log(`[webhook] sub upsert ok: coach=${coachId} sub=${sub.id} status=${row.status} tier=${row.tier}`)
}

async function handleSubscriptionDeleted(sub: any, supabase: any) {
  await supabase.from("coach_subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", sub.id)
  const { data: existing } = await supabase
    .from("coach_subscriptions")
    .select("coach_id")
    .eq("stripe_subscription_id", sub.id)
    .single()
  const coachId = existing?.coach_id ?? sub.metadata?.coach_id
  if (coachId) {
    await supabase.from("profiles").update({ coach_subscription_status: "cancelled" }).eq("id", coachId)
  }
  console.log(`[webhook] sub.deleted ok: sub=${sub.id}`)
}

async function handleInvoicePaid(inv: any, supabase: any) {
  if (!inv.subscription) return
  await supabase.from("coach_subscriptions")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", inv.subscription)
  const { data: existing } = await supabase
    .from("coach_subscriptions")
    .select("coach_id")
    .eq("stripe_subscription_id", inv.subscription)
    .single()
  if (existing?.coach_id) {
    await supabase.from("profiles").update({ coach_subscription_status: "active" }).eq("id", existing.coach_id)
  }
  console.log(`[webhook] invoice.paid ok: sub=${inv.subscription}`)
}

async function handleInvoiceFailed(inv: any, supabase: any) {
  if (!inv.subscription) return
  await supabase.from("coach_subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", inv.subscription)
  const { data: existing } = await supabase
    .from("coach_subscriptions")
    .select("coach_id")
    .eq("stripe_subscription_id", inv.subscription)
    .single()
  if (existing?.coach_id) {
    await supabase.from("profiles").update({ coach_subscription_status: "past_due" }).eq("id", existing.coach_id)
  }
  console.log(`[webhook] invoice.payment_failed ok: sub=${inv.subscription}`)
}

async function handleCheckoutSessionCompleted(session: any, supabase: any) {
  // Only B2C one-time purchases (mode=payment) go through this handler.
  // Subscription-mode sessions are handled via customer.subscription.created.
  if (session.mode !== "payment") {
    console.log(`[webhook] Skipping non-payment session ${session.id}`)
    return
  }
  const userId = session.metadata?.user_id
  const tier   = session.metadata?.tier
  if (!userId || !tier || (tier !== "corerx" && tier !== "fullrx")) {
    console.error(`[webhook] Bad B2C metadata: user_id=${userId} tier=${tier}`)
    return
  }
  const row = {
    user_id: userId,
    tier,
    channel: "stripe_web",
    channel_receipt_id: session.payment_intent || session.id,
    amount_cents: session.amount_total ?? 0,
    platform_fee_cents: 0,
    status: "completed",
    purchased_at: new Date().toISOString(),
    meta: { session_id: session.id, customer_email: session.customer_details?.email ?? null },
  }
  await supabase.from("b2c_purchases").upsert(row, { onConflict: "channel,channel_receipt_id" })
  console.log(`[webhook] b2c purchase ok: user=${userId} tier=${tier}`)
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return txt("method_not_allowed", 405)

  const rawBody = await req.text()
  const sig = req.headers.get("Stripe-Signature") ?? ""

  // Determine which signing secret to use. We use the `source` query
  // param (?source=coach_subs or ?source=b2c) to pick. Default is coach_subs.
  const url = new URL(req.url)
  const source = url.searchParams.get("source") ?? "coach_subs"
  const secret = source === "b2c" ? WEBHOOK_SECRET_B2C : WEBHOOK_SECRET

  let event: any
  try {
    event = await verifyWebhook(rawBody, sig, secret)
  } catch (err) {
    console.error(`Signature verification failed (source=${source}):`, (err as Error).message)
    return txt(`Webhook signature verification failed: ${(err as Error).message}`, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    // 1. Run the domain-specific handler that maintains coach_subscriptions
    //    + profiles + b2c_purchases. Existing behaviour.
    // 2. After it succeeds, write a row to billing_events as the immutable
    //    tax/audit record. The DB trigger billing_events_to_activity_events_trg
    //    fans this out into activity_events automatically so the user's
    //    Activity Feed picks it up.
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object
        await handleSubscriptionUpsert(sub, supabase)
        // Look up coach_id from the row we just upserted so the billing
        // event is bound to a user even when sub.metadata didn't carry
        // coach_id (Stripe portal-initiated changes lose metadata).
        const { data: existing } = await supabase
          .from("coach_subscriptions")
          .select("coach_id")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle()
        await logBillingEvent({
          event, supabase,
          userId: existing?.coach_id ?? sub.metadata?.coach_id ?? null,
          type: event.type === "customer.subscription.created"
            ? "subscription_started"
            : "subscription_updated",
          amountCents: sub.items?.data?.[0]?.price?.unit_amount ?? null,
          currency:    sub.items?.data?.[0]?.price?.currency ?? sub.currency ?? null,
          status:      mapStatus(sub.status),
          description: `Coach subscription ${event.type === "customer.subscription.created" ? "started" : "updated"}`,
          stripeCustomerId:     sub.customer ?? null,
          stripeSubscriptionId: sub.id,
          stripeInvoiceId:      null,
          stripeChargeId:       null,
        })
        break
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object
        await handleSubscriptionDeleted(sub, supabase)
        const { data: existing } = await supabase
          .from("coach_subscriptions")
          .select("coach_id")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle()
        await logBillingEvent({
          event, supabase,
          userId: existing?.coach_id ?? sub.metadata?.coach_id ?? null,
          type: "subscription_cancelled",
          amountCents: null,
          currency:    sub.currency ?? null,
          status:      "cancelled",
          description: sub.cancellation_details?.reason
            ? `Coach subscription cancelled (${sub.cancellation_details.reason})`
            : "Coach subscription cancelled",
          stripeCustomerId:     sub.customer ?? null,
          stripeSubscriptionId: sub.id,
          stripeInvoiceId:      null,
          stripeChargeId:       null,
        })
        break
      }
      case "invoice.paid": {
        const inv = event.data.object
        await handleInvoicePaid(inv, supabase)
        await logBillingEvent({
          event, supabase,
          userId: null,                    // resolved by helper via customer
          type: "invoice_paid",
          amountCents: inv.amount_paid ?? null,
          currency:    inv.currency ?? null,
          status:      "paid",
          description: inv.lines?.data?.[0]?.description
                       ?? inv.description
                       ?? "Invoice paid",
          stripeCustomerId:     inv.customer ?? null,
          stripeSubscriptionId: inv.subscription ?? null,
          stripeInvoiceId:      inv.id,
          stripeChargeId:       inv.charge ?? null,
        })
        break
      }
      case "invoice.payment_failed": {
        const inv = event.data.object
        await handleInvoiceFailed(inv, supabase)
        await logBillingEvent({
          event, supabase,
          userId: null,
          type: "invoice_failed",
          amountCents: inv.amount_due ?? null,
          currency:    inv.currency ?? null,
          status:      "failed",
          description: "Invoice payment failed",
          stripeCustomerId:     inv.customer ?? null,
          stripeSubscriptionId: inv.subscription ?? null,
          stripeInvoiceId:      inv.id,
          stripeChargeId:       inv.charge ?? null,
        })
        break
      }
      case "checkout.session.completed": {
        const session = event.data.object
        await handleCheckoutSessionCompleted(session, supabase)
        // Only log billing for B2C one-time purchases here. Subscription-mode
        // sessions are logged via customer.subscription.created which fires
        // separately and carries the price/amount cleanly.
        if (session.mode === "payment") {
          await logBillingEvent({
            event, supabase,
            userId: session.metadata?.user_id ?? null,
            type: "b2c_purchase",
            amountCents: session.amount_total ?? null,
            currency:    session.currency ?? null,
            status:      "completed",
            description: session.metadata?.tier
              ? `One-time purchase — ${session.metadata.tier}`
              : "One-time purchase",
            stripeCustomerId:     session.customer ?? null,
            stripeSubscriptionId: null,
            stripeInvoiceId:      null,
            stripeChargeId:       session.payment_intent ?? null,
          })
        }
        break
      }
      // Refunds, disputes — surface them in billing history even though
      // we don't have a domain handler (they don't mutate
      // coach_subscriptions). The logBillingEvent helper resolves user_id
      // via the customer lookup.
      case "charge.refunded": {
        const charge = event.data.object
        await logBillingEvent({
          event, supabase,
          userId: null,
          type: "refund_issued",
          amountCents: charge.amount_refunded ?? null,
          currency:    charge.currency ?? null,
          status:      "refunded",
          description: charge.refunds?.data?.[0]?.reason
            ? `Refund issued (${charge.refunds.data[0].reason})`
            : "Refund issued",
          stripeCustomerId:     charge.customer ?? null,
          stripeSubscriptionId: null,
          stripeInvoiceId:      charge.invoice ?? null,
          stripeChargeId:       charge.id,
        })
        break
      }
      case "charge.dispute.created": {
        const dispute = event.data.object
        await logBillingEvent({
          event, supabase,
          userId: null,
          type: "dispute_opened",
          amountCents: dispute.amount ?? null,
          currency:    dispute.currency ?? null,
          status:      dispute.status ?? "needs_response",
          description: `Dispute opened (${dispute.reason ?? "unknown reason"})`,
          stripeCustomerId:     null,         // dispute doesn't carry customer directly
          stripeSubscriptionId: null,
          stripeInvoiceId:      null,
          stripeChargeId:       dispute.charge ?? null,
        })
        break
      }
      default:
        console.log(`[webhook] Ignoring event type ${event.type}`)
    }
  } catch (err) {
    // Return 500 → Stripe retries with exponential backoff (up to 3 days).
    // Transient DB failures auto-heal on retry.
    console.error(`Handler error for ${event.id} (${event.type}):`, (err as Error).message)
    return txt(`Handler error: ${(err as Error).message}`, 500)
  }

  return json({ received: true, event_id: event.id, event_type: event.type })
})
