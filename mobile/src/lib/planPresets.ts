/**
 * Self-coached plan presets — the discrete option sets the PlanWizardSheet
 * shows in the mobile app's calorie plan setup + edit flow.
 *
 * Three knobs, all pre-baked so the user picks from a short list rather
 * than typing numbers (the admin panel keeps the raw sliders — these
 * constants only drive the user-facing wizard + edit chips).
 *
 *   MACRO_PRESETS  → 4 entries → (protein_level, fat_level) int pair
 *   PACE_OPTIONS   → 5 entries → (energy_balance_pct, goal_delta_pct)
 *   ACTIVITY_OPTIONS → re-exported from calorieFormulas (5 options 1-5)
 *
 * Goal weight rule (May 23 2026): self-coached users do NOT enter a
 * goal weight. The system derives it from current weight × pace's
 * goal_delta_pct. Maintenance derives goal = current.
 *
 * Correction factor: fixed at 0.75 for every self-coached user.
 * Starting weight: auto-set to current weight at plan-creation time.
 * Notes: admin-only field, stays null for self-coached plans.
 *
 * The (protein_level, fat_level) ints reference rows in
 * PROTEIN_LEVELS + FAT_LEVELS in mobile/src/lib/calorieFormulas.ts.
 * FAT_LEVELS was extended to include levels 4-5 (50%, 70%) so the
 * Keto preset has a valid mapping — the admin panel's UI still only
 * exposes levels 1-3.
 */

import { ACTIVITY_FACTORS } from './calorieFormulas'

// ── Macro presets ─────────────────────────────────────────────────────────────

export type MacroPresetKey = 'balanced' | 'high_protein' | 'keto' | 'performance'

export interface MacroPreset {
  key:           MacroPresetKey
  label:         string
  /** One-liner shown under the preset name in the picker. */
  tagline:       string
  /** FK into PROTEIN_LEVELS — gPerKg of goal weight. */
  protein_level: number
  /** FK into FAT_LEVELS — pctOfCals. IGNORED when carb_cap_g is set
      (fat becomes the residual after capped carbs are subtracted). */
  fat_level:     number
  /** Optional carb floor (g/day). When set, calcMacros uses the
      carb-capped path: carbs locked at this gram count, fat absorbs
      the residual. Used by Keto so the carb target stays ≤50g/day
      (sustained ketosis) regardless of bodyweight × activity TDEE.
      Can be either:
        • number — flat cap regardless of activity (rare, e.g. strict
          therapeutic-ketosis variant)
        • Record<activity_factor, number> — keyed by ACTIVITY_FACTORS
          1-5, so the cap scales with glycogen depletion: sedentary
          → 20g, extreme → 50g (medical sport-keto range).
      Resolve via resolveCarbCap(preset, activity) at consumption
      time — wizard preview + handleSave both use it. */
  carb_cap_g?:   number | Record<number, number>
}

/**
 * Resolve a preset's carb cap to a single int for the given activity
 * tier. Returns null when the preset doesn't have a cap at all
 * (non-Keto presets). The downstream calorie_plans.carb_cap_g column
 * is `int`, so we always persist a single number — the per-activity
 * variation lives only on the in-memory preset definition.
 */
export function resolveCarbCap(
  preset:   MacroPreset,
  activity: number,
): number | null {
  const cap = preset.carb_cap_g
  if (cap == null) return null
  if (typeof cap === 'number') return cap
  return cap[activity] ?? null
}

export const MACRO_PRESETS: Record<MacroPresetKey, MacroPreset> = {
  balanced: {
    key:           'balanced',
    label:         'Balanced',
    tagline:       'Most people start here',
    protein_level: 2,   // Medium = 2.0 g/kg
    fat_level:     3,   // High   = 30%
  },
  high_protein: {
    key:           'high_protein',
    label:         'High-Protein',
    tagline:       'Lifters, cuts, recomposition',
    protein_level: 3,   // High   = 2.4 g/kg
    fat_level:     3,   // High   = 30%  (~30% carbs after protein takes its share)
  },
  keto: {
    key:           'keto',
    label:         'Keto',
    tagline:       'Very low carb, high fat',
    // Moderate protein per sport-ketosis guidelines (1.6 g/kg).
    // Earlier set to 2.0 g/kg which is high-keto territory — excess
    // protein converts to glucose via gluconeogenesis and can pop
    // users out of ketosis.
    protein_level: 1,   // Low = 1.6 g/kg
    // fat_level kept at 5 (70%) for backward-compat display but
    // calcMacros IGNORES it when carb_cap_g is set — fat is computed
    // as the residual after capped carbs. See calorieFormulas.ts.
    fat_level:     5,
    // Activity-tiered carb cap (May 24 2026). Glycogen depletion from
    // exercise = more carb headroom without leaving ketosis. Sedentary
    // users sit at the strict therapeutic floor (20g); extreme-active
    // users top out at the medical upper bound (50g). Standard sport-
    // keto evidence (Phinney/Volek, Cunnane).
    //
    //   1 Sedentary           → 20g
    //   2 Lightly Active      → 25g
    //   3 Moderately Active   → 30g (the original flat default)
    //   4 Very Active         → 40g
    //   5 Extremely Active    → 50g
    carb_cap_g: { 1: 20, 2: 25, 3: 30, 4: 40, 5: 50 },
  },
  performance: {
    key:           'performance',
    label:         'Performance',
    tagline:       'Endurance athletes, high carb',
    protein_level: 2,   // Medium = 2.0 g/kg
    fat_level:     2,   // Medium = 20%  (~55% carbs after fat + protein)
  },
}

