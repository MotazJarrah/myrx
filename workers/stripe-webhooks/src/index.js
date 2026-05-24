// MyRX Stripe Webhooks Worker
//
// Mounted on https://myrxfit.com/stripe-webhooks/* (see wrangler.toml).
// Handles Stripe webhook events for the Coach Platform v1 billing model
// per CLAUDE.md Locks 18-20.
//
// Routes:
//   POST /stripe-webhooks/coach-subs
//     Coach subscription lifecycle (Stripe Checkout for the recurring
//     coach plans — Starter/Pro/Unlimited × monthly/yearly).
//     Handles: customer.subscription.created/updated/deleted,
//              invoice.paid, invoice.payment_failed
//     Writes to: coach_subscriptions + profiles (coach_subscription_*)
//
//   POST /stripe-webhooks/b2c-purchases
//     B2C one-time purchases (Stripe Checkout for SemiRX/FullRX from
//     the website — in-app IAP goes through Apple/Google, not Stripe).
//     Handles: checkout.session.completed (mode=payment, not subscription)
//     Writes to: b2c_purchases
//
// Both endpoints verify the Stripe webhook signature using
// STRIPE_WEBHOOK_SECRET_{TEST|LIVE} before doing any work. Unsigned
// requests get 401. Signature failures get 400.
//
// IMPORTANT: Stripe expects a 2xx response within ~10 seconds, or it
// retries the webhook. We do all DB work synchronously and respond
// 200 only on success. Failures return 500 → Stripe retries with
// exponential backoff up to 3 days, so transient DB errors auto-heal.

import { verifyWebhook } from './verify.js'
import { SupabaseRest, } from './supabase.js'
import { StripeRest, tierFromLookupKey, mapSubscriptionStatus } from './stripe.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',  // Stripe ignores CORS — this is here for any browser-side error inspection only
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Stripe-Signature, Content-Type',
}

function txt(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/plain' },
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Resolve the webhook signing secret for the current Stripe mode.
function webhookSecret(env) {
  const mode = env.STRIPE_MODE || 'test'
  return mode === 'live'
    ? env.STRIPE_WEBHOOK_SECRET_LIVE
    : env.STRIPE_WEBHOOK_SECRET_TEST
}

// ── Coach subscription event handler ─────────────────────────────────────
async function handleCoachSubsEvent(event, env) {
  const supa = new SupabaseRest(env)
  const stripe = new StripeRest(env)

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object
      // Find the price ID from the subscription's first item.
      const item = sub.items?.data?.[0]
      if (!item?.price?.id) {
        console.warn(`[coach-subs] No price item on subscription ${sub.id}; skipping`)
        return
      }
      // Read the lookup_key to map to tier + interval.
      const price = await stripe.getPrice(item.price.id)
      const tierInfo = tierFromLookupKey(price.lookup_key)
      if (!tierInfo) {
        console.warn(`[coach-subs] Price ${price.id} has unknown lookup_key ${price.lookup_key}; skipping`)
        return
      }

      // Find the coach (profile) by stripe_customer_id.
      const coachRows = await supa.select('coach_subscriptions',
        { stripe_customer_id: `eq.${sub.customer}` }, 'coach_id')
      // For a brand-new subscription (created event), we may not have the
      // row yet — the customer was created in coach-signup edge function
      // but the subscription row gets created HERE on the webhook.
      // In that case, look up by stripe_customer_id on profiles directly.
      let coachId = coachRows[0]?.coach_id
      if (!coachId) {
        // Look up profile.id where stripe_customer_id matches.
        // Note: profiles doesn't currently have stripe_customer_id — the
        // coach-signup edge function will need to add it OR include
        // metadata in the Stripe customer to map back. For now we read
        // sub.metadata.coach_id which the signup function MUST set when
        // creating the subscription.
        coachId = sub.metadata?.coach_id
      }
      if (!coachId) {
        console.error(`[coach-subs] Cannot resolve coach_id for sub ${sub.id} (no metadata.coach_id, no existing row)`)
        return
      }

      const row = {
        coach_id: coachId,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        stripe_price_id: item.price.id,
        tier: tierInfo.tier,
        interval: tierInfo.interval,
        status: mapSubscriptionStatus(sub.status),
        trial_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
        trial_end:   sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
        current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
        current_period_end:   sub.current_period_end   ? new Date(sub.current_period_end   * 1000).toISOString() : null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }

      // Upsert the coach_subscriptions row (unique on stripe_subscription_id).
      await supa.upsert('coach_subscriptions', row, 'stripe_subscription_id')

      // Mirror status + tier onto profiles for fast denormalized reads.
      await supa.update('profiles',
        { id: `eq.${coachId}` },
        {
          coach_subscription_status: row.status,
          coach_subscription_tier:   row.tier,
          coach_trial_ends_at:       row.trial_end,
        })

      console.log(`[coach-subs] ${event.type} ok: coach=${coachId} sub=${sub.id} status=${row.status} tier=${row.tier}`)
      return
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      // Mark cancelled in both tables.
      await supa.update('coach_subscriptions',
        { stripe_subscription_id: `eq.${sub.id}` },
        { status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })

      // Look up the coach_id and mirror status onto profiles.
      const rows = await supa.select('coach_subscriptions',
        { stripe_subscription_id: `eq.${sub.id}` }, 'coach_id')
      const coachId = rows[0]?.coach_id ?? sub.metadata?.coach_id
      if (coachId) {
        await supa.update('profiles',
          { id: `eq.${coachId}` },
          { coach_subscription_status: 'cancelled' })
      }
      console.log(`[coach-subs] subscription.deleted ok: sub=${sub.id}`)
      return
    }

    case 'invoice.paid': {
      const inv = event.data.object
      if (!inv.subscription) return  // Only subscription invoices interest us
      // Mark the matching coach_subscriptions row as active.
      await supa.update('coach_subscriptions',
        { stripe_subscription_id: `eq.${inv.subscription}` },
        { status: 'active', updated_at: new Date().toISOString() })

      const rows = await supa.select('coach_subscriptions',
        { stripe_subscription_id: `eq.${inv.subscription}` }, 'coach_id')
      const coachId = rows[0]?.coach_id
      if (coachId) {
        await supa.update('profiles',
          { id: `eq.${coachId}` },
          { coach_subscription_status: 'active' })
      }
      console.log(`[coach-subs] invoice.paid ok: sub=${inv.subscription}`)
      return
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object
      if (!inv.subscription) return
      await supa.update('coach_subscriptions',
        { stripe_subscription_id: `eq.${inv.subscription}` },
        { status: 'past_due', updated_at: new Date().toISOString() })

      const rows = await supa.select('coach_subscriptions',
        { stripe_subscription_id: `eq.${inv.subscription}` }, 'coach_id')
      const coachId = rows[0]?.coach_id
      if (coachId) {
        await supa.update('profiles',
          { id: `eq.${coachId}` },
          { coach_subscription_status: 'past_due' })
      }
      console.log(`[coach-subs] invoice.payment_failed ok: sub=${inv.subscription}`)
      return
    }

    default:
      console.log(`[coach-subs] Ignoring event type ${event.type}`)
      return
  }
}

