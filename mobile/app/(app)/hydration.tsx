/**
 * Hydration — daily water-intake tracker.
 * Skia-migrated 2026-05-31 — see Pattern 9 in CLAUDE.md.
 *
 * Layout (top-to-bottom):
 *   1. Header — "Hydration" h1 + today's date subtext.
 *   2. Today's progress card (AnimateRise delay 0)
 *      ├─ HydrationPet (day/night PixelScene + pace-aware pixel-slime mascot
 *      │  whose pond rises with progress), a friendly "cups" readout (tap →
 *      │  exact mL), and the drink picker (type + size).
 *      └─ Eligibility note + bodyweight-based attribution footer.
 *   3. 7-day chart (AnimateRise delay 250) — Skia bar chart with dashed target line.
 *   4. Today's log list (AnimateRise delay 500) — DeleteAction tap-confirm per row.
 *
 * Storage model:
 *   – water_logs.amount_ml is the RAW volume drunk (always mL).
 *   – water_logs.drink_type tags the beverage; effective hydration =
 *     amount_ml × Beverage-Hydration-Index multiplier (water / sparkling /
 *     coffee / tea / soda = 1.0, milk = 1.5). Progress = effective mL.
 *   – profiles.fluid_unit controls display: 'oz' (default) or 'mL'.
 *
 * Target derivation:
 *   – Daily target = current_weight × 35 mL/kg, from the latest logged
 *     bodyweight (falls back to profiles.current_weight, then a sex estimate).
 *
 * Rendering — GPU-backed via @shopify/react-native-skia. The mascot scene
 * (HydrationPet) and the 7-day chart each paint inside Skia <Canvas>es. Text
 * labels (axis ticks, day labels) remain absolute-positioned RN <Text>
 * overlays above the canvas per Pattern 9. See HrRangeChart.tsx +
 * LineChart.tsx for the two most-relevant reference implementations.
 *
 * NOTE (v1 scope): Wearable hydration integration (Samsung Health
 * DataTypes.HYDRATION, Apple HealthKit dietaryWater, etc.) is OUT OF SCOPE.
 * Manual entry only.
 */

import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Modal } from 'react-native'
import {
  Canvas, Path, Group, Skia, DashPathEffect, type SkPath,
} from '@shopify/react-native-skia'
import HydrationPet from '../../src/components/HydrationPet'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { dataCache } from '../../src/lib/cache'
import AnimateRise from '../../src/components/AnimateRise'
import DeleteAction from '../../src/components/DeleteAction'
import TickerNumber from '../../src/components/TickerNumber'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'
import { GlassWater, Droplets, Coffee, Leaf, CupSoda, Milk, ChevronLeft, type LucideIcon } from 'lucide-react-native'
import PhantomWheel from '../../src/components/PhantomWheel'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

// ── Volume helpers ───────────────────────────────────────────────────────────
// Canonical conversion constants. All math stays in mL internally; we only
// switch to oz/mL at display + chip-tap time.
const ML_PER_OZ = 29.5735
const LB_TO_KG = 0.45359237
// Daily drinking-water target: 35 mL per kg of bodyweight at rest — the
// evidence-based standard endorsed by the U.S. National Academies (IOM) and
// Mayo Clinic (Vivanti, Eur J Clin Nutr 2012). Cross-checks against the
// National Academies (3.7 L men / 2.7 L women total water) and EFSA
// (2.5 / 2.0 L) after backing out the ~20% of water that comes from food.
const ML_PER_KG_TARGET = 35

function ozToMl(oz: number): number { return oz * ML_PER_OZ }
function mlToOz(ml: number): number { return ml / ML_PER_OZ }

/** Render `ml` in the user's display unit, rounded sensibly. */
function fmtVolume(ml: number, unit: 'oz' | 'mL'): string {
  if (unit === 'mL') return String(Math.round(ml))
  // For oz we round to whole numbers (chip values are integers, accumulation
  // stays close to integer with the standard chip sizes).
  return String(Math.round(mlToOz(ml)))
}