export const MACRO_PRESET_ORDER: MacroPresetKey[] = [
  'balanced', 'high_protein', 'keto', 'performance',
]

export const DEFAULT_MACRO_PRESET: MacroPresetKey = 'balanced'

// ── Pace options ──────────────────────────────────────────────────────────────

export type PaceKey =
  | 'lose_aggressive' | 'lose_moderate'
  | 'maintain'
  | 'gain_gradual'    | 'gain_aggressive'

export interface PaceOption {
  key:                 PaceKey
  label:               string
  /** Short helper shown under the label in the picker. */
  tagline:             string
  /** Goes into calorie_plans.energy_balance_pct (e.g. -0.20 = 20% deficit). */
  energy_balance_pct:  number
  /** Fixed timeline this pace is calibrated to. Goal weight is derived
      from energy_balance_pct × TDEE × timeline (see
      predictLbDeltaForPace / deriveGoalWeightKg below). Maintenance =
      0 means no change at all (no timeline, just holding). May 24 2026
      lock: every pace ships with a 1- or 2-month timeline so users
      never sign up for an open-ended plan. */
  timeline_months:     number
}

// Pace ladder (May 24 2026 lock):
//   • Timeline is FIXED per pace at 1 or 2 months.
//   • Goal weight is COMPUTED PER-USER from their TDEE via
//     predictLbDeltaForPace — no static `goal_delta_pct`. A sedentary
//     person at TDEE 1700 sees a smaller predicted loss than a very
//     active person at TDEE 3000 at the same pace, because their
//     daily calorie deficit at the same % differs in absolute terms.
//   • Every option is sustainable per ACSM (~1 lb/week max). Removed
//     the old `lose_aggressive` -30% / -15% pair because it admitted
//     "hard to sustain" in its own tagline — if it's hard to sustain
//     we shouldn't offer it.
//   • PaceScreen renders TWO badges per row: the concrete outcome
//     ("≈ -11 lb in 2 months") + the daily calorie change ("-25%").
//     Outcome uses the user's actual TDEE, computed live in the wizard
//     after they pick their activity level on the previous step.
export const PACE_OPTIONS: Record<PaceKey, PaceOption> = {
  lose_aggressive: {
    key:                'lose_aggressive',
    label:              'Lose hard',
    tagline:            'Push the upper end of sustainable',
    energy_balance_pct: -0.25,
    timeline_months:     2,
  },
  lose_moderate: {
    key:                'lose_moderate',
    label:              'Lose steady',
    tagline:            'A relaxed, easily maintained pace',
    energy_balance_pct: -0.15,
    timeline_months:     1,
  },
  maintain: {
    key:                'maintain',
    label:              'Maintain weight',
    tagline:            'Hold steady at your current weight',
    energy_balance_pct:  0,
    timeline_months:     0,
  },
  gain_gradual: {
    key:                'gain_gradual',
    label:              'Gain steady',
    tagline:            'Small surplus for lean gain',
    energy_balance_pct:  0.10,
    timeline_months:     1,
  },
  gain_aggressive: {
    key:                'gain_aggressive',
    label:              'Gain hard',
    tagline:            'Bigger surplus — most add some fat with the muscle',
    energy_balance_pct:  0.15,
    timeline_months:     2,
  },
}

export const PACE_OPTION_ORDER: PaceKey[] = [
  'lose_aggressive', 'lose_moderate', 'maintain', 'gain_gradual', 'gain_aggressive',
]

export const DEFAULT_PACE: PaceKey = 'maintain'

// ── Activity options (re-exported for wizard convenience) ─────────────────────

export const ACTIVITY_OPTION_ORDER: number[] = [1, 2, 3, 4, 5]
export { ACTIVITY_FACTORS }

// ── Defaults injected at plan-creation time ───────────────────────────────────

/**
 * Fixed correction factor for every self-coached plan (May 22 2026 lock).
 * The admin panel exposes this as an editable input — for self-coached
 * users it's a behind-the-scenes constant.
 */
export const SELF_COACHED_CORRECTION_FACTOR = 0.75

// ── Body composition bands (May 24 2026 lock) ────────────────────────────────
//
// User self-reports via a 3-shape silhouette picker. Gender-aware cutoffs
// (male and female BF% scales are different by ~7 points). Non-binary /
// prefer-not-to-say → female cutoffs, per the "male / else=female" rule
// applied across every other gender-driven calc in the app.
//
// Three bands intentional — finer granularity (4-5 bands) creates noise
// when users self-assess from cartoons. We can go to per-percent picking
// later if/when DEXA / bioimpedance integration lands.

export type BodyFatBand = 'lean' | 'average' | 'high'

export const BODY_FAT_BAND_ORDER: BodyFatBand[] = ['lean', 'average', 'high']

/** Display labels + BF% ranges, gender-aware. Use for picker copy + later
    "Update body composition" UI. */
export const BODY_FAT_BAND_INFO: Record<'male' | 'else', Record<BodyFatBand, {
  label:        string
  rangeText:    string
  description:  string
}>> = {
  male: {
    lean:    { label: 'Lean',    rangeText: '≤14% BF',  description: 'Visible muscle definition, flat / cut midsection' },
    average: { label: 'Average', rangeText: '15–24% BF', description: 'Soft midsection, no visible abs, normal proportions' },
    high:    { label: 'High',    rangeText: '≥25% BF',  description: 'Visible central adiposity, rounded waist' },
  },
  else: {
    lean:    { label: 'Lean',    rangeText: '≤20% BF',  description: 'Athletic, visible muscle tone' },
    average: { label: 'Average', rangeText: '21–30% BF', description: 'Healthy normal, no visible abs' },
    high:    { label: 'High',    rangeText: '≥31% BF',  description: 'Visible central adiposity, rounded shape' },
  },
}

