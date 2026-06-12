# Cardio Detail-Card Specs (Locked)

Locked design specifications for every cardio detail/coaching surface in MyRX mobile — the per-activity progression pages on `mobile/app/(app)/effort/cardio/[activity].tsx` (pace zones, ergs, rucking, stairmill, air bike, swimming).

> Animation mechanics (TickerNumber, AnimateRise cascade, chevron pulse, swipe choreography, FadeInUp/FadeOutUp info panels) are documented once in `docs/context/animation-patterns.md`. This file points to those patterns and keeps only what is cardio-specific.

---

## Cardio coaching-surface detail card (Group A — Endurance Athletes)

This is the spec for the detail page that covers **cardio movements** on `[activity].tsx` (mobile). Cardio v1 promotes from tracking surface to coaching surface, matching strength's depth.

### Three movement groups (May 2026 lock, revised after non-cardio cleanup)

Not every cardio movement fits the same progression model. The user explicitly rejected forcing one framework onto everything during the design lock. A subsequent cleanup (May 17 2026) removed 10 activities from cardio entirely — Walking, Walking (Treadmill), Hiking, Rowing (Open Water), Canoeing, Kayaking, Stand Up Paddleboarding, Inline Skating, Ice Skating, and Stair Climb (outdoor). Those are **recreational / lifestyle activities**, not cardio training surfaces — the user does them for transport, leisure, or outdoor enjoyment rather than to deliberately improve cardio fitness, so any coaching prescription would feel condescending. They might come back as a separate "activity log" surface later; they don't belong in the cardio coaching list.

