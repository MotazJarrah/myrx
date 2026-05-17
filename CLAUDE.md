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
- Begin the task immediately. Do NOT ask about the next task while one is in progress.
- **Web changes deploy via `wrangler`, never via `git push`.** Read the Deployment section below before running ANY git push. There is no GitHub→Cloudflare auto-deploy on this project — pushing produces zero deployment. This trap has cost real time; do not fall into it.
- **MIRROR EVERY CHANGE ACROSS WEB AND MOBILE.** Bug fixes, design tweaks, UX changes, copy edits, font/color/spacing adjustments, new features, removed bandaids — anything that exists on both surfaces gets edited on both surfaces in the SAME turn. The full rule with examples lives in **Cross-platform consistency rule (MANDATORY)** further down — read that section before making your first non-trivial edit. Most "but mobile doesn't match web" complaints come from one-sided edits; the cross-check is non-negotiable.
- **NUMBERED PLANS (MANDATORY).** Whenever the user asks for a plan, or whenever the assistant proposes any multi-item set of changes (revert plans, feature work, refactors, batched fixes, decisions to confirm, etc.) — every item MUST be presented as a numbered list (1, 2, 3...). The user uses these numbers to approve or reject items individually ("go on 1, 3, 5; skip 2, 4"). Never use bullets, sub-headings, or prose paragraphs for items that need an approve/reject decision. Sub-items get nested numbering (1a, 1b, 1c). Open questions are numbered too. This makes the user's review fast and surgical instead of forcing them to re-read full paragraphs.
- **PLAIN-ENGLISH PLANS (MANDATORY).** When the user asks for a plan or a breakdown, write it in plain language they can read without being a coder. No code snippets, no file paths in the middle of sentences, no formulas, no library names dropped without explanation, no acronyms without a parenthetical. Describe the visible behaviour or end-user outcome, then explain the change in product-manager terms. Save the code/formula/file-path talk for the actual implementation turn. This is a separate rule from the numbered-plan rule — both apply at once.
- **ONE QUESTION AT A TIME ON COMPLEX REBUILDS (MANDATORY).** For larger design rebuilds where many elements need discussion (multiple visual tweaks, multiple behavioural changes, multiple copy edits, etc.) — when the user says "break it down" / "walk me through it" / asks for the breakdown of a complex change — present ONE numbered question at a time, not the whole list. For each question include: (a) the issue or decision point in plain language, (b) one or two proposals, (c) the assistant's recommendation and why. WAIT for the user's answer before moving to the next question. Do not batch four questions at once and expect the user to answer all of them in one message. The whole-plan-up-front presentation is fine when the user explicitly asks for "the plan" or "all of it"; the one-at-a-time mode is for the explicit break-it-down requests. **The trigger phrase "break it down" ALWAYS refers to the active plan / proposal on the table, even if the same message mentions reading or doing something else first (e.g. "read X, break it down" still means "after reading X, break down the active plan one item at a time" — NOT "summarise the contents of X"). When in doubt about what "it" refers to, default to the active plan; if there's no active plan, ask the user "break down what specifically?" rather than guessing.**
- **CLAUDE.md MISMATCH AUTO-SYNC (MANDATORY).** This file goes stale fast — the user has been burned by the assistant operating on outdated information about what's in the codebase. Whenever the assistant scans a file, runs a check, or reads a value in the system AND finds that the actual state disagrees with what CLAUDE.md currently states (a value's wrong, a default's changed, a path moved, a behaviour's been edited since the doc was written, etc.) — the assistant MUST update CLAUDE.md immediately to reflect the actual state. Timing: BEFORE making any further change if the assistant is about to act on the mismatched info, or AFTER landing the change if the scan was triggered by the change itself. Never leave CLAUDE.md describing a state that doesn't match the codebase. If multiple mismatches are found in one turn, surface them all in the same edit. The doc is the contract between assistant turns — it has to stay accurate or the next turn starts wrong.

### Training vocabulary (locked terms — use these names in all UI copy and discussion)

The training-system feature uses three short terms agreed with the user. Always use these exact terms going forward — don't invent synonyms in code, copy, or discussion.

- **adp zone** (adaptation zone) — which adaptation a tile/exercise targets. Three values: **strength** (1-5 reps), **hypertrophy** (6-12 reps), **endurance** (13+ reps). Tile rep count maps to an adp zone via these boundaries.
- **rep range** (repetition range) — the specific rep count prescribed for a working set. For tile interactions, the rep range equals the tile's K value (e.g., tapping 6RM → rep range = 6).
- **eff curve** (effort curve) — the rep-max projection formula used by the system. Currently Epley/Brzycki/Lombardi averaged. Translates 1RM → projected weight at any rep count, OR a logged (weight × reps) → projected 1RM. The eff curve is what produces tile values on the rep-max grid.

These three terms work together: the **eff curve** computes weights for any **rep range**, and the **rep range** determines which **adp zone** the prescription falls in. UI copy can use friendlier phrasing where it improves clarity (e.g., "Build Strength" as a header is fine), but internal naming, comments, and analysis discussion must use the three locked terms.

### Weighted Standard next-target card — locked design spec

This is the spec for the "Your next training target" card that appears on `StrengthDetail.jsx` (web) and `[exercise].tsx` (mobile) for **weighted standard** movements: barbell, dumbbell, kettlebell, machine, strongman. Bodyweight, isometric, assisted, carry, band/knee variants each have their own detail view and are NOT covered by this spec.

**Big weight algorithm (the number at the top of the card):**

