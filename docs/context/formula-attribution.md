# Formula Attribution Registry (Locked)

Single source of truth mapping every formula, rate constant, and scientific claim in MyRX's math to its published citation (or explicit MyRX-derived heuristic), so any audit, regulator review, "evidence-based" marketing claim, or migration phase can trace a number to its source without spelunking through file comments.

Update this registry whenever a new formula lands or an existing one's source changes — the file-level code comments and this registry must always agree. When adding a new formula or rate constant anywhere in the app, add it here with the citation AND add the explanatory comment at the formula's site cross-referencing this registry.

---

## Strength — 1RM, projections, hypertrophy rate

| Surface / formula | Source | Where the formula lives |
|---|---|---|
| 1-rep-max projection (rep-max table tiles) | **Epley (1985)**, **Brzycki (1993)**, **Lombardi (1989)** — three estimates averaged | `mobile/src/lib/formulas.ts` `estimate1RM` + `projectAllRMs` |
| 1RM for high-rep efforts (>10 reps) | **Epley + Lombardi only** — Brzycki's linear assumption breaks past ~10 reps (under-projects by 3–4% pts vs NSCA reference tables); drop it above the threshold | `formulas.ts` same functions, conditional dispatch |
| Bodyweight assist projection | **Mifflin-derived effective-load math** — `effective_load = bodyweight − assistance`, then standard 1RM projection on effective load | `formulas.ts` + `AssistedMachineDetail` JSX in `[exercise].tsx` |
| Hypertrophy rate per training tier | **Alan Aragon's natural-lifter model** — Beginner 1–2 lb lean/mo, Intermediate 0.5–1, Advanced 0.25–0.5, Elite <0.25 — referenced verbatim in NASM CPT/CES/PES texts | Used qualitatively in tagline copy; quantified in `GAIN_LEAN_RATIO` matrix (planPresets.ts) |
| Hypertrophy volume / rep-range design | **Schoenfeld 2017**, **Helms 2018**, **PMC 2021 meta-analysis** on rep-range × hypertrophy | Cited in `formulas.ts` line 401; informs the strength adp-zone boundaries (strength 1–5 / hypertrophy 6–12 / endurance 13+) |

## Cardio — pace, zones, intervals

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
| Cardio "lower is better" / chart-direction rule | **MyRX-locked design rule** (May 19 2026) — see "Chart-direction rule" section in CLAUDE.md | LineChart `reversed` prop usage across pace surfaces |
| Rucking tiers (Beginner → Tough) | **GoRuck event ladder** (Tough = 35 lb × 12 mi) | `[activity].tsx` `RUCK_TIER_THRESHOLDS` |

## Calories / TDEE / macros

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

## Heart — HR zones, resting bands

| Surface / formula | Source | Where it lives |
|---|---|---|
| HR zone model (5 zones, 50/60/70/80/90% HRmax) | **ACSM Guidelines 12th ed (2025)**; **Karvonen, Kentala & Mustala (1957)** for HR-reserve methodology | `heart.tsx` zone math; `HrRangeChart` time-in-zone gradient stops |
| Zone naming / colour palette | **MyRX-locked May 22 2026** — Recovery / Endurance / Tempo / Threshold / VO2 with warm yellow→amber→orange→burnt-orange→deep-red ramp. ACSM endorses 3-zone polarized (Z2 / Z4 / Z5 — what the app exposes; Z1 and Z3 are "no man's land" in polarized literature) | `HrRangeChart` palette; theme.ts `palette.red[600]/[700]` added for this surface |
| HRmax estimation | **Tanaka formula (2001)** — `208 − 0.7 × age`. More accurate than Fox-Haskell `220 − age` for the 18–65 range MyRX targets | `heart.tsx` `estimateHrMax` |
| Resting HR band classifier (Athlete → High, 7 bands) | **Topend Sports rating chart + ACSM compilations** — gender-aware, age-bucketed; non-binary / null uses female bands per gender rule | `mobile/src/components/RestingHrIndicator.tsx` `MALE_TABLE` / `FEMALE_TABLE`; web mirror in `web/src/pages/Heart.jsx` |
| VDOT-to-pace mapping (when implemented) | **Jack Daniels' Running Formula (3rd ed., 2014)** — already used for pace zone offsets above | Future expansion of cardio prescriptions |

## Wearable / cold-start baselines

| Surface / formula | Source | Where it lives |
|---|---|---|
| Air Bike cold-start cal/min | **MyRX-calibrated** from typical commercial Assault Bike output at intermediate effort — male 18 / else 13 (male/else=female rule) | `mobile/src/lib/movements.ts` `genderBaselineCalsPerMin` |
| StairMill cold-start floors/min | **MyRX-calibrated** from typical Stairmaster Gauntlet output at moderate-vigorous effort — male 12 / else 9 (male/else=female rule) | `mobile/src/lib/movements.ts` `genderBaselineFloorsPerMin` |
| Per-second HR storage | **Samsung Health Data SDK v1.1.0** — `ExerciseSession.log[].heartRate` field (1 Hz cadence) → stored as `wearable_workouts.raw_meta.hr_log` JSONB array | `mobile/android/.../SamsungHealthModule.kt` + `mobile/src/lib/integrations/samsungHealth.ts` |

## Mobility / ROM, Bodyweight

| Surface / formula | Source | Where it lives |
|---|---|---|
| ROM progression model | **No published formula** — purely user-tracked degrees, with comparison to prior best. Future expansion could cite McKenzie / Janda mobility literature | `Mobility.jsx`, `MobilityDetail.jsx` |
| Bodyweight trend smoothing | **None applied today** — raw daily logs charted as-is. Future: simple 7-day moving average per Lyle McDonald's "true weight" methodology | `Bodyweight.jsx`, `CalorieStrip.jsx` |

## What's NOT a published formula (MyRX-derived heuristics)

These are app-internal rules without a single external citation; documented here so future audits don't go looking for one that doesn't exist:

- **PhantomWheel inertia constants** — `INERTIA_MIN_VELOCITY = 250 px/s`, `INERTIA_DECELERATION = 0.993`. Tuned by feel over many iterations on physical Android devices.
- **Animation timing patterns 1–7** — the 500/250/500ms AnimateRise cascade, the 1.5s chevron pulse cycle, the 220ms swipe-dismiss + LinearTransition timings. MyRX-locked design.
- **Concept2 erg session distances per zone** — drawn from Concept2 community + masters/Olympic prep convention, not from a single paper.
- **GoRuck tier thresholds** — drawn from the GoRuck event series (Tough / Heavy / Selection); MyRX picks Tough as the top tier and sub-divides Beginner / Intermediate / Advanced beneath it.
- **Carry strongman benchmark weights** — drawn from World's Strongest Man / Atlas Stones competition standard sizes, not a single published rate table.
