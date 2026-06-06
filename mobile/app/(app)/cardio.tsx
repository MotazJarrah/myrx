/**
 * Cardio — direct port of MyRX/src/pages/Cardio.jsx to React Native.
 *
 * Layout 1:1:
 *   1. Header (title + dynamic subtext by mode)
 *   2. Form card (animate-rise, zIndex 10 for MovementSearch dropdown):
 *      ├─ Activity search (combobox)
 *      ├─ Conditional input fields by movement.cardio_mode:
 *      │    • duration → mm:ss time only
 *      │    • pace     → distance + unit (km/mi) + time
 *      ├─ Live amber chip (Pace m:ss/km|/mi or Session time)
 *      └─ Save button (amber)
 *   3. "Your activities" list — best per activity, navigates to detail
 *
 * Pace is canonicalised internally as `m:ss/km` (matches the web's storage).
 * Display converts to /mi when the user's distance_unit is 'mi'.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Activity, Timer, ChevronRight, Check, AlertTriangle } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { useMovements } from '../../src/hooks/useMovements'
import {
  SPEED_INPUT_ACTIVITIES,
  speedMaxTenths,
  // Swim stroke consolidation helpers — the 4 stroke variants collapse
  // into a single "Swimming" row in the activities list, and the form
  // recognises any bracketed swim variant as swim mode.
  SWIMMING_BASE_NAME,
  SWIMMING_STROKE_MOVEMENTS,
  parseSwimStroke,
  isSwimActivity,
  swimStrokeFromMovementName,
  SWIM_STROKE_LABELS,
  type SwimStroke,
  // Air Bike calorie-input mode helpers — air bike is programmed in
  // calories, not distance/speed. The log form swaps Distance+Speed
  // for Calories+Time when activity = Air Bike.
  AIR_BIKE_ACTIVITY,
  isAirBikeActivity,
  parseAirBikeLabel,
  calsPerMinFromEffort,
  // Row Erg (Concept2) — distance always in integer meters, pace
  // displayed as split per 500m. The log form swaps the decimal-km
  // distance wheel for an integer-meter wheel (similar to swimming).
  ROW_ERG_ACTIVITY,
  isRowErgActivity,
  pacePer500mFromSecsPerKm,
  // Rucking — distance locked to mi via unit_lock; the log form ALSO
  // adds a pack-weight wheel (locked to lb in code, since unit_lock
  // only holds one unit). Save label format includes pack weight:
  //   "Rucking · 35 lb × 2.5 mi in 45:00"
  RUCKING_ACTIVITY,
  isRuckingActivity,
  // Pack-weight ladder for the Rucking log form wheel — real GoRuck /
  // Rogue plate sizes plus stacked combos, prefixed with 0 for
  // bodyweight rucking.
  RUCK_WEIGHT_LOG_LADDER_LB,
  // StairMill — duration-mode activity that captures FLOORS alongside
  // TIME so the detail page can compute floors-per-minute (rate-anchored
  // coaching). Save label format includes floors:
  //   "StairMill · 245 floors in 20:00"
  STAIRMILL_ACTIVITY,
  isStairMillActivity,
  parseStairMillLabel,
  floorsPerMinFromEffort,
} from '../../src/lib/movements'
import MovementSearch from '../../src/components/MovementSearch'
import PhantomWheel from '../../src/components/PhantomWheel'
import AnimateRise from '../../src/components/AnimateRise'
import UnitToggle from '../../src/components/UnitToggle'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Time helpers (1:1 with Cardio.jsx) ───────────────────────────────────────

function parseTimeStr(str: string): number | null {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs: number | null | undefined): string {
  if (!totalSecs) return '0:00'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Format seconds → "MM:SS" (always two-digit minutes & seconds). */
function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Shared field height — same value as `strength.tsx` so a row of fields on
// cardio matches a row of fields on strength pixel-for-pixel. Pairs with
// the vertical UnitToggle (also 75 tall) and the unit-locked chip below
// (`unitLockedBox`, future-proof; cardio doesn't currently have any
// unit-locked activities but the styling exists for parity).
const FIELD_HEIGHT = 75

// SPEED_INPUT_ACTIVITIES — the set of 5 machine cardio activities where the
// user reads speed off the console (Running Treadmill, Stationary Bike,
// Bike Erg, Air Bike, Elliptical). Imported from movements.ts so the detail
// page reads from the same authoritative source. See that file for the full
// rationale (form swaps Time wheel for Speed wheel; detail page swaps pace
// display for speed display across header / hero / tiles / chart / log list).

function WheelInput({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: alpha(colors.input, 0.10),
      borderColor: colors.border, borderWidth: 1, borderRadius: 6,
      // No horizontal padding — the wheel needs every pixel for the
      // JetBrainsMono digits + unit suffix to fit. The wheel's own
      // container `paddingHorizontal: 8` still gives breathing room
      // from the border. Matches strength.tsx's WheelInput.
      paddingHorizontal: 0, paddingVertical: 6,
      height: FIELD_HEIGHT,
      alignItems: 'center', justifyContent: 'center',
    }}>{children}</View>
  )
}