1. `current_1RM` = the user's highest 1RM estimate ever computed from any logged effort. Uses `bestOneRM` (max across all logged efforts). Never goes down — a bad day doesn't downgrade projections.
2. For each tile K (1RM through 20RM):
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
- Equipment-specific footer line (e.g., `45 lb bar + 130 lb per side`, `Pick the 35 lb kettlebell`, `Set the pin to 60 lb`, `Use the X lb stone, sandbag, or D-ball (or closest available)`, `Pick a pair of X lb kettlebells` when `uses_pair = true`).
- Thin separator (blue/15).
- **Single coaching cue** below the separator (no "this or that"):
  - Non-1RM tile: `Push {K+1} reps at {cue_weight} lb · {sets range} sets · rest {range}`
  - 1RM tile (benchmark): `Hit one clean rep at {big_weight} lb · benchmark attempt`

**Per-zone defaults (uneditable, globally locked):**

| adp zone | rep range | sets | RIR | rest |
|----------|-----------|------|-----|------|
| strength | 1-5 reps | 4-5 sets | 1 rep short of failure | 3-5 min between sets |
| hypertrophy | 6-12 reps | 3-4 sets | 2 reps short of failure | 2-3 min between sets |
| endurance | 13+ reps | 2-3 sets | 3 reps short of failure | 45-60 sec between sets |

RIR is a coaching cue that lives in the adp-zone info panel (not in the prescription line). The cue line itself only mentions sets and rest.

**Tile grid UX (replaces the previous 5-column grid):**

- **Single active adp-zone pill at the top**, flanked by pulsing chevron arrows — same locked choreography as the bodyweight pill row (see the "Pill row swipe gesture" subsection below). Pill label sits on ONE line (`BUILD STRENGTH` / `INCREASE HYPERTROPHY` / `BOOST ENDURANCE`), never wrapped. The previous 3-pill grid is gone.
- Pill order in the swipe carousel (left → right): `strength → hypertrophy → endurance`. Chevrons appear only on the side where another zone exists (no `<<` on strength, no `>>` on endurance).
- Below the pill: single horizontal scrollable row of tiles (1RM through 20RM), with fading edges signaling more content off-screen.
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

- **10 unbroken clean reps in a single set** → promotes to the next tier.
- For Band and Band+Knee tiers, this is gated by **band level** (see "Band-level sub-progression" below): the user must hit 10 unbroken reps at the LIGHT band level before graduating to the next tier. Within those tiers, hitting 10 reps at a heavier band level auto-advances them to the next thinner band, not all the way to the next tier.
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
5. **Chart** — shared across all tiers and all time. Never slides.
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
- No "rest" line and no separate graduation-hint line. ONE unbroken set at the target rep count is the new benchmark — there is no longer a "3 sets" prescription. The graduation moment is implicit: hit 10 at the current band and the algorithm auto-advances; hit 10 at the LIGHT band and the Ready state fires.

**Hero card (item 4) — assisted tier, ready to graduate:**

