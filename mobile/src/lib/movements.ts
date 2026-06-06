/**
 * Subset of MyRX/src/lib/movements.js needed by effortTags + screens.
 *
 * Only ISOMETRIC_EXERCISE_NAMES is required here — it backs a synchronous
 * tag-color check in `effortTags.ts` that runs without waiting for the DB.
 *
 * Everything else (strength/cardio/mobility lists, equipment classification,
 * band/knee eligibility, cardio mode) is read straight from the Supabase
 * `movements` table via `useMovements()` — the DB is the single source of
 * truth for movement classifications. The web app duplicates these as
 * static lists for historical reasons; that's tech debt scheduled to be
 * cleaned up via a future `sync mob to web: movements catalog`.
 *
 * The one piece of pure logic that legitimately stays in code (because it
 * depends on the user's distance-unit preference and isn't data) is
 * `getCardioDistances(name, distUnit)` — that gets added when we port
 * CardioDetail. Until then there's nothing to add here.
 */

/**
 * Cardio machines where the user reads SPEED off the console (rather than
 * computing time mentally). For these activities, both the log form and the
 * detail page display speed (km/h or mph) as the primary metric:
 *   • Log entry: user enters Distance + Speed (Time auto-computes).
 *   • Detail page: hero card row 2 = Speed, row 3 = Time. Tile row shows
 *     Work + Speed. Chart Y-axis = Speed (higher = better, non-reversed).
 *     Header subtitle shows "Best speed — N km/h" instead of "Best pace".
 *   • Saved label format stays the same ("<activity> · <dist> <unit> in mm:ss");
 *     speed is computed from stored pace at display time. No DB migration.
 *
 * Defined here (not inside cardio.tsx) so the detail page can import the same
 * authoritative set without redefining it.
 */
export const SPEED_INPUT_ACTIVITIES = new Set<string>([
  'Running (Treadmill)',
  'Stationary Bike',
  'Bike Erg',
  'Elliptical',
])
// Note: Air Bike was previously in SPEED_INPUT_ACTIVITIES but was moved
// to CALORIE_INPUT_ACTIVITIES (May 17 2026) — air bike training is
// programmed in calories, not speed/distance. See Air Bike detail card
// spec in CLAUDE.md for the full rationale.

export function isSpeedMachine(activity: string): boolean {
  return SPEED_INPUT_ACTIVITIES.has(activity)
}

// ── Pace ↔ Speed conversion helpers ──────────────────────────────────────────
// Stored pace is always in seconds per kilometre. Display speed is in km/h
// or mph based on the user's distance unit. Formula: speed_kmh = 3600 / paceSecsPerKm.

export function paceSecsPerKmToSpeedKmh(paceSecsPerKm: number): number {
  if (!paceSecsPerKm || paceSecsPerKm <= 0) return 0
  return 3600 / paceSecsPerKm
}

export function paceSecsPerKmToSpeedDisplay(paceSecsPerKm: number, distUnit: 'km' | 'mi'): number {
  const kmh = paceSecsPerKmToSpeedKmh(paceSecsPerKm)
  return distUnit === 'mi' ? kmh / 1.60934 : kmh
}

/** "12.0 km/h" or "7.5 mph" — one decimal place. */
export function formatSpeed(paceSecsPerKm: number, distUnit: 'km' | 'mi'): string {
  const speed = paceSecsPerKmToSpeedDisplay(paceSecsPerKm, distUnit)
  const unit  = distUnit === 'mi' ? 'mph' : 'km/h'
  return `${speed.toFixed(1)} ${unit}`
}

/**
 * Realistic speed ceiling per machine in km/h — used to cap the cardio
 * Speed wheel's scrollable range so users can't dial in obviously
 * impossible numbers. Values are conservative — slightly above the
 * fastest real-world maxes so genuine sprint bursts still fit:
 *
 *   • Running (Treadmill): 30 km/h — highest commercial treadmills
 *     (Woodway, Curve) cap around 24–30; consumer treadmills cap at 16–20.
 *   • Stationary Bike: 50 km/h — Peloton-class indoor bikes display this
 *     range under heavy load.
 *   • Bike Erg: 50 km/h — Concept2 Bike Erg, calibrated to feel like
 *     outdoor cycling; sustained max for elite users is in this range.
 *   • Air Bike: 40 km/h — fan-resistance maxes out around here even on
 *     all-out sprints (Assault Bike / Echo Bike / Rogue Echo).
 *   • Elliptical: 25 km/h — consumer ellipticals top out around here.
 *
 * Bolt's sprint peak (44.7 km/h sustained 2s) is unattainable on any
 * machine in this list, so no machine needs to exceed 50.
 */
