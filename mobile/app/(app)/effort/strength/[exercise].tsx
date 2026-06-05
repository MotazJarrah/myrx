/**
 * StrengthDetail — direct port of MyRX/src/pages/StrengthDetail.jsx to RN.
 *
 * Five rendering modes, dispatched off the movement record + name suffixes:
 *
 *   1. IsometricDetail        — strength_type === 'isometric'
 *   2. AssistedMachineDetail  — equipment === 'assisted'
 *   3. CarryDetail            — equipment === 'carry'
 *   4. RepsOnlyDetail         — name endsWith [Band] / [Knee] / [Band + Knee]
 *   5. Standard (rep-based)   — bodyweight or weighted (barbell/dumbbell/etc.)
 *
 * Recharts <LineChart> is replaced by `src/components/LineChart.tsx`
 * (react-native-svg). DOM dropdowns / mouse-hover tooltips don't apply here —
 * the chart uses tap-to-pin tooltips instead.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated'

// Pattern 5 — Inline expansion panel (LOCKED, direct-height-animation).
// PANEL_OPEN_DURATION / PANEL_CLOSE_DURATION / PANEL_EASING are the canonical
// constants shared with sleep.tsx's DimensionRow — kept identical so every
// expansion panel across the app feels the same.
const PANEL_OPEN_DURATION  = 240
const PANEL_CLOSE_DURATION = 200
const PANEL_EASING         = Easing.bezier(0.16, 1, 0.3, 1)  // out-quint, same curve as AnimateRise

// Safety buffer added to the captured height. Absorbs the small (~8–12 px)
// width-mismatch clip that can happen on Android when the hidden measurer's
// `position:'absolute'` width slightly differs from the visible panel's
// in-flow width and text wraps to one more line in the visible than in
// the measurer. The buffer renders below the body text, where the panel's
// own card background / border is visually identical to bottom padding —
// so the extra space looks intentional rather than buggy.
const PANEL_HEIGHT_BUFFER_PX = 16

/**
 * ExpandPanel — direct-height-animation expansion panel.
 *
 * Hidden-measurer pattern (the one that ACTUALLY works on Fabric/new arch).
 *
 * Why the off-screen absolute measurer is necessary:
 *   When the visible Animated.View has `height: 0 + overflow: 'hidden'`,
 *   Fabric/new arch skips the inner child's layout pass, so an `onLayout`
 *   placed INSIDE the Animated.View never fires — contentHeight stays 0
 *   forever and the panel can't open. (We tried single-tree on June 1
 *   2026; it broke pill expansion entirely. Reverted.)
 *
 * Why the ~16 px buffer absorbs the original "clipped last line" bug:
 *   The absolute measurer at `left: 0, right: 0` sometimes ends up a few
 *   percent wider than the visible panel when nested deep in flex layouts.
 *   The text wraps to fewer lines in the measurer, so the captured height
 *   can be 8–12 px short. Adding a fixed 16 px buffer to the animated
 *   height absorbs that worst case; the extra space sits below the body
 *   text inside the panel's card chrome, looking like extra bottom padding.
 */
function ExpandPanel({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}) {
  const [contentHeight, setContentHeight] = useState(0)
  const animatedHeight  = useSharedValue(0)
  const animatedOpacity = useSharedValue(0)

  // Drive the animation off the open flag + measured height. We only animate
  // UP to contentHeight once we've measured it; before that the measurer is
  // still computing.
  if (open && contentHeight > 0) {
    animatedHeight.value  = withTiming(contentHeight, { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
    animatedOpacity.value = withTiming(1,             { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
  } else if (!open) {
    animatedHeight.value  = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
    animatedOpacity.value = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
  }

  const panelAnimatedStyle = useAnimatedStyle(() => ({
    height:   animatedHeight.value,
    opacity:  animatedOpacity.value,
    overflow: 'hidden',
  }))

  const onMeasurerLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + PANEL_HEIGHT_BUFFER_PX
    if (h > 0 && h !== contentHeight) setContentHeight(h)
  }

  return (
    <>
      {/* Hidden measurer — renders the panel at its NATURAL size off-screen
          so we can capture its height for the animation. Necessary because
          a child of a 0-height Animated.View doesn't get its layout pass
          on Fabric/new arch (we proved that by trying single-tree June 1
          2026 — pill expansion completely broke). */}
      <View
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: -9999 }}
        pointerEvents="none"
        onLayout={onMeasurerLayout}
      >
        {children}
      </View>
      {/* Visible panel — height animates 0 ↔ contentHeight. Because this is
          the REAL height (not a fade-in overlay), all sibling views below
          reflow naturally through layout. */}
      <Animated.View style={panelAnimatedStyle}>
        {children}
      </Animated.View>
    </>
  )
}
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler'
import { useLocalSearchParams, router } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import Skeleton from '../../../../src/components/Skeleton'
import DeleteAction from '../../../../src/components/DeleteAction'
import TickerNumber from '../../../../src/components/TickerNumber'
import AnimateRise from '../../../../src/components/AnimateRise'
import LineChart from '../../../../src/components/LineChart'
import { useAuth } from '../../../../src/contexts/AuthContext'
import { supabase } from '../../../../src/lib/supabase'
import { scrollShellToTop } from '../../../../src/lib/shellScroll'
import {
  estimate1RM,
  projectAllRMs,
  getNextBarbellLoad,
  getNextDumbbellWeight,
  getNextAddedWeight,
  platesForBarbellWeight,
  platesForAddedWeight,
  loadableWeight,
  nearestLoadableWeight,
  nextLoadableAbove,
  getLadder,
  adpZoneFor,
  ADP_ZONE_CONFIG,
  type LadderEquipment,
  type AdpZone,
} from '../../../../src/lib/formulas'
import { Info, Check, PartyPopper, Trophy } from 'lucide-react-native'
import { useMovements } from '../../../../src/hooks/useMovements'
import { colors, palette, alpha, withAlpha, fonts } from '../../../../src/theme'

const BODYWEIGHT_THRESHOLD = 10

// ── Rep-only bodyweight stage system ─────────────────────────────────────────
// Rep-only bodyweight movements (Burpee, Sit Up, Mountain Climber, etc. —
// `movements.weighted_progression === false`) progress through three stages of
// rep milestones. The active stage is keyed off the user's RX-tier best reps:
//   Stage 1 (bestReps < 11):   1..10
//   Stage 2 (11 ≤ bestReps ≤ 20):  11..20
//   Stage 3 (bestReps ≥ 21):   25, 50, 75, 100, 125, 145, 160, 175, 190, 200
// The push tile is the smallest stage value strictly greater than bestReps;
// every tile at or below bestReps is "achieved" (✓), everything above the
// push tile is "locked".
const REP_STAGE_1: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const REP_STAGE_2: number[] = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const REP_STAGE_3: number[] = [25, 50, 75, 100, 125, 145, 160, 175, 190, 200]
function pickRepOnlyStage(best: number): number[] {
  if (best >= 21) return REP_STAGE_3
  if (best >= 11) return REP_STAGE_2
  return REP_STAGE_1
}

// ── Bodyweight consolidated detail card constants ────────────────────────────
// Locked in CLAUDE.md "Bodyweight consolidated detail card — locked design spec".
type BwTier = 'band+knee' | 'knee' | 'band' | 'rx'

const BW_TIERS: BwTier[] = ['band+knee', 'knee', 'band', 'rx']
const BW_TIER_RANK: Record<BwTier, number> = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }
const BW_GRADUATION_REPS = 8 // T088 Fix 2.1: was 10 — graduate a tier / advance a band in the strength range (~5-8 reps), not endurance (Schoenfeld repetition continuum; Steven Low, Overcoming Gravity)
const BW_REST_TEXT = '2 min'

function bwTierFromVariantName(name: string): BwTier {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwTierLabel(tier: BwTier | string | null): string {
  switch (tier) {
    case 'band+knee': return 'BAND + KNEE ASSISTED'
    case 'knee':      return 'KNEE ASSISTED'
    case 'band':      return 'BAND ASSISTED'
    case 'rx':        return 'FULL RX'
    default:          return ''
  }
}

function bwTierBadge(tier: BwTier | string | null): string {
  switch (tier) {
    case 'band+knee': return 'B+K'
    case 'knee':      return 'KNEE'
    case 'band':      return 'BAND'
    case 'rx':        return 'FULL RX'
    default:          return ''
  }
}

function equipmentPillLabel(equipment: string | null | undefined): string {
  switch (equipment) {
    case 'bodyweight': return 'BODYWEIGHT'
    case 'barbell':    return 'BARBELL'
    case 'dumbbell':   return 'DUMBBELL'
    case 'kettlebell': return 'KETTLEBELL'
    case 'machine':    return 'RESISTANCE MACHINE'
    case 'assisted':   return 'ASSIST MACHINE'
    case 'carry':      return 'CARRY'
    case 'strongman':  return 'STRONGMAN'
    default:           return (equipment || '').toUpperCase()
  }
}

function bwNextTier(tier: BwTier): BwTier | null {
  const idx = BW_TIERS.indexOf(tier)
  return idx >= 0 && idx < BW_TIERS.length - 1 ? BW_TIERS[idx + 1] : null
}

function parseRepsFromBwLabel(label: string | null | undefined): number | null {
  let m = label?.match(/×\s*(\d+)/)
  if (m) return parseInt(m[1])
  m = label?.match(/·\s*(\d+)\s*reps?/)
  if (m) return parseInt(m[1])
  return null
}

function parseBandLevelFromBwLabel(label: string | null | undefined): string | null {
  const m = label?.match(/\[Band(?:\s*\+\s*Knee)?\]\s*·\s*([\w\s]+?)\s*×/)
  return m ? m[1].trim() : null
}

// ── Small grammar helpers (used by the BW assisted-tier cue copy) ────────
// Pick "a" or "an" by the first letter's sound. Simple heuristic — covers
// the four band names (Extra Heavy → "an", Heavy / Medium / Light → "a"),
// good enough for any other adjective starting with a non-silent letter.
function aOrAn(word: string | null | undefined): string {
  const first = (word || '').trim().charAt(0).toLowerCase()
  return 'aeiou'.includes(first) ? 'an' : 'a'
}

function repWord(count: number): string {
  return count === 1 ? 'rep' : 'reps'
}

// ── Band-level sub-progression (Band and Band+Knee tiers) ────────────────
// Locked rules (see CLAUDE.md):
//   - Levels go heaviest → lightest: Extra Heavy → Heavy → Medium → Light.
//   - "Current band" = the lightest level the user has logged any effort at
//     (their progression frontier).
//   - If best at current band ≥ 10, the algorithm auto-advances to the next
//     thinner level. The pill / tiles / cue all reflect the new band, and
//     the tile grid resets (best at the new band starts at 0).
//   - If the lightest used band is Light and best ≥ BW_GRADUATION_REPS, "allLevelsCleared"
//     is true — the user is ready to graduate to the next tier.
//   - If no efforts are logged in this tier yet, "current band" defaults to
//     Extra Heavy (the most-assistance starting point).
const BAND_LEVELS_PROGRESSION: string[] = ['Extra Heavy', 'Heavy', 'Medium', 'Light']

type BandSubState = {
  currentBand:       string
  bestAtCurrent:     number
  bestPerLevel:      Record<string, number>
  allLevelsCleared:  boolean
}

function computeBandSubState(tierEfforts: Effort[]): BandSubState {
  const bestPerLevel: Record<string, number> = {
    'Extra Heavy': 0, 'Heavy': 0, 'Medium': 0, 'Light': 0,
  }
  tierEfforts.forEach(e => {
    const level = parseBandLevelFromBwLabel(e.label)
    const reps  = parseRepsFromBwLabel(e.label) || 0
    if (level && level in bestPerLevel && reps > bestPerLevel[level]) {
      bestPerLevel[level] = reps
    }
  })

  // Walk lightest → heaviest to find the user's frontier (the lightest
  // band level they've actually used).
  const reverseLevels = ['Light', 'Medium', 'Heavy', 'Extra Heavy']
  let lightestUsed: string | null = null
  for (const level of reverseLevels) {
    if (bestPerLevel[level] > 0) { lightestUsed = level; break }
  }

  if (lightestUsed === null) {
    return { currentBand: 'Extra Heavy', bestAtCurrent: 0, bestPerLevel, allLevelsCleared: false }
  }

  if (bestPerLevel[lightestUsed] < BW_GRADUATION_REPS) {
    return {
      currentBand:      lightestUsed,
      bestAtCurrent:    bestPerLevel[lightestUsed],
      bestPerLevel,
      allLevelsCleared: false,
    }
  }

  // Hit 10 at lightest used → auto-advance to next thinner band.
  const idx = BAND_LEVELS_PROGRESSION.indexOf(lightestUsed)
  if (idx === BAND_LEVELS_PROGRESSION.length - 1) {
    // Already at Light, all levels cleared — ready to graduate.
    return {
      currentBand:      'Light',
      bestAtCurrent:    bestPerLevel['Light'],
      bestPerLevel,
      allLevelsCleared: true,
    }
  }
  const nextBand = BAND_LEVELS_PROGRESSION[idx + 1]
  return {
    currentBand:      nextBand,
    bestAtCurrent:    bestPerLevel[nextBand] || 0,
    bestPerLevel,
    allLevelsCleared: false,
  }
}

function bwWhyText(tier: BwTier): string {
  switch (tier) {
    case 'band+knee':
      return 'Band + Knee gives maximum support: the band carries some of your body weight on the way up, and kneeling shortens your lever. You build the movement pattern and base strength with enough volume to handle the next tier.'
    case 'knee':
      return 'Knee assistance shortens your lever — the same muscles work, but with less load. You get clean reps with full range of motion, building the strength to remove that lever advantage next.'
    case 'band':
      return 'Band assistance still helps lift some of your body weight at the bottom of the rep, but with a full-body line. As you progress to lighter bands, you take on more of your own weight — the final step to unassisted reps.'
    case 'rx':
      return "Full RX is the unassisted movement at body weight — you're lifting 100% of yourself with no help. From here, progression is rep count, and optionally added load."
    default:
      return ''
  }
}

/**
 * Pulsing chevron used to flank the single tier pill on the bodyweight
 * consolidated detail card. The animation cycle is 1.5s:
 *   • 0.00s – 0.25s: fade in (opacity 0 → 1)
 *   • 0.25s – 1.00s: visible (steady at 1)
 *   • 1.00s – 1.25s: fade out (opacity 1 → 0)
 *   • 1.25s – 1.50s: invisible gap, then loop
 * Two chevrons per side; the one closer to the pill uses `delay=0`, the
 * farther one uses `delay=250`. This creates the outward-marching effect.
 */
function BwAnimatedChevron({
  direction,
  delay,
  size = 16,
  color,
}: {
  direction: 'left' | 'right'
  delay: number
  size?: number
  color: string
}) {
  const opacity = useSharedValue(0)

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 250 }),   // fade in
          withTiming(1, { duration: 750 }),   // stay visible
          withTiming(0, { duration: 250 }),   // fade out
          withTiming(0, { duration: 250 })    // invisible gap before next cycle
        ),
        -1
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight

  return (
    <Animated.View style={animStyle}>
      <Icon size={size} color={color} />
    </Animated.View>
  )
}

// ── Effort row (denormalised from supabase) ──────────────────────────────────
interface Effort {
  id:         string
  user_id:    string
  type:       string
  label:      string
  value:      string
  created_at: string
}

// ── Parsers (1:1 with web) ───────────────────────────────────────────────────

function parseOneRM(value: string | null | undefined): { oneRM: number; unit: string } | null {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

function parseRepsFromLabel(label: string | null | undefined): number {
  const m = label?.match(/×\s*(\d+)/)
  return m ? parseInt(m[1]) : 0
}

/**
 * Parses the main lifted weight from a weighted-strength label.
 *   "Bench Press · 135 lb × 8"           → 135
 *   "Squat · 155+25 lb × 5" (bodyweight) → 155 (returns the BW component)
 * Mirror of web parseWeightFromLabel.
 */
function parseWeightFromLabel(label: string | null | undefined): number {
  const m = label?.match(/·\s*([\d.]+)(?:\+[\d.]+)?\s*\w+\s*×/)
  return m ? parseFloat(m[1]) : 0
}

function parseAddedWeightFromLabel(label: string | null | undefined): number {
  const m = label?.match(/\+([\d.]+)\s*\w+\s*×/)
  return m ? parseFloat(m[1]) : 0
}

function parseDurationSecs(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1]) : null
}

function parseAssistanceFromLabel(label: string | null | undefined): { assistance: number; unit: string } | null {
  const m = label?.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
  if (!m) return null
  return { assistance: parseFloat(m[1]), unit: m[2] }
}

function parseCarryFromLabel(label: string | null | undefined): { weight: number; unit: string; dist: number } | null {
  const weightM = label?.match(/·\s*([\d.]+)\s*(\w+)\s*×/)
  const distM   = label?.match(/×\s*([\d.]+)\s*m/)
  if (!weightM || !distM) return null
  return { weight: parseFloat(weightM[1]), unit: weightM[2], dist: parseFloat(distM[1]) }
}

function parseRepsOnlyFromLabel(label: string | null | undefined, isBand: boolean): number | null {
  if (isBand) {
    const m = label?.match(/×\s*(\d+)/)
    return m ? parseInt(m[1]) : null
  }
  const m = label?.match(/·\s*(\d+)\s*reps/)
  return m ? parseInt(m[1]) : null
}

