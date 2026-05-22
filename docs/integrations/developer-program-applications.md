# Developer-Program Applications — Copy/Paste Source

> ## 📍 Session pin (May 18 2026)
>
> The Health Connect integration is **shipped and working** end-to-end on the
> patched APK (manifest `<queries>` + `<activity-alias>` + MainActivity
> permission-delegate registration all in place — see the "Health Connect
> integration — Phase 1 spec" section of CLAUDE.md for the full root-cause
> writeup of the three bugs we fixed). But the Galaxy S25 user test surfaced
> that Samsung Health bridges only steps / weight / body fat to HC by default
> — NOT HR or workouts (which are what MyRX needs for cardio coaching). User
> decision: go **direct OAuth/SDK per platform** rather than relying on HC as
> the universal aggregator. HC stays as a fallback for non-Samsung Android
> users whose source apps DO bridge to HC.
>
> **Build order locked (May 18 2026):** Strava → Fitbit → Apple HealthKit →
> Samsung SDK → Garmin → Whoop → Polar. First three have no external
> approval; last four are gated on developer-program approvals submitted in
> parallel.
>
> **Next actions on resume:**
>
> 1. **User-side, in parallel** — fill in the `[BRACKETS]` below with legal
>    entity, business email, address, phone, year-1 user count, then submit
>    Samsung / Garmin / Whoop / Polar applications. Also register Strava
>    (https://www.strava.com/settings/api) and Fitbit
>    (https://dev.fitbit.com/apps/new) — both instant, no approval delay.
>    Paste resulting Client IDs into the "After-submission tracking" section
>    at the bottom of this file.
>
> 2. **Assistant-side, sequential** —
>    a. Design + apply the Supabase `user_integrations` table migration
>       (columns: `user_id`, `platform`, `access_token` encrypted,
>       `refresh_token` encrypted, `expires_at`, `scopes`, `connected_at`,
>       `last_synced_at`, `status`; RLS owner-only).
>    b. Create `workers/oauth/` Cloudflare Worker with
>       `/oauth/callback/{platform}` endpoints (Strava first, leave the
>       others stubbed for now).
>    c. Build the Strava integration end-to-end: mobile-side OAuth launch via
>       `expo-web-browser`, callback → worker → token storage in Supabase,
>       service module in `mobile/src/lib/integrations/strava.ts`, mapper at
>       `mobile/src/lib/integrations/stravaMapper.ts` (activity → MyRX
>       effort), wire into ConnectTab's existing "Strava" row.
>    d. Fitbit clone of the Strava pattern.
>    e. Apple HealthKit native module (iOS-only — separate scope).
>
> 3. **Blocked-on-approval (resume when their emails come back):** Samsung
>    SDK, Garmin Health API, Whoop API, Polar AccessLink. Each gets its own
>    integration module following the patterns established by Strava.
>
> **What's preserved across the session pin:**
>
> - This doc (`docs/integrations/developer-program-applications.md`).
> - The integration strategy + activity-alias fix + queries fix all locked
>   into CLAUDE.md under "Health Connect integration — Phase 1 spec".
> - The patched APK is running on the dev phone (Galaxy S25 Ultra).
> - The 13-item todo roadmap from the prior session.



Use this document when filling out each platform's developer-program signup
form. Anything in `[BRACKETS]` is a value YOU need to fill in based on your
own business / contact / legal-entity info — the rest can be copy-pasted as-is.

After submission, paste the platform's response (approval email, OAuth client
ID, redirect-URI registration confirmation, etc.) into the matching section at
the bottom of this file so we have one canonical place for credentials.

**Common fields used across every application:**

- **Product name:** MyRX
- **Website:** https://myrxfit.com
- **Privacy Policy URL:** https://myrxfit.com/privacy
- **Terms of Service URL:** https://myrxfit.com/terms
- **Acceptable Use Policy URL:** https://myrxfit.com/acceptable-use
- **Cookie Policy URL:** https://myrxfit.com/cookies
- **Android package name:** `com.myrx.app`
- **iOS bundle identifier:** `com.myrx.app`
- **Custom URL scheme (deep link):** `myrx`
- **OAuth redirect URI (production):** `https://myrxfit.com/oauth/callback`
- **OAuth redirect URI (development):** `myrx://oauth/callback`

**Fields YOU need to fill in (consistent across all four applications):**

- **Legal entity / company name:** `[YOUR LEGAL ENTITY NAME]`
- **Business contact email:** `[YOUR BUSINESS EMAIL]`
- **Business address:** `[YOUR ADDRESS]` (some platforms require this for KYC)
- **Phone:** `[YOUR PHONE NUMBER]` (some platforms require this)
- **Tax ID / VAT number:** `[IF APPLICABLE]` (Garmin and Whoop may ask)

**Product description (use this verbatim everywhere a "describe your app"
field appears):**

> MyRX is a fitness coaching platform for self-coached individuals and the
> coaches who train them. It generates personalized training prescriptions
> across strength, cardio, mobility, and recovery — each progression
> anchored on the user's actual training history rather than generic
> templates. To produce accurate cardio prescriptions (Endurance,
> Threshold, and VO2 Max zones), MyRX needs read-only access to the
> user's workout history and heart-rate data from their wearable platform
> of choice. Data is read on demand when the user opens the app or taps
> "Sync now"; it is stored on the user's per-account record in the MyRX
> backend (Supabase / Postgres, encrypted at rest) and is never sold,
> shared with third parties, or used for advertising.

---

## 1. Samsung Developer Program — Samsung Health SDK

Apply at: https://developer.samsung.com/health

Samsung's flow: register a Samsung Developer account → in the Health
Developer console, create an "app" entry → upload your signing-key SHA-256
hashes (debug + production) → declare the data types you'll read → submit
for review.

**Application content:**

- **App name:** MyRX
- **Platform:** Android (Galaxy phones with Samsung Health installed)
- **Use case category:** Fitness training / Coaching
- **Data types requested (read-only):**
  - Exercise
  - Heart Rate
  - Sleep
  - Step Count
  - Body Composition (weight, body-fat %)
  - Floors Climbed (optional)
- **Data write requests:** none for v1 (read-only)
- **App description (use the verbatim product description above)**

**Signing-key SHA-256 hashes you need to provide:**

1. **Debug** — from the Android Studio default debug keystore. Run from
   the mobile repo:
   ```powershell
   & "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android | Select-String "SHA256:"
   ```
   Paste the SHA-256 line into the application.

2. **Production** — once you have a production keystore for Play Store
   release (you don't yet, per the assetlinks.json comment in CLAUDE.md).
   Add this to the Samsung console AFTER the production keystore is
   generated — you can submit with debug-only initially and add prod later.

**OAuth redirect URIs to register:**

- `https://myrxfit.com/oauth/callback/samsung` (production)
- `myrx://oauth/callback/samsung` (development)

**Expected approval time:** 1-2 weeks per Samsung's docs.

---

## 2. Garmin Health API — Connect Integration

Apply at: https://developer.garmin.com/gc-developer-program/health-api/

Garmin's flow: register as a Garmin Developer → request access to the
Health API → describe your app + commercial use case → sign their API
Terms of Use → wait for approval → receive Consumer Key + Consumer Secret.

**Garmin separates two API tiers — request BOTH:**

1. **Garmin Health API** (data delivery via webhooks)
2. **OAuth 1.0a for User Permissions** (the user consent flow)

**Application content (Garmin asks several free-text questions):**

- **App purpose:** Personalized cardio training prescriptions anchored on
  the user's actual Garmin-tracked activities and HR data. MyRX reads the
  user's workouts to identify their best-effort paces, then generates
  next-step targets in the Endurance / Threshold / VO2 Max zones using
  Daniels' formulas.

- **Data types requested (read-only):**
  - Activities (workouts) — required
  - Activity Details (lap splits, HR streams)
  - Dailies (daily summaries, steps, calories)
  - User Metrics (VO2 Max, fitness age, etc.)
  - Sleep summaries
  - Body Composition
  - Stress details
  - Heart Rate Variability summaries

- **Write/push requested:** No (read-only)

- **Commercial use case:** Yes — paid subscription tier in the MyRX app
  (App Store / Play Store) will offer the Garmin integration as part of
  the premium feature set.

- **Number of expected users (year 1):** `[YOUR ESTIMATE — e.g. 1000-5000]`
  (Garmin uses this for rate-limit tier assignment)

- **Webhook endpoint:** `https://myrxfit.com/oauth/webhooks/garmin`
  (we'll build this as a Cloudflare Worker; doesn't need to exist before
  submission, but the URL needs to be planned)

- **Privacy practices statement:** All user data fetched from Garmin is
  encrypted at rest in MyRX's Supabase Postgres database (Supabase
  encrypts all data at rest with AES-256). Data is keyed per user and
  RLS-protected so users cannot access each other's data. Data is never
  sold, shared with third parties for marketing, or used for advertising.
  Users may disconnect Garmin at any time from MyRX's Settings → Connect
  tab, at which point we delete their cached Garmin data and revoke our
  OAuth token via the Garmin de-registration endpoint.

**Expected approval time:** 2-4 weeks per Garmin's typical cycle. They
are notoriously slow and often go silent for a week or two; follow up
politely after 10 business days if no response.

---

## 3. Whoop Developer Program

Apply at: https://developer.whoop.com/

Whoop's flow: sign in with your existing Whoop account → register a new
app in the developer dashboard → declare scopes → wait for review →
receive Client ID + Client Secret.

> **Important:** the app developer does NOT need to own a Whoop band. End
> users connect their own bands via the OAuth flow we build. If Whoop's
> developer signup happens to require a Whoop login, create a free
> account (no band needed) with the standard identity below. If that's
> blocked entirely, escalate via Whoop's partner team
> (`partners@whoop.com` or the "Contact Sales / Partnerships" link on
> whoop.com) — do NOT skip the integration. Whoop matters because users
> who buy Whoop tend to be exactly the data-driven athletes MyRX targets.

**Application content:**

- **App name:** MyRX
- **App description:** Use the verbatim product description above.
- **App category:** Fitness coaching / training prescriptions
- **Scopes requested:**
  - `read:profile` — user identity for linking
  - `read:cycles` — daily cycles (training load, strain)
  - `read:recovery` — recovery score, HRV, RHR
  - `read:sleep` — sleep summary and stages
  - `read:workout` — workout data including HR series and zone breakdowns
  - `read:body_measurement` — weight, height
  - `offline` — refresh-token support
- **Write scopes:** none
- **OAuth redirect URIs to register:**
  - `https://myrxfit.com/oauth/callback/whoop` (production)
  - `myrx://oauth/callback/whoop` (development)
- **Webhook URL** (Whoop pushes new workouts via webhooks):
  `https://myrxfit.com/oauth/webhooks/whoop`

**Whoop API uses OAuth 2.0 + PKCE.** Standard flow, well documented.

**Expected approval time:** 1-2 weeks. Whoop reviews each app manually
but their cycle is faster than Garmin's.

---

## 4. Polar AccessLink API

Apply at: https://www.polar.com/accesslink-api/

Polar's flow: register at the AccessLink portal → fill out the partner
application → wait for the Polar Business team to email you →
receive Client ID + Client Secret.

**Application content:**

- **Company / app name:** MyRX
- **Business contact:** `[YOUR BUSINESS EMAIL]`
- **App description:** Use the verbatim product description above.
- **Use case:** Read-only consumption of Polar Flow training session data
  to power MyRX's personalized cardio training prescriptions. MyRX
  identifies the user's best-effort paces from their Polar workout
  history and prescribes next-step targets across Endurance, Threshold,
  and VO2 Max zones.
- **Scopes requested:**
  - `accesslink.read_all` — full read access to the user's training and
    daily-activity data (Polar's coarse-grained scope; they don't offer
    fine-grained scopes the way Whoop does)
- **OAuth redirect URIs to register:**
  - `https://myrxfit.com/oauth/callback/polar` (production)
  - `myrx://oauth/callback/polar` (development)
- **Webhook URL:** `https://myrxfit.com/oauth/webhooks/polar`
- **Expected users / commercial intent:** Paid subscription tier on
  iOS App Store and Google Play. Year-1 estimate `[YOUR ESTIMATE]`.

**Polar uses OAuth 2.0** — straightforward flow.

**Expected approval time:** 1-2 weeks. Polar's Business team typically
emails back within a week to confirm receipt and ask follow-up questions.

---

## After-submission tracking

Paste each platform's response below as it comes in.

### Samsung Health SDK
- Submission date: **2026-05-18**
- Status: **PENDING** (Samsung said ~3 days to respond — faster than the 1-2 wk doc estimate)
- Business Account: **Northern Princess LLC** (created 2026-05-18 during the application; LLC, US, 1-10 employees, business industries Fitness & Sports + Health Monitoring, type B2B + B2C, est. global revenue $0)
- App registered: **MyRX** (package `com.myrx.app`, projected launch 18 Nov 2026)
- Debug SHA-256 submitted: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` (production SHA-256 to be added once we have a release keystore for Play Store)
- Read data types granted: Heart rate, Exercise with location, Sleep, Steps, Activity summary, Body composition, User profile
- Write data types: none (read-only)
- Attachments uploaded: Data Flow Diagram (`docs/integrations/samsung-data-flow.pdf`), UX Screenshots (4 JPGs from `photos/`)
- Outbound contact email: `motaz.jarrah@hotmail.com` (Samsung Account email, immutable). Approval notification expected to that inbox.
- App ID (assigned by Samsung): `[FILL IN]`
- Client Key: `[FILL IN]`
- Approval notes:

### Garmin Health API
- Submission date: `[DATE]`
- Status: `[PENDING / APPROVED / REJECTED]`
- Consumer Key: `[FILL IN — STORE IN SUPABASE EDGE FUNCTION SECRETS, NOT HERE]`
- Consumer Secret: store in `wrangler secret put GARMIN_CONSUMER_SECRET`
- Approval notes:

### Whoop
- Submission date: `[DATE]`
- Status: `[PENDING / APPROVED / REJECTED]`
- Client ID: `[FILL IN]`
- Client Secret: store in `wrangler secret put WHOOP_CLIENT_SECRET`
- Approval notes:

### Polar AccessLink
- Submission date: **2026-05-19**
- Status: **APPROVED — instant** (Polar's "1-2 weeks" estimate didn't apply; they issued credentials on submit confirmation)
- Client ID: `d315fe6b-5a61-48b5-8224-83f22a311d36`
- Client Secret: stored in `workers/oauth/.dev.vars` (gitignored). On first worker deploy, run `wrangler secret put POLAR_CLIENT_SECRET` from that file then DELETE the secret value from `.dev.vars` (keep the file empty/header-only).
- Scopes enabled: Exercise data, Daily activity data, Physical information data (all three toggled on at registration)
- Authorization redirect URL registered: `https://myrxfit.com/oauth/callback/polar`
- Business profile: Northern Princess LLC, 2821 Braeburn Circle, Ann Arbor MI 48108, USA
- Business contact: team@myrxfit.com
- Account login email: motaz.jarrah@hotmail.com (the existing Polar/Polar Flow account email — used for the AccessLink admin login at admin.polaraccesslink.com)
- License: AccessLink Limited License Agreement accepted on Northern Princess LLC's behalf

### Strava (no approval needed, register-and-go)
- Registration date: `[DATE — DO THIS WEEK]`
- Client ID: `[FILL IN]`
- Client Secret: store in `wrangler secret put STRAVA_CLIENT_SECRET`
- Register at: https://www.strava.com/settings/api

### Fitbit (registration only)
- Registration date: `[DATE]`
- Client ID: `[FILL IN]`
- Client Secret: store in `wrangler secret put FITBIT_CLIENT_SECRET`
- Register at: https://dev.fitbit.com/apps/new

### Apple HealthKit (no external approval)
- iOS entitlement declared in Xcode: `[FILL IN ONCE iOS BUILD EXISTS]`
- App Store review covers HealthKit usage per Apple's standard process.

---

## Why these go in `docs/integrations/` and not in CLAUDE.md

CLAUDE.md is for assistant context — implementation patterns, file paths,
gotchas. This file is the **operational record** of which platform
credentials we have and where we are in each approval cycle. Update it
each time a credential or status changes.

Secrets themselves NEVER live in this file (or any tracked file). They
go into Cloudflare Worker secrets (`wrangler secret put`) and Supabase
Edge Function secrets (Dashboard → Edge Functions → Secrets). See the
"Secrets hygiene (MANDATORY)" section of CLAUDE.md for the rules.
