// ── Bodyweight strength exercises ─────────────────────────────────────────────
// Used by getEquipmentType() in formulas.js to return 'bodyweight'.
// Naming: Title Case, no hyphens (e.g. "Pull Up" not "Pull-Up").

const BODYWEIGHT_LIST = [
  // Push – upper body
  'Archer Push Up',
  'Archer Push Up (Ring)',
  'Behind the Back Push Up',
  'Bench Dip',
  'Bench Dip (Feet Elevated)',
  'Bodyweight Triceps Extension',
  'Bottom of Push Up Hover',
  'Chest to Deck Push Up',
  'Clapping Dip',
  'Clapping Handstand Push Up',
  'Clapping Push Up',
  'Close Grip Push Up',
  'Decline Push Up',
  'Deficit Handstand Push Up',
  'Diamond Push Up',
  'Divebomber Push Up',
  'Explosive Push Up',
  'Feet Elevated Push Up',
  'Fingertip Push Up',
  'Hand Release Push Up',
  'Hand Release Push Up with Clap',
  'Handstand Push Up (Freestanding)',
  'Handstand Push Up (Wall)',
  'Hindu Push Up',
  'Incline Push Up',
  'Knuckle Push Up',
  'L Sit Dip',
  'One Arm Bench Dip',
  'One Arm Handstand Push Up',
  'One Arm One Leg Push Up',
  'One Arm Push Up',
  'Parallel Bar Dip',
  'Partial ROM Handstand Push Up',
  'Pike Push Up',
  'Planche Push Up',
  'Pseudo Planche Push Up',
  'Pseudo Planche Push Up (Feet Elevated)',
  'Push Up',
  'Push Up to Pike',
  'Push Up to T',
  'Ring Dip',
  'Ring Push Up',
  'Shoulder Tap Push Up',
  'Single Bar Dip',
  'Spiderman Push Up',
  'Stacked Feet Push Up',
  'Staggered Hands Push Up',
  'T Push Up',
  'Tiger Bend Push Up',
  'Triceps Push Up',
  'Typewriter Dip',
  'Typewriter Push Up',
  'Uneven Push Up',
  'V Dip',
  'Walkout Push Up',
  'Wide Grip Push Up',
  'Wide to Close Push Up',

  // Pull – upper body
  'Archer Pull Up',
  'Archer Ring Pull Up',
  'Australian Pull Up',
  'Bar Muscle Up',
  'Behind the Neck Pull Up',
  'Bodyweight Biceps Curl (Under Bar)',
  'Chest to Bar Pull Up',
  'Chest to Ring Row',
  'Chin Up',
  'Clapping Pull Up',
  'Commando Pull Up',
  'Dead Hang Pull Up',
  'Edge Pull Up',
  'Feet Elevated Inverted Row',
  'Finger Pull Up',
  'In and Out Pull Up',
  'Inverted Row',
  'Jumping Muscle Up',
  'L Sit Pull Up',
  'Mixed Grip Chin Up',
  'Mixed Grip Pull Up',
  'Monkey Bar Traverse',
  'Negative Pull Up',
  'Neutral Grip Pull Up',
  'One Arm Pull Up',
  'Pull Up',
  'Ring Muscle Up',
  'Ring Row',
  'Rocking Pull Up',
  'Rope Climb',
  'Towel Pull Up',
  'Typewriter Pull Up',
  'Wide Grip Pull Up',

  // Core
  'Back Extension (Bench)',
  'Back Extension (Floor)',
  'Bicycle Crunch',
  'Bird Dog',
  'Cross Body Crunch',
  'Crunch',
  'Dead Bug',
  'Decline Sit Up',
  'Dragon Flag',
  'Flutter Kick',
  'Glute Bridge',
  'Glute Bridge (Single Leg)',
  'Hanging Knee Raise',
  'Hanging Leg Raise',
  'Hanging Toes to Bar',
  'Hanging Windshield Wiper',
  'Heel Tap Crunch',
  'Hip Thrust (Bodyweight)',
  'Hip Thrust (Single Leg, Bodyweight)',
  'Hollow Body Rocks',

  'Knees to Elbows',
  'L Sit to Tuck',
  'Leg Raise (Lying)',
  'Oblique Crunch',
  'Plank Up',
  'Reverse Crunch',
  'Reverse Hyperextension (Bodyweight)',
  'Russian Twist',
  'Scissor Kick',
  'Seated In Outs',
  'Sit Up',
  'Superman',
  'Toe Touch (Lying)',
  'Tuck to Pike Lift',
  'V Up',
  'Windshield Wiper (Floor)',

  // Lower body
  'Air Squat',
  'Alternating Step Up',
  'Assisted Pistol Squat',
  'Box Pistol Squat',
  'Box Squat (Bodyweight)',
  'Bulgarian Split Squat',
  'Calf Raise',
  'Calf Raise (Single Leg)',
  'Clamshell',
  'Cossack Squat',
  'Curtsy Lunge',
  'Deep Squat (ATG)',
  'Donkey Kick',
  'Fire Hydrant',
  'Forward Lunge',
  'Hamstring Bridge (Feet Elevated)',
  'High Step Up',
  'Hip Abduction (Side Lying)',
  'Hip Adduction (Side Lying)',
  'Jump Squat',
  'Jump Step Up',
  'Lateral Lunge',
  'Lunge Jump',
  'Nordic Hamstring Curl',
  'Pistol Squat',
  'Reverse Lunge',
  'Shrimp Squat',
  'Sissy Squat',
  'Skater Squat',
  'Sliding Leg Curl',
  'Split Jump',
  'Squat Jump 180',
  'Standing Hip Abduction',
  'Step Back Lunge to Knee Drive',
  'Step Up',
  'Sumo Squat',
  'Tibialis Raise',
  'Tibialis Raise (Single Leg)',
  'Walking Lunge',

  // Full-body & plyometrics
  'Box Jump',
  'Box Step Up',
  'Broad Jump',
  'Burpee',
  'Burpee Broad Jump',
  'Burpee Pull Up',
  'Frog Jump',
  'Lateral Bound',
  'Star Jump',
  'Tuck Jump',

  // Crawls & climbers
  'Get Up Sit Through',
  'Groiner',
  'Mountain Climber',
  'Mountain Climber (Cross Body)',
  'Sit Through',

  // Jump rope
  'Double Under',
  'Single Under',

  // Ground-to-stand
  'Turkish Get Up (Bodyweight)',

]

