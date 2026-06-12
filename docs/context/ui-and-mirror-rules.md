# UI, Mirror & Cross-Platform Rules (Locked)

Purpose: the consolidated, MANDATORY gating rules for UI copy, cross-platform/portal mirroring, the Client Detail page, Title Case, and agent parallelization — extracted verbatim from CLAUDE.md so any turn can enforce them without re-reading the whole contract.

---

## No placeholder text — ANYWHERE (MANDATORY, LOCKED May 28 2026)

**Never use placeholder text in any input, search field, textarea, dropdown, picker, OTP cell, or composer — anywhere in the app or web.** This is a hard rule, no exceptions. Applies to web (admin portal, coach portal, marketing pages, legal docs, signup, sign-in), mobile (every screen and every sheet), and any future surface.

"Placeholder text" = the gray text inside an empty input that vanishes the moment the user starts typing (HTML `placeholder=` attribute, React Native `placeholder=` prop, custom faux-placeholder Views that disappear on focus, etc.).

**Why this is banned:**
- Placeholder text disappears the moment the user types, so they lose the prompt before they're done answering. Forces re-blanking the field to re-read it.
- It's the SAME color and weight as muted helper text in our design system, so users sometimes think a field is already filled and skip it.
- Accessibility-broken: most screen readers don't announce placeholders consistently. Users who rely on them can't tell what the field is for.
- The label-vs-placeholder confusion ("is that the label or the value?") is a known UX anti-pattern documented in the Nielsen Norman Group's research from 2014 onward.
- The user has explicitly forbidden it across the entire product.

**Replacement patterns (use these instead):**
- **Visible label above the input.** Plain text, normal foreground color, explicit field name. Stays visible while the user types. Required field markers (`*` or "Required") go in the label, not in placeholder.
- **Helper text below the input** for examples or format hints. e.g. for a "Reason" field, the examples line "e.g. Subpoena #12345, Client data request, Abuse investigation" goes BELOW the textarea as muted helper text — always visible, never disappears.
- **Icon inside the input** for the field affordance. e.g. magnifying glass for a search field is fine; the magnifying glass IS the hint that this is a search input. No "Search…" text needed alongside.
- **Empty-state copy inside the result area** for "type to see results"-style affordances. e.g. after the search input but before the results, render a muted "Type to see clients" line in the results area — it sits where the results will go, not inside the input itself.

---

## Cross-platform consistency rule (MANDATORY)

When the trigger is NOT an explicit `sync ...` phrase — i.e. the user reports a bug, or asks for a new update/feature/design change without naming a direction — the change MUST be cross-checked and applied across **every platform in the system where the surface exists**, not just the side currently being worked on.

| Trigger phrase / context | Scope |
|---|---|
| `sync web to mob: <area>` or `sync mob to web: <area>` | **Single direction.** Only the named area, only that direction. Standard "report-then-wait" still applies. |
| User reports a bug ("X is broken on Y") | **Every platform where that code/surface exists.** If it's broken on mobile Calories, the same logic on web Calories almost certainly has the bug too. Fix in both. If admin has the same surface (e.g. AdminCardioDetail mirrors CardioDetail), check + fix there too. |
| User requests a NEW design change (colors, spacing, animations, loaders, icons, fonts, layout) | **The entire system.** End-user web + mobile + admin portal + admin client-user views. Design is the same across all surfaces by definition; one change should never leave admin looking outdated relative to end-user. |
| User requests a NEW functional change (button behaviour, data flow, validation rules) | **Every platform that has that function.** Back buttons exist on web + admin + mobile detail screens → all three get updated. Food log drawer exists on web end-user + mobile end-user → both get updated. Admin movements page is web-only → only one place. |