/** Pick the gender-bucket key (male vs else) for the cutoffs lookup. */
export function bodyFatGenderKey(gender: string | null | undefined): 'male' | 'else' {
  return gender === 'male' ? 'male' : 'else'
}

// ── Realism matrices (May 24 2026 lock) ──────────────────────────────────────
//
// All three drive the wizard's PaceScreen badge:
//   1. LOSS_REALISM_MATRIX[activity][bfBand]  → % of math-predicted loss
//      that actually shows up at the scale. Lean+Extreme dips because
//      cutting an athletic body has brutal metabolic adaptation +
//      recovery costs; High+anything climbs because first-weeks
//      water/glycogen drop is real.
//   2. GAIN_REALISM_MATRIX[activity][bfBand]  → % of math-predicted gain
//      that actually shows. Sedentary low because NEAT compensation
//      eats some surplus; trained users adhere better + partition more
//      surplus into actual mass.
//   3. GAIN_LEAN_RATIO[activity][bfBand]      → fraction of the GAIN that
//      is lean tissue (rest is fat). Sedentary≈0 because no training
//      stimulus = no muscle. Trained beginner lean has the best
//      partition (closest to 65% lean).
//
// Numbers calibrated against NASM / Aragon / Helms hypertrophy + fat-loss
// rate tables. Cross-references the locked Activity factors in
// calorieFormulas.ts ACTIVITY_FACTORS (1=Sed×1.2 ... 5=Extreme×1.9).

export const LOSS_REALISM_MATRIX: Record<number, Record<BodyFatBand, number>> = {
  1: { lean: 0.45, average: 0.65, high: 0.85 },  // Sedentary
  2: { lean: 0.50, average: 0.70, high: 0.85 },  // Lightly Active
  3: { lean: 0.55, average: 0.75, high: 0.90 },  // Moderately Active
  4: { lean: 0.50, average: 0.78, high: 0.92 },  // Very Active
  5: { lean: 0.40, average: 0.80, high: 0.95 },  // Extremely Active
}

export const GAIN_REALISM_MATRIX: Record<number, Record<BodyFatBand, number>> = {
  1: { lean: 0.50, average: 0.50, high: 0.40 },
  2: { lean: 0.65, average: 0.60, high: 0.55 },
  3: { lean: 0.75, average: 0.70, high: 0.65 },
  4: { lean: 0.80, average: 0.75, high: 0.70 },
  5: { lean: 0.85, average: 0.80, high: 0.75 },
}

export const GAIN_LEAN_RATIO: Record<number, Record<BodyFatBand, number>> = {
  1: { lean: 0.10, average: 0.05, high: 0.00 },
  2: { lean: 0.25, average: 0.15, high: 0.10 },
  3: { lean: 0.50, average: 0.40, high: 0.25 },
  4: { lean: 0.60, average: 0.50, high: 0.35 },
  5: { lean: 0.65, average: 0.50, high: 0.35 },
}

// ── Display unit helpers (May 24 2026) ───────────────────────────────────────
//
// Every weight + protein display on the wizard MUST respect the user's
// profile.weight_unit setting ('lb' | 'kg'). The math layer stays in
// canonical units (kg for weights, g/kg for protein) so the formulas
// don't need to branch — only the display layer converts.
//
// 1 kg = 2.2046 lb · 1 lb = 0.453592 kg. We use 0.453592 for the
// lb→kg direction (matches the rest of the codebase, see
// deriveGoalWeightKg). Display rounds to nearest 0.5 (deltas) or
// nearest int (absolute weights) — matches the precision of the
// underlying predictions, which themselves are realism-multiplied
// estimates, not lab measurements.

export type WeightUnit = 'lb' | 'kg'

/** Format an absolute weight stored in kg into the user's chosen
    display unit. Used for goal weight, current weight, "Stay at X"
    on maintain mode. Rounded to nearest int (no decimal — scale
    weights are noisy day-to-day anyway). */
export function formatWeightFromKg(weightKg: number, unit: WeightUnit): string {
  if (unit === 'kg') return `${Math.round(weightKg)} kg`
  return `${Math.round(weightKg / 0.453592)} lb`
}

/** Format a weight DELTA (always supplied in lb — predictLbDeltaForPace
    + predictLeanFatSplit both return lb) into the user's display unit.
    Rounded to nearest 0.5 to match the PaceScreen badges. Optional
    `withSign` prepends + or − (fancy minus, matches Reality screen big
    number) for non-zero values; without it, returns just the abs +
    unit ("3.5 lb", suitable for the lean/fat split line where the sign
    is implied by the surrounding text). */
export function formatLbDelta(
  lbDelta: number,
  unit:    WeightUnit,
  opts:    { withSign?: boolean } = {},
): string {
  const valueInUnit = unit === 'kg' ? lbDelta * 0.453592 : lbDelta
  const rounded     = Math.round(valueInUnit * 2) / 2
  const abs         = Math.abs(rounded)
  if (opts.withSign) {
    if (rounded > 0)  return `+${abs} ${unit}`
    if (rounded < 0)  return `−${abs} ${unit}`
  }
  return `${abs} ${unit}`
}

/** Format the protein-per-bodyweight ratio for the macro picker
    badges. PROTEIN_LEVELS stores values as g/kg of bodyweight
    (sport-science convention); we convert to g/lb for lb users so
    the badge matches the unit they see elsewhere in the app. Lb
    conversion rounds to 1 decimal (the typical published range is
    0.7–1.1 g/lb so one decimal preserves the meaningful precision). */
