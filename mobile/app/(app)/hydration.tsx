/**
 * Hydration — daily water-intake tracker.
 * Skia-migrated 2026-05-31 — see Pattern 9 in CLAUDE.md.
 *
 * Layout (top-to-bottom):
 *   1. Header — "Hydration" h1 + today's date subtext.
 *   2. Today's progress card (AnimateRise delay 0)
 *      ├─ Circular Skia progress ring (cyan), TickerNumber for current amount,
 *      │  helper text + bodyweight-based attribution. Ring fill animates
 *      │  smoothly as the user logs new entries.
 *      └─ Three quick-add chips (8/12/16 oz OR 250/350/500 mL) inside the same card.
 *   3. 7-day chart (AnimateRise delay 250) — Skia bar chart with dashed target line.
 *   4. Today's log list (AnimateRise delay 500) — DeleteAction tap-confirm per row.
 *
 * Storage model:
 *   – water_logs.amount_ml is the canonical column (always mL).
 *   – profiles.fluid_unit controls display: 'oz' (default) or 'mL'.
 *   – Quick-add chips are unit-locked per the spec; tapping a chip converts
 *     to mL before insert.
 *
 * Target derivation:
 *   – Daily target = current_weight × 0.67 oz/lb (≈50 mL/kg), pulled from
 *     profiles.current_weight + profiles.weight_unit.
 *   – Fallback when weight is missing: 64 oz / 1900 mL (classic 8 glasses).
 *
 * Rendering — GPU-backed via @shopify/react-native-skia. The progress ring
 * and the 7-day chart each paint inside a single Skia <Canvas>. The ring's
 * fill is animated via a Reanimated shared value feeding useDerivedValue,
 * so the arc smoothly extends whenever the user logs a new entry (without
 * the React render cycle being driven per frame). Text labels (axis ticks,
 * day labels) remain absolute-positioned RN <Text> overlays above the
 * canvas per Pattern 9. See HrRangeChart.tsx + LineChart.tsx for the two
 * most-relevant reference implementations.
 *
 * NOTE (v1 scope): Wearable hydration integration (Samsung Health
 * DataTypes.HYDRATION, Apple HealthKit dietaryWater, etc.) is OUT OF SCOPE.
 * Manual entry only.
 */

import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import {
  Canvas, Path, Group, Skia, vec, DashPathEffect, type SkPath,
} from '@shopify/react-native-skia'
import {
  useSharedValue, useDerivedValue, withTiming,
} from 'react-native-reanimated'
import { router } from 'expo-router'  // TEMP — Aquos animation spike nav (remove with the spike)
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { dataCache } from '../../src/lib/cache'
import AnimateRise from '../../src/components/AnimateRise'
import DeleteAction from '../../src/components/DeleteAction'
import TickerNumber from '../../src/components/TickerNumber'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Volume helpers ───────────────────────────────────────────────────────────
// Canonical conversion constants. All math stays in mL internally; we only
// switch to oz/mL at display + chip-tap time.
const ML_PER_OZ = 29.5735
const OZ_PER_LB = 0.67       // bodyweight target multiplier (oz/lb)
const ML_PER_KG = 50         // bodyweight target multiplier (mL/kg)
const FALLBACK_OZ = 64       // 8 × 8oz glasses
const FALLBACK_ML = 1900

function ozToMl(oz: number): number { return oz * ML_PER_OZ }
function mlToOz(ml: number): number { return ml / ML_PER_OZ }

/** Render `ml` in the user's display unit, rounded sensibly. */
function fmtVolume(ml: number, unit: 'oz' | 'mL'): string {
  if (unit === 'mL') return String(Math.round(ml))
  // For oz we round to whole numbers (chip values are integers, accumulation
  // stays close to integer with the standard chip sizes).
  return String(Math.round(mlToOz(ml)))
}

/** Compute today's target in mL from profile bodyweight; fallback if missing. */
function targetMlForProfile(profile: { current_weight: number | null; weight_unit: string | null; fluid_unit?: 'oz' | 'mL' | null } | null): number {
  if (!profile?.current_weight || profile.current_weight <= 0) {
    return (profile?.fluid_unit ?? 'oz') === 'mL' ? FALLBACK_ML : ozToMl(FALLBACK_OZ)
  }
  if (profile.weight_unit === 'kg') {
    return profile.current_weight * ML_PER_KG
  }
  // Default to lb when weight_unit is null or 'lb'.
  return ozToMl(profile.current_weight * OZ_PER_LB)
}

