/**
 * Calorie & macro calculation engine — port of MyRX/src/lib/calorieFormulas.js.
 * Based on Mifflin-St Jeor BMR + TDEE with custom energy balance model.
 *
 * Pure math, no React/RN dependencies. Identical to the web version line-for-line
 * — when the web's calorieFormulas.js changes, mirror the edit here.
 */

// ── Lookup tables ─────────────────────────────────────────────────────────────

export interface ActivityFactor {
  label:       string
  description: string
  value:       number
}

export const ACTIVITY_FACTORS: Record<number, ActivityFactor> = {
  1: { label: 'Sedentary',          description: 'Little or no exercise, desk job',                         value: 1.2   },
  2: { label: 'Lightly Active',     description: 'Light exercise 1–3 days per week',                        value: 1.375 },
  3: { label: 'Moderately Active',  description: 'Moderate exercise 3–5 days per week',                     value: 1.55  },
  4: { label: 'Very Active',        description: 'Heavy exercise 6–7 days per week',                        value: 1.725 },
  5: { label: 'Extremely Active',   description: 'Very heavy exercise, physical job, or training 2× daily', value: 1.9   },
}

export interface EnergyBalanceType {
  label:      string
  goal:       'loss' | 'gain'
  adjustment: number
}

export const ENERGY_BALANCE_TYPES: Record<number, EnergyBalanceType> = {
  1: { label: 'Easy Fat Loss',        goal: 'loss', adjustment: -250 },
  2: { label: 'Moderate Fat Loss',    goal: 'loss', adjustment: -500 },
  3: { label: 'High Fat Loss',        goal: 'loss', adjustment: -800 },
  4: { label: 'Easy Muscle Gain',     goal: 'gain', adjustment:  250 },
  5: { label: 'Moderate Muscle Gain', goal: 'gain', adjustment:  350 },
  6: { label: 'High Muscle Gain',     goal: 'gain', adjustment:  500 },
}

export const PROTEIN_LEVELS: Record<number, { label: string; gPerKg: number }> = {
  1: { label: 'Low',    gPerKg: 1.6 },
  2: { label: 'Medium', gPerKg: 2.0 },
  3: { label: 'High',   gPerKg: 2.4 },
}

// Fat levels: levels 1-3 are the admin panel's original Low/Medium/High
// scale. Levels 4-5 were added May 23 2026 to support the Keto diet
// preset in the self-coached wizard. Admin slider still picks from 1-3;
// presets reach 4-5 via MACRO_PRESETS in mobile/src/lib/planPresets.ts.
//
// May 24 2026 — fat_level is IGNORED for any plan with carb_cap_g set.
// On capped plans, fat is the RESIDUAL (TDEE - protein - capped_carbs),
// not a fixed % of TDEE. This is what makes Keto math hold across all
// TDEEs: carbs lock at 30g/day, protein scales with bodyweight, fat
// absorbs whatever's left. The nominal Keto fat_level (70%) stays for
// backward compat / display fallback when the cap isn't honored.
export const FAT_LEVELS: Record<number, { label: string; pctOfCals: number }> = {
  1: { label: 'Low',       pctOfCals: 0.10 },
  2: { label: 'Medium',    pctOfCals: 0.20 },
  3: { label: 'High',      pctOfCals: 0.30 },
  4: { label: 'Very High', pctOfCals: 0.50 },
  5: { label: 'Keto',      pctOfCals: 0.70 },
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

export function toKg(weight: number, unit: string): number {
  return unit === 'lb' ? weight * 0.453592 : weight
}

export function toCm(height: number, heightUnit: string): number {
  // imperial: stored as total inches; metric: stored as cm
  return heightUnit === 'metric' ? height : height * 2.54
}

export function calcAge(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null
  return Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 86_400_000))
}

// ── Core formulas ─────────────────────────────────────────────────────────────

