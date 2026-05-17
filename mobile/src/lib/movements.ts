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
  'Air Bike',
  'Elliptical',
])

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
  'Air Bike':            40,
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
// mirroring the Sled Drag [Push] / [Pull] pattern from strength. Helpers
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