function parseBandLevelFromLabel(label: string | null | undefined): string | null {
  const m = label?.match(/\[Band(?:\s*\+\s*Knee)?\]\s*·\s*([\w\s]+?)\s*×/)
  return m ? m[1].trim() : null
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function fmtDurationLong(secs: number | null | undefined): string {
  if (!secs) return '0 sec'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s} sec`
  if (s === 0) return `${m} min`
  return `${m} min ${s} sec`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

// ── Isometric milestones / phases ────────────────────────────────────────────
// Locked in CLAUDE.md "Isometric detail card — locked design spec". Single
// milestone set for ALL isometric movements (no more 10-min ceiling for
// plank-class moves); capped at 2 min because past that you're testing pain
// tolerance, not strength (McGill, Behm & Colado, Stronger By Science). The
// 11 milestones are partitioned into three proficiency phases by hold time:
// ≤30 s = STABILITY, 30-90 s = DURABILITY, 90 s+ = MASTERY.
const ISO_MILESTONES: number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

type IsoPhase = 'stability' | 'durability' | 'mastery'

const ISO_PHASE_CONFIG: Record<IsoPhase, { label: string; tiles: number[]; whyText: string }> = {
  stability: {
    label:   'STABILITY PHASE',
    tiles:   [10, 20, 30],
    whyText: 'Short max-effort holds train your biggest motor units to fire harder and faster. The adaptation is neural — you build raw isometric force without much time-under-tension.',
  },
  durability: {
    label:   'DURABILITY PHASE',
    tiles:   [40, 50, 60, 70, 80, 90],
    whyText: 'Mid-range holds put your muscles and connective tissue under sustained tension. The adaptation is endurance and stiffness — the sweet spot for everyday stability and athletic transfer.',
  },
  mastery: {
    label:   'MASTERY PHASE',
    tiles:   [100, 110, 120],
    whyText: "Long holds train connective-tissue endurance and mental fortitude. Returns diminish past 2 min — beyond that you're testing pain tolerance, not strength.",
  },
}

function isoPhaseForBest(bestSecs: number): IsoPhase {
  if (bestSecs >= 90) return 'mastery'
  if (bestSecs >= 30) return 'durability'
  return 'stability'
}

// ── Carry detail card constants ───────────────────────────────────────────────
// Locked in CLAUDE.md "Carry detail card — locked design spec".
// Strongman tier benchmarks per carry movement. Tuple format:
//   [minRatio_or_minKg, minDist_m]
//   mode: 'ratio' → first element is weight / bodyweight (per hand or per implement)
//   mode: 'abs'   → first element is absolute weight in kg
// Unrecognized movements fall back to Farmer's Carry ratio thresholds.
type CarryTier = 'beginner' | 'intermediate' | 'advanced' | 'strongman'
type CarryZone = 'max_load' | 'distance_build' | 'conditioning'

interface CarryBenchmarkCfg {
  mode:  'ratio' | 'abs'
  tiers: Record<CarryTier, [number, number]>
}

const CARRY_BENCHMARKS: Record<string, CarryBenchmarkCfg> = Object.freeze({
  "Farmer's Carry":              { mode: 'ratio', tiers: { beginner: [0.50, 15], intermediate: [1.00, 15], advanced: [1.50, 15], strongman: [2.00, 15] } },
  "Kettlebell Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.40, 15], intermediate: [0.75, 15], advanced: [1.25, 15], strongman: [1.75, 15] } },
  "Single Arm Farmer's Carry":  { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Suitcase Carry":             { mode: 'ratio', tiers: { beginner: [0.25, 15], intermediate: [0.50, 15], advanced: [0.75, 15], strongman: [1.00, 15] } },
  "Yoke Carry":                 { mode: 'ratio', tiers: { beginner: [1.00,  7], intermediate: [1.50,  7], advanced: [2.00,  7], strongman: [2.50,  7] } },
  "Kettlebell Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.15, 15], intermediate: [0.25, 15], advanced: [0.40, 15], strongman: [0.50, 15] } },
  "Single Arm Overhead Carry":  { mode: 'ratio', tiers: { beginner: [0.10, 15], intermediate: [0.20, 15], advanced: [0.30, 15], strongman: [0.40, 15] } },
  "Atlas Stone Bear Hug Carry": { mode: 'abs',   tiers: { beginner: [40, 10],   intermediate: [70, 10],   advanced: [110, 10],  strongman: [140, 10] } },
  "D-Ball Bear Hug Carry":      { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [60, 10],   advanced: [ 90, 10],  strongman: [120, 10] } },
  "Husafell Stone Carry":       { mode: 'abs',   tiers: { beginner: [50, 10],   intermediate: [80, 10],   advanced: [120, 10],  strongman: [150, 10] } },
  "Keg Carry":                  { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [60, 10],   advanced: [100, 10],  strongman: [130, 10] } },
  "Sandbag Carry":              { mode: 'abs',   tiers: { beginner: [25, 10],   intermediate: [50, 10],   advanced: [ 80, 10],  strongman: [110, 10] } },
  "Shield Carry":               { mode: 'abs',   tiers: { beginner: [30, 10],   intermediate: [50, 10],   advanced: [ 75, 10],  strongman: [100, 10] } },

  // Sled Work variants — May 2026 cleanup consolidated cardio's Sled Pull/Push
  // and strength's Sled Work / Sled Push (Prowler) into a single `Sled Work`
  // with two variants tagged `[Push]` and `[Pull]`. Push is leg-dominant
  // (Prowler-style, quad/glute concentric drive) so higher loads are possible;
  // Pull is posterior-chain dominant (strap or harness, hams/glutes pull)
  // and typically carries less weight. Ratios benchmarked against GoRuck,
  // Strongman Corporation, and tactical-fitness programs (Brian Alsruhe,
  // Bryce Lewis). Ratio-mode (vs BW) makes more sense than absolute because
  // a 250 lb athlete pushing 200 lb is not equivalent to a 130 lb athlete
  // pushing the same.
  "Sled Work [Push]":           { mode: 'ratio', tiers: { beginner: [1.00, 15], intermediate: [1.50, 15], advanced: [2.00, 15], strongman: [2.50, 15] } },
  "Sled Work [Drag]":           { mode: 'ratio', tiers: { beginner: [0.75, 15], intermediate: [1.25, 15], advanced: [1.75, 15], strongman: [2.25, 15] } },
})

const CARRY_TIER_ORDER:  CarryTier[]                  = ['beginner', 'intermediate', 'advanced', 'strongman']
const CARRY_TIER_LABELS: Record<CarryTier, string>    = { beginner: 'BEGINNER', intermediate: 'INTERMEDIATE', advanced: 'ADVANCED', strongman: 'STRONGMAN' }
const CARRY_TIER_RANK:   Record<CarryTier, number>    = { beginner: 1, intermediate: 2, advanced: 3, strongman: 4 }

// Carry adaptation zones — replaces STRENGTH/HYPERTROPHY/ENDURANCE for carries.
// Each zone has only a label + "why" line. The actual targets are derived
// per-zone from the user's PB (bestWeight + bestDist) inside `zoneMath` — each
// zone pushes ONE axis (or two for conditioning) anchored on the user's actual
// data, so the three hero slots produce GENUINELY different prescriptions
// instead of all three showing the same global PB. See zoneMath inside
// CarryDetail for the math.
interface CarryZoneCfg { label: string; whyText: string }
const CARRY_ZONES: Record<CarryZone, CarryZoneCfg> = Object.freeze({
  max_load:       { label: 'MAX LOAD',       whyText: 'Heavier weight, same distance. Trains absolute strength and grip endurance under load.' },
  distance_build: { label: 'DISTANCE BUILD', whyText: 'Same weight, longer distance. Trains sustained postural control and grip stamina.' },
  conditioning:   { label: 'CONDITIONING',   whyText: 'Lighter weight, longer distance. Trains aerobic capacity and grip endurance under fatigue.' },
})
const CARRY_ZONE_ORDER: CarryZone[] = ['max_load', 'distance_build', 'conditioning']

// Resolve the benchmark config for a movement (fallback: Farmer's Carry ratio table).
function carryBenchmarkFor(movementName: string): CarryBenchmarkCfg {
  return CARRY_BENCHMARKS[movementName] ?? CARRY_BENCHMARKS["Farmer's Carry"]
}

// Per-movement weight ladders. When present, the zone-math snap rounds to a
// valid ladder rung instead of a 2.5 kg / 5 lb generic increment, so the
// displayed targets correspond to weights the user can actually find at a
// gym (a real Atlas Stone is 100 / 120 / 140 kg, not 102.5 kg).
// Movements NOT in this map fall back to the generic increment snap.
const CARRY_WEIGHT_LADDERS: Record<string, { kg?: number[]; lb?: number[] }> = {
  // ── kg-locked strongman objects (single ladder, kg only)
  'Atlas Stone Bear Hug Carry': { kg: [60, 80, 100, 120, 140, 160, 180, 200] },
  'D-Ball Bear Hug Carry':      { kg: [30, 40, 50, 60, 70, 80, 90, 100] },
  'Husafell Stone Carry':       { kg: [100, 120, 140, 160, 180, 200] },
  'Keg Carry':                  { kg: [40, 60, 80, 100, 120] },
  'Shield Carry':               { kg: [30, 40, 50, 60, 75, 100] },
  'Yoke Carry':                 { kg: [100, 140, 180, 220, 260, 300, 340] },
  // Sandbag isn't unit-locked yet (flexible kg/lb per user's policy), so it
  // gets both ladders. Mapped to typical strongman/conditioning sandbag sizes.
  'Sandbag Carry': {
    kg: [25, 35, 50, 65, 80, 100, 125],
    lb: [50, 75, 100, 125, 150, 175, 200, 250],
  },
  // ── Kettlebell carries (flexible kg/lb per user's policy — kettlebells
  //    come in standard discrete sizes in both unit systems).
  "Kettlebell Farmer's Carry": {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  'Kettlebell Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
  // Single Arm Overhead is typically a KB / DB unilateral carry — same KB
  // ladder. (DBs in the US also come in 5 lb increments, so the lb ladder
  // captures both KB and DB sizes.)
  'Single Arm Overhead Carry': {
    kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
    lb: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  },
}

// Returns the ladder for a movement+unit, or null if no ladder applies
// (other carries — Farmer's, Suitcase, Sled, Vehicle Pull — use the generic
// 2.5 kg / 5 lb increment).
function carryLadderFor(movementName: string, unit: 'kg' | 'lb'): number[] | null {
  const entry = CARRY_WEIGHT_LADDERS[movementName]
  if (!entry) return null
  return entry[unit] ?? null
}

// Snap DOWN to the nearest ladder rung ≤ value. If value is below the lowest
// rung, returns the lowest rung (so a beginner doesn't see "0 kg" target).
function snapDownToLadder(value: number, ladder: number[]): number {
  if (!ladder.length) return value
  let best = ladder[0]
  for (const rung of ladder) {
    if (rung <= value) best = rung
    else break
  }
  return best
}

// Return the smallest ladder rung > value, or null if value ≥ largest rung
// (i.e., user has graduated past the heaviest available equipment).
function nextLadderAbove(value: number, ladder: number[]): number | null {
  for (const rung of ladder) {
    if (rung > value) return rung
  }
  return null
}

// Highest tier the user qualifies for given the parsed efforts + bodyweight.
// Returns null when no tier qualifies (e.g. ratio mode with no bodyweight, or
// no efforts long/heavy enough for the beginner tier).
// Ratio mode normalises both effort weight and bodyweight to LB for comparison.
// Abs mode normalises effort weight to KG.
interface CarryParsedEffort { weight: number; unit: string; distM: number }
function computeCarryTier(
  movementName: string,
  efforts: CarryParsedEffort[],
  bodyweightLb: number | null,
): CarryTier | null {
  const cfg = carryBenchmarkFor(movementName)
  for (const tier of [...CARRY_TIER_ORDER].reverse()) {
    const [threshold, minDistM] = cfg.tiers[tier]
    const qualifies = efforts.some(e => {
      if (e.distM < minDistM) return false
      if (cfg.mode === 'ratio') {
        if (!bodyweightLb || bodyweightLb <= 0) return false
        const weightLb = e.unit === 'kg' ? e.weight / 0.453592 : e.weight
        return (weightLb / bodyweightLb) >= threshold
      }
      const weightKg = e.unit === 'lb' ? e.weight * 0.453592 : e.weight
      return weightKg >= threshold
    })
    if (qualifies) return tier
  }
  return null
}

// ── Common navigation ───────────────────────────────────────────────────────

function goBack() {
  if (router.canGoBack()) router.back()
  else router.replace('/(app)/strength' as any)
}

// ── Common subview pieces ───────────────────────────────────────────────────

function BackButton() {
  // Native-style chevron-only back affordance. Web has a wordy "← Back" link;
  // on mobile, every modern app (Instagram, Spotify, Gmail, etc.) shows just a
  // chevron in the top-left. hitSlop expands the tappable area beyond the
  // visible icon so the small target is still easy to hit.
  return (
    <Pressable onPress={goBack} style={s.backBtn} hitSlop={12} accessibilityLabel="Go back">
      <ChevronLeft size={24} color={colors.foreground} />
    </Pressable>
  )
}

function NextTargetCallout({
  title = 'Your next training target',
  style,
  children,
}: { title?: string; style?: any; children: React.ReactNode }) {
  return (
    <View style={[s.callout, style]}>
      <Text style={s.calloutTitle}>{title}</Text>
      {children}
    </View>
  )
}

interface TileGridProps<T> {
  items: T[]
  cols?: number
  gap?: number
  renderTile: (item: T, i: number, tileW: number) => React.ReactNode
}

function TileGrid<T>({ items, cols = 5, gap = 8, renderTile }: TileGridProps<T>) {
  // Pre-seed the measured width with the standard page-inside-card layout:
  //   window − 16 page padding × 2 − 20 card padding × 2 − 1 card border × 2
  //   = window − 74
  // The border-width terms MATTER: RN uses border-box sizing, so the card's
  // CONTENT area is the outer width minus padding AND border. Without that
  // subtraction the fallback is 2 dp too large; tileW gets rounded up by 1
  // each, and 5 × tileW + 4 × gap exceeds the actual width by ~1 dp →  the
  // 5th tile wraps to row 2 (4-column layout) on the first paint. Then
  // onLayout fires with the real width, tileW shrinks by 1, 5 columns fit
  // — the user sees a visible reflow from 4 cols → 5 cols.
  // Every place TileGrid renders today sits inside an `s.card` on a strength
  // detail page, so this formula matches the actual width exactly (no
  // sub-pixel mismatch). onLayout still refines for atypical contexts.
  const winWidth = useWindowDimensions().width
  const PAGE_PADDING = 16
  const CARD_PADDING = 20
  const CARD_BORDER  = 1
  const fallbackW = Math.max(0, winWidth - PAGE_PADDING * 2 - CARD_PADDING * 2 - CARD_BORDER * 2)
  const [w, setW] = useState(fallbackW)
  // Math.floor avoids fractional widths that RN can round in a way that
  // pushes the last column to wrap. Using explicit marginRight per child
  // (instead of `gap` on the parent) keeps the layout deterministic.
  const tileW = w > 0 ? Math.floor((w - gap * (cols - 1)) / cols) : 0
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)
  const totalRows = Math.ceil(items.length / cols)

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap' }}
      onLayout={onLayout}
    >
      {tileW > 0 && items.map((item, i) => {
        const isLastInRow = (i + 1) % cols === 0
        const row         = Math.floor(i / cols)
        const isLastRow   = row === totalRows - 1
        return (
          <View
            key={i}
            style={{
              width: tileW,
              marginRight: isLastInRow ? 0 : gap,
              marginBottom: isLastRow ? 0 : gap,
            }}
          >
            {renderTile(item, i, tileW)}
          </View>
        )
      })}
    </View>
  )
}

// ── Bodyweight consolidated block ──
// Renders the tier pills + swipeable per-tier slots (tile grid + hero card).
// See CLAUDE.md "Bodyweight consolidated detail card — locked design spec".
interface BodyweightConsolidatedBlockProps {
  bwLoggedTiers:      BwTier[]
  bwActiveTier:       BwTier
  bwBestByTier:       Record<BwTier, number>
  bwHighestTier:      BwTier
  // Reused from the existing Full-RX bwTiles math (added-weight projections)
  // for weighted-progression movements, or the 3-stage rep-only milestones for
  // rep-only bodyweight movements. The `mode` discriminator distinguishes:
  //   'weighted' / 'push' / 'locked' — weighted-progression family
  //   'achieved' / 'push' / 'locked' — rep-only family (no addedWeight)
  bwTiles: {
    reps: number
    addedWeight: number | null
    plates: number[]
    achievable: boolean
    mode: 'locked' | 'push' | 'weighted' | 'achieved'
    nextRep?: number
    isGraduation: boolean
  }[]
  /** True for Pull Up / Dip / Push Up family; false for rep-only movements
   *  (Burpee, Sit Up, etc.) which use the 3-stage rep milestone system. */
  weightedProgression: boolean
  // Full RX hero card body re-uses the pre-consolidation selectedBWTile-driven
  // logic (locked / push / graduation / weighted). Must be passed through so
  // the body can render the same 4 modes the user already knows.
  selectedBWTile:      BodyweightConsolidatedBlockProps['bwTiles'][number] | null
  profileUnit:         'lb' | 'kg'
  selectedRM:          number
  setSelectedRM:       (n: number) => void
  bwTierInfoOpen:      boolean
  setBwTierInfoOpen:   React.Dispatch<React.SetStateAction<boolean>>
  setBwSelectedTier:   React.Dispatch<React.SetStateAction<BwTier | null>>
  bwTierScrollRef:     React.MutableRefObject<ScrollView | null>
  bwTierSlotWidths:    React.MutableRefObject<Record<string, number>>
  bwGraduationDate:    (tier: BwTier) => string | null
  bwLatestBandLevel:   string | null
  bwEffortsByTier:     Record<BwTier, Effort[]>
  /** Pull-Up / Dip / Chin-Up family only — when false (Leg Raise, Plank,
   *  etc.), the tier pill row is hidden because "Full RX" is meaningless
   *  for movements with no assisted-tier progression. */
  canHaveTiers:        boolean
}

function BodyweightConsolidatedBlock(props: BodyweightConsolidatedBlockProps) {
  const {
    bwLoggedTiers, bwActiveTier, bwBestByTier, bwHighestTier,
    bwTiles, selectedBWTile, profileUnit, selectedRM, setSelectedRM,
    bwTierInfoOpen, setBwTierInfoOpen, setBwSelectedTier, canHaveTiers,
    bwTierScrollRef, bwTierSlotWidths,
    bwGraduationDate, bwLatestBandLevel, bwEffortsByTier,
    weightedProgression,
  } = props

  // Pre-seed slotWidth with the screen width minus page padding so the
  // BW pager's tier slots render at near-final width on the very first
  // paint — instead of starting at 0 and popping in after onLayout fires.
  // Page padding (from `app/(app)/_layout.tsx`'s scrollContent style) is
  // 16 each side; subtract 32 total. onLayout still refines if the actual
  // measured width differs (e.g., split-view, orientation, dynamic island
  // cutouts), but the difference is sub-pixel typically — the visible
  // 0 → N jump that caused the "hero card lags the rest of the page" is
  // gone. The previous `layoutAnimEnabled` first-paint gate is no longer
  // needed: the info panel now uses direct-height-animation (ExpandPanel)
  // which doesn't fight with the slot-width measurement on first paint.
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  const [slotWidth, setSlotWidth] = useState(Math.max(0, winWidth - PAGE_PADDING_HORIZONTAL * 2))

  // Bodyweight consolidated: on first paint after the active tier is resolved
  // and the swipe carousel has measured itself, scroll to the active tier's
  // slot. Without this, the page would land at slot 0 (lowest tier) while the
  // active-pill state already points at the user's highest tier — desync.
  // Runs once per mount (ref flag suppresses re-runs on user navigation).
  const bwInitialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (bwInitialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!bwTierScrollRef.current) return
    const idx = bwLoggedTiers.indexOf(bwActiveTier)
    if (idx < 0) return
    // `animated: false` so the page opens directly on the right slot without
    // a visible auto-scroll animation on first mount.
    bwTierScrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    bwInitialScrollDoneRef.current = true
  }, [slotWidth, bwActiveTier, bwLoggedTiers, bwTierScrollRef])

  // ── Pill navigation (component-level so the Pan gesture worklet can call
  // it via runOnJS) ────────────────────────────────────────────────────────
  const currentTierIdx = bwLoggedTiers.indexOf(bwActiveTier)
  const canGoLeft  = currentTierIdx > 0
  const canGoRight = currentTierIdx >= 0 && currentTierIdx < bwLoggedTiers.length - 1
  const navigateTier = (direction: -1 | 1) => {
    const targetIdx = currentTierIdx + direction
    if (targetIdx < 0 || targetIdx >= bwLoggedTiers.length) return
    const targetTier = bwLoggedTiers[targetIdx]
    setBwSelectedTier(targetTier)
    setBwTierInfoOpen(false)
    const tierBest = bwBestByTier[targetTier] || 1
    setSelectedRM(Math.min(Math.max(tierBest, 1), 10))
    if (slotWidth > 0 && bwTierScrollRef.current) {
      bwTierScrollRef.current.scrollTo({ x: targetIdx * slotWidth, animated: true })
    }
  }

  // ── Pan gesture + slide animation for the pill row ─────────────────────
  // The pill is "locked" to the page during the swipe — it follows the
  // finger horizontally, then on release either bounces back (if drag was
  // short) or completes a slide-off / state-change / slide-in cycle.
  //
  // Sequence on a committed swipe:
  //   1. onStart        → chevrons fade out (120ms)
  //   2. onUpdate       → pill follows finger (translateX = translation)
  //   3. onEnd (commit) → pill slides off-screen in swipe direction (250ms)
  //                     → navigateTier() updates state (label changes)
  //                     → pill teleports to opposite off-screen position
  //                     → pill slides back to centre (250ms)
  //                     → chevrons fade back in (200ms), pulse loop resumes
  // Sequence on a cancelled swipe (below threshold or disallowed direction):
  //   onEnd → pill springs back to 0 (200ms), chevrons fade back in
  const SWIPE_THRESHOLD_PX = 20
  const SLIDE_OFFSCREEN_PX = 220
  const SLIDE_DURATION_MS  = 250

  const pillTranslateX        = useSharedValue(0)
  const chevronOpacityOverride = useSharedValue(1)

  const pillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        chevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        pillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const directionAllowed = direction === -1 ? canGoLeft : canGoRight
        const past = Math.abs(event.translationX) > SWIPE_THRESHOLD_PX

        if (!past || !directionAllowed) {
          // Bounce back to centre; chevrons re-appear.
          pillTranslateX.value = withTiming(0, { duration: 200 })
          chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }

        // Slide pill off-screen in the swipe direction. After the slide,
        // change tiers (label updates), teleport the pill to the opposite
        // off-screen position, then slide it back to centre and re-show
        // the chevrons.
        const slideOff = direction === 1 ? -SLIDE_OFFSCREEN_PX : SLIDE_OFFSCREEN_PX
        pillTranslateX.value = withTiming(slideOff, { duration: SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateTier)(direction)
          // Teleport to opposite side, then slide in.
          pillTranslateX.value = -slideOff
          pillTranslateX.value = withTiming(0, { duration: SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) {
              chevronOpacityOverride.value = withTiming(1, { duration: 200 })
            }
          })
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTierIdx, bwLoggedTiers, slotWidth, canGoLeft, canGoRight]
  )

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillTranslateX.value }],
  }))
  const chevronAnimatedStyle = useAnimatedStyle(() => ({
    opacity: chevronOpacityOverride.value,
  }))

  return (
    <View style={{ gap: 12 }}>
      {/* Single active tier pill, flanked by pulsing chevrons that indicate
          swipe direction. See CLAUDE.md "Bodyweight consolidated detail card"
          for the locked behaviour. The whole row is wrapped in a
          GestureDetector so horizontal swipes anywhere on it navigate —
          chevron taps still fire because the Pan only activates after 15 px
          of horizontal movement.
          Hidden entirely for non-tier-eligible bodyweight movements
          (Leg Raise, Plank, etc.) — the "FULL RX" label is misleading when
          there's no assisted-tier progression. */}
      {canHaveTiers && (
        <GestureDetector gesture={pillSwipeGesture}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 6 }}
          >
              <Animated.View style={[{ width: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }, chevronAnimatedStyle]}>
                {canGoLeft && (
                  <Pressable
                    onPress={() => navigateTier(-1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Previous tier"
                  >
                    <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>

              <Animated.View
                style={[
                  {
                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                    borderWidth: 1, borderColor: palette.blue[500],
                    backgroundColor: withAlpha(palette.blue[500], 0.15),
                  },
                  pillAnimatedStyle,
                ]}
              >
                <Text style={{
                  fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                  letterSpacing: 0.5, color: palette.blue[400],
                }}>
                  {bwTierLabel(bwActiveTier)}
                </Text>
              </Animated.View>

              <Animated.View style={[{ width: 56, flexDirection: 'row', alignItems: 'center' }, chevronAnimatedStyle]}>
                {canGoRight && (
                  <Pressable
                    onPress={() => navigateTier(1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Next tier"
                  >
                    <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            </View>
          </GestureDetector>
      )}

      {/* Swipe container: each tier is a paging slot. */}
      <View
        onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={bwTierScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          onMomentumScrollEnd={e => {
            if (slotWidth === 0) return
            const x = e.nativeEvent.contentOffset.x
            const idx = Math.round(x / slotWidth)
            const t = bwLoggedTiers[idx]
            if (t && t !== bwActiveTier) {
              setBwSelectedTier(t)
              setBwTierInfoOpen(false)
              const tierBest = bwBestByTier[t] || 1
              setSelectedRM(Math.min(Math.max(tierBest, 1), 10))
            }
          }}
        >
          {bwLoggedTiers.map(t => {
            const tierBest    = bwBestByTier[t]
            const isFullRxT   = t === 'rx'
            const isGradT     = BW_TIER_RANK[bwHighestTier] > BW_TIER_RANK[t]
            const numEffortsT = bwEffortsByTier[t].length
            const gradDate    = bwGraduationDate(t)
            const nextT       = bwNextTier(t)

            // Band-level sub-progression applies to Band and Band+Knee only.
            // Drives the tile grid (best at CURRENT band, not cumulative),
            // the cue text, the sub-line under the big number, and the
            // ready-to-graduate condition. See CLAUDE.md.
            const hasBandLevels  = t === 'band' || t === 'band+knee'
            const bandSubState   = hasBandLevels ? computeBandSubState(bwEffortsByTier[t]) : null
            // `displayBest` drives the big number and the tile grid; for
            // Band / Band+Knee it's the best at the current band level
            // (which "auto-advances" once 10 is hit), for Knee/RX it's the
            // overall tier best.
            const displayBest    = bandSubState ? bandSubState.bestAtCurrent : tierBest
            // Ready-to-graduate condition is band-aware: Band and Band+Knee
            // graduate when 10 hit at the Light band level; Knee graduates
            // on overall best ≥ 10; Full RX has its own logic.
            const isReadyT       = !isFullRxT && !isGradT && (
              bandSubState
                ? bandSubState.allLevelsCleared
                : tierBest >= BW_GRADUATION_REPS
            )

            return (
              <View
                key={t}
                style={{ width: slotWidth, paddingHorizontal: 0 }}
                onLayout={e => { bwTierSlotWidths.current[t] = e.nativeEvent.layout.width }}
              >
                <View style={s.card}>
                  {/* Tile section */}
                  {isFullRxT ? (
                    <>
                      <View style={{ gap: 2 }}>
                        <Text style={s.h2}>
                          {weightedProgression ? 'Max attempt projections' : 'Max attempts'}
                        </Text>
                        <Text style={s.helpText}>
                          {weightedProgression
                            ? 'Add the proposed load to train each rep target at the same intensity as your current max'
                            : 'Each tile is a rep-count milestone — checkmarks fill in as you hit them'}
                        </Text>
                      </View>
                      <TileGrid
                        items={bwTiles}
                        renderTile={({ reps: r, addedWeight: aw, achievable, mode, nextRep }) => {
                          const isSelected = selectedRM === r
                          const isCurrent  = r === tierBest
                          // For rep-only tiles, 'achieved' replaces 'weighted'
                          // as the visited-state styling. Selection still wins
                          // over current/achieved so the active tile pops.
                          const isAchieved = mode === 'achieved'
                          return (
                            <Pressable
                              onPress={() => achievable && setSelectedRM(r)}
                              disabled={!achievable}
                              style={[
                                s.tile,
                                isSelected  ? s.tileSelected
                                : isCurrent ? s.tileCurrent
                                : isAchieved ? s.tileCurrent
                                : achievable ? s.tileAchievable
                                            : s.tileLocked,
                              ]}
                            >
                              <View style={{ alignItems: 'center' }}>
                                <Text style={[
                                  s.tileLabel,
                                  isSelected  ? s.tileTextSelected
                                  : isCurrent ? s.tileTextCurrentDim
                                  : isAchieved ? s.tileTextCurrentDim
                                  : achievable ? s.tileLabelMuted
                                              : s.tileTextLocked,
                                ]}>{r}</Text>
                                <Text style={[
                                  s.tileLabel,
                                  isSelected  ? s.tileTextSelected
                                  : isCurrent ? s.tileTextCurrentDim
                                  : isAchieved ? s.tileTextCurrentDim
                                  : achievable ? s.tileLabelMuted
                                              : s.tileTextLocked,
                                ]}>{r > 1 ? 'reps' : 'rep'}</Text>
                              </View>
                              {mode === 'achieved' ? (
                                <View style={{ marginTop: 2, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                                  <Check size={14} color={palette.blue[400]} strokeWidth={3} />
                                </View>
                              ) : (
                                <Text style={[
                                  s.tileValueMono,
                                  isSelected  ? s.tileTextSelected
                                  : isCurrent ? s.tileTextCurrent
                                  : achievable ? s.tileTextAchievable
                                              : s.tileTextLocked,
                                ]}>
                                  {mode === 'locked' ? '—'
                                    : mode === 'push' ? `→ ${nextRep}`
                                    : aw === 0 ? 'BW' : `+${aw}`}
                                </Text>
                              )}
                            </Pressable>
                          )
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <View style={{ gap: 2 }}>
                        <Text style={s.h2}>Max attempts</Text>
                        <Text style={s.helpText}>
                          Each tile is a rep-count milestone — checkmarks fill in as you hit them
                        </Text>
                      </View>
                      <TileGrid
                        items={Array.from({ length: 10 }, (_, i) => i + 1)}
                        renderTile={(r: number) => {
                          // Achievement is based on `displayBest` — for Band /
                          // Band+Knee that's the best at the CURRENT band
                          // level (auto-advances after 10), so the tiles
                          // visibly reset when the user moves to a thinner
                          // band. Knee tier just uses overall tier best.
                          const achieved = r <= displayBest
                          return (
                            <View style={[
                              s.tile,
                              achieved ? s.tileCurrent : s.tileLocked,
                            ]}>
                              <View style={{ alignItems: 'center' }}>
                                <Text style={[s.tileLabel, achieved ? s.tileTextCurrentDim : s.tileTextLocked]}>{r}</Text>
                                <Text style={[s.tileLabel, achieved ? s.tileTextCurrentDim : s.tileTextLocked]}>{r > 1 ? 'reps' : 'rep'}</Text>
                              </View>
                              <View style={{ marginTop: 2, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                                {achieved
                                  ? <Check size={14} color={palette.blue[400]} strokeWidth={3} />
                                  : <Text style={[s.tileValueMono, s.tileTextLocked]}>—</Text>}
                              </View>
                            </View>
                          )
                        }}
                      />
                    </>
                  )}

                  <Text style={s.tinyText}>Greyed out tiles are rep counts not yet achieved</Text>

                  {/* Hero card (4 states). NextTargetCallout's default title
                      "Your next training target" is reused here so the layout
                      mirrors the weighted-standard card. No modifier style:
                      BW lets each variant render at its natural size to
                      avoid trailing empty space on shorter modes. */}
                  <NextTargetCallout>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                      <Pressable
                        onPress={() => setBwTierInfoOpen(o => !o)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 4,
                          paddingHorizontal: 8, paddingVertical: 2,
                          borderRadius: 999, borderWidth: 1,
                          borderColor: withAlpha(palette.blue[500], 0.4),
                          backgroundColor: withAlpha(palette.blue[500], 0.1),
                        }}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: palette.blue[400] }} numberOfLines={1}>
                          {bwTierLabel(t)}
                        </Text>
                        <Info size={11} color={palette.blue[400]} />
                      </Pressable>
                    </View>

                    <ExpandPanel open={bwTierInfoOpen}>
                      <View
                        style={{
                          borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.15),
                          backgroundColor: alpha(colors.card, 0.6), borderRadius: 6,
                          paddingHorizontal: 10, paddingVertical: 8, marginTop: 4,
                        }}
                      >
                        <Text style={[s.calloutLabel, { color: colors.foreground, fontWeight: '700', fontSize: 12, marginBottom: 4 }]}>
                          {bwTierLabel(t)}
                        </Text>
                        <Text style={[s.tinyText, { lineHeight: 16 }]}>{bwWhyText(t)}</Text>
                      </View>
                    </ExpandPanel>

                    <View style={{ gap: 2 }}>
                      {isGradT ? (
                        /* Graduated past this tier — simple one-liner; the
                           peak reps + graduation date + session count are
                           intentionally hidden because the user has moved
                           on and that historical detail isn't relevant
                           here anymore. */
                        <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
                          <Check size={28} color={palette.blue[400]} strokeWidth={2.5} />
                          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.foreground }}>
                            You've moved past this tier
                          </Text>
                          <Text style={s.tinyText}>
                            Now training on <Text style={{ fontWeight: '700', color: colors.foreground }}>{bwTierLabel(bwHighestTier)}</Text>
                          </Text>
                        </View>
                      ) : isReadyT ? (
                        <>
                          <View style={s.calloutValueRow}>
                            <TickerNumber value={displayBest} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                            <Text style={s.calloutSubText}>max attempts</Text>
                          </View>
                          <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15), gap: 2 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <PartyPopper size={14} color={palette.blue[400]} />
                              <Text style={s.calloutLabel}>
                                You're ready for <Text style={{ fontWeight: '700', color: colors.foreground }}>{bwTierLabel(nextT)}</Text>
                              </Text>
                            </View>
                            <Text style={s.tinyText}>Log a {bwTierLabel(nextT)} effort to promote</Text>
                          </View>
                        </>
                      ) : isFullRxT ? (
                        /* Full RX — driven by selectedBWTile so tapping a
                           tile in the grid above swaps the body content.
                           Two flavours:
                             1. !weightedProgression — rep-only milestone copy
                                (achieved / push / locked).
                             2. weightedProgression — original locked / push /
                                weighted body. The graduation branch was
                                removed: at best === 10 with no weighted
                                efforts, the tile is now a regular weighted
                                tile and the hero falls through to the
                                standard "+X lb" body. */
                        !weightedProgression ? (
                          selectedBWTile?.mode === 'achieved' ? (() => {
                            // Find the earliest effort on the active tier that reached
                            // or exceeded this tile's rep count — that's when the user
                            // first cleared this milestone.
                            const rxEffs = bwEffortsByTier[bwActiveTier] ?? []
                            const firstClearedTs = rxEffs
                              .filter(e => (parseRepsFromBwLabel(e.label) ?? 0) >= selectedBWTile.reps)
                              .map(e => e.created_at)
                              .sort()[0] ?? null
                            const clearedLabel = firstClearedTs
                              ? new Date(firstClearedTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : null
                            // Next milestone above the user's current best (within the
                            // active rep-only stage). Null when user has cleared the
                            // top of stage 3 (max milestone reached).
                            const tierBestForRepOnly = bwBestByTier[bwActiveTier] ?? 0
                            const activeStage = pickRepOnlyStage(tierBestForRepOnly)
                            const nextMilestone = activeStage.find(r => r > tierBestForRepOnly) ?? null
                            return (
                              <>
                                <View style={s.calloutValueRow}>
                                  <TickerNumber value={selectedBWTile.reps} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                  <Text style={s.calloutSubText}>{selectedBWTile.reps > 1 ? 'reps cleared' : 'rep cleared'}</Text>
                                </View>
                                <Text style={s.tinyText}>
                                  {clearedLabel ? `Cleared on ${clearedLabel}` : 'Cleared'}
                                  {nextMilestone != null
                                    ? ` · Next milestone: ${nextMilestone} reps`
                                    : ' · Max milestone reached'}
                                </Text>
                              </>
                            )
                          })() : selectedBWTile?.mode === 'push' ? (
                            <>
                              <View style={s.calloutValueRow}>
                                <TickerNumber value={selectedBWTile.reps} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                <Text style={s.calloutSubText}>{selectedBWTile.reps > 1 ? 'reps next' : 'rep next'}</Text>
                              </View>
                              <Text style={s.tinyText}>
                                Push for {selectedBWTile.reps} unbroken {repWord(selectedBWTile.reps)}
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={s.calloutLabel}>Target</Text>
                              <View style={s.calloutValueRow}>
                                <TickerNumber value={selectedBWTile?.reps ?? selectedRM} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                <Text style={s.calloutSubText}>{(selectedBWTile?.reps ?? selectedRM) > 1 ? 'reps' : 'rep'}</Text>
                              </View>
                              <Text style={s.tinyText}>
                                Locked — keep building reps
                              </Text>
                            </>
                          )
                        ) : !selectedBWTile || !selectedBWTile.achievable ? (
                          <>
                            <Text style={s.calloutLabel}>Target</Text>
                            <View style={s.calloutValueRow}>
                              <TickerNumber value={selectedRM} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                              <Text style={s.calloutSubText}>max attempts</Text>
                            </View>
                            <Text style={s.tinyText}>
                              Build up to {selectedRM} clean reps at bodyweight first · current best: {tierBest}
                            </Text>
                          </>
                        ) : selectedBWTile.mode === 'push' ? (
                          <>
                            <View style={s.calloutValueRow}>
                              <TickerNumber value={selectedBWTile.nextRep ?? 0} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                              <Text style={s.calloutSubText}>reps next at bodyweight</Text>
                            </View>
                            <Text style={s.tinyText}>
                              Push for one more clean rep — current best: {tierBest}
                            </Text>
                          </>
                        ) : (
                          <>
                            <View style={s.targetRow}>
                              <View>
                                <Text style={s.calloutLabel}>attempt {selectedRM} {repWord(selectedRM)}</Text>
                                <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                                  <TickerNumber value={`+${selectedBWTile.addedWeight}`} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                  <Text style={s.calloutSubText}>{profileUnit} added</Text>
                                </View>
                              </View>
                              {selectedBWTile.plates.length > 0 && (
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[s.tinyText, { marginBottom: 4 }]}>belt / vest</Text>
                                  <View style={s.plateChipRow}>
                                    {selectedBWTile.plates.map((p, i) => (
                                      <View key={i} style={s.plateChip}>
                                        <Text style={s.plateChipText}>{p}</Text>
                                      </View>
                                    ))}
                                  </View>
                                </View>
                              )}
                            </View>
                            <Text style={s.tinyText}>
                              Add {selectedBWTile.addedWeight} {profileUnit} of load — aim for {selectedRM} clean rep{selectedRM > 1 ? 's' : ''}
                            </Text>
                          </>
                        )
                      ) : (
                        /* Working toward graduation on an assisted tier.
                           Single-line cue keyed to tier + current band level:
                             • Band:       Keep practicing until you hit X
                                           unbroken reps with [band] band
                             • Band+Knee:  …with [band] band on your knees
                             • Knee:       …on your knees
                           Big number = NEXT target = displayBest + 1, where
                           displayBest is best at the CURRENT band level for
                           Band / Band+Knee (auto-advances when 10 is hit),
                           or overall tier best for Knee. Sub-line under big
                           number reports the current band level (Band /
                           Band+Knee) or simply "Knee assisted" (Knee). */
                        <>
                          <View style={s.calloutValueRow}>
                            <TickerNumber value={displayBest + 1} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                            <Text style={s.calloutSubText}>max attempts</Text>
                          </View>
                          {bandSubState && (
                            <Text style={s.tinyText}>
                              {t === 'band+knee' ? 'Band + Knee: ' : 'Band: '}
                              <Text style={{ color: palette.blue[400], fontWeight: '700' }}>{bandSubState.currentBand}</Text>
                            </Text>
                          )}
                          {t === 'knee' && (
                            <Text style={s.tinyText}>Knee assisted</Text>
                          )}
                          <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15) }}>
                            <Text style={s.calloutLabel}>
                              Keep practicing until you hit{' '}
                              <Text style={{ color: colors.foreground, fontWeight: '700' }}>{displayBest + 1}</Text>
                              {' '}unbroken {repWord(displayBest + 1)}
                              {t === 'band+knee' && bandSubState
                                ? <> with {aOrAn(bandSubState.currentBand)} <Text style={{ color: colors.foreground, fontWeight: '700' }}>{bandSubState.currentBand}</Text> band on your knees</>
                                : t === 'knee'
                                ? <> on your knees</>
                                : t === 'band' && bandSubState
                                ? <> with {aOrAn(bandSubState.currentBand)} <Text style={{ color: colors.foreground, fontWeight: '700' }}>{bandSubState.currentBand}</Text> band</>
                                : null}
                            </Text>
                          </View>
                        </>
                      )}
                    </View>
                  </NextTargetCallout>
                </View>
              </View>
            )
          })}
        </ScrollView>
      </View>
    </View>
  )
}

function EffortsHistorySection({
  efforts,
  renderRight,
  onDelete,
  renderLeft,
  delay = 0,
}: {
  efforts: Effort[]
  renderRight: (e: Effort) => React.ReactNode
  onDelete: (id: string) => void
  renderLeft?: (e: Effort) => React.ReactNode
  /** AnimateRise delay so the log slides in AFTER the main content + chart. */
  delay?: number
}) {
  return (
    <AnimateRise delay={delay} style={s.cardNoPad}>
      <View style={s.listHeader}>
        <Text style={s.listHeaderText}>Efforts history</Text>
      </View>
      <View>
        {[...efforts].reverse().map((e, i, arr) => (
          <DeleteAction
            key={e.id}
            onDelete={() => onDelete(e.id)}
            style={i < arr.length - 1 ? s.listRowDivider : undefined}
            bg={colors.card}
          >
            <View style={s.listRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                {renderLeft ? renderLeft(e) : (
                  <Text style={s.listRowDate}>{fmtDate(e.created_at)}</Text>
                )}
              </View>
              {renderRight(e)}
            </View>
          </DeleteAction>
        ))}
      </View>
    </AnimateRise>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// IsometricDetail
// ─────────────────────────────────────────────────────────────────────────────

function IsometricDetail({
  exercise, efforts, onDelete, hideHeader,
}: {
  exercise: string
  efforts: Effort[]
  onDelete: (id: string) => void
  /** Suppresses page-level header when rendered inside FamilyConsolidatedDetail. */
  hideHeader?: boolean
}) {
  const durations    = efforts.map(e => parseDurationSecs(e.value)).filter((s): s is number => s !== null)
  const bestSecs     = durations.length > 0 ? Math.max(...durations) : 0
  const nextMilestone = ISO_MILESTONES.find(m => m > bestSecs) ?? null
  const allCleared   = bestSecs >= ISO_MILESTONES[ISO_MILESTONES.length - 1]
  const currentPhase = isoPhaseForBest(bestSecs)
  const phaseCfg     = ISO_PHASE_CONFIG[currentPhase]

  const chartData = efforts
    .map(e => {
      const secs = parseDurationSecs(e.value)
      return secs !== null ? { ts: e.created_at, y: secs } : null
    })
    .filter((p): p is { ts: string; y: number } => p !== null)

  // Tile width + gap math for the widest row (6 tiles): 6 * 48 + 5 * 4 = 308 px.
  // Fits inside the card on standard phones (≥360 px). Labels use fmtDuration so
  // 70 s+ renders as "1m 10s"; numberOfLines={1} keeps the label on one line, and
  // the 10 px tabular-numeric monospace font keeps "1m 10s" through "1m 50s" (the
  // widest values, ~36 px) inside a 48 px tile with 2 px horizontal padding.
  const renderTile = (ms: number) => {
    const achieved = ms <= bestSecs
    return (
      <View
        key={ms}
        style={[
          {
            width: 48, paddingHorizontal: 2, paddingVertical: 6,
            borderRadius: 9, borderWidth: 1, alignItems: 'center',
          },
          achieved
            ? { borderColor: withAlpha(palette.blue[500], 0.4), backgroundColor: withAlpha(palette.blue[500], 0.08) }
            : { borderColor: alpha(colors.border, 0.3), backgroundColor: alpha(colors.card, 0.2), opacity: 0.35 },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
            fontSize: 10, fontWeight: '600',
            color: achieved ? palette.blue[400] : alpha(colors.mutedForeground, 0.4),
          }}
        >
          {fmtDuration(ms)}
        </Text>
        <View style={{ marginTop: 2, height: 12, alignItems: 'center', justifyContent: 'center' }}>
          {achieved
            ? <Check size={11} color={palette.blue[400]} strokeWidth={3} />
            : <Text style={{ fontFamily: fonts.mono[400], fontSize: 10, color: alpha(colors.mutedForeground, 0.4) }}>—</Text>}
        </View>
      </View>
    )
  }

  return (
    <View style={s.page}>
      {/* Header — suppressed when rendered inside FamilyConsolidatedDetail. */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{exercise}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Personal best — </Text>
          <TickerNumber value={fmtDurationLong(bestSecs)} fontSize={14} color={palette.blue[400]} fontWeight="600" />
        </View>
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{equipmentPillLabel('bodyweight')}</Text>
        </View>
        {/* Phase badge mirrors the carry detail's tier badge — moved out of
            the body to sit in the header as a pure status indicator. Pure
            chip (no info button, no tap), parallel to carry's tier chip. */}
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{phaseCfg.label}</Text>
        </View>
      </View>
      )}

      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Hold time milestones</Text>

        {/* 3-6-3 milestone grid, rows centered horizontally. Tiles are
            display-only — they're a status visualisation, not navigation.
            Tile width + row gap are tuned so the widest (6-tile) row fits
            inside the card without overflowing on narrow phones. */}
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
            {ISO_PHASE_CONFIG.stability.tiles.map(renderTile)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
            {ISO_PHASE_CONFIG.durability.tiles.map(renderTile)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
            {ISO_PHASE_CONFIG.mastery.tiles.map(renderTile)}
          </View>
        </View>

        <Text style={s.tinyText}>Greyed out tiles are milestones not yet reached</Text>

        <NextTargetCallout>
          {allCleared ? (
            <View style={{ alignItems: 'center', paddingVertical: 8, gap: 8 }}>
              <Trophy size={28} color={palette.blue[400]} strokeWidth={2} />
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.foreground }}>
                You've hit the practical ceiling
              </Text>
              <Text style={s.tinyText}>Anything beyond 2 min is bonus</Text>
            </View>
          ) : (() => {
            // Display logic for the next-target hero:
            //   < 60 s         → big "[N] seconds"           (e.g. "20 seconds")
            //   exact minute   → big "[M] minute(s)"         (e.g. "1 minute", "2 minutes")
            //   mixed (>60 s)  → big "[M] min(s) [S] sec"    (e.g. "1 minute 10 seconds")
            // Each numeric segment keeps its own TickerNumber so the slot-machine
            // animation still fires when bestSecs advances past a milestone.
            const nm = nextMilestone ?? 0
            const mm = Math.floor(nm / 60)
            const ss = nm % 60
            return (
              <>
                {mm === 0 ? (
                  <View style={s.calloutValueRow}>
                    <TickerNumber value={nm} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                    <Text style={s.calloutSubText}>seconds</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 4 }}>
                    <View style={s.calloutValueRow}>
                      <TickerNumber value={mm} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{mm === 1 ? 'minute' : 'minutes'}</Text>
                    </View>
                    {ss > 0 && (
                      <View style={s.calloutValueRow}>
                        <TickerNumber value={ss} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                        <Text style={s.calloutSubText}>seconds</Text>
                      </View>
                    )}
                  </View>
                )}
                <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15) }}>
                  <Text style={s.calloutLabel}>
                    Hold for{' '}
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                      {nm < 60 ? `${nm} seconds` : fmtDurationLong(nm)}
                    </Text>
                    {' '}without breaking form
                  </Text>
                </View>
              </>
            )
          })()}
        </NextTargetCallout>
      </AnimateRise>

      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Hold time over time</Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1 ? bestSecs : null}
            yTickFormatter={(v) => fmtDuration(Math.round(v))}
            tooltipValueFormatter={(v) => fmtDurationLong(Math.round(v))}
            tooltipLabel="Hold time"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.85)),
              max: (mx) => Math.round(mx * 1.15),
            }}
            caption={<Text style={s.tinyText}>Dashed line = personal best</Text>}
          />
        </AnimateRise>
      )}

      <EffortsHistorySection
        efforts={efforts}
        onDelete={onDelete}
        delay={500}
        renderLeft={e => (
          <Text style={s.listRowDate}>{fmtDate(e.created_at)}</Text>
        )}
        renderRight={e => {
          const secs = parseDurationSecs(e.value)
          return (
            <Text style={s.valBlue}>{fmtDurationLong(secs)}</Text>
          )
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AssistedMachineDetail
// ─────────────────────────────────────────────────────────────────────────────

// Locked design spec: MyRX/CLAUDE.md "Assisted Machine detail card — locked
// design spec". Mirrors the weighted-standard rep-max card visually with
// inverted assistance math:
//   effective_load = max(0, bodyweight − assistance)
//   effective_1RM  = estimate1RM(effective_load, reps)
//   projected_assistance(r) = max(0, bodyweight − projectAllRMs(best_eff_1RM)[r-1])
// Bodyweight gate: requires a log within the last 30 days; stale weight hides
// the projection + hero card and shows a CTA pointing at /(app)/bodyweight.
function AssistedMachineDetail({
  exercise, efforts, onDelete, hideHeader, outerScrollGesture,
}: {
  exercise: string
  efforts: Effort[]
  onDelete: (id: string) => void
  /** When true, suppresses the page-level header (BackButton + h1 +
   *  subtitle + equipment badge) because the FamilyConsolidatedDetail
   *  wrapper is already rendering one. Mirrors CarryDetail's prop. */
  hideHeader?: boolean
  /** Native gesture handle for an outer horizontal ScrollView (the
   *  FamilyConsolidatedDetail paged ScrollView). When provided, the
   *  inner adp-zone pill chains `.blocksExternalGesture(outerScrollGesture)`
   *  so the pill wins horizontal touches before the outer pager
   *  activates. Same L5 chain pattern as CarryDetail and weighted-
   *  standard. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerScrollGesture?: any
}) {
  const { user, profile } = useAuth()
  const displayUnit = (profile?.weight_unit as string) || 'lb'
  const incLb       = displayUnit === 'kg' ? 2.5 : 5

  // Bodyweight: { bwKg, isStale } | null. Fresh log < 30 d wins; profile.current_weight
  // falls back as stale (no recent log timestamp on the profile row itself).
  const [bwInfo, setBwInfo] = useState<{ bwKg: number; isStale: boolean } | null>(null)
  const [bwLoaded, setBwLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('bodyweight').select('weight, unit, created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (cancelled) return
        const row = (data?.[0] as { weight: number; unit: string; created_at: string } | undefined)
        const THIRTY_DAYS_MS = 30 * 86_400_000
        if (row && (Date.now() - new Date(row.created_at).getTime()) < THIRTY_DAYS_MS) {
          const rowKg = row.unit === 'lb' ? row.weight * 0.453592 : row.weight
          setBwInfo({ bwKg: rowKg, isStale: false })
        } else if (profile?.current_weight != null) {
          const pUnit = (profile.weight_unit as string) || 'lb'
          const pKg   = pUnit === 'lb' ? (profile.current_weight as number) * 0.453592 : (profile.current_weight as number)
          setBwInfo({ bwKg: pKg, isStale: true })
        } else {
          setBwInfo(null)
        }
        setBwLoaded(true)
      })
    return () => { cancelled = true }
  }, [user, profile?.current_weight, profile?.weight_unit])

  // Local selection state — names prefixed so they can't collide with the
  // weighted-standard state in the parent component.
  const [assistSelectedRM, setAssistSelectedRM]   = useState<number>(1)
  const [assistZoneInfoOpen, setAssistZoneInfoOpen] = useState(false)
  const assistTileScrollRef    = useRef<ScrollView | null>(null)
  const assistTileOffsets      = useRef<Record<number, number>>({})
  const assistTileWidths       = useRef<Record<number, number>>({})
  const [assistTileViewportW, setAssistTileViewportW] = useState(0)
  const assistTileScrollPosRef = useRef(0)
  const assistTileScrollAnimRef = useRef<{ cancelled: boolean } | null>(null)

  // Pan-swipe shared values for the adp-zone pill row (mirrors the weighted
  // standard card's pill choreography — the pill follows the finger, slides
  // off on commit, label updates, slides back from the opposite side).
  const assistPillTranslateX     = useSharedValue(0)
  const assistChevronOpacityOver = useSharedValue(1)

  // Custom rAF-based scroll animation. `ScrollView.scrollTo({ animated: true })`
  // on Android has a fixed-duration internal animator that feels too quick;
  // a JS-thread rAF over ~24 frames at 60Hz gives a more deliberate settle.
  function assistSmoothScrollTileTo(targetX: number, duration = 400) {
    if (assistTileScrollAnimRef.current) assistTileScrollAnimRef.current.cancelled = true
    const token = { cancelled: false }
    assistTileScrollAnimRef.current = token
    const start    = assistTileScrollPosRef.current
    const distance = targetX - start
    if (Math.abs(distance) < 1) return
    const startTime = Date.now()
    function step() {
      if (token.cancelled) return
      const elapsed = Date.now() - startTime
      const t       = Math.min(1, elapsed / duration)
      const eased   = 1 - Math.pow(1 - t, 3)
      const x       = start + distance * eased
      assistTileScrollRef.current?.scrollTo({ x, animated: false })
      assistTileScrollPosRef.current = x
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function assistScrollToZone(firstRepInZone: number) {
    setAssistZoneInfoOpen(false)
    setAssistSelectedRM(firstRepInZone)
    const offset   = assistTileOffsets.current[firstRepInZone] ?? 0
    const tileW    = assistTileWidths.current[firstRepInZone] ?? 68
    const centered = Math.max(0, offset - Math.max(0, (assistTileViewportW - tileW) / 2))
    assistSmoothScrollTileTo(centered, 600)
  }

  // Parse efforts → { assistance, unit, reps, ts, id }
  const parsed = efforts
    .map(e => {
      const p = parseAssistanceFromLabel(e.label)
      if (!p) return null
      const repsM = e.label.match(/×\s*(\d+)/)
      return { ...p, reps: repsM ? parseInt(repsM[1]) : null, ts: e.created_at, id: e.id }
    })
    .filter((p): p is { assistance: number; unit: string; reps: number | null; ts: string; id: string } => p !== null)

  const labelUnit = parsed[0]?.unit || displayUnit

  // Inverted assistance math — only meaningful with a non-stale bodyweight.
  const bwForMath     = bwInfo && !bwInfo.isStale ? bwInfo : null
  const bwInLabelUnit = bwForMath
    ? (labelUnit === 'kg' ? bwForMath.bwKg : bwForMath.bwKg / 0.453592)
    : null

  const bestEff1RM = bwForMath && bwInLabelUnit != null
    ? parsed
        .filter(p => p.reps && p.reps > 0)
        .reduce((max, p) => Math.max(max, estimate1RM(Math.max(0, bwInLabelUnit - p.assistance), p.reps as number)), 0)
    : 0

  const best1RMAssistance = bwInLabelUnit != null && bestEff1RM > 0
    ? Math.max(0, Math.round(bwInLabelUnit - bestEff1RM))
    : null

  const projections = bestEff1RM > 0 ? projectAllRMs(bestEff1RM, 1) : []
  const assistProjections = bwInLabelUnit != null && projections.length > 0
    ? projections.map(({ reps: r, weight: projEff }) => {
        const projAssist = Math.max(0, Math.round(bwInLabelUnit - projEff))
        const bwPct = bwInLabelUnit > 0 ? Math.round((projAssist / bwInLabelUnit) * 100) : 0
        return { reps: r, assistance: projAssist, bwPct }
      })
    : []

  const selZone    = adpZoneFor(assistSelectedRM)
  const selZoneCfg = ADP_ZONE_CONFIG[selZone]
  const selProj    = assistProjections.find(p => p.reps === assistSelectedRM) ?? null
  const selRepRange = assistSelectedRM

  // Hero "next training target" — must land on a valid pin slot (5 lb / 2.5 kg
  // increments) because assisted machines have fixed pin holes; the user can't
  // request 42 lb of help if the stack only stops at 40 / 45. Two cases:
  //   • Projection sits exactly on a pin → target = pin one increment lower
  //   • Projection lands between pins   → target = pin immediately below it
  // Floored at 0 so a fully-graduated projection renders as "0 lb assistance".
  const currentProjection = selProj?.assistance ?? 0
  const snappedDownPin    = Math.floor(currentProjection / incLb) * incLb
  const targetAssistance  = Math.abs(snappedDownPin - currentProjection) < 0.01
    ? Math.max(0, snappedDownPin - incLb)
    : Math.max(0, snappedDownPin)
  const targetBwPct       = bwInLabelUnit != null && bwInLabelUnit > 0
    ? Math.round((targetAssistance / bwInLabelUnit) * 100)
    : 0

  // Reliability warning: best effort had effective load < 25 % of BW
  // (machine was carrying > 75 %). Spec lives in CLAUDE.md.
  const reliabilityWarn = bwForMath && bwInLabelUnit != null && bwInLabelUnit > 0
    ? (bestEff1RM / bwInLabelUnit) < 0.25
    : false

  // Attempt-unassisted (graduation) cue — fires whenever the next reduction
  // would take the user to 0 lb assistance, i.e. the pin would come off the
  // stack. Driven by targetAssistance so the cue switches automatically: best
  // 1RM-assist of 5 lb (one pin above zero) → 1RM tile target = 0 → graduation.
  // Naturally limits to low rep ranges for most users since higher-rep tiles
  // require more assistance, but applies to ANY rep tile whose next pin is 0.
  const showAttemptUnassisted = targetAssistance === 0
  const bareName = exercise.startsWith('Assisted ')
    ? exercise.slice('Assisted '.length)
    : 'the unassisted version'

  // assistSelectedRM defaults to 1 (STRENGTH zone) on first render to match
  // WeightedStandardDetail's behaviour — that page also opens on 1RM regardless
  // of the user's logged reps. No auto-snap to bestReps on mount.

  // ── Zone pill swipe gesture + chevron-tap navigation ────────────────────
  const ASSIST_ZONE_ORDER: AdpZone[] = ['strength', 'hypertrophy', 'endurance']
  const ASSIST_FIRST_REP_OF_ZONE: Record<AdpZone, number> = { strength: 1, hypertrophy: 6, endurance: 13 }
  const ASSIST_SWIPE_THRESHOLD_PX = 20
  const ASSIST_SLIDE_OFFSCREEN_PX = 220
  const ASSIST_SLIDE_DURATION_MS  = 250
  const assistZoneIdx   = ASSIST_ZONE_ORDER.indexOf(selZone)
  const assistCanGoPrev = assistZoneIdx > 0
  const assistCanGoNext = assistZoneIdx >= 0 && assistZoneIdx < ASSIST_ZONE_ORDER.length - 1

  const triggerAssistPillSlide = (direction: -1 | 1, onMidPoint: () => void) => {
    assistChevronOpacityOver.value = withTiming(0, { duration: 120 })
    const slideOff = direction === 1 ? -ASSIST_SLIDE_OFFSCREEN_PX : ASSIST_SLIDE_OFFSCREEN_PX
    assistPillTranslateX.value = withTiming(slideOff, { duration: ASSIST_SLIDE_DURATION_MS }, (finished) => {
      'worklet'
      if (!finished) return
      runOnJS(onMidPoint)()
      assistPillTranslateX.value = -slideOff
      assistPillTranslateX.value = withTiming(0, { duration: ASSIST_SLIDE_DURATION_MS }, (settled) => {
        'worklet'
        if (settled) assistChevronOpacityOver.value = withTiming(1, { duration: 200 })
      })
    })
  }

  const navigateAssistZone = (direction: -1 | 1) => {
    const target = assistZoneIdx + direction
    if (target < 0 || target >= ASSIST_ZONE_ORDER.length) return
    const firstRep = ASSIST_FIRST_REP_OF_ZONE[ASSIST_ZONE_ORDER[target]]
    triggerAssistPillSlide(direction, () => assistScrollToZone(firstRep))
  }

  const onAssistTilePress = (rm: number) => {
    setAssistZoneInfoOpen(false)
    const newZone: AdpZone = adpZoneFor(rm)
    if (newZone === selZone) {
      setAssistSelectedRM(rm)
      return
    }
    const newIdx = ASSIST_ZONE_ORDER.indexOf(newZone)
    const direction: -1 | 1 = newIdx > assistZoneIdx ? 1 : -1
    triggerAssistPillSlide(direction, () => {
      setAssistSelectedRM(rm)
      const offset = assistTileOffsets.current[rm] ?? 0
      const tileW  = assistTileWidths.current[rm]  ?? 68
      const centered = Math.max(0, offset - Math.max(0, (assistTileViewportW - tileW) / 2))
      assistSmoothScrollTileTo(centered, 600)
    })
  }

  const assistPillSwipeGesture = useMemo(
    () => {
      // L5 activation tuning — same pattern as CarryDetail / weighted-
      // standard. When nested inside FamilyConsolidatedDetail's paged
      // ScrollView, use a LOW activeOffsetX (5px) and NO failOffsetY so
      // the inner Pan beats the outer pager to activation. Standalone
      // (no outer) keeps the original 15/25 thresholds.
      let g = Gesture.Pan()
      if (outerScrollGesture) {
        g = g.activeOffsetX([-5, 5])
        g = g.blocksExternalGesture(outerScrollGesture)
      } else {
        g = g.activeOffsetX([-15, 15])
        g = g.failOffsetY([-25, 25])
      }
      return g
        .onStart(() => {
          'worklet'
          assistChevronOpacityOver.value = withTiming(0, { duration: 120 })
        })
        .onUpdate((event) => {
          'worklet'
          assistPillTranslateX.value = event.translationX
        })
        .onEnd((event) => {
          'worklet'
          const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
          const allowed = direction === -1 ? assistCanGoPrev : assistCanGoNext
          const past    = Math.abs(event.translationX) > ASSIST_SWIPE_THRESHOLD_PX
          if (!past || !allowed) {
            assistPillTranslateX.value     = withTiming(0, { duration: 200 })
            assistChevronOpacityOver.value = withTiming(1, { duration: 200 })
            return
          }
          const slideOff = direction === 1 ? -ASSIST_SLIDE_OFFSCREEN_PX : ASSIST_SLIDE_OFFSCREEN_PX
          const targetIdx = assistZoneIdx + direction
          const targetFirstRep = ASSIST_FIRST_REP_OF_ZONE[ASSIST_ZONE_ORDER[targetIdx]]
          assistPillTranslateX.value = withTiming(slideOff, { duration: ASSIST_SLIDE_DURATION_MS }, (finished) => {
            'worklet'
            if (!finished) return
            runOnJS(assistScrollToZone)(targetFirstRep)
            assistPillTranslateX.value = -slideOff
            assistPillTranslateX.value = withTiming(0, { duration: ASSIST_SLIDE_DURATION_MS }, (settled) => {
              'worklet'
              if (settled) assistChevronOpacityOver.value = withTiming(1, { duration: 200 })
            })
          })
        })
        .onFinalize((_event, success) => {
          // L4 fix — cancelled gestures restore pill + chevrons.
          'worklet'
          if (!success) {
            assistPillTranslateX.value     = withTiming(0, { duration: 200 })
            assistChevronOpacityOver.value = withTiming(1, { duration: 200 })
          }
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assistZoneIdx, assistCanGoPrev, assistCanGoNext, assistTileViewportW, outerScrollGesture]
  )

  const assistPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: assistPillTranslateX.value }] }))

  // Inner tile-row scroll gesture — chains blocksExternalGesture on the
  // outer pager when present so horizontal scrolls inside the rep-max
  // tile row drive the row, not the outer pager.
  const assistTileRowInnerScrollGesture = useMemo(() => {
    let g = Gesture.Native()
    if (outerScrollGesture) g = g.blocksExternalGesture(outerScrollGesture)
    return g
  }, [outerScrollGesture])
  const assistChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: assistChevronOpacityOver.value }))

  const chartData = parsed.map(p => ({ ts: p.ts, y: p.assistance }))
  const bestAssistance = parsed.length > 0 ? Math.min(...parsed.map(p => p.assistance)) : null
  const showProjectionAndHero = bwLoaded && bwForMath != null && bestEff1RM > 0

  return (
    <View style={s.page}>
      {/* Header — suppressed when rendered as a slot inside
          FamilyConsolidatedDetail (hideHeader=true). The wrapper provides
          BackButton + parent-name h1 + family-wide subtitle + badge for
          the entire family page. */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{exercise}</Text>
        {best1RMAssistance != null ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best Est. 1RM — </Text>
            <TickerNumber value={best1RMAssistance} fontSize={14} color={palette.blue[400]} fontWeight="600" />
            <Text style={[s.subText, s.subValueBlue]}> {labelUnit} assist</Text>
          </View>
        ) : parsed.length === 0 ? (
          <Text style={s.subText}>No efforts logged yet</Text>
        ) : (
          <View style={s.subRow}>
            <Text style={s.subText}>Best Est. 1RM — </Text>
            <Text style={[s.subText, s.subValueBlue]}>— {labelUnit} assist</Text>
          </View>
        )}
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{equipmentPillLabel('assisted')}</Text>
        </View>
      </View>
      )}

      {/* Bodyweight gate — replaces projection + hero when bw is missing/stale */}
      {bwLoaded && !showProjectionAndHero && (
        <AnimateRise delay={0} style={s.assistBwGateCard}>
          <Text style={s.h2}>Recent bodyweight required</Text>
          <Text style={s.helpText}>
            We need a recent bodyweight to project assistance accurately. Please log your current weight.
          </Text>
          <Pressable
            onPress={() => router.push('/(app)/bodyweight' as any)}
            style={s.assistBwGateButton}
            accessibilityLabel="Log weight"
          >
            <Text style={s.assistBwGateButtonText}>Log weight</Text>
          </Pressable>
        </AnimateRise>
      )}

      {/* Reliability warning chip — best effort had effective load < 25 % BW */}
      {showProjectionAndHero && reliabilityWarn && (
        <AnimateRise delay={0} style={s.assistWarningChip}>
          <Text style={s.assistWarningChipText}>
            Heads up — your best effort had the machine carrying most of the load. Projections may be imprecise. Try a set with less assistance.
          </Text>
        </AnimateRise>
      )}

      {showProjectionAndHero && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Rep-max projections</Text>
          <Text style={[s.helpText, { marginTop: -6 }]}>Pick an adaptation zone, then tap a rep target.</Text>

          {/* Zone pill row with chevrons + swipe — mirrors the weighted-standard
              card's pill choreography. */}
          <GestureDetector gesture={assistPillSwipeGesture}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8, paddingVertical: 6 }}>
              <Animated.View style={[{ width: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }, assistChevronAnimatedStyle]}>
                {assistCanGoPrev && (
                  <Pressable
                    onPress={() => navigateAssistZone(-1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Previous zone"
                  >
                    <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>

              <Animated.View
                style={[
                  {
                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                    borderWidth: 1, borderColor: palette.blue[500],
                    backgroundColor: withAlpha(palette.blue[500], 0.15),
                  },
                  assistPillAnimatedStyle,
                ]}
              >
                <Text
                  style={{
                    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 0.5, color: palette.blue[400],
                  }}
                  numberOfLines={1}
                >
                  {ADP_ZONE_CONFIG[selZone].label}
                </Text>
              </Animated.View>

              <Animated.View style={[{ width: 56, flexDirection: 'row', alignItems: 'center' }, assistChevronAnimatedStyle]}>
                {assistCanGoNext && (
                  <Pressable
                    onPress={() => navigateAssistZone(1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Next zone"
                  >
                    <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Horizontal scrollable tile row, 1RM → 20RM. Wrapped in a
              GestureDetector that blocks the outer pager when nested
              inside FamilyConsolidatedDetail — without this, horizontal
              scrolls inside the tile row drive the outer pager instead
              of scrolling the tiles. */}
          <GestureDetector gesture={assistTileRowInnerScrollGesture}>
          <ScrollView
            ref={assistTileScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: 2 }}
            style={{ marginHorizontal: -2 }}
            onLayout={(e) => setAssistTileViewportW(e.nativeEvent.layout.width)}
            scrollEventThrottle={16}
            onScroll={(e) => { assistTileScrollPosRef.current = e.nativeEvent.contentOffset.x }}
          >
            {assistProjections.map(({ reps: r, assistance: a, bwPct }) => {
              const isSelected = assistSelectedRM === r
              return (
                <Pressable
                  key={r}
                  onPress={() => onAssistTilePress(r)}
                  onLayout={(e) => {
                    assistTileOffsets.current[r] = e.nativeEvent.layout.x
                    assistTileWidths.current[r]  = e.nativeEvent.layout.width
                  }}
                  style={{
                    minWidth: 68, paddingHorizontal: 12, paddingVertical: 10,
                    borderRadius: 9, borderWidth: 1,
                    borderColor: isSelected ? palette.blue[500] : colors.border,
                    backgroundColor: isSelected ? withAlpha(palette.blue[500], 0.15) : alpha(colors.card, 0.4),
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: isSelected ? palette.blue[400] : colors.mutedForeground,
                  }}>
                    {r}RM
                  </Text>
                  <View style={{ marginTop: 2 }}>
                    {/* Plain Text — tiles must NOT use TickerNumber (see same
                        rule comment on the weighted-standard tile below). */}
                    <Text style={{
                      fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
                      fontSize: 16, fontWeight: '700',
                      color: isSelected ? palette.blue[400] : colors.foreground,
                    }}>
                      {a}
                    </Text>
                  </View>
                  <Text style={{
                    marginTop: 2,
                    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
                    fontSize: 9,
                    color: isSelected ? withAlpha(palette.blue[400], 0.7) : alpha(colors.mutedForeground, 0.5),
                  }}>
                    {bwPct}% BW
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
          </GestureDetector>

          <Text style={s.tinyText}>Epley · Brzycki · Lombardi averaged · % of bodyweight</Text>

          {selProj && (
            <NextTargetCallout style={s.calloutWeighted}>
              {/* Adp-zone pill (top-right). Tap toggles inline info panel. */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={() => setAssistZoneInfoOpen((o) => !o)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 8, paddingVertical: 2,
                    borderRadius: 999, borderWidth: 1,
                    borderColor: withAlpha(palette.blue[500], 0.4),
                    backgroundColor: withAlpha(palette.blue[500], 0.1),
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: palette.blue[400] }} numberOfLines={1}>
                    {selZoneCfg.label}
                  </Text>
                  <Info size={11} color={palette.blue[400]} />
                </Pressable>
              </View>

              {/* Inline expandable adp zone info panel — direct-height-animation
                  (Pattern 5). The panel's real height grows/shrinks so sibling
                  content below reflows naturally through layout. */}
              <ExpandPanel open={assistZoneInfoOpen}>
                <View
                  style={{
                    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.15),
                    backgroundColor: alpha(colors.card, 0.6), borderRadius: 6,
                    paddingHorizontal: 10, paddingVertical: 8, marginTop: 4,
                  }}
                >
                  <Text style={[s.calloutLabel, { color: colors.foreground, fontWeight: '700', fontSize: 12, marginBottom: 4 }]}>
                    {selZoneCfg.label}
                  </Text>
                  <Text style={[s.tinyText, { lineHeight: 16 }]}>{selZoneCfg.whyText}</Text>
                </View>
              </ExpandPanel>

              {/* Big number + RHS "assist" label. */}
              <View>
                <View style={s.targetRow}>
                  <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                    <TickerNumber value={targetAssistance} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                    <Text style={s.calloutSubText}>{labelUnit}</Text>
                  </View>
                  <Text style={s.calloutSubText}>assist</Text>
                </View>

                {/* Single Target BW% chip. Tile shows the user's current
                    projection; hero shows the next reduction target. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8 }}>
                  <View style={s.plateChip}>
                    <Text style={s.plateChipText}>Target {targetBwPct}% BW</Text>
                  </View>
                </View>
              </View>

              {/* Thin separator + cue line. */}
              <View
                style={{
                  marginTop: 10, paddingTop: 10,
                  borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15),
                  gap: 2,
                }}
              >
                {showAttemptUnassisted ? (
                  selRepRange === 1 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>Attempt an unassisted </Text>
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontSize: 14 }}>{bareName}</Text>
                      <Text style={s.calloutLabel}> — you&apos;re ready.</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>Attempt </Text>
                      <TickerNumber value={selRepRange} fontSize={14} color={colors.foreground} fontWeight="700" />
                      <Text style={s.calloutLabel}> unassisted </Text>
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontSize: 14 }}>{bareName}s</Text>
                      <Text style={s.calloutLabel}> — you&apos;re ready.</Text>
                    </View>
                  )
                ) : selRepRange === 1 ? (
                  <>
                    <Text style={s.calloutLabel}>Hit one clean rep</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>with </Text>
                      <TickerNumber value={targetAssistance} fontSize={14} color={palette.blue[400]} fontWeight="700" />
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> {labelUnit}</Text>
                      <Text style={s.calloutLabel}> assistance</Text>
                    </View>
                    <Text style={s.tinyText}>Benchmark attempt</Text>
                  </>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>Do </Text>
                      <Text style={{ color: colors.foreground, fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}>{selZoneCfg.setsText}</Text>
                      <Text style={s.calloutLabel}> of </Text>
                      <TickerNumber value={selRepRange} fontSize={14} color={colors.foreground} fontWeight="700" />
                      <Text style={{ color: colors.foreground, fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> reps</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>with </Text>
                      <TickerNumber value={targetAssistance} fontSize={14} color={palette.blue[400]} fontWeight="700" />
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> {labelUnit}</Text>
                      <Text style={s.calloutLabel}> assistance</Text>
                    </View>
                    <Text style={s.tinyText}>Rest {selZoneCfg.restText} between sets</Text>
                  </>
                )}
              </View>
            </NextTargetCallout>
          )}
        </AnimateRise>
      )}

      {/* Gate chart + log on `bwLoaded` so they mount AT THE SAME TIME as
          the main card (which also waits for `bwLoaded`). Without this gate
          the chart/log render immediately on first paint (they only need
          `efforts`, already loaded), then animate in — while the main card
          waits for the async BW fetch and mounts ~200 ms later. Result:
          user sees chart BEFORE main, breaking the cascade order. */}
      {bwLoaded && chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Assistance over time</Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1 && bestAssistance !== null ? bestAssistance : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)} ${labelUnit}`}
            tooltipLabel="Assistance"
            yDomain={{
              min: () => 0,
              max: (mx) => Math.round(mx * 1.1),
            }}
            // Reversed so reducing assistance over time renders as the
            // line trending UP — visually consistent with every other
            // progression chart in the app (never "lower is better").
            reversed
            caption={<Text style={s.tinyText}>Dashed line = personal best</Text>}
          />
        </AnimateRise>
      )}

      {bwLoaded && (
        <EffortsHistorySection
          efforts={efforts}
          onDelete={onDelete}
          delay={500}
          renderLeft={e => {
            const repsM = e.label.match(/×\s*(\d+)/)
            const reps  = repsM ? parseInt(repsM[1]) : null
            return (
              <View>
                <Text style={s.listRowName}>{reps ? `${reps} rep${reps !== 1 ? 's' : ''}` : '—'}</Text>
                <Text style={s.listRowDateSm}>{fmtDate(e.created_at)}</Text>
              </View>
            )
          }}
        renderRight={e => {
          const p = parseAssistanceFromLabel(e.label)
          return (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.listRowSubLabel}>assistance</Text>
              <Text style={s.valBlue}>{p ? `${p.assistance} ${p.unit}` : '—'}</Text>
            </View>
          )
        }}
        />
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CarryDetail
// ─────────────────────────────────────────────────────────────────────────────

function CarryDetail({
  exercise, efforts, onDelete, displayName, extraHeaderContent, hideHeader,
  outerScrollGesture,
}: {
  exercise: string
  efforts: Effort[]
  onDelete: (id: string) => void
  /**
   * Optional override for the `<Text style={s.h1}>` title. When passed,
   * the header shows this instead of `exercise`. Used by SledDrag's
   * consolidated wrapper to render "Sled Work" as the title while the
   * internal `exercise` prop remains the variant-tagged name
   * ("Sled Work [Push]" / "Sled Work [Drag]") so benchmarks + label
   * parsing still work.
   */
  displayName?: string
  /**
   * Optional ReactNode injected at the END of the header block, AFTER
   * the equipment + tier badges. Used by SledDrag's consolidated wrapper
   * to render the PUSH | PULL variant-toggle pill row here, so the toggle
   * lives in the same visual cluster as the title + best subtitle.
   */
  extraHeaderContent?: React.ReactNode
  /**
   * When true, skip the entire header block (back button, h1, subtitle,
   * equipment badge, tier badge, extraHeaderContent). Used by
   * SledWorkConsolidatedDetail so the wrapper can render the page-level
   * header ONCE outside the paged ScrollView while each variant's body
   * (the rep-max projections card + hero + chart + log list) lives as a
   * sliding slot inside. Matches the BW consolidated-block pattern in
   * strength's main detail page.
   */
  hideHeader?: boolean
  /**
   * L5 fix — when this CarryDetail is rendered as a slot inside a paged
   * horizontal ScrollView (SledWorkConsolidatedDetail), the outer
   * ScrollView's native scroll intercepts horizontal swipes on the inner
   * adp-zone pill row before the inner Pan gesture can activate.
   *
   * The wrapper exposes its outer ScrollView as a `Gesture.Native()`
   * instance and passes it down here. The inner carry pill gesture chains
   * `.blocksExternalGesture(outerScrollGesture)` so when the inner Pan
   * activates (after 15 px of horizontal travel), the outer native scroll
   * is forced to fail. Doing this at the gesture-handler level — instead
   * of via React state + scrollEnabled — is the only way to win the race,
   * because the outer scroll claims the touch within the first frame and
   * React state updates always arrive too late to cancel it.
   *
   * No-op when CarryDetail is rendered standalone (Farmer's Carry, Yoke
   * Carry, etc.) and the prop is omitted.
   */
  outerScrollGesture?: ReturnType<typeof Gesture.Native>
}) {
  const { user, profile } = useAuth()
  // Look up the movement record so we can honour `unit_lock` (strongman / stone
  // carries always render in kg regardless of profile preference — see
  // CLAUDE.md "Mobile Mirror" section for the locked list).
  const dbMovementsForLock = useMovements()
  const carryMovementRecord = dbMovementsForLock.find(m => m.name === exercise) ?? null
  const unitLock = carryMovementRecord?.unit_lock as ('lb' | 'kg' | null | undefined)
  const displayUnit: 'lb' | 'kg' =
    unitLock === 'kg' || unitLock === 'lb'
      ? unitLock
      : ((profile?.weight_unit as string) === 'kg') ? 'kg' : 'lb'
  // Distance display unit: feet for lb users, meters for kg users by default.
  // profile.distance_unit stores 'km'/'mi' for cardio; not directly applicable
  // to carries, so this falls back to the weight-unit preference.
  const distUnit: 'm' | 'ft' = displayUnit === 'kg' ? 'm' : 'ft'

  const cfg     = carryBenchmarkFor(exercise)
  const isRatio = cfg.mode === 'ratio'

  // Weight step (lb / kg). Distance step (ft / m) — spec: 5 m or 10 ft.
  const wInc = displayUnit === 'kg' ? 2.5 : 5
  const dInc = distUnit === 'm' ? 5 : 10

  // ── Bodyweight gate (ratio mode only) ─────────────────────────────────────
  const [bwInfo, setBwInfo]     = useState<{ bwKg: number; isStale: boolean } | null>(null)
  const [bwLoaded, setBwLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('bodyweight').select('weight, unit, created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (cancelled) return
        const row = (data?.[0] as { weight: number; unit: string; created_at: string } | undefined)
        const THIRTY_DAYS_MS = 30 * 86_400_000
        if (row && (Date.now() - new Date(row.created_at).getTime()) < THIRTY_DAYS_MS) {
          const rowKg = row.unit === 'lb' ? row.weight * 0.453592 : row.weight
          setBwInfo({ bwKg: rowKg, isStale: false })
        } else if (profile?.current_weight != null) {
          const pUnit = (profile.weight_unit as string) === 'kg' ? 'kg' : 'lb'
          const pKg   = pUnit === 'lb' ? (profile.current_weight as number) * 0.453592 : (profile.current_weight as number)
          setBwInfo({ bwKg: pKg, isStale: true })
        } else {
          setBwInfo(null)
        }
        setBwLoaded(true)
      })
    return () => { cancelled = true }
  }, [user, profile?.current_weight, profile?.weight_unit])

  // Fresh bodyweight in lb (only meaningful for ratio mode). Abs mode skips
  // the gate entirely so we don't need this value for those movements.
  const bwForMath = bwInfo && !bwInfo.isStale ? bwInfo : null
  const bwLb = bwForMath ? bwForMath.bwKg / 0.453592 : null

  // ── State + refs (prefixed so they don't collide with sibling details) ────
  const [carrySelectedTier, setCarrySelectedTier] = useState<CarryTier | null>(null)
  const [carrySelZone,      setCarrySelZone]      = useState<CarryZone>('max_load')
  const [carryTierInfoOpen, setCarryTierInfoOpen] = useState(false)
  const [carryZoneInfoOpen, setCarryZoneInfoOpen] = useState(false)

  // ── Parse efforts → { ts, weight, unit, distM, id } ───────────────────────
  // `distM` is meters internally (labels store distance in meters); we convert
  // to display units only at render time.
  const parsed = efforts
    .map(e => {
      const p = parseCarryFromLabel(e.label)
      if (!p) return null
      return { ts: e.created_at, weight: p.weight, unit: p.unit, distM: p.dist, id: e.id }
    })
    .filter((p): p is { ts: string; weight: number; unit: string; distM: number; id: string } => p !== null)

  // ── Display helpers ───────────────────────────────────────────────────────
  // Effort weight in the user's display unit (lb or kg).
  const weightInDisplayUnit = (e: { weight: number; unit: string }): number => {
    if (e.unit === displayUnit) return e.weight
    if (e.unit === 'kg' && displayUnit === 'lb') return e.weight / 0.453592
    if (e.unit === 'lb' && displayUnit === 'kg') return e.weight * 0.453592
    return e.weight
  }
  // Effort distance in the user's display unit (m or ft).
  const distInDisplayUnit = (e: { distM: number }): number => distUnit === 'ft' ? e.distM / 0.3048 : e.distM
  const distMToDisplay    = (m: number): number => distUnit === 'ft' ? m / 0.3048 : m

  // Label unit fallback for the subtitle / hero (used only when there are no
  // efforts yet — first effort's unit overrides this once logged).
  const wUnit = displayUnit
  const dUnit = distUnit

  // ── Tier classification ───────────────────────────────────────────────────
  // For ratio mode we need bodyweight; if missing, currentTier stays null
  // and the ladder shows everything as locked.
  const currentTier = computeCarryTier(exercise, parsed, isRatio ? bwLb : null)
  const currentTierRank = currentTier ? CARRY_TIER_RANK[currentTier] : 0

  // Default-select the user's current tier on mount (or beginner if none).
  useEffect(() => {
    if (carrySelectedTier !== null) return
    setCarrySelectedTier(currentTier ?? 'beginner')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTier])

  // ── PB derivations ────────────────────────────────────────────────────────
  const bestWeight = parsed.length
    ? Math.round(Math.max(...parsed.map(weightInDisplayUnit)))
    : 0
  const bestDistDisplay = parsed.length
    ? Math.round(Math.max(...parsed.map(distInDisplayUnit)))
    : 0

  // ── Zone-aware targets, anchored on the user's actual PB ──────────────────
  // Each zone derives a (W_target, D_target) pair from the user's bestWeight +
  // bestDist, pushing ONE axis (or two for conditioning). The hero shows the
  // target alongside a delta vs. the user's best, so the prescription always
  // feels grounded in the user's own data.
  //
  //   MAX LOAD        — heavier weight, same distance:
  //                       W_target = ladder ? nextLadderAbove(bestWeight) ?? bestWeight
  //                                        : bestWeight + wInc
  //                       D_target = bestDist
  //
  //   DISTANCE BUILD  — same weight, longer distance:
  //                       W_target = bestWeight
  //                       D_target = bestDist + dInc
  //
  //   CONDITIONING    — lighter weight (60 % of best), double the distance:
  //                       W_raw    = bestWeight * 0.60
  //                       W_target = ladder ? snapDownToLadder(W_raw, ladder)
  //                                        : snapDownToInc(W_raw, wInc)
  //                       D_target = bestDist * 2
  //
  // Anchored on PB existence (bestWeight > 0 && bestDist > 0). When either is
  // missing we render the empty state for every zone.
  function snapDownToInc(value: number, inc: number): number {
    return Math.floor(value / inc) * inc
  }

  // The verb used in the cue line. "Carry" reads right for most carries
  // (Farmer's, Yoke, Atlas Stone Bear Hug, Husafell, etc.) but not for
  // sled work — you don't CARRY a sled, you PUSH it (Prowler) or
  // DRAG it (rope/harness). Per-movement override here keeps the cue
  // natural for each variant. Default = "Carry".
  function carryVerb(): string {
    if (exercise === 'Sled Work [Push]') return 'Push'
    if (exercise === 'Sled Work [Drag]') return 'Drag'
    return 'Carry'
  }
  const verb = carryVerb()

  // Floor for the conditioning weight when no ladder is defined. The
  // conditioning zone math is `bestWeight × 0.60` snapped down — for a
  // user with a low bestWeight (e.g. 10 lb), 60% = 6 lb snaps down to
  // 5 lb, but the carry wheel min is 10 lb / 5 kg. Prescribing a value
  // the user can't actually input is unactionable, so we floor at the
  // wheel min. Ladder movements handle this naturally via
  // `snapDownToLadder` (which already returns the lowest rung when
  // value < ladder[0]).
  const conditioningFloor = displayUnit === 'kg' ? 5 : 10

  interface CarryZoneMath {
    cfgZone:          CarryZoneCfg
    W_target:         number
    D_target:         number
    weightDeltaText:  string
    distDeltaText:    string
    hasTargets:       boolean
    cueLine:          string
  }

  // Per-zone math: one entry per zone so each slot in the swipe carousel
  // renders its own hero values. PB-anchored — each zone produces DIFFERENT
  // numbers (heavier/same, same/further, lighter/double).
  const zoneMath: Record<CarryZone, CarryZoneMath> = CARRY_ZONE_ORDER.reduce(
    (acc, zoneId) => {
      const cfgZone    = CARRY_ZONES[zoneId]
      const ladder     = carryLadderFor(exercise, displayUnit)
      const hasTargets = bestWeight > 0 && bestDistDisplay > 0

      let W_target = 0
      let D_target = 0
      switch (zoneId) {
        case 'max_load':
          W_target = ladder
            ? (nextLadderAbove(bestWeight, ladder) ?? bestWeight)
            : bestWeight + wInc
          D_target = bestDistDisplay
          break
        case 'distance_build':
          W_target = bestWeight
          D_target = bestDistDisplay + dInc
          break
        case 'conditioning':
        default: {
          const W_raw = bestWeight * 0.60
          const W_snapped = ladder
            ? snapDownToLadder(W_raw, ladder)
            : snapDownToInc(W_raw, wInc)
          // Clamp to the wheel's realistic minimum for non-ladder movements.
          // Without this clamp, a user with a 10 lb bestWeight would see a
          // conditioning prescription of 5 lb — which the carry log wheel
          // doesn't reach (min = 10 lb). Ladder movements floor naturally
          // via snapDownToLadder, so they don't need the clamp.
          W_target = ladder ? W_snapped : Math.max(W_snapped, conditioningFloor)
          D_target = bestDistDisplay * 2
          break
        }
      }

      // Delta vs. best — qualifier strings shown to the right of each row.
      const weightDeltaText = hasTargets
        ? (W_target > bestWeight
            ? `+ ${W_target - bestWeight} ${wUnit}`
            : W_target < bestWeight
              ? `− ${bestWeight - W_target} ${wUnit}`
              : 'same as your best')
        : ''
      const distDeltaText = hasTargets
        ? (D_target > bestDistDisplay
            ? `+ ${D_target - bestDistDisplay} ${dUnit}`
            : 'same as your best')
        : ''

      let cueLine: string
      if (!hasTargets) {
        cueLine = `Log your first ${verb.toLowerCase()} to see a target.`
      } else {
        switch (zoneId) {
          case 'max_load':
            cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — focus on grip and posture`
            break
          case 'distance_build':
            cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — maintain posture across the full distance`
            break
          case 'conditioning':
          default:
            cueLine = `${verb} ${W_target} ${wUnit} for ${D_target} ${dUnit} — control your breathing through the burn`
            break
        }
      }

      acc[zoneId] = { cfgZone, W_target, D_target, weightDeltaText, distDeltaText, hasTargets, cueLine }
      return acc
    },
    {} as Record<CarryZone, CarryZoneMath>,
  )

  // ── Tier ladder gating ────────────────────────────────────────────────────
  // Ratio movements need a fresh bodyweight to render the ladder + hero card.
  // Abs movements always render them.
  const showTierAndHero = isRatio ? (bwLoaded && bwForMath != null) : true
  const showBwGate      = isRatio && bwLoaded && !bwForMath

  // ── Tier description copy ─────────────────────────────────────────────────
  // For the info panel beneath the ladder. Threshold is per-tile per-movement.
  function tierCriteriaText(tier: CarryTier): string {
    const [threshold, minDistM] = cfg.tiers[tier]
    const minDistDisplay = Math.round(distMToDisplay(minDistM))
    if (cfg.mode === 'ratio') {
      const xLabel = `${threshold.toFixed(threshold % 1 === 0 ? 1 : 2)}× bodyweight`
      return `${CARRY_TIER_LABELS[tier]} — ${xLabel} per hand for at least ${minDistDisplay} ${dUnit}`
    }
    // Abs: convert threshold (kg) to display unit
    const thresholdDisplay = displayUnit === 'lb'
      ? Math.round(threshold / 0.453592)
      : threshold
    return `${CARRY_TIER_LABELS[tier]} — ${thresholdDisplay} ${wUnit} for at least ${minDistDisplay} ${dUnit}`
  }

  // Subtitle for the tier ladder card — describes the qualification rule.
  const beginnerMinDistDisplay = Math.round(distMToDisplay(cfg.tiers.beginner[1]))
  const tierLadderSubtitle = isRatio
    ? `Tiers based on weight × bodyweight at ≥ ${beginnerMinDistDisplay} ${dUnit} walked`
    : `Tiers based on absolute load at ≥ ${beginnerMinDistDisplay} ${dUnit} walked`

  // ── Zone pill swipe gesture + chevron-tap navigation ─────────────────────
  // The pill animates via `carryPillTranslateX` (slide-off → teleport → slide-in,
  // ~750 ms total). The hero card content scrolls via a horizontal ScrollView
  // (`carryZoneScrollRef`) — `navigateCarryZone` calls `scrollTo` programmatically
  // (animated:true) so the two animations fire in parallel from the same gesture
  // commit and APPEAR to swipe together. They are NOT bound to the same shared
  // value — this mirrors BW's pattern exactly.
  //
  // Pill choreography (Mirrors the bodyweight tier-swipe):
  //   onStart        → chevrons fade out (120 ms)
  //   onUpdate       → pill follows finger (translateX = translation)
  //   onEnd (commit) → pill slides off-screen (250 ms)
  //                    → navigateCarryZone() updates state (zone swap) AND
  //                      programmatically scrolls the hero ScrollView
  //                    → pill teleports to opposite side, slides back (250 ms)
  //                    → chevrons fade in (200 ms)
  //   onEnd (cancel) → pill bounces to 0 (200 ms), chevrons fade in (200 ms)
  const CARRY_SWIPE_THRESHOLD_PX = 20
  const CARRY_SLIDE_OFFSCREEN_PX = 220
  const CARRY_SLIDE_DURATION_MS  = 250
  const carryZoneIdx   = CARRY_ZONE_ORDER.indexOf(carrySelZone)
  const carryCanGoPrev = carryZoneIdx > 0
  const carryCanGoNext = carryZoneIdx >= 0 && carryZoneIdx < CARRY_ZONE_ORDER.length - 1

  const carryPillTranslateX        = useSharedValue(0)
  const carryChevronOpacityOverride = useSharedValue(1)

  // Hero ScrollView state — one slot per zone (3 slots total). Mirrors BW's
  // `bwTierScrollRef` + `slotWidth` + `bwInitialScrollDoneRef` setup.
  const carryZoneScrollRef = useRef<ScrollView | null>(null)
  const carryZoneInitialScrollDoneRef = useRef(false)
  // Pre-seed with the EXACT measured width of the slot's parent View, which
  // lives INSIDE an `s.card`: window − 16×2 page padding − 20×2 card padding
  // − 1×2 card border = window − 74. Getting this right matters because the
  // ScrollView is pagingEnabled — if slotWidth is too wide, two slots
  // overlap into one viewport and the user sees both at once. If too
  // narrow, the slot under-fills and shows a strip of empty viewport.
  // Same formula as TileGrid's fallback width.
  const carryWinWidth = useWindowDimensions().width
  const CARRY_PAGE_PADDING_HORIZONTAL = 16
  const CARRY_CARD_PADDING_HORIZONTAL = 20
  const CARRY_CARD_BORDER = 1
  const [slotWidth, setSlotWidth] = useState(Math.max(
    0,
    carryWinWidth
      - CARRY_PAGE_PADDING_HORIZONTAL * 2
      - CARRY_CARD_PADDING_HORIZONTAL * 2
      - CARRY_CARD_BORDER * 2,
  ))

  // The previous `carryLayoutAnimEnabled` first-paint gate is no longer needed:
  // the inline info panel now uses direct-height-animation (ExpandPanel) which
  // doesn't fight with the carry pager's slot-width measurement on first paint.
  // Tracks the slot index at the start of a manual drag so `onMomentumScrollEnd`
  // can clamp the result to ±1 (lock page swipe to a single page max).
  const dragStartIdxRef = useRef(0)

  // L4 "stuck mid-swipe" fallback — pagingEnabled's snap animation can be
  // interrupted on Android when the user swipes back and forth rapidly,
  // landing the ScrollView at a non-page-aligned offset (visibly stuck
  // mid-zone). onMomentumScrollEnd never fires in that case because momentum
  // is permanently cancelled. This timeout is armed in onScrollEndDrag and
  // disarmed in onMomentumScrollEnd; if it fires, we force a programmatic
  // scrollTo to the closest page boundary, which always lands cleanly even
  // when native paging glitches.
  const scrollSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (scrollSettleTimeoutRef.current) clearTimeout(scrollSettleTimeoutRef.current)
  }, [])

  // On first paint after the hero ScrollView measures itself, scroll to the
  // active zone's slot (default `max_load` = idx 0) without animation so the
  // page opens directly on the right slot. Mirrors BW's `bwInitialScrollDoneRef`
  // block.
  useEffect(() => {
    if (carryZoneInitialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!carryZoneScrollRef.current) return
    const idx = CARRY_ZONE_ORDER.indexOf(carrySelZone)
    if (idx < 0) return
    carryZoneScrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    carryZoneInitialScrollDoneRef.current = true
  }, [slotWidth, carrySelZone])

  const navigateCarryZone = (direction: -1 | 1) => {
    // Clamp to ±1 so swipe-velocity / programmatic drives can never skip past
    // a single zone (see CLAUDE.md "lock page swipe to one page maximum").
    const targetIdx = Math.max(0, Math.min(CARRY_ZONE_ORDER.length - 1, carryZoneIdx + direction))
    if (targetIdx === carryZoneIdx) return
    const targetZone = CARRY_ZONE_ORDER[targetIdx]
    setCarrySelZone(targetZone)
    setCarryZoneInfoOpen(false)
    // CRITICAL: refresh dragStartIdxRef to the CURRENT zone before the
    // programmatic scrollTo below. The hero ScrollView's onMomentumScrollEnd
    // clamps the landed slot to ±1 from `dragStartIdxRef.current` to prevent
    // velocity skips on USER drags — but the ref only updates via
    // `onScrollBeginDrag`, which never fires for programmatic scrolls. Without
    // this refresh, the clamp would compare the target (e.g. CONDITIONING,
    // idx 2) against the stale ref (e.g. 0 from initial mount), force the
    // result back to idx 1 (DISTANCE BUILD), and silently revert the pill
    // swipe the user just committed. The bug manifested as "pill swipes to
    // next zone, then immediately bounces back to the previous one".
    dragStartIdxRef.current = carryZoneIdx
    // Programmatically scroll the hero ScrollView in parallel with the pill's
    // slide animation. Mirrors BW's `navigateTier` calling scrollTo.
    if (slotWidth > 0 && carryZoneScrollRef.current) {
      carryZoneScrollRef.current.scrollTo({ x: targetIdx * slotWidth, animated: true })
    }
  }

  // Pan gesture + slide animation for the pill + hero — same shape as BW.
  //
  // L5 fix — `blocksExternalGesture(outerScrollGesture)` is the key chain
  // when this CarryDetail is rendered as a slot inside the Sled Work
  // consolidated wrapper. When the inner Pan activates (after 15 px of
  // horizontal travel), the outer pager's native scroll is forced to fail,
  // so the user's swipe drives the inner adp-zone pill instead of the
  // outer Push/Pull pager. No-op when the prop is omitted (standalone
  // Farmer's Carry, Yoke, etc.).
  //
  // L4 fix — `onFinalize` cleanup handles the "stuck mid-swipe" case
  // where the gesture is cancelled before onEnd fires (parent ScrollView
  // takes over, app backgrounded mid-pan, etc.). Without this, the pill
  // would stay wherever onUpdate last set it.
  const carryPillSwipeGesture = useMemo(
    () => {
      // activeOffsetX([-5, 5]) — very low threshold so the inner Pan beats
      // the outer Sled Work pager's native scroll to activation by a wide
      // margin. Once activated, `blocksExternalGesture(outerScrollGesture)`
      // forces the outer to fail.
      //
      // failOffsetY INTENTIONALLY OMITTED. A natural fast horizontal swipe
      // picks up some vertical drift, and a 25-px Y fail threshold caused
      // the inner Pan to abort BEFORE reaching its X-activation threshold —
      // the outer scroll then took over and the user's swipe drove the
      // outer pager instead of the inner pill. Removing the Y fail lets the
      // X-activation win; the only horizontal-eligible parent gesture above
      // us is the outer page swipe, which we explicitly block.
      //
      // `manualActivation(false)` — explicit default. We do NOT want manual
      // activation; gesture-handler should fire activation as soon as
      // activeOffsetX is crossed.
      let g = Gesture.Pan()
        .activeOffsetX([-5, 5])
      if (outerScrollGesture) {
        // blocksExternalGesture: when the inner activates, the outer scroll
        // is cancelled. simultaneousWithExternalGesture is NOT what we want
        // — that would let BOTH scroll at once (the outer would page AND
        // the pill would slide, which is jarring).
        g = g.blocksExternalGesture(outerScrollGesture)
      }
      return g
        .onStart(() => {
          'worklet'
          carryChevronOpacityOverride.value = withTiming(0, { duration: 120 })
        })
        .onUpdate((event) => {
          'worklet'
          carryPillTranslateX.value = event.translationX
        })
        .onEnd((event) => {
          'worklet'
          const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
          const directionAllowed = direction === -1 ? carryCanGoPrev : carryCanGoNext
          const past = Math.abs(event.translationX) > CARRY_SWIPE_THRESHOLD_PX

          if (!past || !directionAllowed) {
            // Bounce back; chevrons re-appear.
            carryPillTranslateX.value = withTiming(0, { duration: 200 })
            carryChevronOpacityOverride.value = withTiming(1, { duration: 200 })
            return
          }

          // Slide off → state change → teleport → slide in.
          const slideOff = direction === 1 ? -CARRY_SLIDE_OFFSCREEN_PX : CARRY_SLIDE_OFFSCREEN_PX
          carryPillTranslateX.value = withTiming(slideOff, { duration: CARRY_SLIDE_DURATION_MS }, (finished) => {
            'worklet'
            if (!finished) return
            runOnJS(navigateCarryZone)(direction)
            // Teleport to opposite side, then slide in.
            carryPillTranslateX.value = -slideOff
            carryPillTranslateX.value = withTiming(0, { duration: CARRY_SLIDE_DURATION_MS }, (settled) => {
              'worklet'
              if (settled) {
                carryChevronOpacityOverride.value = withTiming(1, { duration: 200 })
              }
            })
          })
        })
        .onFinalize((_event, success) => {
          'worklet'
          // If the gesture was cancelled before onEnd, restore pill + chevrons.
          // Without this, rapid back-and-forth swipes can leave translateX
          // stuck wherever onUpdate last set it (L4 stuck mid-swipe).
          if (!success) {
            carryPillTranslateX.value = withTiming(0, { duration: 200 })
            carryChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          }
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carryZoneIdx, carryCanGoPrev, carryCanGoNext, outerScrollGesture],
  )

  const carryPillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: carryPillTranslateX.value }],
  }))
  const carryChevronAnimatedStyle = useAnimatedStyle(() => ({
    opacity: carryChevronOpacityOverride.value,
  }))

  // ── Chart data (one series for weight, one for distance) ─────────────────
  // Mobile LineChart is single-axis, so we render two stacked charts to keep
  // parity with the web's dual-axis layout without adding new chart deps.
  const weightChartData = parsed.map(e => ({ ts: e.ts, y: Math.round(weightInDisplayUnit(e)) }))
  const distChartData   = parsed.map(e => ({ ts: e.ts, y: Math.round(distInDisplayUnit(e)) }))

  // ── Render ────────────────────────────────────────────────────────────────
  const tierBadge = currentTier ? CARRY_TIER_LABELS[currentTier] : null

  return (
    <View style={s.page}>
      {/* ── Header ──
          When `displayName` is passed (used by SledWorkConsolidatedDetail),
          the h1 shows that instead of `exercise` so the title can be
          "Sled Work" while internal logic still works with the variant-
          tagged name "Sled Work [Push]" / "Sled Work [Drag]".
          `extraHeaderContent` lets the wrapper inject the PUSH | PULL
          variant-toggle pill row right after the badges.
          When `hideHeader` is true, the entire block is skipped — the
          consolidated wrapper renders its own header above the paged
          ScrollView so it stays static while the body slides between
          variants. */}
      {!hideHeader && (
        <View>
          <BackButton />
          <Text style={s.h1}>{displayName ?? exercise}</Text>
          {parsed.length === 0 ? (
            <Text style={s.subText}>No efforts logged yet</Text>
          ) : (
            <View style={s.subRow}>
              <Text style={s.subText}>Best — </Text>
              <TickerNumber value={bestWeight} fontSize={14} color={palette.blue[400]} fontWeight="600" />
              <Text style={[s.subText, s.subValueBlue]}> {wUnit}</Text>
              <Text style={s.subText}> · </Text>
              <TickerNumber value={bestDistDisplay} fontSize={14} color={palette.blue[400]} fontWeight="600" />
              <Text style={[s.subText, s.subValueBlue]}> {dUnit}</Text>
            </View>
          )}
          <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
            <Text style={s.carryTierBadgeText}>{equipmentPillLabel('carry')}</Text>
          </View>
          {tierBadge && (
            <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
              <Text style={s.carryTierBadgeText}>{tierBadge}</Text>
            </View>
          )}
          {extraHeaderContent}
        </View>
      )}

      {/* ── Bodyweight gate (ratio mode, no fresh log) ── */}
      {showBwGate && (
        <AnimateRise delay={0} style={s.assistBwGateCard}>
          <Text style={s.h2}>Recent bodyweight required</Text>
          <Text style={s.helpText}>
            We need a recent bodyweight to compute your strongman tier accurately. Please log your current weight.
          </Text>
          <Pressable
            onPress={() => router.push('/(app)/bodyweight' as any)}
            style={s.assistBwGateButton}
            accessibilityLabel="Log weight"
          >
            <Text style={s.assistBwGateButtonText}>Log weight</Text>
          </Pressable>
        </AnimateRise>
      )}

      {/* ── Zone pill row + hero card ──
          The user's strongman tier is already shown as a chip in the header
          subtitle. The tier criteria description that used to live on a
          standalone ladder card now lives here as the secondary subtitle. */}
      {showTierAndHero && (
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Adaptation zone</Text>
          <Text style={[s.helpText, { marginTop: -6 }]}>Pick a training focus, then aim at the next target.</Text>
          <Text style={[s.tinyText, { marginBottom: 8 }]}>{tierLadderSubtitle}.</Text>

          {/* Zone pill row with chevrons + swipe — the pill animates via
              `carryPillAnimatedStyle` (translateX shared value). The hero
              card below is a separate horizontal ScrollView; the two
              animations fire in parallel from the same gesture commit
              (`navigateCarryZone` calls scrollTo on the ScrollView) so they
              APPEAR to swipe together but are NOT bound to the same shared
              value. Mirrors BW's pattern exactly. Chevron tap and pill-row
              pan both funnel through `navigateCarryZone`, which swaps
              `carrySelZone` during the off-screen phase of the slide. The
              ±1 clamp in `navigateCarryZone` ensures a hard swipe can never
              skip past a single zone. */}
          <GestureDetector gesture={carryPillSwipeGesture}>
            <View style={s.carryZoneRow}>
              {/* Left chevrons — wrapped in Animated.View so the swipe gesture
                  can fade them out / in around the slide-off / slide-in. */}
              <Animated.View style={[s.carryZoneChevronSlotLeft, carryChevronAnimatedStyle]}>
                {carryCanGoPrev && (
                  <Pressable
                    onPress={() => navigateCarryZone(-1)}
                    style={s.carryZoneChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Previous zone"
                  >
                    <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>

              {/* Active pill — translates with the user's finger during a pan,
                  slides off / back on commit. Mirrors BW's pillAnimatedStyle. */}
              <Animated.View style={carryPillAnimatedStyle}>
                <View style={s.carryZonePill} accessibilityLabel="Current adaptation zone">
                  <Text style={s.carryZonePillText} numberOfLines={1}>
                    {CARRY_ZONES[carrySelZone].label}
                  </Text>
                </View>
              </Animated.View>

              {/* Right chevrons — same fade override as left. */}
              <Animated.View style={[s.carryZoneChevronSlotRight, carryChevronAnimatedStyle]}>
                {carryCanGoNext && (
                  <Pressable
                    onPress={() => navigateCarryZone(1)}
                    style={s.carryZoneChevronPressable}
                    hitSlop={8}
                    accessibilityLabel="Next zone"
                  >
                    <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Hero card — horizontal ScrollView with one slot per zone. The
              pill animation (above) and the ScrollView's scroll position are
              two separate animations driven from the same gesture commit:
              `navigateCarryZone` updates `carrySelZone` AND calls scrollTo on
              this ScrollView while the pill slides off / back. The user sees
              both move together. Mirrors BW's `bwTierScrollRef` pattern. */}
          <View onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}>
            <ScrollView
              ref={carryZoneScrollRef}
              horizontal
              pagingEnabled
              // L4 fix — disableIntervalMomentum + snapToInterval gives the
              // hero ScrollView stricter page-boundary snapping than plain
              // pagingEnabled. Without these, rapid back-and-forth swipes
              // on Android can leave the offset mid-page because pagingEnabled's
              // native snap animation gets cancelled by the next drag before it
              // completes. Together with the onScrollEndDrag settle-fallback
              // below, the hero is guaranteed to land on a page boundary.
              disableIntervalMomentum
              snapToInterval={slotWidth > 0 ? slotWidth : undefined}
              snapToAlignment="start"
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              onScrollBeginDrag={() => {
                if (scrollSettleTimeoutRef.current) {
                  clearTimeout(scrollSettleTimeoutRef.current)
                  scrollSettleTimeoutRef.current = null
                }
                dragStartIdxRef.current = carryZoneIdx
              }}
              onScrollEndDrag={e => {
                // L4 fallback — arm a settle timeout in case onMomentumScrollEnd
                // never fires (rapid swipes can permanently cancel native momentum).
                // After 350ms the page is forcibly snapped to the closest valid
                // slot. Disarmed by the next onScrollBeginDrag or onMomentumScrollEnd.
                if (slotWidth === 0) return
                const endX = e.nativeEvent.contentOffset.x
                if (scrollSettleTimeoutRef.current) clearTimeout(scrollSettleTimeoutRef.current)
                scrollSettleTimeoutRef.current = setTimeout(() => {
                  if (!carryZoneScrollRef.current) return
                  const rawIdx = Math.round(endX / slotWidth)
                  const start = dragStartIdxRef.current
                  let idx = rawIdx
                  if (idx > start + 1) idx = start + 1
                  if (idx < start - 1) idx = start - 1
                  if (idx < 0) idx = 0
                  if (idx > CARRY_ZONE_ORDER.length - 1) idx = CARRY_ZONE_ORDER.length - 1
                  carryZoneScrollRef.current.scrollTo({ x: idx * slotWidth, animated: true })
                  const z = CARRY_ZONE_ORDER[idx]
                  if (z && z !== carrySelZone) {
                    setCarrySelZone(z)
                    setCarryZoneInfoOpen(false)
                  }
                }, 350)
              }}
              onMomentumScrollEnd={e => {
                if (scrollSettleTimeoutRef.current) {
                  clearTimeout(scrollSettleTimeoutRef.current)
                  scrollSettleTimeoutRef.current = null
                }
                if (slotWidth === 0) return
                const x = e.nativeEvent.contentOffset.x
                const rawIdx = Math.round(x / slotWidth)
                const start = dragStartIdxRef.current
                // Clamp to ±1 from drag-start so a hard swipe can never skip past
                // a single zone (lock page swipe to one page max).
                let idx = rawIdx
                if (idx > start + 1) idx = start + 1
                if (idx < start - 1) idx = start - 1
                const z = CARRY_ZONE_ORDER[idx]
                if (z && z !== carrySelZone) {
                  setCarrySelZone(z)
                  setCarryZoneInfoOpen(false)
                }
                // If we clamped OR landed at a non-integer offset, animate to
                // the corrected slot so the visible page lines up with the new
                // state. The integer-offset reconciliation is the L4 "stuck
                // mid-swipe" defence at the momentum-end stage.
                const expectedX = idx * slotWidth
                if (carryZoneScrollRef.current && Math.abs(x - expectedX) > 1) {
                  carryZoneScrollRef.current.scrollTo({ x: expectedX, animated: true })
                }
              }}
            >
              {CARRY_ZONE_ORDER.map(zoneId => {
                const zm = zoneMath[zoneId]
                const isActiveSlot = zoneId === carrySelZone
                return (
                  <View key={zoneId} style={{ width: slotWidth }}>
                    <View style={s.calloutWeighted}>
                      <NextTargetCallout>
                        {/* Adp-zone pill (top-right). Tap toggles the inline info panel.
                            Only the active slot's panel is interactable. */}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                          <Pressable
                            onPress={() => setCarryZoneInfoOpen((o) => !o)}
                            style={s.carryZoneInfoPillButton}
                          >
                            <Text style={s.carryZoneInfoPillText} numberOfLines={1}>
                              {zm.cfgZone.label}
                            </Text>
                            <Info size={11} color={palette.blue[400]} />
                          </Pressable>
                        </View>

                        {/* Inline expandable zone info panel — only on active slot.
                            Direct-height-animation (Pattern 5): sibling rows below
                            reflow through layout when this panel grows/shrinks. */}
                        <ExpandPanel open={isActiveSlot && carryZoneInfoOpen}>
                          <View style={s.carryHeroZoneInfoPanel}>
                            <Text style={s.carryHeroZoneInfoTitle}>{zm.cfgZone.label}</Text>
                            <Text style={s.carryHeroZoneInfoBody}>{zm.cfgZone.whyText}</Text>
                          </View>
                        </ExpandPanel>

                        {zm.hasTargets ? (
                          <View style={{ gap: 12 }}>
                            {/* Weight row — W_target with delta vs. best on the right */}
                            <View style={s.carryHeroDualRow}>
                              <View style={s.calloutValueRow}>
                                <TickerNumber value={zm.W_target} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                <Text style={s.calloutSubText}>{wUnit}</Text>
                              </View>
                              <Text style={s.carryHeroDualSubLabel}>
                                {zm.weightDeltaText}
                              </Text>
                            </View>
                            {/* Distance row — D_target with delta vs. best on the right */}
                            <View style={s.carryHeroDualRow}>
                              <View style={s.calloutValueRow}>
                                <TickerNumber value={zm.D_target} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                                <Text style={s.calloutSubText}>{dUnit}</Text>
                              </View>
                              <Text style={s.carryHeroDualSubLabel}>
                                {zm.distDeltaText}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={s.calloutSubText}>No qualifying efforts in this zone yet.</Text>
                        )}

                        {/* Thin separator + cue line. */}
                        <View style={s.carryHeroCueRow}>
                          <Text style={s.carryHeroCueText}>{zm.cueLine}</Text>
                        </View>
                      </NextTargetCallout>
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </AnimateRise>
      )}

      {/* ── Weight chart ──
          Gated on `isRatio ? bwLoaded : true` so for ratio movements the
          chart waits for the BW fetch to complete alongside the main card.
          Without this gate the chart renders immediately on first paint
          (efforts are already loaded), animates in, and appears BEFORE the
          main card which is still waiting for `bwLoaded`. Abs movements
          (Atlas Stone, etc.) don't need bw so the chart renders normally. */}
      {(isRatio ? bwLoaded : true) && weightChartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Carry progress over time</Text>
          <View style={s.chartTagBlue}>
            <Text style={s.chartTagText}>Weight</Text>
          </View>
          <LineChart
            data={weightChartData}
            referenceY={weightChartData.length > 1 && bestWeight > 0 ? bestWeight : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)} ${wUnit}`}
            tooltipLabel="Weight"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.85)),
              max: (mx) => Math.round(mx * 1.15),
            }}
            caption={<Text style={s.tinyText}>Dashed line = personal best weight</Text>}
          />
          <View style={s.chartTagBlue}>
            <Text style={s.chartTagText}>Distance</Text>
          </View>
          <LineChart
            data={distChartData}
            referenceY={distChartData.length > 1 && bestDistDisplay > 0 ? bestDistDisplay : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)} ${dUnit}`}
            tooltipLabel="Distance"
            lineColor={withAlpha(palette.blue[400], 0.85)}
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.85)),
              max: (mx) => Math.round(mx * 1.15),
            }}
            caption={<Text style={s.tinyText}>Dashed line = personal best distance</Text>}
          />
        </AnimateRise>
      )}

      {/* ── Efforts history ──
          Gated on isRatio ? bwLoaded : true for the same cascade-ordering
          reason as the chart above. */}
      {(isRatio ? bwLoaded : true) && (
      <EffortsHistorySection
        efforts={efforts}
        onDelete={onDelete}
        delay={500}
        renderLeft={e => {
          const p = parseCarryFromLabel(e.label)
          const dDisplay = p
            ? Math.round(distUnit === 'ft' ? p.dist / 0.3048 : p.dist)
            : null
          return (
            <View>
              <Text style={s.listRowName}>
                {p ? `${p.weight} ${p.unit} × ${dDisplay} ${dUnit}` : '—'}
              </Text>
              <Text style={s.listRowDateSm}>{fmtDate(e.created_at)}</Text>
            </View>
          )
        }}
        renderRight={e => {
          const p = parseCarryFromLabel(e.label)
          // Sled Work entries get their variant ("push" / "drag") as the
          // small label so the user can tell which side each historical
          // effort came from when both variants are shown in the same list.
          // Other carries (Farmer's, Yoke, Atlas Stone, etc.) keep the
          // generic "carry" label since they have no variants.
          const head = e.label.split(' · ')[0] ?? ''
          let subLabel = 'carry'
          if (head === 'Sled Work [Push]') subLabel = 'push'
          else if (head === 'Sled Work [Drag]') subLabel = 'drag'
          return (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.listRowSubLabel}>{subLabel}</Text>
              <Text style={s.valBlue}>{p ? `${p.weight} ${p.unit}` : '—'}</Text>
            </View>
          )
        }}
      />
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SledWorkConsolidatedDetail
//
// Sled Work has two parallel variants stored as separate movements:
// `Sled Work [Push]` and `Sled Work [Drag]`. They're biomechanically
// different (Push = leg-dominant Prowler-style; Pull = posterior-chain
// dominant) but use the same equipment and follow the same Carry detail
// page model. This wrapper:
//   1. Renders a PUSH | PULL segmented toggle in the header.
//   2. Filters the combined efforts list to whichever variant is active.
//   3. Delegates the actual page render to CarryDetail with a tagged
//      `exercise` prop (so CARRY_BENCHMARKS / label parsing still works)
//      plus the `displayName="Sled Work"` override (so the h1 reads as
//      the base name) and `extraHeaderContent` for the toggle pills.
// ─────────────────────────────────────────────────────────────────────────────

function SledWorkConsolidatedDetail({
  efforts, onDelete,
}: { efforts: Effort[]; onDelete: (id: string) => void }) {
  type SledVariant = 'push' | 'drag'
  // Canonical slot order (LEFT → RIGHT). The filtered list below preserves
  // this relative order while dropping any variant the user hasn't logged.
  const SLED_VARIANT_ALL: readonly SledVariant[] = ['push', 'drag'] as const

  const variantOf = (label: string): SledVariant | null => {
    const head = label.split(' · ')[0]
    if (head === 'Sled Work [Push]') return 'push'
    if (head === 'Sled Work [Drag]') return 'drag'
    return null
  }

  // Pre-filter efforts per variant once so each slot inside the paged
  // ScrollView just looks up its own list. CarryDetail does its own
  // parsing on this filtered list.
  const effortsByVariant = useMemo(() => {
    const map: Record<SledVariant, Effort[]> = { push: [], drag: [] }
    efforts.forEach(e => {
      const v = variantOf(e.label)
      if (v) map[v].push(e)
    })
    return map
  }, [efforts])

  // Only render variants the user has actually logged. If the user deletes
  // every Push effort, the PUSH pill and Push slot disappear; the page
  // collapses to just the Drag side. If both have efforts, both render.
  // If neither has efforts, the consolidated row wouldn't have shown up
  // in the strength index in the first place, so this never reaches an
  // empty render path — but we guard with a fallback anyway so a freshly
  // deleted "last effort" state doesn't crash.
  const SLED_VARIANT_ORDER = useMemo(
    () => SLED_VARIANT_ALL.filter(v => effortsByVariant[v].length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effortsByVariant],
  )

  // Default active variant = ALWAYS slot 0 (leftmost) of the FILTERED list
  // — so when the user deletes all Push entries, the page opens on Drag
  // (the only remaining variant). Universal rule across every consolidated
  // carousel in the app (BW assist tiers, Swimming strokes, Sled Work).
  // See CLAUDE.md Pattern 4 — Most-recent-variant logic was rejected
  // because it produced surprising "page opens on the right side" behaviour.
  const defaultVariant: SledVariant = SLED_VARIANT_ORDER[0] ?? SLED_VARIANT_ALL[0]

  const [activeVariant, setActiveVariant] = useState<SledVariant>(defaultVariant)

  // If the active variant disappears (user deletes its last effort while
  // viewing it), snap to the new slot 0 AND scroll the shell back to the
  // top so the user sees the new variant's header — without this, they'd
  // stay scrolled to wherever the deleted effort lived in the list, and
  // wouldn't see the page is now showing DRAG (or PUSH). Skipped on
  // initial mount because defaultVariant is already correct.
  useEffect(() => {
    if (!SLED_VARIANT_ORDER.includes(activeVariant)) {
      const fallback = SLED_VARIANT_ORDER[0] ?? SLED_VARIANT_ALL[0]
      setActiveVariant(fallback)
      scrollShellToTop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SLED_VARIANT_ORDER])

  // ── Paged ScrollView — the "whole page slides" pattern ──────────────────
  // Two slots, one per variant. CarryDetail's body content (rep-max
  // projections, hero, chart, log) lives inside each slot; the wrapper
  // renders the static page-level header (h1 + pill row) above.
  //
  // slotWidth pre-seed: the ScrollView wrapper below uses
  // `marginHorizontal: -PAGE_PADDING_HORIZONTAL` to bleed the slots edge-
  // to-edge, so its measured width is `windowWidth` (the full screen),
  // NOT `windowWidth − page padding`. Pre-seeding with `winWidth` matches
  // what onLayout eventually measures, so the initial scrollTo lands
  // exactly on the active slot's boundary. The BW consolidated block uses
  // `winWidth - 32` instead because it doesn't bleed edge-to-edge — its
  // wrapper sits inside the normal page padding. See CLAUDE.md Pattern 4
  // "slotWidth handling" for the rule.
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  const [slotWidth, setSlotWidth] = useState(winWidth)

  const scrollRef = useRef<ScrollView>(null)

  // L5 fix — expose the outer pager's native scroll as a Gesture.Native()
  // so the inner carry pill's Pan can chain `blocksExternalGesture` on it.
  // When the inner Pan activates (after 15 px of horizontal travel), the
  // outer scroll is forced to fail and the user's swipe drives the inner
  // adp-zone pill instead of the Push/Pull pager. Passed down as the
  // `outerScrollGesture` prop on each CarryDetail slot.
  //
  // Memoised so the gesture identity is stable across renders — re-creating
  // it would force gesture-handler to re-attach every frame, which can drop
  // touches mid-swipe.
  const outerScrollGesture = useMemo(() => Gesture.Native(), [])

  // Initial scroll to the default variant's slot (avoids landing on slot 0
  // when the user's most-recent variant is "pull"). Runs once per mount.
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!scrollRef.current) return
    const idx = SLED_VARIANT_ORDER.indexOf(activeVariant)
    if (idx < 0) return
    scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    initialScrollDoneRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWidth])

  // Direction-aware variant navigation. Used by chevron Pressables AND by
  // the pill Pan gesture (via runOnJS). State change + programmatic
  // scrollTo are bundled so the pill animation and body slide stay in
  // sync (BW's pattern).
  const navigateVariant = (direction: -1 | 1) => {
    const currentIdx = SLED_VARIANT_ORDER.indexOf(activeVariant)
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= SLED_VARIANT_ORDER.length) return
    setActiveVariant(SLED_VARIANT_ORDER[newIdx])
    if (slotWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })
    }
  }

  // Pill swipe + slide animation — same shape as the BW tier pill
  // choreography (and the Swimming stroke wrapper).
  const SLED_SWIPE_THRESHOLD_PX = 20
  const SLED_SLIDE_OFFSCREEN_PX = 220
  const SLED_SLIDE_DURATION_MS  = 250

  const sledPillTranslateX        = useSharedValue(0)
  const sledChevronOpacityOverride = useSharedValue(1)

  const sledPillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        sledChevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        sledPillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > SLED_SWIPE_THRESHOLD_PX
        const currentIdx = SLED_VARIANT_ORDER.indexOf(activeVariant)
        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < SLED_VARIANT_ORDER.length

        if (!past || !validDirection) {
          // Bounce back to centre; chevrons re-appear.
          sledPillTranslateX.value = withTiming(0, { duration: 200 })
          sledChevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }

        // Slide off, flip variant (also scrolls the paged ScrollView via
        // navigateVariant), teleport, slide back in.
        const slideOff = direction === 1 ? -SLED_SLIDE_OFFSCREEN_PX : SLED_SLIDE_OFFSCREEN_PX
        sledPillTranslateX.value = withTiming(slideOff, { duration: SLED_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateVariant)(direction)
          sledPillTranslateX.value = -slideOff
          sledPillTranslateX.value = withTiming(0, { duration: SLED_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) {
              sledChevronOpacityOverride.value = withTiming(1, { duration: 200 })
            }
          })
        })
      })
      .onFinalize((_event, success) => {
        'worklet'
        // L4-style safety net — if the gesture cancels before onEnd (vertical
        // scroll takes over, app backgrounded mid-pan, etc.), restore the
        // pill + chevrons. Without this, the pill can stay wherever onUpdate
        // last set it after a cancelled rapid swipe.
        if (!success) {
          sledPillTranslateX.value = withTiming(0, { duration: 200 })
          sledChevronOpacityOverride.value = withTiming(1, { duration: 200 })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeVariant, slotWidth],
  )

  const sledPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: sledPillTranslateX.value }] }))
  const sledChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: sledChevronOpacityOverride.value }))

  const currentIdx = SLED_VARIANT_ORDER.indexOf(activeVariant)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx < SLED_VARIANT_ORDER.length - 1

  // ── Page-level "Best —" subtitle for the active variant ──────────────────
  // Mirrors Atlas Stone Bear Hug Carry's "Best — N kg · M m" subtitle (with
  // the same unit-aware display logic). Re-derives every render when
  // activeVariant changes so the subtitle ticker-rolls as the user swipes
  // between PUSH and DRAG. The CARRY equipment pill below it identifies
  // the movement category just like every other strength detail page.
  const { profile: sledProfile } = useAuth()
  const sledDisplayUnit: 'lb' | 'kg' =
    ((sledProfile?.weight_unit as string) === 'kg') ? 'kg' : 'lb'
  const sledDistUnit: 'm' | 'ft' = sledDisplayUnit === 'kg' ? 'm' : 'ft'
  const sledActiveParsed = useMemo(() => {
    const list = effortsByVariant[activeVariant] ?? []
    return list.map(e => {
      const p = parseCarryFromLabel(e.label)
      if (!p) return null
      // Convert weight to display unit
      let w = p.weight
      if (p.unit === 'kg' && sledDisplayUnit === 'lb') w = p.weight / 0.453592
      else if (p.unit === 'lb' && sledDisplayUnit === 'kg') w = p.weight * 0.453592
      // distance is stored as meters; convert to ft if needed
      const d = sledDistUnit === 'ft' ? p.dist / 0.3048 : p.dist
      return { w, d }
    }).filter((x): x is { w: number; d: number } => x !== null)
  }, [effortsByVariant, activeVariant, sledDisplayUnit, sledDistUnit])
  const sledBestWeight = sledActiveParsed.length ? Math.round(Math.max(...sledActiveParsed.map(p => p.w))) : 0
  const sledBestDist   = sledActiveParsed.length ? Math.round(Math.max(...sledActiveParsed.map(p => p.d))) : 0
  const sledHasBest    = sledBestWeight > 0 && sledBestDist > 0

  return (
    <View style={s.page}>
      {/* Page-level header — h1 + subtitle + equipment pill + pill row, all
          STATIC during swipes. The subtitle ticker-rolls (digit-only
          animation) when the user swipes between PUSH and DRAG to reflect
          the active variant's best weight × distance. CarryDetail's
          per-variant subtitle inside each slot is hidden via the
          `hideHeader` prop, so the page-level subtitle here is the only
          one the user sees. */}
      <View>
        <BackButton />
        <Text style={s.h1}>Sled Work</Text>
        {sledHasBest ? (
          <View style={s.subRow}>
            <Text style={s.subText}>Best — </Text>
            <TickerNumber value={sledBestWeight} fontSize={14} color={palette.blue[400]} fontWeight="600" />
            <Text style={[s.subText, s.subValueBlue]}> {sledDisplayUnit}</Text>
            <Text style={s.subText}> · </Text>
            <TickerNumber value={sledBestDist} fontSize={14} color={palette.blue[400]} fontWeight="600" />
            <Text style={[s.subText, s.subValueBlue]}> {sledDistUnit}</Text>
          </View>
        ) : (
          <Text style={s.subText}>No {activeVariant === 'push' ? 'push' : 'drag'} efforts logged yet</Text>
        )}
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{equipmentPillLabel('carry')}</Text>
        </View>

        <GestureDetector gesture={sledPillSwipeGesture}>
          <View style={s.sledVariantRow}>
            {hasPrev ? (
              <Animated.View style={[s.sledVariantChevronSlotLeft, sledChevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateVariant(-1)}
                  style={s.sledVariantChevronPressable}
                  hitSlop={8}
                  accessibilityLabel="Previous variant"
                >
                  <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.sledVariantChevronSlotLeft} />
            )}

            <Animated.View
              style={[
                {
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                  borderWidth: 1, borderColor: palette.blue[500],
                  backgroundColor: withAlpha(palette.blue[500], 0.15),
                },
                sledPillAnimatedStyle,
              ]}
            >
              <Text style={{
                fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: 0.5, color: palette.blue[400],
              }}>
                {activeVariant === 'push' ? 'PUSH' : 'DRAG'}
              </Text>
            </Animated.View>

            {hasNext ? (
              <Animated.View style={[s.sledVariantChevronSlotRight, sledChevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateVariant(1)}
                  style={s.sledVariantChevronPressable}
                  hitSlop={8}
                  accessibilityLabel="Next variant"
                >
                  <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.sledVariantChevronSlotRight} />
            )}
          </View>
        </GestureDetector>
      </View>

      {/* Paged ScrollView — Push and Pull bodies slide in/out. Each slot
          renders a full CarryDetail with hideHeader=true (so the wrapper
          header is the only header the user sees). negative
          marginHorizontal bleeds the slots to the screen edges so the
          slide travel matches the user's full swipe distance; each slot
          re-pads internally so the body content lines up with where the
          page header already sits. */}
      <View
        onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
        style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}
      >
        {/* GestureDetector binds the outer Native gesture to this ScrollView's
            native scroll. The inner CarryDetail slots each receive
            `outerScrollGesture={outerScrollGesture}` and chain
            `blocksExternalGesture(outerScrollGesture)` in their carry pill
            Pan — so when the inner Pan activates, the outer scroll fails.
            Without this composition, the outer ScrollView wins every touch
            because it claims the gesture in the first frame, before the
            inner Pan reaches its `activeOffsetX` threshold. */}
        {/* GHScrollView = gesture-handler's ScrollView (drop-in replacement
            for react-native's). When wrapped in <GestureDetector gesture=
            {Gesture.Native()}>, its native scroll cleanly participates in
            gesture composition so `blocksExternalGesture(outerScrollGesture)`
            on the inner pill reliably forces this scroll to fail when the
            inner Pan activates. The native react-native ScrollView only
            partially coordinates with v2 gesture composition — the cause of
            the "inner pill swipes most of the time, but not always" bug. */}
        <GestureDetector gesture={outerScrollGesture}>
          <GHScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={e => {
              if (slotWidth === 0) return
              const x = e.nativeEvent.contentOffset.x
              const idx = Math.round(x / slotWidth)
              const targetVariant = SLED_VARIANT_ORDER[idx]
              if (targetVariant && targetVariant !== activeVariant) {
                setActiveVariant(targetVariant)
              }
            }}
          >
            {SLED_VARIANT_ORDER.map(v => (
              <View
                key={v}
                style={{
                  width: slotWidth,
                  paddingHorizontal: PAGE_PADDING_HORIZONTAL,
                }}
              >
                <CarryDetail
                  exercise={`Sled Work [${v === 'push' ? 'Push' : 'Drag'}]`}
                  displayName="Sled Work"
                  efforts={effortsByVariant[v]}
                  onDelete={onDelete}
                  hideHeader
                  outerScrollGesture={outerScrollGesture}
                />
              </View>
            ))}
          </GHScrollView>
        </GestureDetector>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RepsOnlyDetail (Band / Knee / Band+Knee assisted)