### Concrete examples
- *"Replace ArrowLeft with ChevronLeft for back buttons"* — design change → all of web (end-user + admin), all of mobile.
- *"All standalone spinners should be lime"* — design change → all of web (end-user + admin), all of mobile.
- *"Habits → Frequently used foods"* — copy/UX change to a feature that exists on both → both web + mobile.
- *"Custom meal slots fail to save"* — bug → fix the DB constraint (one-place fix) AND verify the symptom is gone on both web + mobile.
- *"Don't show 'All set' celebration mid-signup"* — UX change → updated `confirm.tsx` on mobile AND `AuthConfirm.jsx` on web in the same turn.
- *"Auto-advance OTP step when user becomes authenticated via email link"* — flow change → added the `useEffect` watcher to BOTH the mobile `OTPScreen` and the web `Signup.jsx` `OTPScreen` in the same turn.
- *"Bump target panel `bg-blue-500/8` → `/15`"* — design change → updated mobile `withAlpha(palette.blue[500], 0.08) → 0.15` AND web Tailwind class in the same turn.
- *"Remove magic-link recovery bandaid"* — when reverting a workaround that was added on both surfaces, REMOVE it from both. Don't leave dead code on one side.

The rule is so important that it's been the cause of nearly every "but mobile doesn't match web" complaint in this project's history. **If you only edited one surface, you almost certainly missed something.** Pause and check the other before declaring the task done.

### What this means in practice
Before saying "done" on any non-sync change, the assistant MUST mentally walk through:
1. Does this surface exist on web end-user? → If yes, did I update it there?
2. Does this surface exist on mobile? → If yes, did I update it there?
3. Does the admin portal have an analogous surface? → If yes, did I update it there?
4. If any of the above is "the change doesn't apply there" — say so explicitly in the response so the user can confirm.

When in doubt, do the cross-check rather than skipping it. A redundant check costs nothing; missing one creates inconsistency that the user has to point out later.

---

## Admin ↔ Coach portal mirror rule (MANDATORY — LOCKED May 26, 2026)

**Anything we do to the admin portal in terms of design or functionality MUST be reflected to the coach portal, and vice versa. Same for the reverse direction.** The two portals are siblings — they share the same visual language, the same component library (`AccountSettings`, `MacroPlanEditor`, etc.), the same sidebar shape, and similar information hierarchies because their users (admin = platform owner, coach = paying B2B customer) need the same operational surfaces with role-appropriate scope.

When you change one side, you change the other in the **same turn**:

- Sidebar nav label rename on admin → rename on coach (same turn).
- New tab on coach portal → add same tab to admin portal (same turn).
- Theme tweak (colors, fonts, spacing, animations) on either → apply to both.
- Bug fix in shared code path that affects both → confirm both are fixed.
- Component update (`AccountSettings`, `MacroPlanEditor`, etc.) → both portals benefit automatically (they share the component); just verify both still render correctly.

**The only exception:** a feature that is **explicitly admin-only** by design (e.g. AdminMovements, AdminFoodLibrary, AdminMessages — features the coach has no business managing). These are admin-only because they govern platform-wide data, not coach-specific data. When you add a new admin-only feature, surface this in your response so the user can confirm it shouldn't mirror to coach.

**Planning rule:** in any plan or proposal that touches admin OR coach portal functionality, layout, or design, **you must include a question about whether this should mirror to the other side — UNLESS you can decide yourself with high confidence.** "Should this mirror to coach?" is a free question the user is happy to answer; not asking it produces inconsistency that the user has to point out later.

**Decision heuristic for when you can decide yourself without asking:**
- Pure visual / chrome change (color, spacing, copy rename) where both surfaces have the literal target string → mirror automatically.
- Same-purpose feature that already exists on both surfaces → mirror automatically.
- A new feature that only makes sense in one role (admin moderating user-generated content, coach inviting their own clients) → don't mirror; surface the decision.
- Ambiguous (e.g. "do we add a 'sign out everywhere' button — is that admin-specific or both?") → ASK before implementing.