- Fires when:
  - **Band / Band+Knee**: best at the LIGHT band level ≥ 10 (`allLevelsCleared` from `computeBandSubState`).
  - **Knee**: overall tier best ≥ 10.
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
3. Else if best at `lightestUsed` < 10 → current band = `lightestUsed`, best at current = `bestPerLevel[lightestUsed]`.
4. Else (best at `lightestUsed` ≥ 10) → auto-advance to the next thinner band:
   - If `lightestUsed` is Light → `allLevelsCleared = true`, the Ready state fires (user can graduate to the next tier).
   - Otherwise → current band = the next thinner level (e.g., Heavy → Medium), best at current = `bestPerLevel[nextBand]` (typically 0 if the user hasn't logged at this lighter band yet).

**Consequences:**
- **Tile grid** shows 1-10 with achievement based on best at the CURRENT band level — not cumulative across all band levels. When the algorithm auto-advances to a new band, the tile grid visibly resets.
- **Cue text** updates to reference the new current band.
- **Sub-line under the big number** updates to identify the new current band.
- The user can skip band levels at will (e.g., go straight to Light without doing Extra Heavy / Heavy / Medium) — the algorithm respects that choice and uses their lightest used band as the frontier.
- Regressing to a heavier band level (e.g., logging Extra Heavy after already practicing Heavy) does NOT pull the current band backward — the lightest used band stays the frontier.

**Knee tier has no sub-progression** — only one variant, just track overall tier best. Ready state fires at tier best ≥ 10.

**Full RX** keeps its 4-mode body (locked / push / graduation / weighted) — see the Full RX section below.

**Animation conventions (mirrored from weighted card):**

- Big number on the hero card uses `TickerNumber` slot-machine animation.
- Info-panel open/close uses the same `LinearTransition` + `FadeInUp / FadeOutUp` pattern that the weighted card uses, with sibling layout animation so the big number slides smoothly when the panel opens.
- Tier-pill row, tile row, and hero card form a synchronised horizontal pager — swiping the hero card scrolls the pill row and the tile row to match, and tapping a pill scrolls all three to that tier.

**Chart (item 5) — shared:**

- One est-progress chart for the whole movement, spanning all tiers and all time.
- Each data point carries the tier in its tooltip (`May 4, Push Up [Knee] · 10 reps`).
- Graduation moments render as vertical milestone markers on the chart (`graduated to KNEE on May 4`).

**Log list (item 6) — shared:**

- One chronological list of every effort across all tiers — never duplicated per tier.
- Each row shows a small tier chip on the right (`B+K`, `K`, `B`, `RX`) so the tier source of every effort is visible at a glance.
- All edit/delete affordances behave the same as the existing log list.

---

### Isometric detail card — locked design spec

This is the spec for the detail page that covers **isometric movements** on `StrengthDetail.jsx` (web) and `[exercise].tsx` (mobile) — Plank Hold, Wall Sit, Side Plank, L-sit, Hollow Hold, Glute Bridge Hold, Superman Hold, Handstand Hold, and any other movement where `movements.strength_type = 'isometric'`. Progression is measured in **seconds of unbroken hold time**, not reps or weight.

**Universal milestone set (locked):** every isometric movement uses the same 12 milestones:

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

This is the spec for the detail page that covers **loaded carry movements** — `movements.equipment === 'carry'` — Farmer's Carry, Kettlebell Farmer's Carry, Single Arm Farmer's Carry, Suitcase Carry, Yoke Carry, Kettlebell Overhead Carry, Single Arm Overhead Carry, and the strongman-object carries (Atlas Stone Bear Hug, D-Ball Bear Hug, Husafell Stone, Keg, Sandbag, Shield, Sled Drag [Push], Sled Drag [Pull]). Progression is tracked along TWO axes simultaneously: **weight per hand / per implement** AND **distance traveled** (meters or feet, normalized to meters internally).

**Sled Drag variant tag (May 2026 lock):** Sled work has TWO biomechanically distinct variants on the same equipment:
- **Sled Drag [Push]** — Prowler-style, leg-dominant (quad/glute concentric drive). Facing the sled, hands on handles, legs piston. Higher loads possible.
- **Sled Drag [Pull]** — drag, posterior-chain dominant (hams/glutes pull). Strap or harness, sled behind. Lower loads typical.

Both are stored as separate movements (`Sled Drag [Push]`, `Sled Drag [Pull]`) with their own `CARRY_BENCHMARKS` entries (`mode: 'ratio'`; Push tiers: 1.0/1.5/2.0/2.5×BW; Pull tiers: 0.75/1.25/1.75/2.25×BW; all at ≥ 15 m).

**Consolidated detail page (locked May 2026):** the strength index collapses both variants into ONE row keyed by the base name `Sled Drag` with a small `PUSH` / `PULL` badge on the right showing whichever variant the user most recently logged. Tapping the row routes to `/effort/strength/Sled Drag` (the base name — not a real movement row in the DB).

The detail page detects `exercise === 'Sled Drag'` (via `isSledDragConsolidated`), fetches BOTH variants in one `or()` query (`Sled Drag [Push] ·%` OR `Sled Drag [Pull] ·%`), and dispatches to `SledDragConsolidatedDetail`. That component:
1. Maintains an `activeVariant: 'push' | 'pull'` state (defaults to whichever variant has the most recent logged effort).
2. Renders a simple PUSH | PULL pill toggle in CarryDetail's header (via the new `extraHeaderContent` prop).
3. Delegates the actual page render to CarryDetail, passing `exercise={`Sled Drag [${activeVariant}]`}` (so `CARRY_BENCHMARKS` lookup + label parsing still work), `displayName="Sled Drag"` (so the h1 reads as the base name), and `efforts={filteredEfforts}` (only the active variant's efforts).
4. The CarryDetail render gets a `key={activeVariant}` prop so it remounts when the user toggles — clean reset of all internal state (selected zone, scroll position, info panel) per variant.

The two new CarryDetail props (`displayName?: string` and `extraHeaderContent?: React.ReactNode`) are additive and have no effect when omitted — every other carry call site (Atlas Stone, Yoke, Farmer's, etc.) renders unchanged.

The May 2026 cleanup also moved `Sandbag Carry`, `Sled Pull`, `Sled Push` from cardio to strength — they were loaded carry work miscategorized as cardio. `Sled Pull` → renamed to `Sled Drag [Pull]`; `Sled Push (Prowler)` → renamed to `Sled Drag [Push]`. `Sandbag Carry` added as a new strength entry (its `CARRY_BENCHMARKS` spec was already in code, but the movement row was missing from the DB).

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

5. **Chart** — dual-axis line chart, weight (left, primary blue) + distance (right, lighter blue). Each effort = single data point on both axes. PB dashed lines for both. Chart's y-axis labels show units. (Mobile uses two stacked single-axis charts because the shared `LineChart` component doesn't support dual axes natively — accepted divergence.)

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
| **A — Endurance Athletes** | Running, Running (Treadmill), Cycling, Cycling (Mountain Bike), Stationary Bike, Bike Erg, Air Bike, Row Erg, Ski Erg, Skiing, Swimming, Elliptical | Full **progression plan** with Endurance/Threshold/VO2 zones (this spec) |
| **B — Different framework needed** | Rucking, Hill Running, Trail Running | Cardio category but pace zones don't fit. Rucking progresses on load + distance (carry-like, not pace). Hill / Trail Running are terrain-confounded — they currently route through Group A's pace-zone plan as an accepted divergence until HR-zone integration lands (Phase 2). |
| **C — Step-Based Machines** | StairMill | **Simple tracking page** (header + chart + history). Step-based conditioning needs its own round-based progression model. Deferred. |

This spec covers **Group A only.** Group B's Rucking gets the simple tracking page; Hill Running and Trail Running fall through Group A's regex default to `running` and use that prescription set (terrain-aware design deferred). Group C (just StairMill after the May 17 niche-equipment cleanup) gets the simple page until a round-based model is designed.

Determined in code by `isEnduranceAthleteActivity(activityName)` → returns true for Group A categories.

**Two cardio modes still exist underneath** (`cardio_mode = 'pace'` vs `'duration'`), but Group A is all pace mode. Duration mode is Group C only, and gets the simple page.

**Adaptation zones (3 zones, locked May 2026):**

The 5-zone HR model is still the underlying science, but the app exposes only the three zones that actually drive progression. **Recovery (Z1) is not training — it's the absence of training, and we don't program rest days for users.** **Tempo (Z3) is what polarized-training research calls "no man's land" — too hard to be efficient aerobic base, too easy to drive lactate-clearance or VO2 max adaptations.** Both dropped from the UI. This also gives perfect 1:1 parity with strength's 3-zone adp model (Strength / Hypertrophy / Endurance → Endurance / Threshold / VO2 Max).

| Zone | Label | %HRmax | Adaptation focus |
|------|-------|--------|------------------|
| Z2 | ENDURANCE | 60–70% | Mitochondrial density, capillary network, fat oxidation. The foundation of all endurance — 70–80% of total training volume per polarized model. |
| Z4 | THRESHOLD | 80–90% | Lactate clearance — the body learns to process lactate faster. THE pace that improves 5K–half marathon times most directly. 1–2 sessions per week max. |
| Z5 | VO2 MAX | 90–100% | Maximum oxygen uptake — your engine ceiling. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between. |

**Science backing (locked):** ACSM *Guidelines for Exercise Testing and Prescription* (12th ed., 2025); Karvonen, Kentala & Mustala (1957) for HR-reserve methodology; Jack Daniels' *Running Formula* (3rd ed., 2014) for VDOT-to-zone mapping; Garmin / Polar / Suunto / Apple Watch all default to the same 5-zone model. The 50/60/70/80/90% HRmax boundaries are the global standard, not novel.

Until heart-rate integration lands (Phase 2 — via Apple Health / Strava / Garmin / Polar), zones derive from **pace as the proxy** using Riegel-scaled offsets from the user's fastest logged pace. Once HR data is available, zones recalibrate from actual HR.

**Per-zone pace formula (pace mode):**

Anchored on the user's fastest logged pace `Pbest` for the activity:

| Zone | Target pace offset (running, /km) | Notes |
|------|-----------------------------------|-------|
| Z2 | `Pbest + 60 s/km` | conversational, aerobic base |
| Z4 | `Pbest + 10 s/km` | ≈ 10K race pace, "comfortably hard sustained" |
| Z5 | `Pbest − 15 s/km` | ≈ 3K race pace, "max sustainable" |

Offsets scale to the activity's pace units (km or mi). For non-running activities (rowing, swimming, cycling, ski erg) the offsets translate to the activity's typical pace scale; calibration tables per activity will land alongside the implementation. Riegel projection (`projectPaces` in `formulas.ts`) handles cross-distance pace mapping — unchanged from today.

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
- `Cross Country Skiing` → `Skiing` (in a cardio-only context, "Skiing" unambiguously means the cardio variant; downhill skiing isn't tracked here).

**Final cardio movements list (19 DB rows, 16 visible activities — May 17 2026 lock, after non-cardio + niche-equipment cleanup + swim stroke consolidation):** Air Bike, Bike Erg, Cycling, Cycling (Mountain Bike), Elliptical, Hill Running, Row Erg, Rucking, Running, Running (Treadmill), Ski Erg, Skiing, StairMill, Stationary Bike, **Swimming [Freestyle], Swimming [Backstroke], Swimming [Breaststroke], Swimming [Butterfly]**, Trail Running. The 4 Swimming stroke variants collapse into a single "Swimming" row in the cardio index (so the user-visible activity count is 16 even though the movements table has 19 rows). See "Swimming detail card — locked design spec" further down for the consolidation architecture.

**Removed from cardio (May 17 2026, two passes):**
- **Pass 1 (recreational/lifestyle — not cardio training):** Walking, Walking (Treadmill), Hiking, Stair Climb (outdoor), Rowing (Open Water), Canoeing, Kayaking, Stand Up Paddleboarding, Inline Skating, Ice Skating. Rationale: transport, leisure, or outdoor activities — the user doesn't pick them with intent to improve cardio fitness, intensity isn't deliberately modulated, and a coaching prescription would be condescending. May come back as part of a separate "activity log" surface (where lifestyle movement counts toward weekly minutes / calories / streaks without a coaching layer).
- **Pass 2 (niche-equipment / niche-user — low coverage value):** Aqua Jogging (rehab-only cross-training for injured runners; tiny user base), Roller Skiing (off-season training tool for competitive Nordic skiers only; <1% of any realistic user base), Arc Trainer (Cybex-brand machine found in ~30% of commercial gyms; most users encounter Elliptical or StairMill instead). Rationale: niche enough that removing them costs essentially no coverage and simplifies the catalog.

**Earlier May 2026 cleanup** also moved `Sandbag Carry`, `Sled Pull`, and `Sled Push` to strength — they're loaded carries, not endurance/lifestyle movement. See Sled Drag note in the strength Carry detail spec.

The mirror update lives in: the Supabase `movements` table (single source of truth for mobile) and `mobile/app/(app)/effort/cardio/[activity].tsx` (`categorizeActivity` regex, `PACE_ZONE_SESSIONS` keys, `DURATION_ZONE_SESSIONS` keys — `arc_trainer` entry removed in Pass 2), plus `mobile/src/lib/movements.ts` (`SPEED_INPUT_ACTIVITIES` set + `SPEED_MAX_KMH` map — Walking (Treadmill) removed in Pass 1). The `categorizeActivity` regex maps the remaining names to existing categories: `Skiing` → `ski_erg` (same motion); `Bike Erg` → `stationary_bike`; `Stationary Bike` → `stationary_bike`; Hill Running / Trail Running → `running` (default fallback). `web/src/lib/movements.js` may still list the removed names — web is frozen per the May 12 2026 lock, so it's allowed to lag.

**Out of v1 scope (deferred, locked):**
- **RPE rating field** on log form — adds no value to zone calculations (pace IS the zone proxy until HR lands). Revisit if coaches request it after the coaching surface is live.
- **Notes field** on log form — pure UX, defer.
- **Per-session calorie auto-estimation** — handled inside the upcoming Calories page overhaul (separate conversation).
- **Heart rate via integration** (Apple Health / Strava / Garmin / Polar) — Phase 2. When it lands, zones recalibrate automatically from actual HR data.

**What's removed from the previous PaceDetail / DurationDetail design:**
- The single "Your next training target" callout that prescribed only a pace at a distance with no session structure, no rest cue, no why explanation. Replaced by the zone-aware hero card with full Daniels-style prescription.
- The implicit "always train at race pace" model. Replaced by 5 explicit adaptation zones, each with its own pace target and session format.

---

### Swimming detail card — locked design spec

This is the spec for the swim-native coaching surface on `[activity].tsx` (mobile) — fired when `isSwimActivity(activity)` (i.e. activity is `'Swimming'`, any `'Swimming [Stroke]'` variant, or a legacy bare `'Swimming · ...'` effort). Routes through `SwimmingConsolidatedDetail` (the stroke-pill wrapper) which then renders `SwimmingDetail` filtered to the active stroke. NOT the generic `PaceDetail`, because swim mechanics differ from running/cycling in five fundamental ways:

1. **Workouts are interval SETS on a clock.** Not "swim X km at Y pace." Real swim sessions look like "8 × 100m, leave every 1:50" — every rep ends at a wall, the user touches, gets whatever rest is left from the leaving interval, then pushes off for the next rep. The "leaving interval" is the canonical swim concept; running has no equivalent.
2. **Distances come in pool lengths, not arbitrary km.** Pool lengths are 25m, 50m (Olympic), or 25 yards. Rep distances are always multiples of pool length: 50m, 100m, 200m, etc. The current SWIM_ZONE_SESSIONS data uses 50m and 100m chunks that fit any pool layout.
3. **Pace is per 100m, not per km.** Universal swim convention. Storage stays in seconds-per-km for cross-activity uniformity, but the detail page divides by 10 at display time.
4. **CSS anchors all zones.** CSS = Critical Swim Speed = swimming's threshold pace (analogous to a runner's lactate threshold). Canonical formula is `(400m_TT_time - 200m_TT_time) ÷ 200`, but v1 uses a Riegel-projected proxy instead (see "CSS proxy" below) to skip the calibration session.
5. **Hero card stacks THREE values, not two.** Running's hero shows work + pace. Swimming's shows work + pace + leaving interval — the leaving interval is what the swimmer actually reads off the pool clock to know when to push off, so it's a first-class number.

**Stroke consolidation (May 17 2026 — LOCKED):**

Swimming has 4 stroke variants — Freestyle, Backstroke, Breaststroke, Butterfly — stored as separate movements in the DB (`Swimming [Freestyle]`, `Swimming [Backstroke]`, `Swimming [Breaststroke]`, `Swimming [Butterfly]`). They collapse into a single detail page via `SwimmingConsolidatedDetail`, mirroring the Sled Drag `[Push]` / `[Pull]` pattern from strength. The architecture:

- **DB**: 4 movement rows, all `category='cardio'`, `cardio_mode='pace'`. No `Swimming` row exists; bare `'Swimming · ...'` effort labels from before this consolidation are legacy and default to Freestyle on the parse path.
- **Cardio index (`cardio.tsx`)**: the "Your activities" aggregation collapses the 4 stroke variants (and legacy bare swim labels) under a single `Swimming` row, with the most-recently-trained stroke shown as a small `FREE` / `BACK` / `BREAST` / `FLY` badge to the right. Best pace shown is the FASTEST per-100m across all strokes.
- **Cardio log form (`cardio.tsx`)**: the activity search returns all 4 stroke variants as separate hits (consistent with how Sled Drag's strength search returns `Sled Drag [Push]` + `Sled Drag [Pull]` separately). The user picks the stroke they swam. The form recognises any bracketed swim variant as swim mode via `isSwimActivity(activity)`; save label format is `Swimming [Backstroke] · 1500 m in 25:00`.
- **Detail page route**: `/effort/cardio/Swimming` (base name from the index collapse) and `/effort/cardio/Swimming [Freestyle]` (bracketed deep links) both route to `SwimmingConsolidatedDetail`. The wrapper holds `activeStroke` state (defaults to whichever stroke was logged most recently; falls back to Freestyle if no swim efforts exist yet) and filters efforts to that stroke. Inner `SwimmingDetail` is stroke-agnostic — operates on whatever filtered list it receives.
- **Pill carousel**: 4-variant version of the same swipe choreography used by Sled Drag and the BW assist tiers. Single amber pill in the center showing the active stroke as a short label (`FREE` / `BACK` / `BREAST` / `FLY`), flanked by pulsing chevrons. Carousel order: `FREE → BACK → BREAST → FLY` (popularity / freestyle-first). No wrap at the ends — left chevron disappears on Freestyle, right chevron disappears on Butterfly.
- **Pill swipe gesture**: identical mechanics to the Sled Drag pill — Pan gesture, 20px threshold, 220px slide-off, 250ms slide-out / slide-in, 120ms chevron fade. Bounded by `currentIdx + direction` within `[0, SWIM_STROKE_ORDER.length - 1]` so over-swipes at the ends bounce back rather than commit.
- **Per-stroke fitness**: every stroke has its own CSS estimate (computed only from that stroke's efforts), its own progression chart, and its own plan queue. Switching strokes flips both the data AND the prescription. A user might have a 1:35/100m freestyle CSS and a 2:15/100m butterfly CSS — both tracked independently, no cross-contamination.
- **Empty states**: each stroke tab computes from only its own efforts. The user who has only swum freestyle sees the normal coaching surface on the FREE tab and an empty-state card on BACK / BREAST / FLY (`"Log your first backstroke effort and your personalized plan will appear here"`). No auto-estimating across strokes — they're physiologically different enough that the user's freestyle CSS tells us nothing about their butterfly CSS.

The 4 stroke movements live in `mobile/src/lib/movements.ts` (`SWIMMING_STROKE_MOVEMENTS`, `SWIM_STROKE_ORDER`, `SWIM_STROKE_LABELS`, `parseSwimStroke`, `isSwimActivity`, `swimStrokeFromMovementName`) so the log form, the index collapse, and the detail page all import from the same authoritative source.

**CSS proxy via Riegel projection (LOCKED):**

For each logged effort, the system projects the user's time to a 1000m-equivalent time using Riegel's law `T2 = T1 × (D2/D1)^1.06`, then divides by 10 for per-100m pace. The CSS proxy = MIN of those projected per-100m paces across all efforts.

- **Why MIN?** An off-day at easy pace shouldn't downgrade CSS — that would make next session's prescription artificially easy. CSS only improves when the user swims faster than current fitness. If they genuinely detrain, the prescription will be too aggressive until they log a fresh harder effort; accepted divergence for v1.
- **Distance-aware:** a 50m sprint projects to a SLOWER 1000m pace than a 1500m steady swim does (Riegel exponent 1.06 means longer distances scale better than naive linear projection). So cross-distance comparisons work without per-distance weighting.
- **Convergence:** the proxy is initially slightly aggressive vs true CSS (because the user's "best ever" is closer to a peak than a sustainable threshold), but the gap narrows as the user accumulates efforts at varied distances. If users complain prescriptions are too hard, optional escalations: (a) add a canonical 400m+200m calibration onboarding flow, or (b) auto-shave 3–5 sec off the proxy to bias toward sustainability.

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
| `riegelProjectCSS(efforts)` | Compute the user's CSS proxy via Riegel projection; returns secs per 100m or null |
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
- **Cardio** — tracking surface today; next up for promotion (in progress).
- **Mobility** — tracking surface (ROM logs).
- **Bodyweight** — tracking surface (weight + goal).
- **Calories / Nutrition** — tracking surface (food log, macros, daily target).
- **Sleep / Water / Habits** — not built. To be decided whether they ship as first-party builds or as Apple Health / Google Fit integrations (Trainerize uses the integration path for sleep — worth copying).

### Roadmap order (rough, not locked)
1. Cardio → coaching surface (NEXT)
2. Bodyweight → coaching surface
3. Mobility → coaching surface
4. Calories → coaching surface
5. Sleep / Water / Habits → tracking surfaces, likely via Apple Health / Google Fit integrations

---

## What This Is
A React + Vite SPA (web, frozen) + React Native / Expo app (mobile, active) — a fitness coaching platform per the mission above. Clients track strength, cardio, mobility, bodyweight, and calories. Admins (coaches) manage clients, review progress, and communicate via chat/suggestions.

---

## Mobile Mirror (mobile/)

There is a **React Native (Expo) port of this app** at `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\`. It targets the same Supabase backend.

**⚠ Web is FROZEN for design + feature parity (locked 2026-05-12).** Mobile is now the active surface for ALL new feature work and design iteration. The web app continues to run against the same Supabase backend and read the same data, but it does NOT receive design or feature parity updates anymore. Touch the web codebase ONLY when:
  - A database schema change would cause the web app to crash or render broken output (in which case apply the minimum compatibility patch — read the new column tolerantly, fall back gracefully when fields are missing).
  - The user explicitly asks for a web change.

This reverses the previous "web is source of truth, mobile mirrors" rule. Going forward, **mobile leads.** When the two diverge, mobile is correct and web is allowed to lag. Don't mirror new mobile work back to web unless the user asks. Don't run `npm run build` or `wrangler pages deploy` after a mobile-side change — only deploy web when you've actually changed web files.

The historical 1:1 mirroring rule still applies to the legacy surfaces that were locked before 2026-05-12 (every variant in `StrengthDetail.jsx`, Bodyweight consolidated, Iso, Assisted, Carry up through the last shared deploy). Those surfaces are paired and should stay that way until the user explicitly retires the web side.

### Current mobile port status

| Surface                  | Web file                                    | Mobile status                                                     |
|--------------------------|---------------------------------------------|-------------------------------------------------------------------|
| Dashboard                | `src/pages/Dashboard.jsx`                   | ✅ shipped                                                         |
| Strength                 | `src/pages/Strength.jsx`                    | ✅ shipped + polished. PhantomWheel-driven inputs (reps / weight / distance) with iOS-style inertia + tap-to-stop, SharedValue-driven text so the step-boundary commit is visually invisible (no more "labels flick up by one digit" artifact), unified 48 px Unit column across all triple-grid variants (standard / assisted / carry), unit-locked movements render "kg" / "lb" at the same size the toggle uses, 1-rep entries show "1RM" instead of "Estimated 1RM" on the live chip. |
| StrengthDetail           | `src/pages/StrengthDetail.jsx`              | ✅ shipped (per-exercise history + best-effort badges; all rep-based, isometric, assisted, carry, band-assist, knee-assist modes covered). |
| Cardio                   | `src/pages/Cardio.jsx`                      | ✅ shipped                                                         |
| CardioDetail             | `src/pages/CardioDetail.jsx`                | ✅ shipped                                                         |
| Mobility                 | `src/pages/Mobility.jsx`                    | ✅ shipped (commit-on-release ROM editor)                          |
| Bodyweight               | `src/pages/Bodyweight.jsx`                  | ✅ shipped                                                         |
| Calories                 | `src/pages/Calories.jsx`                    | ✅ shipped (FoodLogDrawer + barcode scan)                          |
| History                  | `src/pages/History.jsx`                     | ✅ shipped                                                         |
| EditProfile              | `src/pages/EditProfile.jsx`                 | ✅ shipped (Profile + Settings tabs, line-by-line parity)          |
| ChatDrawer               | `src/components/ChatDrawer.jsx`             | ✅ shipped as `ChatSheet.tsx` (realtime, swipe actions, typing)    |
| SuggestionDrawer         | (admin → client suggestion thread)          | ✅ shipped as `SuggestionSheet.tsx`                                |
| Auth (signin only)       | `src/pages/Auth.jsx`                        | Web is sign-in only since web sign-up moved to `/signup`. Forgot-password lives here, sends a magic link via `supabase.auth.resetPasswordForEmail`. Defensive `?mode=signup` redirect to `/signup` for old emails / external links. Mobile keeps fingerprint sign-in via `expo-local-authentication` + `expo-secure-store`; Android App Links via `public/.well-known/assetlinks.json` |
| Sign-up journey          | `src/pages/Signup.jsx`                      | ✅ 19-screen onboarding (welcome → units → modality → magic ×3 → body data ×4 → whats-next → email + password + email-OTP → name → phone + phone-OTP → photo → notifications → welcome-end). Email OTP via Supabase auth, phone OTP via Twilio Verify edge functions. 512px JPEG avatar via crop+downscale. Step + data persisted to sessionStorage so app-switching to read SMS doesn't reset progress. |
| CompleteProfile          | `src/components/CompleteProfile.jsx`        | ✅ Recovery mini-journey for users with `auth.users` row but incomplete `profiles` row. Mirrors Signup design (welcome → units → sex → dob → height → weight → name → phone+OTP → photo → done). `ProtectedLayout` gates on `isProfileComplete()` (`src/lib/profile.js` — checks full_name + gender + birthdate + current_weight + current_height) so the mini-journey doesn't kick the user out mid-flow when phone-otp partially writes the row. Done screen waits for explicit "Open my dashboard" click. |
| MobilityDetail           | `src/pages/MobilityDetail.jsx`              | ⏳ pending (mobile already exposes ROM data inline)                |
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
  - `mobile/app/(app)/profile.tsx` (mobile, defensive) — `isAdmin` check
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

#### When the dev client APK needs rebuilding (`npx expo run:android`)
Only when one of these changes:
- A new native module is added (`npx expo install <pkg>` for anything that has Android/iOS code)
- `app.json` plugin config changes
- `babel.config.js` changes
- Expo SDK version is bumped

Plain JS / TS / TSX edits (95% of work) hot-reload through Metro — never trigger a rebuild for those.

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
│       ├── _layout.tsx                 # AppShell — top bar + content Slot + bottom nav, redirects on !isProfileComplete
│       ├── dashboard.tsx               # ✅ Dashboard.jsx
│       ├── strength.tsx                # ✅ Strength.jsx
│       ├── cardio.tsx                  # ✅ Cardio.jsx
│       ├── mobility.tsx                # ✅ Mobility.jsx (commit-on-release ROM editor)
│       ├── bodyweight.tsx              # ✅ Bodyweight.jsx
│       ├── calories.tsx                # ✅ Calories.jsx (FoodLogDrawer + barcode)
│       ├── history.tsx                 # ✅ History.jsx
│       ├── profile.tsx                 # ✅ EditProfile.jsx (Profile + Settings tabs)
│       └── effort/
│           ├── strength/[exercise].tsx # ✅ StrengthDetail.jsx
│           └── cardio/[activity].tsx   # ✅ CardioDetail.jsx
│       # MobilityDetail.jsx — pending; mobile already exposes ROM data inline
├── src/
│   ├── theme.ts                        # design tokens (HSL strings) + alpha() + Tailwind palette
│   ├── components/                     # AnimateRise, DeleteAction, TickerNumber, NumericInput, MovementSearch,
│   │                                   # LineChart, UnitToggle, Slider, ROMVisualizer, CalorieStrip,
│   │                                   # BarcodeScanner, FoodLogDrawer, ChatSheet, SuggestionSheet,
│   │                                   # MessageActions, Select, ShellSkeleton, Skeleton, LoadingScreen,
│   │                                   # OTPInput, PasswordInput, PasswordStrengthMeter, StepDots, KeyboardScreen
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
- **Settings → Chat card admin gate:** the two share-with-coach toggles are hidden on `profile.tsx` when `profile.is_superuser === true`. Only `Enter to send` shows. Same gate exists on web (`EditProfile.jsx`'s `isAdmin` check + `AdminUserProfile.jsx`'s `isOwnProfile` prop).
- **Mobility's slider commits on gesture-end only.** During a Pan, only `x.value` (UI-thread shared value) updates. Live mannequin animation is deferred until tested on a real device — emulator software rendering can't keep up with per-frame SVG repaints.
- **Deleted-user detection (`AuthContext.tsx`):** after `getSession()`, validates the session against the auth server with `getUser()`. If 401 (user was hard-deleted), signs out cleanly so the app doesn't crash trying to fetch the missing profile.
- **Android quirk — `fontFamily` + `fontWeight` don't combine.** When `fontFamily` points at a registered custom font (Geist, JetBrainsMono — the only families this app loads), do NOT also set `fontWeight` on the same style. Android's renderer can't auto-resolve the weight against a custom family, and the dual hint makes the renderer silently fall back to the system default. Encode the weight into the family name instead (`fonts.sans[700]` is `Geist_700Bold`, `fonts.mono[600]` is `JetBrainsMono_600SemiBold`). iOS tolerates the combination, so this is Android-only — but every style in the app must be Android-safe.
- **Use plain `<Text>` inside `<Animated.View>`, not `<Animated.Text>`, when the text needs custom `fontFamily`.** `Animated.Text` (the Reanimated wrapper) doesn't merge `Text.defaultProps.style` and explicit `fontFamily` the same way plain `Text` does; the custom family silently falls back to the global Geist default. If you need the Text node itself to animate (opacity, transform), wrap a plain `Text` in an `Animated.View` and animate the wrapper.

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

## Secrets hygiene (MANDATORY)

This repo has been bitten twice by secrets leaking via committed files — once with a Cloudflare API token, once with a USDA FoodData Central API key (the USDA one was auto-detected by GitHub and disabled by USDA IT on 2026-05-06). Both leaks happened because a credential ended up in a tracked file. The defences below close that vector at three independent stages, and **all three must stay enabled**.

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
src/pages/Mobility.jsx       — ROM tracking
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
src/components/CalorieStrip.jsx    — Scrollable day-tile strip; sums calories from
                                     food_logs (not calorie_logs); tile click fires
                                     onDayClick(iso); accepts refreshKey prop
src/components/FoodLogDrawer.jsx   — Bottom-sheet food logger (max-h 92dvh).
                                     Three views: 'log' | 'search' | 'portion'.
                                     USDA search → portion picker → Supabase insert.
                                     Props: userId, day, onClose, onEntriesChange
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
src/lib/usda.js             — Legacy USDA-only wrapper. Superseded by foodLibrary.js for
                              new work. Still imported by FoodLogDrawer.
```

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
- `get_coach_info()` — SECURITY DEFINER; returns `{ full_name, avatar_url }` from the superuser profile. Used by end-user ChatDrawer to show coach photo without hitting RLS. When changing return shape, must `DROP FUNCTION` first.

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
- **Food logging vs calorie_logs**: `food_logs` is the live system. `calorie_logs` is legacy — don't delete it, admin "Manual Logs" tab still reads it. CalorieStrip reads `food_logs` and sums calories in JS.
- **CalorieStrip `refreshKey` prop**: bump this integer from the parent after any `food_logs` mutation to trigger a re-fetch. Pattern: `setStripRefreshKey(k => k + 1)`.
- **USDA / food search**: use `foodLibrary.js` (`searchFoods`, `getFoodPortions`, `calcMacros`) for all new food search work. It merges custom myrx foods (Supabase) + USDA (Cloudflare Worker D1). `usda.js` is legacy.
- **UPC progressive search**: queries of 3+ digits trigger UPC mode in both `foodLibrary.js` (Supabase ilike prefix) and the Cloudflare Worker (SQL `LIKE digits%`). 12+ digits = exact match. This means results narrow as the user types — no need to scan a complete barcode.
- **RLS bypass for cross-row reads**: end users can't read admin profile rows. Use `SECURITY DEFINER` RPC functions for any data that clients need from the admin's profile (e.g. `get_coach_info()`). Always `SET search_path = public` on SECURITY DEFINER functions.
- **Coach avatar in ChatDrawer**: only in the drawer header, NOT on individual message bubbles. User explicitly rejected per-message photos.
- **Cloudflare Worker** (`workers/food-search/`): handles `/search` endpoint for USDA D1 food search. UPC detection added — partial prefix LIKE for 3-11 digits, exact for 12+. Deploy with `npx wrangler deploy` from `workers/food-search/`.
- **Admin Movement Library add form**: hidden behind a dashed button (`addOpen` state). Never render the form inline without user clicking "+ Add movement" first.
- **Food library architecture (post-2026-05-14 rebuild + second-pass cleanup)**: two-tier data flow. **Initial seed** = one-shot bulk import from locally-downloaded source files via `scripts/bulk_import/run.mjs` (pulls every USDA data type — branded, foundation, sr_legacy, survey_fndds, experimental, plus the rarer ones — and all of OpenNutrition). **The bulk import now applies the full filter pipeline at INSERT time** (Tier 1-4 of `scripts/d1_migrate/lib/filters.mjs`: Rules 1-14) plus a post-import dedup pass (Tier 5: Rules 15-19). **Ongoing sync** = incremental refresh via `scripts/d1_migrate/sync_usda.mjs` (USDA API delta) and `scripts/d1_migrate/sync_on.mjs` (ON ZIP diff), triggered manually from the admin food-library Sync button. No cron, no auto-schedule. **⚠ Sync scripts do NOT currently apply the filter pipeline** — they predate `filters.mjs` and use their own legacy `shouldSkip` check from `lib/normalize.mjs`. Wiring `enrichFood` + `shouldKeepFood` + `post_import_dedup.mjs` into the sync scripts is a known-pending revamp (sees stale `prefer USDA over ON` comment in `sync_on.mjs` that contradicts Rule 17).
- **`food_library` schema (current)**: 19 columns. Identification: `source` (usda/on/myrx), `source_id` (unique within source), `source_subtype` (literal source category — e.g. 'branded_food', 'foundation_food', 'on_branded', 'on_recipe', 'admin_custom'). Classification: `data_type` (universal — 'branded'/'generic'/'recipe'/'restaurant'/'aggregated'). Nutrition: kcal/protein_g/fat_g/carbs_g/fiber_g/sodium_mg/serving_g/serving_label/servings_per_container/upc/brand/name. Audit: `imported_at`, `last_synced_at`, `source_version` (e.g. 'FoodData_Central_csv_2026-04-30', '2025.1'). `food_category` (USDA's text category) was dropped during the post-audit cleanup. Schema lives in `workers/food-search/schema.sql`; migrations in `workers/food-search/migrations/` (0004 added data_type, 0005 brand-aware classifier fix, 0006 audit columns).
- **`data_type` rule** (`scripts/d1_migrate/lib/normalize.mjs::dataTypeFromUpc(upc, brand)`): branded if EITHER upc OR brand is present; generic only when both are missing. The bulk import uses USDA's own `data_type` column to assign (branded_food → 'branded', everything else → derived per-type), but the Worker myrx-create path and incremental sync paths use the UPC/brand rule as single source of truth.
- **`shouldSkip` UPC rule** (`scripts/d1_migrate/lib/normalize.mjs`): rejects rows without a UPC ONLY when `dataType === 'branded'`. Generics legitimately have no UPC and must pass through. If you copy this filter to a new sync path, copy the `dataType` parameter too — otherwise you'll silently re-introduce the original lettuce-disappears bug.
- **Audit-then-filter workflow (status as of 2026-05-14)**: the audit phase is **COMPLETE**. The original workflow was: bulk import lets every row through, then audit observations accumulate in `docs/food_library_audit.md` + `docs/food_library_filters.md`, then graduate into a cleanup migration + sync-time filters. That graduation has happened — **filters NOW apply at bulk import** (see the food-library architecture bullet above). The 19 approved rules live in `scripts/d1_migrate/lib/filters.mjs` (Tier 1-4) and `scripts/bulk_import/post_import_dedup.mjs` (Tier 5). **Rule numbers reflect execution order, not chronological invention.** See `docs/food_library_filters.md` for the full hierarchy, each rule's reasoning, decided-on-date, and actual impact counts. Sync-time filter wiring is the remaining gap.

---

## What's Been Built (complete feature list)

### Core tracking
- [x] Strength logging (sets × reps × weight, 1RM estimates)
- [x] Cardio logging (distance, time, pace)
- [x] Mobility / ROM tracking with ROMVisualizer
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
