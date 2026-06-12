# Coach Platform — Roles, Trials & Invites (Locked)

Single reference for the MyRX three-tier role model (platform owner / coach / client), the athlete 30-day reverse trial, billing/tier pricing, the launch-required legal docs status, the web-vs-mobile role rule, and the end-to-end coach-invite pipeline. This is contract material — preserve technical detail verbatim.

---

## Three-tier role hierarchy (LOCKED, May 24 2026 — in-discussion, partial)

The role model is shifting from today's two-tier (admin → end user) to a three-tier system (platform owner → coach → client). Decisions locked so far:

1. **Platform owner is a super-coach.** The platform owner (Motaz) keeps the existing admin portal AND has full visibility on every coach, every coach's clients, and every unlinked end user. The platform owner can personally coach clients without needing a second account — clients can be linked directly to the platform owner just like they can to any other coach. The "Clients" view will consolidate to a single page with sub-views / filters (with-coach / without-coach / by-coach) so the platform owner always sees everything from one place. No two-hat toggle needed.

2. **Coach onboarding is fully open self-signup with a free trial period.** Coaches sign up via their own public flow (separate from client signup), are active immediately, and get a free trial period (length TBD — common SaaS pattern is 14 or 30 days). After the trial they convert to paid subscription. No manual approval gate from the platform owner — quality control will come post-hoc through reviews, refunds, and the ability to suspend bad actors.
   - **Their clients are free** as long as the coach's subscription is active. Clients are linked to the coach's account so billing follows the coach, not the client. If a coach lapses, their clients fall back to either being unlinked (B2C tier) or to a grace period — TBD.

3. **Open self-signup means we need fast review/suspension tooling on the platform-owner side.** Bad coaches will exist; the platform owner needs to see flags (complaints from clients, payment disputes, terms-of-service violations) and suspend coach accounts quickly. This is part of the coach-portal management work.

4. **Client-to-coach linking is coach-initiated invitation only for v1.** Coach has an "Invite client" button in their portal — enters the client's email or phone (+ optional note), the system generates a signed invite link (carrying the coach's id, expiring in 7-14 days), and the link is delivered via email or SMS. If the link recipient is a new user, the existing signup journey runs and auto-links them to the coach on completion. If the recipient is an existing MyRX user, the link opens an in-app prompt: "Coach [Name] wants to add you to their roster — accept?" Accept sets the client's `coach_id` profile column. Decline drops the invite. Client-initiated discovery (browsing a coach directory) is OUT of v1 scope — it adds significant work (public coach profiles, search, ratings, request inbox, moderation) and isn't needed until the platform has a critical mass of coaches. Coach-side acquisition is the proven path for B2B2C coaching SaaS (Trainerize, TrueCoach, MyPTHub all started this way).
   - Data model: one new column on `profiles` (`coach_id uuid REFERENCES profiles(id) NULL`) plus an `invites` table tracking pending invites with revocation / history.

5. **Existing clients migrate to unlinked.** Every client currently in the system is implicitly "linked to Motaz the admin" because that's the only role above end-user. In the new world, those clients get migrated to **unlinked** (B2C tier — `coach_id = NULL`). They stay on the app as B2C users; Motaz no longer has the implicit coaching relationship via the admin role. If Motaz wants to keep coaching specific existing clients, he uses the same invite flow as any other coach (he just happens to also be the platform owner). This keeps the post-launch state clean — no client is accidentally "in someone's roster" because of a historical schema decision.

6. **Both sides can unlink unilaterally; data is always retained.** The coach-client link can be broken from either direction at any time. Specifically:
   - **Client unlinks coach** → app forces the client through a "pick a plan" flow before they can keep using the app. Choices: free tier (limited features) or paid tier (full features without a coach). They can't just go silent; ending the coach relationship is also ending the comp'd access they had under the coach's subscription, so they must consciously pick what comes next.
   - **Coach unlinks (kicks) client** → coach loses view of that client immediately. Client gets the "pick a plan" flow on their NEXT login (we don't interrupt a mid-session client; let them finish whatever they're doing, then prompt at the natural session boundary).
   - **Coach's subscription lapses (stops paying)** → coach loses access to all their clients' data immediately. Each affected client sees a polite message at the top of their app: "Your coach's subscription isn't currently active, so they can't view your data right now. Pick a plan to keep all features, or switch to the free tier to continue with what's available." This is the same plan-picker shown for the other unlink paths, just with a different framing message.
   - **Client data is ALWAYS retained no matter what.** Downgrading from coached → free, lapsing from paid → free, coach kicks client, client leaves coach — none of these delete data. Features get gated based on the active tier, but the underlying logs / weights / chat history / wearable samples / food logs are preserved. If the client ever upgrades back (joins a new coach, pays for the paid tier), all their historical data is right there waiting and they continue where they left off.
   - **No cooling-off period** — client can unlink and immediately accept a new coach's invite. We trust the user.
   - **Reporting tool is deferred to v2** — no "Report this coach" button at launch. Add later if abuse patterns emerge.

7. **Coach portal lives at `/coach/*` — separate URL space from `/admin/*`.** Sharing routes would be cleaner in theory but the user explicitly wants a clear "this is mine" mental model for coaches. Two side effects of this decision: (a) we need to fork some shared chrome (top bar, side nav) into a coach version, and (b) auth-gate routing has to redirect coaches landing on `/admin/*` and admins landing on `/coach/*` to their own home.

8. **Coach portal scope — what coaches can / cannot access:**
   - **Coach CAN see** — their roster (clients linked to them only), each of their client's profile / training / body / calories tabs, chat with their clients, the progress dashboard scoped to their roster, the nutrition-compliance grid scoped to their roster, the activity feed scoped to their roster, their own coach profile / subscription / Invite Client surface, plus the new coach-specific pages we're building (see Q6 thread)
   - **Coach CANNOT see** — Suggestions (admin-only — these route to the platform owner for product feedback), the Movement Library (read-only platform-wide list — the platform owner is the sole editor), the Food Library (same: platform owner edits, coach has zero access not even read), other coaches' rosters, platform-wide billing, the coach directory, refund queue, abuse-report queue, support escalations.

9. **Coach onboarding happens DURING signup, not after.** The coach signup journey itself is the onboarding wizard — profile setup, subscription terms acceptance, first invite tutorial all happen in the signup flow before they land on their first dashboard view. No separate "first-run wizard" after signup. The flow has to be tight enough that they don't drop off — split into clear steps with progress dots, same pattern as the existing client signup journey.

10. **Both the coach pages AND the admin pages need a rethink as part of this update — NOT deferred to v2.** The current admin portal was built for "Motaz personally manages a small client roster". It doesn't have everything a coach needs to oversee a roster of 30+ clients on the next-step thesis, and doesn't have everything a platform owner managing a multi-coach marketplace needs. Both surfaces get net-new pages designed during this update.

11. **Coach is a NEXT-STEP OVERSEER, NOT a workout programmer.** Critical philosophical lock. MyRX's algorithm picks the client's next weight, next pace, next macro target. The coach's job is to oversee: see the holistic picture for each client, validate that the algorithm's prescriptions are appropriate, adjust the underlying parameters that drive them (calorie pace, weight goal, macro preset, fat-level, BFP, etc.), and communicate. The coach does NOT build training plans from scratch, design workout calendars, or upload exercise demo videos. That whole class of feature (Trainerize / TrueCoach / MyPTHub style workout programming) is **explicitly out of scope for v1 AND v2** — it's not what MyRX is. Coaches who want to write custom workouts can use another tool; coaches who want to OVERSEE clients on a next-step coaching algorithm use MyRX.

