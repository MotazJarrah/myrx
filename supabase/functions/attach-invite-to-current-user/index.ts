// attach-invite-to-current-user
//
// JWT-required. Called by the mobile app when the signed-in user
// confirms acceptance of a pending coach invite — via any path:
//   (a) Auto-detected banner on the dashboard (email-match)
//   (b) Manual paste of a token / URL in Settings
//   (c) Custom URL scheme deep link (myrx://accept-invite?token=...)
//   (d) Universal Link / App Link (once apps ship)
//
// All four paths funnel through this single endpoint so the validation
// + state-transition logic stays in one place.
//
// Validation matrix (matches the locked Q6 accept-time rules):
//
//   Token state:
//     - token row not found            → 404 invite_not_found
//     - status != 'pending'            → 410 invite_already_used (accepted)
//                                       or invite_revoked (revoked)
//     - expires_at <= now()            → 410 invite_expired
//
//   Caller state (queried from profiles for current user):
//     - is_coach = true                → 403 cant_accept_as_coach
//     - is_superuser = true            → 403 cant_accept_as_admin
//     - deactivated_at is set          → 403 account_deactivated
//     - coach_id = invite.coach_id     → 200 success { already_attached: true }
//                                       (silent no-op — already on this
//                                       coach's roster, no DB write)
//     - coach_id is a different coach  → ALLOW with { swapped_from_coach_id }
//                                       in response so UI can show
//                                       'swapped from Coach Bob' confirm
//
//   Email match (security gate):
//     - invitee_email != caller email  → 403 email_mismatch
//
//     Strict email-match for ALL paths including manual paste.
//     Rationale: prevents forward-invite abuse where user A receives
//     the email, sends the link to user B, and B accepts on B's own
//     account. The coach intended to coach A, not B. If invitee uses
//     a different signup email, the coach can resend to the new email
//     — a 5-second fix vs. a security hole.
//
// State transition (two writes, profile first):
//   - UPDATE profiles SET coach_id = invite.coach_id,
//                          is_self_coached = false
//     WHERE id = caller.id
//   - UPDATE coach_invites SET status = 'accepted',
//                              accepted_at = now(),
//                              accepted_by = caller.id
//     WHERE id = invite.id
//
// Chat v3 note (T170 fix, 2026-06-10): this update previously ALSO set
// chat_enabled = true — but the chat-v3 rework (May 30 2026, task #338)
// DROPPED profiles.chat_enabled (coach-client chat is unconditional now;
// the coach_id link itself is the permission, and admin chat uses the
// separate admin_chat_enabled column). The stale column reference made
// this UPDATE fail with a Postgres undefined-column error → every invite
// acceptance 500'd with profile_update_failed from May 30 until this fix.
// Caught live during T165 trial testing. The accept_coach_invite RPC got
// the same cleanup ON May 30; this function was missed because its source
// only lived in the dashboard — it now lives here in the repo.
//
// Response on success returns the new coach's display profile
// (full_name, avatar_url) so the mobile confirmation UI can show
// 'You're now training with Coach <name>' without a follow-up query.
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY are
// auto-injected by the Supabase Edge Function runtime.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { success: false, error: "Method not allowed.", code: "method_not_allowed" })

  // ── Step 1: identify the caller via their JWT ──────────────────────
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { success: false, error: "Sign in to accept invites.", code: "missing_authorization" })
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !caller) {
    console.error("[attach-invite] caller JWT invalid:", callerErr?.message)
    return json(401, { success: false, error: "Your session expired. Sign in again.", code: "invalid_jwt" })
  }
  const callerEmail = (caller.email ?? "").toLowerCase()
  if (!callerEmail) {
    return json(403, { success: false, error: "Your account is missing an email.", code: "caller_email_missing" })
  }

  // ── Step 2: parse the body ─────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch { return json(400, { success: false, error: "Bad request.", code: "bad_json" }) }
  const rawToken = typeof body?.token === "string" ? body.token.trim() : ""
  if (!rawToken) {
    return json(400, { success: false, error: "Provide an invite token.", code: "missing_token" })
  }
  if (!/^[a-f0-9]{32,128}$/i.test(rawToken)) {
    return json(404, { success: false, error: "That invite code doesn't look right.", code: "invalid_token_shape" })
  }

  // ── Step 3: load caller profile + invite via service-role ─────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from("profiles")
    .select("id, full_name, is_coach, is_superuser, deactivated_at, coach_id, is_self_coached")
    .eq("id", caller.id)
    .maybeSingle()
  if (callerProfileErr) {
    console.error("[attach-invite] caller profile lookup failed:", callerProfileErr.message)
    return json(500, { success: false, error: "Couldn't load your profile. Try again.", code: "caller_profile_lookup_failed" })
  }
  if (!callerProfile) {
    return json(403, { success: false, error: "Your profile is missing. Contact support.", code: "caller_profile_missing" })
  }

  if (callerProfile.is_coach === true) {
    return json(403, {
      success: false,
      error: "Coaches can't accept invites — sign in as a client account.",
      code: "cant_accept_as_coach",
    })
  }
  if (callerProfile.is_superuser === true) {
    return json(403, {
      success: false,
      error: "Admin accounts can't accept invites.",
      code: "cant_accept_as_admin",
    })
  }
  if (callerProfile.deactivated_at) {
    return json(403, {
      success: false,
      error: "Your account is deactivated. Contact support to reactivate it first.",
      code: "account_deactivated",
    })
  }

  // ── Step 4: load the invite ────────────────────────────────────────
  const { data: invite, error: inviteErr } = await admin
    .from("coach_invites")
    .select("id, coach_id, invitee_email, status, expires_at, accepted_at, accepted_by")
    .eq("token", rawToken)
    .maybeSingle()
  if (inviteErr) {
    console.error("[attach-invite] invite lookup failed:", inviteErr.message)
    return json(500, { success: false, error: "Couldn't look up that invite. Try again.", code: "invite_lookup_failed" })
  }
  if (!invite) {
    return json(404, {
      success: false,
      error: "We couldn't find that invite. Double-check the code with your coach.",
      code: "invite_not_found",
    })
  }

  if (invite.status === "accepted") {
    return json(410, {
      success: false,
      error: "This invite has already been used. If that was you, you're already on your coach's roster.",
      code: "invite_already_used",
    })
  }
  if (invite.status === "revoked") {
    return json(410, {
      success: false,
      error: "Your coach revoked this invite. Reach out to ask for a fresh one.",
      code: "invite_revoked",
    })
  }
  if (invite.status !== "pending") {
    return json(410, {
      success: false,
      error: `Invite is in an unexpected state (${invite.status}).`,
      code: "invite_bad_status",
    })
  }
  if (new Date(invite.expires_at) <= new Date()) {
    return json(410, {
      success: false,
      error: "This invite expired. Ask your coach to send a fresh one — your account is still ready.",
      code: "invite_expired",
    })
  }

  const inviteEmail = (invite.invitee_email ?? "").toLowerCase()
  if (!inviteEmail || inviteEmail !== callerEmail) {
    return json(403, {
      success: false,
      error: `This invite was sent to ${invite.invitee_email}. Sign in with that email, or ask your coach to send a fresh invite to ${caller.email}.`,
      code: "email_mismatch",
      invitee_email: invite.invitee_email,
    })
  }

  // ── Step 5: already-attached short-circuit (silent no-op) ─────────
  if (callerProfile.coach_id === invite.coach_id) {
    return json(200, {
      success: true,
      already_attached: true,
      coach_id: invite.coach_id,
      message: "You're already on this coach's roster.",
    })
  }

  const swappedFromCoachId = callerProfile.coach_id || null

  // ── Step 6: state transition ────────────────────────────────────────
  // Chat v3: NO chat_enabled write here — the column is gone; the
  // coach_id link itself is the chat permission (see header note).
  const { error: profileUpdateErr } = await admin
    .from("profiles")
    .update({
      coach_id:        invite.coach_id,
      is_self_coached: false,
    })
    .eq("id", caller.id)
  if (profileUpdateErr) {
    console.error("[attach-invite] profile update failed:", profileUpdateErr.message)
    return json(500, {
      success: false,
      error: "Couldn't attach you to your coach. Try again — your account wasn't changed.",
      code: "profile_update_failed",
      detail: profileUpdateErr.message,
    })
  }

  const { error: inviteUpdateErr } = await admin
    .from("coach_invites")
    .update({
      status:      "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: caller.id,
    })
    .eq("id", invite.id)
  if (inviteUpdateErr) {
    console.error("[attach-invite] invite status update failed (relationship is attached):", inviteUpdateErr.message, { invite_id: invite.id, caller_id: caller.id })
  }

  // ── Step 7: load coach display info for the response ─────────────
  const { data: coachProfile } = await admin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", invite.coach_id)
    .maybeSingle()

  console.log(`[attach-invite] invite ${invite.id} accepted by ${caller.id} (was on coach ${swappedFromCoachId ?? "NONE"} → now on coach ${invite.coach_id})`)

  return json(200, {
    success: true,
    already_attached: false,
    invite_id:           invite.id,
    coach_id:            invite.coach_id,
    coach_full_name:     coachProfile?.full_name ?? null,
    coach_avatar_url:    coachProfile?.avatar_url ?? null,
    swapped_from_coach_id: swappedFromCoachId,
    was_self_coached:    callerProfile.is_self_coached === true,
  })
})
