/**
 * History — port of MyRX/src/pages/History.jsx to React Native.
 *
 * Lists every effort, ROM session, weigh-in, and calorie log for the user, sorted
 * newest first, with category filter chips. Row rendering mirrors Dashboard's
 * ActivityRow (same icon, label, tag-chip, date pattern). Delete uses
 * DeleteAction's two-tap confirm — no separate Alert prompt (matches web).
 *
 * Web parity:
 *   • Filter chips appear only when ≥ 2 categories have data
 *   • Skeleton rows during initial load (8 placeholders)
 *   • Empty state shown when filtered list has zero items
 *   • Calorie row uses log_date for the displayed date (not created_at)
 *
 * Cross-platform consistency: every change here should also be applied to
 * MyRX/src/pages/History.jsx (same row layout, same filter behavior).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native'
import { Dumbbell, Activity, Weight, Flower2, Flame } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { getEffortTags, TAG_STYLES } from '../../src/lib/effortTags'
import DeleteAction from '../../src/components/DeleteAction'
import AnimateRise from '../../src/components/AnimateRise'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha } from '../../src/theme'

// ── ROM metadata ──────────────────────────────────────────────────────────────
// Mirrors Dashboard.tsx — keep both in sync if movements change.
const ROM_META: Record<string, { label: string; group: string }> = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   group: 'Shoulder' },
  'shoulder-extension': { label: 'Shoulder Extension', group: 'Shoulder' },
  'shoulder-abduction': { label: 'Shoulder Abduction', group: 'Shoulder' },
  'hip-flexion':        { label: 'Hip Flexion',        group: 'Hip'      },
  'hip-abduction':      { label: 'Hip Abduction',      group: 'Hip'      },
  'knee-flexion':       { label: 'Knee Flexion',       group: 'Knee'     },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', group: 'Ankle'    },
  'spinal-flexion':     { label: 'Spinal Flexion',     group: 'Spine'    },
}

type FilterKey = 'all' | 'strength' | 'cardio' | 'mobility' | 'weighin' | 'calories'

const FILTER_LABELS: Record<FilterKey, string> = {
  all:      'All',
  strength: 'Strength',
  cardio:   'Cardio',
  mobility: 'Mobility',
  weighin:  'Weigh-in',
  calories: 'Calories',
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyItem = {
  id: string
  _kind: 'effort' | 'rom' | 'weighin' | 'calorie'
  created_at: string
  type?: string
  label?: string
  value?: string
  weight?: number
  unit?: string
  movement_key?: string
  degrees?: number
  calories?: number
  log_date?: string
}

// ── Tag chip ──────────────────────────────────────────────────────────────────

function TagChip({ label, style }: { label: string; style: any }) {
  return (
    <View style={[tc.chip, {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
    }]}>
      <Text style={[tc.text, { color: style.color }]}>{label}</Text>
    </View>
  )
}

const tc = StyleSheet.create({
  chip: { borderRadius: 9999, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontWeight: '600' },
})

// ── Date formatter ────────────────────────────────────────────────────────────
// History uses absolute dates ("Mar 15, 2025") rather than Dashboard's relative
// labels ("Today", "Yesterday", "3d ago") — matches the web's
// `new Date(...).toLocaleDateString()` call.
function formatAbsoluteDate(ts: string): string {
  return new Date(ts).toLocaleDateString()
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ item, onDelete }: { item: AnyItem; onDelete: () => void }) {
  // ── Calorie ──
  if (item._kind === 'calorie') {
    const dateStr = item.log_date
      ? new Date(item.log_date + 'T12:00:00').toLocaleDateString()
      : formatAbsoluteDate(item.created_at)
    return (
      <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
        <View style={d.rowInner}>
          <View style={[d.iconBox, { backgroundColor: withAlpha(palette.red[500], 0.10) }]}>
            <Flame size={14} color={palette.red[400]} />
          </View>
          <View style={d.rowText}>
            <Text style={d.rowLabel} numberOfLines={1}>Intake · {item.calories} kcal</Text>
            <View style={d.rowTags}>
              <TagChip label="Calories" style={TAG_STYLES.calories} />
              <TagChip label="Intake"   style={TAG_STYLES.Intake} />
              <Text style={d.rowDate}>{dateStr}</Text>
            </View>
          </View>
        </View>
      </DeleteAction>
    )
  }

  // ── ROM ──
  if (item._kind === 'rom') {
    const meta = ROM_META[item.movement_key ?? '']
    return (
      <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
        <View style={d.rowInner}>
          <View style={[d.iconBox, { backgroundColor: withAlpha(palette.fuchsia[500], 0.10) }]}>
            <Flower2 size={14} color={palette.fuchsia[400]} />
          </View>
          <View style={d.rowText}>
            <Text style={d.rowLabel} numberOfLines={1}>
              {meta?.label ?? item.movement_key} · {item.degrees}° ROM
            </Text>
            <View style={d.rowTags}>
              <TagChip label="Mobility" style={TAG_STYLES.mobility} />
              {meta?.group ? <TagChip label={meta.group} style={TAG_STYLES[meta.group] ?? TAG_STYLES.Movement} /> : null}
              <Text style={d.rowDate}>{formatAbsoluteDate(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </DeleteAction>
    )
  }

  // ── Weigh-in ──
  if (item._kind === 'weighin') {
    return (
      <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
        <View style={d.rowInner}>
          <View style={[d.iconBox, { backgroundColor: withAlpha(palette.emerald[500], 0.10) }]}>
            <Weight size={14} color={palette.emerald[400]} />
          </View>
          <View style={d.rowText}>
            <Text style={d.rowLabel} numberOfLines={1}>Weigh-in · {item.weight} {item.unit}</Text>
            <View style={d.rowTags}>
              <TagChip label="Bodyweight" style={TAG_STYLES.weighin} />
              <TagChip label="Weigh-in"   style={TAG_STYLES['Weigh-in']} />
              <Text style={d.rowDate}>{formatAbsoluteDate(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </DeleteAction>
    )
  }

  // ── Effort (strength / cardio / mobility) ──
  const { primary, secondary } = getEffortTags(item as any)
  const iconBg =
    item.type === 'strength' ? withAlpha(palette.blue[500], 0.10)
  : item.type === 'cardio'   ? withAlpha(palette.amber[500], 0.10)
  : alpha(colors.primary, 0.10)
  const iconColor =
    item.type === 'strength' ? palette.blue[400]
  : item.type === 'cardio'   ? palette.amber[400]
  : colors.primary
  const Icon =
    item.type === 'strength' ? Dumbbell
  : item.type === 'cardio'   ? Activity
  : Weight

  return (
    <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
      <View style={d.rowInner}>
        <View style={[d.iconBox, { backgroundColor: iconBg }]}>
          <Icon size={14} color={iconColor} />
        </View>
        <View style={d.rowText}>
          <Text style={d.rowLabel} numberOfLines={1}>{item.label}</Text>
          <View style={d.rowTags}>
            <TagChip label={primary.label} style={primary.style} />
            {secondary ? <TagChip label={secondary.label} style={secondary.style} /> : null}
            <Text style={d.rowDate}>{formatAbsoluteDate(item.created_at)}</Text>
          </View>
        </View>
      </View>
    </DeleteAction>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function History() {
  const { user } = useAuth()
  const [efforts,    setEfforts]    = useState<any[]>([])
  const [romRecords, setRomRecords] = useState<any[]>([])
  const [bwLogs,     setBwLogs]     = useState<any[]>([])
  const [calorieLogs, setCalorieLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<FilterKey>('all')

  // ── Fetch all 4 sources in parallel ────────────────────────────────────────
  // Web does staggered fetches with a counter; Promise.all is cleaner and
  // gives us a single loading state-flip at the end.
  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('efforts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('rom_records')
        .select('id, movement_key, degrees, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('bodyweight')
        .select('id, weight, unit, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('calorie_logs')
        .select('id, log_date, calories, updated_at')
        .eq('user_id', user.id)
        .order('log_date', { ascending: false }),
    ]).then(([efRes, romRes, bwRes, calRes]) => {
      setEfforts(efRes.data ?? [])
      setRomRecords(romRes.data ?? [])
      setBwLogs(bwRes.data ?? [])
      // Synthesise created_at from log_date so merge sort works uniformly
      // (matches web's identical transform).
      setCalorieLogs((calRes.data ?? []).map((r: any) => ({
        ...r,
        created_at: r.log_date + 'T12:00:00',
      })))
      setLoading(false)
    })
  }, [user])

  // ── Available filters — only show categories with data ────────────────────
  const availableFilters = useMemo<FilterKey[]>(() => {
    const filters: FilterKey[] = ['all']
    if (efforts.some(e => e.type === 'strength')) filters.push('strength')
    if (efforts.some(e => e.type === 'cardio'))   filters.push('cardio')
    if (efforts.some(e => e.type === 'mobility') || romRecords.length > 0) filters.push('mobility')
    if (bwLogs.length > 0)      filters.push('weighin')
    if (calorieLogs.length > 0) filters.push('calories')
    return filters
  }, [efforts, romRecords, bwLogs, calorieLogs])

  // Reset to 'all' if current filter no longer has items
  useEffect(() => {
    if (filter !== 'all' && !availableFilters.includes(filter)) setFilter('all')
  }, [availableFilters, filter])

  // DeleteAction's tap-confirm (tap trash → red check → tap again) IS the
  // confirm step — no native Alert prompt needed. Matches web behaviour.
  async function handleDelete(item: AnyItem) {
    const table =
      item._kind === 'rom'     ? 'rom_records'
    : item._kind === 'weighin' ? 'bodyweight'
    : item._kind === 'calorie' ? 'calorie_logs'
    : 'efforts'

    if (item._kind === 'rom')      setRomRecords(prev => prev.filter(r => r.id !== item.id))
    else if (item._kind === 'weighin') setBwLogs(prev => prev.filter(b => b.id !== item.id))
    else if (item._kind === 'calorie') setCalorieLogs(prev => prev.filter(c => c.id !== item.id))
    else setEfforts(prev => prev.filter(e => e.id !== item.id))

    await supabase.from(table).delete().eq('id', item.id).eq('user_id', user!.id)
  }

  // ── Merge + sort (newest first) + filter ──────────────────────────────────
  const allItems: AnyItem[] = useMemo(() => [
    ...efforts.map(e => ({ ...e, _kind: 'effort' as const })),
    ...romRecords.map(r => ({ ...r, _kind: 'rom' as const })),
    ...bwLogs.map(b => ({ ...b, _kind: 'weighin' as const })),
    ...calorieLogs.map(c => ({ ...c, _kind: 'calorie' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  [efforts, romRecords, bwLogs, calorieLogs])

  const filtered = useMemo(() => {
    if (filter === 'all')      return allItems
    if (filter === 'mobility') return allItems.filter(i => i._kind === 'rom' || (i._kind === 'effort' && i.type === 'mobility'))
    if (filter === 'weighin')  return allItems.filter(i => i._kind === 'weighin')
    if (filter === 'calories') return allItems.filter(i => i._kind === 'calorie')
    return allItems.filter(i => i._kind === 'effort' && i.type === filter)
  }, [allItems, filter])

  return (
    <ScrollView contentContainerStyle={d.scroll} showsVerticalScrollIndicator={false}>
      <View style={d.container}>

        {/* Header */}
        <View>
          <Text style={d.h1}>History</Text>
          <Text style={d.sub}>Every effort, ROM session, and weigh-in you've logged.</Text>
        </View>

        {/* Filter chips — only show when ≥ 2 categories have data */}
        {!loading && availableFilters.length > 1 ? (
          <View style={d.filterRow}>
            {availableFilters.map(f => {
              const active = filter === f
              return (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[d.filterChip, active ? d.filterChipActive : d.filterChipIdle]}
                >
                  <Text style={[d.filterChipText, active ? d.filterChipTextActive : d.filterChipTextIdle]}>
                    {FILTER_LABELS[f]}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ) : null}

        {/* Body — loading / empty / list */}
        {loading ? (
          <View style={d.skelList}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} style={d.skelRow} />
            ))}
          </View>
        ) : filtered.length === 0 ? (
          <AnimateRise style={d.emptyCard}>
            <Text style={d.emptyText}>No entries logged yet.</Text>
          </AnimateRise>
        ) : (
          <AnimateRise style={d.list}>
            {filtered.map(item => (
              <HistoryRow
                key={`${item._kind}-${item.id}`}
                item={item}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </AnimateRise>
        )}

      </View>
    </ScrollView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  scroll:    { padding: 16, paddingBottom: 32 },
  container: { gap: 20 },

  // Header — `text-xl font-semibold tracking-tight`
  h1:  { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  sub: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  // Filter chips — `flex gap-2 flex-wrap`, each `px-3 py-1.5 rounded-md text-sm border`
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1,
  },
  filterChipIdle: {
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  filterChipActive: {
    borderColor: 'transparent',
    backgroundColor: colors.primary,
  },
  filterChipText: { fontSize: 14 },
  filterChipTextIdle:   { color: colors.mutedForeground },
  filterChipTextActive: { color: colors.primaryForeground, fontWeight: '600' },

  // Skeleton placeholder rows — 8 × 56 high
  skelList: { gap: 8 },
  skelRow:  { height: 56, width: '100%', borderRadius: 12 },

  // Empty state card — `rounded-xl border border-border bg-card p-8 text-center`
  emptyCard: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: { color: colors.mutedForeground, fontSize: 14 },

  // List — `space-y-2`
  list: { gap: 8 },

  // Row — `rounded-xl border border-border` outer; `flex items-center gap-3 px-4 py-3` inner
  rowOuter: {
    borderColor: colors.border, borderWidth: 1, borderRadius: 12,
  },
  rowInner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText:  { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  rowTags:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  rowDate:  { color: colors.mutedForeground, fontSize: 11 },
})
