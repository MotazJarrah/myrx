/**
 * Bodyweight — direct port of MyRX/src/pages/Bodyweight.jsx to React Native.
 *
 * Layout 1:1:
 *   1. Header (title + subtext)
 *   2. Log form (animate-rise): NumericInput weight + lb/kg UnitToggle + emerald "Log weight" button
 *   3. Stats grid (2-col, animate-rise staggered):
 *      ├─ Current Weight        (emerald TickerNumber + "Logged Mon DD" sub)
 *      ├─ BMI                   (color-coded by category w/ pill chip)
 *      ├─ Ideal Weight Range    (BMI 18.5–24.9 → preferredUnit)
 *      └─ Weight Trend          (delta vs ~30 days ago, with TrendingUp/Down/Minus icon)
 *   4. Progress chart (LineChart over time, emerald)
 *   5. Log list (most recent 30) with DeleteAction tap-confirm
 *
 * Profile sync:
 *   – On every log/delete, normalises the most-recent weight to profile.weight_unit
 *     (default 'lb') and updates profiles.current_weight, then refreshProfile().
 *   – If the deleted log was the only one, profile.current_weight is preserved.
 */

import { useState, useEffect, useMemo } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { TrendingUp, TrendingDown, Target, Minus } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { dataCache } from '../../src/lib/cache'
import { TAG_STYLES } from '../../src/lib/effortTags'
import { NumericInput } from '../../src/components/NumericInput'
import UnitToggle from '../../src/components/UnitToggle'
import AnimateRise from '../../src/components/AnimateRise'
import DeleteAction from '../../src/components/DeleteAction'
import TickerNumber from '../../src/components/TickerNumber'
import LineChart from '../../src/components/LineChart'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Helpers (1:1 with Bodyweight.jsx) ────────────────────────────────────────

function toKg(weight: number, unit: string): number {
  return unit === 'lb' ? weight * 0.453592 : weight
}

function toDisplayUnit(kg: number, unit: string): number {
  const val = unit === 'lb' ? kg / 0.453592 : kg
  return Math.round(val * 10) / 10
}

function getHeightM(profile: any): number | null {
  if (!profile?.current_height) return null
  if (profile.height_unit === 'metric') return profile.current_height / 100
  return profile.current_height * 0.0254 // imperial: stored as total inches
}

function calcBMI(weightKg: number | null, heightM: number | null): number | null {
  if (!weightKg || !heightM) return null
  return weightKg / (heightM * heightM)
}

interface BMICategory {
  label: string
  color: string       // text colour
  bg:    string       // bg fill
  border:string       // border colour
}

function bmiCategory(bmi: number): BMICategory {
  if (bmi < 18.5) return { label: 'Underweight', color: palette.sky[400],     bg: withAlpha(palette.sky[500],     0.10), border: withAlpha(palette.sky[500],     0.20) }
  if (bmi < 25)   return { label: 'Normal',      color: palette.emerald[400], bg: withAlpha(palette.emerald[500], 0.10), border: withAlpha(palette.emerald[500], 0.20) }
  if (bmi < 30)   return { label: 'Overweight',  color: palette.amber[400],   bg: withAlpha(palette.amber[500],   0.10), border: withAlpha(palette.amber[500],   0.20) }
  return                 { label: 'Obese',       color: palette.red[400],     bg: withAlpha(palette.red[500],     0.10), border: withAlpha(palette.red[500],     0.20) }
}

// ── Bodyweight log row (matches DB shape) ────────────────────────────────────

