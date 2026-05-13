/**
 * Effort tag colour system — port of MyRX/src/lib/effortTags.js to React Native.
 *
 * Web uses Tailwind class strings like 'bg-blue-500/10 text-blue-400 border border-blue-500/20'.
 * Native style equivalent: { backgroundColor, color, borderColor, borderWidth: 1 }.
 * Hex values come from the Tailwind default palette in src/theme.ts so colours match exactly.
 */

import { palette as p, withAlpha } from '../theme'
import { ISOMETRIC_EXERCISE_NAMES } from './movements'

export interface TagStyle {
  backgroundColor: string
  color: string
  borderColor: string
  borderWidth: number
}

function tag(bgHex: string, fgHex: string, borderHex: string, bgA = 0.10, borderA = 0.30): TagStyle {
  return {
    backgroundColor: withAlpha(bgHex, bgA),
    color:           fgHex,
    borderColor:     withAlpha(borderHex, borderA),
    borderWidth:     1,
  }
}

// Each entry maps to a Tailwind class string in the web; the comment shows the original.
export const TAG_STYLES: Record<string, TagStyle> = {
  // ── Primary tags ──
  // 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
  strength:  tag(p.blue[500],    p.blue[400],    p.blue[500],    0.10, 0.20),
  // 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
  cardio:    tag(p.amber[500],   p.amber[400],   p.amber[500],   0.10, 0.20),
  // 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
  weighin:   tag(p.emerald[500], p.emerald[400], p.emerald[500], 0.10, 0.20),
  // 'bg-red-500/10 text-red-400 border border-red-500/20'
  calories:  tag(p.red[500],     p.red[400],     p.red[500],     0.10, 0.20),

  // ── Bodyweight subtypes ──
  // 'bg-teal-500/10 text-teal-400 border border-teal-400/30'
  'Weigh-in':tag(p.teal[500],    p.teal[400],    p.teal[400]),

  // ── Calorie subtypes ──
  // 'bg-red-400/10 text-red-300 border border-red-400/30'
  Intake:    tag(p.red[400],     p.red[300],     p.red[400]),

  // ── Strength subtypes ──
  Barbell:   tag(p.blue[500],    p.blue[400],    p.blue[400]),
  Dumbbell:  tag(p.indigo[500],  p.indigo[400],  p.indigo[400]),
  Kettlebell:tag(p.cyan[500],    p.cyan[400],    p.cyan[400]),
  Bodyweight:tag(p.violet[500],  p.violet[400],  p.violet[400]),
  Isometric: tag(p.sky[500],     p.sky[400],     p.sky[400]),

  // ── Mobility ──
  // 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20'
  mobility:  tag(p.fuchsia[500], p.fuchsia[400], p.fuchsia[500], 0.10, 0.20),
  Movement:  tag(p.fuchsia[500], p.fuchsia[400], p.fuchsia[400]),
  Yoga:      tag(p.pink[500],    p.pink[400],    p.pink[400]),
  Stretch:   tag(p.rose[500],    p.rose[400],    p.rose[400]),

  // ── ROM body groups ──
  Shoulder:  tag(p.fuchsia[500], p.fuchsia[400], p.fuchsia[400]),
  Hip:       tag(p.pink[500],    p.pink[400],    p.pink[400]),
  Knee:      tag(p.rose[500],    p.rose[400],    p.rose[400]),
  Ankle:     tag(p.violet[500],  p.violet[400],  p.violet[400]),
  Spine:     tag(p.purple[500],  p.purple[400],  p.purple[400]),

  // ── Cardio subtypes ──
  Endurance: tag(p.amber[500],   p.amber[400],   p.amber[400]),
  Cycling:   tag(p.orange[500],  p.orange[400],  p.orange[400]),
  Rowing:    tag(p.amber[600],   p.amber[500],   p.amber[500]),
  Swimming:  tag(p.yellow[400],  p.yellow[400],  p.yellow[400]),
  Skiing:    tag(p.amber[300],   p.amber[300],   p.amber[300]),
  Metcon:    tag(p.orange[600],  p.orange[500],  p.orange[500]),
  Agility:   tag(p.yellow[600],  p.yellow[500],  p.yellow[500]),
  Mobility:  tag(p.amber[400],   p.amber[300],   p.amber[300]),
  Functional:tag(p.orange[400],  p.orange[300],  p.orange[300]),
  Machine:   tag(p.slate[500],   p.slate[400],   p.slate[400]),
}

// ── Strength subtype detection ────────────────────────────────────────────────

