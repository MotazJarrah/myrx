/**
 * Calories — port of MyRX/src/pages/Calories.jsx to React Native.
 *
 * Sections (in render order):
 *   1. Header
 *   2. CalorieStrip (always visible)
 *   3. If no plan/incomplete profile: TodayIntakeCard + pending/missing notice
 *   4. If plan: Daily target hero (BMR/TDEE/Energy pills + dynamic explanation)
 *   5.        Macros (bar + 3-chip grid)
 *   6.        Per-meal breakdown (2-6 meals)
 *   7.        TodayIntakeCard (with target + macro bars)
 *   8.        Timeline (recomp / mismatch / standard)
 *   9.        Current weight goal (start/current/goal + progress bar + dynamic message)
 *  10. FoodLogDrawer (when drawerDay set)
 *
 * Mirrors web's combined fetch — plan + latest BW + 14 days of food_logs in one
 * Promise.all call on mount and on `stripRefreshKey` bump.
 */

import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { Link } from 'expo-router'
import {
  Flame, Clock, TrendingDown, TrendingUp, Utensils,
  X, Plus, UtensilsCrossed, ChevronRight,
} from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import {
  calcFullPlan, calcPerMeal, calcAge,
  getMissingPlanFields,
  ACTIVITY_FACTORS,
  type CaloriePlan, type FullPlanResult, type PerMealBreakdown,
} from '../../src/lib/calorieFormulas'
import CalorieStrip from '../../src/components/CalorieStrip'
import FoodLogDrawer from '../../src/components/FoodLogDrawer'
import type { MealSlot } from '../../src/components/FoodLogDrawer'
import TickerNumber from '../../src/components/TickerNumber'
import AnimateRise from '../../src/components/AnimateRise'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, fonts } from '../../src/theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fromKg(kg: number, unit: string): number {
  return unit === 'lb' ? kg / 0.453592 : kg
}
function fmtWeight(kg: number, unit: string): string {
  return `${fromKg(kg, unit).toFixed(1)} ${unit}`
}

function getEnergyLabel(pct: number): string {
  if (pct <= -40) return 'Aggressive fat loss'
  if (pct <= -25) return 'High fat loss'
  if (pct <= -15) return 'Moderate fat loss'
  if (pct <=  -5) return 'Gradual fat loss'
  if (pct <    5) return 'Maintenance'
  if (pct <   15) return 'Gradual muscle gain'
  if (pct <   25) return 'Moderate muscle gain'
  if (pct <   40) return 'High muscle gain'
  return 'Aggressive bulk'
}

// ── Food log entry shape (mirrors food_logs row used here) ───────────────────

interface CalorieFoodEntry {
  id:         string
  log_date:   string
  meal_slot:  string
  food_name:  string
  calories:   number
  protein_g:  number
  fat_g:      number
  carbs_g:    number
}

interface BWRow { weight: number; unit: string }

// ── MacroBar ─────────────────────────────────────────────────────────────────

function MacroBar({ protein, fat, carbs }: { protein: number; fat: number; carbs: number }) {
  const total = protein + fat + carbs
  if (total === 0) return null
  return (
    <View style={s.macroBar}>
      <View style={[{ width: `${(protein / total) * 100}%` as any, backgroundColor: palette.blue[400], height: '100%' }]} />
      <View style={[{ width: `${(fat     / total) * 100}%` as any, backgroundColor: palette.amber[400], height: '100%' }]} />
      <View style={[{ width: `${(carbs   / total) * 100}%` as any, backgroundColor: palette.emerald[400], height: '100%' }]} />
    </View>
  )
}

// ── MacroChip ────────────────────────────────────────────────────────────────

function MacroChip({
  label, grams, pct, kcal, color, bgColor, borderColor,
}: { label: string; grams: number; pct: number; kcal: number; color: string; bgColor: string; borderColor: string }) {
  return (
    <View style={[s.macroChip, { backgroundColor: bgColor, borderColor }]}>
      <View style={s.macroChipNumRow}>
        <TickerNumber value={grams} fontSize={24} fontWeight="700" color={color} />
        <Text style={[s.macroChipUnit, { color }]}>g</Text>
      </View>
      <Text style={s.macroChipLabel}>{label}</Text>
      <Text style={s.macroChipFooter}>{kcal} kcal · {pct}%</Text>
    </View>
  )
}

// ── TodayIntakeCard ──────────────────────────────────────────────────────────

interface MacroTargets { protein: number; fat: number; carbs: number }

