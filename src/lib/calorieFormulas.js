/**
 * Calorie & macro calculation engine — PRDX Fitness formula system.
 * Based on Mifflin-St Jeor BMR + TDEE with custom energy balance model.
 */

// ── Lookup tables ─────────────────────────────────────────────────────────────

export const ACTIVITY_FACTORS = {
  1: { label: 'Sedentary',          description: 'Little or no exercise, desk job',                        value: 1.2   },
  2: { label: 'Lightly Active',     description: 'Light exercise 1–3 days per week',                       value: 1.375 },
  3: { label: 'Moderately Active',  description: 'Moderate exercise 3–5 days per week',                    value: 1.55  },
  4: { label: 'Very Active',        description: 'Heavy exercise 6–7 days per week',                       value: 1.725 },
  5: { label: 'Extremely Active',   description: 'Very heavy exercise, physical job, or training 2× daily', value: 1.9  },
}

export const ENERGY_BALANCE_TYPES = {
  1: { label: 'Easy Fat Loss',        goal: 'loss', adjustment: -250 },
  2: { label: 'Moderate Fat Loss',    goal: 'loss', adjustment: -500 },
  3: { label: 'High Fat Loss',        goal: 'loss', adjustment: -800 },
  4: { label: 'Easy Muscle Gain',     goal: 'gain', adjustment:  250 },
  5: { label: 'Moderate Muscle Gain', goal: 'gain', adjustment:  350 },
  6: { label: 'High Muscle Gain',     goal: 'gain', adjustment:  500 },
}

export const PROTEIN_LEVELS = {
  1: { label: 'Low',    gPerKg: 1.6 },
  2: { label: 'Medium', gPerKg: 2.0 },
  3: { label: 'High',   gPerKg: 2.4 },
}

export const FAT_LEVELS = {
  1: { label: 'Low',    pctOfCals: 0.10 },
  2: { label: 'Medium', pctOfCals: 0.20 },
  3: { label: 'High',   pctOfCals: 0.30 },
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

export function toKg(weight, unit) {
  return unit === 'lb' ? weight * 0.453592 : weight
}

export function toCm(height, heightUnit) {
  // imperial: stored as total inches; metric: stored as cm
  return heightUnit === 'metric' ? height : height * 2.54
}

export function calcAge(birthdate) {
  if (!birthdate) return null
  return Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 86_400_000))
}

// ── Core formulas ─────────────────────────────────────────────────────────────

/** Mifflin-St Jeor BMR */
export function calcBMR(weightKg, heightCm, age, gender) {
  const gFactor = gender === 'male' ? 5 : -161
  return (weightKg * 9.99) + (heightCm * 6.25) - (age * 4.92) + gFactor
}

/** TDEE = BMR × activity multiplier */
export function calcTDEE(bmr, activityFactorKey) {
  return bmr * ACTIVITY_FACTORS[activityFactorKey].value
}

/** Daily target = TDEE + energy balance adjustment (cal/day) */
export function calcDailyTarget(tdee, energyBalanceTypeKey) {
  return tdee + ENERGY_BALANCE_TYPES[energyBalanceTypeKey].adjustment
}

/**
 * Macro split in grams + calories + %.
 * Protein based on GOAL weight; fats as % of total; carbs = remainder.
 */
export function calcMacros(dailyTargetCals, goalWeightKg, proteinLevelKey, fatLevelKey) {
  const proteinG    = PROTEIN_LEVELS[proteinLevelKey].gPerKg * goalWeightKg
  const proteinCals = proteinG * 4

  const fatPct  = FAT_LEVELS[fatLevelKey].pctOfCals
  const fatCals = dailyTargetCals * fatPct
  const fatG    = fatCals / 9

  const carbCals = Math.max(0, dailyTargetCals - proteinCals - fatCals)
  const carbG    = carbCals / 4

  const safe = (n) => Math.max(0, Math.round(n))
  return {
    protein: { grams: safe(proteinG), calories: safe(proteinCals), pct: safe((proteinCals / dailyTargetCals) * 100) },
    fat:     { grams: safe(fatG),     calories: safe(fatCals),     pct: safe((fatCals     / dailyTargetCals) * 100) },
    carbs:   { grams: safe(carbG),    calories: safe(carbCals),    pct: safe((carbCals    / dailyTargetCals) * 100) },
  }
}

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
export function calcTimeline(currentWeightKg, goalWeightKg, energyAdjustment, correctionFactor, energyPct = null) {
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
    // Recomp net weight change is ~0.25–0.5 kg/month (research consensus)
    // because muscle gain offsets fat loss (or vice versa).
    const monthsBest      = Math.max(1, Math.ceil(weightDiff / 0.5))
    const monthsRealistic = Math.max(2, Math.ceil(weightDiff / 0.25))
    return {
      mode:            'recomp',
      monthsBest,
      monthsRealistic,
      weightDiffKg:    weightDiff,
      isLoss,
    }
  }

  if (!directionMatches) {
    return {
      mode:         'mismatch',
      weightDiffKg: weightDiff,
      isLoss,
    }
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

/**
 * Full pipeline. Returns null if required data is missing.
 * @param {object} profile – { current_weight, weight_unit, current_height, height_unit, gender, birthdate }
 * @param {object} plan    – { activity_factor, energy_balance_type?, energy_balance_pct?, protein_level, fat_level, goal_weight_kg, correction_factor }
 *   energy_balance_pct takes priority (e.g. -0.20 = −20% of TDEE).
 *   Falls back to energy_balance_type for legacy plans.
 */
export function calcFullPlan(profile, plan) {
  const weightKg = profile.current_weight ? toKg(profile.current_weight, profile.weight_unit || 'lb') : null
  const heightCm = profile.current_height ? toCm(profile.current_height, profile.height_unit  || 'imperial') : null
  const age      = calcAge(profile.birthdate)

  if (!weightKg || !heightCm || !age || !profile.gender) return null

  const bmr  = calcBMR(weightKg, heightCm, age, profile.gender)
  const tdee = calcTDEE(bmr, plan.activity_factor)

  // energy_balance_pct (new) takes priority over energy_balance_type (legacy)
  const energyAdj = (plan.energy_balance_pct != null)
    ? Math.round(tdee * plan.energy_balance_pct)
    : ENERGY_BALANCE_TYPES[plan.energy_balance_type]?.adjustment ?? 0

  const dailyTarget = Math.round(tdee + energyAdj)
  const macros      = calcMacros(dailyTarget, plan.goal_weight_kg, plan.protein_level, plan.fat_level)
  const timeline    = calcTimeline(
    weightKg,
    plan.goal_weight_kg,
    energyAdj,
    plan.correction_factor,
    plan.energy_balance_pct ?? null,
  )

  return {
    bmr:          Math.round(bmr),
    tdee:         Math.round(tdee),
    dailyTarget,
    energyAdj,
    macros,
    timeline,
    currentWeightKg: weightKg,
    goalWeightKg:    plan.goal_weight_kg,
  }
}

/** Per-meal breakdown given daily macros and number of meals */
export function calcPerMeal(macros, dailyTarget, meals) {
  const m = Math.max(1, meals)
  return {
    calories: Math.round(dailyTarget / m),
    protein:  Math.round(macros.protein.grams / m),
    fat:      Math.round(macros.fat.grams     / m),
    carbs:    Math.round(macros.carbs.grams   / m),
  }
}