/** O(1) lookup used by getEquipmentType in formulas.js */
export const BODYWEIGHT_EXERCISE_NAMES = new Set(BODYWEIGHT_LIST)

// ── Isometric / time-based exercises ─────────────────────────────────────────
// These are held for a duration, not counted in reps.
// They get a completely separate input + detail view.

const ISOMETRIC_LIST = [
  'Active Hang',
  'Back Lever Hold',
  'Back Lever Hold (Tuck)',
  'Boat Pose Hold',
  'Bottom of Push Up Hover',
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

// ── Weighted strength movements ───────────────────────────────────────────────

const WEIGHTED_LIST = [
  // Barbell
  'Back Squat',
  'Back Squat (High Bar)',
  'Back Squat (Low Bar)',
  'Barbell Curl',
  'Barbell Hip Thrust',
  'Barbell Lunge',
  'Barbell Lunge (Reverse)',
  'Barbell Overhead Triceps Extension',
  'Barbell Row',
  'Barbell Shrug',
  'Barbell Skull Crusher',
  'Barbell Split Squat',
  'Barbell Thruster',
  'Barbell Walking Lunge',
  'Bench Press',
  'Bench Press (Decline)',
  'Bench Press (Incline)',
  'Close Grip Bench Press',
  'Deadlift',
  'Deficit Deadlift',
  'EZ Bar Curl',
  'Floor Press',
  'Front Squat',
  'Good Morning',
  'Overhead Press',
  'Overhead Squat',
  'Pendlay Row',
  'Push Press',
  'Romanian Deadlift',
  'Stiff Leg Deadlift',
  'Sumo Deadlift',
  'Trap Bar Deadlift',
  'Upright Row',
  'Yates Row',
  'Zercher Squat',

  // Dumbbell
  'Concentration Curl',
  'Dumbbell Arnold Press',
  'Dumbbell Bench Press',
  'Dumbbell Bench Press (Incline)',
  'Dumbbell Biceps Curl',
  'Dumbbell Chest Fly',
  'Dumbbell Front Raise',
  'Dumbbell Front Squat',
  'Dumbbell Hammer Curl',
  'Dumbbell Lateral Raise',
  'Dumbbell Lunge',
  'Dumbbell Lunge (Reverse)',
  'Dumbbell Pullover',
  'Dumbbell Rear Delt Fly',
  'Dumbbell Romanian Deadlift',
  'Dumbbell Row',
  'Dumbbell Shoulder Press',
  'Dumbbell Shrug',
  'Dumbbell Skull Crusher',
  'Dumbbell Step Up',
  'Dumbbell Thruster',
  'Dumbbell Upright Row',
  'Dumbbell Walking Lunge',
  'Goblet Squat',
  'Incline Dumbbell Curl',

  'Overhead Dumbbell Triceps Extension',
  'Renegade Row',
  'Suitcase Deadlift',

  // Kettlebell
  'Kettlebell Clean',
  'Kettlebell Clean and Jerk',
  'Kettlebell Deadlift',
  'Kettlebell Farmer Carry',
  'Kettlebell Front Squat',
  'Kettlebell High Pull',
  'Kettlebell Jerk',
  'Kettlebell Overhead Carry',
  'Kettlebell Push Press',
  'Kettlebell Snatch',
  'Kettlebell Strict Press',
  'Kettlebell Swing',
  'Kettlebell Swing (Single Arm)',
  'Kettlebell Turkish Get Up',
  'Kettlebell Windmill',

  // Machine & cable
  'Assisted Dip Machine',
  'Assisted Pull Up Machine',
  'Back Extension Machine',
  'Belt Squat Machine',
  'Biceps Curl Machine',
  'Cable Crossover',
  'Cable Face Pull',
  'Cable Chest Fly',
  'Cable Reverse Fly',
  'Cable Woodchop',
  'Chest Press Machine',
  'Chest Supported Row Machine',
  'Glute Drive Machine',
  'Hack Squat Machine',
  'Hammer Strength Chest Press',
  'Hammer Strength Row',
  'Hip Abduction Machine',
  'Hip Adduction Machine',
  'Horizontal Leg Press',
  'Lat Pulldown',
  'Lat Pulldown (Neutral Grip)',
  'Lat Pulldown (Wide Grip)',
  'Lateral Raise Machine',
  'Leg Curl (Lying)',
  'Leg Curl (Seated)',
  'Leg Extension',
  'Leg Press',
  'Leg Press (45°)',
  'Overhead Cable Triceps Extension',
  'Pec Deck',
  'Rear Delt Fly Machine',
  'Reverse Hyperextension Machine',
  'Seated Cable Row',
  'Seated Calf Raise',
  'Shoulder Press Machine',
  'Single Arm Cable Lateral Raise',
  'Single Arm Cable Row',
  'Smith Machine Bench Press',
  'Smith Machine Split Squat',
  'Smith Machine Squat',
  'Standing Calf Raise',
  'T Bar Row',
  'Triceps Pressdown (Cable)',

  // Strongman
  'Arm Over Arm Rope Pull',
  'Atlas Stone to Platform',
  'Atlas Stone to Shoulder',
  'Axle Clean and Press',
  'Axle Deadlift',
  'Block Press',
  'Circus Dumbbell Press',
  "Conan's Wheel",
  "Farmer's Walk",
  'Husafell Stone Carry',
  'Keg Carry',
  'Keg Clean and Press',
  'Keg Toss',
  'Log Clean and Press',
  'Natural Stone Lift',
  'Sandbag Over Shoulder',
  'Sandbag to Platform',
  'Shield Carry',
  'Sled Drag',
  'Sled Push (Prowler)',
  'Tire Flip',
  'Vehicle Pull',
  'Yoke Carry',

  // Olympic lifts
  'Block Clean',
  'Block Snatch',
  'Clean',
  'Clean and Jerk',
  'Clean Pull',
  'Hang Clean',
  'Hang Power Clean',
  'Hang Power Snatch',
  'Hang Snatch',
  'High Pull (Clean)',
  'High Pull (Snatch)',
  'Jerk (from Rack)',
  'Muscle Snatch',
  'Power Clean',
  'Power Jerk',
  'Power Snatch',
  'Push Jerk',
  'Snatch',
  'Snatch Pull',
  'Split Jerk',
  'Squat Jerk',

  // Unilateral weighted
  'Bulgarian Split Squat (Weighted)',
  'Curtsy Lunge (Weighted)',
  'Forward Lunge (Weighted)',
  'Lateral Lunge (Weighted)',
  'Reverse Lunge (Weighted)',
  'Single Arm Arnold Press',
  'Single Arm Biceps Curl',
  'Single Arm Cable Curl',
  'Single Arm Cable Triceps Pressdown',
  'Single Arm Chest Supported Row',
  'Single Arm Dumbbell Bench Press',
  'Single Arm Dumbbell Front Raise',
  'Single Arm Dumbbell Incline Press',
  'Single Arm Dumbbell Lateral Raise',
  'Single Arm Dumbbell Row',
  'Single Arm Dumbbell Shoulder Press',
  'Single Arm Dumbbell Snatch',
  'Single Arm Dumbbell Upright Row',
  'Single Arm Farmer Carry',
  'Single Arm Floor Press',
  'Single Arm Hammer Curl',
  'Single Arm Kettlebell Clean and Jerk',
  'Single Arm Kettlebell Strict Press',
  'Single Arm Lat Pulldown',
  'Single Arm Overhead Carry',
  'Single Arm Overhead Triceps Extension',
  'Single Arm Preacher Curl',
  'Single Arm Rear Delt Fly',
  'Single Leg Calf Raise (Weighted)',
  'Single Leg Deadlift',
  'Single Leg Hip Thrust (Weighted)',
  'Single Leg Leg Curl',
  'Single Leg Leg Extension',
  'Single Leg Leg Press',
  'Single Leg Romanian Deadlift',
  'Split Squat (Front Foot Elevated)',
  'Step Up (Weighted)',
  'Suitcase Carry',
  'Walking Lunge (Weighted)',
]

// ── Combined & sorted exports ─────────────────────────────────────────────────

/** All strength movements (bodyweight + weighted + isometric), alphabetically sorted */
export const STRENGTH_MOVEMENTS = [...new Set([...BODYWEIGHT_LIST, ...WEIGHTED_LIST, ...ISOMETRIC_LIST])].sort((a, b) =>
  a.localeCompare(b)
)

// ── Cardio movements ──────────────────────────────────────────────────────────

export const CARDIO_MOVEMENTS = [
  // Running & walking
  'Hill Running',
  'Running',
  'Running (Treadmill)',
  'Trail Running',
  'Walking',
  'Walking (Treadmill)',

  // Cycling
  'Cycling',
  'Cycling (Indoor Trainer)',
  'Cycling (Mountain Bike)',
  'Indoor Cycling',

  // Rowing & paddling
  'Canoeing',
  'Kayaking',
  'Row Erg',
  'Rowing',
  'Stand Up Paddleboarding',

  // Skiing
  'Cross Country Skiing',
  'Roller Skiing',
  'Ski Erg',

  // Machines
  'Air Bike',
  'Arc Trainer',
  'Bike Erg',
  'Curved Treadmill',
  'Elliptical',
  "Jacob's Ladder",
  'StairMill',
  'VersaClimber',

  // Stair & climbing
  'Stair Climb',

  // Skating
  'Ice Skating',
  'Inline Skating',

  // Carrying
  'Rucking',
  'Sandbag Carry',
  'Sled Pull',
  'Sled Push',

  // Swimming
  'Aqua Jogging',
  'Swimming',
  'Swimming (Open Water)',

  // Conditioning & HIIT
  'Agility Ladder Drills',
  'Battle Ropes',
  'Box Step Overs',
  'Carioca',
  'Jump Rope',
  'Lateral Shuffles',
  'Line Drills',
  'Shadow Boxing',
  'Shuttle Run',
  'Slideboard',
  'Speed Bag',

  // Crawls
  'Bear Crawl',
  'Crab Walk',
  'Low Crawl',

  // Misc
  'Hiking',
].sort((a, b) => a.localeCompare(b))

// ── Cardio activity classification ──────────────────────────────────────────

/**
 * Activities where the user logs time only (no distance).
 * Everything else in CARDIO_MOVEMENTS is pace-based (distance + time).
 */
const CARDIO_DURATION_SET = new Set([
  'Agility Ladder Drills',
  'Arc Trainer',
  'Battle Ropes',
  'Bear Crawl',
  'Box Step Overs',
  'Carioca',
  'Crab Walk',
  "Jacob's Ladder",
  'Jump Rope',
  'Lateral Shuffles',
  'Line Drills',
  'Low Crawl',
  'Shadow Boxing',
  'Shuttle Run',
  'Slideboard',
  'Speed Bag',
  'StairMill',
  'VersaClimber',
])

/**
 * Returns 'pace' (distance + time input) or 'duration' (time-only input)
 * for a given cardio activity name.
 */
export function getCardioMode(activityName) {
  return CARDIO_DURATION_SET.has(activityName) ? 'duration' : 'pace'
}

/**
 * Returns an array of projection distance objects for a cardio activity.
 * Each object: { name: string, km: number }
 *
 * Swimming / rowing / ski-erg distances are always in meters (international standard).
 * All other distances follow the user's distUnit preference ('km' | 'mi').
 */
export function getCardioDistances(activityName, distUnit = 'km') {
  const lower = activityName.toLowerCase()
  const mi = distUnit === 'mi'

  // Always meters — official competition / erg distances
  if (/swim|aqua/.test(lower)) {
    return [
      { name: '100 m',  km: 0.1 },
      { name: '400 m',  km: 0.4 },
      { name: '800 m',  km: 0.8 },
      { name: '1500 m', km: 1.5 },
      { name: '1 mile', km: 1.60934 },
    ]
  }

  if (/row erg|rowing|canoe|kayak|paddleboard|sup/.test(lower)) {
    return [
      { name: '500 m',   km: 0.5 },
      { name: '1000 m',  km: 1 },
      { name: '2000 m',  km: 2 },
      { name: '5000 m',  km: 5 },
      { name: '10000 m', km: 10 },
    ]
  }

  if (/ski erg/.test(lower)) {
    return [
      { name: '500 m',   km: 0.5 },
      { name: '1000 m',  km: 1 },
      { name: '2000 m',  km: 2 },
      { name: '5000 m',  km: 5 },
      { name: '10000 m', km: 10 },
    ]
  }

  // Cycling — round numbers per unit
  if (/cycl|bike|spin|stationary/.test(lower)) {
    if (mi) return [
      { name: '5 mi',  km: 8.047 },
      { name: '10 mi', km: 16.093 },
      { name: '25 mi', km: 40.234 },
      { name: '40 mi', km: 64.374 },
      { name: '62 mi', km: 99.779 },
    ]
    return [
      { name: '5 km',   km: 5 },
      { name: '10 km',  km: 10 },
      { name: '20 km',  km: 20 },
      { name: '40 km',  km: 40 },
      { name: '100 km', km: 100 },
    ]
  }

  // Running, walking, hiking, rucking, skating, and everything else.
  // Named race distances (5K, 10K, Half, Marathon) stay as-is per industry standard.
  if (mi) return [
    { name: '1 mi',          km: 1.60934 },
    { name: '5K',            km: 5 },
    { name: '10K',           km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
  return [
    { name: '1 km',          km: 1 },
    { name: '5K',            km: 5 },
    { name: '10K',           km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
}

// ── Mobility movements ────────────────────────────────────────────────────────

export const MOBILITY_MOVEMENTS = [
  // ── Movement patterns (locomotion & quadrupedal) ──────────────────────────
  'Bear Crawl',
  'Bear Hold',
  'Beast Hold',
  'Commando Crawl',
  'Crab Hold',
  'Crab Walk',
  'Crocodile Crawl',
  'Duck Walk',
  'Front Kickthrough',
  'Frog Hop',
  'Gorilla Walk',
  'Inchworm',
  'Lateral Bear Crawl',
  'Lateral Crab Walk',
  'Leopard Crawl',
  'Lizard Walk',
  'Low Crawl',
  'Monkey Walk',
  'Plank Walk',
  'Scorpion Reach',
  'Scorpion Walk',
  'Seal Walk',
  'Side Kickthrough',
  'Spider-Man Crawl',
  'Tabletop Hold',
  'Traveling Ape',
  'Underswitch',

  // ── Yoga poses ────────────────────────────────────────────────────────────
  'Boat Pose',
  'Bound Angle Pose',
  'Bow Pose',
  'Bridge Pose',
  'Cat Cow',
  'Chair Pose',
  "Child's Pose",
  'Cobra Pose',
  'Corpse Pose',
  'Crescent High Lunge',
  'Crescent Low Lunge',
  "Dancer's Pose",
  'Double Pigeon Pose',
  'Downward Dog',
  'Extended Side Angle',
  'Fish Pose',
  'Frog Pose',
  'Garland Pose',
  'Goddess Pose',
  'Half Moon Pose',
  'Happy Baby Pose',
  'Head-to-Knee Pose',
  'Hero Pose',
  'Knees-to-Chest Pose',
  'Legs Up the Wall',
  'Lizard Pose',
  'Locust Pose',
  'Low Lunge',
  'Mountain Pose',
  'Pigeon Pose',
  'Puppy Pose',
  'Reversed Warrior',
  'Sphinx Pose',
  'Supine Spinal Twist',
  'Tree Pose',
  'Triangle Pose',
  'Upward Dog',
  'Warrior I',
  'Warrior II',
  'Warrior III',
  'Wheel Pose',
  'Wide-Angle Seated Forward Fold',

  // ── Stretches ─────────────────────────────────────────────────────────────
  '90/90 Hip Stretch',
  'Ankle Circles',
  'Butterfly Stretch',
  'Calf Stretch',
  'Couch Stretch',
  'Cossack Squat',
  'Cross-Body Shoulder Stretch',
  'Deep Squat Hold',
  'Doorway Chest Stretch',
  'Dorsiflexion Lunge',
  'Figure Four Stretch',
  'Frog Stretch',
  'Half Split',
  'Hip Circles',
  'Hip Flexor Stretch',
  'Iron Cross Stretch',
  'Jefferson Curl',
  'Kang Squat',
  'Neck Rolls',
  'Overhead Triceps Stretch',
  "Runner's Lunge",
  'Sciatic Nerve Floss',
  'Seated Forward Fold',
  'Shoulder CAR',
  'Shoulder Circles',
  'Shoulder Rolls',
  'Sleeper Stretch',
  'Spiderman Lunge',
  'Standing Forward Fold',
  'Standing Quad Stretch',
  'Supine Twist',
  'Thread the Needle',
  'Upper Trap Stretch',
  'Wall Angels',
  'Wall Slides',
  "World's Greatest Stretch",
  'Wrist Circles',
].sort((a, b) => a.localeCompare(b))
