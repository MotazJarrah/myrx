// Strength weight ladders + free-weight ranges for the coach/admin add-effort
// form (T131). Verbatim mirror of the mobile source of truth — mobile
// formulas.ts `EQUIPMENT_LADDERS` + strength.tsx `weightWheelProps` — and of the
// inline copies the web detail pages already use (AdminStrengthWeightedDetail /
// BallisticDetail / CarryDetail). Object carries (atlas / d-ball / sandbag),
// kettlebells and strongman events take a FIXED list of real implement weights
// (a dropdown on web); barbell / dumbbell / machine / weighted-bodyweight take a
// free numeric step. Keep these arrays identical to the detail pages so a saved
// weight always lands on the detail's ladder.

export const EQUIPMENT_LADDERS = Object.freeze({
  atlasStone: { lb: [100, 135, 150, 180, 220, 260, 300, 330, 365], kg: [45, 60, 70, 80, 100, 120, 135, 150, 165] },
  dBall:      { lb: [50, 70, 100, 125, 150, 175, 200],             kg: [25, 30, 45, 55, 70, 80, 90] },
  sandbag:    { lb: [50, 75, 100, 125, 150, 175, 200, 250, 300],   kg: [25, 35, 45, 55, 70, 80, 90, 115, 135] },
  kettlebell: { lb: [9, 18, 26, 35, 44, 53, 62, 70, 80, 88, 97, 106], kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48] },
})

export const BAND_LEVELS = ['Light', 'Medium', 'Heavy', 'Extra Heavy']

// Rucking pack-weight ladder (lb-only; 0 = bodyweight ruck). Mirrors mobile
// RUCK_WEIGHT_LOG_LADDER_LB.
export const RUCK_PACK_LADDER_LB = [0, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]

// Per-machine speed caps (km/h) for the speed-input cardio activities. Mirrors
// mobile SPEED_MAX_KMH.
export const SPEED_MAX_KMH = Object.freeze({
  'Running (Treadmill)': 30,
  'Stationary Bike': 50,
  'Bike Erg': 50,
  'Elliptical': 25,
})
export const SPEED_INPUT_ACTIVITIES = new Set(Object.keys(SPEED_MAX_KMH))

// Carry weight ladder by exercise name (atlas / d-ball / sandbag), else null
// (free numeric). Mirrors mobile weightWheelProps('carry', ...).
export function carryWeightLadder(exercise, unit) {
  const n = (exercise || '').toLowerCase()
  if (n.includes('atlas')) return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
  if (n.includes('d-ball') || n.includes('dball')) return EQUIPMENT_LADDERS.dBall[unit] ?? null
  if (n.includes('sandbag')) return EQUIPMENT_LADDERS.sandbag[unit] ?? null
  return null
}

// Weight ladder for a non-carry equipment (kettlebell / strongman), else null.
export function equipmentWeightLadder(equipment, unit) {
  if (equipment === 'kettlebell') return EQUIPMENT_LADDERS.kettlebell[unit] ?? null
  if (equipment === 'strongman') return EQUIPMENT_LADDERS.atlasStone[unit] ?? null
  return null
}

// Free-weight numeric range (step / min / max) per equipment + unit, mirroring
// mobile weightWheelProps for the non-ladder equipment.
export function freeWeightRange(equipment, unit) {
  const kg = unit === 'kg'
  switch (equipment) {
    case 'barbell':  return { step: 5, min: kg ? 20 : 45, max: kg ? 360 : 800 }
    case 'dumbbell': return { step: 5, min: kg ? 2 : 5,   max: kg ? 70 : 150 }
    case 'machine':  return { step: 5, min: kg ? 2 : 5,   max: kg ? 180 : 400 }
    case 'assisted': return { step: 5, min: 0,            max: kg ? 90 : 200 }
    case 'carry':    return { step: 5, min: kg ? 5 : 10,  max: kg ? 200 : 500 }
    default:         return { step: 5, min: 0,            max: kg ? 200 : 500 }
  }
}

// Added-load range for weighted-bodyweight movements (belt/vest). Mirrors
// mobile weightWheelProps('bodyweight', ...): step 2.5, 0 → 150/70.
export function addedLoadRange(unit) {
  const kg = unit === 'kg'
  return { step: 2.5, min: 0, max: kg ? 70 : 150 }
}
