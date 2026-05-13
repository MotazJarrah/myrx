/**
 * Mobility — direct port of MyRX/src/pages/Mobility.jsx to React Native.
 *
 * Layout 1:1:
 *   1. Header (title + subtext)
 *   2. ROM Snapshot — fuchsia-tinted card with a 2-col grid of all 8 movements.
 *      Each tile shows last logged degrees, a mini fuchsia→amber bar, and a
 *      "% of clinical normal" / "Athletic ROM" tag. Tap a tile to expand its
 *      MovementCard below.
 *   3. 8 MovementCards — expandable. Header with last-value chip + chevron.
 *      Open: ROMVisualizer (figure + readout + slider) + Save button +
 *      "Recent sessions" list (5 most-recent, swipe-to-delete via DeleteAction,
 *      "latest" mark on the newest).
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import ROMVisualizer, { MOVEMENT_CONFIG } from '../../src/components/ROMVisualizer'
import DeleteAction from '../../src/components/DeleteAction'
import AnimateRise from '../../src/components/AnimateRise'
import Skeleton from '../../src/components/Skeleton'
import { colors, palette, alpha, withAlpha, fonts } from '../../src/theme'

// ── Movement list (ordered for display, 1:1 with web) ──────────────────────

const MOVEMENTS = [
  { key: 'shoulder-flexion',    group: 'Shoulder' },
  { key: 'shoulder-extension',  group: 'Shoulder' },
  { key: 'shoulder-abduction',  group: 'Shoulder' },
  { key: 'hip-flexion',         group: 'Hip' },
  { key: 'hip-abduction',       group: 'Hip' },
  { key: 'knee-flexion',        group: 'Knee' },
  { key: 'ankle-dorsiflexion',  group: 'Ankle' },
  { key: 'spinal-flexion',      group: 'Spine' },
] as const

// ── Helpers ────────────────────────────────────────────────────────────────

interface ROMRecord {
  id:           string
  movement_key: string
  degrees:      number
  created_at:   string
}

type Records = Record<string, ROMRecord[]>

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── ROM Chip (header chip — last logged value) ─────────────────────────────

function ROMChip({ degrees }: { degrees: number }) {
  return (
    <View style={chip.box}>
      <Text style={chip.text}>{degrees}° current</Text>
    </View>
  )
}

const chip = StyleSheet.create({
  box: {
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999, borderWidth: 1,
    borderColor: withAlpha(palette.fuchsia[500], 0.4),
    backgroundColor: withAlpha(palette.fuchsia[500], 0.2),
  },
  text: {
    color: palette.fuchsia[400],
    fontSize: 12, fontWeight: '600',
  },
})

// ── ROM Snapshot ───────────────────────────────────────────────────────────

function ROMSnapshot({
  records, onTileClick,
}: { records: Records; onTileClick: (key: string) => void }) {
  const trackedCount = MOVEMENTS.filter(m => (records[m.key]?.length ?? 0) > 0).length

  return (
    <AnimateRise style={snap.card}>
      <View style={snap.headerRow}>
        <Text style={snap.title}>ROM Snapshot</Text>
        <Text style={snap.count}>
          {trackedCount}/{MOVEMENTS.length} movements logged
        </Text>
      </View>

      <View style={snap.grid}>
        {MOVEMENTS.map(m => {
          const recs = records[m.key]
          const sorted = recs && recs.length > 0
            ? [...recs].sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            : []
          const best        = sorted.length > 0 ? sorted[0].degrees : null
          const clinicalMax = MOVEMENT_CONFIG[m.key].normalRange[1]
          const athleticMax = MOVEMENT_CONFIG[m.key].athleticRange[1]
          const hasData     = best !== null
          const isAthletic  = hasData && best > clinicalMax

          const barWidthPct = hasData ? Math.min(100, Math.round((best / clinicalMax) * 100)) : 0

          // Fuchsia → amber interpolation (matches web exactly)
          const t = isAthletic
            ? Math.min(1, (best - clinicalMax) / (athleticMax - clinicalMax))
            : 0
          const barColor = hasData
            ? `rgb(${Math.round(232 + 13 * t)},${Math.round(121 + 37 * t)},${Math.round(249 - 238 * t)})`
            : 'transparent'
          const degreeColor = isAthletic
            ? `rgb(${Math.round(232 + 13 * t)},${Math.round(121 + 37 * t)},${Math.round(249 - 238 * t)})`
            : '#E879F9'

          const clinicalPct = hasData ? Math.min(100, Math.round((best / clinicalMax) * 100)) : 0
          const lastDate    = sorted.length > 0 ? dateLabel(sorted[0].created_at) : null

          return (
            <Pressable
              key={m.key}
              onPress={() => hasData && onTileClick(m.key)}
              disabled={!hasData}
              style={[
                snap.tile,
                hasData ? snap.tileLive : snap.tileEmpty,
              ]}
            >
              <View style={snap.tileRow}>
                <Text
                  style={[
                    snap.tileLabel,
                    hasData ? { color: colors.foreground } : { color: alpha(colors.mutedForeground, 0.4) },
                  ]}
                  numberOfLines={1}
                >
                  {MOVEMENT_CONFIG[m.key].label}
                </Text>
                {hasData && (
                  <Text style={[snap.tileVal, { color: degreeColor }]}>{best}°</Text>
                )}
              </View>

              {hasData ? (
                <View style={snap.tileBody}>
                  <View style={snap.miniBarTrack}>
                    <View style={[snap.miniBarFill, { width: `${barWidthPct}%`, backgroundColor: barColor }]} />
                  </View>
                  <View style={snap.tileFootRow}>
                    <Text style={snap.tileFootText}>
                      {isAthletic ? 'Athletic ROM' : `${clinicalPct}% of normal`}
                    </Text>
                    {lastDate ? (
                      <Text style={[snap.tileFootText, { color: alpha(colors.mutedForeground, 0.6) }]}>
                        {lastDate}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : (
                <Text style={[snap.tileFootText, { marginTop: 6, color: alpha(colors.mutedForeground, 0.35) }]}>
                  Not logged yet
                </Text>
              )}
            </Pressable>
          )
        })}
      </View>
    </AnimateRise>
  )
}

const snap = StyleSheet.create({
  card: {
    borderRadius: 12, borderWidth: 1, padding: 16, gap: 12,
    borderColor: withAlpha(palette.fuchsia[500], 0.20),
    backgroundColor: withAlpha(palette.fuchsia[500], 0.05),
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: {
    color: palette.fuchsia[400],
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  count: { color: colors.mutedForeground, fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 9, padding: 10,
  },
  tileLive:  { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
  tileEmpty: { backgroundColor: alpha(colors.muted, 0.10), borderWidth: 1, borderColor: 'transparent' },
  tileRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileLabel: {
    flex: 1, marginRight: 6,
    fontSize: 11, fontWeight: '500', lineHeight: 14,
  },
  tileVal: {
    fontSize: 14, fontWeight: '700',
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },
  tileBody: { marginTop: 8, gap: 4 },
  miniBarTrack: {
    height: 4, borderRadius: 9999,
    backgroundColor: '#1f2937', overflow: 'hidden',
  },
  miniBarFill: { height: '100%', borderRadius: 9999 },
  tileFootRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileFootText: { color: colors.mutedForeground, fontSize: 10 },
})

// ── Movement card (expandable) ─────────────────────────────────────────────

function MovementCard({
  movementKey, records, onSave, onDelete, forceOpen,
}: {
  movementKey: string
  records:     ROMRecord[]
  onSave:      (key: string, deg: number) => Promise<boolean>
  onDelete:    (key: string, id: string) => Promise<boolean>
  forceOpen:   boolean
}) {
  const config = MOVEMENT_CONFIG[movementKey]
  const initializedRef = useRef(false)
  const [expanded,  setExpanded]  = useState(false)
  const [degrees,   setDegrees]   = useState(0)
  const [saving,    setSaving]    = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  // Sort records date-desc — explicit, never rely on fetch/insert order
  const sortedRecords = [...records].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Pre-fill slider with most-recent value (once, when records first load)
  useEffect(() => {
    if (!initializedRef.current && sortedRecords.length > 0) {
      initializedRef.current = true
      setDegrees(sortedRecords[0].degrees)
    }
  }, [records])

  // Parent's forceOpen → expand
  useEffect(() => {
    if (forceOpen) setExpanded(true)
  }, [forceOpen])

  const lastROM = sortedRecords.length > 0 ? sortedRecords[0].degrees : null

  const handleSave = useCallback(async () => {
    if (!degrees || saving) return
    setSaving(true)
    const ok = await onSave(movementKey, degrees)
    setSaving(false)
    if (ok) {
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    }
  }, [degrees, movementKey, onSave, saving])

  const recent = sortedRecords.slice(0, 5)
  const saveDisabled = degrees === 0 || saving || justSaved

  return (
    <View style={mc.card}>
      {/* Header (always visible) */}
      <Pressable
        onPress={() => setExpanded(p => !p)}
        style={({ pressed }) => [mc.header, pressed && { backgroundColor: alpha(colors.accent, 0.3) }]}
      >
        <View style={mc.headerLeft}>
          <Text style={mc.headerTitle} numberOfLines={1}>{config.label}</Text>
          <Text style={mc.headerDesc}  numberOfLines={1}>{config.description}</Text>
        </View>
        <View style={mc.headerRight}>
          {lastROM !== null && <ROMChip degrees={lastROM} />}
          {expanded
            ? <ChevronUp   size={16} color={colors.mutedForeground} />
            : <ChevronDown size={16} color={colors.mutedForeground} />}
        </View>
      </Pressable>

      {/* Expanded panel */}
      {expanded && (
        <View style={mc.panel}>
          <ROMVisualizer
            movementKey={movementKey}
            degrees={degrees}
            onChange={setDegrees}
          />

          <Pressable
            onPress={handleSave}
            disabled={saveDisabled}
            style={[
              mc.saveBtn,
              justSaved   ? mc.saveBtnSaved
              : degrees > 0 ? mc.saveBtnReady
                            : mc.saveBtnDisabled,
            ]}
          >
            <Text
              style={[
                mc.saveBtnText,
                degrees > 0 || justSaved
                  ? { color: palette.fuchsia[400] }
                  : { color: colors.mutedForeground },
              ]}
            >
              {justSaved
                ? '✓ Saved'
                : saving
                  ? 'Saving…'
                  : degrees > 0
                    ? `Log ${degrees}°`
                    : 'Move slider to log'}
            </Text>
          </Pressable>

          {/* History */}
          {recent.length > 0 && (
            <View style={mc.histBlock}>
              <Text style={mc.histTitle}>Recent sessions</Text>
              <View style={mc.histList}>
                {recent.map((r, i) => {
                  const isLatest = i === 0
                  return (
                    <DeleteAction
                      key={r.id}
                      onDelete={async () => {
                        const ok = await onDelete(movementKey, r.id)
                        if (!ok) throw new Error('Delete failed')
                      }}
                      style={i < recent.length - 1 ? mc.histRowDivider : undefined}
                      bg={colors.card}
                    >
                      <View style={mc.histRow}>
                        <Text style={mc.histDate}>{dateLabel(r.created_at)}</Text>
                        <View style={mc.histRight}>
                          <Text
                            style={[
                              mc.histVal,
                              isLatest ? { color: palette.fuchsia[400] } : { color: colors.foreground },
                            ]}
                          >
                            {r.degrees}°
                          </Text>
                          {isLatest ? <Text style={mc.histLatest}> latest</Text> : null}
                        </View>
                      </View>
                    </DeleteAction>
                  )
                })}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const mc = StyleSheet.create({
  card: {
    borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.card,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  headerLeft:  { flex: 1, marginRight: 12 },
  headerTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  headerDesc:  { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  panel: {
    borderTopColor: colors.border, borderTopWidth: 1,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
    gap: 20,
  },

  saveBtn: { paddingVertical: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  saveBtnReady: {
    backgroundColor: withAlpha(palette.fuchsia[500], 0.15),
    borderWidth: 1, borderColor: withAlpha(palette.fuchsia[500], 0.30),
  },
  saveBtnSaved: {
    backgroundColor: withAlpha(palette.fuchsia[500], 0.15),
    borderWidth: 1, borderColor: withAlpha(palette.fuchsia[500], 0.30),
  },
  saveBtnDisabled: { backgroundColor: colors.muted, opacity: 0.5 },
  saveBtnText: { fontSize: 14, fontWeight: '700' },

  histBlock: { gap: 6 },
  histTitle: { color: colors.mutedForeground, fontSize: 12, fontWeight: '500' },
  histList: {
    borderRadius: 9, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  histRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.card,
  },
  histRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  histDate: { color: colors.mutedForeground, fontSize: 12 },
  histRight: { flexDirection: 'row', alignItems: 'baseline' },
  histVal: {
    fontSize: 14, fontWeight: '600',
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },
  histLatest: {
    fontSize: 10, color: withAlpha(palette.fuchsia[400], 0.7),
    marginLeft: 4,
  },
})

// ── Page ──────────────────────────────────────────────────────────────────

export default function Mobility() {
  const { user } = useAuth()
  const [records, setRecords] = useState<Records>({})
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('rom_records')
      .select('id, movement_key, degrees, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return
        if (!data || error) { setLoading(false); return }
        const grouped: Records = {}
        ;(data as ROMRecord[]).forEach(row => {
          if (!grouped[row.movement_key]) grouped[row.movement_key] = []
          grouped[row.movement_key].push(row)
        })
        setRecords(grouped)
        setLoading(false)
      })
    return () => { alive = false }
  }, [user])

  const handleSave = useCallback(async (movementKey: string, degrees: number) => {
    if (!user) return false
    const { data, error } = await supabase
      .from('rom_records')
      .insert({ user_id: user.id, movement_key: movementKey, degrees })
      .select()
      .single()
    if (error || !data) return false
    setRecords(prev => ({
      ...prev,
      [movementKey]: [data as ROMRecord, ...(prev[movementKey] ?? [])],
    }))
    return true
  }, [user])

  const handleDelete = useCallback(async (movementKey: string, id: string) => {
    if (!user) return false
    const { error } = await supabase
      .from('rom_records')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return false
    setRecords(prev => ({
      ...prev,
      [movementKey]: (prev[movementKey] ?? []).filter(r => r.id !== id),
    }))
    return true
  }, [user])

  return (
    <View style={s.page}>
      <View>
        <Text style={s.h1}>Mobility</Text>
        <Text style={s.subText}>
          Track your range of motion — log degrees and monitor your best ROM.
        </Text>
      </View>

      {!loading && (
        <ROMSnapshot
          records={records}
          onTileClick={key => {
            setOpenKey(key)
            // Briefly toggle so re-tapping the same tile after closing works
            setTimeout(() => setOpenKey(null), 100)
          }}
        />
      )}

      {loading ? (
        <View style={{ gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} style={{ height: 80, width: '100%', borderRadius: 16 }} />
          ))}
        </View>
      ) : (
        <AnimateRise delay={120} style={{ gap: 12 }}>
          {MOVEMENTS.map(m => (
            <MovementCard
              key={m.key}
              movementKey={m.key}
              records={records[m.key] ?? []}
              onSave={handleSave}
              onDelete={handleDelete}
              forceOpen={openKey === m.key}
            />
          ))}
        </AnimateRise>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  page: { gap: 24 },
  h1: { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  subText: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },
  helpText: { color: colors.mutedForeground, fontSize: 12 },
})