// Quick-add chips per the locked spec (3 each, no custom).
const OZ_CHIPS = [8, 12, 16] as const
const ML_CHIPS = [250, 350, 500] as const

// ── DB row ───────────────────────────────────────────────────────────────────

interface WaterLog {
  id:         string
  user_id:    string
  amount_ml:  number
  logged_at:  string
  created_at: string
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Midnight (local) of the given date as a JS Date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** ISO yyyy-mm-dd from a Date — used as a bucket key for the 7-day chart. */
function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── Progress ring (Skia, animated) ────────────────────────────────────────────

interface RingProps {
  pct:    number      // 0..1 (clamped at 1)
  size:   number
  stroke: number
  color:  string
  trackColor: string
}

/**
 * Animated circular progress ring rendered on a Skia canvas.
 *
 * The progress arc is built as a partial circle path inside useDerivedValue
 * so the path re-builds on each shared-value frame. The shared value
 * (`progress`) tweens from its previous value to the new `pct` via
 * withTiming whenever the prop changes — so adding a chip-tap entry makes
 * the arc smoothly extend rather than snap. Track is static (full circle).
 *
 * The arc is rotated -90° in math-space (i.e. it starts at 12 o'clock and
 * sweeps clockwise) by passing `-90` as the start angle to addArc.
 */
function ProgressRing({ pct, size, stroke, color, trackColor }: RingProps) {
  const r = (size - stroke) / 2
  const c = size / 2

  // Tween the arc's sweep fraction; React renders are still cheap because
  // only the shared value drives the per-frame work.
  const progress = useSharedValue(Math.max(0, Math.min(1, pct)))
  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(1, pct)), { duration: 400 })
  }, [pct, progress])

  // Static track path (full circle outline) — built once.
  const trackPath = useMemo(() => {
    const path = Skia.Path.Make()
    path.addCircle(c, c, r)
    return path
  }, [c, r])

  // Animated progress arc path. Rebuilt on every shared-value tick on the
  // UI thread (worklet). Uses addArc on a bounding rect so the result is a
  // genuine arc (not a wedge with radial lines). startAngle=-90 means "12
  // o'clock"; sweep is in degrees, positive = clockwise.
  const arcPath = useDerivedValue(() => {
    const path = Skia.Path.Make()
    if (progress.value <= 0) return path
    const sweep = 360 * progress.value
    const rect = { x: c - r, y: c - r, width: r * 2, height: r * 2 }
    path.addArc(rect, -90, sweep)
    return path
  })

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Track — full-circle outline at very low opacity */}
      <Path
        path={trackPath}
        color={trackColor}
        style="stroke"
        strokeWidth={stroke}
      />
      {/* Progress arc — sweep grows as `pct` grows */}
      <Path
        path={arcPath}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
      />
    </Canvas>
  )
}

// ── 7-day bar chart (Skia) ──────────────────────────────────────────────────

interface BarChartProps {
  buckets: { key: string; label: string; ml: number }[]
  targetMl: number
  displayUnit: 'oz' | 'mL'
  width:  number
  height: number
}

/**
 * 7-day bar chart rendered on a Skia canvas with RN <Text> overlays for
 * axis labels and day labels.
 *
 * Shape mix is the same as HrRangeChart: bars (Rects), a dashed reference
 * line (DashPathEffect inside a Path), and tick labels lifted out to RN
 * <Text> per Pattern 9. Static — no animations — so paths are built in
 * useMemo, not useDerivedValue.
 */
