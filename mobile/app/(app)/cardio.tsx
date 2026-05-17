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
import { Activity, Timer, ChevronRight, Check } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { useMovements } from '../../src/hooks/useMovements'
import { SPEED_INPUT_ACTIVITIES, speedMaxTenths } from '../../src/lib/movements'
import MovementSearch from '../../src/components/MovementSearch'
import PhantomWheel from '../../src/components/PhantomWheel'
import AnimateRise from '../../src/components/AnimateRise'
import UnitToggle from '../../src/components/UnitToggle'
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

  // ── DB movements (cached) ──────────────────────────────────────────────────
  const dbMovements   = useMovements()
  const cardioRecords = useMemo(() => dbMovements.filter(m => m.category === 'cardio'), [dbMovements])
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
  // activity is one of the 6 SPEED_INPUT_ACTIVITIES, the form swaps the
  // Time wheel for a Speed wheel and computes Time from distance ÷ speed.
  const isSpeedMode = SPEED_INPUT_ACTIVITIES.has(activity)

  // ── Reset fields when switching modes — every dial starts at ZERO
  // (May 2026 lock — previously they sat at "min savable", e.g. 0.1 km
  // and 00:01, but that read as pre-filled clutter). With a blank-slate
  // 0 default the Save button starts disabled (canSave requires
  // distKm > 0 and timeSecs > 0) and enables as soon as the user dials
  // anything in.
  useEffect(() => {
    if (mode === 'duration') {
      setDistValue('')
      setTimeStr('00:00')
      setSpeedValue('')
    } else if (isSpeedMode) {
      setDistValue('0')
      setSpeedValue('0')
      setTimeStr('')           // derived from speed × distance, not user-entered
    } else {
      setDistValue('0')
      setTimeStr('00:00')
      setSpeedValue('')
    }
  }, [mode, isSpeedMode])

  // ── Clear saved/error on any input change ──────────────────────────────────
  useEffect(() => { setSaved(false); setSaveError('') },
    [activity, distValue, distUnit, timeStr, speedValue])

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
    supabase.from('efforts').select('label, value')
      .eq('user_id', user.id).eq('type', 'cardio')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map<string, ActivityBest>()
        data.forEach((e: any) => {
          const name    = e.label.split(' · ')[0]
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
      })
  }, [user, saved, dbMovements])

  // ── Derived state ─────────────────────────────────────────────────────────
  // distKm + effectiveTimeSecs describe the whole session.
  //   - Pace mode:  user enters distance + time directly.
  //   - Speed mode: user enters distance + speed; time = distance ÷ speed.
  //   - Duration mode (StairMill): no distance, just time.
  const distKm = distUnit === 'mi'
    ? (Number(distValue) || 0) * 1.60934
    : (Number(distValue) || 0)

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
  const livePaceKm: string | null = (() => {
    if (mode !== 'pace' || distKm <= 0 || !effectiveTimeSecs) return null
    const paceSecPerKm = effectiveTimeSecs / distKm
    const m = Math.floor(paceSecPerKm / 60)
    const sc = Math.round(paceSecPerKm % 60)
    return `${m}:${String(sc).padStart(2, '0')}/km`
  })()

  const livePaceDisplay: string | null = (() => {
    if (!livePaceKm) return null
    if (distUnit !== 'mi') return livePaceKm
    const paceSecPerMi = (effectiveTimeSecs / distKm) * 1.60934
    const m = Math.floor(paceSecPerMi / 60)
    const sc = Math.round(paceSecPerMi % 60)
    return `${m}:${String(sc).padStart(2, '0')}/mi`
  })()

  const canSave = !!activity?.trim() && (
    mode === 'pace' ? (distKm > 0 && effectiveTimeSecs > 0) : effectiveTimeSecs > 0
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

    // Speed mode: use the derived effectiveTimeStr — the user entered speed
    // but storage is uniform across all pace-mode activities ("dist in time").
    const label = mode === 'pace'
      ? `${activity} · ${parseFloat(Number(distValue).toFixed(3))} ${distUnit} in ${effectiveTimeStr}`
      : `${activity} · ${effectiveTimeStr}`
    const value = mode === 'pace' ? livePaceKm! : effectiveTimeStr

    const { error } = await supabase.from('efforts').insert({
      user_id: user.id, type: 'cardio', label, value,
    })
    if (error) { setSaveError('Failed to save. Try again.'); return }
    setSaved(true)
    setTimeout(() => {
      setActivity(''); setDistValue(''); setTimeStr(''); setSpeedValue('')
      setPendingQuery(''); setMovementKey(k => k + 1)
    }, 1500)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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

        ) : (
          /* Pace mode — single distance + time entry. Log your best effort
              from any session — could be a continuous run, or one rep from
              an interval workout. The plan reads the resulting PACE to
              classify zone, so the data captured is what matters most.

              Speed mode (5 machines in SPEED_INPUT_ACTIVITIES — running
              treadmill, stationary bike, bike erg, air bike, elliptical)
              swaps the Time wheel for a Speed wheel; the user reads SPEED
              off the machine console rather than computing time mentally
              before logging. Time auto-computes from distance ÷ speed. */
          <>
            <Text style={s.helpText}>
              {isSpeedMode
                ? "Log your distance and the speed you set on the machine. We'll compute the time for you."
                : 'Log your best distance and time from this session — even a single rep of an interval workout counts.'}
            </Text>

            {/* Triple grid — two layouts share the same chrome (75 px field
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
            */}
            <View style={s.tripleGrid}>
              {isSpeedMode ? (
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
                  <View style={[s.field, s.gridPaceDistance]}>
                    <Text style={s.label}>Distance</Text>
                    <WheelInput>
                      <PhantomWheel
                        value={distValue === '' ? 1 : Math.max(0, Math.round(Number(distValue) * 10))}
                        onChange={(tenths) => setDistValue(String(tenths / 10))}
                        decimal="XX.X"
                        min={0} max={500}
                        unit={distUnit}
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

            {/* Live chip(s) below the grid.
                  - Pace mode (user entered time):    one chip showing Pace.
                  - Speed mode (user entered speed):  TWO chips — Time
                    (primary, what the user usually wants to see fall out)
                    and Pace (secondary, what the system stores + classifies
                    zone with). Both render once distance + speed are > 0. */}
            {isSpeedMode ? (
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
})