function TodayIntakeCard({
  entries, dailyTarget, macroTargets, onLogFood,
}: {
  entries:      CalorieFoodEntry[]
  dailyTarget:  number | null
  macroTargets: MacroTargets | null
  onLogFood:    () => void
}) {
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  )

  const hasData    = totals.calories > 0
  const target     = dailyTarget ?? 0
  const remaining  = target - Math.round(totals.calories)
  const isOver     = remaining < 0

  const proteinKcal = totals.protein * 4
  const fatKcal     = totals.fat     * 9
  const carbsKcal   = totals.carbs   * 4
  const totalKcal   = proteinKcal + fatKcal + carbsKcal

  const trackKcal = target > 0 ? Math.max(target, totalKcal) : totalKcal || 300
  const pWidth    = totalKcal > 0 ? (proteinKcal / trackKcal) * 100 : 0
  const fWidth    = totalKcal > 0 ? (fatKcal     / trackKcal) * 100 : 0
  const cWidth    = totalKcal > 0 ? (carbsKcal   / trackKcal) * 100 : 0
  const targetPct = target > 0 && trackKcal > 0 ? (target / trackKcal) * 100 : 100

  return (
    <AnimateRise>
      <View style={s.cardLg}>
        <View style={s.intakeHeader}>
          <Text style={s.cardHeading}>Today's Intake</Text>
          <Pressable onPress={onLogFood} style={s.logFoodBtn}>
            <Plus size={12} color={palette.red[400]} />
            <Text style={s.logFoodBtnText}>Log food</Text>
          </Pressable>
        </View>

        {hasData ? (
          <>
            <View style={s.intakeBigRow}>
              <View>
                <View style={s.intakeBigNumRow}>
                  <Text style={s.intakeBigNumber}>{Math.round(totals.calories).toLocaleString()}</Text>
                  <Text style={s.intakeBigUnit}>kcal</Text>
                </View>
                {target > 0 && (
                  <Text style={s.intakeBigSub}>of {target.toLocaleString()} kcal target</Text>
                )}
              </View>
              {target > 0 && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.intakeRemainNum, { color: isOver ? palette.red[400] : palette.emerald[400] }]}>
                    {isOver ? '+' : ''}{Math.abs(remaining).toLocaleString()}
                  </Text>
                  <Text style={s.intakeRemainSub}>{isOver ? 'over target' : 'remaining'}</Text>
                </View>
              )}
            </View>

            {target > 0 && (
              <View style={{ gap: 6 }}>
                <View style={s.intakeSegBar}>
                  <View style={[s.intakeSeg, { left: '0%', width: `${pWidth}%` as any, backgroundColor: alpha(palette.blue[400], 0.80), borderTopLeftRadius: 9999, borderBottomLeftRadius: 9999 }]} />
                  <View style={[s.intakeSeg, { left: `${pWidth}%` as any, width: `${fWidth}%` as any, backgroundColor: alpha(palette.amber[400], 0.80) }]} />
                  <View style={[s.intakeSeg, { left: `${pWidth + fWidth}%` as any, width: `${cWidth}%` as any, backgroundColor: alpha(palette.emerald[400], 0.80) }]} />
                  <View style={[s.intakeNeedle, { left: `${targetPct}%` as any }]} />
                </View>
                <View style={s.intakeMacroLabels}>
                  <MacroLegend color={palette.blue[400]}    label={`P ${Math.round(totals.protein)}g`} />
                  <MacroLegend color={palette.amber[400]}   label={`F ${Math.round(totals.fat)}g`} />
                  <MacroLegend color={palette.emerald[400]} label={`C ${Math.round(totals.carbs)}g`} />
                </View>
              </View>
            )}

            {macroTargets && (
              <View style={s.intakeChipsGrid}>
                {[
                  { label: 'Protein', val: totals.protein, target: macroTargets.protein, color: palette.blue[400],    bar: palette.blue[400],    bg: 'rgba(59,130,246,0.05)',  border: 'rgba(59,130,246,0.20)'  },
                  { label: 'Fat',     val: totals.fat,     target: macroTargets.fat,     color: palette.amber[400],   bar: palette.amber[400],   bg: 'rgba(245,158,11,0.05)',  border: 'rgba(245,158,11,0.20)'  },
                  { label: 'Carbs',   val: totals.carbs,   target: macroTargets.carbs,   color: palette.emerald[400], bar: palette.emerald[400], bg: 'rgba(16,185,129,0.05)',  border: 'rgba(16,185,129,0.20)'  },
                ].map(({ label, val, target: t, color, bar, bg, border }) => {
                  const pct     = t > 0 ? Math.round((val / t) * 100) : null
                  const isOvr   = t > 0 && val > t
                  const fillPct = t > 0 ? Math.min(100, (val / t) * 100) : 0
                  const ovrPct  = isOvr ? Math.min(100, ((val - t) / t) * 100) : 0
                  return (
                    <View key={label} style={[s.intakeChip, { backgroundColor: bg, borderColor: border }]}>
                      <View style={s.intakeChipTopRow}>
                        <Text style={[s.intakeChipNum, { color }]}>{Math.round(val)}</Text>
                        <Text style={[s.intakeChipUnit, { color }]}>g</Text>
                      </View>
                      <Text style={s.intakeChipLabel}>{label}</Text>
                      {t > 0 && (
                        <>
                          <View style={s.intakeChipBarTrack}>
                            <View style={[s.intakeChipBarFill, { width: `${fillPct}%` as any, backgroundColor: bar }]} />
                            {isOvr && (
                              <View style={[s.intakeChipBarFill, { left: `${fillPct}%` as any, width: `${ovrPct}%` as any, backgroundColor: palette.red[400] }]} />
                            )}
                          </View>
                          <Text style={[s.intakeChipFooter, { color: isOvr ? palette.red[400] : alpha(colors.mutedForeground, 0.60) }]}>
                            /{Math.round(t)}g · {pct}%
                          </Text>
                        </>
                      )}
                    </View>
                  )
                })}
              </View>
            )}
          </>
        ) : (
          <View style={s.intakeEmpty}>
            <View style={s.intakeEmptyIconWrap}>
              <UtensilsCrossed size={20} color={alpha(colors.mutedForeground, 0.50)} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={s.intakeEmptyTitle}>Nothing logged yet today</Text>
              <Text style={s.intakeEmptyHint}>Tap "Log food" to start tracking your intake</Text>
            </View>
          </View>
        )}
      </View>
    </AnimateRise>
  )
}

function MacroLegend({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.macroLegendItem}>
      <View style={[s.macroLegendDot, { backgroundColor: alpha(color, 0.80) }]} />
      <Text style={s.macroLegendLabel}>{label}</Text>
    </View>
  )
}

// ── PendingView ──────────────────────────────────────────────────────────────