function BarChart({ buckets, targetMl, displayUnit, width, height }: BarChartProps) {
  const padTop    = 16
  const padBottom = 22
  const padLeft   = 30
  const padRight  = 8
  const plotW     = width  - padLeft - padRight
  const plotH     = height - padTop  - padBottom
  const n         = buckets.length
  const gap       = 6
  const barW      = (plotW - gap * (n - 1)) / n

  // Max value scales to the larger of target or actual max so the dashed
  // target line is always inside the plot area.
  const dataMax   = Math.max(targetMl, ...buckets.map(b => b.ml), 1)
  const yMax      = dataMax * 1.10

  // Map a value to its y-pixel (0 = top edge of plot area).
  function yFor(v: number): number {
    return padTop + plotH - (v / yMax) * plotH
  }

  const targetY   = yFor(targetMl)
  // Tick marks at 0 / target — written in display unit
  const yTicks = [
    { v: 0,        label: '0' },
    { v: targetMl, label: fmtVolume(targetMl, displayUnit) },
  ]

  // Build the dashed target line path. Single Path; dash pattern via
  // DashPathEffect (child of Path per Skia scoping rules — mirrors SVG's
  // strokeDasharray="3 3").
  const targetLinePath = useMemo<SkPath>(() => {
    const path = Skia.Path.Make()
    path.moveTo(padLeft, targetY)
    path.lineTo(width - padRight, targetY)
    return path
  }, [padLeft, padRight, targetY, width])

  // Bars — one rounded-rect path per day. Skia supports addRRect so each
  // bar's rx=3 is honored without extra math.
  const bars = useMemo(() => {
    return buckets.map((b, i) => {
      const x      = padLeft + i * (barW + gap)
      const filled = b.ml > 0
      const h      = filled ? Math.max(2, (b.ml / yMax) * plotH) : 2
      const y      = padTop + plotH - h
      const path   = Skia.Path.Make()
      path.addRRect({
        rect: { x, y, width: barW, height: h },
        rx: 3,
        ry: 3,
      })
      return {
        key: b.key,
        path,
        color: filled ? palette.cyan[400] : withAlpha(palette.cyan[400], 0.18),
      }
    })
  }, [buckets, padLeft, barW, gap, plotH, padTop, yMax])

  return (
    <View style={{ width, height, position: 'relative' }}>
      <Canvas style={{ width, height }}>
        {/* Dashed target reference line — DashPathEffect is a CHILD of
            <Path> per Skia (not a top-level <Defs> like SVG). Mirrors the
            original strokeDasharray="3 3". */}
        <Path
          path={targetLinePath}
          color={withAlpha(palette.cyan[400], 0.55)}
          style="stroke"
          strokeWidth={1}
        >
          <DashPathEffect intervals={[3, 3]} />
        </Path>

        {/* Bars — one rounded-rect per day */}
        <Group>
          {bars.map(b => (
            <Path key={b.key} path={b.path} color={b.color} />
          ))}
        </Group>
      </Canvas>

      {/* Y-axis tick labels — RN Text overlay above the canvas. Right-
          aligned to land just left of the plot area, mirroring SVG's
          textAnchor="end" at x={padLeft - 4}. */}
      {yTicks.map(t => (
        <Text
          key={t.label + t.v}
          style={[
            chartStyles.yTickLabel,
            {
              top:  yFor(t.v) - 5,
              left: 0,
              width: padLeft - 6,
            },
          ]}
          numberOfLines={1}
        >
          {t.label}
        </Text>
      ))}

      {/* Day labels under each bar */}
      {buckets.map((b, i) => {
        const x = padLeft + i * (barW + gap) + barW / 2
        return (
          <Text
            key={b.key + '-lbl'}
            style={[
              chartStyles.dayLabel,
              {
                top:  height - 14,
                left: x - 20,
                width: 40,
              },
            ]}
            numberOfLines={1}
          >
            {b.label}
          </Text>
        )
      })}
    </View>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Hydration() {
  const { user, profile } = useAuth()

  const fluidUnit: 'oz' | 'mL' = ((profile as any)?.fluid_unit as 'oz' | 'mL' | null) ?? 'oz'
  const chips                  = fluidUnit === 'mL' ? ML_CHIPS : OZ_CHIPS

  const targetMl = useMemo(() => targetMlForProfile(profile as any), [profile])

  // Last-7-days window (today inclusive). We fetch in one shot and bucket
  // client-side so today's "current" total and the 7-day chart share data.
  const sevenDaysAgo = useMemo(() => {
    const s = startOfDay(new Date())
    s.setDate(s.getDate() - 6) // include today + 6 prior days
    return s
  }, [])

  const cacheKey = user ? `hydration:${user.id}` : null
  const [logs, setLogs] = useState<WaterLog[]>(() => (cacheKey ? dataCache.get<WaterLog[]>(cacheKey) ?? [] : []))

  useEffect(() => {
    if (!user) return
    supabase
      .from('water_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('logged_at', sevenDaysAgo.toISOString())
      .order('logged_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data as WaterLog[] | null) ?? []
        setLogs(rows)
        if (cacheKey) dataCache.set(cacheKey, rows)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ── Derived: today's total + per-day buckets ───────────────────────────────

  const todayKey = useMemo(() => dateKey(new Date()), [])

  const todayMl = useMemo(() => {
    return logs
      .filter(l => dateKey(new Date(l.logged_at)) === todayKey)
      .reduce((s, l) => s + Number(l.amount_ml), 0)
  }, [logs, todayKey])

  const todayLogs = useMemo(() => {
    return logs
      .filter(l => dateKey(new Date(l.logged_at)) === todayKey)
      // Newest first — supabase already orders desc, but reapply after
      // optimistic insert / delete to keep ordering stable.
      .slice()
      .sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime())
  }, [logs, todayKey])

  const sevenDayBuckets = useMemo(() => {
    const out: { key: string; label: string; ml: number }[] = []
    const today = startOfDay(new Date())
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key   = dateKey(d)
      const label = i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
      out.push({ key, label, ml: 0 })
    }
    const idxByKey: Record<string, number> = {}
    out.forEach((b, i) => { idxByKey[b.key] = i })
    for (const l of logs) {
      const k = dateKey(new Date(l.logged_at))
      const idx = idxByKey[k]
      if (idx != null) out[idx].ml += Number(l.amount_ml)
    }
    return out
  }, [logs])

  const pct = targetMl > 0 ? todayMl / targetMl : 0

  // ── Actions ────────────────────────────────────────────────────────────────

  async function addAmount(displayAmount: number) {
    if (!user) return
    const amountMl = fluidUnit === 'mL' ? displayAmount : ozToMl(displayAmount)
    // Optimistic insert with a temporary id so the ring + chart move instantly.
    const tempId = `temp-${Date.now()}`
    const optimistic: WaterLog = {
      id: tempId,
      user_id: user.id,
      amount_ml: amountMl,
      logged_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const optimisticLogs = [optimistic, ...logs]
    setLogs(optimisticLogs)

    const { data, error } = await supabase
      .from('water_logs')
      .insert({ user_id: user.id, amount_ml: amountMl })
      .select()
      .single()

    if (error || !data) {
      // Roll back optimistic insert on failure — surface nothing visible
      // beyond the bar regressing; the chip stays available for retry.
      setLogs(logs)
      return
    }
    const reconciled = optimisticLogs.map(l => (l.id === tempId ? (data as WaterLog) : l))
    setLogs(reconciled)
    if (cacheKey) dataCache.set(cacheKey, reconciled)
  }

  async function deleteEntry(id: string) {
    const remaining = logs.filter(l => l.id !== id)
    setLogs(remaining)
    if (cacheKey) dataCache.set(cacheKey, remaining)
    if (!user) return
    await supabase.from('water_logs').delete().eq('id', id).eq('user_id', user.id)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Hero figures rendered with TickerNumber — current value rolls slot-machine
  // style on every chip tap. Target stays static (changes only when profile
  // weight changes).
  const currentDisplay = fmtVolume(todayMl, fluidUnit)
  const targetDisplay  = fmtVolume(targetMl, fluidUnit)
  const remainingMl    = Math.max(0, targetMl - todayMl)
  const overTarget     = todayMl > targetMl

  const targetAttribution = (profile as any)?.current_weight
    ? (profile?.weight_unit === 'kg'
        ? `Bodyweight × 50 mL/kg`
        : `Bodyweight × 0.67 oz/lb`)
    : `Default — log your weight for a personalized target`

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.container}>

        {/* ── Header ── */}
        <View>
          <Text style={s.h1}>Hydration</Text>
          <Text style={s.sub}>{formatToday()}</Text>
        </View>

        {/* ── TEMP: Aquos animation spike (Rive vs Skia bake-off) ──
            Throwaway dev entry point so the two companion prototypes can be
            compared on-device. Remove this whole block (+ the expo-router
            import + app/rive-spike.tsx + app/skia-spike.tsx) once a path is
            chosen. */}
        <View style={s.spikeCard}>
          <Text style={s.spikeLabel}>Aquos animation — compare</Text>
          <View style={s.spikeRow}>
            <Pressable style={s.spikeBtn} onPress={() => router.push('/rive-spike' as any)}>
              <Text style={s.spikeBtnText}>Rive version</Text>
            </Pressable>
            <Pressable style={s.spikeBtn} onPress={() => router.push('/skia-spike' as any)}>
              <Text style={s.spikeBtnText}>Skia version</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Today's progress + quick-add chips ── */}
        <AnimateRise delay={0}>
          <View style={s.card}>
            {/* Progress ring with center value */}
            <View style={s.ringWrap}>
              <ProgressRing
                pct={pct}
                size={200}
                stroke={14}
                color={palette.cyan[400]}
                trackColor={withAlpha(palette.cyan[400], 0.15)}
              />
              <View style={s.ringCenter} pointerEvents="none">
                <View style={s.ringValueRow}>
                  <TickerNumber
                    value={currentDisplay}
                    fontSize={36}
                    fontWeight="700"
                    color={palette.cyan[400]}
                  />
                </View>
                <Text style={s.ringUnit}>{fluidUnit}</Text>
                <Text style={s.ringSub}>of {targetDisplay} {fluidUnit}</Text>
              </View>
            </View>

            <Text style={s.helper}>
              {overTarget
                ? `You hit your target. Keep going if you're thirsty — extra fluid is fine when activity or heat ramps up.`
                : remainingMl > 0
                  ? `${fmtVolume(remainingMl, fluidUnit)} ${fluidUnit} to go today. Steady sips through the day beats chugging it all at once.`
                  : `Log your first sip to start the day.`}
            </Text>
            <Text style={s.attribution}>{targetAttribution}</Text>

            {/* Quick-add chips */}
            <View style={s.chipsRow}>
              {chips.map(amt => (
                <Pressable
                  key={amt}
                  onPress={() => addAmount(amt)}
                  style={({ pressed }) => [s.chip, pressed && s.chipPressed]}
                >
                  <Text style={s.chipValue}>+{amt}</Text>
                  <Text style={s.chipUnit}>{fluidUnit}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </AnimateRise>

        {/* ── 7-day chart ── */}
        <AnimateRise delay={250}>
          <View style={s.card}>
            <Text style={s.chartHeading}>
              Last 7 days <Text style={s.chartHeadingMuted}>({fluidUnit})</Text>
            </Text>
            {/* Width measured by parent; we lock the Skia canvas to a fixed
                width matching the card's inner area. Container clips,
                so 320 is safe on every supported phone width. */}
            <View style={s.chartInner}>
              <BarChart
                buckets={sevenDayBuckets.map(b => ({
                  ...b,
                  // Bar value uses the same canonical mL; the chart converts
                  // the tick labels to display unit via fmtVolume.
                }))}
                targetMl={targetMl}
                displayUnit={fluidUnit}
                width={320}
                height={170}
              />
            </View>
            <Text style={s.chartCaption}>Dashed line = daily target</Text>
          </View>
        </AnimateRise>

        {/* ── Today's log list ── */}
        {todayLogs.length > 0 && (
          <AnimateRise delay={500}>
            <View style={s.logCard}>
              <View style={s.logHeader}>
                <Text style={s.logHeaderText}>Today's log</Text>
                <Text style={s.logHeaderCount}>
                  {todayLogs.length} {todayLogs.length === 1 ? 'entry' : 'entries'}
                </Text>
              </View>
              <View>
                {todayLogs.map((l, idx) => {
                  const ml = Number(l.amount_ml)
                  const display = fmtVolume(ml, fluidUnit)
                  const time = new Date(l.logged_at).toLocaleTimeString(undefined, {
                    hour: 'numeric', minute: '2-digit',
                  })
                  return (
                    <View key={l.id} style={idx > 0 ? s.logRowDivider : null}>
                      <DeleteAction onDelete={() => deleteEntry(l.id)}>
                        <View style={s.logRow}>
                          <View style={s.logRowLeft}>
                            <View style={s.tag}>
                              <Text style={s.tagText}>Water</Text>
                            </View>
                            <Text style={s.logDate} numberOfLines={1}>{time}</Text>
                          </View>
                          <Text style={s.logAmount}>{display} {fluidUnit}</Text>
                        </View>
                      </DeleteAction>
                    </View>
                  )
                })}
              </View>
            </View>
          </AnimateRise>
        )}
      </View>
    </ScrollView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Chart-local label styles (RN Text overlays above the Skia canvas).
const chartStyles = StyleSheet.create({
  yTickLabel: {
    position:   'absolute',
    fontSize:   9,
    color:      colors.mutedForeground,
    textAlign:  'right',
    fontFamily: fonts.mono[500],
  },
  dayLabel: {
    position:  'absolute',
    fontSize:  10,
    color:     colors.mutedForeground,
    textAlign: 'center',
  },
})

const s = StyleSheet.create({
  scroll:    { paddingBottom: 24 },
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 20, maxWidth: 672, alignSelf: 'center', width: '100%' },

  // Header
  h1:  { fontSize: 20, fontWeight: '600', color: colors.foreground, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: colors.mutedForeground, marginTop: 2 },

  // TEMP — Aquos animation spike entry (remove with the spike)
  spikeCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: withAlpha(palette.myrx.lime, 0.4),
    borderRadius: 12,
    padding: 12,
    gap: 8,
    backgroundColor: withAlpha(palette.myrx.lime, 0.05),
  },
  spikeLabel: { fontSize: 11, fontFamily: fonts.sans[700], color: palette.myrx.lime, textTransform: 'uppercase', letterSpacing: 1 },
  spikeRow: { flexDirection: 'row', gap: 10 },
  spikeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: withAlpha(palette.myrx.lime, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(palette.myrx.lime, 0.3),
  },
  spikeBtnText: { fontSize: 13, fontFamily: fonts.sans[700], color: colors.foreground },

  // Card chrome — matches bodyweight / dashboard
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    gap: 14,
  },

  // Progress ring
  ringWrap:    { alignItems: 'center', justifyContent: 'center', height: 200, position: 'relative' },
  ringCenter:  { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringValueRow:{ flexDirection: 'row', alignItems: 'flex-end' },
  ringUnit:    { fontSize: 12, color: colors.mutedForeground, marginTop: 2, letterSpacing: 0.4 },
  ringSub:     { fontSize: 12, color: colors.mutedForeground, marginTop: 6 },

  helper:        { fontSize: 13, color: colors.foreground, lineHeight: 18, textAlign: 'center' },
  attribution:   { fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },

  // Quick-add chips
  chipsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  chip: {
    flex: 1,
    backgroundColor: withAlpha(palette.cyan[500], 0.10),
    borderColor: withAlpha(palette.cyan[500], 0.40),
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  chipPressed: { opacity: 0.65 },
  chipValue:   { fontSize: 18, fontWeight: '700', color: palette.cyan[400], fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  chipUnit:    { fontSize: 11, color: colors.mutedForeground, letterSpacing: 0.4 },

  // Chart
  chartHeading:      { fontSize: 14, fontWeight: '600', color: colors.foreground },
  chartHeadingMuted: { fontWeight: '400', color: colors.mutedForeground },
  chartInner:        { alignItems: 'center' },
  chartCaption:      { fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },

  // Log list — mirrors bodyweight log card chrome
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logHeaderText:  { fontSize: 14, fontWeight: '600', color: colors.foreground },
  logHeaderCount: { fontSize: 12, color: colors.mutedForeground },

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
    backgroundColor: withAlpha(palette.cyan[500], 0.12),
    flexShrink: 0,
  },
  tagText:   { fontSize: 10, fontWeight: '500', color: palette.cyan[400] },
  logDate:   { fontSize: 14, color: colors.mutedForeground, flex: 1 },
  logAmount: { fontFamily: fonts.mono[500], fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '500', color: colors.foreground, flexShrink: 0 },
})