/** Convert a bodyweight reading to kg (rows store weight in their own unit). */
function toKg(weight: number, unit: string | null | undefined): number {
  return unit === 'lb' ? weight * LB_TO_KG : weight
}
/** No logged weight — fall back to population beverage targets (National Academies). */
function defaultTargetMl(gender: string | null | undefined): number {
  if (gender === 'male') return 3000
  if (gender === 'female') return 2200
  return 2500
}

// ── Drink registry — eligible beverages + Beverage-Hydration-Index multipliers.
// Only no/low-calorie, non-alcoholic drinks (+ milk) are offered, so the picker
// itself enforces eligibility (T054). Multipliers from Maughan et al. 2016
// (AJCN): water / sparkling / coffee / tea / diet-soda hydrate ~like water
// (1.0); milk's protein + fat + salts make it linger → 1.5.
type DrinkType = 'water' | 'sparkling' | 'coffee' | 'tea' | 'soda' | 'milk'
interface DrinkMeta { type: DrinkType; label: string; multiplier: number; Icon: LucideIcon; color: string }
const DRINKS: DrinkMeta[] = [
  { type: 'water',     label: 'Water',     multiplier: 1.0, Icon: GlassWater, color: palette.cyan[400] },
  { type: 'sparkling', label: 'Sparkling', multiplier: 1.0, Icon: Droplets,   color: palette.sky[400] },
  { type: 'coffee',    label: 'Coffee',    multiplier: 1.0, Icon: Coffee,     color: palette.amber[400] },
  { type: 'tea',       label: 'Tea',       multiplier: 1.0, Icon: Leaf,       color: palette.emerald[400] },
  { type: 'soda',      label: 'Diet soda', multiplier: 1.0, Icon: CupSoda,    color: palette.violet[400] },
  { type: 'milk',      label: 'Milk',      multiplier: 1.5, Icon: Milk,       color: palette.blue[300] },
]
const DRINK_BY_TYPE = DRINKS.reduce((m, d) => { m[d.type] = d; return m }, {} as Record<DrinkType, DrinkMeta>)
function multiplierFor(t: string): number { return DRINK_BY_TYPE[t as DrinkType]?.multiplier ?? 1 }

// One realistic shared size set for every drink (mL or oz), plus a Custom wheel.
const SIZES_ML = [250, 350, 500]
const SIZES_OZ = [8, 12, 16]

// ── DB row ───────────────────────────────────────────────────────────────────

interface WaterLog {
  id:         string
  user_id:    string
  amount_ml:  number
  drink_type: string
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
  const sizes                  = fluidUnit === 'mL' ? SIZES_ML : SIZES_OZ

