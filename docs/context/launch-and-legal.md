# Launch Checklist & Legal/Consent Rules (Locked)

Standalone CONTRACT reference for MyRX launch-readiness and legal/consent-chain rules — preserved verbatim from CLAUDE.md; accuracy is critical.

---

## Launch-required documentation — STATUS (updated May 26, 2026)

All 10 baseline docs are written and live. Effective dates and incorporation chain audited + locked May 26, 2026 — see the "Legal docs + consent-chain rules" section further down for the rules that govern future edits. Before paid public launch we still need a fitness-industry-aware lawyer to review (the v1 docs are drafted in-house and incorporate standard provisions, but a lawyer review is still worth doing before significant revenue flows).

| # | Doc | URL | Status |
|---|-----|-----|--------|
| 1 | Privacy Policy | `/privacy` | ✅ SHIPPED (audited May 26) — §3.3 now correctly describes wearable data collection; §6.1 subprocessor list synced with DPA; §6.2 / §6.6 reference Coach Agreement + DPA |
| 2 | Terms of Service | `/terms` | ✅ SHIPPED (audited May 26) — §1 incorporates ALL 8 docs by reference; §5.5 defers to Refund Policy; §8 references Coach Agreement + DPA; §9 references Health Disclaimer; §18 lists all 8 in "entire agreement" |

---

## Launch-day checklist (LIVE-MODE GO checklist)

The single source of truth for what needs to be done when we flip from "ready to ship" to "actually live, taking real money, real customers signing up." Every item below has a clear DONE state — check off, move on. Organized by category, sequenced so dependencies resolve cleanly.

**Pre-launch hardening (T-1 to T-7 days):**

1. **All Phase 1-8 work merged to `main` and deployed to production.** No outstanding branch work. CI green. Cloudflare Pages serving the latest web build, Expo OTA / store binaries built and ready.
2. **Full end-to-end smoke test in TEST mode.** Coach signs up via test Stripe, gets test invite link, invites a test client, client accepts, plans flow, chat works, calorie page locks correctly when coached, unlinks correctly. Repeat for B2C: download app, sign up, upgrade to CoreRX via test IAP, verify tier unlock. Document any bugs found, fix before continuing.
3. **Legal docs LIVE on the website** (per Launch-required documentation section above). At MINIMUM 1, 2, 3, 4, 5, 6, 7 must be live before any real money moves. URLs: `myrxfit.com/privacy`, `myrxfit.com/terms`, `myrxfit.com/coach-agreement`, `myrxfit.com/refund-policy`, `myrxfit.com/health-disclaimer`, `myrxfit.com/aup`.
4. **Privacy Policy URL submitted** in App Store Connect (App Information → Privacy Policy URL) and Google Play Console (Store presence → Main store listing → Privacy Policy). Mandatory for store approval.
5. **Database backup verification.** Supabase point-in-time-recovery is on (Pro plan default). Manual test: restore a dropped table to a staging instance to confirm restore actually works. Don't find out it's broken during a real incident.
6. **Cloudflare DNS audit.** All MX, A, CNAME, TXT records for myrxfit.com verified. Email forwarding active. SSL cert valid + auto-renewal confirmed.

**Stripe live-mode switch:**

7. **Activate Stripe live mode** (Dashboard → toggle off Test mode → must have completed all activation steps: business verification, bank account verified, terms accepted). Verify "Live" badge is visible on dashboard header.
8. **Generate live API keys** (Developers → API Keys in LIVE mode). Get `pk_live_...` and `sk_live_...`.
9. **Store live keys as secrets ONLY** — never in git, never in `.env.local` shared, never in chat. Set via:
   - Cloudflare Workers: `wrangler secret put STRIPE_SECRET_KEY_LIVE` (per worker that touches Stripe)
   - Cloudflare Pages: Pages → Settings → Environment variables → Production → add `VITE_STRIPE_PUBLISHABLE_KEY_LIVE`
   - Supabase Edge Functions: Dashboard → Edge Functions → Secrets → add both
