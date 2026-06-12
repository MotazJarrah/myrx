# Strength Detail-Card Specs (Locked)

Implementation contract for every strength detail-card surface — `web/src/pages/StrengthDetail.jsx` (legacy end-user) + the per-type web coach mirrors (`web/src/pages/admin/detail/AdminStrength*Detail.jsx`) + `mobile/app/(app)/effort/strength/[exercise].tsx`. Animation mechanics are referenced by pointer; see `docs/context/animation-patterns.md` for the full constants.

---

## Coaching-cue format (LOCKED — T088 round-2, June 2026)

EVERY coaching cue across the entire app — strength AND cardio, mobile AND the web coach mirrors — uses ONE format, rendered by a single shared component. There are no per-page exceptions.

- **Component:** `mobile/src/components/CueText.tsx` + `web/src/components/CueText.jsx`. Pass the cue as a plain **string**; it auto-emphasizes number+unit tokens (weights `lb`/`kg` → blue, all other numbers → foreground, bold mono). Do NOT hand-wrap numbers in spans.
- **Voice:** one flowing prose sentence (or two). Canonical shape (weighted): `Do 4-5 sets of 5 reps at 285 lb, a weight you can do at least 7 of; rest 3-5 min between sets. Add 5 lb after every clean session, work your way up to 5 × 300 lb.`
- **Hard rules:** commas / semicolons, **NEVER em-dashes (—)**. **NEVER bullets.** **NEVER attribution inside a cue** (source credit lives on its own separate line below). **No `TickerNumber` inside a cue** — RN can't reflow an animated View in wrapping prose, so CueText uses bold text spans; the big hero number above keeps its ticker.
- **When adding/editing ANY cue anywhere:** build the sentence as a plain string and render `<CueText>{string}</CueText>` (web: `<CueText className="…">{string}</CueText>`). Commas, not em-dashes.
- **Swept June 2026:** all mobile strength cues (carry, bodyweight, isometric, assisted, reps-only + bench/ballistic/leverage/load) and all mobile cardio cues (pace, swim, air-bike, ruck, stair-mill, beat-your-best) route through CueText. Web mirrors swept alongside. Olympic/Power-Clean cue is authored in this format when its #2 ramp lands.

---