const SPEED_MAX_KMH: Record<string, number> = {
  'Running (Treadmill)': 30,
  'Stationary Bike':     50,
  'Bike Erg':            50,
  'Elliptical':          25,
}

/**
 * Max value (in TENTHS of the display unit) for the cardio Speed wheel.
 * The wheel's `decimal="XX.X"` mode takes integer tenths — multiply the
 * desired max-speed by 10. Returns a fallback of 500 (50.0 display units)
 * for any activity not in SPEED_MAX_KMH.
 */
export function speedMaxTenths(activity: string, distUnit: 'km' | 'mi'): number {
  const baseKmh    = SPEED_MAX_KMH[activity] ?? 50
  const displayMax = distUnit === 'mi' ? baseKmh / 1.60934 : baseKmh
  return Math.round(displayMax * 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Swimming stroke consolidation (May 17 2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// Swimming has 4 stroke variants stored as separate movements in the DB:
//   Swimming [Freestyle], Swimming [Backstroke],
//   Swimming [Breaststroke], Swimming [Butterfly]
//
// They collapse into a single detail page via SwimmingConsolidatedDetail,
// mirroring the Sled Work [Push] / [Pull] pattern from strength. Helpers
// below live in this shared lib so cardio.tsx (log form + index) and the
// detail page can both reference the same authoritative stroke list.

export type SwimStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly'

// Slot order — HARDEST first (left → right) per the universal carousel
// pattern (matches BW assist tiers: FULL RX → BAND → KNEE → BAND+KNEE,
// and adp zones: STRENGTH → HYPERTROPHY → ENDURANCE). Butterfly is the
// most technically demanding stroke (dolphin kick + simultaneous over-
// head arms) and physiologically the costliest per length; freestyle
// is the easiest / most common. The order also drives default landing
// in the consolidated detail page (lands on the hardest LOGGED stroke).
export const SWIM_STROKE_ORDER: readonly SwimStroke[] =
  ['butterfly', 'breaststroke', 'backstroke', 'freestyle'] as const

export const SWIM_STROKE_LABELS: Record<SwimStroke, { full: string; short: string }> = Object.freeze({
  freestyle:    { full: 'Freestyle',    short: 'FREE'   },
  backstroke:   { full: 'Backstroke',   short: 'BACK'   },
  breaststroke: { full: 'Breaststroke', short: 'BREAST' },
  butterfly:    { full: 'Butterfly',    short: 'FLY'    },
})

export const SWIMMING_BASE_NAME = 'Swimming'

// All 4 stroke-specific movement names. Used by the cardio index to
// collapse them into a single "Swimming" row, and by the detail page
// fetch query to pull efforts across all strokes in one shot.
export const SWIMMING_STROKE_MOVEMENTS: readonly string[] = SWIM_STROKE_ORDER.map(
  s => `${SWIMMING_BASE_NAME} [${SWIM_STROKE_LABELS[s].full}]`,
)

/**
 * True if a movement name is one of the four bracketed swim variants.
 * False for bare "Swimming" (legacy / synthetic).
 */
export function isSwimStrokeMovement(name: string | null | undefined): boolean {
  if (!name) return false
  return SWIMMING_STROKE_MOVEMENTS.includes(name)
}

/**
 * Map a bracketed movement name back to its SwimStroke.
 *   "Swimming [Backstroke]"   → 'backstroke'
 *   "Swimming [Freestyle]"    → 'freestyle'
 *   "Swimming"                → null (bare, not a stroke variant)
 *   "Running"                 → null
 */
export function swimStrokeFromMovementName(name: string | null | undefined): SwimStroke | null {
  if (!name) return null
  const m = name.match(/^Swimming\s+\[(\w+)\]$/i)
  if (!m) return null
  const stroke = m[1].toLowerCase() as SwimStroke
  if (SWIM_STROKE_ORDER.includes(stroke)) return stroke
  return null
}

/**
 * Parse the stroke from an effort label's leading "Swimming [X] · ..."
 * prefix. Bare "Swimming · ..." labels (logged before the May 17 2026
 * stroke consolidation) default to Freestyle on the read path.
 */
export function parseSwimStroke(label: string | null | undefined): SwimStroke {
  if (!label) return 'freestyle'
  const first = label.split(' · ')[0] ?? ''
  const m = first.match(/^Swimming\s+\[(\w+)\]/i)
  if (!m) return 'freestyle'
  const stroke = m[1].toLowerCase() as SwimStroke
  if (SWIM_STROKE_ORDER.includes(stroke)) return stroke
  return 'freestyle'
}

/**
 * True if the activity is any kind of swim — bracketed stroke variant,
 * the base "Swimming" name (from the index collapse navigation), or
 * legacy bare "Swimming" effort labels.
 */
export function isSwimActivity(activity: string | null | undefined): boolean {
  if (!activity) return false
  if (activity === SWIMMING_BASE_NAME) return true
  if (activity.startsWith('Swimming [')) return true
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Row Erg (Concept2) — May 17 2026
// ─────────────────────────────────────────────────────────────────────────────
//
// Concept2 rowing is a well-established sport with its own canonical
// conventions:
//   • Distance in METERS, never km / mi (Concept2 community is universally
//     metric and integer-meter)
//   • Pace expressed as SPLIT TIME per 500m (e.g., "1:55/500m" — the
//     industry-standard "split"), never per-km
//   • Canonical sessions: 2K test, 5K piece, 10K piece, 4×500m intervals,
//     5×1000m intervals, 8×500m sprints
//
// We keep Row Erg in pace-mode storage (cardio_mode='pace', pace stored
// as "X:XX/km" in the value column) for cross-activity uniformity — the
// per-500m display is purely a presentation-layer transform. The log
// form swaps the standard decimal-km distance wheel for an integer-meter
// wheel (similar to swimming) and writes labels like:
//   "Row Erg · 5000 m in 18:30"

export const ROW_ERG_ACTIVITY = 'Row Erg'

export function isRowErgActivity(activity: string | null | undefined): boolean {
  return activity === ROW_ERG_ACTIVITY
}

/**
 * Convert seconds-per-km (the universal cardio storage unit) to a
 * formatted per-500m split. Rowing's pace metric is split per 500m,
 * so 4:00/km becomes 2:00/500m. Returns "—" for invalid input.
 */
export function pacePer500mFromSecsPerKm(secsPerKm: number | null | undefined): string {
  if (!secsPerKm || secsPerKm <= 0) return '—'
  const secsPer500m = secsPerKm / 2
  const m = Math.floor(secsPer500m / 60)
  const s = Math.round(secsPer500m % 60)
  return `${m}:${String(s).padStart(2, '0')}/500m`
}

/**
 * Convert seconds-per-km pace to mechanical wattage on a Concept2 erg
 * (Row Erg, Bike Erg, Ski Erg). Concept2's official pace↔watts formula:
 *
 *   pace_m_per_s = 1000 / pace_sec_per_km
 *   watts = 2.80 × (pace_m_per_s)³
 *
 * Derivation: the Concept2 Performance Monitor's energy model assumes
 * a 2.80 J/m drag factor at standard PM5 calibration; cubic relationship
 * comes from fluid-resistance drag on the flywheel. Same formula applies
 * to Row Erg, Bike Erg, and Ski Erg — they share the Concept2 engine.
 *
 * For a 2:00/500m split (universal rowing benchmark for ~200W workouts):
 *   pace_sec_per_km = 240
 *   pace_m_per_s = 1000 / 240 = 4.167
 *   watts = 2.80 × 4.167³ ≈ 203 W  ✓ (Concept2's published table)
 *
 * Returns integer watts. 0 for invalid input.
 */
export function pacePer500mToWatts(secsPerKm: number | null | undefined): number {
  if (!secsPerKm || secsPerKm <= 0) return 0
  const paceMps = 1000 / secsPerKm
  return Math.round(2.80 * paceMps ** 3)
}

export const CONCEPT2_ERG_ACTIVITIES = new Set(['Row Erg', 'Bike Erg', 'Ski Erg'])

export function isConcept2ErgActivity(activity: string | null | undefined): boolean {
  if (!activity) return false
  return CONCEPT2_ERG_ACTIVITIES.has(activity)
}

// ─────────────────────────────────────────────────────────────────────────────
// Air Bike (May 17 2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// Air bikes (Assault, Echo, Rogue, Schwinn Airdyne) are fan-resistance
// machines. Effort is exponential — push harder, get harder resistance —
// so the entire training methodology is built around short intense
// intervals measured in CALORIES, NOT distance or pace. The log form
// for Air Bike accepts Calories + Time (not Distance + Speed); the
// detail page prescribes interval sets in calorie targets (e.g.,
// "8 × 10 cal sprint, 45 sec rest").
//
// The user's "CSS-equivalent" on air bike is their peak cal/min rate
// — derived from any logged effort as total_cal ÷ total_time_min.
// Zone targets scale linearly with this rate so a faster user gets
// bigger calorie targets per rep (their reps still last roughly the
// same wall-clock time).

export const AIR_BIKE_ACTIVITY = 'Air Bike'

export function isAirBikeActivity(activity: string | null | undefined): boolean {
  return activity === AIR_BIKE_ACTIVITY
}

/**
 * Baseline cal/min rate for users who haven't logged an air bike effort
 * yet (cold start). Once they log any effort, their actual cal/min
 * replaces this baseline.
 *
 * Numbers reflect typical beginner-to-intermediate cal accumulation
 * rates on an Assault Bike with the resistance set normally. They're
 * gender-scaled because cal accumulation is power-dependent (watts),
 * and men generate more power on average due to muscle mass + leverage.
 * The Assault Bike's cal meter uses a fixed formula (~3.6 cal per
 * watt-hour), so faster output → more cals/min.
 *
 *   • male  → 18 cal/min — typical intermediate male output
 *   • else  → 13 cal/min — female value (used for female, non-binary,
 *                          prefer-not-to-say, null). Uniform "male /
 *                          else=female" rule across every gender-driven
 *                          calc in the system; see calorieFormulas.ts
 *                          calcBMR for the canonical comment. Decided
 *                          May 23 2026 to replace the earlier averaging.
 */
export function genderBaselineCalsPerMin(gender: string | null | undefined): number {
  return gender === 'male' ? 18 : 13
}

/**
 * Parse the cal-mode effort label "Air Bike · 50 cal in 5:00" → { cals, timeSecs }.
 * Returns null for labels that don't match the air-bike format.
 */
export function parseAirBikeLabel(label: string | null | undefined): { cals: number; timeSecs: number | null } | null {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  const m = part.match(/^(\d+)\s*cal\s+in\s+(\d+):(\d{2}(?::\d{2})?)$/)
  if (!m) return null
  const cals = parseInt(m[1], 10)
  const timeStr = `${m[2]}:${m[3]}`
  const timeParts = timeStr.split(':').map(Number)
  let timeSecs: number | null = null
  if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
  else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
  return { cals, timeSecs }
}

/**
 * Convert (cals, timeSecs) to cal/min rate. Returns 0 for invalid input.
 */
export function calsPerMinFromEffort(cals: number, timeSecs: number | null): number {
  if (!cals || !timeSecs || timeSecs <= 0) return 0
  return cals / (timeSecs / 60)
}

// ─────────────────────────────────────────────────────────────────────────────
// Rucking (May 19 2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// Rucking is walking with weight on your back — universally programmed by the
// GoRuck / military / tactical-fitness community in **pounds with miles**.
// Despite being a cardio activity (aerobic, low-intensity, sustained), the
// progression model is CARRY-LIKE, not pace-like — you get better by carrying
// heavier or farther, not by getting faster. The detail page mirrors Atlas
// Stone Bear Hug Carry's design (abs-mode tier ladder + load+distance hero
// card + 3 adaptation zones) rather than running's pace zones.
//
// Unit lock: distance to MILES (already in `movements.unit_lock = 'mi'`).
// Pack weight is hard-coded LB-only in the detail page + log form — the
// `unit_lock` column only holds ONE unit (mi for rucking), so the weight
// lock lives in code.

export const RUCKING_ACTIVITY = 'Rucking'

export function isRuckingActivity(activity: string | null | undefined): boolean {
  return activity === RUCKING_ACTIVITY
}

/**
 * Rucking pack weight ladder (lb) — real plate sizes available to the
 * rucking community: GoRuck Sand Plates (10 / 20 / 30 / 45 lb), Rogue
 * Echo plates (10 / 15 / 20 / 25 / 30 / 35 / 40 / 45 lb), and realistic
 * stacked combinations (50 / 60 / 70 / 80 lb).
 *
 * Two variants:
 *   • RUCK_WEIGHT_LADDER_LB        — math ladder used by the detail
 *     page's zone snapping. Starts at 10 lb so conditioning never
 *     prescribes "0 lb" (which isn't a meaningful pack weight).
 *   • RUCK_WEIGHT_LOG_LADDER_LB    — log form wheel ladder. Prepends 0
 *     so the user can record bodyweight rucking (no pack) explicitly.
 */
export const RUCK_WEIGHT_LADDER_LB: readonly number[] = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]
export const RUCK_WEIGHT_LOG_LADDER_LB: readonly number[] = [0, ...RUCK_WEIGHT_LADDER_LB]

// ─────────────────────────────────────────────────────────────────────────────
// StairMill (May 19 2026 — coaching surface, science-backed 3-zone progression)
// ─────────────────────────────────────────────────────────────────────────────
//
// The StairMaster Step Mill is one of the highest-MET sustainable cardio
// machines (~8-12 METs at moderate-to-vigorous effort). Coaching surface
// mirrors Air Bike's architecture: a single rate metric (floors per minute)
// anchors three zones (Endurance / Threshold / VO2 Max) — same mental model
// the user already learned from running, swimming, ergs, and air bike.
//
// Science backing:
//   • Allison et al. (2017) Med Sci Sports Exerc — "Brief Intense Stair
//     Climbing Improves Cardiorespiratory Fitness". 3 × 20-sec sprints,
//     3×/week → +12 % VO2peak in 6 weeks. Drives the VO2 zone protocol.
//   • Boreham et al. (2000) Prev Med — accumulated daily stair climbing
//     improved VO2max ~17 % in sedentary adults; ACSM 12th ed supports
//     20-min continuous vigorous climbing. Drives the Endurance zone.
//   • Interval-training research (Seiler 2010; Laursen & Jenkins 2002) +
//     ACSM 12th ed — hard 3-min intervals drive lactate-threshold
//     adaptation. Drives the Threshold zone protocol.
//   • ACSM Guidelines for Exercise Testing and Prescription, 12th ed (2025)
//     — rates stair climbing as vigorous-intensity, endorses 3-zone
//     polarized programming.
//
// Rate metric: FLOORS PER MINUTE (FPM). Every Step Mill console displays
// FLOORS as the most prominent number; the user reads it off without
// thinking. FPM = total_floors ÷ total_time_minutes. Each zone's
// prescription scales linearly with FPM so a faster climber gets bigger
// floor targets per rep (wall-clock stays roughly the same).

export const STAIRMILL_ACTIVITY = 'StairMill'

export function isStairMillActivity(activity: string | null | undefined): boolean {
  return activity === STAIRMILL_ACTIVITY
}

/**
 * Baseline FPM for users who haven't logged a StairMill effort yet
 * (cold start). Once they log any effort, their actual FPM replaces
 * this baseline. Gender-scaled to roughly match average commercial-
 * Step-Mill output at intermediate effort:
 *
 *   • male  → 12 floors/min (typical intermediate male output)
 *   • else  →  9 floors/min — female value (used for female, non-binary,
 *                              prefer-not-to-say, null). Uniform "male /
 *                              else=female" rule across every gender-
 *                              driven calc in the system; see calorie
 *                              Formulas.ts calcBMR for the canonical
 *                              comment. Decided May 23 2026 to replace
 *                              the earlier averaging.
 *
 * Numbers derived from typical Stairmaster Gauntlet level 8-10 sustained
 * output at moderate-vigorous effort. They're a reasonable starting point
 * — users converge to their own rate after their first logged effort.
 */
export function genderBaselineFloorsPerMin(gender: string | null | undefined): number {
  return gender === 'male' ? 12 : 9
}

/**
 * Parse a StairMill effort label.
 *   New format:    "StairMill · 245 floors in 20:00"
 *   Legacy format: "StairMill · 20:00"  (floors defaults to 0)
 * Returns null if the label can't be parsed at all.
 */
export function parseStairMillLabel(label: string | null | undefined): { floors: number; timeSecs: number | null } | null {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  // Current format with floors count
  const m1 = part.match(/^(\d+)\s*floors?\s+in\s+(\d+:\d{2}(?::\d{2})?)$/)
  if (m1) {
    const floors = parseInt(m1[1], 10)
    const timeStr = m1[2]
    const timeParts = timeStr.split(':').map(Number)
    let timeSecs: number | null = null
    if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
    else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
    return { floors, timeSecs }
  }
  // Legacy duration-only format
  const m2 = part.match(/^(\d+:\d{2}(?::\d{2})?)$/)
  if (m2) {
    const timeParts = m2[1].split(':').map(Number)
    let timeSecs: number | null = null
    if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
    else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
    return { floors: 0, timeSecs }
  }
  return null
}

/**
 * Compute floors-per-minute rate from (floors, timeSecs).
 * Returns 0 for invalid input.
 */
export function floorsPerMinFromEffort(floors: number, timeSecs: number | null): number {
  if (!floors || !timeSecs || timeSecs <= 0) return 0
  return floors / (timeSecs / 60)
}

/**
 * Cardio category pill label — the small UPPERCASE tag rendered under the
 * "Best —" subtitle on every cardio detail page. Mirrors strength's
 * `equipmentPillLabel('barbell')` → "BARBELL" / `equipmentPillLabel('carry')`
 * → "CARRY" pattern: every detail page identifies its movement category
 * with a single static badge below the subtitle.
 *
 * Categorization rules:
 *   • Running family (incl. Hill / Trail / Treadmill) → "RUNNING"
 *   • Cycling family (Cycling, Stationary Bike, Bike Erg) → "CYCLING"
 *   • Air Bike → "AIR BIKE"
 *   • Row Erg → "ROWING"
 *   • Ski Erg → "SKIING"  (the ski erg simulates Nordic ski technique)
 *   • Swimming (any stroke) → "SWIMMING"
 *   • Elliptical → "ELLIPTICAL"
 *   • Rucking → "RUCKING"
 *   • StairMill → "STAIR CLIMBING"
 *
 * Returns "CARDIO" as a generic fallback for any activity that doesn't
 * match a known category.
 */
export function cardioCategoryPillLabel(activity: string | null | undefined): string {
  if (!activity) return 'CARDIO'
  const lower = activity.toLowerCase()
  if (isAirBikeActivity(activity))           return 'AIR BIKE'
  if (isRowErgActivity(activity))            return 'ROWING'
  if (activity === 'Ski Erg')                return 'SKIING'
  if (activity === 'Bike Erg')               return 'CYCLING'
  if (isSwimActivity(activity))              return 'SWIMMING'
  if (isRuckingActivity(activity))           return 'RUCKING'
  if (lower.includes('elliptical'))          return 'ELLIPTICAL'
  if (lower.includes('stair'))               return 'STAIR CLIMBING'
  if (/run|jog/.test(lower))                 return 'RUNNING'
  if (/cycl|bike/.test(lower))               return 'CYCLING'
  return 'CARDIO'
}

const ISOMETRIC_LIST = [
  'Active Hang',
  'Back Lever Hold',
  'Back Lever Hold (Tuck)',
  'Boat Pose Hold',
  'Bottom of Push Up Hold',
  'Calf Raise Hold',
  'Copenhagen Plank',
  'Crow Hold',
  'Dead Hang',
  'Dip Support Hold',
  'Flexed Arm Hang',
  'Freestanding Squat Hold',
  'Front Lever Hold',
  'Front Lever Hold (Tuck)',
  'Glute Bridge Hold',
  'Handstand Hold (Freestanding)',
  'Handstand Hold (Wall)',
  'Hanging L Sit Hold',
  'Headstand Hold',
  'Hollow Hold',
  'Human Flag Hold',
  'L Sit Hold',
  'Nordic Hamstring Mid Range Hold',
  'Pike Compression Hold',
  'Planche Hold',
  'Planche Hold (Straddle)',
  'Planche Hold (Tuck)',
  'Plank Hold',
  'Reverse Plank Hold',
  'Ring Support Hold',
  'Side Plank Hold',
  'Single Leg Glute Bridge Hold',
  'Split Squat Hold',
  'Superman Hold',
  'Tibialis Dorsiflexion Hold',
  'Top of Push Up Hold',
  'V Sit Hold',
  'Wall Sit',
]

export const ISOMETRIC_EXERCISE_NAMES = new Set(ISOMETRIC_LIST)