10. **Re-create the 5 products + 8 prices in LIVE mode.** Test-mode IDs DON'T carry over. Use the same `lookup_key` values (e.g., `coach_starter_monthly`) so the code that references prices by lookup_key still works without code changes. Persist the new live `prod_...` and `price_...` IDs to secrets.
11. **Register the Stripe webhook endpoint** in LIVE mode pointing to your deployed webhook worker URL (e.g., `https://stripe-webhooks.myrxfit.workers.dev/stripe/live`). Grab the `whsec_...` signing secret, store as `STRIPE_WEBHOOK_SECRET_LIVE` worker secret.
12. **Toggle `STRIPE_MODE` env var to `live`** in production. Code paths that read `STRIPE_MODE` (web + workers + edge functions) now use the live key set.
13. **Stripe sanity transaction** — sign up a real coach account yourself (use a real card, $19 charge), complete the flow end-to-end, verify the webhook fires + the subscription row lands in Supabase + the dashboard reflects it. Refund the charge to yourself afterwards (no real money lost).

**Apple App Store:**

14. **Apple Developer Program enrollment** complete and current ($99/yr).
15. **App Store Connect IAP products created** in production (not just sandbox) — **auto-renewable subscriptions** (the old one-time non-consumables are retired):
    - `corerx_monthly` ($4.99 / mo) + `corerx_annual` ($49.99 / yr)
    - `fullrx_monthly` ($6.99 / mo) + `fullrx_annual` ($69.99 / yr)
    Intro-offer config TBD when the rail goes live (T165 changed the model: the 30-day FullRX reverse trial is OUR OWN in-app grant, not a store trial — a store-side intro offer is only the mechanism for honoring "mid-trial upgrade keeps the remaining free days"). Status: "Ready to Submit". Localize for at least English. Pricing applied to all relevant territories.