interface BWLog {
  id:         string
  user_id:    string
  weight:     number
  unit:       string         // 'lb' | 'kg'
  created_at: string
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Bodyweight() {
  const { user, profile, refreshProfile } = useAuth()

  const [weight, setWeight] = useState('')
  const [unit,   setUnit]   = useState<'lb' | 'kg'>(((profile?.weight_unit as 'lb' | 'kg') || 'lb'))

  const bwKey  = user ? `bodyweight:${user.id}` : null
  const cachedLogs = bwKey ? dataCache.get<BWLog[]>(bwKey) : null
  const [logs, setLogs] = useState<BWLog[]>(() => cachedLogs ?? [])
  // Initial-load loading flag — skipped when we already have cached logs so
  // returning users get instant paint. Flips false after the supabase fetch
  // resolves the first time.
  const [loading, setLoading] = useState<boolean>(!cachedLogs)

  // Sync log unit with profile preference when profile loads
  useEffect(() => {
    if (profile?.weight_unit) setUnit(profile.weight_unit as 'lb' | 'kg')
  }, [profile?.weight_unit])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bodyweight')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows: BWLog[] = (data as BWLog[] | null) ?? []
        setLogs(rows)
        if (bwKey) dataCache.set(bwKey, rows)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function logWeight() {
    if (!weight || !user) return
    const { data } = await supabase
      .from('bodyweight')
      .insert({ user_id: user.id, weight: Number(weight), unit })
      .select()
      .single()
    if (!data) return

    const newLogs: BWLog[] = [data as BWLog, ...logs]
    setLogs(newLogs)
    if (bwKey) dataCache.set(bwKey, newLogs)
    setWeight('')

    // Keep profile.current_weight in sync (normalised to profile.weight_unit)
    const prefUnit  = profile?.weight_unit || 'lb'
    const weightKg  = toKg(Number(weight), unit)
    const normalized = prefUnit === 'kg'
      ? Math.round(weightKg * 10) / 10
      : Math.round((weightKg / 0.453592) * 10) / 10
    await supabase.from('profiles').update({ current_weight: normalized }).eq('id', user.id)
    refreshProfile()
  }

  async function deleteEntry(id: string) {
    const remaining = logs.filter(l => l.id !== id)
    setLogs(remaining)
    if (bwKey) dataCache.set(bwKey, remaining)

    if (!user) return
    await supabase.from('bodyweight').delete().eq('id', id).eq('user_id', user.id)

    // Sync profile.current_weight to the new most-recent log.
    if (remaining.length > 0) {
      const latest   = remaining[0]
      const prefUnit = profile?.weight_unit || 'lb'
      const weightKg = toKg(latest.weight, latest.unit)
      const normalized = prefUnit === 'kg'
        ? Math.round(weightKg * 10) / 10
        : Math.round((weightKg / 0.453592) * 10) / 10
      await supabase.from('profiles').update({ current_weight: normalized }).eq('id', user.id)
      refreshProfile()
    }
    // No remaining logs → leave current_weight as-is
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const preferredUnit = (profile?.weight_unit as 'lb' | 'kg') || unit
  const heightM       = getHeightM(profile)

  const latestLog = logs[0] ?? null
  const profileWeightKg = profile?.current_weight != null
    ? toKg(profile.current_weight, profile.weight_unit || 'lb')
    : null
  const latestWeightKg = profileWeightKg
    ?? (latestLog ? toKg(latestLog.weight, latestLog.unit) : null)

  const currentDisplay = profile?.current_weight != null
    ? `${profile.current_weight} ${profile.weight_unit || 'lb'}`
    : latestLog
      ? `${latestLog.weight} ${latestLog.unit}`
      : null

  const bmi    = calcBMI(latestWeightKg, heightM)
  const bmiCat = bmi != null ? bmiCategory(bmi) : null

  const idealMin = heightM ? toDisplayUnit(18.5 * heightM * heightM, preferredUnit) : null
  const idealMax = heightM ? toDisplayUnit(24.9 * heightM * heightM, preferredUnit) : null

  // Weight trend: compare latest to log ~30 days ago (or oldest available)
  const trend = useMemo(() => {
    if (logs.length < 2) return null
    const latest        = logs[0]
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    const reference     = logs.find(l => new Date(l.created_at).getTime() <= thirtyDaysAgo) ?? logs[logs.length - 1]
    if (reference.id === latest.id) return null

    const latestKg    = toKg(latest.weight, latest.unit)
    const referenceKg = toKg(reference.weight, reference.unit)
    const deltaKg     = latestKg - referenceKg
    const deltaVal    = toDisplayUnit(Math.abs(deltaKg), preferredUnit)
    const days        = Math.round(
      (new Date(latest.created_at).getTime() - new Date(reference.created_at).getTime()) / 86_400_000,
    )
    return { delta: deltaKg, display: deltaVal, days }
  }, [logs, preferredUnit])

  // Chart: sorted oldest-first; use LineChart's { ts, y } shape
  const chartData = useMemo(() => {
    if (logs.length > 0) {
      return [...logs]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(l => ({
          ts: l.created_at,
          y:  toDisplayUnit(toKg(l.weight, l.unit), preferredUnit),
        }))
    }
    if (profile?.current_weight != null) {
      return [{
        ts: user?.created_at ?? new Date().toISOString(),
        y:  toDisplayUnit(toKg(profile.current_weight, profile.weight_unit || 'lb'), preferredUnit),
      }]
    }
    return []
  }, [logs, profile, user, preferredUnit])

  const showChart = chartData.length > 0

  // Skeleton — first-paint placeholder when there's no cached log data yet.
  // Heights approximate header + log form + 2x2 stats grid + chart + log list
  // so the page structure is visible while the supabase fetch resolves.
  if (loading) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.container}>
          <View style={{ gap: 6 }}>
            <Skeleton style={{ height: 22, width: 140, borderRadius: 6 }} />
            <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
          </View>
          <Skeleton style={{ height: 140, width: '100%', borderRadius: 12 }} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 100, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 100, flex: 1, borderRadius: 12 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton style={{ height: 100, flex: 1, borderRadius: 12 }} />
            <Skeleton style={{ height: 100, flex: 1, borderRadius: 12 }} />
          </View>
          <Skeleton style={{ height: 240, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 300, width: '100%', borderRadius: 12 }} />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.container}>