// ── B2C one-time purchase event handler ─────────────────────────────────
async function handleB2cPurchaseEvent(event, env) {
  const supa = new SupabaseRest(env)

  if (event.type !== 'checkout.session.completed') {
    console.log(`[b2c] Ignoring event type ${event.type}`)
    return
  }

  const session = event.data.object
  if (session.mode !== 'payment') {
    // Subscription-mode sessions are coach subs, handled by the other endpoint.
    console.log(`[b2c] Skipping non-payment session ${session.id}`)
    return
  }

  // Resolve which tier was purchased + which user. Both come from the
  // checkout session's metadata, which the web /coach/upgrade flow MUST set
  // when creating the session.
  const userId = session.metadata?.user_id
  const tier   = session.metadata?.tier   // 'semirx' or 'fullrx'
  if (!userId || !tier) {
    console.error(`[b2c] Missing metadata on session ${session.id}: user_id=${userId} tier=${tier}`)
    return
  }
  if (tier !== 'semirx' && tier !== 'fullrx') {
    console.error(`[b2c] Unknown tier metadata: ${tier}`)
    return
  }

  const row = {
    user_id: userId,
    tier,
    channel: 'stripe_web',
    channel_receipt_id: session.payment_intent || session.id,
    amount_cents: session.amount_total ?? 0,
    platform_fee_cents: 0,   // Stripe direct = no platform fee, just processor fee
    status: 'completed',
    purchased_at: new Date().toISOString(),
    meta: {
      session_id: session.id,
      customer_email: session.customer_details?.email ?? null,
    },
  }

  await supa.upsert('b2c_purchases', row, 'channel,channel_receipt_id')
  console.log(`[b2c] checkout.session.completed ok: user=${userId} tier=${tier}`)
}

// ── Main router ─────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    if (!url.pathname.startsWith('/stripe-webhooks/')) {
      return txt('Not Found', 404)
    }
    if (request.method !== 'POST') {
      return txt('Method Not Allowed', 405)
    }

    // Read raw body BEFORE signature verification (verify needs raw text).
    const rawBody = await request.text()
    const sig = request.headers.get('Stripe-Signature')
    const secret = webhookSecret(env)

    let event
    try {
      event = await verifyWebhook(rawBody, sig, secret)
    } catch (err) {
      console.error(`Signature verification failed: ${err.message}`)
      return txt(`Webhook signature verification failed: ${err.message}`, 400)
    }

    try {
      const route = url.pathname.replace(/^\/stripe-webhooks\//, '')
      if (route === 'coach-subs') {
        await handleCoachSubsEvent(event, env)
      } else if (route === 'b2c-purchases') {
        await handleB2cPurchaseEvent(event, env)
      } else {
        return txt(`Unknown webhook route: ${route}`, 404)
      }
    } catch (err) {
      // Return 500 → Stripe retries with exponential backoff (up to 3 days).
      // Transient DB failures will auto-heal on retry.
      console.error(`Handler error for event ${event.id} (${event.type}): ${err.message}`)
      return txt(`Handler error: ${err.message}`, 500)
    }

    return json({ received: true, event_id: event.id, event_type: event.type })
  },
}