/** Mifflin-St Jeor BMR.
 *
 * gender factor (from Mifflin-St Jeor 1990):
 *   male  → +5
 *   else  → -161 (female factor)
 *
 * Uniform "male / else=female" rule applied across every gender-driven
 * calc in the system (BMR, resting-HR bands, Air Bike + StairMill
 * cold-start baselines). Decided May 23 2026: the female factor is the
 * more conservative default for any non-male value (non-binary, prefer-
 * not-to-say, null, undefined), produces a sane lower-bound calorie
 * target, and avoids picking a midpoint that matches neither real
 * physiology. Mirrors web/src/lib/calorieFormulas.js (same fix).
 */
export function calcBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: string | null | undefined,
): number {
  const gFactor = gender === 'male' ? 5 : -161
  return (weightKg * 9.99) + (heightCm * 6.25) - (age * 4.92) + gFactor
}

/** TDEE = BMR × activity multiplier */
export function calcTDEE(bmr: number, activityFactorKey: number): number {
  return bmr * ACTIVITY_FACTORS[activityFactorKey].value
}

/** Daily target = TDEE + energy balance adjustment (cal/day) */
export function calcDailyTarget(tdee: number, energyBalanceTypeKey: number): number {
  return tdee + ENERGY_BALANCE_TYPES[energyBalanceTypeKey].adjustment
}

export interface MacroBreakdown {
  protein: { grams: number; calories: number; pct: number }
  fat:     { grams: number; calories: number; pct: number }
  carbs:   { grams: number; calories: number; pct: number }
}

/**
 * Macro split in grams + calories + %.
 *
 * Two paths:
 *   1. Default (carbCapG == null) — protein computed from g/kg × goal
 *      weight, fat is a fixed % of TDEE, carbs are the residual.
 *      Original model; appropriate for Balanced / High-Protein /
 *      Performance presets and admin-coached plans.
 *
 *   2. Carb-capped (carbCapG > 0) — protein computed normally, carbs
 *      LOCKED at the cap (e.g. 30g/day for Keto), fat absorbs the
 *      residual. Used for ketogenic plans where the defining feature
 *      is the carb floor, not a fixed fat %. Without the cap, Keto
 *      math broke at high TDEEs (carbs crept above 50g/day, out of
 *      ketosis). With the cap, the user stays at ~30g carbs/day
 *      regardless of bodyweight × activity level — medically correct.
 *
 * fat_level is IGNORED when carbCapG is set (fat is residual). Pass
 * the preset's fat_level through anyway so older plans still
 * deserialize cleanly.
 */
export function calcMacros(
  dailyTargetCals: number,
  goalWeightKg: number,
  proteinLevelKey: number,
  fatLevelKey: number,
  carbCapG: number | null = null,
): MacroBreakdown {
  const proteinG    = PROTEIN_LEVELS[proteinLevelKey].gPerKg * goalWeightKg
  const proteinCals = proteinG * 4

  let fatCals: number
  let carbCals: number

  if (carbCapG != null && carbCapG > 0) {
    // Carb-capped path (Keto et al.): carbs at cap, fat = residual.
    carbCals = carbCapG * 4
    fatCals  = Math.max(0, dailyTargetCals - proteinCals - carbCals)
  } else {
    // Default path: fat at fixed %, carbs = residual.
    const fatPct = FAT_LEVELS[fatLevelKey].pctOfCals
    fatCals  = dailyTargetCals * fatPct
    carbCals = Math.max(0, dailyTargetCals - proteinCals - fatCals)
  }

  const fatG  = fatCals / 9
  const carbG = carbCals / 4

  const safe = (n: number) => Math.max(0, Math.round(n))
  return {
    protein: { grams: safe(proteinG), calories: safe(proteinCals), pct: safe((proteinCals / dailyTargetCals) * 100) },
    fat:     { grams: safe(fatG),     calories: safe(fatCals),     pct: safe((fatCals     / dailyTargetCals) * 100) },
    carbs:   { grams: safe(carbG),    calories: safe(carbCals),    pct: safe((carbCals    / dailyTargetCals) * 100) },
  }
}

export interface TimelineRecomp {
  mode:            'recomp'
  monthsBest:      number
  monthsRealistic: number
  weightDiffKg:    number
  isLoss:          boolean
}

