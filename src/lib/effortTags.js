/**
 * Effort tag colour system
 *
 * Each primary category owns a hue. Secondary tags within that category
 * stay in the same hue family (analogous shifts) so they feel related
 * but are still visually distinct.
 *
 * All Tailwind class strings are written out in full so JIT can scan them.
 */

import { ISOMETRIC_EXERCISE_NAMES } from './movements.js'

// ── Colour config ─────────────────────────────────────────────────────────────
// Format: full Tailwind class string for a pill chip.

export const TAG_STYLES = {
  // ── Primary tags (one per effort type) ───────────────────────────────────
  strength:     'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  cardio:       'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  weighin:      'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',

  // ── Strength subtypes (blue-family hue shifts) ────────────────────────────
  Barbell:      'bg-blue-500/10 text-blue-400 border border-blue-400/30',
  Dumbbell:     'bg-indigo-500/10 text-indigo-400 border border-indigo-400/30',
  Kettlebell:   'bg-cyan-500/10 text-cyan-400 border border-cyan-400/30',
  Bodyweight:   'bg-violet-500/10 text-violet-400 border border-violet-400/30',
  Isometric:    'bg-sky-500/10 text-sky-400 border border-sky-400/30',
  Machine:      'bg-slate-500/10 text-slate-400 border border-slate-400/30',

  // ── Mobility (fuchsia/pink family) ───────────────────────────────────────
  mobility:     'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20',
  Crawl:        'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-400/30',
  Yoga:         'bg-pink-500/10 text-pink-400 border border-pink-400/30',

  // ── Cardio subtypes (amber/orange/yellow family) ──────────────────────────
  Endurance:    'bg-amber-500/10 text-amber-400 border border-amber-400/30',
  Cycling:      'bg-orange-500/10 text-orange-400 border border-orange-400/30',
  Rowing:       'bg-amber-600/10 text-amber-500 border border-amber-500/30',
  Swimming:     'bg-yellow-400/10 text-yellow-400 border border-yellow-400/30',
  Skiing:       'bg-amber-300/10 text-amber-300 border border-amber-300/30',
  Metcon:       'bg-orange-600/10 text-orange-500 border border-orange-500/30',
  Agility:      'bg-yellow-600/10 text-yellow-500 border border-yellow-500/30',
  Mobility:     'bg-amber-400/10 text-amber-300 border border-amber-300/30',
  Functional:   'bg-orange-400/10 text-orange-300 border border-orange-300/30',
  Machine:      'bg-yellow-700/10 text-yellow-600 border border-yellow-600/30',
}

// ── Strength subtype detection ────────────────────────────────────────────────

function getStrengthSubtype(exerciseName) {
  if (ISOMETRIC_EXERCISE_NAMES.has(exerciseName)) return 'Isometric'

  const lower = exerciseName.toLowerCase()

  if (lower.includes('kettlebell')) return 'Kettlebell'

  if (
    lower.includes('dumbbell') ||
    lower.includes('goblet') ||
    lower.includes('renegade row') ||
    lower.includes('concentration curl')
  ) return 'Dumbbell'

  if (
    /machine|cable|lat pulldown|leg press|leg curl|leg extension|pec deck|smith |hack squat|hip abduction|hip adduction|belt squat|glute drive|assisted/.test(lower)
  ) return 'Machine'

  // Bodyweight: check exercise names that don't show equipment type in the name
  // We use simple keyword heuristics since getEquipmentType has a circular dep here
  if (
    /pull up|push up|chin up|dip|muscle up|handstand|planche|bodyweight|pistol squat|nordic|ring row|inverted row|rope climb|bar lever|l sit|v sit|hollow|wall sit|bird dog|mountain climber|burpee/.test(lower)
  ) return 'Bodyweight'

  return 'Barbell'
}

// ── Cardio subtype detection ──────────────────────────────────────────────────

function getCardioSubtype(activityName) {
  const lower = activityName.toLowerCase()

  // Mobility — checked first to prevent "crab walk" matching endurance
  if (/crab walk|bear crawl|low crawl/.test(lower)) return 'Mobility'

  // Agility
  if (/agility|carioca|lateral shuffle|line drill|shuttle|box step over|slideboard/.test(lower)) return 'Agility'

  // Metcon
  if (/battle rope|jump rope|speed bag|shadow box/.test(lower)) return 'Metcon'

  // Endurance (running, walking, hiking, skating, stair climb, rucking, cross-country skiing)
  if (/run|sprint|jog|trail|walk|hik|ruck|ice skat|inline skat|stair climb|cross country|roller ski/.test(lower)) return 'Endurance'

  // Cycling (bike erg matched here before generic erg)
  if (/cycl|bike|spin/.test(lower)) return 'Cycling'

  // Rowing (ski erg matched here — same machine family)
  if (/row|canoe|kayak|paddle|sup|paddleboard|ski erg/.test(lower)) return 'Rowing'

  // Swimming
  if (/swim|aqua/.test(lower)) return 'Swimming'

  // Remaining skiing (cross country already caught above)
  if (/ski/.test(lower)) return 'Skiing'

  // Functional carries & sleds
  if (/sled|carry/.test(lower)) return 'Functional'

  // Machines (elliptical, versaclimber, stairmill, arc trainer, jacob's ladder, curved treadmill)
  return 'Machine'
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns { primary, secondary } tag descriptors for an effort row.
 * Each descriptor: { label: string, cls: string (Tailwind classes) }
 * secondary may be null for types that don't have subtypes yet.
 */
export function getEffortTags(effort) {
  if (effort.type === 'strength') {
    const exerciseName = effort.label.split(' · ')[0]
    const subtype = getStrengthSubtype(exerciseName)
    return {
      primary:   { label: 'Strength', cls: TAG_STYLES.strength },
      secondary: { label: subtype,    cls: TAG_STYLES[subtype] ?? TAG_STYLES.Barbell },
    }
  }

  if (effort.type === 'cardio') {
    const activityName = effort.label.split(' · ')[0]
    const subtype = getCardioSubtype(activityName)
    return {
      primary:   { label: 'Cardio',  cls: TAG_STYLES.cardio },
      secondary: { label: subtype,   cls: TAG_STYLES[subtype] ?? TAG_STYLES.Endurance },
    }
  }

  if (effort.type === 'mobility') {
    const movementName = effort.label.replace(/^Mobility Session\s*·?\s*/i, '').split(',')[0].trim()
    const lower = movementName.toLowerCase()
    const subtype = /crawl|walk|inchworm|seal|monkey|scorpion|lizard walk/.test(lower) ? 'Crawl' : 'Yoga'
    return {
      primary:   { label: 'Mobility', cls: TAG_STYLES.mobility },
      secondary: { label: subtype,    cls: TAG_STYLES[subtype] },
    }
  }

  // Fallback for any future types
  return {
    primary:   { label: effort.type, cls: TAG_STYLES.weighin },
    secondary: null,
  }
}