| Group | Activities | Detail page treatment |
|-------|------------|----------------------|
| **A — Endurance Athletes** | Running, Running (Treadmill), Cycling, Stationary Bike, Bike Erg, Air Bike, Row Erg, Ski Erg, Swimming, Elliptical | Full **progression plan** with Endurance/Threshold/VO2 zones (this spec) |
| **B — Different framework needed** | Rucking | Cardio category but pace zones don't fit. Rucking progresses on load + distance (carry-like, not pace). Uses a carry-style 3-zone surface (Max Load / Distance Build / Conditioning) instead of pace zones. May 19 2026 removed Hill Running / Trail Running / Cycling (Mountain Bike) / Skiing entirely — terrain or technique confounds pace, recreational use for most users, and we can't coach honestly without HR integration. |
| **C — Step-Based Machines** | StairMill | Floors-per-minute coaching surface (rate-anchored, mirrors Air Bike's architecture but uses floors-per-minute as the rate metric). See "StairMill detail card" below. |

This spec covers **Group A only.** Group B's Rucking gets a carry-style 3-zone surface (see "Rucking detail card" below). Group C (StairMill) gets a floors-per-minute rate-anchored 3-zone surface (see "StairMill detail card" below).

Determined in code by `isEnduranceAthleteActivity(activityName)` → returns true for Group A categories.

**Two cardio modes still exist underneath** (`cardio_mode = 'pace'` vs `'duration'`), but Group A is all pace mode. Duration mode is Group C only, and routes to its own StairMillDetail coaching surface (short-circuits before the generic DurationDetail).

### Adaptation zones (3 zones, locked May 2026)

The 5-zone HR model is still the underlying science, but the app exposes only the three zones that actually drive progression. **Recovery (Z1) is not training — it's the absence of training, and we don't program rest days for users.** **Tempo (Z3) is what polarized-training research calls "no man's land" — too hard to be efficient aerobic base, too easy to drive lactate-clearance or VO2 max adaptations.** Both dropped from the UI. This also gives perfect 1:1 parity with strength's 3-zone adp model (Strength / Hypertrophy / Endurance → Endurance / Threshold / VO2 Max).

| Zone | Label | %HRmax | Adaptation focus |
|------|-------|--------|------------------|
| Z2 | ENDURANCE | 60–70% | Mitochondrial density, capillary network, fat oxidation. The foundation of all endurance — 70–80% of total training volume per polarized model. |
| Z4 | THRESHOLD | 80–90% | Lactate clearance — the body learns to process lactate faster. THE pace that improves 5K–half marathon times most directly. 1–2 sessions per week max. |
| Z5 | VO2 MAX | 90–100% | Maximum oxygen uptake — your engine ceiling. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between. |

**Science backing (locked):** ACSM *Guidelines for Exercise Testing and Prescription* (12th ed., 2025); Karvonen, Kentala & Mustala (1957) for HR-reserve methodology; Jack Daniels' *Running Formula* (3rd ed., 2014) for VDOT-to-zone mapping; Garmin / Polar / Suunto / Apple Watch all default to the same 5-zone model. The 50/60/70/80/90% HRmax boundaries are the global standard, not novel.

Until heart-rate integration lands (Phase 2 — via Apple Health / Strava / Garmin / Polar), zones derive from **pace as the proxy**, anchored on the user's **Critical Speed** with the offsets below. Once HR data is available, zones recalibrate from actual HR.

### Per-zone pace formula (pace mode)

**Anchor — Critical Speed (UPDATED June 2026, T088).** `Panchor` is the user's **Critical Speed** pace, not their single fastest effort. `criticalSpeedPaceSecsPerKm(efforts)` fits a least-squares line of time-vs-distance across the fastest effort at each DISTINCT logged distance; the slope (distance in km) IS the CS pace in s/km. With <2 distinct distances logged it falls back to the fastest pace `Pbest`. *Why:* a single fastest pace is usually a short, anaerobic-heavy effort, so anchoring zones on it made every prescription too hard; CS is the honest sustainable-threshold anchor. Only the zone PRESCRIPTIONS use `Panchor` — the "Best pace —" header subtitle + the chart PB reference line still show the actual fastest `Pbest`. Mobile `[activity].tsx` PaceDetail + web `AdminCardioPaceDetail.jsx` (BeatYourBest is untouched — it has no zone plan queue).

| Zone | Target pace offset (running, /km) | Notes |
|------|-----------------------------------|-------|
| Z2 | `Panchor + 60 s/km` | conversational, aerobic base |
| Z4 | `Panchor + 10 s/km` | ≈ 10K race pace, "comfortably hard sustained" |
| Z5 | `Panchor − 15 s/km` | ≈ 3K race pace, "max sustainable" |

Offsets scale to the activity's pace units (km or mi) and are applied **uniformly across modalities** today (running, cycling, ergs, elliptical). The audit's other half — per-modality power/HR zones (power for ergs/bike, HR/RPE for elliptical) — is **DEFERRED to V2** (it needs the HR/power data the Phase-2 wearable integrations will provide). Riegel projection (`projectPaces` in `formulas.ts`) still handles cross-distance pace mapping for the tiles.

### Per-zone session prescription (the hero card cue)

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

### Layout — single page, top to bottom (locked)

1. **Header** — back chevron + movement name + best-effort subtitle.
   - Pace mode: `Best pace — 4:30 /km · 5K` (`TickerNumber` on the pace value).
   - Duration mode: `Best — 30 min`.
   - Activity-type chip below header (e.g. `RUNNING`, `CYCLING`, `ROWING`, `BATTLE ROPES`).

2. **Progression plan card** (wrapper card, replaces the earlier "Adaptation zone" card):
   - `<h2>Progression plan</h2>`
   - Help text: `Your next step is below. After that, here's what's coming up.`
   - **NO ZONE PILL ROW.** The earlier swipe-pill design let the user pick the zone, but the user explicitly rejected that approach during the May 2026 lock — *"the system should pick what's next, not me"*. The plan generator decides the zone for each step. Zone info is still discoverable via the info pill on the hero card's top-right.
   - **NO TILE ROW for distance selection.** Distance/duration is locked per `(activity, zone)` in `PACE_ZONE_SESSIONS`. The user picks a movement and follows the plan; they don't pick distances.
   - **NEXT STEP hero card** — same `min-h-[220px]` amber-chrome layout as before. Background `withAlpha(palette.amber[500], 0.08)`, border `withAlpha(palette.amber[500], 0.30)`, title `palette.amber[400]`. Title reads `NEXT STEP` (was `YOUR NEXT TRAINING TARGET`):
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
   | StairMill (duration) | 10 min | 25 min | 15 min | 4 × 3 min | 5 × 90 s |
   | Arc Trainer (duration) | 15 min | 30 min | 20 min | 4 × 3.5 min | 5 × 2 min |

   **No activity prescribes anything close to event distances** — no marathon, no 100 km bike, no half-Ironman swim. The largest single-session prescription is 25 km on outdoor cycling. The product philosophy is "push you to become better at the science-backed adaptation that matters", not "chase distance records you'll never train for".

3. **Why-this-zone info panel** — inline expandable, toggled by tapping the zone info pill on the current-step hero. Auto-closes when the plan queue regenerates. Same pattern as strength's adp-zone info panel (see `docs/context/animation-patterns.md`, Pattern 5). Each zone has a `whyText` field in `CARDIO_ZONE_CONFIG`:
   - **ENDURANCE**: *"Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine. Stay disciplined and conversational; resist the urge to push."*
   - **THRESHOLD**: *"The single most productive zone for race times from 5K to half marathon. Cruise intervals teach your body to clear lactate faster, raising the speed you can sustain. 1–2 sessions per week max."*
   - **VO2 MAX**: *"Top-end stress. Short intervals at max sustainable effort build VO2 max — your engine ceiling — and pull every zone below up with them. The most direct stimulus for mile and 5K race-pace adaptation. 1 session per week with full recovery between."*

### Plan-queue generator (LOCKED)

`generatePlanQueue(activity, efforts, bestPace, distUnit, count=8)` in `[activity].tsx`. Pure function of training history. Walks polarized-training rules to build a sequence of upcoming zones:

1. **No hard back-to-back** — after a Threshold or VO2 step, next is Endurance.
2. **Don't let VO2 go stale** — if 10+ days since last Z5, next non-recovery step is VO2.
3. **Don't let Threshold go stale** — if 7+ days since last Z4, next non-recovery step is Threshold.
4. **Anti-stagnation interleave** — after 3 Endurance steps in a row, insert a hard step (alternates T/V).
5. **Default: Endurance** — produces the ~80% Endurance / 20% T+V polarized split (Stephen Seiler's research).

The queue is **never stored**. Logging a new effort updates `bestPaceSecs` and recency tracking, which regenerates a different queue on next render. The plan adapts continuously.

### Encouraging language (LOCKED across the cardio progression UI)

No "missed pace", no "off-script", no "incomplete". Replacements:
- `Welcome back — let's pick up where you left off.` (instead of "plan stale")
- `Same step is still your next one — no rush.` (instead of "incomplete")
- `Solid effort. Same step next time — your body's building toward it.` (instead of "missed pace, try again")
- `Got a session in — adjusting your plan around it.` (instead of "off-script training")
- `Finish your current step first — this one's queued up after.` (preview-tile note)

Voice: a coach who trusts the athlete. Never punitive. Always assumes the user is doing their best.

4. **Progress chart** — existing `LineChart` component. Pace mode: Y-axis reversed (lower pace = better progress). Duration mode: standard Y-axis (higher = better). Dashed line = personal best. Unchanged from today.

5. **Log list** — efforts history, swipe-to-delete. Same row format as today.

### Color theme (locked)

**Cardio is amber end-to-end.** Zone pill / chevrons / tile highlights / hero values / hero chrome / hero title / info panel border — all `palette.amber[400]` and `palette.amber[500]`. Strength keeps its blue theme, cardio keeps amber. The two domains are distinguished at a glance by their accent color — DO NOT use blue chrome on cardio's hero card. This was an explicit user instruction during the May 2026 lock; a prior draft of this spec mistakenly proposed blue chrome for parity with strength's "next target" badge, and the user correctly rejected it.

### Animation conventions

Carried over from strength with no deviation — big pace/duration number uses TickerNumber; info panel uses FadeInUp/FadeOutUp + sibling LinearTransition; zone-pill swipe choreography matches strength exactly. See `docs/context/animation-patterns.md` (TickerNumber = Pattern 2, info panel = Pattern 5, pill swipe = Pattern 4, chevron pulse = Pattern 3).

### Movements supported (locked, May 2026)

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

**Final cardio movements list (15 DB rows, 12 visible activities — May 19 2026 lock, after recreational/terrain-confounded cleanup + swim stroke consolidation):** Air Bike, Bike Erg, Cycling, Elliptical, Row Erg, Rucking, Running, Running (Treadmill), Ski Erg, StairMill, Stationary Bike, **Swimming [Freestyle], Swimming [Backstroke], Swimming [Breaststroke], Swimming [Butterfly]**. The 4 Swimming stroke variants collapse into a single "Swimming" row in the cardio index (so the user-visible activity count is 12 even though the movements table has 15 rows). See "Swimming detail card" further down for the consolidation architecture.

**Removed from cardio (May 17–19 2026, three passes):**
- **Pass 1 (recreational/lifestyle — not cardio training):** Walking, Walking (Treadmill), Hiking, Stair Climb (outdoor), Rowing (Open Water), Canoeing, Kayaking, Stand Up Paddleboarding, Inline Skating, Ice Skating. Rationale: transport, leisure, or outdoor activities — the user doesn't pick them with intent to improve cardio fitness, intensity isn't deliberately modulated, and a coaching prescription would be condescending. May come back as part of a separate "activity log" surface (where lifestyle movement counts toward weekly minutes / calories / streaks without a coaching layer).
- **Pass 2 (niche-equipment / niche-user — low coverage value):** Aqua Jogging (rehab-only cross-training for injured runners; tiny user base), Roller Skiing (off-season training tool for competitive Nordic skiers only; <1% of any realistic user base), Arc Trainer (Cybex-brand machine found in ~30% of commercial gyms; most users encounter Elliptical or StairMill instead). Rationale: niche enough that removing them costs essentially no coverage and simplifies the catalog.
- **Pass 3 (terrain-confounded / recreational + can't coach honestly without HR — May 19 2026):** Skiing (outdoor XC — snow conditions + terrain + technique confound pace, niche audience, seasonal — can't coach honestly without HR + lactate calibration), Hill Running (gradient confounds pace), Trail Running (single-track terrain confounds pace, recreational for most users), Cycling (Mountain Bike) (technical terrain confounds pace, can't coach intervals honestly without HR or power telemetry). Rationale per the May 19 audit: a strict coaching-and-progression app shouldn't display a coaching prescription it can't validate. These activities have no scientifically valid v1 coaching path with the data we have access to.

**Earlier May 2026 cleanup** also moved `Sandbag Carry`, `Sled Pull`, and `Sled Push` to strength — they're loaded carries, not endurance/lifestyle movement. See Sled Work note in the strength Carry detail spec.

The mirror update lives in: the Supabase `movements` table (single source of truth for mobile) and `mobile/app/(app)/effort/cardio/[activity].tsx` (`categorizeActivity` regex, `PACE_ZONE_SESSIONS` keys, `DURATION_ZONE_SESSIONS` keys), plus `mobile/src/lib/movements.ts` (`SPEED_INPUT_ACTIVITIES` set + `SPEED_MAX_KMH` map). After Pass 3 the `categorizeActivity` regex no longer maps `skiing` (the outdoor activity) to `ski_erg`; only `ski erg` itself matches that category. `web/src/lib/movements.js` is kept in sync where practical, but web is frozen per the May 12 2026 lock so minor drift is allowed.

### Out of v1 scope (deferred, locked)

- **RPE rating field** on log form — adds no value to zone calculations (pace IS the zone proxy until HR lands). Revisit if coaches request it after the coaching surface is live.
- **Notes field** on log form — pure UX, defer.
- **Per-session calorie auto-estimation** — handled inside the upcoming Calories page overhaul (separate conversation).
- **Heart rate via integration** (Apple Health / Strava / Garmin / Polar) — Phase 2. When it lands, zones recalibrate automatically from actual HR data.

**What's removed from the previous PaceDetail / DurationDetail design:**
- The single "Your next training target" callout that prescribed only a pace at a distance with no session structure, no rest cue, no why explanation. Replaced by the zone-aware hero card with full Daniels-style prescription.
- The implicit "always train at race pace" model. Replaced by 5 explicit adaptation zones, each with its own pace target and session format.

---

## Concept2 ergs (Row Erg / Bike Erg / Ski Erg) — locked design spec (May 19 2026)

All three Concept2 PM5-powered ergs share the same flywheel mechanics, the same display console, and the same coaching surface in MyRX. They route through the generic `PaceDetail` component with shared erg-aware branching — NOT three separate components — because the pace-zone framework (Endurance / Threshold / VO2 Max) fits all three identically. What differs is per-activity labels and rest-cue verbs, handled inline via `isRowErgActivity` / `isConcept2ErgActivity` predicates.

### 1. Distance display rule (LOCKED — applies to all 3 ergs)

Distance ALWAYS renders in metric, regardless of the user's `distance_unit` profile preference. The PM5 console is universally metric worldwide; Concept2 athletes (rowers, OCR competitors, Crossfitters, swimmers cross-training) think in meters and kilometers regardless of locale.

- `<1 km` → integer meters (`"500 m"`, `"999 m"`)
- `≥1 km` → km with sensible precision (`"1.5 km"`, `"5 km"`, `"10 km"`). Trailing zeros stripped: `5.00 km` reads as `5 km`; `1.50 km` reads as `1.5 km`.

Implemented in `fmtDistForActivity(activity, distKm, distUnit)` which short-circuits on `isConcept2ErgActivity(activity)` and ignores `distUnit` entirely.

### 2. Pace display rule (LOCKED)

Pace renders as **split per 500m** — the canonical Concept2 metric across all three ergs. Storage stays in seconds-per-km for cross-cardio uniformity; the per-500m is a display-layer transform via `pacePer500mFromSecsPerKm(secsPerKm)` (divides by 2 and formats as `m:ss/500m`).

- Header subtitle: `Best — m:ss/500m · NNN W` (split AND watts, side by side, both `TickerNumber`-animated).
- Chart Y-axis labels, tooltip values, log-list right-side metric — all per-500m.
- The word "Pace" doesn't appear on erg surfaces; "Best —" replaces "Best pace —".

### 3. Watts↔pace formula (LOCKED — verified against Concept2's published table)

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

### 4. Hero card — 4 rows for ergs (LOCKED)

The PaceDetail hero card renders 4 stacked TickerNumber rows for Concept2 ergs ONLY (1 extra row vs. the generic 3-row hero):

1. **Workout goal** — `8 km` (continuous) or `5 × 600 m` (interval). Big amber, fontSize 30.
2. **Time** — `:30` per interval or `37:30` total. Descriptor "to complete" or "per interval".
3. **Checkpoint assist** — sub-distance pacing reading (e.g. "`200 m` at 50 sec / `500 m` at 2:05 / `1 km` at 4:10"). The user reads this mid-rep on the PM5 to verify they haven't drifted off target pace. Hidden when the rep is too short (<500m) to benefit from a checkpoint.
4. **Watts target** — `203 W`, derived from the prescribed zone pace via the Concept2 formula. Descriptor "watts target".

Row 4 is hidden on every non-erg activity. Conditional via `selectedStep.ergWattsTarget != null`. Same `TickerNumber` styling as the other 3 rows.

**Why 4 rows and not 3:** the PM5 displays BOTH pace and watts simultaneously on its console. A coach prescribing erg work always gives both. Forcing the user to mentally derive one from the other defeats the point of the coaching surface — the watts target is a direct PM5-readable number, not a derivation.

### 5. Cue line construction (LOCKED)

The cue does NOT mention watts (watts lives on Row 4). The cue focuses on workout structure + checkpoint pacing. For Row Erg specifically, "pace" is replaced with "split" and the per-500m split is referenced inline:

- Endurance continuous (Row Erg): `"Row 5 km in 25:00 at a steady 2:30/500m split — aim for 2:30 at 500 m."`
- Threshold interval (Row Erg): `"Row 4 × 1 km at 2:05/500m split (4:10 each)."`
- Endurance continuous (Bike Erg / Ski Erg): `"Pedal 15 km in 45:00 at steady conversation pace — aim for 4:00 at 1 km."`
- Threshold interval (Bike Erg / Ski Erg): `"Glide 4 × 1 km in 4:10 each — aim for 2:05 at 500 m."`

Verb is activity-aware: `Row` for Row Erg, `Pedal` for Bike Erg, `Glide` for Ski Erg.

### 6. Rest cue verb (LOCKED)

- **Row Erg**: `"Paddle easy 60 sec between cruise intervals"` / `"Equal-time paddle recovery between intervals"`. Rowers paddle easy between reps, they don't jog.
- **Bike Erg / Ski Erg**: `"Easy pedal 60 sec between cruise intervals"` (bike) / `"Easy glide 60 sec between cruise intervals"` (ski). Activity-verb interpolated from `getActivityVerb`.

### 7. Adaptation zones (LOCKED — Daniels' offsets applied uniformly across all 3 ergs)

| Zone | Pace offset (sec/km) | Effect on a 200 W rower (~2:00/500m best) |
|------|----------------------|-------------------------------------------|
| Endurance | +60 | ~2:30/500m, ~104 W |
| Threshold | +10 | ~2:05/500m, ~179 W |
| VO2 Max | −15 | ~1:52.5/500m, ~247 W |

These watts fall within ±10% of published Concept2 zone watts (UT2/AT/AN) for an athlete with the same baseline. The Daniels' running offsets translate to rowing/cycling/skiing power zones cleanly because of the cubic pace↔watts relationship — small pace changes produce zone-appropriate watts changes.

**Why Daniels' offsets instead of Concept2's UT2/UT1/AT/TR/AN naming:** modern polarized coaching has converged on 3-zone (Endurance / Threshold / VO2) across endurance disciplines (Stephen Seiler, Iñigo San Millán, Norwegian sprint method). MyRX uses E/T/V uniformly across running, swimming, cycling, AND ergs so the user learns ONE zone model. Concept2's 5-zone naming is an old rowing-specific convention.

### 8. Canonical session distances per zone (LOCKED — `PACE_ZONE_SESSIONS`)

Row Erg:
- Endurance: 2K, 5K, 10K (2K is the test distance; 5K is the standard medium piece; 10K is the long piece)
- Threshold: 4×500m, 5×1000m (canonical T-pace test sets used at every level from masters to Olympic prep)
- VO2 Max: 6×500m, 8×500m (Norwegian sprint sets; 8×500m is widely benchmarked)

Bike Erg / Ski Erg: shares the same `rowing` entry in `PACE_ZONE_SESSIONS` (because the distances translate cleanly — a 5K row, a 5K bike erg, and a 5K ski erg are all roughly 20-25 min steady-state efforts at the same fitness level).

### 9. Limitations + deferred (out of v1 scope)

- **`bestPaceSecs` anchoring** assumes the user's best logged pace ≈ their 5K race pace. If they only logged a 500m sprint or a 60-min steady, offsets produce slightly skewed zone targets. Same limitation exists across every pace activity in the system — not erg-specific. Acceptable for advisory coaching.
- **Stroke rate (SPM)** — Concept2 PM5 displays stroke rate alongside split. v2.
- **Drag factor** — Concept2 setting that affects perceived effort. Out of scope; users self-set this on the machine.
- **2K benchmark test mode** — the canonical rowing/erg benchmark. Would warrant a dedicated "test mode" log entry + benchmark tracking on the detail page. v2.
- **Watts-based logging** — currently we derive watts from pace. If the user logs an interval session, they don't enter watts directly; the system computes them from pace. v2 if users ask.
- **Sport-specific bike/ski erg movements** — Bike Erg is sometimes set up for HIIT-style "max calories in 60 sec" tests; Ski Erg has "100m sprint" benchmark sets. v2.

### 10. Implementation summary (LOCKED — what NOT to refactor)

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

## Rucking detail card — locked design spec (May 19 2026)

Rucking sits on the **cardio tab** by activity-tab placement but its progression model is **carry-like**, not pace-like. You get better at rucking by carrying HEAVIER or going FARTHER, not by getting FASTER. Pace is too sensitive to load and terrain to be a useful coaching anchor — a 35 lb × 3 mi ruck at 18:00/mi is a harder session than the same person walking 3 mi at 14:00/mi with no pack, and pace doesn't capture that.

The detail page mirrors **Atlas Stone Bear Hug Carry's abs-mode CarryDetail** top to bottom — same hero card shape, same 4-tier ladder, same 3 adaptation zones. Same as Atlas was built kg-only, Rucking is built **lb-only**: the GoRuck / US tactical-fitness community is universally imperial, and any conversion would lose recognition of canonical benchmark weights (35 lb = GoRuck Tough). Distance is locked to miles for the same reason.

### Unit locks (LOCKED)

- Distance → **miles** via `movements.unit_lock = 'mi'` on the Rucking row.
- Pack weight → **pounds**, hard-coded in `RuckingDetail` and the cardio log form. The `unit_lock` column only holds ONE unit, so the weight-lock lives in code.

### Tier ladder (LOCKED — `RUCK_TIER_THRESHOLDS`)

Stepped down from the GoRuck event ladder. TOUGH = the GoRuck Tough standard exactly (35 lb × 12 mi). Beginner / Intermediate / Advanced are sub-Tough progression stops. We don't include GoRuck Heavy (45 lb × 20 mi) or Selection (35 lb × 40 mi) because they require multi-hour sessions that exceed the app's 45-min session philosophy.

| Tier | Pack weight (lb) | Distance (mi) |
|------|------------------|---------------|
| BEGINNER | 10 | 2 |
| INTERMEDIATE | 20 | 4 |
| ADVANCED | 30 | 8 |
| TOUGH | 35 | 12 |

Qualification: a single effort must meet BOTH thresholds simultaneously (NOT cumulative across efforts). User's "current tier" is the highest tier they've cleared.

### Weight ladder (LOCKED — `RUCK_WEIGHT_LADDER_LB`)

```
[10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]
```

Common GoRuck Sand Plate sizes (10 / 20 / 30 / 45 lb), Rogue Echo plate sizes (10 / 15 / 20 / 25 / 30 / 35 / 40 / 45 lb), and realistic stacked combinations. MAX LOAD and CONDITIONING zone math snap to ladder rungs so prescriptions correspond to plates the user can actually load.

**Pack-weight soft safety cap (LOCKED — June 2026):** the log form (`cardio.tsx`, `isRuckMode`) shows a **soft amber warning** (never a hard block) the moment the entered pack exceeds **~1/3 of the user's bodyweight** — the common safe-load ceiling for sustained loaded carries. Copy: *"Heads up: N lb is X% of your bodyweight. Rucking guidance keeps loaded carries near a third of bodyweight, so build up to this gradually."* Bodyweight comes from `profile.current_weight`, converted to lb (pack is lb-locked). It does NOT cap the wheel — the user can still log a real heavy ruck (data integrity). Mobile-only (web end-user log form is frozen; the coach view is read-only).

**Tiers stay ABSOLUTE (verify-first, June 2026):** a T088 audit claimed the tiers were mislabeled and should be bodyweight-relative — both refuted on inspection. Our tiers match the official GoRuck standard exactly (Light 20 / Tough 35 / Heavy 45 lb), which is **absolute** worldwide, so they are NOT scaled to bodyweight. The bodyweight relationship lives only in the soft safety cap above, as a separate guardrail.

### Adaptation zones (LOCKED — mirror Carry's exactly)

| Zone | Weight target | Distance target |
|------|---------------|-----------------|
| MAX LOAD | `nextLadderAbove(bestWeight)` or `bestWeight` | `bestDist` |
| DISTANCE BUILD | `bestWeight` | `bestDist + 1 mi` |
| CONDITIONING | `snapDownToLadder(bestWeight × 0.60)` | `bestDist × 2` |

Each zone pushes ONE axis (or two for conditioning) anchored on the user's PB. Hero card renders the target + a delta string vs. the user's best (`+ 5 lb`, `same as your best`, `+ 1 mi`, etc.).

### Effort label format (LOCKED)

Current format with pack weight:
```
Rucking · 35 lb × 2.5 mi in 45:00
```

Legacy format (pre-May-19-2026, no weight column on log form) — still parses, treated as `packLb = 0`:
```
Rucking · 2.5 mi in 45:00
```

`parseRuckLabel` handles both shapes. Users who logged before this spec see their old efforts at packLb = 0 (effectively bodyweight rucking).

### Layout — single page, top to bottom (LOCKED)

1. **Header**: back chevron + "Rucking" h1 + subtitle `Best — N lb · N mi · TIER`. Both numbers `TickerNumber`-animated; tier label in amber.
2. **Adaptation zone card** (`<AnimateRise delay={0}>`):
   - Title "Adaptation zone" + help text "Pick a training focus, then aim at the next target."
   - **Zone pill row** — single amber pill flanked by pulsing chevrons. Same chevron animation + swipe choreography as Air Bike's zone pill and Carry's adaptation zone pill (see `docs/context/animation-patterns.md`, Patterns 3 + 4).
   - **Hero card** (amber chrome): top-right info pill + 2 stacked `TickerNumber` rows (weight target + distance target with delta strings) + thin separator + cue line.
3. **Progress chart** (`<AnimateRise delay={500}>`): single **Total work** line chart — metric = `pack weight × distance` per effort, plotted over time. Replaces the earlier two-chart (pack weight + distance) layout, same reason as Carry (a distance-only PR was invisible on a weight-only graph). PB dashed line = best total work; a heavier-but-shorter ruck can read lower (less total work) — expected, not a regression. The hero targets + log list keep the per-axis breakdown. Same on athlete mobile + coach web (AdminCardioRuckingDetail) + the coach Efforts card. Label is "**Total work**", not "Workload" (see the Carry chart terminology lock).
4. **Log list** (`<AnimateRise delay={500}>`): each row shows the workout shape on the left (`35 lb × 2.5 mi`) and wall-clock time on the right.

### Header tags (LOCKED — mirrors strength's equipment-pill convention)

Below the "Best —" subtitle row, two stacked badges:
1. **Category pill**: `RUCKING` — same chrome as every other cardio detail page's category tag (small amber `s.categoryBadge`).
2. **Tier pill**: `BEGINNER` / `INTERMEDIATE` / `ADVANCED` / `TOUGH` — same chrome, only rendered when the user's logged efforts clear a tier.

Both pills use the same amber-tinted `s.categoryBadge` style so they read as stacked tags. The tier pill explicitly mirrors Atlas Stone Bear Hug Carry's tier badge below its CARRY pill — same visual pattern, just amber instead of blue.

**No in-app tier ladder card.** An earlier draft included a "Rucking tiers" card with all four tiers, criteria, and achievement checkmarks. Removed May 19 2026 — the rucking community already knows the GoRuck tier scale, so the card was redundant chrome. The user's current tier still surfaces as the small TIER pill in the header.

### Cardio log form changes (`cardio.tsx`)

When `isRuckMode = isRuckingActivity(activity)`, the pace-mode triple-grid is replaced with a **3-wheel layout**: `Pack Weight | Distance | Time`. Pack Weight is integer-lb with step 5, range 0–150. Distance is decimal `XX.X` mi (locked, no toggle). Time stays `mm:ss`. Both Pack Weight and Distance render with inline unit suffixes — no separate Unit chip column.

Live chip below the grid shows `Ruck — N lb × N mi` (the two-axis headline metric) and a secondary `Pace — m:ss/mi` chip (derived read-only). Pace is shown but not stored as the primary metric.

### Components / helpers (LOCKED)

- `mobile/src/lib/movements.ts`: `RUCKING_ACTIVITY = 'Rucking'`, `isRuckingActivity(name)`.
- `mobile/app/(app)/effort/cardio/[activity].tsx`: `RuckTier`, `RUCK_TIER_*`, `RUCK_ZONE_*`, `RUCK_WEIGHT_LADDER_LB`, `parseRuckLabel`, `classifyRuckTier`, `snapDownToRuckLadder`, `nextRuckLadderAbove`, `RuckingDetail` component.
- `cardio.tsx`: `isRuckMode` + `packWeightValue` state + Pack Weight wheel + rucking-aware save label.
- Dispatch in `CardioDetail` checks `isRuckingActivity(activity)` AFTER the air-bike check and BEFORE swim/beat-your-best/PaceDetail.

### Out of v1 scope (deferred)

- **Terrain factor** (hill vs. flat) — affects difficulty. v2 when GPS integration lands.
- **Elevation gain** — same as terrain. v2.
- **Pack type / fit metrics** — out of scope; user logs the pack weight only.
- **HR-zone integration** — would refine which adaptation zone the user actually trained. Phase 2 alongside running's HR upgrade.
- **GoRuck Heavy / Selection tiers** — multi-hour sessions exceed the app's 45-min philosophy. Deferred.

---

## StairMill detail card — locked design spec (May 19 2026)

The StairMaster Step Mill is one of the highest-MET sustainable cardio machines (~8–12 METs at moderate-to-vigorous effort). Coaching surface mirrors **Air Bike's rate-anchored architecture** line-for-line: a single rate metric — **floors per minute (FPM)** — anchors three zones (ENDURANCE / THRESHOLD / VO2 MAX). Same mental model the user already learned from running, swimming, ergs, and air bike.

**Why FPM as the rate anchor:** every Step Mill console displays FLOORS as the most prominent number. The user reads it off without thinking. FPM = `total_floors ÷ total_time_minutes`. Each zone's prescription scales linearly with peak FPM so a faster climber gets bigger floor targets per rep (wall-clock per rep stays roughly the same).

### Science backing (LOCKED — same citation rule as Air Bike, real research only)

| Zone | Protocol source | Key finding |
|------|-----------------|-------------|
| **VO2 MAX** | Allison et al. (2017) *Med Sci Sports Exerc* | 3 × 20-sec all-out stair climbs, 3×/week → **+12% VO2peak in 6 weeks**. Drives the VO2 zone protocol (extended to 60-sec reps for Step Mill console pacing). |
| **THRESHOLD** | Interval research (Seiler 2010; Laursen & Jenkins 2002) + ACSM 12th ed | Hard 3-min intervals drive lactate-threshold adaptation. Drives the 4 × 3-min threshold protocol. (Was mis-cited to Honda 2014, a blood-glucose study — corrected June 2026.) |
| **ENDURANCE** | Boreham et al. (2000) *Prev Med* + ACSM 12th ed | Accumulated daily stair climbing improved VO2max ~17% in sedentary adults; ACSM backs the 20-min continuous vigorous block we actually prescribe. (Boreham's protocol was accumulated bouts, not one continuous session — clarified June 2026.) |
| Global framework | ACSM Guidelines 12th ed (2025) | Endorses stair climbing as vigorous-intensity (8+ METs) and supports 3-zone polarized programming across all endurance disciplines. |

### Three adaptation zones (LOCKED — `STAIRMILL_ZONE_CONFIG`)

| Zone | Reps × Duration | Intensity (% peak FPM) | Rest | Example for 12 FPM user |
|------|------------------|------------------------|------|--------------------------|
| **ENDURANCE** | 1 × 20 min continuous | 65% | n/a | ~160 floors total at 7.8 FPM |
| **THRESHOLD** | 4 × 3 min | 85% | 90 sec | 4 × 30 floors at 10.2 FPM |
| **VO2 MAX** | 3 × 60 sec | 110% | 3 min full recovery | 3 × 13 floors at 13.2 FPM |

VO2 zone allows above-peak intensity (110%) because short reps tolerate above-peak output. Zone names match every other cardio surface (running / swimming / ergs) — drops Air Bike's CrossFit-specific "SPRINT" naming because stair-climbing protocols use the standard exercise-science vocabulary.

### Cold-start baseline (LOCKED — `genderBaselineFloorsPerMin`)

Gender-aware, mirrors Air Bike's 18 / 13 / 15 cal/min pattern. Numbers derived from typical Stairmaster Gauntlet level 8-10 sustained output at moderate-vigorous effort:

- Male → 12 floors/min
- Everyone else (female, non-binary, prefer-not-to-say, unset) → 9 floors/min — the uniform "male / else=female" rule used across every gender-driven calc (see calorie `calcBMR`). (Code is `gender === 'male' ? 12 : 9`; the earlier "other → 10" averaging was retired May 23 2026.)

Replaced by user's actual peak FPM after their first logged effort.

### Effort label format (LOCKED)

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

### Layout — single page, top to bottom (LOCKED)

1. **Header**: back chevron + "StairMill" h1 + `Best — N.N floors/min` subtitle (or cold-start message). `STAIR CLIMBING` category pill below the subtitle.
2. **Progression plan card** (`<AnimateRise delay={0}>`): zone pill row with swipe gesture + 4-row hero card:
   - Row 1: workout shape (`160 floors` or `4 × 30 floors`)
   - Row 2: estimated wall-clock time (`20:00` or `3:00`)
   - Row 3: target FPM rate (`7.8 floors/min`)
   - Row 4: rest between reps (intervals only)
3. **Chart card** (`<AnimateRise delay={250}>`): FPM over time, Y-axis NOT reversed (higher = better, mirrors Air Bike — locked chart-direction rule).
4. **Log list** (`<AnimateRise delay={500}>`): each row shows floors + time on the left, derived FPM rate on the right.

**Attribution under the hero card:** `Floors-per-minute anchored zones · Allison protocol · ACSM`. Cites real research without explaining the formula (info-pill content rule — see `docs/context/animation-patterns.md`, Pattern 5).

### Cardio log form changes (`cardio.tsx`)

When `isStairMillMode = isStairMillActivity(activity)`, the duration-mode form swaps the single hh:mm:ss Duration wheel for a **two-column grid**: `Floors | Time`. Both wheels required (canSave guards on `floors > 0 && time > 0`). Floors is an integer wheel (step 1, range 0–500). Time stays `mm:ss`. Live chip shows derived `Climb rate — N.N floors/min`. Generic duration-mode activities (none currently — Arc Trainer was removed May 17) still use the single Duration wheel via the else-branch.

### Dispatch order (LOCKED)

StairMill's `cardio_mode = 'duration'` in the DB, but `CardioDetail` short-circuits BEFORE the generic `mode === 'duration'` route via an explicit `isStairMillActivity` check. Any future duration-mode activity that gets its own coaching surface should follow the same pattern.

### Components / helpers (LOCKED)

- `mobile/src/lib/movements.ts`: `STAIRMILL_ACTIVITY = 'StairMill'`, `isStairMillActivity`, `parseStairMillLabel`, `floorsPerMinFromEffort`, `genderBaselineFloorsPerMin`.
- `mobile/app/(app)/effort/cardio/[activity].tsx`: `StairMillZone`, `STAIRMILL_ZONE_ORDER`, `STAIRMILL_ZONE_CONFIG`, `buildStairMillZoneRx`, `getStairMillZoneCue`, `StairMillDetail` component.
- `mobile/app/(app)/cardio.tsx`: `isStairMillMode` + `floorsValue` state + Floors wheel + StairMill-aware save label.

### Out of v1 scope (deferred)

- **Resistance level (1–20)** — secondary intensity modulator on real Step Mills. Adds complexity to the log form without proportional coaching value (FPM already captures effort intensity). v2.
- **Tabata 20s/10s sets** — extreme HIIT prescription used in the original Allison protocol (20-sec reps). The Step Mill console's response time makes 20-sec reps hard to pace cleanly; we extended to 60-sec reps for v1. v2 with a dedicated "test mode".
- **Empire State Building Run-Up benchmark mode** — cultural benchmark (86 floors for time). Specialty feature, defer.
- **HR-zone integration** — would replace the FPM proxy with true HR zones. Phase 2 alongside running's HR upgrade.

---

## Air Bike detail card — locked design spec

This is the spec for the air-bike-native coaching surface on `[activity].tsx` (mobile) — fired when `isAirBikeActivity(activity)` (i.e. `activity === 'Air Bike'`). Routes to its own `AirBikeDetail` component rather than the generic `PaceDetail`, because air bike training mechanics are fundamentally different from running/cycling/etc:

1. **Training is programmed in CALORIES, not distance or pace.** Air bikes (Assault, Echo, Rogue, Schwinn Airdyne) are fan-resistance machines — effort is exponential, you cannot go "easy" because the fan punishes any sustained output. Real workouts: "8 × 10 cal sprint, 45s rest," "Tabata cals," "Death by Calories (1 cal min 1, 2 cal min 2, ...)," "100-cal test for time." Nobody trains air bike at "2.5 km steady-state pace" — that prescription doesn't exist in any real program.
2. **The user's training-anchor metric is CAL/MIN rate**, not pace. Computed as `total_cals ÷ total_time_min` from any logged effort. The user's "best" is the MAX rate across all their efforts — a single hard session sets the rate; longer easier sessions naturally show lower rates so the MAX stays at the peak.
3. **Zone names: AEROBIC / THRESHOLD / SPRINT**, not Endurance/Threshold/VO2 Max. CrossFit and HIIT coaching communities use these names for air bike work — "sprint" is significantly more associated with air bike than the generic "VO2 max" sports-science term. Threshold stays (the term spans every cardio discipline). Aerobic replaces Endurance because air bike's "easy" zone is still moderately taxing — "aerobic" reads more accurately than "endurance" for a 5-min steady ride.
4. **Three slots in HARDEST-FIRST order (per swipe Pattern 4):** SPRINT (slot 0) → THRESHOLD (slot 1) → AEROBIC (slot 2). Default landing on SPRINT — matches the universal "always slot 0" rule.

### Per-zone session prescriptions (LOCKED)

Each zone target = `peakCalsPerMin × duration × intensityFactor`, rounded to nearest whole calorie (the machine display is integer-only). Numbers below show a worked example for an intermediate-male user at 18 cal/min baseline.

| Zone | Duration (min/rep) | Intensity | Reps | Rest | 18 cal/min example |
|------|--------------------|-----------|------|------|---------------------|
| **SPRINT** | 0.5 | 100% | 8 | 45 sec | 8 × 9 cal max effort |
| **THRESHOLD** | 1.0 | 85% | 5 | 30 sec | 5 × 15 cal sustained hard |
| **AEROBIC** | 5.0 continuous | 65% | 1 | 0 | 59 cal continuous easy |

A faster user (e.g. 25 cal/min advanced) gets bigger targets: 8 × 13 cal sprints, 5 × 21 cal threshold, 81 cal aerobic. A slower user (e.g. 13 cal/min) gets smaller targets: 8 × 7 cal sprints, 5 × 11 cal threshold, 42 cal aerobic. The targets scale linearly with the rate so each rep stays roughly the same wall-clock duration regardless of fitness level.

### Cold-start (gender-aware baseline cal/min)

Users with no logged air bike efforts get bootstrapped with a gender-aware baseline so the zone prescriptions show reasonable starting targets:

- `profile.gender === 'male'` → 18 cal/min baseline (typical intermediate-male output on an Assault Bike at normal resistance)
- `profile.gender === 'female'` → 13 cal/min baseline (typical intermediate-female output — power-based scaling reflects average watt differences)
- Other / unset → 13 cal/min (same as female — the uniform "male / else=female" rule; code is `gender === 'male' ? 18 : 13`)

The baseline only affects the page on first visit. After the first logged effort, the user's actual `peakCalsPerMin` replaces the baseline (peak > 0 always takes precedence). The page header reads "No efforts logged yet · using N cal/min as a starting estimate" until the user logs their first effort.

### Layout — Pattern L4 (LOCKED, May 19 2026)

Air Bike uses Layout L4 from `docs/Layout Design.xlsx` (`In-frame variation swipe pill / Hero card / Consolidated chart and log`) — same shape as Carry's adp-zone surface, but with amber chrome (cardio theme) instead of blue (strength). The page is a single page, top to bottom:

1. **Header** — back chevron + "Air Bike" title + subtitle: `Best — N cal/min` (TickerNumber on the rate value). When no efforts: `No efforts logged yet · using N cal/min as a starting estimate`.
2. **Progression plan card** (`<AnimateRise delay={0}>`):
   - Title `Your progression plan` + helper text "Three zones to train, each anchored on your cal/min rate. Swipe the pill to switch zones."
   - **In-frame variation swipe pill** — single pill in the center showing the active zone (SPRINT / THRESHOLD / AEROBIC, hardest-first), flanked by pulsing amber chevrons (chevron pulse + swipe choreography — see `docs/context/animation-patterns.md`, Patterns 3 + 4). Pan gesture swipes between zones; chevron taps also navigate. Matches Carry's `carryZoneRow` pill exactly, just amber instead of blue.
   - **Hero card** (amber chrome): top-right info pill (zone label + Info icon, tappable for inline "why this zone" panel — Pattern 5). Two stacked TickerNumber rows:
     - Row 1 = work (`8 × 9 cal` for intervals, `59 cal` for continuous AEROBIC) — sub-text "the work"
     - Row 2 = estimated wall-clock time per rep (or total for AEROBIC) — sub-text "est. per interval" / "est. total"
   - Full coaching cue underneath the thin separator: the work + the rest interval, NO watts. e.g. SPRINT: `Sprint 9 cals as fast as you can. Rest 45 sec, repeat 8 times. Each interval should take about 30 sec.` AEROBIC (continuous): `Pedal 59 cals at a steady aerobic effort, about 5 min total.`
   - Attribution: `Cal/min anchored zones · gender-calibrated baseline`
   - **Watts overlay REMOVED (June 2026, T088 verify-first):** the old "hold ≥ X W" row derived `watts = cal/min × 17.4` (a generic ~25%-efficiency calc). That is NOT a published Assault/Echo/Rogue/Schwinn standard, and it doesn't match the Assault console's own watts readout — so a target the user couldn't validate against the machine was unactionable noise. Dropped from the hero rows, the cues, and the attribution; cal/min (on every console + our anchor) stands alone. A console-calibrated watts readout would need physical hardware testing — deferred.
3. **Chart** (`<AnimateRise delay={250}>`) — cal/min rate over time. **Y-axis NOT reversed** — higher rate = better progress = line trends UP. Distinct from pace charts where the Y-axis is reversed (lower = faster = trend down). Reference line at peak rate.
4. **Log list** (`<AnimateRise delay={500}>`) — each row shows the cal/min rate on the right.

### Wattage overlay — REMOVED (June 2026, T088 verify-first)

The page formerly derived a per-zone watts floor (`watts = cal/min × 17.4`, a generic ~25%-efficiency calc) and showed "hold ≥ X W". Dropped because: (1) `× 17.4` is NOT a published Assault/Echo/Rogue/Schwinn standard (the earlier "industry-standard conversion" claim was false); (2) it doesn't match the Assault console's own watts display, so the target was unverifiable mid-effort. Watts is gone from the hero rows, the cues, and the attribution. cal/min remains the sole anchor (it's on every console). Re-adding a console-calibrated watts readout would require physically measuring a specific machine — deferred. The `calsPerMinToWatts` helper was deleted from both `movements.ts` and the web mirror.

### Log form (`cardio.tsx`) — calorie-input mode (LOCKED)

When `activity === 'Air Bike'` (`isCalorieMode`):
- **Distance and Speed are dropped entirely** from the form. Calorie mode is a 2-column grid: **Calories | Time**. Both columns use `gridLarge` (flex 2.55, symmetric) since "150 cal" and "5:00" are similar widths.
- **Calories wheel**: INTEGER mode, step 1, min 0, max 300. Range covers a 100-cal benchmark test (single rep) up to a long aerobic session (~200+ cal). Step 1 matches the machine display's integer-only readout.
- **Time wheel**: standard `mm:ss`, max 99 minutes.
- **Live chip**: `Rate — N.N cal/min` (computed as `calsPerMinFromEffort(cals, timeSecs)`). One chip only, no pace / session-time chips.
- **Save label format**: `Air Bike · 50 cal in 5:00`. The bracketed activity name + period + cal count + time. `parseAirBikeLabel` on the read side extracts this back into `{cals, timeSecs}`.
- **Save value format**: `12.0 cal/min` (the derived rate, 1 decimal). Stored in the `value` column for consistency with the pace activities (which store pace strings in `value`). The detail page parses this directly, OR re-computes from the label for redundancy.

### Activities list (`cardio.tsx`)

The "Your activities" row for Air Bike shows `Best rate — N.N cal/min` on the right, not `Best pace`. Aggregation logic finds the MAX cal/min rate across all logged Air Bike efforts (higher = better) — distinct from the other pace-mode activities where the MIN pace seconds is the best.

### Helpers in `mobile/src/lib/movements.ts`

| Function | Purpose |
|----------|---------|
| `AIR_BIKE_ACTIVITY` | The literal string `'Air Bike'` |
| `isAirBikeActivity(name)` | True iff name equals AIR_BIKE_ACTIVITY |
| `parseAirBikeLabel(label)` | Parse `"Air Bike · N cal in M:SS"` → `{ cals, timeSecs }` |
| `calsPerMinFromEffort(cals, timeSecs)` | Compute cal/min rate (returns 0 for invalid) |
| `genderBaselineCalsPerMin(gender)` | Cold-start baseline (18 male / 13 else) |

### Out of v1 scope (deferred)

- **100-cal benchmark test** — a famous standalone benchmark ("how fast can you hit 100 cals?"). Would require a separate "test mode" on the log form and a dedicated chart line on the detail page. Defer until users ask for it.
- **EMOM cal ladders** ("3 cal min 1, 6 cal min 2, 9 cal min 3, ...") — interval programming pattern. Out of scope; one prescription per zone for now.
- **Watts as a primary INPUT** — v1 derives watts from cal/min for coaching advice only; the user never types watts. Reading watts off the air bike console for a primary input would require asking the user to monitor a fluctuating value mid-rep (impractical). If wattage-aware machines (e.g. Concept2 BikeErg + Erg PM5) ship as separate movements, those CAN use watts as primary input. Air Bike stays cal-input + watts-derived.
- **Test-set tracking** — users who do a 100-cal time trial would want to log that specifically and see their best 100-cal time over time. v2.
- **AirBikeConsolidatedDetail wrapper** — air bike has only one variant, no consolidation needed. If we ever add variants (e.g., one-arm air bike, seated vs standing), the Sled Work / Swimming wrapper pattern applies.

---

## Swimming detail card — locked design spec

This is the spec for the swim-native coaching surface on `[activity].tsx` (mobile) — fired when `isSwimActivity(activity)` (i.e. activity is `'Swimming'`, any `'Swimming [Stroke]'` variant, or a legacy bare `'Swimming · ...'` effort). Routes through `SwimmingConsolidatedDetail` (the stroke-pill wrapper) which then renders `SwimmingDetail` filtered to the active stroke. NOT the generic `PaceDetail`, because swim mechanics differ from running/cycling in five fundamental ways:

1. **Workouts are interval SETS on a clock.** Not "swim X km at Y pace." Real swim sessions look like "8 × 100m, leave every 1:50" — every rep ends at a wall, the user touches, gets whatever rest is left from the leaving interval, then pushes off for the next rep. The "leaving interval" is the canonical swim concept; running has no equivalent.
2. **Distances come in pool lengths, not arbitrary km.** Pool lengths are 25m, 50m (Olympic), or 25 yards. Rep distances are always multiples of pool length: 50m, 100m, 200m, etc. The current SWIM_ZONE_SESSIONS data uses 50m and 100m chunks that fit any pool layout.
3. **Pace is per 100m, not per km.** Universal swim convention. Storage stays in seconds-per-km for cross-activity uniformity, but the detail page divides by 10 at display time.
4. **CSS anchors all zones.** CSS = Critical Swim Speed = swimming's threshold pace (analogous to a runner's lactate threshold). Canonical formula is `(400m_TT_time - 200m_TT_time) ÷ 200`; MyRX estimates it without a forced calibration session — a 2-point linear Critical-Speed fit across the user's logged distances, falling back to a Riegel proxy when a stroke has <2 distances (see "CSS estimation" below).
5. **Hero card stacks THREE values, not two.** Running's hero shows work + pace. Swimming's shows work + pace + leaving interval — the leaving interval is what the swimmer actually reads off the pool clock to know when to push off, so it's a first-class number.

### Stroke consolidation (May 17 2026 — LOCKED)

Swimming has 4 stroke variants — Freestyle, Backstroke, Breaststroke, Butterfly — stored as separate movements in the DB (`Swimming [Freestyle]`, `Swimming [Backstroke]`, `Swimming [Breaststroke]`, `Swimming [Butterfly]`). They collapse into a single detail page via `SwimmingConsolidatedDetail`, mirroring the Sled Work `[Push]` / `[Pull]` pattern from strength. The architecture:

- **DB**: 4 movement rows, all `category='cardio'`, `cardio_mode='pace'`. No `Swimming` row exists; bare `'Swimming · ...'` effort labels from before this consolidation are legacy and default to Freestyle on the parse path.
- **Cardio index (`cardio.tsx`)**: the "Your activities" aggregation collapses the 4 stroke variants (and legacy bare swim labels) under a single `Swimming` row, with the most-recently-trained stroke shown as a small `FREE` / `BACK` / `BREAST` / `FLY` badge to the right. Best pace shown is the FASTEST per-100m across all strokes.
- **Cardio log form (`cardio.tsx`)**: the activity search returns all 4 stroke variants as separate hits (consistent with how Sled Work's strength search returns `Sled Work [Push]` + `Sled Work [Drag]` separately). The user picks the stroke they swam. The form recognises any bracketed swim variant as swim mode via `isSwimActivity(activity)`; save label format is `Swimming [Backstroke] · 1500 m in 25:00`.
- **Detail page route**: `/effort/cardio/Swimming` (base name from the index collapse) and `/effort/cardio/Swimming [Freestyle]` (bracketed deep links) both route to `SwimmingConsolidatedDetail`. The wrapper holds `activeStroke` state (defaults to whichever stroke was logged most recently; falls back to Freestyle if no swim efforts exist yet) and filters efforts to that stroke. Inner `SwimmingDetail` is stroke-agnostic — operates on whatever filtered list it receives.
- **Pill carousel**: 4-variant version of the same swipe choreography used by Sled Work and the BW assist tiers (see `docs/context/animation-patterns.md`, Pattern 4). Single amber pill in the center showing the active stroke as a short label (`FREE` / `BACK` / `BREAST` / `FLY`), flanked by pulsing chevrons. Carousel order: `FREE → BACK → BREAST → FLY` (popularity / freestyle-first). No wrap at the ends — left chevron disappears on Freestyle, right chevron disappears on Butterfly.
- **Pill swipe gesture**: identical mechanics to the Sled Work pill — Pan gesture, 20px threshold, 220px slide-off, 250ms slide-out / slide-in, 120ms chevron fade. Bounded by `currentIdx + direction` within `[0, SWIM_STROKE_ORDER.length - 1]` so over-swipes at the ends bounce back rather than commit.
- **Per-stroke fitness**: every stroke has its own CSS estimate (computed only from that stroke's efforts), its own progression chart, and its own plan queue. Switching strokes flips both the data AND the prescription. A user might have a 1:35/100m freestyle CSS and a 2:15/100m butterfly CSS — both tracked independently, no cross-contamination.
- **Empty states**: each stroke tab computes from only its own efforts. The user who has only swum freestyle sees the normal coaching surface on the FREE tab and an empty-state card on BACK / BREAST / FLY (`"Log your first backstroke effort and your personalized plan will appear here"`). No auto-estimating across strokes — they're physiologically different enough that the user's freestyle CSS tells us nothing about their butterfly CSS.

The 4 stroke movements live in `mobile/src/lib/movements.ts` (`SWIMMING_STROKE_MOVEMENTS`, `SWIM_STROKE_ORDER`, `SWIM_STROKE_LABELS`, `parseSwimStroke`, `isSwimActivity`, `swimStrokeFromMovementName`) so the log form, the index collapse, and the detail page all import from the same authoritative source.

### CSS estimation — 2-point linear, Riegel fallback (UPDATED June 2026, T088)

CSS is computed per stroke by `computeSwimCSS(efforts)`:

1. **Preferred — 2-point linear Critical Speed** (`linearProjectCSS`). Take the fastest time at each DISTINCT logged distance, then fit a least-squares line of time-vs-distance. The critical-speed model says `time = distance / CS + anaerobic term`, so the line's SLOPE is `1 / CS` (seconds per metre) and `CSS per 100m = slope × 100`. Needs ≥2 distinct distances for the stroke.
2. **Fallback — single-point Riegel proxy** (`riegelProjectCSS`, the old method): when a stroke has <2 distinct distances, project each effort to a 1000m-equivalent via `T2 = T1 × (D2/D1)^1.06`, ÷10 for per-100m, take the MIN. Still per-stroke.

**Why the change (verify-first, T088):** the old single-point Riegel + MIN was the SOLE method. It biased CSS too FAST — MIN picks the *fastest* projection, usually a short anaerobic-heavy effort, not a sustainable threshold — and the 1.06 exponent is a *running* fatigue constant (a poor fit for swimming, worse for fly/breast). The 2-point linear fit is the canonical CS estimate and self-corrects as the user logs varied distances; Riegel stays only as the cold-start fallback (1 distance). **Zone offsets unchanged** (Endurance +12, Threshold 0, VO2 −7 s/100m): the audit suggested deepening VO2 to CSS−8..−10, but that was premised on the OLD over-fast CSS; against the corrected (slower, more honest) CSS the existing −7 is appropriate, so it was deliberately left.

### Per-zone session prescriptions (`SWIM_ZONE_SESSIONS`, LOCKED)

Drawn from Maglischo *Swimming Even Faster* (1993), Counsilman *Science of Swimming* (1968), and Costill's lactate-threshold research at Indiana University. The 10×100m T-pace set is THE canonical swimming threshold-test set used at every level from age-group to Olympic prep.

| Zone | Primary session | Variant |
|------|-----------------|---------|
| **Endurance** | 8 × 100m at endurance pace, leave on (pace + 10s rest) | 10 × 100m — more volume |
| **Threshold** | 10 × 100m at threshold pace, leave on (pace + 10s rest) — Costill's canonical T-pace test set | 5 × 200m |
| **VO2 Max** | 10 × 50m at VO2 pace, leave on (pace + 20s rest) | 6 × 100m at race pace |

The plan queue cycles through both variants per zone so consecutive same-zone steps look different (no five identical Endurance tiles in a row).

### Per-zone pace offsets from CSS (per 100m, LOCKED)

| Zone | Offset | Effect |
|------|--------|--------|
| Endurance | +12 sec/100m | Conversational aerobic pace — 12 sec slower per 100m than CSS |
| Threshold | 0 | CSS itself — sustained moderate-hard |
| VO2 Max | −7 sec/100m | Race-pace work — 7 sec faster per 100m than CSS |

Offsets from Maglischo's training-zone tables. Same shape as Daniels' running offsets but tuned to swimming's narrower physiological window (water resistance means small pace changes are big effort changes).

### Leaving interval computation (LOCKED)

`leaving_interval_secs = round_to_nearest_5(target_pace_per_100m × rep_distance_m / 100 + rest_secs_for_zone)` where `rest_secs` is 10s for Endurance/Threshold, 20s for VO2. Rounded to nearest 5s because pool clocks tick at 5-second granularity (5/10 second-hand intervals), and swimmers think in those units ("leave on the :30").

### Layout — single page, top to bottom (LOCKED)

1. **Header** — back chevron + "Swimming" title + subtitle `Best — m:ss/100m` (or `/100yd` in yards mode). `TickerNumber` on the pace value.
2. **Progression plan card** (`<AnimateRise delay={0}>`):
   - Title `Your progression plan` + helper text
   - Tile row: 8 upcoming swim sessions, each tile shows zone label + work shape (reps × distance) + target pace. Tappable to drive the hero card. Leaving interval is on the hero only — too noisy for tiles.
   - **Hero card** (amber chrome, `min-h-220`): top-right info pill (zone label + Info icon, tappable for "why this zone"), then THREE stacked TickerNumber rows: Row 1 = work (`8 × 100m`), Row 2 = target pace (`1:38/100m`), Row 3 = leaving interval (`1:50`). Thin separator + full coaching cue sentence.
   - Attribution: `Riegel · Maglischo · Counsilman · Costill — CSS-anchored zones`
3. **Chart** (`<AnimateRise delay={250}>`) — pace per 100m over time, Y-axis reversed (lower = faster = trend down). Reference line at CSS.
4. **Log list** (`<AnimateRise delay={500}>`) — each row shows per-100m pace on the right (swim convention, not per-km).

### Log form (`cardio.tsx`) — swim-mode form variant (LOCKED)

When `activity === 'Swimming'`:
- **Distance wheel**: INTEGER mode (step 25, min 0, max 5000) — not the decimal-km wheel. Pool distances always come in whole numbers.
- **Unit column**: locked chip showing `m` or `yd` (pulled from `profile.swim_unit`, which is DERIVED from the Distance preference — see the swim_unit note below) — not the km/mi toggle. Fixed per-user; toggling per-log would be friction.
- **Time wheel**: stays `mm:ss` (max 99:00).
- **Save label format**: `Swimming · 1500 m in 25:00` (or `· 1640 yd in 25:00`). Old `· 1.5 km in 25:00` labels still parse via `parseEffortLabel` for back-compat.
- **Storage**: `value` column stores pace in seconds-per-km regardless of input unit (uniform storage across all pace-mode activities). Detail page divides by 10 for per-100m display.

### `profiles.swim_unit` column (LOCKED, migration `add_swim_unit_to_profiles`)

- Type: `text NOT NULL DEFAULT 'm'`
- CHECK constraint: `swim_unit IN ('m', 'yd')`
- Settings UI: **NO dedicated swim-unit card.** `swim_unit` is DERIVED from the single Distance preference on BOTH mobile and web (`mi` → `yd`, `km` → `m`): mobile `settings.tsx` writes `swim_unit: distanceUnit === 'mi' ? 'yd' : 'm'` in the prefs save batch (see the `// Swim unit follows the single Distance preference now` comment), and web `AccountSettings.jsx` does the same. An earlier design had a separate "Swim distance" card; it was consolidated into the one Distance toggle — the column is still written, just computed, not user-picked. Tradeoff: a user can't set swim units independently of run/ride distance, accepted for a simpler units card. (Corrected 2026-06-08 — the doc previously claimed a separate card that no longer exists.)

### Swimming-specific helpers in `[activity].tsx`

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

### `parseEffortLabel` (`[activity].tsx`) — extended for swim formats

The regex chain in `parseEffortLabel` now handles `m` and `yd` units after the existing `km` and `mi` cases. Critical: the `m` regex requires `\s+in\s+` after the unit so it doesn't accidentally match the `m` in `mi`. Old km-format swim labels still parse correctly for back-compat.

### Out of v1 scope (deferred)

- **Pool length input** — currently inferred (all prescriptions use 50m and 100m sets which fit any pool). Could become a profile preference later if needed.
- **Drill / pull / kick set prescription** — swim coaches differentiate full-stroke vs drill (technique) vs pull (no kick) vs kick (no arms). v1 just prescribes total work; the user picks the technique mix.
- **Canonical CSS calibration flow** — currently uses Riegel proxy. Add 400m+200m TT onboarding if proxy proves inaccurate in practice.
- **Cross-stroke CSS estimation** — when a user has logged efforts in only one stroke, we don't estimate their other strokes' CSS via stroke-conversion ratios (e.g. butterfly is typically ~30% slower than freestyle). Each stroke has its own empty state until the user logs an effort there. Cleaner UX, no fake numbers.

**Final cardio movements list update (May 17 2026):** the swimming consolidation replaces the single `Swimming` row with 4 stroke variants in the movements table. Updated catalog: **19 cardio movements** (was 16) — Air Bike, Bike Erg, Cycling, Cycling (Mountain Bike), Elliptical, Hill Running, Row Erg, Rucking, Running, Running (Treadmill), Ski Erg, Skiing, StairMill, Stationary Bike, **Swimming [Freestyle], Swimming [Backstroke], Swimming [Breaststroke], Swimming [Butterfly]**, Trail Running. The cardio index collapses the 4 strokes into a single "Swimming" row at display time so the user sees 16 visible activities. (Note: this May-17 catalog predates the May-19 Pass-3 cleanup that removed Cycling (Mountain Bike) / Hill Running / Skiing / Trail Running — see the Group-A "Final cardio movements list (15 DB rows, 12 visible activities)" above for the current list.)
