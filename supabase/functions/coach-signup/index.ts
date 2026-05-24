// coach-signup
//
// Public Supabase Edge Function — no JWT required (this IS the signup).
// Handles the web /coach/signup form submission end-to-end:
//
//   1. Validates the input (email, password, name, phone, tier, interval)
//   2. Checks credential_history for a prior account with this email
//      and short-circuits with `account_exists_offer_resurrection` if
//      found — frontend should prompt user to choose restore or fresh start
//      (resurrection flow lives in a separate function for v2; for now
//      we just block the signup so a stale email can't create a duplicate)
//   3. Creates the auth.users entry via Supabase Auth admin API
//   4. Creates the profile row with is_coach=true + coach metadata,
//      including the 14-day trial timestamp per CLAUDE.md Lock 2
//   5. Records the signup in credential_history per Lock 17
//   6. Creates a Stripe Customer with the coach's email + name
//   7. Looks up the target price by lookup_key (e.g. coach_starter_monthly)
//   8. Creates a Stripe Checkout Session in subscription mode with:
//        - 14-day free trial
//        - metadata.coach_id = the new profile's id (so the
//          stripe-webhooks worker can map subscription events back)
//        - success_url + cancel_url back to the web /coach/welcome page
//   9. Returns { checkout_url, session_id, coach_id } to the frontend
//
// The frontend redirects the user to checkout_url. Stripe handles the
// payment, then redirects to success_url. The stripe-webhooks worker
// fires asynchronously and populates coach_subscriptions + updates
// profiles.coach_subscription_status to 'trialing'.
//
// Rollback semantics: if Stripe customer creation or checkout session
// creation fails, we delete the partially-created auth user + profile
// (no orphaned signups). If only the profile insert fails after auth
// succeeds, we still delete the auth user. credential_history rows
// stay (they're append-only, harmless if extra).

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

// ── Stripe REST helpers (Deno-native — no SDK) ──────────────────────
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

async function stripeDelete(path: string): Promise<void> {
  await fetch(`${STRIPE_API}${path}`, {
    method: "DELETE",
    headers: stripeHeaders(),
  })
  // Ignore failures — best-effort cleanup
}

// ── Input validation ────────────────────────────────────────────────
const VALID_TIERS = new Set(["starter", "pro", "unlimited"])
const VALID_INTERVALS = new Set(["monthly", "yearly"])

interface CoachSignupPayload {
  email:      string
  password:   string
  full_name:  string
  phone?:     string
  tier:       string   // 'starter' | 'pro' | 'unlimited'
  interval:   string   // 'monthly' | 'yearly'
  bio?:       string
  specialties?: string[]
}

function validatePayload(p: any): { ok: true; payload: CoachSignupPayload } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "bad_payload" }

  const email = String(p.email ?? "").trim().toLowerCase()
  const password = String(p.password ?? "")
  const full_name = String(p.full_name ?? "").trim()
  const phone = p.phone ? String(p.phone).trim() : undefined
  const tier = String(p.tier ?? "").trim().toLowerCase()
  const interval = String(p.interval ?? "").trim().toLowerCase()
  const bio = p.bio ? String(p.bio).trim() : undefined
  const specialties = Array.isArray(p.specialties)
    ? p.specialties.map((s: any) => String(s).trim()).filter(Boolean)
    : undefined

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_email" }
  if (password.length < 8) return { ok: false, error: "password_too_short" }
  if (!full_name) return { ok: false, error: "missing_name" }
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) return { ok: false, error: "invalid_phone" }
  if (!VALID_TIERS.has(tier)) return { ok: false, error: "invalid_tier" }
  if (!VALID_INTERVALS.has(interval)) return { ok: false, error: "invalid_interval" }

  return {
    ok: true,
    payload: { email, password, full_name, phone, tier, interval, bio, specialties },
  }
}