function PendingView() {
  return (
    <View style={s.pendingWrap}>
      <View style={s.pendingIcon}>
        <Clock size={32} color={palette.amber[400]} />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={s.pendingTitle}>Your plan is on its way</Text>
        <Text style={s.pendingMsg}>
          Your personalised calorie plan is being prepared. Check back soon — it'll be ready before you know it.
        </Text>
      </View>
    </View>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Calories() {
  const { user, profile, refreshProfile } = useAuth()
  const [plan, setPlan]         = useState<CaloriePlan | null>(null)
  const [loading, setLoading]   = useState(true)
  const [meals, setMealsState]  = useState<number | null>(null)
  const [activePill, setActivePill] = useState<'bmr' | 'tdee' | 'energy' | null>(null)
  const [latestBW, setLatestBW] = useState<BWRow | null>(null)

  const [drawerDay, setDrawerDay]             = useState<string | null>(null)
  const [stripRefreshKey, setStripRefreshKey] = useState(0)
  const [todayEntries, setTodayEntries]       = useState<CalorieFoodEntry[]>([])
  const [logsMap, setLogsMap]                 = useState<Record<string, { calories: number }>>({})

  const TODAY = isoToday()

  useEffect(() => {
    if (!user) return
    const fromIso = (() => {
      const d = new Date(); d.setDate(d.getDate() - 13)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()

    Promise.all([
      supabase.from('calorie_plans').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('bodyweight').select('weight, unit').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('food_logs')
        .select('id, log_date, meal_slot, food_name, calories, protein_g, fat_g, carbs_g')
        .eq('user_id', user.id).gte('log_date', fromIso),
    ]).then(([planRes, bwRes, logsRes]) => {
      const planData = (planRes.data ?? null) as CaloriePlan | null
      setPlan(planData)
      setMealsState(planData?.meals ?? null)
      if (bwRes.data) setLatestBW(bwRes.data as BWRow)

      const allLogs = (logsRes.data ?? []) as CalorieFoodEntry[]
      setTodayEntries(allLogs.filter(e => e.log_date === TODAY))

      const map: Record<string, { calories: number }> = {}
      allLogs.forEach(e => {
        if (!map[e.log_date]) map[e.log_date] = { calories: 0 }
        map[e.log_date].calories += e.calories
      })
      setLogsMap(map)

      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stripRefreshKey])

  function handleDrawerEntriesChange(day: string, entries: any[]) {
    if (day === TODAY) setTodayEntries(entries as CalorieFoodEntry[])
    setStripRefreshKey(k => k + 1)
  }

  function setMeals(updater: number | ((prev: number | null) => number)) {
    setMealsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (user && plan) {
        supabase
          .rpc('update_my_meals', { p_meals: next })
          .then(({ error }) => { if (error) console.error('Failed to persist meals:', error) })
      }
      return next
    })
  }

  const result: FullPlanResult | null = useMemo(() => {
    if (!plan || !profile) return null
    const currentKgOverride = latestBW
      ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
      : null
    return calcFullPlan(profile, plan, currentKgOverride)
  }, [plan, profile, latestBW])

  const perMeal: PerMealBreakdown | null = useMemo(() => {
    if (!result || meals == null) return null
    return calcPerMeal(result.macros, result.dailyTarget, meals)
  }, [result, meals])

  if (loading) {
    // Skeleton mirrors the actual Calories layout: header → strip → hero
    // → macros → per-meal → today's intake. Heights match the rendered
    // cards so the user sees structure before data resolves.
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.container}>
          <View style={{ gap: 6 }}>
            <Skeleton style={{ height: 22, width: 120, borderRadius: 6 }} />
            <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
          </View>
          {/* Strip */}
          <Skeleton style={{ height: 176, width: '100%', borderRadius: 16 }} />
          {/* Hero */}
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 16 }} />
          {/* Macros */}
          <Skeleton style={{ height: 192, width: '100%', borderRadius: 16 }} />
          {/* Per meal */}
          <Skeleton style={{ height: 224, width: '100%', borderRadius: 16 }} />
          {/* Today */}
          <Skeleton style={{ height: 256, width: '100%', borderRadius: 16 }} />
        </View>
      </ScrollView>
    )
  }

  const isLoss    = result ? result.energyAdj < 0 : false
  const TrendIcon = isLoss ? TrendingDown : TrendingUp
  const trendHue  = isLoss ? palette.emerald[400] : palette.blue[400]

  const macroTargets: MacroTargets | null = result ? {
    protein: result.macros.protein.grams,
    fat:     result.macros.fat.grams,
    carbs:   result.macros.carbs.grams,
  } : null

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.container}>

        <View>
          <Text style={s.h1}>Calories</Text>
          <Text style={s.sub}>
            {result ? 'Your personalised daily calorie and macro targets.' : 'Your daily calorie and macro targets.'}
          </Text>
        </View>

        <CalorieStrip
          dailyTarget={result?.dailyTarget ?? null}
          onDayClick={setDrawerDay}
          selectedIso={drawerDay}
          externalLogs={logsMap}
        />

        {!result && (
          <>
            <TodayIntakeCard
              entries={todayEntries}
              dailyTarget={null}
              macroTargets={null}
              onLogFood={() => setDrawerDay(TODAY)}
            />
            {!plan && (
              <View style={[s.cardLg, { padding: 0 }]}>
                <PendingView />
              </View>
            )}
          </>
        )}

        {plan && !result && (() => {
          const missing = getMissingPlanFields(profile)
          const listed  = missing.length === 1
            ? missing[0]
            : missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1]
          return (
            <Link href={'/(app)/edit-profile' as any} asChild>
              <Pressable style={s.missingCard}>
                <View style={s.missingIconWrap}>
                  <Clock size={14} color={palette.amber[400]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.missingTitle}>Almost there</Text>
                  <Text style={s.missingMsg}>
                    Your plan is ready — we just need your{' '}
                    <Text style={{ color: colors.foreground, fontWeight: '500' }}>{listed}</Text>{' '}
                    to calculate your calorie target. Tap to update your profile.
                  </Text>
                </View>
                <ChevronRight size={16} color={alpha(palette.amber[400], 0.60)} />
              </Pressable>
            </Link>
          )
        })()}

        {result && plan && (
          <>
            <AnimateRise>
              <View style={s.heroCard}>
                <View style={s.heroLabel}>
                  <Flame size={16} color={palette.red[400]} />
                  <Text style={s.heroLabelText}>Daily calorie target</Text>
                </View>
                <View style={s.heroBig}>
                  <TickerNumber
                    value={result.dailyTarget}
                    fontSize={60}
                    fontWeight="700"
                    color={palette.red[400]}
                  />
                </View>
                <Text style={s.heroUnit}>kcal / day</Text>

                <View style={s.pillRow}>
                  {[
                    { id: 'bmr'  as const, label: 'BMR',  value: `${result.bmr} kcal`  },
                    { id: 'tdee' as const, label: 'TDEE', value: `${result.tdee} kcal` },
                  ].map(({ id, label, value }) => {
                    const active = activePill === id
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setActivePill(p => p === id ? null : id)}
                        style={[
                          s.pill,
                          active
                            ? { borderColor: 'rgba(239,68,68,0.40)', backgroundColor: 'rgba(239,68,68,0.10)' }
                            : { borderColor: colors.border, backgroundColor: alpha(colors.muted, 0.30) },
                        ]}
                      >
                        <Text style={[s.pillText, { color: active ? palette.red[400] : colors.mutedForeground }]}>
                          {label} <Text style={s.pillValue}>{value}</Text>
                        </Text>
                      </Pressable>
                    )
                  })}
                  {(() => {
                    const active = activePill === 'energy'
                    const baseColor = isLoss ? palette.emerald[400] : palette.blue[400]
                    const baseBg    = isLoss ? 'rgba(16,185,129,0.10)' : 'rgba(59,130,246,0.10)'
                    const activeBg  = isLoss ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)'
                    return (
                      <Pressable
                        onPress={() => setActivePill(p => p === 'energy' ? null : 'energy')}
                        style={[
                          s.pill,
                          { borderColor: active ? alpha(baseColor, 0.50) : alpha(baseColor, 0.30),
                            backgroundColor: active ? activeBg : baseBg },
                          s.pillRowFlex,
                        ]}
                      >
                        <TrendIcon size={12} color={baseColor} />
                        <Text style={[s.pillText, { color: baseColor, marginLeft: 4 }]}>
                          {isLoss ? '−' : '+'}{Math.abs(result.energyAdj)} kcal
                        </Text>
                      </Pressable>
                    )
                  })()}
                </View>

                <ActivePillPanel
                  pill={activePill}
                  onClose={() => setActivePill(null)}
                  result={result}
                  plan={plan}
                  profile={profile}
                  isLoss={isLoss}
                />

                <Text style={s.planLabel}>{ACTIVITY_FACTORS[plan.activity_factor]?.label}</Text>
              </View>
            </AnimateRise>

            <AnimateRise delay={40}>
              <View style={s.cardLg}>
                <Text style={s.cardHeading}>Daily macros</Text>
                <MacroBar
                  protein={result.macros.protein.grams}
                  fat={result.macros.fat.grams}
                  carbs={result.macros.carbs.grams}
                />
                <View style={s.macroChipsGrid}>
                  <MacroChip
                    label="Protein"
                    grams={result.macros.protein.grams}
                    pct={result.macros.protein.pct}
                    kcal={result.macros.protein.calories}
                    color={palette.blue[400]}
                    bgColor="rgba(59,130,246,0.05)"
                    borderColor="rgba(59,130,246,0.20)"
                  />
                  <MacroChip
                    label="Fat"
                    grams={result.macros.fat.grams}
                    pct={result.macros.fat.pct}
                    kcal={result.macros.fat.calories}
                    color={palette.amber[400]}
                    bgColor="rgba(245,158,11,0.05)"
                    borderColor="rgba(245,158,11,0.20)"
                  />
                  <MacroChip
                    label="Carbs"
                    grams={result.macros.carbs.grams}
                    pct={result.macros.carbs.pct}
                    kcal={result.macros.carbs.calories}
                    color={palette.emerald[400]}
                    bgColor="rgba(16,185,129,0.05)"
                    borderColor="rgba(16,185,129,0.20)"
                  />
                </View>
              </View>
            </AnimateRise>

            <AnimateRise delay={80}>
              <View style={s.cardLg}>
                <View style={s.perMealHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Utensils size={16} color={colors.mutedForeground} />
                    <Text style={s.cardHeading}>Per meal</Text>
                  </View>
                  {meals != null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {[2, 3, 4, 5, 6].map(n => (
                        <Pressable
                          key={n}
                          onPress={() => setMeals(n)}
                          style={[s.perMealNumBtn, meals === n ? s.perMealNumBtnActive : s.perMealNumBtnIdle]}
                        >
                          <Text style={[s.perMealNumText, meals === n ? s.perMealNumTextActive : s.perMealNumTextIdle]}>{n}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {meals == null ? (
                  <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                    <Text style={s.perMealHint}>Choose how many meals you'd like to split your day into.</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {[2, 3, 4, 5, 6].map(n => (
                        <Pressable
                          key={n}
                          onPress={() => setMeals(n)}
                          style={s.perMealBigBtn}
                        >
                          <Text style={s.perMealBigBtnText}>{n}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : perMeal ? (
                  <>
                    <View style={s.perMealKcalCard}>
                      <View style={s.perMealKcalRow}>
                        <Text style={[s.perMealKcalNum,  { color: palette.red[400] }]}>{perMeal.calories}</Text>
                        <Text style={[s.perMealKcalUnit, { color: palette.red[400] }]}>kcal</Text>
                      </View>
                      <Text style={s.perMealKcalLabel}>Calories</Text>
                    </View>
                    <View style={s.macroChipsGrid}>
                      {[
                        { label: 'Protein', value: `${perMeal.protein}g`, kcal: perMeal.protein * 4, color: palette.blue[400],    bg: 'rgba(59,130,246,0.05)', border: 'rgba(59,130,246,0.20)' },
                        { label: 'Fat',     value: `${perMeal.fat}g`,     kcal: perMeal.fat * 9,     color: palette.amber[400],   bg: 'rgba(245,158,11,0.05)', border: 'rgba(245,158,11,0.20)' },
                        { label: 'Carbs',   value: `${perMeal.carbs}g`,   kcal: perMeal.carbs * 4,   color: palette.emerald[400], bg: 'rgba(16,185,129,0.05)', border: 'rgba(16,185,129,0.20)' },
                      ].map(m => (
                        <View key={m.label} style={[s.macroChip, { backgroundColor: m.bg, borderColor: m.border }]}>
                          <Text style={[s.macroChipPlain, { color: m.color }]}>{m.value}</Text>
                          <Text style={s.macroChipLabel}>{m.label}</Text>
                          <Text style={s.macroChipFooter}>{Math.round(m.kcal)} kcal</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={s.perMealCaption}>Tap a number above to change your meal frequency.</Text>
                  </>
                ) : null}
              </View>
            </AnimateRise>

            <TodayIntakeCard
              entries={todayEntries}
              dailyTarget={result.dailyTarget}
              macroTargets={macroTargets}
              onLogFood={() => setDrawerDay(TODAY)}
            />

            {result.timeline && <TimelineCard result={result} profile={profile} TrendIcon={TrendIcon} trendHue={trendHue} />}

            {/* Use `!= null` instead of `&&` because goalWeightKg is `number | null`
               — if a user ever has a goal of 0, the bare-number truthy check would
               return 0, which RN renders as the bare text "0". `!= null` is safe. */}
            {result.goalWeightKg != null && plan ? (
              <CurrentWeightGoal result={result} plan={plan} profile={profile} latestBW={latestBW} />
            ) : null}
          </>
        )}
      </View>

      <FoodLogDrawer
        userId={user?.id}
        day={drawerDay}
        onClose={() => setDrawerDay(null)}
        onEntriesChange={handleDrawerEntriesChange}
        mealSlotsDefault={(profile?.meal_slots_default ?? null) as MealSlot[] | null}
        onSaveSlotsDefault={async (slots) => {
          if (!user) return
          await supabase.from('profiles').update({ meal_slots_default: slots }).eq('id', user.id)
          // Refresh AuthContext so the Settings tab picks up the new
          // layout immediately — no app reload needed.
          await refreshProfile()
        }}
      />
    </ScrollView>
  )
}

// ── Active pill explanation panel ────────────────────────────────────────────

function ActivePillPanel({
  pill, onClose, result, plan, profile, isLoss,
}: {
  pill:    'bmr' | 'tdee' | 'energy' | null
  onClose: () => void
  result:  FullPlanResult
  plan:    CaloriePlan
  profile: any
  isLoss:  boolean
}) {
  const pUnit = profile?.weight_unit || 'lb'
  const hUnit = profile?.height_unit || 'imperial'
  const weightDisplay = profile?.current_weight
    ? `${profile.current_weight} ${pUnit}`
    : '—'
  const heightDisplay = profile?.current_height
    ? (hUnit === 'imperial'
        ? `${Math.floor(profile.current_height / 12)}'${Math.round(profile.current_height % 12)}"`
        : `${Math.round(profile.current_height)} cm`)
    : '—'
  const age      = calcAge(profile?.birthdate)
  const activity = ACTIVITY_FACTORS[plan.activity_factor]
  const energyPct = plan.energy_balance_pct != null
    ? Math.round(plan.energy_balance_pct * 100)
    : Math.round((result.energyAdj / result.tdee) * 100)
  const energyLabel = getEnergyLabel(energyPct)
  const adjAbs  = Math.abs(result.energyAdj)
  const adjWord = result.energyAdj < 0 ? 'minus' : result.energyAdj > 0 ? 'plus' : null

  let title: string
  let body:  React.ReactNode

  if (pill === 'bmr') {
    title = 'Basal Metabolic Rate (BMR)'
    body = (
      <Text style={s.pillBody}>
        BMR is the calories your body burns at complete rest — what you'd burn if you stayed in bed all day, just keeping you alive. Yours is{' '}
        <Text style={s.pillBodyBold}>{result.bmr} kcal</Text>, calculated from your weight ({weightDisplay}), height ({heightDisplay}), and age ({age ?? '—'} yrs). As you grow, your metrics will too — and so will your BMR.
      </Text>
    )
  } else if (pill === 'tdee') {
    title = 'Total Daily Energy Expenditure (TDEE)'
    body = (
      <Text style={s.pillBody}>
        TDEE is the total calories you burn in a typical day — your BMR plus everything you spend through movement, exercise, and even digestion. Yours is{' '}
        <Text style={s.pillBodyBold}>{result.tdee} kcal</Text>: your BMR ({result.bmr}) considering you're <Text style={s.pillBodyMid}>{activity?.label?.toLowerCase()}</Text>. Eating exactly this much would keep your weight stable.
      </Text>
    )
  } else if (pill === 'energy') {
    title = `Energy balance · ${energyLabel}`
    body = (
      <Text style={s.pillBody}>
        Energy balance is the gap between what you eat and what you burn. Yours is{' '}
        <Text style={[s.pillBodyBold, { color: isLoss ? palette.emerald[400] : palette.blue[400] }]}>
          {result.energyAdj > 0 ? '+' : ''}{result.energyAdj} kcal/day
        </Text>{' '}
        ({energyPct > 0 ? '+' : ''}{energyPct}% of TDEE), set by your coach as <Text style={s.pillBodyMid}>{energyLabel}</Text>. Added to your TDEE ({result.tdee}), this gives you a daily target of{' '}
        <Text style={[s.pillBodyBold, { color: palette.red[400] }]}>{result.dailyTarget} kcal</Text>.
      </Text>
    )
  } else {
    title = 'Daily calorie target'
    // Pre-compute the optional " minus your energy balance of N" phrase as a
    // plain string so the JSX has no inline conditional Text-inside-Text
    // (RN tightened up the rules around mixing JSX expressions and bare
    // literal text inside a single <Text>; refactoring to a precomputed
    // string keeps the body unambiguous and the warning quiet).
    const adjPhrase = adjWord ? ` ${adjWord} your energy balance of ${adjAbs}` : ''
    body = (
      <Text style={s.pillBody}>
        This is how many calories you should aim to eat each day to move toward your goal. It's your TDEE ({result.tdee}){adjPhrase}, giving you{' '}
        <Text style={[s.pillBodyBold, { color: palette.red[400] }]}>{result.dailyTarget} kcal/day</Text>. Hit this consistently and your body will go where the plan is pointing. Tap any pill above to learn more about that number.
      </Text>
    )
  }

  return (
    <View style={s.pillPanel}>
      <View style={s.pillPanelHeader}>
        <Text style={s.pillPanelTitle}>{title}</Text>
        {pill && (
          <Pressable onPress={onClose} hitSlop={6}>
            <X size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
      {body}
    </View>
  )
}

// ── Timeline card ────────────────────────────────────────────────────────────

function TimelineCard({
  result, profile, TrendIcon, trendHue,
}: {
  result:    FullPlanResult
  profile:   any
  TrendIcon: typeof TrendingUp
  trendHue:  string
}) {
  const tl = result.timeline
  if (!tl) return null
  const pUnit = profile?.weight_unit || 'lb'

  return (
    <AnimateRise delay={120}>
      <View style={s.cardLg}>
        {tl.mode === 'recomp' ? (
          <>
            <View style={s.timelineHeader}>
              <TrendIcon size={16} color={palette.purple[400]} />
              <Text style={s.cardHeading}>Body recomposition</Text>
            </View>
            {(() => {
              const b = tl.monthsBest, r = tl.monthsRealistic
              const label = b === r ? `${b}` : `${b}–${r}`
              const unit  = (b === 1 && r === 1) ? 'month' : 'months'
              return (
                <View style={s.timelineNumRow}>
                  <Text style={s.timelineApprox}>approx.</Text>
                  <Text style={[s.timelineNum, { color: palette.purple[400] }]}>~{label}</Text>
                  <Text style={s.timelineUnit}>{unit}</Text>
                </View>
              )
            })()}
            <Text style={s.timelineMsg}>
              Your goal is a small change and your calorie target is balanced — this is recomposition territory.
              With consistent training and adequate protein, you can lose fat and build muscle at the same time.
            </Text>
            <Text style={s.timelineFootnote}>
              Net body weight in recomp typically shifts ~0.25–0.5 kg per month. Scale may stay flat while body composition improves — track progress photos and strength too.
            </Text>
          </>
        ) : tl.mode === 'mismatch' ? (
          <>
            <View style={s.timelineHeader}>
              <TrendIcon size={16} color={palette.amber[400]} />
              <Text style={s.cardHeading}>Plan note</Text>
            </View>
            <Text style={s.timelineMsg}>
              Your goal weight and calorie target are pulling in different directions. Reach out to your coach to align them.
            </Text>
          </>
        ) : (
          <>
            <View style={s.timelineHeader}>
              <TrendIcon size={16} color={trendHue} />
              <Text style={s.cardHeading}>Estimated timeline</Text>
            </View>
            {(() => {
              const b = tl.monthsBest, r = tl.monthsRealistic
              const label = b === r ? `${b}` : `${b}–${r}`
              const unit  = (b === 1 && r === 1) ? 'month' : 'months'
              return (
                <View style={s.timelineNumRow}>
                  <Text style={s.timelineApprox}>approx.</Text>
                  <Text style={s.timelineNum}>~{label}</Text>
                  <Text style={s.timelineUnit}>{unit}</Text>
                </View>
              )
            })()}
            <Text style={s.timelineMsg}>
              to {tl.isLoss ? 'lose' : 'gain'}{' '}
              <Text style={s.timelineMsgEmph}>{fromKg(tl.weightDiffKg, pUnit).toFixed(1)} {pUnit}</Text>
              {/* React Native: bare strings only render inside a <Text> parent.
                 A `<>` fragment doesn't forward the Text rendering context, so
                 the strings inside ' and reach your goal weight of ' would
                 throw. Wrapping the conditional branch in a nested <Text>
                 keeps the strings inside a Text and renders inline. */}
              {result.goalWeightKg ? (
                <Text>
                  {' '}and reach your goal weight of{' '}
                  <Text style={s.timelineMsgEmph}>{fmtWeight(result.goalWeightKg, pUnit)}</Text>
                </Text>
              ) : null}
            </Text>
            <Text style={s.timelineFootnote}>
              Best-case assumes full daily adherence. Realistic estimate accounts for rest days and variation.
            </Text>
          </>
        )}
      </View>
    </AnimateRise>
  )
}

// ── Current weight goal card ─────────────────────────────────────────────────

const GOAL_MESSAGES = {
  zero:      ["Your plan is set. Log your first day and let the journey begin.", "Every meaningful journey starts with the first meal logged. Begin today.", "Your goal is locked in. Today is day one of your journey, start by logging your intake.", "The plan is ready. Log your first meal and take the first step on your journey.", "Your journey starts now. Track today's intake and build the foundation."],
  early:     ["First steps in. Every meal you track is a choice made with intention.", "You've started moving. Each logged meal is a small commitment to the bigger picture.", "The early days are the hardest. You're doing it, keep logging consistently.", "A few days in. The tracking habit is forming, don't break the streak.", "You're off the starting line. Consistency here sets the tone for everything ahead."],
  building:  ["Building the routine. Consistent eating habits, not perfect ones, are what move the scale.", "You're finding your rhythm. Staying close to your daily target is the entire game.", "Progress is quiet but real. Your intake choices are compounding every single day.", "The routine is taking shape. What you eat consistently always wins over what you eat occasionally.", "Early progress is here. Keep hitting your daily calorie target and the body follows."],
  committed: ["Your daily commitment is paying off. The discipline at the table is showing up on the scale.", "Your daily commitment is paying off. What you do consistently is starting to speak.", "Your daily commitment is paying off. Stay in your numbers and this keeps moving.", "Your daily commitment is paying off. Real, sustained change looks exactly like this.", "Your daily commitment is paying off. You've built a solid foundation, don't stop now."],
  halfway:   ["More than halfway to your goal weight. What you eat most days matters more than what you eat occasionally.", "Past the halfway point. Your meal choices are consistently working in your favour.", "You're over halfway. The eating pattern you've built is what got you here, protect it.", "Halfway done. Your daily intake discipline has been the deciding factor, keep it going.", "More than halfway there. Stay in your calorie target and the final stretch will take care of itself."],
  dialled:   ["Your intake habits are dialled in. Stay in your target range and the number will follow.", "Deep into the journey now. You know what to eat and you're doing it, that's rare.", "Your eating consistency is your biggest asset right now. Don't trade it for shortcuts.", "You're in the final third. Log every day, stay in your range, finish what you started.", "Three quarters done. The consistency you've built at mealtime will carry you across the line."],
  nearEnd:   ["Almost there. The discipline you've built at mealtime got you this far, don't loosen the reins now.", "You're close. A few more consistent weeks at your calorie target and this phase is done.", "The finish line is in sight. Your intake log tells the story of real commitment.", "Nearly at goal. What you've built here, consistent daily tracking, is a skill you keep forever.", "So close. Don't drift off plan now. The meals you log this week are the last push."],
  final:     ["Right at the edge of your goal. A few more consistent days at your calorie target and you're done.", "You're almost across the line. Stay disciplined at every meal, the end is right here.", "Final stretch. Log your intake, hit your numbers, finish this phase strong.", "One last push. The consistency that carried you 90% of the way will take you the rest.", "You're this close. Don't let up on your daily target now, the goal is within reach."],
  done:      ["Goal weight reached. Your eating consistency did this, not luck. Your coach will now discuss the next phase goals with you.", "You've done it. Consistent daily intake, meal after meal, got you here. Your coach will now discuss the next phase with you.", "Goal reached. What you built at the table every day is what made the difference. Your coach will reach out to discuss your next phase goals.", "Phase complete. Your commitment to your daily intake plan paid off. Your coach will now set the goals for your next phase.", "You hit your goal weight. The discipline you showed over this phase is the foundation for what comes next. Your coach will discuss the next phase with you."],
}

function pickMsg(arr: string[]): string { return arr[Math.floor(Math.random() * arr.length)] }
function getGoalMessage(p: number): string {
  if (p >= 1.0)  return pickMsg(GOAL_MESSAGES.done)
  if (p >= 0.90) return pickMsg(GOAL_MESSAGES.final)
  if (p >= 0.75) return pickMsg(GOAL_MESSAGES.nearEnd)
  if (p >= 0.60) return pickMsg(GOAL_MESSAGES.dialled)
  if (p >= 0.45) return pickMsg(GOAL_MESSAGES.halfway)
  if (p >= 0.25) return pickMsg(GOAL_MESSAGES.committed)
  if (p >= 0.10) return pickMsg(GOAL_MESSAGES.building)
  if (p > 0)     return pickMsg(GOAL_MESSAGES.early)
  return pickMsg(GOAL_MESSAGES.zero)
}

function CurrentWeightGoal({
  result, plan, profile, latestBW,
}: {
  result:   FullPlanResult
  plan:     CaloriePlan
  profile:  any
  latestBW: BWRow | null
}) {
  const pUnit     = profile?.weight_unit || 'lb'
  const startKg   = plan.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
  const currentKg = latestBW
    ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
    : null
  const goalKg = result.goalWeightKg

  if (!startKg || !goalKg || Math.abs(startKg - goalKg) < 0.1) {
    return (
      <AnimateRise delay={160}>
        <View style={s.cardLg}>
          <Text style={[s.cardHeading, { marginBottom: 8 }]}>Current weight goal</Text>
          <Text style={s.timelineMsg}>
            Your coach hasn't locked in a phase starting weight yet. Once they do, your progress toward{' '}
            <Text style={s.timelineMsgEmph}>{fromKg(goalKg ?? 0, pUnit).toFixed(1)} {pUnit}</Text> will appear here.
          </Text>
        </View>
      </AnimateRise>
    )
  }

  const effectiveCurrent = currentKg ?? startKg
  const isLossPhase = startKg > goalKg

  const progress = plan.goal_reached
    ? 1
    : (() => {
        const totalDiff   = Math.abs(startKg - goalKg)
        const movedAmount = isLossPhase ? (startKg - effectiveCurrent) : (effectiveCurrent - startKg)
        return Math.min(1, Math.max(0, movedAmount / totalDiff))
      })()

  const hue      = Math.round(progress * 142)
  const barColor = `hsl(${hue}, 70%, 48%)`
  const pctColor = `hsl(${hue}, 70%, 55%)`

  return (
    <AnimateRise delay={160}>
      <View style={s.cardLg}>
        <Text style={s.cardHeading}>Current weight goal</Text>

        <View style={s.goalRow}>
          <View>
            <Text style={s.goalSmallLabel}>PHASE START</Text>
            <Text style={s.goalBigNum}>
              {fromKg(startKg, pUnit).toFixed(1)}<Text style={s.goalSmallUnit}> {pUnit}</Text>
            </Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={s.goalSmallLabel}>CURRENT</Text>
            {currentKg != null
              ? <Text style={s.goalBigNum}>
                  {fromKg(currentKg, pUnit).toFixed(1)}<Text style={s.goalSmallUnit}> {pUnit}</Text>
                </Text>
              : <Text style={s.goalNoCurrent}>No weigh-in</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.goalSmallLabel}>GOAL</Text>
            <Text style={s.goalBigNum}>
              {fromKg(goalKg, pUnit).toFixed(1)}<Text style={s.goalSmallUnit}> {pUnit}</Text>
            </Text>
          </View>
        </View>

        <View style={s.goalProgressTrack}>
          <View style={[s.goalProgressFill, { width: `${progress * 100}%` as any, backgroundColor: barColor }]} />
          <View style={[s.goalProgressKnob, { left: `${Math.max(2, progress * 100)}%` as any, backgroundColor: barColor }]} />
        </View>

        <View style={s.goalMsgRow}>
          <View style={s.goalPctWrap}>
            <Text style={[s.goalPctNum, { color: pctColor }]}>{Math.round(progress * 100)}</Text>
            <Text style={s.goalPctLabel}>%</Text>
          </View>
          <Text style={s.goalMsgText}>{getGoalMessage(progress)}</Text>
        </View>
      </View>
    </AnimateRise>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:    { paddingBottom: 32 },
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 20, maxWidth: 672, alignSelf: 'center', width: '100%' },

  // Header
  h1:  { fontSize: 20, fontWeight: '600', color: colors.foreground, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: colors.mutedForeground, marginTop: 2 },

  fullLoading: { paddingVertical: 80, alignItems: 'center' },

  // Generic card
  cardLg: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  cardHeading: { fontSize: 14, fontWeight: '600', color: colors.foreground },

  // Today's intake card
  intakeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logFoodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
    backgroundColor: 'rgba(239,68,68,0.10)',
    paddingHorizontal: 12, paddingVertical: 4,
  },
  logFoodBtnText: { fontSize: 12, fontWeight: '600', color: palette.red[400] },

  intakeBigRow:    { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  intakeBigNumRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  intakeBigNumber: { fontSize: 36, fontWeight: '700', color: palette.red[400], fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  intakeBigUnit:   { fontSize: 14, color: colors.mutedForeground },
  intakeBigSub:    { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  intakeRemainNum: { fontSize: 14, fontWeight: '600', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
  intakeRemainSub: { fontSize: 11, color: colors.mutedForeground },

  intakeSegBar: { position: 'relative', height: 16, borderRadius: 9999, backgroundColor: alpha(colors.muted, 0.40), overflow: 'hidden' },
  intakeSeg:    { position: 'absolute', top: 0, height: '100%' },
  intakeNeedle: { position: 'absolute', top: 0, height: '100%', width: 2, backgroundColor: alpha(colors.mutedForeground, 0.50) },
  intakeMacroLabels: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  intakeChipsGrid: { flexDirection: 'row', gap: 6 },
  intakeChip: {
    flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, gap: 4,
  },
  intakeChipTopRow: { flexDirection: 'row', alignItems: 'baseline' },
  intakeChipNum:    { fontSize: 16, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  intakeChipUnit:   { fontSize: 11, fontWeight: '400', marginLeft: 1 },
  intakeChipLabel:  { fontSize: 10, color: colors.mutedForeground },
  intakeChipBarTrack: { position: 'relative', height: 4, borderRadius: 9999, backgroundColor: alpha(colors.muted, 0.40), overflow: 'hidden', marginTop: 6 },
  intakeChipBarFill:  { position: 'absolute', top: 0, height: '100%', borderRadius: 9999 },
  intakeChipFooter:   { fontSize: 10, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'], marginTop: 4 },

  intakeEmpty: { paddingVertical: 16, alignItems: 'center', gap: 12 },
  intakeEmptyIconWrap: {
    width: 48, height: 48, borderRadius: 9999,
    backgroundColor: alpha(colors.muted, 0.30),
    alignItems: 'center', justifyContent: 'center',
  },
  intakeEmptyTitle: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },
  intakeEmptyHint:  { fontSize: 11, color: alpha(colors.mutedForeground, 0.60), marginTop: 2, textAlign: 'center' },

  macroLegendItem:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  macroLegendDot:   { width: 8, height: 8, borderRadius: 9999 },
  macroLegendLabel: { fontSize: 11, color: colors.foreground, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },

  // MacroBar
  macroBar: { flexDirection: 'row', height: 10, width: '100%', overflow: 'hidden', borderRadius: 9999 },

  // MacroChip
  macroChipsGrid: { flexDirection: 'row', gap: 12 },
  macroChip:      { flex: 1, borderRadius: 12, borderWidth: 1, padding: 16, alignItems: 'center', gap: 4 },
  macroChipNumRow: { flexDirection: 'row', alignItems: 'baseline' },
  macroChipUnit:   { fontSize: 16, fontWeight: '400', marginLeft: 1 },
  macroChipLabel:  { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  macroChipFooter: { fontSize: 11, color: alpha(colors.mutedForeground, 0.60), marginTop: 4 },
  macroChipPlain:  { fontSize: 24, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },

  // Daily target hero
  heroCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  heroLabel:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroLabelText: { fontSize: 14, color: colors.mutedForeground },
  heroBig:       { },
  heroUnit:      { fontSize: 14, color: colors.mutedForeground },
  pillRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8, flexWrap: 'wrap' },
  pill: {
    borderRadius: 9999, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  pillRowFlex: { flexDirection: 'row', alignItems: 'center' },
  pillText:    { fontSize: 12, fontWeight: '500' },
  pillValue:   { fontFamily: fonts.mono[500], fontVariant: ['tabular-nums'] },

  pillPanel: {
    width: '100%',
    marginTop: 8,
    borderRadius: 9, borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.muted, 0.20),
    paddingHorizontal: 16, paddingVertical: 12,
  },
  pillPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  pillPanelTitle:  { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, color: colors.mutedForeground, flex: 1 },
  pillBody:        { fontSize: 13, lineHeight: 19, color: colors.mutedForeground, textAlign: 'left' },
  pillBodyBold:    { fontWeight: '600', color: colors.foreground, fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
  pillBodyMid:     { fontWeight: '500', color: colors.foreground },

  planLabel: { fontSize: 12, color: colors.mutedForeground, paddingTop: 4 },

  // Per meal
  perMealHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  perMealNumBtn: { width: 32, height: 32, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  perMealNumBtnIdle:    { borderColor: colors.border },
  perMealNumBtnActive:  { borderColor: 'rgba(132,204,22,1)', backgroundColor: 'rgba(132,204,22,1)' },
  perMealNumText:        { fontSize: 12, fontWeight: '600' },
  perMealNumTextIdle:    { color: colors.mutedForeground },
  perMealNumTextActive:  { color: '#fff' },

  perMealBigBtn: {
    width: 40, height: 40, borderRadius: 9999, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  perMealBigBtnText: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  perMealHint: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },

  perMealKcalCard: {
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)', backgroundColor: 'rgba(239,68,68,0.05)',
    borderRadius: 12, padding: 16, alignItems: 'center', gap: 4,
  },
  perMealKcalRow: { flexDirection: 'row', alignItems: 'baseline' },
  perMealKcalNum: { fontSize: 24, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  perMealKcalUnit:{ fontSize: 16, fontWeight: '700', marginLeft: 2 },
  perMealKcalLabel:{ fontSize: 12, color: colors.mutedForeground },
  perMealCaption:  { fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },

  // Missing-fields card
  missingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.20)',
    backgroundColor: 'rgba(245,158,11,0.05)',
    paddingHorizontal: 20, paddingVertical: 20,
  },
  missingIconWrap: {
    width: 28, height: 28, borderRadius: 9999,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  missingTitle: { fontSize: 14, fontWeight: '500', color: palette.amber[300] },
  missingMsg:   { fontSize: 14, color: colors.mutedForeground, marginTop: 2, lineHeight: 19 },

  // Pending
  pendingWrap: { paddingVertical: 80, alignItems: 'center', gap: 16 },
  pendingIcon: {
    width: 64, height: 64, borderRadius: 9999,
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  pendingTitle: { fontSize: 18, fontWeight: '600', color: colors.foreground },
  pendingMsg:   { fontSize: 14, color: colors.mutedForeground, textAlign: 'center', maxWidth: 280, lineHeight: 19 },

  // Timeline
  timelineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineNumRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  timelineApprox: { fontSize: 11, color: colors.mutedForeground },
  timelineNum:    { fontSize: 30, fontWeight: '700', color: colors.foreground, fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  timelineUnit:   { fontSize: 14, color: colors.mutedForeground },
  timelineMsg:    { fontSize: 14, color: colors.mutedForeground, marginTop: 4, lineHeight: 19 },
  timelineMsgEmph:{ fontWeight: '500', color: colors.foreground },
  timelineFootnote:{ fontSize: 11, color: colors.mutedForeground, marginTop: 8, lineHeight: 15 },

  // Goal
  goalRow:        { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  goalSmallLabel: { fontSize: 10, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.6 },
  goalBigNum:     { fontSize: 18, fontWeight: '700', color: colors.foreground, fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  goalSmallUnit:  { fontSize: 14, fontWeight: '400', color: colors.mutedForeground },
  goalNoCurrent:  { fontSize: 14, color: alpha(colors.mutedForeground, 0.50) },

  goalProgressTrack: { position: 'relative', height: 12, backgroundColor: alpha(colors.muted, 0.40), borderRadius: 9999 },
  goalProgressFill:  { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 9999 },
  goalProgressKnob:  {
    position: 'absolute', top: '50%', height: 20, width: 20, borderRadius: 9999,
    borderWidth: 2, borderColor: colors.background,
    marginLeft: -10, marginTop: -10,
  },

  goalMsgRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  // Web uses `min-w-[2.5rem]` (40px) — fits "100" because system-default fonts
  // render digits narrower than JetBrains Mono. JBM digits at 24px are ~14px
  // wide, so "100" needs ~42-45px. Bump to a comfortable minWidth and let the
  // wrap grow as needed (still keeps the message text aligned across percents).
  goalPctWrap:  { minWidth: 52, alignItems: 'center' },
  goalPctNum:   { fontSize: 24, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  goalPctLabel: { fontSize: 10, color: colors.mutedForeground, marginTop: -2 },
  goalMsgText:  { flex: 1, fontSize: 14, color: colors.mutedForeground, lineHeight: 19, paddingTop: 2 },
})
