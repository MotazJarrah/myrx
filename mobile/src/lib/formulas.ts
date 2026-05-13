/**
 * Direct port of MyRX/src/lib/formulas.js — physics + math only, no DOM.
 * Only the functions Strength + Cardio + Bodyweight need are ported here;
 * plate-loader and BODYWEIGHT_EXERCISE_NAMES come back later if/when needed.
 */

// ─── 1RM estimation (Epley + Brzycki + Lombardi averaged) ─────────────────────
// Brzycki's linear assumption breaks past ~10 reps — it dramatically
// under-projects load at 15 / 20RM relative to lab data. We drop it from the
// average when reps > 10 and use Epley + Lombardi only (both behave
// asymptotically and stay closer to NSCA reference tables at high reps).
export function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight
  const epley    = weight * (1 + reps / 30)
  const lombardi = weight * Math.pow(reps, 0.1)
  if (reps > 10) return Math.round((epley + lombardi) / 2)
  const brzycki  = weight * (36 / (37 - reps))
  return Math.round((epley + brzycki + lombardi) / 3)
}

export function projectAllRMs(weight: number, reps: number, maxReps: number = 20) {
  const oneRM = estimate1RM(weight, reps)
  return Array.from({ length: maxReps }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    const epley    = oneRM / (1 + r / 30)
    const lombardi = oneRM / Math.pow(r, 0.1)
    if (r > 10) {
      return { reps: r, weight: Math.round((epley + lombardi) / 2) }
    }
    const brzycki  = oneRM * (37 - r) / 36
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

// ─── Pace projections (Riegel formula) ───────────────────────────────────────

function fmtTimeSecs(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function projectPaces(distanceKm: number, timeSecs: number, distances?: { name: string; km: number }[]) {
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

// ─── Calorie burn (MET formula) ──────────────────────────────────────────────
export function estimateCalories(met: number, weightKg: number, durationMins: number): number {
  return Math.round((met * weightKg * durationMins) / 60)
}

// ─── Barbell plate configuration ─────────────────────────────────────────────

type Unit = 'lb' | 'kg'

const BAR_WEIGHT:   Record<Unit, number>   = { lb: 45,   kg: 20   }
const MIN_INCREMENT: Record<Unit, number>  = { lb: 5,    kg: 2.5  }
const PLATE_SIZES:  Record<Unit, number[]> = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
}

/**
 * Returns the next achievable barbell weight strictly above `projected`
 * by exactly one minimum plate increment (+5 lb / +2.5 kg per session).
 *
 * Boundary fix: when `projected` already sits exactly on a plate boundary
 * (e.g. 335 lb = 45 bar + 290), we always advance by one more increment.
 */
export function getNextBarbellLoad(
  projected: number,
  unit: Unit = 'lb',
): { weight: number; platesPerSide: number[] } {
  const bar    = BAR_WEIGHT[unit]
  const inc    = MIN_INCREMENT[unit]
  const plates = PLATE_SIZES[unit]

  const weightAboveBar = Math.max(0, projected - bar)
  const nextAboveBar = (weightAboveBar % inc === 0)
    ? weightAboveBar + inc
    : Math.ceil(weightAboveBar / inc) * inc
  const targetWeight = bar + nextAboveBar
  const perSide      = nextAboveBar / 2

  const usedPlates: number[] = []
  let rem = perSide
  for (const p of plates) {
    while (rem >= p - 0.001) {
      usedPlates.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return { weight: targetWeight, platesPerSide: usedPlates }
}

/**
 * Returns the next dumbbell weight strictly above `projected` (per hand).
 * Dumbbells increment in fixed steps (5 lb / 2 kg).
 */
export function getNextDumbbellWeight(projected: number, unit: Unit = 'lb'): number {
  const inc = unit === 'kg' ? 2 : 5
  return (projected % inc === 0)
    ? projected + inc
    : Math.ceil(projected / inc) * inc
}

/**
 * Returns the smallest loadable weight STRICTLY ABOVE `current` for the given
 * equipment type. Mirror of web `nextLoadableAbove`.
 */
export function nextLoadableAbove(current: number, equipment: LadderEquipment, unit: LadderUnit = 'lb'): number | null {
  const ladder = getLadder(equipment, unit)
  if (ladder) {
    for (const w of ladder) if (w > current) return w
    return null
  }
  if (equipment === 'barbell')    return getNextBarbellLoad(current, unit).weight
  if (equipment === 'dumbbell')   return getNextDumbbellWeight(current, unit)
  if (equipment === 'machine')    return getNextDumbbellWeight(current, unit)
  if (equipment === 'bodyweight') return getNextAddedWeight(current, unit).weight
  return null
}

/**
 * Returns the smallest LOADABLE weight ≥ `raw` for a given equipment type.
 * Mirror of web loadableWeight.
 */
export function loadableWeight(raw: number, equipment: LadderEquipment, unit: LadderUnit = 'lb'): number {
  const ladder = getLadder(equipment, unit)
  if (ladder) {
    for (const w of ladder) if (w >= raw) return w
    return ladder[ladder.length - 1]
  }
  if (equipment === 'barbell') {
    const bar = BAR_WEIGHT[unit]
    const inc = MIN_INCREMENT[unit]
    const above = Math.max(0, raw - bar)
    return bar + Math.ceil(above / inc) * inc
  }
  if (equipment === 'dumbbell') {
    const inc = unit === 'kg' ? 2 : 5
    return Math.max(inc, Math.ceil(raw / inc) * inc)
  }
  if (equipment === 'machine') {
    const inc = unit === 'kg' ? 2.5 : 5
    return Math.max(inc, Math.ceil(raw / inc) * inc)
  }
  if (equipment === 'bodyweight') {
    const inc = 2.5
    return Math.max(0, Math.ceil(raw / inc) * inc)
  }
  return raw
}

/**
 * Returns the plates per side needed to load a SPECIFIC barbell weight.
 * Mirror of web platesForBarbellWeight.
 */
export function platesForBarbellWeight(weight: number, unit: Unit = 'lb'): number[] {
  const bar    = BAR_WEIGHT[unit]
  const plates = PLATE_SIZES[unit]
  const perSide = Math.max(0, (weight - bar)) / 2
  const used: number[] = []
  let rem = perSide
  for (const p of plates) {
    while (rem >= p - 0.001) {
      used.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return used
}

/**
 * Returns the plates needed to add a SPECIFIC weight via belt or vest.
 * Mirror of web platesForAddedWeight.
 */
export function platesForAddedWeight(weight: number, unit: Unit = 'lb'): number[] {
  const plates = PLATE_SIZES[unit]
  const used: number[] = []
  let rem = Math.max(0, weight)
  for (const p of plates) {
    while (rem >= p - 0.001) {
      used.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return used
}

/**
 * Returns the next added-weight value strictly above `projected`
 * (belt/vest for bodyweight exercises). Plates added in 2.5 lb / 1.25 kg
 * increments (no bar). Same boundary fix as barbell.
 */
export function getNextAddedWeight(
  projected: number,
  unit: Unit = 'lb',
): { weight: number; plates: number[] } {
  const inc    = 2.5
  const plates = PLATE_SIZES[unit]

  const safe   = Math.max(0, projected)
  const target = (safe % inc === 0)
    ? safe + inc
    : Math.ceil(safe / inc) * inc

  const usedPlates: number[] = []
  let rem = target
  for (const p of plates) {
    while (rem >= p - 0.001) {
      usedPlates.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return { weight: target, plates: usedPlates }
}

// ── Strongman work-volume scores (Mode B + Mode C) ──────────────────────
// For weighted carries (Mode B = weight × distance) and weighted isometric
// holds (Mode C = weight × time), no peer-reviewed projection formula
// equivalent to Epley/Brzycki exists. Reviewed: biomechanics literature
// (Frontiers in Sports 2021, Sports Medicine Open 2019) on yoke walks and
// farmer's carries focuses on stride / GRF patterns, not predictive
// distance projections. For isometric holds, the Hill force-velocity
// equation is muscle-physiology-level — not usable as a "next target"
// projection.
//
// Instead we expose a simple work-volume score (load × secondary), useful
// for set-to-set comparison and PR ranking ACROSS loads, but NOT a true
// 1RM equivalent. Mirrors web/src/lib/projections.js.

/** Mode B — carry work score: weight × distance. Units: lb·ft or kg·m. */
export function carryWorkScore(weight: number, distance: number): number {
  if (weight <= 0 || distance <= 0) return 0
  return weight * distance
}

/** Mode C — hold work score: weight × time held. Units: lb·s or kg·s. */
export function holdWorkScore(weight: number, timeSeconds: number): number {
  if (weight <= 0 || timeSeconds <= 0) return 0
  return weight * timeSeconds
}

// ─── Implement ladders (atlas stone / d-ball / sandbag / kettlebell) ────────
// "Ladders" are fixed, non-uniform weight progressions that match what's
// physically available — you can't add a 2.5 lb plate to an atlas stone.
// Sources:
//   • Atlas stone:    World's Strongest Man competition standards.
//   • D-ball:         Rogue / Sorinex gym standards.
//   • Sandbag:        Rogue Strongman, GORUCK, Brute Force standards.
//   • Kettlebell:     IKFF / IKMF — 4 kg increments, converted to lb.
// All ladders are sorted ascending. A movement can override per-row via
// `weight_ladder_override` JSONB column. Both lb + kg variants are exposed
// so the picker can swap at the unit boundary.
// Mirrors web/src/lib/formulas.js EQUIPMENT_LADDERS exactly.
export type LadderUnit = 'lb' | 'kg'
export interface LadderSet { lb: number[]; kg: number[] }

export const EQUIPMENT_LADDERS: Readonly<Record<'atlasStone'|'dBall'|'sandbag'|'kettlebell', LadderSet>> = Object.freeze({
  atlasStone: {
    lb: [100, 135, 150, 180, 220, 260, 300, 330, 365],
    kg: [45,  60,  70,  80,  100, 120, 135, 150, 165],
  },
  dBall: {
    lb: [50, 70,  100, 125, 150, 175, 200],
    kg: [25, 30,  45,  55,  70,  80,  90],
  },
  sandbag: {
    lb: [50, 75,  100, 125, 150, 175, 200, 250, 300],
    kg: [25, 35,  45,  55,  70,  80,  90,  115, 135],
  },
  kettlebell: {
    lb: [9, 18, 26, 35, 44, 53, 62, 70, 80, 88, 97, 106],
    kg: [4, 8,  12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
  },
})

export type LadderEquipment =
  | 'barbell' | 'dumbbell' | 'kettlebell' | 'machine'
  | 'strongman' | 'atlasStone' | 'dBall' | 'sandbag' | 'bodyweight'

export type LadderOverride = number[] | { lb?: number[]; kg?: number[] } | null | undefined

/**
 * Resolve a movement's ladder array based on equipment + unit. Returns null
 * if the equipment isn't ladder-style (barbell / dumbbell / bodyweight).
 * Pass `override` (a row's `weight_ladder_override` JSONB) to use the row's
 * custom ladder instead of the equipment-wide default.
 */
export function getLadder(
  equipment: LadderEquipment,
  unit: LadderUnit = 'lb',
  override: LadderOverride = null,
): number[] | null {
  if (override && Array.isArray(override) && override.length > 0) {
    return [...override].sort((a, b) => a - b)
  }
  if (override && !Array.isArray(override) && override[unit] && Array.isArray(override[unit])) {
    return [...(override[unit] as number[])].sort((a, b) => a - b)
  }
  switch (equipment) {
    case 'atlasStone': return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
    case 'dBall':      return EQUIPMENT_LADDERS.dBall[unit] ?? null
    case 'sandbag':    return EQUIPMENT_LADDERS.sandbag[unit] ?? null
    case 'kettlebell': return EQUIPMENT_LADDERS.kettlebell[unit] ?? null
    case 'strongman':  return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
    default:           return null
  }
}

/**
 * Given a ladder array and a current weight, return the NEXT step on the
 * ladder strictly above `current`. Returns `null` if `current` is already at
 * or above the top of the ladder (the user has graduated past the heaviest
 * implement available — show "unsupported, log free weight" UX).
 */
export function nextLadderStep(ladder: number[] | null, current: number): number | null {
  if (!ladder || ladder.length === 0) return null
  for (const w of ladder) {
    if (w > current) return w
  }
  return null
}

// ── adp-zone (adaptation zone) classification + defaults ─────────────────
// Mirror of web formulas.js. See CLAUDE.md "Weighted Standard next-target
// card" for the locked spec. Per-movement overrides are NOT allowed.

export type AdpZone = 'strength' | 'hypertrophy' | 'endurance'

export function adpZoneFor(reps: number): AdpZone {
  if (reps <= 5)  return 'strength'
  if (reps <= 12) return 'hypertrophy'
  return 'endurance'
}

export interface AdpZoneConfigEntry {
  label:        string
  repRangeText: string
  setsText:     string
  rirText:      string
  restText:     string
  whyText:      string
}

export const ADP_ZONE_CONFIG: Readonly<Record<AdpZone, AdpZoneConfigEntry>> = Object.freeze({
  strength: {
    label:        'Build Strength',
    repRangeText: 'reps 1-5',
    setsText:     '4-5 sets',
    rirText:      'stop 1 rep short of failure',
    restText:     '3-5 min',
    whyText:
      'Heavy loads at low reps recruit your biggest motor units and train them to fire harder and faster. The adaptation is neural — you get stronger without adding muscle size.',
  },
  hypertrophy: {
    label:        'Increase Hypertrophy',
    repRangeText: 'reps 6-12',
    setsText:     '3-4 sets',
    rirText:      'stop 2 reps short of failure',
    restText:     '2-3 min',
    whyText:
      'Moderate loads taken close to failure put muscle fibers under sustained mechanical tension and metabolic stress. Both signals trigger growth of the fibers themselves.',
  },
  endurance: {
    label:        'Boost Endurance',
    repRangeText: 'reps 13+',
    setsText:     '2-3 sets',
    rirText:      'stop 3 reps short of failure',
    restText:     '45-60 sec',
    whyText:
      'Lighter loads at high reps drive capillary and mitochondrial growth inside the muscle. The adaptation is in stamina and waste clearance, not raw force — your muscles work longer before fatigue.',
  },
})

// ─── Double-progression target ──────────────────────────────────────────────
// Schoenfeld 2017, Helms 2018, PMC 2021 meta-analysis:
//   "Stay at the same load until you hit the top of the prescribed rep range,
//    then graduate to the next load and reset to the bottom of the range."
// This is the safest default progression rule for non-1RM training.
// Mirrors web/src/lib/formulas.js nextProgression.
export interface NextProgressionInput {
  weight: number
  reps: number
  repRangeLo: number | null | undefined
  repRangeHi: number | null | undefined
  equipment?: LadderEquipment
  ladder?: number[] | null
  unit?: LadderUnit
}

export interface NextProgressionResult {
  stayAtWeight: boolean
  weight: number
  targetRepsLo: number | null | undefined
  targetRepsHi: number | null | undefined
  atTop: boolean
}

export function nextProgression({
  weight, reps, repRangeLo, repRangeHi,
  equipment = 'barbell', ladder = null, unit = 'lb',
}: NextProgressionInput): NextProgressionResult {
  const lo = Number.isFinite(repRangeLo) ? (repRangeLo as number) : null
  const hi = Number.isFinite(repRangeHi) ? (repRangeHi as number) : null

  if (lo == null || hi == null) {
    return { stayAtWeight: true, weight, targetRepsLo: lo, targetRepsHi: hi, atTop: false }
  }

  if (!Number.isFinite(reps) || reps < hi) {
    const nextLo = Number.isFinite(reps) ? Math.min(reps + 1, hi) : lo
    return { stayAtWeight: true, weight, targetRepsLo: nextLo, targetRepsHi: hi, atTop: false }
  }

  let nextWeight: number | null = null
  const explicitLadder = ladder ?? getLadder(equipment, unit)
  if (explicitLadder) {
    nextWeight = nextLadderStep(explicitLadder, weight)
  } else if (equipment === 'barbell') {
    nextWeight = getNextBarbellLoad(weight, unit).weight
  } else if (equipment === 'dumbbell') {
    nextWeight = getNextDumbbellWeight(weight, unit)
  } else if (equipment === 'machine') {
    const inc = unit === 'kg' ? 2.5 : 5
    nextWeight = weight + inc
  } else if (equipment === 'bodyweight') {
    nextWeight = getNextAddedWeight(weight, unit).weight
  } else {
    nextWeight = getNextBarbellLoad(weight, unit).weight
  }

  if (nextWeight == null) {
    return { stayAtWeight: true, weight, targetRepsLo: lo, targetRepsHi: hi, atTop: true }
  }
  return { stayAtWeight: false, weight: nextWeight, targetRepsLo: lo, targetRepsHi: hi, atTop: false }
}