// ─────────────────────────────────────────────────────────────────────────────

function RepsOnlyDetail({
  exercise, efforts, onDelete, assistType = 'band', hideHeader,
}: {
  exercise:    string
  efforts:     Effort[]
  onDelete:    (id: string) => void
  assistType?: 'band' | 'knee' | 'band+knee'
  /** Suppresses page-level header when rendered inside FamilyConsolidatedDetail. */
  hideHeader?: boolean
}) {
  const isBand      = assistType !== 'knee'
  const assistLabel =
    assistType === 'band+knee' ? 'Band + Knee assisted'
    : assistType === 'knee'    ? 'Knee assisted'
                               : 'Band assisted'
  const hintText =
    assistType === 'band+knee'
      ? 'Progress by using lighter bands and removing knee assist one step at a time'
      : assistType === 'knee'
        ? 'Build strength in the knee-assisted position to progress to full reps'
        : 'Work towards unassisted reps by progressively using lighter bands'
  const baseName = exercise
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')

  const parsed = efforts
    .map(e => {
      const reps      = parseRepsOnlyFromLabel(e.label, isBand)
      const bandLevel = isBand ? parseBandLevelFromLabel(e.label) : null
      return reps !== null ? { reps, bandLevel, ts: e.created_at, id: e.id } : null
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const bestReps = parsed.length > 0 ? Math.max(...parsed.map(p => p.reps)) : 0
  const chartData = parsed.map(p => ({ ts: p.ts, y: p.reps }))

  return (
    <View style={s.page}>
      {/* Header — suppressed when rendered inside FamilyConsolidatedDetail. */}
      {!hideHeader && (
      <View>
        <BackButton />
        <Text style={s.h1}>{baseName}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>{assistLabel} · Best — </Text>
          <TickerNumber value={bestReps} fontSize={14} color={palette.blue[400]} fontWeight="600" />
          <Text style={[s.subText, s.subValueBlue]}> reps</Text>
        </View>
      </View>
      )}

      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Progress</Text>
        <NextTargetCallout title="Personal best">
          <View style={s.calloutValueRow}>
            <TickerNumber value={bestReps} fontSize={36} color={palette.blue[400]} fontWeight="700" />
            <Text style={s.calloutSubText}>reps</Text>
          </View>
          <Text style={s.tinyText}>{hintText}</Text>
        </NextTargetCallout>
      </AnimateRise>

      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Reps over time</Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1 ? bestReps : null}
            yWidth={32}
            allowDecimals={false}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)}`}
            tooltipLabel="Reps"
            yDomain={{
              min: (mn) => Math.max(0, mn - 1),
              max: (mx) => mx + 2,
            }}
            caption={<Text style={s.tinyText}>Dashed line = personal best</Text>}
          />
        </AnimateRise>
      )}

      <EffortsHistorySection
        efforts={efforts}
        onDelete={onDelete}
        delay={500}
        renderLeft={e => {
          const bandLevel = isBand ? parseBandLevelFromLabel(e.label) : null
          return (
            <View>
              {bandLevel && (
                <Text style={s.listRowMutedBold}>{bandLevel} band</Text>
              )}
              <Text style={s.listRowDateSm}>{fmtDate(e.created_at)}</Text>
            </View>
          )
        }}
        renderRight={e => {
          const reps = parseRepsOnlyFromLabel(e.label, isBand)
          return (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.listRowSubLabel}>reps</Text>
              <Text style={s.valBlue}>{reps ?? '—'}</Text>
            </View>
          )
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OlympicLiftDetail (Layout 9) — Olympic barbell lifts (snatch / clean / jerk
// family + pulls). These fail on TECHNIQUE and BAR SPEED, not muscular fatigue,
// so they get NO rep-max grid and NO hypertrophy/endurance zones — instead, three
// %-of-best intensity tiles (Technique 70% / Build 85% / Peak = next PR) and a
// "stop when the bar slows" cue. Built on the Layout-2 (isometric) skeleton:
// fixed tile row → hero → chart → log, no swipe pill. (T088 Model 1 / Fix 1.2)
// ─────────────────────────────────────────────────────────────────────────────

type OlympicKey = 'technique' | 'build' | 'peak'
type OlympicTarget = { key: OlympicKey; label: string; pct: number; pctText: string; repsText: string; cue: string }
const OLYMPIC_TARGETS: ReadonlyArray<OlympicTarget> = [
  { key: 'technique', label: 'TECHNIQUE', pct: 0.70, pctText: '70%',   repsText: '× 2-3',
    cue: 'Light and fast — drill the positions. Stop the set the moment bar speed drops.' },
  { key: 'build',     label: 'BUILD',     pct: 0.85, pctText: '85%',   repsText: '× 1-2',
    cue: 'Heavy but crisp singles and doubles. Stop the moment the bar slows down.' },
  { key: 'peak',      label: 'PEAK',      pct: 1.00, pctText: '100%+', repsText: '× 1',
    cue: 'Build to a heavy single — a new PR. Make-or-miss; speed is the signal, never grind it out.' },
]

function OlympicLiftDetail({
  exercise, efforts, onDelete, hideHeader,
}: {
  exercise: string
  efforts: Effort[]
  onDelete: (id: string) => void
  hideHeader?: boolean
}) {
  const { profile } = useAuth()

  // Best single. Olympic lifts are logged low-rep (1-3), so parseOneRM (the same
  // 1RM the log already stored) is a valid proxy — no high-rep extrapolation.
  const best = useMemo(() => {
    let b: { oneRM: number; unit: string } | null = null
    for (const e of efforts) {
      const p = parseOneRM(e.value)
      if (p && p.oneRM > 0 && (!b || p.oneRM > b.oneRM)) b = p
    }
    return b
  }, [efforts])
  const unit    = (best?.unit as 'lb' | 'kg') || ((profile?.weight_unit as 'lb' | 'kg') || 'lb')
  const best1RM = best?.oneRM ?? 0

  const [selKey, setSelKey] = useState<OlympicKey>('build')
  const selTarget: OlympicTarget = OLYMPIC_TARGETS.find(t => t.key === selKey) ?? OLYMPIC_TARGETS[1]

  // Peak = the next loadable single above the best (the PR to chase); technique /
  // build = the nearest loadable rung at the % of best. All Olympic lifts are
  // barbell, so the loadable rounding is always barbell.
  const weightFor = (t: OlympicTarget): number => {
    if (best1RM <= 0) return 0
    if (t.key === 'peak') return nextLoadableAbove(best1RM, 'barbell', unit) ?? best1RM
    return nearestLoadableWeight(best1RM * t.pct, 'barbell', unit)
  }
  const selWeight = weightFor(selTarget)

  const chartData = efforts
    .map(e => { const p = parseOneRM(e.value); return p && p.oneRM > 0 ? { ts: e.created_at, y: p.oneRM } : null })
    .filter((p): p is { ts: string; y: number } => p !== null)

  const renderTile = (t: OlympicTarget) => {
    const activeTile = t.key === selKey
    const w = weightFor(t)
    return (
      <Pressable
        key={t.key}
        onPress={() => setSelKey(t.key)}
        style={[
          { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, alignItems: 'center', gap: 3 },
          activeTile
            ? { borderColor: withAlpha(palette.blue[500], 0.6), backgroundColor: withAlpha(palette.blue[500], 0.10) }
            : { borderColor: alpha(colors.border, 0.4), backgroundColor: alpha(colors.card, 0.2) },
        ]}
      >
        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: activeTile ? palette.blue[400] : colors.mutedForeground }}>{t.label}</Text>
        <Text style={{ fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], fontSize: 16, color: activeTile ? palette.blue[400] : colors.foreground }}>{w}</Text>
        <Text style={{ fontFamily: fonts.mono[500], fontVariant: ['tabular-nums'], fontSize: 10, color: colors.mutedForeground }}>{t.pctText}</Text>
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{t.repsText}</Text>
      </Pressable>
    )
  }

  return (
    <View style={s.page}>
      {!hideHeader && (
        <View>
          <BackButton />
          <Text style={s.h1}>{exercise}</Text>
          <View style={s.subRow}>
            <Text style={s.subText}>{best1RM > 0 ? 'Best — ' : 'No efforts logged yet'}</Text>
            {best1RM > 0 && <TickerNumber value={best1RM} fontSize={14} color={palette.blue[400]} fontWeight="600" />}
            {best1RM > 0 && <Text style={s.subText}> {unit}</Text>}
          </View>
          <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
            <Text style={s.carryTierBadgeText}>OLYMPIC</Text>
          </View>
        </View>
      )}

      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Train by percentage</Text>
        <Text style={s.tinyText}>Pick an intensity — these lifts build on bar speed, not reps.</Text>

        {best1RM > 0 ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              {OLYMPIC_TARGETS.map(renderTile)}
            </View>

            <NextTargetCallout>
              <View style={s.calloutValueRow}>
                <TickerNumber value={selWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                <Text style={s.calloutSubText}> {unit}</Text>
              </View>
              <Text style={s.tinyText}>{selTarget.label} · {selTarget.pctText} · {selTarget.repsText}</Text>
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15) }}>
                <Text style={s.calloutLabel}>{selTarget.cue}</Text>
              </View>
            </NextTargetCallout>

            <Text style={s.tinyText}>{'NSCA (Haff & Triplett) · Catalyst Athletics · velocity-based training'}</Text>
          </>
        ) : (
          <Text style={[s.tinyText, { marginTop: 8 }]}>Log a {exercise} effort and your percentage targets will appear here.</Text>
        )}
      </AnimateRise>

      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Best lift over time</Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1 ? best1RM : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)} ${unit}`}
            tooltipLabel="Est. 1RM"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.9)),
              max: (mx) => Math.round(mx * 1.1),
            }}
            caption={<Text style={s.tinyText}>Dashed line = personal best</Text>}
          />
        </AnimateRise>
      )}

      <EffortsHistorySection
        efforts={efforts}
        onDelete={onDelete}
        delay={500}
        renderLeft={e => (<Text style={s.listRowDate}>{fmtDate(e.created_at)}</Text>)}
        renderRight={e => {
          const p = parseOneRM(e.value)
          return <Text style={s.valBlue}>{p ? `${p.oneRM} ${p.unit}` : '—'}</Text>
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BallisticLiftDetail (Layout 10) — ballistic KETTLEBELL lifts (swing / snatch /
// clean / jerk / push-press / high-pull + double & single-arm variants). These
// are trained for high-power reps at a given bell, NOT a 1-rep max — so they get
// NO rep-max grid. Progression is a BELL LADDER: own a bell at a clean rep volume,
// then size up. Benchmarks: Simple & Sinister (100 swings/5min), the snatch test
// (100 snatches/5min). Built on the Layout-2 skeleton: ladder strip → hero →
// chart → log, no swipe pill. (T088 Model 1 / Fix 1.2b)
// ─────────────────────────────────────────────────────────────────────────────

function BallisticLiftDetail({
  exercise, efforts, onDelete, hideHeader,
}: {
  exercise: string
  efforts: Effort[]
  onDelete: (id: string) => void
  hideHeader?: boolean
}) {
  const { profile } = useAuth()

  const parsed = useMemo(() => efforts.map(e => ({
    ts: e.created_at,
    weight: parseWeightFromLabel(e.label),
    reps: parseRepsFromLabel(e.label),
    unit: parseOneRM(e.value)?.unit ?? null,
  })).filter(p => p.weight > 0), [efforts])

  const unit = ((parsed.length ? parsed[parsed.length - 1].unit : null) as 'lb' | 'kg' | null)
    || ((profile?.weight_unit as 'lb' | 'kg') || 'lb')
  const bestBell   = parsed.length ? Math.max(...parsed.map(p => p.weight)) : 0
  const ladder     = (getLadder('kettlebell', unit) ?? []) as readonly number[]
  const targetBell = nextLoadableAbove(bestBell, 'kettlebell', unit) ?? bestBell

  const benchmark = /swing/i.test(exercise)  ? 'Benchmark: 100 swings in 5 min (Simple & Sinister).'
    : /snatch/i.test(exercise) ? 'Benchmark: 100 snatches in 5 min (the snatch test).'
    : null

  const chartData = parsed.map(p => ({ ts: p.ts, y: p.weight }))

  const renderBell = (kg: number) => {
    const achieved = kg <= bestBell
    const isTarget = kg === targetBell && kg > bestBell
    return (
      <View key={kg} style={[
        { minWidth: 56, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 9, borderWidth: 1, alignItems: 'center', gap: 3 },
        isTarget ? { borderColor: palette.blue[500], backgroundColor: withAlpha(palette.blue[500], 0.15) }
          : achieved ? { borderColor: withAlpha(palette.blue[500], 0.4), backgroundColor: withAlpha(palette.blue[500], 0.08) }
            : { borderColor: alpha(colors.border, 0.3), backgroundColor: alpha(colors.card, 0.2), opacity: 0.4 },
      ]}>
        <Text style={{ fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], fontSize: 13, color: (achieved || isTarget) ? palette.blue[400] : colors.mutedForeground }}>{kg}</Text>
        <View style={{ height: 12, alignItems: 'center', justifyContent: 'center' }}>
          {achieved
            ? <Check size={11} color={palette.blue[400]} strokeWidth={3} />
            : isTarget
              ? <Text style={{ fontSize: 9, fontWeight: '700', color: palette.blue[400] }}>NEXT</Text>
              : <Text style={{ fontFamily: fonts.mono[400], fontSize: 10, color: alpha(colors.mutedForeground, 0.4) }}>—</Text>}
        </View>
      </View>
    )
  }

  return (
    <View style={s.page}>
      {!hideHeader && (
        <View>
          <BackButton />
          <Text style={s.h1}>{exercise}</Text>
          <View style={s.subRow}>
            <Text style={s.subText}>{bestBell > 0 ? 'Best — ' : 'No efforts logged yet'}</Text>
            {bestBell > 0 && <TickerNumber value={bestBell} fontSize={14} color={palette.blue[400]} fontWeight="600" />}
            {bestBell > 0 && <Text style={s.subText}> {unit}</Text>}
          </View>
          <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
            <Text style={s.carryTierBadgeText}>BALLISTIC</Text>
          </View>
        </View>
      )}

      <AnimateRise delay={0} style={s.card}>
        <Text style={s.h2}>Move up the bells</Text>
        <Text style={s.tinyText}>Trained on power, not a 1-rep max — own a bell, then size up.</Text>

        {bestBell > 0 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
              {ladder.map(renderBell)}
            </ScrollView>

            <NextTargetCallout>
              <View style={s.calloutValueRow}>
                <TickerNumber value={targetBell} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                <Text style={s.calloutSubText}> {unit} — next bell</Text>
              </View>
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15), gap: 2 }}>
                <Text style={s.calloutLabel}>Train the {bestBell} {unit} bell in high-power sets of 5-10 with full rest. Own ~100 clean reps, then move up to {targetBell} {unit}.</Text>
                {benchmark && <Text style={s.tinyText}>{benchmark}</Text>}
              </View>
            </NextTargetCallout>

            <Text style={s.tinyText}>{'StrongFirst · Simple & Sinister (Pavel) · RKC/SFG snatch test'}</Text>
          </>
        ) : (
          <Text style={[s.tinyText, { marginTop: 8 }]}>Log a {exercise} effort and your bell ladder will appear here.</Text>
        )}
      </AnimateRise>

      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>Bell weight over time</Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1 ? bestBell : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) => `${Math.round(v)} ${unit}`}
            tooltipLabel="Bell"
            yDomain={{ min: (mn) => Math.max(0, Math.round(mn * 0.9)), max: (mx) => Math.round(mx * 1.1) }}
            caption={<Text style={s.tinyText}>Dashed line = heaviest bell</Text>}
          />
        </AnimateRise>
      )}

      <EffortsHistorySection
        efforts={efforts}
        onDelete={onDelete}
        delay={500}
        renderLeft={e => (<Text style={s.listRowDate}>{fmtDate(e.created_at)}</Text>)}
        renderRight={e => {
          const w = parseWeightFromLabel(e.label)
          const reps = parseRepsFromLabel(e.label)
          const u = parseOneRM(e.value)?.unit ?? unit
          return <Text style={s.valBlue}>{w > 0 ? `${w} ${u} × ${reps}` : '—'}</Text>
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main StrengthDetail (handles loading + dispatch + standard rep-based view)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// StrengthDetail — single-variant detail page.
//
// Default export reads the exercise from the URL. When rendered as a slot
// inside FamilyConsolidatedDetail (admin-added variant family wrapper), the
// wrapper passes `propExercise` to override and `propHideHeader` to suppress
// the page-level header chrome (so the wrapper's own header is the only one
// the user sees). Mirrors the same prop shape CarryDetail accepts when
// rendered inside SledWorkConsolidatedDetail.
// ─────────────────────────────────────────────────────────────────────────────

function StrengthDetail({
  propExercise,
  propHideHeader,
  outerScrollGesture,
}: {
  propExercise?: string
  propHideHeader?: boolean
  /** Native gesture handle for an outer horizontal ScrollView (the family
   *  paged ScrollView in FamilyConsolidatedDetail). When provided, the
   *  inner adp-zone pill swipe + tile-row horizontal scroll chain
   *  `.blocksExternalGesture(outerScrollGesture)` on themselves so they
   *  win horizontal touches before the outer pager activates. Same
   *  pattern Sled Work uses for CarryDetail's inner gestures. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerScrollGesture?: any
} = {}) {
  const { exercise: rawExercise } = useLocalSearchParams<{ exercise: string }>()
  // When the props override (`propExercise`) is passed in by a wrapper
  // (e.g. SledWorkConsolidatedDetail, the upcoming FamilyConsolidatedDetail),
  // it takes precedence over the URL param. Lets the wrapper render N
  // instances of StrengthDetail with different exercises, each in its
  // own paged ScrollView slot.
  const exerciseFromUrl = typeof rawExercise === 'string' ? decodeURIComponent(rawExercise) : ''
  const exercise = propExercise ?? exerciseFromUrl
  const { user, profile } = useAuth()

  const dbMovements    = useMovements()
  const [efforts, setEfforts]       = useState<Effort[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedRM, setSelectedRM] = useState<number>(1)
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)
  const [bwTierInfoOpen, setBwTierInfoOpen] = useState(false)
  // Active tier on the bodyweight consolidated page (see CLAUDE.md spec).
  // Initialised in the efforts-loading useEffect to the highest tier reached.
  const [bwSelectedTier, setBwSelectedTier] = useState<BwTier | null>(null)
  const bwTierScrollRef = useRef<ScrollView | null>(null)
  const bwTierSlotWidths = useRef<Record<string, number>>({})

  // Tile scroll container + tile-position map so a pill click can scroll the
  // row to the first tile of that adp zone.
  const tileScrollRef    = useRef<ScrollView | null>(null)
  const tileOffsets      = useRef<Record<number, number>>({})
  const tileWidths       = useRef<Record<number, number>>({})
  // Visible width of the horizontal tile-row ScrollView. Captured via
  // onLayout so we can centre the active tile inside it on zone change.
  const [tileViewportW, setTileViewportW] = useState(0)
  // Current scroll position of the tile row, synced via onScroll. Used as
  // the start position for the custom rAF-based smooth scroll below.
  const tileScrollPosRef = useRef(0)
  const tileScrollAnimRef2 = useRef<{ cancelled: boolean } | null>(null)

  // Custom rAF-based scroll animation. Native `ScrollView.scrollTo({ animated: true })`
  // on Android has a fixed-duration internal animator that felt too quick
  // (almost instant) — this loops `scrollTo({ animated: false })` over a
  // longer duration with ease-out cubic so the scroll has a more deliberate
  // settle. JS-thread rAF is fine for a short animation (~24 frames at 60 Hz).
  function smoothScrollTileTo(targetX: number, duration = 400) {
    // Cancel any in-flight animation so a new zone change doesn't fight it.
    if (tileScrollAnimRef2.current) tileScrollAnimRef2.current.cancelled = true
    const token = { cancelled: false }
    tileScrollAnimRef2.current = token

    const start    = tileScrollPosRef.current
    const distance = targetX - start
    if (Math.abs(distance) < 1) return
    const startTime = Date.now()

    function step() {
      if (token.cancelled) return
      const elapsed = Date.now() - startTime
      const t       = Math.min(1, elapsed / duration)
      const eased   = 1 - Math.pow(1 - t, 3)   // ease-out cubic
      const x       = start + distance * eased
      tileScrollRef.current?.scrollTo({ x, animated: false })
      tileScrollPosRef.current = x
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function scrollToZone(firstRepInZone: number) {
    setZoneInfoOpen(false)  // dismiss the info panel on any zone change
    setSelectedRM(firstRepInZone)
    const offset    = tileOffsets.current[firstRepInZone] ?? 0
    const tileW     = tileWidths.current[firstRepInZone] ?? 68
    // Centre the tile in the viewport; clamp to non-negative so the first
    // strength tile (no content before it) still lands at the start.
    const centered  = Math.max(0, offset - Math.max(0, (tileViewportW - tileW) / 2))
    smoothScrollTileTo(centered, 600)
  }

  // Weighted-standard adp-zone pill swipe infrastructure. Shared values
  // declared at the top of the component so they live across renders; the
  // actual gesture is constructed below once `selZone` is known.
  const wsPillTranslateX     = useSharedValue(0)
  const wsChevronOpacityOver = useSharedValue(1)


  async function handleDeleteEffort(id: string) {
    setEfforts(prev => prev.filter(e => e.id !== id))
    if (user) await supabase.from('efforts').delete().eq('id', id).eq('user_id', user.id)
  }

  // ── Exercise type detection (from DB record) ───────────────────────────────
  const isBandKneeAssisted = exercise.endsWith(' [Band + Knee]')
  const isBandAssisted     = exercise.endsWith(' [Band]')
  const isKneeAssisted     = exercise.endsWith(' [Knee]')
  const baseExercise = exercise
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
  const movementRecord    = dbMovements.find(m => m.name === baseExercise) ?? null
  const isIsometric       = movementRecord?.strength_type === 'isometric'
  const isAssistedMachine = movementRecord?.equipment === 'assisted'
  const isCarry           = movementRecord?.equipment === 'carry'
  const isOlympic         = movementRecord?.lift_type === 'olympic'
  const isBallistic       = movementRecord?.lift_type === 'ballistic'
  // Sled Work consolidated route — the URL is the base name "Sled Work"
  // (without [Push] / [Pull] suffix). The actual movements in the DB are
  // `Sled Work [Push]` and `Sled Work [Drag]` — when the user taps the
  // collapsed row in the strength index, the route lands here with
  // exercise === "Sled Work" and no matching movementRecord. The
  // dispatcher below routes to SledWorkConsolidatedDetail, which fetches
  // both variants (via the or() query branch in the useEffect below) and
  // renders a PUSH | PULL toggle on top of CarryDetail.
  // Anchored on `exerciseFromUrl` (the raw URL param) NOT the family-aware
  // `exercise` shadow. If we used `exercise`, family mode would shadow it
  // to "Sled Work [Push]" and this check would always return false, sending
  // the page down the wrong dispatch branch.
  const isSledWorkConsolidated = exerciseFromUrl === 'Sled Work'
  const equipmentType     = movementRecord?.equipment ?? 'barbell'
  // Bodyweight now includes ALL four tiers — the assisted suffixes are part
  // of the consolidated bodyweight detail page (see CLAUDE.md spec).
  const isBodyweightExercise = equipmentType === 'bodyweight'
  // True only for the Pull-Up / Dip / Chin-Up family — movements that can
  // actually be performed with band/knee assistance. For other bodyweight
  // movements (Leg Raise, Plank Hold, etc.), the tier UI (FULL RX badge,
  // tier pill in the consolidated block) is misleading because there's no
  // assisted-tier progression — so we gate the tier-specific chrome on this.
  const canHaveTiers = !!(movementRecord?.band_assist || movementRecord?.knee_assist)
  // True for bodyweight movements that graduate to weighted training after 10
  // reps (Pull Up, Dip, Push Up family, etc.) — the original "+X lb" tile
  // suggestions still apply. False for rep-only bodyweight movements (Burpee,
  // Sit Up, Mountain Climber, etc.) which progress through a 3-stage rep
  // milestone system with no weight projections. Sourced from
  // `movements.weighted_progression` so the admin panel can flag new
  // movements without code changes.
  const weightedProgression = !!(movementRecord?.weighted_progression)

  useEffect(() => {
    if (!user || !exercise) return
    let alive = true

    const query = supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'strength')
      .order('created_at', { ascending: true })

    // Bodyweight: pull every tier variant in one shot so the consolidated
    // detail page can render the whole journey across B+K / K / B / Full RX.
    //
    // BUT only use the multi-filter `.or()` query when the movement is actually
    // eligible for tier variants (band_assist or knee_assist). PostgREST's
    // `or()` syntax uses parentheses as grouping markers, so movement names
    // containing literal parens (e.g. "Leg Raise (Lying)", "Bench Press (Close
    // Grip)") get parsed as malformed filter expressions and the query returns
    // nothing — page stays empty. Non-tier-eligible bodyweight movements fall
    // back to a single `.ilike()` which passes the value as a single param and
    // handles parens safely.
    const filtered = isBodyweightExercise && canHaveTiers
      ? query.or(
          [
            `label.ilike.${baseExercise} ·%`,
            `label.ilike.${baseExercise} [Band] ·%`,
            `label.ilike.${baseExercise} [Knee] ·%`,
            `label.ilike.${baseExercise} [Band + Knee] ·%`,
          ].join(',')
        )
      : isSledWorkConsolidated
        ? query.or(
            [
              `label.ilike.Sled Work [Push] ·%`,
              `label.ilike.Sled Work [Drag] ·%`,
            ].join(',')
          )
        : query.ilike('label', `${exercise} ·%`)

    filtered.then(({ data }) => {
      if (!alive) return
      const loaded = (data || []) as Effort[]
      setEfforts(loaded)
      setLoading(false)
      if (isBodyweightExercise && loaded.length > 0) {
        const repsByTier: Record<BwTier, number> = { 'band+knee': 0, 'knee': 0, 'band': 0, 'rx': 0 }
        loaded.forEach(e => {
          const t = bwTierFromVariantName(e.label.split(' · ')[0])
          const r = parseRepsFromBwLabel(e.label) || 0
          if (r > repsByTier[t]) repsByTier[t] = r
        })
        const loggedTiers = BW_TIERS.filter(t => repsByTier[t] > 0)
        const highestTier: BwTier = loggedTiers.length > 0 ? loggedTiers[loggedTiers.length - 1] : 'rx'
        const urlTier: BwTier | null = isBandKneeAssisted ? 'band+knee'
          : isKneeAssisted ? 'knee'
          : isBandAssisted ? 'band'
          : null
        const initialTier: BwTier = urlTier && loggedTiers.includes(urlTier) ? urlTier : highestTier
        setBwSelectedTier(initialTier)
        const bestInActive = repsByTier[initialTier]
        if (bestInActive > 0) {
          if (!weightedProgression) {
            // Rep-only: default to the push tile (smallest stage value
            // above the user's current best) so the hero opens on the
            // natural next target. If the user has already saturated the
            // stage (e.g. logged 10 reps in Stage 1), fall back to the
            // top of that stage — the next stage doesn't unlock until
            // they cross the threshold (11 / 21 reps).
            const stage = bestInActive >= 21 ? REP_STAGE_3
              : bestInActive >= 11 ? REP_STAGE_2
              : REP_STAGE_1
            const pushVal = stage.find(r => r > bestInActive)
            setSelectedRM(pushVal ?? stage[stage.length - 1])
          } else {
            setSelectedRM(Math.min(bestInActive, 10))
          }
        }
      }
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, exercise])

  // When an effort gets deleted that drops a tier out of the user's logged
  // set, the previously-active pill (held in `bwSelectedTier` state) may no
  // longer be valid — e.g., user was on FULL RX, deleted their only RX
  // effort, RX is no longer logged. Reset to the highest logged tier so the
  // pill / hero card / carousel slot all match the live data.
  // Computes `loggedTiers` inline from `efforts` because the per-tier
  // helpers (`bwLoggedTiers`, etc.) are declared further down past the
  // early returns; this effect lives above them so its hook order is stable.
  useEffect(() => {
    if (!isBodyweightExercise) return
    if (bwSelectedTier === null) return
    const byTier: Record<BwTier, Effort[]> = { 'band+knee': [], 'knee': [], 'band': [], 'rx': [] }
    efforts.forEach(e => {
      const t = bwTierFromVariantName(e.label.split(' · ')[0])
      byTier[t].push(e)
    })
    const loggedTiers = BW_TIERS.filter(t => byTier[t].length > 0).reverse()
    if (loggedTiers.length === 0) return
    if (!loggedTiers.includes(bwSelectedTier)) {
      const fallback = loggedTiers[0]
      setBwSelectedTier(fallback)
      const best = Math.max(0, ...byTier[fallback].map(e => parseRepsFromBwLabel(e.label) || 0))
      if (best > 0) {
        if (!weightedProgression) {
          // Rep-only: snap selection to the push tile in the active stage.
          const stage = pickRepOnlyStage(best)
          const pushVal = stage.find(r => r > best)
          setSelectedRM(pushVal ?? stage[stage.length - 1])
        } else {
          setSelectedRM(Math.min(best, 10))
        }
      }
    }
  }, [efforts, bwSelectedTier, isBodyweightExercise, weightedProgression])

  // ── Weighted-standard adp-zone pill swipe hooks (must live above the
  // early returns below so React's rules-of-hooks ordering stays stable
  // across renders, regardless of loading / empty / type-specific
  // branches). The closure these hooks build over `selZone` is recomputed
  // every render via `adpZoneFor(selectedRM)` below; the useMemo deps
  // pin re-creation to the values the worklet actually reads. ───────────
  const wsSelZone: AdpZone = adpZoneFor(selectedRM)
  const WS_ZONE_ORDER: AdpZone[] = ['strength', 'hypertrophy', 'endurance']
  const WS_FIRST_REP_OF_ZONE: Record<AdpZone, number> = { strength: 1, hypertrophy: 6, endurance: 13 }
  const WS_SWIPE_THRESHOLD_PX = 20
  const WS_SLIDE_OFFSCREEN_PX = 220
  const WS_SLIDE_DURATION_MS  = 250
  const wsZoneIdx   = WS_ZONE_ORDER.indexOf(wsSelZone)
  const wsCanGoPrev = wsZoneIdx > 0
  const wsCanGoNext = wsZoneIdx >= 0 && wsZoneIdx < WS_ZONE_ORDER.length - 1

  // Generic helper: slide the pill off in the swipe direction, fire
  // `onMidPoint` once the pill is off-screen (callers do the state change
  // there — set selected rep, scroll the tile row, etc.), then slide the
  // new pill in from the opposite side and fade the chevrons back in. Used
  // by EVERY zone change — chevron taps, tile taps that cross a zone
  // boundary, etc. — so the animation runs no matter the trigger. The pan
  // gesture's `onEnd` worklet keeps its inline animation because the pill
  // is already mid-pan and starting a fresh animation via this helper
  // would add a runOnJS hop.
  const triggerPillSlide = (direction: -1 | 1, onMidPoint: () => void) => {
    wsChevronOpacityOver.value = withTiming(0, { duration: 120 })
    const slideOff = direction === 1 ? -WS_SLIDE_OFFSCREEN_PX : WS_SLIDE_OFFSCREEN_PX
    wsPillTranslateX.value = withTiming(slideOff, { duration: WS_SLIDE_DURATION_MS }, (finished) => {
      'worklet'
      if (!finished) return
      runOnJS(onMidPoint)()
      wsPillTranslateX.value = -slideOff
      wsPillTranslateX.value = withTiming(0, { duration: WS_SLIDE_DURATION_MS }, (settled) => {
        'worklet'
        if (settled) wsChevronOpacityOver.value = withTiming(1, { duration: 200 })
      })
    })
  }

  const navigateZone = (direction: -1 | 1) => {
    const target = wsZoneIdx + direction
    if (target < 0 || target >= WS_ZONE_ORDER.length) return
    const firstRep = WS_FIRST_REP_OF_ZONE[WS_ZONE_ORDER[target]]
    triggerPillSlide(direction, () => scrollToZone(firstRep))
  }

  // Called when a tile is tapped. If the tile lives in a different zone
  // than the active one, run the same pill-slide animation as a chevron
  // tap / swipe; otherwise just update the selected rep without animation
  // (no zone change → nothing to animate).
  const onTilePress = (rm: number) => {
    setZoneInfoOpen(false)
    const newZone: AdpZone = adpZoneFor(rm)
    if (newZone === wsSelZone) {
      setSelectedRM(rm)
      return
    }
    const newIdx = WS_ZONE_ORDER.indexOf(newZone)
    const direction: -1 | 1 = newIdx > wsZoneIdx ? 1 : -1
    triggerPillSlide(direction, () => {
      setSelectedRM(rm)
      // Centre the tapped tile in the row (same maths as scrollToZone).
      const offset = tileOffsets.current[rm] ?? 0
      const tileW  = tileWidths.current[rm]  ?? 68
      const centered = Math.max(0, offset - Math.max(0, (tileViewportW - tileW) / 2))
      smoothScrollTileTo(centered, 600)
    })
  }

  // Pan onEnd performs its OWN slide animation (the pill is already mid-pan,
  // it has to finish the journey off-screen and then slide a new pill back).
  // It must therefore call the raw state-change `scrollToZone` directly at
  // the midpoint — NOT `navigateZone`, which would trigger a second slide
  // via `triggerPillSlide` and produce a "ghost pill" mid-swipe.
  //
  // HISTORICAL NOTE (May 19 2026): an earlier attempt added a second
  // GestureDetector around the hero card so the hero would also be swipable.
  // That was reverted because the pill is conceptually linked to the SLIDING
  // TILE STRIP (rep-max projections), not the hero card itself. The hero is
  // a derived view of the selected tile — swiping it sideways doesn't have
  // a meaningful target. Only the pill row swipes, the tile strip scrolls
  // horizontally, and the user taps a tile to move the hero's content.
  const wsPillSwipeGesture = useMemo(
    () => {
      // ── L5 activation tuning ────────────────────────────────────────
      // When NESTED inside FamilyConsolidatedDetail's paged ScrollView,
      // the inner Pan needs a very LOW activation threshold (5 px) and
      // NO failOffsetY so it beats the outer pager's native scroll to
      // activation. A natural fast horizontal swipe picks up vertical
      // drift; a 25 px Y-fail caused the inner Pan to abort BEFORE
      // reaching X-activation, letting the outer scroll take over and
      // the user's swipe drove the outer pager instead of the inner
      // pill. Mirrors the exact tuning CarryDetail uses inside
      // SledWorkConsolidatedDetail (verified working there).
      //
      // STANDALONE (no outer scroll) keeps the original 15 px / 25 px
      // thresholds — works fine when there's no competing outer pager.
      let g = Gesture.Pan()
      if (outerScrollGesture) {
        g = g.activeOffsetX([-5, 5])
        g = g.blocksExternalGesture(outerScrollGesture)
      } else {
        g = g.activeOffsetX([-15, 15])
        g = g.failOffsetY([-25, 25])
      }
      return g.onStart(() => {
        'worklet'
        wsChevronOpacityOver.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        wsPillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const allowed = direction === -1 ? wsCanGoPrev : wsCanGoNext
        const past    = Math.abs(event.translationX) > WS_SWIPE_THRESHOLD_PX
        if (!past || !allowed) {
          wsPillTranslateX.value     = withTiming(0, { duration: 200 })
          wsChevronOpacityOver.value = withTiming(1, { duration: 200 })
          return
        }
        const slideOff = direction === 1 ? -WS_SLIDE_OFFSCREEN_PX : WS_SLIDE_OFFSCREEN_PX
        const targetIdx = wsZoneIdx + direction
        const targetFirstRep = WS_FIRST_REP_OF_ZONE[WS_ZONE_ORDER[targetIdx]]
        wsPillTranslateX.value = withTiming(slideOff, { duration: WS_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          // Raw state change — no second slide animation. `scrollToZone`
          // handles `setSelectedRM` + tile-row centring.
          runOnJS(scrollToZone)(targetFirstRep)
          wsPillTranslateX.value = -slideOff
          wsPillTranslateX.value = withTiming(0, { duration: WS_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) wsChevronOpacityOver.value = withTiming(1, { duration: 200 })
          })
        })
      })
      .onFinalize((_event, success) => {
        // L4 fix — if gesture cancelled before onEnd (outer pager took
        // over, app backgrounded mid-pan), restore pill + chevrons.
        // Without this, rapid back-and-forth swipes can leave translateX
        // stuck wherever onUpdate last set it.
        'worklet'
        if (!success) {
          wsPillTranslateX.value     = withTiming(0, { duration: 200 })
          wsChevronOpacityOver.value = withTiming(1, { duration: 200 })
        }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wsZoneIdx, wsCanGoPrev, wsCanGoNext, tileViewportW, outerScrollGesture]
  )

  const wsPillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: wsPillTranslateX.value }] }))
  const wsChevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: wsChevronOpacityOver.value }))

  // Tile-row inner-scroll gesture — when rendered inside the family paged
  // ScrollView, this Native gesture chains blocksExternalGesture on the
  // outer pager so horizontal swipes inside the tile row scroll the tile
  // row instead of paging between variants. When no outer is present
  // (standalone StrengthDetail), this is just a plain Native gesture
  // with no blocking — same as not having the GestureDetector at all.
  const tileRowInnerScrollGesture = useMemo(() => {
    let g = Gesture.Native()
    if (outerScrollGesture) g = g.blocksExternalGesture(outerScrollGesture)
    return g
  }, [outerScrollGesture])

  if (loading) {
    return (
      <View style={s.page}>
        <Skeleton style={{ height: 36, width: 36, borderRadius: 9999, marginBottom: 8 }} />
        <View style={{ gap: 8, marginBottom: 16 }}>
          <Skeleton style={{ height: 22, width: 200, borderRadius: 6 }} />
          <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
        </View>
        <View style={{ gap: 16 }}>
          {/* Projections */}
          <Skeleton style={{ height: 144, width: '100%', borderRadius: 16 }} />
          {/* Chart */}
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 16 }} />
          {/* Log list */}
          <Skeleton style={{ height: 320, width: '100%', borderRadius: 16 }} />
        </View>
      </View>
    )
  }

  if (efforts.length === 0) {
    return (
      <View style={s.page}>
        <BackButton />
        <Text style={s.helpText}>No efforts found for {exercise}.</Text>
      </View>
    )
  }

  // ── Type-based routing ────────────────────────────────────────────────────
  // Sled Work consolidated route runs FIRST — it doesn't have a matching
  // movementRecord (the base name "Sled Work" isn't a DB row; only the
  // [Push] and [Pull] variants are), so the other isCarry / isAssisted /
  // etc. checks all fall through here.
  if (isSledWorkConsolidated) return <SledWorkConsolidatedDetail efforts={efforts} onDelete={handleDeleteEffort} />
  if (isIsometric)        return <IsometricDetail        exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} hideHeader={propHideHeader} />
  if (isOlympic)          return <OlympicLiftDetail      exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} hideHeader={propHideHeader} />
  if (isBallistic)        return <BallisticLiftDetail    exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} hideHeader={propHideHeader} />
  if (isAssistedMachine)  return <AssistedMachineDetail  exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} hideHeader={propHideHeader} outerScrollGesture={outerScrollGesture} />
  if (isCarry)            return <CarryDetail            exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} hideHeader={propHideHeader} outerScrollGesture={outerScrollGesture} />
  // Bodyweight assisted variants fall through to the consolidated render
  // below; RepsOnlyDetail is only used for non-bodyweight assist edge cases.
  if (isBandKneeAssisted && !isBodyweightExercise) return <RepsOnlyDetail exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} assistType="band+knee" hideHeader={propHideHeader} />
  if (isBandAssisted     && !isBodyweightExercise) return <RepsOnlyDetail exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} assistType="band"      hideHeader={propHideHeader} />
  if (isKneeAssisted     && !isBodyweightExercise) return <RepsOnlyDetail exercise={exercise} efforts={efforts} onDelete={handleDeleteEffort} assistType="knee"      hideHeader={propHideHeader} />

  // ── Rep-based derivations (standard bodyweight or weighted) ──────────────
  const best = efforts.reduce<{ oneRM: number; unit: string } | null>((acc, e) => {
    const parsed = parseOneRM(e.value)
    if (!parsed) return acc
    if (!acc || parsed.oneRM > acc.oneRM) return parsed
    return acc
  }, null)

  const unit      = best?.unit || 'lb'
  const bestOneRM = best?.oneRM ?? 0

  // `bestReps` drives the Full RX tile-grid math — MUST only count Full RX
  // efforts, not assisted-tier efforts.
  const rxOnlyEfforts = isBodyweightExercise
    ? efforts.filter(e => bwTierFromVariantName(e.label.split(' · ')[0]) === 'rx')
    : []

  const bestReps = isBodyweightExercise
    ? Math.max(0, ...rxOnlyEfforts.map(e => parseRepsFromLabel(e.label)))
    : 0

  const bestRepsEffort = isBodyweightExercise && rxOnlyEfforts.length > 0
    ? rxOnlyEfforts.reduce((b, e) => {
        const bReps = parseRepsFromLabel(b.label)
        const eReps = parseRepsFromLabel(e.label)
        if (eReps > bReps) return e
        if (eReps === bReps && parseAddedWeightFromLabel(e.label) > parseAddedWeightFromLabel(b.label)) return e
        return b
      })
    : null
  const bestRepsAddedWeight = bestRepsEffort ? parseAddedWeightFromLabel(bestRepsEffort.label) : 0

  const profileBW   = (profile?.current_weight as number | null | undefined) ?? null
  const profileUnit = (profile?.weight_unit as 'lb' | 'kg' | undefined) || (unit as 'lb' | 'kg')

  const effectiveOneRM = isBodyweightExercise && bestOneRM === 0 && profileBW && bestReps > 0
    ? estimate1RM(profileBW, bestReps)
    : bestOneRM

  const projections = effectiveOneRM > 0 ? projectAllRMs(effectiveOneRM, 1) : []

  // ── Latest effort + rep-range context (mirror of web) ─────────────────────
  const repRangeLo: number | null = (movementRecord as any)?.rep_range_lo ?? null
  const repRangeHi: number | null = (movementRecord as any)?.rep_range_hi ?? null
  const lastEffort = efforts.length > 0 ? efforts[efforts.length - 1] : null
  const lastReps   = lastEffort ? parseRepsFromLabel(lastEffort.label) : 0
  const lastWeight = lastEffort
    ? (isBodyweightExercise
        ? parseAddedWeightFromLabel(lastEffort.label)
        : parseWeightFromLabel(lastEffort.label))
    : 0

  // ── Bodyweight tiles (mirror of web) ──────────────────────────────────────
  // The shape of `bwTiles` depends on `weightedProgression`:
  //
  // WEIGHTED PROGRESSION (Pull Up, Dip, Push Up family, etc.):
  //   Tiles are always reps 1..10. Modes:
  //     • locked    — rep count not yet achieved (above current best). Greyed.
  //     • push      — the AT-MAX tile while still in Phase 1 (best < threshold).
  //                   Tile shows "→ (best+1)"; card says "push for one more rep".
  //     • weighted  — every other achievable tile. Tile shows "+X lb"; card
  //                   prescribes belt/vest training at that rep count.
  //   `isGraduation` is still computed for type compatibility but no longer
  //   rendered — the hero falls through to the standard weighted-tile body.
  //
  // REP-ONLY (Burpee, Sit Up, Mountain Climber, etc.):
  //   Tiles come from one of three stages based on bestReps:
  //     Stage 1 (bestReps < 11):  [1..10]
  //     Stage 2 (11 ≤ bestReps ≤ 20):  [11..20]
  //     Stage 3 (bestReps ≥ 21):  [25, 50, 75, 100, 125, 145, 160, 175, 190, 200]
  //   Modes:
  //     • achieved  — tile rep count ≤ bestReps. Renders a Check icon.
  //     • push      — the smallest stage value > bestReps. Tile shows "→ r".
  //     • locked    — every tile above the push tile. Tile shows "—".
  //   `addedWeight`, `plates`, `isGraduation` are unused (null / [] / false).
  interface BwTile {
    reps:         number
    mode:         'locked' | 'push' | 'weighted' | 'achieved'
    addedWeight:  number | null
    plates:       number[]
    achievable:   boolean
    nextRep?:     number
    isGraduation: boolean
  }

  const bwTiles: BwTile[] = (() => {
    if (isBodyweightExercise && !weightedProgression) {
      const stage = pickRepOnlyStage(bestReps)
      const pushIdx = stage.findIndex(r => r > bestReps)
      return stage.map((r, i) => {
        if (r <= bestReps) {
          return { reps: r, mode: 'achieved', addedWeight: null, plates: [], achievable: true, isGraduation: false }
        }
        if (i === pushIdx) {
          return { reps: r, mode: 'push', addedWeight: null, plates: [], achievable: true, nextRep: r, isGraduation: false }
        }
        return { reps: r, mode: 'locked', addedWeight: null, plates: [], achievable: false, isGraduation: false }
      })
    }

    return Array.from({ length: 10 }, (_, i) => i + 1).map<BwTile>(r => {
      const achievable = r <= bestReps
      const proj       = projections.find(p => p.reps === r)

      if (!proj || !achievable) {
        return { reps: r, mode: 'locked', addedWeight: null, plates: [], achievable, isGraduation: false }
      }

      if (r === bestReps && bestReps < BODYWEIGHT_THRESHOLD) {
        return { reps: r, mode: 'push', addedWeight: null, plates: [], achievable, nextRep: r + 1, isGraduation: false }
      }

      const bestActualAdded = efforts
        .filter(e => parseRepsFromLabel(e.label) === r)
        .map(e => parseAddedWeightFromLabel(e.label))
        .reduce((max, v) => Math.max(max, v), 0)

      const baseWeight   = profileBW ?? effectiveOneRM
      const formulaAdded = Math.max(0, proj.weight - baseWeight)
      const targetRaw    = bestActualAdded > 0
        ? Math.max(formulaAdded, bestActualAdded + 0.001)
        : formulaAdded
      const nextAdded    = targetRaw > 0 ? getNextAddedWeight(targetRaw, profileUnit) : null

      const isGraduation = (r === bestReps) && (bestReps === BODYWEIGHT_THRESHOLD) && (bestActualAdded === 0)

      return {
        reps:         r,
        mode:         'weighted',
        addedWeight:  nextAdded?.weight ?? 0,
        plates:       nextAdded?.plates ?? [],
        achievable,
        isGraduation,
      }
    })
  })()

  const selectedBWTile = bwTiles.find(t => t.reps === selectedRM) ?? null

  // ── Bodyweight consolidated: per-tier data ────────────────────────────────
  // Mirrors the same block in MyRX/src/pages/StrengthDetail.jsx. Buckets every
  // effort by tier, computes the best-reps achieved per tier, and decides the
  // active tier + its hero-card state.
  const bwEffortsByTier: Record<BwTier, Effort[]> = (() => {
    const buckets: Record<BwTier, Effort[]> = { 'band+knee': [], 'knee': [], 'band': [], 'rx': [] }
    if (!isBodyweightExercise) return buckets
    efforts.forEach(e => {
      const t = bwTierFromVariantName(e.label.split(' · ')[0])
      buckets[t].push(e)
    })
    return buckets
  })()

  const bwBestByTier: Record<BwTier, number> = (() => {
    const out: Record<BwTier, number> = { 'band+knee': 0, 'knee': 0, 'band': 0, 'rx': 0 }
    ;(Object.entries(bwEffortsByTier) as [BwTier, Effort[]][]).forEach(([t, efs]) => {
      efs.forEach(e => {
        const r = parseRepsFromBwLabel(e.label) || 0
        if (r > out[t]) out[t] = r
      })
    })
    return out
  })()

  // HIGHEST → LOWEST order. The carousel slot order (left → right) puts the
  // highest tier at slot 0 (leftmost) so the page lands on Full RX (or the
  // user's highest reached tier) by default; chevrons point right toward
  // lower assisted tiers.
  const bwLoggedTiers: BwTier[] = BW_TIERS.filter(t => bwEffortsByTier[t].length > 0).reverse()
  const bwHighestTier: BwTier = bwLoggedTiers.length > 0 ? bwLoggedTiers[0] : 'rx'

  const bwGraduationDate = (tier: BwTier): string | null => {
    const next = bwNextTier(tier)
    if (!next) return null
    const effs = bwEffortsByTier[next]
    if (effs.length === 0) return null
    return effs[0].created_at
  }

  const bwActiveTier: BwTier = bwSelectedTier ?? bwHighestTier

  const bwLatestBandLevel: string | null = (() => {
    if (bwActiveTier !== 'band' || bwEffortsByTier.band.length === 0) return null
    const lastBand = bwEffortsByTier.band[bwEffortsByTier.band.length - 1]
    return parseBandLevelFromBwLabel(lastBand.label)
  })()

  // ── Weighted projections ─────────────────────────────────────────────────
  const selectedProjection = !isBodyweightExercise
    ? projections.find(p => p.reps === selectedRM) ?? null
    : null

  // ── Weighted-standard next-target (mirror of web; see CLAUDE.md spec) ──
  const current_1RM = bestOneRM
  const selRepRange = selectedRM
  const selProj     = selectedProjection?.weight ?? 0
  const selRawForBig: number = selRepRange === 1
    ? Math.max(current_1RM, selProj)
    : selProj
  const selCueWeight: number = selRepRange === 1
    ? loadableWeight(current_1RM, equipmentType as LadderEquipment, unit as 'lb' | 'kg')
    : loadableWeight(selRawForBig, equipmentType as LadderEquipment, unit as 'lb' | 'kg')
  const selBigWeightRaw: number | null = nextLoadableAbove(selRawForBig, equipmentType as LadderEquipment, unit as 'lb' | 'kg')
  const selBigWeight: number = selBigWeightRaw ?? selCueWeight

  const selZone: AdpZone   = adpZoneFor(selRepRange)
  const selZoneCfg         = ADP_ZONE_CONFIG[selZone]
  // Note: weighted-standard adp-zone pill swipe hooks (useMemo gesture +
  // useAnimatedStyles) are declared above the early returns at the top of
  // the component, so rules-of-hooks ordering stays stable.

  const targetWeight: number = selBigWeight

  // ── Submaximal WORKING weight for the cue (Fix 1.1 / T088) ───────────────
  // Working sets use a weight you could do `reserve` MORE reps than the tile's
  // rep target (reps-in-reserve) — NOT the rep-max. You double-progress up to
  // selBigWeight (140), which stays the PR test/target shown big up top.
  const selReserve: number     = selZoneCfg.reserve
  const couldDoReps: number    = Math.min(20, selRepRange + selReserve)
  const workingProjRaw: number = projections.find(p => p.reps === couldDoReps)?.weight ?? selProj
  const workingWeight: number  = nearestLoadableWeight(workingProjRaw, equipmentType as LadderEquipment, unit as 'lb' | 'kg')
  const workingNextAbove: number | null = nextLoadableAbove(workingWeight, equipmentType as LadderEquipment, unit as 'lb' | 'kg')
  const workingJump: number    = workingNextAbove != null
    ? Math.round((workingNextAbove - workingWeight) * 100) / 100
    : (unit === 'kg' ? 2.5 : 5)

  const targetPlatesBarbell: number[] = (equipmentType === 'barbell')
    ? platesForBarbellWeight(targetWeight, unit as 'lb' | 'kg')
    : []
  const targetPlatesAdded: number[] = (equipmentType === 'bodyweight')
    ? platesForAddedWeight(targetWeight, unit as 'lb' | 'kg')
    : []

  const usesPair: boolean = !!(movementRecord as any)?.uses_pair

  // Weighted: est. 1RM over time. Bodyweight: max-attempt reps over time
  // across all tiers (one line; tier carried in the tooltip via fmt).
  const chartData = isBodyweightExercise
    ? efforts
        .map(e => {
          const r = parseRepsFromBwLabel(e.label)
          if (r === null) return null
          return { ts: e.created_at, y: r }
        })
        .filter((p): p is { ts: string; y: number } => p !== null)
    : efforts
        .map(e => {
          const parsed = parseOneRM(e.value)
          return parsed ? { ts: e.created_at, y: parsed.oneRM } : null
        })
        .filter((p): p is { ts: string; y: number } => p !== null)

  return (
    <View style={s.page}>

      {/* Header — suppressed when this StrengthDetail is rendered as a
          slot inside FamilyConsolidatedDetail (propHideHeader=true). The
          wrapper renders its own header once at the top of the page; each
          slot inside the paged ScrollView only renders the body content. */}
      {!propHideHeader && (
      <View>
        <BackButton />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.h1}>{isBodyweightExercise ? baseExercise : exercise}</Text>
          {isBodyweightExercise && canHaveTiers && bwLoggedTiers.length > 0 && (
            <View style={{
              borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.3),
              backgroundColor: withAlpha(palette.blue[500], 0.15),
              paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
            }}>
              <Text style={{
                fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: 0.5, color: palette.blue[400],
              }}>
                {bwTierBadge(bwHighestTier)}
              </Text>
            </View>
          )}
        </View>
        {isBodyweightExercise ? (
          bwLoggedTiers.length > 0 ? (
            <View style={[s.subRow, { flexWrap: 'wrap' }]}>
              <Text style={s.subText}>Best — </Text>
              <TickerNumber value={bwBestByTier[bwHighestTier]} fontSize={14} color={palette.blue[400]} fontWeight="600" />
              <Text style={[s.subText, s.subValueBlue]}> max attempts</Text>
              {canHaveTiers && (
                <>
                  <Text style={s.subText}> on </Text>
                  <Text style={[s.subText, { fontWeight: '600', color: colors.foreground }]}>{bwTierLabel(bwHighestTier)}</Text>
                </>
              )}
            </View>
          ) : (
            <Text style={s.subText}>No efforts logged yet</Text>
          )
        ) : (
          <View style={s.subRow}>
            <Text style={s.subText}>Best Est. 1RM — </Text>
            <TickerNumber value={bestOneRM} fontSize={14} color={palette.blue[400]} fontWeight="600" />
            <Text style={[s.subText, s.subValueBlue]}> {unit}</Text>
          </View>
        )}
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{equipmentPillLabel(movementRecord?.equipment ?? equipmentType)}</Text>
        </View>
      </View>
      )}

      {/* Bodyweight consolidated branch — see CLAUDE.md spec. */}
      {isBodyweightExercise ? (
        bwLoggedTiers.length === 0 ? (
          <AnimateRise delay={0} style={s.card}>
            <Text style={s.helpText}>Log your first effort to start tracking your progression.</Text>
          </AnimateRise>
        ) : (
          /* AnimateRise wraps the whole tier pager so the BW main content
             slides in (delay 0) at the same time as the chart (delay 120)
             and log (delay 240) — matches every other detail page's
             staggered entrance. Without this the BW page used to render
             instantly while the chart + log slid in below. No `style` prop
             so we don't wrap it in another card chrome — the inner
             per-tier slot already has its own s.card. */
          <AnimateRise delay={0}>
            <BodyweightConsolidatedBlock
              bwLoggedTiers={bwLoggedTiers}
              bwActiveTier={bwActiveTier}
              bwBestByTier={bwBestByTier}
              bwHighestTier={bwHighestTier}
              bwTiles={bwTiles}
              selectedBWTile={selectedBWTile}
              profileUnit={profileUnit}
              selectedRM={selectedRM}
              setSelectedRM={setSelectedRM}
              bwTierInfoOpen={bwTierInfoOpen}
              setBwTierInfoOpen={setBwTierInfoOpen}
              setBwSelectedTier={setBwSelectedTier}
              bwTierScrollRef={bwTierScrollRef}
              bwTierSlotWidths={bwTierSlotWidths}
              bwGraduationDate={bwGraduationDate}
              bwLatestBandLevel={bwLatestBandLevel}
              bwEffortsByTier={bwEffortsByTier}
              canHaveTiers={canHaveTiers}
              weightedProgression={weightedProgression}
            />
          </AnimateRise>
        )
      ) : (
        /* Weighted-standard branch — mirror of web. See CLAUDE.md spec. */
        <AnimateRise delay={0} style={s.card}>
          <Text style={s.h2}>Rep-max projections</Text>
          <Text style={[s.helpText, { marginTop: -6 }]}>Pick an adaptation zone, then tap a rep target.</Text>

          {/* Single active adp-zone pill, flanked by pulsing chevrons. Same
              choreography as the bodyweight pill row — the pill follows the
              finger on pan, slides off on commit, label updates, pill slides
              in from the opposite side, and the first tile of the new zone
              centres in the tile row below. See CLAUDE.md. */}
          <GestureDetector gesture={wsPillSwipeGesture}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8, paddingVertical: 6 }}>
              <Animated.View style={[{ width: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }, wsChevronAnimatedStyle]}>
                {wsCanGoPrev && (
                  <Pressable
                    onPress={() => navigateZone(-1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Previous zone"
                  >
                    <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>

              <Animated.View
                style={[
                  {
                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                    borderWidth: 1, borderColor: palette.blue[500],
                    backgroundColor: withAlpha(palette.blue[500], 0.15),
                  },
                  wsPillAnimatedStyle,
                ]}
              >
                <Text
                  style={{
                    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 0.5, color: palette.blue[400],
                  }}
                  numberOfLines={1}
                >
                  {ADP_ZONE_CONFIG[selZone].label}
                </Text>
              </Animated.View>

              <Animated.View style={[{ width: 56, flexDirection: 'row', alignItems: 'center' }, wsChevronAnimatedStyle]}>
                {wsCanGoNext && (
                  <Pressable
                    onPress={() => navigateZone(1)}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                    hitSlop={8}
                    accessibilityLabel="Next zone"
                  >
                    <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                    <View style={{ marginLeft: -6 }}>
                      <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Horizontal scrollable tile row — wrapped in a GestureDetector
              that chains blocksExternalGesture on the outer pager when
              inside FamilyConsolidatedDetail. Without this, the outer
              paged ScrollView grabs every horizontal touch first and the
              user can never scroll through 1RM → 20RM tiles. */}
          <GestureDetector gesture={tileRowInnerScrollGesture}>
          <ScrollView
            ref={tileScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: 2 }}
            style={{ marginHorizontal: -2 }}
            // Capture the viewport width so `scrollToZone` can centre the
            // first tile of the active zone in this row.
            onLayout={(e) => setTileViewportW(e.nativeEvent.layout.width)}
            // Track the current scroll position so `smoothScrollTileTo` can
            // animate from wherever the row actually is right now (whether
            // moved manually or programmatically).
            scrollEventThrottle={16}
            onScroll={(e) => { tileScrollPosRef.current = e.nativeEvent.contentOffset.x }}
          >
            {/* Cap the strip at 15RM (T088 Fix 1.3): rep-max projection is only
                accurate to ~10 reps, so 16-20RM tiles were noise. 13-15RM stay
                (the Endurance zone needs 13+) but are flagged with "≈". */}
            {projections.filter(({ reps }) => reps <= 15).map(({ reps: r, weight: w }) => {
              const isSelected = selectedRM === r
              const pct = effectiveOneRM > 0 ? Math.round((w / effectiveOneRM) * 100) : 0
              const isEstimate = r >= 13
              return (
                <Pressable
                  key={r}
                  onPress={() => onTilePress(r)}
                  onLayout={(e) => {
                    tileOffsets.current[r] = e.nativeEvent.layout.x
                    tileWidths.current[r]  = e.nativeEvent.layout.width
                  }}
                  style={{
                    minWidth: 68, paddingHorizontal: 12, paddingVertical: 10,
                    borderRadius: 9, borderWidth: 1,
                    borderColor: isSelected ? palette.blue[500] : colors.border,
                    backgroundColor: isSelected ? withAlpha(palette.blue[500], 0.15) : alpha(colors.card, 0.4),
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: isSelected ? palette.blue[400] : colors.mutedForeground,
                  }}>
                    {r}RM
                  </Text>
                  <View style={{ marginTop: 2 }}>
                    {/* Plain Text — tiles must NOT use TickerNumber per the
                        locked rule (rolling digits inside a tile-style grid
                        adds noise; tiles are status indicators that change
                        wholesale when tapped). See CLAUDE.md "TickerNumber
                        slot-machine animation" — locked list of where it
                        lives and where it does not. */}
                    <Text style={{
                      fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
                      fontSize: 16, fontWeight: '700',
                      color: isSelected ? palette.blue[400] : colors.foreground,
                    }}>
                      {isEstimate ? `≈${w}` : w}
                    </Text>
                  </View>
                  <Text style={{
                    marginTop: 2,
                    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
                    fontSize: 9,
                    color: isSelected ? withAlpha(palette.blue[400], 0.7) : alpha(colors.mutedForeground, 0.5),
                  }}>
                    {pct}%
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
          </GestureDetector>

          <Text style={s.tinyText}>Epley · Brzycki · Lombardi averaged · % of 1RM</Text>
          <Text style={s.tinyText}>≈ 13RM+ are rough estimates — rep-max math is most accurate up to ~10 reps</Text>

          {selectedProjection && (
            /* `calloutWeighted` sets `minHeight: 220` so every weighted
               equipment variant (barbell / dumbbell / kettlebell / machine /
               strongman) renders at the same height. */
            <NextTargetCallout style={s.calloutWeighted}>
              {/* Title text removed (NextTargetCallout already provides it).
                  Adp-zone pill is the only header element here. */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={() => setZoneInfoOpen((o) => !o)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 8, paddingVertical: 2,
                    borderRadius: 999, borderWidth: 1,
                    borderColor: withAlpha(palette.blue[500], 0.4),
                    backgroundColor: withAlpha(palette.blue[500], 0.1),
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: palette.blue[400] }} numberOfLines={1}>
                    {selZoneCfg.label}
                  </Text>
                  <Info size={11} color={palette.blue[400]} />
                </Pressable>
              </View>

              {/* Inline expandable adp zone info panel — direct-height-animation
                  (Pattern 5). The panel's real height grows/shrinks so the
                  big-weight block below slides naturally via layout flow. */}
              <ExpandPanel open={zoneInfoOpen}>
                <View
                  style={{
                    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.15),
                    backgroundColor: alpha(colors.card, 0.6), borderRadius: 6,
                    paddingHorizontal: 10, paddingVertical: 8, marginTop: 4,
                  }}
                >
                  <Text style={[s.calloutLabel, { color: colors.foreground, fontWeight: '700', fontSize: 12, marginBottom: 4 }]}>
                    {selZoneCfg.label}
                  </Text>
                  <Text style={[s.tinyText, { lineHeight: 16 }]}>{selZoneCfg.whyText}</Text>
                </View>
              </ExpandPanel>

              {/* Big weight + equipment-specific RHS. */}
              <View>
              {equipmentType === 'barbell' && (
                <>
                  <View style={s.targetRow}>
                    <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                      <TickerNumber value={targetWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{unit}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.tinyText, { marginBottom: 4 }]}>per side</Text>
                      <View style={s.plateChipRow}>
                        {targetPlatesBarbell.map((p, i) => (
                          <View key={i} style={s.plateChip}>
                            <Text style={s.plateChipText}>{p}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                  <Text style={s.tinyText}>
                    {unit === 'kg' ? 20 : 45} {unit} bar + {targetPlatesBarbell.join(' + ') || '—'} {unit} per side
                  </Text>
                </>
              )}

              {equipmentType === 'dumbbell' && (
                <>
                  <View style={s.targetRow}>
                    <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                      <TickerNumber value={targetWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{unit}</Text>
                    </View>
                    <Text style={s.calloutSubText}>each hand</Text>
                  </View>
                  <Text style={s.tinyText}>
                    Pick the {targetWeight} {unit} dumbbells — one in each hand
                  </Text>
                </>
              )}

              {equipmentType === 'kettlebell' && (
                <>
                  <View style={s.targetRow}>
                    <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                      <TickerNumber value={targetWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{unit}</Text>
                    </View>
                    <Text style={s.calloutSubText}>{usesPair ? 'each hand' : 'kettlebell'}</Text>
                  </View>
                  <Text style={s.tinyText}>
                    {usesPair
                      ? `Pick a pair of ${targetWeight} ${unit} kettlebells`
                      : `Pick the ${targetWeight} ${unit} kettlebell`}
                  </Text>
                </>
              )}

              {equipmentType === 'machine' && (
                <>
                  <View style={s.targetRow}>
                    <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                      <TickerNumber value={targetWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{unit}</Text>
                    </View>
                    <Text style={s.calloutSubText}>pin setting</Text>
                  </View>
                  <Text style={s.tinyText}>
                    Set the pin to {targetWeight} {unit}
                  </Text>
                </>
              )}

              {equipmentType === 'strongman' && (
                <>
                  <View style={s.targetRow}>
                    <View style={[s.calloutValueRow, { marginTop: 2 }]}>
                      <TickerNumber value={targetWeight} fontSize={36} color={palette.blue[400]} fontWeight="700" />
                      <Text style={s.calloutSubText}>{unit}</Text>
                    </View>
                    <Text style={s.calloutSubText}>load</Text>
                  </View>
                  <Text style={s.tinyText}>
                    Use the {targetWeight} {unit} stone, sandbag, or D-ball (or closest available)
                  </Text>
                </>
              )}
              </View>

              {/* Thin separator, then the prescription + rest line. */}
              <View
                style={{
                  marginTop: 10, paddingTop: 10,
                  borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15),
                  gap: 2,
                }}
              >
                {selRepRange === 1 ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>Hit one clean rep at </Text>
                      <TickerNumber value={targetWeight} fontSize={14} color={palette.blue[400]} fontWeight="700" />
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> {unit}</Text>
                    </View>
                    <Text style={s.tinyText}>Benchmark attempt</Text>
                  </>
                ) : (
                  <>
                    {/* Work line — submaximal WORKING weight (Fix 1.1 / T088), not the rep-max target */}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Text style={s.calloutLabel}>Do </Text>
                      <Text style={{ color: colors.foreground, fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}>{selZoneCfg.setsText}</Text>
                      <Text style={s.calloutLabel}> of </Text>
                      <TickerNumber value={selRepRange} fontSize={14} color={colors.foreground} fontWeight="700" />
                      <Text style={{ color: colors.foreground, fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> reps</Text>
                      <Text style={s.calloutLabel}> at </Text>
                      <TickerNumber value={workingWeight} fontSize={14} color={palette.blue[400]} fontWeight="700" />
                      <Text style={{ color: palette.blue[400], fontWeight: '700', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], fontSize: 14 }}> {unit}</Text>
                    </View>
                    <Text style={s.tinyText}>A weight you could do {couldDoReps} — but only do {selRepRange}</Text>
                    <Text style={s.tinyText}>Add {workingJump} {unit} each time all sets are clean — work up to {selRepRange} × {targetWeight} {unit}</Text>
                    <Text style={s.tinyText}>Rest {selZoneCfg.restText} between sets</Text>
                  </>
                )}
              </View>
            </NextTargetCallout>
          )}
        </AnimateRise>
      )}

      {/* Progress chart */}
      {chartData.length >= 1 && (
        <AnimateRise delay={250} style={s.card}>
          <Text style={s.h2}>
            {isBodyweightExercise ? 'Max attempts over time' : 'Est. 1RM over time'}
          </Text>
          <LineChart
            data={chartData}
            referenceY={chartData.length > 1
              ? (isBodyweightExercise ? bwBestByTier[bwHighestTier] : bestOneRM)
              : null}
            yTickFormatter={(v) => `${Math.round(v)}`}
            tooltipValueFormatter={(v) =>
              isBodyweightExercise ? `${Math.round(v)} reps` : `${Math.round(v)} ${unit}`
            }
            tooltipLabel={isBodyweightExercise ? 'Max attempts' : 'Est. 1RM'}
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.9)),
              max: (mx) => Math.round(mx * 1.1),
            }}
            caption={
              <Text style={s.tinyText}>
                Dashed line = personal best
                {isBodyweightExercise && ' on ' + bwTierLabel(bwHighestTier)}
              </Text>
            }
          />
        </AnimateRise>
      )}

      {/* Efforts history */}
      <EffortsHistorySection
        efforts={efforts}
        onDelete={handleDeleteEffort}
        delay={500}
        renderLeft={e => {
          const tail = e.label.split(' · ').slice(1).join(' · ')
          return (
            <View>
              <Text style={s.listRowName}>{tail}</Text>
              <Text style={s.listRowDateSm}>{fmtDate(e.created_at)}</Text>
            </View>
          )
        }}
        renderRight={e => {
          const parsed = parseOneRM(e.value)
          // For bodyweight use the multi-format parser so Knee + Full RX
          // labels (`· N reps`) report correctly.
          const reps   = isBodyweightExercise
            ? (parseRepsFromBwLabel(e.label) || 0)
            : parseRepsFromLabel(e.label)
          if (isBodyweightExercise) {
            const rowTier = bwTierFromVariantName(e.label.split(' · ')[0])
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.listRowSubLabel}>max attempts</Text>
                  <Text style={s.valBlue}>{reps}</Text>
                </View>
                <View style={{
                  borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.3),
                  backgroundColor: withAlpha(palette.blue[500], 0.15),
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                }}>
                  <Text style={{
                    fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
                    letterSpacing: 0.5, color: palette.blue[400],
                  }}>
                    {bwTierBadge(rowTier)}
                  </Text>
                </View>
              </View>
            )
          }
          if (parsed) {
            return (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.listRowSubLabel}>Est. 1RM</Text>
                <Text style={s.valBlue}>{parsed.oneRM} {parsed.unit}</Text>
              </View>
            )
          }
          return null
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const BLUE_BG_SOFT   = withAlpha(palette.blue[500], 0.08)
const BLUE_BORDER    = withAlpha(palette.blue[500], 0.30)
const BLUE_BORDER_DIM = withAlpha(palette.blue[500], 0.40)

const s = StyleSheet.create({
  page: { gap: 24 },

  // ── Back button ─────────────────────────────────────────────────────────
  // Native-style chevron-only back affordance. Negative marginLeft visually
  // aligns the chevron's stroke with the H1 below (chevrons have built-in
  // optical padding). marginBottom keeps spacing parity with the old
  // text-label version.
  backBtn:  { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 8, padding: 4 },

  // ── Headings ────────────────────────────────────────────────────────────
  h1:      { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  subText: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },
  subRow:  {
    flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2,
  },
  subValueBlue: {
    color: palette.blue[400],
    fontFamily: fonts.mono[400],
    fontVariant: ['tabular-nums'],
  },
  h2:      { color: colors.foreground, fontSize: 14, fontWeight: '600' },

  // ── Common card ─────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 20, gap: 16,
  },
  cardNoPad: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, overflow: 'hidden',
  },

  // ── Help text ───────────────────────────────────────────────────────────
  helpText: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  tinyText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },

  // ── Small inline chart pill labels (rendered above each chart) ──────────
  chartTagBlue: {
    alignSelf: 'center',
    backgroundColor: withAlpha(palette.blue[500], 0.10),
    borderColor: withAlpha(palette.blue[500], 0.30),
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
    marginBottom: 4,
  },
  chartTagText: {
    color: palette.blue[400],
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: fonts.mono[600],
  },

  // ── Stat grid (carry detail) ─────────────────────────────────────────────
  statGrid: {
    flexDirection: 'row', gap: 12,
  },
  statTile: {
    flex: 1, gap: 4,
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 16,
  },
  statLabel: {
    color: colors.mutedForeground, fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statValue: {
    color: palette.blue[400], fontSize: 24,
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },
  statUnit: {
    color: colors.mutedForeground, fontSize: 14, fontWeight: '400',
  },

  // ── Tile grid items ─────────────────────────────────────────────────────
  tile: {
    borderWidth: 1, borderRadius: 9,
    padding: 8,
    alignItems: 'center', justifyContent: 'center',
    gap: 2,
  },
  tileSelected: {
    borderColor: palette.blue[500],
    backgroundColor: withAlpha(palette.blue[500], 0.15),
    transform: [{ scale: 1.05 }],
  },
  tileCurrent: {
    borderColor: BLUE_BORDER_DIM,
    backgroundColor: BLUE_BG_SOFT,
  },
  tileAchievable: {
    borderColor: alpha(colors.border, 0.6),
    backgroundColor: alpha(colors.card, 0.4),
  },
  tileLocked: {
    borderColor: alpha(colors.border, 0.3),
    backgroundColor: alpha(colors.card, 0.2),
    opacity: 0.35,
  },
  tileLabel: {
    color: colors.mutedForeground, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: 1,
    opacity: 0.7,                  // matches web's `opacity-70` on the `{r}RM` div
  },
  tileLabelMuted: { color: colors.mutedForeground },
  // text-xs (12) — used by isometric milestones + bodyweight tiles
  tileValueMono: {
    fontSize: 12,
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    color: colors.foreground,
    lineHeight: 14,                // leading-tight
  },
  // text-sm (14) — used by weighted rep-max projection tiles (`text-sm` on web)
  tileValueLg: {
    fontSize: 14,
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    color: colors.foreground,
  },
  tilePct: {
    fontSize: 9,
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
    lineHeight: 9,                 // leading-none
  },
  tileTextSelected:    { color: palette.blue[400] },
  tileTextCurrent:     { color: withAlpha(palette.blue[400], 0.8) },
  tileTextCurrentDim:  { color: withAlpha(palette.blue[400], 0.7) },
  tileTextAchievable:  { color: colors.foreground },
  tileTextLocked:      { color: alpha(colors.mutedForeground, 0.4) },

  // Small "✓" beneath an achieved milestone tile
  checkBlue: {
    fontSize: 9, color: withAlpha(palette.blue[400], 0.6), marginTop: 1,
  },

  // ── Blue "next training target" callout ─────────────────────────────────
  // Base callout chrome; per-detail-type min-height (where applied) lives
  // in the modifier style below.
  callout: {
    borderRadius: 9, paddingHorizontal: 16, paddingVertical: 16,
    backgroundColor: BLUE_BG_SOFT, borderColor: BLUE_BORDER, borderWidth: 1,
    gap: 8,
  },
  // Weighted standard card — sized for the tallest variant (barbell with
  // multiple plate chips on the per-side breakdown). BW deliberately has NO
  // modifier; each BW state renders at its natural size because forcing a
  // shared min-height left the shorter modes (Full RX push, locked, etc.)
  // with too much trailing empty space.
  calloutWeighted: { minHeight: 220 },
  calloutTitle: {
    color: palette.blue[400], fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },
  calloutValueRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 6,
  },
  calloutValue: {
    color: palette.blue[400], fontSize: 36,
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
    lineHeight: 36,
  },
  calloutSubText: { color: colors.mutedForeground, fontSize: 14 },
  calloutLabel:   { color: colors.mutedForeground, fontSize: 14 },

  targetRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  plateChipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end',
  },
  plateChip: {
    borderColor: BLUE_BORDER, borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  plateChipText: {
    color: palette.blue[400], fontSize: 11,
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },

  // ── Bodyweight progress bar (toward weighted threshold) ──────────────────
  progressRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressTrack: {
    height: 6, borderRadius: 9999,
    backgroundColor: colors.muted, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: palette.blue[500],
    borderRadius: 9999,
  },

  // ── Efforts history list ────────────────────────────────────────────────
  listHeader: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  listHeaderText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },

  listRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.card,
  },
  listRowDivider: {
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  listRowName: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  listRowMutedBold: { color: colors.mutedForeground, fontSize: 12, fontWeight: '500' },
  listRowDate: { color: colors.mutedForeground, fontSize: 12 },
  listRowDateSm: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  listRowSubLabel: { color: colors.mutedForeground, fontSize: 11 },

  valBlue: {
    color: palette.blue[400], fontSize: 14,
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },

  // ── Assisted-machine: bodyweight-gate CTA card ──────────────────────────
  // Replaces the rep-max projection + hero card when the user has no recent
  // bodyweight log (within 30 days). Uses the same blue chrome as the hero
  // callout so it visually slots into the same position.
  assistBwGateCard: {
    borderRadius: 12, padding: 20, gap: 12,
    borderWidth: 1, borderColor: BLUE_BORDER,
    backgroundColor: BLUE_BG_SOFT,
  },
  assistBwGateButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1, borderColor: palette.blue[500],
    backgroundColor: withAlpha(palette.blue[500], 0.15),
  },
  assistBwGateButtonText: {
    color: palette.blue[400], fontSize: 14, fontWeight: '600',
  },

  // ── Assisted-machine: reliability-warning chip (amber-tinted) ───────────
  // Renders above the projection card when the user's best effort had the
  // machine carrying > 75 % of their bodyweight (effective load < 25 % BW).
  assistWarningChip: {
    borderRadius: 9,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.4),
    backgroundColor: withAlpha(palette.amber[500], 0.1),
    marginBottom: -8,
  },
  assistWarningChipText: {
    color: palette.amber[400], fontSize: 12, lineHeight: 18,
  },

  // ── Carry detail card ───────────────────────────────────────────────────
  // Small inline tier badge next to the header best-PR line.
  carryTierBadge: {
    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.3),
    backgroundColor: withAlpha(palette.blue[500], 0.1),
    borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  carryTierBadgeText: {
    color: palette.blue[400],
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },

  // Sled Work PUSH | PULL variant toggle — mirrors the bodyweight tier
  // pill choreography exactly (single pill flanked by pulsing chevrons,
  // swipe to commit with slide-off / state-change / slide-in animation).
  // See SledWorkConsolidatedDetail for the gesture worklet.
  sledVariantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 6,
    alignSelf: 'stretch',
  },
  sledVariantChevronSlotLeft: {
    width: 56,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sledVariantChevronSlotRight: {
    width: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sledVariantChevronPressable: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Tier ladder — 4 horizontal tiles (BEGINNER / INTERMEDIATE / ADVANCED / STRONGMAN).
  carryTierRow: {
    flexDirection: 'row', gap: 8,
  },
  carryTierTileBase: {
    flex: 1, minWidth: 0,
    borderRadius: 9, borderWidth: 1,
    paddingHorizontal: 4, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  carryTierTileSelected: {
    borderColor: palette.blue[500],
    backgroundColor: withAlpha(palette.blue[500], 0.15),
    transform: [{ scale: 1.03 }],
  },
  carryTierTileAchieved: {
    borderColor: withAlpha(palette.blue[500], 0.4),
    backgroundColor: withAlpha(palette.blue[500], 0.08),
  },
  carryTierTileLocked: {
    borderColor: alpha(colors.border, 0.3),
    backgroundColor: alpha(colors.card, 0.2),
    opacity: 0.5,
  },
  carryTierTileLabel: {
    fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
    lineHeight: 11,
  },
  carryTierTileIconRow: {
    marginTop: 2, height: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  carryTierTileDash: {
    fontFamily: fonts.mono[400],
    fontSize: 10,
    color: alpha(colors.mutedForeground, 0.4),
  },

  // Shared inline info panel (used beneath the tier ladder row).
  carryInfoPanel: {
    borderRadius: 6, borderWidth: 1,
    borderColor: withAlpha(palette.blue[500], 0.15),
    backgroundColor: alpha(colors.card, 0.6),
    paddingHorizontal: 10, paddingVertical: 8,
  },
  carryInfoPanelText: {
    color: colors.mutedForeground,
    fontSize: 11, lineHeight: 16,
  },

  // Zone pill row (max_load / distance_build / conditioning).
  carryZoneRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginBottom: 4,
    // Vertical padding bumped from 6 → 14 so the inner pill row exposes a
    // taller hit area to gesture-handler. Visual chrome looks the same (the
    // pill chip's own height controls the rendered size), but a swipe that
    // starts a few px above or below the pill still lands inside the
    // GestureDetector and the inner Pan claims the touch instead of
    // falling through to the outer Sled Work pager.
    paddingVertical: 14,
  },
  carryZoneChevronSlotLeft: {
    width: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
  },
  carryZoneChevronSlotRight: {
    width: 56, flexDirection: 'row', alignItems: 'center',
  },
  carryZoneChevronPressable: {
    flexDirection: 'row', alignItems: 'center',
  },
  carryZonePill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
    borderWidth: 1, borderColor: palette.blue[500],
    backgroundColor: withAlpha(palette.blue[500], 0.15),
  },
  carryZonePillText: {
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
    color: palette.blue[400],
  },

  // Hero card — adp-zone info pill (top-right).
  carryZoneInfoPillButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1,
    borderColor: withAlpha(palette.blue[500], 0.4),
    backgroundColor: withAlpha(palette.blue[500], 0.1),
  },
  carryZoneInfoPillText: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    color: palette.blue[400],
  },
  carryHeroZoneInfoPanel: {
    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.15),
    backgroundColor: alpha(colors.card, 0.6),
    borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    marginTop: 4,
  },
  carryHeroZoneInfoTitle: {
    color: colors.foreground,
    fontSize: 12, fontWeight: '700',
    marginBottom: 4,
  },
  carryHeroZoneInfoBody: {
    color: colors.mutedForeground,
    fontSize: 11, lineHeight: 16,
  },

  // Dual target rows (Go heavier / Go further) inside the hero card.
  carryHeroDualRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  carryHeroDualSubLabel: {
    color: colors.mutedForeground,
    fontSize: 11, textAlign: 'right',
    maxWidth: '50%',
  },

  // Thin separator + cue line at the bottom of the hero card.
  carryHeroCueRow: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: withAlpha(palette.blue[500], 0.15),
  },
  carryHeroCueText: {
    color: colors.foreground,
    fontSize: 13, lineHeight: 18,
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// renderBestSubtitleFor — equipment-aware "Best …" subtitle for the family
// page header.
//
// SINGLE SOURCE OF TRUTH for per-equipment subtitle logic in the family
// wrapper. Mirrors the same format each equipment's standalone detail
// component renders for its own header so the family page reads
// identically to a single-variant page:
//
//   Weighted (barbell / dumbbell / machine / kettlebell / strongman):
//     "Best Est. 1RM — N lb"
//   Carry:
//     "Best — N lb · M m"   (per-effort max weight + max distance)
//   Isometric:
//     "Personal best — N min N sec"
//   Assisted:
//     "Best Est. 1RM — N lb assist"   (lowest assistance = best)
//   Bodyweight (unused — admin disables variants on BW):
//     falls through to weighted default.
//
// Returns JSX. Falls back to a plain "No efforts logged yet" Text when
// the active variant has zero efforts.
//
// Adding a new equipment type to the admin catalog requires adding one
// case here — that's the ONLY per-equipment code change a new equipment
// type needs in the family wrapper. Everything else (dispatch, paged
// ScrollView, pill chrome, gestures, slot rendering) is fully generic.
// ─────────────────────────────────────────────────────────────────────────────

function renderBestSubtitleFor(
  variant: { equipment?: string | null; strength_type?: string | null } | null,
  efforts: Effort[],
): React.ReactNode {
  if (!variant) return <Text style={s.subText}>No efforts logged yet</Text>

  // Isometric — duration max
  if (variant.strength_type === 'isometric') {
    let maxSecs = 0
    efforts.forEach(e => {
      const sec = parseDurationSecs(e.value)
      if (sec !== null && sec > maxSecs) maxSecs = sec
    })
    if (maxSecs <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Personal best — </Text>
        <Text style={[s.subText, s.subValueBlue]}>{fmtDurationLong(maxSecs)}</Text>
      </View>
    )
  }

  // Carry — per-effort max weight + max distance
  if (variant.equipment === 'carry') {
    let maxW = 0, wUnit = 'lb'
    let maxD = 0
    efforts.forEach(e => {
      const c = parseCarryFromLabel(e.label)
      if (!c) return
      if (c.weight > maxW) { maxW = c.weight; wUnit = c.unit }
      if (c.dist > maxD) maxD = c.dist
    })
    if (maxW <= 0 && maxD <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best — </Text>
        <TickerNumber value={maxW} fontSize={14} color={palette.blue[400]} fontWeight="600" />
        <Text style={[s.subText, s.subValueBlue]}> {wUnit} · </Text>
        <TickerNumber value={maxD} fontSize={14} color={palette.blue[400]} fontWeight="600" />
        <Text style={[s.subText, s.subValueBlue]}> m</Text>
      </View>
    )
  }

  // Assisted — lowest assistance = highest effective 1RM. Surface the
  // best (smallest) assistance value the user has logged.
  if (variant.equipment === 'assisted') {
    let minAssist = Infinity, aUnit = 'lb'
    efforts.forEach(e => {
      const a = parseAssistanceFromLabel(e.label)
      if (!a) return
      if (a.assistance < minAssist) { minAssist = a.assistance; aUnit = a.unit }
    })
    if (!Number.isFinite(minAssist)) return <Text style={s.subText}>No efforts logged yet</Text>
    return (
      <View style={s.subRow}>
        <Text style={s.subText}>Best — </Text>
        <TickerNumber value={minAssist} fontSize={14} color={palette.blue[400]} fontWeight="600" />
        <Text style={[s.subText, s.subValueBlue]}> {aUnit} assist</Text>
      </View>
    )
  }

  // Default — weighted standard (barbell / dumbbell / machine / kettlebell
  // / strongman). Max parseOneRM across the efforts.
  let maxOneRM = 0, unit = 'lb'
  efforts.forEach(e => {
    const p = parseOneRM(e.value)
    if (p && p.oneRM > maxOneRM) { maxOneRM = p.oneRM; unit = p.unit }
  })
  if (maxOneRM <= 0) return <Text style={s.subText}>No efforts logged yet</Text>
  return (
    <View style={s.subRow}>
      <Text style={s.subText}>Best Est. 1RM — </Text>
      <TickerNumber value={maxOneRM} fontSize={14} color={palette.blue[400]} fontWeight="600" />
      <Text style={[s.subText, s.subValueBlue]}> {unit}</Text>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FamilyConsolidatedDetail
//
// Sled Work-mirror wrapper for admin-added variant families (Bone, etc.).
// Byte-for-byte clone of SledWorkConsolidatedDetail's structure:
//   1. Static header (BackButton + h1 = parent name + subtitle + equipment
//      badge) — stays put as user swipes between variants.
//   2. Pill row — single blue pill in centre showing the active variant's
//      bracket label, flanked by pulsing BwAnimatedChevron pairs. Swipe-
//      driven slide-off + slide-in choreography matching Sled Work timing
//      (20 px threshold, 220 px slide, 250 ms duration).
//   3. Paged horizontal ScrollView — one slot per variant. Each slot
//      renders a full <StrengthDetail propExercise={variant.name}
//      propHideHeader /> instance. Native paging gives the continuous
//      "whole page slides" motion the user asked for.
// ─────────────────────────────────────────────────────────────────────────────

function FamilyConsolidatedDetail({
  parent,
  variants,
}: {
  parent: { id: string; name: string; equipment?: string | null }
  variants: ReadonlyArray<{
    id: string
    name: string
    equipment?: string | null
    strength_type?: string | null
    variant_short_label?: string | null
    created_at?: string
  }>
}) {
  // Slot order = variants that have AT LEAST ONE logged effort, preserving
  // the catalog order (already sorted by created_at in the route
  // dispatcher). Empty variants are hidden — no pill, no slot. Universal
  // rule mirroring Sled Work / Swimming: if Push has efforts but Drag
  // doesn't, only the PUSH pill renders and the page collapses to one
  // slot. If neither has efforts, the consolidated row wouldn't have
  // shown up in the strength index in the first place, so this never
  // reaches an empty render path — but we guard with a fallback anyway
  // so the page survives an "all variants deleted" state.
  //
  // `effortsByVariant` is async-loaded below, so on first render it's an
  // empty map → loggedVariants would be empty → render fallback. After
  // the fetch resolves we re-derive and show the filtered list.
  const [activeId, setActiveId] = useState<string>('')

  // ── Per-variant raw efforts (drives the header subtitle) ─────────────
  // Single query for all variants' efforts; grouped by variant id so
  // each pill swipe is an O(1) lookup. The subtitle JSX is computed at
  // render time by `renderBestSubtitleFor(variant, efforts)` which
  // dispatches on the variant's equipment / strength_type — this is the
  // ONE central place per-equipment subtitle logic lives. New equipment
  // types added to the admin catalog need one new case in that helper;
  // every other piece of the framework (dispatch, ScrollView, gestures,
  // pill row) is fully generic.
  const { user } = useAuth()
  const [effortsByVariant, setEffortsByVariant] = useState<Record<string, Effort[]>>({})
  useEffect(() => {
    if (!user || variants.length === 0) return
    let alive = true
    const labelFilters = variants.map(v => `label.ilike.${v.name} ·%`).join(',')
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'strength')
      .or(labelFilters)
      .then(({ data }) => {
        if (!alive) return
        // Sort by name length DESC so longer names win when two share a
        // prefix (defensive — admins might create overlapping bracket
        // suffixes).
        const sortedVariants = variants.slice().sort((a, b) => b.name.length - a.name.length)
        const map: Record<string, Effort[]> = {}
        ;(data || []).forEach((e: Effort) => {
          const variant = sortedVariants.find(v => e.label.startsWith(`${v.name} ·`))
          if (!variant) return
          ;(map[variant.id] ??= []).push(e)
        })
        setEffortsByVariant(map)
      })
    return () => { alive = false }
  }, [user, variants])
  // Filter to only variants that have at least one logged effort. Empty
  // variants get NO pill + NO slot. Fallback: when efforts haven't loaded
  // yet OR no variant has any efforts (defensive — shouldn't reach here
  // because the index row wouldn't have shown up), show ALL variants so
  // the page never renders zero slots.
  const loggedVariants = useMemo(() => {
    const filtered = variants.filter(v => (effortsByVariant[v.id]?.length ?? 0) > 0)
    return filtered.length > 0 ? filtered : variants
  }, [variants, effortsByVariant])
  const variantOrder = loggedVariants

  // Default activeId to the first logged variant once data arrives. If
  // the current activeId points at a variant that no longer has any
  // efforts (user deleted them all), snap to the first available.
  useEffect(() => {
    if (variantOrder.length === 0) return
    if (!activeId || !variantOrder.some(v => v.id === activeId)) {
      setActiveId(variantOrder[0].id)
    }
  }, [variantOrder, activeId])

  // Active variant + its efforts — both used by the subtitle helper.
  const activeVariantRow = variantOrder.find(v => v.id === activeId) ?? variantOrder[0] ?? null
  const activeEfforts = effortsByVariant[activeId] ?? []
  const currentIdx = Math.max(0, variantOrder.findIndex(v => v.id === activeId))
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < variantOrder.length - 1

  // ── Paged ScrollView slot sizing (mirrors Sled Work's pattern) ─────────
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  // Pre-seed slotWidth so the initial render lays slots out correctly.
  // Wrapper uses marginHorizontal: -PAGE_PADDING_HORIZONTAL to bleed edge-
  // to-edge, so measured width = full screen width.
  const [slotWidth, setSlotWidth] = useState(winWidth)
  const scrollRef = useRef<ScrollView>(null)

  // Expose the outer ScrollView's native scroll as a Gesture.Native() so
  // inner gestures inside each variant's StrengthDetail body (adp-zone
  // pill swipe, tile-row horizontal scroll) can chain
  // `blocksExternalGesture(outerScrollGesture)` on themselves. When an
  // inner gesture activates, the outer paged scroll is forced to fail
  // and the touch drives the inner gesture instead. Without this, the
  // outer pager wins every horizontal touch and the user can't swipe the
  // adp-zone pill or scroll through the 1RM-20RM tiles. Mirrors the same
  // pattern Sled Work uses for CarryDetail's inner gestures.
  // Memoised so identity is stable across renders — re-creating it would
  // force gesture-handler to re-attach every frame.
  const outerScrollGesture = useMemo(() => Gesture.Native(), [])

  // Initial scrollTo — runs once per mount, after slotWidth is measured,
  // to land on activeId's slot (always slot 0 by default, but defensive
  // in case `activeId` ever defaults to a non-zero slot via state init).
  const initialScrollDoneRef = useRef(false)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (slotWidth <= 0) return
    if (!scrollRef.current) return
    const idx = variantOrder.findIndex(v => v.id === activeId)
    if (idx < 0) return
    scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    initialScrollDoneRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWidth])

  // ── Pill swipe choreography (byte-for-byte Sled Work) ─────────────────
  const pillTranslateX        = useSharedValue(0)
  const chevronOpacityOverride = useSharedValue(1)

  const SWIPE_THRESHOLD_PX     = 20
  const SLIDE_OFFSCREEN_PX     = 220
  const SLIDE_DURATION_MS      = 250

  // navigateVariant — direction-aware. Updates state + programmatically
  // scrolls the body ScrollView to the new slot's offset. Used by pill
  // chevron taps AND by the pill Pan gesture (via runOnJS in onEnd).
  const navigateVariant = (direction: -1 | 1) => {
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= variantOrder.length) return
    setActiveId(variantOrder[newIdx].id)
    if (slotWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })
    }
  }

  const pillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        chevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate(e => {
        'worklet'
        pillTranslateX.value = e.translationX
      })
      .onEnd(e => {
        'worklet'
        const passed = Math.abs(e.translationX) >= SWIPE_THRESHOLD_PX
        const direction: -1 | 1 = e.translationX < 0 ? 1 : -1
        const canMove = (direction === 1 && hasNext) || (direction === -1 && hasPrev)
        if (!passed || !canMove) {
          pillTranslateX.value = withTiming(0, { duration: 200 })
          chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }
        const slideOff = direction === 1 ? -SLIDE_OFFSCREEN_PX : SLIDE_OFFSCREEN_PX
        pillTranslateX.value = withTiming(slideOff, { duration: SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateVariant)(direction)
          pillTranslateX.value = -slideOff
          pillTranslateX.value = withTiming(0, { duration: SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          })
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIdx, hasPrev, hasNext, variantOrder.length, slotWidth],
  )

  const pillAnimStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: pillTranslateX.value }] }))
  const chevronAnimStyle = useAnimatedStyle(() => ({ opacity: chevronOpacityOverride.value }))

  // Extract bracket label for pill text (e.g. "Bone [Ex 1]" → "Ex 1").
  const variantLabel = (name: string): string => {
    const m = name.match(/\[(.+)\]\s*$/)
    return m ? m[1] : name
  }
  const activeVariant = variantOrder[currentIdx]

  return (
    <View style={s.page}>
      {/* ── Static header ─────────────────────────────────────────────── */}
      <View>
        <BackButton />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.h1}>{parent.name}</Text>
        </View>

        {/* Best subtitle — equipment-aware, active variant only. Dispatched
            via renderBestSubtitleFor() which picks the right format based
            on the variant's equipment / strength_type. Single source of
            truth for per-equipment subtitle logic in the family wrapper.
            Updates instantly when the user swipes between variants because
            activeEfforts re-reads effortsByVariant[activeId]. */}
        {renderBestSubtitleFor(activeVariantRow, activeEfforts)}

        {/* Equipment badge — same chrome as standalone StrengthDetail */}
        <View style={[s.carryTierBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
          <Text style={s.carryTierBadgeText}>{equipmentPillLabel(parent.equipment ?? null)}</Text>
        </View>

        {/* ── Pill row — Sled Work clone ────────────────────────────── */}
        <GestureDetector gesture={pillSwipeGesture}>
          <View style={s.sledVariantRow}>
            {hasPrev ? (
              <Animated.View style={[s.sledVariantChevronSlotLeft, chevronAnimStyle]}>
                <Pressable
                  onPress={() => navigateVariant(-1)}
                  style={s.sledVariantChevronPressable}
                  hitSlop={8}
                  accessibilityLabel="Previous variant"
                >
                  <BwAnimatedChevron direction="left" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <BwAnimatedChevron direction="left" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.sledVariantChevronSlotLeft} />
            )}

            <Animated.View
              style={[
                {
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999,
                  borderWidth: 1, borderColor: palette.blue[500],
                  backgroundColor: withAlpha(palette.blue[500], 0.15),
                },
                pillAnimStyle,
              ]}
            >
              <Text style={{
                fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
                letterSpacing: 0.5, color: palette.blue[400],
              }}>
                {activeVariant ? variantLabel(activeVariant.name) : ''}
              </Text>
            </Animated.View>

            {hasNext ? (
              <Animated.View style={[s.sledVariantChevronSlotRight, chevronAnimStyle]}>
                <Pressable
                  onPress={() => navigateVariant(1)}
                  style={s.sledVariantChevronPressable}
                  hitSlop={8}
                  accessibilityLabel="Next variant"
                >
                  <BwAnimatedChevron direction="right" delay={0} color={withAlpha(palette.blue[400], 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <BwAnimatedChevron direction="right" delay={250} color={withAlpha(palette.blue[400], 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.sledVariantChevronSlotRight} />
            )}
          </View>
        </GestureDetector>
      </View>

      {/* ── Paged horizontal ScrollView — body slides between variants ──
            Wrapped in a GestureDetector bound to `outerScrollGesture` so
            inner gestures (adp-zone pill swipe, tile-row scroll inside
            each slot) can chain blocksExternalGesture on this to win
            horizontal touches before the outer pager activates. */}
      <View
        onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
        style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}
      >
        <GestureDetector gesture={outerScrollGesture}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={e => {
              if (slotWidth === 0) return
              const x = e.nativeEvent.contentOffset.x
              const idx = Math.round(x / slotWidth)
              const target = variantOrder[idx]
              if (target && target.id !== activeId) setActiveId(target.id)
            }}
          >
            {variantOrder.map(variant => (
              <View
                key={variant.id}
                style={{ width: slotWidth, paddingHorizontal: PAGE_PADDING_HORIZONTAL }}
              >
                <StrengthDetail
                  propExercise={variant.name}
                  propHideHeader
                  outerScrollGesture={outerScrollGesture}
                />
              </View>
            ))}
          </ScrollView>
        </GestureDetector>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export — route dispatcher.
//
// Reads the URL exercise param. If the param matches a PARENT row in the
// movements catalog (a row with no parent_movement_id but with children
// pointing at it via parent_movement_id), it's an admin-added variant
// family — render FamilyConsolidatedDetail. Otherwise render a standalone
// StrengthDetail driven by the URL.
//
// EXCLUDE hardcoded consolidated routes: "Sled Work" is structurally a
// family in the DB but has its own dedicated SledWorkConsolidatedDetail
// inside StrengthDetail's existing dispatch. Letting FamilyConsolidatedDetail
// take over would break that path. Add more exclusions here if other
// hardcoded families appear in the future.
// ─────────────────────────────────────────────────────────────────────────────

export default function StrengthDetailRoute() {
  const { exercise: rawExercise } = useLocalSearchParams<{ exercise: string }>()
  const exerciseFromUrl = typeof rawExercise === 'string' ? decodeURIComponent(rawExercise) : ''
  const dbMovements = useMovements()

  const isHardcodedRoute = exerciseFromUrl === 'Sled Work'

  const parent = useMemo(
    () => isHardcodedRoute
      ? null
      : (dbMovements.find(m => m.name === exerciseFromUrl && !m.parent_movement_id) ?? null),
    [dbMovements, exerciseFromUrl, isHardcodedRoute],
  )
  const variants = useMemo(
    () => parent
      ? dbMovements
          .filter(m => m.parent_movement_id === parent.id)
          .slice()
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      : [],
    [parent, dbMovements],
  )

  if (parent && variants.length >= 2) {
    return <FamilyConsolidatedDetail parent={parent} variants={variants} />
  }
  return <StrengthDetail />
}