  // Latest logged bodyweight drives the target (falls back to the profile
  // weight, then a sex-based estimate). Fetched once per user.
  const [bwKg, setBwKg] = useState<number | null>(null)
  useEffect(() => {
    if (!user) return
    supabase
      .from('bodyweight')
      .select('weight, unit, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const row = (data as { weight: number; unit: string | null }[] | null)?.[0]
        if (row?.weight) setBwKg(toKg(Number(row.weight), row.unit))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const targetMl = useMemo(() => {
    const profileKg = (profile as any)?.current_weight
      ? toKg(Number((profile as any).current_weight), (profile as any).weight_unit)
      : null
    const kg = bwKg ?? profileKg
    if (kg && kg > 0) return Math.round(kg * ML_PER_KG_TARGET)
    return defaultTargetMl((profile as any)?.gender)
  }, [bwKg, profile])

  // Last-7-days window (today inclusive). We fetch in one shot and bucket
  // client-side so today's "current" total and the 7-day chart share data.
  const sevenDaysAgo = useMemo(() => {
    const s = startOfDay(new Date())
    s.setDate(s.getDate() - 6) // include today + 6 prior days
    return s
  }, [])

  const cacheKey = user ? `hydration:${user.id}` : null
  const [logs, setLogs] = useState<WaterLog[]>(() => (cacheKey ? dataCache.get<WaterLog[]>(cacheKey) ?? [] : []))
  const [drinks, setDrinks] = useState(0)   // bumps on each log → drives the pet's drink reaction

  // Picker state — selected drink type, the Custom-amount wheel, and the
  // cups↔exact readout toggle.
  const [selType, setSelType]       = useState<DrinkType | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customVal, setCustomVal]   = useState(fluidUnit === 'mL' ? 300 : 10)
  const [showExact, setShowExact]   = useState(false)

  // Keep the custom-amount default sensible for the active unit.
  useEffect(() => { setCustomVal(fluidUnit === 'mL' ? 300 : 10) }, [fluidUnit])

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

  // Effective hydration = sum(raw mL × BHI multiplier). Milk over-counts 1.5×.
  const todayEffectiveMl = useMemo(() => {
    return logs
      .filter(l => dateKey(new Date(l.logged_at)) === todayKey)
      .reduce((s, l) => s + Number(l.amount_ml) * multiplierFor(l.drink_type), 0)
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
      if (idx != null) out[idx].ml += Number(l.amount_ml) * multiplierFor(l.drink_type)
    }
    return out
  }, [logs])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function addDrink(type: DrinkType, displayAmount: number) {
    if (!user) return
    setDrinks(d => d + 1)   // pet plays Eat + a hop
    const amountMl = fluidUnit === 'mL' ? displayAmount : ozToMl(displayAmount)
    // Optimistic insert with a temporary id so the pet + chart move instantly.
    const tempId = `temp-${Date.now()}`
    const optimistic: WaterLog = {
      id: tempId,
      user_id: user.id,
      amount_ml: amountMl,
      drink_type: type,
      logged_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const optimisticLogs = [optimistic, ...logs]
    setLogs(optimisticLogs)

    const { data, error } = await supabase
      .from('water_logs')
      .insert({ user_id: user.id, amount_ml: amountMl, drink_type: type })
      .select()
      .single()

    if (error || !data) {
      // Roll back optimistic insert on failure — the chip stays for retry.
      setLogs(logs)
      return
    }
    const reconciled = optimisticLogs.map(l => (l.id === tempId ? (data as WaterLog) : l))
    setLogs(reconciled)
    if (cacheKey) dataCache.set(cacheKey, reconciled)
  }

  // Pick a size from the size view → log it, then return to the type grid.
  function logSize(sz: number) {
    if (selType) addDrink(selType, sz)
    setSelType(null)
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
  const remainingMl = Math.max(0, targetMl - todayEffectiveMl)
  const overTarget  = todayEffectiveMl >= targetMl
  // Friendly "cups" readout — a cup ≈ 250 mL of effective hydration. Tap the
  // readout to flip to the exact effective-vs-target volume (T056).
  const cupsTarget  = Math.max(1, Math.round(targetMl / 250))
  const cupsDone    = Math.round(todayEffectiveMl / 250)

  // Selected drink (size-picker state) — null = show the type grid.
  const selMeta = selType ? DRINK_BY_TYPE[selType] : null
  const SelIcon = selMeta?.Icon ?? null

  const hasWeight = bwKg != null || ((profile as any)?.current_weight ?? 0) > 0
  // Unit-free, source-names-first — matches the strength/cardio attribution
  // format ("Epley · Brzycki · ..."). The 35 mL/kg science lives in the
  // ML_PER_KG_TARGET comment above, not in this line, so it never clashes with
  // the user's oz/mL setting.
  const targetAttribution = hasWeight
    ? `National Academies · Mayo Clinic · EFSA · by bodyweight`
    : `National Academies · EFSA · sex-based estimate`

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.container}>

        {/* ── Header ── */}
        <View>
          <Text style={s.h1}>Hydration</Text>
          <Text style={s.sub}>Track your water intake and reach your daily goal.</Text>
        </View>

        {/* ── Today's progress + quick-add chips ── */}
        <AnimateRise delay={0}>
          <View style={s.card}>
            {/* Hydration mascot — the day/night scene + pace-aware pet,
                replaces the old daily-total ring */}
            <HydrationPet todayMl={todayEffectiveMl} targetMl={targetMl} drinkNonce={drinks} />
            <Pressable style={s.petStats} onPress={() => setShowExact(v => !v)}>
              {showExact ? (
                <>
                  <TickerNumber value={fmtVolume(todayEffectiveMl, fluidUnit)} fontSize={30} fontWeight="700" color={palette.cyan[400]} />
                  <Text style={s.petStatsSub}>of {fmtVolume(targetMl, fluidUnit)} {fluidUnit}</Text>
                </>
              ) : (
                <>
                  <TickerNumber value={String(cupsDone)} fontSize={30} fontWeight="700" color={palette.cyan[400]} />
                  <Text style={s.petStatsSub}>of {cupsTarget} cups</Text>
                </>
              )}
            </Pressable>

            <Text style={s.helper}>
              {overTarget
                ? `You hit your target. Keep going if you're thirsty — extra fluid is fine when activity or heat ramps up.`
                : remainingMl > 0
                  ? `${fmtVolume(remainingMl, fluidUnit)} ${fluidUnit} to go today. Steady sips through the day beats chugging it all at once.`
                  : `Log your first sip to start the day.`}
            </Text>

            {/* Drink picker — pick a type, then it's REPLACED by that drink's
                sizes (tap ‹ to choose a different drink). No expansion (T061). */}
            <View style={s.pickerWrap}>
              {selType === null ? (
                <View style={s.typeRow}>
                  {DRINKS.map(d => {
                    const Icon = d.Icon
                    return (
                      <Pressable
                        key={d.type}
                        onPress={() => setSelType(d.type)}
                        style={({ pressed }) => [s.typeTile, pressed && s.chipPressed]}
                      >
                        <Icon size={20} color={d.color} />
                        <Text style={s.typeLabel} numberOfLines={1}>{d.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : (
                <View style={s.sizeWrap}>
                  <Pressable onPress={() => setSelType(null)} style={({ pressed }) => [s.sizeHeader, pressed && s.chipPressed]}>
                    <ChevronLeft size={18} color={colors.mutedForeground} />
                    {SelIcon && <SelIcon size={18} color={selMeta?.color} />}
                    <Text style={s.sizeHeaderText}>{selMeta?.label}</Text>
                    <Text style={s.sizeHeaderHint}>Change drink</Text>
                  </Pressable>
                  <View style={s.sizeRow}>
                    {sizes.map(sz => (
                      <Pressable
                        key={sz}
                        onPress={() => logSize(sz)}
                        style={({ pressed }) => [s.sizeChip, pressed && s.chipPressed]}
                      >
                        <Text style={s.sizeChipText}>{sz}</Text>
                        <Text style={s.sizeChipUnit}>{fluidUnit}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => setCustomOpen(true)}
                      style={({ pressed }) => [s.sizeChip, s.sizeChipAlt, pressed && s.chipPressed]}
                    >
                      <Text style={s.sizeChipAltText}>Custom</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Eligibility note (T054) — what counts, plain-language. */}
              <Text style={s.eligNote}>
                Only no- and low-calorie, non-alcoholic drinks count toward hydration — milk included.
              </Text>
            </View>

            {/* Science attribution — matches the tinyText footer credit used on
                the strength / cardio detail pages (left-aligned, muted, 11px). */}
            <Text style={s.attribution}>{targetAttribution}</Text>
          </View>
        </AnimateRise>

        {/* Custom-amount sheet — the existing PhantomWheel for an exact volume */}
        <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
          {/* GestureHandlerRootView is required INSIDE the modal so the
              PhantomWheel's Pan works on Android (modals render in a separate
              view hierarchy that the app-root GH provider doesn't reach). */}
          <GestureHandlerRootView style={{ flex: 1 }}>
          <Pressable style={s.modalBackdrop} onPress={() => setCustomOpen(false)}>
            <Pressable style={s.modalSheet} onPress={() => {}}>
              <Text style={s.modalTitle}>
                Custom amount{selType ? ` · ${DRINK_BY_TYPE[selType].label}` : ''}
              </Text>
              <PhantomWheel
                value={customVal}
                onChange={setCustomVal}
                step={fluidUnit === 'mL' ? 25 : 1}
                min={0}
                max={fluidUnit === 'mL' ? 2000 : 64}
                unit={` ${fluidUnit}`}
              />
              <Pressable
                onPress={() => { if (selType && customVal > 0) addDrink(selType, customVal); setCustomOpen(false); setSelType(null) }}
                style={({ pressed }) => [s.modalLogBtn, pressed && s.chipPressed]}
              >
                <Text style={s.modalLogText}>Log drink</Text>
              </Pressable>
            </Pressable>
          </Pressable>
          </GestureHandlerRootView>
        </Modal>

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
                  const meta = DRINK_BY_TYPE[(l.drink_type as DrinkType)] ?? DRINK_BY_TYPE.water
                  const Icon = meta.Icon
                  const display = fmtVolume(Number(l.amount_ml), fluidUnit)
                  const time = new Date(l.logged_at).toLocaleTimeString(undefined, {
                    hour: 'numeric', minute: '2-digit',
                  })
                  return (
                    <View key={l.id} style={idx > 0 ? s.logRowDivider : null}>
                      <DeleteAction onDelete={() => deleteEntry(l.id)}>
                        <View style={s.logRow}>
                          <View style={s.logRowLeft}>
                            <Icon size={16} color={meta.color} />
                            <Text style={s.logName} numberOfLines={1}>{meta.label}</Text>
                            {meta.multiplier !== 1 && (
                              <View style={s.multBadge}>
                                <Text style={s.multBadgeText}>×{meta.multiplier}</Text>
                              </View>
                            )}
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

  petStats: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  petStatsSub: { color: colors.mutedForeground, fontSize: 14, fontFamily: fonts.sans[500], paddingBottom: 4 },

  // Card chrome — matches bodyweight / dashboard
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    gap: 14,
  },

  helper:        { fontSize: 13, color: colors.foreground, lineHeight: 18, textAlign: 'center' },
  attribution:   { fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },

  // Quick-add chips
  chipsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  drinkBtn: {
    flex: 1,
    backgroundColor: withAlpha(palette.cyan[500], 0.10),
    borderColor: withAlpha(palette.cyan[500], 0.40),
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 3,
  },
  chipPressed: { opacity: 0.65 },
  drinkLabel:  { fontSize: 15, color: colors.foreground, fontFamily: fonts.sans[700] },
  drinkValue:  { fontSize: 13, color: palette.cyan[400], fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },

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

  // Drink picker
  pickerWrap: { gap: 10 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  typeTile: {
    width: '31%',
    minWidth: 92,
    backgroundColor: withAlpha(palette.cyan[500], 0.06),
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  typeTileActive: { backgroundColor: withAlpha(palette.cyan[500], 0.14), borderColor: withAlpha(palette.cyan[500], 0.5) },
  typeLabel:       { fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.sans[600] },
  typeLabelActive: { color: colors.foreground },

  sizeWrap:        { gap: 10 },
  sizeHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  sizeHeaderText:  { fontSize: 15, color: colors.foreground, fontFamily: fonts.sans[700] },
  sizeHeaderHint:  { fontSize: 12, color: colors.mutedForeground, marginLeft: 'auto' },
  sizeRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 2 },
  sizeChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: withAlpha(palette.cyan[500], 0.10),
    borderColor: withAlpha(palette.cyan[500], 0.4),
    borderWidth: 1,
  },
  sizeChipText:    { fontSize: 16, color: colors.foreground, fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  sizeChipUnit:    { fontSize: 12, color: palette.cyan[400], fontFamily: fonts.sans[500] },
  sizeChipAlt:     { backgroundColor: 'transparent', borderColor: colors.border },
  sizeChipAltText: { fontSize: 14, color: colors.mutedForeground, fontFamily: fonts.sans[600] },

  eligNote: { fontSize: 11, color: colors.mutedForeground, lineHeight: 15, textAlign: 'center' },

  // Custom-amount modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalSheet:    { width: '100%', maxWidth: 340, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 20, gap: 14, alignItems: 'center' },
  modalTitle:    { fontSize: 15, color: colors.foreground, fontFamily: fonts.sans[700] },
  modalLogBtn:   { alignSelf: 'stretch', backgroundColor: palette.cyan[500], borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalLogText:  { fontSize: 15, color: colors.background, fontFamily: fonts.sans[700] },

  // Log-row additions
  logName:       { fontSize: 14, color: colors.foreground, fontFamily: fonts.sans[600], flexShrink: 1 },
  multBadge:     { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 9999, backgroundColor: withAlpha(palette.blue[400], 0.15), flexShrink: 0 },
  multBadgeText: { fontSize: 10, color: palette.blue[300], fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
})
