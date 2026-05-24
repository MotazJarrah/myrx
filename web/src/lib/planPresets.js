/**
 * Self-coached plan presets — web port of mobile/src/lib/planPresets.ts.
 *
 * Three knobs the PlanWizardSheet exposes for self-coached users:
 *   MACRO_PRESETS    → 4 entries → (protein_level, fat_level) int pair
 *   PACE_OPTIONS     → 5 entries → (energy_balance_pct, goal_delta_pct)
 *   ACTIVITY_OPTIONS → re-exported from calorieFormulas (5 options 1-5)
 *
 * Defaults injected silently at save time (NOT shown in the wizard):
 *   correction_factor  = 0.75
 *   starting_weight_kg = current_weight
 *   goal_weight_kg     = current_weight × (1 + pace.goal_delta_pct)
 *   notes              = null
 *
 * Web ↔ mobile parity: this file must stay byte-equivalent to
 * mobile/src/lib/planPresets.ts for the preset definitions + helper
 * logic. Different wizard CHROME on the two surfaces is fine; the
 * math behind it must match exactly.
 */

import { ACTIVITY_FACTORS } from './calorieFormulas'

// ── Macro presets ─────────────────────────────────────────────────────────────

export const MACRO_PRESETS = {
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
    protein_level: 3,   // High = 2.4 g/kg
    fat_level:     3,   // High = 30%  (~30% carbs after protein)
  },
  keto: {
    key:           'keto',
    label:         'Keto',
    tagline:       'Very low carb, high fat',
    protein_level: 2,   // Medium = 2.0 g/kg
    fat_level:     5,   // Keto   = 70%
  },
  performance: {
    key:           'performance',
    label:         'Performance',
    tagline:       'Endurance athletes, high carb',
    protein_level: 2,   // Medium = 2.0 g/kg
    fat_level:     2,   // Medium = 20%  (~55% carbs after fat + protein)
  },
}

export const MACRO_PRESET_ORDER = ['balanced', 'high_protein', 'keto', 'performance']
export const DEFAULT_MACRO_PRESET = 'balanced'

// ── Pace options ──────────────────────────────────────────────────────────────

// Pace ladder (May 24 2026 lock — see mobile/src/lib/planPresets.ts for
// the canonical comment). Timeline FIXED per pace. Goal weight COMPUTED
// PER-USER from TDEE via predictLbDeltaForPace (no static goal_delta_pct).
export const PACE_OPTIONS = {
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

export const PACE_OPTION_ORDER = [
  'lose_aggressive', 'lose_moderate', 'maintain', 'gain_gradual', 'gain_aggressive',
]
export const DEFAULT_PACE = 'maintain'

// ── Activity options (re-exported for wizard convenience) ─────────────────────

export const ACTIVITY_OPTION_ORDER = [1, 2, 3, 4, 5]
export { ACTIVITY_FACTORS }

// ── Defaults injected at plan-creation time ───────────────────────────────────

export const SELF_COACHED_CORRECTION_FACTOR = 0.75

// ── Derivation helpers ────────────────────────────────────────────────────────

/** Standard thermodynamic conversion: ~3500 kcal = 1 lb of body weight. */
export const CALORIES_PER_LB = 3500

/**
 * Predict the lb of body weight a user will lose/gain following this pace
 * for the pace's locked timeline, given their TDEE. Negative = loss.
 * Used by PaceScreen for the outcome badge and by deriveGoalWeightKg
 * for the persisted goal so both flow through the same math.
 */
export function predictLbDeltaForPace(paceKey, tdee) {
  const pace = PACE_OPTIONS[paceKey]
  if (!pace || pace.timeline_months === 0) return 0
  const dailyCalDelta = tdee * pace.energy_balance_pct
  const totalCalDelta = dailyCalDelta * pace.timeline_months * 30
  return totalCalDelta / CALORIES_PER_LB
}

/**
 * Compute the derived goal_weight_kg for a self-coached user. Uses the
 * SAME calorie-math derivation as predictLbDeltaForPace so the persisted
 * goal matches the badge the user committed to. Mirrors mobile.
 */
export function deriveGoalWeightKg(currentKg, paceKey, tdee) {
  const lbDelta = predictLbDeltaForPace(paceKey, tdee)
  const kgDelta = lbDelta * 0.453592
  return Math.round((currentKg + kgDelta) * 10) / 10
}

/**
 * Lookup the preset that matches an existing plan's (protein_level,
 * fat_level) pair — used when re-opening the wizard to highlight the
 * current selection. Returns null if no preset matches (hand-tuned).
 */
export function macroPresetForPlan(protein_level, fat_level) {
  if (protein_level == null || fat_level == null) return null
  for (const key of MACRO_PRESET_ORDER) {
    const p = MACRO_PRESETS[key]
    if (p.protein_level === protein_level && p.fat_level === fat_level) return key
  }
  return null
}

/**
 * Inverse lookup: given a plan's stored energy_balance_pct, return the
 * closest PaceKey. Tolerance of 0.5 percentage points to absorb rounding.
 */
export function paceForPlan(energy_balance_pct) {
  if (energy_balance_pct == null) return null
  let bestKey  = null
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
