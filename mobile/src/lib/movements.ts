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