        {/* ── Header ── */}
        <View>
          <Text style={s.h1}>Bodyweight</Text>
          <Text style={s.sub}>Track your weight and monitor body composition trends.</Text>
        </View>

        {/* ── Log form ── */}
        <AnimateRise>
          <View style={s.formCard}>
            <View style={s.formRow}>
              <View style={s.formWeightCol}>
                <Text style={s.label}>Weight</Text>
                <NumericInput
                  value={weight}
                  onChange={setWeight}
                  placeholder="0.0"
                />
              </View>
              <View style={s.formUnitCol}>
                <Text style={s.label}>Unit</Text>
                <UnitToggle<'lb' | 'kg'>
                  value={unit}
                  options={['lb', 'kg'] as const}
                  onChange={setUnit}
                />
              </View>
            </View>

            <Pressable
              onPress={logWeight}
              disabled={!weight}
              style={[s.logBtn, !weight && s.logBtnDisabled]}
            >
              <Text style={s.logBtnText}>Log weight</Text>
            </Pressable>
          </View>
        </AnimateRise>

        {/* ── Stats grid ──
            Web is `grid-cols-2 gap-3` with row-major fill, AND CSS grid stretches
            cells in the same row to the row's tallest height. Mobile equivalent:
            an explicit 2-row layout, each row a flex row with two `flex: 1` cells.
            `alignItems: 'stretch'` (default) makes both cells in a row fill the
            row's content height — so the bottoms align even when one cell's
            content wraps to an extra line. */}
        <View style={s.statsGrid}>

