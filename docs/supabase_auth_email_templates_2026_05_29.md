# Supabase Auth email templates — coach-voice rewrites

Locked May 29 2026. Paste into Supabase Dashboard → Authentication → Email Templates → (select template) → swap subject + body. All 5 templates share the same building blocks:

- `{{ .Token }}` — the 6-digit OTP (always renders).
- `{{ .ConfirmationURL }}` — the button link that opens the app / completes the action.
- No marketing language. No "Welcome to MyRX!" exclamations. No "for your security."
- Same look-and-feel as the coach invite email (dark background, lime accent button).

Each template is given as:
1. Subject line
2. HTML body
3. Plaintext body (Supabase auto-generates a plaintext fallback from HTML, but if your template editor exposes a separate plaintext field, paste this verbatim)

---

## 1. Confirm sign up

**Subject:** Confirm your email on MyRX

**HTML body:**

```html
<p>Enter the code below in the MyRX app to finish signing up, or tap Confirm to open the app directly.</p>

<p style="font-size: 28px; letter-spacing: 6px; font-family: monospace; margin: 24px 0;"><strong>{{ .Token }}</strong></p>

<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #c4ff45; color: #000; text-decoration: none; border-radius: 6px;">Confirm email</a></p>

<p style="color: #888; font-size: 13px; margin-top: 32px;">Code expires in 24 hours. Didn't sign up? Ignore the email — nothing happens.</p>
```

**Plaintext body:**

```
Enter the code below in the MyRX app to finish signing up:

{{ .Token }}

Or tap to confirm: {{ .ConfirmationURL }}

Code expires in 24 hours. Didn't sign up? Ignore the email — nothing happens.
```

---

## 2. Reset password

**Subject:** Reset your MyRX password

**HTML body:**

```html
<p>Enter the code below in the MyRX app to set a new password, or tap Reset to open the app directly.</p>

<p style="font-size: 28px; letter-spacing: 6px; font-family: monospace; margin: 24px 0;"><strong>{{ .Token }}</strong></p>

<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #c4ff45; color: #000; text-decoration: none; border-radius: 6px;">Reset password</a></p>

<p style="color: #888; font-size: 13px; margin-top: 32px;">Code expires in 1 hour. Didn't ask for a reset? Ignore the email — your password stays the same.</p>
```

**Plaintext body:**

```
Enter the code below in the MyRX app to set a new password:

{{ .Token }}

Or tap to reset: {{ .ConfirmationURL }}

Code expires in 1 hour. Didn't ask for a reset? Ignore the email — your password stays the same.
```

---

## 3. Magic link

**Subject:** Sign in to MyRX

**HTML body:**

```html
<p>Enter the code below in the MyRX app, or tap Sign in to open MyRX directly.</p>

<p style="font-size: 28px; letter-spacing: 6px; font-family: monospace; margin: 24px 0;"><strong>{{ .Token }}</strong></p>

<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #c4ff45; color: #000; text-decoration: none; border-radius: 6px;">Sign in</a></p>

<p style="color: #888; font-size: 13px; margin-top: 32px;">Code expires in 1 hour. Didn't ask to sign in? Ignore the email — nothing happens.</p>
```

**Plaintext body:**

```
Enter the code below in the MyRX app to sign in:

{{ .Token }}

Or tap to sign in: {{ .ConfirmationURL }}

Code expires in 1 hour. Didn't ask to sign in? Ignore the email — nothing happens.
```

---

## 4. Change email

**Subject:** Confirm your new email on MyRX

**HTML body:**

```html
<p>You changed your MyRX email to this address. Enter the code below in the app, or tap Confirm to finish the change.</p>

<p style="font-size: 28px; letter-spacing: 6px; font-family: monospace; margin: 24px 0;"><strong>{{ .Token }}</strong></p>

<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #c4ff45; color: #000; text-decoration: none; border-radius: 6px;">Confirm new email</a></p>

<p style="color: #888; font-size: 13px; margin-top: 32px;">Didn't make this change? Sign in and revert it from Profile → Settings, or email team@myrxfit.com.</p>
```

**Plaintext body:**

```
You changed your MyRX email to this address.

Enter the code below in the app:

{{ .Token }}

Or tap to confirm: {{ .ConfirmationURL }}

Didn't make this change? Sign in and revert it from Profile → Settings, or email team@myrxfit.com.
```

---

## 5. Invite user

> **Note:** the MyRX-built coach invite flow runs through the `send-coach-invite` edge function — NOT through this default Supabase template. So this template should rarely fire. If you want to be extra safe, point it at the coach-invite path so a stray send still lands the user somewhere sensible.

**Subject:** You've been invited to MyRX

**HTML body:**

```html
<p>Someone invited you to MyRX. Tap below to set up your account.</p>

<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #c4ff45; color: #000; text-decoration: none; border-radius: 6px;">Set up account</a></p>

<p style="color: #888; font-size: 13px; margin-top: 32px;">Didn't expect this? Ignore the email — nothing happens.</p>
```

**Plaintext body:**

```
Someone invited you to MyRX. Tap below to set up your account:

{{ .ConfirmationURL }}

Didn't expect this? Ignore the email — nothing happens.
```

---

## How to paste

1. Sign in to https://supabase.com/dashboard
2. Pick the **myrx** project
3. Authentication → Email Templates
4. For each of the 5 templates above:
   - Click the template name
   - Replace **Subject** with the bold subject line above
   - Replace **Message body** with the HTML body
   - Save
5. Test by triggering the relevant action (sign up, reset password, etc.) to confirm the new copy renders correctly.

If your template editor has a separate **Plaintext** field, paste the plaintext body too. If it auto-generates plaintext from HTML, skip that step.
