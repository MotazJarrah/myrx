// trial-reminders — T165 email reminder dispatcher for the 30-day FullRX
// reverse trial.
//
// Invoked hourly by pg_cron (job: b2c_trial_reminders) via net.http_post.
// Scans profiles for live athlete trials entering the reminder windows and
// sends each reminder exactly once (stamped via the
// b2c_trial_reminder_{7d,2d}_sent_at columns):
//
//   • 7-day reminder — trial ends within 7 days, 7d stamp NULL
//   • 2-day reminder — trial ends within 2 days, 2d stamp NULL
//
// A user entering BOTH windows in one run (possible with dev time-travel
// on b2c_trial_ends_at) gets ONLY the 2-day email; the 7d stamp is set
// silently so they never receive two nags back-to-back.
//
// AUTH — nonce handshake (T165, replaces the vault-service-key design
// that 401'd forever pending a human pasting a key into Vault):
//   1. pg_cron tick: INSERTs a one-time row into public.cron_nonces and
//      sends its id as body.nonce. We consume it ATOMICALLY here
//      (used_at stamp + purpose match + 10-minute freshness). Only
//      something with DB write access can mint nonces — outsiders
//      calling this URL get 401. verify_jwt is OFF for this function;
//      the nonce IS the auth.
//   2. Operator path: Bearer <service-role key> still accepted for
//      manual ops runs.
//
// EMAIL SOURCE: profiles has NO email column (emails live in auth.users
// — the profiles.email mention in older docs is stale). Each candidate's
// address is resolved via auth.admin.getUserById; candidate sets are
// tiny (users inside a 7-day expiry window), so per-row lookups are fine.
//
// EMAIL DESIGN (T178, 2026-06-10): light, high-contrast, table-based,
// matching the coach-invite + auth-email shell (cream #F4F3EF outer,
// white card, dark #121721 header strip w/ logo, near-black body,
// forced-light meta so Outlook can't dark-invert it). No CTA button —
// the action is "open the app" (athlete payments are native-store IAP
// per T176; we never link to web).
//
// Exclusions (mirror TrialBanner's eligibility): coach-attached athletes
// (covered by their coach), coaches, superusers, anonymized accounts, and
// users who already bought a paid tier ('free' is the column DEFAULT —
// only corerx/fullrx opt out of reminders).
//
// Copy rules (locked 2026-06-09): gentle "keep your access" framing.
// NEVER "you'll be charged" — there is no card on file and nothing
// auto-bills; day 30 just drops the account to the Free tier.
//
// Email dispatch: SendGrid — same SENDGRID_API_KEY / SENDGRID_FROM
// secrets as send-coach-invite. Missing key → rows are NOT stamped, so
// reminders retry on the next run once the key lands. Per-row send
// failures also leave the row unstamped (retry next hour).
//
// Notifications future (T166): when the push/in-app notification system
// ships, this dispatcher gains a push channel alongside email.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const SENDGRID_FROM = Deno.env.get("SENDGRID_FROM") ?? "MyRX <no-reply@myrxfit.com>";

function parseFromAddress(input: string): { email: string; name?: string } {
  const match = input.match(/^(.*)<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { email: input.trim() };
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!SENDGRID_API_KEY) return false;
  const from = parseFromAddress(SENDGRID_FROM);
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
  return res.status >= 200 && res.status < 300;
}

function firstName(fullName: string | null): string {
  if (!fullName) return "there";
  return fullName.trim().split(/\s+/)[0] || "there";
}