export function formatProteinPerWeight(gPerKg: number, unit: WeightUnit): string {
  if (unit === 'kg') return `${gPerKg}g/kg`
  const gPerLb = Math.round((gPerKg / 2.2046) * 10) / 10
  return `${gPerLb}g/lb`
}

// ── Derivation helpers ────────────────────────────────────────────────────────

/** Standard thermodynamic conversion: ~3500 kcal = 1 lb of body weight. */
export const CALORIES_PER_LB = 3500

/**
 * Realism fallback used when activity + bfBand aren't both available.
 * 0.75 is the broad middle of the matrices below — see the per-cell
 * realism multipliers in LOSS_REALISM_MATRIX / GAIN_REALISM_MATRIX
 * which supersede this whenever both inputs ARE known.
 */
export const REALISM_FACTOR_FALLBACK = 0.75

/**
 * Predict the lb of body weight a user will lose/gain following this
 * pace for the pace's locked timeline, given their TDEE + activity
 * tier + body-fat band. Negative = loss.
 *
 *   daily_delta = TDEE × energy_balance_pct
 *   total_cal   = daily_delta × timeline_months × 30 days
 *   raw_lb      = total_cal / CALORIES_PER_LB
 *   final_lb    = raw_lb × realism[activity][bfBand]
 *
 * The realism multiplier is direction-aware (LOSS_REALISM_MATRIX vs
 * GAIN_REALISM_MATRIX) and per-(activity,bfBand) so a lean athlete
 * trying to Lose hard sees a smaller predicted loss than a high-BF
 * sedentary user picking the same pace, reflecting actual physiology.
 * When activity or bfBand isn't available, falls back to a flat 0.75.
 *
 * Used by PaceScreen for the outcome badge AND by deriveGoalWeightKg
 * for the persisted goal — same math, so the badge the user commits
 * to is the goal_weight_kg that lands in the DB.
 */
export function predictLbDeltaForPace(
  paceKey:  PaceKey,
  tdee:     number,
  activity: number | null = null,
  bfBand:   BodyFatBand | null = null,
): number {
  const pace = PACE_OPTIONS[paceKey]
  if (!pace || pace.timeline_months === 0) return 0
  const dailyCalDelta = tdee * pace.energy_balance_pct
  const totalCalDelta = dailyCalDelta * pace.timeline_months * 30
  const rawLb         = totalCalDelta / CALORIES_PER_LB

  let realism: number
  if (activity && activity >= 1 && activity <= 5 && bfBand) {
    const matrix = pace.energy_balance_pct < 0 ? LOSS_REALISM_MATRIX : GAIN_REALISM_MATRIX
    realism = matrix[activity][bfBand]
  } else {
    realism = REALISM_FACTOR_FALLBACK
  }
  return rawLb * realism
}

/**
 * Split a predicted GAIN into lean-mass + fat-mass pounds, using the
 * activity tier + body-fat band to look up the lean ratio. Returns
 * null for loss / maintain / missing inputs — caller renders only the
 * scale-weight badge in those cases.
 *
 * Sedentary users get ~0% lean, so badges read "+2.5 lb (~0 lb muscle,
 * ~2.5 lb fat)" — brutally honest about what an untrained surplus
 * actually produces. Trained users see meaningful muscle numbers
 * calibrated to NASM hypertrophy rates.
 */
export function predictLeanFatSplit(
  scaleLbDelta: number,
  activity:     number | null,
  bfBand:       BodyFatBand | null,
): { leanLb: number; fatLb: number } | null {
  if (scaleLbDelta <= 0) return null
  if (!activity || activity < 1 || activity > 5 || !bfBand) return null
  const leanRatio = GAIN_LEAN_RATIO[activity][bfBand]
  const leanLb    = scaleLbDelta * leanRatio
  const fatLb     = scaleLbDelta - leanLb
  return { leanLb, fatLb }
}

/**
 * Per-row warning for the macro picker step. Coach voice (May 24 2026
 * rewrite): every string describes the BIOLOGY of why the combo
 * doesn't fit and ends with a CONCRETE next step the user can take in
 * 1-4 weeks. Rendered as an amber chip inline on the row — option
 * stays clickable; this is informational only. The deeper synthesis
 * across all four picks lives on the "Let's make it real" step
 * (evaluateRealism below). The chip is the in-flow nudge; the reality
 * step is the full conversation.
 *
 * Rules:
 *   • Performance + Sedentary/Light → no glycogen burn to absorb carbs
 *   • High-Protein + High BF → no strength stimulus to absorb protein
 * null for any other combo.
 *
 * See CLAUDE.md "Voice and Coaching Philosophy" for the 3-pillar rule
 * these strings adhere to.
 */
export function macroProfileWarning(
  macroKey: MacroPresetKey,
  activity: number | null,
  bfBand:   BodyFatBand | null,
): string | null {
  if (!activity || activity < 1) return null
  if (macroKey === 'performance' && activity <= 2) {
    return "Performance carbs assume daily glycogen burn from training. Without that work, extra carbs just store as fat. Balanced fits where you are — switch when you're training 4-5 days a week."
  }
  if (macroKey === 'high_protein' && bfBand === 'high') {
    return "Extra protein at your body fat has nowhere productive to go without a strength stimulus. Add 2-3 lift sessions a week — at that point High-Protein becomes muscle-building instead of expensive maintenance."
  }
  return null
}

/**
 * Per-row warning for the pace picker step. Coach voice (May 24 2026
 * rewrite): every string names the user's current state, explains the
 * biology of why this pace doesn't fit them right now, and ends with a
 * concrete next step. null when the combo is fine. Rendered as an
 * amber chip inline on the row — option stays clickable.
 *
 * See CLAUDE.md "Voice and Coaching Philosophy" for the 3-pillar rule
 * these strings adhere to.
 */
