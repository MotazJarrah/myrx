import { BODYWEIGHT_EXERCISE_NAMES } from './movements.js'

// 1RM estimation formulas (averaged)
export function estimate1RM(weight, reps) {
  if (reps === 1) return weight
  const epley = weight * (1 + reps / 30)
  const brzycki = weight * (36 / (37 - reps))
  const lombardi = weight * Math.pow(reps, 0.1)
  return Math.round((epley + brzycki + lombardi) / 3)
}

export function projectAllRMs(weight, reps) {
  const oneRM = estimate1RM(weight, reps)
  return Array.from({ length: 10 }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    // Invert each formula to project the weight you can lift for r reps
    const brzycki  = oneRM * (37 - r) / 36      // inverse Brzycki
    const epley    = oneRM / (1 + r / 30)        // inverse Epley
    const lombardi = oneRM / Math.pow(r, 0.1)   // inverse Lombardi
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

// ─── Pace projections (Riegel formula) ───────────────────────────────────────
// distanceKm  – the distance of the known effort in km
// timeSecs    – the time of the known effort in seconds
// distances   – array of { name: string, km: number } to project onto

function fmtTimeSecs(totalSecs) {
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function projectPaces(distanceKm, timeSecs, distances) {
  const dists = distances ?? [
    { name: '1 km',          km: 1 },
    { name: '5 km',          km: 5 },
    { name: '10 km',         km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
  return dists.map(({ name, km }) => {
    const projectedSecs = timeSecs * Math.pow(km / distanceKm, 1.06)
    const paceSecPerKm  = projectedSecs / km
    const pMins = Math.floor(paceSecPerKm / 60)
    const pSecs = Math.round(paceSecPerKm % 60)
    return {
      name,
      km,
      timeSecs: Math.round(projectedSecs),
      time:     fmtTimeSecs(Math.round(projectedSecs)),
      pace:     `${pMins}:${String(pSecs).padStart(2, '0')}/km`,
      paceSecPerKm,
    }
  })
}

// Calorie burn estimate
export function estimateCalories(met, weightKg, durationMins) {
  return Math.round((met * weightKg * durationMins) / 60)
}

// ─── Equipment classification ────────────────────────────────────────────────

const DUMBBELL_KEYWORDS = [
  'dumbbell', ' db ', 'dumbell',
  'kettlebell', 'goblet squat', 'concentration curl', 'renegade row',
]

/**
 * Returns 'barbell' | 'dumbbell' | 'bodyweight' for a given exercise name.
 * Checks the curated BODYWEIGHT_EXERCISE_NAMES set first (exact match),
 * then falls back to keyword heuristics.
 */
export function getEquipmentType(name = '') {
  if (BODYWEIGHT_EXERCISE_NAMES.has(name)) return 'bodyweight'
  const lower = ` ${name.toLowerCase()} `
  // Bodyweight keyword fallback for custom / unlisted names
  const bwKeywords = [
    'pull up', 'pullup', 'chin up', 'chinup', 'push up', 'pushup',
    ' dip ', 'muscle up', 'muscleup', 'handstand', 'planche',
    'bodyweight', 'body weight',
  ]
  if (bwKeywords.some(k => lower.includes(k))) return 'bodyweight'
  if (DUMBBELL_KEYWORDS.some(k => lower.includes(k))) return 'dumbbell'
  return 'barbell'
}

// ─── Barbell plate configuration ─────────────────────────────────────────────

const BAR_WEIGHT  = { lb: 45, kg: 20 }
const PLATE_SIZES = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
}
// Smallest plate pair (one per side): 2×2.5 lb = 5 lb, 2×1.25 kg = 2.5 kg
const MIN_INCREMENT = { lb: 5, kg: 2.5 }

/**
 * Returns nearest achievable barbell weight at or above `projected`
 * and the plates to load on each side.
 */
export function getNextBarbellLoad(projected, unit = 'lb') {
  const bar    = BAR_WEIGHT[unit]  ?? 45
  const inc    = MIN_INCREMENT[unit] ?? 5
  const plates = PLATE_SIZES[unit] ?? PLATE_SIZES.lb

  const weightAboveBar = Math.max(0, projected - bar)
  const nextAboveBar   = Math.ceil(weightAboveBar / inc) * inc
  const targetWeight   = bar + nextAboveBar
  const perSide        = nextAboveBar / 2

  const usedPlates = []
  let rem = perSide
  for (const p of plates) {
    while (rem >= p - 0.001) {
      usedPlates.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }

  return { weight: targetWeight, platesPerSide: usedPlates }
}

// ─── Dumbbell next weight ─────────────────────────────────────────────────────
// Dumbbells come in 5 lb / 2 kg fixed increments.

/**
 * Returns the nearest dumbbell weight at or above `projected` (per hand).
 */
export function getNextDumbbellWeight(projected, unit = 'lb') {
  const inc = unit === 'kg' ? 2 : 5
  return Math.ceil(projected / inc) * inc
}

// ─── Bodyweight-plus added weight ────────────────────────────────────────────
// For chin-ups etc. the projected weight is the added load on a belt/vest.
// Plates are added in 2.5 lb / 1.25 kg increments (no bar).

/**
 * Returns the nearest added-weight value at or above `projected`
 * and the plates that make it up (no bar weight).
 */
export function getNextAddedWeight(projected, unit = 'lb') {
  const inc    = unit === 'kg' ? 2.5 : 2.5
  const plates = PLATE_SIZES[unit] ?? PLATE_SIZES.lb

  const target = Math.ceil(Math.max(0, projected) / inc) * inc

  const usedPlates = []
  let rem = target
  for (const p of plates) {
    while (rem >= p - 0.001) {
      usedPlates.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }

  return { weight: target, plates: usedPlates }
}