// Light, high-contrast email shell (T178) — matches send-coach-invite +
// the auth templates. Forced light so Outlook dark mode can't invert it.
function reminderHtml(name: string, daysLeft: number): string {
  const dayWord = daysLeft === 1 ? "day" : "days";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Your FullRX trial — ${daysLeft} ${dayWord} left</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;color:#121721;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color-scheme:light;supported-color-schemes:light;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#F4F3EF" style="background:#F4F3EF;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E2DA;">
        <tr><td align="center" bgcolor="#121721" style="background:#121721;padding:28px 16px;">
          <img src="https://myrxfit.com/email-logo.png" alt="MyRX" width="120" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;color:#121721;">Hey ${name} — ${daysLeft} ${dayWord} left of FullRX</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">When your trial ends, your account drops to Free — no charge, nothing to cancel, and all your logs stay. To keep Bodyweight, Calories, Heart, Sleep &amp; Hydration, open MyRX &rarr; <strong style="color:#121721;">Settings &rarr; Billing</strong>.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #E5E2DA;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9CA3AF;">You're getting this because you have an active MyRX trial. — The MyRX team</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#A8A29E;">MyRX — train one step at a time</p>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Auth: one-time cron nonce OR operator service-key bearer ───────
  const auth = req.headers.get("Authorization") ?? "";
  let authorized = !!SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`;
  if (!authorized) {
    let nonce: string | null = null;
    try {
      const body = await req.json();
      nonce = typeof body?.nonce === "string" ? body.nonce : null;
    } catch { /* no/invalid body → stays unauthorized */ }
    if (nonce && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nonce)) {
      const { data: consumed } = await db
        .from("cron_nonces")
        .update({ used_at: new Date().toISOString() })
        .eq("id", nonce)
        .eq("purpose", "trial_reminders")
        .is("used_at", null)
        .gt("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .select("id");
      authorized = !!consumed && consumed.length > 0;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  // Candidates: live athlete trials inside the widest (7-day) window.
  // NOTE: no email here — profiles has no email column; resolved per-row
  // below via auth.admin.getUserById.
  const { data: rows, error } = await db
    .from("profiles")
    .select("id, full_name, b2c_trial_ends_at, b2c_trial_reminder_7d_sent_at, b2c_trial_reminder_2d_sent_at")
    .not("b2c_trial_ends_at", "is", null)
    .gt("b2c_trial_ends_at", new Date().toISOString())
    .lte("b2c_trial_ends_at", new Date(Date.now() + 7 * 86_400_000).toISOString())
    .is("coach_id", null)
    .is("anonymized_at", null)
    .or("b2c_subscription_tier.is.null,b2c_subscription_tier.eq.free")
    .not("is_coach", "is", true)
    .not("is_superuser", "is", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent7 = 0, sent2 = 0, skipped = 0, failures = 0;

  for (const row of rows ?? []) {
    // Resolve the email from auth.users (profiles has no email column).
    let email: string | null = null;
    try {
      const { data: u } = await db.auth.admin.getUserById(row.id);
      email = u?.user?.email ?? null;
    } catch { /* lookup failed → treated as no email */ }
    if (!email) { skipped++; continue; }

    const msLeft = new Date(row.b2c_trial_ends_at).getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    const in2dWindow = msLeft <= 2 * 86_400_000;
    const name = firstName(row.full_name);

    try {
      if (in2dWindow && !row.b2c_trial_reminder_2d_sent_at) {
        const ok = await sendEmail(
          email,
          `Your FullRX trial ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
          reminderHtml(name, daysLeft),
        );
        if (ok) {
          // Stamp 2d, and 7d too if it was never sent — entering both
          // windows at once must produce exactly ONE email.
          const stamp = new Date().toISOString();
          await db.from("profiles").update({
            b2c_trial_reminder_2d_sent_at: stamp,
            ...(row.b2c_trial_reminder_7d_sent_at ? {} : { b2c_trial_reminder_7d_sent_at: stamp }),
          }).eq("id", row.id);
          sent2++;
        } else failures++;
      } else if (!in2dWindow && !row.b2c_trial_reminder_7d_sent_at) {
        const ok = await sendEmail(
          email,
          "A week left of FullRX — here's what you'd keep",
          reminderHtml(name, daysLeft),
        );
        if (ok) {
          await db.from("profiles").update({
            b2c_trial_reminder_7d_sent_at: new Date().toISOString(),
          }).eq("id", row.id);
          sent7++;
        } else failures++;
      } else {
        skipped++;
      }
    } catch {
      failures++;
    }
  }

  return new Response(
    JSON.stringify({ candidates: (rows ?? []).length, sent7, sent2, skipped, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
