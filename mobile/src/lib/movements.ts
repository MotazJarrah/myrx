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
