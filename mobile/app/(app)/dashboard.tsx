/**
 * Dashboard — port of MyRX/src/pages/Dashboard.jsx to React Native.
 *
 * Layout matches the web 1:1:
 *   1. Profile card (animate-rise delay 0ms)
 *      ├─ Edit pencil top-right
 *      ├─ Greeting line ("Good morning,", text-xl)
 *      ├─ Avatar 80x80 + name + email + detail chips + body chips
 *      └─ Stats footer (streak / PRs / member-since), border-top
 *   2. Recent activity card (animate-rise delay 240ms)
 *      ├─ Header: "Recent activity" + "View all →"
 *      └─ 5 merged rows (efforts + ROM + bodyweight + calories), DeleteAction on each
 *
 * Helpers (formatGreeting, computeWeekStreak, computeMonthlyPRs, formatHeight, etc.)
 * are direct ports of the web functions — same inputs, same outputs.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native'
import { Image } from 'expo-image'
import { Link, router } from 'expo-router'
import {
  Dumbbell, Activity, Weight, Flower2, Flame,
  ArrowRight, User, Pencil,
} from 'lucide-react-native'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { dataCache } from '../../src/lib/cache'
import { getEffortTags, TAG_STYLES } from '../../src/lib/effortTags'
import DeleteAction from '../../src/components/DeleteAction'
import TickerNumber from '../../src/components/TickerNumber'
import AnimateRise from '../../src/components/AnimateRise'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Helpers (1:1 with Dashboard.jsx) ─────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

function calcAge(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null
  const today = new Date()
  const birth = new Date(birthdate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function formatGender(g: string | null | undefined): string | null {
  if (!g) return null
  const map: Record<string, string> = {
    male: 'Male', female: 'Female',
    'non-binary': 'Non-binary', 'prefer-not-to-say': 'Prefer not to say',
  }
  return map[g] ?? g
}

function formatDate(ts: string): string {
  const now  = new Date()
  const then = new Date(ts)
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000
  )
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMemberSince(ts: string | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatHeight(height: number | null | undefined, unit: string | null | undefined): string | null {
  if (!height) return null
  if (unit === 'imperial') {
    const total = Math.round(height)
    const ft = Math.floor(total / 12)
    const inches = total % 12
    return `${ft}'${inches}"`
  }
  return `${height} cm`
}

// ── Streak helpers ────────────────────────────────────────────────────────────

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay() === 0 ? 7 : d.getDay()  // Mon=1 … Sun=7
  d.setDate(d.getDate() - (day - 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function computeWeekStreak(dates: string[]): number {
  if (!dates || dates.length === 0) return 0
  const weekSet = new Set(dates.map(d => getWeekKey(d)))
  const now = new Date()
  const thisWeek = getWeekKey(now.toISOString())
  const check = new Date(now)
  if (!weekSet.has(thisWeek)) check.setDate(check.getDate() - 7)
  let streak = 0
  while (true) {
    const key = getWeekKey(check.toISOString())
    if (weekSet.has(key)) { streak++; check.setDate(check.getDate() - 7) }
    else break
  }
  return streak
}

function parseEffort1RM(value: string | null | undefined): number | null {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

function computeMonthlyPRs(allStrengthEfforts: any[], allRomRecords: any[]): number {
  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth()
  const isThisMonth = (ds: string) => {
    const d = new Date(ds)
    return d.getFullYear() === y && d.getMonth() === mo
  }
  let count = 0

  const byEx: Record<string, { rm: number; date: string }[]> = {}
  allStrengthEfforts.forEach(e => {
    const rm = parseEffort1RM(e.value)
    if (!rm) return
    const ex = e.label?.split(' · ')[0]
    if (!ex) return
    if (!byEx[ex]) byEx[ex] = []
    byEx[ex].push({ rm, date: e.created_at })
  })
  Object.values(byEx).forEach(arr => {
    const best = arr.reduce((b, e) => e.rm > b.rm ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })

  const byMov: Record<string, { deg: number; date: string }[]> = {}
  allRomRecords.forEach(r => {
    if (!byMov[r.movement_key]) byMov[r.movement_key] = []
    byMov[r.movement_key].push({ deg: r.degrees, date: r.created_at })
  })
  Object.values(byMov).forEach(arr => {
    const best = arr.reduce((b, e) => e.deg > b.deg ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })

  return count
}

// ── ROM metadata ──────────────────────────────────────────────────────────────

const ROM_META: Record<string, { label: string; group: string }> = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   group: 'Shoulder' },
  'shoulder-extension': { label: 'Shoulder Extension', group: 'Shoulder' },
  'shoulder-abduction': { label: 'Shoulder Abduction', group: 'Shoulder' },
  'hip-flexion':        { label: 'Hip Flexion',         group: 'Hip'      },
  'hip-abduction':      { label: 'Hip Abduction',       group: 'Hip'      },
  'knee-flexion':       { label: 'Knee Flexion',        group: 'Knee'     },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', group: 'Ankle'    },
  'spinal-flexion':     { label: 'Spinal Flexion',      group: 'Spine'    },
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

// ── Activity row ──────────────────────────────────────────────────────────────

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

function ActivityRow({ item, onDelete }: { item: AnyItem; onDelete: () => void }) {
  // ── Calorie ──
  if (item._kind === 'calorie') {
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
              <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
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
              <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
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
              <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
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
            <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
          </View>
        </View>
      </View>
    </DeleteAction>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, profile } = useAuth()

  const cacheKey = user ? `dashboard:${user.id}` : null
  const cached   = cacheKey ? dataCache.get<any>(cacheKey) : null

  const [recentEfforts, setRecentEfforts]   = useState<any[]>(cached?.efforts   ?? [])
  const [recentROM, setRecentROM]           = useState<any[]>(cached?.rom       ?? [])
  const [recentBW, setRecentBW]             = useState<any[]>(cached?.bw        ?? [])
  const [recentCalories, setRecentCalories] = useState<any[]>(cached?.calories  ?? [])
  const [trainingStreak, setTrainingStreak] = useState<number | null>(cached?.streak ?? null)
  const [monthlyPRs, setMonthlyPRs]         = useState<number | null>(cached?.prs    ?? null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('efforts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('rom_records').select('id, movement_key, degrees, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('bodyweight').select('id, weight, unit, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('calorie_logs').select('id, log_date, calories').eq('user_id', user.id).order('log_date', { ascending: false }).limit(5),
      supabase.from('efforts').select('created_at, label, value, type').eq('user_id', user.id),
      supabase.from('rom_records').select('movement_key, degrees, created_at').eq('user_id', user.id),
    ]).then(([efRes, romRes, bwRes, calRes, allEffRes, allRomRes]) => {
      const efforts  = efRes.data  ?? []
      const rom      = romRes.data ?? []
      const bw       = bwRes.data  ?? []
      const calories = (calRes.data ?? []).map((r: any) => ({ ...r, created_at: r.log_date + 'T12:00:00' }))
      const allEff   = allEffRes.data ?? []
      const allRom   = allRomRes.data ?? []

      const streak = computeWeekStreak(allEff.map((e: any) => e.created_at))
      const prs    = computeMonthlyPRs(allEff.filter((e: any) => e.type === 'strength'), allRom)

      setRecentEfforts(efforts)
      setRecentROM(rom)
      setRecentBW(bw)
      setRecentCalories(calories)
      setTrainingStreak(streak)
      setMonthlyPRs(prs)

      if (cacheKey) dataCache.set(cacheKey, { efforts, rom, bw, calories, streak, prs })
    })
  }, [user])

  // DeleteAction's tap-confirm (tap trash → red check → tap again) IS the
  // confirm step — no native Alert prompt needed. Web behaves the same way.
  async function handleDelete(item: AnyItem) {
    const table =
      item._kind === 'rom'     ? 'rom_records'
    : item._kind === 'weighin' ? 'bodyweight'
    : item._kind === 'calorie' ? 'calorie_logs'
    : 'efforts'

    if (item._kind === 'rom')      setRecentROM(prev => prev.filter(r => r.id !== item.id))
    else if (item._kind === 'weighin') setRecentBW(prev => prev.filter(b => b.id !== item.id))
    else if (item._kind === 'calorie') setRecentCalories(prev => prev.filter(c => c.id !== item.id))
    else setRecentEfforts(prev => prev.filter(e => e.id !== item.id))

    await supabase.from(table).delete().eq('id', item.id).eq('user_id', user!.id)
  }

  // Merge + sort + cap to 5 (matches web)
  const allActivity: AnyItem[] = [
    ...recentEfforts.map(e => ({ ...e, _kind: 'effort' as const })),
    ...recentROM.map(r => ({ ...r, _kind: 'rom' as const })),
    ...recentBW.map(b => ({ ...b, _kind: 'weighin' as const })),
    ...recentCalories.map(c => ({ ...c, _kind: 'calorie' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5)

  // ── Profile-derived display values ─────────────────────────────────────────
  const age           = calcAge(profile?.birthdate)
  const gender        = formatGender(profile?.gender)
  const memberSince   = formatMemberSince(user?.created_at)
  const avatarUrl     = profile?.avatar_url || null
  const displayWeight = profile?.current_weight
    ? `${profile.current_weight} ${profile.weight_unit || 'lb'}`
    : null
  const displayHeight = formatHeight(profile?.current_height, profile?.height_unit || 'imperial')

  // Format phone with country-aware spacing (e.g. "+1 555 123 4567") so
  // it matches the input shown on EditProfile / Settings.
  const phoneDisplay = profile?.phone
    ? (parsePhoneNumberFromString(profile.phone)?.formatInternational() ?? profile.phone)
    : null
  const detailChips = [gender, age != null ? `${age} yrs` : null, phoneDisplay].filter(Boolean) as string[]
  const bodyChips   = [displayWeight, displayHeight].filter(Boolean) as string[]

  return (
    <View style={d.container}>

      {/* ── Profile card ─────────────────────────────────────────────── */}
      {/* The card is wrapped in a positioning View so the edit pencil can
          float OUTSIDE the AnimateRise wrapper. AnimateRise (Reanimated's
          Animated.View) was dropping the Pressable's touches on the
          Android emulator — moving the pencil outside the animated parent
          fixes the dead tap. */}
      <View style={d.profileCardWrap}>
        <AnimateRise delay={0} style={d.card}>

        {/* Greeting line — text-xl, mb-4, leaves room for the pencil */}
        <Text style={d.greeting} numberOfLines={1}>
          {getGreeting()},
        </Text>

        <View style={d.profileRow}>
          {/* Avatar — h-20 w-20 */}
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={d.avatar} contentFit="cover" />
          ) : (
            <View style={d.avatarPlaceholder}>
              <User size={36} color={colors.primary} />
            </View>
          )}

          {/* Name + email + chips */}
          <View style={d.profileText}>
            <Text style={d.name} numberOfLines={1}>
              {profile?.full_name || user?.email?.split('@')[0] || 'Athlete'}
            </Text>
            <Text style={d.email} numberOfLines={1}>{user?.email}</Text>

            {detailChips.length > 0 && (
              <View style={d.chipsRow}>
                {detailChips.map(chip => (
                  <View key={chip} style={d.detailChip}>
                    <Text style={d.detailChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            )}

            {bodyChips.length > 0 && (
              <View style={d.chipsRow}>
                {bodyChips.map(chip => (
                  <View key={chip} style={d.bodyChip}>
                    <Text style={d.bodyChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Stats footer — border-top */}
        <View style={d.statsRow}>
          {trainingStreak != null && (
            <View style={[d.statChip, d.statChipBlue]}>
              <Text style={d.statChipEmoji}>🗓️</Text>
              <View style={d.statChipNum}>
                <TickerNumber value={trainingStreak} fontSize={11} color={palette.blue[400]} fontWeight="700" />
              </View>
              <Text style={[d.statChipText, { color: palette.blue[400] }]}> wk streak</Text>
            </View>
          )}
          {monthlyPRs != null && (
            <View style={[d.statChip, d.statChipAmber]}>
              <Text style={d.statChipEmoji}>🏆</Text>
              <View style={d.statChipNum}>
                <TickerNumber value={monthlyPRs} fontSize={11} color={palette.amber[400]} fontWeight="700" />
              </View>
              <Text style={[d.statChipText, { color: palette.amber[400] }]}>
                {' '}PR{monthlyPRs !== 1 ? 's' : ''} this month
              </Text>
            </View>
          )}
          <View style={[d.statChip, d.statChipMuted]}>
            <Text style={d.statChipEmoji}>📅</Text>
            <Text style={[d.statChipText, { color: colors.mutedForeground }]}> since {memberSince}</Text>
          </View>
        </View>
        </AnimateRise>

        {/* Edit pencil — floats OUTSIDE the AnimateRise so its taps don't
            get swallowed by Reanimated's Animated.View on Android. The
            wrapping View is `position: relative`, so this absolute pencil
            lands at the top-right of the card visually. Direct router.push
            (not Link asChild) for the most reliable nav path. */}
        <Pressable
          onPress={() => router.push('/(app)/profile' as any)}
          style={d.editBtn}
          hitSlop={16}
          accessibilityLabel="Edit profile"
        >
          <Pencil size={14} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* ── Recent activity card ─────────────────────────────────────── */}
      {/* DEV-BISECT step 5: Restored ActivityRow. */}
      <AnimateRise delay={240} style={[d.card, { padding: 0 }]}>
        <View style={d.activityHeader}>
          <Text style={d.activityTitle}>Recent activity</Text>
          <Link href={'/(app)/history' as any} asChild>
            <Pressable style={d.viewAllBtn}>
              <Text style={d.viewAllText}>View all </Text>
              <ArrowRight size={12} color={colors.mutedForeground} />
            </Pressable>
          </Link>
        </View>

        <View style={d.activityList}>
          {allActivity.map(item => (
            <ActivityRow
              key={`${item._kind}-${item.id}`}
              item={item}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  container: { gap: 20 },

  // Card — `rounded-2xl border border-border bg-card p-6`
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    position: 'relative',
  },

  // Wraps the profile AnimateRise card + the floating edit pencil in a
  // single positioning context so the pencil can be `position: absolute`
  // OUTSIDE the AnimateRise (Reanimated's Animated.View was eating taps).
  profileCardWrap: { position: 'relative' },

  // Edit pencil — `absolute right-4 top-4 h-7 w-7 rounded-full border bg-background`
  // zIndex: 10 keeps it above the AnimateRise's content (sibling stacking).
  editBtn: {
    position: 'absolute',
    right: 16, top: 16,
    width: 28, height: 28, borderRadius: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10, elevation: 10,
  },

  // Greeting — `text-xl font-semibold tracking-tight mb-4 pr-9`
  greeting: {
    color: colors.foreground,
    fontSize: 20, fontWeight: '600',
    marginBottom: 16, paddingRight: 36,
  },

  // Profile row — `flex items-center gap-5`
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: colors.border,
  },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: alpha(colors.primary, 0.10),
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  profileText: { flex: 1, minWidth: 0 },
  name:        { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  email:       { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  // Detail chip — `rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground`
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  detailChip: {
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999,
  },
  detailChipText: { color: colors.mutedForeground, fontSize: 11 },

  // Body chip — `rounded-full border border-primary/30 bg-primary/8 font-mono tabular-nums text-primary`
  bodyChip: {
    borderColor: alpha(colors.primary, 0.30), borderWidth: 1,
    backgroundColor: alpha(colors.primary, 0.08),
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999,
  },
  bodyChipText: {
    color: colors.primary, fontSize: 11,
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },

  // Stats row — `mt-5 flex flex-wrap gap-1.5 border-t border-border pt-4`
  statsRow: {
    marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: colors.border,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  statChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999, borderWidth: 1,
  },
  statChipBlue:  { borderColor: withAlpha(palette.blue[500],  0.30), backgroundColor: withAlpha(palette.blue[500],  0.10) },
  statChipAmber: { borderColor: withAlpha(palette.amber[500], 0.30), backgroundColor: withAlpha(palette.amber[500], 0.10) },
  statChipMuted: { borderColor: colors.border, backgroundColor: alpha(colors.muted, 0.30) },
  statChipEmoji: { fontSize: 11, marginRight: 4 },
  statChipNum:   { marginRight: 0 },
  statChipText:  { fontSize: 11, fontWeight: '500' },

  // Activity card header — `flex items-center justify-between border-b px-5 py-3.5`
  activityHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  activityTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  viewAllBtn:    { flexDirection: 'row', alignItems: 'center' },
  viewAllText:   { color: colors.mutedForeground, fontSize: 12 },

  // Empty state — `px-5 py-10 text-center`
  emptyWrap:  { paddingHorizontal: 20, paddingVertical: 40, alignItems: 'center' },
  emptyText:  { color: colors.mutedForeground, fontSize: 14 },
  emptyCta:   { color: colors.primary, fontSize: 14, fontWeight: '500', marginTop: 12 },

  // Activity list — `p-3 space-y-2`
  activityList: { padding: 12, gap: 8 },

  // Activity row — `rounded-xl border border-border` outer; `flex items-center gap-3 px-4 py-3` inner
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