export function paceProfileWarning(
  paceKey:  PaceKey,
  activity: number | null,
  bfBand:   BodyFatBand | null,
): string | null {
  if (!activity || !bfBand) return null
  const pace = PACE_OPTIONS[paceKey]
  if (!pace || pace.timeline_months === 0) return null

  const isLoseHard = pace.energy_balance_pct === -0.25
  const isGainHard = pace.energy_balance_pct ===  0.15
  const isAnyGain  = pace.energy_balance_pct  >   0

  // Most-specific cases first so a lean athlete on Lose hard gets the
  // recovery-specific warning rather than the generic lean-tissue one.
  if (isLoseHard && bfBand === 'lean' && activity === 5) {
    return "You're already lean and training hard. Your body has nothing extra to burn — a hard deficit pulls from muscle and recovery. Drop to Lose Steady; you'll keep what you've built and your training stays sharp."
  }
  if (isLoseHard && bfBand === 'lean') {
    return "When body fat is already low, hard deficits run out of fat to burn and start cannibalizing muscle. Lose Steady protects the lean tissue you've worked for."
  }
  if (isAnyGain && bfBand === 'high') {
    return "Adding mass on top of high body fat means most of the gain goes to fat too, which loads joints and dulls insulin sensitivity. Switch to Lose Steady for 2 months — your composition shifts, then a clean bulk lands on better ground."
  }
  if (isGainHard && (activity === 1 || activity === 2)) {
    return "Without a training stimulus, your body has no signal to build muscle, so a hard surplus just stores as fat. Start lifting 2-3x/week first — then a steady surplus partitions much better."
  }
  return null
}

// ── Realism evaluator (May 24 2026) ──────────────────────────────────────────
//
// The synthesis layer behind the "Let's make it real now" wizard step.
// Takes the user's full set of choices (bodyFat, activity, pace, macro)
// + their current weight + TDEE and returns:
//   • A coach-voice summary of the plan as a whole
//   • The concrete realistic outcome over the pace's timeline
//   • A list of issue cards (each in coach voice — acknowledge,
//     biology, next step) where the choices fight each other
//   • A consolidated "apply all suggestions" payload the user can
//     accept with one tap (each suggestion is also reachable
//     individually via the per-screen warning chips on earlier steps)
//
// The evaluator is intentionally pure + serializable — no async, no
// side effects, no UI. It returns data; the screen renders it. Adding
// or tightening a rule means editing this one function. Per the
// "Voice and Coaching Philosophy" rule in CLAUDE.md every string here
// must follow the 3-pillar pattern (acknowledge → biology → next step).
//
// Severity:
//   • 'major'   — choice actively works against the goal. Suggested.
//   • 'caution' — choice is sub-optimal but not actively harmful.
//
// Classification (drives the screen's header color + summary tone):
//   • on_track     → 0 major, 0 caution. Plan fits. Show outcome + Save.
//   • needs_tuning → 1 major OR 1-2 caution. One thing to adjust.
//   • needs_rework → 2+ major OR 3+ caution. Multiple choices fight.

export type RealismSeverity = 'caution' | 'major'
export type RealismField = 'pace' | 'macro' | 'activity' | 'bodyFat'

export interface RealismIssue {
  severity: RealismSeverity
  field:    RealismField
  /** Coach-voice paragraph following the 3-pillar rule (acknowledge →
      biology → next step). Rendered as the body of an issue card. */
  message:  string
  /** Optional concrete change the user could apply. Multiple issues
      may share field overlap; the consolidated payload below merges
      them. Single-field suggestions are auto-applied on the apply
      button — body fat is never auto-changed (self-report). */
  suggestion?: {
    pace?:     PaceKey
    macro?:    MacroPresetKey
    activity?: number
  }
}

export type RealismClassification = 'on_track' | 'needs_tuning' | 'needs_rework'

export interface RealismVerdict {
  classification:  RealismClassification
  /** Coach-voice opener summarizing the entire plan in one paragraph. */
  summary:         string
  /** Predicted lb delta over the pace's locked timeline with full
      activity × bfBand realism multipliers. Negative = loss. Used by
      the screen to render the concrete outcome card. */
  outcomeLb:       number
  /** Same math, expressed as the persisted goal_weight_kg. */
  goalWeightKg:    number
  /** 1 or 2 months — comes straight from the pace's `timeline_months`. */
  timelineMonths:  number
  /** Lean/fat split for gain rows (null on loss/maintain). */
  split:           { leanLb: number; fatLb: number } | null
  /** All issues detected, sorted major first then caution. */
  issues:          RealismIssue[]
  /** When >=1 issues with suggestions, the merged "apply everything we
      suggest" payload + a short coach-voice rationale describing the
      change. Null when no suggestions apply (on_track or no auto-fix
      possible). */
  consolidatedSuggestion: {
    pace?:        PaceKey
    macro?:       MacroPresetKey
    activity?:    number
    /** Short label for the apply button — e.g. "Switch to Lose Steady". */
    label:        string
    /** Coach-voice paragraph explaining what the merged change does
        biologically. */
    rationale:    string
  } | null
}

/**
 * Run the full realism evaluation for a complete set of wizard picks.
 *
 * Pure function — no I/O, no async, no UI. The caller (RealityCheckScreen
 * inside PlanWizardSheet) wraps it in useMemo over the same inputs so it
 * recomputes when the user applies a suggested change. Apply path is:
 *   user taps "Apply suggested changes"
 *     → parent setState's pace/macro/activity per consolidatedSuggestion
 *     → useMemo recomputes with new inputs
 *     → screen re-renders with the new (probably on_track) verdict
 *     → user taps Save below to commit
 *
 * The rule set is intentionally small and easily extendable — adding
 * a new rule means pushing one more RealismIssue into the issues array
 * with the right severity and a coach-voice message. The classifier
 * + consolidator + summary all work off the same array.
 */