export interface TimelineMismatch {
  mode:         'mismatch'
  weightDiffKg: number
  isLoss:       boolean
}

export interface TimelineStandard {
  mode:            'standard'
  monthsBest:      number
  monthsRealistic: number
  weightDiffKg:    number
  isLoss:          boolean
}

export type Timeline = TimelineRecomp | TimelineMismatch | TimelineStandard | null

/**
 * Timeline to goal.
 *
 * ONE shared projection for every goal (7700 kcal ≈ 1 kg). The mode only changes
 * the label/notes, NOT the number:
 *  • 'standard'  — normal loss/gain goal.
 *  • 'recomp'    — small goal change (≤ 2 kg) AND mild energy balance (|pct| ≤ 15%).
 *                   Same achievable estimate as 'standard', just tagged so the UI can
 *                   add a "scale moves slowly here" note (muscle gain offsets fat loss,
 *                   so treat it as a best case). It used to show a fixed slow band that
 *                   read as static — now it shows how short it could actually take.
 *  • 'mismatch'  — the calorie direction opposes the goal direction; no timeline is
 *                   valid, so the caller shows a warning instead.
 *
 * /20 ≈ a realistic ~20 on-plan days per month (nobody is perfect every day) — this is
 * the motivating "how short it could take" number. correctionFactor (e.g. 0.8) gives the
 * conservative end for tougher stretches.
 */
export function calcTimeline(
  currentWeightKg: number,
  goalWeightKg:    number,
  energyAdjustment: number,
  correctionFactor: number,
  energyPct: number | null = null,
): Timeline {
  const weightDiff = Math.abs(currentWeightKg - goalWeightKg)
  if (weightDiff < 0.1) return null

  const isLoss = currentWeightKg > goalWeightKg

  // Direction of energy: negative pushes weight down, positive pushes it up.
  const directionMatches = (isLoss && energyAdjustment < 0) || (!isLoss && energyAdjustment > 0)

  // Calorie direction opposes the goal → unreachable; show a warning. Applies to
  // small/recomp goals too (a tiny lose-goal on a surplus still won't get there).
  if (!directionMatches) {
    return { mode: 'mismatch', weightDiffKg: weightDiff, isLoss }
  }

  const dailyAmount = Math.abs(energyAdjustment)
  if (dailyAmount === 0) return null

  // One achievable projection for every goal. Recomp is NOT a slower number — it's
  // the same estimate, tagged so the UI can add a "scale moves slowly" note.
  const totalCals       = weightDiff * 7700
  const monthsBest      = (totalCals / dailyAmount) / 20
  const monthsRealistic = (totalCals / (dailyAmount * correctionFactor)) / 20

  const mildEnergy = energyPct != null
    ? Math.abs(energyPct) <= 0.15
    : Math.abs(energyAdjustment) <= 350
  const isRecomp = weightDiff <= 2 && mildEnergy

  return {
    mode:            isRecomp ? 'recomp' : 'standard',
    monthsBest:      Math.ceil(monthsBest),
    monthsRealistic: Math.ceil(monthsRealistic),
    weightDiffKg:    weightDiff,
    isLoss,
  }
}

// ── Profile + plan shapes (loose since they come from Supabase rows) ─────────

export interface CalorieProfile {
  current_weight?: number | null
  weight_unit?:    string | null
  current_height?: number | null
  height_unit?:    string | null
  gender?:         string | null
  birthdate?:      string | null
}

export interface CaloriePlan {
  activity_factor:      number
  energy_balance_type?: number | null
  energy_balance_pct?:  number | null
  protein_level:        number
  fat_level:            number
  /** Optional carb floor in g/day. When set, calcMacros uses the
      carb-capped path (carbs=cap, fat=residual). Used by Keto preset. */
  carb_cap_g?:          number | null
  goal_weight_kg?:      number | null
  starting_weight_kg?:  number | null
  correction_factor:    number
  goal_reached?:        boolean
  meals?:               number | null
}

