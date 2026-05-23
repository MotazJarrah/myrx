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
  /** FK into FAT_LEVELS — pctOfCals. */
  fat_level:     number
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
  /** Multiplier vs current weight that produces goal_weight_kg.
      e.g. -0.10 means goal = current_weight × (1 - 0.10).
      Maintenance = 0 → goal = current_weight. */
  goal_delta_pct:      number
}

export const PACE_OPTIONS: Record<PaceKey, PaceOption> = {
  lose_aggressive: {
    key:                'lose_aggressive',
    label:              'Lose aggressively',
    tagline:            '~2 lb/week — hard to sustain',
    energy_balance_pct: -0.30,
    goal_delta_pct:     -0.15,
  },
  lose_moderate: {
    key:                'lose_moderate',
    label:              'Lose moderately',
    tagline:            '~1–1.5 lb/week — the typical pace',
    energy_balance_pct: -0.20,
    goal_delta_pct:     -0.10,
  },
  maintain: {
    key:                'maintain',
    label:              'Maintain weight',
    tagline:            'Hold steady at your current weight',
    energy_balance_pct:  0,
    goal_delta_pct:      0,
  },
  gain_gradual: {
    key:                'gain_gradual',
    label:              'Gain gradually',
    tagline:            'Small surplus — lean gain',
    energy_balance_pct:  0.10,
    goal_delta_pct:      0.05,
  },
  gain_aggressive: {
    key:                'gain_aggressive',
    label:              'Gain aggressively',
    tagline:            'Bigger surplus — more fat with the muscle',
    energy_balance_pct:  0.20,
    goal_delta_pct:      0.10,
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

// ── Derivation helper ─────────────────────────────────────────────────────────

/**
 * Compute the derived goal_weight_kg for a self-coached user given their
 * current weight (kg) and chosen pace. Maintenance → goal = current.
 * Other paces → goal = current × (1 + goal_delta_pct).
 *
 * Rounded to 1 decimal place to match how the admin panel stores values.
 */
export function deriveGoalWeightKg(currentKg: number, paceKey: PaceKey): number {
  const pace  = PACE_OPTIONS[paceKey]
  const delta = pace?.goal_delta_pct ?? 0
  const raw   = currentKg * (1 + delta)
  return Math.round(raw * 10) / 10
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
