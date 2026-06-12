// coach-signup
//
// JWT-required. For an ALREADY-AUTHED user, creates (or reuses) a Stripe
// Customer + Checkout Session for the 30-day coach trial. Does NOT grant coach
// status — the stripe-webhook does that after Stripe confirms (T194 grant-flip).
//
// Background (May 26 2026 refactor):
//
//   v1-v3: This function created the auth user itself via admin
//   createUser and called email_confirm: true to skip OTP. That meant
//   the coach signup couldn't use Supabase's normal email-OTP flow
//   and any TWILIO phone verification — the auth user was already
//   confirmed by the time the frontend reached any OTP screen.
//
//   v4 (this version): The frontend now drives a normal Supabase
//   auth flow — supabase.auth.signUp at the password screen sends a
//   real OTP email, verifyOtp on the email-OTP screen confirms,
//   send-phone-otp + verify-phone-otp handle Twilio. By the time
//   the user reaches the Stripe screen they're already a fully
//   authed Supabase user with a profile row (created by
//   init-profile-checkpoint after password). This function just:
//
//     1. Verifies the JWT (verify_jwt: true at the function level).
//     2. (T194) Does NOT grant coach status. Picking a plan must not
//        unlock the portal — the stripe-webhook is the SOLE granter and
//        sets is_coach + coach_subscription_* only after Stripe confirms
//        a live subscription.
//     3. Looks up the target Stripe price by lookup_key (e.g.
//        coach_starter_monthly).
//     4. Creates (or reuses) the Stripe Customer with the coach's email +
//        name, and stores its id on the profile as a pending-coach marker.
//     5. Creates the Stripe Checkout Session in subscription mode
//        with the 30-day trial and metadata.coach_id so the
//        stripe-webhook can map subscription events back.
//     6. Returns { checkout_url, session_id, coach_id }.
//
//   The frontend redirects the user to checkout_url. Stripe handles
//   payment, then redirects to success_url. The stripe-webhook then
//   sets is_coach=true + coach_subscription_status='trialing' and
//   populates coach_subscriptions asynchronously — THAT is what grants
//   portal access.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const STRIPE_MODE          = Deno.env.get("STRIPE_MODE") ?? "test"
const STRIPE_SECRET        = STRIPE_MODE === "live"
  ? Deno.env.get("STRIPE_SECRET_KEY_LIVE")!
  : Deno.env.get("STRIPE_SECRET_KEY_TEST")!
const SITE_URL             = Deno.env.get("SITE_URL") ?? "https://myrxfit.com"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

