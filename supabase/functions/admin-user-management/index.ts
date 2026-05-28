// admin-user-management
//
// Superuser-only edge function. Handles three account operations that
// require the service-role key and therefore cannot run from the browser:
//
//   action='deactivate'  — Ban the auth user (~100 yr ban) AND set
//                          profiles.deactivated_at = now(). The user can no
//                          longer log in, but all their data persists.
//                          Fully reversible via action='activate'.
//
//   action='activate'    — Unban the auth user AND clear profiles.deactivated_at.
//                          Restores normal sign-in. Idempotent.
//
//   action='hard_delete' — Permanently wipe the account. Calls
//                          auth.admin.deleteUser(target_user_id), which
//                          cascades through every FK that references
//                          auth.users(id) ON DELETE CASCADE — wiping
//                          profiles, efforts, bodyweight, rom_records,
//                          calorie_logs, calorie_plans, food_logs,
//                          hr_samples, step_samples, wearable_workouts,
//                          user_integrations, messages, credential_history,
//                          plus auth internals (identities, sessions, etc.).
//                          Irreversible.
//
// Authorization: caller MUST be a superuser. We extract their JWT from
// the Authorization header, look up auth.uid(), then check
// profiles.is_superuser=true. A non-superuser caller gets 403.
//
// Self-protection: a superuser CANNOT deactivate / delete themselves
// via this function. Returns 400 if target_user_id === caller.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// Supabase Edge Function runtime. No manual secret setup required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

const VALID_ACTIONS = new Set(["deactivate", "activate", "hard_delete"])
// 100-year ban duration — Supabase requires the Go time.Duration string format.
const BAN_DURATION_HOURS = "876000h"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" })

  // ── Step 1: identify the caller via their JWT ──────────────────────
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "missing_authorization" })
  }

  // Use the anon key + the caller's JWT to identify them (NEVER use the
  // service-role key for auth lookup — that bypasses RLS).
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !caller) {
    console.error("Caller JWT invalid:", callerErr?.message)
    return json(401, { error: "invalid_jwt" })
  }

  // ── Step 2: gate on is_superuser via service-role client ──────────
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: callerProfile, error: callerProfileErr } = await adminClient
    .from("profiles")
    .select("id, is_superuser")
    .eq("id", caller.id)
    .single()
  if (callerProfileErr || !callerProfile) {
    return json(403, { error: "caller_profile_missing" })
  }
  if (callerProfile.is_superuser !== true) {
    return json(403, { error: "superuser_required" })
  }

  // ── Step 3: parse + validate the request body ──────────────────────
  let body: any
  try { body = await req.json() } catch { return json(400, { error: "bad_json" }) }

  const action = String(body?.action ?? "").trim().toLowerCase()
  const targetUserId = String(body?.target_user_id ?? "").trim()
  const confirm = String(body?.confirm ?? "")

  if (!VALID_ACTIONS.has(action)) return json(400, { error: "invalid_action" })
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return json(400, { error: "invalid_target_user_id" })
  if (targetUserId === caller.id) return json(400, { error: "cannot_modify_self" })

  // Hard-delete additionally requires an explicit confirm token to guard
  // against double-click misfires. The frontend sends 'DELETE'.
  if (action === "hard_delete" && confirm !== "DELETE") {
    return json(400, { error: "missing_confirm_token" })
  }

  // ── Step 4: look up the target profile (for response payload) ─────
  const { data: targetProfile, error: targetErr } = await adminClient
    .from("profiles")
    .select("id, full_name, is_superuser, deactivated_at")
    .eq("id", targetUserId)
    .single()
  if (targetErr || !targetProfile) {
    return json(404, { error: "target_user_not_found" })
  }
  if (targetProfile.is_superuser === true) {
    // Prevent admins from deactivating / deleting other admins through
    // this endpoint. Use the Supabase dashboard for admin lifecycle.
    return json(403, { error: "cannot_modify_admin" })
  }

  // ── Step 5: execute the requested action ───────────────────────────
  try {
    if (action === "deactivate") {
      const { error: banErr } = await adminClient.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: BAN_DURATION_HOURS },
      )
      if (banErr) throw new Error(`ban failed: ${banErr.message}`)

      const { error: markErr } = await adminClient
        .from("profiles")
        .update({ deactivated_at: new Date().toISOString() })
        .eq("id", targetUserId)
      if (markErr) throw new Error(`mark deactivated_at failed: ${markErr.message}`)

      console.log(`[admin-mgmt] deactivated user ${targetUserId} by admin ${caller.id}`)
      return json(200, { success: true, action: "deactivate", target_user_id: targetUserId })
    }

    if (action === "activate") {
      const { error: unbanErr } = await adminClient.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: "none" },
      )
      if (unbanErr) throw new Error(`unban failed: ${unbanErr.message}`)

      const { error: clearErr } = await adminClient
        .from("profiles")
        .update({ deactivated_at: null })
        .eq("id", targetUserId)
      if (clearErr) throw new Error(`clear deactivated_at failed: ${clearErr.message}`)

      console.log(`[admin-mgmt] reactivated user ${targetUserId} by admin ${caller.id}`)
      return json(200, { success: true, action: "activate", target_user_id: targetUserId })
    }

    if (action === "hard_delete") {
      // Single call cascades through every FK with ON DELETE CASCADE on
      // auth.users(id). Tables wiped: profiles, efforts, bodyweight,
      // rom_records, calorie_logs, calorie_plans, food_logs, hr_samples,
      // step_samples, wearable_workouts, user_integrations, messages,
      // credential_history (via profiles cascade), plus auth internals
      // (identities, sessions, mfa_factors, etc.).
      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
      if (deleteErr) throw new Error(`delete failed: ${deleteErr.message}`)

      console.log(`[admin-mgmt] HARD-DELETED user ${targetUserId} (${targetProfile.full_name ?? "no name"}) by admin ${caller.id}`)
      return json(200, {
        success: true,
        action: "hard_delete",
        target_user_id: targetUserId,
        target_full_name: targetProfile.full_name,
      })
    }

    return json(400, { error: "unhandled_action" })
  } catch (err) {
    console.error(`[admin-mgmt] ${action} failed for ${targetUserId}:`, (err as Error).message)
    return json(500, { error: "action_failed", action, detail: (err as Error).message })
  }
})
