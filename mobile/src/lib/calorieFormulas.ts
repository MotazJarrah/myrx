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
// preset in the self-coached wizard (Keto needs ~70% of calories from
// fat). Admin slider still picks from 1-3; presets reach 4-5 via
// MACRO_PRESETS in mobile/src/lib/planPresets.ts.
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

/** Mifflin-St Jeor BMR */
export function calcBMR(weightKg: number, heightCm: number, age: number, gender: string): number {
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
 * Protein based on GOAL weight; fats as % of total; carbs = remainder.
 */
export function calcMacros(
  dailyTargetCals: number,
  goalWeightKg: number,
  proteinLevelKey: number,
  fatLevelKey: number,
): MacroBreakdown {
  const proteinG    = PROTEIN_LEVELS[proteinLevelKey].gPerKg * goalWeightKg
  const proteinCals = proteinG * 4

  const fatPct  = FAT_LEVELS[fatLevelKey].pctOfCals
  const fatCals = dailyTargetCals * fatPct
  const fatG    = fatCals / 9

  const carbCals = Math.max(0, dailyTargetCals - proteinCals - fatCals)
  const carbG    = carbCals / 4

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
 * Modes:
 *  • 'standard'  — pure thermodynamics (7700 kcal = 1 kg fat). Used when goal direction
 *                   matches energy direction (deficit + lower goal, surplus + higher goal).
 *  • 'recomp'    — Body recomposition window: small goal change (≤ 2 kg) AND mild energy
 *                   balance (|pct| ≤ 15%). Math-based timeline doesn't apply because muscle
 *                   gain offsets fat loss; returns a fixed "3–6 months" estimate.
 *  • 'mismatch'  — Goal direction opposes energy direction outside the recomp window.
 *                   Returns null timeline so caller can show a warning.
 *
 * /20 = worst-case 20 committed days per month.
 * correctionFactor (e.g. 0.8) gives the realistic upper-bound estimate.
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

  // Direction of energy: negative = pushes weight down, positive = pushes weight up
  const directionMatches = (isLoss && energyAdjustment < 0) || (!isLoss && energyAdjustment > 0)

  // Recomp window: ≤ 2 kg goal change AND mild energy balance (|pct| ≤ 15% if known,
  // else fall back to ≤ 350 kcal/day adjustment)
  const mildEnergy = energyPct != null
    ? Math.abs(energyPct) <= 0.15
    : Math.abs(energyAdjustment) <= 350
  const isRecomp = weightDiff <= 2 && mildEnergy

  if (isRecomp) {
    const monthsBest      = Math.max(1, Math.ceil(weightDiff / 0.5))
    const monthsRealistic = Math.max(2, Math.ceil(weightDiff / 0.25))
    return { mode: 'recomp', monthsBest, monthsRealistic, weightDiffKg: weightDiff, isLoss }
  }

  if (!directionMatches) {
    return { mode: 'mismatch', weightDiffKg: weightDiff, isLoss }
  }

  // Standard thermodynamic projection
  const dailyAmount = Math.abs(energyAdjustment)
  if (dailyAmount === 0) return null

  const totalCals       = weightDiff * 7700
  const monthsBest      = (totalCals / dailyAmount) / 20
  const monthsRealistic = (totalCals / (dailyAmount * correctionFactor)) / 20

  return {
    mode:            'standard',
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
  const macros = calcMacros(dailyTarget, effectiveGoalKg, plan.protein_level, plan.fat_level)

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