export interface FullPlanResult {
  bmr:             number
  tdee:            number
  dailyTarget:     number
  energyAdj:       number
  macros:          MacroBreakdown
  timeline:        Timeline
  currentWeightKg: number
  goalWeightKg:    number | null
}

/**
 * Full pipeline. Returns null if required data is missing.
 *
 * @param profile                       Profile row from `profiles` table.
 * @param plan                          Plan row from `calorie_plans` table.
 * @param currentWeightKgOverride       When provided, overrides profile weight for the
 *   timeline calculation only (e.g. latest logged bodyweight). BMR/TDEE still use profile
 *   weight so plan targets stay stable between weigh-ins.
 */
export function calcFullPlan(
  profile: CalorieProfile,
  plan: CaloriePlan,
  currentWeightKgOverride: number | null = null,
): FullPlanResult | null {
  const weightKg = profile.current_weight ? toKg(profile.current_weight, profile.weight_unit || 'lb') : null
  const heightCm = profile.current_height ? toCm(profile.current_height, profile.height_unit  || 'imperial') : null
  const age      = calcAge(profile.birthdate)

  if (!weightKg || !heightCm || !age || !profile.gender) return null

  const bmr  = calcBMR(weightKg, heightCm, age, profile.gender)
  const tdee = calcTDEE(bmr, plan.activity_factor)

  // energy_balance_pct (new) takes priority over energy_balance_type (legacy)
  const energyAdj = (plan.energy_balance_pct != null)
    ? Math.round(tdee * plan.energy_balance_pct)
    : ENERGY_BALANCE_TYPES[plan.energy_balance_type ?? 0]?.adjustment ?? 0

  const dailyTarget = Math.round(tdee + energyAdj)

  // Fall back to current weight for protein calc when goal isn't set yet
  const effectiveGoalKg = plan.goal_weight_kg || weightKg
  const macros = calcMacros(dailyTarget, effectiveGoalKg, plan.protein_level, plan.fat_level, plan.carb_cap_g ?? null)

  // Timeline uses live bodyweight (override) if available, else profile weight.
  const timelineWeightKg = currentWeightKgOverride ?? weightKg
  const timeline: Timeline = plan.goal_weight_kg
    ? calcTimeline(
        timelineWeightKg,
        plan.goal_weight_kg,
        energyAdj,
        plan.correction_factor,
        plan.energy_balance_pct ?? null,
      )
    : null

  return {
    bmr:             Math.round(bmr),
    tdee:            Math.round(tdee),
    dailyTarget,
    energyAdj,
    macros,
    timeline,
    currentWeightKg: timelineWeightKg,
    goalWeightKg:    plan.goal_weight_kg ?? null,
  }
}

/**
 * Returns an array of human-readable field names that are missing from profile
 * and required for calcFullPlan to succeed. Empty array = nothing missing.
 */
export function getMissingPlanFields(profile: CalorieProfile | null | undefined): string[] {
  const missing: string[] = []
  const weightKg = profile?.current_weight
    ? toKg(profile.current_weight, profile.weight_unit || 'lb')
    : null
  const heightCm = profile?.current_height
    ? toCm(profile.current_height, profile.height_unit || 'imperial')
    : null
  const age = calcAge(profile?.birthdate)
  if (!weightKg)        missing.push('weight')
  if (!heightCm)        missing.push('height')
  if (!profile?.gender) missing.push('gender')
  if (!age)             missing.push('date of birth')
  return missing
}

export interface PerMealBreakdown {
  calories: number
  protein:  number
  fat:      number
  carbs:    number
}

/** Per-meal breakdown given daily macros and number of meals */
export function calcPerMeal(macros: MacroBreakdown, dailyTarget: number, meals: number): PerMealBreakdown {
  const m = Math.max(1, meals)
  return {
    calories: Math.round(dailyTarget / m),
    protein:  Math.round(macros.protein.grams / m),
    fat:      Math.round(macros.fat.grams     / m),
    carbs:    Math.round(macros.carbs.grams   / m),
  }
}