export function evaluateRealism(input: {
  pace:            PaceKey
  macro:           MacroPresetKey
  activity:        number
  bodyFat:         BodyFatBand
  currentWeightKg: number
  tdee:            number
}): RealismVerdict {
  const { pace, macro, activity, bodyFat, currentWeightKg, tdee } = input
  const paceOpt    = PACE_OPTIONS[pace]
  const isMaintain = paceOpt.energy_balance_pct === 0
  const isLose     = paceOpt.energy_balance_pct < 0
  const isGain     = paceOpt.energy_balance_pct > 0
  const isLoseHard = paceOpt.energy_balance_pct === -0.25
  const isGainHard = paceOpt.energy_balance_pct ===  0.15
  const isAnyGain  = isGain
  // currentWeightKg is captured for shape parity with future weight-
  // anchored rules (e.g. "your weight has dropped X lb in 8 weeks, ease
  // back from Lose Hard"). Referenced via the derived goalWeightKg
  // below; no other current rule uses raw bodyweight.
  void currentWeightKg

  // ── Outcome math ────────────────────────────────────────────────────
  // Same helpers as the per-row PaceScreen badge — the realism step is
  // a synthesis layer over numbers the user already saw, never a new
  // calculation. If predictLbDeltaForPace changes, the reality screen
  // changes with it.
  const lbDelta      = predictLbDeltaForPace(pace, tdee, activity, bodyFat)
  const goalWeightKg = deriveGoalWeightKg(currentWeightKg, pace, tdee, activity, bodyFat)
  const split        = isGain ? predictLeanFatSplit(lbDelta, activity, bodyFat) : null

  // ── Rule scan ───────────────────────────────────────────────────────
  // Order matters: more-specific rules push first so the consolidated
  // suggestion picks the tighter fix. Issues array stays sorted in
  // detection order; the screen sorts by severity at render time.
  const issues: RealismIssue[] = []

  // R1. Lose Hard + lean + extreme activity — most specific lean case.
  if (isLoseHard && bodyFat === 'lean' && activity === 5) {
    issues.push({
      severity: 'major',
      field:    'pace',
      message:
        "You're already lean and training extremely hard. Your body " +
        "has nothing extra to burn — a hard deficit pulls from muscle " +
        "and recovery, and your sessions degrade within 2 weeks. Drop " +
        "to Lose Steady; you'll keep what you've built and your " +
        "training stays sharp through the cut.",
      suggestion: { pace: 'lose_moderate' },
    })
  }
  // R2. Lose Hard + lean (catch-all for less extreme activity).
  else if (isLoseHard && bodyFat === 'lean') {
    issues.push({
      severity: 'major',
      field:    'pace',
      message:
        "When body fat is already low, hard deficits run out of fat to " +
        "burn and start cannibalizing muscle. Lose Steady protects the " +
        "lean tissue you've worked for and gets you to your next " +
        "single-digit BF on a path you can actually sustain.",
      suggestion: { pace: 'lose_moderate' },
    })
  }

  // R3. Any gain + high body fat.
  if (isAnyGain && bodyFat === 'high') {
    issues.push({
      severity: 'major',
      field:    'pace',
      message:
        "Adding mass on top of high body fat means most of the gain " +
        "goes to fat too, which loads joints and dulls insulin " +
        "sensitivity. Switch to Lose Steady for 2 months — your " +
        "composition shifts, then a clean bulk lands on better ground.",
      suggestion: { pace: 'lose_moderate' },
    })
  }

  // R4. Gain Hard + sedentary/light — only if not already caught by R3.
  if (isGainHard && (activity === 1 || activity === 2) && bodyFat !== 'high') {
    issues.push({
      severity: 'major',
      field:    'pace',
      message:
        "Without a consistent training stimulus, your body has no " +
        "signal to build muscle, so a hard surplus just stores as fat. " +
        "Drop to Gain Steady and add 2 lift sessions a week — by next " +
        "month your body knows what to do with the extra calories.",
      suggestion: { pace: 'gain_gradual' },
    })
  }

  // R5. Performance preset + sedentary/light.
  if (macro === 'performance' && activity <= 2) {
    issues.push({
      severity: 'caution',
      field:    'macro',
      message:
        "Performance carbs assume daily glycogen burn from training. " +
        "Without that work, the extra carbs just store as fat. Start " +
        "with Balanced; switch when you're training 4-5 days a week " +
        "and feel a real difference from the extra carbs.",
      suggestion: { macro: 'balanced' },
    })
  }

  // R6. High-Protein + high BF (recomp message).
  if (macro === 'high_protein' && bodyFat === 'high') {
    issues.push({
      severity: 'caution',
      field:    'macro',
      message:
        "Extra protein at high body fat has nowhere productive to go " +
        "without a strength stimulus. Start with Balanced and add 2-3 " +
        "lift sessions a week — at that point High-Protein becomes " +
        "muscle-building instead of expensive maintenance.",
      suggestion: { macro: 'balanced' },
    })
  }

  // R7. Keto + extremely active (technical caveat, not a hard block).
  // May 24 2026 — user edit dropped the "Expect 2-4 weeks of slower
  // sessions while you adapt" middle sentence; the message reads
  // tighter without it.
  if (macro === 'keto' && activity === 5) {
    issues.push({
      severity: 'caution',
      field:    'macro',
      message:
        "High-intensity training pulls from glycogen, and Keto keeps " +
        "glycogen low. Most extremely-active athletes get more out of " +
        "Performance once they're past 3+ sessions a week.",
      suggestion: { macro: 'performance' },
    })
  }

  // R8. Maintain + high BF (gentle nudge, no major implications).
  if (isMaintain && bodyFat === 'high') {
    issues.push({
      severity: 'caution',
      field:    'pace',
      message:
        "Maintenance holds you exactly where you are — including the " +
        "joint loading and insulin resistance that come with high body " +
        "fat. Lose Steady drops body fat at ~1% body weight per week, " +
        "which is sustainable and starts making daily life feel easier " +
        "within a month.",
      suggestion: { pace: 'lose_moderate' },
    })
  }

  // R9. Gain Steady + Sedentary/Light + NOT High BF (May 24 2026).
  // Symmetric to R4 (which catches Gain HARD at the same activity
  // range): R9 catches the GENTLER pace, so severity is caution not
  // major. Without a training stimulus, even a +10% surplus mostly
  // stores as fat — the user picked Gain Steady because they don't
  // want to add fat, but the math says they will without lifting.
  if (pace === 'gain_gradual' && (activity === 1 || activity === 2) && bodyFat !== 'high') {
    issues.push({
      severity: 'caution',
      field:    'pace',
      message:
        "Even a gentle surplus needs a training stimulus to become " +
        "muscle. Without lift sessions, most of the gain just stores " +
        "as fat. Switch to Maintain until you're consistently training " +
        "2-3 days a week — then Gain Steady actually produces composition change.",
      suggestion: { pace: 'maintain' },
    })
  }

  // R10. Maintain + Average + Sedentary (May 24 2026).
  // R8 already catches Maintain + High. This rule fills the gap for
  // average BF + sedentary lifestyle — same biology, milder symptom.
  // Suggested fix: Lose Steady (option A per user choice — actionable
  // path, the user can ignore the button and keep maintain if they
  // really want to).
  if (isMaintain && bodyFat === 'average' && activity === 1) {
    issues.push({
      severity: 'caution',
      field:    'pace',
      message:
        "Maintaining at sedentary average means daily life slowly drifts " +
        "you toward higher body fat — same calories, less movement, " +
        "creeping accumulation over years. Lose Steady drops body fat at " +
        "~1% body weight per week without changing your routine drastically.",
      suggestion: { pace: 'lose_moderate' },
    })
  }

  // R11. Lose Hard + Average + Extremely Active (May 24 2026).
  // R1 catches the lean + extreme case (red, muscle cannibalization).
  // R11 extends a CAUTION to average BF at the same activity — there's
  // fat to burn, so it's not muscle-loss territory, but the recovery
  // cost of a 25% deficit while training 6-7 days a week still
  // degrades sessions. Caution, not major.
  if (isLoseHard && bodyFat === 'average' && activity === 5) {
    issues.push({
      severity: 'caution',
      field:    'pace',
      message:
        "Training extremely hard demands recovery, and a 25% deficit " +
        "pulls from that pool — sessions feel harder and recovery takes " +
        "longer even with average body fat to burn. Lose Steady lets " +
        "you keep training quality while still trimming consistently.",
      suggestion: { pace: 'lose_moderate' },
    })
  }

  // R12. Gain Hard + Average + Moderately Active (May 24 2026).
  // R4 catches Gain Hard at sedentary/light (no training stimulus,
  // major). R12 flags the typical intermediate-lifter mistake of
  // pushing a +15% surplus at moderate training (3-5 days/week) —
  // partition table says ~40% lean / 60% fat at this tier, so the
  // user is adding more fat than muscle. Gain Steady (+10%) at the
  // same training stimulus partitions much better.
  if (isGainHard && bodyFat === 'average' && activity === 3) {
    issues.push({
      severity: 'caution',
      field:    'pace',
      message:
        "At moderate training (3-5 days a week), a +15% surplus " +
        "partitions about 40% lean / 60% fat — you're adding more fat " +
        "than muscle. Gain Steady (+10%) keeps the surplus small enough " +
        "that more of it lands as actual mass at this training level.",
      suggestion: { pace: 'gain_gradual' },
    })
  }

  // ── Classify ────────────────────────────────────────────────────────
  const majorCount   = issues.filter(i => i.severity === 'major').length
  const cautionCount = issues.filter(i => i.severity === 'caution').length
  let classification: RealismClassification
  if (majorCount === 0 && cautionCount === 0) {
    classification = 'on_track'
  } else if (majorCount >= 2 || cautionCount >= 3) {
    classification = 'needs_rework'
  } else {
    classification = 'needs_tuning'
  }

  // ── Build summary ───────────────────────────────────────────────────
  // Coach voice opener — acknowledges the user's situation, names what
  // the realistic outcome is, and (for non-on_track) signals that we've
  // got suggestions below.
  const monthTxt   = paceOpt.timeline_months === 1 ? '1 month' : `${paceOpt.timeline_months} months`
  const outcomeAbs = Math.abs(Math.round(lbDelta * 2) / 2)
  const outcomeStr = isMaintain
    ? 'hold your current weight'
    : isLose
      ? `lose about ${outcomeAbs} lb`
      : `gain about ${outcomeAbs} lb`
  let summary: string
  if (classification === 'on_track') {
    summary =
      `Your picks line up with where you're starting. Over the next ` +
      `${monthTxt}, expect to ${outcomeStr} — that's the honest ` +
      `outcome with your activity and body composition factored in. ` +
      `Stick to it and we'll check in on your progress.`
  } else if (classification === 'needs_tuning') {
    summary =
      `Your plan mostly fits, but one piece is working against the ` +
      `rest. The math says ${outcomeStr} over ${monthTxt}, and the ` +
      `tweak below gets your body to actually produce that result ` +
      `instead of fighting you for it.`
  } else {
    summary =
      `Your picks are pulling against each other. The math projects ` +
      `${outcomeStr} over ${monthTxt}, but with this combo your body ` +
      `won't produce that result — it'll fight the changes. Here's ` +
      `a plan that fits where you're actually starting.`
  }

  // ── Consolidate suggestions ─────────────────────────────────────────
  // Merge all suggestions into a single apply payload. Later
  // suggestions override earlier ones on the same field — fine because
  // detection order has more-specific rules first, so the later rule
  // on the same field is the broader / safer default.
  let consolidatedSuggestion: RealismVerdict['consolidatedSuggestion'] = null
  const withSuggestions = issues.filter(i => i.suggestion)
  if (withSuggestions.length > 0) {
    const merged: { pace?: PaceKey; macro?: MacroPresetKey; activity?: number } = {}
    for (const i of withSuggestions) {
      const s = i.suggestion!
      if (s.pace     != null) merged.pace     = s.pace
      if (s.macro    != null) merged.macro    = s.macro
      if (s.activity != null) merged.activity = s.activity
    }
    // Don't offer to apply an identity change (e.g. all suggestions
    // happened to land on what the user already picked).
    const isIdentity =
      (merged.pace     == null || merged.pace     === pace) &&
      (merged.macro    == null || merged.macro    === macro) &&
      (merged.activity == null || merged.activity === activity)
    if (!isIdentity) {
      const changes: string[] = []
      if (merged.pace     != null && merged.pace     !== pace)     changes.push(PACE_OPTIONS[merged.pace].label)
      if (merged.macro    != null && merged.macro    !== macro)    changes.push(MACRO_PRESETS[merged.macro].label)
      if (merged.activity != null && merged.activity !== activity) changes.push(ACTIVITY_FACTORS[merged.activity].label)
      if (changes.length > 0) {
        const n = changes.length
        const label = n === 1
          ? `Switch to ${changes[0]}`
          : `Switch to ${changes.slice(0, -1).join(', ')} + ${changes[changes.length - 1]}`
        // Tighter rationale (May 24 2026 rewrite): one sentence with
        // pluralization-aware verb. Drops the older two-sentence form
        // that repeated what the label + button already say.
        const opener = n === 1 ? 'One change' : n === 2 ? 'Two changes' : 'A few changes'
        const verb   = n === 1 ? 'brings' : 'bring'
        const rationale = `${opener} ${verb} your plan in line with where you're starting.`
        consolidatedSuggestion = { ...merged, label, rationale }
      }
    }
  }

  // Sort issues major-first for the screen renderer.
  const sortedIssues = [...issues].sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'major' ? -1 : 1
  })

  return {
    classification,
    summary,
    outcomeLb:               lbDelta,
    goalWeightKg,
    timelineMonths:          paceOpt.timeline_months,
    split,
    issues:                  sortedIssues,
    consolidatedSuggestion,
  }
}

