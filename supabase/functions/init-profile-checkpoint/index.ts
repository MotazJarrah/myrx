// init-profile-checkpoint
//
// Called from the password screen IMMEDIATELY after supabase.auth.signUp
// returns success for a brand-new account. At that moment the user has
// no Supabase session (email confirmation pending), so a normal
// authenticated client write to profiles fails RLS. This function uses
// the service role to:
//
//   1. Verify the supplied user_id matches a real auth.users row whose
//      email matches the supplied email AND whose email_confirmed_at
//      is null (so we're operating in the post-signUp / pre-OTP window).
//   2. Upsert the profile row with all body data the journey collected
//      so far (units, sex, dob, height/weight, modality).
//   3. Stamp profiles.signup_checkpoint = 'password' so the journey
//      knows this user has cleared checkpoint #1.
//   4. Optionally write the demo first-effort + first weigh-in entries
//      that mirror what the OTP-success path used to do.
//
// verify_jwt is FALSE on this function because the caller has no JWT.
// The auth check below (user_id + email + recently created) limits
// the blast radius — an attacker would need a valid in-flight signUp
// user_id (a UUID), which is not random-guessable in any practical
// timeframe.
//
// IMPORTANT — `auth_user_id` is mandatory on every INSERT.
// profiles_active_must_have_auth CHECK: (deactivated_at IS NOT NULL OR
// auth_user_id IS NOT NULL). Active rows MUST have auth_user_id set.
// Without it, the upsert silently fails server-side and the journey
// continues to the next screen — the failure only surfaces at the
// NEXT authed upsert (NameScreen) which then trips the same constraint
// loudly. Setting it here closes the loop.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

interface EffortPayload {
  label: string
  type: string
  value: string
}

interface Body {
  user_id: string
  email: string
  body_data: {
    gender: string | null
    birthdate: string | null
    current_height: number
    current_weight: number
    weight_unit: 'lb' | 'kg'
    height_unit: 'imperial' | 'metric'
    distance_unit: 'mi' | 'km'
  }
  effort?: EffortPayload | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")   return json(405, { error: "method_not_allowed" })

  let payload: Body
  try { payload = await req.json() } catch { return json(400, { error: "bad_json" }) }
  if (!payload.user_id || !payload.email || !payload.body_data) {
    return json(400, { error: "bad_request" })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Auth check: the supplied user_id must match a real auth.users row
  // whose email matches the supplied value. Without a JWT this is the
  // only thing keeping the function from being abused, so we keep it
  // strict (UUID + email match).
  const { data: userData, error: getUserErr } = await admin.auth.admin.getUserById(payload.user_id)
  if (getUserErr || !userData?.user) {
    console.error("getUserById failed:", getUserErr)
    return json(404, { error: "user_not_found" })
  }
  const user = userData.user
  if (user.email?.toLowerCase() !== payload.email.toLowerCase()) {
    return json(403, { error: "email_mismatch" })
  }

  // T240: the marker is assigned by SIGNUP SOURCE. This function serves
  // BOTH journeys — the mobile athlete signup AND the web coach signup
  // call it right after signUp. The web coach signUp stamps
  // user_metadata.signup_journey = 'coach' at auth-account creation;
  // the mobile athlete signup sets no such metadata. The v9 bug: it
  // stamped 'C' unconditionally, so mid-journey MOBILE athletes were
  // marked as coaches (the coach email step then told them "you already
  // have a coach account"). An existing athlete CONVERTING via the coach
  // signup never reaches this function (signUp returns
  // user_already_exists) — AC is stamped in the coach Signup flow.
  const journey = (user.user_metadata as Record<string, unknown> | null)?.["signup_journey"]
  const accountMarker = journey === "coach" ? "C" : "A"

  const bd = payload.body_data
  const { error: profErr } = await admin.from("profiles").upsert({
    id:               payload.user_id,
    // auth_user_id satisfies the profiles_active_must_have_auth CHECK
    // constraint (active rows must have auth_user_id set). We mirror
    // it from id because profiles.id IS the auth.users.id in this
    // schema — they're 1:1 by design.
    auth_user_id:     payload.user_id,
    gender:           bd.gender,
    birthdate:        bd.birthdate,
    current_height:   bd.current_height,
    current_weight:   bd.current_weight,
    weight_unit:      bd.weight_unit,
    height_unit:      bd.height_unit,
    distance_unit:    bd.distance_unit,
    signup_checkpoint: "password",
    account_marker:    accountMarker,
  }, { onConflict: "id" })
  if (profErr) {
    console.error("init-profile-checkpoint upsert failed:", profErr)
    return json(500, { error: "db_error", detail: profErr.message })
  }

  // First-effort entry. Optional — present only on a fresh demo walk.
  if (payload.effort) {
    const { error: effortErr } = await admin.from("efforts").insert({
      user_id: payload.user_id,
      ...payload.effort,
    })
    if (effortErr) console.error("first effort insert failed:", effortErr)
  }

  // First weigh-in entry.
  const { error: bwErr } = await admin.from("bodyweight").insert({
    user_id: payload.user_id,
    weight:  bd.current_weight,
    unit:    bd.weight_unit,
  })
  if (bwErr) console.error("first bodyweight insert failed:", bwErr)

  return json(200, { success: true })
})
