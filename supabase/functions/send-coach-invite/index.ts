// send-coach-invite
//
// JWT-required. Lets a coach invite a prospective client to MyRX by
// EMAIL ONLY (v1 — locked May 27 2026). Generates an accept-invite
// token, records the invite in coach_invites, and dispatches the
// email via SendGrid. The accept URL is:
//
//   https://coach.myrxfit.com/accept-invite?token=<64-char-token>
//
// Authorization:
//
//   1. Verifies the JWT in the Authorization header (anon client +
//      auth.getUser).
//   2. Gates on profiles.is_coach = true. Non-coaches → 403.
//
// Validations (locked May 27 2026):
//
//   - invitee_email is REQUIRED. Email is the canonical identity anchor
//     for the patient-invite detection (see CLAUDE.md "Coach invite →
//     invitee path" — mobile email-match runs at signup AND on every
//     app launch to attach pending invites to the right user, including
//     existing free athletes who never tap the original link).
//   - Email shape sanity-checked + lowercased.
//   - Lookup any existing profile matching the email via
//     lookup_invitee_profile RPC:
//       * is_coach = true               → 400 cant_invite_coach
//       * is_superuser = true           → 400 cant_invite_admin
//       * deactivated_at IS NOT NULL    → 400 account_deactivated
//       * coach_id = caller             → 400 already_on_roster
//       * coach_id != caller (not null) → ALLOW (swap at accept-time)
//   - Lookup any pending+unexpired invite from the same coach to the
//     same email. If found → 400 invite_already_pending.
//
// Token: 64-char URL-safe hex (two crypto.randomUUID() blocks joined,
// dashes stripped). Inserted with expires_at = now() + 14 days.
//
// Email dispatch: SendGrid (https://docs.sendgrid.com/api-reference/
// mail-send/mail-send). Requires the SENDGRID_API_KEY project secret +
// a verified sending domain (myrxfit.com with SPF/DKIM/DMARC DNS
// records, set up in the SendGrid dashboard). If the key is missing,
// the function still inserts the invite row + returns success with
// sent_email=false — the accept URL is in the response body for
// hand-delivery (and logged for recovery).
//
// SMS / phone field removed v1 (locked May 27 2026). Click-count to the
// App Store is identical via SMS or email but SMS adds 1-3 weeks of
// A2P 10DLC vetting + monthly carrier fees for zero UX gain. The
// historical phone field also caused false-positive invitee lookups
// (coach's own phone colliding with other profiles). The
// coach_invites.invitee_phone column is retained NULLABLE for legacy
// rows but this function no longer writes to it.
//
// Activity event: best-effort INSERT into user_activity_events with
// event_type='coach.invite_sent'. Wrapped in try/catch.
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY are
// auto-injected by the Supabase Edge Function runtime. SENDGRID_* and
// SITE_URL come from project secrets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!
const SENDGRID_API_KEY          = Deno.env.get("SENDGRID_API_KEY") ?? ""
const SENDGRID_FROM             = Deno.env.get("SENDGRID_FROM") ?? "MyRX <invites@myrxfit.com>"
const SITE_URL                  = Deno.env.get("SITE_URL") ?? "https://myrxfit.com"

/**
 * Parses a "Display Name <email@domain>" string into its components.
 * Falls back to email-only when no display name is present.
 */
function parseFromAddress(input: string): { email: string; name?: string } {
  const match = input.match(/^\s*(.+?)\s*<([^>]+)>\s*$/)
  if (match) return { name: match[1], email: match[2] }
  return { email: input.trim() }
}

const INVITE_TTL_DAYS = 14

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
})

// Basic-but-strict email shape check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Generate a 64-char URL-safe hex token by concatenating two
 * randomUUIDs and stripping dashes.
 */
function generateInviteToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  )
}

/**
 * SendGrid email send. Returns { ok, status, body }. If
 * SENDGRID_API_KEY isn't set, returns ok:false with body
 * 'sendgrid_not_configured' — the invite row still gets persisted;
 * the URL is recoverable from the response body for hand-delivery.
 */
