/**
 * AdminStrengthBodyweightDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's BODYWEIGHT CONSOLIDATED strength detail screen.
 *
 * Covers movements whose `movements.equipment === 'bodyweight'`. The four
 * assist tiers — Full RX / Band / Knee / Band + Knee — collapse onto a single
 * consolidated page (the athlete shows them as a swipe carousel; WEB renders
 * them as clickable tier pills, per the task brief).
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - CLAUDE.md → "Bodyweight consolidated detail card — locked design spec"
 *   - mobile/app/(app)/effort/strength/[exercise].tsx
 *       · BodyweightConsolidatedBlock component
 *       · the StrengthDetail render's `isBodyweightExercise` branch
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header        — base movement name + highest-tier badge
 *                      + "Best — N max attempts on <TIER>" (TickerNumber)
 *                      + BODYWEIGHT equipment category pill
 *   2. Tier pills    — clickable pill per logged tier (HIGHEST → LOWEST),
 *                      defaulting to the highest logged tier. (Replaces the
 *                      mobile gesture carousel with web tabs.)
 *   3. Tile grid     — 10 max-attempt tiles (1 REP … 10 REPS), achieved vs
 *                      locked. On assisted tiers, achievement is band-aware
 *                      (best at the CURRENT band level). Full RX tiles are
 *                      clickable (weighted progression / rep-only stages).
 *   4. Hero card     — per-tier state: assisted-working / ready-to-graduate /
 *                      graduated / Full RX 4-mode (locked / push / graduation /
 *                      weighted). Big numbers use TickerNumber. The band-level
 *                      sub-progression surfaces IMPLICITLY here (band-aware
 *                      tiles + cue + sub-line under the big number) exactly as
 *                      the athlete renders it — there is NO separate band
 *                      summary strip (the athlete has none either).
 *   5. Chart         — Recharts "max attempts over time" line across ALL tiers
 *                      + personal-best reference line.
 *   6. Efforts log   — chronological list across all tiers, each row carrying a
 *                      tier chip. Per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why formulas / tier logic are re-implemented inline:
 * web/src/lib/formulas.js is the OLDER, simpler web copy. Its `projectAllRMs`
 * is hard-capped at 10 tiles, and it does NOT export the bodyweight tier
 * helpers (parseRepsFromBwLabel, computeBandSubState, bwTierFromVariantName,
 * etc.) — those live only in the mobile file. Rather than mutate the frozen
 * web lib, every needed piece is reproduced here verbatim from
 * mobile/app/(app)/effort/strength/[exercise].tsx so the projections + tier
 * math match the athlete exactly.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SIMPLIFICATIONS vs. the athlete (documented for a refine pass):
 *   S1. Tier selector is clickable pills, NOT the gesture swipe carousel
 *       (per the task brief — web uses tabs). No pulsing chevrons, no
 *       finger-follow slide animation.
 *   S2. The Full RX 4-mode hero body, assisted-working hero, ready-to-graduate
 *       hero, and graduated hero are all rendered as the correct STATIC state
 *       for the active tier (no animated transitions between them beyond the
 *       per-number TickerNumber).
 *   S3. The info panel (why-this-tier) toggles open/closed with a simple
 *       conditional render (no FadeInUp / LinearTransition motion).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Info, Check } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ═══════════════════════════════════════════════════════════════════════════
// Tier model (verbatim mirror of mobile BW_TIERS / BW_TIER_RANK / labels)
// ═══════════════════════════════════════════════════════════════════════════
const BW_TIERS = ['band+knee', 'knee', 'band', 'rx']
const BW_TIER_RANK = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }
const BW_GRADUATION_REPS = 8 // T088 Fix 2.1: was 10 — graduate in the strength range (~5-8 reps), not endurance

function bwTierFromVariantName(name) {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwTierLabel(tier) {
  switch (tier) {
    case 'band+knee': return 'BAND + KNEE ASSISTED'
    case 'knee':      return 'KNEE ASSISTED'
    case 'band':      return 'BAND ASSISTED'
    case 'rx':        return 'FULL RX'
    default:          return ''
  }
}

function bwTierBadge(tier) {
  switch (tier) {
    case 'band+knee': return 'B+K'
    case 'knee':      return 'KNEE'
    case 'band':      return 'BAND'
    case 'rx':        return 'FULL RX'
    default:          return ''
  }
}

function bwNextTier(tier) {
  const idx = BW_TIERS.indexOf(tier)
  return idx >= 0 && idx < BW_TIERS.length - 1 ? BW_TIERS[idx + 1] : null
}

function bwWhyText(tier) {
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

// ── Small grammar helpers (mirror of mobile aOrAn / repWord) ─────────────────
function aOrAn(word) {
  const first = (word || '').trim().charAt(0).toLowerCase()
  return 'aeiou'.includes(first) ? 'an' : 'a'
}
function repWord(count) {
  return count === 1 ? 'rep' : 'reps'
}

// ═══════════════════════════════════════════════════════════════════════════
// Effort-label parsers (verbatim mirror of mobile)
// ═══════════════════════════════════════════════════════════════════════════
function parseOneRM(value) {
  const m = value?.match(/(?:Est\. )?1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

// Full RX rep parser — labels look like "Push Up · 162.9 lb × 27" or
// "Push Up · 25+10 lb × 8" — reps come from the "× N" tail.
function parseRepsFromLabel(label) {
  const m = label?.match(/×\s*(\d+)/)
  return m ? parseInt(m[1]) : 0
}

// Multi-format rep parser used across ALL tiers. Band labels are
// "Pull Up [Band] · Heavy × 7" (× N); Knee/RX rep-only labels are
// "Pull Up [Knee] · 8 reps" (· N reps).
function parseRepsFromBwLabel(label) {
  let m = label?.match(/×\s*(\d+)/)
  if (m) return parseInt(m[1])
  m = label?.match(/·\s*(\d+)\s*reps?/)
  if (m) return parseInt(m[1])
  return null
}

// Added belt/vest weight on Full RX labels — "162.9+20 lb × 5" → 20.
function parseAddedWeightFromLabel(label) {
  const m = label?.match(/\+([\d.]+)\s*\w+\s*×/)
  return m ? parseFloat(m[1]) : 0
}

// Band level off a Band / Band+Knee label — "[Band] · Heavy × 7" → "Heavy".
function parseBandLevelFromBwLabel(label) {
  const m = label?.match(/\[Band(?:\s*\+\s*Knee)?\]\s*·\s*([\w\s]+?)\s*×/)
  return m ? m[1].trim() : null
}

// ═══════════════════════════════════════════════════════════════════════════
// Band-level sub-progression (Band & Band+Knee tiers) — verbatim mirror of
// mobile computeBandSubState. Extra Heavy → Heavy → Medium → Light, with
// auto-advance once BW_GRADUATION_REPS (8) reps are hit at the lightest used band.
// ═══════════════════════════════════════════════════════════════════════════
const BAND_LEVELS_PROGRESSION = ['Extra Heavy', 'Heavy', 'Medium', 'Light']

function computeBandSubState(tierEfforts) {
  const bestPerLevel = { 'Extra Heavy': 0, 'Heavy': 0, 'Medium': 0, 'Light': 0 }
  tierEfforts.forEach(e => {
    const level = parseBandLevelFromBwLabel(e.label)
    const reps  = parseRepsFromBwLabel(e.label) || 0
    if (level && level in bestPerLevel && reps > bestPerLevel[level]) {
      bestPerLevel[level] = reps
    }
  })

  // Walk lightest → heaviest to find the user's frontier.
  const reverseLevels = ['Light', 'Medium', 'Heavy', 'Extra Heavy']
  let lightestUsed = null
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
    return { currentBand: 'Light', bestAtCurrent: bestPerLevel['Light'], bestPerLevel, allLevelsCleared: true }
  }
  const nextBand = BAND_LEVELS_PROGRESSION[idx + 1]
  return {
    currentBand:      nextBand,
    bestAtCurrent:    bestPerLevel[nextBand] || 0,
    bestPerLevel,
    allLevelsCleared: false,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Rep-only stage milestones (verbatim mirror of mobile) — for bodyweight
// movements WITHOUT weighted progression (Burpee, Sit Up, etc.).
// ═══════════════════════════════════════════════════════════════════════════
const REP_STAGE_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const REP_STAGE_2 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const REP_STAGE_3 = [25, 50, 75, 100, 125, 145, 160, 175, 190, 200]
function pickRepOnlyStage(best) {
  if (best >= 21) return REP_STAGE_3
  if (best >= 11) return REP_STAGE_2
  return REP_STAGE_1
}

// ═══════════════════════════════════════════════════════════════════════════
// Weighted-progression math (1RM estimate + projections + added-weight plates)
// Verbatim mirror of mobile estimate1RM / projectAllRMs(…, maxReps=10 here
// since BW tiles only need reps 1..10) / getNextAddedWeight / platesForAdded.
// ═══════════════════════════════════════════════════════════════════════════
const BODYWEIGHT_THRESHOLD = 10
const PLATE_SIZES = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
}

function estimate1RM(weight, reps) {
  if (reps === 1) return weight
  const epley    = weight * (1 + reps / 30)
  const brzycki  = weight * (36 / (37 - reps))
  const lombardi = weight * Math.pow(reps, 0.1)
  return Math.round((epley + brzycki + lombardi) / 3)
}

// Project rep-max weights 1RM..maxReps from a known weight×reps effort.
function projectAllRMs(weight, reps, maxReps = 10) {
  const oneRM = estimate1RM(weight, reps)
  return Array.from({ length: maxReps }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    const brzycki  = oneRM * (37 - r) / 36
    const epley    = oneRM / (1 + r / 30)
    const lombardi = oneRM / Math.pow(r, 0.1)
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

function getNextAddedWeight(projected, unit = 'lb') {
  const inc    = 2.5
  const plates = PLATE_SIZES[unit] ?? PLATE_SIZES.lb
  const safe   = Math.max(0, projected)
  const target = (safe % inc === 0) ? safe + inc : Math.ceil(safe / inc) * inc
  const usedPlates = []
  let rem = target
  for (const p of plates) {
    while (rem >= p - 0.001) {
      usedPlates.push(p)
      rem = Math.round((rem - p) * 1000) / 1000
    }
  }
  return { weight: target, plates: usedPlates }
}

// ── Misc formatters ─────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The equipment kind this component handles. Dispatcher routes here when the
// movement's `equipment === 'bodyweight'`. Kept un-exported so the file only
// exports the component (Fast Refresh requirement).
const BODYWEIGHT_EQUIPMENT = 'bodyweight'

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId    (string, required) — client's auth user id
//   exercise  (string, required) — base movement name, e.g. "Pull Up". May also
//                                  arrive as a bracketed variant ("Pull Up [Band]")
//                                  — the suffix is stripped to the base name for
//                                  fetching + display.
//   onBack    (fn, optional)     — custom back handler. Defaults to returning to
//                                  the client's detail page.
//
// Self-contained: fetches the movements row (by base name) for equipment /
// band_assist / knee_assist / weighted_progression, all tier efforts for the
// base movement, and the profile's current_weight (used for the Full RX
// weighted-tile projections when no RX 1RM exists yet).
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthBodyweightDetail({ userId, exercise, onBack }) {
  // Strip any assist-variant suffix to the consolidated base name.
  const baseExercise = (exercise || '')
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileUnit, setProfileUnit] = useState('lb')
  const [profileBW, setProfileBW]     = useState(null)
  const [meta, setMeta]               = useState(null) // { band_assist, knee_assist, weighted_progression }

  // Active tier (clickable pill). Null until efforts resolve → defaults to the
  // highest logged tier. Selected tile (Full RX only) + info-panel toggle.
  const [activeTier, setActiveTier]   = useState(null)
  const [selectedRM, setSelectedRM]   = useState(1)
  const [tierInfoOpen, setTierInfoOpen] = useState(false)

  // ── Load efforts + profile + movement row ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      // Bodyweight consolidated: pull every tier variant in one shot so the
      // page can render the whole journey across B+K / K / B / Full RX.
      // PostgREST `or()` parens choke on movement names containing literal
      // parens, so we replicate the athlete's guard: use the multi-filter
      // .or() only when the movement is tier-eligible (decided AFTER the
      // movements row loads). To keep this a single round-trip without that
      // chicken-and-egg, we fetch the movement row first, THEN the efforts.
      const movRes = await supabase
        .from('movements')
        .select('equipment, band_assist, knee_assist, weighted_progression')
        .eq('name', baseExercise)
        .maybeSingle()
      if (cancelled) return

      const movement = movRes.data ?? null
      const tierEligible = !!(movement?.band_assist || movement?.knee_assist)

      const effortsQuery = supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', 'strength')
        .order('created_at', { ascending: true })

      const filtered = tierEligible
        ? effortsQuery.or(
            [
              `label.ilike.${baseExercise} ·%`,
              `label.ilike.${baseExercise} [Band] ·%`,
              `label.ilike.${baseExercise} [Knee] ·%`,
              `label.ilike.${baseExercise} [Band + Knee] ·%`,
            ].join(',')
          )
        : effortsQuery.ilike('label', `${baseExercise} ·%`)

      const [efRes, profRes] = await Promise.all([
        filtered,
        supabase
          .from('profiles')
          .select('weight_unit, current_weight')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return

      const loaded = efRes.data || []
      setEntries(loaded)
      setProfileUnit(profRes.data?.weight_unit || 'lb')
      setProfileBW(profRes.data?.current_weight ?? null)
      setMeta(movement)

      // Default active tier = highest logged tier (matches athlete's slot-0
      // landing rule). If a bracketed variant was passed AND it's logged,
      // prefer it (mirror of athlete's urlTier preference).
      const repsByTier = { 'band+knee': 0, 'knee': 0, 'band': 0, 'rx': 0 }
      loaded.forEach(e => {
        const t = bwTierFromVariantName(e.label.split(' · ')[0])
        const r = parseRepsFromBwLabel(e.label) || 0
        if (r > repsByTier[t]) repsByTier[t] = r
      })
      const loggedTiers = BW_TIERS.filter(t => repsByTier[t] > 0)
      const highestTier = loggedTiers.length > 0 ? loggedTiers[loggedTiers.length - 1] : 'rx'
      const urlTier =
        exercise?.endsWith(' [Band + Knee]') ? 'band+knee'
        : exercise?.endsWith(' [Knee]') ? 'knee'
        : exercise?.endsWith(' [Band]') ? 'band'
        : null
      const initialTier = urlTier && loggedTiers.includes(urlTier) ? urlTier : highestTier
      setActiveTier(initialTier)
      setSelectedRM(Math.min(Math.max(repsByTier[initialTier] || 1, 1), 10))

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, baseExercise, exercise])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  // ── Movement flags ──────────────────────────────────────────────────────────
  const canHaveTiers        = !!(meta?.band_assist || meta?.knee_assist)
  const weightedProgression = !!(meta?.weighted_progression)

  // ── Per-tier bucketing + bests ──────────────────────────────────────────────
  const bwEffortsByTier = useMemo(() => {
    const buckets = { 'band+knee': [], 'knee': [], 'band': [], 'rx': [] }
    entries.forEach(e => {
      const t = bwTierFromVariantName(e.label.split(' · ')[0])
      buckets[t].push(e)
    })
    return buckets
  }, [entries])

  const bwBestByTier = useMemo(() => {
    const out = { 'band+knee': 0, 'knee': 0, 'band': 0, 'rx': 0 }
    Object.entries(bwEffortsByTier).forEach(([t, efs]) => {
      efs.forEach(e => {
        const r = parseRepsFromBwLabel(e.label) || 0
        if (r > out[t]) out[t] = r
      })
    })
    return out
  }, [bwEffortsByTier])

  // HIGHEST → LOWEST (slot-0 = highest tier, matches athlete carousel order).
  const bwLoggedTiers = useMemo(
    () => BW_TIERS.filter(t => bwEffortsByTier[t].length > 0).reverse(),
    [bwEffortsByTier]
  )
  const bwHighestTier = bwLoggedTiers.length > 0 ? bwLoggedTiers[0] : 'rx'

  // Resolved active tier (state may lag the data — fall back to highest).
  const tier = (activeTier && bwLoggedTiers.includes(activeTier))
    ? activeTier
    : bwHighestTier

  // ── Full RX weighted-tile math (mirror of parent's bwTiles derivation) ───────
  const rxOnlyEfforts = bwEffortsByTier.rx
  const bestRxReps = Math.max(0, ...rxOnlyEfforts.map(e => parseRepsFromLabel(e.label)))
  const bestOneRM = useMemo(() => entries.reduce((acc, e) => {
    const parsed = parseOneRM(e.value)
    if (!parsed) return acc
    return parsed.oneRM > acc ? parsed.oneRM : acc
  }, 0), [entries])

  // effectiveOneRM: when no RX 1RM exists yet, derive from profile bodyweight ×
  // best RX reps so the weighted tiles still project. Mirror of athlete.
  const effectiveOneRM = bestOneRM === 0 && profileBW && bestRxReps > 0
    ? estimate1RM(profileBW, bestRxReps)
    : bestOneRM
  const projections = useMemo(
    () => (effectiveOneRM > 0 ? projectAllRMs(effectiveOneRM, 1, 10) : []),
    [effectiveOneRM]
  )

  // bwTiles — shape depends on weightedProgression (mirror of athlete).
  const bwTiles = useMemo(() => {
    if (!weightedProgression) {
      const stage = pickRepOnlyStage(bestRxReps)
      const pushIdx = stage.findIndex(r => r > bestRxReps)
      return stage.map((r, i) => {
        if (r <= bestRxReps) return { reps: r, mode: 'achieved', addedWeight: null, plates: [], achievable: true, isGraduation: false }
        if (i === pushIdx)   return { reps: r, mode: 'push', addedWeight: null, plates: [], achievable: true, nextRep: r, isGraduation: false }
        return { reps: r, mode: 'locked', addedWeight: null, plates: [], achievable: false, isGraduation: false }
      })
    }

    return Array.from({ length: 10 }, (_, i) => i + 1).map(r => {
      const achievable = r <= bestRxReps
      const proj       = projections.find(p => p.reps === r)
      if (!proj || !achievable) {
        return { reps: r, mode: 'locked', addedWeight: null, plates: [], achievable, isGraduation: false }
      }
      if (r === bestRxReps && bestRxReps < BODYWEIGHT_THRESHOLD) {
        return { reps: r, mode: 'push', addedWeight: null, plates: [], achievable, nextRep: r + 1, isGraduation: false }
      }
      const bestActualAdded = rxOnlyEfforts
        .filter(e => parseRepsFromLabel(e.label) === r)
        .map(e => parseAddedWeightFromLabel(e.label))
        .reduce((max, v) => Math.max(max, v), 0)
      const baseWeight   = profileBW ?? effectiveOneRM
      const formulaAdded = Math.max(0, proj.weight - baseWeight)
      const targetRaw    = bestActualAdded > 0
        ? Math.max(formulaAdded, bestActualAdded + 0.001)
        : formulaAdded
      const nextAdded    = targetRaw > 0 ? getNextAddedWeight(targetRaw, profileUnit) : null
      const isGraduation = (r === bestRxReps) && (bestRxReps === BODYWEIGHT_THRESHOLD) && (bestActualAdded === 0)
      return {
        reps: r, mode: 'weighted',
        addedWeight: nextAdded?.weight ?? 0,
        plates: nextAdded?.plates ?? [],
        achievable, isGraduation,
      }
    })
  }, [weightedProgression, bestRxReps, projections, rxOnlyEfforts, profileBW, effectiveOneRM, profileUnit])

  const selectedBWTile = bwTiles.find(t => t.reps === selectedRM) ?? null

  // ── Active-tier hero state inputs ────────────────────────────────────────────
  const tierBest    = bwBestByTier[tier]
  const isFullRxT   = tier === 'rx'
  const isGradT     = BW_TIER_RANK[bwHighestTier] > BW_TIER_RANK[tier]
  const nextT       = bwNextTier(tier)
  const hasBandLevels = tier === 'band' || tier === 'band+knee'
  const bandSubState  = hasBandLevels ? computeBandSubState(bwEffortsByTier[tier]) : null
  const displayBest   = bandSubState ? bandSubState.bestAtCurrent : tierBest
  const isReadyT      = !isFullRxT && !isGradT && (
    bandSubState ? bandSubState.allLevelsCleared : tierBest >= BW_GRADUATION_REPS
  )

  // Switching tiers: snap the selected tile to that tier's best (clamped 1..10)
  // and close the info panel — mirror of athlete navigateTier.
  function switchTier(t) {
    if (!t || t === tier) return
    setActiveTier(t)
    setTierInfoOpen(false)
    setSelectedRM(Math.min(Math.max(bwBestByTier[t] || 1, 1), 10))
  }
  function onTilePress(r, achievable) {
    if (achievable) setSelectedRM(r)
  }

  // ── Chart data — max attempts over time, across ALL tiers ────────────────────
  const chartData = useMemo(() => entries
    .map(e => {
      const r = parseRepsFromBwLabel(e.label)
      return r !== null ? { ts: e.created_at, date: fmtShort(e.created_at), value: r } : null
    })
    .filter(Boolean), [entries])

  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const bestForChart = chartData.length > 1 ? bwBestByTier[bwHighestTier] : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Tile-grid renderers (Full RX clickable vs assisted display-only) ─────────
  function renderFullRxTiles() {
    return bwTiles.map(({ reps: r, addedWeight: aw, achievable, mode, nextRep }) => {
      const isSelected = selectedRM === r
      const isCurrent  = r === tierBest
      const isAchieved = mode === 'achieved'
      const visited    = isCurrent || isAchieved
      return (
        <button
          key={r}
          onClick={() => onTilePress(r, achievable)}
          disabled={!achievable}
          className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 transition-colors ${
            isSelected ? 'border-blue-500 bg-blue-500/15'
            : visited   ? 'border-blue-500/40 bg-blue-500/10'
            : achievable ? 'border-border bg-card/40 hover:border-blue-500/40'
                        : 'border-border bg-card/20 opacity-40'
          }`}
          style={{ minWidth: 60 }}
        >
          <span className={`text-[10px] font-bold uppercase leading-tight ${isSelected ? 'text-blue-400' : visited ? 'text-blue-400/80' : 'text-muted-foreground'}`}>
            {r}
          </span>
          <span className={`text-[10px] font-bold uppercase leading-tight ${isSelected ? 'text-blue-400' : visited ? 'text-blue-400/80' : 'text-muted-foreground'}`}>
            {r > 1 ? 'reps' : 'rep'}
          </span>
          {mode === 'achieved' ? (
            <span className="mt-1 flex h-4 items-center justify-center">
              <Check className="h-3.5 w-3.5 text-blue-400" strokeWidth={3} />
            </span>
          ) : (
            <span className={`mt-1 font-mono text-xs font-bold tabular-nums ${isSelected ? 'text-blue-400' : isCurrent ? 'text-blue-400' : achievable ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
              {mode === 'locked' ? '—'
                : mode === 'push' ? `→ ${nextRep}`
                : aw === 0 ? 'BW' : `+${aw}`}
            </span>
          )}
        </button>
      )
    })
  }

  function renderAssistedTiles() {
    // Achievement based on displayBest (band-aware for Band / Band+Knee).
    return Array.from({ length: 10 }, (_, i) => i + 1).map(r => {
      const achieved = r <= displayBest
      return (
        <div
          key={r}
          className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 ${
            achieved ? 'border-blue-500/40 bg-blue-500/10' : 'border-border bg-card/20 opacity-40'
          }`}
          style={{ minWidth: 60 }}
        >
          <span className={`text-[10px] font-bold uppercase leading-tight ${achieved ? 'text-blue-400/80' : 'text-muted-foreground'}`}>{r}</span>
          <span className={`text-[10px] font-bold uppercase leading-tight ${achieved ? 'text-blue-400/80' : 'text-muted-foreground'}`}>{r > 1 ? 'reps' : 'rep'}</span>
          <span className="mt-1 flex h-4 items-center justify-center">
            {achieved
              ? <Check className="h-3.5 w-3.5 text-blue-400" strokeWidth={3} />
              : <span className="font-mono text-xs font-bold tabular-nums text-muted-foreground/50">—</span>}
          </span>
        </div>
      )
    })
  }

  // ── Hero body for the active tier ────────────────────────────────────────────
  function renderHeroBody() {
    // 1. Graduated past this tier — one-liner.
    if (isGradT) {
      return (
        <div className="flex flex-col items-center gap-2 py-4">
          <Check className="h-7 w-7 text-blue-400" strokeWidth={2.5} />
          <p className="text-sm font-medium text-foreground">You've moved past this tier</p>
          <p className="text-[11px] text-muted-foreground">
            Now training on <span className="font-bold text-foreground">{bwTierLabel(bwHighestTier)}</span>
          </p>
        </div>
      )
    }

    // 2. Ready to graduate.
    if (isReadyT) {
      return (
        <>
          <div className="flex items-baseline gap-2">
            <TickerNumber value={displayBest} className="font-mono text-4xl font-bold text-blue-400" />
            <span className="text-sm text-muted-foreground">max attempts</span>
          </div>
          <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
            <p className="text-sm">
              <span className="text-muted-foreground">Ready for </span>
              <span className="font-bold text-foreground">{bwTierLabel(nextT)}</span>
            </p>
          </div>
        </>
      )
    }

    // 3. Full RX — selectedBWTile-driven (4 modes).
    if (isFullRxT) {
      if (!weightedProgression) {
        // Rep-only family.
        if (selectedBWTile?.mode === 'achieved') {
          const firstClearedTs = rxOnlyEfforts
            .filter(e => (parseRepsFromBwLabel(e.label) ?? 0) >= selectedBWTile.reps)
            .map(e => e.created_at)
            .sort()[0] ?? null
          const clearedLabel = firstClearedTs ? fmtShort(firstClearedTs) : null
          const activeStage = pickRepOnlyStage(bestRxReps)
          const nextMilestone = activeStage.find(r => r > bestRxReps) ?? null
          return (
            <>
              <div className="flex items-baseline gap-2">
                <TickerNumber value={selectedBWTile.reps} className="font-mono text-4xl font-bold text-blue-400" />
                <span className="text-sm text-muted-foreground">{selectedBWTile.reps > 1 ? 'reps cleared' : 'rep cleared'}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {clearedLabel ? `Cleared on ${clearedLabel}` : 'Cleared'}
                {nextMilestone != null ? ` · Next milestone: ${nextMilestone} reps` : ' · Max milestone reached'}
              </p>
            </>
          )
        }
        if (selectedBWTile?.mode === 'push') {
          return (
            <>
              <div className="flex items-baseline gap-2">
                <TickerNumber value={selectedBWTile.reps} className="font-mono text-4xl font-bold text-blue-400" />
                <span className="text-sm text-muted-foreground">{selectedBWTile.reps > 1 ? 'reps next' : 'rep next'}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Push for {selectedBWTile.reps} unbroken {repWord(selectedBWTile.reps)}
              </p>
            </>
          )
        }
        return (
          <>
            <p className="text-xs font-medium text-muted-foreground">Target</p>
            <div className="flex items-baseline gap-2">
              <TickerNumber value={selectedBWTile?.reps ?? selectedRM} className="font-mono text-4xl font-bold text-blue-400" />
              <span className="text-sm text-muted-foreground">{(selectedBWTile?.reps ?? selectedRM) > 1 ? 'reps' : 'rep'}</span>
            </div>
          </>
        )
      }

      // Weighted-progression family — locked / push / weighted (3 modes; the
      // graduation branch was removed in the athlete too).
      if (!selectedBWTile || !selectedBWTile.achievable) {
        return (
          <>
            <p className="text-xs font-medium text-muted-foreground">Target</p>
            <div className="flex items-baseline gap-2">
              <TickerNumber value={selectedRM} className="font-mono text-4xl font-bold text-blue-400" />
              <span className="text-sm text-muted-foreground">max attempts</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Build up to {selectedRM} clean reps at bodyweight first · current best: {tierBest}
            </p>
          </>
        )
      }
      if (selectedBWTile.mode === 'push') {
        return (
          <>
            <div className="flex items-baseline gap-2">
              <TickerNumber value={selectedBWTile.nextRep ?? 0} className="font-mono text-4xl font-bold text-blue-400" />
              <span className="text-sm text-muted-foreground">reps next at bodyweight</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Push for one more clean rep — current best: {tierBest}
            </p>
          </>
        )
      }
      // weighted
      return (
        <>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">attempt {selectedRM} {repWord(selectedRM)}</p>
              <div className="mt-0.5 flex items-baseline gap-1">
                <TickerNumber value={`+${selectedBWTile.addedWeight}`} className="font-mono text-4xl font-bold text-blue-400" />
                <span className="text-sm text-muted-foreground">{profileUnit} added</span>
              </div>
            </div>
            {selectedBWTile.plates.length > 0 && (
              <div className="flex flex-col items-end">
                <span className="mb-1 text-[11px] text-muted-foreground">belt / vest</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {selectedBWTile.plates.map((p, i) => (
                    <span key={i} className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-400">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Add {selectedBWTile.addedWeight} {profileUnit} of load — aim for {selectedRM} clean rep{selectedRM > 1 ? 's' : ''}
          </p>
        </>
      )
    }

    // 4. Assisted tier, still working toward graduation.
    return (
      <>
        <div className="flex items-baseline gap-2">
          <TickerNumber value={displayBest + 1} className="font-mono text-4xl font-bold text-blue-400" />
          <span className="text-sm text-muted-foreground">max attempts</span>
        </div>
        {bandSubState && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {tier === 'band+knee' ? 'Band + Knee: ' : 'Band: '}
            <span className="font-bold text-blue-400">{bandSubState.currentBand}</span>
          </p>
        )}
        {tier === 'knee' && <p className="mt-0.5 text-[11px] text-muted-foreground">Knee assisted</p>}
        <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
          <p className="text-sm text-muted-foreground">
            Keep practicing until you hit{' '}
            <span className="font-bold text-foreground">{displayBest + 1}</span>{' '}
            unbroken {repWord(displayBest + 1)}
            {tier === 'band+knee' && bandSubState
              ? <> with {aOrAn(bandSubState.currentBand)} <span className="font-bold text-foreground">{bandSubState.currentBand}</span> band on your knees</>
              : tier === 'knee'
              ? <> on your knees</>
              : tier === 'band' && bandSubState
              ? <> with {aOrAn(bandSubState.currentBand)} <span className="font-bold text-foreground">{bandSubState.currentBand}</span> band</>
              : null}
          </p>
        </div>
      </>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* ── 1. Header ── */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">{baseExercise}</h1>
          {canHaveTiers && bwLoggedTiers.length > 0 && (
            <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
              {bwTierBadge(bwHighestTier)}
            </span>
          )}
        </div>
        {bwLoggedTiers.length > 0 ? (
          <p className="mt-0.5 flex flex-wrap items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber value={bwBestByTier[bwHighestTier]} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">max attempts</span>
            {canHaveTiers && (
              <>
                <span>on</span>
                <span className="font-semibold text-foreground">{bwTierLabel(bwHighestTier)}</span>
              </>
            )}
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
          BODYWEIGHT
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : bwLoggedTiers.length === 0 ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            No efforts logged yet.
          </p>
        </AnimateRise>
      ) : (
        <>
          {/* ── 2 + 3 + 4. Tier pills + tile grid + hero ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">

            {/* Tier pills (clickable tabs — web equivalent of the mobile
                swipe carousel). Order HIGHEST → LOWEST. Only logged tiers
                shown. Hidden entirely for non-tier-eligible movements. */}
            {canHaveTiers && bwLoggedTiers.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                {bwLoggedTiers.map(t => {
                  const isActive = t === tier
                  return (
                    <button
                      key={t}
                      onClick={() => switchTier(t)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-500/15 text-blue-400'
                          : 'border-border bg-card/40 text-muted-foreground hover:border-blue-500/40'
                      }`}
                    >
                      {bwTierLabel(t)}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Tile-grid header */}
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold">
                {isFullRxT
                  ? (weightedProgression ? 'Max attempt projections' : 'Max attempts')
                  : 'Max attempts'}
              </h2>
            </div>

            {/* Tile row — horizontal scroll w/ fading edges. */}
            <div className="relative mt-2">
              <div className="flex gap-2 overflow-x-auto py-1 px-0.5" style={{ scrollbarWidth: 'none' }}>
                {isFullRxT ? renderFullRxTiles() : renderAssistedTiles()}
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
            </div>

            {/* ── Hero card ── */}
            <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] p-4">
              {/* Tappable tier info pill (why this tier). */}
              <div className="flex justify-end">
                <button
                  onClick={() => setTierInfoOpen(o => !o)}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5"
                >
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-blue-400">
                    {bwTierLabel(tier)}
                  </span>
                  <Info className="h-3 w-3 text-blue-400" />
                </button>
              </div>

              {tierInfoOpen && (
                <div className="mt-1 rounded-md border border-blue-500/15 bg-card/60 px-2.5 py-2">
                  <p className="mb-1 text-xs font-bold text-foreground">{bwTierLabel(tier)}</p>
                  <p className="text-[11px] leading-4 text-muted-foreground">{bwWhyText(tier)}</p>
                </div>
              )}

              <div className="mt-1">
                {renderHeroBody()}
              </div>
            </div>
          </AnimateRise>

          {/* ── 6. Chart — max attempts over time, across all tiers ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Max attempts over time</p>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[Math.max(0, Math.round(minV * 0.9)), Math.round(maxV * 1.1)]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${Math.round(v)} reps`, 'Max attempts']}
                    />
                    {bestForChart && (
                      <ReferenceLine y={bestForChart} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-in-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Not enough efforts logged yet.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Dashed line = personal best{canHaveTiers ? ` on ${bwTierLabel(bwHighestTier)}` : ''}
              </p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 7. Efforts log (chronological, all tiers, tier chip + delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No efforts found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const detail   = e.label.split(' · ').slice(1).join(' · ')
                  const reps     = parseRepsFromBwLabel(e.label) || 0
                  const rowTier  = bwTierFromVariantName(e.label.split(' · ')[0])
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{detail || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-muted-foreground">max attempts</span>
                            <span className="font-mono text-xs font-semibold tabular-nums text-blue-400">{reps}</span>
                          </div>
                          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
                            {bwTierBadge(rowTier)}
                          </span>
                        </div>
                      </div>
                    </SwipeDelete>
                  )
                })}
              </div>
            </div>
          )}
        </AnimateRise>
      )}
    </div>
  )
}
