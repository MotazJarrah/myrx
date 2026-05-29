// coach-signup
//
// JWT-required. Converts an ALREADY-AUTHED user into a coach +
// creates a Stripe Customer + Checkout Session for the 14-day trial.
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
//     2. Upserts the profile to flip is_coach=true + coach_subscription_*
//        + 14-day trial timestamp.
//     3. Looks up the target Stripe price by lookup_key (e.g.
//        coach_starter_monthly).
//     4. Creates the Stripe Customer with the coach's email + name
//        pulled from auth metadata.
//     5. Creates the Stripe Checkout Session in subscription mode
//        with the 14-day trial and metadata.coach_id so the
//        stripe-webhooks worker can map subscription events back.
//     6. Returns { checkout_url, session_id, coach_id }.
//
//   The frontend redirects the user to checkout_url. Stripe handles
//   payment, then redirects to success_url. The stripe-webhooks
//   worker populates coach_subscriptions + flips
//   coach_subscription_status to 'trialing' asynchronously.

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
  // If this user is already an active coach with a paid subscription,
  // they shouldn't be running through signup again. Trialing or none →
  // proceed (lets users who abandoned mid-checkout retry cleanly).
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, is_coach, coach_subscription_status")
    .eq("id", user.id)
    .maybeSingle()

  if (existingProfile?.is_coach
      && existingProfile?.coach_subscription_status
      && !["trialing", null, "incomplete", "incomplete_expired", "canceled"].includes(existingProfile.coach_subscription_status)) {
    return json(409, { error: "You're already a coach — sign in instead of going through signup.", code: "already_a_coach" })
  }

  // ── Step 2: Convert profile to coach + start trial ────────────────
  // Upsert (not insert) — init-profile-checkpoint already created the
  // profile row with body data during the password step. We just need
  // to add the coach-specific fields.
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const fullName    = (user.user_metadata?.full_name as string)
                      || user.email
                      || ""
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .upsert({
      id:                          user.id,
      auth_user_id:                user.id,
      full_name:                   fullName,
      is_coach:                    true,
      is_superuser:                false,
      coach_subscription_status:   "trialing",
      coach_subscription_tier:     tier,
      coach_trial_ends_at:         trialEndsAt,
      coach_id:                    null,  // coaches themselves are unlinked
    }, { onConflict: "id" })
    .select()
    .single()

  if (profileErr || !profile) {
    console.error("profile upsert failed:", profileErr)
    return json(500, { error: "Couldn't save your coach profile. Try again.", code: "profile_update_failed", detail: profileErr?.message })
  }

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

  // ── Step 4: Create the Stripe Customer ────────────────────────────
  let customerId: string
  try {
    const customer = await stripePost("/customers", {
      email: user.email!,
      name:  fullName,
      "metadata[coach_id]": profile.id,
      "metadata[supabase_user_id]": user.id,
    })
    customerId = customer.id
  } catch (err) {
    console.error("Stripe customer create failed:", err)
    return json(500, { error: "Couldn't set up your Stripe customer. Try again.", code: "stripe_customer_create_failed", detail: String(err) })
  }

  // ── Step 5: Create the Checkout Session ───────────────────────────
  try {
    const session = await stripePost("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]":    priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "14",
      "subscription_data[metadata][coach_id]": profile.id,
      "metadata[coach_id]": profile.id,
      "metadata[supabase_user_id]": user.id,
      success_url: `${SITE_URL}/coach/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/coach/signup?cancelled=1`,
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
      coach_id:     profile.id,
    })
  } catch (err) {
    // Don't roll back the profile — the user IS a valid coach now,
    // just couldn't make it through Checkout. They can retry from
    // the frontend without needing to redo signup. Leaves an orphan
    // Stripe Customer (harmless; no charges without a subscription).
    console.error("Stripe checkout.sessions.create failed:", err)
    return json(500, { error: "Couldn't start the checkout session. Try again.", code: "stripe_checkout_create_failed", detail: String(err) })
  }
})