## Swipe-acceptance rule (LOCKED — June 2026)

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
- **A swipeable element must ANIMATE, not snap.** When an element accepts the variant-swipe it plays the SAME slide choreography the pill does (chevrons fade → slide off in the swipe direction → navigate → slide back in — see animation-patterns.md, Pattern 4). Never wire a swipe as a raw state change — that was the bug the user caught ("if something is swipable it should do the swipe animation, just like the rest of the things that swipe").
- **BW chart** is per-tier (after the round-2 #4 split), so it accepts the tier-swipe AND slides: a `Gesture.Pan` on the chart slides the chart off by a full window width (`bwChartTranslateX`), calls `navigateBwTierFromChart` (live tier state + bounds via `bwNavRef` / `bwChartCanLeft`/`Right` shared values so the gesture sits in the hook zone), then slides the chart back in. `BodyweightConsolidatedBlock` has a `lastSyncedTierRef`-guarded scroll-sync `useEffect` so the hero pager slides to match. The BW **log stays ungestured** (consolidated across tiers).
- **Weighted hero** got its own `wsHeroSwipeGesture` that mirrors the pill's slide choreography exactly (drives `wsPillTranslateX` → `scrollToZone`), so swiping the hero animates the pill identically — previously only the pill swiped.
- **Sled / Swimming**: chart + log live inside the per-variant paged ScrollView, so they already swipe (each filtered to the active variant). **Air Bike / Rucking / Carry**: chart + log are shared across zones → deliberately ungestured.
- Shared charts/logs are left ungestured on purpose (they scroll vertically / pin tooltips / delete rows).
- The variant-nav `Gesture.Pan` uses `activeOffsetX([-15, 15])` + `failOffsetY([-25, 25])` so taps (tooltip pin, info pill, tile select) and vertical scroll still work.

When you add or change a variant page, set each element's swipe per this rule and update `docs/Layout Design.xlsx`. (Web coach mirrors are a separate, lighter implementation; this rule is the canonical intent.)

---

## Weighted Standard next-target card — locked design spec

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

- **Single active adp-zone pill at the top**, flanked by pulsing chevron arrows — same locked choreography as the bodyweight pill row (see animation-patterns.md, Pattern 3 for the chevron pulse and Pattern 4 for the swipe). Pill label sits on ONE line (`BUILD STRENGTH` / `INCREASE HYPERTROPHY` / `BOOST ENDURANCE`), never wrapped. The previous 3-pill grid is gone.
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

## Olympic lift detail card (Layout 9) — locked design spec

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

**Deferred (Fix 1.2b):** ballistic **kettlebell** moves (Swing, Snatch, Clean, Clean & Jerk, etc.) are explosive but **rep-based** (no 1-rep-max swing), so the %-of-best card does NOT fit them. They keep `lift_type` unset for now and still route to the weighted card; their correct rep/load-based treatment is a separate follow-up. (Superseded by the Ballistic kettlebell card below — `lift_type = 'ballistic'`.)

---

## Ballistic kettlebell detail card (Layout 10) — locked design spec

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

## Bodyweight consolidated detail card — locked design spec

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
- The graduation target is the same across all four tiers and all movements. It is NOT adp-zone aware (because bodyweight has no adp zones).
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

**Chevron pulse animation:** see animation-patterns.md, Pattern 3. This card is the canonical reference for the pattern — blue theme (`BwAnimatedChevron`), 1.5 s cycle, two chevrons per side, outer delayed 250 ms behind inner, both sides in phase. Web uses CSS `@keyframes bw-chevron-pulse` (in `src/index.css`); mobile uses Reanimated `withRepeat(withSequence(...))`.

**Pill row swipe gesture — pill physically follows the finger and slides on commit:** see animation-patterns.md, Pattern 4. Card-specific values: navigate threshold **20 px**, pan activation **15 px** (so chevron taps still fire for small touches); slide-off **±220 px** over 250 ms; chevron fade-out 120 ms on `onStart`, fade-in 200 ms once the new pill lands; cancelled swipe springs the pill back over 200 ms. Implementation: `Gesture.Pan()` from `react-native-gesture-handler` (v2), wrapped around the row by a `<GestureDetector>`; pill + chevron containers are `Animated.View`s driven by two shared values (`pillTranslateX`, `chevronOpacityOverride`). The `chevronOpacityOverride` multiplies on top of `BwAnimatedChevron`'s own pulse — 0 hides them, 1 plays the pulse. (The earlier responder-system implementation was unreliable due to negotiation ordering; gesture-handler avoids it.) **Web** keeps the simple `onTouchStart` / `onTouchEnd` model — no physical slide animation (mobile-only because gesture-handler + Reanimated provide the frame-perfect shared-value plumbing).

**Hero card height — selective per-type min-height** (locked):

- **Weighted standard** gets a fixed `min-h-[220px]` web / `minHeight: 220` mobile (`s.calloutWeighted`) so all five equipment variants (barbell / dumbbell / kettlebell / machine / strongman) render at the same height. The 220 px floor is sized for the tallest weighted variant (barbell with multiple plate chips on the per-side breakdown).
- **Bodyweight consolidated** intentionally has NO min-height. An earlier iteration forced 260 px across all BW states, but the tallest BW variant (assisted working state with band-level hint + 3-line cue) is much taller than the shorter Full RX modes (push / locked / graduation / weighted) — forcing them all to 260 px left ~100 px of trailing empty space on the shorter modes. The current behaviour: each BW variant renders at its natural size; the slight height variation across tier swipes is accepted as the lesser evil.
- **Isometric / AssistedMachine / Carry / RepsOnly:** no min-height applied; each renders at its natural size.
- The mobile `NextTargetCallout` component (an inline component in `[exercise].tsx`) takes an optional `style` prop so the per-type modifier (`s.calloutWeighted`) can be passed in. Without `style`, it falls back to the base `s.callout` chrome.

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
  - **Band / Band+Knee tiers**: best reps at the *current band level* (see "Band-level sub-progression" below). When the user hits the graduation count at the current band, the algorithm auto-advances to the next thinner band level and `displayBest` resets to 0 — the big number flips to 1 and the tile grid empties.
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

The user's band level is parsed from the effort label (`Pull Up [Band] · Heavy × 7` → `Heavy`). Within these tiers the algorithm tracks **best reps per band level** and auto-advances the "current band" as the user clears the graduation count (8) at each. The full algorithm:

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

**Full RX** keeps its 4-mode body (locked / push / graduation / weighted) — see the Full RX section above.

**Animation conventions (mirrored from weighted card):**

- Big number on the hero card uses `TickerNumber` slot-machine animation (see animation-patterns.md, Pattern 2).
- Info-panel open/close uses the `LinearTransition` + `FadeInUp / FadeOutUp` pattern (see animation-patterns.md, Pattern 5), with sibling layout animation so the big number slides smoothly when the panel opens.
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

## Isometric detail card — locked design spec

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
     - **Big number** = the next un-achieved milestone above `bestSecs`, with `TickerNumber` slot-machine animation (see animation-patterns.md, Pattern 2). The display format depends on the milestone value:
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

## Leverage / skill hold detail card (Layout 11) — locked design spec

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

**Family consolidation (LOCKED — June 2026):** the 4 multi-variant families (Planche / Front Lever / Back Lever / Handstand Hold) are now real parent/child variant families and render through the **generic `FamilyConsolidatedDetail` engine** (the same Sled / Swimming pill-carousel — see animation-patterns.md, Pattern 4) on mobile — NOT four separate pages. The DB migration (`supabase/migrations-archive/20260605_consolidate_leverage_families.sql`) renamed each variant to `Name [Variant]` bracket form, linked the children to a fresh parent container row via `parent_movement_id`, set `variant_short_label` (TUCK/STRADDLE/FULL/WALL/FREE), and migrated logged effort labels. Carousel order = easiest→hardest (Tuck→Straddle→Full, Wall→Freestanding); each slot is a per-variant `LeverageHoldDetail` (milestone strip hidden — the pill replaces it). The consolidated header shows the **SKILL** badge (leverage parents have `equipment = null`). `LEVERAGE_LADDERS` is still consulted inside each slot to drive the "ready for next variant" hero hint. The strength index collapses each family to one row. **Web is mobile-only here:** the web admin has no generic consolidation engine, so the coach view renders leverage variants **individually** (each with its own milestones + progression ladder) — arguably clearer for a read-only roster review; a web pill carousel is deferred until the user asks. Both surfaces use the bracket names.

**Dispatch order (LOCKED):** `hold_type === 'leverage'` MUST come before the `strength_type === 'isometric'` branch (leverage holds ARE isometric) — both mobile + web. On mobile the generic family dispatcher (`StrengthDetailRoute`: parent row + ≥2 children → `FamilyConsolidatedDetail`) sits ahead of the per-movement leverage branch, so a leverage *parent* consolidates while a leverage *child / standalone* still routes to `LeverageHoldDetail`.

---

## Loadable hold detail card (Layout 12) — locked design spec

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

## Assisted Machine detail card — locked design spec

This is the spec for the detail page that covers **assisted (weight-reducing) machine movements** — `movements.equipment === 'assisted'` — Assisted Pull-up, Assisted Dip, Assisted Chin-up, etc. The machine provides a counterweight that *reduces* the user's effective bodyweight. Progression is measured in **how little assistance the user needs**, with the eventual goal of 0 (graduate to the unassisted bodyweight variant). (Coach mirror: `AdminStrengthAssistedDetail.jsx`.)

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

The shared formula update (locked simultaneously): `estimate1RM` and `projectAllRMs` in both `web/src/lib/formulas.js` (web) and `mobile/src/lib/formulas.ts` (mobile) drop Brzycki when `reps > 10` and average only Epley + Lombardi. Brzycki's linear assumption under-projects high-rep loads relative to NSCA reference tables; the cap fixes that. This change also affects the 15RM / 20RM tiles on weighted-detail pages — expected ~3-4 percentage-point increase.

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

## Carry detail card — locked design spec

This is the spec for the detail page that covers **loaded carry movements** — `movements.equipment === 'carry'` — Farmer's Carry, Kettlebell Farmer's Carry, Single Arm Farmer's Carry, Suitcase Carry, Yoke Carry, Kettlebell Overhead Carry, Single Arm Overhead Carry, and the strongman-object carries (Atlas Stone Bear Hug, D-Ball Bear Hug, Husafell Stone, Keg, Sandbag, Shield, Sled Work [Push], Sled Work [Drag]). Progression is tracked along TWO axes simultaneously: **weight per hand / per implement** AND **distance traveled** (meters or feet, normalized to meters internally). (Coach mirror: `AdminStrengthCarryDetail.jsx`.)

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
   - Zone pill row (swipeable, 3 zones, same chevron-pulse pattern as weighted — see animation-patterns.md, Pattern 3 + 4): `MAX LOAD` / `DISTANCE BUILD` (default) / `CONDITIONING`. Swipe / tap navigates between zones. Each zone has its own recommended `(target_distance, weight_modifier)` profile.

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
- The single-axis weight-only chart. Replaced by the single **Total work** chart (see item 5).