**Concrete recent examples of the mirror rule in action:**
- May 26 2026: coach sidebar bottom user-card said "Account & settings" → renamed to "Account Settings" → SAME rename applied to admin sidebar in the same edit pass.
- May 26 2026: coach `CoachProfile.jsx` sub-tab labeled "My Profile" → renamed to "Settings" → SAME rename applied to admin `AdminProfile.jsx` sub-tab.
- May 26 2026: legal-docs surface added to shared `AccountSettings.jsx::AboutTab` (Refund Policy + Health Disclaimer always; Coach Agreement + DPA gated on `is_coach || is_superuser`). Single component, both surfaces benefit. The `is_superuser` clause is the explicit decision: superusers (admins) DO see the coach-specific docs because they oversee the coach platform.

**Examples of the exception (admin-only, don't mirror):**
- AdminMovements (movement library CRUD) — platform-wide data, coach has no business editing global movements.
- AdminFoodLibrary (food library CRUD) — same reasoning.
- AdminUserDetail / AdminUserPlan — admin viewing/editing a specific client's data. Coaches have their own client view at `/coach/client/:id` which serves the same UX role but scoped to their roster only.

The mirror rule is one of the most-broken rules in this codebase's history (analogous to the web↔mobile rule above). Most "but admin doesn't match coach" complaints come from one-sided edits. The cross-check is non-negotiable.

---

## Coach/admin DATA mirror = data + prescription, strip athlete-education (MANDATORY — LOCKED June 4 2026, originally ledger T086)

When a mobile athlete surface is mirrored into the **web coach/admin view**, that view shows **client DATA + the actionable prescription only** — it is NOT a copy of the athlete's coaching/teaching layer. The coach is a NEXT-STEP OVERSEER (see the coach-scope lock ~"Coach is a NEXT-STEP OVERSEER, NOT a workout programmer"), not a student of the algorithm, so athlete-facing explanatory copy has no value to a coach and just clutters the review surface.

**This rule INTENTIONALLY DIVERGES the web coach/admin mirror from mobile** — the prose below STAYS on the mobile athlete page and is STRIPPED from the web mirror, so the web↔mobile cross-check does NOT apply to these prose blocks. (The admin↔coach cross-check above still applies: admin and coach mirrors stay in sync with EACH OTHER — both stripped.)

**STRIP from the coach/admin mirror:**
- Motivational / encouragement lines (goal-progress pep talk, "Steady sips beat chugging it all at once", random progress messages).
- How/what-to-log instructions + feature help-text subtitles ("Pick an adaptation zone…", "Pick a training focus…", "Tap a day to log food", "Tap any pill to learn more").
- Eligibility / definition notes ("only no- and low-calorie drinks count").
- Science attributions / citation footers ("National Academies · Maughan 2016", "Epley · Brzycki · Lombardi", "Riegel · Daniels'…").
- Always-visible metric explainers ("BMR is the calories your body burns at rest…", recomp / timeline science paragraphs, best-case-vs-realistic notes).

**KEEP:** the data (charts, logs, best/PR/current numbers), the prescription numbers + the single cue line, section headers / badges / tiles, and OPT-IN "why this zone" info pills (collapsed by default — not clutter; flag to the user if they want those gone too). If an explainer can't be made opt-in/collapsed, strip it. Neutralize athlete-instruction empty states to factual ones ("Log your first…" → "No X logged yet") and drop celebratory emoji/decoration.

Applies to EVERY coach/admin mirror surface — existing and future (the `AdminUser*` tabs, the `AdminStrength*` / `AdminCardio*` detail pages, the calorie dashboard, and anything added later). Apply it AT BUILD TIME when you create a new mirror; don't ship the athlete prose and strip it later. Original sweep (June 4 2026): AdminUser{Sleep,Hydration,Heart} + all AdminStrength*/AdminCardio* detail pages.

---

## Client Detail page — locked patterns (admin + coach mirror, May 26 2026)

The client detail page (`AdminUserDetail.jsx` on the admin side, `CoachClientDetail.jsx` on the coach side) is the single most action-dense surface in either portal. Three patterns are locked as of May 26, 2026 — every future edit must honour them, and they apply to BOTH the admin and coach versions per the portal-mirror rule above.

**1. The right-side action column is exactly 3 rows, grouped by purpose.**

The buttons and pills on the right side of the client header sit in 3 stacked rows, with `gap-2` between rows and `gap-1` within each row. Each row has a specific job, and new buttons added to this page MUST land in the right row by purpose — not by "what looks best on the design":

- **Row 1 — Status pills.** Read-only summary chips that tell the user the client's current intake plan and goal status (Intake Plan, Goal). No actions, no toggles — just at-a-glance state.
- **Row 2 — Relationship toggles.** Things that change the working relationship between client and coach: Chat on/off, Self-managed vs Coach-managed. Toggling these changes how the client experiences the app, not their account standing.
- **Row 3 — Account actions.** Account-level operations: Active/Inactive toggle, Settings cog (⚙), Delete. These touch the underlying account state, not the relationship.

**Coach view hides three things.** Coaches do NOT see the Settings cog, the Delete button, or the Active/Inactive toggle. Account-level operations are admin-only — a coach can't deactivate or delete a client they were assigned. The Row 3 grouping still exists on the coach view; it just renders empty (or collapses if all three items are hidden).

When the user asks for a new button on this page, ask which row it belongs in BEFORE writing the JSX. Don't invent a fourth row, don't squeeze the new button into the wrong row because it fits the layout, and don't show admin-only actions to coaches.

**2. The stat chips mirror mobile's Dashboard exactly.**

The compact stat chip row underneath the client header shows the same 5 chips the user sees on their own mobile Dashboard, in the same order, with the same emoji prefixes and the same source data:

- 🏆 Strength PRs this month
- 🏆 Cardio PRs this month
- 🍴 Food log count — **distinct `food_logs.log_date` values in the last 14 days** (NOT a consecutive-day streak). Label reads "X day(s) logged in last 14 days". Only shown when the value is > 0. LOCKED May 26 2026 after a real-data audit caught the original consecutive-streak implementation hiding the chip for active users who had any recent 1-2 day gap (e.g. 10 logs across 14 days but no log yesterday → streak walker returned 0 → chip hidden). The compute is now a one-liner: `new Set(logDates).size` against the caller's already-windowed fetch. Function name preserved as `computeFoodLogStreak` (mobile) / `calcStreak` (web admin + coach) for code-grep continuity, but the SEMANTICS are window-count, not streak-walk.
- ❤️ Lowest BPM in the last 7 days
- ⚖️ Weekly weight diff

The PR counts come from the same parsing helpers the mobile Dashboard uses — `parseEffort1RM` for strength, `parseCardioBest` for cardio (direction-aware: pace is lower-is-better, speed/distance/duration are higher-is-better). Those helpers live in `mobile/app/(app)/dashboard.tsx` and are mirrored as `parse1RM` + `parseCardioBest` in `web/src/pages/admin/AdminUserDetail.jsx`. Grouping is by exercise/activity NAME (`label.split(' · ')[0]`), not by full label — so a user who PRs their Bench Press once and their Bench Press [Close Grip] once counts as ONE PR, not two. Variants of the same movement are the same movement for PR-counting purposes.

When mobile's Dashboard chip set changes — new chip added, chip removed, emoji swapped, source helper renamed, grouping rule altered — the admin and coach Client Detail pages MUST be updated in the same turn. This is the cross-platform mirror rule applied to chip parity: the user sees the same numbers about themselves on mobile that the admin/coach sees about them on web, and any drift breaks trust.

**3. Admin bypass for client health data — RLS policy on every per-user health table.**

The `efforts` and `bodyweight` tables have always had an `Admin full access` RLS policy keyed off `is_admin()`. May 26, 2026 added the same policy to `food_logs`, `hr_samples`, `step_samples`, and `wearable_workouts` — without it, the admin's AdminUserDetail queries returned empty data for any client whose health rows were guarded by the standard "users own their rows" policy, and chips silently dropped to zero with no error. The user has to look at the mobile app on the client's phone to realize the chip is wrong; that's the kind of slow-leak bug we can't afford. **June 6 2026 — `water_logs` (hydration) was missed by the May-26 migration and hit exactly this bug**: the coach/admin Hydration tab showed no data even though the client had logged water, because `water_logs` only had the owner `user_id = auth.uid()` policies. Fixed by `supabase/migrations/20260606_water_logs_admin_coach_rls.sql` (adds `Admin full access on water_logs` via `is_admin()` + `Coaches see roster water_logs`). ⚠ `sleep_sessions` reads work for the admin via an older `Superusers select all sleep sessions` SELECT policy, but it still LACKS a `Coaches see roster` policy — add that before the coach-portal Sleep reflection, or coaches will hit the same empty-data bug.

Going forward: any new Supabase table holding per-user health, training, or wearable data MUST get an `Admin full access` policy at table-creation time. Add it in the same migration that creates the table, not as a follow-up — follow-ups get forgotten and the chip-silently-drops bug recurs. Coaches retain their existing `Coaches see roster` SELECT-only policy (they read their assigned clients' data, they don't get admin-write access). The distinction is: admin = full CRUD across all clients via `is_admin()`; coach = SELECT-only across roster via the inline `user_id IN (SELECT id FROM profiles WHERE coach_id = auth.uid())` subquery (there is NO `is_coach_for()` helper — the policies inline that subquery; copy it from `food_logs` / `efforts` / `water_logs`).

**⚠ PREREQUISITE FOR THE COACH-PORTAL REFLECTION — applies to ALL pages (ledger T095).** Before building or reflecting ANY coach client-data view (`CoachClientDetail` + its tabs), audit EVERY per-user table that view reads and ensure it has BOTH the `Admin full access` (`is_admin()`) and `Coaches see roster` policies. Skipping this makes the coach view **silently show empty data** — the exact `water_logs` Hydration bug from June 6. Known status: `efforts` / `bodyweight` / `food_logs` / `hr_samples` / `step_samples` / `wearable_workouts` = both present; `water_logs` = fixed (June 6); `sleep_sessions` = admin works via an older `Superusers select all sleep sessions` SELECT policy but **still lacks the coach roster policy**; `calorie_plans` / `rom_records` / anything else the coach reads = not yet audited. This is its own ledger task (T095) precisely because it's easy to forget and recurs per-table.

---

## Title Case rule for titles, headers, labels, and tab names (MANDATORY — LOCKED May 26, 2026)

**Every visible title, page header, section header, tab label, button label, card title, modal title, dropdown option label, nav item, and chip label in the app uses Title Case.** Title Case = capitalize the first letter of every word EXCEPT short articles, conjunctions, and prepositions (a, an, the, and, but, or, of, in, on, at, to, by, for, with, from).

- ✅ "Account Settings", "My Profile", "Macro Plan", "Coach Platform", "How It Works", "Data Processing Agreement", "Refund Policy", "Health & Medical Disclaimer", "Terms of Service" (preposition "of" stays lowercase), "Acceptable Use Policy"
- ❌ "Account settings", "Macro plan", "How we compute your numbers", "Refund policy", "Cookie policy"

**Scope — what this rule covers:**

1. **Page titles / h1** — "Account Settings", "Profile", "Calories", "Strength", etc.
2. **Section headers (h2, h3)** — "Adaptation Zone", "Progression Plan", "Best Effort", "Coach Platform"
3. **Tab labels** — "Settings", "Macro Plan", "Subscription", "Account", "Preferences", "Security", "About"
4. **Navigation items** — "Dashboard", "My Clients", "Invite Client", "Suggested Adjustments"
5. **Button labels** — "Update Plan", "Save Changes", "Sign Out", "Sign In", "Add My First Client"
6. **Card / modal titles** — "Your Next Training Target", "Personal Best"
7. **Dropdown option labels** — "Lose Steady", "Build Muscle", "Maintain"
8. **Section-divider chips / pill labels** — "Strength Phase", "Endurance Zone", "Fly", "Free", "Back"
9. **Legal doc titles + cross-link labels** — "Terms of Service", "Privacy Policy", "How We Compute Your Numbers"
10. **Settings group labels** — "Notifications", "Appearance", "Body Stats", "Display Units"

**Scope — what this rule does NOT cover** (intentional sentence case is fine here):

- Body text, descriptions, helper text, tooltip text, error messages, coaching cue lines, info-panel paragraphs — these are PROSE, not titles.
- Form placeholder text — sentence case (e.g. `"Search for a movement..."` is fine).
- In-prose embedded references — e.g. inside a paragraph "see your settings page" stays sentence case; "Settings" as a standalone label is Title Case.
- Legal-doc body text (numbered headings inside legal docs like "1. Agreement to these Terms" follow legal-doc convention and are NOT app titles).

**Recent rename to apply this rule** (May 26 2026):

- "Account settings" → "Account Settings" (web coach + admin sidebar bottom + CoachProfile h1)
- "How we compute your numbers" → "How We Compute Your Numbers" (AccountSettings AboutTab + HowWeCompute legal-doc title)
- "How it works" section label → "How It Works"

**Auditing existing titles when you encounter them:** if you're editing a file and you notice a title/header/label that isn't Title Case, fix it in the same edit. Don't leave a known violation behind just because it wasn't the trigger for your edit.

**For future additions:** every time you add or rename a title-class string (per the scope list above), it MUST be Title Case. The user has been burned by lowercase titles slipping in — making the rule explicit makes it harder to miss.

---

## Always parallelize agents when independent work exists (MANDATORY — LOCKED May 26, 2026)

**For every single task: if independent sub-work exists, spawn the maximum reasonable number of sub-agents in parallel to finish faster.** The user is paying for compute and explicitly wants us to use it. Sequential work that could have been parallel is wasted wall-clock time the user is paying for twice (once to me, once in their own time waiting).

**When to fan out (default to YES):**

- **Audits / research** across multiple files, surfaces, or codebases. One agent per surface (web / mobile / admin / coach / edge functions / DB schema). 3-6 agents typical.
- **Implementation phases with independent components.** E.g. for the Phase 3 coach-invite flow: agent 1 builds the edge function, agent 2 builds the web invite-form, agent 3 builds the web accept-invite landing page, agent 4 builds the mobile equivalent — all in parallel.
- **Multi-perspective code review.** security-reviewer + code-reviewer + architecture-critic on the same change. 2-3 agents in parallel, different lenses.
- **Cross-platform mirror checks** (web↔mobile, admin↔coach). One agent per side, compare reports.
- **Investigating unknowns to ground design decisions.** When the user asks me a question and I don't have full context, spawn agents to research while I draft the question/answer. Three agents can read three corners of the codebase in the time it'd take me to read one.
- **Anything that says "audit + report" in the user's request** — fan out by area immediately.

**When NOT to fan out (rare):**

- Pure sequential dependencies (step N truly needs step N-1's output).
- Tiny single-file edits where agent spin-up exceeds the work itself.
- Decision-mode Q&A flows where the user is answering one question at a time — those are serial by nature.
- Edits to the SAME file by multiple agents — they'd step on each other's diffs.

**The mechanics:**

- Use the Agent tool with `subagent_type` selecting the right specialist (general-purpose for research/search, code-reviewer for review, security-reviewer for vuln scan, planner for planning, etc.).
- Spawn multiple agents in a **single message with parallel tool calls** — they execute concurrently, not sequentially.
