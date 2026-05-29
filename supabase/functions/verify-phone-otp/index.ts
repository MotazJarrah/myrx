// verify-phone-otp
//
// Calls Twilio Verify's VerificationCheck endpoint. On approved
// status: stamp profiles.phone = phone, profiles.phone_verified_at =
// NOW(), and return success.
//
// We write BOTH phone and phone_verified_at atomically here so the
// change-phone flow in /profile is single-step from the client's
// perspective. During signup the phone is also pre-written by the
// PhoneScreen — the redundant write is harmless and saves the edit
// flow from a two-write race window where phone is stale.
//
// All the things our previous implementation did manually — hash
// comparison, attempts counter, expiration check, row cleanup — are
// handled inside Twilio's Verify state machine. We just translate the
// final approved/pending result into a profile update.
//
// IMPORTANT — `auth_user_id` MUST be in the upsert payload, even
// though for an existing-profile UPDATE the column wouldn't change.
// PostgreSQL evaluates CHECK constraints on the PROPOSED INSERT row
// FIRST, BEFORE the ON CONFLICT branch fires. So an upsert payload
// of just { id, phone, phone_verified_at } proposes an INSERT row
// where auth_user_id is NULL — which fails the
// profiles_active_must_have_auth CHECK regardless of whether the
// existing row already has auth_user_id set. The fix: include
// auth_user_id = userId in the payload (it's a no-op for UPDATE
// since the value matches what's already there, and it makes the
// fallback INSERT path satisfy the constraint).
//
// Same fix pattern as init-profile-checkpoint and the NameScreen
// upsert in web/src/pages/coach/Signup.jsx.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TWILIO_ACCOUNT_SID        = Deno.env.get("TWILIO_ACCOUNT_SID")!
const TWILIO_AUTH_TOKEN         = Deno.env.get("TWILIO_AUTH_TOKEN")!
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

async function checkVerification(phone: string, code: string): Promise<{ ok: boolean; status: number; body: string }> {
  const url  = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  const params = new URLSearchParams({ To: phone, Code: code })
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")   return json(405, { error: "Method not allowed.", code: "method_not_allowed" })

  const auth = req.headers.get("Authorization") ?? ""
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: auth } },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) return json(401, { error: "Sign in and try again.", code: "unauthorized" })
  const userId = userData.user.id

  let payload: { phone?: string; code?: string }
  try { payload = await req.json() } catch { return json(400, { error: "We couldn't read that request. Try again.", code: "bad_json" }) }

  const phone = (payload.phone ?? "").trim()
  const code  = (payload.code  ?? "").trim()
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) return json(400, { error: "That phone number isn't in the right format. Check it and try again.", code: "invalid_phone" })
  if (!/^\d{4,8}$/.test(code))           return json(400, { error: "That code isn't the right length. Check it and try again.", code: "invalid_code" })

  const tw = await checkVerification(phone, code)
  if (!tw.ok) {
    console.error("Twilio Verify check failed:", tw.status, tw.body)
    if (tw.status === 404) return json(404, { error: "That code expired or was already used. Request a new one.", code: "no_active_code" })
    if (tw.body.includes("60202") || tw.body.includes("max check attempts")) {
      return json(429, { error: "Too many tries on this code. Wait a few minutes, then request a new one.", code: "too_many_attempts" })
    }
    return json(500, { error: "Couldn't verify the code right now. Try again in a moment.", code: "verify_failed", twilio_status: tw.status })
  }

  let parsed: { status?: string }
  try { parsed = JSON.parse(tw.body) } catch { parsed = {} }
  if (parsed.status !== "approved") {
    return json(400, { error: "That code didn't match. Check it and try again.", code: "invalid_code" })
  }

  // Code matched — write phone + verified-at atomically. Using upsert
  // so a missing profile row (edge case) doesn't silently no-op.
  // auth_user_id MUST be in the payload (see file-header comment) so
  // the proposed-INSERT row satisfies the profiles_active_must_have_auth
  // CHECK constraint. For the normal UPDATE branch the value matches
  // what's already there, so it's a no-op.
  const verifiedAt = new Date().toISOString()
  const { error: profErr } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, auth_user_id: userId, phone, phone_verified_at: verifiedAt },
      { onConflict: "id" }
    )
  if (profErr) {
    console.error("set phone + phone_verified_at failed:", profErr)
    return json(500, { error: "Verified, but we couldn't save your phone. Try again.", code: "db_error", detail: profErr.message })
  }

  return json(200, { success: true, phone, verified_at: verifiedAt })
})
