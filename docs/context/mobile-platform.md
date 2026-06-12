# Mobile Platform — Logo Rules, Auth, Phone Verify, Profile Gate (Locked)

Purpose: the contract for MyRX's brand/logo rules, cross-platform feature gates, mobile auth infrastructure, Twilio Verify phone verification, the profile-completeness gate, and how to work across web + mobile in one session. Accuracy is critical — this is a source-of-truth reference extracted verbatim from CLAUDE.md.

---

## Brand / logo rules (MANDATORY — applies to web + mobile)

These rules came from real user feedback after multiple wordmark mistakes; treat them as hard constraints, not preferences.

1. **Never render the brand name as JSX text.** No `<Text>My<Text>RX</Text></Text>`, no `<span className="text-primary">RX</span>`, no styled-text wordmark approximations. Always use the actual wordmark image asset.
2. **One wordmark per page, maximum.** If the page has a centered slogan-version wordmark in the body (e.g. signup welcome screen), the header MUST NOT also show the no-slogan wordmark. If the header shows the wordmark (e.g. dashboard / strength / cardio post-auth shell), the body MUST NOT include another logo.
3. **The slogan version of the wordmark is reserved for ONE place across the entire system: the signup journey's welcome screen.** Every other surface — landing carousel, sign-in, forgot-password, dashboard, strength, cardio, mobility, bodyweight, calories, history, profile, admin shell — uses the no-slogan version, OR no logo at all.
4. **Logo file canonicals** (Final/-folder copies are the source of truth, both repos sync from there):
   - `myrx-wordmark-dark.png` — no slogan, dark theme (1781×390)
   - `myrx-wordmark-light.png` — no slogan, light theme (1781×390)
   - `myrx-wordmark-dark-slogan.png` — with slogan, dark theme (1820×625)
   - `myrx-wordmark-light-slogan.png` — with slogan, light theme (1820×625)
5. **Auth-flow headers stay logo-free.** Sign-up, sign-in, forgot-password headers should be back-arrow only (no wordmark). The branding sits in the body content, not the chrome.

When in doubt, audit the rendered surface for ANY brand mark (image OR text) before adding another. If one already exists on that page, do not add a second.

---

## Cross-platform feature gates (current)

- **`profile.is_superuser`** hides the two share-with-coach toggles on the Settings page (admin has no coach). Applied in:
  - `src/pages/EditProfile.jsx` (end-user web, when admin is in client view) — `isAdmin` check
  - `src/pages/admin/tabs/AdminUserProfile.jsx` (admin's own profile via `/admin/profile`) — `isOwnProfile` prop
  - `mobile/app/(app)/settings.tsx` (mobile, defensive) — `isAdmin` check
- **Profile refresh no longer unmounts the route tree.** `App.jsx` `ProtectedLayout` only renders `<ShellSkeleton />` when `profile` is `null` (initial load), not on every `refreshProfile()` call. Mirrors mobile's `(app)/_layout.tsx` guard.

---

## Mobile auth infrastructure (shipped)

The mobile app uses a hybrid email-confirmation model where each Supabase auth email contains BOTH a magic link (web users tap it → existing redirect flow) AND a 6-digit OTP code (mobile users type it → in-app verification). All 5 Supabase email templates (Confirm sign up, Reset password, Magic link, Change email, Invite user) are branded with MyRX and use this dual-format pattern.

- **Email templates** edited in Supabase Dashboard → Authentication → Email Templates. Each contains `{{ .ConfirmationURL }}` (for the lime "Confirm/Reset" button) and `{{ .Token }}` (the 6-digit code shown below the button).
- **Redirect URL allowlist** has `https://myrxfit.com/auth/confirm` and `/auth/recovery`. These are what mobile's `signUp()` and `resetPasswordForEmail()` calls pass as `emailRedirectTo`.
- **Android App Links** via `public/.well-known/assetlinks.json` (deployed with the web app). Contains the mobile app's package name (`com.myrx.app`) and SHA256 fingerprint of the debug keystore. When a user taps the magic link from their phone with the app installed, Android opens the app directly instead of the browser. Production keystore fingerprint must be added to this JSON before Play Store release.
- **Biometric sign-in** (mobile only): user opts in from Settings → Sign-in card. App stores `email + password` encrypted in SecureStore (`expo-secure-store` + Android Keystore-backed encryption). Sign-in screen shows a Fingerprint button when biometric is enabled. `signOut()` keeps the credentials so fingerprint still works after logout — by design.
- **Web is currently a 19-screen onboarding journey** at `/signup` (Signup.jsx). Mobile's 5-step flow is the older synthesis of `Auth.jsx` (3 steps) + `CompleteProfile.jsx` (3 steps); the next sync should bring mobile in line with web's longer journey OR keep them divergent — TBD.

---

## Phone verification (Twilio Verify)

Phone OTP is wired through Twilio Verify, NOT Twilio Programmable Messaging. Verify uses pre-registered shortcodes — no A2P 10DLC compliance hoops, works globally on day 1.

- **Edge functions**:
  - `send-phone-otp` — calls Twilio Verify `Verifications` resource. Twilio handles code generation, TTL (10 min), and resend cooldown (60 s). We don't store anything ourselves anymore; the old `phone_otp_codes` table was dropped.
  - `verify-phone-otp` — calls Twilio Verify `VerificationCheck`. On `approved` status, atomically writes `profiles.phone` + `profiles.phone_verified_at` via UPSERT (so this works for both new-phone change flow and signup-time verification).
- **Required Edge Function secrets**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Set in Supabase Dashboard → Edge Functions → Secrets.
- **Sandbox mode** (trial Twilio account): SMS only delivers to numbers added in **Phone Numbers → Manage → Verified Caller IDs**. Adding the credit card to the Twilio account exits trial, lifting the verified-only restriction.
- **Web OTP API zero-tap**: the `navigator.credentials.get({ otp })` listener is parked in both `Signup.jsx` PhoneOTPScreen and `CompleteProfile.jsx` PhoneOTPScreen. To re-enable: submit a custom Twilio Verify template with `@myrxfit.com #{{1}}` suffix, get it approved (1-3 business days), pass `TemplateSid` from `send-phone-otp`, then restore the listener (long comments in both files explain the exact restore steps).

---

## Profile completeness gate

`ProtectedLayout` (`App.jsx`) doesn't gate on `if (!profile)` — it gates on `if (!isProfileComplete(profile))` from `src/lib/profile.js`. This is what enables the CompleteProfile mini-journey to write profile fields incrementally without ProtectedLayout kicking the user out the moment any field is set. The "complete" check requires `full_name + gender + birthdate + current_weight + current_height`. Phone is not required (legacy users without phones shouldn't be force-routed through a mini-journey on every login).

---

## Working across web + mobile in one session

The mobile codebase lives at `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile` (Expo / React Native, Expo Router). The two projects share Supabase backend, edge functions, RLS policies, and DB schema. Both are accessed from the same Claude Code session — there's no separate workspace.

When making changes that touch both sides:
1. Edit the relevant files in whichever side you're starting from
2. Either propose the equivalent diff on the other side and confirm with the user before touching it, OR mirror it directly if the change is mechanical (e.g. shared formula constants)
3. Run typecheck / build on both sides if relevant