function getStrengthSubtype(exerciseName: string): string {
  if (ISOMETRIC_EXERCISE_NAMES.has(exerciseName)) return 'Isometric'

  const lower = exerciseName.toLowerCase()

  if (lower.includes('kettlebell')) return 'Kettlebell'

  if (
    lower.includes('dumbbell') ||
    lower.includes('goblet') ||
    lower.includes('renegade row') ||
    lower.includes('concentration curl')
  ) return 'Dumbbell'

  if (/machine|cable|lat pulldown|leg press|leg curl|leg extension|pec deck|smith |hack squat|hip abduction|hip adduction|belt squat|glute drive|assisted/.test(lower))
    return 'Machine'

  if (/pull up|push up|chin up|dip|muscle up|handstand|planche|bodyweight|pistol squat|nordic|ring row|inverted row|rope climb|bar lever|l sit|v sit|hollow|wall sit|bird dog|mountain climber|burpee/.test(lower))
    return 'Bodyweight'

  return 'Barbell'
}

// ── Cardio subtype detection ──────────────────────────────────────────────────

function getCardioSubtype(activityName: string): string {
  const lower = activityName.toLowerCase()

  if (/crab walk|bear crawl|low crawl/.test(lower)) return 'Mobility'
  if (/agility|carioca|lateral shuffle|line drill|shuttle|box step over|slideboard/.test(lower)) return 'Agility'
  if (/battle rope|jump rope|speed bag|shadow box/.test(lower)) return 'Metcon'
  if (/run|sprint|jog|trail|walk|hik|ruck|ice skat|inline skat|stair climb|cross country|roller ski/.test(lower)) return 'Endurance'
  if (/cycl|bike|spin/.test(lower)) return 'Cycling'
  if (/row|canoe|kayak|paddle|sup|paddleboard|ski erg/.test(lower)) return 'Rowing'
  if (/swim|aqua/.test(lower)) return 'Swimming'
  if (/ski/.test(lower)) return 'Skiing'
  if (/sled|carry/.test(lower)) return 'Functional'
  return 'Machine'
}

// ── Mobility subtype detection ────────────────────────────────────────────────

function getMobilitySubtype(lower: string): string {
  if (/bear crawl|bear hold|beast hold|commando crawl|crab hold|crab walk|crocodile crawl|duck walk|kickthrough|frog hop|gorilla walk|inchworm|lateral bear|lateral crab|leopard crawl|lizard walk|low crawl|monkey walk|plank walk|scorpion reach|scorpion walk|seal walk|spider|tabletop hold|traveling ape|underswitch/.test(lower))
    return 'Movement'

  if (/boat pose|bound angle|bow pose|bridge pose|cat cow|chair pose|child|cobra pose|corpse pose|crescent|dancer|double pigeon|downward dog|extended side angle|fish pose|frog pose|garland|goddess|half moon|happy baby|head.to.knee|hero pose|knees.to.chest|legs up the wall|lizard pose|locust pose|low lunge|mountain pose|pigeon pose|puppy pose|reversed warrior|sphinx|supine spinal twist|tree pose|triangle pose|upward dog|warrior|wheel pose|wide.angle/.test(lower))
    return 'Yoga'

  return 'Stretch'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EffortTagDescriptor {
  label: string
  style: TagStyle
}

export interface EffortTags {
  primary:   EffortTagDescriptor
  secondary: EffortTagDescriptor | null
}

/**
 * Returns { primary, secondary } tag descriptors for an effort row.
 * 1:1 port of getEffortTags() from the web app.
 */
export function getEffortTags(effort: { type: string; label?: string }): EffortTags {
  if (effort.type === 'strength') {
    const exerciseName = effort.label?.split(' · ')[0] ?? ''
    const subtype = getStrengthSubtype(exerciseName)
    return {
      primary:   { label: 'Strength', style: TAG_STYLES.strength },
      secondary: { label: subtype,    style: TAG_STYLES[subtype] ?? TAG_STYLES.Barbell },
    }
  }

  if (effort.type === 'cardio') {
    const activityName = effort.label?.split(' · ')[0] ?? ''
    const subtype = getCardioSubtype(activityName)
    return {
      primary:   { label: 'Cardio',  style: TAG_STYLES.cardio },
      secondary: { label: subtype,   style: TAG_STYLES[subtype] ?? TAG_STYLES.Endurance },
    }
  }

  if (effort.type === 'mobility') {
    const movementsStr = (effort.label ?? '').replace(/^Mobility Session\s*·?\s*/i, '')
    const counts: Record<string, number> = { Movement: 0, Yoga: 0, Stretch: 0 }
    movementsStr.split(',').forEach(chunk => {
      const name = chunk.trim().replace(/\s+\d+:\d{2}(?::\d{2})?$/, '').trim()
      if (name) counts[getMobilitySubtype(name.toLowerCase())]++
    })
    const subtype = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]) ?? 'Stretch'
    return {
      primary:   { label: 'Mobility', style: TAG_STYLES.mobility },
      secondary: { label: subtype,    style: TAG_STYLES[subtype] },
    }
  }

  return {
    primary:   { label: effort.type, style: TAG_STYLES.weighin },
    secondary: null,
  }
}
