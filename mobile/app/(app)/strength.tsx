/**
 * Strength — direct port of MyRX/src/pages/Strength.jsx to React Native.
 *
 * Layout 1:1:
 *   1. Header (title + dynamic subtext)
 *   2. Form card (animate-rise):
 *      ├─ Movement search (combobox modal)
 *      ├─ Conditional input fields by movement type:
 *      │    • isometric            → duration mm:ss
 *      │    • assisted machine     → reps + assistance + unit
 *      │    • carry                → weight + unit + distance(m)
 *      │    • standard / bodyweight→ reps + weight + unit + optional band/knee
 *      ├─ Live feedback chip (1RM / hold / carry totals)
 *      └─ Save button
 *   3. "Your movements" list — best-effort per movement, navigates to detail
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Dumbbell, Timer, ChevronRight, Check } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { estimate1RM, getLadder, type LadderEquipment, type LadderUnit } from '../../src/lib/formulas'
import { useMovements } from '../../src/hooks/useMovements'
import MovementSearch from '../../src/components/MovementSearch'
import PhantomWheel from '../../src/components/PhantomWheel'
import AnimateRise from '../../src/components/AnimateRise'
import UnitToggle from '../../src/components/UnitToggle'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Helpers (1:1 with Strength.jsx) ──────────────────────────────────────────

function parseTimeStr(str: string): number | null {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

/** Format seconds → "MM:SS" (always two-digit minutes & seconds). */
function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Wheel sizing helpers (mirror of Strength.jsx) ────────────────────────────
function defaultWeight(equipment: string | undefined | null, unit: LadderUnit): number {
  if (equipment === 'barbell')    return unit === 'kg' ?  60 : 135
  if (equipment === 'dumbbell')   return unit === 'kg' ?  20 :  40
  if (equipment === 'kettlebell') return unit === 'kg' ?  16 :  35
  if (equipment === 'strongman')  return unit === 'kg' ? 100 : 220
  if (equipment === 'machine')    return unit === 'kg' ?  45 : 100
  if (equipment === 'assisted')   return unit === 'kg' ?  25 :  50
  if (equipment === 'bodyweight') return 0
  if (equipment === 'carry')      return unit === 'kg' ?  25 :  50
  return unit === 'kg' ? 25 : 50
}

interface WheelRange { step?: number; min?: number; max?: number; ladder?: readonly number[] }
function weightWheelProps(equipment: string | undefined | null, unit: LadderUnit, name = ''): WheelRange {
  const lower = (name || '').toLowerCase()
  if (equipment === 'carry') {
    if (lower.includes('atlas'))                              return { ladder: getLadder('atlasStone', unit) ?? undefined }
    if (lower.includes('d-ball') || lower.includes('dball'))  return { ladder: getLadder('dBall', unit) ?? undefined }
    if (lower.includes('sandbag'))                            return { ladder: getLadder('sandbag', unit) ?? undefined }
    return { step: 5, min: unit === 'kg' ? 5 : 10, max: unit === 'kg' ? 200 : 500 }
  }
  const ladder = equipment ? getLadder(equipment as LadderEquipment, unit) : null
  if (ladder) return { ladder }
  if (equipment === 'barbell')    return { step: 5,   min: unit === 'kg' ? 20 : 45,  max: unit === 'kg' ? 360 : 800 }
  if (equipment === 'dumbbell')   return { step: 5,   min: unit === 'kg' ? 2  : 5,   max: unit === 'kg' ? 70  : 150 }
  if (equipment === 'machine')    return { step: 5,   min: unit === 'kg' ? 2  : 5,   max: unit === 'kg' ? 180 : 400 }
  if (equipment === 'assisted')   return { step: 5,   min: 0,                          max: unit === 'kg' ? 90  : 200 }
  if (equipment === 'bodyweight') return { step: 2.5, min: 0,                          max: unit === 'kg' ? 70  : 150 }
  return { step: 5, min: 0, max: unit === 'kg' ? 200 : 500 }
}

// Fixed height shared by WheelInput, the read-only unitLockedBox, and the
// vertical UnitToggle so all three field types in the triple grid render at
// identical heights and the row aligns cleanly at the bottom.
const FIELD_HEIGHT = 75