16. **Apple App Store Small Business Program** application submitted and APPROVED (drops Apple cut from 30 % to 15 % when annual revenue is under $1M). Approval is automatic if you qualify — apply early, takes a day or two.
17. **App Store metadata complete**: app name "MyRX", subtitle, description, keywords, screenshots (6.7-inch iPhone + 13-inch iPad), app preview videos (optional but helps conversion), age rating questionnaire complete, support URL, marketing URL, privacy policy URL.
18. **App Review Information** filled in App Store Connect: demo account credentials so Apple reviewers can test paid features (create a comp'd `fullrx` user just for review), contact info, reviewer notes ("MyRX is a fitness coaching platform. Use the demo account at the link below to test all paid features. Coaches sign up at myrxfit.com/coach/signup — not in-app").
19. **iOS binary uploaded** via Xcode / Transporter, processed successfully, attached to the version awaiting review.
20. **Submit for App Store review.** Typical Apple review = 1-3 days for routine apps. Be ready for at least one rejection round — address feedback, resubmit.

**Google Play Store:**

21. **Google Play Developer Account** active ($25 one-time).
22. **Google Play Console subscription products created** (auto-renewable):
    - `corerx_monthly` ($4.99 / mo) + `corerx_annual` ($49.99 / yr)
    - `fullrx_monthly` ($6.99 / mo) + `fullrx_annual` ($69.99 / yr)
    Intro-offer config TBD (same T165 note as Apple above). Status: "Active". Match Apple's product IDs so the mobile code uses one constant set.
23. **Production track release configured** in Play Console (Production → Create new release). APK / AAB uploaded, signed with the production keystore.
24. **Production keystore SHA-256 fingerprint added** to `web/public/.well-known/assetlinks.json` (Android App Links — required for magic-link sign-in deeplinks to work on the production install). Deploy web after updating this file.
25. **Store listing complete**: title, short description, full description, screenshots (phone + tablet), feature graphic (1024 x 500), app icon, content rating questionnaire, target audience + content, data safety form (matches Privacy Policy disclosures).
26. **Submit for Google Play review.** Typical Google review = 1-7 days. Initial submissions get extra scrutiny.

**Backend / infrastructure:**

27. **Production Supabase project verified** — RLS policies covered by tests, backups on, migrations all applied, no orphan dev tables.
28. **All edge functions deployed** with live-mode secrets configured (send-phone-otp / verify-phone-otp / coach-signup / stripe-webhook / etc.).
29. **All Cloudflare Workers deployed** with live secrets (food-search / oauth / webhooks / etc.).
30. **Cloudflare Pages production deploy verified** — myrxfit.com serves the latest build, asset hashes match local `web/dist/`, no console errors on page load.
31. **Twilio Verify production** — moved out of sandbox (paid account, no verified-callers-only restriction). Test SMS to a brand-new phone number that's never used the app before. Confirm OTP arrives within 30 seconds.
32. **Domain monitoring set up** — uptime check on `myrxfit.com` + `api.myrxfit.com` (if applicable) via Uptime Kuma / BetterStack / Pingdom. Alert to your email + phone if downtime > 2 min.

**Monitoring + alerting:**

33. **Stripe webhook delivery monitoring** — dashboard → Webhooks → endpoint → metrics. Verify delivery rate > 99 %. Set up email alert for failed deliveries.
34. **Supabase logs review** — confirm no spam errors in the production logs. Set up alerts for `error` log level (Pro plan).
35. **Sentry / Bugsnag / similar error tracker** wired into web + mobile. Threshold alerts on new error types so you find regressions before users tell you.
36. **Customer support inbox monitored** — `support@myrxfit.com` (or whichever address you set) checked daily, ideally with auto-acknowledge email reply. Backup forwarding to your personal phone for urgent issues.

**Existing-user migration (per CLAUDE.md Lock 5):**

37. **Verify all existing clients are `coach_id = NULL`** in production. Run `SELECT count(*) FROM profiles WHERE coach_id IS NOT NULL;` — should be 0 unless you manually linked someone via testing. Existing test users move to unlinked B2C tier per Lock 5.
38. **Send notification email to existing users** (optional but kind) explaining the change: "MyRX has added coaches to the platform. Your account is unchanged — you're now using MyRX in self-coached mode. If you'd like to be coached by someone, ask them to invite you via their coach account."

**First-coach onboarding (you eat your own dog food):**

39. **You (Motaz) sign up as a coach yourself** via the live coach signup flow at `myrxfit.com/coach/signup`. Use a real card, complete payment, verify the trial→active transition works.
40. **Invite 2-3 real clients** (friends, family, beta testers) via the live invite flow. Have them complete the PARQ + onboarding form. Verify their data appears in your coach roster, chat works, intake plan editor works.
41. **Monitor for 48 hours** post-launch — watch for crashes, billing issues, signup friction. Be ready to hotfix.

**Marketing + announcement:**

42. **Landing page / marketing site** live at `myrxfit.com` — clear coach value prop, clear B2C value prop, pricing table, sign-up CTAs to both `/coach/signup` and the app store.
43. **Social media accounts ready** — at minimum a single channel (Instagram / X / TikTok — whichever you'll actually post on) with the brand assets in place + 2-3 launch-day posts queued.
44. **Launch email** drafted to any pre-launch email list. Subject line tested. Send via Mailchimp / Buttondown / ConvertKit (Stripe doesn't send marketing email).
45. **Coach outreach list** — 10-20 individual coaches you'll personally email at launch with a personal pitch. The first paying coaches usually come from your direct outreach, not organic discovery.

---

## Legal docs + consent-chain rules (LOCKED, May 26 2026)

Legal docs are a contract, not UI copy. The fact that they live as
JSX files in `web/src/pages/legal/*.jsx` is an implementation detail
— treat them as you would a signed PDF. The rules below come from a
real audit that found 12 gaps after the 4 Phase-2 legal docs (Coach
Agreement, Refund Policy, Health Disclaimer, DPA) shipped — each
fix is locked here so the same gaps don't reappear.

1. **Single canonical consent point: the TOS.** The user clicks ONE
   checkbox during signup. That click must legally bind them to
   EVERY policy that matters, not just the doc whose name appears in
   the checkbox label. We achieve this by having the **TOS §1
   incorporate every other policy by reference**, and the consent
   checkbox label includes the literal phrase "which together
   incorporate our [other policies] by reference."

   Current TOS §1 incorporation list (web/src/pages/legal/TermsOfService.jsx):
   AUP, Cookie Policy, Refund Policy, Health & Medical Disclaimer,
   and (for Coaches only) Coach Agreement + DPA. **When a new
   policy ships, it MUST be added to TOS §1's incorporation list in
   the same PR.** Forgetting to do so means the new policy isn't
   legally part of the contract, even if the user has read it.

2. **Cross-doc conflicts: more-specific policy ALWAYS controls.** TOS
   §1 explicitly states this. So when TOS §5.5 (Refunds) says one
   thing and the Refund Policy says another, the Refund Policy wins.
   The legacy May-9-2026 TOS §5.5 used to say "all fees are
   non-refundable except where required by law" — which directly
   conflicted with the new Refund Policy's 14-day trial, 14-day
   annual refund window, athlete-unlock 14-day guarantee, etc. The
   May-26-2026 rewrite REPLACED that paragraph with a summary list
   that defers explicitly to the Refund Policy. **When you add a new
   ancillary doc that supersedes any TOS section, you MUST rewrite
   that TOS section to defer.** Don't leave a contradiction.

3. **TOS §18 "Entire agreement" must list every ancillary doc.**
   Boilerplate "entire agreement" clauses define the boundary of
   what's contractually binding. Omitting a doc from this list is a
   plausible argument that the doc isn't part of the contract — even
   if it's incorporated by reference elsewhere. Belt-AND-suspenders:
   the doc must appear in BOTH §1 incorporation AND §18 entire-
   agreement list.

4. **Privacy Policy reality-check: §3.3 "Information we do not
   collect" must match what the app ACTUALLY collects.** The May-9
   PP said "we do not collect health records from connected medical
   devices" — at a time when the Samsung Health Data SDK integration
   (May 21) was reading HR samples, step buckets, and per-second
   workout HR streams. That's a factual misrepresentation under GDPR
   Art. 13/14 transparency obligation AND CCPA disclosure rules.
   Fixed by carving "Clinical health records from healthcare
   providers (lab results, prescriptions, diagnoses, imaging)" into
   §3.4 and adding a new §3.3 ("Information from wearables and
   fitness platforms") that describes WHAT we collect from each
   connected platform.

   **The rule**: every time we ship a new data-collection capability
   (new wearable integration, new biometric, new analytics signal),
   the same PR MUST update PP §3.1 (information you provide) OR §3.3
   (wearables) OR §3.4 (information we DO NOT collect) so the
   policy and the codebase stay in sync. If you ever find yourself
   thinking "we'll update the legal docs later," you're creating
   regulatory exposure.

5. **Subprocessor list in PP §6.1 MUST match DPA's subprocessor
   list.** Two places that list the same thing → drift is inevitable
   → users can argue they consented to one list (PP) but not the
   other (DPA) → coverage gap. The PP now contains an explicit "if
   a discrepancy ever appears, the DPA is the authoritative list"
   statement, but the goal is no discrepancies.

   **The rule**: when adding a new subprocessor (e.g. shipping the
   Apple HealthKit integration), update BOTH the DPA's subprocessor
   list AND PP §6.1 in the same PR. The DPA's list is the canonical
   source; PP mirrors it.

6. **Cross-references must use real URLs.** PP §6.2 used to say "the
   coach is bound by our Coach Terms of Service" — a doc that does
   not exist. Should have said "Coach Agreement" and linked to
   `/coach-agreement`. Dangling references in legal docs look
   amateurish AND create ambiguity about what's actually binding.
   Whenever you mention another policy by name, link to it by URL.

7. **Bump the effective date EVERY time the legal doc changes
   materially.** The `effectiveDate` prop on `<LegalLayout>` is the
   date users see at the top of the doc. If you change a binding
   provision (incorporation list, cross-references, refund terms,
   data-collection statements) and don't bump the date, you create
   an audit-trail gap. The May-26-2026 audit forced a bump on both
   TOS and PP for exactly this reason.

8. **Consent checkbox text on signup must enumerate the named docs
   AND signal that they incorporate the rest by reference.** Web
   coach signup (`pages/coach/Signup.jsx` PasswordScreen) now reads:
   "I agree to the [TOS], [PP], [Coach Agreement], and [DPA] —
   which together incorporate our Refund Policy, Health & Medical
   Disclaimer, Cookie Policy, and Acceptable Use Policy by
   reference." Mobile athlete signup (`mobile/app/(auth)/sign-up.tsx`
   PasswordScreen) has the equivalent phrasing minus the coach
   docs. **When the incorporation list changes, the checkbox copy on
   BOTH surfaces must change too.**

9. **`LegalLayout.jsx::FOOTER_LINKS` and `mobile/app/(app)/about.tsx`
   are the two cross-link surfaces.** Both list every legal doc the
   user might want to navigate to from another legal doc (web) or
   from the app's About screen (mobile). When a new doc ships, both
   files must add the link. These are the cross-link surfaces for
   legal docs; the admin client detail page (`AdminUserDetail.jsx`)
   is the equivalent cross-link surface for the new `Client Detail`
   patterns above.