12. **Coach portal v1 pages — the locked set.**
    - **Carries over from existing admin portal (scoped to roster)**: Roster, Client detail (profile + efforts + body + calories tabs), Progress dashboard (weight goals), Nutrition compliance grid, Activity feed, Messages (chat with their clients), Intake Plan editor.
    - **New surfaces aligned with the next-step thesis**:
      - **Per-client snapshot** — one screen showing every domain's current next-step state for a single client (strength next targets across top movements, current cardio zone + next session, today's calorie target + 7-day adherence, weight gap to goal + ETA, today's resting/avg HR, nearest ROM goal). Coach's "how's Sarah doing right now?" view. Replaces clicking through 6 tabs to assemble the same picture mentally.
      - **Coach private notes per client** — date-stamped journal only the coach sees. Surfaces on the client detail page. Coach-only, never visible to client.
      - **Parameter templates** (NOT workout templates) — reusable PARAMETER bundles: "Aggressive cut template" = Lose Hard + High-Protein + 25 % deficit cap. "Lean bulk template" = Gain Steady + Balanced macros. "Marathon prep template" = high cardio TDEE multiplier + Performance macros. Coach picks a template, applies to a client, the calorie plan parameter screen prefills for review/save.
      - **Suggested adjustments queue** — system-generated prompts the coach reviews in the morning: "Sarah hit her weight goal — switch to maintenance?" "Mike's been below his calorie target 6 of 7 days — adjust target down?" "Lisa hasn't logged strength in 2 weeks — message her?" Read down the list, take action or dismiss.
      - **Onboarding intake form** — lightweight 5-10 question form a client fills when they accept a coach's invite. Current goal, training experience, schedule (days/week), injuries, equipment access. Coach reads this in the client detail. Not a full PARQ.
      - **Roster health overview ("morning briefing")** — daily-opened dashboard with aggregate stats across the roster: how many need attention, how many new check-ins to review, how many unread messages, this week's PRs across the roster.
      - **Coach profile (visible to client)** — bio, photo, specialties. Shown during invite accept + in chat header.
      - **Subscription** — coach's own billing status, trial countdown, plan tier, payment method, cancel.
      - **Invite Client** — form to send invites + history (pending / accepted / declined / expired).

13. **Coach portal v1 — explicit NOs.** Listed so future asks for these features can be answered with "out of scope per Q6 lock": no training plan builder, no cardio session calendar, no custom exercise videos, no meal plan builder, no direct in-app payments from coach to client, no group programs, no custom coach branding override of MyRX brand, no scheduling / appointment system.