/**
 * Compute the derived goal_weight_kg for a self-coached user given
 * their current weight (kg), chosen pace, TDEE, activity tier, and
 * body-fat band. Uses the SAME calorie-math derivation as
 * predictLbDeltaForPace so the persisted goal matches the badge the
 * user committed to. Rounded to 1 decimal kg to match how the admin
 * panel stores values.
 *
 * Maintenance → goal = current. Anything else → current + delta_kg.
 */
export function deriveGoalWeightKg(
  currentKg: number,
  paceKey:   PaceKey,
  tdee:      number,
  activity:  number | null = null,
  bfBand:    BodyFatBand | null = null,
): number {
  const lbDelta = predictLbDeltaForPace(paceKey, tdee, activity, bfBand)
  const kgDelta = lbDelta * 0.453592
  return Math.round((currentKg + kgDelta) * 10) / 10
}

/**
 * Lookup the preset that matches an existing plan's (protein_level,
 * fat_level) pair — used when re-opening the wizard to highlight the
 * current selection. Returns null if no preset matches exactly (the
 * plan was hand-tuned by an admin and doesn't fit any preset shape).
 */
export function macroPresetForPlan(
  protein_level: number | null,
  fat_level:     number | null,
): MacroPresetKey | null {
  if (protein_level == null || fat_level == null) return null
  for (const key of MACRO_PRESET_ORDER) {
    const p = MACRO_PRESETS[key]
    if (p.protein_level === protein_level && p.fat_level === fat_level) return key
  }
  return null
}

/**
 * Inverse of deriveGoalWeightKg + energy_balance_pct lookup — given a
 * plan's stored energy_balance_pct, return the closest PaceKey. Used
 * when re-opening the wizard / picker to highlight the active pace.
 * Tolerance of 0.5 percentage points to absorb rounding noise.
 */
export function paceForPlan(energy_balance_pct: number | null): PaceKey | null {
  if (energy_balance_pct == null) return null
  let bestKey: PaceKey | null = null
  let bestDiff = Infinity
  for (const key of PACE_OPTION_ORDER) {
    const opt  = PACE_OPTIONS[key]
    const diff = Math.abs((opt.energy_balance_pct ?? 0) - energy_balance_pct)
    if (diff < bestDiff) { bestDiff = diff; bestKey = key }
  }
  // Only accept the match if it's within 0.5pp — anything further means
  // the plan was admin-tuned to a value our presets don't cover.
  return bestDiff <= 0.005 ? bestKey : null
}
