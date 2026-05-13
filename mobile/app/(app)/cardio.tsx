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
import MovementSearch from '../../src/components/MovementSearch'
import PhantomWheel from '../../src/components/PhantomWheel'
import TimeWheel from '../../src/components/TimeWheel'
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

function WheelInput({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: alpha(colors.input, 0.30),
      borderColor: colors.border, borderWidth: 1, borderRadius: 6,
      paddingHorizontal: 12, paddingVertical: 6,
      minHeight: 44,
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

  // ── Reset fields when switching modes — pre-populate sensible defaults so
  // the wheels don't render at "empty" and the user can save immediately if
  // the defaults match their effort. Mirror of web Cardio.jsx.
  useEffect(() => {
    if (mode === 'duration') { setDistValue(''); setTimeStr('30:00') }
    else                     { setDistValue('5'); setTimeStr('25:00') }
  }, [mode])

  // ── Clear saved/error on any input change ──────────────────────────────────
  useEffect(() => { setSaved(false); setSaveError('') },
    [activity, distValue, distUnit, timeStr])

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
  const distKm = distUnit === 'mi'
    ? (Number(distValue) || 0) * 1.60934
    : (Number(distValue) || 0)
  const timeSecs = parseTimeStr(timeStr) ?? 0

  const livePaceKm: string | null = (() => {
    if (mode !== 'pace' || distKm <= 0 || !timeSecs) return null
    const paceSecPerKm = timeSecs / distKm
    const m = Math.floor(paceSecPerKm / 60)
    const sc = Math.round(paceSecPerKm % 60)
    return `${m}:${String(sc).padStart(2, '0')}/km`
  })()

  const livePaceDisplay: string | null = (() => {
    if (!livePaceKm) return null
    if (distUnit !== 'mi') return livePaceKm
    const paceSecPerMi = (timeSecs / distKm) * 1.60934
    const m = Math.floor(paceSecPerMi / 60)
    const sc = Math.round(paceSecPerMi % 60)
    return `${m}:${String(sc).padStart(2, '0')}/mi`
  })()

  const canSave = !!activity?.trim() && (mode === 'pace' ? (distKm > 0 && timeSecs > 0) : timeSecs > 0)

  const saveDisabled = suggestionMode
    ? (suggesting || suggestSent)
    : (saved || !canSave)

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveEffort() {
    if (!user || saved || !canSave) return
    setSaveError('')

    const label = mode === 'pace'
      ? `${activity} · ${parseFloat(Number(distValue).toFixed(3))} ${distUnit} in ${timeStr}`
      : `${activity} · ${timeStr}`
    const value = mode === 'pace' ? livePaceKm! : timeStr

    const { error } = await supabase.from('efforts').insert({
      user_id: user.id, type: 'cardio', label, value,
    })
    if (error) { setSaveError('Failed to save. Try again.'); return }
    setSaved(true)
    setTimeout(() => {
      setActivity(''); setDistValue(''); setTimeStr('')
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
                {/* Test bed for the hh:mm:ss split time wheel. Cardio
                    Duration mode tops out at 3 hours so this is the only
                    place in the app where the hours reel matters in
                    practice. The controlled value (total seconds in
                    `timeStr`) is unchanged — TimeWheel reads/writes via
                    onChange just like the previous single PhantomWheel. */}
                <TimeWheel
                  value={parseTimeStr(timeStr) || 0}
                  onChange={(secs) => setTimeStr(formatMmSs(secs))}
                  format="hh:mm:ss"
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
          /* Pace mode */
          <>
            <View style={s.tripleGrid}>
              <View style={[s.field, s.gridLarge]}>
                <Text style={s.label}>Distance</Text>
                <WheelInput>
                  <PhantomWheel
                    value={Math.max(1, Math.round((Number(distValue) || 5) * 10))}
                    onChange={(tenths) => setDistValue(String(tenths / 10))}
                    step={1} min={1} max={500}
                    format={(tenths) => (tenths / 10).toFixed(1)}
                    unit={distUnit}
                  />
                </WheelInput>
              </View>
              <View style={[s.field, s.gridSmall]}>
                <Text style={s.label}>Unit</Text>
                <UnitToggle value={distUnit} options={['km', 'mi'] as const} onChange={setDistUnit} />
              </View>
              <View style={[s.field, s.gridLarge]}>
                <Text style={s.label}>Time</Text>
                <WheelInput>
                  <PhantomWheel
                    value={parseTimeStr(timeStr) || 0}
                    onChange={(secs) => setTimeStr(formatMmSs(secs))}
                    step={1} min={0} max={3 * 3600}
                    format={formatMmSs}
                  />
                </WheelInput>
              </View>
            </View>

            {livePaceDisplay ? (
              <ChipAmber>
                <Activity size={14} color={palette.amber[400]} />
                <Text style={s.chipLabel}>Pace</Text>
                <Text style={[s.chipValue, { color: palette.amber[400], marginLeft: 'auto' }]}>
                  {livePaceDisplay}
                </Text>
              </ChipAmber>
            ) : null}
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

  tripleGrid: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  gridSmall:  { flex: 0.9 },
  gridLarge:  { flex: 1.35 },

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