14. **Admin (platform-owner) portal v1 pages — the locked set.**
    - **Carries over from existing admin portal (with marketplace scope)**: Admin overview / dashboard (expand stats to include total coaches, total clients, unlinked B2C count, weekly MRR, churn), Movement Library (admin-only edit, coaches + clients see read-only), Food Library (admin-only edit, coaches don't see at all, clients see only what the system serves them), Suggestions (flat feed of all client suggestions across all clients — already exists today).
    - **New surfaces a platform owner needs**:
      - **Coaches list** — every coach on the platform with photo, name, status (active / trialing / suspended / lapsed), join date, roster size, subscription tier, MRR contribution, last-active. Filter / sort. Click to coach detail.
      - **Coach detail** — drill into one coach: profile, roster (their clients), subscription history, support history, billing events, audit log of significant actions. Admin-only controls: suspend, refund a billing event, message the coach, override subscription state.
      - **Clients list (consolidated, marketplace-wide)** — every client across the platform with photo, name, status, with-coach badge / unlinked badge, last-active, calorie tier, weight goal status. Filter chips: *with-coach*, *unlinked*, *by-coach (specific coach)*, *free tier*, *paid tier*. Single page implements what was earlier discussed as "consolidate client pages under a single Clients page with sub pages".
      - **Billing dashboard** — every coach subscription event: signups, trial conversions, churn, refunds, MRR / ARR trends, failed payments. Per-coach billing history. Payment-processor webhook log.
      - **Refund queue** — manual review queue. Each entry shows context, history, approve/decline/credit buttons. Audit-logged.
      - **Abuse / moderation queue** — surface stubbed at launch (so it's not net-new when v2 reporting tool lands). Lists flagged coaches / clients with severity, source, action history.
      - **Support inbox** — manual support tickets from coaches or clients. Web ticket form + email forward into queue. Status, assigned-to, threaded reply, related coach/client.
      - **Platform health page** — live ops view: error rate, API uptime, Supabase / Cloudflare status, recent deploys.
      - **Coach analytics deep-dive** — beyond top-line MRR: retention curves, cohort analysis, trial-to-paid conversion rate, average roster size by tenure, top-performing coaches by client outcomes, churn-risk indicators.
      - **Marketing tools** — referral programs (coach-referred-coach incentives), promo codes for coaches (e.g., extend trial, % off first 3 months), launch campaign tracking (where coaches found us — utm-style attribution), email blast tooling for the coach base.

15. **Admin portal v1 — explicit NO.** Documentation / policy editor (markdown editor + version history for legal docs in-app) deferred to v2. At launch volumes, editing legal docs in the codebase + re-deploy is acceptable. Build a real editor once docs change frequently or non-engineers (legal team) edit them.

16. **Client-app changes when coached vs unlinked — locked set.**
    - **Chat scope**: when client has a coach, chat targets THAT coach (coach photo + first name in header). When client is unlinked, the chat icon is HIDDEN entirely — chat is reserved for coach-client. Unlinked clients use Suggestions to reach the platform.
    - **Coach branding visible to client**: chat header shows coach photo + name. Client dashboard shows a small "Coached by [Coach Name]" chip with coach photo near their own profile photo. Tapping the chip opens the coach profile card (bio, specialties, photo, "Unlink from coach" button).
    - **Onboarding intake form**: when a client accepts a coach's invite, they immediately get a PARQ + onboarding form. **Required to sign / complete — non-negotiable, no skip path.** Until completed, the client cannot use the coached experience. PARQ = Physical Activity Readiness Questionnaire (standard pre-exercise screening; covers cardiovascular conditions, medications, injuries). Onboarding form layers on: current goal, training experience, schedule availability, equipment access, food preferences. Both are signed (timestamp + agreement record) and stored against the client's profile so the coach can read them in the client detail view and so we have a compliance record for liability purposes.
    - **"Pick a plan" flow** (fires on client-unlinks-coach / coach-unlinks-client / coach-subscription-lapses): two visible buttons (free tier / paid tier). "Find a new coach" button reserved for v2 (no coach directory in v1). Lapse messaging is sympathetic: "Your coach's subscription isn't currently active right now. Pick what's next for you." Tier specifics still under review (see Q9 thread).
    - **Suggestions affordance**: both coached AND self-coached clients see the amber Lightbulb (Suggestions) button. Suggestions ALWAYS go to admin (platform owner), never to the coach. Coach has no visibility into suggestions. Chat is the coach-client channel; suggestions are the platform-owner channel.
    - **Coached chip on dashboard**: small chip near client's own profile photo showing "Coached by [Coach Name]" + coach photo. Quick way to re-find the coach without digging through Settings.
    - **Calorie page view differs based on coached vs self-coached — and ONLY the calorie page**:
       - At signup, if a `coach_id` is assigned (via invite-link), the client starts as **coached** → coached calorie page view (plan parameters editable by coach, read-only for client + appropriate guidance copy).
       - At signup with no `coach_id`, the client starts as **self-coached** → self-coached calorie page view (plan parameters fully editable by client, the existing wizard / chips / goal flow).
       - All other domains (strength, cardio, mobility, bodyweight, heart, history) render IDENTICALLY whether the client is coached or self-coached. The algorithm picks next-step the same way for both; only the calorie-page lock changes.
       - This consolidates and supersedes the prior `is_self_coached` boolean — the truth source becomes `coach_id IS NULL` (self-coached) vs `coach_id IS NOT NULL` (coached). Migration step in implementation phase.

17. **Account resurrection — credential-history requirement (LOCKED, May 24 2026).** Critical data-architecture decision. When a user deletes their account and later re-signs up with the same email or phone, we MUST be able to find their previous data and offer to restore it. A user should never lose their progression history because they deleted and re-created.

    - **Mechanism**: a `credential_history` table that records every (user_id, email, phone, recorded_at, event_type) tuple over the user's lifecycle. Event types include `signup`, `email_change`, `phone_change`, `deletion`, `resurrection`. The table is append-only — credentials are recorded as they're used / changed, never overwritten.
    - **At signup**: before creating a new profile, check `credential_history` for any prior `user_id` matching the incoming email OR phone. If found, surface a "We found previous data linked to this email — restore it?" prompt to the user. On accept, the new auth user is linked to the OLD profile id (not a new one), and all historical efforts / bodyweight / calories / wearable data / etc. is immediately accessible. On decline, a fresh profile is created and the credential_history row records `signup` as a new lineage.
    - **At account deactivation**: rather than hard-deleting the profile row + all its dependent data, we mark `profiles.deactivated_at = now()` (renamed from the misleading `deleted_at` on May 26 2026) and record a `deletion` event in `credential_history`. The auth.users record IS deleted (so the user can't sign in with the old credentials and so we honor right-to-deletion requirements legally), but the underlying data remains keyed to the stable profile id. The user's PII (email, phone, full_name) on the profile row can be tombstoned to a hash to satisfy GDPR / CCPA right-to-erasure if requested; the activity logs themselves stay anonymized but recoverable.
    - **Schema design implications**: the `profiles.id` becomes a STABLE long-term identifier independent of auth.users.id. A new column `profiles.auth_user_id` references auth.users for the current sign-in mapping. On resurrection, only `auth_user_id` changes — all foreign keys on logs, efforts, bodyweight, etc. continue to reference the original `profiles.id`.
    - **Privacy + legal considerations**: this is COMPATIBLE with GDPR / CCPA when properly scoped — we honor erasure requests by hashing the PII + dropping the credential_history's email/phone columns for that user. The pseudonymous activity data can stay for legitimate-interest purposes (anonymized fitness research, aggregate platform analytics). Specifics will need a privacy-lawyer review before launch but the architecture supports it.

18. **Billing model — locked (pricing model finalized 2026-06-06: EVERYTHING is a recurring subscription; the old one-time / lifetime B2C model is RETIRED).**
    - **Coaches pay; their clients NEVER pay.** A client linked to an active coach gets **full FullRX access** for free — the coach's subscription IS the client's access. **Every coach tier grants FullRX to the coach AND all their linked athletes; coach tiers differ only by client cap.**
    - **Coach subscriptions are recurring monthly / annual**, paid via Stripe Checkout on the website (never inside the mobile app — no Apple/Google involvement). **Annual = recurring 17% off ("2 months free"), every year — it renews at the same discounted annual price (NOT first-year-only; there is no year-2 jump).**
    - **Public (athlete / B2C) users pay a recurring MONTHLY subscription per tier.** 30-day FullRX REVERSE trial on signup (raised from 14 + restructured 2026-06-09, T165 — see the "Athlete 30-day reverse trial" section below); annual option = recurring 17% off. Three tiers: Free / CoreRX / FullRX. The earlier "pay once, own it forever" lifetime model is retired (locked 2026-06-06).
    - **Free trial: 30 days for COACHES** (sign up, enter payment, get 30 days of full functionality, auto-converts on day 31 unless cancelled; Stripe Smart Retries — 4 attempts over ~3 weeks — for failed payments; lapse / soft-grace / hard-grace timeline per Q4 lock). Raised from 14 → 30 days (T207, 2026-06-11). **ATHLETES get the 30-day no-card reverse trial instead** (T165, 2026-06-09) — no payment up front, our own grant, auto-drops to Free at day 30.
    - **Payment processor for direct billing: Stripe.** Coach + B2C web-purchased subscriptions both run on Stripe (~2.9% + $0.30 / transaction). Square is NOT the path forward — Stripe's subscription + dunning + tax + webhook ecosystem is meaningfully better for SaaS.
    - **B2C in-app subscriptions use Apple IAP / Google Play Billing** (auto-renewable subscriptions). Mandatory per Apple Guideline 3.1.1 and Google Play Billing policy — any in-app feature unlock MUST use the platform processor. **Apply for Apple App Store Small Business Program** at launch so revenue under $1M/year drops Apple's cut from 30 % to 15 %. Google Play has an analogous tier.
    - **Acquisition-channel-aware hybrid for B2C** (LOCKED — pattern 3 from Q9 discussion). In-app upgrade button uses IAP (Apple/Google take 15 %). Same upgrade is available on website via Stripe (we keep ~97 %). **Same price on both surfaces** — no in-app promotion of the cheaper web path, no compliance risk with Apple. Marketing (email, social ads, blog, organic search) pushes users to the website where they can convert via Stripe. Most early volume goes through IAP (App Store discoverability); blended cut comes down as the marketing engine matures and more conversions happen on web. Expected blended Apple cut after year 1: ~8-12 % of B2C revenue.

19. **Coach tier prices — LOCKED FINAL (2026-06-06).**
    Monthly subscription, 30-day free trial. Annual = recurring 17% off ("2 months free"), every year (NOT first-year-only — it renews at the same discounted annual, no year-2 jump). **Every coach tier grants full FullRX access to the coach AND all their linked athletes; tiers differ only by client cap.**
    | Tier | Client cap | Monthly | Annual (17% off, recurring) |
    |---|---|---|---|
    | Coach Starter | 10 | $19 / mo | $189 / yr |
    | Coach Pro | 25 | $39 / mo | $389 / yr |
    | Coach Elite | 26+ (truly unlimited) | $99 / mo | $989 / yr |

    Notes:
    - Top tier was named "Coach Unlimited" in an earlier draft; renamed to **Coach Elite** May 25 2026. Code references use `elite` as the tier id.
    - Top-tier cap lowered from 50+ to 26+ — coaches at this volume are the agency / high-volume segment, not the typical solo coach.
    - **Client count = total clients linked to the coach (not active-only).** Coaches can SUSPEND a client to retain their data while freeing the slot (suspended client loses app access, is gently prompted to switch to a free or paid B2C tier). Reactivation requires the coach to be under their tier cap (or to upgrade). If a suspended client switches to self-coached, they unlink fully and disappear from the coach's roster. **Implementation of the suspend mechanism is its own discussion thread after the v1 pricing UI lands** — covers the suspend button UI on the coach side, the gentle prompt on the client side, the slot-reclamation logic, and the auto-unlink-on-self-coach-switch flow.

20. **Public (B2C / athlete) tier prices — LOCKED FINAL (2026-06-06; trial restructured to 30-day reverse trial 2026-06-09, T165).** Recurring MONTHLY subscription; annual option = recurring 17% off ("2 months free"). The earlier one-time / lifetime model is RETIRED.
    | Tier | Pages unlocked (cumulative) | Monthly | Annual (17% off) |
    |---|---|---|---|
    | Free | Strength + Cardio | $0 | — |
    | CoreRX | Free + Bodyweight + Calories/Food | $4.99 / mo | $49.99 / yr |
    | FullRX | CoreRX + Heart + Hydration + Sleep + every future feature | $6.99 / mo | $69.99 / yr |

    Notes:
    - Code tier ids: `free` / `corerx` / `fullrx` (the middle tier's earlier-draft name is fully retired — `corerx` is the only id).
    - Free is genuinely usable (not a trial) — drives adoption + exposes upgrade prompts. Everyone also gets the 30-day FullRX reverse trial on signup before landing on their chosen tier (see the section below).
    - CoreRX adds the two most-asked-for features (body composition tracking + calorie/macro coaching).
    - FullRX adds the wellness layer (Heart / Hydration / Sleep) — appeals to power users / wearable owners, and is the $2-more no-brainer over CoreRX.
    - Heart, Hydration, and Sleep are all built (they're the FullRX wellness pages).
    - Ads: discussion deferred to a separate phase. Free tier currently has no ads listed in this lock.

---

## Athlete 30-day FullRX reverse trial — SHIPPED system spec (T165, locked 2026-06-09)

The athlete trial is a **reverse trial**: every new athlete signup starts with FULL FullRX access for 30 days with **no card and no store subscription**, then auto-drops to the Free tier unless they subscribe. It is **OUR OWN grant** (DB columns on `profiles`), never an Apple/Google/Stripe subscription — the store sub only begins if/when the user actually pays. Rail for athlete payments: **Apple/Google in-app purchase, globally** (locked 2026-06-09; no in-app mention of any external subscribe page — anti-steering rules outside US/EU).

- **DB (migration `t165_b2c_trial_columns`):** `profiles.b2c_trial_ends_at` (set ONCE at welcome-end = now + 30 days, guarded against overwrite on resume), `b2c_trial_ended_acknowledged_at` (day-30 modal dismissal), `b2c_trial_reminder_7d_sent_at` / `b2c_trial_reminder_2d_sent_at` (email dedup stamps).
- **Effective tier:** `resolveTier` gained a trial branch — live trial ⇒ `fullrx`; expiry drops the user to `b2c_subscription_tier ?? 'free'` automatically with **no DB write**. Branch order: superuser → coach-self → coached-client → **trial** → paid tier. Updated in ALL FOUR copies: `mobile/src/components/RadialNav.tsx`, `mobile/app/(app)/dashboard.tsx`, `web/src/pages/admin/AdminUserDetail.jsx`, `web/src/pages/coach/CoachClientDetail.jsx`.
- **Signup touchpoints (exactly two, locked):** (1) the **gift screen** (`'gift'` step, fresh order only, right after the projection reveal) — copy LOCKED verbatim: *"MyRX is free to use — You're starting with FullRX free for 30 days. No card required, nothing to cancel."*; (2) the **welcome-end restate**: *"30 days of FullRX starts now — we'll remind you before it ends."* NO tier comparison anywhere in signup.
- **During the trial:** dashboard **banner** (`TrialBanner.tsx`, CoachChangeBanner chrome in blue, "FullRX trial — N days left", per-day dismissible via AsyncStorage, taps to Settings → Billing). Hidden for coaches / superusers / coach-attached / already-subscribed.
- **Reminders:** edge function `trial-reminders` (SendGrid, same secrets as send-coach-invite) invoked hourly by pg_cron job `b2c_trial_reminders` (`:15`, offset from the `:00` anonymize job) via `pg_net` → sends the 7-day and 2-day emails exactly once each (stamp columns). Auth: the cron reads the service-role key from **Vault secret `service_role_key`** — until that secret is created (one-time `select vault.create_secret('<key>','service_role_key');` in the SQL editor) the job no-ops with a 401. Copy rule: "keep your access" framing, NEVER "you'll be charged" (nothing auto-bills). Push/in-app notification channel is T166 (future).
- **Day 30:** `TrialEndedModal.tsx` on the dashboard — graceful step-down ("You're now on Free — your logs and history are all still here"), shows the **first** tier comparison (`PlanCards.tsx`) + "Stay on Free" dismiss (writes the ack stamp). Skipped entirely if the user subscribed mid-trial.
- **Upgrade surface:** Settings → Billing (`BillingTab.tsx` self-managed branch renders trial/tier-aware copy + `PlanCards`). RadialNav's UpgradeModal already deep-links there. `PlanCards` = 3 tier cards + monthly/annual toggle, FullRX badged "Most popular".
- **Mid-trial upgrade keeps the remaining free days** (locked): the tier is written immediately but resolveTier's trial branch keeps FullRX until day 30 — billing conceptually starts at expiry. The real store rail will honor this via a store-side intro offer.
- **Payment rail abstraction:** `mobile/src/lib/billing.ts` — tier catalog (`ATHLETE_TIERS`, product ids `corerx_monthly` / `corerx_annual` / `fullrx_monthly` / `fullrx_annual`), trial helpers, and `purchase()` — currently the **MOCK store provider** (dev Alert sheet simulating success/cancel/fail; success writes `b2c_subscription_tier` client-side, exactly the state change the real store webhook will perform server-side). When Apple/Google accounts are linked, swap the body of `purchase()` for the store SDK + receipt validation; UI doesn't change.
- **Testing without store accounts:** time-travel by setting `b2c_trial_ends_at` via SQL (future = banner/days, within 7d/2d = reminder emails on next cron tick, past = step-down modal + locks); the mock sheet covers purchase outcomes; Apple sandbox / Google license testers replace the mock when accounts exist.

Open items still to discuss / track outside this thread:
- Notifications system — flagged as the **NEXT major phase AFTER the coach platform work lands.** Out of scope for THIS update, called out here so it doesn't slip later. Will cover: push notifications + in-app notification center for coach invites, coach messages, plan adjustments, milestone celebrations, check-in reminders, billing events, Suggestions replies, etc. Will need its own full design pass.
- Ad strategy (whether to include in Free tier, network choice, placement, opt-out) — deferred to a separate phase per user lock.
- Coach analytics deep-dive details (which specific metrics, dashboards) — surface is locked for v1 but the actual metrics to display need a design pass during implementation.
- Marketing tools details (referral program incentive structure, promo code system, attribution tracking) — surface is locked for v1, details TBD during implementation.

---

## Launch-required documentation — STATUS (updated May 26, 2026)

All 10 baseline docs are written and live. Effective dates and incorporation chain audited + locked May 26, 2026 — see the "Legal docs + consent-chain rules" section further down for the rules that govern future edits. Before paid public launch we still need a fitness-industry-aware lawyer to review (the v1 docs are drafted in-house and incorporate standard provisions, but a lawyer review is still worth doing before significant revenue flows).

| # | Doc | URL | Status |
|---|-----|-----|--------|
| 1 | Privacy Policy | `/privacy` | ✅ SHIPPED (audited May 26) — §3.3 now correctly describes wearable data collection; §6.1 subprocessor list synced with DPA; §6.2 / §6.6 reference Coach Agreement + DPA |
| 2 | Terms of Service | `/terms` | ✅ SHIPPED (audited May 26) — §1 incorporates ALL 8 docs by reference; §5.5 defers to Refund Policy; §8 references Coach Agreement + DPA; §9 references Health Disclaimer; §18 lists all 8 in "entire agreement" |
| 3 | Coach Agreement | `/coach-agreement` | ✅ SHIPPED May 26 — bundles Code of Conduct (#8 below) inside as §5 |
| 4 | Refund Policy | `/refund-policy` | ✅ SHIPPED May 26 |
| 5 | Health & Medical Disclaimer | `/health-disclaimer` | ✅ SHIPPED May 26 |
| 6 | Subscription auto-renewal disclosure | inside Coach Agreement §3 + Refund Policy §1.3 | ✅ SHIPPED May 26 — not a standalone doc; the required disclosures live inside Coach Agreement and Refund Policy as the Stripe + Apple/Google submission process expects |
| 7 | Acceptable Use Policy | `/acceptable-use` | ✅ SHIPPED (pre-existing) |
| 8 | Coach Code of Conduct | inside Coach Agreement §5 | ✅ SHIPPED May 26 — bundled into Coach Agreement, not a standalone doc |
| 9 | Data Processing Agreement (DPA) | `/dpa` | ✅ SHIPPED May 26 — GDPR Art. 28 + CCPA service-provider terms; subprocessor list, SCCs, 72-hour breach notification, audit rights |
| 10 | Cookie Policy | `/cookies` | ✅ SHIPPED (pre-existing) |

All 8 routable docs wired in `web/src/App.jsx` (lazy-loaded as PUBLIC routes ABOVE `ProtectedLayout`'s catch-all). All 8 listed in `web/src/pages/legal/LegalLayout.jsx::FOOTER_LINKS` and `mobile/app/(app)/about.tsx`. Consent checkbox on web coach signup names TOS + PP + Coach Agreement + DPA and signals incorporation of the rest; mobile athlete signup names TOS + PP + Health Disclaimer.

---

## Coach Invite Client flow — locked design spec (May 26 2026)

The end-to-end pipeline for a coach to bring a client onto their roster via a one-click email invite link. Shipped end-to-end on May 26 2026; this section is the contract every downstream change must respect.

**Token + invite row:**

- `coach_invites` table — created in Phase 1 migration. Columns: `id`, `coach_id`, `invitee_email`, `invitee_phone`, `coach_message`, `token` (64-char random URL-safe), `status` (`pending` | `accepted` | `revoked` | `declined`), `expires_at` (default `now() + 14 days`), `created_at`, `accepted_at`, `accepted_by`. Unique partial index on `(coach_id, lower(invitee_email))` WHERE `status = 'pending'` blocks duplicate active invites to the same email per coach. RLS: coaches can SELECT/INSERT/UPDATE their own rows (`coach_id = auth.uid()`); anonymous can SELECT a single row by token (gated via the preview RPC).
- Expiry is **14 days** — long enough that "I saw it but life got busy" still works, short enough that stale links don't sit in inboxes forever.
- `token` is the secret. NEVER expose it in app logs, error messages, or activity feed details. Only render it inside the email body and the URL hash.

**Edge function — `send-coach-invite`:**

Lives at `supabase/functions/send-coach-invite/index.ts`. JWT-required (caller must be authenticated). Validates:
1. Caller has `is_coach = true` AND `coach_subscription_status IN ('trialing', 'active')`. Otherwise → 403 with `code: 'not_a_coach'`.
2. At least one of `invitee_email` / `invitee_phone` is non-null.
3. Invitee state matrix:
   - `is_coach = true` on existing profile → reject `cant_invite_coach`
   - `is_superuser = true` → reject `cant_invite_admin`
   - `deactivated_at IS NOT NULL` → reject `account_deactivated`
   - Already on the SAME coach's roster (`profiles.coach_id = caller`) → reject `already_on_roster`
   - Duplicate pending invite from this coach to this invitee → reject `duplicate_pending_invite`
4. Generates a 64-char token via `crypto.randomBytes(48).toString('base64url')`.
5. Inserts `coach_invites` row with 14-day expiry.
6. **Email** via **SendGrid (Twilio's email product)**. Secrets: `SENDGRID_API_KEY` + `SENDGRID_FROM` (default `"MyRX <invites@myrxfit.com>"`). Vendor choice locked May 26 2026, FULLY PROVISIONED same day: we use SendGrid instead of Resend because Twilio acquired SendGrid in 2019 and we already have a paid Twilio account for Verify — one vendor, one bill, one support relationship covers both email + SMS channels. SendGrid sending domain (myrxfit.com) authenticated via Twilio One Console → Email → Authenticate domain → automated Cloudflare integration (Entri). Three CNAME records auto-installed on Cloudflare DNS: `em6552.myrxfit.com` + `s1._domainkey` + `s2._domainkey` (plus the existing `_dmarc` TXT was kept). DKIM/SPF/DMARC propagated within ~30 seconds via Cloudflare's internal DNS. The edge function posts to `https://api.sendgrid.com/v3/mail/send` with tracking_settings DISABLED — click-tracking would rewrite the accept URL into a SendGrid redirect, leaking the token to their logs AND breaking the Android App Link autoVerify match (different host). Branded HTML template referencing the coach's name + optional personal message + the CTA link `https://myrxfit.com/coach/accept-invite?token=<token>`. Email always fires unless `invitee_email` is null. If `SENDGRID_API_KEY` is missing, the function still inserts the invite row + returns `sent_email: false` so the URL is recoverable from the function logs.
7. **SMS DEFERRED until Twilio A2P 10DLC approval lands.** Phone is stored on the invite row so the SMS can fire automatically once approval comes through. `sms_deferred: true` flag is returned in the response so the UI can surface this.
8. Writes a `coach_invite.sent` activity event.

**RPCs — both SECURITY DEFINER + `SET search_path = public`:**

- `preview_coach_invite(p_token text)` — PUBLIC (no auth required). Returns `{ result, invite_id, coach: {id, full_name, avatar_url}, invitee_email, invitee_phone, expires_at, coach_message }`. Result codes: `pending`, `invalid`, `revoked`, `expired`, `accepted`, `declined`. Lets the AcceptInvite landing page show the coach's name + avatar BEFORE the invitee signs in — critical for trust ("oh yes, that's my coach").
- `accept_coach_invite(p_token text, p_confirm_swap boolean DEFAULT false)` — AUTH REQUIRED. Returns `{ result, coach?, current_coach?, previous_coach?, new_coach?, message?, invite_email?, your_email?, invite_phone?, your_phone? }`. **On `success` / `success_swap` the RPC sets `profiles.chat_enabled = true` on the accepting client** (locked May 26 2026 — the coach platform makes chat the primary communication channel, so a freshly-linked client needs the Chat button enabled immediately, not after admin manually toggles it). Admin retains override authority via AdminUserDetail's chat toggle; re-accepting an invite re-enables it (fresh relationship, fresh trust). Coaches do NOT get chat_enabled toggle authority — the auto-enable is their allowance. Result codes (all 12 MUST be handled by every client surface that calls this):
  - `success` — fresh link to coach, no previous coach. Returns `coach`.
  - `success_swap` — was previously coached by someone else; coach_id swapped. Returns `previous_coach` + `new_coach`.
  - `needs_swap_confirmation` — invitee already has a coach AND `p_confirm_swap=false`. Returns `current_coach`. UI must show inline confirmation, then re-fire with `p_confirm_swap=true`.
  - `already_accepted_by_you` — re-tap of the same invite link by the same user. Returns `coach`. UI shows soft "you're already linked" + dashboard CTA.
  - `already_used` — accepted/declined by someone else (or this user previously declined). Terminal.
  - `revoked` — coach revoked the invite. Terminal.
  - `expired` — past 14-day expiry. Terminal.
  - `invalid` — token doesn't exist OR auth.uid() is null OR token is empty. Terminal.
  - `email_mismatch` / `phone_mismatch` — signed-in account's email/phone doesn't match what the invite was sent to. UI shows both addresses + "sign out and use the right account" CTA.
  - `is_coach` / `is_admin` — signed-in user is a coach or admin and can't be coached. UI shows "coach/admin accounts can't be coached" block.
- Atomic token race protection: the `UPDATE coach_invites SET status='accepted' WHERE token=p_token AND status='pending'` returns `0 ROW_COUNT` if a concurrent acceptance won, in which case the RPC returns `already_used`. Both clients fail safely.
- Writes a `coach.assigned` or `coach.swapped` activity event on success.

**Web surfaces:**

1. **`/coach/invite`** — `web/src/pages/coach/CoachInvite.jsx`. Coach-side form (email + optional phone + 500-char personal message) + pending invites list with Revoke/Resend actions + recently-accepted list (last 10, links to client detail). Realtime via `supabase.channel('coach-invites-${user.id}').on('postgres_changes', { filter: 'coach_id=eq.<id>' }, refetch)`. Resend = revoke the old row + re-fire the edge function (the duplicate-invite guard requires the old row to be revoked first).
2. **`/coach/accept-invite?token=xxx`** — `web/src/pages/coach/AcceptInvite.jsx`. PUBLIC route — MUST sit ABOVE the `ProtectedLayout` catch-all in `App.jsx`. Reads `?token=` via `new URLSearchParams(window.location.search)` (Wouter's `useLocation` doesn't expose query strings). Renders all 12 RPC result states. Signed-out → routes to `/signup?invite=<token>`. Signed-in → fires the accept RPC. Auto-redirects to `/dashboard?invite_accepted=1` on success.
3. **`/signup?invite=xxx`** — `web/src/pages/Signup.jsx`. The end-user signup journey. URL param captured into `data.invite` early, persisted to sessionStorage via the existing `safeData` spread (survives app-switching for SMS reads). The final `WelcomeEndScreen.openDashboard()` (lines ~3440-3465) fires `accept_coach_invite({ p_token: data.invite, p_confirm_swap: false })` AFTER `refreshProfile()` AND BEFORE `navigate('/dashboard')`. Failures are non-blocking — user reaches the dashboard regardless; coach can re-invite if the linkage didn't take.
4. **`/coach/clients`** — `web/src/pages/coach/CoachClients.jsx`. Roster list. Realtime subscription to `profiles` filtered on `coach_id=eq.${user.id}` for INSERT + UPDATE + DELETE. UPDATE handler covers the existing-account-invitee case (their `coach_id` got set after-the-fact). Empty state in coach voice with CTA to `/coach/invite`. Search input appears only when 4+ clients exist.

**Mobile surfaces:**

1. **`mobile/app/(auth)/accept-invite.tsx`** — Public landing screen. PUBLIC (no auth required to view — that's why it sits in `(auth)`). Uses `useLocalSearchParams<{ token?: string; invite?: string }>()` from `expo-router`. Same 12-result-code handling as web. Signed-out → `router.replace('/(auth)/sign-up?invite=<token>')`. Signed-in → fires accept RPC. `needs_swap_confirmation` shows a native `Alert.alert` with "Cancel" + destructive "Switch coach" → re-fires with `p_confirm_swap: true`.
2. **`mobile/app/(auth)/sign-up.tsx`** — Reads `?invite=xxx` via `useLocalSearchParams`. Stamps into `data.invite` (added to `JourneyData` interface + `defaultData`). Persists across AsyncStorage round-trips (`safeData` spread automatically). On `WelcomeEndScreen.openDashboard()` final navigation, calls `accept_coach_invite` exactly like web — non-blocking failures, route to `/(app)/dashboard?invite_accepted=1` on success.

**Android App Links (`mobile/app.json`):**

The `intentFilters` block has TWO `pathPrefix` entries — `/auth` AND `/coach/accept-invite`. Both verified via the existing `web/public/.well-known/assetlinks.json` (uses `handle_all_urls` so the verification is domain-wide). When the user taps the email-invite link on their phone WITH the dev-client APK installed AND Android App Links verification has succeeded, the link opens the mobile app directly into `/(auth)/accept-invite?token=xxx` instead of the browser. Production APK gets the same treatment via the same intent filter (re-prebuild required after `app.json` changes).

**Voice (LOCKED — every string MUST follow):**

- Form intro: "Send an email invite. Your client signs up for free, joins your roster automatically."
- Form footer note: "The link in the email lasts 14 days and only works once. The first person to sign up through it links to your roster — that's why we don't share a generic invite URL anywhere in the app."
- Personal message hint: "Recommended. A personal note triples acceptance rates vs. a bare templated invite — your client knows the link is real and the ask is human."
- Empty roster state: "Send your first invite from the Invite Client page — your clients sign up free under your subscription and appear here automatically. Once linked, you can manage their macro plan, review their training, and message them from this portal."
- `needs_swap_confirmation` UI: shows the current coach's name + avatar AND the new coach's name + avatar, with copy explaining "your current coach will lose access to your data the moment you confirm — your training, macro plan, and chat with [current coach] will be replaced with [new coach]". Confirm button is amber/destructive-styled.

**Out of v1 scope (deferred):**

- **SMS dispatch** — depends on Twilio A2P 10DLC approval. Edge function already accepts `invitee_phone`; just doesn't send the text yet. When approval lands, flip the `sms_deferred` branch in `send-coach-invite/index.ts` to actually fire the Verify message.
- **In-app push notifications** when a client accepts — surfaces as the realtime "Recently Accepted" card in `CoachInvite.jsx` for v1. Push lands in Phase 4 when Expo Push Notifications wiring is added.
- **Coach-to-coach invite chains** (e.g., one coach inviting another to MyRX). Not a v1 use case.
- **Invite via shareable QR code** — same security model concern as a generic invite URL. The single-use token is the moat; deferred until we have a clear use case.

---

## Web / Mobile role rule (LOCKED — May 27 2026, NO EXCEPTIONS)

This is a top-level architectural decision. Every routing change, signup change, sign-in change, and new feature must honour it.

| Role | Web (desktop) | Mobile |
|---|---|---|
| **Athlete** (end-user / client) | ❌ Zero web surfaces. No signup, no signin, no app routes. Every athlete URL returns 404 / "page not found". | ✅ ONLY surface — entire app (signup + signin + training) |
| **Coach** | ✅ Coach portal at `/coach/*` ONLY. No athlete UI on web — not even to log their own training. | ✅ Athlete view ONLY (their own training data). No coach UI access on mobile. |
| **Admin** | ✅ Admin portal at `/admin/*` ONLY. Same as coach — no athlete UI on web. | ✅ Athlete view ONLY. No admin UI access on mobile. |

**Web entry points (ONLY):**
- `/` (Landing — marketing)
- `/for-coaches` — the ONLY page that has a "Sign in" button. Sign-in is for coaches + admins.
- `/coach/signup`, `/coach/welcome` — coach signup journey
- `/coach/*` — coach portal (after sign-in for is_coach=true profiles)
- `/admin/*` — admin portal (after sign-in for is_superuser=true profiles)
- `/coach/accept-invite?token=...` — invite-email landing. Shows the "Download the app" placeholder for non-coach/admin recipients with token preserved (so when athletes install the mobile app, the invite auto-links).
- Marketing pages: `/coach/pricing`, `/pricing`, `/about`, etc.
- Legal pages: `/terms`, `/privacy`, `/cookies`, `/coach-agreement`, etc.

**Web entry points that DO NOT EXIST (athlete-only — removed May 27 2026):**
- `/signup` — athletes sign up on mobile only
- `/dashboard`, `/strength`, `/cardio`, `/mobility`, `/bodyweight`, `/heart`, `/calories`, `/history`, `/profile`
- `/effort/strength/:exercise`, `/effort/cardio/:activity`, `/mobility/:movement`

**Post-sign-in routing (web `/auth?mode=signin`) — superseded June 12 2026 by the account_marker system (next section).** Sign-in, the root `/` route, and the 404 "Back home" button all resolve through ONE shared function: `roleHomePath(profile)` in `web/src/lib/roleRouting.js` (host-aware + marker-aware). Never hand-roll a role redirect — import that.

**Session policy:**
- When an athlete signs into web (which they should never do once apps ship — but the credentials still work because Supabase Auth doesn't know about roles), they land on the placeholder page. Their web session technically persists (Supabase cookie) but no athlete route consumes it. Manual navigation to any athlete URL → 404.
- All athlete sessions that existed at the time this rule was enacted (May 27 2026) were force-killed server-side via SQL deletion from `auth.sessions`. Future enforcement happens at the post-sign-in routing layer.

**Mobile behavior:**
- The mobile app has NO coach or admin UI. Period. A coach signing into mobile sees the athlete client app, scoped to THEIR OWN training data (using their own profile.id as user_id).
- The mobile signup journey is athlete-only. There's no path on mobile to become a coach or admin. Coach signup happens on `/coach/signup` (web) only.

**Why this rule exists:**
- The coach/admin portals are dense desktop dashboards that don't fit on a phone screen. Forcing them into mobile would result in poor UX.
- The athlete app is mobile-first by design (log a lift between sets, track cardio during a run, log food at the table). Forcing it onto a desktop would require building two parallel UIs for the same feature set — wasted maintenance.
- One surface per use-case = clean mental model + clean codebase. No "responsive both ways" complexity.

**Archive:** the 13 athlete page .jsx files (Dashboard, Strength, StrengthDetail, Cardio, CardioDetail, Mobility, MobilityDetail, Bodyweight, Heart, Calories, History, EditProfile, Signup) were moved out of `web/src/pages/` on May 27 2026 to `docs/_archive/web-athlete-pages/`. Available for reference but no longer in the active build. If a coach/admin page references one of them (the EditProfile usage in AdminProfile, for instance), that import was refactored or copied into a coach/admin equivalent at the same time.

---

## account_marker — the A / AC / C signup-role state machine (LOCKED — June 12 2026, T234)

`profiles.account_marker` is the **single durable signal** for which signup journey an account belongs to and where it routes. It exists because `signup_checkpoint` is ONE shared column used by BOTH the athlete journey (mobile) and the coach journey (web) — without the marker, coach-only checkpoint values (`plan`, `stripe`) leak into the athlete journey's resume logic (whose `CHECKPOINT_RANK` can't interpret them) and vice versa. The marker gates **which platform interprets the checkpoint**.

**Values (CHECK-constrained `A | AC | C | D`, default `A`), assigned by SIGNUP SOURCE after email validation:**

| Marker | Meaning | Set when |
|---|---|---|
| `A` | Athlete | Mobile signup (the column default). Also restored by the mobile "switch to athlete" reversal. |
| `C` | Coach | Web coach signup with a NEW email — stamped by the `init-profile-checkpoint` edge function the moment the profile row is created. Also the settled end-state: coach `welcome-end` stamps `C`. |
| `AC` | Athlete converting to coach (reversible) | An existing `A` account enters the web coach signup: in-flow at the email step (correct password — or, for unconfirmed-email accounts, the email OTP — is the conversion moment), or `detectFlow` when an already-signed-in `A` user loads `/signup`. |
| `D` | Staff / admin (PERMANENT) | Backfilled for `is_superuser` rows; auto-stamped + pinned by the `protect_admin_marker` BEFORE INSERT/UPDATE trigger on profiles — no writer can ever change a `D` marker, and any superuser row is forced to `D`. Signup always shows "staff account — sign in instead". |

**State machine: `A`, `C`, `D` are settled; `AC` is the only transient.** `A → AC` requires proven ownership (correct password, or email-OTP for unconfirmed accounts — stamped post-session via the `pendingMarkerAC` deferred effect). `AC → C` happens ONLY at coach signup completion (welcome-end, after payment). `AC/C → A` happens ONLY via the mobile coach-pending "Switch to an athlete account" button. `D` never transitions, in or out (DB-trigger-pinned). A user can bounce between journeys forever — nothing settles until one journey FINISHES, and athlete data is never altered by an unfinished conversion.

**Signed-out `/signup` NEVER resumes from sessionStorage (T237 — locked June 12 2026).** A signup resumes ONLY after the account is proven (login or OTP). Signed-out entry = always page 1, step 1; the X exit clears the per-tab journey state AND signs out. The email step is THE gate — full decision matrix per `check_account_status(p_email)` → `{exists, marker, email_confirmed, pending_deletion}`:

| Email status | Email step behaviour |
|---|---|
| Not found | Continue signup normally (marker `C` assigned at profile creation). |
| `pending_deletion` | "Scheduled for deletion — sign in to reactivate first." |
| Marker `D` | "Staff account — sign in instead." No switch offer, ever. |
| Marker `C`, confirmed | "You already have a coach account — sign in" (post-login: portal if finished, `/signup` resume if not). |
| Marker `C`, unconfirmed | Can't log in (password sign-in blocked pre-confirmation) → resend the 6-digit code + jump to the code step in place; verifying continues their signup. |
| Marker `A`/`AC`, confirmed | "You already have an athlete account — continue as coach?" → Yes → password verify → `A→AC` + prefill + skip validated steps. |
| Marker `A`/`AC`, unconfirmed | Same ask → Yes → resend code + jump to the code step (OTP = the validation); `A→AC` stamps the moment verification creates the session. |

**Routing (single source of truth: `roleHomePath(profile)` in `web/src/lib/roleRouting.js`):**
- ANY host: superuser → `/admin/overview` FIRST (the `/admin/*?` ProtectedLayout route is mounted outside the host conditional, so the admin portal works on coach.myrxfit.com too — an admin is an admin everywhere; they can still visit `/portal` manually to preview).
- Coach host: active-sub coach (`active|trialing|past_due`) → `/portal`; marker `C`/`AC` unfinished → `/signup` (resume); marker `A` → `/app` (Download the app — served on BOTH hosts).
- Main host: everyone else → `/app`.
- Consumed by `RoleRouter` (root `/`), `NotFoundPage` ("Back home"), and `Auth.jsx` post-sign-in. `RoleRouter` waits for the profile before redirecting (the `A` default during profile load must never mis-route a coach).

**Web coach signup email step (in-flow conversion, `EmailScreen` in `coach/Signup.jsx`):** Continue calls the `check_account_status(p_email)` RPC (SECURITY DEFINER, anon-executable, returns only `{exists, marker}` — no new enumeration surface beyond signUp's own `user_already_exists`). Not found → normal flow. Marker `C` → "you already have a coach account, sign in" prompt. Marker `A`/`AC` → in-flow confirm ("You already have an athlete account — continue as coach?") → in-flow password verify (`signInWithPassword`; wrong password = nothing changes in the DB) → on success: marker `A → AC` (guarded `.neq('account_marker','C')`), profile prefilled, journey jumps past validated steps (`name`/`phone`/`phone-otp` in completeness order, else straight to `plan`). Back-nav reaches the prefilled screens; `shouldSkip` skips the create-password + OTP steps whenever `email === verifiedEmail`. The old signUp-time `emailExistsPrompt` interstitial in `PasswordScreen` remains as a fail-open fallback (the RPC erroring must never block signup).

**Mobile (athlete app):** sign-up hydration intercepts marker `C`/`AC` accounts with no `onboarded_at` → routes to `app/(auth)/coach-pending.tsx` ("Your coach signup is waiting"): **Finish on the web** (opens coach.myrxfit.com, account untouched) or **Switch to an athlete account** (marker → `A`; coach-only checkpoints `plan`/`stripe` remapped to `photo` — the last step both journeys share — then straight into the athlete resume). Completed athletes (incl. `AC` converting + every settled coach) hit the dashboard fast-path first — coaches train as athletes on mobile, unchanged.

**Invariants when touching ANY signup/auth code:**
1. Never write coach-only checkpoint values to a profile without the marker being `C`/`AC`.
2. Never route by `is_coach` alone on web — always `roleHomePath`.
3. The marker may only move `A → AC` (password-verified), `AC → C` (welcome-end), `AC/C → A` (mobile switch), or be set at creation (`A` mobile default / `C` init-profile-checkpoint). No other transitions.

---

## Coach invite → invitee path (LOCKED — May 27 2026)

Architecture spec for the end-to-end coach invite flow. v1 is **email-only**: coach enters email → SendGrid sends a branded invite → invitee taps the accept-link → smart-routes them through install / signup / coach-attachment depending on their state. The "patient invite" pattern (email-match detection in the mobile app) makes the invite **discoverable by ANY path the invitee takes into the app**, not just clicking the original link.

### Why email-only (Branch.io comparison)

Considered Branch.io for deferred-deep-link install attribution ($0.01/click, ~free at our scale). Rejected in favor of email-based detection — not for cost, for **coverage**. Email-match handles cases Branch can't:

| Scenario | Branch | Email-match |
|---|---|---|
| Tap link → install → open | ✅ | ✅ |
| Tap link → don't install → sign up later via App Store | ❌ | ✅ |
| Friend mentions MyRX → install → sign up with same email coach invited | ❌ | ✅ |
| Tap link on phone A → install on phone B | ❌ | ✅ |
| Already have the app, never tapped the link | ❌ | ✅ |
| Coach manually pings: "hey check your email" | ❌ | ✅ |

Email is a **canonical identity anchor**. Branch is just device fingerprinting. The invite token persists in `coach_invites` for 14 days and the mobile app actively scans for matches — so the invite is "patient" and waits for the invitee to encounter the app via any path.

We can always add Branch LATER if we want install attribution for paid ad campaigns (different problem from invite-coach-attachment).

### The 6-state auth-branching matrix (mobile accept-invite handler)

When the mobile app's deep-link handler receives an invite token (via direct App Link tap OR via email-match detection), it branches on the **current sign-in state**:

| State | Behavior |
|---|---|
| **Not signed in** | "Coach Sarah invited you. Sign in or create an account to accept." → after auth completes, `profiles.coach_id = invite.coach_id` |
| **Signed in as free athlete** (no coach OR `is_self_coached=true`) | "Coach Sarah invited you to her roster. Accept?" → on confirm, `coach_id` set + `is_self_coached=false`. ALL TRAINING DATA PRESERVED (see "free athlete conversion" below). |
| **Signed in as another coach's client** | "You're currently on Coach Bob's roster. Accept this invite to swap to Coach Sarah?" → on confirm, `coach_id` flips. Old coach loses RLS access; new coach gains it. All data persists. |
| **Signed in as a different person than invitee** (email mismatch) | "This invite was sent to friend@example.com but you're signed in as athlete@example.com. Sign out and sign in as the invitee to accept." |
| **Signed in as the inviting coach themselves** | Reject: "Coaches can't accept athlete invites. Sign in as a client account." |
| **Signed in as admin** | Same rejection. |

### Free athlete → coached athlete (the conversion value prop)

This is the **most important conversion path in the product**. When a free MyRX user (existing account with training history, weight log, calorie history, mobility ROM, food entries) accepts an invite:

1. `UPDATE profiles SET coach_id = invite.coach_id, is_self_coached = false WHERE id = athlete.id`
2. **Every byte of training data persists.** RLS automatically grants the new coach access via `coach_id` foreign key — no migration, no re-onboarding.
3. The athlete's self-coached calorie plan stays in place. The coach can override it later, but nothing's lost in the moment.
4. Mobile app surfaces "Coach Sarah is now coaching you" + a chat-enabled toggle.

This is the recruitment moat: coaches can recruit existing MyRX free users with ZERO re-onboarding cost. Don't break this. Any future change that involves wiping or migrating user data on coach attachment is a regression.

### Patient invite detection (email-match)

The mobile app detects pending invites by email-match at TWO points:

**(1) Signup flow** — when a new user enters their email at signup, the app queries `coach_invites WHERE invitee_email = $email AND status='pending' AND expires_at > NOW()`. If match: show "Coach Sarah invited you to her roster" interstitial → confirm OR skip → continue normal signup → on completion, call `attach-invite-to-current-user(token)` to set `coach_id`.

**(2) App-launch** — on every app foreground (debounced to once/hour, persisted to AsyncStorage), if signed in, query the same table by `currentUser.email`. If match AND user is NOT already on that coach's roster: show a banner "Coach Sarah invited you to her roster. Tap to accept." → same `attach-invite-to-current-user` flow.

These two together mean an invite the coach sends today is detectable by ANY path the user takes into the app, for the 14-day TTL.

### "Have an invite code?" manual fallback

Edge case: invitee signed up with a different email than the one the coach has on file (e.g. invited at work@company.com but signed up with personal@gmail.com). Email-match doesn't fire.

Mitigation: Settings → "Have an invite code?" → user pastes the original accept-link OR the raw token → app calls `attach-invite-to-current-user(token)` → validates the token directly (not via email-match), runs the same auth-state branching matrix, attaches if valid.

### `attach-invite-to-current-user` edge function (Phase 6 build)

JWT-required edge function. Single entry point for ALL paths above (signup detection, app-launch banner, manual paste). Pseudocode:

```
1. verify JWT, get current user
2. fetch invite by token from coach_invites
3. validate: status='pending', not expired, AND (email-match OR token-paste with raw token)
4. validate current user state: not the coach themselves, not admin, not deactivated
5. atomically (single transaction):
   a. UPDATE profiles SET coach_id = invite.coach_id, is_self_coached = false WHERE id = currentUser.id
   b. UPDATE coach_invites SET status='accepted', accepted_at=NOW(), accepted_by=currentUser.id WHERE token=$token
6. best-effort: record activity event 'coach.invite_accepted'
7. return success + invite metadata
8. mobile app shows confirmation + refreshes profile → coach now visible in chat / suggestions etc.
```

Idempotency: if invite is already accepted by THIS user, return success silently (no-op). If accepted by a DIFFERENT user, return 409 with friendly error.

### Smart-link routing on `/coach/accept-invite` (Phase 9 launch checklist)

The web page at `myrxfit.com/coach/accept-invite?token=...` is the URL that's actually in the invite email. Currently a React page that just shows "Download the app." Needs to graduate to a server-side device router:

- **iOS Safari/Chrome UA** → 302 redirect to `apps.apple.com/...` with the token preserved in the URL (so iOS Universal Link matches once app is installed)
- **Android Chrome UA** → 302 redirect to `play.google.com/...` (or Android App Link triggers the installed app directly)
- **Desktop UA** → show current page with both store badges + QR code so they scan with their phone

This needs to be a Cloudflare Pages Function (not a React route) so the redirect happens BEFORE React loads. Add as a Phase 9 launch-checklist item.

### Out-of-scope (deferred)

- Branch.io / Adjust install attribution — revisit if paid ad campaigns demand it
- SMS dispatch — A2P 10DLC vetting + carrier fees aren't worth it for zero UX gain over email
- WhatsApp Business API channel — international expansion only
- Multi-coach simultaneous invites with priority selection UI — current behavior is "first to accept wins, others go stale"