function parsePaceToSecs(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// ── Type for "Your activities" list ──────────────────────────────────────────

interface ActivityBest {
  name:         string
  displayValue: string         // e.g. "5:00/km" or "25:00"
  secs:         number
  mode:         'pace' | 'duration'
  /** Swimming-only: the most-recently-logged stroke across all 4 variants.
   *  Drives the small stroke badge (FREE / BACK / BREAST / FLY) on the
   *  collapsed "Swimming" row in "Your activities". Mirrors the Sled Work
   *  pattern where the strength row shows the most-recent variant badge. */
  swimMostRecentStroke?: SwimStroke
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Cardio() {
  const { user, profile } = useAuth()
  const isAdmin = !!(profile as any)?.is_superuser

  // ── Core fields ────────────────────────────────────────────────────────────
  const [activity,  setActivity]  = useState('')
  const [distValue, setDistValue] = useState('')
  const [distUnit,  setDistUnit]  = useState<'km' | 'mi'>(((profile as any)?.distance_unit as 'km' | 'mi') || 'km')
  useEffect(() => {
    const u = (profile as any)?.distance_unit
    if (u) setDistUnit(u as 'km' | 'mi')
  }, [profile])
  const [timeStr, setTimeStr] = useState('')
  // Speed-mode third column (machines in SPEED_INPUT_ACTIVITIES). Same string
  // shape as distValue (e.g. "10.5" means 10.5 km/h or 10.5 mph). Time is
  // derived at render-time from speedKmh × distKm — never stored separately.
  const [speedValue, setSpeedValue] = useState('')

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saved,        setSaved]        = useState(false)
  const [suggestSent,  setSuggestSent]  = useState(false)
  const [suggesting,   setSuggesting]   = useState(false)
  const suggestingRef  = useRef(false)
  const [saveError,    setSaveError]    = useState('')
  const [activities,   setActivities]   = useState<ActivityBest[]>([])
  const [pendingQuery, setPendingQuery] = useState('')
  const [movementKey,  setMovementKey]  = useState(0)
  // Initial-load loading flag — flips false after the first Supabase fetch
  // of efforts resolves. Drives the page-level skeleton.
  const [loading,      setLoading]      = useState(true)

  // ── DB movements (cached) ──────────────────────────────────────────────────
  const dbMovements   = useMovements()
  // Hide family-PARENT rows from the dropdown. Parent rows are the
  // "Swimming" / "Sled Work" / "Bone" family entries — the user logs
  // against a specific variant (e.g. "Swimming [Freestyle]"), never the
  // parent name. Same filter used on the strength index.
  const familyParentIds = useMemo(() => {
    const ids = new Set<string>()
    dbMovements.forEach(m => {
      if (m.parent_movement_id) ids.add(m.parent_movement_id)
    })
    return ids
  }, [dbMovements])
  // Same filter logic as strength.tsx — hide family parents AND deprecated
  // movements from the new-log search dropdown so deprecated activities
  // can't accept new effort logs. They still appear on the "Your
  // Movements" list (built from logged efforts) and their detail pages
  // remain accessible for historical data review.
  const cardioRecords = useMemo(
    () => dbMovements.filter(m =>
      m.category === 'cardio'
      && !familyParentIds.has(m.id)
      && !m.deprecated
    ),
    [dbMovements, familyParentIds],
  )
  const cardioNames   = useMemo(() => cardioRecords.map(m => m.name), [cardioRecords])
  const movementRecord = activity ? (cardioRecords.find(m => m.name === activity) ?? null) : null
  const mode: 'pace' | 'duration' = movementRecord
    ? ((movementRecord.cardio_mode as 'pace' | 'duration' | undefined) || 'pace')
    : 'pace'

  // Optional per-movement unit lock (km-only / mi-only activities). Mirrors
  // strength.tsx's `unit_lock` pattern. Cardio doesn't have any unit-locked
  // activities at the moment, so this almost always resolves to undefined
  // and the regular toggle renders — but the styling is wired up so the
  // day a locked-unit activity is added it looks identical to strength.
  const unitLock = (movementRecord as any)?.unit_lock as ('km' | 'mi' | null | undefined)
  useEffect(() => {
    if (unitLock === 'km' || unitLock === 'mi') setDistUnit(unitLock)
  }, [unitLock])

  // Speed-mode detection. Derived from activity name — when the selected
  // activity is one of the 5 SPEED_INPUT_ACTIVITIES, the form swaps the
  // Time wheel for a Speed wheel and computes Time from distance ÷ speed.
  const isSpeedMode = SPEED_INPUT_ACTIVITIES.has(activity)

  // Air Bike calorie-input third column (separate from speedValue —
  // air bike is no longer in SPEED_INPUT_ACTIVITIES). Stores the
  // integer calorie count the user has dialed in. Saved label format:
  // "Air Bike · N cal in M:SS" — distance and pace are not stored.
  const [calsValue, setCalsValue] = useState('')

  // Air bike mode detection. When the user picks Air Bike, the form
  // swaps Distance+Speed for Calories+Time. Save label changes shape.
  // Detail page routes to AirBikeDetail (separate from PaceDetail).
  const isCalorieMode = isAirBikeActivity(activity)

  // Row Erg mode detection. Concept2 rowing is logged in integer
  // meters (not decimal km) and the pace is presented as a per-500m
  // split. The form swaps the decimal-km distance wheel for an
  // integer-meter wheel (same shape as swim mode). Detail page stays
  // on PaceDetail but with rowing-specific display formatting.
  const isRowMode = isRowErgActivity(activity)

  // Rucking mode — adds a Pack Weight wheel to the form (locked to lb).
  // Distance is already locked to mi via unit_lock on the movement row.
  // Save label includes pack weight: "Rucking · 35 lb × 2.5 mi in 45:00".
  // packWeightValue is in pounds; default 0 = bodyweight rucking.
  const isRuckMode = isRuckingActivity(activity)
  const [packWeightValue, setPackWeightValue] = useState('0')

  // Rucking soft safety cap — WARN (never block) when the pack exceeds ~1/3 of
  // bodyweight, the common safe-load ceiling for sustained loaded carries. Tiers
  // stay absolute (the GoRuck standard); this is a separate BW-relative guardrail.
  // Pack is lb-locked, so convert the profile bodyweight to lb first.
  const ruckBwRaw = (profile?.current_weight as number | null | undefined) ?? 0
  const ruckBwLb  = ruckBwRaw > 0
    ? ((profile?.weight_unit as string) === 'kg' ? ruckBwRaw / 0.453592 : ruckBwRaw)
    : 0
  const ruckPackLb  = Math.round(Number(packWeightValue) || 0)
  const ruckOverCap = isRuckMode && ruckBwLb > 0 && ruckPackLb > ruckBwLb / 3
  const ruckPctBw   = ruckBwLb > 0 ? Math.round((ruckPackLb / ruckBwLb) * 100) : 0

  // StairMill mode — duration-mode activity, but logs FLOORS alongside
  // TIME so the detail page can derive floors-per-minute (the rate anchor
  // for science-based 3-zone progression). Save label format:
  //   "StairMill · 245 floors in 20:00"
  // floorsValue = 0 → legacy duration-only save label ("StairMill · 20:00")
  // which still parses on the read side.
  const isStairMillMode = isStairMillActivity(activity)
  const [floorsValue, setFloorsValue] = useState('0')

  // Swim-mode detection. Swimming has its own form layout:
  //   • Distance wheel runs in INTEGER mode (step 25) in meters or yards,
  //     not the decimal-km wheel used for running/cycling. Pool distances
  //     come in whole numbers — 1500m, 800m, 50m — never "1.5 km."
  //   • Unit column shows "m" or "yd" as a locked chip (pulled from the
  //     user's swim_unit profile preference), not the km/mi toggle.
  //   • Time stays mm:ss as usual.
  //   • Save label format is "Swimming [Backstroke] · 1500 m in 25:00"
  //     (the bracketed stroke name IS the activity name written to the
  //     label). parseEffortLabel on the read path handles old bare
  //     "Swimming · ..." labels for back-compat with pre-May-17 efforts.
  // Detection matches any of the 4 stroke variants — the user picks
  // a specific stroke from search and the form recognises swim mode.
  const isSwimMode = isSwimActivity(activity)
  const swimUnit: 'm' | 'yd' = ((profile as any)?.swim_unit as 'm' | 'yd' | undefined) || 'm'

  // ── Reset fields when switching modes — every dial starts at ZERO
  // (May 2026 lock — previously they sat at "min savable", e.g. 0.1 km
  // and 00:01, but that read as pre-filled clutter). With a blank-slate
  // 0 default the Save button starts disabled (canSave requires
  // distKm > 0 and timeSecs > 0) and enables as soon as the user dials
  // anything in.
  useEffect(() => {
    if (isStairMillMode) {
      // StairMill is in duration mode but ALSO captures floors. Default
      // both wheels to 0; canSave guards on floors > 0 AND time > 0.
      setDistValue('')
      setTimeStr('00:00')
      setSpeedValue('')
      setCalsValue('')
      setPackWeightValue('0')
      setFloorsValue('0')
    } else if (mode === 'duration') {
      setDistValue('')
      setTimeStr('00:00')
      setSpeedValue('')
      setCalsValue('')
      setPackWeightValue('0')
      setFloorsValue('0')
    } else if (isCalorieMode) {
      setDistValue('')
      setSpeedValue('')
      setCalsValue('0')         // integer calories
      setTimeStr('00:00')
      setPackWeightValue('0')
    } else if (isSpeedMode) {
      setDistValue('0')
      setSpeedValue('0')
      setTimeStr('')           // derived from speed × distance, not user-entered
      setCalsValue('')
      setPackWeightValue('0')
    } else if (isSwimMode || isRowMode) {
      setDistValue('0')        // integer meters
      setTimeStr('00:00')
      setSpeedValue('')
      setCalsValue('')
      setPackWeightValue('0')
    } else if (isRuckMode) {
      setDistValue('0')        // decimal miles
      setTimeStr('00:00')
      setSpeedValue('')
      setCalsValue('')
      setPackWeightValue('0')  // lb — 0 default = bodyweight rucking
      setFloorsValue('0')
    } else {
      setDistValue('0')
      setTimeStr('00:00')
      setSpeedValue('')
      setCalsValue('')
      setPackWeightValue('0')
      setFloorsValue('0')
    }
  }, [mode, isSpeedMode, isSwimMode, isCalorieMode, isRowMode, isRuckMode, isStairMillMode])

  // ── Clear saved/error on any input change ──────────────────────────────────
  useEffect(() => { setSaved(false); setSaveError('') },
    [activity, distValue, distUnit, timeStr, speedValue, calsValue, packWeightValue, floorsValue])

  // ── Suggestion mode ────────────────────────────────────────────────────────
  const suggestionMode = !isAdmin && !activity && pendingQuery.trim() !== '' &&
    !cardioNames.some(m => {
      const tokens = pendingQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
      return tokens.every(t => m.toLowerCase().includes(t))
    })

  async function handleSuggestMove(name?: string) {
    if (!user || suggestingRef.current || suggestSent) return
    const n = (name || pendingQuery).trim()
    if (!n) return
    suggestingRef.current = true
    setSuggesting(true)
    const { error } = await supabase.from('messages').insert({
      user_id: user.id, from_admin: false,
      body: `New cardio move suggestion: ${n}`,
      is_suggestion: true, read: false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setPendingQuery('')
      setMovementKey(k => k + 1)
      setActivity(''); setDistValue(''); setTimeStr('')
      setTimeout(() => setSuggestSent(false), 2000)
    }
  }

  // ── Load "Your activities" ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    supabase.from('efforts').select('label, value, created_at')
      .eq('user_id', user.id).eq('type', 'cardio')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map<string, ActivityBest>()
        data.forEach((e: any) => {
          const head = e.label.split(' · ')[0]
          // Swim consolidation: group all 4 stroke variants + legacy bare
          // "Swimming · ..." labels under a single SWIMMING_BASE_NAME key.
          // The collapsed row shows the best per-100m pace across all
          // strokes plus a small badge for the most-recently-trained stroke.
          if (isSwimActivity(head)) {
            const stroke = parseSwimStroke(e.label)
            const secs = parsePaceToSecs(e.value)
            if (secs === null) return
            const existing = map.get(SWIMMING_BASE_NAME)
            const newBest = !existing || secs < existing.secs
            // Efforts come in chronological order, so the last forEach iter
            // we hit is the most-recent — always overwrite the stroke field.
            map.set(SWIMMING_BASE_NAME, {
              name:         SWIMMING_BASE_NAME,
              displayValue: newBest ? e.value         : existing!.displayValue,
              secs:         newBest ? secs            : existing!.secs,
              mode:         'pace',
              swimMostRecentStroke: stroke,
            })
            return
          }
          // Air Bike (calorie mode): label = "Air Bike · 50 cal in 5:00",
          // value = "12.0 cal/min". "Best" = HIGHEST cal/min rate, not
          // lowest pace. We stash the rate in `secs` (re-used field;
          // higher = better unlike pace) and the display value reads
          // "12.0 cal/min" directly from the stored value column.
          if (isAirBikeActivity(head)) {
            const parsed = parseAirBikeLabel(e.label)
            if (!parsed || !parsed.timeSecs) return
            const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
            if (rate <= 0) return
            const existing = map.get(head)
            // Higher rate is better — keep the MAX across all efforts.
            if (!existing || rate > existing.secs) {
              map.set(head, {
                name:         head,
                displayValue: `${rate.toFixed(1)} cal/min`,
                secs:         rate,
                mode:         'pace',
              })
            }
            return
          }
          // StairMill (floors-per-minute coaching surface): label =
          // "StairMill · 245 floors in 20:00", value = "12.3 floors/min".
          // Same shape as Air Bike — "best" = HIGHEST FPM rate, not lowest
          // pace, and we stash the rate in `secs` (higher = better). Legacy
          // "StairMill · 20:00" labels (no floors) yield FPM = 0 and would
          // never win the max-rate comparison, so they're correctly
          // ignored for the "best" calculation but still contribute to
          // the count of logged sessions.
          if (isStairMillActivity(head)) {
            const parsed = parseStairMillLabel(e.label)
            if (!parsed || !parsed.timeSecs) return
            const rate = floorsPerMinFromEffort(parsed.floors, parsed.timeSecs)
            const existing = map.get(head)
            if (rate > 0 && (!existing || rate > existing.secs)) {
              map.set(head, {
                name:         head,
                // "fl/min" matches the abbreviation used in the hero card
                // and the log form wheel — keeps the activity list compact
                // and consistent with every other rate-anchored card (Air
                // Bike: "cal/min", ergs: "W"). The full "floors/min" still
                // appears in the detail page subtitle / chart / log list.
                displayValue: `${rate.toFixed(1)} fl/min`,
                secs:         rate,
                mode:         'pace',
              })
            } else if (!existing) {
              // Legacy floors=0 entry — surface the row anyway so the user
              // sees their StairMill activity in the list. Display a dash
              // for the metric column until a fresh effort with floors > 0
              // overrides it.
              map.set(head, {
                name:         head,
                displayValue: '—',
                secs:         0,
                mode:         'pace',
              })
            }
            return
          }
          // Non-swim / non-airbike — existing aggregation logic
          const name    = head
          const actMode = (dbMovements.find(m => m.name === name)?.cardio_mode as 'pace' | 'duration' | undefined) || 'pace'
          if (actMode === 'pace') {
            const secs = parsePaceToSecs(e.value)
            if (secs === null) return
            const existing = map.get(name)
            if (!existing || secs < existing.secs) {
              map.set(name, { name, displayValue: e.value, secs, mode: 'pace' })
            }
          } else {
            const secs = parseTimeStr(e.value)
            if (!secs) return
            const existing = map.get(name)
            if (!existing || secs > existing.secs) {
              map.set(name, { name, displayValue: e.value, secs, mode: 'duration' })
            }
          }
        })
        setActivities([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
        setLoading(false)
      })
  }, [user, saved, dbMovements])

  // ── Derived state ─────────────────────────────────────────────────────────
  // distKm + effectiveTimeSecs describe the whole session.
  //   - Pace mode:  user enters distance + time directly.
  //   - Speed mode: user enters distance + speed; time = distance ÷ speed.
  //   - Swim mode:  user enters distance in m/yd + time directly.
  //   - Duration mode (StairMill): no distance, just time.
  const distKm = isSwimMode
    ? (swimUnit === 'yd'
        ? (Number(distValue) || 0) * 0.0009144   // yd → km
        : (Number(distValue) || 0) / 1000)        // m  → km
    : isRowMode
      ? (Number(distValue) || 0) / 1000           // integer m → km
      : (distUnit === 'mi'
          ? (Number(distValue) || 0) * 1.60934
          : (Number(distValue) || 0))

  // Speed mode: user-entered speed → km/h (convert from mph if needed).
  const speedKmh = isSpeedMode
    ? (distUnit === 'mi'
        ? (Number(speedValue) || 0) * 1.60934
        : (Number(speedValue) || 0))
    : 0

  // Derived time in speed mode (seconds) — exact, not rounded yet.
  const speedModeTimeSecs = (isSpeedMode && distKm > 0 && speedKmh > 0)
    ? (distKm / speedKmh) * 3600
    : 0

  // Effective time used everywhere downstream (chip, label, canSave).
  // In speed mode this is the derived value; otherwise it's parsed from
  // the user-entered timeStr.
  const effectiveTimeSecs = isSpeedMode
    ? Math.round(speedModeTimeSecs)
    : (parseTimeStr(timeStr) ?? 0)

  // Backwards-compat alias — most existing code reads `timeSecs`.
  const timeSecs = effectiveTimeSecs

  // The string form of the effective time, used as-is in the saved label.
  // formatMmSs allows >99 minutes (renders as "120:00"), same as duration
  // mode does for >1h sessions — parseTimeStr handles both shapes on read.
  const effectiveTimeStr = isSpeedMode
    ? formatMmSs(effectiveTimeSecs)
    : timeStr

  // Pace is computed the same way regardless of input mode — distance ÷ time.
  // Storage always normalizes to seconds-per-km for the `value` column so the
  // detail page math works uniformly across activities. Swimming displays
  // per-100m via divide-by-10 at display time, but stores per-km here.
  const livePaceKm: string | null = (() => {
    if (mode !== 'pace' || distKm <= 0 || !effectiveTimeSecs) return null
    const paceSecPerKm = effectiveTimeSecs / distKm
    const m = Math.floor(paceSecPerKm / 60)
    const sc = Math.round(paceSecPerKm % 60)
    return `${m}:${String(sc).padStart(2, '0')}/km`
  })()

  // Display pace — adapts to mode:
  //   • Swim mode:   per-100m (per-100yd in yards mode). The user thinks
  //                  in per-100m, never per-km.
  //   • Row Erg:     per-500m "split" (Concept2 convention). Same data
  //                  as the per-km storage, just divided by 2 for display.
  //   • Mile-unit non-swim: per-mile.
  //   • Everything else: per-km (matches livePaceKm).
  const livePaceDisplay: string | null = (() => {
    if (!livePaceKm) return null
    if (isSwimMode) {
      const paceSecPer100 = (effectiveTimeSecs / distKm) / 10  // pace per 100m derived from /km
      const m = Math.floor(paceSecPer100 / 60)
      const sc = Math.round(paceSecPer100 % 60)
      return `${m}:${String(sc).padStart(2, '0')}/100${swimUnit}`
    }
    if (isRowMode) {
      const secsPerKm = effectiveTimeSecs / distKm
      return pacePer500mFromSecsPerKm(secsPerKm)
    }
    if (distUnit !== 'mi') return livePaceKm
    const paceSecPerMi = (effectiveTimeSecs / distKm) * 1.60934
    const m = Math.floor(paceSecPerMi / 60)
    const sc = Math.round(paceSecPerMi % 60)
    return `${m}:${String(sc).padStart(2, '0')}/mi`
  })()

  // Air Bike's gate is calories + time (no distance). Other pace-mode
  // activities require distance + time; duration mode just needs time.
  // StairMill requires floors + time (the coaching surface anchors on
  // floors-per-minute, so a floors=0 save would be useless).
  const calsNum   = Number(calsValue)   || 0
  const floorsNum = Number(floorsValue) || 0
  const canSave = !!activity?.trim() && (
    isCalorieMode
      ? (calsNum > 0 && effectiveTimeSecs > 0)
      : isStairMillMode
        ? (floorsNum > 0 && effectiveTimeSecs > 0)
        : (mode === 'pace' ? (distKm > 0 && effectiveTimeSecs > 0) : effectiveTimeSecs > 0)
  )

  const saveDisabled = suggestionMode
    ? (suggesting || suggestSent)
    : (saved || !canSave)

  // ── Save ───────────────────────────────────────────────────────────────────
  // Single-format labels only (locked May 2026 — no interval entry mode):
  //   • Pace:     "Running · 5 km in 37:55"
  //   • Duration: "StairMill · 15:00"
  // The user logs their BEST distance × time from any session — could be
  // a continuous run, or one rep from an interval workout. The plan/queue
  // logic only reads pace via `value`, so it doesn't care about rep count.
  // Volume tracking deferred to a future iteration.
  async function saveEffort() {
    if (!user || saved || !canSave) return
    setSaveError('')

    // Label format depends on mode:
    //   • Air Bike (cal): "Air Bike · 50 cal in 5:00"
    //   • Swim mode:      "Swimming · 1500 m in 25:00" (integer m/yd)
    //   • Pace mode:      "Running · 5 km in 37:55"
    //   • Speed mode:     same as pace mode (storage is uniform)
    //   • Duration mode:  "StairMill · 15:00"
    // The value column:
    //   • Air Bike (cal): "N cal/min" (rounded to 0.1; derived from cals÷min)
    //   • Pace mode:      seconds-per-km pace
    //   • Duration mode:  bare time
    // Uniform on the read side per parseEffortLabel / parseAirBikeLabel.
    let label: string
    let value: string
    if (isCalorieMode) {
      const cals = Math.round(Number(calsValue))
      label = `${activity} · ${cals} cal in ${effectiveTimeStr}`
      const rate = calsPerMinFromEffort(cals, effectiveTimeSecs)
      value = `${rate.toFixed(1)} cal/min`
    } else if (mode === 'pace') {
      if (isSwimMode) {
        label = `${activity} · ${Math.round(Number(distValue))} ${swimUnit} in ${effectiveTimeStr}`
      } else if (isRowMode) {
        // Row Erg always saves distance as integer meters
        // ("Row Erg · 5000 m in 18:30"). parseEffortLabel's existing
        // 'm' regex handles the read path.
        label = `${activity} · ${Math.round(Number(distValue))} m in ${effectiveTimeStr}`
      } else if (isRuckMode) {
        // Rucking save format includes pack weight:
        //   "Rucking · 35 lb × 2.5 mi in 45:00"
        // Pack weight = 0 → save without weight (legacy format):
        //   "Rucking · 2.5 mi in 45:00"
        // RuckingDetail's parseRuckLabel handles both shapes.
        const packLb = Math.round(Number(packWeightValue) || 0)
        const distMi = parseFloat(Number(distValue).toFixed(2))
        label = packLb > 0
          ? `${activity} · ${packLb} lb × ${distMi} mi in ${effectiveTimeStr}`
          : `${activity} · ${distMi} mi in ${effectiveTimeStr}`
      } else {
        label = `${activity} · ${parseFloat(Number(distValue).toFixed(3))} ${distUnit} in ${effectiveTimeStr}`
      }
      value = livePaceKm!
    } else {
      // StairMill — duration-mode but stores floors alongside time so the
      // detail page can derive floors-per-minute. parseStairMillLabel on
      // the read side accepts both the new format AND the legacy
      // duration-only format for back-compat.
      if (isStairMillMode && floorsNum > 0) {
        label = `${activity} · ${Math.round(floorsNum)} floors in ${effectiveTimeStr}`
        const fpm = floorsNum / (effectiveTimeSecs / 60)
        value = `${fpm.toFixed(1)} floors/min`
      } else {
        label = `${activity} · ${effectiveTimeStr}`
        value = effectiveTimeStr
      }
    }

    const { error } = await supabase.from('efforts').insert({
      user_id: user.id, type: 'cardio', label, value,
    })
    if (error) { setSaveError('Failed to save. Try again.'); return }
    setSaved(true)
    setTimeout(() => {
      setActivity(''); setDistValue(''); setTimeStr(''); setSpeedValue(''); setCalsValue('')
      setPackWeightValue('0')
      setFloorsValue('0')
      setPendingQuery(''); setMovementKey(k => k + 1)
    }, 1500)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Skeleton — placeholder before the first cardio efforts fetch resolves.
  // Heights approximate header + log-form card + Your Activities list card
  // so the structure is visible during the initial paint.
  if (loading) {
    return (
      <View style={s.page}>
        <View style={{ gap: 6 }}>
          <Skeleton style={{ height: 22, width: 100, borderRadius: 6 }} />
          <Skeleton style={{ height: 14, width: 240, borderRadius: 6 }} />
        </View>
        <Skeleton style={{ height: 220, width: '100%', borderRadius: 12 }} />
        <Skeleton style={{ height: 320, width: '100%', borderRadius: 12 }} />
      </View>
    )
  }

  return (
    <View style={s.page}>

      <View>
        <Text style={s.h1}>Cardio</Text>
        <Text style={s.subText}>
          {mode === 'duration'
            ? 'Log your session time to track progress.'
            : 'Log distance and time to track your pace.'}
        </Text>
      </View>

      <AnimateRise delay={0} style={[s.card, s.cardWithDropdown]}>

        {/* Activity search */}
        <View style={s.field}>
          <Text style={s.label}>Activity</Text>
          <MovementSearch
            key={movementKey}
            value={activity}
            onChange={setActivity}
            onSuggest={isAdmin ? undefined : handleSuggestMove}
            onQueryChange={isAdmin ? undefined : setPendingQuery}
            movements={cardioNames}
            placeholder="Search or type activity…"
          />
        </View>

        {suggestionMode ? (
          <Text style={s.helpText}>
            This activity isn't in our list yet. Send it as a suggestion and your coach will add it.
          </Text>
        ) : !activity ? null : mode === 'duration' ? (
          <>
            {/* StairMill log form — two-column grid: Floors | Time.
                Both wheels required (canSave guards on floors > 0 AND
                time > 0). Floors = the number the user reads off the
                most prominent number on the StairMaster console.
                Generic duration-mode activities (none currently — Arc
                Trainer was removed May 17) still get just the Duration
                wheel via the else-branch. */}
            {isStairMillMode ? (
              <>
                <View style={s.tripleGrid}>
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Floors</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={Number(floorsValue) || 0}
                        onChange={(v) => setFloorsValue(String(v))}
                        step={1}
                        min={0}
                        max={500}
                        unit="fl"
                      />
                    </WheelInput>
                  </View>
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Time</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={parseTimeStr(timeStr) || 0}
                        onChange={(secs) => setTimeStr(formatMmSs(secs))}
                        time="mm:ss"
                        maxMinutes={99}
                      />
                    </WheelInput>
                  </View>
                </View>

                {/* Live chips — primary FPM rate (the coaching anchor) +
                    session time. Mirrors Air Bike's rate chip pattern. */}
                {floorsNum > 0 && effectiveTimeSecs > 0 && (
                  <ChipAmber>
                    <Activity size={14} color={palette.amber[400]} />
                    <Text style={s.chipLabel}>Climb rate</Text>
                    <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                      {(floorsNum / (effectiveTimeSecs / 60)).toFixed(1)} floors/min
                    </Text>
                  </ChipAmber>
                )}
              </>
            ) : (
              <>
                <View style={s.field}>
                  <Text style={s.label}>Duration</Text>
                  <WheelInput>
                    {/* hh:mm:ss split-reel time picker via PhantomWheel's
                        time mode. Cardio Duration tops out at 3 hours so this
                        is the only place in the app where the hours reel
                        matters in practice. Controlled value is total
                        seconds in `timeStr`. */}
                    <PhantomWheel
                      value={parseTimeStr(timeStr) || 0}
                      onChange={(secs) => setTimeStr(formatMmSs(secs))}
                      time="hh:mm:ss"
                      maxHours={3}
                    />
                  </WheelInput>
                </View>

                {timeSecs > 0 && (
                  <ChipAmber>
                    <Timer size={14} color={palette.amber[400]} />
                    <Text style={s.chipLabel}>Session time</Text>
                    <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                      {fmtSecs(timeSecs)}
                    </Text>
                  </ChipAmber>
                )}
              </>
            )}
          </>

        ) : (
          /* Pace mode — single distance + time entry. Log your best effort
              from any session — could be a continuous run, or one rep from
              an interval workout. The plan reads the resulting PACE to
              classify zone, so the data captured is what matters most.

              Three sub-modes:
              • Default pace (outdoor / generic): Distance | Unit toggle | Time
              • Speed mode (5 machines): Distance | Speed | Unit toggle
              • Swim mode (Swimming only):       Distance | Unit (locked m/yd) | Time
            */
          <>
            <Text style={s.helpText}>
              {isCalorieMode
                ? "Log how many calories you hit on the machine display and the time it took. We'll compute your cal/min rate."
                : isSwimMode
                  ? "Log your best distance and time from this session — a single rep or a continuous swim, your choice."
                  : isSpeedMode
                    ? "Log your distance and the speed you set on the machine. We'll compute the time for you."
                    : 'Log your best distance and time from this session — even a single rep of an interval workout counts.'}
            </Text>

            {/* Triple grid — FOUR layouts share the same chrome (75 px field
                height, 8 px gap, 48 px Unit column — all GLOBAL spec from
                CLAUDE.md). Big-column flex differs by mode:

                Pace mode (outdoor): Distance | Unit | Time
                  - gridPaceDistance flex 3.0 (Distance carries unit suffix
                    "26.2 km" — needs extra room)
                  - gridUnit width 48 (Unit toggle between distance + time)
                  - gridPaceTime flex 2.1 (Time "25:00" is narrower)

                Speed mode (5 machines): Distance | Speed | Unit
                  - Both Distance and Speed are decimal wheels with NO unit
                    suffix (Unit toggle at the end declares the km/mi basis
                    for both fields — column headers "Distance" and "Speed"
                    disambiguate the dimension). Both use gridLarge (flex
                    2.55, symmetric) since their content widths are similar
                    ("5.0" / "10.5") without the unit suffix dragging.
                  - gridUnit width 48 at the END.

                Swim mode (Swimming): Distance | Unit (locked) | Time
                  - Distance wheel is INTEGER (step 25, min 0, max 5000) in
                    m or yd. Pool distances always come in whole numbers
                    of pool lengths.
                  - Unit column is a LOCKED chip showing "m" or "yd" pulled
                    from profile.swim_unit — not a toggle (the user sets
                    this once in Settings; toggling per-log would be friction).
                  - Time stays mm:ss.

                Calorie mode (Air Bike): Calories | Time (2 columns)
                  - Calories is INTEGER wheel (step 1, min 0, max 300) — the
                    user reads cal count off the machine display.
                  - No distance, no speed, no unit column. Time stays mm:ss.
                  - Both columns use gridLarge (flex 2.55, symmetric) since
                    "150 cal" and "5:00" are similar widths. 2-column layout
                    means the grid is more spacious than the 3-column ones.
            */}
            {isRuckMode ? (
              <>
                {/* Rucking — Atlas-style quad-grid for row 1 + Time alone
                    on row 2. Mirrors strength's carry log form
                    byte-for-byte: 2 wheels + 2 unit chips, inline units
                    stripped from both wheels (the unit chip to the right
                    declares each one). Rucking sits OUTSIDE the
                    tripleGrid wrapper because it needs two stacked rows;
                    every other mode below is a single row of fields.
                    • Pack Weight uses a discrete LADDER (real GoRuck /
                      Rogue plate sizes including 0 for bodyweight
                      rucking) — same logic as Atlas Stone's discrete
                      kg-only stone weights.
                    • Distance is continuous decimal mi (0.1-mi step)
                      capped at 20.0 mi — covers GoRuck Tough's 12 mi
                      comfortably; multi-hour Heavy / Selection events
                      are off-app per CLAUDE.md's 45-min philosophy.
                    • Both units are LOCKED (rucking community is
                      universally imperial; no kg or km option). */}
                <View style={s.quadGrid}>
                  <View style={[s.field, s.gridQuadLarge]}>
                    <Text style={s.label}>Pack weight</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={Number(packWeightValue) || 0}
                        onChange={(v) => setPackWeightValue(String(v))}
                        ladder={RUCK_WEIGHT_LOG_LADDER_LB}
                      />
                    </WheelInput>
                  </View>
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    <View style={s.unitLockedBox}>
                      <Text style={s.unitLockedText} numberOfLines={1}>lb</Text>
                    </View>
                  </View>
                  <View style={[s.field, s.gridQuadLarge]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={distValue === '' ? 0 : Math.max(0, Math.round(Number(distValue) * 10))}
                        onChange={(tenths) => setDistValue(String(tenths / 10))}
                        decimal="XX.X"
                        min={0} max={200}
                      />
                    </WheelInput>
                  </View>
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    <View style={s.unitLockedBox}>
                      <Text style={s.unitLockedText} numberOfLines={1}>mi</Text>
                    </View>
                  </View>
                </View>
                {/* Row 2 — Time alone, full width. Squeezing it into row 1
                    with three other fields crowded everything off-screen
                    on phone widths; stacking gives Time room to breathe
                    and matches the layout pattern of the cardio Duration
                    mode. */}
                <View style={s.field}>
                  <Text style={s.label}>Time</Text>
                  <WheelInput>
                    <PhantomWheel
                      value={parseTimeStr(timeStr) || 0}
                      onChange={(secs) => setTimeStr(formatMmSs(secs))}
                      time="mm:ss"
                      maxMinutes={99}
                    />
                  </WheelInput>
                </View>
              </>
            ) : (
            <View style={s.tripleGrid}>
              {isCalorieMode ? (
                <>
                  {/* Calories — integer wheel, no unit suffix. Cal count is
                      what users read off the air bike's console; distance
                      and pace are barely used in real air-bike programming. */}
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Calories</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={Number(calsValue) || 0}
                        onChange={(v) => setCalsValue(String(v))}
                        step={1}
                        min={0}
                        max={300}
                        unit="cal"
                      />
                    </WheelInput>
                  </View>
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Time</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={parseTimeStr(timeStr) || 0}
                        onChange={(secs) => setTimeStr(formatMmSs(secs))}
                        time="mm:ss"
                        maxMinutes={99}
                      />
                    </WheelInput>
                  </View>
                </>
              ) : isRowMode ? (
                <>
                  {/* Row Erg — integer-meter wheel, step 100. Concept2
                      community is universally metric and tracks rowing
                      distance in whole meters. Range 0-30000 covers a
                      10K piece comfortably. Inline unit dropped — the
                      "m" locked chip to the right already declares it. */}
                  <View style={[s.field, s.gridPaceDistance]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={Number(distValue) || 0}
                        onChange={(v) => setDistValue(String(v))}
                        step={100}
                        min={0}
                        max={30000}
                      />
                    </WheelInput>
                  </View>
                  {/* Locked unit — always 'm' for rowing. Same chrome as
                      swim mode's locked unit chip. Tap doesn't toggle —
                      Concept2 standard. */}
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    <View style={s.unitLockedBox}>
                      <Text style={s.unitLockedText} numberOfLines={1}>m</Text>
                    </View>
                  </View>
                  <View style={[s.field, s.gridPaceTime]}>
                    <Text style={s.label}>Time</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={parseTimeStr(timeStr) || 0}
                        onChange={(secs) => setTimeStr(formatMmSs(secs))}
                        time="mm:ss"
                        maxMinutes={99}
                      />
                    </WheelInput>
                  </View>
                </>
              ) : isSwimMode ? (
                <>
                  {/* Distance — integer wheel. Inline unit dropped — the
                      locked unit chip in the middle column declares m or yd. */}
                  <View style={[s.field, s.gridPaceDistance]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={Number(distValue) || 0}
                        onChange={(v) => setDistValue(String(v))}
                        step={25}
                        min={0}
                        max={5000}
                      />
                    </WheelInput>
                  </View>
                  {/* Locked unit — m or yd from profile. Tappable hint:
                      change it in Settings. Same chrome as Rucking's
                      unit-locked chip. */}
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    <View style={s.unitLockedBox}>
                      <Text style={s.unitLockedText} numberOfLines={1}>{swimUnit}</Text>
                    </View>
                  </View>
                  <View style={[s.field, s.gridPaceTime]}>
                    <Text style={s.label}>Time</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={parseTimeStr(timeStr) || 0}
                        onChange={(secs) => setTimeStr(formatMmSs(secs))}
                        time="mm:ss"
                        maxMinutes={99}
                      />
                    </WheelInput>
                  </View>
                </>
              ) : isSpeedMode ? (
                <>
                  {/* Distance — no unit suffix (toggle at end declares it) */}
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={distValue === '' ? 1 : Math.max(0, Math.round(Number(distValue) * 10))}
                        onChange={(tenths) => setDistValue(String(tenths / 10))}
                        decimal="XX.X"
                        min={0} max={500}
                      />
                    </WheelInput>
                  </View>
                  {/* Speed — no unit suffix; column header tells the user
                      what dimension this is (km/h or mph implied by toggle).
                      Max scrollable range is per-machine (see
                      `speedMaxTenths` in `movements.ts`) — caps slightly
                      above each machine's realistic top speed so users
                      can't dial in physically impossible numbers but
                      genuine sprint bursts still fit. */}
                  <View style={[s.field, s.gridLarge]}>
                    <Text style={s.label}>Speed</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={speedValue === '' ? 1 : Math.max(0, Math.round(Number(speedValue) * 10))}
                        onChange={(tenths) => setSpeedValue(String(tenths / 10))}
                        decimal="XX.X"
                        min={0} max={speedMaxTenths(activity, distUnit)}
                      />
                    </WheelInput>
                  </View>
                  {/* Unit toggle at the END — same chrome as pace mode but
                      moved here so the two related decimal fields sit
                      side-by-side without the toggle splitting them. */}
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    {unitLock ? (
                      <View style={s.unitLockedBox}><Text style={s.unitLockedText} numberOfLines={1}>{unitLock}</Text></View>
                    ) : (
                      <UnitToggle value={distUnit} options={['km', 'mi'] as const} onChange={setDistUnit} vertical />
                    )}
                  </View>
                </>
              ) : (
                <>
                  {/* Default pace mode (outdoor running, cycling, elliptical).
                      Inline unit dropped — the km/mi toggle in the middle
                      column declares it. */}
                  <View style={[s.field, s.gridPaceDistance]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={distValue === '' ? 1 : Math.max(0, Math.round(Number(distValue) * 10))}
                        onChange={(tenths) => setDistValue(String(tenths / 10))}
                        decimal="XX.X"
                        min={0} max={500}
                      />
                    </WheelInput>
                  </View>
                  <View style={[s.field, s.gridUnit]}>
                    <Text style={s.label}>Unit</Text>
                    {unitLock ? (
                      <View style={s.unitLockedBox}><Text style={s.unitLockedText} numberOfLines={1}>{unitLock}</Text></View>
                    ) : (
                      <UnitToggle value={distUnit} options={['km', 'mi'] as const} onChange={setDistUnit} vertical />
                    )}
                  </View>
                  <View style={[s.field, s.gridPaceTime]}>
                    <Text style={s.label}>Time</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={parseTimeStr(timeStr) || 0}
                        onChange={(secs) => setTimeStr(formatMmSs(secs))}
                        time="mm:ss"
                        maxMinutes={99}
                      />
                    </WheelInput>
                  </View>
                </>
              )}
            </View>
            )}

            {/* Live chip(s) below the grid.
                  - Air Bike (calorie mode):          one chip showing cal/min rate.
                  - Pace mode (user entered time):    one chip showing Pace.
                  - Speed mode (user entered speed):  TWO chips — Time
                    (primary, what the user usually wants to see fall out)
                    and Pace (secondary, what the system stores + classifies
                    zone with). Both render once distance + speed are > 0. */}
            {isCalorieMode ? (
              calsNum > 0 && effectiveTimeSecs > 0 ? (
                <ChipAmber>
                  <Activity size={14} color={palette.amber[400]} />
                  <Text style={s.chipLabel}>Rate</Text>
                  <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                    {calsPerMinFromEffort(calsNum, effectiveTimeSecs).toFixed(1)} cal/min
                  </Text>
                </ChipAmber>
              ) : null
            ) : isSpeedMode ? (
              effectiveTimeSecs > 0 && livePaceDisplay ? (
                <>
                  <ChipAmber>
                    <Timer size={14} color={palette.amber[400]} />
                    <Text style={s.chipLabel}>Session time</Text>
                    <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                      {fmtSecs(effectiveTimeSecs)}
                    </Text>
                  </ChipAmber>
                  <ChipAmber>
                    <Activity size={14} color={palette.amber[400]} />
                    <Text style={s.chipLabel}>Pace</Text>
                    <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                      {livePaceDisplay}
                    </Text>
                  </ChipAmber>
                </>
              ) : null
            ) : isRuckMode ? (
              /* Rucking — show pack weight × distance as the headline metric
                 (the two axes the detail page tracks). Pace is a derived
                 read-only secondary chip. The user thinks in load + miles,
                 not in min/mi pace. The soft safety warning shows as soon as the
                 pack is over ~1/3 BW, independent of distance/time. */
              <>
                {ruckOverCap ? (
                  <ChipAmber>
                    <AlertTriangle size={14} color={palette.amber[400]} />
                    <Text style={[s.chipLabel, { flex: 1, lineHeight: 16 }]}>
                      Heads up: {ruckPackLb} lb is {ruckPctBw}% of your bodyweight. Rucking guidance keeps loaded carries near a third of bodyweight, so build up to this gradually.
                    </Text>
                  </ChipAmber>
                ) : null}
                {(Number(distValue) > 0 && effectiveTimeSecs > 0) ? (
                  <>
                    <ChipAmber>
                      <Activity size={14} color={palette.amber[400]} />
                      <Text style={s.chipLabel}>Ruck</Text>
                      <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                        {Math.round(Number(packWeightValue) || 0)} lb × {parseFloat(Number(distValue).toFixed(2))} mi
                      </Text>
                    </ChipAmber>
                    {livePaceDisplay ? (
                      <ChipAmber>
                        <Timer size={14} color={palette.amber[400]} />
                        <Text style={s.chipLabel}>Pace</Text>
                        <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                          {livePaceDisplay}
                        </Text>
                      </ChipAmber>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              livePaceDisplay ? (
                <ChipAmber>
                  <Activity size={14} color={palette.amber[400]} />
                  <Text style={s.chipLabel}>Pace</Text>
                  <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                    {livePaceDisplay}
                  </Text>
                </ChipAmber>
              ) : null
            )}
          </>
        )}

        {(activity || suggestionMode) ? (
          <>
            <Pressable
              onPress={() => suggestionMode ? handleSuggestMove(pendingQuery) : saveEffort()}
              disabled={saveDisabled}
              style={[
                s.saveBtn,
                suggestionMode
                  ? (suggestSent ? s.saveBtnSent
                     : suggesting ? s.saveBtnSuggesting
                     : s.saveBtnPrimary)
                  : (saved ? s.saveBtnSaved
                     : canSave ? s.saveBtnPrimary
                     : s.saveBtnDisabled),
              ]}
            >
              <Text style={[
                s.saveBtnText,
                suggestionMode
                  ? (suggestSent ? { color: palette.amber[400] } : { color: '#fff' })
                  : (saved ? { color: palette.amber[400] }
                     : canSave ? { color: '#fff' }
                     : { color: colors.mutedForeground }),
              ]}>
                {suggestionMode
                  ? (suggestSent ? '✓ Suggestion Sent' : suggesting ? 'Sending…' : 'Send Suggestion')
                  : (saved ? '✓ Saved' : 'Save Effort')}
              </Text>
            </Pressable>

            {suggestSent && (
              <View style={s.suggestSentBox}>
                <Check size={14} color={palette.amber[400]} />
                <Text style={[s.tinyText, { color: palette.amber[400] }]}>
                  Suggestion sent to your coach.
                </Text>
              </View>
            )}

            {saveError ? <Text style={s.errorText}>{saveError}</Text> : null}
          </>
        ) : null}
      </AnimateRise>

      {/* Your activities */}
      {activities.length > 0 && (
        <AnimateRise delay={120} style={[s.card, s.cardNoPad]}>
          <View style={s.listHeader}>
            <Text style={s.listHeaderText}>Your activities</Text>
          </View>
          <View>
            {activities.map((act, i) => (
              <Pressable
                key={act.name}
                onPress={() => router.push(`/effort/cardio/${encodeURIComponent(act.name)}` as any)}
                style={({ pressed }) => [
                  s.listRow,
                  i < activities.length - 1 && s.listRowDivider,
                  pressed && { backgroundColor: alpha(colors.accent, 0.5) },
                ]}
              >
                <Text style={s.listRowName}>{act.name}</Text>
                <View style={s.listRowRight}>
                  {act.mode === 'duration' ? (
                    <>
                      <Text style={s.listRowSub}>Best time</Text>
                      <Text style={s.listRowVal}>{fmtSecs(act.secs)}</Text>
                    </>
                  ) : isAirBikeActivity(act.name) ? (
                    /* Air Bike — calorie mode. Shows "Best rate — N cal/min"
                       directly from the stored displayValue (set by the
                       aggregation above). Higher = better, no inversion. */
                    <>
                      <Text style={s.listRowSub}>Best rate</Text>
                      <Text style={s.listRowVal}>{act.displayValue}</Text>
                    </>
                  ) : isRowErgActivity(act.name) ? (
                    /* Row Erg — Concept2 convention. Shows split per 500m
                       derived from the stored per-km pace (divide by 2).
                       Lower split = faster, same direction as pace. */
                    <>
                      <Text style={s.listRowSub}>Best split</Text>
                      <Text style={s.listRowVal}>{pacePer500mFromSecsPerKm(act.secs)}</Text>
                    </>
                  ) : act.name === SWIMMING_BASE_NAME ? (
                    /* Swimming — 4 stroke variants consolidated into one
                       row. Shows best pace per 100m (or 100yd) across all
                       strokes, plus a small badge for the most-recent
                       stroke (FREE / BACK / BREAST / FLY). Mirrors the
                       Sled Work PUSH / PULL badge pattern from strength. */
                    <>
                      <Text style={s.listRowSub}>Best pace</Text>
                      <Text style={s.listRowVal}>{(() => {
                        if (!act.secs || act.secs <= 0) return '—'
                        const secsPer100 = act.secs / 10
                        const mm = Math.floor(secsPer100 / 60)
                        const ss = Math.round(secsPer100 % 60)
                        return `${mm}:${String(ss).padStart(2, '0')}/100${swimUnit}`
                      })()}</Text>
                      {act.swimMostRecentStroke && (
                        <View style={s.swimStrokeBadge}>
                          <Text style={s.swimStrokeBadgeText}>
                            {SWIM_STROKE_LABELS[act.swimMostRecentStroke].short}
                          </Text>
                        </View>
                      )}
                    </>
                  ) : SPEED_INPUT_ACTIVITIES.has(act.name) ? (
                    /* Speed machines — show best speed (km/h or mph) instead
                       of best pace. act.secs is pace seconds per km regardless
                       of how it was entered (storage is uniform). Convert to
                       speed_kmh = 3600 / secs, then to mph if needed. */
                    <>
                      <Text style={s.listRowSub}>Best speed</Text>
                      <Text style={s.listRowVal}>{(() => {
                        if (!act.secs || act.secs <= 0) return '—'
                        const kmh = 3600 / act.secs
                        const v   = distUnit === 'mi' ? kmh / 1.60934 : kmh
                        return `${v.toFixed(1)} ${distUnit === 'mi' ? 'mph' : 'km/h'}`
                      })()}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.listRowSub}>Best pace</Text>
                      <Text style={s.listRowVal}>{
                        distUnit === 'mi'
                          ? (() => {
                              const m = act.displayValue?.match(/^(\d+):(\d{2})\//)
                              if (!m) return act.displayValue
                              const spm = (parseInt(m[1]) * 60 + parseInt(m[2])) * 1.60934
                              return `${Math.floor(spm / 60)}:${String(Math.round(spm % 60)).padStart(2, '0')}/mi`
                            })()
                          : act.displayValue
                      }</Text>
                    </>
                  )}
                  <ChevronRight size={16} color={colors.mutedForeground} />
                </View>
              </Pressable>
            ))}
          </View>
        </AnimateRise>
      )}

    </View>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ChipAmber({ children }: { children: React.ReactNode }) {
  return (
    <View style={[chipS.row, {
      borderColor: withAlpha(palette.amber[500], 0.25),
      backgroundColor: withAlpha(palette.amber[500], 0.08),
    }]}>{children}</View>
  )
}

const chipS = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 16, paddingVertical: 10,
  },
})

// ── Main styles ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { gap: 24 },

  h1:      { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  subText: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  card: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 20, gap: 16,
  },
  cardNoPad: { padding: 0, gap: 0 },
  // Form card hosts the MovementSearch dropdown — needs to render above the
  // "Your activities" card below. RN's zIndex stacks within siblings.
  cardWithDropdown: { zIndex: 10, elevation: 0 },

  field: { gap: 6 },
  label: { color: colors.mutedForeground, fontSize: 14 },
  input: {
    backgroundColor: alpha(colors.input, 0.30),
    borderColor: colors.border, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    color: colors.foreground, fontSize: 14, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },
  helpText:  { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  tinyText:  { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },
  errorText: { color: colors.destructive, fontSize: 12, lineHeight: 16 },

  // Triple-grid spec — globally-locked values match strength.tsx exactly:
  //   - tripleGrid.gap        (8 px)
  //   - gridUnit.width        (48 px — every Unit column on every page)
  //   - FIELD_HEIGHT          (75 px — every row of fields on every page)
  //   - vertical UnitToggle   (lb/kg or mi/km stacked, not side-by-side)
  // The "big" column flex values, however, are PER-PAGE — Distance content
  // ("26.2 km" / "26.2 mi", 6–8 chars w/ unit) is longer than mm:ss Time
  // content ("25:00" / "180:00", 5–6 chars), so cardio's pace row uses
  // ASYMMETRIC larges. Strength's carry row keeps symmetric larges because
  // its Weight and Distance fields show similar-width content there.
  // See CLAUDE.md "Field sizing parity (strength ↔ cardio)" for the rule.
  tripleGrid: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  gridSmall:  { flex: 0.85 },           // not used on cardio today, kept for parity
  gridLarge:  { flex: 2.55 },           // unused on cardio today, kept for parity
  gridUnit:   { width: 48 },            // fixed-width Unit column (GLOBAL spec)
  // Pace-mode asymmetric larges — Distance gets the extra room so its
  // "100.0 km" / "26.2 mi" content has breathing space; Time gives some up.
  // Math (on a 320-px-wide card after 40 px page padding): 320 - 16 (gaps) -
  // 48 (Unit) = 256 for the two larges. With 3.0/2.1 ratio that's ~150 px
  // for Distance, ~106 px for Time — well above the widest content each
  // wheel can render in JetBrainsMono Bold.
  gridPaceDistance: { flex: 3.0 },
  gridPaceTime:     { flex: 2.1 },

  // Quad grid for Rucking row 1 — [Pack Weight] [lb chip] [Distance] [mi chip].
  // Mirrors strength's carry-mode quad grid byte-for-byte. Both wheel columns
  // get `flex: 1` so they split the remaining space evenly after the two
  // 48-px unit chips. Row 2 below it is the Time wheel full-width.
  quadGrid:        { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  gridQuadLarge:   { flex: 1 },

  // Read-only unit indicator shown in place of UnitToggle when the selected
  // activity has `unit_lock` (none today; future-proof). Visual matches the
  // toggle's active state so the layout doesn't shift, but it's non-interactive.
  // Locked spec mirrors strength.tsx exactly.
  unitLockedBox: {
    height: FIELD_HEIGHT,
    paddingHorizontal: 8, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.input, 0.10),
    borderColor: colors.border, borderWidth: 1, borderRadius: 6,
  },
  unitLockedText: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  chipLabel: { color: colors.mutedForeground, fontSize: 12 },
  chipValue: { fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], fontSize: 16 },

  saveBtn:           { paddingVertical: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  saveBtnPrimary:    { backgroundColor: palette.amber[500] },
  saveBtnSuggesting: { backgroundColor: withAlpha(palette.amber[500], 0.6) },
  saveBtnSaved:      { backgroundColor: withAlpha(palette.amber[500], 0.15), borderColor: withAlpha(palette.amber[500], 0.30), borderWidth: 1 },
  saveBtnSent:       { backgroundColor: withAlpha(palette.amber[500], 0.15), borderColor: withAlpha(palette.amber[500], 0.30), borderWidth: 1 },
  saveBtnDisabled:   { backgroundColor: colors.muted, opacity: 0.5 },
  saveBtnText:       { fontSize: 14, fontWeight: '700' },

  suggestSentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: withAlpha(palette.amber[500], 0.10),
    borderColor: withAlpha(palette.amber[500], 0.30), borderWidth: 1,
  },

  listHeader: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  listHeaderText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  listRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  listRowName:    { color: colors.foreground, fontSize: 14, fontWeight: '500', flex: 1, marginRight: 12 },
  listRowRight:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listRowSub:     { color: colors.mutedForeground, fontSize: 12 },
  listRowVal: {
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    fontSize: 14, color: palette.amber[400],
  },

  // Most-recent-stroke badge on the consolidated Swimming row. Mirrors
  // the small PUSH / PULL badge that the strength index renders for the
  // Sled Work consolidated row.
  swimStrokeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: withAlpha(palette.amber[500], 0.5),
    backgroundColor: withAlpha(palette.amber[500], 0.12),
    marginLeft: 6,
  },
  swimStrokeBadgeText: {
    color: palette.amber[400],
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
})
