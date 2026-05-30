# Supabase Auth Email Templates — MyRX (Locked May 30 2026)

Final canonical reference for the five transactional Supabase Auth emails sent
to MyRX users. Each template went through three pivots before landing on the
locked design described below:

1. **Dark navy on dark navy** — Outlook mobile mangled it (lifted card to grey,
   inverted lime to olive). Documented [Outlook Android dark-mode behavior](https://emailsyall.com/mitigating_the_disaster/);
   no CSS workaround exists.
2. **Button-first reorder + `[data-ogsc]` selectors** — Outlook mobile ignored
   them. Research confirmed Outlook for Android's auto-darken pass is
   uncontrollable from HTML/CSS.
3. **Light chrome + dark navy band for the logo** — current locked version.
   Renders correctly on Outlook mobile, Outlook desktop, Apple Mail.

A fourth pivot (May 30 2026) split the 5 templates into **two structural
variants** based on whether the app actually has a UI to consume the 6-digit
OTP code:

- **2-section variant** (button-only): heading → lead → button → divider → footer
- **3-section variant** (button + code): heading → lead → button → divider → "Or enter this code in the app:" → token chip → divider → footer

---

## Variant A — Button-only HTML (used by 3 templates)

Used when the app has NO UI to type a 6-digit code for this auth type. Only
the email link works.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#F4F3EF" style="background:#F4F3EF;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E2DA;">

<!-- DARK NAVY HEADER BAND with logo -->
<tr><td align="center" bgcolor="#121721" style="background:#121721;padding:28px 16px;">
<img src="https://myrxfit.com/email-logo.png" alt="MyRX" width="100" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">
</td></tr>

<!-- HEADING on white card -->
<tr><td style="padding:32px 32px 8px 32px;color:#121721;font-size:22px;font-weight:600;line-height:1.4;text-align:center;">{HEADING}</td></tr>

<!-- LEAD HELPER TEXT -->
<tr><td style="padding:0 32px 24px 32px;color:#5A6478;font-size:14px;line-height:1.6;text-align:center;">{LEAD}</td></tr>

<!-- LIME CTA BUTTON -->
<tr><td align="center" style="padding:0 32px 28px 32px;">
<a href="{CTA_HREF}" style="display:inline-block;background:#CAF240;color:#121721;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;">{CTA_LABEL}</a>
</td></tr>

<tr><td style="padding:0 32px;"><hr style="border:0;border-top:1px solid #E5E2DA;margin:0;"></td></tr>

<!-- FOOTER COPY -->
<tr><td style="padding:20px 32px 32px 32px;color:#5A6478;font-size:12px;line-height:1.6;text-align:center;">{FOOTER}</td></tr>

</table>

<!-- ATTRIBUTION (outside card, on cream bg) -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin-top:24px;">
<tr><td align="center" style="color:#5A6478;font-size:12px;line-height:1.5;">MyRX &middot; <a href="https://myrxfit.com" style="color:#5A6478;text-decoration:underline;">myrxfit.com</a></td></tr>
</table>

</td></tr></table>
</body>
</html>
```

**Used by:** Invite user, Magic link or OTP, Change email address.

---

## Variant B — Button + Code HTML (used by 2 templates)

Used when the app DOES have a UI to type the 6-digit code. Adds the "Or enter
this code in the app:" section + dark navy token chip below the button divider.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#F4F3EF" style="background:#F4F3EF;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E2DA;">

<tr><td align="center" bgcolor="#121721" style="background:#121721;padding:28px 16px;">
<img src="https://myrxfit.com/email-logo.png" alt="MyRX" width="100" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">
</td></tr>

<tr><td style="padding:32px 32px 8px 32px;color:#121721;font-size:22px;font-weight:600;line-height:1.4;text-align:center;">{HEADING}</td></tr>
<tr><td style="padding:0 32px 24px 32px;color:#5A6478;font-size:14px;line-height:1.6;text-align:center;">{LEAD}</td></tr>

<tr><td align="center" style="padding:0 32px 28px 32px;">
<a href="{CTA_HREF}" style="display:inline-block;background:#CAF240;color:#121721;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;">{CTA_LABEL}</a>
</td></tr>

<tr><td style="padding:0 32px;"><hr style="border:0;border-top:1px solid #E5E2DA;margin:0;"></td></tr>

<!-- CODE ALTERNATIVE — only in Variant B -->
<tr><td style="padding:20px 32px 12px 32px;color:#5A6478;font-size:13px;line-height:1.6;text-align:center;">Or enter this code in the app:</td></tr>
<tr><td align="center" style="padding:0 32px 24px 32px;">
<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#CAF240;font-family:'Courier New',monospace;background:#121721;padding:16px 24px;border-radius:8px;display:inline-block;">{{ .Token }}</div>
</td></tr>

<tr><td style="padding:0 32px;"><hr style="border:0;border-top:1px solid #E5E2DA;margin:0;"></td></tr>

<tr><td style="padding:20px 32px 32px 32px;color:#5A6478;font-size:12px;line-height:1.6;text-align:center;">{FOOTER}</td></tr>

</table>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin-top:24px;">
<tr><td align="center" style="color:#5A6478;font-size:12px;line-height:1.5;">MyRX &middot; <a href="https://myrxfit.com" style="color:#5A6478;text-decoration:underline;">myrxfit.com</a></td></tr>
</table>

</td></tr></table>
</body>
</html>
```

**Used by:** Confirm sign up, Reset password.

---

## Why some templates show a code and others don't

May 30 2026 audit of the codebase mapped each template's `{{ .Token }}` to
whether there's an actual UI surface where a user can type it. The verdict:

| Template | Variant | Code surface | Rationale |
|---|---|---|---|
| `confirm-sign-up` | **B** | Mobile: `(auth)/sign-up.tsx` OTPScreen (`type:'signup'`)<br>Web: `coach/Signup.jsx` OTPScreen | Both surfaces accept the code |
| `reset-password` | **B** | Mobile: `(auth)/forgot-password.tsx` (3-step: email → OTP → new password) | Mobile works. Web has no OTP entry — must use link |
| `invite-user` | **A** | None | Production invites use the custom `send-coach-invite` edge function (different flow). Supabase's built-in invite template only fires from Dashboard manual action. No UI accepts the OTP. |
| `magic-link-or-otp` | **A** | None | `signInWithOtp` isn't wired to any sign-in surface — template never fires in production. Test-only. |
| `change-email-address` | **A** | Mobile signup journey only (during mid-signup email edit). NOT in Settings → change email | Settings calls `updateUser({email})` to trigger the email, then just shows a "pending" banner — no OTP entry field. User must use the link. |

The 3 Variant-A templates previously included the "Or enter this code" section
+ token chip in their email. Stripped May 30 2026 to avoid promising the user
something the app can't deliver.

---

## Per-template copy strings

All templates use `{{ .ConfirmationURL }}` for the CTA href so Supabase auto-
constructs the correct redirect with the right `type` query param.

| Template slug | Variant | Subject | Heading | Lead | CTA label | Footer |
|---|---|---|---|---|---|---|
| `confirm-sign-up` | B | Confirm your MyRX account | Confirm your email | Tap below to confirm your MyRX account and finish signing up. | Confirm email | Didn't sign up for MyRX? You can ignore this email — your address won't be used. |
| `invite-user` | A | Your invite to MyRX | You're invited to MyRX | Tap below to accept the invitation and set up your account. | Accept invite | If you don't know who invited you, ignore this email. Questions? Email team@myrxfit.com. |
| `magic-link-or-otp` | A | Sign in to MyRX | Sign in to MyRX | Tap below to sign in to your MyRX account. | Sign in | Didn't ask to sign in? You can ignore this email — your account stays secure. |
| `change-email-address` | A | Confirm your new MyRX email | Confirm your new email | You're changing your MyRX email from `<strong style="color:#121721">{{ .Email }}</strong>` to `<strong style="color:#121721">{{ .NewEmail }}</strong>`. Tap below to confirm. | Confirm new email | Didn't make this change? Sign in and revert it from Profile → Settings, or email team@myrxfit.com. |
| `reset-password` | B | Reset MyRX password | Reset your password | Tap below to set a new password for your MyRX account. | Reset password | Code expires in 1 hour. Didn't ask for a reset? Ignore this email — your password stays the same. |

---

## Brand color reference

All values match the locked palette from `CLAUDE.md` (task #318, "Lock blue-
tinted palette") and the brand book.

| Token | Hex | Brand role | Used in template |
|---|---|---|---|
| Brand dark | `#121721` | Locked dark navy | Header band bg, code chip bg (Variant B), heading text, button text, strong text |
| Brand lime | `#CAF240` | Locked accent | Button bg, token code text (Variant B) |
| Brand off-white | `#F4F3EF` | Page background | Outer page bg |
| Card white | `#FFFFFF` | Surface | Card bg |
| Neutral mid | `#5A6478` | Muted body text | Lead helper, "or enter code" helper (Variant B), footer text, attribution |
| Neutral pale | `#E5E2DA` | Divider | Card border, horizontal dividers |

---

## Logo asset

The logo image used in the dark header band is hosted at:

```
https://myrxfit.com/email-logo.png
```

This is the **dark-theme** version of the wordmark (white "My" + lime "RX")
which only reads correctly on a dark background. The light-mode body uses the
existing dark-theme logo by giving it its own small dark navy band at the
top of the white card. **Do not put this logo directly on the cream/white body**
— the white "My" would be invisible. If you ever want to deploy a light-theme
version of the wordmark (dark "My" + lime "RX") for use elsewhere on a light
bg, the canonical source is `branding/Logo/Final/myrx-wordmark-light.png`.

---

## Render notes per client (May 30 2026 verified)

| Client | Render |
|---|---|
| **Outlook mobile (Android)** | ✅ Correct: cream page, white card with thin border, dark navy header band with logo, dark text on white, lime button, lime token on dark chip (Variant B). Brand chrome 100% preserved. |
| **Outlook desktop (Windows)** | ✅ Correct: same as Outlook mobile. |
| **Gmail web (dark theme)** | ⚠️ Renders dark: Gmail's algorithm detects the dark navy header band and triggers its "this email is dark by design" pass, darkening the whole card. Brand chrome preserved (lime button, lime token on dark chip, logo intact). |
| **Gmail web (light theme)** | ⚠️ Same dark rendering as Gmail dark theme. To get true light rendering in Gmail, the email would need to have NO dark elements at all (no dark header band). Trade-off accepted: keeping the dark band preserves visual identity in Outlook. |
| **Gmail iOS / Android** | Same as Gmail web — algorithm is consistent. |
| **Apple Mail (iOS/macOS)** | ✅ Correct: respects light theme cleanly. |

**The current design optimizes for Outlook correctness.** Gmail's "always dark"
behavior on this template is acceptable because brand chrome holds. If
priorities ever flip toward "Gmail must respect user theme," deploy a light-
theme logo and remove the dark header band entirely.

---

## How to update a template

Templates can only be edited via the Supabase Dashboard (no Management API for
templates without a Personal Access Token). Two requirements:

1. **The "Save changes" button is gated on the Subject input changing** — Monaco
   body edits via DevTools don't trigger React's form-dirty state. So you must
   tweak the subject (even just whitespace) to enable Save.
2. **Use the dashboard at:**
   `https://supabase.com/dashboard/project/xtxzfhoxyyrlxslgzvty/auth/templates/<SLUG>`
   where SLUG is one of: `confirm-sign-up`, `invite-user`, `magic-link-or-otp`,
   `change-email-address`, `reset-password`.

For programmatic edits via Chrome DevTools console (used during the rollouts):

```js
// Set body via Monaco API
window.monaco.editor.getEditors()[0].getModel().setValue(NEW_HTML)

// Set subject via React-aware native setter (input event triggers form-dirty)
const si = document.querySelector('input[id^="MAILER_SUBJECTS_"]')
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  .set.call(si, NEW_SUBJECT)
si.dispatchEvent(new Event('input', { bubbles: true }))

// Click Save
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'Save changes')
  .click()
```

---

## How to fire test emails

There's an edge function `test-send-auth-emails` deployed to the Supabase
project (`verify_jwt=false`, header-gated by a shared secret) that fires all
five templates in one call.

```bash
curl -s -X POST \
  'https://xtxzfhoxyyrlxslgzvty.supabase.co/functions/v1/test-send-auth-emails' \
  -H 'x-test-secret: myrx-test-email-2026-05-30' \
  -H 'Content-Type: application/json' \
  -d '{"target": "yourname@example.com"}'
```

Defaults to `motaz.jarrah@hotmail.com` if `target` is omitted. Creates the six
required temp users (`+signuptest`, `+invitetest`, `+magictest`, `+resettest`,
`+chgfrom`, `+chgto`) as aliases of the target address (relies on Gmail/Hotmail
plus-addressing routing all aliases back to the base inbox). Cleans up stale
temp users at the start of each run.

For ONE template only (e.g. reset password) without firing the full set, call
the public auth method directly with the publishable key — see the inline
script pattern in past sessions.

---

## How to clean up test users

```sql
-- Run via Supabase MCP execute_sql tool or the Dashboard SQL editor
DELETE FROM auth.users
WHERE email LIKE 'jarrah.motaz+%@gmail.com'
   OR email LIKE 'motaz.jarrah+%@hotmail.com'
   OR email LIKE '%+signuptest@%'
   OR email LIKE '%+invitetest@%'
   OR email LIKE '%+magictest@%'
   OR email LIKE '%+resettest@%'
   OR email LIKE '%+chgfrom@%'
   OR email LIKE '%+chgto@%';
```

---

## If you ever want to add a code surface to a Variant-A template

Three would need to be built:

1. **Magic link sign-in OTP** — add a "Sign in with code" surface on both web
   `Auth.jsx` and mobile `(auth)/sign-in.tsx`. Calls `signInWithOtp` to send
   the code, then `verifyOtp({email, token, type:'magiclink'})` on submit.
2. **Invite code paste flow** — Supabase's `inviteUserByEmail` flow would need
   a "paste invite code" UI on web + mobile. Note: production invites go
   through `send-coach-invite` instead, which has its OWN paste-code surface
   already (`CoachInviteCodeCard.tsx` on mobile). Adding a Supabase invite
   code surface would be a separate, less-used path.
3. **Email change OTP in Settings** — add a "verify new email" OTP screen
   that mounts after the user submits the email change in Settings. Calls
   `verifyOtp({email: newEmail, token, type:'email_change'})`.

Once any of these ships, swap that template back to Variant B (just add the
code section back in via the dashboard).

---

## Sources (research from May 30 2026)

The decision to abandon the dark template + ship the light template instead is
grounded in these references:

- [Mitigating the Disaster That Is Dark Mode — EmailsYall](https://emailsyall.com/mitigating_the_disaster/)
- [Dark Mode Email Design Best Practices for 2026 — Enchant Agency](https://www.enchantagency.com/blog/dark-mode-email-design-best-practices-css-guide-2026)
- [Ultimate Guide to Dark Mode — Litmus](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers)
- [Dark Mode Email Design — Markaplugin](https://markaplugin.com/blog/dark-mode-email-design)
- [Dark Mode Best Practice and Tips — Bird Taxi docs](https://docs.bird.com/taxi/email-and-taxi-for-email-best-practice/dark-mode/dark-mode-best-practice-and-tips)

The consensus across all five: Outlook for Android does aggressive partial-
invert color rewriting on dark emails that cannot be reliably prevented from
HTML/CSS. The `[data-ogsc]` selector targets Outlook.com web only; Outlook
mobile ignores it. The community calls this "the disaster" and recommends
testing + accepting variance OR switching to light-mode designs. We picked
the latter — which is what every major B2B/B2C provider (Stripe, Notion,
Linear, GitHub, Substack) ships for exactly this reason.