function WheelInput({
  children,
  style,
}: {
  children: React.ReactNode
  /** Optional overrides merged AFTER the defaults — use this to nudge
   *  height / padding for a specific field (e.g. Active Hang's Duration
   *  field wants a slightly taller box that extends upward). */
  style?: React.ComponentProps<typeof View>['style']
}) {
  return (
    <View
      style={[
        {
          backgroundColor: alpha(colors.input, 0.10),
          borderColor: colors.border, borderWidth: 1, borderRadius: 6,
          // No horizontal padding — the wheel needs every pixel it can get for
          // the JetBrainsMono digits + unit suffix to fit (e.g. "100 lb",
          // "800 lb" in barbell deadlift). The wheel's own container
          // paddingHorizontal: 8 still gives the text breathing room from
          // this box's border.
          paddingHorizontal: 0, paddingVertical: 6,
          height: FIELD_HEIGHT,
          alignItems: 'center', justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

function parseOneRM(value: string | null | undefined): { oneRM: number; unit: string } | null {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

function parseDurationSecs(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1]) : null
}

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const sec = secs % 60
  if (m === 0) return `${sec}s`
  if (sec === 0) return `${m}m`
  return `${m}m ${sec}s`
}

const BAND_LEVELS = ['Light', 'Medium', 'Heavy', 'Extra Heavy'] as const

// ── Types for "Your movements" list ──────────────────────────────────────────

type BwTier = 'band+knee' | 'knee' | 'band' | 'rx'

const BW_TIER_RANK: Record<BwTier, number> = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }

function bwTierFromVariantName(name: string): BwTier {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwTierBadgeLabel(tier: BwTier): string {
  switch (tier) {
    case 'band+knee': return 'B+K'
    case 'knee':      return 'KNEE'
    case 'band':      return 'BAND'
    case 'rx':        return 'FULL RX'
    default:          return ''
  }
}

function parseRepsFromBwLabel(label: string | null | undefined): number | null {
  let m = label?.match(/×\s*(\d+)/)
  if (m) return parseInt(m[1])
  m = label?.match(/·\s*(\d+)\s*reps?/)
  if (m) return parseInt(m[1])
  return null
}

type MoveBest =
  | { name: string; kind: 'isometric'; bestSecs: number }
  | { name: string; kind: 'assisted';  bestAssistance: number; unit: string }
  | { name: string; kind: 'carry';     bestDist: number }
  | { name: string; kind: 'bodyweight-consolidated'; bestByTier: Record<BwTier, number>; highestTier: BwTier; canHaveTiers: boolean }
  | { name: string; kind: 'strength';  oneRM: number; unit: string }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Strength() {
  const { user, profile } = useAuth()
  const isAdmin = !!(profile as any)?.is_superuser

  // ── Core fields ────────────────────────────────────────────────────────────
  const [exercise,   setExercise]   = useState('')
  const [weight,     setWeight]     = useState('')
  const [reps,       setReps]       = useState('')
  const [timeStr,    setTimeStr]    = useState('')
  const [distance,   setDistance]   = useState('')
  const [bandLevel,  setBandLevel]  = useState<typeof BAND_LEVELS[number] | null>(null)
  const [kneeAssist, setKneeAssist] = useState(false)
  const [unit,       setUnit]       = useState<'lb' | 'kg'>((profile?.weight_unit as 'lb' | 'kg') || 'lb')
  useEffect(() => { if (profile?.weight_unit) setUnit(profile.weight_unit as 'lb' | 'kg') }, [profile?.weight_unit])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saved,        setSaved]        = useState(false)
  const [suggestSent,  setSuggestSent]  = useState(false)
  const [suggesting,   setSuggesting]   = useState(false)
  const suggestingRef  = useRef(false)
  const [saveError,    setSaveError]    = useState('')
  const [movements,    setMovements]    = useState<MoveBest[]>([])
  const [pendingQuery, setPendingQuery] = useState('')
  const [movementKey,  setMovementKey]  = useState(0)

  // ── DB movements (cached) ──────────────────────────────────────────────────
  const dbMovements     = useMovements()
  const strengthRecords = useMemo(() => dbMovements.filter(m => m.category === 'strength'), [dbMovements])
  const strengthNames   = useMemo(() => strengthRecords.map(m => m.name), [strengthRecords])

  // ── Reset on any meaningful field change ───────────────────────────────────
  useEffect(() => { setSaved(false); setSaveError('') },
    [exercise, weight, reps, timeStr, unit, distance, bandLevel, kneeAssist])

  // ── Movement record + flags (computed BEFORE the reset effect uses them so
  //    default values match the new exercise's shape) ───────────────────────
  const movementRecord    = exercise ? (strengthRecords.find(m => m.name === exercise) ?? null) : null
  const isIsometric       = movementRecord?.strength_type === 'isometric'
  const isAssistedMachine = movementRecord?.equipment === 'assisted'
  const isCarry           = movementRecord?.equipment === 'carry'
  const isBodyweightExercise = movementRecord?.equipment === 'bodyweight'
  const isBandEligible    = !!isBodyweightExercise && movementRecord?.band_assist === true
  const isKneeEligible    = !!isBodyweightExercise && movementRecord?.knee_assist === true
  // Pull Up / Dip / Push Up family — supports added load on same record.
  // For weighted_progression=false bodyweight movements (Burpee, Crunch, etc.)
  // the logging form hides the weight field and extends the rep max to 200.
  const weightedProgression = !!isBodyweightExercise && movementRecord?.weighted_progression === true
  const isDumbbell        = movementRecord?.equipment === 'dumbbell'
  // Force unit to the movement's `unit_lock` when set (e.g. strongman events
  // and stone/object carries are universally kg worldwide). Runs after the
  // profile-weight-unit effect so the movement lock wins. The UnitToggle is
  // hidden below for locked movements; user can't change unit on these.
  const unitLock = movementRecord?.unit_lock as ('lb' | 'kg' | null | undefined)
  useEffect(() => {
    if (unitLock === 'kg' || unitLock === 'lb') setUnit(unitLock)
  }, [unitLock])

  // ── Reset modifiers + pre-populate wheel defaults when exercise changes ──
  // Every wheel starts at its minimum valid value (Option A — visual
  // consistency). For ladder movements (atlas stones, D-balls, sandbags,
  // kettlebells) the "minimum" is the lowest ladder rung. For non-ladder
  // movements it's the wheel's `min` prop (bar weight for barbell, 0 for
  // assisted/bodyweight, etc.). User scrolls up from there.
  useEffect(() => {
    setBandLevel(null); setKneeAssist(false)
    if (!movementRecord) {
      setDistance(''); setWeight(''); setReps(''); setTimeStr('')
      return
    }
    // Reps: start at 1 (the wheel min).
    setReps('1')
    // Distance: only for carry; start at 5 m (the wheel min).
    setDistance(isCarry ? '5' : '')
    // Time: only for isometric; start at 00:01 (1 second, the lowest plausible).
    setTimeStr(isIsometric ? '00:01' : '')
    // Weight: start at the wheel's minimum — ladder[0] for ladder movements,
    // else the equipment-class wheel `min`. For bodyweight added load and
    // assisted machines this is 0.
    if (isCarry || !isIsometric) {
      const equip = movementRecord.equipment
      if (equip === 'bodyweight') {
        setWeight('0')
      } else {
        const wheelProps = weightWheelProps(equip, unit, movementRecord.name)
        const wheelMin = wheelProps.ladder?.[0] ?? wheelProps.min ?? 0
        setWeight(String(wheelMin))
      }
    } else {
      setWeight('')
    }
  }, [exercise, unit, isIsometric, isCarry, movementRecord]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Suggestion mode ─────────────────────────────────────────────────────────
  const suggestionMode = !isAdmin && !exercise && pendingQuery.trim() !== '' &&
    !strengthNames.some(m => {
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
      body: `New strength move suggestion: ${n}`,
      is_suggestion: true, read: false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setPendingQuery('')
      setMovementKey(k => k + 1)
      setExercise(''); setWeight(''); setReps(''); setTimeStr(''); setDistance('')
      setTimeout(() => setSuggestSent(false), 2000)
    }
  }

  // ── Weight calculations ────────────────────────────────────────────────────
  const profileBodyWeight = (profile?.current_weight as number | null | undefined) ?? null
  const addedWeight       = isBodyweightExercise ? (Number(weight) || 0) : 0
  const assistanceWeight  = isAssistedMachine    ? (Number(weight) || 0) : 0

  // Round to 1 decimal place to avoid IEEE 754 floating-point artefacts
  // (e.g. 162.9 − 155 = 7.900000000000006 from JS subtraction).
  const effectiveWeight = isAssistedMachine
    ? Math.round(Math.max(0, (profileBodyWeight ?? 0) - assistanceWeight) * 10) / 10
    : isBodyweightExercise
      ? Math.round(((profileBodyWeight ?? 0) + addedWeight) * 10) / 10
      : Number(weight)

  const r = Number(reps)
  // Skip 1RM projection for rep-only bodyweight movements (Burpee, Crunch,
  // etc.) — they have no weighted-progression concept, so an Est. 1RM banner
  // would be meaningless / misleading.
  const liveOneRM = !isIsometric && !isCarry && !bandLevel && !kneeAssist
    && !(isBodyweightExercise && !weightedProgression)
    && r >= 1 && r <= 30 && reps && effectiveWeight > 0
    ? estimate1RM(effectiveWeight, r)
    : null

  const durSecs    = parseTimeStr(timeStr) || 0
  const canSaveIso = isIsometric && durSecs >= 1

  const canSaveRep = (() => {
    if (!exercise.trim())  return false
    if (isIsometric)       return canSaveIso
    if (isAssistedMachine) return !!liveOneRM && r >= 1 && r <= 30
    if (isCarry)           return !!Number(weight) && !!Number(distance) && Number(distance) > 0
    if (bandLevel)         return r >= 1 && !!reps
    if (kneeAssist)        return r >= 1 && !!reps
    // Rep-only bodyweight (Burpee, Crunch, etc.) — no liveOneRM (we don't
    // project 1RM beyond 30 reps anyway) and rep cap extends to 200 to match
    // the Stage 3 milestone scale on the detail page.
    if (isBodyweightExercise && !weightedProgression) return !!reps && r >= 1 && r <= 200
    return liveOneRM || (isBodyweightExercise && !!reps && r >= 1 && r <= 30)
  })()

  const buttonDisabled = suggestionMode
    ? (suggesting || suggestSent)
    : (saved || !canSaveRep)

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveEffort() {
    if (!user || saved) return
    function resetForm() {
      setExercise(''); setWeight(''); setReps(''); setTimeStr('')
      setDistance(''); setBandLevel(null); setKneeAssist(false)
      setPendingQuery(''); setMovementKey(k => k + 1)
    }

    if (isIsometric) {
      if (!canSaveIso) return
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${durSecs} sec`,
        value: `${durSecs} sec`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (isAssistedMachine) {
      if (!profileBodyWeight) {
        setSaveError('No bodyweight on file — please log your weight in the Bodyweight section first.')
        return
      }
      if (!liveOneRM) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${assistanceWeight} ${unit} assist × ${reps}`,
        value: `Est. 1RM ${liveOneRM} ${unit}`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (isCarry) {
      const w = Number(weight); const d = Number(distance)
      if (!w || !d || d <= 0) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${w} ${unit} × ${d} m`,
        value: `${d} m @ ${w} ${unit}`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (bandLevel && kneeAssist) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Band + Knee] · ${bandLevel} × ${reps}`,
        value: `${reps} reps`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (bandLevel) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Band] · ${bandLevel} × ${reps}`,
        value: `${reps} reps`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (kneeAssist) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Knee] · ${reps} reps`,
        value: `${reps} reps`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (isBodyweightExercise && !profileBodyWeight && addedWeight <= 0) {
      setSaveError('No bodyweight on file — please log your weight in the Bodyweight section first.')
      return
    }
    // Rep-only bodyweight (Burpee, Crunch, Sit Up, etc.) — no 1RM projection,
    // just store the rep count. Label format keeps a bodyweight reference
    // (compatible with parseRepsFromBwLabel) but the value field stores plain
    // "X reps" instead of an Est. 1RM. canSaveRep already guards r >= 1.
    if (isBodyweightExercise && !weightedProgression) {
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${profileBodyWeight} ${unit} × ${reps}`,
        value: `${reps} reps`,
      })
      setSaved(true); setTimeout(resetForm, 1500); return
    }
    if (!liveOneRM) return
    setSaveError('')
    const labelWeight = isBodyweightExercise
      ? (addedWeight > 0 ? `${profileBodyWeight}+${addedWeight}` : `${profileBodyWeight}`)
      : Number(weight)
    await supabase.from('efforts').insert({
      user_id: user.id, type: 'strength',
      label: `${exercise} · ${labelWeight} ${unit} × ${reps}`,
      value: `Est. 1RM ${liveOneRM} ${unit}`,
    })
    setSaved(true); setTimeout(resetForm, 1500)
  }

  // ── Load "Your movements" list ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    supabase.from('efforts').select('label, value')
      .eq('user_id', user.id).eq('type', 'strength')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map<string, MoveBest>()
        data.forEach((e: any) => {
          const name = e.label.split(' · ')[0]
          const isBandKnee = name.endsWith(' [Band + Knee]')
          const isBand     = name.endsWith(' [Band]')
          const isKnee     = name.endsWith(' [Knee]')
          const baseName   = isBandKnee || isBand || isKnee
            ? name.replace(/ \[Band \+ Knee\]$/, '').replace(/ \[Band\]$/, '').replace(/ \[Knee\]$/, '')
            : name
          const rec = dbMovements.find(m => m.name === baseName)

          if (rec?.strength_type === 'isometric') {
            const secs = parseDurationSecs(e.value)
            if (secs === null) return
            const ex = map.get(name) as Extract<MoveBest, { kind: 'isometric' }> | undefined
            if (!ex || secs > ex.bestSecs) map.set(name, { name, bestSecs: secs, kind: 'isometric' })
          } else if (rec?.equipment === 'assisted') {
            const assistM = e.label.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
            if (!assistM) return
            const assistance = parseFloat(assistM[1]); const u = assistM[2]
            const ex = map.get(name) as Extract<MoveBest, { kind: 'assisted' }> | undefined
            if (!ex || assistance < (ex.bestAssistance ?? Infinity))
              map.set(name, { name, bestAssistance: assistance, unit: u, kind: 'assisted' })
          } else if (rec?.equipment === 'carry') {
            const distM = e.label.match(/×\s*([\d.]+)\s*m/)
            if (!distM) return
            const dist = parseFloat(distM[1])
            const ex = map.get(name) as Extract<MoveBest, { kind: 'carry' }> | undefined
            if (!ex || dist > (ex.bestDist ?? 0)) map.set(name, { name, bestDist: dist, kind: 'carry' })
          } else if (rec?.equipment === 'bodyweight') {
            // Consolidated bodyweight branch — all four tiers collapse into
            // one row keyed by baseName. See CLAUDE.md "Bodyweight
            // consolidated detail card" spec.
            const tier    = bwTierFromVariantName(name)
            const repsVal = parseRepsFromBwLabel(e.label)
            if (!repsVal) return
            const ex = map.get(baseName) as Extract<MoveBest, { kind: 'bodyweight-consolidated' }> | undefined
            // Only Pull-Up / Dip / Chin-Up family movements actually have
            // band/knee tier variants. For other bodyweight movements (Leg
            // Raise, Plank, etc.) the "FULL RX" tier badge is misleading
            // because there's no assisted-tier progression. Gate the badge
            // rendering on this flag — see the same fix in the detail page.
            const canHaveTiers = !!(rec?.band_assist || rec?.knee_assist)
            if (!ex) {
              map.set(baseName, {
                name: baseName,
                kind: 'bodyweight-consolidated',
                bestByTier:  { 'band+knee': 0, 'knee': 0, 'band': 0, 'rx': 0, [tier]: repsVal },
                highestTier: tier,
                canHaveTiers,
              })
            } else {
              const prevBestForTier = ex.bestByTier[tier] ?? 0
              const newBestByTier   = { ...ex.bestByTier, [tier]: Math.max(prevBestForTier, repsVal) }
              const newHighestTier: BwTier = BW_TIER_RANK[tier] > BW_TIER_RANK[ex.highestTier] ? tier : ex.highestTier
              map.set(baseName, { ...ex, bestByTier: newBestByTier, highestTier: newHighestTier })
            }
          } else {
            const parsed = parseOneRM(e.value)
            if (!parsed) return
            const ex = map.get(name) as Extract<MoveBest, { kind: 'strength' }> | undefined
            if (!ex || parsed.oneRM > ex.oneRM) map.set(name, { name, oneRM: parsed.oneRM, unit: parsed.unit, kind: 'strength' })
          }
        })
        setMovements([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
  }, [user, saved, dbMovements])

  const headerSubtext = isIsometric       ? 'Log a timed hold to track your progress.'
    : isAssistedMachine ? 'Lower assistance = less help = harder. Goal: reach 0.'
    : isCarry           ? 'Log the weight carried and distance covered in metres.'
    : 'Enter any set to project your 1RM.'

  return (
    <View style={s.page}>

      <View>
        <Text style={s.h1}>Strength</Text>
        <Text style={s.subText}>{headerSubtext}</Text>
      </View>

      <AnimateRise delay={0} style={[s.card, s.cardWithDropdown]}>

        {/* Movement search */}
        <View style={s.field}>
          <Text style={s.label}>Exercise</Text>
          <MovementSearch
            key={movementKey}
            value={exercise}
            onChange={setExercise}
            onSuggest={isAdmin ? undefined : handleSuggestMove}
            onQueryChange={isAdmin ? undefined : setPendingQuery}
            movements={strengthNames}
            placeholder="Search or type movement…"
          />
        </View>

        {suggestionMode ? (
          <Text style={s.helpText}>
            This exercise isn't in our list yet. Send it as a suggestion and your coach will add it.
          </Text>

        ) : !exercise ? null : isIsometric ? (
          <>
            <View style={s.field}>
              <Text style={s.label}>Duration</Text>
              <WheelInput>
                {/* Split mm:ss reels via PhantomWheel's time mode — colon
                    fixed dead-centre, minutes / seconds scroll
                    independently with the digits anchored to the colon's
                    edges. The `time` prop turns PhantomWheel into the
                    split-reel composition (previously a separate
                    TimeWheel component; merged in to keep all wheels
                    behind one file). */}
                <PhantomWheel
                  value={parseTimeStr(timeStr) || 0}
                  onChange={(secs) => setTimeStr(formatMmSs(secs))}
                  time="mm:ss"
                  maxMinutes={60}
                />
              </WheelInput>
            </View>
            {durSecs >= 1 && (
              <ChipBlue>
                <Timer size={14} color={palette.blue[400]} />
                <Text style={s.chipLabel}>Hold duration</Text>
                <Text style={[s.chipValue, { color: palette.blue[400], marginLeft: 'auto' }]}>{fmtDuration(durSecs)}</Text>
              </ChipBlue>
            )}
          </>

        ) : isAssistedMachine ? (
          <>
            <View style={s.tripleGrid}>
              <View style={[s.field, s.gridSmall]}>
                <Text style={s.label}>Reps</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(reps) || 8}
                    onChange={(n) => setReps(String(n))}
                    step={1} min={1} max={30}
                  />
                </WheelInput>
              </View>
              <View style={[s.field, s.gridLarge]}>
                <Text style={s.label}>Assistance ↓</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(weight) || 0}
                    onChange={(n) => setWeight(String(n))}
                    step={5} min={0} max={unit === 'kg' ? 90 : 200}
                    unit={unit}
                  />
                </WheelInput>
              </View>
              <View style={[s.field, s.gridUnit]}>
                <Text style={s.label}>Unit</Text>
                {unitLock ? (
                  <View style={s.unitLockedBox}><Text style={s.unitLockedText} numberOfLines={1}>{unitLock}</Text></View>
                ) : (
                  <UnitToggle value={unit} options={['lb', 'kg'] as const} onChange={setUnit} vertical />
                )}
              </View>
            </View>

            {profileBodyWeight !== null && reps && r >= 1 && (
              <ChipAmber>
                <Dumbbell size={14} color={palette.amber[400]} />
                <Text style={s.chipLabel}>{profileBodyWeight} − {assistanceWeight} = </Text>
                <Text style={[s.chipLabel, { fontWeight: '700', color: colors.foreground }]}>{effectiveWeight} {unit}</Text>
                <Text style={s.chipLabel}> effective</Text>
                {liveOneRM != null && (
                  <Text style={[s.chipValue, { color: palette.blue[400], marginLeft: 'auto' }]}>{liveOneRM} {unit}</Text>
                )}
              </ChipAmber>
            )}
            {!profileBodyWeight && (
              <Text style={s.helpText}>
                Log your bodyweight in the Bodyweight section to enable assistance calculations.
              </Text>
            )}
            <Text style={s.tinyText}>Lower assistance = less help = harder · Goal: reach 0 {unit}</Text>
          </>

        ) : isCarry ? (
          <>
            <View style={s.tripleGrid}>
              <View style={[s.field, s.gridLarge]}>
                <Text style={s.label}>Weight</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(weight) || defaultWeight('carry', unit)}
                    onChange={(n) => setWeight(String(n))}
                    {...weightWheelProps('carry', unit, exercise)}
                    unit={unit}
                  />
                </WheelInput>
              </View>
              <View style={[s.field, s.gridUnit]}>
                <Text style={s.label}>Unit</Text>
                {unitLock ? (
                  <View style={s.unitLockedBox}><Text style={s.unitLockedText} numberOfLines={1}>{unitLock}</Text></View>
                ) : (
                  <UnitToggle value={unit} options={['lb', 'kg'] as const} onChange={setUnit} vertical />
                )}
              </View>
              <View style={[s.field, s.gridLarge]}>
                <Text style={s.label}>Distance (m)</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(distance) || 50}
                    onChange={(n) => setDistance(String(n))}
                    step={5} min={5} max={500}
                    unit="m"
                  />
                </WheelInput>
              </View>
            </View>
            {Number(weight) > 0 && Number(distance) > 0 && (
              <ChipBlue>
                <Dumbbell size={14} color={palette.blue[400]} />
                <Text style={s.chipLabel}>
                  {(Number(weight) * Number(distance)).toLocaleString()} {unit}·m of work
                </Text>
              </ChipBlue>
            )}
          </>

        ) : (
          /* Standard rep-based */
          <>
            {bandLevel || kneeAssist ? (
              <View style={s.field}>
                <Text style={s.label}>Reps</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(reps) || 8}
                    onChange={(n) => setReps(String(n))}
                    step={1} min={1} max={100}
                  />
                </WheelInput>
              </View>
            ) : (isBodyweightExercise && !weightedProgression) ? (
              /* Rep-only bodyweight movements (Burpee, Crunch, Leg Raise, etc.)
                 — no added-weight field, rep max extends to 200 to cover the
                 full Stage 3 milestone scale. */
              <View style={s.field}>
                <Text style={s.label}>Reps</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Number(reps) || 8}
                    onChange={(n) => setReps(String(n))}
                    step={1} min={1} max={200}
                  />
                </WheelInput>
              </View>
            ) : (
              <View style={s.tripleGrid}>
                <View style={[s.field, s.gridSmall]}>
                  <Text style={s.label}>Reps</Text>
                  <WheelInput>
                    <PhantomWheel
                      value={Number(reps) || 8}
                      onChange={(n) => setReps(String(n))}
                      step={1} min={1} max={30}
                      />
                  </WheelInput>
                </View>
                <View style={[s.field, s.gridLarge]}>
                  <Text style={s.label}>
                    {isBodyweightExercise
                      ? 'Added load'
                      : (isDumbbell ? 'Per hand' : 'Weight')}
                  </Text>
                  <WheelInput>
                    <PhantomWheel
                      value={Number(weight) || (isBodyweightExercise ? 0 : defaultWeight(movementRecord?.equipment, unit))}
                      onChange={(n) => setWeight(String(n))}
                      {...weightWheelProps(movementRecord?.equipment, unit, exercise)}
                      unit={unit}
                    />
                  </WheelInput>
                </View>
                <View style={[s.field, s.gridUnit]}>
                  <Text style={s.label}>Unit</Text>
                  {unitLock ? (
                  <View style={s.unitLockedBox}><Text style={s.unitLockedText} numberOfLines={1}>{unitLock}</Text></View>
                ) : (
                  <UnitToggle value={unit} options={['lb', 'kg'] as const} onChange={setUnit} vertical />
                )}
                </View>
              </View>
            )}

            {isBandEligible && (
              <View style={s.modGroup}>
                <Text style={s.modLabel}>Band Assistance</Text>
                <View style={s.bandRow}>
                  {([null, ...BAND_LEVELS] as const).map(level => {
                    const active = bandLevel === level
                    return (
                      <Pressable
                        key={level ?? 'none'}
                        onPress={() => setBandLevel(level)}
                        style={[s.bandBtn, active && s.bandBtnActive]}
                      >
                        <Text style={[s.bandBtnText, active && s.bandBtnTextActive]}>
                          {level ?? 'None'}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}

            {isKneeEligible && (
              <Pressable
                onPress={() => setKneeAssist(k => !k)}
                style={[s.kneeBtn, kneeAssist && s.kneeBtnActive]}
              >
                <View style={[s.kneeBox, kneeAssist && s.kneeBoxActive]}>
                  {kneeAssist && <Check size={10} color={colors.primaryForeground} />}
                </View>
                <Text style={[s.kneeText, kneeAssist && { color: colors.primary }]}>Knee assisted</Text>
              </Pressable>
            )}

            {liveOneRM != null && (
              <ChipBlue>
                <Dumbbell size={14} color={palette.blue[400]} />
                {/* At exactly 1 rep, the lift IS the 1RM — no Epley/Lombardi
                    projection is happening, so the "Est." / "Estimated"
                    prefix would be misleading. Drop it. For 2+ reps the
                    value comes from `estimate1RM` and the label keeps the
                    prefix. */}
                <Text style={s.chipLabel}>
                  {r === 1
                    ? (isDumbbell ? '1RM per hand' : '1RM')
                    : (isDumbbell ? 'Est. 1RM per hand' : 'Estimated 1RM')}
                </Text>
                <Text style={[s.chipValue, { color: palette.blue[400], marginLeft: 'auto' }]}>{liveOneRM} {unit}</Text>
              </ChipBlue>
            )}

            {(bandLevel || kneeAssist) && r >= 1 && reps ? (
              <ChipBlue>
                <Check size={14} color={palette.blue[400]} />
                <Text style={s.chipLabel}>
                  {bandLevel && kneeAssist
                    ? `${bandLevel} band + Knee · ${reps} reps`
                    : bandLevel
                      ? `${bandLevel} band · ${reps} reps`
                      : `Knee assisted · ${reps} reps`}
                </Text>
              </ChipBlue>
            ) : null}
          </>
        )}

        {(exercise || suggestionMode) ? (
          <>
            <Pressable
              onPress={() => suggestionMode ? handleSuggestMove(pendingQuery) : saveEffort()}
              disabled={buttonDisabled}
              style={[
                s.saveBtn,
                suggestionMode
                  ? (suggestSent ? s.saveBtnSent : s.saveBtnSendingPrimary)
                  : (saved ? s.saveBtnSaved
                    : canSaveRep ? s.saveBtnPrimary
                    : s.saveBtnDisabled),
              ]}
            >
              <Text style={[
                s.saveBtnText,
                suggestionMode
                  ? (suggestSent ? { color: palette.blue[400] } : { color: '#fff' })
                  : (saved ? { color: palette.blue[400] }
                    : canSaveRep ? { color: '#fff' }
                    : { color: colors.mutedForeground }),
              ]}>
                {suggestionMode
                  ? (suggestSent ? '✓ Suggestion Sent' : suggesting ? 'Sending…' : 'Send Suggestion')
                  : (saved ? '✓ Saved' : 'Save Effort')}
              </Text>
            </Pressable>

            {suggestSent && (
              <View style={s.suggestSentBox}>
                <Check size={14} color={palette.blue[400]} />
                <Text style={[s.tinyText, { color: palette.blue[400] }]}>
                  Suggestion sent to your coach.
                </Text>
              </View>
            )}

            {saveError ? <Text style={s.errorText}>{saveError}</Text> : null}
          </>
        ) : null}

        {/* Removed "* Optional — uses your latest logged bodyweight" footnote;
            the field is unambiguous on its own now. */}
      </AnimateRise>

      {movements.length > 0 && (
        <AnimateRise delay={120} style={[s.card, s.cardNoPad]}>
          <View style={s.listHeader}>
            <Text style={s.listHeaderText}>Your movements</Text>
          </View>
          <View>
            {movements.map((mov, i) => (
              <Pressable
                key={mov.name}
                onPress={() => router.push(`/effort/strength/${encodeURIComponent(mov.name)}` as any)}
                style={({ pressed }) => [
                  s.listRow,
                  i < movements.length - 1 && s.listRowDivider,
                  pressed && { backgroundColor: alpha(colors.accent, 0.5) },
                ]}
              >
                <Text style={s.listRowName}>{mov.name}</Text>
                <View style={s.listRowRight}>
                  {mov.kind === 'isometric' ? (
                    <>
                      <Text style={s.listRowSub}>Best hold</Text>
                      <Text style={s.listRowVal}>{fmtDuration(mov.bestSecs)}</Text>
                    </>
                  ) : mov.kind === 'assisted' ? (
                    <>
                      <Text style={s.listRowSub}>Best assist</Text>
                      <Text style={s.listRowVal}>{mov.bestAssistance} {mov.unit}</Text>
                    </>
                  ) : mov.kind === 'carry' ? (
                    <>
                      <Text style={s.listRowSub}>Best dist.</Text>
                      <Text style={s.listRowVal}>{mov.bestDist} m</Text>
                    </>
                  ) : mov.kind === 'bodyweight-consolidated' ? (
                    <>
                      <Text style={s.listRowSub}>Best</Text>
                      <Text style={s.listRowVal}>{mov.bestByTier[mov.highestTier]} reps</Text>
                      {mov.canHaveTiers && (
                        <View style={{
                          borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.3),
                          backgroundColor: withAlpha(palette.blue[500], 0.15),
                          paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                        }}>
                          <Text style={{
                            fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
                            letterSpacing: 0.5, color: palette.blue[400],
                          }}>
                            {bwTierBadgeLabel(mov.highestTier)}
                          </Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={s.listRowSub}>Est. 1RM</Text>
                      <Text style={s.listRowVal}>{mov.oneRM} {mov.unit}</Text>
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

function ChipBlue({ children }: { children: React.ReactNode }) {
  return (
    <View style={[chipS.row, {
      borderColor: withAlpha(palette.blue[500], 0.25),
      backgroundColor: withAlpha(palette.blue[500], 0.08),
    }]}>{children}</View>
  )
}

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

  // Read-only unit indicator shown in place of UnitToggle when the selected
  // movement has `unit_lock`. Visual style matches the toggle's active state
  // so the layout doesn't shift, but it's non-interactive.
  unitLockedBox: {
    // Match FIELD_HEIGHT (75px) so this chip lines up with WheelInput +
    // the vertical UnitToggle in the same row.
    height: 75,
    paddingHorizontal: 8, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.input, 0.10),
    borderColor: colors.border, borderWidth: 1, borderRadius: 6,
  },
  // fontSize matches the active state of the vertical UnitToggle
  // (`UnitToggle.textActive` ≈ 14/700). The previous size (18/700) was
  // wider than the gridUnit column in the carry triple-grid (which is
  // narrower than the standard layout because both flanking columns are
  // `gridLarge`), so `kg` wrapped to two lines for unit-locked carries
  // like atlas stone. `numberOfLines={1}` on the Text below is an extra
  // safety net if the layout ever shrinks further.
  unitLockedText: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  h1:      { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  subText: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  card: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 20, gap: 16,
  },
  cardNoPad: { padding: 0, gap: 0 },
  // Form card hosts the MovementSearch dropdown — needs to render above the
  // "Your movements" card below. RN's zIndex stacks within siblings, so the
  // form card must outrank its sibling. `elevation: 0` keeps the Android
  // shadow off so we don't get an unwanted shadow halo.
  cardWithDropdown: { zIndex: 10, elevation: 0 },

  field: { gap: 6 },
  label: { color: colors.mutedForeground, fontSize: 14 },
  input: {
    backgroundColor: alpha(colors.input, 0.10),
    borderColor: colors.border, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    color: colors.foreground, fontSize: 14, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },
  helpText: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  tinyText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },
  optional: { color: palette.blue[400], fontSize: 14, lineHeight: 14 },
  errorText:{ color: colors.destructive, fontSize: 12, lineHeight: 16 },

  tripleGrid: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  // gridLarge = primary wheels (Weight / Distance / Reps for the numeric input)
  // gridSmall = secondary wheels (Reps in the carry/assisted layouts)
  // gridUnit  = the Unit column — fixed pixel width so it renders the
  //              same in every layout (the carry triple-grid sandwiches
  //              gridUnit between two gridLarge columns, whereas the
  //              standard/assisted layout has one gridSmall + one
  //              gridLarge alongside it — a flex-based gridUnit ended
  //              up ~30 % narrower in the carry case and was wrapping
  //              "kg" on unit-locked movements like Atlas Stone).
  //
  // 48 px is the size gridUnit hit in the *standard* layout under the
  // old flex 0.55, so the standard/assisted rows look the same as
  // before; only the carry rows widen the Unit column (their two
  // gridLarge columns each shrink by ~5 px to make room — still well
  // above the widest weight string the wheel renders, e.g. "200 kg"
  // in JetBrainsMono Bold ≈ 110 px).
  //
  // Reps tops out at "30" (2 digits) so its column is the trimmed one;
  // the primary wheel needs the room for values like "100 lb" / "800 lb"
  // (barbell deadlift max) in JetBrainsMono Bold which is wider than the
  // earlier estimate. Gap tightened to 8 (from 12) so the columns get
  // another 8px of total room.
  gridSmall:  { flex: 0.85 },
  gridLarge:  { flex: 2.55 },
  gridUnit:   { width: 48 },

  chipLabel: { color: colors.mutedForeground, fontSize: 12 },
  chipValue: { fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], fontSize: 16 },

  modGroup: { gap: 8 },
  modLabel: {
    color: colors.mutedForeground, fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  bandRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bandBtn: {
    borderColor: colors.border, borderWidth: 1, borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  bandBtnActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  bandBtnText:       { color: colors.mutedForeground, fontSize: 12, fontWeight: '500' },
  bandBtnTextActive: { color: colors.primaryForeground, fontWeight: '700' },

  kneeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8,
  },
  kneeBtnActive: {
    backgroundColor: alpha(colors.primary, 0.10),
    borderColor: alpha(colors.primary, 0.30),
  },
  kneeBox: {
    width: 16, height: 16, borderRadius: 3,
    borderColor: colors.mutedForeground, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  kneeBoxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  kneeText:      { color: colors.mutedForeground, fontSize: 14 },

  saveBtn: { paddingVertical: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  saveBtnPrimary:        { backgroundColor: palette.blue[500] },
  saveBtnSendingPrimary: { backgroundColor: palette.blue[500] },
  saveBtnSaved:          { backgroundColor: withAlpha(palette.blue[500], 0.15), borderColor: withAlpha(palette.blue[500], 0.30), borderWidth: 1 },
  saveBtnSent:           { backgroundColor: withAlpha(palette.blue[500], 0.15), borderColor: withAlpha(palette.blue[500], 0.30), borderWidth: 1 },
  saveBtnDisabled:       { backgroundColor: colors.muted, opacity: 0.5 },
  saveBtnText:           { fontSize: 14, fontWeight: '700' },

  suggestSentBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: withAlpha(palette.blue[500], 0.10),
    borderColor: withAlpha(palette.blue[500], 0.30), borderWidth: 1,
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
    fontSize: 14, color: palette.blue[400],
  },
})