          {/* Row 1: Current Weight | BMI */}
          <View style={s.statRow}>
            {/* Current Weight */}
            <AnimateRise delay={60} style={s.statCell}>
              <View style={[s.statCard, s.cardFill]}>
                <Text style={s.statTitle}>Current Weight</Text>
                {currentDisplay
                  ? <View style={s.tickerRow}>
                      <TickerNumber
                        value={currentDisplay}
                        fontSize={24}
                        fontWeight="700"
                        color={palette.emerald[400]}
                      />
                    </View>
                  : <Text style={[s.bigNumber, { color: palette.emerald[400] }]}>—</Text>}
                <Text style={s.statSub}>
                  {latestLog
                    ? `Logged ${new Date(latestLog.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : profile?.current_weight ? 'From profile' : 'Log your first weigh-in'}
                </Text>
              </View>
            </AnimateRise>

            {/* BMI */}
            <AnimateRise delay={120} style={s.statCell}>
              {bmi != null && bmiCat ? (
                <View style={[s.statCardColored, s.cardFill, { backgroundColor: bmiCat.bg, borderColor: bmiCat.border }]}>
                  <View style={s.bmiHeaderRow}>
                    <Text style={s.statTitle}>BMI</Text>
                    <View style={[s.bmiPill, { backgroundColor: bmiCat.bg, borderColor: bmiCat.border }]}>
                      <Text style={[s.bmiPillText, { color: bmiCat.color }]}>{bmiCat.label}</Text>
                    </View>
                  </View>
                  <View style={s.tickerRow}>
                    <TickerNumber
                      value={bmi.toFixed(1)}
                      fontSize={24}
                      fontWeight="700"
                      color={bmiCat.color}
                    />
                  </View>
                  <Text style={s.statSub}>Normal range: 18.5 – 24.9</Text>
                </View>
              ) : (
                <View style={[s.statCard, s.cardFill]}>
                  <Text style={s.statTitle}>BMI</Text>
                  <Text style={s.statEmpty}>
                    {!latestWeightKg ? 'Log a weigh-in first' : 'Add height in profile to calculate'}
                  </Text>
                </View>
              )}
            </AnimateRise>
          </View>

          {/* Row 2: Ideal Weight Range | Weight Trend */}
          <View style={s.statRow}>
            {/* Ideal Weight Range — content wraps naturally if "125.3 – 168.6 lb"
                doesn't fit on one line in a narrow card (web does the same). */}
            <AnimateRise delay={180} style={s.statCell}>
              {idealMin != null && idealMax != null ? (
                <View style={[s.statCard, s.cardFill]}>
                  <Text style={s.statTitle}>Ideal Weight Range</Text>
                  <View style={s.idealRow}>
                    <TickerNumber
                      value={idealMin}
                      fontSize={24}
                      fontWeight="700"
                      color={colors.foreground}
                    />
                    <Text style={[s.bigNumberInline, { color: colors.foreground }]}> – </Text>
                    <TickerNumber
                      value={idealMax}
                      fontSize={24}
                      fontWeight="700"
                      color={colors.foreground}
                    />
                    <Text style={s.idealUnit}>{preferredUnit}</Text>
                  </View>
                  <Text style={s.statSub}>Based on BMI 18.5 – 24.9</Text>
                </View>
              ) : (
                <View style={[s.statCard, s.cardFill]}>
                  <Text style={s.statTitle}>Ideal Weight Range</Text>
                  <Target size={20} color={alpha(colors.mutedForeground, 0.30)} style={{ marginBottom: 4 }} />
                  <Text style={s.statEmpty}>Add height in profile</Text>
                </View>
              )}
            </AnimateRise>

            {/* Weight Trend */}
            <AnimateRise delay={240} style={s.statCell}>
              {trend ? (
                <View style={[s.statCard, s.cardFill]}>
                  <View style={s.bmiHeaderRow}>
                    <Text style={s.statTitle}>Weight Trend</Text>
                    {trend.delta < -0.05 ? <TrendingDown size={16} color={palette.emerald[400]} />
                      : trend.delta > 0.05 ? <TrendingUp size={16} color={palette.amber[400]} />
                      : <Minus size={16} color={colors.mutedForeground} />}
                  </View>
                  <View style={[s.tickerRow, { alignItems: 'flex-end' }]}>
                    {trend.delta > 0.05
                      ? <Text style={[s.bigNumberInline, { color: palette.amber[400] }]}>+</Text>
                      : trend.delta < -0.05
                        ? <Text style={[s.bigNumberInline, { color: palette.emerald[400] }]}>−</Text>
                        : null}
                    <TickerNumber
                      value={trend.display}
                      fontSize={24}
                      fontWeight="700"
                      color={trend.delta < -0.05 ? palette.emerald[400] : trend.delta > 0.05 ? palette.amber[400] : colors.foreground}
                    />
                    <Text style={[
                      s.bigNumberInline,
                      { color: trend.delta < -0.05 ? palette.emerald[400] : trend.delta > 0.05 ? palette.amber[400] : colors.foreground },
                    ]}>
                      {' '}{preferredUnit}
                    </Text>
                  </View>
                  <Text style={s.statSub}>Over {trend.days} day{trend.days !== 1 ? 's' : ''} of tracking</Text>
                </View>
              ) : (
                <View style={[s.statCard, s.cardFill]}>
                  <Text style={s.statTitle}>Weight Trend</Text>
                  <Text style={s.statEmpty}>Log more weigh-ins to see your trend</Text>
                </View>
              )}
            </AnimateRise>
          </View>
        </View>

        {/* ── Progress chart ── */}
        {showChart && (
          <AnimateRise>
            <View style={s.chartCard}>
              <Text style={s.chartHeading}>
                Progress <Text style={s.chartHeadingMuted}>({preferredUnit})</Text>
              </Text>
              <LineChart
                data={chartData}
                height={180}
                yWidth={40}
                lineColor={palette.emerald[400]}    /* web stroke="#34d399" */
                activeDotRadius={7}                  /* web activeDot r=7 */
                tooltipLabel="Weight"
                tooltipValueFormatter={v => `${v} ${preferredUnit}`}
                yTickFormatter={v => String(Math.round(v * 10) / 10)}
                caption={chartData.length === 1 ? (
                  <Text style={s.chartCaption}>Log more weigh-ins to see your trend</Text>
                ) : null}
              />
            </View>
          </AnimateRise>
        )}

        {/* ── Log ── */}
        {logs.length > 0 && (
          <AnimateRise>
            <View style={s.logCard}>
              <View style={s.logHeader}>
                <Text style={s.logHeaderText}>Log</Text>
              </View>
              <View>
                {logs.slice(0, 30).map((l, idx) => (
                  <View key={l.id} style={idx > 0 ? s.logRowDivider : null}>
                    <DeleteAction onDelete={() => deleteEntry(l.id)}>
                      <View style={s.logRow}>
                        <View style={s.logRowLeft}>
                          <View style={[s.tag, TAG_STYLES.weighin]}>
                            <Text style={[s.tagText, { color: TAG_STYLES.weighin.color }]}>Weigh-in</Text>
                          </View>
                          <Text style={s.logDate} numberOfLines={1}>
                            {new Date(l.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </View>
                        <Text style={s.logWeight}>{l.weight} {l.unit}</Text>
                      </View>
                    </DeleteAction>
                  </View>
                ))}
              </View>
            </View>
          </AnimateRise>
        )}
      </View>
    </ScrollView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:    { paddingBottom: 24 },
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 20, maxWidth: 672, alignSelf: 'center', width: '100%' },

  // Header
  h1:  { fontSize: 20, fontWeight: '600', color: colors.foreground, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: colors.mutedForeground, marginTop: 2 },

  // Log form
  formCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    gap: 16,
  },
  formRow:       { flexDirection: 'row', gap: 12 },
  formWeightCol: { flex: 2, gap: 6 },
  formUnitCol:   { flex: 1, gap: 6 },
  label:         { fontSize: 14, color: colors.mutedForeground },

  logBtn: {
    backgroundColor: palette.emerald[500],
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  logBtnDisabled: { opacity: 0.5 },
  logBtnText:     { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Stats grid — explicit 2-row × 2-col layout to mirror CSS `grid-cols-2`.
  // `statRow` is a flex row with default `alignItems: 'stretch'` so both cells
  // in a row inherit the row's tallest content height (matches CSS grid's
  // implicit row alignment). `statCell` + `cardFill` on the inner card make
  // the card itself stretch to fill the cell vertically.
  statsGrid: { gap: 12 },
  statRow:   { flexDirection: 'row', gap: 12 },
  statCell:  { flex: 1 },
  cardFill:  { flex: 1, minHeight: 110 },
  statCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    minHeight: 110,
  },
  statCardColored: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    minHeight: 110,
  },
  statTitle: { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
  statSub:   { fontSize: 12, color: colors.mutedForeground },
  statEmpty: { fontSize: 14, color: alpha(colors.mutedForeground, 0.60), lineHeight: 18 },

  // Big-number row (TickerNumber wraps)
  tickerRow:        { flexDirection: 'row', alignItems: 'flex-end' },
  bigNumber:        { fontSize: 24, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  bigNumberInline:  { fontSize: 24, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },

  // BMI card
  bmiHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bmiPill:      {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    borderWidth: 1,
  },
  bmiPillText: { fontSize: 10, fontWeight: '600' },

  // Ideal weight — flex-wrap so the range + unit fall to a new line if they
  // don't fit horizontally (matches the web `<p>` block-level wrap behaviour).
  idealRow:  { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  idealUnit: { fontSize: 14, color: colors.mutedForeground, marginBottom: 2, marginLeft: 6 },

  // Chart
  chartCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
  },
  chartHeading:       { fontSize: 14, fontWeight: '600', color: colors.foreground, marginBottom: 16 },
  chartHeadingMuted:  { fontWeight: '400', color: colors.mutedForeground },
  chartCaption:       { fontSize: 12, color: colors.mutedForeground, textAlign: 'center', marginTop: 8 },

  // Log list
  logCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  logHeader: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  logHeaderText: { fontSize: 14, fontWeight: '600', color: colors.foreground },

  logRowDivider: { borderTopColor: colors.border, borderTopWidth: 1 },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.card,
    gap: 12,
  },
  logRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9999,
    flexShrink: 0,
  },
  tagText:  { fontSize: 10, fontWeight: '500' },
  logDate:  { fontSize: 14, color: colors.mutedForeground, flex: 1 },
  logWeight:{ fontFamily: fonts.mono[500], fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '500', color: colors.foreground, flexShrink: 0 },
})