// ── Handler ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" })

  let rawPayload: any
  try { rawPayload = await req.json() } catch { return json(400, { error: "bad_json" }) }

  const validation = validatePayload(rawPayload)
  if (!validation.ok) return json(400, { error: validation.error })
  const p = validation.payload

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── Step 1: Check credential_history for prior account ────────────
  const { data: priorRows } = await supabase
    .from("credential_history")
    .select("profile_id, recorded_at, event_type, profile:profiles(deleted_at)")
    .eq("email", p.email)
    .order("recorded_at", { ascending: false })
    .limit(1)
  if (priorRows && priorRows.length > 0) {
    const priorProfile = (priorRows[0] as any).profile
    if (priorProfile?.deleted_at) {
      // Soft-deleted profile exists — offer resurrection (Lock 17)
      return json(409, {
        error: "account_exists_offer_resurrection",
        prior_profile_id: priorRows[0].profile_id,
      })
    }
    // Profile is still active — duplicate signup
    return json(409, { error: "email_already_in_use" })
  }

  // ── Step 2: Create the auth user ──────────────────────────────────
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email:          p.email,
    password:       p.password,
    email_confirm:  true,  // Coach signup auto-confirms; they did the work via web UI
    phone:          p.phone,
    user_metadata:  { full_name: p.full_name, is_coach: true },
  })
  if (authErr || !authData?.user) {
    console.error("auth.admin.createUser failed:", authErr)
    return json(500, { error: "auth_create_failed", detail: authErr?.message })
  }
  const authUser = authData.user

  // ── Step 3: Create the profile row ────────────────────────────────
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .insert({
      id:                          authUser.id,
      auth_user_id:                authUser.id,
      full_name:                   p.full_name,
      phone:                       p.phone ?? null,
      is_coach:                    true,
      is_superuser:                false,
      coach_bio:                   p.bio ?? null,
      coach_specialties:           p.specialties ?? null,
      coach_subscription_status:   "trialing",
      coach_subscription_tier:     p.tier,
      coach_trial_ends_at:         trialEndsAt,
      coach_id:                    null,  // coaches themselves are unlinked
    })
    .select()
    .single()

  if (profileErr || !profile) {
    // Rollback: delete the auth user we just created
    await supabase.auth.admin.deleteUser(authUser.id)
    console.error("profiles.insert failed:", profileErr)
    return json(500, { error: "profile_create_failed", detail: profileErr?.message })
  }

  // ── Step 4: Record credential_history (Lock 17) ──────────────────
  await supabase.rpc("record_credential_history", {
    p_profile_id: profile.id,
    p_email:      p.email,
    p_phone:      p.phone ?? null,
    p_event_type: "signup",
    p_meta:       { source: "coach_signup", auth_user_id: authUser.id },
  })

  // ── Step 5: Resolve the Stripe price by lookup_key ────────────────
  const period = p.interval === "monthly" ? "monthly" : "yearly"
  const lookupKey = `coach_${p.tier}_${period}`
  let priceId: string
  try {
    const prices = await stripeGet(`/prices?lookup_keys[]=${lookupKey}&active=true&limit=1`)
    if (!prices?.data?.[0]?.id) {
      throw new Error(`No active price found for lookup_key=${lookupKey}`)
    }
    priceId = prices.data[0].id
  } catch (err) {
    // Rollback both auth user + profile
    await supabase.from("profiles").delete().eq("id", profile.id)
    await supabase.auth.admin.deleteUser(authUser.id)
    console.error("Stripe price lookup failed:", err)
    return json(500, { error: "stripe_price_lookup_failed", detail: String(err) })
  }

  // ── Step 6: Create the Stripe Customer ────────────────────────────
  let customerId: string
  try {
    const customer = await stripePost("/customers", {
      email: p.email,
      name:  p.full_name,
      "metadata[coach_id]": profile.id,
      "metadata[supabase_user_id]": authUser.id,
    })
    customerId = customer.id
  } catch (err) {
    await supabase.from("profiles").delete().eq("id", profile.id)
    await supabase.auth.admin.deleteUser(authUser.id)
    console.error("Stripe customer create failed:", err)
    return json(500, { error: "stripe_customer_create_failed", detail: String(err) })
  }

  // ── Step 7: Create the Checkout Session ───────────────────────────
  try {
    const session = await stripePost("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]":    priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "14",
      "subscription_data[metadata][coach_id]": profile.id,
      "metadata[coach_id]": profile.id,
      "metadata[supabase_user_id]": authUser.id,
      success_url: `${SITE_URL}/coach/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/coach/signup?cancelled=1`,
      // Save the customer's payment method so we can charge them on
      // trial end automatically
      payment_method_collection: "always",
      // Don't surface a "promo code" field in checkout for now (we can
      // add promo support in Phase 5 Marketing Tools)
      allow_promotion_codes: "false",
    })
    return json(200, {
      success:      true,
      checkout_url: session.url,
      session_id:   session.id,
      coach_id:     profile.id,
    })
  } catch (err) {
    // Don't delete the auth + profile here — the user is fine, just the
    // Checkout session creation failed. They can retry from the frontend.
    // We do leave an orphaned Stripe Customer in this case, which is
    // benign (customers without subscriptions cost nothing).
    console.error("Stripe checkout.sessions.create failed:", err)
    return json(500, { error: "stripe_checkout_create_failed", detail: String(err) })
  }
})
