# MyRX — Project Context

## Repository structure

Single repo at `C:\Users\motaz\OneDrive\Desktop\MyRX`. Everything lives under it.

```
MyRX/
├── web/         ← Web app (Vite + React + Wouter + Supabase) — Cloudflare Pages target
│   ├── src/                       source code (pages, components, contexts, lib)
│   ├── public/                    static assets served verbatim
│   ├── functions/                 Cloudflare Pages Functions (e.g. /api/off-search)
│   ├── package.json               web-specific deps + scripts
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   ├── index.html                 Vite HTML entry
│   └── dist/                      build output (gitignored)
│
├── mobile/      ← Mobile app (Expo + React Native + Reanimated 4)
│   ├── app/                       expo-router routes
│   ├── src/                       components, contexts, lib, theme
│   ├── assets/                    fonts, images, splash
│   ├── package.json               mobile-specific deps
│   ├── app.json, babel.config.js, metro.config.js, tailwind.config.cjs
│   └── android/                   native folder (gitignored, regen via `npx expo prebuild`)
│
├── workers/     ← Cloudflare Workers (independent deploys)
│   └── food-search/               D1-backed USDA / OpenNutrition food search worker
│
├── supabase/    ← Supabase schema + edge functions + applied migrations
│   ├── migrations/                tracked SQL migrations
│   ├── migrations-archive/        loose ad-hoc SQL files kept for reference
│   └── functions/                 Supabase edge functions (Twilio Verify, etc.)
│
├── branding/    ← Logo + wordmark masters (Photoshop / SVG sources)
│   └── Logo/
│
├── docs/        ← Design docs, blueprints, user stories, dataset licenses
│   ├── BLUEPRINT_behavioral_features.md
│   ├── User Stories.txt
│   ├── Free Weights.docx, Distance.docx, Bodyweight_Reps_Exercises_Grouped.docx
│   └── datasets/opennutrition/    OpenNutrition seed licenses (TSV was one-shot, discarded)
│
├── scripts/     ← Deploy helpers + data-import tooling
│   ├── usda_import/               USDA FoodData Central importer (one-shot)
│   ├── seed_movements.mjs, import-opennutrition.mjs
│   └── data-tools/                Python scripts for spreadsheet wrangling
│
├── CLAUDE.md, README.md, .gitignore, .env.local (gitignored)
└── .git, .claude, .github
```

**Path conventions used throughout this doc:**
- `src/pages/Strength.jsx` (no folder prefix) → **web** file, lives at `web/src/pages/Strength.jsx`.
- `app/(app)/strength.tsx`, `src/components/PhantomWheel.tsx` (no folder prefix, but `app/` or `.tsx` extension hints React Native) → **mobile** file, lives at `mobile/...`.
- Anything with an explicit prefix (`web/`, `mobile/`, `workers/`, `supabase/`) means exactly that absolute location from the repo root.

**Deploy is direct-upload, not Git-integrated.** Cloudflare Pages does NOT watch GitHub. `git push` is for source-of-truth only; deploys happen exclusively via `wrangler pages deploy web/dist` (see Deployment section).

---

## Working Relationship
- **You are the programmer. The user is the product manager.**
- At the start of every new session, read this file top to bottom. The user will tell you what they want to work on — don't prompt for it.
- **TASK LEDGER (MANDATORY — read every session).** `docs/TASK_PIPELINE.xlsx` is the cross-session record of EVERY task (done + pending), each with a stable numeric ID (T001, T002, …) and a "where we left off / what's next" note. Read it at session start so you know the open threads and can resume any of them when the user says "pick up T0xx". **Keep it current:** whenever a task starts, advances, finishes, or is deferred/parked/reverted, update it — edit the `TASKS` list in `scripts/build_task_pipeline_xlsx.py`, re-run `python scripts/build_task_pipeline_xlsx.py`, and commit both the script and the regenerated `.xlsx`. New tasks get the next free T### id; never reuse or renumber an id. The `.xlsx` is generated — never hand-edit it.
- **CAPTURE-FIRST (MANDATORY, locked 2026-06-03).** Every single time the user raises a point that needs fixing or discussion — ANY size: a bug, a design tweak, a decision to make, an idea, a "look into X" — the **FIRST** action, BEFORE writing any reply, is to log it in `docs/TASK_PIPELINE.xlsx` as a new **Pending** task. Append the row to the `TASKS` list in `scripts/build_task_pipeline_xlsx.py`, re-run `python scripts/build_task_pipeline_xlsx.py` so the sheet is immediately current, THEN answer — and state the assigned **T###** in your reply. The task stays **Pending** until the work is actually done/decided, then flip it to Done (or Deferred/Parked/Reverted). Commit the regenerated pipeline at the end of any turn that added or changed tasks so it survives across sessions. NEVER skip the capture step because an item seems "too small" — small items are exactly what gets lost.
- **FLAGGED / DEFERRED WORK GETS ITS OWN T### (MANDATORY, locked 2026-06-03).** If, while doing one task, you discover or flag a follow-up — a redeploy still needed, a cleanup, a "this should also happen later", a side-effect to revisit — it gets its **OWN new task id**. NEVER bury a live follow-up in another task's notes, and ESPECIALLY never inside a task you are marking Done/Closed — a note in a closed task is invisible and will be missed. The rule of thumb: if there is still an action outstanding, there must be an open (Pending/Deferred) row whose title is that action. Mentioning it only in prose, or only in a finished task's context field, is a miss.
- Begin the task immediately. Do NOT ask about the next task while one is in progress.
- **Web changes deploy via `wrangler`, never via `git push`.** Read the Deployment section below before running ANY git push. There is no GitHub→Cloudflare auto-deploy on this project — pushing produces zero deployment. This trap has cost real time; do not fall into it.
- **MIRROR EVERY CHANGE ACROSS WEB AND MOBILE.** Bug fixes, design tweaks, UX changes, copy edits, font/color/spacing adjustments, new features, removed bandaids — anything that exists on both surfaces gets edited on both surfaces in the SAME turn. The full rule with examples lives in **Cross-platform consistency rule (MANDATORY)** further down — read that section before making your first non-trivial edit. Most "but mobile doesn't match web" complaints come from one-sided edits; the cross-check is non-negotiable.
- **NUMBERED PLANS (MANDATORY).** Whenever the user asks for a plan, or whenever the assistant proposes any multi-item set of changes (revert plans, feature work, refactors, batched fixes, decisions to confirm, etc.) — every item MUST be presented as a numbered list (1, 2, 3...). The user uses these numbers to approve or reject items individually ("go on 1, 3, 5; skip 2, 4"). Never use bullets, sub-headings, or prose paragraphs for items that need an approve/reject decision. Sub-items get nested numbering (1a, 1b, 1c). Open questions are numbered too. This makes the user's review fast and surgical instead of forcing them to re-read full paragraphs.
- **PLAIN-ENGLISH PLANS (MANDATORY).** When the user asks for a plan or a breakdown, write it in plain language they can read without being a coder. No code snippets, no file paths in the middle of sentences, no formulas, no library names dropped without explanation, no acronyms without a parenthetical. Describe the visible behaviour or end-user outcome, then explain the change in product-manager terms. Save the code/formula/file-path talk for the actual implementation turn. This is a separate rule from the numbered-plan rule — both apply at once.
- **ONE QUESTION AT A TIME ON COMPLEX REBUILDS (MANDATORY).** For larger design rebuilds where many elements need discussion (multiple visual tweaks, multiple behavioural changes, multiple copy edits, etc.) — when the user says "break it down" / "walk me through it" / asks for the breakdown of a complex change — present ONE numbered question at a time, not the whole list. For each question include: (a) the issue or decision point in plain language, (b) one or two proposals, (c) the assistant's recommendation and why. WAIT for the user's answer before moving to the next question. Do not batch four questions at once and expect the user to answer all of them in one message. The whole-plan-up-front presentation is fine when the user explicitly asks for "the plan" or "all of it"; the one-at-a-time mode is for the explicit break-it-down requests. **The trigger phrase "break it down" ALWAYS refers to the active plan / proposal on the table, even if the same message mentions reading or doing something else first (e.g. "read X, break it down" still means "after reading X, break down the active plan one item at a time" — NOT "summarise the contents of X"). When in doubt about what "it" refers to, default to the active plan; if there's no active plan, ask the user "break down what specifically?" rather than guessing.**
- **CLAUDE.md MISMATCH AUTO-SYNC (MANDATORY).** This file goes stale fast — the user has been burned by the assistant operating on outdated information about what's in the codebase. Whenever the assistant scans a file, runs a check, or reads a value in the system AND finds that the actual state disagrees with what CLAUDE.md currently states (a value's wrong, a default's changed, a path moved, a behaviour's been edited since the doc was written, etc.) — the assistant MUST update CLAUDE.md immediately to reflect the actual state. Timing: BEFORE making any further change if the assistant is about to act on the mismatched info, or AFTER landing the change if the scan was triggered by the change itself. Never leave CLAUDE.md describing a state that doesn't match the codebase. If multiple mismatches are found in one turn, surface them all in the same edit. The doc is the contract between assistant turns — it has to stay accurate or the next turn starts wrong.
- **WEB-SEARCH-FIRST WHEN STUCK ON A PLATFORM BUG (MANDATORY, locked May 18 2026).** When debugging an Android / iOS / native-platform bug whose symptom is STABLE and REPRODUCIBLE (e.g. "permission Activity launches and auto-dismisses within 20 ms", "build fails at xyz Gradle task", "Kotlin compile errors on a stable RN library"), and the codebase-only diagnostic time exceeds **15 minutes** with no convincing root-cause hypothesis — STOP local diagnostics and run a WebSearch first. Stable platform symptoms are almost always documented somewhere on developer.android.com, developer.apple.com, GitHub issue trackers, or Stack Overflow. The May 18 2026 Health Connect debugging session burned ~30 minutes on local-only diagnostics (checking permission state, querying HC's data store, inspecting MainActivity) before finally web-searching and finding the missing `<activity-alias>` requirement in 2 minutes via the official Android docs. Codebase-only diagnostics ARE useful for asymmetric bugs that depend on YOUR specific app state, but stable platform-API symptoms aren't that — they're the same on every app that hits them, so the answer is already on the public internet. Heuristic: if the symptom would reproduce identically on a brand-new throwaway app, web-search it.

### System messages — brand voice rules (LOCKED — May 29 2026)

Every user-facing string the system emits — email subjects, email bodies, SMS, in-app banners, modal copy, toast text, error responses, RPC `RAISE EXCEPTION` strings, humanizer fallbacks — must follow these seven rules. Same rules across mobile + web + edge functions + RPCs. These RULES apply to STRINGS the SYSTEM produces; the existing "Voice and Coaching Philosophy" 3-pillar rule (acknowledge → mechanism → next step) governs COACH-PRESCRIPTION copy (warnings, info pills, plan-evaluation outcomes). Where the two overlap (an error message naming a next step, etc.) both apply at once.

1. **Channel coherence.** Every message reads cleanly on its own surface alone. Email says "tap the button" because there IS a button. In-app banner says "tap Accept" because that's the affordance. SMS says "open the MyRX app" because no inline UI exists. Never reference a button / link / action that doesn't exist where the message renders. **Never reuse email copy verbatim inside the app** (the recurring "tap the link below to install the app" leak — that line makes sense in an email; it's nonsense inside the running app).
2. **No redundancy across blocks.** Subject ≠ H1 ≠ body ≠ personal-message block ≠ secondary block. If the subject is "X invited you to MyRX," the body advances to the next thing rather than restating it. Same principle on every multi-block surface (banner title + body, modal header + subline, page hero + subhero).
3. **The coach leads, doesn't pay.** When subscription coverage comes up, the coach is the leader inviting the athlete to train, not the patron. **Banned phrases:** "your coach's subscription," "fully covered by your coach," "no payment because your coach…," "free under your subscription," "complimentary account," "on your coach." The standalone form **is** fine: `Your MyRX subscription is covered by your coach. No payment is required from you.` Frame the coach as the leader; the billing piece is invisible mechanism happening in the background.
4. **No marketing or performative phrasing.** Banned: "Welcome to your journey," "Ready to transform?", "Let's crush goals," "Start your journey," "Welcome back, Coach," "Welcome to MyRX!", urgency theater, exclamation points on platform copy, "your roster will populate," "Ready to Onboard." Plain factual coach voice always.
5. **No security platitudes / unnamed mechanism gestures.** Banned: "for your security," "we take privacy seriously," "per legal requirement." When restricting or explaining a platform mechanism, name the actual mechanism. Example replacement: "Billing records are retained per legal requirement." → "Billing records stay on file — we're required to keep those for tax + dispute resolution."
6. **Direct address — the athlete is "you."** On athlete-facing surfaces, always second-person. On coach-facing surfaces (when the coach reads ABOUT an athlete on their roster), "the client" is fine. On admin-facing surfaces (admin reading ABOUT a client/coach), "the user" / "the athlete" / "this account" is fine. Never lock these wires: the athlete reading their own banner should never see themselves called "the client."
7. **No filler hedges.** Banned: "consider," "you might want to," "down the line," "feel free to," "please" (when it precedes an imperative — `"Please try again"` → `"Try again."`), "double-check" → "check," "we couldn't" → "Couldn't," `"in the future"`, `"if you'd like"`. Replace with concrete next-step language.

**Plus three formatting conventions that come out of the rules:**

- **Lowercase coach / admin / client** in body copy. Banned: "Coach accounts can't be Clients" → "Coach accounts can't be clients." (Section headers and UI section labels can stay capitalised when they're acting as UI chrome — `YOUR COACH`, `Pending Invites` — but body sentences don't get to capitalise "Coach" as if it were a brand.)
- **Personal message field on coach invite is removed (decision 2b, May 29 2026).** The coach invite ships with a single locked `PRESET_MESSAGE` constant — no per-coach customization. The web `/coach/invite` form shows just the email field + Send Invite button — no preview, no override, the edge function still accepts a `coach_message` body param for back-compat but the web side always passes the preset. Per-coach customization is OFF by design — the audit found that any coach-written variation drifted out of voice within a few sentences, so the field came out.
- **Brand appears in every email subject, but not always first (LOCKED, May 29 2026).** Surveyed pattern across modern apps (Notion, Linear, Vercel, Slack, Figma, GitHub, Stripe) — the dominant convention is **brand mid-sentence + verb-first**, not brand-first. Lead with the action; the brand sits inside the action. Examples currently shipped: `Confirm your MyRX email`, `Sign in to MyRX`, `Reset your MyRX password`, `Confirm your new MyRX email`, `You've been invited to MyRX`. The From field already carries the brand (`MyRX <team@myrxfit.com>`) so the subject doesn't have to. **Coach invite is an industry-norm exception**: `{coachName} invited you to MyRX` — the inviter's name leads, because the personal hook of "someone you know is inviting you" measurably outperforms brand-first in invite open rates (Slack, Notion, Figma, Linear, Asana all do the same). Banned subject patterns: `Welcome to MyRX — X`, `MyRX — X`, `[MyRX] X`, brand-only subjects with no verb.

**When you write ANY new user-facing string** (new banner, new error, new email template, new RPC exception), run it through all 7 rules + the three formatting conventions before shipping. New strings that obviously violate any rule should be fixed before commit, not after a user complaint.

### Training vocabulary (locked terms — use these names in all UI copy and discussion)

The training-system feature uses three short terms agreed with the user. Always use these exact terms going forward — don't invent synonyms in code, copy, or discussion.

- **adp zone** (adaptation zone) — which adaptation a tile/exercise targets. Three values: **strength** (1-5 reps), **hypertrophy** (6-12 reps), **endurance** (13+ reps). Tile rep count maps to an adp zone via these boundaries.
- **rep range** (repetition range) — the specific rep count prescribed for a working set. For tile interactions, the rep range equals the tile's K value (e.g., tapping 6RM → rep range = 6).
- **eff curve** (effort curve) — the rep-max projection formula used by the system. Currently Epley/Brzycki/Lombardi averaged. Translates 1RM → projected weight at any rep count, OR a logged (weight × reps) → projected 1RM. The eff curve is what produces tile values on the rep-max grid.

These three terms work together: the **eff curve** computes weights for any **rep range**, and the **rep range** determines which **adp zone** the prescription falls in. UI copy can use friendlier phrasing where it improves clarity (e.g., "Build Strength" as a header is fine), but internal naming, comments, and analysis discussion must use the three locked terms.

### Animation patterns — locked reference

Every animated element across the app draws from a SHORT, SHARED set of patterns. They're listed here once with their exact timing constants, gesture rules, and source-code locations so future page builds can just say "use Pattern X" without re-explaining the motion. **If you find yourself inventing a NEW animation pattern, stop and check this list first — almost every UI motion the app needs already has a canonical pattern documented here.** When in doubt, copy the constants verbatim; do not retune by feel.

The patterns are numbered. Cross-platform-consistency rule still applies — when an animation lands on one surface, mirror it on the other (until the web freeze for legacy surfaces, anyway).

---

**Pattern 1 — Staggered entrance cascade (`AnimateRise`)**

What it does: cards on a detail page slide in sequentially from the bottom, each with a small delay so the user perceives the page assembling in front of them.

- Component: `mobile/src/components/AnimateRise.tsx` (web equivalent: `.animate-rise` CSS class).
- Duration: **500 ms**. Easing: `cubic-bezier(0.16, 1, 0.3, 1)`. Transform: opacity 0 → 1 + translateY 8 → 0.
- Delays (LOCKED):
  - **delay 0** — first card (typically the main coaching surface — projections card, BW tier pager, swim plan).
  - **delay 250** — chart card.
  - **delay 500** — log list / efforts history.
- Total entrance: ~1000 ms from skeleton-clear to log fully visible.
- Anti-pattern: relying on the default `delay = 0` and stacking three `AnimateRise` siblings with no delays — they all fire at once and the cascade disappears. Always pass `delay={0|250|500}` explicitly. Tools like the strength detail page's `EffortsHistorySection` accept a `delay` prop that forwards to its inner `AnimateRise`; pass `delay={500}` whenever you call it.
- Async-data-gated content rule: if a card depends on a Supabase fetch that happens AFTER `efforts` resolves (e.g., bodyweight gate for ratio carries / assisted machines), gate ALL cascade-eligible content on the SAME async-ready flag (`bwLoaded`). Otherwise the chart and log mount on frame 0 while the main card waits for the BW fetch, and the user sees chart-then-main instead of main-then-chart.
- Where it's used: every detail page top-to-bottom (Weighted Standard, Bodyweight Consolidated, Assisted Machine, Carry, Isometric, RepsOnly, PaceDetail, SwimmingConsolidatedDetail, DurationDetail). Mandatory on any new detail page.

---

**Pattern 2 — Slot-machine numeric ticker (`TickerNumber`)**

What it does: when a numeric value changes, each digit slot rolls vertically slot-machine-style to the new digit. Non-digit characters (`×`, `m`, `km/h`, `:`, `/`, `%`, `lb`, etc.) render as static `Text` inside the same row, so mixed strings like `"5 × 600 m"` animate just the digits.

- Component: `mobile/src/components/TickerNumber.tsx`.
- First-mount guarantee: every digit always animates on first paint (the component forces `from = 9` when `targetIdx === 0` for forward columns, `from = 0` otherwise — without this, a digit whose target happened to be 0 would skip the animation and the user would see a static digit while its siblings rolled).
- **Where it IS used (mandatory on these surfaces):**
  - Page header "Best — N" subtitle on every detail page (with the right unit suffix). Examples: `Best Est. 1RM — 370 lb`, `Best — 1:38/100m`, `Best speed — 12.5 km/h`, `Best session — 25:00`, `Personal best — 1m 30s`.
  - Hero card big numbers (the main target value — projected weight, target pace, leaving interval, max-attempt count, isometric duration).
  - Hero card cue-line embedded numbers — the small numbers INSIDE the cue sentence (e.g., strength's `"Push 6 reps at 135 lb"` tickers both `6` and `135`). Strength uses this; cardio's cue stays plain prose.
- **Where it is NOT used (and must not be added):**
  - Tiles (rep-max grid, BW max-attempt grid, iso milestone grid, cardio plan-queue upcoming-step tiles). Tiles are status indicators that change wholesale when the user taps — digit rolling adds noise.
  - Plate chips (per-side plate breakdown like `25 / 10 / 2.5` on barbell). Plates are categorical labels, not progressive numeric values.
  - Chart axis labels and tooltip values — the chart's own dot animations carry the visual progression.
  - Log-list rows (recent efforts on detail page; "Your activities" list on index page). These are read-only history.
  - Cue lines, descriptors, helper text, captions, attribution lines.
  - The `—` placeholder shown when a metric has no data yet.
- Sub-text + value layout pattern: wrap in `<View style={s.subRow}>` and place the label `Text`, the `TickerNumber`, and any trailing unit `Text` as siblings. Do NOT nest `<Text>` inside `<Text>` for these — the inner Text can't be replaced by a TickerNumber View since View can't be a child of Text in React Native.

---

**Pattern 3 — Pulsing chevron (`BwAnimatedChevron`, `AmberAnimatedChevron`)**

What it does: pairs of chevrons flank a swipeable pill, pulsing in/out to telegraph that the user can swipe to navigate. Two chevrons per side (inner + outer), with the inner leading and outer following.

- Components: `BwAnimatedChevron` in `mobile/app/(app)/effort/strength/[exercise].tsx` (blue theme — strength); `AmberAnimatedChevron` in `mobile/app/(app)/effort/cardio/[activity].tsx` (amber theme — cardio). Both have the same timing; they exist as two copies because strength is blue and cardio is amber.
- **Cycle length: 1.5 seconds**, looping forever.
- Per-chevron timeline:
  - 0.00–0.25 s: fade in (opacity 0 → 1)
  - 0.25–1.00 s: visible (steady)
  - 1.00–1.25 s: fade out (opacity 1 → 0)
  - 1.25–1.50 s: invisible gap, then loop
- **Outer chevron delay: 250 ms** behind the inner. Achieved on RN via `withDelay(250, withRepeat(withSequence(...)))`. On web via `animation-delay: 0.25s` plus `animation-fill-mode: both` (so the outer stays at opacity 0 during its delay — without that, it would show at default opacity 1 until the animation kicked in).
- Both sides (left chevrons + right chevrons) run in the SAME phase — left-inner and right-inner pulse together, left-outer and right-outer pulse together. This creates a "marching outward" or "marching inward" rhythm depending on direction.
- Fade in/out durations are exactly **0.25 s** each.
- Where it's used: BW tier pill row, Weighted Standard adp-zone pill row, Sled Work PUSH/PULL pill row, Swimming stroke pill row, and any future variant-selector pill row.

---

**Pattern 4 — Consolidated-page swipe ("whole page slides")**

This is the BIG one — the canonical pattern for switching between variants of a consolidated detail page (BW assist tiers, Weighted Standard adp zones, Sled Work PUSH/PULL, Swimming strokes, and any future N-variant page). Designed to feel as smooth as iOS native page-curl transitions while staying RN-friendly.

- Reference implementation: `BodyweightConsolidatedBlock` in `mobile/app/(app)/effort/strength/[exercise].tsx`. The two cardio/strength wrappers (`SledWorkConsolidatedDetail`, `SwimmingConsolidatedDetail`) mirror it byte-for-byte modulo the colour palette and the variant list.

**Structure (top-to-bottom):**

1. Page-level header (h1 + best subtitle + maybe equipment badge) — sits OUTSIDE the paged ScrollView. Stays positionally static during swipes. The subtitle's `TickerNumber` may re-render on variant change (digit roll only — no layout animation).
2. **Pill row** — single pill in the center showing the active variant's short label (e.g., `PUSH`, `FREE`, `STRENGTH`, `BAND`). Flanked by pulsing chevrons (Pattern 3) on both sides. Wrapped in `<GestureDetector gesture={pillSwipeGesture}>`. Chevrons only render on the side where a navigation target exists (no wrap at the carousel ends).
3. **Paged ScrollView** — `horizontal pagingEnabled` with `showsHorizontalScrollIndicator={false}` and `decelerationRate="fast"`. One slot per variant. Each slot is a fixed `width: slotWidth` and contains the body content for that variant (rep-max projections + hero + chart + log list, or whatever the page renders).

**Variant order in the carousel (LOCKED):**

- When variants have a clear HARDNESS / INTENSITY / PROGRESSION ranking, the **hardest variant goes LEFTMOST** (slot 0). Easier variants follow to the right. Examples currently in the app:
  - BW assist tiers: `FULL RX → BAND → KNEE → BAND+KNEE` (no-assist hardest, most-assist easiest)
  - Weighted-standard adp zones: `STRENGTH → HYPERTROPHY → ENDURANCE` (heaviest load hardest, lightest easiest)
  - Swim strokes: `FLY → BREAST → BACK → FREE` (butterfly technically + physiologically hardest; freestyle easiest)
- When variants are PARALLEL (different muscle groups, equipment configs, or stylistic choices with no clean hardness ordering), the order is arbitrary — pick what's intuitive. Example: Sled Work `PUSH | PULL` (push is leg-dominant, pull is posterior-chain dominant — different stimuli, neither "harder").

**Default landing slot on first mount (LOCKED — simple universal rule):**

The page ALWAYS opens on **slot 0** (the leftmost pill), regardless of which variant the user logged most recently. Don't try to be clever with "most-recent" or "highest logged" heuristics — they produce surprising behaviour ("why did my Sled Work page open on PULL?") and inconsistency across surfaces.

Concretely:
- **BW assist tiers** → slot 0 = highest logged tier (because `loggedTiers` array only contains logged tiers; leftmost = leftmost-of-logged = highest logged). If the user has only logged Band+Knee, the carousel only contains Band+Knee and slot 0 = Band+Knee.
- **Swimming strokes** → slot 0 = Butterfly. All 4 stroke slots always render (for discoverability — empty-state cards on the strokes the user hasn't logged yet double as "you can train butterfly too" prompts). Trade-off accepted: a user with only freestyle logged opens the page on a butterfly empty-state and has to swipe right to find their data. Predictable over personalised.
- **Sled Work variants** → slot 0 = Push. Same reasoning — both PUSH and PULL slots always render; opening on the right side just because the user's last session was PULL is jarring.

**Pill label style:**

- BW assist tiers and Weighted-standard adp zones use SHORT all-caps labels (`FULL RX`, `BAND+KNEE`, `STRENGTH`) — the labels are already short concepts.
- **Swim strokes use FULL names** (`Freestyle`, `Backstroke`, `Breaststroke`, `Butterfly`) on the carousel pill. The short forms (`FREE`, `BACK`, `BREAST`, `FLY`) are reserved for the small stroke badge on the consolidated "Swimming" row in the cardio index — full names wouldn't fit there. The pill has room for the full name; readability wins.
- Sled Work uses `PUSH` / `PULL` everywhere (short by nature).
- When in doubt, prefer FULL names on pills. Short forms are an optimisation for cramped layouts (index badges, tile labels), not the default.

**Constants (LOCKED — copy verbatim, do not retune):**

```
SWIPE_THRESHOLD_PX     = 20         // min translation to commit swipe
SLIDE_OFFSCREEN_PX     = 220        // pill slide distance on commit
SLIDE_DURATION_MS      = 250        // pill slide off / back duration
PAN_ACTIVE_OFFSET_X    = [-15, 15]  // pan activates after 15 px horizontal
PAN_FAIL_OFFSET_Y      = [-25, 25]  // vertical drag past 25 px cancels
CHEVRON_FADE_OUT_MS    = 120        // chevrons fade on pan start
CHEVRON_FADE_IN_MS     = 200        // chevrons fade back after slide-in
BOUNCE_BACK_DURATION_MS = 200        // pill spring-back when below threshold
PAGE_PADDING_HORIZONTAL = 16        // outer padding of page; used in slotWidth
```

**Gesture sequence (committed swipe):**

1. **onStart** — `chevronOpacityOverride.value = withTiming(0, { duration: 120 })`. Chevrons fade out so they don't visually compete with the pill slide.
2. **onUpdate** — `pillTranslateX.value = event.translationX`. Pill physically follows the finger horizontally.
3. **onEnd (past threshold, direction allowed)**:
   a. `pillTranslateX.value = withTiming(slideOff, { duration: 250 })` where `slideOff = ±220` based on direction. Pill slides off-screen.
   b. **Callback fires** when slide-off completes:
      - `runOnJS(navigateVariant)(direction)` — updates state AND calls `scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })`. Body ScrollView slides to the new slot at the same time the pill is off-screen.
      - `pillTranslateX.value = -slideOff` — pill teleports to the opposite off-screen position (no animation, just an instant assignment).
      - `pillTranslateX.value = withTiming(0, { duration: 250 })` — pill slides back to center showing the new variant's label.
   c. **When the slide-in completes** — `chevronOpacityOverride.value = withTiming(1, { duration: 200 })`. Chevrons fade back in, pulse loop resumes (Pattern 3).
4. **onEnd (cancelled — below threshold OR direction blocked)**:
   - `pillTranslateX.value = withTiming(0, { duration: 200 })` — pill springs back to center.
   - `chevronOpacityOverride.value = withTiming(1, { duration: 200 })` — chevrons re-appear immediately.

**slotWidth handling (CRITICAL — first-paint smoothness):**

- **Pre-seed** the initial `slotWidth` state. The pre-seeded value MUST match what `onLayout` will eventually measure for the ScrollView wrapper. The right formula depends on whether the wrapper uses the negative-margin "edge-to-edge" trick:
  - **No negative-margin** (wrapper sits inside the normal page padding) → pre-seed `windowWidth − PAGE_PADDING_HORIZONTAL * 2` (= `windowWidth − 32`). Example: `BodyweightConsolidatedBlock`.
  - **With negative-margin** (wrapper bleeds edge-to-edge via `marginHorizontal: -PAGE_PADDING_HORIZONTAL`) → pre-seed `windowWidth`. Example: `SwimmingConsolidatedDetail`, `SledWorkConsolidatedDetail`. The wrapper's measured width is the full screen because the negative margin cancels the page padding.
- Mismatched pre-seed causes a ~32 px alignment bug on first paint: the slots render at the wrong width, the initial `scrollTo(idx * slotWidth)` lands on a fractional pixel boundary, and the user sees a sliver of the adjacent slot at the screen edge. Pattern was originally introduced for BW and copy-pasted into the negative-margin wrappers without adjusting — leading to a real bug surfaced in May 2026. Always pick the formula based on the wrapper's actual width.
- If you let it start at 0, the slots render as 0-px-wide on first paint and pop to full width when `onLayout` fires, which causes the inner detail content to lag behind the header by one frame. NEVER ship with `useState(0)`.
- `onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}` on the ScrollView's wrapper View — still wire this up, because the pre-seed isn't perfect (split view, orientation, dynamic-island insets can differ slightly). The measurement refinement happens silently because the pre-seed is sub-pixel accurate when the formula is right.
- For BW specifically, also gate `LinearTransition` off for the first 2 RAFs after mount so any sub-pixel refinement doesn't animate as a layout change.

**Initial scrollTo (CRITICAL — landing on the right slot):**

After mount, programmatically scroll to the active variant's slot with `animated: false`. Without this, the page lands at slot 0 (the leftmost variant) while the active-variant state already points at e.g. the user's most-recent stroke / variant — visible desync. Guard with a `useRef(false)` flag so this only runs once per mount, not on every navigation.

```ts
const initialScrollDoneRef = useRef(false)
useEffect(() => {
  if (initialScrollDoneRef.current) return
  if (slotWidth <= 0) return
  if (!scrollRef.current) return
  const idx = VARIANT_ORDER.indexOf(activeVariant)
  if (idx < 0) return
  scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
  initialScrollDoneRef.current = true
}, [slotWidth])
```

**onMomentumScrollEnd sync (direct body swipes):**

When the user swipes the body content directly (not the pill), the ScrollView's native paging takes over. Sync state via `onMomentumScrollEnd`:

```ts
onMomentumScrollEnd={e => {
  if (slotWidth === 0) return
  const x = e.nativeEvent.contentOffset.x
  const idx = Math.round(x / slotWidth)
  const target = VARIANT_ORDER[idx]
  if (target && target !== activeVariant) setActiveVariant(target)
}}
```

This ensures the pill label updates when the user swipes the body directly. The pill won't physically animate in this case (only its label re-renders).

**The body ScrollView mechanic is IDENTICAL on every variant pager — keep it that way (LOCKED, June 2026).** Plain `pagingEnabled` + `decelerationRate="fast"` + this one `onMomentumScrollEnd`. `pagingEnabled` is velocity-aware natively, so a quick flick advances one page on its own — no extra scaffolding needed. Carry/Sled briefly carried an "L4" band-aid (`disableIntervalMomentum` + `snapToInterval` + an `onScrollEndDrag` settle-timeout + a ±1 clamp) added for a suspected rapid-swipe stuck-mid-page bug; it made a fast short flick round back to the ORIGIN (visible bounce-back) and diverged Carry's feel from every other pager. Removed June 2026 — all pagers (BW tiers, Carry, Sled, Swimming, the leverage family carousel, Air Bike / Ruck / StairMill zones) now share this exact mechanic.

**Negative-margin trick for slot width:**

The page padding is 16 px each side from `(app)/_layout.tsx`. The page content normally lives inside that padding. For the paged ScrollView to span edge-to-edge (so slides look full-bleed), wrap it in `<View style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}>` then re-pad inside each slot with `paddingHorizontal: PAGE_PADDING_HORIZONTAL`. The inner content lines up with where the page header sits.

**Anti-patterns (DO NOT DO):**

- `key={activeVariant}` on the inner detail component to force remount. Produces a hard cutover with no slide — the whole reason BW felt smoother than the pre-refactor Sled Work / Swimming pages.
- Calling `setActiveVariant` synchronously from `onUpdate` (during the pan). State change should fire AFTER the slide-off animation completes, via `runOnJS` in the slide-off callback.
- Forgetting the initial scrollTo. Result: page opens on slot 0, pill shows correct variant, body shows wrong variant.
- Calling `scrollTo` without a `slotWidth > 0` guard. Result: NaN / Infinity scroll positions on first render before onLayout fires.
- Adding `disableIntervalMomentum` / `snapToInterval` / an `onScrollEndDrag` settle-timeout / a ±1 clamp to ONE pager. It diverges that page's swipe feel from every other pager AND causes a fast-flick bounce-back (the settle target rounds a quick short flick back to the origin). Use the plain `pagingEnabled` mechanic above on every pager.

---

**Pattern 5 — Inline expansion panel (direct height animation — LOCKED May 31 2026)**

What it does: a panel grows from height 0 to its measured content height (and back) when toggled. Because the panel's REAL height changes, every sibling view below it cascades automatically through React Native's normal layout flow — other rows, charts, downstream cards all slide down smoothly with zero extra animation wrappers. Used for "why this zone" info panels, band-level sub-progression detail panels, the Sleep Stats per-row pills, and any other inline expandable content.

**Why the old pattern was retired:** the previous canonical was `FadeInUp` / `FadeOutUp` + a parent `<Animated.View layout={LinearTransition.duration(200)}>` wrapper. During the May 31 2026 Sleep page debugging session we proved this approach is unreliable in deep nesting (`ScrollView → AnimateRise → row → row-head`): the `LinearTransition` wrapper either fails to propagate to siblings outside its parent, or silently no-ops on Fabric/new arch. `LayoutAnimation.configureNext` (the React Native classic alternative) is broken on Fabric entirely. Setting `reanimated.staticFeatureFlags.DISABLE_COMMIT_PAUSING_MECHANISM: true` to "fix" `LinearTransition` instead breaks it further. Direct height animation sidesteps all of these — there's no animation system to fight with, just plain layout flow.

**Canonical mechanic (copy verbatim — HIDDEN-MEASURER + BUFFER, locked June 1 2026):**

```tsx
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'

const PANEL_OPEN_DURATION    = 240
const PANEL_CLOSE_DURATION   = 200
const PANEL_EASING           = Easing.bezier(0.16, 1, 0.3, 1)  // out-quint, matches AnimateRise
const PANEL_HEIGHT_BUFFER_PX = 16  // absorbs the width-mismatch clipped-last-line bug — see below

function CollapsiblePanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [contentHeight, setContentHeight] = useState(0)
  const animatedHeight  = useSharedValue(0)
  const animatedOpacity = useSharedValue(0)

  if (open && contentHeight > 0) {
    animatedHeight.value  = withTiming(contentHeight, { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
    animatedOpacity.value = withTiming(1,             { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
  } else if (!open) {
    animatedHeight.value  = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
    animatedOpacity.value = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
  }

  const panelStyle = useAnimatedStyle(() => ({
    height:   animatedHeight.value,
    opacity:  animatedOpacity.value,
    overflow: 'hidden',
  }))

  const onMeasurerLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + PANEL_HEIGHT_BUFFER_PX
    if (h > 0 && h !== contentHeight) setContentHeight(h)
  }

  return (
    <>
      {/* Hidden off-screen measurer — renders the panel at natural size
          so we can capture its height. NECESSARY: a child of a 0-height
          Animated.View doesn't get a layout pass on Fabric / new arch,
          so an inline single-tree measurer never fires onLayout. */}
      <View
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: -9999 }}
        pointerEvents="none"
        onLayout={onMeasurerLayout}
      >
        {children}
      </View>
      {/* Visible panel — REAL height animates 0 ↔ contentHeight. Sibling
          views below cascade automatically through normal layout flow. */}
      <Animated.View style={panelStyle}>
        {children}
      </Animated.View>
    </>
  )
}
```

**Two bugs proven on June 1 2026 (both attempts to remove the buffer / inline the measurer failed — keep the canonical above):**

1. **Single-tree inner-measurer breaks expansion entirely.** Tried placing the measurer INSIDE the Animated.View (sharing one tree → guaranteed width match). On Fabric / new arch, Yoga skips the layout pass for children of a 0-height parent — `onLayout` never fires, `contentHeight` stays 0 forever, the panel never opens when tapped. Confirmed live: pills stopped expanding completely. Reverted.

2. **Hidden-measurer width mismatch clips last line.** The `position: 'absolute', left: 0, right: 0` measurer can end up a few percent wider than the visible panel in deep flex layouts (nested cards, `NextTargetCallout`, etc.), so text wraps to FEWER lines in the measurer. Captured height comes back ~8–12 px short of what the visible panel needs, clipping the bottom of the last line of body text.

**Fix that actually works: hidden-measurer + 16 px buffer.** The 16 px is added to the captured height inside `onMeasurerLayout`, so the visible panel renders 16 px taller than the measurer reported. The extra space sits below the body text inside the panel's card background / border, where it reads as normal bottom padding rather than a bug.

**LOCKED rules (do not deviate):**

- **No `LayoutAnimation` ever.** Broken on Fabric — keep it out of React Native imports.
- **No `Animated.View layout={LinearTransition}` wrappers** for sibling reflow. The reflow is automatic once the panel's real height changes.
- **No `FadeInUp` / `FadeOutUp` for the panel itself.** Use the height-anim wrapper.
- **Hidden-measurer is mandatory.** Single-tree inner-measurer is BROKEN on Fabric (see Bug #1 above). Don't try to reintroduce it.
- **`PANEL_HEIGHT_BUFFER_PX = 16` is mandatory** and absorbs the width-mismatch clip. Don't drop it back to 0 thinking the visible vs measurer widths "should match" — they don't, reliably.
- **Durations: 240 ms open, 200 ms close**, easing `Easing.bezier(0.16, 1, 0.3, 1)` (out-quint).
- **Content below the panel is a plain `<View>`** — no animation wrapper needed.
- **Auto-close on programmatic state change** (e.g., navigating to a different zone via Pattern 4).

**Where it's used:** Sleep Stats per-row info pills (canonical implementation lives in `mobile/app/(app)/sleep.tsx` `DimensionRow`, ~lines 863-1000). Zone info panels on Weighted Standard, Assisted Machine, Carry, Swimming, Cardio Pace detail pages. Band sub-state info panels on Bodyweight consolidated. Stair-zone info pills on StairMill. Rucking adaptation zone info pill. Any future expand/collapse where the user wants the content below to slide rather than snap.

**Migration note for legacy pages:** if you find code still using `FadeInUp` / `FadeOutUp` + `LinearTransition` for an inline expansion panel, that's the OLD pattern — rewrite to direct height animation. The Sleep Stats `DimensionRow` is the reference implementation; copy the mechanic line for line.

**Info-pill content rule (LOCKED, May 19 2026):** the text inside an info pill / info panel is a **static string about progression-or-adaptation INTENT** for the activity. It is NOT:

- Dynamic / interpolated with the user's log values (no `${beatStats.bucketRound}`, no `Best at {distUnit}`, no per-user numbers).
- A formula explanation (no `watts = cal/min × 17.4`, no `Next = Best × 0.5%`, no `bucketed to nearest km`).
- A re-statement of what's already shown in the hero card.

It IS: a short paragraph (one to three sentences) that tells the user **what adaptation this zone / variant / activity is designed to drive, and how that adaptation is supposed to work biologically**. The user's question being answered is "why does this exist?" — not "how is it computed?" and not "what are my numbers?".

Good examples (already in the codebase):
- *"Heavy loads at low reps recruit your biggest motor units and train them to fire harder and faster. The adaptation is neural — you get stronger without adding muscle size."* (Strength adp zone)
- *"Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine."* (Cardio endurance zone)
- *"Knee assistance shortens your lever — the same muscles work, but with less load."* (BW assisted tier)

Bad examples (what NOT to do — caught during the May 19 2026 audit):
- *"Watts derived from cal/min × 17.4..."* (formula explanation — banned)
- *"Best = the fastest time at {beatStats.bucketRound} {distUnit}..."* (dynamic interpolation from log — banned)
- *"Lighter weight (~60 % of best), double the distance"* (formula explanation — banned; rewrote to *"Lighter weight, longer distance"* which describes the intent without the math)

If you find yourself writing `{some.field}` inside the info panel JSX, you're violating the rule — replace with a static string. If the static string is just a re-statement of the hero card content, delete the info panel entirely instead of duplicating.

This rule applies to every info pill across the app — strength, cardio, mobility, calories, settings — anywhere a user can tap a `<Info>` icon to expand context.

**Chart-direction rule (LOCKED, May 19 2026):** **never show "lower is better" in any chart caption, tooltip, axis label, or accompanying copy.** Every progression chart in the app should read as "line trends UP = the user is improving" regardless of whether the underlying metric is mathematically lower-is-better (pace, assistance load, etc.) or higher-is-better (1RM, cal/min, distance).

Two implementation paths to honour the rule:

1. **Pace / split / assistance charts** — leave the Y-axis as the raw metric (seconds per km, lb of assistance, etc.) but set the LineChart `reversed` prop. The chart then renders smaller values at the TOP, so the line trends upward as the user improves. Caption says something neutral like `Dashed = personal best` — never `lower = better`.

2. **Higher-is-better charts** (1RM, cal/min, distance, max attempts, watts) — no `reversed`, no caption framing needed. The line trends up naturally.

Captions to AVOID across the app:
- `"lower = better"`
- `"lowest <metric> (personal best)"`
- `"smaller is better"`
- Any tooltip / axis-label phrasing that frames the win as a downward number movement.

Captions that are fine:
- `"Dashed = personal best"`
- `"Dashed line = personal best weight"`
- `"Dashed line = personal best distance"`
- Anything that names what the dashed reference line represents, without commentary on direction.

If a user-facing metric is fundamentally hard to read as "up = better" (rare — most things can be reframed via a sibling metric), consider converting the display to a derived metric: pace → speed (km/h), assistance → effective bodyweight lifted (bodyweight − assistance), etc. Picking the right anchor metric is preferable to teaching users that "lower is better."

This rule was triggered May 19 2026 when the user noticed the Beat-Your-Best chart's `"lower = better"` caption and asked for an app-wide audit. Outcome: 1 caption removed (BeatYourBestDetail), 1 caption simplified ("lowest assistance (personal best)" → "personal best" on Assisted Machine detail), 1 axis flipped (Assisted Machine chart gained `reversed` so reducing assistance now reads as the line trending upward).

**Chart distance/duration normalization (LOCKED, June 6 2026 — "false-drop" Push 2):** progression charts that plot a per-distance or per-duration metric MUST normalize across distances/durations so a longer (harder) effort never reads as a regression. A raw plot of pace/load/reps dips the line when the athlete swaps a short effort for a longer/harder one even though they improved. Rules:

- **Pace charts** (running, treadmill, ergs via `PaceDetail`; cycling / stationary / elliptical via `BeatYourBestDetail`; swimming): Riegel-project EVERY chart point to a common anchor distance (`T_anchor = t × (anchor/d)^1.06`), then plot the equivalent pace. Anchors: running / cycling / elliptical = **5 km**, ergs (Row/Bike/Ski) = **2 km**, swimming = **1000m-equivalent per-100m** (same projection as the CSS proxy). The dashed reference = the best NORMALIZED value (not the raw best). The header "Best —" subtitle and the efforts LIST still show the raw logged pace — **only the CHART normalizes.** Caption notes the anchor ("pace shown as 5 km-equivalent (Riegel)"). Helpers: `riegelNormalizedPaceSecsPerKm(effort, anchorKm)` + `paceChartAnchorKm(activity)` in mobile `[activity].tsx` AND in each coach-web `admin/detail/AdminCardio{Pace,BeatYourBest,Swimming}Detail.jsx`.
- **Load holds** (isometric `hold_type === 'load'` — weighted plank / hang): plot EQUIVALENT LOAD at a 30 s hold via the Rohmert curve (`load × rohmert(30) / rohmert(dur)`), not raw load — so a lighter-but-longer hold doesn't drop. `LoadHoldDetail` in `[exercise].tsx`.
- **Band tiers** (bodyweight assisted Band / Band+Knee): plot a band-adjusted difficulty score (`bandRank × BW_GRADUATION_REPS + reps`), not raw reps — advancing to a thinner band resets reps but is harder, so raw reps would drop. Knee tier (no sub-bands) + unweighted Full RX still plot reps; weighted Full RX plots Est. 1RM. Driven by `bwChartMode` ('e1rm' | 'difficulty' | 'reps') in `[exercise].tsx`.
- **Yard swimmers** (`profiles.swim_unit === 'yd'`): per-100 pace DISPLAY converts per-100m → per-100yd (`× 0.9144`) so the number matches the "/100yd" label (was showing per-100m under a /100yd label, ~9% off). Display-only — the coaching math (CSS, zone paces, leaving intervals) stays per-100m. `fmtPaceSecsPer100m(secs, swimUnit)` in `[activity].tsx`; inline `× 0.9144` in `cardio.tsx` live chip + activities list.
- **Rates are NOT normalized** (air-bike cal/min, stair-mill floors/min) — they're duration-anchored, not distance-based; higher = better, no false-drop. Carry / Rucking use "Total work" = weight × distance (a separate single-axis fix — see the Carry spec).

Still PENDING (deferred follow-up): the coach-web Efforts-tab cardio mini-graph sparklines (`AdminUserActivity.jsx`) still plot raw pace per point — they need per-point label parsing + per-stroke swim handling. The DETAIL charts (the primary surface) are done on both mobile + coach web.

**"Do not touch finalized surfaces" rule (LOCKED, May 19 2026):** every detail surface in this app reaches "finalized / done" status after the user has visually approved it and we've marked the activity as `done` in `docs/Activity Completion Status.xlsx`. **Once a surface is done, it is FROZEN.** When the user asks for a tweak to a NEW or in-progress activity, the change MUST be scoped to that activity ONLY — never spread out to "harmonize" or "unify" with the locked surfaces. Locked surfaces are considered design decisions the user has approved and lived with; an "improvement" to them is a REGRESSION risk.

Practical interpretation:

- If you find yourself thinking "let me also update Running's hero to match this new pattern" → STOP. Running is locked. Don't touch it.
- If the user says "unify the hero rows" — they mean unify the IN-PROGRESS work with the locked surfaces' pattern, not the other way around. The locked surfaces are the reference, the new work conforms.
- Acceptable changes to locked surfaces:
  - Bug fixes (visual glitches, crashes, mathematically wrong numbers).
  - Caption / copy fixes that the user explicitly calls out.
  - Cross-platform mirroring when the user explicitly asks for it.
  - Adjustments triggered by a NEW rule the user has just locked in (e.g., the "no lower-is-better" rule retroactively applied across all charts).
- NOT acceptable: speculative refactors, "while I'm here" cleanups, harmonization passes the user didn't request.

This rule was triggered May 19 2026 when the user asked to add watts + split + time to the Concept2 erg hero card and the assistant proposed unifying the hero pattern across all locked detail surfaces (Running, Swimming, Air Bike). The user pushed back: "i dont like that every page is different in view, we need to unify, but here's the catch... do not touch the ones we locked, i want this known, never to ever touch anything we consider finalized and done." The activities currently considered finalized and done are everything marked `done` in `docs/Activity Completion Status.xlsx` — explicitly including Running, Running (Treadmill), Swimming (all 4 strokes), Air Bike, all strength detail surfaces, and the Beat-Your-Best surfaces for Cycling / Stationary Bike / Elliptical. Future surfaces (Rucking, StairMill) are open; the in-progress erg watts integration is open. Everything else is frozen until the user explicitly unfreezes it.

---

**Pattern 6 — PhantomWheel inertia + cross-fade**

What it does: a numeric / time / decimal picker wheel with iOS-style inertia roll. Each row stacks a halo layer + center layer that cross-fades by `|rank|` so the highlight smoothly transfers between rows as the wheel rolls (no on/off snap at commit).

- Component: `mobile/src/components/PhantomWheel.tsx`. Used by every value/time/distance/speed input in the app (strength reps/weight/distance, isometric duration, cardio distance/time/speed).
- **Inertia threshold: 250 px/s** finger release velocity. Above → `withDecay` coast. Below → `withTiming` snap.
- **Deceleration: 0.993** (lower = quicker stop). Tuned away from the iOS default 0.998 which reads as too lazy on a stepped picker.
- **Halo/center cross-fade opacity**: `absRank >= 1 ? 1 : absRank` for halo, `absRank >= 1 ? 0 : 1 - absRank` for center. At rank 0 only center is visible; at rank ≥ 1 only halo is visible.
- **Step-boundary commit detection**: `useAnimatedReaction` watching `scrollY`, fires `runOnJS(commitValue)` when `Math.round(scrollY / PITCH)` changes. Works during BOTH drag AND decay phases — the user's `value` prop stays in sync throughout the coast.
- **Direction contract**: drag DOWN → value INCREASES. Higher values live ABOVE the center line (a new higher value rolls in from above and slides down into center).
- Atomic text + position update: `formattedTextsSV` (a `SharedValue<readonly string[]>`) is recomputed in the same `useLayoutEffect` as `committedSteps.value = pendingStepsRef.current`. Both reach the UI thread atomically — no flicker.
- DO NOT change inertia constants without explicit user approval. They've been tuned over many iterations to feel right on physical Android devices.

---

**Pattern 7 — Save button feedback**

What it does: the Save button on log forms gets a brief "✓ Saved" green/amber acknowledgement after a successful insert, then auto-resets to the idle state.

- **Hold duration: 1500 ms** then `setSaved(false)` + clear other form fields.
- Color: success tint (`palette.amber[400]` for cardio, `palette.blue[400]` for strength save buttons).
- Disabled state: button is `pressable={false}` and renders muted while `saved === true` so the user can't double-tap during the success display.
- The 1500 ms is enough for the user to see the confirmation and for the form to clear without the action feeling unfinished. Don't shorten it below 1200 or the success disappears before the eye registers it.

---

**Pattern 9 — Skia GPU canvas for charts and visuals (LOCKED May 31 2026)**

What it does: any chart or vector visualisation with multiple shapes/paths/gradients renders on a single `@shopify/react-native-skia` `<Canvas>` instead of nested `react-native-svg` primitives. Skia paths are constructed in worklets, animated via `useDerivedValue` + `useAnimatedProps`, and run entirely on the UI thread — no per-shape native bridge crossings, no per-frame Yoga layout passes for the visual elements.

**Why the old pattern was retired:** `react-native-svg`'s `<Path>`, `<Circle>`, `<Line>`, etc. each cross the JS↔native bridge on every frame they animate. With more than a handful of animated primitives in one chart, the bridge becomes the scroll-perf bottleneck — even on flagship Android (Galaxy S25 Ultra). The Sleep page's `SleepClock` had 8 animated paths (7 ring arcs + 1 average band) and that alone caused full-page scroll glitch on the only page it appeared on. Migrating that one component to Skia eliminated the jank entirely. The conclusion the user explicitly locked in: **default to Skia for any chart / SVG-style visual; only fall back to `react-native-svg` for truly static, never-animated tiny vector overlays**, and even then prefer Skia when it's already loaded on the page.

**Canonical mechanic (copy the shape from `mobile/src/components/SleepClock.tsx`):**

```tsx
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

// Worklet — builds a Skia path object programmatically. Runs on the UI thread.
function buildArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number, thickness: number): SkPath {
  'worklet'
  const path = Skia.Path.Make()
  const startRad = (startDeg - 90) * Math.PI / 180
  const endRad   = (endDeg   - 90) * Math.PI / 180
  const outerR   = r + thickness / 2
  const innerR   = r - thickness / 2
  path.moveTo(cx + outerR * Math.cos(startRad), cy + outerR * Math.sin(startRad))
  path.arcToRotated(outerR, outerR, 0, false, true,
    cx + outerR * Math.cos(endRad), cy + outerR * Math.sin(endRad))
  path.lineTo(cx + innerR * Math.cos(endRad), cy + innerR * Math.sin(endRad))
  path.arcToRotated(innerR, innerR, 0, false, false,
    cx + innerR * Math.cos(startRad), cy + innerR * Math.sin(startRad))
  path.close()
  return path
}

// Component — useDerivedValue recomputes the path when SharedValues change.
function RingArc({ progress, color }: { progress: SharedValue<number>; color: string }) {
  const path = useDerivedValue(() => buildArcPath(100, 100, 60, 0, progress.value * 360, 8))
  return (
    <Canvas style={{ width: 200, height: 200 }}>
      <Path path={path} color={color} />
    </Canvas>
  )
}
```

**Skia path-building APIs (the ones you'll actually use):**

- `Skia.Path.Make()` — fresh empty path.
- `.moveTo(x, y)` — set the pen position without drawing.
- `.lineTo(x, y)` — straight line from pen position to (x, y).
- `.arcToRotated(rx, ry, xAxisRotate, largeArc, sweepCW, x, y)` — SVG-style elliptical arc to (x, y).
- `.cubicTo(c1x, c1y, c2x, c2y, x, y)` — cubic Bézier curve. Use this for the Catmull-Rom-to-Bézier conversion that `LineChart` does for monotone-cubic smoothing.
- `.quadTo(cx, cy, x, y)` — quadratic Bézier.
- `.addCircle(cx, cy, r)` — full circle sub-path.
- `.addRect(Skia.XYWHRect(x, y, w, h))` — rectangle.
- `.close()` — close the current sub-path.

**Skia rendering primitives:**

- `<Canvas style={{ width, height }}>` — wrapper. One per visualisation. Do NOT nest `<Canvas>` inside `<Canvas>`; use Skia's `<Group>` for grouping.
- `<Path path={skPath} color={hex|sharedValue} />` — stroke or fill (`style="stroke"` adds stroke styling, default is fill).
- `<Circle cx cy r color />` / `<Rect x y width height color />` / `<Line p1 p2 color />` — geometric primitives that don't need a Path.
- `<LinearGradient start={vec(x1,y1)} end={vec(x2,y2)} colors={[c1, c2]} />` — must be a CHILD of the `<Path>` / shape it gradient-fills. Gradient `<Defs>` from svg-land does not exist.
- `<Text x y text="..." font={font} color />` — uses `useFont('path/to/ttf', size)` to load a font. For dynamic numeric labels, an absolute-positioned RN `<Text>` overlay is often simpler than wiring fonts through Skia.

**Animation patterns:**

- **Static path, animated colour**: `useDerivedValue(() => interpolateColor(progress.value, [0, 1], ['#888', '#0f0']))` returns a colour string; pass directly to `<Path color={derived} />`.
- **Animated path shape**: `useDerivedValue(() => buildXxxPath(args.value))` returns a path object; pass to `<Path path={derived} />`. Reanimated tracks the SharedValue deps and recomputes on UI-thread frames.
- **Animated transform**: Skia doesn't have per-shape `transform`. Instead, build the path with the transform pre-applied inside the worklet, OR wrap shapes in `<Group transform={[{ rotate: derived }]}>` where the transform array is itself a SharedValue.
- **Tap-to-pin tooltips**: render tooltips OUTSIDE the `<Canvas>` as RN absolute-positioned `<View>`s — Skia is for the visual; the tooltip is regular RN. Use `useRegisterChartDismiss(dismissFn)` + `markChartTouch()` from `mobile/src/lib/chartTooltipScope.tsx` so tapping outside dismisses correctly.

**LOCKED rules (do not deviate):**

- **No `react-native-svg` for new charts.** Default to Skia. The only acceptable exception: a one-off truly-static icon overlay that doesn't justify loading Skia on a page that doesn't already use it. If the page has any Skia visual at all, additional small overlays go through Skia too.
- **No nested `<Canvas>`.** Group with `<Group>`. Nested canvases create separate Skia contexts that don't share `<LinearGradient>` definitions — the inner ones silently fall back to black.
- **Build paths in worklets**, not at component render time. The worklet runs on the UI thread; component-render-time path construction crosses the bridge every time.
- **One `<Canvas>` per visualisation**, not one per shape. Even 20 paths inside a single `<Canvas>` outperform 5 paths split across 5 `<Canvas>`s.
- **`useDerivedValue` returns Skia objects (paths, colours)** — `useAnimatedProps` is for animated primitive props (transforms, opacity). Pick the right hook for what you're animating.

**Where it's used:** `mobile/src/components/SleepClock.tsx` is the reference implementation (7 ring arcs + 1 average band, gesture-driven selection, calendar-anchored slot indexing). Other charts and visuals are migrating per the May 31 2026 app-wide Skia rollout — see the relevant component file's header comment for "Skia-migrated YYYY-MM-DD" markers.

**Migration note for legacy charts:** if you find a component still importing `Svg`, `Path`, `Circle`, `Line`, `Rect`, `G`, `Defs`, `LinearGradient`, `Stop` from `react-native-svg` and using them with any animation (Reanimated `useAnimatedProps` on the `d` prop, `Animated.timing` on transforms, etc.), that's the OLD pattern — rewrite to Skia. Keep the component's PUBLIC PROP SURFACE identical so call sites don't have to change. Reference `SleepClock.tsx` for the canonical structure.

---

**Pattern 8 — Radial nav menu (long-press starburst)** — LOCKED May 24 2026

The bottom tab bar replacement. A single floating circular button at screen-bottom-centre; press-and-hold blooms a half-circle of seven orbit icons; slide to highlight, release to navigate. Replaces the horizontal scrolling `BottomNav` entirely.

- Component: `mobile/src/components/RadialNav.tsx`. Mounted once by `(app)/_layout.tsx` as a sibling of the page `<ScrollView>`. Self-contained — single file, no external state.
- **Positioning model**: root is `position: 'absolute', bottom: 0` of the AppShell container. Does NOT reserve flex space — `ScrollView` fills the entire shell height behind it, and the dome scrim provides the visual clearance around the button.
- **Centre button**: hollow white 2px ring, `colors.background` bg, glyph = CURRENT PAGE's icon (dynamic via `usePathname`, falls back to Dashboard icon for off-nav routes like `/profile`). Single tap → navigates to Dashboard; long-press → menu blooms. Glyph cross-fades lime→white via a finger-position check against `CENTER_BTN_RADIUS` (lime when finger over centre or menu closed; white once finger has moved off — doubles as the "release here to cancel" hint).
- **Orbit composition (LOCKED slot order, left → right):**
  - Inner ring (layer 2, 3 items): Strength · Bodyweight · Cardio  (angles 140°, 90°, 40°)
  - Outer ring (layer 1, 4 items): Sleep · Heart · Calories · Hydration  (angles 155°, 110°, 70°, 25°)
  - (Synced 2026-06-03 to match `RadialNav.tsx`: Mobility was removed in the June 2026 mobility teardown and History isn't in the nav; Sleep + Hydration are the two fullrx orbit pages. Bodyweight moved to the inner-top slot.)
  - Dashboard SWAPS into the slot of whichever orbit page the user is currently on (when on Dashboard itself, no swap — orbit shows the 7 non-Dashboard pages in their natural slots).
- **Orbit chrome** (every state): hollow white 1.5px ring, `colors.background` bg, glyph cross-fades white → lime on hover via 120 ms `useDerivedValue` + `interpolateColor`. Bg and border NEVER change; only the glyph colour shifts on hover.
- **Labels**: 10px white Geist Medium below — wait, ABOVE — each orbit icon (anchored via `bottom: ICON_DIAM + LABEL_GAP` on the wrapper so the label sits LABEL_GAP=4 above the icon's top edge). Fades in with the menu via the parent wrapper's opacity.
- **Dome scrim ("moon")**: solid filled circle at `colors.background` (90 % opacity), positioned with centre at the page bottom edge so exactly the top half is visible above. Bottom half clipped by a parent `View` with `overflow:'hidden'` and `height = DOME_MAX_RADIUS`, anchored at root bottom — prevents the dome from bleeding into the system gesture-nav inset below the SafeAreaView.
- **Dome geometry (LOCKED constants)**:
  - `DOME_IDLE_RADIUS_Y = 60`, `DOME_IDLE_RADIUS_X = 78` (1.3:1 ellipse — gentle pedestal hugging the button).
  - `DOME_MAX_RADIUS ≈ 260`, computed dynamically as `Math.sqrt(orbit_x² + (CENTER_BTN_RADIUS + orbit_y + ICON_RADIUS + LABEL_GAP + LABEL_HEIGHT)²) + DOME_OPEN_PADDING` from the worst-case (topmost) orbit icon at angle 70° / 110°. Auto-adapts if ring radii or angles change.
  - `DOME_OPEN_PADDING = 28` — breathing room between label/icon edge and dome edge when fully bloomed.
  - Idle → open animates BOTH `scaleX` and `scaleY` independently from `(DOME_IDLE_RADIUS_X|Y / DOME_MAX_RADIUS)` to 1 — ellipse morphs to circle on bloom.
- **Spokes**: lime `<Line>` from button centre to each orbit icon's NEAR edge (not centre — each item carries a precomputed `spokeEndX/Y = item.x|y * shrinkFactor` where `shrinkFactor = 1 - ICON_RADIUS / RING_RADIUS`). Opacity capped at 0.30 so they read as guide lines, not competing with the icons.
- **Timing constants (LOCKED)**: `HOLD_MS = 100` (press-and-hold threshold), `OPEN_DURATION_MS = 220`, `CLOSE_DURATION_MS = 160`, `HOVER_DURATION_MS = 120`.
- **Hit-test math**: gesture-handler's `e.x` / `e.y` are view-relative coords on the 56×56 `centerWrap`. They continue tracking the finger correctly even when it moves OUTSIDE the view's bounds (values just go negative or exceed view dimensions). Finger offset from button centre = `e.x - CENTER_BTN_RADIUS` / `e.y - CENTER_BTN_RADIUS`. No `measureInWindow`, no SafeAreaView offset shifts, no async timing — this is the May 24 2026 cleanup; the previous `measureInWindow` impl was unreliable on Android and missed the SafeAreaView top inset.
- **Gesture choreography**: `Gesture.Pan().minDistance(0)`. `onBegin` starts a JS-side 100 ms `setTimeout` that animates `openProgress 0 → 1` when it fires. `onUpdate` (only while `openProgress > 0.5`) reads `e.x/y`, computes finger offset, and calls a worklet `recomputeHovered` that linear-scans the 7 orbit positions for the nearest within `ICON_HIT_RADIUS = 40`. `onEnd` checks: (a) menu open + icon hovered → navigate to that orbit's slot; (b) quick tap (release before HOLD_MS, menu never opened) → navigate to Dashboard; (c) anything else → cancel.
- **Skip-nav guard**: `navigateToHref` is a no-op if the requested href's stripped path equals `activePathRef.current` (the live `usePathname()` result). Prevents the "tap Dashboard reloads Dashboard" loop AND the bug where off-nav routes (`/profile`, `/about`) couldn't navigate to Dashboard because the icon-display fallback set `currentHref` to Dashboard (use `activePathRef`, not `currentHref`, for the skip-check — they're separate concerns).
- **Haptics (`expo-haptics`)**: Soft impact on menu open (in the `setTimeout` JS callback, alongside the `withTiming` call). Selection tap on hover via a `useAnimatedReaction` watching `hoveredIdx` from the UI thread → `runOnJS(hapticHover)()` when the value changes to a new non-empty target. NO release haptic per user lock — the visual close + page navigation is its own clear feedback.
- **Worklet contract (LOCKED — non-negotiable)**: every colour value used inside a `useAnimatedStyle` / `useAnimatedProps` callback MUST be precomputed as a module-scope constant. Calling `alpha()` / `withAlpha()` / `colors.X` resolution synchronously inside a worklet crashes the UI thread with `[Worklets] Tried to synchronously call a non-worklet function 'alpha'`. The component declares `COLOR_WHITE`, `COLOR_BLACK`, `COLOR_LIME = colors.primary`, `COLOR_DOME = colors.background` etc. at module load and reuses the strings inside all worklets.
- **AppShell paddingBottom impact**: because RadialNav is `position:absolute` (no flex slot), `(app)/_layout.tsx`'s `scrollContent.paddingBottom` was bumped 12 → 80 so the last page row scrolls clear of the half-moon's idle footprint (60 + 20 buffer).
- **Where it's used**: the only nav primitive in the (app) shell. The old `BottomNav` flex child + `BottomNavItem` definitions remain in `(app)/_layout.tsx` as dead JSX (not rendered) — they can be removed in a follow-up cleanup. Reverting to the old nav is one swap in `_layout.tsx`.

---

**Adding a new animation:** before inventing a new motion, scan this list. If a similar pattern exists (e.g., a slide-in panel — that's Pattern 5; a chart visual — that's Pattern 9), reuse the exact constants. If none of the patterns fit, write the new one INTO this list before merging — add a Pattern 10 entry with timing, gesture rules, source code location, and where it's used. This file is the contract.

> ⚠️ **DETAIL-SPEC STALENESS — the spec sections below can LAG the mobile code (LOCKED, June 2026).** The per-variant "locked design spec" sections in this doc (Weighted Standard, Bodyweight, Isometric, Assisted, Carry, every cardio surface, StairMill, etc.) describe DESIGN INTENT and were accurate when written — but the mobile components have since evolved past several of them. When you BUILD OR MAINTAIN any detail surface — especially the web admin coach-mirrors at `web/src/pages/admin/detail/AdminStrength*.jsx` / `AdminCardio*.jsx` — the **ACTUAL mobile component render is the SOLE source of truth for the visual** (`mobile/app/(app)/effort/strength/[exercise].tsx` and `effort/cardio/[activity].tsx`). Read the live JSX and mirror IT; use these spec sections only for intent/context, NEVER as the pixel spec. This trap is real: in June 2026 the admin StairMill mirror was built to the spec's old zone-pill design while the mobile code had moved to a tile/plan-queue model, and a full cross-check (ledger T082) then found stale-spec artifacts in most of the other mirrors too (phantom panels, wrong section order, removed-then-re-added titles). If a spec section conflicts with the code, the CODE wins — and update the spec section to match (auto-sync rule).
>
> **EXCEPTION — coach mirrors intentionally OMIT athlete-only prose (T086, June 2026).** The web admin coach-mirror detail/tab surfaces (`AdminUser{Sleep,Hydration,Heart}.jsx`, `AdminStrength*Detail.jsx`, `AdminCardio*Detail.jsx`) deliberately STRIP the athlete-facing explanatory copy that the mobile pages show: attribution/citation footers (Epley·Brzycki·Lombardi, Riegel·Daniels'·Seiler, National Academies·…·Maughan, etc.), feature help-text subtitles ("Pick an adaptation zone, then tap a rep target"), tier-criteria methodology subtitles, motivational lines ("Steady sips…", "Anything beyond 2 min is bonus"), eligibility/how-to-log notes, and Sleep's always-visible "why this matters" science. The coach view = client DATA + the prescription cue + the opt-in "why this zone" info pills, nothing else. So a "match the mobile render" cross-check will see these as "missing" — that is CORRECT, do NOT re-add them. (Mobile athlete pages keep all of it.)

### Coaching-cue format (LOCKED — T088 round-2, June 2026)

EVERY coaching cue across the entire app — strength AND cardio, mobile AND the web coach mirrors — uses ONE format, rendered by a single shared component. There are no per-page exceptions.

- **Component:** `mobile/src/components/CueText.tsx` + `web/src/components/CueText.jsx`. Pass the cue as a plain **string**; it auto-emphasizes number+unit tokens (weights `lb`/`kg` → blue, all other numbers → foreground, bold mono). Do NOT hand-wrap numbers in spans.
- **Voice:** one flowing prose sentence (or two). Canonical shape (weighted): `Do 4-5 sets of 5 reps at 285 lb, a weight you can do at least 7 of; rest 3-5 min between sets. Add 5 lb after every clean session, work your way up to 5 × 300 lb.`
- **Hard rules:** commas / semicolons, **NEVER em-dashes (—)**. **NEVER bullets.** **NEVER attribution inside a cue** (source credit lives on its own separate line below). **No `TickerNumber` inside a cue** — RN can't reflow an animated View in wrapping prose, so CueText uses bold text spans; the big hero number above keeps its ticker.
- **When adding/editing ANY cue anywhere:** build the sentence as a plain string and render `<CueText>{string}</CueText>` (web: `<CueText className="…">{string}</CueText>`). Commas, not em-dashes.
- **Swept June 2026:** all mobile strength cues (carry, bodyweight, isometric, assisted, reps-only + bench/ballistic/leverage/load) and all mobile cardio cues (pace, swim, air-bike, ruck, stair-mill, beat-your-best) route through CueText. Web mirrors swept alongside. Olympic/Power-Clean cue is authored in this format when its #2 ramp lands.

---

### Swipe-acceptance rule (LOCKED — June 2026)

On any **variant page** (a detail page with a variant pill/carousel — assist tiers, adp zones, strokes, push/pull, etc.), an element accepts the variant-swipe gesture **if and only if its content is per-variant** (it changes when you swipe to another variant). A **shared / consolidated** element (same content across all variants) does **NOT** swipe — it scrolls / taps / reads normally. One discriminator: *"is this element's content shared across variants?"* → shared = no swipe, not-shared = swipe. Applies element by element, the **log included**: a per-variant (filtered) log swipes; a consolidated log doesn't.

**The canonical per-element source of truth is `docs/Layout Design.xlsx`, column "Swipe rule (per element)".** Mirror of it:

| Layout | Variant | Swipes | Does NOT swipe |
|---|---|---|---|
| 1 Bodyweight | assist tier | pill, hero, tiles, **chart** (all per-tier) | **log** (consolidated across tiers) |
| 3 Weighted | adp zone | pill, **hero** (per-zone) | tiles (shared 1-15RM grid → they scroll), chart, log (shared across zones) |
| 4 Carry | adp zone | pill, hero (per-zone) | chart, log (shared across zones) |
| 5 Sled (consolidated) | push/pull | pill, hero, chart, log (all per-variant, filtered) | — |
| 6 Swimming (consolidated) | stroke | pill, hero, plan tiles, chart, log (all per-stroke, filtered) | — |
| Air Bike / Rucking | adp zone | pill, hero (per-zone) | chart, log (shared) |
| Pace / StairMill | (no variant pill — tile-tap model) | — (no variant swipe at all) | n/a |

**Implementation notes (mobile, `[exercise].tsx` / `[activity].tsx`):**
- **A swipeable element must ANIMATE, not snap.** When an element accepts the variant-swipe it plays the SAME slide choreography the pill does (chevrons fade → slide off in the swipe direction → navigate → slide back in). Never wire a swipe as a raw state change — that was the bug the user caught ("if something is swipable it should do the swipe animation, just like the rest of the things that swipe").
- **BW chart** is per-tier (after the round-2 #4 split), so it accepts the tier-swipe AND slides: a `Gesture.Pan` on the chart slides the chart off by a full window width (`bwChartTranslateX`), calls `navigateBwTierFromChart` (live tier state + bounds via `bwNavRef` / `bwChartCanLeft`/`Right` shared values so the gesture sits in the hook zone), then slides the chart back in. `BodyweightConsolidatedBlock` has a `lastSyncedTierRef`-guarded scroll-sync `useEffect` so the hero pager slides to match. The BW **log stays ungestured** (consolidated across tiers).
- **Weighted hero** got its own `wsHeroSwipeGesture` that mirrors the pill's slide choreography exactly (drives `wsPillTranslateX` → `scrollToZone`), so swiping the hero animates the pill identically — previously only the pill swiped.
- **Sled / Swimming**: chart + log live inside the per-variant paged ScrollView, so they already swipe (each filtered to the active variant). **Air Bike / Rucking / Carry**: chart + log are shared across zones → deliberately ungestured.
- Shared charts/logs are left ungestured on purpose (they scroll vertically / pin tooltips / delete rows).
- The variant-nav `Gesture.Pan` uses `activeOffsetX([-15, 15])` + `failOffsetY([-25, 25])` so taps (tooltip pin, info pill, tile select) and vertical scroll still work.

When you add or change a variant page, set each element's swipe per this rule and update `docs/Layout Design.xlsx`. (Web coach mirrors are a separate, lighter implementation; this rule is the canonical intent.)

---

### Weighted Standard next-target card — locked design spec

This is the spec for the "Your next training target" card that appears on `StrengthDetail.jsx` (web) and `[exercise].tsx` (mobile) for **weighted standard** movements: barbell, dumbbell, kettlebell, machine, strongman. Bodyweight, isometric, assisted, carry, band/knee variants each have their own detail view and are NOT covered by this spec. **Olympic & ballistic barbell lifts** (`movements.lift_type = 'olympic'` — snatch / clean / jerk family + pulls) are ALSO excluded — they route to the Olympic card (Layout 9, spec below), because a rep-max grid is meaningless and unsafe for explosive lifts (T088 Model 1 / Fix 1.2).

**Big weight algorithm (the number at the top of the card):**

1. `current_1RM` = the user's highest 1RM estimate ever computed from any logged effort. Uses `bestOneRM` (max across all logged efforts). Never goes down — a bad day doesn't downgrade projections.
2. For each tile K (1RM through 15RM — the rendered grid is capped at 15 per T088 Fix 1.3; the projection math still computes internally up to 20 for the working-weight lookup):
   - `projection_K` = eff curve weight at K reps from `current_1RM`.
   - `cue_weight_K` = `round_up(projection_K, smallest_jump)` — the user's current capability at K reps, rounded to the nearest loadable weight.
   - `big_weight_K` = `round_up(projection_K + smallest_jump, smallest_jump)` — the next progression milestone (one loadable step above current capability).
3. 1RM tile special case: `big_weight_1RM = round_up(current_1RM + smallest_jump, smallest_jump)` — current 1RM plus the smallest plate jump, the PR attempt.
4. `smallest_jump` depends on equipment + unit:
   - Barbell: 5 lb / 2.5 kg (two 2.5 lb plates per side, or two 1.25 kg plates per side)
   - Dumbbell: 5 lb / 2 kg (fixed dumbbell sizes)
   - Machine: 5 lb / 2.5 kg (pin step)
   - Kettlebell: next ladder rung (variable)
   - Strongman: next ladder rung (variable)

**Card layout:**

- Header line: the adp-zone label as a tappable pill ("BUILD STRENGTH ⓘ" / "INCREASE HYPERTROPHY ⓘ" / "BOOST ENDURANCE ⓘ"), right-aligned. Tapping the pill expands an inline info panel below it. The previous "YOUR NEXT TRAINING TARGET" title text was removed — a template/wrapper component already supplies that header, and rendering it again here created a visual duplicate.
- The info panel's body explains the **WHY** of the adaptation (the science of WHY this rep/load range produces this adaptation), NOT the what-to-do prescription. The what-to-do lives in the cue line at the bottom of the card. Each zone has a `whyText` field in `ADP_ZONE_CONFIG`.
- Big weight number on the left + equipment-specific RHS on the right.
- Equipment-specific footer line for NON-barbell loads (e.g., `Pick the 35 lb kettlebell`, `Set the pin to 60 lb`, `Use the X lb stone, sandbag, or D-ball (or closest available)`, `Pick a pair of X lb kettlebells` when `uses_pair = true`). **Barbell + Olympic have NO prose footer** — the per-side plate-chip line (below) is their sole loading display; the old `45 lb bar + … per side` prose was removed because it duplicated the chips (plates show in exactly one format).
- **Plate-chips layout (LOCKED, June 2026):** the per-side / belt-vest plate chips sit on their OWN single line BELOW the big number, joined with the label (`per side  45  25  10`, `belt / vest  45  45  10`). ALWAYS one line — never wrapped, never squeezed beside the number (the user rejected the beside-the-number wrap). Applies to every plate hero: weighted-standard barbell, bodyweight belt/vest, and Olympic. Mobile uses `s.plateLine` + `s.plateLineLabel` (a `flexDirection:'row'` line, no wrap); web uses a `flex flex-nowrap items-center gap-1.5` line.
- Thin separator (blue/15).
- **Coaching cue** below the separator — prescribes a submaximal WORKING weight, NOT the rep-max (T088 Model 1 / Fix 1.1, locked 2026-06-05). The big number + equipment footer stay the PR target (`big_weight`); the cue describes the day-to-day work and the path to that PR:
  - Non-1RM tile (4 short lines): `Do {sets} of {K} reps at {working_weight} {unit}` · `A weight you could do {K + reserve} — but only do {K}` · `Add {jump} {unit} each time all sets are clean — work up to {K} × {big_weight} {unit}` (the add is REPEATED cycle-by-cycle — you climb to the PR, you don't reach it in one 5-lb jump) · `Rest {rest} between sets`.
    - `working_weight = nearestLoadableWeight(projection at (K + zone reserve) reps)` — snaps to the NEAREST loadable rung (128→130, 126→125), not round-up. `jump` = the equipment's loadable increment.
    - Science: working sets must be submaximal with reps in reserve (Prilepin's loading table, RIR/RPE autoregulation, ACSM); you reach the PR via double progression, and the rep-max is a periodic *test*. `nearestLoadableWeight` + the `reserve` field live in `mobile/src/lib/formulas.ts`; the web coach mirror (`AdminStrengthWeightedDetail.jsx`) has byte-equivalent local copies.
  - 1RM tile (benchmark): `Hit one clean rep at {big_weight} {unit}` · `Benchmark attempt`.

**Per-zone defaults (uneditable, globally locked):**

| adp zone | rep range | sets | RIR | rest |
|----------|-----------|------|-----|------|
| strength | 1-5 reps | 4-5 sets | leave ~2 in reserve | 3-5 min between sets |
| hypertrophy | 6-12 reps | 3-4 sets | leave ~2 in reserve | 2-3 min between sets |
| endurance | 13+ reps | 2-3 sets | leave ~1 in reserve | 45-60 sec between sets |

The reps-in-reserve column = the `reserve` field, and it now drives BOTH the working weight AND the cue line ("a weight you could do {K + reserve} — but only do {K}"). The 2 / 2 / 1 values **correct a previously-inverted set** (was strength 1 / hypertrophy 2 / endurance 3, which had it backwards): the evidence (Refalo 2023; Schoenfeld) says strength is robust to proximity-to-failure so it can leave MORE in reserve, while endurance trains CLOSEST to failure. `whyText` (the adaptation science) still lives in the info panel. (T088 Fix 1.4: the hypertrophy `whyText` now also notes growth isn't locked to 6-12 — it spans ~5 to 30+ reps trained close to failure; the zone stays as an intent label, not an exclusive growth window.)

**Tile grid UX (replaces the previous 5-column grid):**

- **Single active adp-zone pill at the top**, flanked by pulsing chevron arrows — same locked choreography as the bodyweight pill row (see the "Pill row swipe gesture" subsection below). Pill label sits on ONE line (`BUILD STRENGTH` / `INCREASE HYPERTROPHY` / `BOOST ENDURANCE`), never wrapped. The previous 3-pill grid is gone.
- Pill order in the swipe carousel (left → right): `strength → hypertrophy → endurance`. Chevrons appear only on the side where another zone exists (no `<<` on strength, no `>>` on endurance).
- Below the pill: single horizontal scrollable row of tiles (1RM through **15RM** — capped at 15 per T088 Fix 1.3; 16-20RM removed as noise, and 13-15RM flagged with a leading "≈" as rough estimates since rep-max math is only accurate to ~10 reps), with fading edges signaling more content off-screen.
- Tapping a chevron OR swiping the pill row navigates one zone in that direction. On commit, the **first tile of the new zone scrolls to the CENTRE of the tile row** (via `scrollIntoView({ inline: 'center' })` on web / measured-viewport scrollTo on mobile) and becomes the selected tile that drives the card below.
- On mobile, the pill physically slides with the user's finger during pan and runs the same slide-off / slide-in choreography as the bodyweight pill (chevrons fade out at pan start, fade back in once the new pill lands). Web stays simple touch-swipe (no physical slide animation).

**Zone-boundary behaviour:** the cue line is allowed to push the rep count briefly into the next adp zone (5RM tile → cue says "push 6 reps" which is hypertrophy; 12RM tile → cue says "push 13 reps" which is endurance). This is intentional — it represents one session of slightly-different-zone work to earn the next progression in the original zone.

**Database schema additions** (in support of this card):

- `movements.uses_pair` (boolean, default false) — for kettlebell movements that require a pair (Double KB Clean, Double KB Squat, etc.). Toggle in the Admin Movement Library form when equipment = kettlebell.

When `uses_pair = true`:
- Footer copy switches from `Pick the X lb kettlebell` to `Pick a pair of X lb kettlebells`.
- RHS label switches from `kettlebell` to `each hand`.
- Big weight is the per-kettlebell weight (mirrors how dumbbell weights are displayed per hand).

---

### Olympic lift detail card (Layout 9) — locked design spec

This is the spec for the detail page covering **Olympic weightlifting lifts** on `[exercise].tsx` (mobile, `OlympicLiftDetail`) + the web coach mirror `AdminStrengthOlympicDetail.jsx`. Selected by `movements.lift_type = 'olympic'` — a CHECK-constrained `text` column (allowed `'olympic' | 'ballistic'`, NULL otherwise) added in migration `add_lift_type_to_movements` (June 2026). The 22 tagged moves are the barbell snatch / clean / jerk family + their power / hang / block / muscle variants + the pulls (Snatch Pull, Clean Pull, High Pull). (T088 Model 1 / Fix 1.2.)

**Why a separate card:** these lifts fail on TECHNIQUE and BAR SPEED, not muscular fatigue. A rep-max grid (1RM…20RM) is meaningless for them — nobody does a 20-rep snatch — and showing one nudges the user toward a dangerous, nonexistent practice. So they get NO rep-max grid, NO adp zones, and a %-of-best card instead. Evidence: NSCA Essentials (Haff & Triplett); Catalyst Athletics; velocity-based-training literature. Real Olympic programming is 1–3 reps at 70–100%, stopping the set when bar speed drops.

**Layout 9** (built on the Layout-2 isometric skeleton — fixed tile row → hero → chart → log, no swipe pill):
1. **Header** — back chevron + movement name + `Best — N unit` subtitle (TickerNumber; "No efforts logged yet" when empty) + a static **OLYMPIC** category pill.
2. **"Train by percentage" card:**
   - A fixed **3-tile row** (tap to select; no swipe pill, no zones to navigate): **TECHNIQUE** (70% · × 2-3) · **BUILD** (85% · × 1-2) · **PEAK** (100%+ · × 1). Each tile shows its loadable weight + % + rep count.
   - **Hero card** (blue chrome) for the selected tile: big TickerNumber weight + **per-side plate chips** (the same `platesForBarbellWeight` breakdown + `N unit bar + … per side` footer the weighted barbell card shows — added T088 round-2 #2 so Olympic loads read like every other strength move) + `LABEL · % · reps` sub-line + a **prose coaching cue** rendered through the shared `CueText` component. The cue reads as an explicit STEP SEQUENCE (the user found the earlier compressed "through X and Y before…" phrasing hard to follow): *"Start with an empty bar, then {jump} {unit}, then {jump} {unit}, then do {reps} reps at {work} {unit}, around {pct} of your best. {bar-speed reminder}"*. The warm-up jumps come from `buildOlympicCue` → `olympicRamp` (two loadable rungs at ~60% & ~80% of the working weight, strictly between the empty bar and the work set, 0-2 rungs that collapse on light loads), each rendered as its own `then N unit` step. Examples: Build → *"Start with an empty bar, then 75 lb, then 100 lb, then do 1-2 reps at 125 lb, around 85% of your best. Keep every rep crisp and stop the moment the bar slows."*; Peak → *"…then build to a heavy single at 150 lb, a new PR. Make or miss, never grind it out, speed is the signal."* Each jump carries its unit, so CueText renders every loadable weight blue (they all read as real weights to put on the bar). Reps stay 1-3 BY DESIGN — there is deliberately NO high-rep option (technique + bar speed collapse past ~3 reps), and the cue reinforces it.
   - Attribution: `NSCA (Haff & Triplett) · Catalyst Athletics · velocity-based training`.
3. **Chart** — best lift (est. 1RM) over time + personal-best reference line.
4. **Log** — efforts history (read-only + per-effort delete on the coach mirror).

**Weight math (LOCKED):** `best1RM` = max `parseOneRM` across efforts (valid because Olympic lifts are logged low-rep — no high-rep extrapolation). Technique / Build weights = `nearestLoadableWeight(best1RM × pct)` (nearest barbell rung). Peak = `nextLoadableAbove(best1RM)` (the next PR single to chase). All Olympic lifts are barbell, so loadable rounding is always barbell.

**Dispatch order (LOCKED):** the `lift_type === 'olympic'` check MUST come before the weighted-standard branch (Olympic lifts are `equipment = 'barbell'`, which is in the weighted set) — both in mobile `[exercise].tsx` and web `AdminEffortDetail.jsx`.

**Deferred (Fix 1.2b):** ballistic **kettlebell** moves (Swing, Snatch, Clean, Clean & Jerk, etc.) are explosive but **rep-based** (no 1-rep-max swing), so the %-of-best card does NOT fit them. They keep `lift_type` unset for now and still route to the weighted card; their correct rep/load-based treatment is a separate follow-up.

---

### Ballistic kettlebell detail card (Layout 10) — locked design spec

Spec for the detail page covering **ballistic kettlebell lifts** on `[exercise].tsx` (mobile, `BallisticLiftDetail`) + the web coach mirror `AdminStrengthBallisticDetail.jsx`. Selected by `movements.lift_type = 'ballistic'` (same column as Olympic; tagged in migration `tag_ballistic_kettlebell_moves`, June 2026). The 13 tagged moves: Kettlebell Swing / Snatch / Clean / Clean and Jerk / Jerk / Push Press / High Pull + Double KB Swing / Snatch / Clean / Push Press + Single Arm KB Swing / Clean and Jerk. (T088 Model 1 / Fix 1.2b.)

**Why a separate card:** these are explosive, momentum-driven lifts trained for high-power REPS at a given bell — there is no 1-rep-max kettlebell swing, so a rep-max grid is meaningless. Progression is a BELL LADDER (own a bell at a clean rep volume, then size up), not %-of-1RM. Evidence: StrongFirst / Pavel's *Simple & Sinister* (100 one-arm swings + 10 get-ups → graduate the bell); the RKC/SFG snatch test (100 snatches in 5 min). Ballistic power favours moderate load + semi-short sets (5-10 reps) with full rest.

**Layout 10** (Layout-2 skeleton — ladder strip → hero → chart → log, no swipe pill):
1. **Header** — back chevron + name + `Best — N unit` (heaviest bell logged) + a static **BALLISTIC** pill.
2. **"Move up the bells" card:**
   - A horizontal **bell-ladder strip** (kettlebell sizes from `EQUIPMENT_LADDERS.kettlebell`): bells ≤ best show blue + check, the next rung shows **NEXT** (target), heavier ones greyed. Display-only.
   - **Hero card** — the next bell big + a prescription/graduation cue: *"Train the [best] bell in high-power sets of 5-10 with full rest. Own ~100 clean reps, then move up to [next]."* Swing → references Simple & Sinister; Snatch → the snatch test.
   - Attribution: `StrongFirst · Simple & Sinister (Pavel) · RKC/SFG snatch test`.
3. **Chart** — bell weight over time + heaviest-bell reference line.
4. **Log** — each effort shows bell × reps (read-only + per-effort delete on the coach mirror).

**Data (LOCKED):** bell weight + reps parsed from the effort LABEL (`Name · W unit × R`); `bestBell` = heaviest logged; `targetBell` = next ladder rung above best (`nextLoadableAbove(..., 'kettlebell', ...)`).

**Dispatch order (LOCKED):** `lift_type === 'ballistic'` MUST come before the weighted-standard branch (these are `equipment = 'kettlebell'`, which is in the weighted set) — both mobile + web. **Grind** kettlebell moves (Strict Press, Front Squat, Deadlift, Turkish Get-Up, Windmill, Z Press, Double KB Press / Row / Thruster, Double KB Front Squat) keep `lift_type` NULL and stay on the weighted card.

---

### Bodyweight consolidated detail card — locked design spec

This is the spec for the consolidated detail page that covers **bodyweight movements** and their assisted variants on `StrengthDetail.jsx` (web) and `[exercise].tsx` (mobile). Push-Up, Pull-Up, Dip, etc. — any movement where `movements.equipment = 'bodyweight'`. The four assist tiers (`[Band + Knee]`, `[Knee]`, `[Band]`, `Full RX`) are presented as a single consolidated page rather than four separate entries.

**Bodyweight does NOT use adp zones.** The adp-zone framework (strength / hypertrophy / endurance) is exclusive to the weighted-standard card. Bodyweight tile values are called **max attempts** — they represent rep-count milestones, not training adaptations. Bodyweight terminology is `max attempts`, never `max reps`, and the tile labels read `1 REP / 2 REPS / … / 10 REPS`.

**The four assist tiers, ordered easiest → hardest (universally locked, no per-movement overrides):**

1. **Band + Knee** (movement labelled `[Band + Knee]`) — most assistance
2. **Knee** (`[Knee]`)
3. **Band** (`[Band]`) — band only is treated as harder than knee only
4. **Full RX** (no suffix) — no assistance

Always written as "**Full RX**", never just "RX".

**Tier graduation rule (universal, single number):**

- **8 unbroken clean reps in a single set** (`BW_GRADUATION_REPS` — dropped from 10 to 8 in T088 Fix 2.1 so graduation stays in the strength range ~5-8 reps instead of drifting into endurance; Schoenfeld repetition continuum, Steven Low) → promotes to the next tier.
- For Band and Band+Knee tiers, this is gated by **band level** (see "Band-level sub-progression" below): the user must hit 8 unbroken reps at the LIGHT band level before graduating to the next tier. Within those tiers, hitting 8 reps at a heavier band level auto-advances them to the next thinner band, not all the way to the next tier.
- "Clean" = full range of motion, no kip / cheat, controlled descent.
- The "10 reps" target is the same across all four tiers and all movements. It is NOT adp-zone aware (because bodyweight has no adp zones).
- The user can also self-promote at any time by logging a harder tier directly — the system respects revealed preference. Re-logging an easier tier after graduation is silent (no demotion, no UI badge).

**Index page (`Strength.jsx`) collapse rule:**

- All four variants of the same base movement (e.g. `Push Up`, `Push Up [Band]`, `Push Up [Knee]`, `Push Up [Band + Knee]`) collapse into **one row per base movement**.
- The row label shows just the base name (`Push Up`).
- A small **tier badge** on the right shows the highest tier the user has reached: `B+K`, `KNEE`, `BAND`, or `FULL RX`.
- Tapping the row lands on the consolidated detail page (this spec).

**Detail page layout (top to bottom, NEVER inverted):**

1. **Header** — back chevron + movement name + tier badge (matches the index row badge).
2. **Tier pills** — horizontally-scrollable pill row.
3. **Tile row** — 10 max-attempt tiles. Swipes/scroll-snaps in sync with the hero card.
4. **Hero card** — big number + cue line + rest line + graduation hint.
5. **Chart** — shows the ACTIVE tier only (round-2 #4): one curve per pill/tier, so band-assisted reps aren't blended with full-RX reps. Re-filters when you swipe the pill; never physically slides.
6. **Log list** — shared chronological list of every effort across all tiers. Never slides.

**Tier pill row (item 2) — single pill + marching chevrons:**

- Only ONE pill is shown at a time: the **active tier**. Pill text is the tier name in caps (`BAND + KNEE` / `KNEE ASSISTED` / `BAND ASSISTED` / `FULL RX`) with the same blue chrome as the adp-zone pill on the weighted card.
- Flanking the pill are pulsing **chevron arrows** that indicate swipe direction:
  - `<<` on the left side ⇒ a lower tier slot exists to the left
  - `>>` on the right side ⇒ a higher tier slot exists to the right
  - Arrows appear ONLY on the side where another logged-tier slot exists. The opposite side shows a transparent spacer of equal width so the pill stays centred.
  - Always TWO chevrons per side (`<<` / `>>`), never one.
- **Carousel slot order** (left → right): **highest → lowest**. So `FULL RX | BAND | KNEE | BAND+KNEE`. Default landing slot when the page opens is slot 0 — the **highest logged tier** (leftmost slot). Chevrons therefore point RIGHT toward lower assisted tiers by default.
- **Navigation:** tapping a chevron OR horizontally swiping the hero-card + tile-row both advance one tier in that direction. The pill text updates to reflect the new active tier.
- **Initial-scroll sync (locked):** on mount, the carousel programmatically scrolls to the active tier's slot so the pill text and the visible page can never desync. Without this, the page would load at slot 0 (lowest tier) while the pill state already points at the highest tier reached.

**Chevron pulse animation** (locked timing):

- Cycle length: **1.5 seconds**, looping forever.
- Two chevrons per side. On each side, the **inner** chevron (closer to the pill) leads at delay 0 and the **outer** chevron (farther from the pill) follows 0.25 s later. **Both sides** (`<<` left and `>>` right) run in the SAME phase — left-inner and right-inner pulse together, left-outer and right-outer pulse together.
- Per side, the per-chevron timeline:
  - 0.00–0.25 s: inner fades in (opacity 0 → 1)
  - 0.25–0.50 s: outer fades in
  - 0.50–1.00 s: both visible (steady)
  - 1.00–1.25 s: inner fades out
  - 1.25–1.50 s: outer fades out, then loop immediately
- Fade in/out durations are exactly **0.25 s** each.
- Implemented on web with CSS `@keyframes bw-chevron-pulse` (in `src/index.css`) and `animation-delay: 0.25s` on the outer chevrons. `animation-fill-mode: both` is required so the outer chevron stays at opacity 0 during its 0.25s delay (otherwise it'd show at default opacity 1 until the animation kicks in). On mobile, implemented with Reanimated `withRepeat(withSequence(...))` with `delay = 250` on the outer chevrons.

**Pill row swipe gesture — pill physically follows the finger and slides on commit:**

- The **entire pill+chevrons row** is swipeable. Threshold = **20 px** to navigate. Pan activation threshold = **15 px** (so chevron taps still fire for small touches).
- **Visual choreography on commit** (mobile only — web stays simple): the pill is "locked" to the page during the gesture and physically slides across the screen as the user swipes.
  1. **onStart** — chevrons fade out over 120 ms via `chevronOpacityOverride` shared value. They disappear BEFORE the slide starts.
  2. **onUpdate** — the pill's `translateX` mirrors `event.translationX` so it follows the finger in real time.
  3. **onEnd (committed swipe, past threshold AND direction allowed)** — pill animates to `±220 px` in the swipe direction over 250 ms (slides off-screen). `runOnJS(navigateTier)` then updates state (label changes). The pill teleports to the opposite off-screen position and slides back to 0 over 250 ms (new label slides in from the other side). When that settles, `chevronOpacityOverride` animates 0 → 1 over 200 ms and the chevron pulse loop resumes.
  4. **onEnd (cancelled — below threshold OR swiping toward a non-existent tier)** — pill springs back to 0 over 200 ms; chevrons fade back in immediately.
- Implementation: `Gesture.Pan()` from `react-native-gesture-handler` (v2), wrapped around the row by a `<GestureDetector>`. The pill and the two chevron containers are `Animated.View`s with `useAnimatedStyle` derived from two shared values (`pillTranslateX`, `chevronOpacityOverride`). The chevron's existing pulse animation lives inside `BwAnimatedChevron`; the override on the outer container multiplies on top — when the override is 0 the chevrons are hidden, when it's 1 the pulse plays normally. The earlier responder-system implementation proved unreliable (some touches never reached the parent because of negotiation ordering); gesture-handler avoids this entirely.
- **Web** keeps the simple `onTouchStart` / `onTouchEnd` model — no physical slide animation. The translate-and-slide effect is mobile-only because gesture-handler + Reanimated provide the necessary frame-perfect shared-value plumbing.

**Hero card height — selective per-type min-height** (locked):

- **Weighted standard** gets a fixed `min-h-[220px]` web / `minHeight: 220` mobile (`s.calloutWeighted`) so all five equipment variants (barbell / dumbbell / kettlebell / machine / strongman) render at the same height. The 220 px floor is sized for the tallest weighted variant (barbell with multiple plate chips on the per-side breakdown).
- **Bodyweight consolidated** intentionally has NO min-height. An earlier iteration forced 260 px across all BW states, but the tallest BW variant (assisted working state with band-level hint + 3-line cue) is much taller than the shorter Full RX modes (push / locked / graduation / weighted) — forcing them all to 260 px left ~100 px of trailing empty space on the shorter modes. The current behaviour: each BW variant renders at its natural size; the slight height variation across tier swipes is accepted as the lesser evil.
- **Isometric / AssistedMachine / Carry / RepsOnly:** no min-height applied; each renders at its natural size.
- The mobile `NextTargetCallout` component takes an optional `style` prop so the per-type modifier (`s.calloutWeighted`) can be passed in. Without `style`, it falls back to the base `s.callout` chrome.

**Tile row (item 3) — assisted tiers:**

- Same 10-tile grid as the existing bodyweight Full-RX page (1 REP through 10 REPS).
- Tiles are **display-only on assisted tiers** — NOT clickable. There is no weight progression on assisted tiers, only milestone tracking.
- Each tile is one of two states:
  - ✓ **Achieved** — the user has logged at least one effort at that rep count on this tier. Renders blue with a checkmark.
  - — **Not yet** — greyed out with an em-dash. (No "→ next rep" hint, no "+X weight", no "BW" label.)
- Tile row has the same fading-edge horizontal scroll treatment as the weighted page.

**Tile row (item 3) — Full RX tier:**

- Same 10-tile grid as the existing bodyweight Full-RX page (unchanged from today).
- Tiles ARE clickable on Full RX (the user is choosing which rep-target to project against), and the tile labels show `BW` for achieved-at-bodyweight, `+X` for the added-weight projection, `→ N` for push-for-next-rep, or `—` for locked.

**Hero card (item 4) — assisted tier, still working toward graduation:**

- Tier label as a tappable pill at the top of the card, right-aligned, mirroring the adp-zone pill on the weighted card.
- The info-panel below the pill explains *why* this tier is the right intermediate.
- **Big number = the NEXT target = `displayBest + 1`** where `displayBest` is:
  - **Band / Band+Knee tiers**: best reps at the *current band level* (see "Band-level sub-progression" below). When the user hits 10 at the current band, the algorithm auto-advances to the next thinner band level and `displayBest` resets to 0 — the big number flips to 1 and the tile grid empties.
  - **Knee tier**: overall tier best.
- **Sub-line directly under the big number** identifies the current variant:
  - Band tier: `Band: [current band level]` (e.g., `Band: Extra Heavy`)
  - Band+Knee tier: `Band + Knee: [current band level]`
  - Knee tier: `Knee assisted`
  - The earlier "— push to no band" suffix is REMOVED — the sub-line is purely an identifier of the current variant, not a coaching hint.
- Thin separator (blue/15).
- **Single-line cue** — replaces the previous three-line "Do 3 sets / Rest 2 min / Hit 10 to graduate":
  - Band+Knee at *(band)*: `Keep practicing until you hit (displayBest + 1) unbroken reps with (band) band on your knees`
  - Knee: `Keep practicing until you hit (tierBest + 1) unbroken reps on your knees`
  - Band at *(band)*: `Keep practicing until you hit (displayBest + 1) unbroken reps with (band) band`
- No "rest" line and no separate graduation-hint line. ONE unbroken set at the target rep count is the new benchmark — there is no longer a "3 sets" prescription. The graduation moment is implicit: hit 8 at the current band and the algorithm auto-advances; hit 8 at the LIGHT band and the Ready state fires (`BW_GRADUATION_REPS` = 8 since T088 Fix 2.1, was 10).

**Hero card (item 4) — assisted tier, ready to graduate:**

- Fires when:
  - **Band / Band+Knee**: best at the LIGHT band level ≥ 8 (`allLevelsCleared` from `computeBandSubState`).
  - **Knee**: overall tier best ≥ 8.
- Tier label pill stays at top.
- Big number = `displayBest` (the user's peak at the variant that triggered Ready).
- Cue/rest/graduation-hint lines are replaced by a single promotion block:
  - 🎉 **You're ready for *(next tier)***
  - Sub-line: "Log a *(next tier name)* effort to promote".

**Hero card (item 4) — graduated tier (the user swiped back to view it):**

- Tier label pill stays at top.
- Big number = the user's peak on that tier.
- The cue/rest/graduation block is replaced by a graduation summary:
  - ✅ **Graduated on *(date)***
  - Sub-line: best + number of sessions logged on that tier.

**Hero card (item 4) — Full RX tier:**

- Tier label pill at top: `FULL RX` (mirrors the pill chrome used on assisted tiers — kept for visual continuity when swiping between tiers).
- **Body content uses the ORIGINAL pre-consolidation `selectedBWTile`-driven 4-mode logic. DO NOT simplify it.** The user explicitly locked this. The four modes are:
  - **locked** (tile not yet achieved): `Target / {N} max attempts / Build up to {N} clean reps at bodyweight first · current best: {tierBest}`
  - **push** (at-max tile, below threshold): `{nextRep} reps next at bodyweight / Push for one more clean rep — current best: {tierBest}`
  - **graduation moment** (at-max tile = 10, no weighted history): `+{N} {unit} added to start / Attach {N} via belt/vest and work back up to 10 reps`
  - **weighted** (every other achievable tile): `{N} reps target / +{N} {unit} added (with belt/vest plates) / Add {N} {unit} via belt or vest — aim for {N} clean reps`
- Driven by `selectedBWTile` so clicking a tile in the Full RX grid swaps the body content. This is the pre-existing behavior that ships rich weighted-bodyweight progression for users on Full RX.

**Band-level sub-progression** (Band and Band+Knee tiers only — LOCKED):

The `[Band]` and `[Band + Knee]` tiers each contain four band-level sub-tiers, ordered heaviest → lightest (most → least assistance):

```
Extra Heavy → Heavy → Medium → Light → graduate to next tier
```

The user's band level is parsed from the effort label (`Pull Up [Band] · Heavy × 7` → `Heavy`). Within these tiers the algorithm tracks **best reps per band level** and auto-advances the "current band" as the user clears 10 reps at each. The full algorithm:

1. Find `lightestUsed` = the lightest band level the user has logged any effort at (their progression frontier).
2. If `lightestUsed` is null (no efforts yet in this tier) → current band = **Extra Heavy** (most-assistance starting point), best at current = 0.
3. Else if best at `lightestUsed` < 8 → current band = `lightestUsed`, best at current = `bestPerLevel[lightestUsed]`.
4. Else (best at `lightestUsed` ≥ 8) → auto-advance to the next thinner band:
   - If `lightestUsed` is Light → `allLevelsCleared = true`, the Ready state fires (user can graduate to the next tier).
   - Otherwise → current band = the next thinner level (e.g., Heavy → Medium), best at current = `bestPerLevel[nextBand]` (typically 0 if the user hasn't logged at this lighter band yet).

**Consequences:**
- **Tile grid** shows 1-10 with achievement based on best at the CURRENT band level — not cumulative across all band levels. When the algorithm auto-advances to a new band, the tile grid visibly resets.
- **Cue text** updates to reference the new current band.
- **Sub-line under the big number** updates to identify the new current band.
- The user can skip band levels at will (e.g., go straight to Light without doing Extra Heavy / Heavy / Medium) — the algorithm respects that choice and uses their lightest used band as the frontier.
- Regressing to a heavier band level (e.g., logging Extra Heavy after already practicing Heavy) does NOT pull the current band backward — the lightest used band stays the frontier.

**Knee tier has no sub-progression** — only one variant, just track overall tier best. Ready state fires at tier best ≥ 8.

**Full RX** keeps its 4-mode body (locked / push / graduation / weighted) — see the Full RX section below.

**Animation conventions (mirrored from weighted card):**

- Big number on the hero card uses `TickerNumber` slot-machine animation.
- Info-panel open/close uses the same `LinearTransition` + `FadeInUp / FadeOutUp` pattern that the weighted card uses, with sibling layout animation so the big number slides smoothly when the panel opens.
- Tier-pill row, tile row, and hero card form a synchronised horizontal pager — swiping the hero card scrolls the pill row and the tile row to match, and tapping a pill scrolls all three to that tier.

**Chart (item 5) — per active tier (round-2 #4):**

- The chart plots ONLY the active tier's efforts (`chartData` filters on `bwTierFromVariantName(label) === bwActiveTier` on mobile / `=== tier` on web). Blending ~13 light-band reps with ~5 full-RX reps on one curve was misleading, so each pill/tier gets its own line; the PB reference line + caption (`on {tier}`) follow the active tier too. The chart re-filters when the user swipes the pill (it reads `bwActiveTier` / `tier`), but never physically slides.
- **Metric — reps OR Est. 1RM, load-aware (locked June 2026):** by default the chart plots **rep count** (more reps = better). BUT when the **active tier** has ANY added-load effort (a weighted Full-RX rep, e.g. label `Pull Up · 162.9+150 lb × 1`, value `Est. 1RM 312.9 lb`), the chart switches to **Estimated 1RM** for every point in that tier — `e1RM = estimate1RM(bodyweight + addedWeight, reps)` (weighted efforts already store `Est. 1RM N`; pure-bodyweight points are computed from the athlete's bodyweight). This fixes the false-drop where a heavy single read LOWER than a high-rep bodyweight set on a reps-only axis. The switch is **per active tier** (band/knee tiers stay reps so an assisted rep never gets an inflated full-bodyweight 1RM); pure-bodyweight movements (never loaded) stay reps. The "Best —" subtitle, the strength-index row, and the coach Efforts card follow the same rule. The max-attempt TILE GRID is unaffected — always reps. Helpers: `parseAddedWeightFromLabel` (matches the `+N unit ×` in the label), `bwE1RMForEffort` (mobile) / inline e1RM (web).
- Each data point still carries the tier in its tooltip (`May 4, Push Up [Knee] · 10 reps`).
- Graduation moments render as vertical milestone markers on the chart (`graduated to KNEE on May 4`).

**Log list (item 6) — shared:**

- One chronological list of every effort across all tiers — never duplicated per tier.
- Each row shows a small tier chip on the right (`B+K`, `K`, `B`, `RX`) so the tier source of every effort is visible at a glance.
- All edit/delete affordances behave the same as the existing log list.

---

### Isometric detail card — locked design spec

This is the spec for the detail page that covers **isometric movements** on `StrengthDetail.jsx` (web) and `[exercise].tsx` (mobile) — Plank Hold, Wall Sit, Side Plank, L-sit, Hollow Hold, Glute Bridge Hold, Superman Hold, and any other movement where `movements.strength_type = 'isometric'` and `hold_type` is neither `'leverage'` nor `'load'`. Progression is measured in **seconds of unbroken hold time**, not reps or weight. **Skill/leverage holds (`hold_type = 'leverage'` — planche, front/back lever, human flag, L-sit, handstand, crow, support holds) are EXCLUDED from this card** — they route to the Leverage hold card (Layout 11, spec below), because a 2-min time grid is meaningless for a skill that maxes at ~10-20 s (T088 Model 3). **Loadable holds (`hold_type = 'load'` — wall sit, calf-raise hold, glute-bridge holds, dead hang, split-squat hold, squat hold) are ALSO excluded** — they route to the Load hold card (Layout 12, spec below): build the bodyweight hold to ~60 s, then add external load (T088 Model 3).

**Universal milestone set (locked) — TIME/LOAD holds only:** every time/load isometric movement uses the same 12 milestones (leverage/skill holds use Layout 11's short 5-30 s set + a variant ladder instead):

```
10s · 20s · 30s · 40s · 50s · 60s · 70s · 80s · 90s · 100s · 110s · 120s
```

No more `TEN_MIN_ISO` split. Per the science (McGill Torso Endurance Tests, Behm & Colado 2012, Stronger By Science reviews), 2 min is the practical ceiling for plank-class holds — beyond that the test devolves into pain tolerance / tissue compliance, not strength. We cap the milestone grid at 2 min for ALL isometric movements; users can still log longer holds, but the grid doesn't go past 120 s.

**Three phases (locked):** the milestones are partitioned into proficiency-tier phases, each with its own science-backed adaptation focus:

| Phase | Range | Milestones | Adaptation focus |
|-------|-------|------------|------------------|
| **STABILITY PHASE** | up to 30 s (current best < 30) | 10 s, 20 s, 30 s | Motor-unit recruitment, neural force production, basic stability |
| **DURABILITY PHASE** | 30 – 90 s (current best ≥ 30, < 90) | 40 s, 50 s, 60 s, 70 s, 80 s, 90 s | Muscular stamina, tissue stiffness, time-under-tension growth |
| **MASTERY PHASE** | 90 s+ (current best ≥ 90) | 100 s, 110 s, 120 s | Connective-tissue endurance, mental fortitude. Returns diminish past 2 min — beyond is bonus territory |

**Phase classification** is a pure function of the user's best hold time:
- `bestSecs < 30` → STABILITY PHASE
- `30 ≤ bestSecs < 90` → DURABILITY PHASE
- `bestSecs ≥ 90` → MASTERY PHASE

**Layout — single tile grid in a 3-6-3 arrangement, no separate carousel:**

1. **Header** — back chevron + movement name + `Personal best — X` subtitle.
2. **Wrapper card** containing:
   - Card title (`Hold time milestones` or similar — copy detail can be tweaked, not locked).
   - **Single phase pill, centered above the grid.** No chevrons, no swipe, no horizontal nav — pure status indicator showing the current phase derived from `bestSecs`. Tappable to open the same info-panel pattern used on weighted / bodyweight (the `whyText` for the active phase).
   - **Milestone grid, three rows centered**:
     ```
           [10s] [20s] [30s]                         ← row 1 (3 tiles, centered)
     [40s] [50s] [60s] [70s] [80s] [90s]             ← row 2 (6 tiles)
          [100s] [110s] [120s]                       ← row 3 (3 tiles, centered)
     ```
     Tiles are display-only — no tap-to-select interaction. Each tile is achieved (blue chrome + checkmark) if `tileSecs <= bestSecs`; otherwise locked (greyed em-dash, same chrome as bodyweight locked tiles).
   - **Tile label format — `fmtDuration` (min + sec) on a single line (locked):** labels use the shared `fmtDuration(ms)` helper so tiles past 60 s render as `1m 10s` … `1m 50s` (and `1m` / `2m` for the round-minute milestones). To stop those longer strings from wrapping to two lines (which historically made the middle-row tiles visibly taller and broke the 3-6-3 rhythm), the label is forced single-line via `whitespace-nowrap` on web and `numberOfLines={1}` on mobile, and the chrome is tightened to make the text fit:
       - Tile width: web `w-12` (48 px), mobile `width: 48`.
       - Horizontal padding: web `px-1` (4 px each side), mobile `paddingHorizontal: 2`.
       - Font size: 10 px, tabular-numeric monospace.
       - Row gap: web `gap-1` (4 px), mobile `gap: 4`.
     The widest possible labels (`1m 10s` … `1m 50s`, 6 chars) measure ~36 px at 10 px monospace — comfortably inside a 48 px tile. The widest row (6 tiles) totals `6 × 48 + 5 × 4 = 308 px`, which fits inside the card on a 360 px-wide phone after page + card padding. Do NOT widen the tile further or the middle row will overflow on narrow phones; do NOT enlarge the font or the longer labels will overflow horizontally.
   - **Hero card** (same chrome as weighted / bodyweight):
     - Title `YOUR NEXT TRAINING TARGET`.
     - **Big number** = the next un-achieved milestone above `bestSecs`, with `TickerNumber` slot-machine animation. The display format depends on the milestone value:
       - `< 60 s` (10 – 50): single ticker `[N]` + sub-text `seconds`. Example: `20  seconds`.
       - exact minute (60, 120): single ticker `[M]` + sub-text `minute` / `minutes`. Example: `1  minute`, `2  minutes`.
       - mixed (70 – 110): two ticker numbers side-by-side, each with its own unit label — `[M] minute(s) [S] seconds`. Example: `1  minute  10  seconds`. Each segment animates independently so the slot-machine still fires when bestSecs crosses a milestone.
     - **Cue line** (single line, below thin separator): `Hold for X without breaking form`, where X is `${nextMilestone} seconds` for milestones < 60 s and `fmtDurationLong(nextMilestone)` (returns `1 min`, `1 min 10 sec`, `2 min`, etc.) for milestones ≥ 60 s.
     - **All-milestones-cleared state** (bestSecs ≥ 120): replace the big-number block with a centered trophy + the line: `You've hit the practical ceiling — anything beyond 2 min is bonus`.
3. **Chart** — shared infrastructure, plots hold time over time. Unchanged.
4. **Log list** — shared infrastructure. Unchanged.

**What's removed from the previous design:**
- `ISO_MILESTONES_10MIN` and the `TEN_MIN_ISO` set — gone. One milestone set for all isometrics.
- `selectedMilestone` state and tap-to-review behaviour — tiles are status indicators only now; the hero card always shows the NEXT target, not a tile the user tapped.
- The "first target" / "achieved" / "all done" three-mode hero card body — replaced by a single "next target + cue" block with a special-cased all-cleared state.
- "Tap an achieved milestone to review it" subtitle — no longer applicable.

---

### Leverage / skill hold detail card (Layout 11) — locked design spec

Spec for the detail page covering **skill / leverage isometric holds** on `[exercise].tsx` (mobile, `LeverageHoldDetail`) + the web coach mirror `AdminStrengthLeverageDetail.jsx`. Selected by `movements.hold_type = 'leverage'` — a CHECK-constrained `text` column (`'time' | 'load' | 'leverage'`) added in migration `add_hold_type_tag_leverage_holds` (June 2026). The 18 tagged moves: Planche (Tuck/Straddle/Full), Front Lever (Tuck/Full), Back Lever (Tuck/Full), Handstand (Wall/Freestanding), Human Flag, L-Sit, V-Sit, Hanging L-Sit, Headstand, Crow, Dip/Ring Support, Pike Compression. (T088 Model 3.)

**Why a separate card:** these fail on LEVERAGE, not endurance — a full planche maxes at ~10-20 s even for elites, so the 10-120 s time grid + 2-min cap is meaningless and a "mastery = 2 min" frame is wrong. Progression is a LEVERAGE LADDER (tuck → straddle → full), not longer time. Evidence: gymnastics-strength leverage progression (GMB; Steven Low, *Overcoming Gravity*); isometric strength is joint-angle/position-specific (Oranchuk 2019; Kitai & Sale).

**Layout 11** (Layout-2 skeleton — strip → tiles → hero → chart → log, no swipe pill):
1. **Header** — name + `Best — N s` + a static **SKILL** pill.
2. **"Hold the position" card:**
   - A **skill-ladder strip** (only when harder variants exist in the DB): the variant sequence (Tuck → Straddle → Full) with the current variant highlighted. Standalone holds omit it.
   - **Short milestone tiles**: `5 / 10 / 15 / 20 / 30 s` (achieved ≤ best). NOT the 10-120 s grid.
   - **Hero**: while best < 30 s → the next milestone as target + cue *"Hold a clean N s — at 30 s clean, progress to [next variant]"* (or *"build to a solid 30 s"* if standalone). At best ≥ 30 s (the **gate**) → a Trophy state: *"Ready for [next variant] — log a [next] effort to progress"*, or *"Skill mastered"* for the top/standalone rung.
   - Attribution: `Gymnastics leverage progression · GMB · Steven Low (Overcoming Gravity)`.
3. **Chart** — hold time over time + PB reference line.
4. **Log** — hold time per effort (read-only + per-effort delete on the coach mirror).

**Locked constants:** `LEVERAGE_MILESTONES = [5,10,15,20,30]`, `LEVERAGE_GATE = 30` (clean seconds at a variant → progress). `LEVERAGE_LADDERS` (code lookup) holds the variant families in **bracket form**: Planche `[Tuck]→[Straddle]→[Full]`, Front/Back Lever `[Tuck]→[Full]`, Handstand `[Wall]→[Freestanding]`. The standalone holds (L-Sit, V-Sit, Human Flag, Headstand, Crow, Dip/Ring Support, Hanging L-Sit, Pike Compression) are intentionally **not linked** — each is its own page.

**Family consolidation (LOCKED — June 2026):** the 4 multi-variant families (Planche / Front Lever / Back Lever / Handstand Hold) are now real parent/child variant families and render through the **generic `FamilyConsolidatedDetail` engine** (the same Sled / Swimming pill-carousel) on mobile — NOT four separate pages. The DB migration (`supabase/migrations-archive/20260605_consolidate_leverage_families.sql`) renamed each variant to `Name [Variant]` bracket form, linked the children to a fresh parent container row via `parent_movement_id`, set `variant_short_label` (TUCK/STRADDLE/FULL/WALL/FREE), and migrated logged effort labels. Carousel order = easiest→hardest (Tuck→Straddle→Full, Wall→Freestanding); each slot is a per-variant `LeverageHoldDetail` (milestone strip hidden — the pill replaces it). The consolidated header shows the **SKILL** badge (leverage parents have `equipment = null`). `LEVERAGE_LADDERS` is still consulted inside each slot to drive the "ready for next variant" hero hint. The strength index collapses each family to one row. **Web is mobile-only here:** the web admin has no generic consolidation engine, so the coach view renders leverage variants **individually** (each with its own milestones + progression ladder) — arguably clearer for a read-only roster review; a web pill carousel is deferred until the user asks. Both surfaces use the bracket names.

**Dispatch order (LOCKED):** `hold_type === 'leverage'` MUST come before the `strength_type === 'isometric'` branch (leverage holds ARE isometric) — both mobile + web. On mobile the generic family dispatcher (`StrengthDetailRoute`: parent row + ≥2 children → `FamilyConsolidatedDetail`) sits ahead of the per-movement leverage branch, so a leverage *parent* consolidates while a leverage *child / standalone* still routes to `LeverageHoldDetail`.

---

### Loadable hold detail card (Layout 12) — locked design spec

Spec for **loadable isometric holds** on `[exercise].tsx` (mobile, `LoadHoldDetail`) + the web coach mirror `AdminStrengthLoadDetail.jsx`. Selected by `movements.hold_type = 'load'` (migration `tag_load_holds`, June 2026). The 7 tagged moves: Wall Sit, Calf Raise Hold, Glute Bridge Hold, Single Leg Glute Bridge Hold, Dead Hang, Split Squat Hold, Freestanding Squat Hold. (T088 Model 3.)

**Why:** these positions take external load, so endless seconds is the wrong progression — past ~60 s a bodyweight hold trains endurance, not strength. Build the hold to 60 s, THEN add weight. Evidence: isometric strength is position/joint-angle-specific (Oranchuk 2019; ACSM).

**Layout (round-2 #6 redesign — looks like the Pull-Up Full RX grid):** a persistent TUT (time-under-tension) tile grid + a hero, in two phases:
- **Build phase** (no weighted efforts yet): tiles = bodyweight duration milestones `15 / 30 / 45 / 60 s`, each ✓ (held that long) or — (not yet); hero targets the next milestone; cue *"Hold a clean N s, build to 60 s, then start adding load."* You can't project an added-weight target until a loaded hold is logged — first earn the bodyweight hold.
- **Loaded phase** (any weighted effort logged): tiles = `10 / 20 / 30 / 45 / 60 / 90 s`, each PROJECTING the added weight to aim for at that duration (heavier for short holds, lighter for long), via Rohmert's curve anchored on the user's best loaded hold; tap a tile → hero shows that prescription (`Hold 30 sec with +25 lb added, then add 5 lb once you hold it clean`); default tile 30 s. A tile whose projection rounds to 0 shows `BW`.

**Projection (Rohmert's isometric-endurance curve):** `rohmertFactor(secs)` = fraction of a brief-max isometric force holdable for a duration (points from Rohmert 1960: 6 s→1.0, 30 s→0.62, 60 s→0.46, 90 s→0.38, …, interpolated + clamped). `projectedAddedFor(D) = round_to_increment(bestLoad × rohmertFactor(D) / rohmertFactor(bestLoadDur))`, floored at 0 — the isometric analog of the rep-max eff curve. `LOAD_HOLD_GATE = 60`, `LOAD_HOLD_TARGET_SECS = 30` (default tile), increment 5 lb / 2.5 kg.

**Title + attribution (round-2 #6 fixes):** the card title is neutral (`Build the hold` / `Load targets by hold time`) — "Add load" is NO LONGER a title (the add-load guidance lives in the cue). Attribution reformatted to the standard sources-only line: `Rohmert isometric-endurance curve · Oranchuk 2019 · ACSM`.

**Log form (mobile `strength.tsx`):** for `hold_type='load'` the isometric form gains an **Added-weight wheel** (step 5 lb / 2.5 kg, min 0 = bodyweight) beside the duration wheel. Label: `Name · {w} {unit} × {dur} sec` when loaded, `Name · {dur} sec` when bodyweight; `value` stays `{dur} sec` so `parseDurationSecs` is unchanged. Weight is parsed back from the label via `parseLoadHoldWeight`.

**Chart:** adaptive — plots **load over time** once any weighted effort exists, else **hold time over time**.

**Dispatch order (LOCKED):** `hold_type === 'load'` before the `strength_type === 'isometric'` branch (mobile + web). Web log form is frozen — the coach mirror displays the progression read-only (the Added-weight wheel is athlete-app only).

---

### Assisted Machine detail card — locked design spec

This is the spec for the detail page that covers **assisted (weight-reducing) machine movements** — `movements.equipment === 'assisted'` — Assisted Pull-up, Assisted Dip, Assisted Chin-up, etc. The machine provides a counterweight that *reduces* the user's effective bodyweight. Progression is measured in **how little assistance the user needs**, with the eventual goal of 0 (graduate to the unassisted bodyweight variant).

**Distinction from `equipment === 'machine'`:** resistance-adding machines (lat pulldown, leg press, chest press, etc.) use `equipment === 'machine'` and route through `WeightedStandardDetail` — their progression is upward (more weight). The assisted-machine spec on this page applies ONLY to `equipment === 'assisted'`.

**Visual design (locked):** mirrors `WeightedStandardDetail` exactly. Same wrapper card, same adaptation-zone pill row with chevrons, same horizontal rep-range tile scroll, same hero card chrome, same TickerNumber slot-machine animation, same min-h-[220px] hero card height lock. The ONLY differences are the inverted math and a small number of copy / unit swaps.

**Math — inverted via effective load (locked):**
```
bodyweight_kg               = latest_bodyweight_log_within_30_days
                              ?? profile.current_weight (normalized to kg)
effective_load(effort)      = max(0, bodyweight − effort.assistance)
effective_1RM_per_effort    = estimate1RM(effective_load, reps)             // shared formula
best_effective_1RM          = max(effective_1RM_per_effort across efforts)
best_1RM_assistance         = max(0, bodyweight − best_effective_1RM)       ← shown in header subtitle

For each rep range r in 1..20:
  projected_effective(r)    = projectAllRMs(best_effective_1RM, 1)[r-1].weight
  projected_assistance(r)   = max(0, bodyweight − projected_effective(r))
  tile_bw_pct(r)            = round((projected_assistance(r) / bodyweight) × 100)
```

The shared formula update (locked simultaneously): `estimate1RM` and `projectAllRMs` in both `src/lib/formulas.js` (web) and `mobile/src/lib/formulas.ts` (mobile) drop Brzycki when `reps > 10` and average only Epley + Lombardi. Brzycki's linear assumption under-projects high-rep loads relative to NSCA reference tables; the cap fixes that. This change also affects the 15RM / 20RM tiles on weighted-detail pages — expected ~3-4 percentage-point increase.

**Bodyweight gate (locked):**
- Source: latest log in the `bodyweight` table for the user, or `profile.current_weight` as fallback (always synced to latest log on insert/delete).
- Recency check: if the latest log's `created_at` is older than **30 days**, the rep-max projection card and hero card are REPLACED with a single CTA card: *"We need a recent bodyweight to project assistance accurately. Please log your current weight."* + a button that deep-links to `/bodyweight` (web) / `/(app)/bodyweight` (mobile). Header subtitle, chart, and log list still render so the user can see their existing data.
- The 30-day rule is also the source of truth for whether the projection card renders — there's no fallback "best effort with stale weight." Stale weight + no recent log = projection card hidden until a fresh log lands.

**Layout — single page, top to bottom (locked):**
1. **Header** — back chevron + movement name + subtitle `Best Est. 1RM — <X> <unit> assist` (TickerNumber on X). When no efforts logged yet: `No efforts logged yet`.
2. **Rep-max projections card** (skip if bodyweight gate fails):
   - Title `Rep-max projections`, subtitle `Pick an adaptation zone, then tap a rep target.`
   - Adaptation-zone pill row — STRENGTH / HYPERTROPHY / ENDURANCE — same swipe + tap behaviour as weighted.
   - Horizontal scrollable tile row, 1RM through 20RM, same chrome as weighted. Each tile shows:
     - `<r>RM` (uppercase tracking-wider)
     - Projected assistance value (= what the user can do TODAY at this rep count) with TickerNumber animation
     - `<bw_pct>% BW` underneath — the projected assistance as a percentage of bodyweight, with literal "BW" suffix so users read it as "of bodyweight" without consulting an axis. Replaces weighted's `% of 1RM` line.
   - Source attribution: `Epley · Brzycki · Lombardi averaged · % of bodyweight` (Brzycki dropped past 10RM per the shared formula change).
3. **Hero card** — same blue chrome as weighted, min-height locked:
   - Top-right adaptation zone pill with info button + inline expandable info panel (identical to weighted).
   - Big TickerNumber = the **target** assistance at the selected rep range. Must land on a valid pin slot — assisted machines have fixed pin holes (5 lb / 2.5 kg increments), so 42 lb is not requestable if the stack steps in 5s. Formula:
     ```
     snapped_down = Math.floor(projected_assistance(r) / inc) * inc
     target = projected_assistance(r) is exactly on a pin
              ? max(0, snapped_down − inc)         // step one pin lower
              : max(0, snapped_down)               // already between pins → use pin below
     ```
     The tile shows the raw projection (current frontier, may not sit on a pin); the hero card shows the pin the user should actually move to. Sub-text `<unit> assist` (replaces `<unit>` / `pin setting` / `each hand`).
   - **Single Target BW% chip** below the big number: `Target <Y>% BW` where Y = `round((targetAssistance / bodyweight) × 100)`. Same blue-border style as weighted's plate chips. (No "Current" chip — current is already on the tile.)
   - Thin separator + cue line `Do <sets> sets of <reps> reps with <Z> <unit> assistance` for rep ranges ≥ 2, using the **target** value for `<Z>`; for 1-rep range `Hit one clean rep with <Z> <unit> assistance` (mirrors weighted's `Hit one clean rep at <Z> <unit>`).
   - **"Attempt unassisted" replacement (locked):** the cue line is replaced with a graduation prompt whenever **`targetAssistance === 0`** for the selected rep tile — i.e., the next reduction pin would come off the stack. Two variants based on rep range:
     - `selRepRange === 1` → `Attempt an unassisted <BareName> — you're ready.` (article "an", not "one" — reads as natural English with "unassisted" starting on a vowel sound)
     - `selRepRange > 1`  → `Attempt <N> unassisted <BareName>s — you're ready.` (where N is the rep count, animated with TickerNumber)
     BareName strips the leading "Assisted " from the movement (e.g. "Assisted Pull Up" → "Pull Up"). The "s" pluralization and the entire bare name are wrapped in a no-wrap span (`whitespace-nowrap` web, single inline `Text` on mobile) so they never break across lines — a bare name like "Pull Up" with a trailing "s" outside the bolded span used to strand the "s" on a new line when the line wrapped. The trigger is on the *target*, not on `best_1RM_assistance`, so a best of exactly 5 lb (one pin above zero) at 1RM correctly triggers it. This naturally limits the cue to low rep ranges for most users (since higher-rep tiles project higher assistance values), but it fires for ANY tile whose next pin is 0.
4. **Reliability warning (locked):** if the user's best-ever effort had effective load < 25 % of bodyweight (i.e., the machine was carrying > 75 % of their bodyweight for their best set), render a small soft warning chip *above* the rep-max projection card, before the title: amber-tinted, `Heads up — your best effort had the machine carrying most of the load. Projections may be imprecise. Try a set with less assistance.` Does not block any card; purely informational.
5. **Chart** — `Assistance over time`, line chart from existing infrastructure. Lower = better progress. Unchanged from current implementation.
6. **Log list** — efforts history, same row format as current implementation. Unchanged.

**Adaptation zone rep ranges (locked, shared with weighted):**
- STRENGTH: 1–5 reps, 3-5 sets, rest 3-5 min
- HYPERTROPHY: 6–12 reps, 3-4 sets, rest 1-3 min
- ENDURANCE: 13–20 reps, 2-3 sets, rest 30-60 s

**State management mirror from weighted:**
- `selZone` controls which zone pill is highlighted (default: deduce from `selectedRM`).
- `selectedRM` is which tile is selected (default: closest tile to user's best rep count).
- `zoneInfoOpen` toggles the inline info panel on the hero card.
- Swipe / tap on the zone pill row scrolls the tile list to that zone's first rep.
- Outside-click closes the info panel.

**What's NOT carried over from the existing AssistedMachineDetail:**
- The standalone "Progress tracker" / "Lower assistance = less help = harder" copy — gone, replaced by the rep-max card.
- The "graduated to bodyweight" big celebratory state — replaced by the text-only "Attempt unassisted" cue swap when 1RM-assist is below threshold. No special trophy, no deep-link, no migration prompt — by design (your call).

---

### Carry detail card — locked design spec

This is the spec for the detail page that covers **loaded carry movements** — `movements.equipment === 'carry'` — Farmer's Carry, Kettlebell Farmer's Carry, Single Arm Farmer's Carry, Suitcase Carry, Yoke Carry, Kettlebell Overhead Carry, Single Arm Overhead Carry, and the strongman-object carries (Atlas Stone Bear Hug, D-Ball Bear Hug, Husafell Stone, Keg, Sandbag, Shield, Sled Work [Push], Sled Work [Drag]). Progression is tracked along TWO axes simultaneously: **weight per hand / per implement** AND **distance traveled** (meters or feet, normalized to meters internally).

**Sled Work variant tag (May 2026 lock):** Sled work has TWO biomechanically distinct variants on the same equipment:
- **Sled Work [Push]** — Prowler-style, leg-dominant (quad/glute concentric drive). Facing the sled, hands on handles, legs piston. Higher loads possible.
- **Sled Work [Drag]** — drag, posterior-chain dominant (hams/glutes pull). Strap or harness, sled behind. Lower loads typical.

Both are stored as separate movements (`Sled Work [Push]`, `Sled Work [Drag]`) with their own `CARRY_BENCHMARKS` entries (`mode: 'ratio'`; Push tiers: 1.0/1.5/2.0/2.5×BW; Pull tiers: 0.75/1.25/1.75/2.25×BW; all at ≥ 15 m).

**Consolidated detail page (locked May 2026):** the strength index collapses both variants into ONE row keyed by the base name `Sled Work` with a small `PUSH` / `PULL` badge on the right showing whichever variant the user most recently logged. Tapping the row routes to `/effort/strength/Sled Work` (the base name — not a real movement row in the DB).

The detail page detects `exercise === 'Sled Work'` (via `isSledDragConsolidated`), fetches BOTH variants in one `or()` query (`Sled Work [Push] ·%` OR `Sled Work [Drag] ·%`), and dispatches to `SledWorkConsolidatedDetail`. That component:
1. Maintains an `activeVariant: 'push' | 'pull'` state (defaults to whichever variant has the most recent logged effort).
2. Renders a simple PUSH | PULL pill toggle in CarryDetail's header (via the new `extraHeaderContent` prop).
3. Delegates the actual page render to CarryDetail, passing `exercise={`Sled Work [${activeVariant}]`}` (so `CARRY_BENCHMARKS` lookup + label parsing still work), `displayName="Sled Work"` (so the h1 reads as the base name), and `efforts={filteredEfforts}` (only the active variant's efforts).
4. The CarryDetail render gets a `key={activeVariant}` prop so it remounts when the user toggles — clean reset of all internal state (selected zone, scroll position, info panel) per variant.

The two new CarryDetail props (`displayName?: string` and `extraHeaderContent?: React.ReactNode`) are additive and have no effect when omitted — every other carry call site (Atlas Stone, Yoke, Farmer's, etc.) renders unchanged.

The May 2026 cleanup also moved `Sandbag Carry`, `Sled Pull`, `Sled Push` from cardio to strength — they were loaded carry work miscategorized as cardio. `Sled Pull` → renamed to `Sled Work [Drag]`; `Sled Push (Prowler)` → renamed to `Sled Work [Push]`. `Sandbag Carry` added as a new strength entry (its `CARRY_BENCHMARKS` spec was already in code, but the movement row was missing from the DB).

**`movements.unit_lock` — community-dominant-unit forcing (locked May 2026):**

`unit_lock` is a `CHECK`-constrained text column on the `movements` table that forces a specific unit for that movement, overriding the user's profile preference. Allowed values: `'kg'`, `'lb'`, `'mi'`, `'km'`. NULL when the movement should follow the user's profile preference.

Currently in use:
- **Strongman strength events** (Atlas Stone family, D-Ball family, Husafell Stone, Keg, Yoke, Tire Flip, Log, Axle, etc.) — locked to **`kg`** because strongman weights are kg-universal worldwide.
- **Rucking (cardio)** — locked to **`mi`** because the rucking community (GoRuck, US tactical fitness) uses miles exclusively. The canonical benchmark is the 12-mile ruck under 3 hours; GoRuck events are all programmed in miles. No European/Asian rucking event uses km as the primary unit despite local convention.

Honored by:
1. The log form (`strength.tsx` carry block, `cardio.tsx` pace mode): when `unit_lock` is set, the regular `UnitToggle` is replaced by a static `unitLockedBox` chip showing the locked unit; the toggle can't change it.
2. The detail page (`[exercise].tsx` carry render, `[activity].tsx` cardio detail): a derived `distUnit` (or weight unit) prefers `movementRecord.unit_lock` over `profile.distance_unit` / `profile.weight_unit` when set. So Rucking's "Best — N mi" subtitle displays in miles even for a user whose profile says km.

The CHECK constraint was widened from `{'kg','lb'}` to `{'kg','lb','mi','km'}` in migration `widen_movements_unit_lock_check` (May 2026) so distance-based locks could be added. When adding a new community-dominant-unit lock, update both the DB column AND the TS `Movement.unit_lock` union in `mobile/src/hooks/useMovements.ts`.

**Visual design (locked):** Mirrors WeightedStandardDetail's outer chrome (header + adaptation-zone pill row + chevron-swipe + hero card with min-h-220 blue chrome + chart + log list). The carry-specific twist is the **dual-axis hero card** — two stacked target rows ("Go heavier" / "Go further") instead of weighted's single TickerNumber + cue line. The user's current strongman tier (BEGINNER / INTERMEDIATE / ADVANCED / STRONGMAN) is shown as a chip in the header subtitle, NOT as a dedicated ladder card. The tier criteria one-liner ("Tiers based on weight × bodyweight at ≥ 15 m walked" or "Tiers based on absolute load at ≥ 10 m walked") appears as the secondary subtitle of the Adaptation zone block, not as a separate card.

**Tier classification math (locked):**
```
For each effort: (weight, distance_m, ts)
  // Convert ft → m: distance_m = ft * 0.3048
  load_ratio = weight / bodyweight   (for ratio-based movements)
  // OR for stone/object carries:
  load_kg = weight in kg            (for absolute-weight movements)

For each tier in [strongman, advanced, intermediate, beginner]:
  qualifies = ANY effort exists where:
    (load_ratio ≥ tier.minRatio AND distance_m ≥ tier.minDist)
    OR (load_kg ≥ tier.minAbsKg AND distance_m ≥ tier.minDist)
  user_tier = highest tier where qualifies = true
  // Default to BEGINNER if no efforts meet the lowest tier
```

**Per-movement strongman benchmarks (locked):**

```js
const CARRY_BENCHMARKS = Object.freeze({
  // Ratio-based (weight / bodyweight per hand or per implement)
  "Farmer's Carry":              { mode: 'ratio', tiers: { beginner: [0.50, 15], intermediate: [1.00, 15], advanced: [1.50, 15], strongman: [2.00, 15] } },
  "Kettlebell Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.40, 15], intermediate: [0.75, 15], advanced: [1.25, 15], strongman: [1.75, 15] } },
  "Single Arm Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Suitcase Carry":             { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Yoke Carry":                 { mode: 'ratio', tiers: { beginner: [1.00,  7], intermediate: [1.50,  7], advanced: [2.00,  7], strongman: [2.50,  7] } },
  "Kettlebell Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.15, 15], intermediate: [0.25, 15], advanced: [0.40, 15], strongman: [0.50, 15] } },
  "Single Arm Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.10, 15], intermediate: [0.20, 15], advanced: [0.30, 15], strongman: [0.40, 15] } },

  // Absolute-weight (kg) — strongman objects don't scale with bodyweight cleanly
  "Atlas Stone Bear Hug Carry": { mode: 'abs',   tiers: { beginner: [40, 10], intermediate: [70, 10], advanced: [110, 10], strongman: [140, 10] } },
  "D-Ball Bear Hug Carry":      { mode: 'abs',   tiers: { beginner: [30, 10], intermediate: [60, 10], advanced: [ 90, 10], strongman: [120, 10] } },
  "Husafell Stone Carry":       { mode: 'abs',   tiers: { beginner: [50, 10], intermediate: [80, 10], advanced: [120, 10], strongman: [150, 10] } },
  "Keg Carry":                  { mode: 'abs',   tiers: { beginner: [30, 10], intermediate: [60, 10], advanced: [100, 10], strongman: [130, 10] } },
  "Sandbag Carry":              { mode: 'abs',   tiers: { beginner: [25, 10], intermediate: [50, 10], advanced: [ 80, 10], strongman: [110, 10] } },
  "Shield Carry":               { mode: 'abs',   tiers: { beginner: [30, 10], intermediate: [50, 10], advanced: [ 75, 10], strongman: [100, 10] } },
})
// Tier tuple format: [minRatio | minAbsKg, minDist_m]
// Fallback for unrecognized movements: use the Farmer's Carry ratio table.
```

**Adaptation zones (locked, carry-specific — replaces STRENGTH/HYPERTROPHY/ENDURANCE):**

Each zone pushes ONE axis (or two for conditioning) anchored on the user's actual best effort — `bestWeight` (heaviest weight logged, display unit) and `bestDist` (longest distance logged, display unit). The zone math below produces a `(W_target, D_target)` pair from those two anchors; each slot in the hero swipe then renders its own prescription with a delta vs. the user's best.

| Zone           | Weight axis                                                   | Distance axis           |
|----------------|---------------------------------------------------------------|-------------------------|
| MAX LOAD       | heavier — `nextLadderAbove(bestWeight)` or `bestWeight+wInc`  | same — `bestDist`       |
| DISTANCE BUILD | same — `bestWeight`                                           | longer — `bestDist+dInc`|
| CONDITIONING   | lighter — `snap(bestWeight × 0.60)`                           | double — `bestDist × 2` |

- **MAX LOAD** — heavier weight, same distance. Trains absolute strength and grip endurance under load.
- **DISTANCE BUILD** — same weight, longer distance. Default zone. Trains sustained postural control and grip stamina.
- **CONDITIONING** — lighter weight (~60 % of best, snapped down), double the distance (science-based for conditioning carries). Trains aerobic capacity and grip endurance fatigue.

Each zone prescribes a genuinely different workout, anchored on the user's actual data — the hero numbers move across all three slots instead of showing the same global PB everywhere.

**Layout — single page, top to bottom (locked):**
1. **Header** — back chevron + movement name + subtitle: `Best — <X> lb · <Y> ft · <TIER>` where X is the user's heaviest logged weight and Y is the longest distance from any effort, and TIER is the computed tier badge (BEGINNER / INTERMEDIATE / ADVANCED / STRONGMAN). When no efforts: `No efforts logged yet`.

2. **Bodyweight gate** (same pattern as Assisted, for ratio-based movements only): if the user has no recent bodyweight log (≤ 30 days), the Adaptation zone block and hero card are REPLACED by a CTA pointing to `/bodyweight`. Chart + log list still render. Absolute-weight movements (stones, kegs, etc.) don't need bodyweight and skip the gate.

3. **Adaptation zone block** (combines what was previously two separate cards):
   - `<h2>Adaptation zone</h2>` title
   - Primary subtitle: `Pick a training focus, then aim at the next target.`
   - Secondary subtitle (smaller, dimmer): the tier-criteria one-liner (`Tiers based on weight × bodyweight at ≥ 15 m walked` for ratio mode; `Tiers based on absolute load at ≥ 10 m walked` for abs mode).
   - Zone pill row (swipeable, 3 zones, same chevron-pulse pattern as weighted): `MAX LOAD` / `DISTANCE BUILD` (default) / `CONDITIONING`. Swipe / tap navigates between zones. Each zone has its own recommended `(target_distance, weight_modifier)` profile.

4. **Hero card** (`YOUR NEXT TRAINING TARGET`):
   - Same min-h-220 blue chrome as weighted/assisted.
   - Top-right info pill for the active zone with inline expandable info panel (mirrors weighted's pattern).
   - **Two stacked target rows**, each its own animated TickerNumber. Right-side text is a plain delta vs. the user's best (NO formulas, NO abstract "weightPct"):
     - **Top row — weight**: `<TickerNumber: W_target> <wUnit>` + delta string (`+ <diff> <wUnit>` if heavier, `same as your best` if equal, `− <diff> <wUnit>` if lighter).
     - **Bottom row — distance**: `<TickerNumber: D_target> <dUnit>` + delta string (`+ <diff> <dUnit>` if longer, `same as your best` if equal — distance never goes below best in any zone).
   - Thin separator + cue line specific to the active zone, plugging the same `W_target` / `D_target` numbers. e.g. for MAX LOAD: `Carry <W_target> <wUnit> for <D_target> <dUnit> — focus on grip and posture` (verb is "Carry", not "Walk" — applies to all carry variants including stone bear-hug carries which aren't walked).

5. **Chart** — single **Total work** line chart (metric = `weight × distance` per effort, plotted over time). Replaces the earlier two-chart (weight + distance) layout — a distance-only PR was invisible on a weight-only graph, so the two axes consolidate into one total-work metric. PB dashed line = best total work. **NOTE (locked):** a deliberate heavier-but-shorter (MAX LOAD zone) session can read LOWER than a lighter-longer one because it's genuinely *less total work* — expected, not a regression; the caption states this. The hero's two targets (go heavier / go farther) + the log list (each effort shown as `weight × distance`) carry the per-axis breakdown. Same on athlete mobile + coach web (AdminStrengthCarryDetail) + the coach Efforts card. **Terminology (locked June 2026):** the label is "**Total work**", NOT "Workload" — "workload" in S&C usually means training volume, so total work (= force × distance) is the precise term. Do not reintroduce "Workload" as a user-facing label.

6. **Log list** — same row format. Each row shows `<weight> × <distance>` and a timestamp.

**Adaptation zone target derivation (locked):**
For the selected zone, the hero's two TickerNumbers are computed directly from the user's `bestWeight` and `bestDist` (both already in display unit), with zone-specific transformations:
```
bestWeight = heaviest logged effort (display unit, rounded)
bestDist   = longest logged effort (display unit, rounded)
wInc       = displayUnit === 'kg' ? 2.5 : 5
dInc       = distUnit    === 'm'  ? 5   : 10
ladder     = carryLadderFor(exercise, displayUnit)   // null if no ladder applies

// MAX LOAD — heavier weight, same distance:
W_target = ladder
  ? (nextLadderAbove(bestWeight, ladder) ?? bestWeight)
  : bestWeight + wInc
D_target = bestDist

// DISTANCE BUILD — same weight, longer distance:
W_target = bestWeight
D_target = bestDist + dInc

// CONDITIONING — lighter weight, double the distance:
W_raw    = bestWeight * 0.60
W_target = ladder
  ? snapDownToLadder(W_raw, ladder)
  : snapDownToInc(W_raw, wInc)
D_target = bestDist * 2

// Anchor on PB existence — once both axes have data, all three zones produce prescriptions:
hasTargets = bestWeight > 0 && bestDist > 0

// Delta strings shown to the right of each TickerNumber:
weightDeltaText =
  W_target > bestWeight ? `+ ${W_target - bestWeight} ${wUnit}`
  : W_target < bestWeight ? `− ${bestWeight - W_target} ${wUnit}`
  : 'same as your best'
distDeltaText =
  D_target > bestDist ? `+ ${D_target - bestDist} ${dUnit}`
  : 'same as your best'

// Cue line plugs the SAME W_target / D_target values shown in the TickerNumbers:
cueLine = `Carry ${W_target} ${wUnit} for ${D_target} ${dUnit} — ${zoneAdvice}`
// where snapDownToInc(value, inc) = Math.floor(value / inc) * inc
```

Each zone produces DIFFERENT targets because each pushes a different axis. Worked example — **Atlas Stone Bear Hug Carry**, user PB = 60 kg × 15 m, ladder = `[60, 80, 100, 120, 140, 160, 180, 200]`:
- MAX LOAD       → `80 kg × 15 m` → weight delta `+ 20 kg`, distance delta `same as your best`
- DISTANCE BUILD → `60 kg × 20 m` → weight delta `same as your best`, distance delta `+ 5 m`
- CONDITIONING   → `60 kg × 30 m` → weight delta `same as your best` (snap-down clamped at the lowest rung 60 kg, since 60 × 0.6 = 36 falls below the ladder), distance delta `+ 15 m`

Worked example — **Farmer's Carry** (no ladder), user PB = 100 kg × 50 m:
- MAX LOAD       → `102.5 kg × 50 m` → `+ 2.5 kg`, `same as your best`
- DISTANCE BUILD → `100 kg × 55 m`   → `same as your best`, `+ 5 m`
- CONDITIONING   → `60 kg × 100 m`   → `− 40 kg`, `+ 50 m`

**Per-movement weight ladders (locked — mobile-only refinement, web still uses generic snap):**

For strongman objects (Atlas Stones, D-Balls, Husafell, Keg, Shield, Yoke, Sandbag) and kettlebell carries, gyms only stock fixed discrete sizes. Showing "102.5 kg" for an Atlas Stone is meaningless — that's not a real stone. So mobile's `CarryDetail` swaps the generic 2.5 kg / 5 lb snap for a per-movement ladder of REAL equipment weights. The `heavierW` value snaps to the next available rung rather than adding `wInc`. Movements NOT in the map (Farmer's Carry, Single Arm Farmer's Carry, Suitcase Carry, Sled, Vehicle Pull) keep the generic increment snap.

```ts
const CARRY_WEIGHT_LADDERS: Record<string, { kg?: number[]; lb?: number[] }> = {
  // ── kg-locked strongman objects (single ladder, kg only)
  'Atlas Stone Bear Hug Carry': { kg: [60, 80, 100, 120, 140, 160, 180, 200] },
  'D-Ball Bear Hug Carry':      { kg: [30, 40, 50, 60, 70, 80, 90, 100] },
  'Husafell Stone Carry':       { kg: [100, 120, 140, 160, 180, 200] },
  'Keg Carry':                  { kg: [40, 60, 80, 100, 120] },
  'Shield Carry':               { kg: [30, 40, 50, 60, 75, 100] },
  'Yoke Carry':                 { kg: [100, 140, 180, 220, 260, 300, 340] },
  // Sandbag isn't unit-locked (flexible kg/lb)
  'Sandbag Carry': {
    kg: [25, 35, 50, 65, 80, 100, 125],
    lb: [50, 75, 100, 125, 150, 175, 200, 250],
  },
  // ── Kettlebell carries (flexible kg/lb)
  "Kettlebell Farmer's Carry": {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  'Kettlebell Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  'Single Arm Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
}
```

Ladder helpers (used by the zone-math derivation above):

- `snapDownToLadder(value, ladder)` returns the largest rung ≤ `value`. If `value` is below the lowest rung, returns the lowest rung (a beginner never sees "0 kg"). Used for CONDITIONING's `W_target`.
- `nextLadderAbove(value, ladder)` returns the smallest rung > `value`, or `null` if `value` is already ≥ the heaviest rung (in which case MAX LOAD's `W_target` falls back to `bestWeight`). Used for MAX LOAD's `W_target`.
- The distance math is always continuous, never laddered.

Worked example — **Kettlebell Farmer's Carry** in lb mode, user PB = 60 lb × 30 ft, ladder = `[10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100]`:
- MAX LOAD       → `70 lb × 30 ft`  → `+ 10 lb`, `same as your best`
- DISTANCE BUILD → `60 lb × 40 ft`  → `same as your best`, `+ 10 ft`
- CONDITIONING   → `35 lb × 60 ft`  → `− 25 lb` (snapDownToLadder(36, ladder) = 35), `+ 30 ft`

**State management:**
- `selZone` controls which zone pill is highlighted (default: `'distance_build'`).
- `selectedTier` controls which tier's info panel is open in the ladder (default: user's current tier).
- Swipe/tap pill = scroll-to + setSelZone.
- Outside-click closes the tier info panel.

**What's removed from the previous CarryDetail design:**
- The 2-stat-card grid (`Best distance` + `Best weight`). Replaced by the unified header subtitle + tier ladder card.
- The single-axis chart. Replaced by dual-axis chart.

---

### Cardio coaching-surface detail card — locked design spec

This is the spec for the detail page that covers **cardio movements** on `[activity].tsx` (mobile). Cardio v1 promotes from tracking surface to coaching surface, matching strength's depth.

**Three movement groups (May 2026 lock, revised after non-cardio cleanup):** not every cardio movement fits the same progression model. The user explicitly rejected forcing one framework onto everything during the design lock. A subsequent cleanup (May 17 2026) removed 10 activities from cardio entirely — Walking, Walking (Treadmill), Hiking, Rowing (Open Water), Canoeing, Kayaking, Stand Up Paddleboarding, Inline Skating, Ice Skating, and Stair Climb (outdoor). Those are **recreational / lifestyle activities**, not cardio training surfaces — the user does them for transport, leisure, or outdoor enjoyment rather than to deliberately improve cardio fitness, so any coaching prescription would feel condescending. They might come back as a separate "activity log" surface later; they don't belong in the cardio coaching list.

| Group | Activities | Detail page treatment |
|-------|------------|----------------------|
| **A — Endurance Athletes** | Running, Running (Treadmill), Cycling, Stationary Bike, Bike Erg, Air Bike, Row Erg, Ski Erg, Swimming, Elliptical | Full **progression plan** with Endurance/Threshold/VO2 zones (this spec) |
| **B — Different framework needed** | Rucking | Cardio category but pace zones don't fit. Rucking progresses on load + distance (carry-like, not pace). Uses a carry-style 3-zone surface (Max Load / Distance Build / Conditioning) instead of pace zones. May 19 2026 removed Hill Running / Trail Running / Cycling (Mountain Bike) / Skiing entirely — terrain or technique confounds pace, recreational use for most users, and we can't coach honestly without HR integration. |
| **C — Step-Based Machines** | StairMill | Floors-per-minute coaching surface (rate-anchored, mirrors Air Bike's architecture but uses floors-per-minute as the rate metric). See "StairMill detail card — locked design spec" below. |

This spec covers **Group A only.** Group B's Rucking gets a carry-style 3-zone surface (see "Rucking detail card" spec below). Group C (StairMill) gets a floors-per-minute rate-anchored 3-zone surface (see "StairMill detail card" spec below).

Determined in code by `isEnduranceAthleteActivity(activityName)` → returns true for Group A categories.

**Two cardio modes still exist underneath** (`cardio_mode = 'pace'` vs `'duration'`), but Group A is all pace mode. Duration mode is Group C only, and routes to its own StairMillDetail coaching surface (short-circuits before the generic DurationDetail).

**Adaptation zones (3 zones, locked May 2026):**

The 5-zone HR model is still the underlying science, but the app exposes only the three zones that actually drive progression. **Recovery (Z1) is not training — it's the absence of training, and we don't program rest days for users.** **Tempo (Z3) is what polarized-training research calls "no man's land" — too hard to be efficient aerobic base, too easy to drive lactate-clearance or VO2 max adaptations.** Both dropped from the UI. This also gives perfect 1:1 parity with strength's 3-zone adp model (Strength / Hypertrophy / Endurance → Endurance / Threshold / VO2 Max).

| Zone | Label | %HRmax | Adaptation focus |
|------|-------|--------|------------------|
| Z2 | ENDURANCE | 60–70% | Mitochondrial density, capillary network, fat oxidation. The foundation of all endurance — 70–80% of total training volume per polarized model. |
| Z4 | THRESHOLD | 80–90% | Lactate clearance — the body learns to process lactate faster. THE pace that improves 5K–half marathon times most directly. 1–2 sessions per week max. |
| Z5 | VO2 MAX | 90–100% | Maximum oxygen uptake — your engine ceiling. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between. |

**Science backing (locked):** ACSM *Guidelines for Exercise Testing and Prescription* (12th ed., 2025); Karvonen, Kentala & Mustala (1957) for HR-reserve methodology; Jack Daniels' *Running Formula* (3rd ed., 2014) for VDOT-to-zone mapping; Garmin / Polar / Suunto / Apple Watch all default to the same 5-zone model. The 50/60/70/80/90% HRmax boundaries are the global standard, not novel.

Until heart-rate integration lands (Phase 2 — via Apple Health / Strava / Garmin / Polar), zones derive from **pace as the proxy**, anchored on the user's **Critical Speed** with the offsets below. Once HR data is available, zones recalibrate from actual HR.

**Per-zone pace formula (pace mode):**

**Anchor — Critical Speed (UPDATED June 2026, T088).** `Panchor` is the user's **Critical Speed** pace, not their single fastest effort. `criticalSpeedPaceSecsPerKm(efforts)` fits a least-squares line of time-vs-distance across the fastest effort at each DISTINCT logged distance; the slope (distance in km) IS the CS pace in s/km. With <2 distinct distances logged it falls back to the fastest pace `Pbest`. *Why:* a single fastest pace is usually a short, anaerobic-heavy effort, so anchoring zones on it made every prescription too hard; CS is the honest sustainable-threshold anchor. Only the zone PRESCRIPTIONS use `Panchor` — the "Best pace —" header subtitle + the chart PB reference line still show the actual fastest `Pbest`. Mobile `[activity].tsx` PaceDetail + web `AdminCardioPaceDetail.jsx` (BeatYourBest is untouched — it has no zone plan queue).

| Zone | Target pace offset (running, /km) | Notes |
|------|-----------------------------------|-------|
| Z2 | `Panchor + 60 s/km` | conversational, aerobic base |
| Z4 | `Panchor + 10 s/km` | ≈ 10K race pace, "comfortably hard sustained" |
| Z5 | `Panchor − 15 s/km` | ≈ 3K race pace, "max sustainable" |

Offsets scale to the activity's pace units (km or mi) and are applied **uniformly across modalities** today (running, cycling, ergs, elliptical). The audit's other half — per-modality power/HR zones (power for ergs/bike, HR/RPE for elliptical) — is **DEFERRED to V2** (it needs the HR/power data the Phase-2 wearable integrations will provide). Riegel projection (`projectPaces` in `formulas.ts`) still handles cross-distance pace mapping for the tiles.

**Per-zone session prescription (the hero card cue):**

| Zone | Session format | Source |
|------|----------------|--------|
| Z1 | Continuous easy, 20–40 min | ACSM recovery-day prescription |
| Z2 | Continuous, 30–90 min | Phil Maffetone (MAF method) · Iñigo San Millán (polarized training) · ACSM aerobic-base recommendation |
| Z3 | Continuous, 20–40 min at "comfortably hard" | Pete Pfitzinger marathon training · Daniels' "T pace" continuous |
| Z4 | Cruise intervals: 4–6 × 1km at T-pace with 1 min jog recovery (or 3–4 × 1.5K, or 2 × 3K) | Daniels' Running Formula — canonical "Cruise Intervals" |
| Z5 | Short intervals: 3–5 × 1km at I-pace with equal recovery, OR Norwegian 4×4 min at VO2 pace | Veronique Billat (time-at-VO2max research) · Daniels' "I pace" · Stephen Seiler / Marius Bakken (Norwegian model) |

For non-running activities, the prescriptions translate naturally:
- Rowing: 1km reps → 500m / 1000m intervals
- Swimming: 1km reps → 4 × 200m / 8 × 100m
- Cycling: time-based intervals (3–5 min reps)
- Duration-mode movements: time-at-zone (e.g. "20 min at Z3 tempo intensity · maintain consistent rhythm")

**Layout — single page, top to bottom (locked):**

1. **Header** — back chevron + movement name + best-effort subtitle.
   - Pace mode: `Best pace — 4:30 /km · 5K` (`TickerNumber` on the pace value).
   - Duration mode: `Best — 30 min`.
   - Activity-type chip below header (e.g. `RUNNING`, `CYCLING`, `ROWING`, `BATTLE ROPES`).

2. **Progression plan card** (wrapper card, replaces the earlier "Adaptation zone" card):
   - `<h2>Progression plan</h2>`
   - Help text: `Your next step is below. After that, here's what's coming up.`
   - **NO ZONE PILL ROW.** The earlier swipe-pill design let the user pick the zone, but the user explicitly rejected that approach during the May 2026 lock — *"the system should pick what's next, not me"*. The plan generator decides the zone for each step. Zone info is still discoverable via the info pill on the hero card's top-right.
   - **NO TILE ROW for distance selection.** Distance/duration is locked per `(activity, zone)` in `PACE_ZONE_SESSIONS`. The user picks a movement and follows the plan; they don't pick distances.
   - **NEXT STEP hero card** — same `min-h-[220px]` amber-chrome layout as before. Background `withAlpha(palette.amber[500], 0.08)`, border `withAlpha(palette.amber[500], 0.30)`, title `palette.amber[400]`. Title now reads `NEXT STEP` (was `YOUR NEXT TRAINING TARGET`):
     - Top-right zone info pill — label + Info icon. Tappable to expand inline why-this-zone info panel. Auto-closes when the plan queue regenerates.
     - **Two-row body, no clutter:**
       - **Row 1 (WORK)**: `X km` (continuous) or `N × X km` (intervals). Sub-1km values render in meters: `5 × 600 m`, not `5 × 0.6 km`.
       - **Row 2 (TIME)**: bare time. Continuous = total session time (e.g. `37:30`). Intervals = time per rep (e.g. `3:48`). NO prefix (`in`, `per rep`, etc.) — the cue below spells out what the number is.
     - Thin separator + **full workout descriptor cue line** — one sentence containing the activity verb, work, time, rest pattern, and recovery instruction. Activity verb auto-adapts: `Run`/`Pedal`/`Row`/`Swim`/`Walk`/`Skate`/`Glide`. Rest is **informative only** — *"then take 1 day easy before your next step"*, *"next step whenever you're ready"*. No mandatory rests.
   - **COMING UP queue (8-tile horizontal scroll)**:
     - Shows 7 upcoming steps (after the current) generated live by `generatePlanQueue(activity, efforts, bestPaceSecs, distUnit, 8)`.
     - Each tile shows: zone label (small caps), work spec, time spec, rest descriptor.
     - All tiles tappable. Tapping a tile expands a preview panel below the scroll row showing the tile's full cue + an encouraging reminder: *"Finish your current step first — this one's queued up after."*
     - The queue is **regenerated on every render** from training history. Never stored. Never stale.
   - **Attribution under the queue:** `Riegel · Daniels' · Seiler · pace zones & polarized 80/20`. Three names credit the formulas we actually compute against: Riegel (`projectPaces` pace projection across distances), Daniels' (zone pace offsets — Endurance = best + 60s/km, Threshold = best + 10s/km, VO2 = best − 15s/km — and the cruise-interval / VO2-rep session formats), Seiler (polarized 80/20 queue rules — no hard back-to-back, ~80% Endurance distribution). Two trailing descriptors joined with `&` (NOT `·`) so they read as a single bundled description rather than two more authorities: "pace zones" describes the output type (paces by zone), "polarized 80/20" labels the queue philosophy. ACSM and Coggan/Concept2/USA-Swimming were dropped because the math doesn't actually invoke them — HR zones are Phase 2, and we apply Daniels' pace logic uniformly across all Group A activities (running, cycling, air bike, rowing, swimming, ski erg, elliptical), not sport-specific frameworks. Same string on every activity. "Daniels'" drops "Running Formula" intentionally — we credit the person/methodology, not the book title, mirroring strength's `Epley · Brzycki · Lombardi` convention.
   - **45-min total-time ceiling** — enforced by `adjustPaceForTimeCap` per step. For continuous zones, distance shrinks via `niceCapKm`. For interval zones, rep count drops until total ≤ 45 min. The product philosophy: *the app pushes you to become better, not to chase event distances you'll never train for.*

   **Per-activity prescribed sessions (locked, May 2026):** see `PACE_ZONE_SESSIONS` and `DURATION_ZONE_SESSIONS` in `mobile/app/(app)/effort/cardio/[activity].tsx`. Highlights:

   | Activity | Recovery | Endurance | Tempo | Threshold | VO2 Max |
   |----------|----------|-----------|-------|-----------|---------|
   | Running / Treadmill | 3 km easy | 8 km steady | 5 km tempo | 4 × 1 km | 5 × 600 m |
   | Walking | 1.5 km | 4 km | 3 km | 4 × 500 m | 5 × 300 m |
   | Hiking | 3 km | 10 km | 6 km | 4 × 1 km | 5 × 600 m |
   | Rucking | 2 km | 6 km | 4 km | 4 × 750 m | 5 × 400 m |
   | Outdoor Cycling | 10 km | 25 km | 15 km | 4 × 3 km | 5 × 1.6 km |
   | Stationary Bike | 5 km | 15 km | 10 km | 4 × 2 km | 5 × 1 km |
   | Air Bike / Assault Bike | 1.5 km | 2.5 km | 1.5 km | 3 × 500 m | 5 × 200 m |
   | Rowing / Canoe / Kayak | 2 km | 4 km | 3 km | 3 × 1 km | 4 × 500 m |
   | Ski Erg | 2 km | 4 km | 3 km | 3 × 1 km | 4 × 500 m |
   | Swimming | 400 m | 1500 m | 1000 m | 4 × 200 m | 4 × 100 m |
   | Elliptical | 2 km | 5 km | 4 km | 4 × 750 m | 5 × 400 m |
   | Skating | 3 km | 8 km | 5 km | 4 × 1 km | 5 × 600 m |
   | StairMill (duration) | 10 min | 25 min | 15 min | 4 × 3 min | 5 × 90 s |
   | Arc Trainer (duration) | 15 min | 30 min | 20 min | 4 × 3.5 min | 5 × 2 min |

   **No activity prescribes anything close to event distances** — no marathon, no 100 km bike, no half-Ironman swim. The largest single-session prescription is 25 km on outdoor cycling. The product philosophy is "push you to become better at the science-backed adaptation that matters", not "chase distance records you'll never train for".

3. **Why-this-zone info panel** — inline expandable, toggled by tapping the zone info pill on the current-step hero. Auto-closes when the plan queue regenerates. Same pattern as strength's adp-zone info panel (`FadeInUp` / `FadeOutUp`). Each zone has a `whyText` field in `CARDIO_ZONE_CONFIG`:
   - **ENDURANCE**: *"Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine. Stay disciplined and conversational; resist the urge to push."*
   - **THRESHOLD**: *"The single most productive zone for race times from 5K to half marathon. Cruise intervals teach your body to clear lactate faster, raising the speed you can sustain. 1–2 sessions per week max."*
   - **VO2 MAX**: *"Top-end stress. Short intervals at max sustainable effort build VO2 max — your engine ceiling — and pull every zone below up with them. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between."*

**Plan-queue generator (LOCKED):** `generatePlanQueue(activity, efforts, bestPace, distUnit, count=8)` in `[activity].tsx`. Pure function of training history. Walks polarized-training rules to build a sequence of upcoming zones:

1. **No hard back-to-back** — after a Threshold or VO2 step, next is Endurance.
2. **Don't let VO2 go stale** — if 10+ days since last Z5, next non-recovery step is VO2.
3. **Don't let Threshold go stale** — if 7+ days since last Z4, next non-recovery step is Threshold.
4. **Anti-stagnation interleave** — after 3 Endurance steps in a row, insert a hard step (alternates T/V).
5. **Default: Endurance** — produces the ~80% Endurance / 20% T+V polarized split (Stephen Seiler's research).

The queue is **never stored**. Logging a new effort updates `bestPaceSecs` and recency tracking, which regenerates a different queue on next render. The plan adapts continuously.

**Encouraging language is LOCKED across the cardio progression UI.** No "missed pace", no "off-script", no "incomplete". Replacements:
- `Welcome back — let's pick up where you left off.` (instead of "plan stale")
- `Same step is still your next one — no rush.` (instead of "incomplete")
- `Solid effort. Same step next time — your body's building toward it.` (instead of "missed pace, try again")
- `Got a session in — adjusting your plan around it.` (instead of "off-script training")
- `Finish your current step first — this one's queued up after.` (preview-tile note)

Voice: a coach who trusts the athlete. Never punitive. Always assumes the user is doing their best.

4. **Progress chart** — existing `LineChart` component. Pace mode: Y-axis reversed (lower pace = better progress). Duration mode: standard Y-axis (higher = better). Dashed line = personal best. Unchanged from today.

5. **Log list** — efforts history, swipe-to-delete. Same row format as today.

**Color theme (locked):**
- **Cardio is amber end-to-end.** Zone pill / chevrons / tile highlights / hero values / hero chrome / hero title / info panel border — all `palette.amber[400]` and `palette.amber[500]`. Strength keeps its blue theme, cardio keeps amber. The two domains are distinguished at a glance by their accent color — DO NOT use blue chrome on cardio's hero card. This was an explicit user instruction during the May 2026 lock; a prior draft of this spec mistakenly proposed blue chrome for parity with strength's "next target" badge, and the user correctly rejected it.

**Animation conventions (carried over from strength — no deviation):**
- Big pace/duration number on hero card uses `TickerNumber` slot-machine animation.
- Info panel open/close uses `FadeInUp` / `FadeOutUp` with sibling `LinearTransition` so the hero card slides smoothly when the panel opens.
- Zone pill swipe choreography matches strength exactly (gesture-handler `Pan`, chevron opacity override, slide-off / slide-in via Reanimated `withTiming`).

**Movements supported (locked, May 2026):**

Pace mode: all run / cycle / row / ski erg / swim / elliptical / treadmill / skating / skiing variants with distance + time inputs.

Duration mode: Arc Trainer, StairMill.

**Movements REMOVED from cardio (May 2026 cleanup — locked):**
- **Jump Rope** — covered by Single Unders / Double Unders in strength as rep-only bodyweight movements. No need for a duration-mode duplicate.
- **Agility drills**: Agility Ladder Drills, Carioca, Lateral Shuffles, Line Drills. Skill / warm-up work — zone framework doesn't add coaching value here.
- **Sprint-style**: Box Step Overs, Shuttle Run, Slideboard. Same rationale as agility drills; cleaner cardio list is better than mixed.
- **Conditioning fluff**: Battle Ropes, Shadow Boxing, Speed Bag. Couldn't be tracked in a way the rest of the system could use; removed entirely rather than left as orphan duration entries.
- **Floor-work cardio**: Bear Crawl, Crab Walk, Low Crawl. Same reasoning as conditioning fluff — not useful in the progression model.
- **Niche vertical-climber machines**: VersaClimber, Jacob's Ladder. Removed for cardio-list simplicity — niche enough (HIIT studios, CrossFit boxes, specialty gyms) that removing them costs little coverage. StairMill + Arc Trainer (the common commercial-gym duration machines) kept.
- **Duplicate indoor cycling variants**: `Cycling (Indoor Trainer)` + `Indoor Cycling` consolidated into `Stationary Bike`. `Bike Erg` kept as a separate entry (Concept2-specific, different machine, recognized by serious users).
- **Duplicate treadmill variant**: `Curved Treadmill` consolidated into `Running (Treadmill)` (the user logs the same data either way).
- **Duplicate swimming variant**: `Swimming (Open Water)` consolidated into bare `Swimming` (pool vs open-water distinction was unused).

**Renamed in cardio (May 2026 cleanup — locked):**
- `Rowing` → `Rowing (Open Water)` to disambiguate from `Row Erg` (the machine).

**Final cardio movements list (15 DB rows, 12 visible activities — May 19 2026 lock, after recreational/terrain-confounded cleanup + swim stroke consolidation):** Air Bike, Bike Erg, Cycling, Elliptical, Row Erg, Rucking, Running, Running (Treadmill), Ski Erg, StairMill, Stationary Bike, **Swimming [Freestyle], Swimming [Backstroke], Swimming [Breaststroke], Swimming [Butterfly]**. The 4 Swimming stroke variants collapse into a single "Swimming" row in the cardio index (so the user-visible activity count is 12 even though the movements table has 15 rows). See "Swimming detail card — locked design spec" further down for the consolidation architecture.

**Removed from cardio (May 17–19 2026, three passes):**
- **Pass 1 (recreational/lifestyle — not cardio training):** Walking, Walking (Treadmill), Hiking, Stair Climb (outdoor), Rowing (Open Water), Canoeing, Kayaking, Stand Up Paddleboarding, Inline Skating, Ice Skating. Rationale: transport, leisure, or outdoor activities — the user doesn't pick them with intent to improve cardio fitness, intensity isn't deliberately modulated, and a coaching prescription would be condescending. May come back as part of a separate "activity log" surface (where lifestyle movement counts toward weekly minutes / calories / streaks without a coaching layer).
- **Pass 2 (niche-equipment / niche-user — low coverage value):** Aqua Jogging (rehab-only cross-training for injured runners; tiny user base), Roller Skiing (off-season training tool for competitive Nordic skiers only; <1% of any realistic user base), Arc Trainer (Cybex-brand machine found in ~30% of commercial gyms; most users encounter Elliptical or StairMill instead). Rationale: niche enough that removing them costs essentially no coverage and simplifies the catalog.
- **Pass 3 (terrain-confounded / recreational + can't coach honestly without HR — May 19 2026):** Skiing (outdoor XC — snow conditions + terrain + technique confound pace, niche audience, seasonal — can't coach honestly without HR + lactate calibration), Hill Running (gradient confounds pace), Trail Running (single-track terrain confounds pace, recreational for most users), Cycling (Mountain Bike) (technical terrain confounds pace, can't coach intervals honestly without HR or power telemetry). Rationale per the May 19 audit: a strict coaching-and-progression app shouldn't display a coaching prescription it can't validate. These activities have no scientifically valid v1 coaching path with the data we have access to.

**Earlier May 2026 cleanup** also moved `Sandbag Carry`, `Sled Pull`, and `Sled Push` to strength — they're loaded carries, not endurance/lifestyle movement. See Sled Work note in the strength Carry detail spec.

The mirror update lives in: the Supabase `movements` table (single source of truth for mobile) and `mobile/app/(app)/effort/cardio/[activity].tsx` (`categorizeActivity` regex, `PACE_ZONE_SESSIONS` keys, `DURATION_ZONE_SESSIONS` keys), plus `mobile/src/lib/movements.ts` (`SPEED_INPUT_ACTIVITIES` set + `SPEED_MAX_KMH` map). After Pass 3 the `categorizeActivity` regex no longer maps `skiing` (the outdoor activity) to `ski_erg`; only `ski erg` itself matches that category. `web/src/lib/movements.js` is kept in sync where practical, but web is frozen per the May 12 2026 lock so minor drift is allowed.

**Out of v1 scope (deferred, locked):**
- **RPE rating field** on log form — adds no value to zone calculations (pace IS the zone proxy until HR lands). Revisit if coaches request it after the coaching surface is live.
- **Notes field** on log form — pure UX, defer.
- **Per-session calorie auto-estimation** — handled inside the upcoming Calories page overhaul (separate conversation).
- **Heart rate via integration** (Apple Health / Strava / Garmin / Polar) — Phase 2. When it lands, zones recalibrate automatically from actual HR data.

**What's removed from the previous PaceDetail / DurationDetail design:**
- The single "Your next training target" callout that prescribed only a pace at a distance with no session structure, no rest cue, no why explanation. Replaced by the zone-aware hero card with full Daniels-style prescription.
- The implicit "always train at race pace" model. Replaced by 5 explicit adaptation zones, each with its own pace target and session format.

---

### Concept2 ergs (Row Erg / Bike Erg / Ski Erg) — locked design spec (May 19 2026)

All three Concept2 PM5-powered ergs share the same flywheel mechanics, the same display console, and the same coaching surface in MyRX. They route through the generic `PaceDetail` component with shared erg-aware branching — NOT three separate components — because the pace-zone framework (Endurance / Threshold / VO2 Max) fits all three identically. What differs is per-activity labels and rest-cue verbs, handled inline via `isRowErgActivity` / `isConcept2ErgActivity` predicates.

**1. Distance display rule (LOCKED — applies to all 3 ergs):**

Distance ALWAYS renders in metric, regardless of the user's `distance_unit` profile preference. The PM5 console is universally metric worldwide; Concept2 athletes (rowers, OCR competitors, Crossfitters, swimmers cross-training) think in meters and kilometers regardless of locale.

- `<1 km` → integer meters (`"500 m"`, `"999 m"`)
- `≥1 km` → km with sensible precision (`"1.5 km"`, `"5 km"`, `"10 km"`). Trailing zeros stripped: `5.00 km` reads as `5 km`; `1.50 km` reads as `1.5 km`.

Implemented in `fmtDistForActivity(activity, distKm, distUnit)` which short-circuits on `isConcept2ErgActivity(activity)` and ignores `distUnit` entirely.

**2. Pace display rule (LOCKED):**

Pace renders as **split per 500m** — the canonical Concept2 metric across all three ergs. Storage stays in seconds-per-km for cross-cardio uniformity; the per-500m is a display-layer transform via `pacePer500mFromSecsPerKm(secsPerKm)` (divides by 2 and formats as `m:ss/500m`).

- Header subtitle: `Best — m:ss/500m · NNN W` (split AND watts, side by side, both `TickerNumber`-animated).
- Chart Y-axis labels, tooltip values, log-list right-side metric — all per-500m.
- The word "Pace" doesn't appear on erg surfaces; "Best —" replaces "Best pace —".

**3. Watts↔pace formula (LOCKED — verified against Concept2's published table):**

Concept2's official pace-to-watts formula:

```
pace_m_per_s = 1000 / pace_sec_per_km
watts = 2.80 × (pace_m_per_s)³
```

Mathematically equivalent to Concept2's documented `watts = 2.80 / (pace_sec_per_meter)³`. Cross-check against Concept2's published values:

| Pace | m/s | Computed watts | Concept2 published |
|------|-----|----------------|---------------------|
| 2:00/500m | 4.167 | 203 W | ~203 W ✓ |
| 1:45/500m | 4.762 | 302 W | ~302 W ✓ |
| 2:30/500m | 3.333 | 104 W | ~104 W ✓ |

The cubic relationship comes from fluid-resistance drag on the flywheel (same physics as bike aerodynamics: power scales with velocity cubed in a drag-dominated system). The 2.80 J/m drag-factor constant is set by Concept2's PM5 calibration and is identical across Row Erg, Bike Erg, and Ski Erg — they share the same engine.

Implementation: `pacePer500mToWatts(secsPerKm)` in `mobile/src/lib/movements.ts`. Returns rounded integer watts (PM5 consoles display ints).

**Per-erg note:** The Bike Erg's PM5 calibrates flywheel revolutions to display "distance" in a way that gives equivalent power to Row Erg at the same pace. The Ski Erg uses the same flywheel mechanics. So applying the same formula across all three is **industry standard** (Concept2's own online pace-watts calculator uses the unified formula).

**4. Hero card — 4 rows for ergs (LOCKED):**

The PaceDetail hero card renders 4 stacked TickerNumber rows for Concept2 ergs ONLY (1 extra row vs. the generic 3-row hero):

1. **Workout goal** — `8 km` (continuous) or `5 × 600 m` (interval). Big amber, fontSize 30.
2. **Time** — `:30` per interval or `37:30` total. Descriptor "to complete" or "per interval".
3. **Checkpoint assist** — sub-distance pacing reading (e.g. "`200 m` at 50 sec / `500 m` at 2:05 / `1 km` at 4:10"). The user reads this mid-rep on the PM5 to verify they haven't drifted off target pace. Hidden when the rep is too short (<500m) to benefit from a checkpoint.
4. **Watts target** — `203 W`, derived from the prescribed zone pace via the Concept2 formula. Descriptor "watts target".

Row 4 is hidden on every non-erg activity. Conditional via `selectedStep.ergWattsTarget != null`. Same `TickerNumber` styling as the other 3 rows.

**Why 4 rows and not 3:** the PM5 displays BOTH pace and watts simultaneously on its console. A coach prescribing erg work always gives both. Forcing the user to mentally derive one from the other defeats the point of the coaching surface — the watts target is a direct PM5-readable number, not a derivation.

**5. Cue line construction (LOCKED):**

The cue does NOT mention watts (watts lives on Row 4). The cue focuses on workout structure + checkpoint pacing. For Row Erg specifically, "pace" is replaced with "split" and the per-500m split is referenced inline:

- Endurance continuous (Row Erg): `"Row 5 km in 25:00 at a steady 2:30/500m split — aim for 2:30 at 500 m."`
- Threshold interval (Row Erg): `"Row 4 × 1 km at 2:05/500m split (4:10 each)."`
- Endurance continuous (Bike Erg / Ski Erg): `"Pedal 15 km in 45:00 at steady conversation pace — aim for 4:00 at 1 km."`
- Threshold interval (Bike Erg / Ski Erg): `"Glide 4 × 1 km in 4:10 each — aim for 2:05 at 500 m."`

Verb is activity-aware: `Row` for Row Erg, `Pedal` for Bike Erg, `Glide` for Ski Erg.

**6. Rest cue verb (LOCKED):**

- **Row Erg**: `"Paddle easy 60 sec between cruise intervals"` / `"Equal-time paddle recovery between intervals"`. Rowers paddle easy between reps, they don't jog.
- **Bike Erg / Ski Erg**: `"Easy pedal 60 sec between cruise intervals"` (bike) / `"Easy glide 60 sec between cruise intervals"` (ski). Activity-verb interpolated from `getActivityVerb`.

**7. Adaptation zones (LOCKED — Daniels' offsets applied uniformly across all 3 ergs):**

| Zone | Pace offset (sec/km) | Effect on a 200 W rower (~2:00/500m best) |
|------|----------------------|-------------------------------------------|
| Endurance | +60 | ~2:30/500m, ~104 W |
| Threshold | +10 | ~2:05/500m, ~179 W |
| VO2 Max | −15 | ~1:52.5/500m, ~247 W |

These watts fall within ±10% of published Concept2 zone watts (UT2/AT/AN) for an athlete with the same baseline. The Daniels' running offsets translate to rowing/cycling/skiing power zones cleanly because of the cubic pace↔watts relationship — small pace changes produce zone-appropriate watts changes.

**Why Daniels' offsets instead of Concept2's UT2/UT1/AT/TR/AN naming:** modern polarized coaching has converged on 3-zone (Endurance / Threshold / VO2) across endurance disciplines (Stephen Seiler, Iñigo San Millán, Norwegian sprint method). MyRX uses E/T/V uniformly across running, swimming, cycling, AND ergs so the user learns ONE zone model. Concept2's 5-zone naming is an old rowing-specific convention.

**8. Canonical session distances per zone (LOCKED — `PACE_ZONE_SESSIONS`):**

Row Erg:
- Endurance: 2K, 5K, 10K (2K is the test distance; 5K is the standard medium piece; 10K is the long piece)
- Threshold: 4×500m, 5×1000m (canonical T-pace test sets used at every level from masters to Olympic prep)
- VO2 Max: 6×500m, 8×500m (Norwegian sprint sets; 8×500m is widely benchmarked)

Bike Erg / Ski Erg: shares the same `rowing` entry in `PACE_ZONE_SESSIONS` (because the distances translate cleanly — a 5K row, a 5K bike erg, and a 5K ski erg are all roughly 20-25 min steady-state efforts at the same fitness level).

**9. Limitations + deferred (out of v1 scope):**

- **`bestPaceSecs` anchoring** assumes the user's best logged pace ≈ their 5K race pace. If they only logged a 500m sprint or a 60-min steady, offsets produce slightly skewed zone targets. Same limitation exists across every pace activity in the system — not erg-specific. Acceptable for advisory coaching.
- **Stroke rate (SPM)** — Concept2 PM5 displays stroke rate alongside split. v2.
- **Drag factor** — Concept2 setting that affects perceived effort. Out of scope; users self-set this on the machine.
- **2K benchmark test mode** — the canonical rowing/erg benchmark. Would warrant a dedicated "test mode" log entry + benchmark tracking on the detail page. v2.
- **Watts-based logging** — currently we derive watts from pace. If the user logs an interval session, they don't enter watts directly; the system computes them from pace. v2 if users ask.
- **Sport-specific bike/ski erg movements** — Bike Erg is sometimes set up for HIIT-style "max calories in 60 sec" tests; Ski Erg has "100m sprint" benchmark sets. v2.

**10. Implementation summary (LOCKED — what NOT to refactor):**

- **No separate components**: all 3 ergs route through `PaceDetail` with conditional branching via `isRowErgActivity` (for Row Erg's "split" language) and `isConcept2ErgActivity` (for all 3 ergs' watts row, metric distance, and metric subtitle).
- **Helpers in `mobile/src/lib/movements.ts`**:
  - `ROW_ERG_ACTIVITY` = `'Row Erg'`
  - `CONCEPT2_ERG_ACTIVITIES` = `Set(['Row Erg', 'Bike Erg', 'Ski Erg'])`
  - `isRowErgActivity(name)` / `isConcept2ErgActivity(name)`
  - `pacePer500mFromSecsPerKm(secsPerKm)` — formats per-500m split string
  - `pacePer500mToWatts(secsPerKm)` — Concept2 watts formula
- **`PlanStep.ergWattsTarget: number | null`** — new field, set only for Concept2 ergs. Null for everyone else.
- **`fmtDistForActivity`** — short-circuits on `isConcept2ErgActivity` to apply metric rule, ignoring `distUnit`.
- **Log form (`cardio.tsx`)** — `isRowMode = isRowErgActivity(activity)` already shipped for Row Erg; Bike Erg and Ski Erg still use the generic km/mi log form (acceptable divergence — log form polish for all 3 ergs is v2).

**Activities list** — Row Erg shows `Best split — N:NN/500m`; Bike Erg and Ski Erg fall through to `Best pace — N:NN/km`. Cosmetic divergence accepted for v1.

---

### Rucking detail card — locked design spec (May 19 2026)

Rucking sits on the **cardio tab** by activity-tab placement but its progression model is **carry-like**, not pace-like. You get better at rucking by carrying HEAVIER or going FARTHER, not by getting FASTER. Pace is too sensitive to load and terrain to be a useful coaching anchor — a 35 lb × 3 mi ruck at 18:00/mi is a harder session than the same person walking 3 mi at 14:00/mi with no pack, and pace doesn't capture that.

The detail page mirrors **Atlas Stone Bear Hug Carry's abs-mode CarryDetail** top to bottom — same hero card shape, same 4-tier ladder, same 3 adaptation zones. Same as Atlas was built kg-only, Rucking is built **lb-only**: the GoRuck / US tactical-fitness community is universally imperial, and any conversion would lose recognition of canonical benchmark weights (35 lb = GoRuck Tough). Distance is locked to miles for the same reason.

**Unit locks (LOCKED):**
- Distance → **miles** via `movements.unit_lock = 'mi'` on the Rucking row.
- Pack weight → **pounds**, hard-coded in `RuckingDetail` and the cardio log form. The `unit_lock` column only holds ONE unit, so the weight-lock lives in code.

**Tier ladder (LOCKED — `RUCK_TIER_THRESHOLDS`):**

Stepped down from the GoRuck event ladder. TOUGH = the GoRuck Tough standard exactly (35 lb × 12 mi). Beginner / Intermediate / Advanced are sub-Tough progression stops. We don't include GoRuck Heavy (45 lb × 20 mi) or Selection (35 lb × 40 mi) because they require multi-hour sessions that exceed the app's 45-min session philosophy.

| Tier | Pack weight (lb) | Distance (mi) |
|------|------------------|---------------|
| BEGINNER | 10 | 2 |
| INTERMEDIATE | 20 | 4 |
| ADVANCED | 30 | 8 |
| TOUGH | 35 | 12 |

Qualification: a single effort must meet BOTH thresholds simultaneously (NOT cumulative across efforts). User's "current tier" is the highest tier they've cleared.

**Weight ladder (LOCKED — `RUCK_WEIGHT_LADDER_LB`):**

```
[10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]
```

Common GoRuck Sand Plate sizes (10 / 20 / 30 / 45 lb), Rogue Echo plate sizes (10 / 15 / 20 / 25 / 30 / 35 / 40 / 45 lb), and realistic stacked combinations. MAX LOAD and CONDITIONING zone math snap to ladder rungs so prescriptions correspond to plates the user can actually load.

**Pack-weight soft safety cap (LOCKED — June 2026):** the log form (`cardio.tsx`, `isRuckMode`) shows a **soft amber warning** (never a hard block) the moment the entered pack exceeds **~1/3 of the user's bodyweight** — the common safe-load ceiling for sustained loaded carries. Copy: *"Heads up: N lb is X% of your bodyweight. Rucking guidance keeps loaded carries near a third of bodyweight, so build up to this gradually."* Bodyweight comes from `profile.current_weight`, converted to lb (pack is lb-locked). It does NOT cap the wheel — the user can still log a real heavy ruck (data integrity). Mobile-only (web end-user log form is frozen; the coach view is read-only).

**Tiers stay ABSOLUTE (verify-first, June 2026):** a T088 audit claimed the tiers were mislabeled and should be bodyweight-relative — both refuted on inspection. Our tiers match the official GoRuck standard exactly (Light 20 / Tough 35 / Heavy 45 lb), which is **absolute** worldwide, so they are NOT scaled to bodyweight. The bodyweight relationship lives only in the soft safety cap above, as a separate guardrail.

**Adaptation zones (LOCKED — mirror Carry's exactly):**

| Zone | Weight target | Distance target |
|------|---------------|-----------------|
| MAX LOAD | `nextLadderAbove(bestWeight)` or `bestWeight` | `bestDist` |
| DISTANCE BUILD | `bestWeight` | `bestDist + 1 mi` |
| CONDITIONING | `snapDownToLadder(bestWeight × 0.60)` | `bestDist × 2` |

Each zone pushes ONE axis (or two for conditioning) anchored on the user's PB. Hero card renders the target + a delta string vs. the user's best (`+ 5 lb`, `same as your best`, `+ 1 mi`, etc.).

**Effort label format (LOCKED):**

Current format with pack weight:
```
Rucking · 35 lb × 2.5 mi in 45:00
```

Legacy format (pre-May-19-2026, no weight column on log form) — still parses, treated as `packLb = 0`:
```
Rucking · 2.5 mi in 45:00
```

`parseRuckLabel` handles both shapes. Users who logged before this spec see their old efforts at packLb = 0 (effectively bodyweight rucking).

**Layout — single page, top to bottom (LOCKED):**

1. **Header**: back chevron + "Rucking" h1 + subtitle `Best — N lb · N mi · TIER`. Both numbers `TickerNumber`-animated; tier label in amber.
2. **Adaptation zone card** (`<AnimateRise delay={0}>`):
   - Title "Adaptation zone" + help text "Pick a training focus, then aim at the next target."
   - **Zone pill row** — single amber pill flanked by pulsing chevrons. Same Pattern-3 chevron animation + Pattern-4 swipe choreography as Air Bike's zone pill and Carry's adaptation zone pill.
   - **Hero card** (amber chrome): top-right info pill + 2 stacked `TickerNumber` rows (weight target + distance target with delta strings) + thin separator + cue line.
3. **Progress chart** (`<AnimateRise delay={500}>`): single **Total work** line chart — metric = `pack weight × distance` per effort, plotted over time. Replaces the earlier two-chart (pack weight + distance) layout, same reason as Carry (a distance-only PR was invisible on a weight-only graph). PB dashed line = best total work; a heavier-but-shorter ruck can read lower (less total work) — expected, not a regression. The hero targets + log list keep the per-axis breakdown. Same on athlete mobile + coach web (AdminCardioRuckingDetail) + the coach Efforts card. Label is "**Total work**", not "Workload" (see the Carry chart terminology lock).
4. **Log list** (`<AnimateRise delay={500}>`): each row shows the workout shape on the left (`35 lb × 2.5 mi`) and wall-clock time on the right.

**Header tags (LOCKED — mirrors strength's equipment-pill convention):**

Below the "Best —" subtitle row, two stacked badges:
1. **Category pill**: `RUCKING` — same chrome as every other cardio detail page's category tag (small amber `s.categoryBadge`).
2. **Tier pill**: `BEGINNER` / `INTERMEDIATE` / `ADVANCED` / `TOUGH` — same chrome, only rendered when the user's logged efforts clear a tier.

Both pills use the same amber-tinted `s.categoryBadge` style so they read as stacked tags. The tier pill explicitly mirrors Atlas Stone Bear Hug Carry's tier badge below its CARRY pill — same visual pattern, just amber instead of blue.

**No in-app tier ladder card.** An earlier draft included a "Rucking tiers" card with all four tiers, criteria, and achievement checkmarks. Removed May 19 2026 — the rucking community already knows the GoRuck tier scale, so the card was redundant chrome. The user's current tier still surfaces as the small TIER pill in the header.

**Cardio log form changes (`cardio.tsx`):**

When `isRuckMode = isRuckingActivity(activity)`, the pace-mode triple-grid is replaced with a **3-wheel layout**: `Pack Weight | Distance | Time`. Pack Weight is integer-lb with step 5, range 0–150. Distance is decimal `XX.X` mi (locked, no toggle). Time stays `mm:ss`. Both Pack Weight and Distance render with inline unit suffixes — no separate Unit chip column.

Live chip below the grid shows `Ruck — N lb × N mi` (the two-axis headline metric) and a secondary `Pace — m:ss/mi` chip (derived read-only). Pace is shown but not stored as the primary metric.

**Components / helpers (LOCKED):**

- `mobile/src/lib/movements.ts`: `RUCKING_ACTIVITY = 'Rucking'`, `isRuckingActivity(name)`.
- `mobile/app/(app)/effort/cardio/[activity].tsx`: `RuckTier`, `RUCK_TIER_*`, `RUCK_ZONE_*`, `RUCK_WEIGHT_LADDER_LB`, `parseRuckLabel`, `classifyRuckTier`, `snapDownToRuckLadder`, `nextRuckLadderAbove`, `RuckingDetail` component.
- `cardio.tsx`: `isRuckMode` + `packWeightValue` state + Pack Weight wheel + rucking-aware save label.
- Dispatch in `CardioDetail` checks `isRuckingActivity(activity)` AFTER the air-bike check and BEFORE swim/beat-your-best/PaceDetail.

**Out of v1 scope (deferred):**
- **Terrain factor** (hill vs. flat) — affects difficulty. v2 when GPS integration lands.
- **Elevation gain** — same as terrain. v2.
- **Pack type / fit metrics** — out of scope; user logs the pack weight only.
- **HR-zone integration** — would refine which adaptation zone the user actually trained. Phase 2 alongside running's HR upgrade.
- **GoRuck Heavy / Selection tiers** — multi-hour sessions exceed the app's 45-min philosophy. Deferred.

---

### StairMill detail card — locked design spec (May 19 2026)

The StairMaster Step Mill is one of the highest-MET sustainable cardio machines (~8–12 METs at moderate-to-vigorous effort). Coaching surface mirrors **Air Bike's rate-anchored architecture** line-for-line: a single rate metric — **floors per minute (FPM)** — anchors three zones (ENDURANCE / THRESHOLD / VO2 MAX). Same mental model the user already learned from running, swimming, ergs, and air bike.

**Why FPM as the rate anchor:** every Step Mill console displays FLOORS as the most prominent number. The user reads it off without thinking. FPM = `total_floors ÷ total_time_minutes`. Each zone's prescription scales linearly with peak FPM so a faster climber gets bigger floor targets per rep (wall-clock per rep stays roughly the same).

**Science backing (LOCKED — same citation rule as Air Bike, real research only):**

| Zone | Protocol source | Key finding |
|------|-----------------|-------------|
| **VO2 MAX** | Allison et al. (2017) *Med Sci Sports Exerc* | 3 × 20-sec all-out stair climbs, 3×/week → **+12% VO2peak in 6 weeks**. Drives the VO2 zone protocol (extended to 60-sec reps for Step Mill console pacing). |
| **THRESHOLD** | Interval research (Seiler 2010; Laursen & Jenkins 2002) + ACSM 12th ed | Hard 3-min intervals drive lactate-threshold adaptation. Drives the 4 × 3-min threshold protocol. (Was mis-cited to Honda 2014, a blood-glucose study — corrected June 2026.) |
| **ENDURANCE** | Boreham et al. (2000) *Prev Med* + ACSM 12th ed | Accumulated daily stair climbing improved VO2max ~17% in sedentary adults; ACSM backs the 20-min continuous vigorous block we actually prescribe. (Boreham's protocol was accumulated bouts, not one continuous session — clarified June 2026.) |
| Global framework | ACSM Guidelines 12th ed (2025) | Endorses stair climbing as vigorous-intensity (8+ METs) and supports 3-zone polarized programming across all endurance disciplines. |

**Three adaptation zones (LOCKED — `STAIRMILL_ZONE_CONFIG`):**

| Zone | Reps × Duration | Intensity (% peak FPM) | Rest | Example for 12 FPM user |
|------|------------------|------------------------|------|--------------------------|
| **ENDURANCE** | 1 × 20 min continuous | 65% | n/a | ~160 floors total at 7.8 FPM |
| **THRESHOLD** | 4 × 3 min | 85% | 90 sec | 4 × 30 floors at 10.2 FPM |
| **VO2 MAX** | 3 × 60 sec | 110% | 3 min full recovery | 3 × 13 floors at 13.2 FPM |

VO2 zone allows above-peak intensity (110%) because short reps tolerate above-peak output. Zone names match every other cardio surface (running / swimming / ergs) — drops Air Bike's CrossFit-specific "SPRINT" naming because stair-climbing protocols use the standard exercise-science vocabulary.

**Cold-start baseline (LOCKED — `genderBaselineFloorsPerMin`):**

Gender-aware, mirrors Air Bike's 18 / 13 / 15 cal/min pattern. Numbers derived from typical Stairmaster Gauntlet level 8-10 sustained output at moderate-vigorous effort:

- Male → 12 floors/min
- Everyone else (female, non-binary, prefer-not-to-say, unset) → 9 floors/min — the uniform "male / else=female" rule used across every gender-driven calc (see calorie `calcBMR`). (Code is `gender === 'male' ? 12 : 9`; the earlier "other → 10" averaging was retired May 23 2026.)

Replaced by user's actual peak FPM after their first logged effort.

**Effort label format (LOCKED):**

Current format with floors count:
```
StairMill · 245 floors in 20:00
```

Legacy format (pre-May-19-2026, no floors column on log form) — still parses, treated as `floors = 0`:
```
StairMill · 20:00
```

`parseStairMillLabel` handles both shapes. Legacy efforts contribute to the chart timeline but don't contribute to peak FPM (since 0 floors → 0 FPM).

**Save value format:** `12.3 floors/min` for new format, bare time for legacy. The value column always stores the derived rate so future detail-page reads don't need to re-parse the label.

**Layout — single page, top to bottom (LOCKED):**

1. **Header**: back chevron + "StairMill" h1 + `Best — N.N floors/min` subtitle (or cold-start message). `STAIR CLIMBING` category pill below the subtitle.
2. **Progression plan card** (`<AnimateRise delay={0}>`): zone pill row with swipe gesture + 4-row hero card:
   - Row 1: workout shape (`160 floors` or `4 × 30 floors`)
   - Row 2: estimated wall-clock time (`20:00` or `3:00`)
   - Row 3: target FPM rate (`7.8 floors/min`)
   - Row 4: rest between reps (intervals only)
3. **Chart card** (`<AnimateRise delay={250}>`): FPM over time, Y-axis NOT reversed (higher = better, mirrors Air Bike — locked chart-direction rule).
4. **Log list** (`<AnimateRise delay={500}>`): each row shows floors + time on the left, derived FPM rate on the right.

**Attribution under the hero card:** `Floors-per-minute anchored zones · Allison protocol · ACSM`. Cites real research without explaining the formula (Pattern 5 info-pill rule).

**Cardio log form changes (`cardio.tsx`):**

When `isStairMillMode = isStairMillActivity(activity)`, the duration-mode form swaps the single hh:mm:ss Duration wheel for a **two-column grid**: `Floors | Time`. Both wheels required (canSave guards on `floors > 0 && time > 0`). Floors is an integer wheel (step 1, range 0–500). Time stays `mm:ss`. Live chip shows derived `Climb rate — N.N floors/min`. Generic duration-mode activities (none currently — Arc Trainer was removed May 17) still use the single Duration wheel via the else-branch.

**Dispatch order (LOCKED):**

StairMill's `cardio_mode = 'duration'` in the DB, but `CardioDetail` short-circuits BEFORE the generic `mode === 'duration'` route via an explicit `isStairMillActivity` check. Any future duration-mode activity that gets its own coaching surface should follow the same pattern.

**Components / helpers (LOCKED):**

- `mobile/src/lib/movements.ts`: `STAIRMILL_ACTIVITY = 'StairMill'`, `isStairMillActivity`, `parseStairMillLabel`, `floorsPerMinFromEffort`, `genderBaselineFloorsPerMin`.
- `mobile/app/(app)/effort/cardio/[activity].tsx`: `StairMillZone`, `STAIRMILL_ZONE_ORDER`, `STAIRMILL_ZONE_CONFIG`, `buildStairMillZoneRx`, `getStairMillZoneCue`, `StairMillDetail` component.
- `mobile/app/(app)/cardio.tsx`: `isStairMillMode` + `floorsValue` state + Floors wheel + StairMill-aware save label.

**Out of v1 scope (deferred):**
- **Resistance level (1–20)** — secondary intensity modulator on real Step Mills. Adds complexity to the log form without proportional coaching value (FPM already captures effort intensity). v2.
- **Tabata 20s/10s sets** — extreme HIIT prescription used in the original Allison protocol (20-sec reps). The Step Mill console's response time makes 20-sec reps hard to pace cleanly; we extended to 60-sec reps for v1. v2 with a dedicated "test mode".
- **Empire State Building Run-Up benchmark mode** — cultural benchmark (86 floors for time). Specialty feature, defer.
- **HR-zone integration** — would replace the FPM proxy with true HR zones. Phase 2 alongside running's HR upgrade.

---

### Health Connect integration — Phase 1 spec (May 17 2026)

Android-only wearable / health-platform funnel. Google Health Connect is the universal Android data store that aggregates data from Samsung Health, Fitbit, Garmin Connect, Whoop, Polar Flow, Strava, and any other source that supports the Android Health Connect SDK. By integrating with HC, we get every Android wearable for free — the user's data path is `Watch → Source app (Samsung Health / Fitbit / etc.) → Health Connect → MyRX`.

**Phase 1 scope (LOCKED — what's shipped):**

1. **Read-only**: MyRX reads from HC; writing MyRX efforts back to HC (so logs appear in Samsung Health / Fitbit / etc.) is **Phase 2**.
2. **Manual sync only**: a "Sync now" button on the Health Connect row in the Connect tab. App-launch auto-sync is Phase 1.1; background sync is Phase 2.
3. **Permission set requested**: ExerciseSession, HeartRate, Steps, Distance, TotalCaloriesBurned, Weight. All declared in AndroidManifest via `mobile/plugins/withHealthConnectPermissions.js` (a small inline config plugin). The user grants per-data-type in HC's system UI; we read the subset they actually granted.
4. **Just logs to console**: the v1 "Sync now" pulls last-7-days workouts + HR and `console.log`s them. Mapping HC records → MyRX effort logs is **next** once the plumbing is verified with real data.
5. **iOS deferred**: HealthKit support comes later. The `healthConnect.ts` module returns safe defaults (empty list / 'unavailable' status) on iOS so the rest of the app can call it unconditionally without platform checks.

**Files:**

- `mobile/plugins/withHealthConnectPermissions.js` — inline config plugin that adds the 6 `<uses-permission android:name="android.permission.health.READ_*">` tags to AndroidManifest.xml during prebuild. The official `react-native-health-connect` config plugin only adds the rationale intent filter, not the data-type permissions — those have to be declared per-app.
- `mobile/app.json` — `plugins` array includes `react-native-health-connect` first (rationale intent filter) followed by `./plugins/withHealthConnectPermissions` (data-type permissions). Order matters: the second plugin appends to whatever AndroidManifest the first one produced.
- `mobile/src/lib/healthConnect.ts` — service module. Lazy-requires the native module (so iOS doesn't blow up on module load); exports `availability()`, `initialize()`, `requestPermissions()`, `grantedPermissions()`, `disconnect()`, `fetchRecentWorkouts(days)`, `fetchRecentHeartRate(days)`. All async, all safe-default on iOS.
- `mobile/src/lib/lastSyncStorage.ts` — per-integration last-sync timestamp persistence in AsyncStorage. Keyed by `myrx.lastSync.<integration>` where integration ∈ `'healthConnect' | 'appleHealthKit' | 'strava' | 'garmin' | 'whoop' | 'polar'`. Also exports `formatLastSync(iso)` for human-friendly "5 min ago" / "yesterday" strings.
- `mobile/app/(app)/settings.tsx` — `ConnectTab` shows the Health Connect row with Connect / Sync now / Disconnect actions wired up. Other 5 integration rows (Apple Health, Strava, Garmin, Whoop, Polar Flow) remain "Coming soon" placeholders.

**Native rebuild required:**

Adding `react-native-health-connect` is a native-module change, so the dev-client APK must be rebuilt via `npx expo run:android` before the integration works on the user's phone. JS Fast Refresh continues to work for everything else, but the Health Connect surface in `ConnectTab` will show as "unavailable" until the user installs the rebuilt APK.

**`MainActivity.onCreate` MUST register the permission delegate (LOCKED, May 18 2026):**

`react-native-health-connect` uses a singleton `HealthConnectPermissionDelegate` with a `lateinit var requestPermission: ActivityResultLauncher<...>` that has to be bound to a real `ComponentActivity` via `registerForActivityResult` BEFORE any JS code can tap the "Connect" button. The library does NOT do this binding via its config plugin (the plugin only adds the rationale intent filter). The host app's `MainActivity.onCreate` has to call it explicitly:

```kotlin
// mobile/android/app/src/main/java/com/myrx/app/MainActivity.kt
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)

    // Must register AFTER super.onCreate() but BEFORE the activity reaches
    // STARTED state (registerForActivityResult validates lifecycle).
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
  }
}
```

Without this call, the FIRST permission request crashes with `UninitializedPropertyAccessException: lateinit property requestPermission has not been initialized`. The dev launcher catches that crash and PERSISTS it into `shared_prefs/expo.modules.devlauncher.errorregistry.xml`, which then makes EVERY subsequent cold launch land directly on `DevLauncherErrorActivity` — Metro never gets a bundle fetch, the JS bundle never executes, and the app appears bricked. Recovering requires deleting the prefs file via `adb shell run-as com.myrx.app rm shared_prefs/expo.modules.devlauncher.errorregistry.xml` AND fixing the underlying registration, because otherwise the next "Connect" tap re-triggers the same crash.

The MainActivity edit is preserved across `npx expo prebuild --clean` ONLY if it's done BEFORE the prebuild (clean prebuild wipes `android/`). When you have to do a clean prebuild for an unrelated reason, re-apply this patch immediately after.

**If the dev launcher ever lands on the red error screen with the bundle never loading, ALWAYS check `errorregistry.xml` first** — `adb shell run-as com.myrx.app cat shared_prefs/expo.modules.devlauncher.errorregistry.xml` shows you the persisted exception. That's the actual root cause; the visible "error" is just a symptom of the launcher refusing to retry.

**`<activity-alias ViewPermissionUsageActivity>` is REQUIRED for Android 14+ (LOCKED, May 18 2026):**

On Android 14+ devices, Health Connect refuses to show its permission dialog unless the app declares an `<activity-alias>` named `ViewPermissionUsageActivity` with:
1. An intent filter for `android.intent.action.VIEW_PERMISSION_USAGE` + `android.intent.category.HEALTH_PERMISSIONS`
2. The `android:permission="android.permission.START_VIEW_PERMISSION_USAGE"` gate
3. An `android:targetActivity` pointing at a real Activity in the app

Without this alias, `com.android.healthconnect.controller.permissions.request.PermissionsActivity` launches and **auto-dismisses within milliseconds** without ever becoming user-visible. Our wrapper sees an empty permission grant set and reports "No data types granted." The alias is HC's privacy-policy-rationale handshake — it verifies the app can render an explanation of why it needs the data. The target activity doesn't need to actually render a privacy policy for the alias to satisfy HC (MainActivity is fine as a target for v1).

Our `mobile/plugins/withHealthConnectPermissions.js` config plugin adds the alias automatically on every prebuild:

```xml
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
    <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
  </intent-filter>
</activity-alias>
```

**Diagnosing this specific failure mode:** if Connect taps produce "No data types granted" every time AND the app is NOT in HC's "Your health apps" list at all (apps only get registered there AFTER a successful permission grant), the alias is missing. Confirm with `adb shell cmd package query-activities -a android.intent.action.VIEW_PERMISSION_USAGE -p com.myrx.app` — output must include `com.myrx.app.ViewPermissionUsageActivity`. If empty, the alias didn't make it into the manifest.

**AndroidManifest MUST declare `<queries>` visibility for the Android 14+ HC system module (LOCKED, May 18 2026):**

On Android 14+ devices (Galaxy S25, Pixel 8+, etc.), Health Connect ships as a system module under package `com.google.android.healthconnect.controller` — NOT the legacy `com.google.android.apps.healthdata` that older docs reference. `react-native-health-connect`'s own AndroidManifest declares a `<queries><package>` for ONLY the legacy package, which means on Android 11+ (where package visibility is strict), the HC SDK literally cannot see the system provider on a modern device. The symptom: when the user taps Connect, the HC `PermissionsActivity` AND Android's `GrantPermissionsActivity` both launch and auto-dismiss within ~20 ms with no UI shown, our wrapper returns an empty grant set, and the UI shows "No data types granted — tap Connect again to retry." Tapping again does the same thing every time.

The fix is one extra `<package>` entry inside the existing `<queries>` block. Our `mobile/plugins/withHealthConnectPermissions.js` config plugin (invoked from `app.json` plugins array) now adds this automatically — every prebuild produces a manifest containing:

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW"/>
    <category android:name="android.intent.category.BROWSABLE"/>
    <data android:scheme="https"/>
  </intent>
  <package android:name="com.google.android.healthconnect.controller"/>
</queries>
```

The legacy `com.google.android.apps.healthdata` query already comes in via the library's own manifest, so we don't need to add it; the new system-module query is what closes the gap.

**Diagnosing this specific failure mode:** if Connect taps produce "No data types granted" every time AND `adb logcat` shows `com.android.healthconnect.controller.permissions.request.PermissionsActivity` + `com.google.android.permissioncontroller.../GrantPermissionsActivity` both being created and destroyed within milliseconds without ever becoming user-visible — the package-visibility query is missing. Confirm with `adb shell dumpsys package com.myrx.app | grep queriesPackages` — if the output doesn't include `com.google.android.healthconnect.controller`, the manifest hasn't been regenerated with the plugin fix.

**User-side prerequisites for Samsung-watch testing:**

1. Samsung Health app installed on the phone, paired with the user's Galaxy Watch.
2. Samsung Health → Settings → Connected services → **Health Connect** = ON. (Default on One UI 6 / Android 14+; older phones may need manual enable.)
3. Open MyRX → Settings → Connect → tap **Connect** on the Google Health Connect row → grant the 6 data types in HC's system UI.
4. Tap **Sync now**. Recent workouts + HR samples are logged to console (`console.log('[Health Connect] workouts:', ...)`) and the last-sync stamp updates in the row's sub-text.

**Integration strategy update — direct OAuth/SDK per platform (LOCKED, May 18 2026):**

After the Galaxy S25 HC test surfaced that Samsung Health doesn't share HR or workouts with Health Connect by default (only steps / weight / body fat make it through the bridge — confirmed via the user's Health Connect → Data and access screen on May 18), the product direction is **dedicated direct integrations per platform**, NOT relying on HC as the universal aggregator. The user's call: *"i want everything connected, every platform connected individually"* — coverage matters more than implementation cost.

HC stays in the app as a FALLBACK for users on non-Samsung Android devices whose source apps DO bridge to HC. It's no longer the primary path for Galaxy/Garmin/Whoop/Polar/Fitbit/Strava users.

**The seven integrations on the roadmap:**

1. **Apple HealthKit** — iOS only, native module. No external approval, just App Store review covers HealthKit entitlements.
2. **Samsung Health SDK** — Android only, native module. Samsung Developer Program approval required (~1-2 weeks).
3. **Strava** — OAuth2 + REST. No approval delay; just register an API app at https://www.strava.com/settings/api.
4. **Garmin Health API** — OAuth1.0a + webhooks. Garmin Developer Program approval required (~2-4 weeks).
5. **Whoop API v1** — OAuth2 + webhooks. Whoop Developer Program approval (~1-2 weeks).
6. **Polar AccessLink** — OAuth2. Polar Business team approval (~1-2 weeks).
7. **Fitbit Web API** — OAuth2. Personal-tier app registration is instant; production-tier rate limits need approval.

**Build order (originally locked May 18 2026):** Strava → Fitbit → Apple HealthKit → Samsung SDK → Garmin → Whoop → Polar. The first three have no external approval delay; the last four are gated on developer-program approvals.

**Updated May 22 2026:** Samsung Developer Program approval came back on 2026-05-20 05:08 AM (~36 hours after the 2026-05-18 04:27 PM submission — faster than Samsung's own "~3 days" estimate), so **Samsung Health was promoted out of order** — it's the active build target now because the user's primary test device is a Galaxy S25 Ultra and Samsung Health is the only direct integration that can deliver Galaxy Watch HR + steps data on day 1. Polar AccessLink was already live (approved instantly on 2026-05-19). Other integrations resume in the original order once Samsung is verified.

**Samsung Health Data SDK — implementation notes (May 22 2026):**

- **Not OAuth.** Samsung Health is a NATIVE Android SDK distributed as `samsung-health-data-api-1.1.0.aar` (March 12 2026, latest). The host app talks to the Samsung Health app on the device via local IPC. There is no Client ID / Client Secret embedded anywhere — Samsung verifies the calling app by package name + signing-key SHA-256 (both submitted at app-approval time). The `workers/oauth/` worker does NOT handle Samsung; it treats `samsung_health` as a known platform value but rejects `/oauth/start/samsung_health` with `not_yet_implemented`.
- **AAR is vendored.** The SDK binary is dropped into `mobile/android/app/libs/samsung-health-data-api-1.1.0.aar` by hand from Samsung Developer Console. Samsung's license forbids redistribution, so `app/libs/*.aar` is gitignored. Each contributor downloads it once.
- **Min SDK = 29.** Samsung Health Data SDK requires Android 10+. Bumped `android.minSdkVersion` in `mobile/android/gradle.properties` from 26 → 29 as part of this integration. Also reflected in `app.json` via the `expo-build-properties` plugin.
- **Java 17+, Kotlin coroutines, kotlin-parcelize plugin.** Already in place via Expo SDK 54 + JBR 21.
- **Native module shape.** `mobile/android/app/src/main/java/com/myrx/app/samsung/SamsungHealthModule.kt` exposes: `isAvailable()`, `getPermissionStatus()`, `requestPermissions()`, `readHeartRate(startMs, endMs)`, `readSteps(startMs, endMs)`, `readWorkouts(startMs, endMs)`. Registered via `SamsungHealthPackage.kt` added to `MainApplication.getPackages()`.
- **JS-side service.** `mobile/src/lib/integrations/samsungHealth.ts` mirrors the Polar / Health Connect shape (`availability()`, `requestConnect()`, `getStatus()`, `disconnect()`, `syncRecent(daysBack)`). Sync writes into `hr_samples`, `step_samples`, and `wearable_workouts` Supabase tables with idempotent upsert keyed on `(user_id, source, source_record_id)`.
- **Connect tab.** Samsung Health gets a dedicated card on the Connect tab (`settings.tsx::ConnectTab`) between Health Connect and Polar — Connect / Sync now / Disconnect actions mirror the Health Connect pattern.
- **Config plugin.** `mobile/plugins/withSamsungHealth.js` survives `expo prebuild --clean`. It patches AndroidManifest (`<package name="com.sec.android.app.shealth"/>` in `<queries>`), `app/build.gradle` (kotlin-parcelize + AAR fileTree + gson + lifecycle-runtime-ktx + kotlinx-coroutines-android), and MainApplication.kt (SamsungHealthPackage import + registration).
- **Verification path.** Once the AAR is in place and the dev-client APK rebuilt via `npx expo run:android`, Settings → Connect → Samsung Health → Connect launches Samsung Health's permission dialog → grant → Sync now pulls last 7 days of HR + step buckets + workouts into Supabase.

**Supabase tables for wearable data (migration `add_wearable_hr_steps_workouts`, May 22 2026):**

- `hr_samples` — one row per HR reading. Columns: `user_id`, `source` (`samsung_health` / `apple_healthkit` / etc.), `source_record_id`, `measured_at`, `bpm` (CHECK 20–250), `context` (`resting`/`exercise`/`sleep`/`manual`/`auto`), `workout_id` (FK to `wearable_workouts`, ON DELETE SET NULL), `raw_meta` jsonb. Indices: `(user_id, measured_at desc)`, partial `(workout_id, measured_at) where workout_id is not null`. RLS owner-only.
- `step_samples` — one row per step bucket. Columns: `user_id`, `source`, `source_record_id`, `start_at`, `end_at`, `steps` (CHECK 0–100000), `distance_m`, `raw_meta`. Index: `(user_id, start_at desc)`. RLS owner-only.
- `wearable_workouts` — one row per workout session as seen by the wearable. Distinct from MyRX-logged `efforts` (which are user-entered in-app). Columns: `user_id`, `source`, `source_record_id`, `exercise_type`, `start_at`, `end_at`, `duration_s`, `distance_m`, `calories_kcal`, `avg_bpm` / `max_bpm` / `min_bpm`, `steps`, `raw_meta`. Index: `(user_id, start_at desc)`. RLS owner-only.

The `(user_id, source, source_record_id)` unique constraint on all three tables makes resync idempotent — re-running `syncRecent(7)` only inserts genuinely new rows.

**Cross-cutting infrastructure (build once, reuse across all integrations):**

- **OAuth callback worker** at `workers/oauth/` (new Cloudflare Worker) — handles `/oauth/callback/{platform}` endpoints, exchanges authorization codes for refresh tokens, stores tokens encrypted to a per-user `user_integrations` Supabase table.
- **Webhook receiver worker** at `workers/webhooks/` (new) — accepts POSTs from Garmin and Whoop when new data lands. Maps webhook payload → MyRX effort rows.
- **`user_integrations` Supabase table** — columns: `user_id`, `platform`, `access_token` (encrypted), `refresh_token` (encrypted), `expires_at`, `scopes`, `connected_at`, `last_synced_at`, `status` ('active'/'disconnected'/'expired'). RLS: users own their rows.
- **Token-refresh background job** — Cloudflare Worker cron that re-issues access tokens before they expire (Strava: 6hr, Whoop: 1hr, Garmin: 90d, Polar: long-lived, Fitbit: 8hr).
- **Data normalization layer** in `mobile/src/lib/integrations/` — each platform gets its own `<platform>Mapper.ts` that converts platform-native workouts → MyRX effort schema. Sport-type enum mapping lives there.

**Application content for every developer-program signup** lives in `docs/integrations/developer-program-applications.md` — that's the canonical place. Update that file as each application moves through pending → approved → live.

**Secrets** for OAuth client_secrets and webhook signing keys live in **Cloudflare Worker secrets** (`wrangler secret put`) and **Supabase Edge Function secrets** (Dashboard → Edge Functions → Secrets). Never in tracked files; see "Secrets hygiene (MANDATORY)" further down for the full rules.

**Health Connect bullets that survive this strategy change:**

- HC → MyRX effort mapping: still needed for the HC-as-fallback path. Sport-type enum mapping (ExerciseType=33 → Running, ExerciseType=11 → Cycling) lives behind this work.
- HR series storage: still an open schema question — likely a new `hr_samples` table or extended `efforts.hr_avg` column. Resolved once we pick a representative integration and see what shape its HR-stream payload arrives in.
- Bidirectional sync: deferred — write-back to HC is not on the roadmap. Each direct integration is read-only for v1 too; we'll consider write-back per platform as users ask for it.
- Background sync: deferred until at least one direct integration is live. WorkManager (Android) and BackgroundTasks (iOS) are the right primitives.

---

### Air Bike detail card — locked design spec

This is the spec for the air-bike-native coaching surface on `[activity].tsx` (mobile) — fired when `isAirBikeActivity(activity)` (i.e. `activity === 'Air Bike'`). Routes to its own `AirBikeDetail` component rather than the generic `PaceDetail`, because air bike training mechanics are fundamentally different from running/cycling/etc:

1. **Training is programmed in CALORIES, not distance or pace.** Air bikes (Assault, Echo, Rogue, Schwinn Airdyne) are fan-resistance machines — effort is exponential, you cannot go "easy" because the fan punishes any sustained output. Real workouts: "8 × 10 cal sprint, 45s rest," "Tabata cals," "Death by Calories (1 cal min 1, 2 cal min 2, ...)," "100-cal test for time." Nobody trains air bike at "2.5 km steady-state pace" — that prescription doesn't exist in any real program.
2. **The user's training-anchor metric is CAL/MIN rate**, not pace. Computed as `total_cals ÷ total_time_min` from any logged effort. The user's "best" is the MAX rate across all their efforts — a single hard session sets the rate; longer easier sessions naturally show lower rates so the MAX stays at the peak.
3. **Zone names: AEROBIC / THRESHOLD / SPRINT**, not Endurance/Threshold/VO2 Max. CrossFit and HIIT coaching communities use these names for air bike work — "sprint" is significantly more associated with air bike than the generic "VO2 max" sports-science term. Threshold stays (the term spans every cardio discipline). Aerobic replaces Endurance because air bike's "easy" zone is still moderately taxing — "aerobic" reads more accurately than "endurance" for a 5-min steady ride.
4. **Three slots in HARDEST-FIRST order (per Pattern 4):** SPRINT (slot 0) → THRESHOLD (slot 1) → AEROBIC (slot 2). Default landing on SPRINT — matches the universal "always slot 0" rule.

**Per-zone session prescriptions (LOCKED):**

Each zone target = `peakCalsPerMin × duration × intensityFactor`, rounded to nearest whole calorie (the machine display is integer-only). Numbers below show a worked example for an intermediate-male user at 18 cal/min baseline.

| Zone | Duration (min/rep) | Intensity | Reps | Rest | 18 cal/min example |
|------|--------------------|-----------|------|------|---------------------|
| **SPRINT** | 0.5 | 100% | 8 | 45 sec | 8 × 9 cal max effort |
| **THRESHOLD** | 1.0 | 85% | 5 | 30 sec | 5 × 15 cal sustained hard |
| **AEROBIC** | 5.0 continuous | 65% | 1 | 0 | 59 cal continuous easy |

A faster user (e.g. 25 cal/min advanced) gets bigger targets: 8 × 13 cal sprints, 5 × 21 cal threshold, 81 cal aerobic. A slower user (e.g. 13 cal/min) gets smaller targets: 8 × 7 cal sprints, 5 × 11 cal threshold, 42 cal aerobic. The targets scale linearly with the rate so each rep stays roughly the same wall-clock duration regardless of fitness level.

**Cold-start (gender-aware baseline cal/min):**

Users with no logged air bike efforts get bootstrapped with a gender-aware baseline so the zone prescriptions show reasonable starting targets:

- `profile.gender === 'male'` → 18 cal/min baseline (typical intermediate-male output on an Assault Bike at normal resistance)
- `profile.gender === 'female'` → 13 cal/min baseline (typical intermediate-female output — power-based scaling reflects average watt differences)
- Other / unset → 13 cal/min (same as female — the uniform "male / else=female" rule; code is `gender === 'male' ? 18 : 13`)

The baseline only affects the page on first visit. After the first logged effort, the user's actual `peakCalsPerMin` replaces the baseline (peak > 0 always takes precedence). The page header reads "No efforts logged yet · using N cal/min as a starting estimate" until the user logs their first effort.

**Layout — Pattern L4 (LOCKED, May 19 2026):** Air Bike uses Layout L4 from `docs/Layout Design.xlsx` (`In-frame variation swipe pill / Hero card / Consolidated chart and log`) — same shape as Carry's adp-zone surface, but with amber chrome (cardio theme) instead of blue (strength). The page is a single page, top to bottom:

1. **Header** — back chevron + "Air Bike" title + subtitle: `Best — N cal/min` (TickerNumber on the rate value). When no efforts: `No efforts logged yet · using N cal/min as a starting estimate`.
2. **Progression plan card** (`<AnimateRise delay={0}>`):
   - Title `Your progression plan` + helper text "Three zones to train, each anchored on your cal/min rate. Swipe the pill to switch zones."
   - **In-frame variation swipe pill** — single pill in the center showing the active zone (SPRINT / THRESHOLD / AEROBIC, hardest-first), flanked by pulsing amber chevrons (Pattern 3 + Pattern 4 swipe choreography). Pan gesture swipes between zones; chevron taps also navigate. Matches Carry's `carryZoneRow` pill exactly, just amber instead of blue.
   - **Hero card** (amber chrome): top-right info pill (zone label + Info icon, tappable for inline "why this zone" panel — Pattern 5). Two stacked TickerNumber rows:
     - Row 1 = work (`8 × 9 cal` for intervals, `59 cal` for continuous AEROBIC) — sub-text "the work"
     - Row 2 = estimated wall-clock time per rep (or total for AEROBIC) — sub-text "est. per interval" / "est. total"
   - Full coaching cue underneath the thin separator: the work + the rest interval, NO watts. e.g. SPRINT: `Sprint 9 cals as fast as you can. Rest 45 sec, repeat 8 times. Each interval should take about 30 sec.` AEROBIC (continuous): `Pedal 59 cals at a steady aerobic effort, about 5 min total.`
   - Attribution: `Cal/min anchored zones · gender-calibrated baseline`
   - **Watts overlay REMOVED (June 2026, T088 verify-first):** the old "hold ≥ X W" row derived `watts = cal/min × 17.4` (a generic ~25%-efficiency calc). That is NOT a published Assault/Echo/Rogue/Schwinn standard, and it doesn't match the Assault console's own watts readout — so a target the user couldn't validate against the machine was unactionable noise. Dropped from the hero rows, the cues, and the attribution; cal/min (on every console + our anchor) stands alone. A console-calibrated watts readout would need physical hardware testing — deferred.
3. **Chart** (`<AnimateRise delay={250}>`) — cal/min rate over time. **Y-axis NOT reversed** — higher rate = better progress = line trends UP. Distinct from pace charts where the Y-axis is reversed (lower = faster = trend down). Reference line at peak rate.
4. **Log list** (`<AnimateRise delay={500}>`) — each row shows the cal/min rate on the right.

**Wattage overlay — REMOVED (June 2026, T088 verify-first).** The page formerly derived a per-zone watts floor (`watts = cal/min × 17.4`, a generic ~25%-efficiency calc) and showed "hold ≥ X W". Dropped because: (1) `× 17.4` is NOT a published Assault/Echo/Rogue/Schwinn standard (the earlier "industry-standard conversion" claim was false); (2) it doesn't match the Assault console's own watts display, so the target was unverifiable mid-effort. Watts is gone from the hero rows, the cues, and the attribution. cal/min remains the sole anchor (it's on every console). Re-adding a console-calibrated watts readout would require physically measuring a specific machine — deferred. The `calsPerMinToWatts` helper was deleted from both `movements.ts` and the web mirror.

**Log form (`cardio.tsx`) — calorie-input mode (LOCKED):**

When `activity === 'Air Bike'` (`isCalorieMode`):
- **Distance and Speed are dropped entirely** from the form. Calorie mode is a 2-column grid: **Calories | Time**. Both columns use `gridLarge` (flex 2.55, symmetric) since "150 cal" and "5:00" are similar widths.
- **Calories wheel**: INTEGER mode, step 1, min 0, max 300. Range covers a 100-cal benchmark test (single rep) up to a long aerobic session (~200+ cal). Step 1 matches the machine display's integer-only readout.
- **Time wheel**: standard `mm:ss`, max 99 minutes.
- **Live chip**: `Rate — N.N cal/min` (computed as `calsPerMinFromEffort(cals, timeSecs)`). One chip only, no pace / session-time chips.
- **Save label format**: `Air Bike · 50 cal in 5:00`. The bracketed activity name + period + cal count + time. `parseAirBikeLabel` on the read side extracts this back into `{cals, timeSecs}`.
- **Save value format**: `12.0 cal/min` (the derived rate, 1 decimal). Stored in the `value` column for consistency with the pace activities (which store pace strings in `value`). The detail page parses this directly, OR re-computes from the label for redundancy.

**Activities list (`cardio.tsx`):**

The "Your activities" row for Air Bike shows `Best rate — N.N cal/min` on the right, not `Best pace`. Aggregation logic finds the MAX cal/min rate across all logged Air Bike efforts (higher = better) — distinct from the other pace-mode activities where the MIN pace seconds is the best.

**Helpers in `mobile/src/lib/movements.ts`:**

| Function | Purpose |
|----------|---------|
| `AIR_BIKE_ACTIVITY` | The literal string `'Air Bike'` |
| `isAirBikeActivity(name)` | True iff name equals AIR_BIKE_ACTIVITY |
| `parseAirBikeLabel(label)` | Parse `"Air Bike · N cal in M:SS"` → `{ cals, timeSecs }` |
| `calsPerMinFromEffort(cals, timeSecs)` | Compute cal/min rate (returns 0 for invalid) |
| `genderBaselineCalsPerMin(gender)` | Cold-start baseline (18 male / 13 else) |

**Out of v1 scope (deferred):**

- **100-cal benchmark test** — a famous standalone benchmark ("how fast can you hit 100 cals?"). Would require a separate "test mode" on the log form and a dedicated chart line on the detail page. Defer until users ask for it.
- **EMOM cal ladders** ("3 cal min 1, 6 cal min 2, 9 cal min 3, ...") — interval programming pattern. Out of scope; one prescription per zone for now.
- **Watts as a primary INPUT** — v1 derives watts from cal/min for coaching advice only; the user never types watts. Reading watts off the air bike console for a primary input would require asking the user to monitor a fluctuating value mid-rep (impractical). If wattage-aware machines (e.g. Concept2 BikeErg + Erg PM5) ship as separate movements, those CAN use watts as primary input. Air Bike stays cal-input + watts-derived.
- **Test-set tracking** — users who do a 100-cal time trial would want to log that specifically and see their best 100-cal time over time. v2.
- **AirBikeConsolidatedDetail wrapper** — air bike has only one variant, no consolidation needed. If we ever add variants (e.g., one-arm air bike, seated vs standing), the Sled Work / Swimming wrapper pattern applies.

---

### Swimming detail card — locked design spec

This is the spec for the swim-native coaching surface on `[activity].tsx` (mobile) — fired when `isSwimActivity(activity)` (i.e. activity is `'Swimming'`, any `'Swimming [Stroke]'` variant, or a legacy bare `'Swimming · ...'` effort). Routes through `SwimmingConsolidatedDetail` (the stroke-pill wrapper) which then renders `SwimmingDetail` filtered to the active stroke. NOT the generic `PaceDetail`, because swim mechanics differ from running/cycling in five fundamental ways:

1. **Workouts are interval SETS on a clock.** Not "swim X km at Y pace." Real swim sessions look like "8 × 100m, leave every 1:50" — every rep ends at a wall, the user touches, gets whatever rest is left from the leaving interval, then pushes off for the next rep. The "leaving interval" is the canonical swim concept; running has no equivalent.
2. **Distances come in pool lengths, not arbitrary km.** Pool lengths are 25m, 50m (Olympic), or 25 yards. Rep distances are always multiples of pool length: 50m, 100m, 200m, etc. The current SWIM_ZONE_SESSIONS data uses 50m and 100m chunks that fit any pool layout.
3. **Pace is per 100m, not per km.** Universal swim convention. Storage stays in seconds-per-km for cross-activity uniformity, but the detail page divides by 10 at display time.
4. **CSS anchors all zones.** CSS = Critical Swim Speed = swimming's threshold pace (analogous to a runner's lactate threshold). Canonical formula is `(400m_TT_time - 200m_TT_time) ÷ 200`; MyRX estimates it without a forced calibration session — a 2-point linear Critical-Speed fit across the user's logged distances, falling back to a Riegel proxy when a stroke has <2 distances (see "CSS estimation" below).
5. **Hero card stacks THREE values, not two.** Running's hero shows work + pace. Swimming's shows work + pace + leaving interval — the leaving interval is what the swimmer actually reads off the pool clock to know when to push off, so it's a first-class number.

**Stroke consolidation (May 17 2026 — LOCKED):**

Swimming has 4 stroke variants — Freestyle, Backstroke, Breaststroke, Butterfly — stored as separate movements in the DB (`Swimming [Freestyle]`, `Swimming [Backstroke]`, `Swimming [Breaststroke]`, `Swimming [Butterfly]`). They collapse into a single detail page via `SwimmingConsolidatedDetail`, mirroring the Sled Work `[Push]` / `[Pull]` pattern from strength. The architecture:

- **DB**: 4 movement rows, all `category='cardio'`, `cardio_mode='pace'`. No `Swimming` row exists; bare `'Swimming · ...'` effort labels from before this consolidation are legacy and default to Freestyle on the parse path.
- **Cardio index (`cardio.tsx`)**: the "Your activities" aggregation collapses the 4 stroke variants (and legacy bare swim labels) under a single `Swimming` row, with the most-recently-trained stroke shown as a small `FREE` / `BACK` / `BREAST` / `FLY` badge to the right. Best pace shown is the FASTEST per-100m across all strokes.
- **Cardio log form (`cardio.tsx`)**: the activity search returns all 4 stroke variants as separate hits (consistent with how Sled Work's strength search returns `Sled Work [Push]` + `Sled Work [Drag]` separately). The user picks the stroke they swam. The form recognises any bracketed swim variant as swim mode via `isSwimActivity(activity)`; save label format is `Swimming [Backstroke] · 1500 m in 25:00`.
- **Detail page route**: `/effort/cardio/Swimming` (base name from the index collapse) and `/effort/cardio/Swimming [Freestyle]` (bracketed deep links) both route to `SwimmingConsolidatedDetail`. The wrapper holds `activeStroke` state (defaults to whichever stroke was logged most recently; falls back to Freestyle if no swim efforts exist yet) and filters efforts to that stroke. Inner `SwimmingDetail` is stroke-agnostic — operates on whatever filtered list it receives.
- **Pill carousel**: 4-variant version of the same swipe choreography used by Sled Work and the BW assist tiers. Single amber pill in the center showing the active stroke as a short label (`FREE` / `BACK` / `BREAST` / `FLY`), flanked by pulsing chevrons. Carousel order: `FREE → BACK → BREAST → FLY` (popularity / freestyle-first). No wrap at the ends — left chevron disappears on Freestyle, right chevron disappears on Butterfly.
- **Pill swipe gesture**: identical mechanics to the Sled Work pill — Pan gesture, 20px threshold, 220px slide-off, 250ms slide-out / slide-in, 120ms chevron fade. Bounded by `currentIdx + direction` within `[0, SWIM_STROKE_ORDER.length - 1]` so over-swipes at the ends bounce back rather than commit.
- **Per-stroke fitness**: every stroke has its own CSS estimate (computed only from that stroke's efforts), its own progression chart, and its own plan queue. Switching strokes flips both the data AND the prescription. A user might have a 1:35/100m freestyle CSS and a 2:15/100m butterfly CSS — both tracked independently, no cross-contamination.
- **Empty states**: each stroke tab computes from only its own efforts. The user who has only swum freestyle sees the normal coaching surface on the FREE tab and an empty-state card on BACK / BREAST / FLY (`"Log your first backstroke effort and your personalized plan will appear here"`). No auto-estimating across strokes — they're physiologically different enough that the user's freestyle CSS tells us nothing about their butterfly CSS.

The 4 stroke movements live in `mobile/src/lib/movements.ts` (`SWIMMING_STROKE_MOVEMENTS`, `SWIM_STROKE_ORDER`, `SWIM_STROKE_LABELS`, `parseSwimStroke`, `isSwimActivity`, `swimStrokeFromMovementName`) so the log form, the index collapse, and the detail page all import from the same authoritative source.

**CSS estimation — 2-point linear, Riegel fallback (UPDATED June 2026, T088):**

CSS is computed per stroke by `computeSwimCSS(efforts)`:

1. **Preferred — 2-point linear Critical Speed** (`linearProjectCSS`). Take the fastest time at each DISTINCT logged distance, then fit a least-squares line of time-vs-distance. The critical-speed model says `time = distance / CS + anaerobic term`, so the line's SLOPE is `1 / CS` (seconds per metre) and `CSS per 100m = slope × 100`. Needs ≥2 distinct distances for the stroke.
2. **Fallback — single-point Riegel proxy** (`riegelProjectCSS`, the old method): when a stroke has <2 distinct distances, project each effort to a 1000m-equivalent via `T2 = T1 × (D2/D1)^1.06`, ÷10 for per-100m, take the MIN. Still per-stroke.

**Why the change (verify-first, T088):** the old single-point Riegel + MIN was the SOLE method. It biased CSS too FAST — MIN picks the *fastest* projection, usually a short anaerobic-heavy effort, not a sustainable threshold — and the 1.06 exponent is a *running* fatigue constant (a poor fit for swimming, worse for fly/breast). The 2-point linear fit is the canonical CS estimate and self-corrects as the user logs varied distances; Riegel stays only as the cold-start fallback (1 distance). **Zone offsets unchanged** (Endurance +12, Threshold 0, VO2 −7 s/100m): the audit suggested deepening VO2 to CSS−8..−10, but that was premised on the OLD over-fast CSS; against the corrected (slower, more honest) CSS the existing −7 is appropriate, so it was deliberately left.

**Per-zone session prescriptions (`SWIM_ZONE_SESSIONS`, LOCKED):**

Drawn from Maglischo *Swimming Even Faster* (1993), Counsilman *Science of Swimming* (1968), and Costill's lactate-threshold research at Indiana University. The 10×100m T-pace set is THE canonical swimming threshold-test set used at every level from age-group to Olympic prep.

| Zone | Primary session | Variant |
|------|-----------------|---------|
| **Endurance** | 8 × 100m at endurance pace, leave on (pace + 10s rest) | 10 × 100m — more volume |
| **Threshold** | 10 × 100m at threshold pace, leave on (pace + 10s rest) — Costill's canonical T-pace test set | 5 × 200m |
| **VO2 Max** | 10 × 50m at VO2 pace, leave on (pace + 20s rest) | 6 × 100m at race pace |

The plan queue cycles through both variants per zone so consecutive same-zone steps look different (no five identical Endurance tiles in a row).

**Per-zone pace offsets from CSS (per 100m, LOCKED):**

| Zone | Offset | Effect |
|------|--------|--------|
| Endurance | +12 sec/100m | Conversational aerobic pace — 12 sec slower per 100m than CSS |
| Threshold | 0 | CSS itself — sustained moderate-hard |
| VO2 Max | −7 sec/100m | Race-pace work — 7 sec faster per 100m than CSS |

Offsets from Maglischo's training-zone tables. Same shape as Daniels' running offsets but tuned to swimming's narrower physiological window (water resistance means small pace changes are big effort changes).

**Leaving interval computation (LOCKED):**

`leaving_interval_secs = round_to_nearest_5(target_pace_per_100m × rep_distance_m / 100 + rest_secs_for_zone)` where `rest_secs` is 10s for Endurance/Threshold, 20s for VO2. Rounded to nearest 5s because pool clocks tick at 5-second granularity (5/10 second-hand intervals), and swimmers think in those units ("leave on the :30").

**Layout — single page, top to bottom (LOCKED):**

1. **Header** — back chevron + "Swimming" title + subtitle `Best — m:ss/100m` (or `/100yd` in yards mode). `TickerNumber` on the pace value.
2. **Progression plan card** (`<AnimateRise delay={0}>`):
   - Title `Your progression plan` + helper text
   - Tile row: 8 upcoming swim sessions, each tile shows zone label + work shape (reps × distance) + target pace. Tappable to drive the hero card. Leaving interval is on the hero only — too noisy for tiles.
   - **Hero card** (amber chrome, `min-h-220`): top-right info pill (zone label + Info icon, tappable for "why this zone"), then THREE stacked TickerNumber rows: Row 1 = work (`8 × 100m`), Row 2 = target pace (`1:38/100m`), Row 3 = leaving interval (`1:50`). Thin separator + full coaching cue sentence.
   - Attribution: `Riegel · Maglischo · Counsilman · Costill — CSS-anchored zones`
3. **Chart** (`<AnimateRise delay={250}>`) — pace per 100m over time, Y-axis reversed (lower = faster = trend down). Reference line at CSS.
4. **Log list** (`<AnimateRise delay={500}>`) — each row shows per-100m pace on the right (swim convention, not per-km).

**Log form (`cardio.tsx`) — swim-mode form variant (LOCKED):**

When `activity === 'Swimming'`:
- **Distance wheel**: INTEGER mode (step 25, min 0, max 5000) — not the decimal-km wheel. Pool distances always come in whole numbers.
- **Unit column**: locked chip showing `m` or `yd` (pulled from `profile.swim_unit`) — not the km/mi toggle. User sets the unit once in Settings; toggling per-log would be friction.
- **Time wheel**: stays `mm:ss` (max 99:00).
- **Save label format**: `Swimming · 1500 m in 25:00` (or `· 1640 yd in 25:00`). Old `· 1.5 km in 25:00` labels still parse via `parseEffortLabel` for back-compat.
- **Storage**: `value` column stores pace in seconds-per-km regardless of input unit (uniform storage across all pace-mode activities). Detail page divides by 10 for per-100m display.

**`profiles.swim_unit` column (LOCKED, migration `add_swim_unit_to_profiles`):**

- Type: `text NOT NULL DEFAULT 'm'`
- CHECK constraint: `swim_unit IN ('m', 'yd')`
- Settings UI: Profile page > Settings tab > "Swim distance" unit card row (separate from "Distance" — a user can run miles outdoors and swim meters indoors).

**Swimming-specific helpers in `[activity].tsx`:**

| Function | Purpose |
|----------|---------|
| `computeSwimCSS(efforts)` | CSS per stroke: 2-point linear fit, Riegel fallback; secs per 100m or null |
| `linearProjectCSS(efforts)` | 2-point linear Critical Speed (slope of time-vs-distance × 100); null if <2 distinct distances |
| `riegelProjectCSS(efforts)` | Cold-start fallback — single-point Riegel projection, MIN across efforts |
| `getSwimZonePaceSecsPer100m(zone, css)` | Apply zone offset to CSS; floor at 40 s/100m (faster than world record) |
| `buildSwimPlanStep(zone, css, swimUnit, session)` | Build one queue entry (work + pace + leaving interval + cue) |
| `generateSwimPlanQueue(efforts, css, swimUnit, count)` | Polarized-rule queue generator (same shape as running's, but per-100m and pulling from `SWIM_ZONE_SESSIONS`) |
| `classifySwimEffortZone(value, css)` | Classify a logged effort as endurance/threshold/vo2 in per-100m space |
| `fmtPaceSecsPer100m(secs)` | Format secs as `m:ss` |
| `fmtSwimDist(distM, swimUnit)` | Convert + format meters to m or yd display string |

**`parseEffortLabel` (`[activity].tsx`) — extended for swim formats:**

The regex chain in `parseEffortLabel` now handles `m` and `yd` units after the existing `km` and `mi` cases. Critical: the `m` regex requires `\s+in\s+` after the unit so it doesn't accidentally match the `m` in `mi`. Old km-format swim labels still parse correctly for back-compat.

**Out of v1 scope (deferred):**
- **Pool length input** — currently inferred (all prescriptions use 50m and 100m sets which fit any pool). Could become a profile preference later if needed.
- **Drill / pull / kick set prescription** — swim coaches differentiate full-stroke vs drill (technique) vs pull (no kick) vs kick (no arms). v1 just prescribes total work; the user picks the technique mix.
- **Canonical CSS calibration flow** — currently uses Riegel proxy. Add 400m+200m TT onboarding if proxy proves inaccurate in practice.
- **Cross-stroke CSS estimation** — when a user has logged efforts in only one stroke, we don't estimate their other strokes' CSS via stroke-conversion ratios (e.g. butterfly is typically ~30% slower than freestyle). Each stroke has its own empty state until the user logs an effort there. Cleaner UX, no fake numbers.

**Final cardio movements list update (May 17 2026):** the swimming consolidation replaces the single `Swimming` row with 4 stroke variants in the movements table. Updated catalog: **19 cardio movements** (was 16) — Air Bike, Bike Erg, Cycling, Cycling (Mountain Bike), Elliptical, Hill Running, Row Erg, Rucking, Running, Running (Treadmill), Ski Erg, Skiing, StairMill, Stationary Bike, **Swimming [Freestyle], Swimming [Backstroke], Swimming [Breaststroke], Swimming [Butterfly]**, Trail Running. The cardio index collapses the 4 strokes into a single "Swimming" row at display time so the user sees 16 visible activities.

---

## Mission, vision, and revenue model

### Mission
MyRX helps every person progress **one step at a time** across every domain that matters in their fitness — strength, cardio, mobility, body composition, nutrition, recovery, and the habits that hold it all together. Every screen, every card, every chart answers one question for the user: **"What's my next step here?"**

### Vision
One product, two audiences:
- **Coaches** who want a complete admin platform to run their entire client roster.
- **Self-coached individuals** who want a coach-quality next-step experience even without a human coach.

Both audiences use the same client-facing app. The coach version is the admin overlay on top of it; the self-coached version is the client UI minus the coach. **There is one product, not two.**

### Revenue model (two streams)

**Stream A — Coach subscription (B2B2C).** Coaches pay a monthly subscription for the admin portal. Their clients get the full client app at NO cost as long as the coach's subscription is active. The coach gets every client's data, chat, suggestion threads, progress dashboards, and the ability to message and program for the whole roster. This is the differentiator vs. Strong / Hevy / Strava — none of those sell a coach overlay.

**Stream B — App Store / Google Play tier (B2C direct).** Free download with a limited free tier. Full features unlocked by EITHER a recurring subscription (monthly) OR a one-time lifetime purchase. No coach involved — the app itself plays the coaching role through the "next step" framing built into every domain.

### Why so many domains? (the question that nearly tripped us up)
A coach helps clients with strength, cardio, mobility, body composition, nutrition, recovery, AND the habits that hold the whole program together — not just one of those. The B2B2C arm means the app must support what a coach actually does day-to-day, or the coach can't deliver their full service through MyRX. **Breadth is table stakes for the coach segment, not bloat.**

**Backed by May 2026 market research:** every successful B2B2C coaching platform on the market is multi-domain. Trainerize (#1, tens of thousands of coaches) covers strength, cardio, nutrition, macros, meal plans, habits, sleep, water, mindfulness, body weight, and wearable sync — they identify *five pillars of healthy living* (activity, nutrition macros, nutrition portions, mindfulness, sleep). TrueCoach, MyPTHub, Virtuagym, Exercise.com sit in the same range. **Shipping without sleep / water / habits would put MyRX BEHIND the segment standard, not ahead of it.**

For the B2C arm, multi-domain works at scale (MyFitnessPal, Peloton, Apple Fitness+ all dominate via breadth) but niche specialists charge more per user (Whoop $30/mo, Strava $12/mo) because they go deeper. **The depth is the lever for B2C competitiveness, not the breadth.**

### Product principle (the scope decider)
Two tiers of domain treatment, and the goal is to promote every domain from tier 2 to tier 1 over time:

1. **Coaching surface** — answers "what's my next step here?" the way the Strength detail page does today. Clear target value, specific prescription (sets / reps / weight / time / distance), rest / recovery cue, and a "why this matters" explanation. Coaching surfaces are competitive moats for both arms — they justify the B2C paid tier AND they make the coach's job easier in the B2B2C arm.

2. **Tracking surface** — logs data, surfaces trends, but doesn't prescribe a next step. Habit checkboxes, water intake, sleep duration, body weight trend. Still valuable for both arms — Trainerize's habit checkboxes are tracking surfaces with light coaching — but doesn't drive a B2C subscription on its own.

Promote in order of decision energy: training prescription comes first (strength + cardio), recovery / habits / hydration come last.

### Where each domain stands today
- **Strength** — coaching surface. Done.
- **Cardio** — coaching surface. Done (pace / rate-anchored zones across all Group-A activities + Air Bike, Rucking, StairMill, Swimming, Concept2 ergs).
- **Mobility** — ❌ **REMOVED (June 2026).** The legacy ROM-tracking feature was deleted everywhere: the mobile page (`mobile/app/(app)/mobility.tsx`), the mobile + web `ROMVisualizer`, the dashboard ROM feed/PR logic, and the web admin surfaces (`AdminMobilityDetail`, `AdminClientMobility`, the `rom_records` queries in AdminOverview/AdminFeed/AdminDashboard/AdminUserActivity/AdminUserDetail, the `/admin/.../effort/mobility/` route, the Navbar item, `MOBILITY_MOVEMENTS`). RETAINED: the `rom_records` DB table (historical data; no UI reads it) and the `delete-user`/export edge functions that clean it. Remaining incidental mentions are legal-doc prose and the UNRELATED cardio "Mobility" crawl-movement subtype (crab walk / bear crawl) — both intentionally kept.
- **Bodyweight** — tracking surface (weight + goal). **Coaching-surface promotion CLOSED (June 2026)** — stays a logging/tracking surface by design (user call; ledger T041).
- **Calories / Nutrition** — tracking surface (food log, macros, daily target, plan wizard + timeline). **Coaching-surface promotion CLOSED (June 2026)** — stays a logging surface by design (user call; ledger T042).
- **Sleep** — ✅ **coaching surface, built** (`mobile/app/(app)/sleep.tsx`). Does next-step guidance, not just tracking (ledger T043).
- **Hydration (Water)** — ✅ **coaching surface, built + redesigned** (`mobile/app/(app)/hydration.tsx`; mascot + fluid counting + fast picker; ledger T001 / T016 / T044 / T052-T062).
- **Habits** — not built. TBD whether first-party or Apple Health / Google Fit integration.

### Roadmap order (updated June 2026)
The coaching-surface roadmap is effectively complete — every surface getting a coaching layer has one:
1. ✅ Strength — coaching surface (done).
2. ✅ Cardio — coaching surface (done).
3. ✅ Sleep — coaching surface (done).
4. ✅ Hydration — coaching surface (done).
5. Bodyweight — coaching promotion CLOSED; stays a tracking surface (user call, ledger T041).
6. Calories — coaching promotion CLOSED; stays a logging surface (user call, ledger T042).
7. ~~Mobility~~ — removed entirely (June 2026).

Remaining open product work (see `docs/TASK_PIPELINE.xlsx`): finalize the Connect page + sync logic (T047), admin↔coach client-view parity (T015), wire the food-library filter rules into the SYNC scripts (T048), and the iOS launch checklist (T046 — deferred until the app is Android-complete).

---

### Three-tier role hierarchy (LOCKED, May 24 2026 — in-discussion, partial)

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

18. **Billing model — locked.**
    - **Coaches pay; their clients NEVER pay.** A client linked to an active coach has full feature access for free. The coach's subscription IS the client's access.
    - **Coach subscriptions are recurring monthly / annual**, paid via Stripe Checkout on the website (never inside the mobile app — no Apple/Google involvement). **Annual = 17% off first year ONLY; renews at full annual rate (monthly × 12) from year 2 onward.** Coach signup copy MUST explicitly say "first year" so the year-2 renewal price isn't a surprise. Pre-renewal email reminder + dashboard banner are part of Phase 9 launch readiness.
    - **Public users (unlinked) pay one-time per tier.** Upgrading is a single payment that grants lifetime access at that tier. No recurring billing for B2C clients. Three tiers: Free / CoreRX / FullRX. Once they buy CoreRX or FullRX, they own it forever.
    - **Free trial for coaches: 14 days.** Coach signs up via web, enters payment info, gets 14 days of full functionality at the tier they selected. Auto-converts to paid on day 15 unless they cancel. After conversion, follow Stripe's default Smart Retries (4 retry attempts over ~3 weeks) for failed payments. Lapse / soft-grace / hard-grace timeline per Q4 lock.
    - **Payment processor for direct billing: Stripe.** Coach subscriptions + B2C web-purchased one-time tiers both run on Stripe. Square is NOT the path forward — Stripe's subscription + dunning + tax + webhook ecosystem is meaningfully better for SaaS, and the cost is equivalent (~2.9 % + $0.30 / transaction).
    - **B2C in-app purchases use Apple IAP / Google Play Billing.** Mandatory per Apple Guideline 3.1.1 and Google Play Billing policy — any in-app feature unlock MUST use the platform processor. One-time non-consumable purchases work the same as subscriptions for this rule. **Apply for Apple App Store Small Business Program** at launch so revenue under $1M/year drops Apple's cut from 30 % to 15 %. Google Play has an analogous tier.
    - **Acquisition-channel-aware hybrid for B2C** (LOCKED — pattern 3 from Q9 discussion). In-app upgrade button uses IAP (Apple/Google take 15 %). Same upgrade is available on website via Stripe (we keep ~97 %). **Same price on both surfaces** — no in-app promotion of the cheaper web path, no compliance risk with Apple. Marketing (email, social ads, blog, organic search) pushes users to the website where they can convert via Stripe. Most early volume goes through IAP (App Store discoverability); blended cut comes down as the marketing engine matures and more conversions happen on web. Expected blended Apple cut after year 1: ~8-12 % of B2C revenue.

19. **Coach tier prices — locked (revised May 25 2026).**
    Annual prices reflect 17% off year 1 only; year-2 renewal = monthly × 12 (shown in parentheses).
    | Tier | Client cap | Monthly | Annual (year 1) | Annual renewal (year 2+) |
    |---|---|---|---|---|
    | Coach Starter | 10 | $19 / mo | $189 / yr | $228 / yr |
    | Coach Pro | 25 | $39 / mo | $389 / yr | $468 / yr |
    | Coach Elite | 26+ (truly unlimited) | $99 / mo | $989 / yr | $1,188 / yr |

    Notes:
    - Top tier was named "Coach Unlimited" in an earlier draft; renamed to **Coach Elite** May 25 2026. Code references use `elite` as the tier id.
    - Top-tier cap lowered from 50+ to 26+ — coaches at this volume are the agency / high-volume segment, not the typical solo coach.
    - **Client count = total clients linked to the coach (not active-only).** Coaches can SUSPEND a client to retain their data while freeing the slot (suspended client loses app access, is gently prompted to switch to a free or paid B2C tier). Reactivation requires the coach to be under their tier cap (or to upgrade). If a suspended client switches to self-coached, they unlink fully and disappear from the coach's roster. **Implementation of the suspend mechanism is its own discussion thread after the v1 pricing UI lands** — covers the suspend button UI on the coach side, the gentle prompt on the client side, the slot-reclamation logic, and the auto-unlink-on-self-coach-switch flow.

20. **Public (B2C) tier prices — locked (revised May 25 2026).** All one-time payments, lifetime access at that tier once purchased.
    | Tier | Pages unlocked | One-time price |
    |---|---|---|
    | Free | Strength + Cardio | $0 |
    | CoreRX | Free + Bodyweight + Calories | $39 (one-time) |
    | FullRX | CoreRX + Heart + Hydration + Sleep | $59 (one-time) |

    Notes:
    - Middle tier was named "SemiRX" in an earlier draft; renamed to **CoreRX** May 25 2026 — reads as "the essential prescription" instead of "half a prescription". Code references use `corerx` as the tier id.
    - Free is genuinely usable (not a trial) — drives adoption and exposes upgrade prompts.
    - CoreRX adds the two most-asked-for features (body composition tracking + calorie/macro coaching).
    - FullRX adds the wellness layer (HR / hydration / sleep) — appeals to power users / wearable owners.
    - Hydration and Sleep are NEW pages to build as part of FullRX (Sleep already has a design spec — see Sleep page section above; Hydration is net-new design + build).
    - Ads: discussion deferred to a separate phase. Free tier currently has no ads listed in this lock.

Open items still to discuss / track outside this thread:
- Notifications system — flagged as the **NEXT major phase AFTER the coach platform work lands.** Out of scope for THIS update, called out here so it doesn't slip later. Will cover: push notifications + in-app notification center for coach invites, coach messages, plan adjustments, milestone celebrations, check-in reminders, billing events, Suggestions replies, etc. Will need its own full design pass.
- Ad strategy (whether to include in Free tier, network choice, placement, opt-out) — deferred to a separate phase per user lock.
- Coach analytics deep-dive details (which specific metrics, dashboards) — surface is locked for v1 but the actual metrics to display need a design pass during implementation.
- Marketing tools details (referral program incentive structure, promo code system, attribution tracking) — surface is locked for v1, details TBD during implementation.

---

### Launch-required documentation — STATUS (updated May 26, 2026)

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

### Coach Invite Client flow — locked design spec (May 26 2026)

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

### Launch-day checklist (LIVE-MODE GO checklist)

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
15. **App Store Connect IAP products created** in production (not just sandbox):
    - `corerx_unlock` (non-consumable, $39 USD)
    - `fullrx_unlock` (non-consumable, $59 USD)
    Status: "Ready to Submit". Localize for at least English. Pricing applied to all relevant territories.
16. **Apple App Store Small Business Program** application submitted and APPROVED (drops Apple cut from 30 % to 15 % when annual revenue is under $1M). Approval is automatic if you qualify — apply early, takes a day or two.
17. **App Store metadata complete**: app name "MyRX", subtitle, description, keywords, screenshots (6.7-inch iPhone + 13-inch iPad), app preview videos (optional but helps conversion), age rating questionnaire complete, support URL, marketing URL, privacy policy URL.
18. **App Review Information** filled in App Store Connect: demo account credentials so Apple reviewers can test paid features (create a comp'd `fullrx` user just for review), contact info, reviewer notes ("MyRX is a fitness coaching platform. Use the demo account at the link below to test all paid features. Coaches sign up at myrxfit.com/coach/signup — not in-app").
19. **iOS binary uploaded** via Xcode / Transporter, processed successfully, attached to the version awaiting review.
20. **Submit for App Store review.** Typical Apple review = 1-3 days for routine apps. Be ready for at least one rejection round — address feedback, resubmit.

**Google Play Store:**

21. **Google Play Developer Account** active ($25 one-time).
22. **Google Play Console IAP products created**:
    - `corerx_unlock` ($39 USD)
    - `fullrx_unlock` ($59 USD)
    Status: "Active". Match Apple's product IDs so the mobile code uses one constant set.
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

**Rollback plan (have this ready BEFORE you launch):**

46. **Documented rollback procedure** — if a critical bug shows up in the first 24 hours, how do you revert? Cloudflare Pages: redeploy previous successful build via dashboard. App store: pull the binary from sale (Apple) / halt rollout (Google). Stripe: pause webhook endpoint, freeze new subscription creation via edge function feature flag.
47. **Feature flag for new signups** — a single env var (`SIGNUPS_ENABLED=true|false`) that the coach signup edge function checks. If something breaks, set it to false to stop new signups while leaving existing users unaffected. Avoids needing a full rollback.
48. **Communication template ready** for outage incidents — pre-drafted Twitter / status page post + email to active users. Don't write under pressure.

**Day-of (launch day proper):**

49. **Final smoke test** of the live signup flow ~1 hour before announcement.
50. **Announce.** Push your launch email, social posts, coach outreach emails. Don't do this until items 1-48 are checked.
51. **Watch the metrics live** for the first 2-4 hours — Stripe dashboard (new subscriptions), Supabase dashboard (signup row counts), error tracker. Be available to hotfix.

---

## Brand System (LOCKED — May 29 2026)

**The canonical brand book is `branding/BRAND.md`** (with paired `BRAND.html` rendering layer and `BRAND.pdf` externally-shareable PDF). Every decision about visual identity, voice, logo usage, color, typography, or brand application traces back to that document. If CLAUDE.md and BRAND.md contradict on a brand topic, BRAND.md wins.

### The 4 locked brand colors

| Token | Hex | HSL | Role |
|---|---|---|---|
| **MyRX Lime** | `#CAF240` | `hsl(73°, 87%, 60%)` | Primary accent — CTAs, the "RX" letters, ANY green anywhere in the app |
| **MyRX Dark** | `#121721` | `hsl(220°, 28%, 10%)` | Page background, icon background |
| **MyRX Surface** | `#171C26` | `hsl(220°, 24%, 12%)` | Cards, sheets, drawers — sits 2% lighter than Dark |
| **MyRX Foreground** | `#F4F3EF` | `hsl(60°, 5%, 96%)` | Text + iconography on dark surfaces |

These live in code at:
- **Web** — `web/src/index.css` (both `:root` light mode + `.dark` dark mode CSS variable blocks; every neutral on H=220 hue family)
- **Mobile** — `mobile/src/theme.ts` (the `HSL` object + `palette.myrx.*` hex entries)

### Why the dark is blue-tinted (locked May 29 2026 after green-tinted trial)

Originally locked at green-tinted dark (H=150) so the dark would share a hue family with the lime accent. User feedback during sweep: "too green on green" — the lime and the dark dissolved into each other instead of standing out.

Moved to blue-tinted dark (H=220) because H=220 sits ~147° from the lime (H=73) on the color wheel — close to complementary. The hue separation is what makes the lime POP against the surface instead of blending. Saturation 28% (BG) / 24% (card) was deliberately bumped from the more typical 12–18% range — at lower saturation, the H=220 dark reads as slate-grey instead of recognizable blue. The "blue on lime" pairing IS the brand signature; saturation enforces it.

Past attempts during the iteration (do not re-litigate without explicit user request):
- L=8% (deeper) → reads as grey because less light = less expressed color. Bad.
- S=42% (more saturated at L=10%) → too aggressive, reads navy-corporate. Bad.
- Final: `H=220, S=28%, L=10%` (BG) + `H=220, S=24%, L=12%` (card). User-approved.

### Tagline

**"Performance Lab"** — locked. Appears on the **Tag** logo variant (used for hero placements only — cover pages, marketing hero, presentation title slides). Never on app chrome, never in email signatures, never on social profile avatars. See BRAND.md Section IV "The Slogan Reservation."

### Logo system — 8 variants

Located at `branding/Logo/Final/`:
- `Logo Tag White/Black.{png,svg}` — wordmark + "Performance Lab" tagline (hero placements only)
- `Logo Clean White/Black.{png,svg}` — wordmark only, single-line (most contexts)
- `Logo Block White/Black.{png,svg}` — wordmark in stacked square (tight square spaces)
- `Logo Icon White/Black.{png,svg}` — square with safe-zone padding (favicon, app icon, avatars)

Both PNG + SVG for each. "White" = light text for use on dark BG. "Black" = dark text for use on light BG. The "RX" letters are always lime regardless of variant. **App icon / favicon = `Logo Icon White` (locked)**. Do not crop the Icon variant — its padding is intentional and protected by the safe-zone rule.

### Voice and tone

Locked separately in CLAUDE.md under "Voice and Coaching Philosophy (LOCKED — May 24 2026)" and externally documented in BRAND.md Section III. Never overridden. Every user-facing string runs through the 3-pillar coach voice: **acknowledge state → explain biology → name realistic next step**.

### Brand sync rule (cross-platform — MANDATORY)

When updating brand colors or visual tokens:

1. Update `web/src/index.css` light + dark mode blocks together
2. Update `mobile/src/theme.ts` HSL object + `palette.myrx` hex entries together
3. Bump the `--myrx-build` marker in `web/src/index.css` to force CSS hash rotation (cache-poisoning rule — see Browser/React scars section)
4. Update `branding/BRAND.md` if hex values change, then regenerate `BRAND.html` + `BRAND.pdf` (Chrome headless print-to-PDF: `chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="branding/BRAND.pdf" "file:///.../branding/BRAND.html"`)
5. Build + deploy web. Reload mobile.

NEVER let web and mobile drift on brand colors. NEVER introduce a new green shade — every green in the system is `#CAF240`. Semantic emerald (`#10B981`) is for "save succeeded" / "data persisted" only — different semantic from brand lime.

### Components reference

- **Web Tailwind classes** (resolve via the CSS variables above): `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, `bg-secondary`, `text-secondary-foreground`, `bg-accent`.
- **Mobile imports** from `mobile/src/theme.ts`: `import { colors, palette, alpha, withAlpha } from '@/theme'` — use `colors.background`, `colors.primary`, `palette.myrx.lime`, `palette.myrx.dark`, etc.
- **For HSL → HSLA alpha** (semi-transparent overlays): `alpha(colors.primary, 0.1)` produces `hsla(...)`.
- **For hex → rgba alpha** on palette entries: `withAlpha(palette.myrx.lime, 0.18)` produces `rgba(...)`.

### Past incident — color update gotcha (May 29 2026)

If you update brand colors but only on one side (web OR mobile), the cross-platform-consistency rule is violated. Both surfaces MUST land together in the same turn. See task log #314 / #318 for the May 29 2026 sweep where the original cool-blue-tinted dark `#0D0F11` (HSL 220, 12%, 6%) was migrated via green-tinted dark `#131A17` (HSL 150, 15%, 9%) — rejected by user — and finally landed at the locked blue-tinted dark `#121721` (HSL 220, 28%, 10%) across both codebases simultaneously, along with primary going from HSL(80, 95%, 55%) → HSL(73, 87%, 60%) to match the locked `#CAF240` lime.

---

## iOS reflection checklist (LOCKED — comprehensive sweep, May 26 2026)

MyRX has been built Android-first since day one. The `mobile/` Expo project has a fully wired `mobile/android/` native folder; there is no `mobile/ios/` folder, no Apple Developer Program enrollment, no AASA file, no HealthKit integration. This section is the canonical, exhaustive list of every iOS-specific tackle that must happen before iOS launch — each item linked to where the Android equivalent already lives so the iOS reflection pass has a 1:1 reference. Treat it like the existing "Pre-launch checklist" — work through it top to bottom when the user opens the iOS launch chapter. Length target: terse list, no prose padding.

### 1. Apple Developer Program + App Store Connect prerequisites
- [ ] Enroll in Apple Developer Program ($99/yr, requires DUNS for Northern Princess LLC entity).
- [ ] Create App Store Connect app record using `bundleIdentifier: com.myrx.app` (already declared in `mobile/app.json` line 17).
- [ ] Apply to **Apple Small Business Program** (15% cut vs 30%) — qualifying threshold ~$1M.
- [ ] Generate Apple Distribution certificate + provisioning profile (EAS Build handles this if `eas.json` is extended with iOS config — currently Android-only at `mobile/eas.json` lines 11-19).
- [ ] Generate Push Notification certificate (APNs key `.p8` preferred — works for dev + prod, no expiry).

### 2. `mobile/ios/` native folder bootstrap
- [ ] Run `npx expo prebuild --platform ios` to generate `mobile/ios/` (mirrors how `mobile/android/` was generated). Currently nonexistent.
- [ ] Add `ios.buildNumber` auto-increment + `ios.supportsTablet` decision (currently `false` at `mobile/app.json` line 16 — confirm vs iPad strategy).
- [ ] Extend `mobile/eas.json` with `ios` build profile (production + preview). Currently Android-only.
- [ ] Apply the existing config plugins to iOS: `withSamsungHealth` and `withHealthConnectPermissions` are Android-only by design (skip on iOS — they no-op). Net new iOS config plugin: `withAppleHealthKit` to inject HealthKit entitlement + Info.plist usage strings.

### 3. Info.plist permission rationale strings (all REQUIRED — iOS rejects without)
Android handles these as runtime prompts driven by `<uses-permission>` declarations in `mobile/android/app/src/main/AndroidManifest.xml` lines 2-17. iOS requires PRE-DECLARED human-readable strings in Info.plist or the app crashes when the permission is requested.
- [ ] `NSCameraUsageDescription` — already styled prose at `mobile/app.json` line 53 (expo-camera plugin `cameraPermission`). Verify carried into iOS Info.plist via the expo-camera plugin.
- [ ] `NSFaceIDUsageDescription` — already at `mobile/app.json` line 61 (`faceIDPermission` via expo-local-authentication). Verify iOS injection.
- [ ] `NSHealthShareUsageDescription` — net new. Mirror Samsung Health blurb from `mobile/app/(app)/settings.tsx` line 2118.
- [ ] `NSHealthUpdateUsageDescription` — net new (only if writing back; v1 is read-only — set to a forward-looking string anyway since v2 will write).
- [ ] `NSPhotoLibraryUsageDescription` — for avatar upload via expo-image-picker.
- [ ] `NSPhotoLibraryAddUsageDescription` — only if we ever export workout images.
- [ ] `NSMicrophoneUsageDescription` — Android already declares `RECORD_AUDIO` at AndroidManifest line 5; mirror reason on iOS or remove if unused.
- [ ] `NSUserNotificationsUsageDescription` — for expo-notifications. Android equivalent is the runtime permission in `mobile/app/(auth)/sign-up.tsx` around line 2697.
- [ ] `NSContactsUsageDescription` — only if coach-invite ever reads contacts (currently no).
- [ ] `NSMotionUsageDescription` — only if pedometer/CMPedometer used (currently HealthKit will own step data; skip).

### 4. Universal Links (iOS equivalent of Android App Links)
Android App Links work today via `web/public/.well-known/assetlinks.json` (debug SHA256 only — production cert pending per pre-launch checklist item 24).
- [ ] Create `web/public/.well-known/apple-app-site-association` (AASA) — JSON, NO `.json` extension, served as `application/json` Content-Type, NO redirect.
- [ ] Populate AASA with Team ID + bundle ID (`<TEAM_ID>.com.myrx.app`) and `paths` matching every deep-link route currently in `AndroidManifest.xml` lines 51-56 — at minimum `/auth/*` (signup confirm, recovery). Add future routes: `/coach/invite/*`, `/oauth/callback/*` (Strava/Polar/Garmin), `/reset-password`, `/share/*`.
- [ ] Add `applinks:myrxfit.com` to iOS `com.apple.developer.associated-domains` entitlement.
- [ ] Cloudflare Pages serves `.well-known/` from `web/public/` automatically — verify the AASA file is reachable at `https://myrxfit.com/.well-known/apple-app-site-association` with correct MIME type.

### 5. Apple HealthKit integration (mirrors Samsung Health Data SDK)
Samsung Health is the canonical Android integration: `mobile/android/app/src/main/java/com/myrx/app/samsung/SamsungHealthModule.kt` (native Kotlin module) + `mobile/src/lib/integrations/samsungHealth.ts` (TS service) + `mobile/plugins/withSamsungHealth.js` (config plugin). Per CLAUDE.md, `mobile/src/lib/healthConnect.ts` already returns `'unavailable'` on iOS as the safe-default seam.
- [ ] Pick a library: `react-native-health` (community, mature) OR write a native Swift module (full control, matches Samsung pattern). Recommendation: `react-native-health` for v1 to ship fast.
- [ ] Add HealthKit entitlement (capability) to iOS target via new config plugin (`withAppleHealthKit`).
- [ ] Permission set must mirror Samsung's data types: HeartRate, RestingHeartRate, Steps, DistanceWalkingRunning, ActiveEnergyBurned, BodyMass, WorkoutType. See `mobile/plugins/withHealthConnectPermissions.js` lines 40-51 for the Android equivalent list.
- [ ] Create `mobile/src/lib/integrations/appleHealthKit.ts` mirroring the `samsungHealth.ts` API surface (`requestConnect`, `getStatus`, `disconnect`, `syncRecent`, `ConnectionStatus` type).
- [ ] Wire `last_sync` storage via existing `mobile/src/lib/lastSyncStorage.ts` (the `'appleHealthKit'` integration key is already in the union — line 20).
- [ ] Heart page (`mobile/app/(app)/heart.tsx`) and Sleep page (pending — see proposed spec) must auto-switch source from `samsung_health` → `apple_healthkit` on iOS. Per-second HR log path: Samsung exposes `ExerciseSession.log[].heartRate`; HealthKit exposes `HKQuantityTypeIdentifierHeartRate` series — write a normaliser so `wearable_workouts.raw_meta.hr_log` JSONB stays the same shape across platforms.
- [ ] Add the `apple_healthkit` platform to the `user_integrations` RLS INSERT/UPDATE policies (`access_token IS NULL` guard already in place — migration `user_integrations_allow_owner_native_sdk_writes` covers it).
- [ ] Update `mobile/app/(app)/settings.tsx` Connect tab — the "Apple Health" placeholder at line 2118 graduates to a functional row mirroring the Health Connect / Samsung Health rows.

### 6. Sign in with Apple (MANDATORY if any social-login is offered)
App Store Review Guideline 4.8: any app offering third-party social login MUST also offer Sign in with Apple. We don't currently offer social login — but if we add Google / GitHub coach-signup before iOS launch, SIWA becomes mandatory.
- [ ] Audit signup flows (`mobile/app/(auth)/sign-up.tsx`, `web/src/pages/Signup.jsx`, `web/src/pages/coach/Signup.jsx`) — confirm email-only is the ONLY auth method.
- [ ] If social login is added: install `expo-apple-authentication`, add iOS capability, render SIWA button per HIG (must be equal prominence to other providers), wire to Supabase OAuth.

### 7. Push notifications (APNs — separate from FCM)
Currently `mobile/app.json` line 65-70 declares `expo-notifications`. Android side: no `google-services.json` checked in yet — FCM not wired (push is not active anywhere). Sign-up flow asks for permission at `mobile/app/(auth)/sign-up.tsx` line 2697.
- [ ] Apple Push Notification key (`.p8`) uploaded to Expo / EAS for push token issuance.
- [ ] Decide between Expo Push (managed) vs raw APNs (direct). For v1, Expo Push is simpler.
- [ ] Push token storage table in Supabase (`user_push_tokens(user_id, platform, token, created_at)`) — net new, neither platform writes one today.
- [ ] Notification categories / actions defined per iOS HIG (reply-from-notification for chat, snooze for plan reminders).

### 8. In-app purchases (iOS StoreKit, mirrors Play Billing)
Pre-launch checklist items 14-20 already cover App Store Connect IAP — extending here for completeness.
- [ ] Choose IAP wrapper: `react-native-iap` (cross-platform) or RevenueCat (managed). RevenueCat recommended for receipt validation + cross-platform entitlement sync.
- [ ] Register IAP products in App Store Connect matching Google Play product IDs: `corerx_unlock` ($39), `fullrx_unlock` ($59). Same IDs so client code uses one constant set.
- [ ] Subscription products (if monthly tier ships): register in App Store Connect with same lookup keys as Stripe (`coach_starter_monthly` etc.).
- [ ] Sandbox test accounts created in App Store Connect for App Review testing.
- [ ] Edge function: receipt validation endpoint (calls Apple's `verifyReceipt` / App Store Server API). Mirror what'll eventually exist for Google Play Developer API.

### 9. SMS auto-fill (built-in on iOS, library on Android)
Android uses `react-native-sms-user-consent` (lazy-required at `mobile/app/(app)/settings.tsx` line 56-60). iOS auto-fills natively via `UITextContentType.oneTimeCode` — no library needed.
- [ ] Verify every OTP input across the codebase has `textContentType="oneTimeCode"` + `autoComplete="sms-otp"` props set: `mobile/src/components/OTPInput.tsx` line 102 ✓, signup OTP screens, password-reset OTP, phone-OTP, email-OTP.
- [ ] Verify SMS body format from Supabase + Twilio Verify is compatible with iOS auto-fill heuristic (code must appear near the end of the message).

### 10. Biometric (Face ID branding + entitlement)
`expo-local-authentication` is cross-platform but Face ID has stricter requirements than Android fingerprint.
- [ ] `NSFaceIDUsageDescription` already declared at `mobile/app.json` line 61 — verify Expo plugin injects it correctly into Info.plist.
- [ ] Biometric credential storage already uses `expo-secure-store` which maps to iOS Keychain automatically — no change needed (`mobile/src/contexts/AuthContext.tsx` line 11).
- [ ] Verify Face ID fallback to passcode + the "Cancel" → "Use Password" flow renders the email/password screen correctly on iOS.

### 11. App Transport Security (ATS) + WebView
- [ ] Audit all `fetch()` calls for `http://` (non-TLS) URLs — iOS blocks plaintext HTTP by default. Worker URLs, Supabase, Cloudflare all already HTTPS; legal-doc opener (`mobile/src/lib/openLegalDoc.ts`) uses SFSafariViewController on iOS — no ATS issue.
- [ ] Confirm OAuth callback URLs use HTTPS (already do — `https://myrxfit.com/oauth/callback/*`).

### 12. App Store Connect launch readiness assets
Pre-launch items 14-20 list these — explicit iOS-only deliverables:
- [ ] App icon: 1024×1024 PNG, no alpha, no rounded corners (Apple rounds them).
- [ ] Screenshots: 6.7" iPhone (1290×2796) + 6.1" iPhone (1179×2556) + 13" iPad if iPad supported.
- [ ] App preview video (optional but boosts conversion): 30 sec max per device class.
- [ ] App Privacy "nutrition labels" — declare every data type collected (matches existing web `web/src/pages/legal/PrivacyPolicy.jsx`). HealthKit data flagged as "linked to user" + "not used for tracking".
- [ ] Age rating questionnaire (likely 4+; verify nothing in fitness content triggers higher).
- [ ] Demo account credentials for App Review (comp'd `fullrx` user with sample logs).
- [ ] Reviewer notes — coach signup at `myrxfit.com/coach/signup` is web-only, not in-app (App Store reviewers don't need a coach account).

### 13. Codebase audit — "iOS pending" / "iOS deferred" markers
These spots in the code already document iOS as a follow-up. Each becomes an actionable iOS task:
- [ ] `mobile/src/lib/healthConnect.ts` lines 9, 14, 41-43, 92, 112, 229, 277 — iOS safe-default branches. Replace with HealthKit dispatch once integration ships.
- [ ] `mobile/src/lib/integrations/samsungHealth.ts` lines 95, 132 — iOS unsupported_platform return; route to HealthKit on iOS via platform check.
- [ ] `mobile/src/lib/integrations/polar.ts` line 74 — note that OAuth callback handles iOS Universal Link (AASA must be live first).
- [ ] `mobile/app/(app)/settings.tsx` lines 2101, 2118, 2360, 2384 — "Apple HealthKit support coming for iOS" placeholder copy. Swap once HealthKit lands.
- [ ] `CLAUDE.md` line 1525, 1627, 1676 — wearable strategy markers; update when HealthKit migration ships.

### 14. Apple-specific UI / behaviour parity
- [ ] iOS Safari does NOT support `screen.orientation.lock` (per CLAUDE.md line 3812-3817) — barcode scanner gracefully degrades. Confirm visible "align horizontally" hint is sufficient on iPhone.
- [ ] Swipe-back gesture: `mobile/app/(auth)/sign-up.tsx` line 3176 notes Android hardware back works; iOS uses edge-swipe — verify every full-screen modal allows edge-swipe-to-dismiss.
- [ ] iOS Keyboard: `mobile/src/components/KeyboardScreen.tsx` line 7-19 already handles `behavior="padding"` for iOS. Run on physical iPhone to confirm.
- [ ] Date picker: `mobile/app/(app)/settings.tsx` line 251, 415, 1024 — iOS uses inline picker, Android uses imperative dialog. Already coded conditionally.

### 15. EAS Build + Submit for iOS
- [ ] `eas.json` extended with `ios` build profile (development + preview + production).
- [ ] `eas build --platform ios --profile production` succeeds end-to-end.
- [ ] `eas submit --platform ios` configured with App Store Connect API key.
- [ ] TestFlight internal testing group set up (Motaz + 1-2 beta testers) before App Review submission.

### 16. Documentation + handoff
- [ ] After iOS launch: update CLAUDE.md to remove "Android-first" framing and document iOS specifics (build commands, simulator gotchas, Xcode version pins, etc.) — mirrors the depth of the existing Android dev workflow section.

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

**What's NOT a placeholder (so don't strip these):**
- Icons in inputs (magnifying glass, send arrow, clear-X button)
- Empty-state text shown BELOW or BESIDE an input (e.g. "No results yet — try a different term")
- Default-selected values in dropdowns (the dropdown shows the selected option's label, that's a value, not a placeholder)
- Labels above inputs
- Helper text below inputs
- Mask/format hints baked into the input chrome (e.g. the static `/` separators in a date picker between the day, month, year cells)

**Audit follow-up:** the codebase has accumulated existing placeholders across signup, sign-in, search inputs, chat composers, food log search, coach signup, admin forms, etc. They all need to be swept and replaced with visible labels + helper text. This is a separate cleanup task to track once the Export Conversation feature ships — sweep all `placeholder=` attributes across web + mobile + edit drawers in one pass.

When in doubt: visible label above, helper text below, no placeholder inside. Ever.

---

## Account-deletion lifecycle + retention contract (MANDATORY, LOCKED May 28 2026)

Two phases of "deletion" — a 30-day reversible grace, then permanent anonymization that scrubs PII but retains specific tables for legal compliance.

### Phase 1 — Scheduled (reversible, 30 days)

Triggered by either path:
- **User-initiated**: athlete or coach taps "Delete my account" in their Settings → calls `schedule_account_deletion(null)` RPC.
- **Admin-initiated**: admin opens `/admin/user/:id` → clicks the Delete pill → calls `schedule_account_deletion(p_user_id)` RPC with admin auth.

Result: `profiles.scheduled_for_deletion_at = now() + 30 days`. The user CAN still authenticate (Supabase auth is untouched) but every protected route renders the **reactivation gate** instead of the normal shell:
- **Web**: `web/src/components/ReactivationGate.jsx`, mounted by `CoachProtectedLayout` AND `ProtectedLayout` whenever `profile.scheduled_for_deletion_at` is non-null.
- **Mobile**: `mobile/src/components/ReactivationGate.tsx`, mounted by `app/(app)/_layout.tsx` with the same condition.

Gate page shows: name + amber alert icon + days remaining + target date + [Reactivate my account] (calls `cancel_scheduled_deletion()`) + [Sign out]. On successful reactivation, `scheduled_for_deletion_at` clears → AuthContext refreshes profile → gate unmounts → normal shell renders.

If they never reactivate within 30 days, the nightly cron calls `anonymize_account_now(user_id)` for every profile whose `scheduled_for_deletion_at < now()`.

### Phase 2 — Anonymized (permanent, irreversible)

`anonymize_account_now()` does ALL of the following in one atomic transaction:

1. **Scrub `profiles` PII**: `full_name = 'Deleted User'`, `phone = NULL`, `avatar_url = NULL`, `birthdate = NULL`, `gender = NULL`, `anonymized_at = now()`, `anonymized_by = caller`, `scheduled_for_deletion_at = NULL`.
2. **Hard-delete personal training data** (bodyweight, efforts, food_logs, calorie_logs, rom_records, calorie_plans, hr_samples, step_samples, wearable_workouts, user_integrations) — these are not legally required to retain and contain sensitive health info.
3. **Unlink coach's athletes** (if the deleted account is a coach): all athletes get `coach_id = NULL`, `is_self_coached = true`, `coach_lost_banner_dismissed_at = NULL`.
4. **Scrub `auth.users`**: `email = 'deleted-<uuid>@anon.myrx.local'` (frees the original email for re-signup), `phone = NULL`, `banned_until = '2099-12-31'` (blocks future sign-in attempts permanently).
5. **Write `account:deleted` activity_events gravestone**.

### Retention contract — what survives anonymization

Anonymization NEVER touches these tables. They retain their `user_id` linkage forever (or per legal retention windows, typically 7 years):

| Table | Why retained |
|---|---|
| `messages` | Chat transcripts for legal export (subpoenas, abuse investigations, safety review) |
| `messages_admin_access_log` | Audit trail of every admin chat export |
| `activity_events` | Per-user audit log — every meaningful event for the account |
| `coach_subscriptions` | Stripe customer + subscription IDs for tax reconciliation |
| `billing_events` | Immutable per-event Stripe billing history (invoices, charges, refunds, disputes) — required for tax + accounting compliance |
| `b2c_purchases` | One-time athlete purchases — same compliance reason |

**The `billing_events` table is NEVER deleted from, by any caller, including admin.** Even when admin clicks Delete on a user, the trigger preserves the billing rows by virtue of `user_id` being a FK with `ON DELETE SET NULL` (we never hard-delete auth.users anyway — anonymization bans + scrubs the row instead). If a billing row is genuinely wrong, we issue a corrective Stripe event (refund, credit note) which creates a NEW `billing_events` row — never modify or delete existing ones.

### Fresh signup with the same email after anonymization

YES, the original email is freed for reuse the moment `anonymize_account_now()` runs (Step 4 above). When the user signs up again:
- Brand-new `auth.users` row → brand-new `user_id`
- Brand-new `profiles` row → no link to the old account
- Old anonymized profile still in DB under "Deleted User" with `auth.users.email = 'deleted-<old-uuid>@anon.myrx.local'` and `banned_until = '2099'`
- Old billing/messages/activity still queryable under the OLD `user_id` by admin
- New account has ZERO connection to the old data — clean slate from their perspective

This matches industry standard (Google, Apple, Meta all allow email reuse after account deletion).

### Stripe subscription pause / resume / cancel — intent layer (LOCKED May 28 2026)

The deletion lifecycle is wired to coach Stripe subscriptions through three "pending intent" timestamp columns on `coach_subscriptions`:

| Column | Set by | Cleared by | Phase 2 Stripe call |
|---|---|---|---|
| `pause_pending_at` | `schedule_account_deletion()` on coach accounts | orchestrator on success | `stripe.subscriptions.update(id, { pause_collection: { behavior: 'mark_uncollectible' } })` |
| `resume_pending_at` | `cancel_scheduled_deletion()` on coach accounts that had a pause pending or were already `paused` | orchestrator on success | `stripe.subscriptions.update(id, { pause_collection: '' })` |
| `cancel_pending_at` | `anonymize_account_now()` on coach accounts with an active sub | orchestrator on success | `stripe.subscriptions.cancel(id)` |

`coach_subscriptions.status` CHECK was widened to allow two new states: `paused` (Phase 2 destination after a successful pause API call) and `pending_cancel` (Phase 1 immediately flips the status here inside `anonymize_account_now` so admin UI / billing surfaces stop showing the sub as active before the Stripe cancel API lands).

**Phase 1 (SHIPPED — this migration):** the three RPCs MARK INTENT — set the pending timestamp, optionally update `status`, and write a `billing:subscription_orchestrator_pending` row to `activity_events` so the front-end / future orchestrator can react. **No Stripe API calls happen.** Every pre-existing lifecycle side effect (PII scrub, athlete unlink, auth.users ban, gravestone activity_events) is preserved verbatim.

**Phase 2 (DEFERRED — follow-up task):** build a `stripe-subscription-orchestrator` edge function (or admin action, or cron) that picks up rows where any `*_pending_at` column is set, calls the matching Stripe API, then clears the pending column on success and logs to `billing_events` (`type='subscription.paused' | 'subscription.resumed' | 'subscription.cancelled_lifecycle'`).

**Why deferred:** every Phase 2 call has real financial consequences (charging or not charging a customer). Marking intent first gives admin a review checkpoint AND lets us iterate the orchestrator independently of the deletion-lifecycle RPCs. The Phase 1 status flip to `pending_cancel` already protects the UI from showing an anonymized coach as actively billable, so the gap window is cosmetic — Stripe will still try to charge until Phase 2 ships, but admin / users see correct UI immediately.

Migration: `supabase/migrations/20260528_stripe_subscription_lifecycle_intent.sql` (applied May 28 2026 via `stripe_subscription_lifecycle_intent`).

### Activity Feed surfaces billing automatically

The trigger `billing_events_to_activity_events_trg` on `billing_events` mirrors every insert into `activity_events` with `event_type = 'billing:' || type`. So every invoice payment, refund, subscription change, and dispute shows up in the per-user Activity Feed tab without the UI needing to read two tables. `event_data` carries `amount_cents`, `currency`, `status`, `description`, and the relevant Stripe IDs for deep-link to Stripe Dashboard.

The `formatBillingAmount(d)` helper in `AdminUserDetail.jsx`'s `ActivityFeed` component formats the amount inline using `Intl.NumberFormat`. Same format as `BillingView` so the two surfaces read identically.

### Billing surface (`<BillingView userId={x} viewer="user"|"admin" />`)

One component, three places:
1. **Admin → `/admin/user/:id` → Billing tab** (`viewer="admin"`) — works for active, scheduled, AND anonymized accounts (anonymized gets the amber "tax records retained" header).
2. **Coach → `/coach/profile` → Billing tab** (`viewer="user"`) — coach's own billing surface. Scheduled / anonymized branches unreachable (reactivation gate blocks them, anonymized = can't sign in).
3. **Athlete → Settings → Billing** (Phase 7, when B2C ships) — same component, scoped to athlete user_id.

Layout: two stacked sections.
- **Current** — adaptive header. Coach sub: tier + status + renewal + Stripe customer ID. Anonymized: amber "anonymized on X" banner with retention notice. Athlete (Phase 7): purchase / sub status.
- **Transactions** — universal chronological list from `billing_events`, grouped by month, with tone-coded icons (green = paid, red = failed/refunded, blue = lifecycle, amber = dispute). Each row links out to Stripe Dashboard.

The component reads from `profiles` + `coach_subscriptions` + `billing_events` directly with no RPC needed — RLS on `billing_events` enforces the access rules (users see own, admins see all).

---

## What This Is
A React + Vite SPA (web — **coach portal + admin portal ONLY**; athletes have zero web surfaces, see "Web / Mobile role rule") + React Native / Expo app (mobile — the sole athlete surface, active) — a fitness coaching platform per the mission above. Athletes track strength, cardio, mobility, bodyweight, and calories on mobile. Coaches/admins manage clients, review progress, and communicate via chat/suggestions through the web portals.

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

**Post-sign-in routing (web `/auth?mode=signin`):**
- `profile.is_coach === true` → `/coach/portal`
- `profile.is_superuser === true` → `/admin/overview`
- Neither (athlete) → "Download the app" placeholder page

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

---

## Testing documentation rule (MANDATORY — locked May 27 2026)

Every new testable feature ships with a corresponding XLSX in `docs/testing/<feature_name>.xlsx` enumerating all end-to-end test scenarios.

**When this rule fires:** any feature that introduces a new user-facing flow with multiple states, edge cases, or branching paths. Examples that QUALIFY: coach invite flow, accept-invite flow, payment flow, signup journey, plan wizard, deferred deep linking. Examples that DO NOT qualify: trivial UI tweaks, copy changes, single-state pages, internal refactors.

**XLSX format (locked):**
- Title sheet: "Overview" with feature context (2-3 sentences) + summary table (scenario count, priority breakdown)
- One sheet per major scenario category (Sending, Accepting, Data Integrity, Email Delivery, UI/UX, Error States, etc.)
- Each scenario row has columns: **ID** (T-001 etc.), **Scenario name**, **Preconditions**, **Steps** (numbered plain-language list), **Expected result**, **Failure modes to watch for**, **Priority** (P0 critical / P1 high / P2 medium)
- Priority cells color-coded (P0 red, P1 orange, P2 yellow)
- Auto-filter on header row, frozen header + ID column
- Wrap text in long columns, auto-sized row heights
- Sheet names cannot contain `/` (openpyxl rejects — use "UI and UX" not "UI / UX")

**Why this rule exists:** the user reads these XLSX files to do end-to-end manual QA before shipping. Without a checklist, QA is ad-hoc and edge cases slip through. The XLSX format works in Excel + Google Sheets + Numbers, prints to paper, and can be ticked off row-by-row during a test session.

**Builder script convention:** put the openpyxl Python builder at `scripts/build_test_scenarios_<feature>.xlsx.py` so the XLSX can be regenerated from source whenever scenarios change. Mirror the style of existing builders at `scripts/build_launch_checklist_xlsx.py` and `scripts/build_reminders_xlsx.py`.

**Inaugural file (May 27 2026):** `docs/testing/coach_invites.xlsx` — 55 scenarios across 6 sheets (Sending Invites × 14, Accepting Invites × 16, Data Integrity × 7, Email Delivery × 7, UI and UX × 7, Error States × 4). Builder at `scripts/build_test_scenarios_xlsx.py`.

---

## Mobile Mirror (mobile/)

There is a **React Native (Expo) port of this app** at `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\`. It targets the same Supabase backend.

**⚠ SUPERSEDED by the "Web / Mobile role rule" (locked 2026-05-27). There is NO athlete web app — nothing in this section about a "web freeze," "freeze reversal," porting mobile surfaces to web, a web "Client View" at `myrxfit.com/dashboard` / `/strength` / `/cardio`, or a "1:1 web↔mobile mirror" applies anymore.** On 2026-05-27 every athlete web surface was deleted (the 13 page files were moved to `docs/_archive/web-athlete-pages/`); athletes are mobile-ONLY and web is the coach portal + admin portal exclusively. There is nothing to port mobile→web and no athlete mirror to maintain. The paragraphs below this banner are kept only for history. The only live cross-surface concerns now: (a) the shared Supabase backend (schema / RLS / triggers / edge functions), and (b) the coach/admin portals' OWN read-only views of athlete data (`AdminUserDetail`, `AdminEffortDetail`, `AdminCardioDetail`, `AdminMobilityDetail`, `AdminClientMobility`, `CoachClientDetail`, `MacroPlanEditor`, …) — when athlete data SHAPE or domain logic changes on mobile (formula constants, label/parse formats, new columns), check whether these web-native views need the matching update.

Reason for the reversal: the user QAs their own client experience on web (via the "Client View" link in the admin portal that drops them into their own end-user account at `myrxfit.com/dashboard`, `/strength`, `/cardio`, etc.). With web frozen, that experience visibly diverged from mobile and the user surfaced it as a regression — *"none of the mobile updates we did were reflected to the admin client view, we need to reflect all updates code by code, line by line"*.

We briefly tried an architectural shortcut (React Native Web aliasing to share components between mobile and web) on 2026-05-23 — it surfaced enough runtime issues (global undefined, React duplicate-instance, useContext throws) that we reverted the whole experiment. The committed plan is the boring path: **port every mobile-only surface to a native web React equivalent**. Different stacks, same UX, same data, same locked rules.

Going forward:
  - Mobile and web BOTH receive every design/feature change.
  - The 1:1 mirroring rule from the pre-2026-05-12 era is back in force.
  - When making a non-trivial change, audit BOTH surfaces (`web/src/` AND `mobile/`) before declaring done.
  - The cross-platform consistency rule (further down) is the active gating rule. The web freeze paragraph is dead.

**⚠ Iteration-phase web freeze (MANDATORY, locked May 24 2026).** The 1:1 mirroring rule above applies AFTER a mobile design is locked — NOT during active mobile-side iteration. When the user is iterating on a mobile feature (back-and-forth tuning of copy, numbers, layout, formula calibration, etc.) the web port is DEFERRED until the mobile spec settles. Mirroring every iteration step to web wastes time + ships unstable design + creates a moving target. Heuristic: if the user is still calling out things to change on a mobile surface within the same session, that surface is "in iteration" — touch only mobile. Once they say it's locked / good / ready, then do the web port. If unclear, ASK before mirroring. Default to mobile-only when in doubt during a back-and-forth tuning session.

The Calories self-coached plan wizard (mobile/src/components/PlanWizardSheet.tsx + mobile/app/(app)/calories.tsx) is in active iteration as of May 24 2026 — work is mobile-only until the user explicitly says it's locked. Recent web pushes for this surface during iteration were a rule violation surfaced by the user (*"i want no updates on web, put it in claude.md, it was supposed to be there"*) — don't repeat.

Mobile-to-web translation reference (used during the May 23 2026 catch-up port; keep around for ongoing parity work):

| Mobile | → Web equivalent |
|---|---|
| `<View>` `<Text>` `<Pressable>` | `<div>` `<span>` `<button>` |
| `StyleSheet` + `theme.ts` | Tailwind classes (already aligned by convention — colors + spacing + radius scale match) |
| Reanimated 4 worklets | CSS `@keyframes` + `transition` properties |
| `react-native-svg` | Plain SVG (same element API) |
| `PhantomWheel` (gesture wheel input) | HTML number input + ▼/▲ steppers, or scroll-snap on touch |
| `lucide-react-native` | `lucide-react` (already in web deps) |
| `expo-router` `<Link>` | Wouter `<Link>` |
| `useSafeAreaInsets()` | Not needed on web (no status bar / gesture nav) |
| `useFocusEffect` | `useEffect` (web doesn't have tab focus/blur the same way) |

The big design specs (animation Patterns 1-7, all the locked detail-card specs for strength/cardio/etc., tile conventions, info-pill content rule, chart-direction rule, "do not touch finalized surfaces" rule) all apply IDENTICALLY on web. Same colors, same hex values, same spacing scale, same locked behaviour. The translation is mechanical — the design language is shared.

### Current mobile port status

| Surface                  | Web file                                    | Mobile status                                                     |
|--------------------------|---------------------------------------------|-------------------------------------------------------------------|
| Dashboard                | `src/pages/Dashboard.jsx`                   | ✅ shipped                                                         |
| Strength                 | `src/pages/Strength.jsx`                    | ✅ shipped + polished. PhantomWheel-driven inputs (reps / weight / distance) with iOS-style inertia + tap-to-stop, SharedValue-driven text so the step-boundary commit is visually invisible (no more "labels flick up by one digit" artifact), unified 48 px Unit column across all triple-grid variants (standard / assisted / carry), unit-locked movements render "kg" / "lb" at the same size the toggle uses, 1-rep entries show "1RM" instead of "Estimated 1RM" on the live chip. |
| StrengthDetail           | `src/pages/StrengthDetail.jsx`              | ✅ shipped (per-exercise history + best-effort badges; all rep-based, isometric, assisted, carry, band-assist, knee-assist modes covered). |
| Cardio                   | `src/pages/Cardio.jsx`                      | ✅ shipped                                                         |
| CardioDetail             | `src/pages/CardioDetail.jsx`                | ✅ shipped                                                         |
| Mobility                 | `src/pages/Mobility.jsx`                    | ❌ REMOVED June 2026 — legacy ROM tracking deleted (mobile + web); rom_records table retained, no UI |
| Bodyweight               | `src/pages/Bodyweight.jsx`                  | ✅ shipped                                                         |
| Calories                 | `src/pages/Calories.jsx`                    | ✅ shipped (FoodLogDrawer + barcode scan)                          |
| History                  | `src/pages/History.jsx`                     | ✅ shipped                                                         |
| EditProfile              | `src/pages/EditProfile.jsx`                 | ✅ shipped (Profile + Settings tabs, line-by-line parity)          |
| ChatDrawer               | `src/components/ChatDrawer.jsx`             | ✅ shipped as `ChatSheet.tsx` (realtime, swipe actions, typing)    |
| SuggestionDrawer         | (admin → client suggestion thread)          | ✅ shipped as `SuggestionSheet.tsx`                                |
| Auth (signin only)       | `src/pages/Auth.jsx`                        | Web is sign-in only since web sign-up moved to `/signup`. Forgot-password lives here, sends a magic link via `supabase.auth.resetPasswordForEmail`. Defensive `?mode=signup` redirect to `/signup` for old emails / external links. Mobile keeps fingerprint sign-in via `expo-local-authentication` + `expo-secure-store`; Android App Links via `public/.well-known/assetlinks.json` |
| Sign-up journey          | `src/pages/Signup.jsx`                      | ✅ 19-screen onboarding (welcome → units → modality → magic ×3 → body data ×4 → whats-next → email + password + email-OTP → name → phone + phone-OTP → photo → notifications → welcome-end). Email OTP via Supabase auth, phone OTP via Twilio Verify edge functions. 512px JPEG avatar via crop+downscale. Step + data persisted to sessionStorage so app-switching to read SMS doesn't reset progress. |
| CompleteProfile          | `src/components/CompleteProfile.jsx`        | ✅ Recovery mini-journey for users with `auth.users` row but incomplete `profiles` row. Mirrors Signup design (welcome → units → sex → dob → height → weight → name → phone+OTP → photo → done). `ProtectedLayout` gates on `isProfileComplete()` (`src/lib/profile.js` — checks full_name + gender + birthdate + current_weight + current_height) so the mini-journey doesn't kick the user out mid-flow when phone-otp partially writes the row. Done screen waits for explicit "Open my dashboard" click. |
| MobilityDetail           | `src/pages/MobilityDetail.jsx`              | ❌ REMOVED June 2026 (never shipped)                                |
| Landing                  | `src/pages/Landing.jsx`                     | N/A — mobile launches straight to sign-in/dashboard                |
| Admin portal (15+ pages) | `src/pages/admin/...`                       | N/A — web-only by design                                           |

### Brand / logo rules (MANDATORY — applies to web + mobile)

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

### Cross-platform feature gates (current)

- **`profile.is_superuser`** hides the two share-with-coach toggles on the Settings page (admin has no coach). Applied in:
  - `src/pages/EditProfile.jsx` (end-user web, when admin is in client view) — `isAdmin` check
  - `src/pages/admin/tabs/AdminUserProfile.jsx` (admin's own profile via `/admin/profile`) — `isOwnProfile` prop
  - `mobile/app/(app)/settings.tsx` (mobile, defensive) — `isAdmin` check
- **Profile refresh no longer unmounts the route tree.** `App.jsx` `ProtectedLayout` only renders `<ShellSkeleton />` when `profile` is `null` (initial load), not on every `refreshProfile()` call. Mirrors mobile's `(app)/_layout.tsx` guard.

### Mobile auth infrastructure (shipped)

The mobile app uses a hybrid email-confirmation model where each Supabase auth email contains BOTH a magic link (web users tap it → existing redirect flow) AND a 6-digit OTP code (mobile users type it → in-app verification). All 5 Supabase email templates (Confirm sign up, Reset password, Magic link, Change email, Invite user) are branded with MyRX and use this dual-format pattern.

- **Email templates** edited in Supabase Dashboard → Authentication → Email Templates. Each contains `{{ .ConfirmationURL }}` (for the lime "Confirm/Reset" button) and `{{ .Token }}` (the 6-digit code shown below the button).
- **Redirect URL allowlist** has `https://myrxfit.com/auth/confirm` and `/auth/recovery`. These are what mobile's `signUp()` and `resetPasswordForEmail()` calls pass as `emailRedirectTo`.
- **Android App Links** via `public/.well-known/assetlinks.json` (deployed with the web app). Contains the mobile app's package name (`com.myrx.app`) and SHA256 fingerprint of the debug keystore. When a user taps the magic link from their phone with the app installed, Android opens the app directly instead of the browser. Production keystore fingerprint must be added to this JSON before Play Store release.
- **Biometric sign-in** (mobile only): user opts in from Settings → Sign-in card. App stores `email + password` encrypted in SecureStore (`expo-secure-store` + Android Keystore-backed encryption). Sign-in screen shows a Fingerprint button when biometric is enabled. `signOut()` keeps the credentials so fingerprint still works after logout — by design.
- **Web is currently a 19-screen onboarding journey** at `/signup` (Signup.jsx). Mobile's 5-step flow is the older synthesis of `Auth.jsx` (3 steps) + `CompleteProfile.jsx` (3 steps); the next sync should bring mobile in line with web's longer journey OR keep them divergent — TBD.

### Phone verification (Twilio Verify)

Phone OTP is wired through Twilio Verify, NOT Twilio Programmable Messaging. Verify uses pre-registered shortcodes — no A2P 10DLC compliance hoops, works globally on day 1.

- **Edge functions**:
  - `send-phone-otp` — calls Twilio Verify `Verifications` resource. Twilio handles code generation, TTL (10 min), and resend cooldown (60 s). We don't store anything ourselves anymore; the old `phone_otp_codes` table was dropped.
  - `verify-phone-otp` — calls Twilio Verify `VerificationCheck`. On `approved` status, atomically writes `profiles.phone` + `profiles.phone_verified_at` via UPSERT (so this works for both new-phone change flow and signup-time verification).
- **Required Edge Function secrets**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Set in Supabase Dashboard → Edge Functions → Secrets.
- **Sandbox mode** (trial Twilio account): SMS only delivers to numbers added in **Phone Numbers → Manage → Verified Caller IDs**. Adding the credit card to the Twilio account exits trial, lifting the verified-only restriction.
- **Web OTP API zero-tap**: the `navigator.credentials.get({ otp })` listener is parked in both `Signup.jsx` PhoneOTPScreen and `CompleteProfile.jsx` PhoneOTPScreen. To re-enable: submit a custom Twilio Verify template with `@myrxfit.com #{{1}}` suffix, get it approved (1-3 business days), pass `TemplateSid` from `send-phone-otp`, then restore the listener (long comments in both files explain the exact restore steps).

### Profile completeness gate

`ProtectedLayout` (`App.jsx`) doesn't gate on `if (!profile)` — it gates on `if (!isProfileComplete(profile))` from `src/lib/profile.js`. This is what enables the CompleteProfile mini-journey to write profile fields incrementally without ProtectedLayout kicking the user out the moment any field is set. The "complete" check requires `full_name + gender + birthdate + current_weight + current_height`. Phone is not required (legacy users without phones shouldn't be force-routed through a mini-journey on every login).

### Working across web + mobile in one session

The mobile codebase lives at `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile` (Expo / React Native, Expo Router). The two projects share Supabase backend, edge functions, RLS policies, and DB schema. Both are accessed from the same Claude Code session — there's no separate workspace.

When making changes that touch both sides:
1. Edit the relevant files in whichever side you're starting from
2. Either propose the equivalent diff on the other side and confirm with the user before touching it, OR mirror it directly if the change is mechanical (e.g. shared formula constants)
3. Run typecheck / build on both sides if relevant

---

### Mobile dev environment

**Repo location:** `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\`
There is a small `mobile/CLAUDE.md` stub pointing back to this file — this section is the single source of truth for mobile dev guidance.

#### Tech stack
- Expo SDK 54, React Native 0.81, React 19
- New arch enabled (`newArchEnabled: true` in `app.json`)
- `expo-router` v6, file-based, `(app)` group for authed routes, `(auth)` group for sign-in / sign-up / forgot-password
- Same Supabase project as web (`xtxzfhoxyyrlxslgzvty`)
- Storage: `@react-native-async-storage/async-storage` (Supabase session + `dataCache` + signup journey state at key `myrx.signup.state`)
- Icons: `lucide-react-native` (NEVER emojis as icon substitutes — only emojis the web file itself uses inline are allowed, e.g. 🗓️/🏆/📅 in Dashboard stat chips)
- Animations: `react-native-reanimated` v4 + `react-native-worklets`
- Gestures: `react-native-gesture-handler` (drives `DeleteAction`'s swipe mode for chat bubbles)
- SVG / charts: `react-native-svg` (custom Fritsch-Carlson monotone-cubic curve in `LineChart.tsx` mirrors Recharts' `type="monotone"`; tap-to-pin tooltip replaces hover)
- Image picker: `expo-image-picker`; resize: `expo-image-manipulator` (avatars 512×512 JPEG @ 0.85 quality)
- Camera (food scan): `expo-camera`'s built-in barcode scanner. **`expo-barcode-scanner` is REMOVED** — deprecated, breaks Kotlin compile on SDK 54
- Biometric sign-in: `expo-local-authentication` + `expo-secure-store`

#### Daily dev workflow — physical Android device via USB (primary)

The user runs against a physical phone connected by USB cable, not Expo Go and not an emulator. **Reanimated 4 + new arch is broken in Expo Go**, so the only valid runtime is a custom dev-client APK installed on the device.

1. **Connect the phone**: USB cable; on the phone enable Settings → Developer options → USB debugging; accept the "Allow USB debugging from this computer" prompt that pops on the phone the first time.
2. **Verify the laptop sees it**:
   ```powershell
   adb devices
   ```
   Expect one line with status `device` (not `unauthorized`, not `offline`). If `unauthorized`, accept the dialog on the phone. If nothing shows, replug the cable and run `adb kill-server; adb start-server`.
3. **Forward Metro from laptop:8081 → phone localhost:8081** (so the dev client connects without needing the laptop's LAN IP):
   ```powershell
   adb reverse tcp:8081 tcp:8081
   ```
4. **Start Metro**:
   ```powershell
   cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
   npx expo start --dev-client --port 8081
   ```
5. **Open the MyRX dev client app on the phone.** It auto-connects to `localhost:8081`. JS edits hot-reload.

If the dev client APK isn't installed on the phone yet (first-time setup, or after a native module change), run from the mobile repo:
```powershell
npx expo run:android
```
This compiles + installs the APK directly to the connected device. First build is 8–10 min; subsequent native rebuilds are 1–3 min.

#### Daily dev workflow — WiFi after the APK is installed (preferred ongoing workflow)

The user's normal pattern is: USB only for the initial APK transfer, then **disconnect the cable and work over WiFi for the rest of the session.** The dev-client app on the phone is named **"myrx"** (visible in the launcher).

Once the APK is on the phone:
1. **Phone and laptop must be on the same WiFi network.** Trivially true at home; verify if travelling.
2. **Disconnect the USB cable** — no longer needed.
3. **Start Metro** from the mobile repo:
   ```powershell
   cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
   npx expo start --dev-client --port 8081
   ```
   Metro's terminal output shows a `exp+myrx://expo-development-client/?url=http%3A%2F%2F192.168.x.x%3A8081` URL and a QR code. The IP in that URL is the laptop's LAN IP — that's how the phone reaches Metro.
4. **Open the "myrx" app on the phone.** It remembers the last Metro URL it used; if the laptop's IP hasn't changed, it just connects. If the IP changed (new WiFi, DHCP lease swap, etc.), the dev client lands on a "Choose a development server" screen — scan the QR from Metro's terminal output, or tap the recent URL if it's listed.
5. **JS edits hot-reload automatically.** No phone-side action needed for code changes.

#### Reloading + opening the dev menu on the phone
- **Assistant must auto-reload after every JS/TS edit.** The user does NOT want to be asked "shake to reload?" or "let me know when you've reloaded" — the assistant pushes the reload itself, every single time, by running:
  ```powershell
  adb shell am force-stop com.myrx.app
  adb shell monkey -p com.myrx.app -c android.intent.category.LAUNCHER 1
  ```
  This kills the app and relaunches its main activity, which gives a fresh JS context that re-fetches the latest bundle from Metro. **Why force-stop + monkey instead of `adb shell am broadcast -a com.facebook.react.devsupport.RELOAD`:** broadcasts return `result=0` ("delivered") but no receiver is registered for them under Expo SDK 54 + new arch, so they're a silent no-op. Only the force-stop + relaunch path actually reloads. Verify success with `adb shell pidof com.myrx.app` before vs after — the PID should change.

  Run as the LAST step of any turn that edits a `.ts`/`.tsx`/`.js`/`.jsx`/`.json` file under `mobile/`. Skip ONLY when there's no Metro server attached (e.g. native rebuild in progress) or the user explicitly says not to reload yet.

  **"Change not appearing after reload" scar (LOCKED, June 6 2026 — corrected).** When a mobile edit doesn't show up after a reload there are TWO distinct causes. **Check the CODE one FIRST — it's more common than it looks and it masquerades as a cache problem:**
  - **(a) The change is a silent no-op in the code.** The June 6 2026 Pull-Up chart fix looked "stuck" across many reloads AND survived a Metro `--clear` restart — but the real cause was a **temporal-dead-zone bug**: `bwHasWeighted` referenced `bwActiveTier` ~170 lines BEFORE its `const` declaration, so it evaluated to `undefined` → the `=== bwActiveTier` check was silently always-false → the chart never switched to "Est. 1RM over time". Old code and "new-code-whose-condition-is-always-false" render IDENTICALLY, so you cannot tell them apart by looking at the screen. **Diagnosis:** confirm the edit is on disk, then VERIFY THE NEW CONDITION ACTUALLY EVALUATES TRUE for the real data — here: query the DB for the efforts and confirm a loaded effort exists in the active tier — and check no variable is read before its `const`/`let` declaration (TDZ → `undefined`/always-false, no crash). The fix was moving the block below `bwActiveTier` (commit f03b01b); nothing cache-related.
  - **(b) Genuine stale Metro cache.** This CAN happen (repo under OneDrive, whose file-watcher sometimes misses edits): a force-stop + relaunch gives a fresh JS *context* but re-fetches whatever bundle Metro currently has, and Metro may not have re-transformed the changed file. Fix: restart Metro with **`--clear`** (`npx expo start --dev-client --clear --port 8081` from `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile`); it prints `Bundler cache is empty, rebuilding`. **But do NOT assume this is the cause** — the June 6 case was (a), and `--clear` did not fix it. Rule out (a) by verifying the code path before blaming the cache.
  Either way: never tell the user to delete + re-log their data — the data is not the problem.

  **Important caveat: `adb` commands require USB.** When the user has disconnected the cable to work over WiFi (their normal pattern after the initial build install), `adb devices` returns empty. In that case:
  1. Metro's Fast Refresh pushes JS-only edits to the connected dev client over WebSocket automatically — most edits don't need any reload trigger.
  2. For changes that Fast Refresh can't apply hot (new routes, new top-level effects, certain context refactors), the assistant must explicitly ask the user to shake the phone and tap Reload — there's no remote reload over WiFi.
  3. Verify USB attachment with `adb devices` BEFORE attempting force-stop. If empty, skip the reload command and tell the user what to do.
- **Shake the phone** → the React Native dev menu pops (Reload, Debug, Toggle Inspector, etc.). Standard RN gesture; works in the "myrx" dev client too. Fallback when the broadcast doesn't reach the device (some Samsung firmware filters dev-support broadcasts).
- **Reload from the menu** — picks up the latest JS bundle from Metro. Equivalent to `r r` in Metro's terminal.
- **"Toggle Inspector"** — tap any element on screen to see its component tree (useful for layout debugging).
- **Settings → Configure development server** — change the Metro URL when the laptop's LAN IP changes.

**CRITICAL — never deep-link the dev client to `localhost:8081`.** That URL only resolves on the phone via an active `adb reverse tcp:8081 tcp:8081` USB tunnel. The moment the user unplugs the cable, the phone tries to connect to its OWN localhost (which has nothing on port 8081) and the dev client errors out. For every cold-launch via deep link, ALWAYS use the laptop's LAN IP, e.g.:
```powershell
adb shell am start -W -a android.intent.action.VIEW \
  -d "exp+mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.187%3A8081" \
  com.myrx.app
```
The dev client persists the last-used URL across cold-starts. Once it's pointed at the LAN IP, the user can keep USB unplugged forever and reloads still work over WiFi — `adb shell am force-stop com.myrx.app` + `adb shell monkey ...` only need USB at the moment of the kill, not for the bundle fetch that follows. If you absolutely need `localhost` (e.g. testing changes on a network that blocks port 8081), explicitly run `adb reverse tcp:8081 tcp:8081` in the same turn AND remind the user to keep the cable in.

The laptop's current LAN IP can be read from `Get-NetIPAddress -AddressFamily IPv4 | Where { $_.PrefixOrigin -ne 'WellKnown' }`. It usually doesn't change during a session, but if the user roams networks (home → office → café), it will change and the dev client will need to be re-pointed (shake → "Configure development server" → new URL).

If the phone can't reach Metro after a network change:
- Confirm laptop and phone are on the same SSID.
- Confirm Windows Firewall isn't blocking inbound on port 8081. Symptoms: `adb shell ping -c 3 <laptop-LAN-IP>` shows 100% packet loss AND `adb shell curl http://<laptop-LAN-IP>:8081/status` times out, while `curl http://localhost:8081/status` from the laptop returns 200. Fix (requires UAC elevation):
  ```powershell
  netsh advfirewall firewall add rule name="MyRX Metro 8081" dir=in action=allow protocol=TCP localport=8081 profile=private,public
  netsh advfirewall firewall add rule name="ICMP Allow incoming V4 echo request" protocol=icmpv4:8,any dir=in action=allow profile=private,public
  ```
  These rules persist across reboots; you only need to add them once. Both use `profile=private,public` so they apply whether the WiFi network is classified as Private (home) or Public (cafe / hotspot).
- Worst case, plug in USB and `adb reverse tcp:8081 tcp:8081` again as the fallback.

#### adb-over-WiFi (LOCKED, May 18 2026 — preferred over USB except for the initial setup)

The user explicitly told us not to ask for the USB cable again once wireless adb is established. The cable is needed exactly ONCE to flip the switch; everything afterward — `adb logcat`, `adb shell`, `dumpsys`, `pm list`, etc. — works over WiFi until the phone reboots.

**ALWAYS reconnect at session start (LOCKED, May 19 2026):** the wireless adb endpoint is sticky on the phone until reboot, but the laptop's adb daemon forgets paired WiFi devices when its own process restarts (laptop reboot, daemon kill, etc.). So at the start of every session — before touching anything mobile — run:
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" connect 10.0.0.116:5555
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices    # should show the WiFi endpoint
```
If `adb connect` returns `connected to 10.0.0.116:5555` and `adb devices` lists `10.0.0.116:5555  device`, you're set — no cable needed. If it returns `failed to connect` or the endpoint shows up as `offline`, the daemon's wireless mode dropped (phone reboot, etc.) — then ask the user to plug in USB ONCE so you can re-run the one-time setup below.

**One-time setup with the cable plugged in:**
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" tcpip 5555
Start-Sleep -Seconds 2
& "$env:ANDROID_HOME\platform-tools\adb.exe" connect 10.0.0.116:5555
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices    # should show both endpoints
```

**Important effects of `adb tcpip 5555`:**
- The adbd daemon on the phone restarts in TCP mode. Any previous USB endpoint (`R5GYC0VWG4A` style serial) becomes unreachable for a few seconds while the daemon re-binds.
- **`adb reverse tcp:8081 tcp:8081` is destroyed** by the tcpip flip and CANNOT be re-armed over WiFi (`adb reverse` is a USB-only feature). After `tcpip`, the dev client MUST use the laptop's LAN IP (`http://<laptop-IP>:8081`), not `localhost`. If the LAN bundle stream is flaky, your only USB-tunnel option requires re-plugging AND running `tcpip 5555` again (the USB-mode bit is sticky until reboot or `adb usb`).
- The WiFi endpoint persists until the phone reboots OR you run `adb usb` to revert. After a reboot, the user has to replug the cable and re-run `adb tcpip 5555` exactly once.

**Discovering the phone's IP without USB:** `adb shell ip route` (over WiFi) returns `10.0.0.0/24 dev wlan0 ... src <IP>`. If even the WiFi adb is dead, ask the user to read it from **Settings → About phone → Status info → IP address** on the device.

**Wireless adb does NOT enable Metro tunneling.** The `adb reverse` trick that lets the phone hit `http://localhost:8081` over USB has no WiFi equivalent. Once you're wireless, the dev client URL MUST be the laptop's LAN IP. If the LAN bundle stream stalls (the `Software caused connection abort` mid-multipart symptom we've hit), the fallback is to physically replug the cable, run `adb tcpip 5555` if you want to stay wireless after, then deep-link the dev client to localhost; OR fix the underlying WiFi flakiness (Windows TCP keepalive / firewall / power-save on the phone's wlan0 chip).

**Do not ask the user to re-plug for diagnostics.** If `adb devices` shows the WiFi endpoint as `10.0.0.116:5555 device`, everything else works the same — `logcat`, `pidof`, `dumpsys`, `pm list packages`, `run-as <pkg>`, `cat shared_prefs/...` all run unchanged over WiFi. The only commands that fail are `adb reverse` and `adb push` to large files (slower but functional).

**Reading a device-side error / red box without asking the user (LOCKED, May 19 2026):**

When the user says "I have an error showing" or similar, do NOT ask them to paste it. Read it directly:

```powershell
# 1. Take a screenshot via wireless ADB — the LogBox red-box / yellow-box
#    overlay renders as part of the device UI, so it's captured.
adb -s 10.0.0.116:5555 exec-out screencap -p > "C:/Users/motaz/myrx-error-screen.png"

# 2. Read the PNG via Claude's Read tool (multimodal — reads images natively).
#    The error message + call stack is visible in the screenshot.
```

This works because the dev client's LogBox renders in the Android view hierarchy like any other UI. The `screencap` command captures the entire screen including the overlay. Then `Read` parses the image and surfaces the text.

`adb logcat` is the fallback if the error is a silent JS warning that doesn't display a box, but for any visible red/yellow box this screencap trick is faster and surfaces the formatted error text + call stack exactly as the user sees them.

**GestureDetector + view flattening (LOCKED, May 19 2026):**

When wrapping a non-`<View>` element (custom component, `<NextTargetCallout>`, etc.) in a `<GestureDetector>`, the child MUST be a `<View collapsable={false}>` — gesture-handler attaches its native handler to the child's underlying Android view, and React Native's view-flattening pass can erase non-essential Views at native level, leaving the gesture without an anchor. Symptom: red-box `[react-native-gesture-handler] GestureDetector has received a child that may get view-flattened. To prevent it from misbehaving you need to wrap the child with a <View collapsable={false}>.`

Plain `<View style={...}>` with explicit styles usually isn't flattened (the style forces a native node), so simple cases like `<GestureDetector><View style={...}>...</View></GestureDetector>` don't need the explicit `collapsable={false}` flag. Custom components or stateless wrappers around content (like `NextTargetCallout`) DO need it.

#### Background-process output buffering (PowerShell pipelines)

A common time-waster: when launching a long-running build via `run_in_background`, **never** end the command with `| Select-Object -Last N` or any other aggregator-style filter. `Select-Object`, `Sort-Object`, `Group-Object`, etc. are all "wait for the entire stream" cmdlets in PowerShell — they buffer until EOF, which means the output file stays empty until the process exits. If you need to keep memory usage low, redirect the full stream and tail later:

```powershell
# WRONG — output file empty until the build finishes:
& .\gradlew.bat installDebug 2>&1 | Select-Object -Last 50
# (Select-Object only emits at EOF)

# RIGHT — output streams live, tail with Bash / Read tool later:
& .\gradlew.bat installDebug 2>&1
# (raw stdout/stderr stream straight into the captured background log)
```

To filter LIVE for specific lines (e.g. `BUILD SUCCESSFUL` / `error:`), use the Monitor tool with `tail -f <output-file> | grep --line-buffered ...` instead of trying to filter inside the PowerShell pipeline.

#### When the dev client APK needs rebuilding (`npx expo run:android`)
Only when one of these changes:
- A new native module is added (`npx expo install <pkg>` for anything that has Android/iOS code)
- `app.json` plugin config changes
- `babel.config.js` changes
- Expo SDK version is bumped

Plain JS / TS / TSX edits (95% of work) hot-reload through Metro — never trigger a rebuild for those.

**Use `npx expo run:android`, NOT raw `gradlew installDebug` (LOCKED, May 18 2026):**

`npx expo run:android` automatically passes an ABI filter that restricts native-lib compilation to ONLY the connected device's architecture — Galaxy S25 is arm64-v8a, so only arm64 native libs get built. Total time on incremental Kotlin-only changes: ~2 min.

Calling `gradlew installDebug` directly does NOT inherit that filter. Gradle then compiles native libs for ALL FOUR ABIs (arm64-v8a, armeabi-v7a, x86, x86_64) which is 4× the CMake work for zero benefit on a physical device. Empirical: same change goes from 2 min → 10+ min that way. Worse: there's no obvious progress signal because clang invocations don't print to stdout, so it looks hung even when it's actively working with 10+ parallel `clang++` processes.

If you MUST call `gradlew` directly (e.g. to bypass an `expo prebuild` step that would clobber a manual file edit), add this to `mobile/android/gradle.properties` first:

```properties
reactNativeArchitectures=arm64-v8a
```

That restricts native builds to the one ABI the dev phone needs. Don't commit it though — CI builds the full set for store releases.

#### Daily dev workflow — emulator (fallback only)
Used when no phone is plugged in. Emulator reaches the host PC at `10.0.2.2:8081`, NOT `localhost` (from inside Android, `localhost` is the emulator itself).
```powershell
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd Medium_Phone_API_35 -no-snapshot-save -no-audio
& "$env:ANDROID_HOME\platform-tools\adb.exe" wait-for-device
cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
npx expo start --dev-client --port 8081
```

#### Required env vars (already set persistently for the user)
- `JAVA_HOME = C:\Program Files\Android\Android Studio\jbr` (bundled JBR 21 — don't install a separate JDK 17, Gradle 8.6+ supports 21)
- `ANDROID_HOME = C:\Users\motaz\AppData\Local\Android\Sdk`
- `PATH` includes `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator`

#### Mobile file tree (key paths)
```
mobile/
├── app/                                # expo-router
│   ├── _layout.tsx                     # GestureHandlerRootView + AuthProvider + cache hydration
│   ├── index.tsx                       # auth-aware redirect → /(app)/dashboard or /(auth)/sign-in
│   ├── (auth)/
│   │   ├── _layout.tsx                 # gates on isProfileComplete + !profileLoading
│   │   ├── sign-in.tsx                 # ✅ port of Auth.jsx sign-in branch + Fingerprint button
│   │   ├── sign-up.tsx                 # ✅ 20-screen journey (full parity with web Signup.jsx)
│   │   └── forgot-password.tsx         # ✅ 3-step (email → OTP → set new password)
│   └── (app)/
│       ├── _layout.tsx                 # AppShell — top bar + content Slot + floating RadialNav, redirects on !isProfileComplete
│       ├── dashboard.tsx               # ✅ Dashboard.jsx
│       ├── strength.tsx                # ✅ Strength.jsx
│       ├── cardio.tsx                  # ✅ Cardio.jsx
│       ├── bodyweight.tsx              # ✅ Bodyweight.jsx
│       ├── calories.tsx                # ✅ Calories.jsx (FoodLogDrawer + barcode)
│       ├── history.tsx                 # ✅ History.jsx
│       ├── settings.tsx                 # ✅ EditProfile.jsx (Profile + Settings tabs)
│       └── effort/
│           ├── strength/[exercise].tsx # ✅ StrengthDetail.jsx
│           └── cardio/[activity].tsx   # ✅ CardioDetail.jsx
├── src/
│   ├── theme.ts                        # design tokens (HSL strings) + alpha() + Tailwind palette
│   ├── components/                     # AnimateRise, DeleteAction, TickerNumber, NumericInput, MovementSearch,
│   │                                   # LineChart, UnitToggle, Slider, CalorieStrip,
│   │                                   # BarcodeScanner, FoodLogDrawer, ChatSheet, SuggestionSheet,
│   │                                   # MessageActions, Select, ShellSkeleton, Skeleton, LoadingScreen,
│   │                                   # OTPInput, PasswordInput, PasswordStrengthMeter, StepDots, KeyboardScreen,
│   │                                   # RadialNav  ← bottom-nav replacement (Pattern 8, May 24 2026)
│   ├── lib/
│   │   ├── supabase.ts                 # client (AsyncStorage-backed session)
│   │   ├── profile.ts                  # isProfileComplete() — mirrors web/src/lib/profile.js
│   │   ├── effortTags.ts               # TAG_STYLES + getEffortTags
│   │   ├── cache.ts                    # AsyncStorage-backed dataCache + sync in-memory shadow
│   │   ├── formulas.ts                 # estimate1RM, projectAllRMs, projectPaces, etc.
│   │   ├── calorieFormulas.ts          # BMR/TDEE/macros/timeline
│   │   ├── foodLibrary.ts              # searchFoods + getFoodPortions + calcMacros + lookupBarcode
│   │   ├── countries.ts                # COUNTRIES list + matchCountryFromPhone
│   │   └── movements.ts                # ISOMETRIC_EXERCISE_NAMES set
│   ├── hooks/
│   │   └── useMovements.ts             # module-level cache, single fetch
│   └── contexts/
│       └── AuthContext.tsx             # Supabase auth + profile + biometric helpers + deleted-user detection
├── android/                            # native project (generated by expo run:android)
├── babel.config.js                     # has `react-native-reanimated/plugin` (must be LAST)
├── app.json                            # newArchEnabled: true; plugins: expo-router, expo-secure-store, expo-camera, expo-font
├── package.json
└── tsconfig.json
```

#### Mobile conventions
- **Porting workflow:** read web file in full → list "RN doesn't have this" items (Recharts → svg paths, DOM dropdown → Modal+FlatList, react-phone-number-input → libphonenumber-js + Select, etc.) → port → `npx tsc --noEmit` clean → tell user to reload.
- **Colors:** all from `src/theme.ts`. NEVER hardcode hex outside theme. Use `alpha(c.token, 0.10)` for `bg-token/10` (HSL→HSLA), `withAlpha(palette.blue[500], 0.1)` for hex→rgba. Border radius scale matches Tailwind via `radius` export.
- **Icons:** `lucide-react-native` only, same icon name as web. Default size 14–18 (`h-3.5 w-3.5` → 14, `h-4 w-4` → 16, `h-5 w-5` → 20).
- **Animations:** wrap content in `<AnimateRise delay={N}>` for web's `.animate-rise` (cubic-bezier(0.16, 1, 0.3, 1), 500ms). New animations use reanimated worklets — not the legacy `Animated` API.
- **Gestures:** `react-native-gesture-handler` only (`Gesture.Pan()`, `Gesture.Tap()`). `GestureHandlerRootView` is at the root in `app/_layout.tsx` — don't nest another. `DeleteAction` already exists; `swipe={true}` for chat bubbles, default for trash-button rows.
- **Lists / dropdowns:** long scrollable → `FlatList`. DOM `<select>` → `Modal + FlatList` (see `src/components/Select.tsx`). For inline-absolute dropdowns (MovementSearch pattern) the dropdown View needs a computed explicit `height` (not just `maxHeight`), otherwise the inner gesture-handler ScrollView won't activate scroll.
- **Routing:** `expo-router` typed routes. If `tsc` complains about a known-good `href`, cast `as any` (Generated `.expo/types` lags renames). Inside-app links use `<Link href="..." asChild>` over `<Pressable>`, or `router.push(...)` in callbacks.
- **TypeScript:** `npx tsc --noEmit` must be clean before saying "ready to test." Use `as any` only for external-lib lag, never to silence a real bug.

#### Mobile-specific gotchas
- **No Expo Go, ever.** Reanimated 4 + new arch breaks it. Always use the dev-client APK.
- **Reanimated plugin must be the LAST entry in `babel.config.js` plugins.** Don't reorder.
- **`expo-barcode-scanner` is removed** — deprecated, breaks Kotlin compile on SDK 54. Use `expo-camera`'s built-in barcode scanner.
- **`react-native-worklets` is a peer dep of Reanimated 4** — installed separately.
- **`npm install` needs `--legacy-peer-deps`** for some packages because of React 19 transitive peer-dep conflicts.
- **`hsla(...)` is supported by RN's `backgroundColor` / `color` / `borderColor`.** That's why `theme.ts` stores raw HSL strings — `alpha()` just rewrites `hsl(...)` → `hsla(..., a)`.
- **Avatar upload** uses `expo-image-picker` + `expo-image-manipulator` (resize to 512×512 JPEG @ 0.85) + `supabase.storage.from('avatars').upload(...)`. Direct upload, no base64.
- **`useMovements` caches the full movement table at module level.** Fetches once per app session; only `invalidateMovements()` triggers a re-fetch. Don't add per-component re-fetches.
- **Auth uses 6-digit OTP, not magic-link click.** Both signup confirmation and password reset send an email containing both `{{ .Token }}` and `{{ .ConfirmationURL }}`. Mobile users type the code (`verifyOtp({ email, token, type: 'signup' | 'recovery' })`); web users tap the link. Same email works for both.
- **Android App Links via `public/.well-known/assetlinks.json`** (deployed with the WEB app). Contains the mobile package name + debug keystore SHA256. **Production keystore fingerprint must be added before Play Store release.**
- **Biometric sign-in stores email + password** encrypted in SecureStore (`myrx.bio.email` / `myrx.bio.password`), NOT just session token. Standard `signOut()` keeps the credentials so biometric still works after logout — intentional. Tradeoff: storing raw password (encrypted) is less secure than session-token-based; fine for fitness, not appropriate for banking.
- **`(auth)/_layout.tsx` redirects to `/(app)` only when `isProfileComplete(profile)` is true** — not just `profile` truthy. The signup journey writes profile fields incrementally (email-OTP success writes body data; phone-OTP writes phone + verified_at; etc.); without the completeness check, mid-journey users would bounce to dashboard before required fields exist.
- **`(app)/_layout.tsx` only shows `<ShellSkeleton />` when `profile === null`** (initial cold load). Subsequent `refreshProfile()` calls flip `profileLoading=true` briefly but we keep the existing UI mounted so route state (scroll position, active tab, form inputs) survives. Mirrors web's `ProtectedLayout`.
- **AsyncStorage key `myrx.signup.state`** persists `{ step, data }` across the signup journey. Survives app-switching (e.g. user leaves to read the SMS code) — the journey resumes at the same step on return.
- **Settings → Chat card admin gate:** the two share-with-coach toggles are hidden on `settings.tsx` when `profile.is_superuser === true`. Only `Enter to send` shows. Same gate exists on web (`EditProfile.jsx`'s `isAdmin` check + `AdminUserProfile.jsx`'s `isOwnProfile` prop).
- **Mobility's slider commits on gesture-end only.** During a Pan, only `x.value` (UI-thread shared value) updates. Live mannequin animation is deferred until tested on a real device — emulator software rendering can't keep up with per-frame SVG repaints.
- **Deleted-user detection (`AuthContext.tsx`):** after `getSession()`, validates the session against the auth server with `getUser()`. If 401 (user was hard-deleted), signs out cleanly so the app doesn't crash trying to fetch the missing profile.
- **Android quirk — `fontFamily` + `fontWeight` don't combine.** When `fontFamily` points at a registered custom font (Geist, JetBrainsMono — the only families this app loads), do NOT also set `fontWeight` on the same style. Android's renderer can't auto-resolve the weight against a custom family, and the dual hint makes the renderer silently fall back to the system default. Encode the weight into the family name instead (`fonts.sans[700]` is `Geist_700Bold`, `fonts.mono[600]` is `JetBrainsMono_600SemiBold`). iOS tolerates the combination, so this is Android-only — but every style in the app must be Android-safe.
- **Use plain `<Text>` inside `<Animated.View>`, not `<Animated.Text>`, when the text needs custom `fontFamily`.** `Animated.Text` (the Reanimated wrapper) doesn't merge `Text.defaultProps.style` and explicit `fontFamily` the same way plain `Text` does; the custom family silently falls back to the global Geist default. If you need the Text node itself to animate (opacity, transform), wrap a plain `Text` in an `Animated.View` and animate the wrapper.
- **Reanimated worklets cannot call theme helpers (`alpha()` / `withAlpha()` / `colors.X` resolution) synchronously.** They're plain JS string helpers, not worklets. Calling them inside a `useAnimatedStyle` / `useAnimatedProps` / gesture-handler worklet crashes the UI thread with `[Worklets] Tried to synchronously call a non-worklet function 'alpha'`, and the dev-launcher persists the crash so the app cold-launches into the red error screen on every subsequent open. **Always precompute colour values as module-scope constants** (`const ICON_BG = alpha(colors.card, 0.95)`) and reference the constants inside worklets. This pattern lives in `RadialNav.tsx` as the canonical example (the `COLOR_*` block at module top). When the dev launcher lands on the persistent red error screen, recover via `adb shell run-as com.myrx.app rm shared_prefs/expo.modules.devlauncher.errorregistry.xml` AND fix the underlying worklet violation (the prefs file just stores the symptom).
- **Gesture-handler `e.x` / `e.y` are view-relative AND keep tracking the finger outside the view's bounds.** Once a `Gesture.Pan()` is active, `event.x` / `event.y` are coordinates relative to the GestureDetector's view (top-left = 0,0), and they keep updating correctly even when the finger physically moves OUTSIDE the view's bounds (values just go negative or exceed view dimensions). This is the right primitive for hit-test math where you need finger-vs-element distance regardless of where the parent sits on screen — `RadialNav` uses `e.x - CENTER_BTN_RADIUS` for finger-offset-from-button-centre. **Prefer this over `e.absoluteX/Y` + `measureInWindow`** — that combo is unreliable on Android, has async timing issues, and misses the SafeAreaView's top inset (positions end up shifted by ~24 px on phones with a status bar).
- **`useAnimatedReaction` is the right primitive for "fire JS when a SharedValue changes".** Used in `RadialNav` to trigger the hover haptic when `hoveredIdx.value` changes. The reaction callback runs on the UI thread when the watched value changes; `runOnJS(fn)()` schedules the JS-side handler. Cheaper + lower-latency than checking the value in a polling effect.
- **`expo-haptics` install requires Metro cache clear.** When you `npm install expo-haptics` (or `--legacy-peer-deps` fallback after `npx expo install` fails), Metro's resolver caches the pre-install state and keeps reporting `expo-haptics` as unresolvable even after the files exist on disk. Symptom: the dev launcher shows `There was a problem loading the project. Metro has encountered an error: While trying to resolve module 'expo-haptics' from file 'RadialNav.tsx', the package 'node_modules/expo-haptics/package.json' was successfully found. However, this package itself specifies a 'main' module field that could not be resolved` (referencing `src/Haptics.ts`, which DOES exist). Fix: kill Metro and restart with `--clear` (i.e. `npx expo start --dev-client --port 8081 --clear`). The cache reset makes the resolver re-scan node_modules. Same pattern for any other native module added mid-session.
- **Floating bottom-nav layout impacts page padding.** `RadialNav` (Pattern 8 above) is `position:'absolute'` and reserves zero flex space — `(app)/_layout.tsx`'s `ScrollView` fills the full height. The `scrollContent.paddingBottom` is therefore set to 80 px so the last page row scrolls clear of the half-moon dome's idle footprint (dome top sits ~60 px above page bottom; +20 buffer). If you add another floating bottom overlay, account for it in the same padding — pages can scroll content behind absolute children, but content behind the dome would be hidden.

#### PhantomWheel — gesture-driven number / time picker primitive

Every numeric and time input across the mobile app — strength reps / weight / distance, isometric duration (Plank Hold, Active Hang), cardio distance, cardio duration, cardio pace time — goes through ONE component:

- `src/components/PhantomWheel.tsx` — gesture-driven scrolling wheel with THREE render modes:
  - **Numeric mode** (default): single rolling reel showing the value (optionally with `unit` suffix or `format` function). Used for reps, weight, time-in-seconds with custom format, etc.
  - **Time mode** (`time="mm:ss"` or `time="hh:mm:ss"`): split-reel time picker, 2 or 3 NumericPhantomWheel reels flanking static `:` colons. Used for every time field on strength + cardio.
  - **Decimal mode** (`decimal="XX.X"`): split-reel decimal picker — two reels (whole + tenth) flanking a static `.` decimal point, plus an optional static unit suffix after the right reel. Same logic + design as time mode but with `.` instead of `:`. Used by cardio's Distance field. **Clamp behaviour (LOCKED):** each reel runs INDEPENDENTLY in its own range. The whole reel scrolls across `[Math.floor(min/10), Math.floor(max/10)]`; the tenth reel always scrolls `[0, 9]`. There is NO combined clamp, so the effective scrollable range is `[minWhole.0, maxWhole.9]` — NOT `[min, max]`. Example: cardio passes `min=0 max=500` and the wheel reaches 0.0 up to 50.9 (one extra tenth beyond 50.0). If business logic needs a literal hard cap, the parent's save-validation enforces it; the wheel itself never combined-clamps.

The split-reel time picker used to live in a separate `TimeWheel.tsx` file. It was merged INTO `PhantomWheel.tsx` so every wheel in the app lives behind one file and the mode is a single prop flip. Do not re-split.

**Mode rule (LOCKED for strength + cardio):**
- Any TIME field uses `<PhantomWheel time="mm:ss" .../>` or `<PhantomWheel time="hh:mm:ss" .../>` — split reels with `:` separators.
- Any DECIMAL field (cardio Distance currently) uses `<PhantomWheel decimal="XX.X" unit="..." .../>` — split reels with `.` separator, optional static unit suffix.
- Any plain-integer NUMERIC field uses `<PhantomWheel step={...} ... />` — single rolling wheel.
- Never combine `time` and `decimal` on the same call. The dispatcher picks `time` first, then `decimal`, else numeric.
- The user explicitly approved these splits for strength + cardio. If extending to other pages later, the same rules apply.

**Architecture (PhantomWheel):**
- Single `Gesture.Pan()` inside a `GestureDetector`. Worklet-driven; all per-frame motion runs on the UI thread via Reanimated 4.
- `CenterRow` (in flow, bold styling) shows the current value. `HaloRow`s (absolute, positioned at `top:'50%'` with translateY) render the rolling halo above + below.
- Each row stacks TWO text layers (halo-styled + centre-styled) cross-fading by `|rank|` so the "highlight" smoothly transfers between rows as the wheel rolls (no on/off snap at commit). Both layers are `AnimatedTextInput` (read-only, `editable={false}`, accessibility-hidden) wrapped in a plain `<View pointerEvents="none">` inside an `<Animated.View>`. Rationale: the text content of each row is driven from a `SharedValue` (`formattedTextsSV`) via `useAnimatedProps` so labels update on the UI thread in lockstep with positions — see "Atomic text + position update" below. The `<View pointerEvents="none">` wrapper is critical because `pointerEvents` on the TextInput element itself is unreliable on Android (the native touch handler can fire before RN's hit-testing finishes and intermittently swallows the Pan's first event).
- Position uses a forward `rank → y` mapping (not inverse `y → rank`): linear rank from scrollY, piecewise-linear lookup into a non-uniform `spacings` table that bakes in `OVERLAP_PX = 6` for the "tucked-under" feel. Don't refactor this to a uniform pitch — adjacent rows would visibly "pop" at every commit boundary.
- Halo materialises on first real finger movement (`haloOpacity` shared value fades in over `FADE_IN_MS`); fades out **only after** any inertia completes (in the `withDecay` callback), not at `onEnd`. Fading on release made the inertia roll happen behind an invisible curtain — the wheel appeared to teleport to its final number.

**Atomic text + position update (the fix for the old label-flick glitch):**
- The pre-fix architecture drove `formatted` row text through a React prop (recomputed in a `useMemo` from `value`) AND drove position through a SharedValue (`committedSteps`, written from `useLayoutEffect`). The two travelled through different paths to the UI thread — Fabric vs JSI — and landed on different frames. At every step boundary the UI thread rendered ONE frame with the new labels but the old `committedSteps`, which read as "all halo numbers shift up by one digit, then snap back" on every commit.
- Current architecture: both updates leave the JS thread in the SAME synchronous block (`useLayoutEffect`) and reach the UI thread atomically. `formattedTextsSV` (a `SharedValue<readonly string[]>` indexed by `offset + renderRadius`) is recomputed alongside `committedSteps.value = pendingStepsRef.current`. Each row reads its label from this SV via `useAnimatedProps`. Out-of-range slots carry an empty string and render as a 0-px-wide TextInput → invisible without needing to be unmounted. The `format` prop stays a plain JS function — it runs JS-side as part of the useLayoutEffect recompute, output is what travels through the SharedValue.
- Do NOT re-introduce per-row text via React props. The atomicity is what makes the commit visually invisible.

**Inertia roll (iOS-style scroll wheel feel):**
- Fast finger release → `withDecay` continues the roll, decelerating geometrically. Slow release → `withTiming` snaps to the last committed step. Threshold is `INERTIA_MIN_VELOCITY = 250 px/s`; deceleration is `INERTIA_DECELERATION = 0.993` (lower = quicker stop, higher = longer glide — 0.998 is the iOS default but reads as too lazy on a stepped picker).
- Step-boundary commits during the coast are detected by a `useAnimatedReaction` that watches `scrollY` and fires `runOnJS(commitValue)` when `Math.round(scrollY/PITCH)` changes. This is the SINGLE source of truth for commits — `onUpdate` no longer fires them. The reaction works for both drag AND decay phases, so the parent's `value` and the rendered labels stay in sync throughout the coast.
- `onBegin` cancels any in-flight inertia by writing `scrollY.value = 0` (a non-animated assignment cancels Reanimated animations). The reset order matters: `lastEmittedSteps.value = 0` MUST happen before `scrollY.value = 0`, or the reaction fires a stray commit on the same frame.
- `onFinalize` only writes a settle animation on cancellation (parent ScrollView claim, app backgrounded, etc.). For successful releases, `onEnd` has already started either a snap or a decay; touching `scrollY` here would clobber that.

**Two value modes:**
- **Uniform** — `step + min + max`. Worklet computes `nextVal = startValue + stepsRounded × step` (clamped).
- **Ladder** — `ladder: readonly number[]`. Worklet does ladder-index arithmetic (`startIndex + stepsRounded`) and reads `ladder[idx]`. Ladder array is captured into the worklet closure at gesture-build time; uses direct indexed access only (`arr[i]`) — no `.findIndex` / `.map` (array methods crash worklets).

**Direction contract (locked, do not unflip):**
- Drag DOWN → value INCREASES.
- Visually, rows translate DOWN with the finger. **Higher values live ABOVE the centre line; lower values below.** A new higher value rolls in from above sliding down into the centre.
- Implementation: `translateY` is `-y - centerSize/2` in HaloRow and `-y` in CenterRow (negated relative to a non-flipped wheel). Don't unflip — the user explicitly chose this orientation after considering both directions.

**Props worth knowing:**
- `anchor: 'center' | 'right' | 'left'` (default `'center'`) — where each row's edge is pinned during scale. `'center'` lets both edges sweep outward (`( )` brackets), used for ordinary numeric wheels. `'right'` pins the right edge (the row's right edge stays at the wrapper's right; left edge traces `(`), used by the minutes reel of a split time wheel so the digits hug the colon's left side. `'left'` mirrors that for the seconds reel. Implementation uses `alignItems` for in-flow positioning and `transformOrigin` for the scale pivot — no translateX math needed.
- `noScale: boolean` (default `false`) — when `true`, halo rows render at the centre size (no shrink) and spacings become uniform `centerSize` (no overlap). Used by the middle reel of an `hh:mm:ss` time wheel where the digits sit between two static colons.

**Time-mode formats (passed via the `time` prop):**
- `time="mm:ss"` — two reels (minutes anchored `right`, seconds anchored `left`) + one static colon. `value` is total seconds. Used by strength isometric duration (Plank Hold, Active Hang) and cardio pace-mode Time. Combined `onChange(totalSecs)` fires whenever either reel commits.
- `time="hh:mm:ss"` — three reels (hours anchored `right`, minutes anchored `center` with default scaling, seconds anchored `left`) + two static colons. `value` is total seconds. Used by cardio duration mode (max 3 hours, set via `maxHours={3}`). The middle minutes reel uses the default centred scaling (halo rows shrink, both edges sweep outward symmetrically) — bounded by the two flanking colons but the bracket animation still has room to play within each row's scaled width.
- The colon is a fixed `<Text>` at the geometric centre rendered in `fonts.mono[700]` at `centerSize` font, identical to a centre-row digit. `pointerEvents='none'` so drags fall through to the reels.
- Each reel is an independent `NumericPhantomWheel` — minutes / seconds / hours have separate internal `value × onChange` pairs; the user scrolls them one at a time. The composed `onChange(totalSecs)` rebuilds the total from the current (hours, minutes, seconds) tuple after any reel commits.
- Time mode IGNORES the numeric-mode props (`step`, `min`, `max`, `ladder`, `unit`, `format`, `anchor`, `noScale`) — the composition wires those per-reel itself. Pass only: `value`, `onChange`, `time`, optionally `minMinutes` / `maxMinutes` / `maxHours`, plus the universal `centerSize` / `haloRadius` / `style`.

**Font convention (MANDATORY for numerics):**
- Numeric text uses `fontFamily: fonts.mono[N]` (JetBrainsMono variants — `JetBrainsMono_500Medium`, `JetBrainsMono_700Bold`, etc.). The font is registered globally by `expo-font` via `useFonts(...)` in `app/_layout.tsx`.
- **Never combine `fontFamily: fonts.mono[N]` with explicit `fontWeight`.** Android doesn't auto-resolve `fontWeight` when `fontFamily` is custom, and the dual hint makes the renderer silently fall back to the system default (Geist via the global `Text.defaultProps.style`). Weight is encoded in the family name itself — `JetBrainsMono_700Bold` IS the bold variant.
- Always pair with `fontVariant: ['tabular-nums']` so digit widths stay constant as the wheel rolls. Without this, `1` is narrower than `8` and the row jitters horizontally during scroll.

**Scroll clamping (do not remove):** the `onUpdate` worklet clamps `scrollY` to `[minAllowedSteps × PITCH, maxAllowedSteps × PITCH]` derived from `(MIN - startValue) / STEP` and `(MAX - startValue) / STEP` (ladder mode uses `startIndex` against `LADDER_LEN - 1`). Without this the visual rolling continues past the bounds while the underlying value sits clamped at MIN/MAX — the wheel looks like it's "scrolling on nothing." User can still swipe back the other direction normally.

**Cross-fade structure (per row, in BOTH HaloRow and CenterRow):**
```
<Animated.View wrapper (animatedStyle: transform + halo-radius opacity; pointerEvents="none">
  <View centerInner (position: relative, sizes to text content) pointerEvents="none">
    <Animated.View haloLayerStyle (in-flow) pointerEvents="none">
      <View pointerEvents="none">
        <AnimatedTextInput style={haloText + textInputReset} animatedProps={animatedTextProps}
                           editable={false} scrollEnabled={false} multiline={false}
                           caretHidden focusable={false}
                           importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
      </View>
    </Animated.View>
    <Animated.View centerLayerStyle (absolute) pointerEvents="none">
      <View pointerEvents="none">
        <AnimatedTextInput style={centerText + textInputReset} animatedProps={animatedTextProps} … />
      </View>
    </Animated.View>
  </View>
</Animated.View>
```
- Both layers' opacities are exact complements (`absRank >= 1 ? 1 : absRank` vs `absRank >= 1 ? 0 : 1 - absRank`). At rank 0 only the centre layer is visible; at rank ≥ 1 only the halo layer. The "highlight" stays anchored at the geometric middle and transfers smoothly between rows as the wheel rolls.
- The in-flow halo layer sizes the inner View; the absolute centre overlay fills it.
- `animatedTextProps` is a `useAnimatedProps` worklet reading `formattedTextsSV.value[offset + textsIdxBase]`; that single SharedValue drives both layers on the row, so text and position stay frame-perfect in sync.
- `s.textInputReset` (`padding: 0, margin: 0, textAlignVertical: 'center'`) strips the platform defaults that distinguish a TextInput from a Text node — without it, the digits shift a few pixels upward and a phantom caret column appears on some Androids. Combined with `lineHeight === fontSize` and `includeFontPadding: false` on the inline style, the glyph lands on the same baseline a `<Text>` would.
- Every wrapper from the row's outer `Animated.View` down to the TextInput carries `pointerEvents="none"` — belt and suspenders against the Android TextInput touch capture issue described in the architecture section.

**Field sizing parity (strength ↔ cardio) — what's locked globally vs per-page:**

The triple-grid row of fields on `strength.tsx` and `cardio.tsx` shares a strict GLOBAL contract — the values below MUST be identical on both files (and on any future page that uses the same row pattern):

- `FIELD_HEIGHT = 75` — every WheelInput / unitLockedBox / vertical UnitToggle in the row is exactly 75 px tall, so the row aligns at the bottom regardless of which fields are present.
- `tripleGrid.gap = 8` — same 8 px gap between every column on every page.
- `gridUnit: { width: 48 }` — the Unit column is a FIXED 48 px on every page, every template (standard / assisted / carry on strength, pace on cardio). This is what locks the lb/kg or mi/km toggle to the same visual size everywhere.
- Vertical `UnitToggle` (`vertical` prop) — units stacked, not side-by-side. Universal across both pages.
- `WheelInput` chrome — `paddingHorizontal: 0`, `paddingVertical: 6`, background `alpha(colors.input, 0.10)`, border `colors.border`, radius 6. Identical on both pages.
- `unitLockedBox` / `unitLockedText` styles — `paddingHorizontal: 8`, `fontSize: 14, fontWeight: '700'`, `numberOfLines={1}`. Mirrored into both stylesheets even if a page doesn't have a unit-locked variant yet (cardio doesn't today; the styles are there for future use).

The "big number column" flex values, however, are PER-PAGE because the typical content widths differ:

- Strength's `gridLarge: { flex: 2.55 }` is used for Weight and Distance in the carry layout. Both fields show similar-width content there (e.g. `"250 kg"` and `"15 m"` — both 5–6 chars), so symmetric larges look right.
- Cardio's pace mode uses `gridPaceDistance: { flex: 3.0 }` for Distance (`"26.2 km"` / `"100.0 km"`, 6–8 chars w/ unit) and `gridPaceTime: { flex: 2.1 }` for Time (`"25:00"` / `"180:00"`, 5–6 chars). Distance gets the extra room because its content is wider; same-flex on both leaves Distance cramped.

If you find yourself tweaking `FIELD_HEIGHT`, `tripleGrid.gap`, `gridUnit.width`, the `WheelInput` chrome, or the `unitLockedBox` / `unitLockedText` styles on ONE of the two pages, stop and apply the same edit to the other before moving on — these are the universal values. The per-page big-column flexes are independent: edit one without touching the other. This rule is the reason the user told us to consolidate the layout in the first place.

**Field-height + column-flex convention (`strength.tsx` + `cardio.tsx`):**
- `FIELD_HEIGHT = 75`. Matches `UnitToggle.rowVertical` height (75) and the `unitLockedBox` chip height (75) so the triple grid row aligns at the bottom across every variant (Reps + Weight + Unit, Weight + Unit + Distance, etc.).
- `tripleGrid: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' }`.
- `gridSmall: { flex: 0.85 }` (Reps — max value `30`, just 2 digits).
- `gridLarge: { flex: 2.55 }` (Weight / Distance — needs space for "100 lb" / "800 lb" in JetBrainsMono Bold).
- `gridUnit: { width: 48 }` (FIXED, not flex). The Unit column renders at the same width in every layout this way. Earlier this was `flex: 0.55`, which gave ~48 px in the standard layout (`gridSmall + gridLarge + gridUnit`) but only ~30 px in the carry layout (`gridLarge + gridUnit + gridLarge`) — that's why `unitLockedBox` was wrapping "kg" on unit-locked carries like Atlas Stone. Pinning to a width is the only way to make the column visually consistent regardless of what flanks it. Verified safe: carry's two `gridLarge` columns each give up ~5 px to the new fixed Unit, leaving ~128 px — still well above the widest weight string the wheel can render in carry mode (`"250 kg"` ≈ 110 px in JetBrainsMono Bold).
- `unitLockedBox`: `paddingHorizontal: 8`, `paddingVertical: 6`, height `FIELD_HEIGHT`. `unitLockedText`: `fontSize: 14, fontWeight: '700'` (matches the active state of the vertical `UnitToggle` — the previous `fontSize: 18` was wider than the carry Unit column). Always rendered with `numberOfLines={1}` as a safety net.
- `WheelInput` defaults: `paddingHorizontal: 0`, `paddingVertical: 6`. `WheelInput` accepts an optional `style` prop for per-field overrides (currently unused after the Active-Hang +3 experiment was rolled into the global `FIELD_HEIGHT` bump).
- `PhantomWheel.container` defaults: `alignSelf: 'stretch'`, `paddingHorizontal: 0`. Stretching is critical — without it the container sized to the centre text's width, which made every HaloRow's `left:0/right:0` wrapper inherit that narrow width and truncate longer halo values (the classic "wider value coming up from below → text wraps and `lb` clips" bug).

**Default values: min scrollable value — LOCKED across strength + cardio (May 2026 lock):**

Every value/time/distance/speed wheel on strength and cardio sits at its **minimum scrollable value** on page-load (and on exercise-switch / mode-switch). For most wheels that minimum is 0 (cardio distance, cardio time, cardio speed, isometric time). For wheels where 0 isn't physically meaningful, the minimum is whatever the wheel hard-stops at:

- **Strength reps**: min = 1 (you can't perform 0 reps).
- **Strength weight** (non-bodyweight, non-assisted): min = `ladder[0]` for ladder movements (Atlas Stone 60 kg, D-Ball 30 kg, etc.) or `wheelMin` for non-ladder (barbell 45 lb / 20 kg, dumbbell 5 lb / 2 kg, generic carry 5 kg / 10 lb).
- **Strength carry distance**: min = 5 m (carrying 0 m isn't a meaningful effort; wheel hard-stops at 5).
- **Strength weight on bodyweight / assisted**: min = 0 (no added load is a valid starting point).

Earlier in May 2026 this rule was briefly relaxed to "blank slate at literal zero" — which broke wheels whose physical minimum was non-zero (carry distance showed 0 m while the wheel itself could only scroll down to 5 m, and the wheel-and-state contract silently disagreed). The corrected rule is "min scrollable": the wheel's `min` prop defines what zero means for that field; the state defaults to exactly that.

Concrete defaults (verified against current code, NOT to be drifted from without updating this doc and the matching effect in code):

| Wheel | Default | Save guard | Notes |
|---|---|---|---|
| Strength reps | `1` | reps ≥ 1 (always met) | Wheel min = 1; 0 reps isn't meaningful. |
| Strength weight (non-bodyweight) | `ladder[0]` if ladder, else `wheelMin` | weight > 0 | Wheel min varies by equipment — see formula in `weightWheelProps()`. |
| Strength weight (bodyweight added) | `0` | n/a | Added load is 0 by default; bodyweight itself comes from the profile. |
| Strength carry distance | `5` (metres) | distance > 0 (always met) | Wheel min = 5 m; carrying 0 m isn't meaningful. |
| Strength isometric duration | `00:00` | timeSecs > 0 | Wheel min = 00:00 (a "just started" hold). |
| Cardio pace distance | `0` (km / mi) | distKm > 0 | Wheel min = 0; scrollable down to 0.0. |
| Cardio pace time | `00:00` | timeSecs > 0 | Wheel min = 00:00. |
| Cardio pace speed (5 machines) | `0` (km/h or mph) | speed > 0 | Wheel min = 0. Drives `effectiveTimeSecs = distance ÷ speed`. |
| Cardio duration time | `00:00` | timeSecs > 0 | Wheel min = 00:00. |

The matching state-driving code lives in:
- Strength: `useEffect` keyed off `exercise` / `unit` / `isIsometric` / `isCarry` / `movementRecord` (mobile/app/(app)/strength.tsx).
- Cardio: `useEffect` keyed off `mode` / `isSpeedMode` (mobile/app/(app)/cardio.tsx).

When adding a new value/time wheel anywhere, the same rule applies: initialise state to the wheel's `min` prop value (whatever the wheel can scroll down to). The wheel and the state must agree from frame 0 — never set state to a value the wheel can't reach, and never let the wheel render a fallback that disagrees with state (the original carry-distance bug: state was `0`, wheel min was `5`, wheel rendered `50` via a `|| 50` fallback — Save was gated on the state, so it stayed disabled while the user looked at a wheel that read `50 m`).

**Staggered page-load animation — LOCKED across strength + cardio detail pages (May 2026 lock):**

Every detail page (strength weighted-standard / assisted / carry / iso / repsonly / bodyweight, cardio pace / duration) follows the same entrance choreography:

1. **Skeleton** rendered while `loading === true` (Supabase fetch in progress).
2. **Main content card** — the tile-grid + hero-card combo (or empty-state card) — slides in via `<AnimateRise delay={0}>`. Cubic-bezier(0.16, 1, 0.3, 1), 500 ms, opacity 0 → 1 + translateY 8 → 0.
3. **Chart card** — slides in 250 ms later: `<AnimateRise delay={250}>`.
4. **Log list (Efforts history)** — slides in 500 ms after mount: `<AnimateRise delay={500}>`, applied via `EffortsHistorySection`'s `delay` prop on strength, and inline on cardio's history block.

Total entrance: ~1000 ms from skeleton-clear to log fully visible. Delays were bumped from 120/240 → 250/500 in May 2026 because 120 ms felt too tight to perceive as a real cascade.

**Critical: every new detail-page card must follow this pattern.** Always pass `delay={0}` / `{250}` / `{500}` explicitly — relying on the default for the "main" case (`<AnimateRise style={s.card}>` without `delay`) is technically equivalent (the AnimateRise component defaults `delay = 0`), but explicit values make the cascade intent unambiguous in code. If a page renders the main content via a custom component (like `BodyweightConsolidatedBlock` for the BW tier pager), wrap the call site in `<AnimateRise delay={0}>` so the cascade still works.

**Common gotcha:** when adding a log section that uses `EffortsHistorySection`, remember to pass `delay={500}` — the prop forwards to the inner `AnimateRise`. Without it the log defaults to 0 and appears alongside the main card. (This was the bug on the weighted-standard detail in the May 2026 audit — the call site used `onDelete={handleDeleteEffort}` instead of the common `onDelete={onDelete}` pattern, so a `replace_all` missed adding the delay.)

**Second gotcha — `bwLoaded`-gated detail pages (Assisted Machine + Carry ratio mode):** these pages run a separate Supabase fetch for the user's recent bodyweight inside the detail component (not at the parent level). The main projections / hero card is gated on `bwLoaded && bwForMath != null` — i.e. it doesn't mount until the BW fetch completes (~200 ms after the page-level effort fetch resolves).

If you let the chart and log render unconditionally on these pages, they mount on frame 0 (only need `efforts`, already loaded) and animate in via their `delay={250}` / `delay={500}` schedules. Meanwhile the main card waits ~200 ms for BW, then mounts and starts its own `delay={0}` animation — but by then the chart has already started. **The user sees chart BEFORE main, breaking the cascade.**

The fix: gate the chart + log on `bwLoaded` (Assisted Machine) or `isRatio ? bwLoaded : true` (Carry, since abs-mode movements like Atlas Stone don't need BW) so they wait for the same fetch as the main card. All three then mount on the same frame and the `delay={0}` / `{250}` / `{500}` cascade fires in order.

When adding new detail-page types or surfaces that depend on async data inside the component (not just `efforts`), always gate ALL cascade-eligible content on the SAME async-ready flag — never let some cards render eagerly and others wait.

**TickerNumber slot-machine animation — LOCKED across strength + cardio (May 2026 lock):**

The `TickerNumber` component (`src/components/TickerNumber.tsx`) animates each digit slot-machine style when the value changes (digits roll past on a vertical reel). Non-digit characters (×, m, km/h, :, %, etc.) render as static `Text` inside the same row, so mixed strings like `"5 × 600 m"` animate the `5`, `6`, `0`, `0` digits and keep the `× ` and ` m` static.

**First-mount animation guarantee:** the component forces `from = 9` (when `targetIdx === 0`) or `from = 0` (otherwise) on the very first mount of each digit reel — so EVERY digit always animates on page open, regardless of its value. Without this guard, a digit whose `targetIdx` happened to be 0 (forward column → digit `0`; reverse column → digit `9`) hit the `from === targetIdx` shortcut and skipped the animation, manifesting as e.g. the tenth digit of a `"7.9 km/h"` speed display not rolling on first paint.

Where it lives (USE TickerNumber here):

1. **"Best — X" subtitle** in the page header — EVERY detail page must use it. Exhaustive list:
   - Strength weighted standard: `Best Est. 1RM — N unit` (`[exercise].tsx` ~line 3655)
   - Strength assisted: `Best Est. 1RM — N unit assist` (`[exercise].tsx` ~line 1875)
   - Strength carry: `Best — N wUnit · M dUnit` (`[exercise].tsx` ~line 2598) — both numbers ticker
   - Strength isometric: `Personal best — N min N sec` (`[exercise].tsx` ~line 1469) — fmtDurationLong string tickers the numbers
   - Strength bodyweight: `Best — N max attempts on TIER` (`[exercise].tsx` ~line 3641) — the `N` tickers; tier label stays plain
   - Strength rep-only (band/knee/etc.): `assistLabel · Best — N reps` (`[exercise].tsx` ~line 2927)
   - Cardio pace mode: `Best pace — m:ss/km` (`[activity].tsx` ~line 1126)
   - Cardio speed mode: `Best speed — N km/h` (`[activity].tsx` ~line 1112)
   - Cardio duration mode: `Best session — N:NN` (`[activity].tsx` ~line 1441)
2. **Hero card big numbers (the main target value)** on every detail page. Strength's weighted-standard target weight, assisted target assistance, carry weight/distance targets, BW max-attempts (all 6 Full RX modes: achieved / push / locked / not-yet-achievable / push-at-bodyweight / weighted), BW assist-tier `displayBest`, isometric duration segments, rep-only "Personal best" callout (`bestReps`). Cardio's Work / Speed / Time / pacing-checkpoint rows.
3. **Hero card cue-line embedded numbers (14 px)** — the small numbers INSIDE the cue sentence (e.g., strength's `"Push 6 reps at 135 lb"` tickers both the `6` and the `135`). ✅ on strength; cardio's cue is a plain sentence today and stays plain.

Where it is NOT used (and must not be added):

1. **Tiles** (rep-max grid, BW max-attempt grid, iso milestone grid, cardio upcoming-step tiles). Tiles are status indicators that change wholesale when the user taps; rolling digits inside them adds noise. Plain `Text` only.
2. **Plate chips** (the per-side plate breakdown like `25 / 10 / 2.5` on barbell). Plates are categorical labels, not progressive numeric values. Plain `Text` only.
3. **Chart axis labels and tooltip values.** The chart's own dot animations carry the visual progression; tickering the axis labels would compete.
4. **Log-list rows** (recent efforts on the detail page, "Your activities" list on the index page). These are read-only history; tickering would be over-decoration.
5. **Cue lines, descriptors, helper text, captions.** Plain `Text`.
6. **The "—" placeholder** shown when a metric has no data yet (e.g., `Best Est. 1RM — — lb assist` when `best1RMAssistance` is null). Plain `Text` — there's no number to ticker.

**Sub-text + value layout pattern for Best subtitles:** wrap in `<View style={s.subRow}>` and place the label `Text`, the `TickerNumber`, and any trailing unit `Text` as siblings. Do NOT nest `<Text>` inside `<Text>` for these (the inner Text can't be replaced by a TickerNumber View since View can't be a child of Text in React Native).

When adding a new numeric display anywhere: default to plain `Text`. Add `TickerNumber` ONLY if the value represents a progressive achievement that updates as the user logs new efforts (best subtitle, hero card target) — never for static labels, categorical chips, or read-only history.

**Live-chip label convention (`strength.tsx`):**
- The "Estimated 1RM" chip below the form drops the "Est." / "Estimated" prefix when reps is exactly `1`: a 1-rep lift IS the 1RM, no `estimate1RM` projection runs in that case, and the prefix would be misleading. For 2+ reps the chip reads "Estimated 1RM" / "Est. 1RM per hand" (dumbbell variant) as before. The stored effort `value` in the DB still uses the `"Est. 1RM N unit"` shape regardless — the `parseOneRM` regex on the read path is just looking for the number; the visible label divergence is UI-only.

**Category tag convention (MANDATORY — LOCKED May 19 2026):**

Every detail page header MUST render a small UPPERCASE category badge BELOW the "Best —" subtitle row. The badge identifies the movement family with a short, recognisable label.

- **Strength** uses `s.carryTierBadge` chrome (blue) and `equipmentPillLabel(movementRecord.equipment)` for the label — `BARBELL` / `BODYWEIGHT` / `CARRY` / `ASSIST MACHINE` / etc. Every weighted-standard, bodyweight, isometric, assisted, repsonly, and carry detail page already has it. **Sled Work consolidated** wasn't getting it before (the wrapper skips CarryDetail's header entirely) — now it gets a CARRY pill at the page-level header below the subtitle.
- **Cardio** uses `s.categoryBadge` chrome (amber) and `cardioCategoryPillLabel(activity)` for the label — `RUNNING` / `CYCLING` / `ROWING` / `SKIING` / `AIR BIKE` / `SWIMMING` / `ELLIPTICAL` / `RUCKING` / `STAIR CLIMBING`. Applied to PaceDetail, AirBikeDetail, BeatYourBestDetail, SwimmingConsolidatedDetail, DurationDetail, and RuckingDetail.
- **Stacked tags**: when a page also has a tier classification (Atlas Stone Bear Hug Carry's `INTERMEDIATE` etc., Rucking's `TOUGH` etc.), the tier pill stacks BELOW the category pill using the same chrome.

When adding a new detail page or detail surface, always include a category badge. Skip it ONLY when the page genuinely has no category to surface (e.g. a non-movement detail page).

### Cross-platform consistency rule (MANDATORY)

When the trigger is NOT an explicit `sync ...` phrase — i.e. the user reports a bug, or asks for a new update/feature/design change without naming a direction — the change MUST be cross-checked and applied across **every platform in the system where the surface exists**, not just the side currently being worked on.

| Trigger phrase / context | Scope |
|---|---|
| `sync web to mob: <area>` or `sync mob to web: <area>` | **Single direction.** Only the named area, only that direction. Standard "report-then-wait" still applies. |
| User reports a bug ("X is broken on Y") | **Every platform where that code/surface exists.** If it's broken on mobile Calories, the same logic on web Calories almost certainly has the bug too. Fix in both. If admin has the same surface (e.g. AdminCardioDetail mirrors CardioDetail), check + fix there too. |
| User requests a NEW design change (colors, spacing, animations, loaders, icons, fonts, layout) | **The entire system.** End-user web + mobile + admin portal + admin client-user views. Design is the same across all surfaces by definition; one change should never leave admin looking outdated relative to end-user. |
| User requests a NEW functional change (button behaviour, data flow, validation rules) | **Every platform that has that function.** Back buttons exist on web + admin + mobile detail screens → all three get updated. Food log drawer exists on web end-user + mobile end-user → both get updated. Admin movements page is web-only → only one place. |

#### Concrete examples
- *"Replace ArrowLeft with ChevronLeft for back buttons"* — design change → all of web (end-user + admin), all of mobile.
- *"All standalone spinners should be lime"* — design change → all of web (end-user + admin), all of mobile.
- *"Habits → Frequently used foods"* — copy/UX change to a feature that exists on both → both web + mobile.
- *"Custom meal slots fail to save"* — bug → fix the DB constraint (one-place fix) AND verify the symptom is gone on both web + mobile.
- *"Don't show 'All set' celebration mid-signup"* — UX change → updated `confirm.tsx` on mobile AND `AuthConfirm.jsx` on web in the same turn.
- *"Auto-advance OTP step when user becomes authenticated via email link"* — flow change → added the `useEffect` watcher to BOTH the mobile `OTPScreen` and the web `Signup.jsx` `OTPScreen` in the same turn.
- *"Bump target panel `bg-blue-500/8` → `/15`"* — design change → updated mobile `withAlpha(palette.blue[500], 0.08) → 0.15` AND web Tailwind class in the same turn.
- *"Remove magic-link recovery bandaid"* — when reverting a workaround that was added on both surfaces, REMOVE it from both. Don't leave dead code on one side.

The rule is so important that it's been the cause of nearly every "but mobile doesn't match web" complaint in this project's history. **If you only edited one surface, you almost certainly missed something.** Pause and check the other before declaring the task done.

#### What this means in practice
Before saying "done" on any non-sync change, the assistant MUST mentally walk through:
1. Does this surface exist on web end-user? → If yes, did I update it there?
2. Does this surface exist on mobile? → If yes, did I update it there?
3. Does the admin portal have an analogous surface? → If yes, did I update it there?
4. If any of the above is "the change doesn't apply there" — say so explicitly in the response so the user can confirm.

When in doubt, do the cross-check rather than skipping it. A redundant check costs nothing; missing one creates inconsistency that the user has to point out later.

### Admin ↔ Coach portal mirror rule (MANDATORY — LOCKED May 26, 2026)

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

### Client Detail page — locked patterns (admin + coach mirror, May 26 2026)

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

The `efforts` and `bodyweight` tables have always had an `Admin full access` RLS policy keyed off `is_admin()`. May 26, 2026 added the same policy to `food_logs`, `hr_samples`, `step_samples`, and `wearable_workouts` — without it, the admin's AdminUserDetail queries returned empty data for any client whose health rows were guarded by the standard "users own their rows" policy, and chips silently dropped to zero with no error. The user has to look at the mobile app on the client's phone to realize the chip is wrong; that's the kind of slow-leak bug we can't afford.

Going forward: any new Supabase table holding per-user health, training, or wearable data MUST get an `Admin full access` policy at table-creation time. Add it in the same migration that creates the table, not as a follow-up — follow-ups get forgotten and the chip-silently-drops bug recurs. Coaches retain their existing `Coaches see roster` SELECT-only policy (they read their assigned clients' data, they don't get admin-write access). The distinction is: admin = full CRUD across all clients via `is_admin()`; coach = SELECT-only across roster via `is_coach_for(user_id)`.

### Title Case rule for titles, headers, labels, and tab names (MANDATORY — LOCKED May 26, 2026)

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

### Always parallelize agents when independent work exists (MANDATORY — LOCKED May 26, 2026)

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
- Use `run_in_background: true` if I have other independent work to do while they run (e.g. continue drafting a response or making my own edits) — I'll be notified on completion automatically. Don't poll.
- Pass each agent a **self-contained prompt** — they have no context from this conversation. Include file paths, what to look for, and a target word count for the response (typically "under 200-300 words" so their output doesn't bloat my context on return).
- **Tell the agent whether to write code or just research.** They're not aware of the user's intent.

**Heuristic — "how many agents?":**

- 1 = should I just do it myself? Then no agent.
- 2-3 = ideal for most research / audit tasks.
- 4-6 = ideal for implementation phases with 4-6 independent components.
- 7+ = rare; only when truly independent (e.g. one agent per cardio activity to refactor zone-prescription logic). Coordination overhead dominates past this.

**Concrete recent example (May 26 2026):** during the Phase 3 design Q3 decision flow, I spawned 2 parallel agents — one to audit existing DB state for the invite-accept logic, one to research industry-standard handling of token-race / email-mismatch / forwarded-link scenarios — while I edited CLAUDE.md and drafted the question. Two agent reports + the rule edit + the question draft all in one round-trip instead of three.

**The user's explicit instruction (May 26 2026):** "for every single task you do, if you can apply multiple agents, apply the maximum required agents to finish it faster, every single time, ive paid a lot of money and just now i know about this, we could have been doing things much faster, so lets start using it now". Treat this as a permanent direction — if a turn passes where I could have parallelized but didn't, I'm violating the rule.

## Formula attribution registry (LOCKED — every published source the app's math leans on)

Single source of truth for "which scientific work each formula in MyRX comes from." Goes here so any future audit, regulator review, marketing claim ("evidence-based"), or migration phase can map every number to a citation without spelunking through file comments. Update this table whenever a new formula lands or an existing one's source changes — the file-level comments and this table must agree.

### Strength — 1RM, projections, hypertrophy rate

| Surface / formula | Source | Where the formula lives |
|---|---|---|
| 1-rep-max projection (rep-max table tiles) | **Epley (1985)**, **Brzycki (1993)**, **Lombardi (1989)** — three estimates averaged | `mobile/src/lib/formulas.ts` `estimate1RM` + `projectAllRMs` |
| 1RM for high-rep efforts (>10 reps) | **Epley + Lombardi only** — Brzycki's linear assumption breaks past ~10 reps (under-projects by 3–4% pts vs NSCA reference tables); drop it above the threshold | `formulas.ts` same functions, conditional dispatch |
| Bodyweight assist projection | **Mifflin-derived effective-load math** — `effective_load = bodyweight − assistance`, then standard 1RM projection on effective load | `formulas.ts` + `AssistedMachineDetail` JSX in `[exercise].tsx` |
| Hypertrophy rate per training tier | **Alan Aragon's natural-lifter model** — Beginner 1–2 lb lean/mo, Intermediate 0.5–1, Advanced 0.25–0.5, Elite <0.25 — referenced verbatim in NASM CPT/CES/PES texts | Used qualitatively in tagline copy; quantified in `GAIN_LEAN_RATIO` matrix (planPresets.ts) |
| Hypertrophy volume / rep-range design | **Schoenfeld 2017**, **Helms 2018**, **PMC 2021 meta-analysis** on rep-range × hypertrophy | Cited in `formulas.ts` line 401; informs the strength adp-zone boundaries (strength 1–5 / hypertrophy 6–12 / endurance 13+) |

### Cardio — pace, zones, intervals

| Surface / formula | Source | Where the formula lives |
|---|---|---|
| Pace projection across distances | **Riegel's law (1981)** — `T2 = T1 × (D2/D1)^1.06` | `mobile/src/lib/formulas.ts` `projectPaces`; `[activity].tsx` swim CSS proxy + Beat-Your-Best chart |
| Pace zone offsets per activity | **Jack Daniels' Running Formula (3rd ed., 2014)** — Endurance = best + 60s/km, Threshold = best + 10s/km, VO2 = best − 15s/km | `[activity].tsx` `getPaceZoneSecsPerKm`, `PACE_ZONE_SESSIONS` |
| Polarized 80/20 distribution (queue rules) | **Stephen Seiler / Marius Bakken — Norwegian sprint model** | `[activity].tsx` `generatePlanQueue` |
| Threshold (Cruise Intervals) prescription | **Daniels' "Cruise Intervals"** canonical session (4–6 × 1km T-pace with 60s jog recovery) | `PACE_ZONE_SESSIONS.threshold` |
| VO2 max interval prescription | **Veronique Billat — time-at-VO2max research**, **Daniels' "I pace"**, **Norwegian 4×4** | `PACE_ZONE_SESSIONS.vo2max` |
| Endurance baseline + aerobic-base methodology | **Phil Maffetone (MAF method)**, **Iñigo San Millán (polarized)**, **ACSM aerobic-base recommendation** | Endurance session prescriptions across PaceDetail |
| Concept2 erg watts↔pace | **Concept2 official formula** — `watts = 2.80 × (m/s)³` (drag-factor constant × velocity cubed). Identical across Row Erg, Bike Erg, Ski Erg (same flywheel + PM5) | `mobile/src/lib/movements.ts` `pacePer500mToWatts` |
| Air Bike watts overlay | **REMOVED June 2026 (T088)** — `cal/min × 17.4` was a generic 25%-efficiency calc, NOT an Assault/Echo standard, and didn't match the console; dropped as unverifiable noise. cal/min is the sole anchor. | — |
| StairMill VO2 protocol | **Allison et al. (2017) Med Sci Sports Exerc** — 3×20-sec stair sprints, 3×/week → +12% VO2peak in 6 weeks | `[activity].tsx` `STAIRMILL_ZONE_CONFIG.vo2max` |
| StairMill Threshold protocol | **Interval research (Seiler 2010; Laursen & Jenkins 2002) + ACSM 12th ed** — hard 3-min intervals → lactate-threshold adaptation | `STAIRMILL_ZONE_CONFIG.threshold` |
| StairMill Endurance protocol | **Boreham et al. (2000) Prev Med + ACSM 12th ed** — accumulated daily stair climbing improved VO2max; ACSM backs the 20-min continuous block | `STAIRMILL_ZONE_CONFIG.endurance` |
| Swimming CSS (Critical Swim Speed) | **Critical Power/Speed model (Monod & Scherrer; Wakayoshi 1992 for swimming)** — 2-point linear fit of time-vs-distance (slope = 1/CS); canonical `(400m TT − 200m TT) ÷ 200` is the same idea. Riegel proxy is the <2-distance fallback | `[activity].tsx` `computeSwimCSS` |
| Swim training prescriptions (pace zones) | **Maglischo "Swimming Even Faster" (1993)**, **Doc Counsilman "Science of Swimming" (1968)** | `SWIM_ZONE_SESSIONS`, `SWIM_ZONE_PACE_OFFSETS` |
| Swim T-pace test set (canonical 10×100m) | **Costill** — used at every level from age-group to Olympic prep | `SWIM_ZONE_SESSIONS.threshold` |
| Cardio "lower is better" / chart-direction rule | **MyRX-locked design rule** (May 19 2026) — see "Chart-direction rule" section above | LineChart `reversed` prop usage across pace surfaces |
| Rucking tiers (Beginner → Tough) | **GoRuck event ladder** (Tough = 35 lb × 12 mi) | `[activity].tsx` `RUCK_TIER_THRESHOLDS` |

### Calories / TDEE / macros

| Surface / formula | Source | Where it lives |
|---|---|---|
| BMR | **Mifflin-St Jeor (1990)** — `(10 × kg) + (6.25 × cm) − (5 × age) + gFactor`, where gFactor = +5 male / −161 else | `mobile/src/lib/calorieFormulas.ts` `calcBMR`; mirrored in `web/src/lib/calorieFormulas.js` |
| BMR gender rule (non-binary / prefer-not-to-say) | **MyRX-locked May 23 2026** — uniform "male / else=female" applied across BMR, RestingHrIndicator bands, Air Bike + StairMill cold-start baselines | See "Unified gender rule" in calcBMR comment |
| Activity factor multipliers (1.2 / 1.375 / 1.55 / 1.725 / 1.9) | **ACSM Guidelines for Exercise Testing and Prescription (12th ed., 2025)** — Sedentary → Extremely Active scale; same as Trainerize / MyFitnessPal | `calorieFormulas.ts` `ACTIVITY_FACTORS` |
| Calorie-to-pound conversion | **Wishnofsky (1958)** — `1 lb body weight ≈ 3500 kcal`. Known oversimplification (ignores metabolic adaptation, NEAT drop, water/glycogen); MyRX layers a realism factor on top | `planPresets.ts` `CALORIES_PER_LB`; `predictLbDeltaForPace` |
| Weight-change realism factor (overall) | **Population-adherence research** — typical real loss/gain = 60–80% of math prediction. MyRX picks **0.75** as fallback when full matrix can't apply | `planPresets.ts` `REALISM_FACTOR_FALLBACK` |
| Realism matrix (activity × BF band) | **NASM / Alan Aragon / Eric Helms hypertrophy + fat-loss rate tables** — lean cuts harder, high-BF easier in early weeks, sedentary surplus is mostly fat etc. | `planPresets.ts` `LOSS_REALISM_MATRIX`, `GAIN_REALISM_MATRIX`, `GAIN_LEAN_RATIO` |
| Pace ladder (max sustainable rate) | **ACSM 1–2 lb/week safe sustainable rate** | `planPresets.ts` `PACE_OPTIONS` — Lose hard = -25% cals × 2 mo, etc. |
| Body fat band cutoffs | **ACSM body composition norms** — Male: lean ≤14% / avg 15–24% / high ≥25%; Female: lean ≤20% / avg 21–30% / high ≥31% | `planPresets.ts` `BODY_FAT_BAND_INFO`, gender-aware via `bodyFatGenderKey` |
| Macro split (Balanced) | **General nutrition guidelines** — 25% P / 30% F / 45% C, standard "Most people start here" preset | `planPresets.ts` `MACRO_PRESETS.balanced` |
| Macro split (High-Protein) | **Lyle McDonald, Eric Helms hypertrophy work** — 2.4 g/kg protein (~30%), 30% fat, ~40% carbs. **ISSN Position Stand on Protein and Exercise (Jäger 2017)** confirms 1.6–2.4 g/kg is the productive range | `MACRO_PRESETS.high_protein` |
| Macro split (Performance / endurance) | **ACSM endurance-athlete recommendation** — 5–12 g/kg carbs; MyRX hits 8–10 g/kg at Very/Extreme Active TDEEs via 20% fat residual model | `MACRO_PRESETS.performance` |
| Macro split (Keto) | **Phinney + Volek (sport keto)**, **Cunnane (medical ketosis)** — 1.6 g/kg protein, carbs capped at 20–50g/day by activity, fat = residual. Standard therapeutic ketosis stays below 50g | `MACRO_PRESETS.keto` (with `carb_cap_g` activity-tiered table) + `calcMacros` carb-capped branch |
| Carb cap by activity (Keto) | **MyRX-derived, sport-keto evidence-based** (Phinney/Volek, Cunnane) — Sed 20g / Light 25g / Mod 30g / Very 40g / Extreme 50g. Reflects glycogen depletion: trained users tolerate more carbs without leaving ketosis | `planPresets.ts` `MACRO_PRESETS.keto.carb_cap_g` |
| Self-coached correction factor | **MyRX-locked May 22 2026** — fixed 0.75 multiplier on TDEE for behind-the-scenes calorie target adjustment (admin slider exposes per-client variation) | `planPresets.ts` `SELF_COACHED_CORRECTION_FACTOR` |
| Pace timeline (1–2 months max) | **MyRX-locked May 24 2026** — every pace ships with a fixed 1- or 2-month timeline so users never sign up for an open-ended plan | `planPresets.ts` `PACE_OPTIONS[*].timeline_months` |

### Heart — HR zones, resting bands

| Surface / formula | Source | Where it lives |
|---|---|---|
| HR zone model (5 zones, 50/60/70/80/90% HRmax) | **ACSM Guidelines 12th ed (2025)**; **Karvonen, Kentala & Mustala (1957)** for HR-reserve methodology | `[heart.tsx]` zone math; `HrRangeChart` time-in-zone gradient stops |
| Zone naming / colour palette | **MyRX-locked May 22 2026** — Recovery / Endurance / Tempo / Threshold / VO2 with warm yellow→amber→orange→burnt-orange→deep-red ramp. ACSM endorses 3-zone polarized (Z2 / Z4 / Z5 — what the app exposes; Z1 and Z3 are "no man's land" in polarized literature) | `HrRangeChart` palette; theme.ts `palette.red[600]/[700]` added for this surface |
| HRmax estimation | **Tanaka formula (2001)** — `208 − 0.7 × age`. More accurate than Fox-Haskell `220 − age` for the 18–65 range MyRX targets | `heart.tsx` `estimateHrMax` |
| Resting HR band classifier (Athlete → High, 7 bands) | **Topend Sports rating chart + ACSM compilations** — gender-aware, age-bucketed; non-binary / null uses female bands per gender rule | `mobile/src/components/RestingHrIndicator.tsx` `MALE_TABLE` / `FEMALE_TABLE`; web mirror in `web/src/pages/Heart.jsx` |
| VDOT-to-pace mapping (when implemented) | **Jack Daniels' Running Formula (3rd ed., 2014)** — already used for pace zone offsets above | Future expansion of cardio prescriptions |

### Wearable / cold-start baselines

| Surface / formula | Source | Where it lives |
|---|---|---|
| Air Bike cold-start cal/min | **MyRX-calibrated** from typical commercial Assault Bike output at intermediate effort — male 18 / else 13 (male/else=female rule) | `mobile/src/lib/movements.ts` `genderBaselineCalsPerMin` |
| StairMill cold-start floors/min | **MyRX-calibrated** from typical Stairmaster Gauntlet output at moderate-vigorous effort — male 12 / else 9 (male/else=female rule) | `mobile/src/lib/movements.ts` `genderBaselineFloorsPerMin` |
| Per-second HR storage | **Samsung Health Data SDK v1.1.0** — `ExerciseSession.log[].heartRate` field (1 Hz cadence) → stored as `wearable_workouts.raw_meta.hr_log` JSONB array | `mobile/android/.../SamsungHealthModule.kt` + `mobile/src/lib/integrations/samsungHealth.ts` |

### Mobility / ROM, Bodyweight

| Surface / formula | Source | Where it lives |
|---|---|---|
| ROM progression model | **No published formula** — purely user-tracked degrees, with comparison to prior best. Future expansion could cite McKenzie / Janda mobility literature | `Mobility.jsx`, `MobilityDetail.jsx` |
| Bodyweight trend smoothing | **None applied today** — raw daily logs charted as-is. Future: simple 7-day moving average per Lyle McDonald's "true weight" methodology | `Bodyweight.jsx`, `CalorieStrip.jsx` |

### What's NOT a published formula (MyRX-derived heuristics)

These are app-internal rules without a single external citation; document them here so future audits don't go looking for one that doesn't exist:

- **PhantomWheel inertia constants** — `INERTIA_MIN_VELOCITY = 250 px/s`, `INERTIA_DECELERATION = 0.993`. Tuned by feel over many iterations on physical Android devices.
- **Animation timing patterns 1–7** — the 500/250/500ms AnimateRise cascade, the 1.5s chevron pulse cycle, the 220ms swipe-dismiss + LinearTransition timings. MyRX-locked design.
- **Concept2 erg session distances per zone** — drawn from Concept2 community + masters/Olympic prep convention, not from a single paper.
- **GoRuck tier thresholds** — drawn from the GoRuck event series (Tough / Heavy / Selection); MyRX picks Tough as the top tier and sub-divides Beginner / Intermediate / Advanced beneath it.
- **Carry strongman benchmark weights** — drawn from World's Strongest Man / Atlas Stones competition standard sizes, not a single published rate table.

When adding a new formula or rate constant anywhere in the app, add it to the appropriate table above with the citation, and add the explanatory comment at the formula's site cross-referencing this section.

## Sleep page coaching engine (LOCKED — May 31 2026)

The Sleep page (`mobile/app/(app)/sleep.tsx`) computes everything from the user's actual logs — no settings input required. The math has to read the same way every time, so the entire engine is locked here. Touch these only with explicit user approval.

### Inputs

- **`sessions7`** — last 7 nights of `sleep_sessions` rows. Source of every average on the page.
- **`profile.birthdate`** — drives the age-banded target duration. Only required field.
- **`profile.date_format`** — `'mdy'` or `'dmy'`, drives the Sleep Clock center date label.

No user-set bedtime, wake time, or duration target. **Do not add one** — that path was considered and rejected May 31 2026. The user explicitly said: derive everything from logs, coach toward the age-banded target, don't force input.

### Targets

- **`target_duration_hours`** = age-banded per `targetHoursForAge(birthdate)` — locked table:
  - 0-3mo: 15h · 4-11mo: 13h · 1-2y: 12h · 3-5y: 11h · 6-12y: 10h · 13-17y: 9h · 18-25y: 7.5h · 26+: 7h
  - Sources: AASM Paruthi 2016 (J Clinical Sleep Med), NSF Hirshkowitz 2015 (Sleep Health), Li et al. 2022 (Nature Aging, UK Biobank N≈500k).
- **`DEEP_TARGET_S`** = 5400 (90 min). Yu et al. 2024 — MCI vs CN have ~4.3% deep-sleep gap (≈18 min on a 7h night), so 90 min is the population center.
- **`REM_TARGET_S`** = 5400 (90 min). Same source basis.
- **Target bedtime** (computed, not stored): `avg_wake_hour - target_duration_hours`. So if user wakes at 7:30 AM and target = 7h, target_bedtime = 12:30 AM. **Never** asks the user.

### Averages (all from sessions7)

- **`avg_duration_s`** = `sum(s.duration_s) / N`. Used for Total dim + verdict banner.
- **`avg_bed_hour`** = `mean(bedtimeOffsetSeconds(s.start_at)) / 3600`. Decimal hours in local TZ. Source of truth for every bedtime-anchored cue.
- **`avg_wake_hour`** = `mean(wakeOffsetSeconds(s.end_at)) / 3600`. Same.
- **Consistency stddev** = `stdDev(bedOffsets) / 60` (minutes). Drives Schedule's consistency classifier.

### Status classifiers (LOCKED dose-response thresholds — see existing CLAUDE.md research section)

- `classifyTotal(actual, target)` → OK ≤30 min off, WARN ≤90 min, FAIL >90. Symmetric (Li U-curve).
- `classifyStage(actual, target)` → OK ≤15 min short, WARN ≤30 min, FAIL >30. Asymmetric — only short side.
- `classifyBedtime(actual, target)` → OK ≤15 min late, WARN ≤60 min, FAIL >60. Wittmann 2006 social-jetlag boundary.
- `classifyConsistency(sd)` → OK ≤30 min, WARN ≤60 min, FAIL >60. Lunsford-Avery 2018 + Windred 2024.

### CBT-I weekly micro-target (NEW — Spielman 1987 sleep restriction therapy)

- **`computeMicroTarget(avgSec, targetSec)`** returns `{ microTargetSec, deltaMin, direction, reachesTarget }`.
- Step size: **`MICRO_TARGET_STEP_SEC = 15 * 60`** (15 min). Spielman 1987 + Edinger 2021 AASM CBT-I guideline: circadian rhythm adapts to bedtime shifts in 15-min weekly increments. Larger jumps don't stick.
- **Clamping**: never overshoots the age-banded target. If avg = 6h and target = 7h, this week's target is 6h 15m, next week 6h 30m, etc. Once within ±15 min of target → direction = 'hold'.
- Surfaced in the banner as: *"This week, aim for Yh Zm (+15 min) — your circadian rhythm adapts in 15-min weekly steps."*

### Bedtime-anchored hygiene cue registry (LOCKED — every cue cites its source)

All cues use **`makeCue(id, avgBedHour, avgWakeHour)`** which computes time offsets relative to the user's actual logs. No generic clock times.

| Cue ID | Time formula | Source |
|---|---|---|
| `caffeine` | bedtime − 6h | Drake et al. 2013 (J Clin Sleep Med) — caffeine half-life |
| `alcohol` | bedtime − 3h | Roehrs & Roth 2001 — REM suppression |
| `meals` | bedtime − 3h | Park et al. 2020 — delayed deep entry |
| `screens_dim` | bedtime − 1h | Burgess 2013 — melatonin suppression |
| `screens_off` | bedtime − 30 min | Burgess 2013 — blue-light wake trigger |
| `sunlight` | wake + 30 min | Wright et al. 2013, Khalsa 2003 — strongest circadian anchor |
| `temp` | ≤67°F (not time-dependent) | Okamoto-Mizuno 2012 — thermoregulation drop triggers deep |
| `wake_anchor` | `fmtClock12(avg_wake_hour)` | Czeisler 1999 — DOMINANT zeitgeber (stronger than bedtime) |
| `rem_tail` | "last 90 min of sleep" (not time-dependent) | Carskadon & Dement — REM cycles lengthen across night |

When adding a new cue, add it to the registry above + cite the published source. **Never** add a generic-time cue ("no caffeine after 2 PM" applied to all users) — that violates the page's design contract.

### Cue rotation

- **`weekParity()`** = `Math.floor(Date.now() / WEEK_MS) % 2`. Stable within a render, flips at the weekly boundary.
- Each dim has 2 cues; week 0 shows primary, week 1 shows alternate. Prevents chronically-off users from reading the same advice 7 days in a row.
- Per-dim rotation:
  - **Total** (when short): sunlight (W0) ↔ wake_anchor (W1)
  - **Deep**: temp (W0) ↔ meals (W1)
  - **REM**: alcohol (W0) ↔ rem_tail (W1)
  - **Schedule**: always wake_anchor (Czeisler-primary, no rotation — bedtime variant names a specific time instead)

### Wake-time anchor (LOCKED — coaching primary)

Czeisler 1999 + decades of subsequent chronobiology research: **wake time is the dominant circadian zeitgeber, stronger than bedtime**. Every coaching cue that needs a single high-leverage lever must lead with "hold your wake time" — not "hold your bedtime". Behavior reason: alarms are easier to enforce than falling-asleep targets. Biology reason: wake time triggers the cortisol rise that anchors the next 24h cycle.

This means:
- Schedule's consistency cue: *"Hold your alarm at HH:MM AM — wake time is your dominant circadian anchor."* (NOT "hold your bedtime".)
- Total short, bedtime late case: lead with *"Hold W as alarm anchor"* then *"pull bedtime to B"*.
- Total short, bedtime already early case: lead with *"Hold W"* or extend wake later if schedule allows.

### Verdict banner composition (LOCKED — 3 woven pieces + cascade)

The top banner is the single integrative coaching cue. Composed in `verdictText` memo as:

```
[STATE] [MICRO?] [LEVER] [CASCADE?]
```

- **STATE**: `"Sleep is averaging Xh Ym."`
- **MICRO** (only when off-target): `" This week, aim for Yh Zm (+15 min) — your circadian rhythm adapts in 15-min weekly steps."`
- **LEVER** (always, lead-dim-specific):
  - Total short + bedtime late: *"Hold W as your alarm anchor (wake time is your strongest circadian zeitgeber) and pull bedtime to B."*
  - Total short + bedtime early: *"Hold W as your wake target — or extend it later if your schedule allows. Bedtime is already on track."*
  - Total over: *"Hold W as your alarm and let bedtime drift later — oversleeping past the age-banded target signals recovery debt."*
  - Schedule lead: wake_anchor cue.
  - Deep/REM lead: corresponding rotated cue from registry.
- **CASCADE** (only when 2+ dims off): one short sentence noting which fix carries the others. Schedule fixes get "Once your wake anchor holds, total and stage time usually follow"; total fixes get "Adding total sleep typically lifts deep + REM proportionally".

Per-dim card action lines stay one-line — the integrative narrative lives only in the banner.

### Verdict color tracks the LEAD item's status (NOT off-count thresholds)

`lead` memo picks worst-status-first (FAIL > WARN). `verdict.color = statusColor(lead.status)` — banner color matches the named dim's pill color. If banner says "start with schedule" and schedule is FAIL → red stripe; if it names a WARN item → amber stripe.

### "How we compute" info pill (LOCKED — Pattern 5 inline panel)

Small `<Info>` icon in the verdict-card header. Tap → expands a `FadeInUp`/`FadeOutUp` panel with 5 labeled paragraphs explaining: target source, your averages, this week's nudge, hygiene timing math, wake-anchor reasoning. Color stripe + icon track `verdict.color`. Mirrors the existing Pattern 5 used on every other detail page.

### Attribution footer (LOCKED format)

Single line under the Dimension Breakdown card:

```
AASM · NSF · Li 2022 · Belenky · Van Dongen · Wittmann · Windred · Spielman · Czeisler · Wright · Roehrs · Okamoto-Mizuno · Burgess · Drake · Park — age-banded targets, dose-response thresholds, CBT-I micro-targeting, bedtime-anchored hygiene cues
```

When adding a new source to the engine, append to the names list AND extend the descriptor at the end. Never remove an existing author — every name listed has a downstream formula or threshold depending on it.

### Tests / sanity-check rules

- Every hygiene cue in `makeCue()` must reference `avgBedHour` or `avgWakeHour` (not a hardcoded clock time). If a cue is timing-independent (temp, REM-tail), document that in the cue text.
- Every new source added to the registry must (a) be a published study with a name + year, (b) get added to the attribution footer, (c) get added to this LOCKED section's source list.
- Micro-target step stays at 15 min unless CBT-I literature changes. Don't tune by feel.
- Wake-anchor primacy is non-negotiable per Czeisler — do not flip the coaching back to bedtime-first.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS v3, Wouter v3 (routing), Lucide React (icons)
- **Auth/DB**: Supabase (project: `xtxzfhoxyyrlxslgzvty`)
- **Hosting**: Cloudflare Pages
- **Fonts**: Geist (primary, all-purpose) + Geist Mono (loaded but rarely used). See font conventions below.
- **Charts**: Recharts

### Font conventions (locked)
- **Default text** — all UI copy, headings, labels, body text — uses **Geist** (sans). This is the system font.
- **Numbers** (weights, reps, times, distances, percentages, calorie counts, ages, durations, projections) use **Geist Mono** via the Tailwind `font-mono` class. Always pair with `tabular-nums` so numeric digits line up by column. This is the canonical look across every detail page, dashboard stat, tile, and chip — match it.
- Examples that should use `font-mono tabular-nums`:
  - Big weight numbers on detail pages (`text-3xl font-mono tabular-nums text-blue-400`)
  - Tile values in rep-max grids
  - Plate chips, dumbbell weight, kettlebell weight, machine pin
  - PR projections in headers ("Best Est. 1RM — 370 lb")
  - Time displays ("3:30 min", "45 sec")
  - Pace / distance values
  - Percentages on tiles ("100%", "76%")
- **Geist (sans) for everything else** — including verbs, units (`lb`, `kg`, `min`, `sec`), labels, descriptions, button text.
- Don't remove `font-mono` from existing number renders unless explicitly asked. If you're adding a new number display, default to `font-mono tabular-nums` to match.

## Live URL
**Primary (canonical):** https://myrxfit.com — this is the URL the user QAs against. Always reference this URL in messages, screenshots, and bug reports.

**Cloudflare-managed alias:** https://myrx-bwl.pages.dev — auto-generated by Cloudflare for the `myrx` Pages project. Serves the exact same bundle as myrxfit.com; both are CNAMEd to the same project. Useful for `wrangler` deploy URLs but NOT what to show the user.

When verifying a deploy, hit myrxfit.com (not the pages.dev alias) so the asset hash you compare matches what the user actually sees:
```bash
curl -s "https://myrxfit.com/" | grep -oE 'index-[^"]+\.js'
ls web/dist/assets/index-*.js
```

## Deployment
```powershell
# From C:\Users\motaz\OneDrive\Desktop\MyRX\web
npm run build
npx wrangler pages deploy dist --project-name myrx --commit-dirty=true
```
Env vars are already set in the shell profile. No need to set them manually.

> 🚀 **AUTO-DEPLOY AFTER EVERY WEB CHANGE.**
> The user QAs on the live URL — there is no `npm run dev` workflow. After any code
> change to `web/` (no matter how small), the assistant MUST chain the build + deploy
> from inside `web/`:
> `cd web && npm run build && npx wrangler pages deploy dist --project-name myrx --commit-dirty=true`
> as the LAST action of the turn. Reporting "build passed, please verify" without
> deploying wastes a round-trip because the user can't test until it's live.
> Skip ONLY if the user explicitly says not to deploy (e.g. "don't deploy yet", "just write the code"),
> OR if the change was mobile-only (`mobile/...` — no web build needed).

> ⚠️ **Deploy goes directly to Cloudflare — NOT via GitHub.**
> The Cloudflare Pages project (`myrx`) is a **Direct Upload type** — its Git connection is not active. Pushing to `MotazJarrah/myrx` on GitHub does NOTHING for the live site. Wrangler uploads `dist/` straight to Cloudflare Pages, full stop.
>
> **The Pages dashboard is misleading**: deployments listed there show commit messages like `feat: ...` and a `main` branch source. Those are residue from a past CI/Git integration that stopped firing. **Treat them as stale labels** — the actual content was uploaded by a wrangler call. New `git push origin main` commits will NOT appear here.
>
> **If a change isn't visible at `myrxfit.com` after a deploy, verify with this:**
> ```bash
> curl -s "https://myrxfit.com/" | grep -oE 'index-[^"]+\.js'   # what's live
> ls web/dist/assets/index-*.js                                       # what local build produced
> ```
> If those two hashes don't match, the wrangler upload didn't run — re-run `npx wrangler pages deploy dist --project-name myrx --commit-dirty=true`.
>
> Past incident (2026-05-08): three GitHub pushes in one session deployed nothing because the Pages project was assumed to be Git-connected. Resolved by direct wrangler upload. Don't re-run that experiment — wrangler is the only deploy path.

> 🚫 **Netlify is GONE. Do not use it, reference it, or deploy to it under any circumstance.**
> The Netlify account has been deleted. There is no `.netlify/` folder. The only valid deploy target is Cloudflare Pages via `wrangler`.

> ⚙️ **Edge functions ALSO don't auto-deploy on git push** (LOCKED — May 29 2026).
> Supabase edge functions (`supabase/functions/*/index.ts`) behave the same way as Cloudflare Pages: committing + pushing the file changes the repo but does NOT change what's running in production. Each function has its own version on the Supabase project and must be deployed explicitly via the `mcp__8dbdae5c-...__deploy_edge_function` MCP tool (or `supabase functions deploy <name>` from a properly-configured CLI).
>
> When you edit any `supabase/functions/*/index.ts`, treat deploy as the last step of the turn — same rule as the wrangler one above. Read the full file, call the deploy tool with the entire file content, verify the response says `status: ACTIVE` with a bumped `version` number.
>
> **Past incident (May 29 2026)**: voice-audit rewrites for `send-coach-invite`, `verify-phone-otp`, and `coach-signup` landed in three commits but never deployed for an unknown number of hours. Production still served the old banned phrasing ("fully covered by your coach's subscription") until the rules were caught visually in a test invite. Resolved by deploying all three via MCP. Don't repeat — agents that report "rewrote the function" but haven't called the deploy tool have not actually finished the work.

## Cloudflare Details
- Account ID: `d42e96189bfa3cacb2aaab8231eb0097`
- Project name: `myrx`
- API Token: **NEVER COMMIT.** Stored locally in `$env:CLOUDFLARE_API_TOKEN`
  (PowerShell profile) — set there once and `wrangler` picks it up from
  the environment. If a fresh agent needs to deploy and the env var is
  missing, ask the user to paste it in chat rather than recording it in
  any file. (Previous tokens were exposed via committed CLAUDE.md and
  auto-revoked by Cloudflare's GitHub-secret-scanning integration —
  see commit history if a token shows up in `cfut_…` form anywhere,
  it must be rotated immediately.)

## Email infrastructure (LOCKED — May 26 2026)

The user explicitly asked for vendor unification ("i hate that we have so many channels for everything"). The locked end-state:

**Outbound (all app-generated email): SendGrid via Twilio account.**
- Coach invites (`send-coach-invite` edge function) → SendGrid HTTPS API
- Supabase Auth emails — signup confirmation, magic link, password recovery, email change, invite user — Supabase Auth → Custom SMTP → `smtp.sendgrid.net:587` / username `apikey` / password = `SENDGRID_API_KEY`
- Future: any new app email sender (notifications, weekly digests, etc.) MUST go through SendGrid. No other provider gets added without explicit user approval.
- Sending domain: myrxfit.com (DKIM + SPF + DMARC verified via Twilio One Console → Email → Domain Authentication, auto-installed via Cloudflare Entri integration on May 26 2026)
- From addresses (both on the same authenticated domain):
  - `noreply@myrxfit.com` for Supabase Auth flows (SMTP_ADMIN_EMAIL)
  - `invites@myrxfit.com` for coach invites (SENDGRID_FROM)
  - Both share the same DKIM signature and deliverability reputation
- Sender name: `MyRX`
- Free tier: 100 emails/day. $20/mo for 40k once volume exceeds the free tier. SendGrid trial ends July 25 2026 — credit card needs to be added before then OR sending will pause.

**Inbound (human inbox for replies to team@myrxfit.com): Zoho Mail.** Kept as-is. Separate from outbound — different problem space (human reading vs. machine sending). No plan to consolidate inbound into SendGrid; Inbound Parse would require building a custom inbox UI inside MyRX admin and that's not worth it for v1.

**SMS: Twilio Verify** (already in use, separate from email channels).

**REMOVED (no longer in use, do not re-add):**
- Resend — was briefly in the `send-coach-invite` edge function before the Twilio/SendGrid pivot. Killed May 26 2026. If you ever see `RESEND_API_KEY`, `RESEND_FROM`, or `api.resend.com` references in new code, that's a regression — delete them.
- Supabase Auth's built-in SMTP — still works as a fallback if custom SMTP fails, but the rate limit (4 emails/hour on free tier) made it unusable for OTP volume at scale. The custom SMTP override is permanent.

**Operational notes:**
- The SendGrid API key is scoped to "Mail Send" only (Restricted Access in SendGrid's permission model). Even if it leaks, attacker can only send email — not read suppression lists, not change billing, not view contacts.
- Tracking (click-tracking, open-tracking, subscription-tracking) is DISABLED on every outbound. Click-tracking would rewrite our URLs into SendGrid redirects which (a) leak invite tokens to SendGrid's logs and (b) break Android App Link autoVerify because the host changes from `myrxfit.com` to `sendgrid.net`.
- If deliverability ever drops, first check: SendGrid dashboard → Activity Feed for bounces/blocks/spam reports. Don't blame Supabase — they're just relaying through SendGrid now.

## Secrets hygiene (MANDATORY)

This repo has been bitten twice by secrets leaking via committed files — once with a Cloudflare API token, once with a USDA FoodData Central API key (the USDA one was auto-detected by GitHub and disabled by USDA IT on 2026-05-06). Both leaks happened because a credential ended up in a tracked file. A third near-miss on 2026-05-27 — a Stripe TEST secret key (`sk_test_...`) pasted into `COACH_PLATFORM_TEST_READY.md` for setup convenience — was caught by GitHub Push Protection (Layer 3) before reaching the public repo, then scrubbed from git history via `git filter-repo --path COACH_PLATFORM_TEST_READY.md --invert-paths --force`. That incident is the textbook example of why all three defence layers must stay enabled and why even test-tier credentials get the same treatment as production. The pre-commit hook was extended after the incident to catch `sk_test_`, `rk_live_/test_`, `whsec_`, and `SG.xxx.xxx` patterns.

### Where secrets live

Every credential MUST live in exactly one of these stores, and nowhere else (no files, no CLAUDE.md, no scratch docs, no chat messages, no inline code):

| Secret class                                    | Storage                                                          |
|-------------------------------------------------|------------------------------------------------------------------|
| CI/CD secrets (USDA API key, etc.)              | **GitHub Actions Secrets** — `Settings → Secrets and variables → Actions` |
| Cloudflare wrangler / deploy                    | **PowerShell profile env var** — `$env:CLOUDFLARE_API_TOKEN`     |
| Cloudflare Worker runtime secrets               | **`wrangler secret put NAME`** — encrypted in CF, never on disk  |
| Supabase Edge Function secrets (Twilio etc.)    | **Supabase Dashboard → Edge Functions → Secrets**                |
| Web/mobile public-tier keys (Supabase anon)     | Plain Vite/Expo env, embedded in client bundle — OK to commit    |
| Web/mobile **service-role** Supabase keys       | Never used client-side. Server only.                             |

Code reads them at runtime via `process.env.NAME` (or `import.meta.env` for Vite). Never inline.

### Layer 1 — `.gitignore` (.env* family)

`.gitignore` explicitly blocks `.env`, `.env.local`, `.env.production`, etc. so they can't be staged accidentally. The only exception is `.env.example` (an empty template, no real values). If you find yourself wanting to commit anything in the `.env*` family, you're about to leak a secret — stop and rethink.

### Layer 2 — pre-commit hook (`scripts/git-hooks/pre-commit`)

A bash script that scans staged changes for known secret patterns (Cloudflare tokens, AWS keys, OpenAI keys, Stripe keys, GitHub PATs, USDA api.data.gov URLs, JWT triplets, private key blocks, generic Bearer tokens, hardcoded `*_KEY=` / `*_TOKEN=` assignments). Blocks the commit if any pattern matches.

**One-time install** (per clone of the repo):

```bash
git config core.hooksPath scripts/git-hooks
# Linux/macOS only:
chmod +x scripts/git-hooks/pre-commit
```

**Verify it's wired up:**

```bash
git config core.hooksPath   # should print: scripts/git-hooks
```

If you legitimately need to commit something that triggers a false positive (e.g. adding a new regex example to the hook itself):

```bash
git commit --no-verify
```

Don't make `--no-verify` a habit. If a real secret matches and you bypass, you've defeated the whole defence.

### Layer 3 — GitHub Push Protection (server-side)

GitHub scans every push for ~200 known credential formats. If it sees one, it blocks the push and tells you which file/line. Free, one-click to enable.

**Enable at:** `Settings → Code security → Secret scanning → Push protection → Enable for this repository`

This is the final net — if a secret somehow makes it past layers 1 and 2, push protection catches it before it becomes public. **Never disable it.** Status must stay enabled across repo transfers, owner changes, etc.

### What to do if a secret leaks anyway

1. **Rotate the secret immediately** — go to the issuing service (Cloudflare, USDA, Supabase, Twilio, …) and revoke + regenerate. The exposed value is dead the moment it leaves your machine.
2. **Force-rewrite git history** to scrub the secret from past commits. Use `git filter-repo --replace-text <(echo 'SECRET_VALUE==>REMOVED')` then a force-push to `origin/main`. Note: even after history rewrite, the secret may persist in forks, caches, and the Internet Archive — rotation is the only real fix.
3. **Update the new secret** in its proper store (GHA secret, env var, etc.).
4. **Add the leaked pattern to `scripts/git-hooks/pre-commit`** so the same shape can't slip through again.
5. **Audit the rest of the repo** for siblings of the same secret class.

## Food library architecture (LOCKED — May 21 2026)

The food library is two layers: a Cloudflare D1 database (`myrx-food-library`)
holding ~470K curated rows from USDA + OpenNutrition + MYRX-custom, AND the
search/CRUD worker (`workers/food-search/`) that fronts it.

**There are TWO paths to update the data and they share the same
core pipeline. Picking the right one matters:**

| Path | When | Where it runs |
|---|---|---|
| **Sync orchestrator** (production) | Day-to-day. Admin clicks "Sync now" in the food library admin panel after USDA / ON release new data. Monthly cron also fires it. | GitHub Actions. Pulls source files from R2 mirror, processes them, writes to D1. |
| **bulk_import** (full rebuild) | One-shot. Use only when D1 needs to be wiped and rebuilt from scratch (e.g. recovering from corruption, schema migration). | Locally, on the admin's laptop. Expects pre-extracted CSV/ZIP files in `scripts/bulk_import/data/`. |

Both share the same loaders, filter rules, and dedup logic in
`scripts/bulk_import/lib/`. The orchestrator at `scripts/sync/run.mjs`
just adds: download from R2, diff against live food_library, write
either via changelog (staged) or atomic swap (commit).

### Sync orchestrator — the production update path

**Why R2 mirror exists**: USDA's CDN at `fdc-datasets.ars.usda.gov`
returns `ENOTFOUND` from every cloud-egress IP we've tested (GitHub
Actions runners, Cloudflare sandbox, etc.). USDA appears to firewall
or geofence non-residential IPs. **The CDN is effectively
unreachable from any automated pipeline.** Direct fetch is not a
viable architecture.

The R2 mirror works around it: admin downloads the USDA + ON ZIPs
manually onto their laptop (where USDA's CDN works fine), uploads
them via the drag-drop UI in admin Food Library, and the sync
orchestrator pulls from R2 (which is always reachable from GHA).

**Release cadence reality check**: USDA publishes ~2x/year — April
and October/November. OpenNutrition updates less often. The monthly
cron we set up is overkill; it'll be a no-op most months because the
data hasn't changed. That's fine — the diff will be empty and Phase
5 short-circuits.

**Files in R2**:
- `usda/current.zip` — latest USDA FoodData Central ZIP (~460 MB)
- `usda/meta.json` — `{ filename, size, uploaded_at }`
- `on/current.zip` — latest OpenNutrition ZIP (~60 MB)
- `on/meta.json` — same shape
- Bucket: `myrx-food-mirror`, binding: `MIRROR_BUCKET` in worker
- Files are **per-source independent** — re-upload only what's new.
  If only USDA has a new release, drag in just that ZIP; ON stays put.

**Sync phases** (`scripts/sync/run.mjs`, ~16 min end-to-end):
1. Phase 1 — Download both ZIPs from R2 in parallel (~25 sec)
2. Phase 2 — Parse via `loadUsda()` + `loadOn()` (filter rules 1-14
   applied during parse) (~4 min, dominated by USDA's 27M-row
   food_nutrient.csv)
3. Phase 3 — Dedup rules 15-19 in memory via `applyDedup()` (~7 sec)
4. Phase 4 — Diff against live food_library (USDA + ON only; MYRX
   excluded; chunked 10k rows per query) (~5 min)
5. Phase 5 — Write changelog + apply to D1 (~1 min). **Short-circuits
   immediately if diff is empty** (no inserts/updates/deletes → skip).
   Reuses Phase 4's loaded data so we don't double-query.
6. Phase 6 — FTS rebuild + watermarks + sync_history row (~20 sec)

**Modes**:
- `staged` — changelog rows written with `committed=0`. Admin reviews
  the I/U/D summary, clicks Commit (apply) or Discard (drop). Used
  via the dry-run toggle.
- `commit` — changelog rows + atomic swap on food_library in one go.
  No review step.

**Cancellation**: worker has `sync_cancel_requested` flag. UI sets
it on Cancel. Orchestrator polls between phases AND every 5 seconds
during the download phase. On cancel: pushes status='cancelled',
worker wipes the run's changelog + step_log, state resets to idle.
**Don't add "clear cancel flag on running transition" anywhere** —
that bug silently swallowed user cancels for half a day.

**D1 schema for sync**:
- `sync_state` (key/value) — current status, run_id, mode, cancel
  flag, watermarks, etc.
- `sync_changelog` (run_id, operation, food_source, food_source_id,
  before_data, after_data, committed, reverted) — every I/U/D per
  run. Used for review/commit/discard/undo.
- `sync_history` (run_id, mode, status, started_at, ended_at,
  total_ms, phase_durations JSON, inserts, updates, deletes) — one
  row per run, used for ETA computation (median of last 5).
- `sync_step_log` (run_id, ts, step_code, message, level, error_code)
  — verbose progress feed. Retention: most-recent 3 runs.

**Error codes** (E_001 through E_099) — short identifiers logged in
sync_step_log so failures can be triaged from a glance at the log
panel. Full list at top of `scripts/sync/run.mjs`.

### Bulk import — full rebuild path (rarely needed)

```powershell
cd C:\Users\motaz\OneDrive\Desktop\MyRX
node --max-old-space-size=8192 scripts/bulk_import/run.mjs
```

Pre-requisites (already in `data/usda/` and `data/on/`):
- `scripts/bulk_import/data/usda/FoodData_Central_csv_YYYY-MM-DD/`
  (downloaded "Full Download" ZIP from
  https://fdc.nal.usda.gov/download-datasets, extracted)
- `scripts/bulk_import/data/on/opennutrition-dataset-YYYY.N.zip`
  (downloaded as-is from https://www.opennutrition.app/download)

### What the bulk import does (in order)

1. Pre-flight check — required files present
2. Snapshot current row counts
3. Wipe USDA + ON rows from D1 (**MYRX rows are NEVER touched** —
   `wipeUsdaAndOn()` filters `WHERE source IN ('usda','on')`)
4. Backfill MYRX audit columns
5. Load USDA CSVs into memory + apply **Tier 1-4 filter rules (1-14)**
   from `scripts/d1_migrate/lib/filters.mjs` during parsing
6. Load ON ZIP into memory + apply **Tier 1-4 filter rules (1-14)**
7. **Apply Tier 5 dedup rules (15-19) IN MEMORY** to the combined
   USDA+ON array via `scripts/bulk_import/lib/dedup_in_memory.mjs`.
   This is the architectural rule — see below for why.
8. Push the deduped union (~470K rows) to D1 via `wrangler d1 execute
   --file=...` in batches of 25K rows per file
9. Rebuild FTS5 search index
10. Set sync watermarks (`usda_last_sync_date` = the CSV's snapshot
    date, `on_last_version` = the ON ZIP's version string) so future
    incremental syncs only fetch deltas
11. Final row-count verification + per-rule dedup summary

**Total runtime: ~9-15 minutes.** Most of the time is the D1 push
(~3-5 min) and parsing the 27M-row USDA `food_nutrient.csv` (~4 min).
The in-memory dedup runs in ~14 seconds.

### THE LAW: dedup runs in memory, BEFORE the D1 write

Rules 1-14 (REPAIR + REJECT tiers) run as the loaders walk the CSV
streams. Rules 15-19 (DEDUP tier) require cross-row comparison and
**MUST run in Node memory before any row hits D1.**

Earlier versions of the script ran Rules 15-19 as a post-import SQL
pass (`post_import_dedup.mjs`). At ~470K rows that worked. At 2M+ rows
— which is what the unfiltered USDA branded food catalog is — every
monolithic DELETE in that script timed out:

- **D1 has a 30-second per-query CPU budget.** Wrangler `--file`
  execution can't extend that.
- A `DELETE WHERE id NOT IN (SELECT MAX(id) GROUP BY ...)` over 2M
  rows times out, regardless of indexing.
- Even chunked self-joins on `(source, upc)` time out per chunk
  when the join cardinality is large.

The architecturally correct fix is to do dedup where the data already
lives — in Node memory, after the loaders parse and the filter
pipeline drops the Tier 1-4 rejects. Each dedup rule is then an O(n)
Map operation; the whole pass finishes in ~14 seconds.

The implementation is `scripts/bulk_import/lib/dedup_in_memory.mjs`.
**Do not move the dedup back into SQL. Do not try to "optimize" by
deduping post-import.** Both have been tried and both don't scale.

### Common failure modes + fixes

1. **`FATAL ERROR: Ineffective mark-compacts near heap limit` /
   `JavaScript heap out of memory` during Pass 6 (filter rules).**
   Cause: Node's default 4 GB heap isn't enough for the 2.1M USDA
   row array. Fix: always run with `--max-old-space-size=8192` (8 GB).
   12 GB if USDA ever grows past 3M rows.

2. **`UNIQUE constraint failed: food_library.source,
   food_library.source_id` during USDA push.** Cause: trying to
   re-insert a row that's still in the table. Fix: confirm Step 3
   (wipe) actually ran — re-run `wipeUsdaAndOn()` manually if needed.

3. **`wrangler d1 execute … --file=… --json` retry-3-times-then-fail
   on a DELETE statement.** Cause: D1's 30s query budget exceeded.
   Almost always means someone reverted Step 7 to a post-import SQL
   dedup. Restore the in-memory dedup path (`applyDedup`) in run.mjs.

4. **`error code: 1101` from a `/admin/cleanup/...` Worker endpoint.**
   Cause: CPU limit on the Worker, NOT D1. Worker free tier is 10ms
   CPU per request; paid is 30s. Either chunk the worker logic into
   ≤1000-row batches or move the heavy work to GHA + wrangler.

5. **`spawnSync /bin/sh ENOBUFS` in Phase 4 (sync orchestrator).**
   Cause: wrangler `--json` output for a large D1 query (50k-row
   chunk) exceeded Node's default `execSync` stdout buffer (1 MB).
   Fix: `maxBuffer: 256 * 1024 * 1024` on `execSync` in
   `d1_writer.mjs::querySql` AND reduce CHUNK in `run.mjs` to
   10,000 rows per query. Both layers — bigger buffer + smaller
   chunks — survive transient network blips too.

6. **`Wrangler requires at least Node.js v22.0.0` in GHA.** Wrangler
   4.x dropped Node 20 support. `.github/workflows/sync-food-library.yml`
   must specify `node-version: '22'` (or higher). Not 20.

7. **USDA scrape returns `ENOTFOUND (fdc-datasets.ars.usda.gov)` in
   GHA.** USDA's CDN is unreachable from cloud-egress IPs. This is
   not a transient error — it's permanent. The architectural fix is
   the R2 mirror (see "Sync orchestrator" above). DO NOT try to
   re-implement direct scraping with a different probe technique,
   different host, retries, etc. — all paths through that hostname
   fail the same way.

8. **Sync "stuck" cancelling for minutes.** Caused by the orchestrator
   being inside a long phase (e.g. ZIP extract, USDA parse pass) that
   doesn't poll the cancel flag. Cancel is checked at phase boundaries
   + every 5s during downloads. ZIP extract is the longest blind spot.
   Acceptable behaviour — the run will exit at the next checkpoint.

### Free-tier note

Cloudflare's documented D1 free tier limits (100K writes/day, 500MB
per DB) are NOT strictly enforced for `wrangler d1 execute --file=...`
uploads from the CLI. We pushed 2M+ rows in 13 minutes through that
path with zero rejections. The HTTP D1 API DOES enforce limits — so
per-row writes via worker fetch are still the bottleneck.

This is the practical reality, not the official spec. If Cloudflare
changes enforcement, the bulk_import would need to be batched across
multiple days OR moved to a paid plan ($5/mo Workers Paid = 50M
writes/day).

### Sync watermark contract

The bulk import sets two watermarks at Step 10. Any future incremental
sync (cron or manual) reads them as the starting date filter:

- `usda_last_sync_date` (e.g., `2026-04-30`) — sync_usda.mjs uses
  this as `publishedDateBegin` when calling USDA's API.
- `on_last_version` (e.g., `2025.1`) — sync_on.mjs skips its work
  entirely if the published ON version matches.

**If you ever manually wipe + reimport without bulk_import setting
these, the next sync defaults `usda_last_sync_date` to `2020-01-01`
and pulls ~6 years of USDA → 2,278 pages → 6-9 hours. Set the
watermark manually in that case:**

```powershell
cd C:\Users\motaz\OneDrive\Desktop\MyRX\workers\food-search
npx wrangler d1 execute myrx-food-library --remote --command `
  "UPDATE sync_state SET value='YYYY-MM-DD', updated_at=datetime('now') WHERE key='usda_last_sync_date';"
```

### What CSV files to download for a fresh import

Both downloads are public and free, no API key required:

- USDA Full Download (~500 MB zipped, ~5 GB extracted):
  https://fdc.nal.usda.gov/download-datasets → "Full Download"
- OpenNutrition dataset (~270 MB zipped):
  https://www.opennutrition.app/download → latest version

The filename's embedded date IS the watermark the sync uses. Don't
rename them.

## Cloudflare + D1 production scars

Gotchas discovered the hard way. Each one cost real time. None are
obvious from the docs.

1. **D1 has a 30-second per-query CPU budget.** Wrangler `--file`
   execution can't extend it. Monolithic operations over 2M+ rows
   ALWAYS time out — `DELETE WHERE id NOT IN (SELECT ... GROUP BY)`,
   self-joins on large tables, etc. Either chunk into ≤10k-row
   batches OR move the cross-row logic to in-memory Node (see THE LAW
   for food_library dedup).

2. **`execSync` default stdout buffer is 1 MB.** Wrangler `--json`
   output for a 50k-row query is ~50 MB → `spawnSync ENOBUFS`. Set
   `maxBuffer: 256 * 1024 * 1024` on every `execSync` call that
   wraps wrangler, AND keep individual query chunks at ≤10k rows.

3. **Wrangler 4.x requires Node 22+.** GHA Setup-Node must specify
   `node-version: '22'`. Wrangler refuses to start on Node 20 with
   a "requires at least Node.js v22.0.0" error.

4. **Workers Free has a 100 MB request body limit.** Anything bigger
   (food source ZIPs are 460 MB) needs R2 multipart upload, chunked
   from the frontend. The worker does NOT proxy the bytes through
   itself — it just orchestrates the multipart upload via R2's API
   (`createMultipartUpload`, `resumeMultipartUpload`, `uploadPart`,
   `complete`).

5. **R2 incomplete multipart uploads auto-clean at 7 days.** No need
   to write a cleanup job — if a browser refresh interrupts an
   upload mid-session, the orphan chunks expire automatically. We
   also write a `pending.json` marker per upload so the worker can
   abort cleanly when the user clicks Cancel.

6. **R2 must be manually enabled in the Cloudflare dashboard once per
   account.** Requires accepting R2 Terms of Service. Not automatable
   via wrangler — `wrangler r2 bucket create` returns "Please enable
   R2 through the Cloudflare Dashboard. [code: 10042]" until ToS is
   accepted via the web UI.

7. **`wrangler d1 execute --file` bypasses D1's HTTP API rate limits.**
   The documented free-tier limits (100K writes/day) are enforced on
   the HTTP API but NOT on the CLI `--file` pathway. We pushed 2M+
   rows in 13 minutes via the CLI with zero rejections. Per-row
   writes via worker `env.DB.prepare(...).run()` DO count against the
   limits. This is practical reality, not documented behaviour — if
   Cloudflare ever closes the loophole, bulk_import switches to a
   multi-day batched run or Workers Paid ($5/mo = 50M writes/day).

8. **Cloudflare Pages does NOT auto-deploy from GitHub on this
   project.** The Pages dashboard shows commit-message-looking
   deployments, but those are residue from a defunct Git connection.
   The only working deploy path is `wrangler pages deploy web/dist`.
   `git push` accomplishes nothing for the live site. Verify with:
   ```bash
   curl -s "https://myrxfit.com/" | grep -oE 'index-[^"]+\.js'
   ls web/dist/assets/index-*.js
   ```
   Hashes must match.

9. **Vite reads `.env.local` from the project root, NOT from `web/`.**
   Need `envDir: '..'` in `vite.config.js`. Without it, build-time
   env vars are empty strings and the bundle 401s every admin
   endpoint. This bit us once and could bite again on any new env
   var added.

## Supabase + Postgres scars

Hard-won lessons from things that aren't obvious from the docs.

1. **EVERY `profiles` upsert MUST include `auth_user_id`** (LOCKED,
   May 26 2026). The `profiles_active_must_have_auth` CHECK
   constraint requires `(deactivated_at IS NOT NULL OR auth_user_id IS
   NOT NULL)`. Looks like a "row-state" rule, but PostgreSQL evaluates
   CHECK constraints on the **proposed-INSERT row FIRST**, BEFORE
   the ON CONFLICT branch fires — even when the existing row already
   has `auth_user_id` set. So an upsert payload like
   `{ id: user.id, phone: '+1...' }` proposes an INSERT row where
   `auth_user_id` is NULL → CHECK fails → entire statement errors
   out before the ON CONFLICT DO UPDATE branch can run.

   **The rule**: every upsert into `profiles` (across web, mobile,
   and edge functions) MUST include `auth_user_id: <userId>` in the
   payload, even when you "know" the row already exists. It's a
   no-op for the UPDATE branch (value matches what's there) and the
   one thing that makes the fallback INSERT path satisfy the CHECK.

   Where the pattern was reintroduced and burned us (all fixed May
   26 2026): mobile `sign-up.tsx` (11 upsert sites in UnitsScreen,
   SexScreen, DOBScreen, HeightScreen, WeightScreen, the batched
   Promise-screen save, NameScreen, PhoneScreen pre-write,
   PhotoScreen, welcome-end, bumpCheckpoint); web end-user
   `Signup.jsx` (same 11 sites mirrored); web coach `Signup.jsx`
   (NameScreen, PhotoScreen); web `AuthContext.jsx::updateProfile`;
   edge functions `init-profile-checkpoint` + `verify-phone-otp`.

   Most of those were silently swallowed by `try { ... } catch
   { /* best-effort */ }` blocks — so users walked through signup
   thinking everything saved, when half the fields were getting
   dropped by the CHECK. The verify-phone-otp loud failure (500 to
   the client) is what finally surfaced the bug. **Don't trust that
   "the row already exists" rescues you from the CHECK — it doesn't.**

   New upserts: add `auth_user_id: user.id` (web) or
   `auth_user_id: userId` (edge functions) RIGHT AFTER `id:` in
   every payload. A code-review heuristic: any line that reads
   `from('profiles').upsert(` MUST have `auth_user_id` somewhere
   in the payload object. UPDATE statements (`.from('profiles')
   .update({...}).eq('id', ...)`) are NOT affected — CHECK on
   UPDATE only evaluates the post-UPDATE row. Only upserts trigger
   the proposed-INSERT pre-check.

## Android App Links (LOCKED — May 30 2026)

`mobile/app.json` declares HTTPS path prefixes that Android should hand
off from the browser into the MyRX app. **These prefixes MUST be narrow
and match only the URLs the mobile app actually has a route for.**

Current locked set:

- `/auth/confirm` — Supabase post-signup verification redirect
- `/auth/recovery` — Supabase post-password-reset redirect
- `/coach/accept-invite` — coach invite acceptance flow

What NOT to do:

- ❌ `pathPrefix: "/auth"` — too broad. Matches `/auth?mode=signin`,
  `/auth?mode=signup`, `/auth/legacy-foo`, anything Supabase or web
  later adds under `/auth/*`. When web signs out via redirect to
  `/auth?mode=signin`, Android pirates the URL into the mobile app
  and Expo Router shows "Unmatched Route" because there's no `/auth`
  route in mobile. This bit us May 30 2026 — user signed out on web
  in their Android Chrome browser and got dumped into the mobile app
  with the Unmatched Route screen.
- ❌ `pathPrefix: "/"` or any root-level prefix — would intercept
  EVERY myrxfit.com page.
- ❌ Adding a prefix for a path that has no matching Expo Router
  route in mobile.

The rule: for every prefix in `intentFilters.data[].pathPrefix`,
verify that `mobile/app/<path>.tsx` (or a parent `(group)/<path>.tsx`)
exists and handles the deep link gracefully.

Changing the prefix list requires a **native rebuild** — AndroidManifest
is baked into the APK at build time. After editing `app.json`:

```
cd mobile && npx expo run:android
```

Reinstalls the dev-client APK with the new manifest. JS-only Fast Refresh
won't pick up manifest changes.

When iOS ships, the same rule applies to `associatedDomains` /
`expo.ios.associatedDomains` — narrow path patterns, never `applinks:*`.

---

## Browser / React scars

Same theme: hard-won lessons from things that don't show up in any
documentation.

1. **bfcache eviction triggers** — when these are present, the page
   does a full reload on tab return instead of a fast snapshot
   restore (caused the "page keeps refreshing on tab switch"
   complaint). Avoid:
   - `Cache-Control: no-store` or `no-cache` on the document. Use
     `max-age=0, must-revalidate` for the same intent without
     killing bfcache.
   - **`self.clients.claim()` in service worker (any version). NO
     EXCEPTIONS — not even "one-time recovery" rationales. BUILD_VERSION
     bumps on every postbuild, which means a new SW install + activate
     fires on every deploy. Any claim() in the SW activate handler
     therefore fires PER DEPLOY, evicting bfcache for every active tab
     every time. This rule was broken once (May 25 2026 cache-poisoning
     "one-time recovery" — was actually per-deploy because the deploy
     cadence + BUILD_VERSION bump invalidated the "one-time" claim) and
     the regression reproduced the exact constant-reload symptom this
     rule was written to prevent. Permanently removed May 27 2026.
     Same ban applies to `self.clients.matchAll().navigate()` — same
     bfcache impact, plus it force-reloads every controlled tab on
     activate, which IS the user-visible symptom.**
   - WebSocket connections open at page-hide (pre-Chrome 149).
     Disconnect Supabase realtime on `visibilitychange='hidden'`,
     reconnect on `visible`.
   - `TOKEN_REFRESHED` auth events firing while the page is hidden.

2. **`sr-only` input inside a `<label>` triggers scroll-into-view on
   click.** The browser focuses the (invisible) input and scrolls it
   into view, dragging the page down. Pattern that broke the dry-run
   toggle. Use `<button role="switch" aria-checked={state}>` for
   custom toggles — no input element means no focus-scroll behaviour,
   and the button has native keyboard support.

   **Route-level viewport gates must NOT use pure `useIsDesktop()`
   (matchMedia min-width).** That hook flips false whenever DevTools
   opens on a laptop (DevTools panel narrows the available width
   below the breakpoint). If the gate is `if (!isDesktop) <Redirect/>`,
   opening DevTools silently navigates the user away from the page
   they were on — and closing DevTools doesn't bring them back, because
   the destination route doesn't have a reverse gate. Symptom: coach
   opens DevTools to inspect, gets dumped into /dashboard, can't get
   back without manually navigating. Locked May 27 2026 after exactly
   that bug. Use `useIsPhone()` (viewport AND `pointer:coarse`) for
   route gates — touch-input filter keeps DevTools-resized laptops on
   the original route. `useIsDesktop()` is still fine for
   COMPONENT-level layout decisions (3-col vs 1-col grid etc.), just
   not for redirects.

3. **Chrome popup blocker rejects the SECOND `window.open()` in a
   single click handler.** Only the first one is treated as
   user-initiated. Bit us on a "Open both source download pages"
   button that opened USDA + ON. Fix: split into two separate
   buttons (or two anchor tags with `target="_blank"`), each handling
   one URL on click.

4. **`ProtectedLayout` flickering caused full-tree unmounts.** The
   auth context briefly flips `profileLoading=true` even when
   `profile` is already loaded (any `refreshProfile()` call). If the
   gate is `if (loading || profileLoading) show <Skeleton/>`, every
   profile refresh tears down the route tree. Gate on
   `if (loading || (profileLoading && !profile))` instead — show
   skeleton ONLY on the initial null load, never on subsequent
   refreshes. This was the actual root cause of the "page refresh"
   complaints (NOT bfcache, which was a separate but smaller issue).

5. **Inline-arrow `component={() => ...}` on wouter `<Route>` causes
   unmount-on-every-parent-render.** Wouter renders `<props.component />`
   directly, and inline arrows produce a NEW function reference on every
   AppRoutes render. React's reconciler treats different function types
   as different components → unmounts the old + mounts a fresh one →
   page state resets, useEffects re-fire, data refetches, UI flashes
   skeleton. Symptom is identical to a page reload (em-dash placeholders
   on stat cards, "Loading…" panels) even though the URL never changes
   and load count stays the same. The bfcache log will correctly say
   `(NO reload)` because no navigation happened — the component just
   tore itself down. Locked May 27 2026 after the coach dashboard
   reproduced this on every tab-switch.
   **Fix:** define route components as STABLE top-level functions and
   pass them by reference: `component={CoachPortalRoute}` not
   `component={() => <CoachProtectedLayout><CoachDashboard/></CoachProtectedLayout>}`.
   See App.jsx — the Coach*Route consts above AppRoutes are the
   reference pattern.

6. **No visibility-change / focus refetches anywhere.** Pages load
   their data on mount and stay static until the user explicitly
   navigates away. The "useFocusEffect" pattern from React Native
   does NOT translate to web — on a desktop browser, the user
   constantly tab-switches (alt-tabbing to Slack / chat / docs is
   normal work behavior), and every tab return triggering a fresh
   fetch produces visible loading skeletons that feel like reloads.
   That ruined the coach dashboard UX until May 27 2026.
   **Valid refetch triggers (web):**
   - Initial mount (`useEffect([])`)
   - Route change (component remount via wouter)
   - Supabase realtime UPDATE/INSERT events (server pushes delta)
   - Explicit user action (button click, pull-to-refresh)
   **Banned (web):**
   - `document.addEventListener('visibilitychange', ... fetch ...)`
   - `window.addEventListener('focus', ... fetch ...)`
   - `useFocusEffect` from React Navigation (mobile-only, doesn't
     apply on web — but if a contributor ports the pattern, it gets
     implemented as visibilitychange and falls under this ban)
   The visibilitychange handlers in AuthContext.jsx + main.jsx are
   EXCEPTIONS — they disconnect/reconnect the Supabase realtime
   WebSocket for bfcache compatibility (pre-Chrome 149). They do
   NOT trigger fetches.

7. **Don't auto-clear server-side error state via polling.** When
   the admin operations panel showed a stale failure message from a
   previous run, the fix was to clear the in-DB error in a one-time
   capture (set `errorClearedRef`, push empty error to server,
   show in UI until next operation starts). Hammering the worker
   to clear it via repeated POSTs would be cheaper to write but
   nukes the audit trail.

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

10. **Status of the 4 Phase-2 legal docs:** all SHIPPED (May 26
    2026) — `/coach-agreement`, `/refund-policy`,
    `/health-disclaimer`, `/dpa`. All 4 routed in `App.jsx`. All 4
    incorporated into TOS §1. All 4 included in TOS §18 entire-
    agreement list. Coach Agreement + DPA referenced in TOS §8
    coach-specific terms. Health Disclaimer referenced in TOS §9
    health section. Refund Policy referenced in TOS §5.5 refunds
    section. PP §6.2 + §6.6 reference Coach Agreement + DPA.

11. **Legal docs are PUBLIC routes** that must sit BEFORE the
    `ProtectedLayout` catch-all in `App.jsx` so they don't get
    swallowed by the SPA's default redirect to `/dashboard`. The
    block of `<Route path="/terms" ... />`, `<Route path="/privacy" ... />`,
    etc., must remain above `<Route component={ProtectedLayout} />`.

## Barcode scanner rules (web admin + mobile)

Both surfaces — the web admin food-library Scan button and the
mobile FoodLogDrawer — use the same underlying patterns.

1. **1D barcode physics.** UPC/EAN/Code-128/etc. encode data in
   vertical bar widths. The scanner reads a horizontal line of
   pixels across the bars. If the barcode rotates 90° relative to
   the scan line, the scanner sees one solid stripe and nothing
   decodable. The aim frame is 4:1 (wide-to-tall) BY DESIGN — it's
   telling the user "put a horizontally-aligned barcode here." ZXing
   tries rotated decodes via `TRY_HARDER`, but it's slower and less
   reliable than just holding it right.

2. **Camera selection MUST be explicit.** Both web (`@zxing/browser`)
   and mobile (`expo-camera`) default to whichever camera the browser
   picks — on phones, that's usually the FRONT camera. Useless. Web:
   `decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } })`.
   Use `ideal` not `exact` so desktops without a rear camera still
   get their available camera.

3. **Format hints save real time.** Default `BrowserMultiFormatReader`
   tries QR, Data Matrix, Code 128, Aztec, PDF417, UPC, EAN on every
   video frame. For food packaging, only UPC-A, UPC-E, EAN-13, EAN-8
   matter. Limiting via `DecodeHintType.POSSIBLE_FORMATS` + setting
   `TRY_HARDER` is faster AND more reliable on busy packaging. Also
   request `1280x720` video resolution — phones default to lower res
   on the rear camera unless asked.

4. **iOS Safari does NOT support `screen.orientation.lock`.** Even
   in fullscreen mode, even as a PWA. Apple has refused this since
   forever. Android Chrome supports it via fullscreen +
   `screen.orientation.lock('portrait')`. Wrap the lock attempt in
   try/catch and accept silent failure — the scanner still works on
   iOS, just without orientation pinning. The visible "align
   horizontally" hint is the cross-platform fallback.

5. **OpenFoodFacts proxy fetches CAN hang.** OFF's API is slow and
   sometimes returns malformed JSON. Wrap the fetch in an
   `AbortController` with 8s timeout. On timeout, fall through to
   opening the Add panel with just the UPC pre-filled — manual
   data entry is better UX than an infinite spinner.

6. **`scanError` must render at page level, not inside the panel.**
   If the scan flow finishes without opening a panel (timeout, lookup
   error, etc.), an error rendered inside the panel has nowhere to
   show. Bit us when scans silently completed with nothing visible.

7. **UPC match is a SEED, not a final answer.** UPC lookups too often
   return mislinked/stale items, or the user is actually eating a
   different variant of the same product. Mobile scan flow:
   - Look up UPC → get the matched food's name + brand
   - `stripNameForGenericSearch(name, brand)` strips it down to a
     generic term (drops brand, sizes, pack counts, packaging words,
     parens) — `"Trader Joe's Almond Butter, Creamy, 16oz Jar"` →
     `"almond butter creamy"`
   - Run that as a normal FTS search, drop the user into the
     search-results view with the stripped query pre-populated
   - The originally-matched UPC item is NOT shown in results — the
     user picks the right variant from the generic search hits
   - Zero hits → "Not in our library" state
   Web admin uses a different flow (the goal there is to ADD missing
   foods to MYRX): UPC found → open edit panel; UPC not found → fetch
   OFF for a starter pre-fill → open add panel.

## Supabase
- Project ID: `xtxzfhoxyyrlxslgzvty`
- Site URL: `https://myrxfit.com`
- MCP server is connected — use `mcp__8dbdae5c-*` tools for DB operations

---

## Source Tree (key files)

### End-user shell & components
```
src/components/Navbar.jsx          — AppShell wrapper: sidebar, mobile nav,
                                     floating chat + suggestion buttons, drawers
src/components/ChatDrawer.jsx      — Slide-up chat panel (only when chat_enabled)
src/components/SuggestionDrawer.jsx — Slide-up suggestion panel (always available)
src/components/TickerNumber.jsx    — Animated number counter
src/contexts/AuthContext.jsx       — Supabase auth + profile
src/contexts/ThemeContext.jsx      — Light/dark toggle
```

### End-user pages
```
src/pages/Dashboard.jsx      — Profile card with animated stat pills, training streak,
                               monthly PRs, member-since badge
src/pages/Strength.jsx
src/pages/Cardio.jsx
src/pages/Bodyweight.jsx
src/pages/Calories.jsx
src/pages/History.jsx
src/pages/EditProfile.jsx    — Profile tab + Settings tab (units, body stats,
                               messaging Enter preference, appearance/theme)
src/pages/Auth.jsx
src/pages/Landing.jsx
```

### Admin shell & pages
```
src/pages/admin/AdminShell.jsx      — Sidebar nav with live unread-message badge
                                      + goals-reached badge on Weight Goal Progress.
                                      All sign-out buttons styled destructive red
                                      (text-destructive hover:bg-destructive/10).
src/pages/admin/AdminOverview.jsx   — Dashboard: stats tiles, needs-attention list
src/pages/admin/AdminDashboard.jsx  — Client roster: stat tiles (TickerNumber),
                                      filter tabs, sort dropdown, rich client rows
                                      with animate-ping status dots
src/pages/admin/AdminUserDetail.jsx — Per-client detail: tabs (Profile/Efforts/
                                      Bodyweight/Calories), snapshot badges,
                                      chat_enabled toggle button
src/pages/admin/AdminProgress.jsx   — Weight goal progress cards for all clients
src/pages/admin/AdminNutrition.jsx  — 7-day calorie compliance grid
src/pages/admin/AdminFeed.jsx       — Activity feed (last 2 months, filterable)
src/pages/admin/AdminMessages.jsx   — Two tabs: Messages (split-view chat) +
                                      Suggestions (flat feed of all client suggestions)
src/pages/admin/AdminProfile.jsx    — Admin's own profile/settings
src/pages/admin/AdminMovements.jsx  — Movement library CRUD. Add form hidden behind
                                      a dashed "+ Add movement" button (addOpen state).
                                      Clicking opens form with X to close + Cancel button.
                                      Auto-closes 2s after successful save.
                                      Edit: tap any row → full edit form replaces list view.
src/pages/admin/AdminFoodLibrary.jsx — Food library CRUD for admin-managed ('myrx') foods.
                                       Search bar works on name OR UPC with progressive
                                       UPC results (3+ digits trigger prefix search).
                                       Add / Edit / Delete via manual form (FoodForm).
                                       UPC is a text input on the form — entering one
                                       classifies the row as 'branded'; leaving it blank
                                       classifies it as 'generic' (universal data_type rule).
                                       NOTE: a previous iteration of this page had a Scan
                                       button that opened BarcodeScanner + auto-populated
                                       the form from OpenFoodFacts. That wiring has been
                                       removed from this file but the BarcodeScanner.jsx
                                       component and /api/off-search proxy still exist —
                                       Phase D of the food-rebuild plan re-attaches them.
                                       Until then, admin must type UPCs by hand.
src/pages/admin/tabs/              — AdminUserProfile, AdminUserActivity,
                                      AdminUserBody, AdminUserCalories
```

### Calorie / Food logging components
```
src/components/FoodLogDrawer.jsx   — Bottom-sheet food logger (max-h 92dvh).
                                     Three views: 'log' | 'search' | 'portion'.
                                     USDA search → portion picker → Supabase insert.
                                     Props: userId, day, onClose, onEntriesChange.
                                     CalorieStrip.jsx was deleted May 28 2026 as
                                     part of the web-orphan cleanup — athlete-web
                                     pages were removed earlier so the strip had
                                     no consumers left.
```

### Lib
```
src/lib/supabase.js         — Supabase client
src/lib/calorieFormulas.js  — calcFullPlan, toKg, etc.
src/lib/cache.js            — dataCache (simple in-memory cache for admin feed)
src/lib/foodLibrary.js      — Unified food search: fans out to Cloudflare Worker (USDA/D1)
                              AND Supabase food_library (custom 'myrx' foods).
                              searchFoods(query, limit), getFoodPortions(food),
                              calcMacros(per100g, grams).
                              UPC detection: 3+ digit-only queries trigger UPC mode —
                              partial prefix match (LIKE digits%) as user types,
                              exact match at 12+ digits.
                              Custom myrx results always appear first in merged results.
```

> Web-orphan cleanup batch (May 28 2026) deleted these formerly-mentioned web
> files. None are referenced by the live app anymore:
>   • pages/AboutMyRX, pages/admin/AdminSettings,
>     pages/admin/tabs/AdminUserPlan, pages/coach/Portal
>   • components/CalorieStrip, LoadingScreen, MessageActions, NumericInput,
>     PhantomWheel, PlanWizardSheet, Skeleton
>   • lib/usda, lib/opennutrition, lib/projections, lib/signupResume, lib/effortTags
> All replacements live elsewhere — MacroPlanEditor replaces AdminUserPlan,
> foodLibrary replaces usda+opennutrition, formulas replaces projections, the
> mobile copies of PhantomWheel + MessageActions + effortTags are the live
> versions (web copies were never wired up).

---

## Database Schema (key tables)

### `profiles`
Extends `auth.users`. Key columns:
- `id` (uuid, PK = auth user id)
- `full_name`, `email`, `phone`, `birthdate`, `gender`
- `avatar_url` (text)
- `weight_unit` ('lb'|'kg'), `height_unit` ('imperial'|'metric'), `distance_unit` ('mi'|'km')
- `current_weight`, `current_height`
- `is_superuser` (bool) — admin flag
- `chat_enabled` (bool, default false) — admin-controlled per client; gates chat UI
- `created_at`

### `efforts`
- `id`, `user_id`, `label`, `type` ('strength'|'cardio'), `value`, `created_at`

### `rom_records`
- `id`, `user_id`, `movement_key`, `degrees`, `created_at`

### `bodyweight`
- `id`, `user_id`, `weight`, `unit`, `created_at`

### `calorie_logs`
- `id`, `user_id`, `log_date` (date), `calories`
- Legacy table — kept for historical data. Admin "Manual Logs" tab still reads it.

### `food_logs`
Per-item food log entries (replaces calorie_logs for new intake tracking):
- `id` (uuid PK), `user_id` (uuid FK → auth.users)
- `log_date` (date), `meal_slot` (text: 'breakfast'|'lunch'|'dinner'|'snacks')
- `food_name` (text), `brand_name` (text nullable), `fdc_id` (int nullable — USDA FDC ID)
- `portion_label` (text — display label e.g. "150g", "1 cup")
- `portion_qty` (numeric — raw number the user typed), `portion_g` (numeric — gram equivalent)
- `calories`, `protein_g`, `fat_g`, `carbs_g` (numeric)
- `created_at` (timestamptz)
- Index on `(user_id, log_date)`. RLS: users own their rows.

### `calorie_plans`
- `user_id`, `starting_weight_kg`, `goal_weight_kg`, `goal_reached` (bool), + plan params

### `messages`
- `id` (uuid PK)
- `user_id` (uuid) — always the CLIENT's user id (never the admin's)
- `from_admin` (bool) — true = admin sent it, false = client sent it
- `body` (text)
- `is_suggestion` (bool, default false) — suggestion vs normal message
- `read` (bool, default false)
- `created_at`
- **RLS**: clients can see/insert own rows (`user_id = auth.uid()`). Superusers bypass RLS and see all.

### `food_library`
Admin-managed custom foods (source = 'myrx') plus synced USDA foods (source = 'usda'):
- `id` (uuid PK), `source` ('myrx'|'usda'), `source_id` (text — USDA FDC ID or custom)
- `name`, `brand` (text nullable)
- `kcal`, `protein_g`, `fat_g`, `carbs_g` (numeric, per 100g)
- `serving_g` (numeric — default portion grams), `serving_label` (text — e.g. "1 cup")
- `servings_per_container` (numeric nullable)
- `upc` (text nullable) — barcode; indexed for fast lookup
- RLS: admins (is_superuser) can insert/update/delete. All authenticated users can SELECT.

### RPC functions
- `get_users_for_admin()` — returns all client profiles (id, full_name, email, avatar_url, weight_unit, current_weight, created_at, is_superuser, etc.)
- `get_user_for_admin(p_user_id uuid)` — single client profile
- `upsert_profile(...)` — upsert own profile
- `get_coach_info()` — SECURITY DEFINER; returns `{ full_name, avatar_url, last_seen_at, share_online_status }` of the **caller's linked coach** (via `profiles.coach_id`). Falls back to the superuser's profile when the caller has no linked coach (legacy admin↔client chat model — keeps old chats working). Returns NULL when neither exists. Used by ChatDrawer / ChatSheet / mobile dashboard's "Coached by [name]" badge. **v2 locked May 26 2026** — pre-v2 always returned the superuser regardless of coach_id, which broke once the coach platform shipped. When changing return shape, must `DROP FUNCTION` first.

---

## Design Patterns

### Theming
- Dark mode default (`:root`), light mode = `.light` on `<html>`
- Use Tailwind design tokens: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`
- Never hardcode dark colors

### Status dots (AdminDashboard)
`animate-ping` expanding-ring pattern (NOT `animate-pulse`):
```jsx
<span className="relative flex h-3 w-3">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
    style={{ backgroundColor: color, animationDuration: '1s' }} />
  <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-card"
    style={{ backgroundColor: color }} />
</span>
```
- 🟢 Green (active ≤7d): `animationDuration: '1s'`
- 🟡 Amber (semi-active): `animationDuration: '2s'`
- 🔴 Red (inactive): `animationDuration: '0.75s'`
- ⚫ Grey (new account, no activity yet): static dot, no animation

### Account-age-aware inactivity logic
```js
function computeStatus(lastActive, accountAgeDays) {
  if (lastActive) {
    const daysSince = (Date.now() - new Date(lastActive)) / 86_400_000
    if (daysSince <= 7) return 'green'
    if (accountAgeDays < 7) return 'new'
    return daysSince <= Math.min(14, accountAgeDays) ? 'amber' : 'red'
  }
  return accountAgeDays < 7 ? 'new' : 'red'
}
```
New accounts (<7 days) are never flagged as inactive in AdminOverview needs-attention either.

### Animated number tiles
Use `<TickerNumber value={n} />` for any count/stat display that should animate on mount.

---

## Chat & Suggestions System

### Architecture
- **`chat_enabled`** on `profiles` is the master gate. Admin toggles it per client from `AdminUserDetail`. Default: `false`.
- When `false`: client sees only the Suggestion button (amber, always visible).
- When `true`: client sees both Suggestion button (amber) and Chat button (blue).

### End-user UI (Navbar.jsx)
- **Suggestion button**: amber circle, always shown, opens `SuggestionDrawer`
- **Chat button**: blue circle, only when `chat_enabled`, opens `ChatDrawer`, shows unread badge
- Both drawers slide up from the bottom

### SuggestionDrawer
- Shows the client's OWN past suggestions (private — other clients can't see each other's)
- Entry field at bottom; Enter-to-send preference respected
- Messages inserted with `is_suggestion: true`

### ChatDrawer
- Non-suggestion messages only (`is_suggestion: false`)
- Header: coach avatar (if uploaded) + "Coach [FirstName]" label
  - Avatar + name fetched via `get_coach_info()` RPC (SECURITY DEFINER — bypasses RLS)
  - Fallback: MessageCircle icon if no avatar set
  - **Do NOT add photos to individual message bubbles** — avatar only in header
- Admin messages marked read on open
- Realtime subscription via Supabase channel

### Admin UI (AdminMessages.jsx)
- **Messages tab**: split-view (client list left, conversation right). Marks client messages read optimistically on select. Realtime via Supabase channel.
- **Suggestions tab**: flat feed of ALL client suggestions across all clients (admin can see all).
- Badge counts on each tab (unread messages, unread suggestions).
- AdminShell sidebar: Messages nav item shows unread count badge. Weight Goal Progress nav item shows green badge = count of clients with `goal_reached = true`.

### Enter-to-send preference
- LocalStorage key: `myrx_enter_to_send` (`'false'` = Enter for new line; anything else / missing = Enter sends)
- Toggled in `EditProfile` Settings tab → "Messaging" section
- Respected in ChatDrawer, SuggestionDrawer, and AdminMessages reply box

---

## Admin Portal Overview

### Access
Admins (`is_superuser = true`) see an "Admin Portal" button in the client nav, or are routed directly to `/admin/*`.

### AdminDashboard (`/admin/clients`)
- 6 stat tiles with TickerNumber: Total Clients, Active This Week, Needs Attention, PRs This Week, On a Streak, Nutrition On Track
- Filter tabs: All / Needs Attention / On Fire / No Plan
- Sort: Last active, Streak, Goal progress, Name A–Z
- Rich client rows: avatar, name, email, status dot (animate-ping), flag pills, stats strip, mini goal progress bar

### AdminOverview (`/admin/overview`)
- Quick stats
- Needs-attention list (account-age-aware — new accounts not flagged)
- Avatar photos displayed throughout

### AdminUserDetail (`/admin/user/:id`)
- Tabs: Profile | Efforts | Bodyweight | Calories
- Profile card: avatar, name, email, age/gender/weight/height, snapshot badges (training streak, monthly PRs, strength/cardio/mobility PRs, nutrition streak, weigh-ins)
- **Chat toggle button** in top-right of profile card: "Chat off" / "Chat on" — updates `profiles.chat_enabled`

---

## LocalStorage Keys
| Key | Purpose |
|-----|---------|
| `myrx_enter_to_send` | `'false'` = Enter for new line; default = Enter sends |
| `admin-user-tab-{id}` | Last active tab per user in AdminUserDetail |

---

## Known Patterns / Gotchas
- **Supabase RPC return type changes** require `DROP FUNCTION` first then `CREATE OR REPLACE` — can't just alter the return type.
- **Realtime channels**: always `supabase.removeChannel(channel)` in cleanup. Use specific event types (`INSERT`, `UPDATE`) rather than `'*'` for reliability.
- **Calorie logs** use `log_date` (date-only). When converting to timestamps use `T00:00:00.000Z` suffix so they're always in the past.
- **Supabase MCP tool** (`mcp__8dbdae5c-*`) is available — prefer it for migrations over raw SQL in bash.
- **AdminFeed** uses `dataCache` to avoid re-fetching on every visit.
- **Avatar**: if `avatar_url` is set, show `<img>` instead of initials — applies to ALL admin list views (clients, progress, nutrition, feed, messages, UserDetail).
- **Food logging vs calorie_logs**: `food_logs` is the live system. `calorie_logs` is legacy — don't delete it, admin "Manual Logs" tab still reads it. The mobile CalorieStrip component reads `food_logs` and sums calories in JS. (The web copy of CalorieStrip was deleted May 28 2026 with the orphan cleanup — athlete-web pages are gone.)
- **USDA / food search**: use `foodLibrary.js` (`searchFoods`, `getFoodPortions`, `calcMacros`) for all food search work. It merges custom myrx foods (Supabase) + USDA (Cloudflare Worker D1). The legacy `usda.js` + `opennutrition.js` wrappers were deleted May 28 2026 — they had zero remaining consumers.
- **UPC progressive search**: queries of 3+ digits trigger UPC mode in both `foodLibrary.js` (Supabase ilike prefix) and the Cloudflare Worker (SQL `LIKE digits%`). 12+ digits = exact match. This means results narrow as the user types — no need to scan a complete barcode.
- **RLS bypass for cross-row reads**: end users can't read admin profile rows. Use `SECURITY DEFINER` RPC functions for any data that clients need from the admin's profile (e.g. `get_coach_info()`). Always `SET search_path = public` on SECURITY DEFINER functions.
- **Coach avatar in ChatDrawer**: only in the drawer header, NOT on individual message bubbles. User explicitly rejected per-message photos.
- **Cloudflare Worker** (`workers/food-search/`): handles `/search` endpoint for USDA D1 food search. UPC detection added — partial prefix LIKE for 3-11 digits, exact for 12+. Deploy with `npx wrangler deploy` from `workers/food-search/`.
- **Admin Movement Library add form**: hidden behind a dashed button (`addOpen` state). Never render the form inline without user clicking "+ Add movement" first.
- **Food library architecture (post-2026-05-14 rebuild + second-pass cleanup)**: two-tier data flow. **Initial seed** = one-shot bulk import from locally-downloaded source files via `scripts/bulk_import/run.mjs` (pulls every USDA data type — branded, foundation, sr_legacy, survey_fndds, experimental, plus the rarer ones — and all of OpenNutrition). **The bulk import now applies the full filter pipeline at INSERT time** (Tier 1-4 of `scripts/d1_migrate/lib/filters.mjs`: Rules 1-14) plus a post-import dedup pass (Tier 5: Rules 15-19). **Ongoing sync** = incremental refresh via the orchestrator `scripts/sync/run.mjs` (pulls source ZIPs from the R2 mirror, parses, diffs against live D1, writes). Triggered by the admin food-library Sync button (→ `POST /admin/sync` in `workers/food-search/src/sync-admin.js` → GitHub `workflow_dispatch` on `sync-food-library.yml` → `node scripts/sync/run.mjs`) AND a monthly cron (`0 3 1 * *`). **✅ The production sync applies the FULL 19-rule pipeline** — it reuses the SAME loaders as the bulk import (`loadUsda` / `loadOn` → `enrichFood` + `shouldKeepFood`, Rules 1-14) and the SAME `applyDedup` (`scripts/bulk_import/lib/dedup_in_memory.mjs`, Rules 15-19), so a sync produces a byte-identical filtered/deduped result to a full rebuild (only difference: diff-based insert/update/delete instead of wipe-and-rebuild). Verified by audit 2026-06-04 (ledger T048). The legacy `scripts/d1_migrate/sync_usda.mjs` + `sync_on.mjs` are **dead / superseded** by the orchestrator (no workflow or `package.json` references them) — and even they have since been migrated to `enrichFood` + `getFilterReason`, so the old "`shouldSkip` from `normalize.mjs`" claim is obsolete (`shouldSkip` still exists in `normalize.mjs` but has no caller in any sync path).
- **`food_library` schema (current)**: 19 columns. Identification: `source` (usda/on/myrx), `source_id` (unique within source), `source_subtype` (literal source category — e.g. 'branded_food', 'foundation_food', 'on_branded', 'on_recipe', 'admin_custom'). Classification: `data_type` (universal — 'branded'/'generic'/'recipe'/'restaurant'/'aggregated'). Nutrition: kcal/protein_g/fat_g/carbs_g/fiber_g/sodium_mg/serving_g/serving_label/servings_per_container/upc/brand/name. Audit: `imported_at`, `last_synced_at`, `source_version` (e.g. 'FoodData_Central_csv_2026-04-30', '2025.1'). `food_category` (USDA's text category) was dropped during the post-audit cleanup. Schema lives in `workers/food-search/schema.sql`; migrations in `workers/food-search/migrations/` (0004 added data_type, 0005 brand-aware classifier fix, 0006 audit columns).
- **`data_type` rule** (`scripts/d1_migrate/lib/normalize.mjs::dataTypeFromUpc(upc, brand)`): branded if EITHER upc OR brand is present; generic only when both are missing. The bulk import uses USDA's own `data_type` column to assign (branded_food → 'branded', everything else → derived per-type), but the Worker myrx-create path and incremental sync paths use the UPC/brand rule as single source of truth.
- **`shouldSkip` UPC rule** (`scripts/d1_migrate/lib/normalize.mjs`): rejects rows without a UPC ONLY when `dataType === 'branded'`. Generics legitimately have no UPC and must pass through. If you copy this filter to a new sync path, copy the `dataType` parameter too — otherwise you'll silently re-introduce the original lettuce-disappears bug.
- **Audit-then-filter workflow (status as of 2026-06-04)**: the audit phase is **COMPLETE** and the filters apply at BOTH bulk-import time AND sync time. The 19 approved rules live in `scripts/d1_migrate/lib/filters.mjs` (Tier 1-4, Rules 1-14) and `scripts/bulk_import/lib/dedup_in_memory.mjs` (Tier 5, Rules 15-19; `scripts/bulk_import/post_import_dedup.mjs` is the SQL equivalent, used only by the manual `clean_rebuild.mjs`). Rule numbers reflect execution order, not chronological invention. **There is no remaining sync-time gap** — the production sync orchestrator (`scripts/sync/run.mjs`) reuses the bulk-import loaders + `applyDedup`, so all 19 rules run on every sync (verified 2026-06-04, ledger T048).
- **Filter rules — rejected proposals (DO NOT re-suggest these — already considered and rejected 2026-05-14):**
  - **Reject single-word generic names** (`name NOT LIKE '% %' AND brand IS NULL`) — these are legitimate international cuisine names: Sosaties, Tequeños, Yakisoba, Kombu, Escargot, Cassava, Hazelnuts, Mansaf, etc. Real high-value reference data. Keep.
  - **Reject the `on_generic` cohort (8,922 rows)** — sample showed quality reference data: Jollof Rice with Beef, Bebek Betutu, Bibimbap, Pacific Mackerel, Curly Fries, etc. This is the recipe/homestyle backbone of OpenNutrition. Keep.
  - **Reject `(0% moisture)` USDA Foundation Food rows (17 rows)** — real Foundation Food science data (dried-bean nutrition under USDA's 0%-moisture analysis). Tiny count, real data. Keep.
  - **Reject all-caps generic names** (8+ consecutive uppercase letters, brand IS NULL) — these are legitimate SR Legacy entries where USDA stored the brand IN THE NAME in all-caps (`Candies, TWIZZLERS CHERRY BITES`, `Snacks, KRAFT, CORNNUTS`). Rule 3 title-case normalises them. Keep.
  - **Reject branded rows with `serving_g IS NULL` (147,711 rows)** — macro data is still correct; users can log by grams. Lacking a portion is a search-UX problem, better solved by demoting in ranking than deletion. Keep.
  - **Reject "kcal differs across cross-source UPCs" (~24K UPCs)** — real data conflicts, not duplicates. Picking the wrong source would propagate wrong nutrition values. Keep both pending manual review.

---

## What's Been Built (complete feature list)

### Core tracking
- [x] Strength logging (sets × reps × weight, 1RM estimates)
- [x] Cardio logging (distance, time, pace)
- [x] ~~Mobility / ROM tracking with ROMVisualizer~~ — REMOVED June 2026 (legacy; rom_records table retained, no UI)
- [x] Bodyweight tracking with charts
- [x] Calorie logging with daily targets
- [x] **Food logging** — USDA FoodData Central search, per-item entries in `food_logs`,
      FoodLogDrawer bottom-sheet (search → portion picker → log), TodayIntakeCard with
      segmented horizontal macro bar, CalorieStrip now sums from `food_logs`
- [x] Admin "Food Log" sub-tab on client Calories tab (grouped by date + meal slot)
- [x] Full history page

### Profile & Settings
- [x] Avatar upload / remove
- [x] Unit preferences (weight lb/kg, height ft/cm, distance mi/km) with auto-conversion
- [x] Body stats (auto-creates bodyweight log entry on weight change)
- [x] Light / dark mode toggle
- [x] Enter-to-send preference (Messaging section in Settings)
- [x] Email change flow

### Dashboard
- [x] Profile card with animated pill badges: training streak (blue), monthly PRs (amber), member-since (neutral)
- [x] TickerNumber animations on all stats

### Admin portal (complete)
- [x] AdminOverview — stats + needs-attention (account-age-aware)
- [x] AdminDashboard — full coaching roster with tiles, filters, sort, status dots
- [x] AdminProgress — weight goal progress bars per client
- [x] AdminNutrition — 7-day calorie compliance grid
- [x] AdminFeed — filterable activity feed (last 2 months)
- [x] AdminUserDetail — full client view with snapshot badges + chat toggle
- [x] AdminMessages — Messages tab (split-view) + Suggestions tab (flat feed)
- [x] Admin sidebar unread badge (messages) + goals-reached badge (progress)
- [x] AdminMovements — movement library with add-behind-button UX, swipe-delete, edit
- [x] AdminFoodLibrary — food library with name+UPC search, barcode scan, detail panel,
      progressive UPC results, scan result cards, CRUD for myrx foods

### Chat & suggestions
- [x] `messages` table with RLS
- [x] `chat_enabled` column on profiles
- [x] Suggestion button (amber, always visible)
- [x] Chat button (blue, gated by chat_enabled)
- [x] ChatDrawer with Coach [FirstName] header + coach avatar (header only, not on bubbles), realtime
- [x] `get_coach_info()` RPC (SECURITY DEFINER) — returns coach full_name + avatar_url to end users
- [x] SuggestionDrawer with own-suggestions feed, realtime
- [x] Admin chat_enabled toggle in AdminUserDetail
- [x] AdminMessages two-tab layout with badge counts, realtime
- [x] All admin sign-out buttons styled destructive red

### Infrastructure
- [x] Migrated Netlify → Cloudflare Pages (deploy via `wrangler pages deploy`, NOT git push)
- [x] Supabase MCP connected
- [x] get_users_for_admin RPC returns avatar_url
- [x] `food_logs` table + RLS + index (migration: `supabase/migrations/20260501_food_logs.sql`)

---

## Hydration mascot — Rive plant ("Aquos") — IN PROGRESS / BLOCKED (June 1 2026)

A Tamagotchi-style **gamification mascot** for the Hydration page: a potted plant floating in water whose **leaves open their eyes one at a time as the user logs water**, culminating in the water animating at ~100% of the daily goal. Explicitly a *gamification helper*, NOT turning the app into a game. The user's lock: **"2 clicks per progression"** to open one leaf — and clicks-per-leaf + the hydration→leaves mapping must live **in app code, NOT baked into the rig** (so it stays tunable). Tech: **Rive** via `rive-react-native@9.8.3`.

**STATUS: blocked on visual verification.** The edited rig is built, exported, bundled, and the app rebuilt (BUILD SUCCESSFUL), but per-leaf control has NOT been confirmed to visually open leaves. User reports "nothing is working." See "Current blocker" below.

### The file + license
- Source: Rive Community **"Wavy Plant - Bone Rig / Interactive Hover" by BradleyConners**, license **CC BY** → **MUST credit BradleyConners** in an in-app credits/licenses screen before shipping.
- Marketplace: `https://rive.app/marketplace/21837-40979-wavy-plant-bone-rig-interactive-hover/`
- Original free download: `MyRX/21837-40979-wavy-plant-bone-rig-interactive-hover.riv` (289720 bytes).
- **EDITED export (has per-leaf control):** `MyRX/new wavy_plant_-_bone_rig___interactive_hover.riv` (290172 bytes).
- Bundled into app (both = the EDITED export): `mobile/android/app/src/main/res/raw/wavy_plant.riv` + `mobile/assets/wavy_plant.riv`.

### Rig structure (introspected — 10 artboards)
- Artboard **"plant"** (#1) = the one we render. SM `"State Machine 1"`. Original input: ONE boolean **"leaf on"** → opens ALL 5 eyes at once (verified: all 5 glow open within ~0.3 s, simultaneous — no free per-leaf scrub). Hierarchy: `leafs off / leafs on / stick / controls (→ track 1..5, each holds a nested "leaf" artboard)`.
- Artboard **"leaf"** (#8) = a single leaf. SM `"State Machine 1"`, input **"active"** (boolean) → `eye on`/`eye off` + scale/color anims.
- Others: `plant - remap` (#0, input "water on"), `plant - base` (#7, "water on"), field-stars/bubbles, fx-leaf-light, fx-bubbles, tent-basic/comp.
- **PROVEN (3 ways) the ORIGINAL "plant" artboard exposes NO per-leaf control** — only "leaf on" (all). `setInputStateAtPath('active', true, 'leaf 1')` resolves the nested artboard but throws `No StateMachineInput found` (FATAL — async throw inside Rive's `advance()`, past JS try/catch, crashes the app). A 55-combo `inputByPath(name, path)` probe resolved zero leaf inputs. So per-leaf REQUIRES a rig edit.

### The edit (done in Rive editor — lives in the exported file)
- Remixed to the user's Rive account: **workspace `TazDS86`, account id 1500321, file id 2328827** → editor URL `editor.rive.app/file/.../2328827`.
- Used Rive's **in-editor "Build" Agent** (the AI agent in the editor) to add a **View Model `PlantControl`** with 5 boolean properties **`leaf1..leaf5`**, each (per the Agent) data-bound to track N's leaf `active` input. "leaf on" preserved. The Agent also created a `LeafControlScript` — **a STUB / demo-comment file, IGNORE it** (not the binding mechanism).
- **VERIFIED** via WASM introspection of the exported `.riv`: `viewModelCount()=1`, VM `PlantControl` with `leaf1..leaf5` (all boolean). Properties are real + exported.
- **UNVERIFIED (the crux):** whether each `leafN` property is actually *bound* to a leaf's `active` input — i.e. whether flipping it visually opens that leaf. The Agent's stub script hints the binding step may have been left undone.

### Rive paid plan
Free tier can edit/remix but NOT export `.riv`. User upgraded to **CADET ($9/mo)** (has ".riv export"; banner: "Free to create, $9 to ship"). Can downgrade after — the `.riv` is bundled and runs offline forever; re-subscribe only to edit the rig again. Workspace billing: `rive.app/account/1500321`.

### Runtime API (rive-react-native 9.8.3 — CONFIRMED in node_modules `.d.ts`)
```ts
import Rive, { Fit, Alignment, useRive, useRiveBoolean, AutoBind, BindByName } from 'rive-react-native'
const [setRef, riveRef] = useRive()
// <Rive ref={setRef} resourceName="wavy_plant" artboardName="plant"
//       stateMachineName="State Machine 1" dataBinding={AutoBind(true)} autoplay ... />
const [, setLeaf1] = useRiveBoolean(riveRef, 'leaf1')   // setLeaf1(true) should open leaf 1
```
- Data-bind helpers (from package root): `AutoBind(bool)`, `BindByName(name)`, `BindByIndex(n)`, `BindEmpty()`, plus `useRiveBoolean/Number/String/Color/Enum/Trigger`.
- Classic SM API also present on the ref: `setInputState(sm, input, value)`, `setInputStateAtPath`, `fireState`. So `riveRef.setInputState('State Machine 1','leaf on',true)` opens all leaves (works — proven).

### Metro shim (CRITICAL — do NOT remove)
`mobile/metro.config.js` redirects bare `rive-react-native` → `node_modules/rive-react-native/lib/commonjs/index.js`. The package's `react-native`/`source` field points at `src/index.tsx`, which Expo SDK 54's Metro can't resolve → it 500s the whole bundle. The resolver shim fixes it.

### Android build
`rive-react-native` forced **compileSdk 36** (androidx.core 1.17 requires it). Set in: `mobile/android/gradle.properties` (`android.compileSdkVersion=36`, `android.buildToolsVersion=36.0.0`), `mobile/app.json` (expo-build-properties `compileSdkVersion: 36`), `mobile/plugins/withForceCompileSdk.js` (marker `// MyRX: force compileSdk 36 on third-party libs`). **A `res/raw/*.riv` change requires `npx expo run:android` (~2 min)** — JS hot-reload does NOT pick up native resources. Always use `npx expo run:android` (NOT raw `gradlew`) so the arm64-only ABI filter applies.

### Spike screens + assets (THROWAWAY — delete once the real integration lands)
- `mobile/app/plant-spike.tsx` — current data-binding test (`AutoBind` + `useRiveBoolean leaf1..5`; buttons Open-next-leaf / Reset / All-leaves-on). Reach via `myrx://plant-spike`.
- `mobile/app/rive-spike.tsx` — old avatar comparison spike (`resourceName="avatar"` → `res/raw/avatar.riv`).
- `mobile/app/skia-spike.tsx` — Skia comparison spike (`assets/aquos-hero.png`).
- `mobile/app/(app)/hydration.tsx` — has a TEMP dashed **"AQUOS ANIMATION — COMPARE"** card linking to `/rive-spike` + `/skia-spike` (remove it).
- Throwaway assets: `res/raw/avatar.riv`, `mobile/assets/aquos-hero.png`, `MyRX/Aquos/` (hand-drawn creature images, abandoned — user said "any mascot will do").

### Introspection tooling
`C:/Users/motaz/riv-introspect/` — Node scripts using `@rive-app/canvas-advanced-single` with headless DOM shims. **The richer `Image` shim that fires `onload` via `queueMicrotask` is REQUIRED** or `rive.load()` hangs forever on the plant's embedded image mesh (a minimal Image stub never resolves). Node 22's `navigator` is read-only — do NOT shim it. Scripts: `introspect.mjs` (artboards + SM inputs), `nesting.mjs` (probe artboard prototype methods), `probe.mjs` (`inputByPath(name,path)` grid), `vmcheck.mjs` (view models + properties). Run `node <script>.mjs [path-to-riv]` — inspects any `.riv` offline without rendering.

### CURRENT STATUS — binding CONFIRMED broken; Build Agent is a DEAD END (June 1 2026, session 2)

**The binding is broken — PROVEN in the editor.** Opened file 2328827, Animate mode → played State Machine 1 (eyes start closed), opened the Data panel (the `PlantControl` instance), set `leaf1`–`leaf5` ALL true, zoomed to fit: **zero eyes opened.** The Build Agent only declared the VM + 5 boolean properties + a no-op stub; it NEVER wired `leafN` → each leaf's `active`. ("leaf on" still opens all 5; the per-leaf VM does nothing.)

**The in-editor Build Agent CANNOT fix this — confirmed, do NOT keep trying it.** Across two sessions it produced ONLY empty stub scripts (`LeafControlScript`, then `AddLeaf1Input` — both just comments + `return function(){ return {} }`). When pushed for a single SM boolean it stated outright: *"that's a manual process in Rive's GUI since the API limitations prevent programmatic state machine input additions"* and that the VM *"requires manual setup in the editor (adding a listener to the nested state machine)… which is why they weren't working."* **Takeaway: the Build Agent can write scripts but CANNOT add state-machine inputs OR create data-bind edges. Both real fix-paths are manual GUI surgery.** Don't burn another Agent run on this.

**Two manual-GUI fix paths remain (Agent can't do either):**
1. **Data-bind edges** (easier manual build): bind each nested leaf instance's `active` input to `PlantControl.leafN`. VM + properties already exist, so it's ~5 edges, no new states/timelines. RUNTIME RISK: rive-react-native nested-artboard data-binding is the fragile path (see failure modes below) — verify on-device before trusting it.
2. **State-machine inputs** (harder manual build, runtime-PROVEN): add 5 boolean SM inputs (or a Number `growth` 0–5) on State Machine 1 + states/transitions/timelines that open leaves cumulatively, mirroring how "leaf on" already opens all 5. Drives via `setInputState(...)` — the SAME API already proven to work for "leaf on" at runtime. Much more GUI work to build.

**Runtime failure modes to watch (data-bind route):**
- `AutoBind(true)` auto-binds the artboard's DEFAULT VM instance (Inspector: `Model=PlantControl, Instance=Instance`). If it doesn't bind, try `dataBinding={BindByName('PlantControl')}`.
- `useRiveBoolean('leaf1')` path may be wrong/nested → setter silently no-ops.
- Nested leaf SMs must be running for `active` to take effect. NOTE: "leaf on" proves the nested actives DO animate at runtime when driven through the parent SM — which is why the SM-input path is the safer runtime bet.

**Rig structure (mapped this session — exact paths for the manual fix):**
- Artboard `plant` → `controls` (group) → `track 1`..`track 5` (bones, follow-path constrained) → each `track N` → `leaf N` (a GROUP) → `leaf` (the NESTED ARTBOARD instance: `Source: leaf`, `Mode: Node`, `Model: Inherit`). The nested `leaf` instance plays its own `State Machine 1` + `leaf loop`; its eye open/close is controlled by the leaf artboard's own boolean input `active`.
- Parent `plant` State Machine 1 = `Entry` / `Any State` / `Exit` / `event-off` / `event-on`, driven by the boolean input `leaf on` (opens/closes ALL five at once — the `leafs on`/`leafs off` timelines key every nested `active`).
- The nested `active` input is NOT shown as a directly-bindable/keyable row when you select the `leaf` instance (only `Model: Inherit` + a data-bind diamond + the Animations list appear). That's why neither manual path has an obvious one-click gesture — controlling a nested artboard input is the advanced "components / nested view models" workflow (set the nested instance's Data Bind → Model, then connect its input to a parent VM property).

**KEY UNBLOCK — data-bind DOES work at runtime in rive-react-native (workaround for issue #348):** open issue rive-app/rive-react-native#348 ("data binding doesn't trigger the state machine until you press the artboard") has a CONFIRMED workaround: **call `riveRef.play()` immediately after each `useRiveBoolean` setter** — that fires the SM evaluation with no user press. So the data-bind path IS viable end-to-end. Combined with the VM + `leaf1..leaf5` already existing AND the plant-spike app code already written, that makes **data-bind the recommended path**. Remaining work: (a) create the 5 binding edges in the editor [intricate — nested-instance Data Bind Model + connect each input to `leafN`], verify each in the editor PREVIEW (toggle `leaf1` → leaf opens); (b) add `riveRef.play()` after the setters in `plant-spike.tsx`/`hydration.tsx`; (c) re-export → rebuild → verify on-device. The SM-input path stays the fallback if the editor binding proves un-doable.

**Cleanup debt in the rig:** the Agent left TWO junk stub code files (`LeafControlScript`, `AddLeaf1Input`) and a partially-set-up `PlantControl` VM. Delete the junk scripts before final export (keep the VM — the data-bind path uses it).

**Once per-leaf works:** wire into `mobile/app/(app)/hydration.tsx` — count taps/hydration, **2 clicks (tunable const) = +1 leaf**, map daily-water-% → open-leaf-count (0–5), fire the water animation near 100%. Then DELETE all spike screens + the hydration dashed card + throwaway assets, and add the **BradleyConners (CC BY)** credit.

### Dev-env reminders (full details in the mobile dev section)
Wireless adb: `adb connect 10.0.0.116:5555` (phone endpoint — sticky until reboot). Laptop LAN IP was **10.0.0.187** (re-derive each session via `Get-NetIPAddress`; DHCP can change it). Dev-client scheme `exp+myrx-mobile`; app scheme `myrx`. Deep-link to LAN Metro: `exp+myrx-mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.187%3A8081` (NEVER `localhost` over wifi). Device screencap = 1080×2340; **the Read tool can hit a per-session "many-image / 2000px" cap mid-session — once capped, downscaling does NOT help; rely on the user's eyes or a fresh session for visual verification.**