async function sendInviteEmail(args: {
  to: string
  coachName: string
  coachMessage: string | null
  acceptUrl: string
}): Promise<{ ok: boolean; status: number; body: string }> {
  if (!SENDGRID_API_KEY) {
    return { ok: false, status: 0, body: "sendgrid_not_configured" }
  }

  // Optional coach note → a light quoted block with a lime accent rule.
  const personalLine = args.coachMessage
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;"><tr><td style="padding:14px 16px;background:#F4F3EF;border-left:3px solid #CAF240;border-radius:8px;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;font-style:italic;">${escapeHtml(args.coachMessage)}</p>
          </td></tr></table>`
    : ""

  const safeCoach = escapeHtml(args.coachName)

  // Light, high-contrast, table-based email (T178). Matches the auth-email
  // shell: cream #F4F3EF outer, white #FFFFFF card, dark #121721 header
  // strip with the white+lime wordmark, single lime button (table-cell
  // bgcolor so Outlook renders it), near-black body text. The
  // color-scheme meta + supported-color-schemes lock it to LIGHT so
  // Outlook's dark mode can't invert it into a muddy block.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeCoach} invited you to MyRX</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;color:#121721;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color-scheme:light;supported-color-schemes:light;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#F4F3EF" style="background:#F4F3EF;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E2DA;">
        <tr><td align="center" bgcolor="#121721" style="background:#121721;padding:28px 16px;">
          <img src="${SITE_URL}/email-logo.png" alt="MyRX" width="120" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;color:#121721;">${safeCoach} invited you to train on MyRX</h1>
          ${personalLine}
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">Accept the invite and your coach sees your training and your numbers, and works the plan with you — right inside the app.</p>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#374151;">Your MyRX subscription is fully covered by your coach. No payment needed from you.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#CAF240" style="background:#CAF240;border-radius:10px;">
            <a href="${args.acceptUrl}" style="display:inline-block;padding:15px 34px;color:#121721;font-size:15px;font-weight:700;text-decoration:none;">Accept invite</a>
          </td></tr></table>
          <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#6B7280;">Button not working? Paste this into your browser:<br><a href="${args.acceptUrl}" style="color:#3B7A57;word-break:break-all;">${args.acceptUrl}</a></p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #E5E2DA;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9CA3AF;">This invite expires in 14 days. Didn't expect it? Just ignore this email — nothing happens.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#A8A29E;">MyRX — train one step at a time</p>
    </td></tr>
  </table>
</body></html>`

  const text = `${args.coachName} invited you to MyRX.

${args.coachMessage ? args.coachMessage + '\n\n' : ''}Tap to accept and start training together:
${args.acceptUrl}

Your MyRX subscription is covered by your coach. No payment is required from you.

This link expires in 14 days. Didn't expect this? Ignore the email — nothing happens.`

  const from = parseFromAddress(SENDGRID_FROM)

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: args.to }] }],
      from,
      subject: `${args.coachName} invited you to MyRX`,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html",  value: html },
      ],
      // Tracking off — these are transactional invites. Click-tracking
      // would rewrite the accept URL into a SendGrid redirect, which
      // (a) leaks the token to SendGrid's logs and (b) breaks Android
      // App Link / iOS Universal Link autoVerify because the host
      // changes from myrxfit.com to sendgrid.net.
      tracking_settings: {
        click_tracking:        { enable: false, enable_text: false },
        open_tracking:         { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/**
 * Best-effort write to user_activity_events. Silently swallows
 * errors so the invite still succeeds.
 */
async function recordActivityEvent(
  admin: ReturnType<typeof createClient>,
  coachId: string,
  details: Record<string, unknown>,
) {
  try {
    const { error } = await admin.from("user_activity_events").insert({
      user_id:     coachId,
      actor_id:    coachId,
      actor_role:  "coach",
      source:      "coach",
      event_type:  "coach.invite_sent",
      details,
    })
    if (error) {
      console.warn("[send-coach-invite] activity event write skipped:", error.message)
    }
  } catch (err) {
    console.warn("[send-coach-invite] activity event write threw:", (err as Error).message)
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST")    return json(405, { success: false, error: "Method not allowed.", code: "method_not_allowed" })

  // ── Step 1: identify the caller via their JWT ──────────────────────
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { success: false, error: "Sign in to send invites.", code: "missing_authorization" })
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !caller) {
    console.error("[send-coach-invite] caller JWT invalid:", callerErr?.message)
    return json(401, { success: false, error: "Your session expired. Sign in again.", code: "invalid_jwt" })
  }

  // ── Step 2: gate on is_coach via service-role client ──────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from("profiles")
    .select("id, full_name, is_coach")
    .eq("id", caller.id)
    .maybeSingle()
  if (callerProfileErr) {
    console.error("[send-coach-invite] caller profile lookup failed:", callerProfileErr.message)
    return json(500, { success: false, error: "Couldn't load your profile. Try again.", code: "caller_profile_lookup_failed" })
  }
  if (!callerProfile) {
    return json(403, { success: false, error: "Your profile didn't load. Sign out, sign in again, and try once more — email team@myrxfit.com if it persists.", code: "caller_profile_missing" })
  }
  if (callerProfile.is_coach !== true) {
    return json(403, { success: false, error: "Only coach accounts can send invites.", code: "coach_required" })
  }

  // ── Step 3: parse + shape-check the body ──────────────────────────
  let body: any
  try { body = await req.json() } catch { return json(400, { success: false, error: "Bad request.", code: "bad_json" }) }

  const rawEmail = typeof body?.invitee_email === "string" ? body.invitee_email.trim() : ""
  const coachMessage = typeof body?.coach_message === "string"
    ? body.coach_message.trim().slice(0, 1000)   // hard cap to keep DB row small
    : null

  if (!rawEmail) {
    return json(400, { success: false, error: "Add an email — that's where the invite goes.", code: "missing_email" })
  }

  const email = rawEmail.toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return json(400, { success: false, error: "That email doesn't look right. Check the spelling.", code: "invalid_email" })
  }

  // ── Step 4: invitee-state matrix (email-only lookup) ───────────────
  // RPC `lookup_invitee_profile` joins profiles + auth.users and
  // matches by email (priority) or phone (fallback). v1 only passes
  // email so phone fallback is dormant — see CLAUDE.md identity rule.
  type ExistingProfile = {
    id: string
    full_name: string | null
    is_coach: boolean | null
    is_superuser: boolean | null
    deactivated_at: string | null
    coach_id: string | null
  }

  const { data: matches, error: lookupErr } = await admin
    .rpc("lookup_invitee_profile", { p_email: email, p_phone: null })
  if (lookupErr) {
    console.error("[send-coach-invite] invitee profile lookup failed:", lookupErr.message)
    return json(500, { success: false, error: "Couldn't check the invitee. Try again.", code: "invitee_lookup_failed" })
  }
  const existing = (matches?.[0] as ExistingProfile | undefined) ?? null

  if (existing) {
    const inviteeName = existing.full_name?.trim() || "That person"
    if (existing.is_coach === true) {
      return json(400, {
        success: false,
        error: "This email belongs to a coach. Coaches can't be invited as clients.",
        code: "cant_invite_coach",
      })
    }
    if (existing.is_superuser === true) {
      return json(400, {
        success: false,
        error: "This email belongs to a MyRX admin.",
        code: "cant_invite_admin",
      })
    }
    if (existing.deactivated_at) {
      return json(400, {
        success: false,
        error: "This account is deactivated. They'll need to reactivate before you can invite them — team@myrxfit.com can help.",
        code: "account_deactivated",
      })
    }
    if (existing.coach_id === caller.id) {
      return json(400, {
        success: false,
        error: `${inviteeName} is already on your roster.`,
        code: "already_on_roster",
      })
    }
    // coach_id != caller (and not null) → ALLOW. Coach swap is
    // handled at accept-invite time (mobile app shows swap-confirm
    // sheet to the invitee).
  }

  // ── Step 5: duplicate-invite guard (email-only) ────────────────────
  const nowIso = new Date().toISOString()
  const { data: pending, error: dupErr } = await admin
    .from("coach_invites")
    .select("id, expires_at")
    .eq("coach_id", caller.id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .ilike("invitee_email", email)
    .limit(1)
  if (dupErr) {
    console.error("[send-coach-invite] dup invite lookup failed:", dupErr.message)
    return json(500, { success: false, error: "Couldn't check pending invites. Try again.", code: "dup_lookup_failed" })
  }
  if (pending && pending.length > 0) {
    const expiresAt = new Date(pending[0].expires_at)
    const expiryLabel = expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })
    return json(400, {
      success: false,
      error: `You already have a pending invite for this email (expires ${expiryLabel}). Resend or revoke from the invites list.`,
      code: "invite_already_pending",
    })
  }

  // ── Step 6: persist the invite ────────────────────────────────────
  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error: insertErr } = await admin
    .from("coach_invites")
    .insert({
      coach_id:      caller.id,
      invitee_email: email,
      invitee_phone: null,   // v1: phone removed from form (see header)
      coach_message: coachMessage,
      token,
      expires_at:    expiresAt,
      status:        "pending",
    })
    .select("id, expires_at")
    .single()
  if (insertErr || !invite) {
    console.error("[send-coach-invite] insert failed:", insertErr?.message)
    return json(500, {
      success: false,
      error: "Couldn't save the invite. Try again.",
      code: "invite_insert_failed",
      detail: insertErr?.message,
    })
  }

  const acceptUrl = `${SITE_URL}/accept-invite?token=${token}`
  const coachName = callerProfile.full_name?.trim() || "Your coach"

  // ── Step 7: send the email (best-effort via SendGrid) ──────────────
  let sentEmail = false
  let emailError: string | null = null
  const result = await sendInviteEmail({
    to:           email,
    coachName,
    coachMessage,
    acceptUrl,
  })
  if (result.ok) {
    sentEmail = true
  } else {
    emailError = result.body
    console.warn("[send-coach-invite] email send failed; URL surfaced in response for manual delivery", {
      to:              email,
      accept_url:      acceptUrl,
      coach_name:      coachName,
      sendgrid_status: result.status,
      sendgrid_body:   result.body.slice(0, 500),
    })
  }

  // ── Step 8: best-effort activity event ─────────────────────────────
  await recordActivityEvent(admin, caller.id, {
    invitee_email: email,
    token_id:      invite.id,
  })

  console.log(`[send-coach-invite] invite ${invite.id} sent by coach ${caller.id} (email=${email})`)

  return json(200, {
    success: true,
    invite: {
      id:          invite.id,
      expires_at:  invite.expires_at,
      sent_email:  sentEmail,
      email_error: emailError,
      // accept_url surfaced so the coach UI can show a copy-link fallback
      // when SendGrid hasn't fired (e.g. provisioning gap). Coach is
      // already authorized over this row — returning the URL doesn't
      // expand attack surface.
      accept_url:  acceptUrl,
    },
  })
})