// ── Stripe REST helpers (Deno-native, no SDK) ──────────────────────
const STRIPE_API = "https://api.stripe.com/v1"
function stripeHeaders() {
  return {
    Authorization: `Basic ${btoa(STRIPE_SECRET + ":")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  }
}
async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, { headers: stripeHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe GET ${path} failed: ${res.status} ${text}`)
  }
  return await res.json()
}
async function stripePost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString()
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: stripeHeaders(),
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe POST ${path} failed: ${res.status} ${text}`)
  }
  return await res.json()
}

// ── Tier / cadence validation ─────────────────────────────────────
// Canonical, single-spelling values per CLAUDE.md (May 24 2026 lock):
//   tier:     starter | pro | elite
//   interval: monthly | annual
// Stripe products + price lookup_keys use the SAME spellings (renamed
// May 26 2026 via scripts/rename-stripe-coach-tiers.mjs). No legacy
// translation layer.
const VALID_TIERS     = new Set(["starter", "pro", "elite"])
const VALID_INTERVALS = new Set(["monthly", "annual"])

// ── Handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { error: "Method not allowed.", code: "method_not_allowed" })

  // verify_jwt is TRUE on this function, so Supabase has already
  // validated the JWT before we get here. We just need to extract
  // the user_id from it to know who's signing up.
  const authHeader = req.headers.get("Authorization") || ""
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    console.error("getUser failed:", userErr)
    return json(401, { error: "Sign in and try again.", code: "not_authenticated" })
  }

  // Payload — minimal because most data was saved during the
  // standard auth flow. Just the tier + cadence the coach picked.
  let payload: any
  try { payload = await req.json() } catch { return json(400, { error: "We couldn't read that request. Try again.", code: "bad_json" }) }

  const tier     = String(payload?.tier ?? "").trim().toLowerCase()
  const interval = String(payload?.interval ?? "").trim().toLowerCase()
  if (!VALID_TIERS.has(tier))         return json(400, { error: "That subscription tier isn't valid. Refresh the page and try again.", code: "invalid_tier" })
  if (!VALID_INTERVALS.has(interval)) return json(400, { error: "That billing interval isn't valid. Refresh the page and try again.", code: "invalid_interval" })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── Step 1: Block duplicates ──────────────────────────────────────
  // Read the existing profile. The block decision is below (T194): only a LIVE
  // coach (is_coach=true) is turned away; a lapsed or pending one proceeds so
  // they can (re)subscribe. We also read coach_stripe_customer_id to reuse it
  // on a retry instead of orphaning a new Stripe customer.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, is_coach, coach_subscription_status, coach_stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle()

  // After the T194 grant-flip, is_coach is TRUE only while the Stripe
  // subscription is live (trialing/active/past_due) — the webhook is the sole
  // granter. So is_coach===true here means "already a live coach" → send them to
  // sign-in. A lapsed/cancelled coach (is_coach=false) or a pending coach who
  // abandoned checkout (is_coach=false, customer id set) falls through and may
  // (re)subscribe.
  if (existingProfile?.is_coach === true) {
    return json(409, { error: "You're already a coach — sign in instead of going through signup.", code: "already_a_coach" })
  }

  // ── Step 2: NO coach grant here (T194 grant-flip) ─────────────────
  // Picking a plan must NOT grant portal access. The webhook is the SOLE
  // granter — is_coach + coach_subscription_* are written only after Stripe
  // confirms the subscription (status 'trialing'). Here we just need the user's
  // name for the Stripe customer. The profile row already exists (created by
  // init-profile-checkpoint at the password step).
  const fullName = (user.user_metadata?.full_name as string)
                   || user.email
                   || ""

  // ── Step 3: Resolve the Stripe price by lookup_key ────────────────
  // Stripe lookup_keys use the canonical tier + interval values
  // verbatim (e.g. coach_pro_annual, coach_elite_monthly). No
  // translation layer — Stripe product names + lookup_keys were
  // renamed to match (script: rename-stripe-coach-tiers.mjs).
  const lookupKey = `coach_${tier}_${interval}`
  let priceId: string
  try {
    const prices = await stripeGet(`/prices?lookup_keys[]=${lookupKey}&active=true&limit=1`)
    if (!prices?.data?.[0]?.id) {
      throw new Error(`No active price found for lookup_key=${lookupKey}`)
    }
    priceId = prices.data[0].id
  } catch (err) {
    console.error("Stripe price lookup failed:", err)
    return json(500, { error: "We couldn't load the tier pricing. Try again in a moment.", code: "stripe_price_lookup_failed", detail: String(err) })
  }

  // ── Step 4: Create (or reuse) the Stripe Customer ─────────────────
  // Reuse the customer from a prior abandoned attempt so retries don't orphan a
  // new customer each time. Storing the id is the PENDING-coach marker (customer
  // id present + is_coach still false = started checkout, not yet paid) — NOT the
  // access grant (that's the webhook).
  let customerId = existingProfile?.coach_stripe_customer_id ?? ""
  if (!customerId) {
    try {
      const customer = await stripePost("/customers", {
        email: user.email!,
        name:  fullName,
        "metadata[coach_id]": user.id,
        "metadata[supabase_user_id]": user.id,
      })
      customerId = customer.id
    } catch (err) {
      console.error("Stripe customer create failed:", err)
      return json(500, { error: "Couldn't set up your Stripe customer. Try again.", code: "stripe_customer_create_failed", detail: String(err) })
    }
    await admin.from("profiles").update({ coach_stripe_customer_id: customerId }).eq("id", user.id)
  }

  // ── Step 5: Create the Checkout Session ───────────────────────────
  try {
    const session = await stripePost("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]":    priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "30",
      "subscription_data[metadata][coach_id]": user.id,
      "metadata[coach_id]": user.id,
      "metadata[supabase_user_id]": user.id,
      success_url: `${SITE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/signup?cancelled=1`,
      // Save the customer's payment method so we can charge them on
      // trial end automatically.
      payment_method_collection: "always",
      // Promo codes deferred to Phase 5 Marketing Tools.
      allow_promotion_codes: "false",
    })
    return json(200, {
      success:      true,
      checkout_url: session.url,
      session_id:   session.id,
      coach_id:     user.id,
    })
  } catch (err) {
    // Nothing to roll back — we never granted coach status (the webhook does
    // that only after Stripe confirms). The pending-coach marker
    // (coach_stripe_customer_id) is already saved, so a retry reuses the same
    // customer instead of orphaning a new one.
    console.error("Stripe checkout.sessions.create failed:", err)
    return json(500, { error: "Couldn't start the checkout session. Try again.", code: "stripe_checkout_create_failed", detail: String(err) })
  }
})
