// coach-billing-portal
//
// JWT-required. Opens the Stripe Billing Portal for an existing coach so they
// can update their card, cancel, or switch tier — the in-app "Manage plan"
// button (T194 step 8). We don't build our own billing UI; Stripe's hosted
// portal handles it, and any change the coach makes there fires the same webhook
// events (customer.subscription.updated / .deleted, invoice.*) that the
// stripe-webhook already turns into is_coach + coach_subscription_status updates.
//
//   1. Verify the JWT (verify_jwt: true) → get the user.
//   2. Look up profiles.coach_stripe_customer_id (set by coach-signup, kept in
//      sync by stripe-webhook). No customer id → 400 (nothing to manage).
//   3. Create a Billing Portal session for that customer with a return_url back
//      to the coach Billing tab.
//   4. Return { url }.
//
// NOTE: NOT gated on is_active_coach — a LAPSED coach must still reach the portal
// to update their card / reactivate / view past invoices. The portal only ever
// exposes the coach's OWN billing, never any client data.
//
// PREREQUISITE (one-time, Stripe Dashboard): the Customer Portal must be
// configured + activated under Settings → Billing → Customer portal, with the
// coach products added so plan-switching + cancellation are allowed. Without an
// active portal configuration, /billing_portal/sessions returns an error.
//
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Manual secrets (shared with coach-signup): STRIPE_MODE, STRIPE_SECRET_KEY_TEST,
// STRIPE_SECRET_KEY_LIVE, SITE_URL, SUPABASE_ANON_KEY.

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

const STRIPE_API = "https://api.stripe.com/v1"
async function stripePost(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(STRIPE_SECRET + ":")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe POST ${path} failed: ${res.status} ${text}`)
  }
  return await res.json()
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { error: "Method not allowed.", code: "method_not_allowed" })

  const authHeader = req.headers.get("Authorization") || ""
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return json(401, { error: "Sign in and try again.", code: "not_authenticated" })
  }

  // Find the coach's Stripe customer id (set during checkout by coach-signup
  // and kept in sync by the webhook). No customer = nothing to manage.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: profile } = await admin
    .from("profiles")
    .select("coach_stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle()

  const customerId = profile?.coach_stripe_customer_id
  if (!customerId) {
    return json(400, { error: "No billing account found for your coach plan.", code: "no_customer" })
  }

  try {
    const session = await stripePost("/billing_portal/sessions", {
      customer:   customerId,
      return_url: `${SITE_URL}/profile`,
    })
    return json(200, { success: true, url: session.url })
  } catch (err) {
    console.error("Stripe billing_portal.sessions.create failed:", err)
    return json(500, { error: "Couldn't open the billing portal. Try again.", code: "stripe_portal_failed", detail: String(err) })
  }
})
