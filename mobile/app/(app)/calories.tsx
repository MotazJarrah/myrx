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
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { Link } from 'expo-router'
import {
  Flame, Clock, TrendingDown, TrendingUp, Utensils,
  X, Plus, UtensilsCrossed, ChevronRight, Pencil,
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
import PlanWizardSheet from '../../src/components/PlanWizardSheet'
import { MACRO_PRESETS, PACE_OPTIONS, macroPresetForPlan, paceForPlan } from '../../src/lib/planPresets'
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
//
// Two modes (May 23 2026):
//   - Admin-coached (`onSetupPlan` not provided): unchanged copy + no CTA.
//     The user is waiting for their coach to author a plan.
//   - Self-coached (`onSetupPlan` provided): swap copy to "Set your own
//     goal" and add a primary CTA that opens the PlanWizardSheet.
//
// Same card chrome for both — the empty-state shape is consistent; only
// the messaging + CTA changes based on who owns the plan.

function PendingView({ onSetupPlan }: { onSetupPlan?: () => void }) {
  if (onSetupPlan) {
    return (
      <View style={s.pendingWrap}>
        <View style={s.pendingIcon}>
          <Flame size={32} color={palette.amber[400]} />
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={s.pendingTitle}>Set up your plan</Text>
          <Text style={s.pendingMsg}>
            Pick your pace, activity level, and how you eat. Your daily calorie + macro targets are calculated from there.
          </Text>
        </View>
        <Pressable style={s.pendingCTA} onPress={onSetupPlan}>
          <Text style={s.pendingCTAText}>Set up my plan</Text>
        </Pressable>
      </View>
    )
  }
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

  // Plan wizard state. `wizardStep` controls deep-link into a specific
  // screen (used by the edit chips); `wizardSingleScreen` makes the
  // wizard show only that one screen and Save instead of Next. When
  // null, the wizard is closed.
  const [wizardOpen, setWizardOpen]                 = useState(false)
  // Default = 'activity' since the May 24 2026 wizard reorder. Activity
  // step picks the multiplier that drives TDEE, which the Pace step uses
  // to compute per-user weight outcomes. Old default was 'pace' which
  // now opens on what's actually step 2 — wrong. Inline edit chips
  // override this with their own step ('pace' | 'activity' | 'macros')
  // because they open in single-screen mode where order doesn't matter.
  const [wizardStep, setWizardStep]                 = useState<'pace' | 'activity' | 'macros'>('activity')
  const [wizardSingleScreen, setWizardSingleScreen] = useState(false)

  function openWizard(step: 'pace' | 'activity' | 'macros' = 'activity', single = false) {
    setWizardStep(step)
    setWizardSingleScreen(single)
    setWizardOpen(true)
  }

  // Derived: is this user self-coached?
  const isSelfCoached = profile?.is_self_coached === true
  // Admins set their own intake plan from the admin Intake Plan tab
  // (web only — admin portal is web-exclusive). On mobile, an admin who
  // somehow lands on this page never sees inline edit UI either — they're
  // pointed back to the web admin panel. Mirror of web Calories.jsx
  // (May 23 2026 lock).
  const isAdmin         = profile?.is_superuser === true
  const canEditPlanHere = isSelfCoached && !isAdmin

  // Current weight in kg — sourced from latest bodyweight log if present,
  // else from profile.current_weight (which is stored in profile.weight_unit).
  // The wizard needs this to derive goal_weight + starting_weight.
  const currentWeightKg = useMemo<number | null>(() => {
    if (latestBW) {
      return latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight)
    }
    if (profile?.current_weight) {
      return profile.weight_unit === 'lb'
        ? profile.current_weight * 0.453592
        : Number(profile.current_weight)
    }
    return null
  }, [latestBW, profile])

  // ── Goal-reached banner ─────────────────────────────────────────────────
  // Shown to self-coached users when their latest bodyweight crosses the
  // plan's derived goal_weight_kg. Tap "Switch to maintenance" to flip
  // energy_balance_pct → 0 and goal_weight_kg → current. Tap dismiss to
  // hide forever (AsyncStorage flag per user+goal so a re-edit of the
  // plan back to losing/gaining re-arms the banner cleanly).
  const [goalReachedDismissed, setGoalReachedDismissed] = useState(true)
  const goalReachedKey = useMemo(() => {
    if (!user || !plan?.goal_weight_kg) return null
    return `myrx_goal_reached_${user.id}_${plan.goal_weight_kg}`
  }, [user, plan?.goal_weight_kg])

  useEffect(() => {
    if (!goalReachedKey) { setGoalReachedDismissed(true); return }
    AsyncStorage.getItem(goalReachedKey).then(v => {
      setGoalReachedDismissed(v === '1')
    })
  }, [goalReachedKey])

  const goalReached = useMemo(() => {
    // Admin goal-reached is handled from the admin Intake Plan tab on web.
    // Suppress the inline detection here (May 23 2026 mirror).
    if (!canEditPlanHere || !plan || !currentWeightKg) return false
    if (plan.energy_balance_pct == null || Math.abs(plan.energy_balance_pct) < 0.005) return false
    const goal = plan.goal_weight_kg
    const start = plan.starting_weight_kg
    if (goal == null || start == null) return false
    // Loss: current <= goal. Gain: current >= goal. Direction inferred
    // from start vs goal, NOT from energy_balance_pct, so a re-edit that
    // changed direction is handled correctly.
    if (goal < start) return currentWeightKg <= goal
    if (goal > start) return currentWeightKg >= goal
    return false
  }, [canEditPlanHere, plan, currentWeightKg])

  async function handleSwitchToMaintenance() {
    if (!user || !plan || !currentWeightKg) return
    const newGoal = Math.round(currentWeightKg * 10) / 10
    const { error } = await supabase
      .from('calorie_plans')
      .update({
        energy_balance_pct: 0,
        goal_weight_kg:     newGoal,
        starting_weight_kg: newGoal,
        // Reset goal_reached so the next phase tracks fresh progress
        // toward maintenance. Without this, plan.goal_reached stays
        // true and the progress bar is forced to 100% forever (the
        // CurrentWeightGoal `progress` calc short-circuits on this
        // flag). May 24 2026 fix.
        goal_reached:       false,
        updated_at:         new Date().toISOString(),
      })
      .eq('user_id', user.id)
    if (error) {
      console.error('[Calories] flip-to-maintenance failed:', error)
      return
    }
    if (goalReachedKey) await AsyncStorage.setItem(goalReachedKey, '1')
    setGoalReachedDismissed(true)
    setStripRefreshKey(k => k + 1)
  }

  /**
   * "Keep going" handler (May 24 2026 — second rewrite). Earlier
   * iterations either dismissed-only (left goal_reached=true forever
   * forcing 100%) or rebaselined start=current with goal unchanged
   * (looked weird because the stat row still showed the OLD goal as
   * a stale leftover). Final semantics:
   *
   *   • goal_weight_kg ← null   (clears the target — there's no
   *     active phase right now)
   *   • goal_reached   ← false  (clears the celebration trigger)
   *   • starting_weight_kg stays as historical record
   *
   * The card detects null goal and switches to a minimal "Plan
   * complete — set a new one" state with one Update plan CTA. No
   * phase start / current / goal stat row (no plan to compare
   * against), no plan summary chips. Daily calorie target above
   * still computes via calcMacros's currentWeight fallback.
   */
  async function handleDismissGoalReached() {
    if (user && plan) {
      const { error } = await supabase
        .from('calorie_plans')
        .update({
          goal_weight_kg: null,
          goal_reached:   false,
          updated_at:     new Date().toISOString(),
        })
        .eq('user_id', user.id)
      if (error) console.error('[Calories] keep-going clear-goal failed:', error)
    }
    if (goalReachedKey) await AsyncStorage.setItem(goalReachedKey, '1')
    setGoalReachedDismissed(true)
    setStripRefreshKey(k => k + 1)
  }
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

  // Live refresh — a coach can edit this client's calorie plan + weight goal
  // from the admin portal, and weigh-ins land from the Bodyweight page. Without
  // a subscription the page would show a stale plan/goal until a full remount.
  // Mirrors the chat/profile realtime pattern: any change to this user's
  // calorie_plans or bodyweight row re-runs the page fetch via stripRefreshKey.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`calories-sync-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calorie_plans', filter: `user_id=eq.${user.id}` },
        () => setStripRefreshKey(k => k + 1),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bodyweight', filter: `user_id=eq.${user.id}` },
        () => setStripRefreshKey(k => k + 1),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

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
                <PendingView
                  onSetupPlan={
                    // Self-coached non-admin users get the CTA. Admin-
                    // coached clients fall through to "Your plan is on its
                    // way" (coach writes it). Admins themselves also fall
                    // through here on mobile — they set their plan from
                    // the web admin Intake Plan tab. May 23 2026 lock.
                    canEditPlanHere
                      ? () => {
                          if (!currentWeightKg) {
                            // The wizard needs a current weight to derive
                            // goal_weight + starting_weight. If the user
                            // hasn't logged bodyweight yet, route them
                            // to the Bodyweight tab.
                            // TODO: replace with a friendlier inline prompt
                            //       once the bodyweight onboarding lands.
                          }
                          openWizard('activity', false)
                        }
                      : undefined
                  }
                />
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
            {/* The standalone goal-reached celebration block lived here
                until May 24 2026. It's now embedded INSIDE the Current
                weight goal card — when goalReached is true, the plan
                summary chips at the bottom are replaced by the same
                "🎉 You hit your goal weight" content + 3 action
                buttons. Single block instead of two stacked blocks. */}

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

            {/* The standalone "My plan" card was merged into the
                CurrentWeightGoal card on May 24 2026 — the plan summary
                + edit affordance now live inside the same block as the
                progress bar (pencil icon top-right opens the wizard,
                pace/activity/macros chips at the bottom show + deep-link
                into specific steps). See CurrentWeightGoal below. */}

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

            {/* Card order (May 24 2026): CurrentWeightGoal FIRST,
                TimelineCard SECOND. The goal card always renders when
                a plan exists — it decides its own internal state:
                  • active goal (normal stat row + progress + chips)
                  • goal reached (stat row + celebration)
                  • goal cleared / not set (minimal "set a new plan"
                    state — fires after Keep going clears goal_weight_kg)
                We DON'T gate at the parent level on goalWeightKg
                anymore — if the plan exists in any state, the card
                shows the appropriate UI. */}
            {plan ? (
              <CurrentWeightGoal
                result={result}
                plan={plan}
                profile={profile}
                latestBW={latestBW}
                canEditPlanHere={canEditPlanHere}
                openWizard={openWizard}
                goalReached={goalReached && !goalReachedDismissed}
                onSwitchToMaintenance={handleSwitchToMaintenance}
                onDismissGoalReached={handleDismissGoalReached}
              />
            ) : null}

            {/* TimelineCard hides when the user already hit their
                goal — showing a timeline for a goal they've reached
                is just noise. The CurrentWeightGoal card now carries
                the "what's next" prompt (Update plan / Switch to
                maintenance / Keep going) inside its own body when
                goal is reached. */}
            {result.timeline && !plan.goal_reached && (
              <TimelineCard result={result} plan={plan} profile={profile} TrendIcon={TrendIcon} trendHue={trendHue} />
            )}
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

      <PlanWizardSheet
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        userId={user?.id ?? null}
        currentWeightKg={currentWeightKg}
        // Profile fields needed for the PaceScreen's per-user TDEE math
        // (BMR × activityFactor → energy_balance_pct × timeline →
        // predicted lb delta for each pace option). Without these the
        // wizard falls back to a relative-% display instead of concrete
        // pound numbers.
        heightCm={profile?.current_height
          ? (profile.height_unit === 'imperial' ? profile.current_height * 2.54 : profile.current_height)
          : null}
        age={calcAge(profile?.birthdate)}
        gender={profile?.gender ?? null}
        // body_fat_band feeds the realism matrix + lean/fat split + Tier 3
        // amber warnings on the Pace step. When null the wizard auto-
        // prepends a BodyComp picker step so the user picks once.
        bodyFatBand={(profile as any)?.body_fat_band ?? null}
        // weight_unit drives EVERY weight + protein display in the
        // wizard (PaceScreen badges, MacrosScreen protein g/kg vs g/lb,
        // RealityCheckScreen outcome card). Math layer stays in
        // canonical kg + g/kg; only display converts. Defaults to 'lb'
        // when profile hasn't loaded the field yet.
        weightUnit={(profile?.weight_unit === 'kg' ? 'kg' : 'lb')}
        existingPlan={plan}
        startStep={wizardStep}
        singleScreen={wizardSingleScreen}
        onSaved={() => {
          // Bump stripRefreshKey to re-run the page-level Promise.all
          // load (line ~358) — picks up the new plan rows + recomputes
          // the daily target hero / macros / per-meal / etc.
          setStripRefreshKey(k => k + 1)
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
  result, plan, profile, TrendIcon, trendHue,
}: {
  result:    FullPlanResult
  plan:      CaloriePlan
  profile:   any
  TrendIcon: typeof TrendingUp
  trendHue:  string
}) {
  const tl = result.timeline
  if (!tl) return null
  // Goal already reached (sticky DB flag) → no timeline projection and no
  // "different directions" mismatch note; both are noise once the goal is hit.
  // The CurrentWeightGoal card carries the "what's next" prompt instead. Gated
  // on plan.goal_reached (NOT the live `goalReached` recompute, which is
  // suppressed for coach-managed clients) so it works for coached + self-
  // coached alike.
  if (plan.goal_reached) return null
  const pUnit = profile?.weight_unit || 'lb'

  // Self-coached alignment (May 24 2026 fix): when the user IS self-
  // coached AND their plan matches a known pace preset, use the
  // pace's locked `timeline_months` as the AUTHORITATIVE timeline
  // instead of the calcTimeline thermodynamic range. The wizard's
  // outcome screen displays the same number — so "the plan said
  // 2 months" agrees with "the timeline card said 2 months".
  //
  // Critically gated on profile.is_self_coached === true. Admin-
  // coached clients never went through the wizard — their plan was
  // set by an admin via the web panel with potentially arbitrary
  // energy_balance_pct values. Some of those values may COINCIDE
  // with a preset's pct (e.g. admin picks -0.15 which happens to
  // match Lose Steady), but that doesn't mean the client committed
  // to a 1-month timeline — they were just given a plan. For those
  // clients calcTimeline's thermodynamic range stays authoritative,
  // since it reflects what the admin actually set + how long that
  // adjustment realistically takes.
  const isSelfCoached = profile?.is_self_coached === true
  const paceKey       = isSelfCoached ? paceForPlan(plan.energy_balance_pct ?? null) : null
  const lockedMonths  = paceKey ? PACE_OPTIONS[paceKey].timeline_months : null
  // Single-number display when locked; range otherwise. Maintain pace
  // (timeline_months === 0) skips the override since there's no
  // commitment timeline for maintenance.
  const useLockedTimeline = lockedMonths != null && lockedMonths > 0

  // Shared timeline number renderer used by both recomp and standard
  // modes. Picks single-number ("~2 months") when self-coached and the
  // pace is locked, falls back to range ("~2–4 months") otherwise.
  // Type-narrowed parameter so TS knows monthsBest/Realistic exist —
  // mismatch mode never calls this (it has no months data).
  function renderTimelineNum(
    timeline: { monthsBest: number; monthsRealistic: number },
    numColor?: string,
  ) {
    let label: string
    let unit: string
    if (useLockedTimeline) {
      label = `${lockedMonths}`
      unit  = lockedMonths === 1 ? 'month' : 'months'
    } else {
      const b = timeline.monthsBest, r = timeline.monthsRealistic
      label = b === r ? `${b}` : `${b}–${r}`
      unit  = (b === 1 && r === 1) ? 'month' : 'months'
    }
    return (
      <View style={s.timelineNumRow}>
        <Text style={s.timelineApprox}>approx.</Text>
        <Text style={[s.timelineNum, numColor ? { color: numColor } : null]}>~{label}</Text>
        <Text style={s.timelineUnit}>{unit}</Text>
      </View>
    )
  }

  return (
    <AnimateRise delay={120}>
      <View style={s.cardLg}>
        {tl.mode === 'recomp' ? (
          <>
            <View style={s.timelineHeader}>
              <TrendIcon size={16} color={palette.purple[400]} />
              <Text style={s.cardHeading}>Body recomposition</Text>
            </View>
            {renderTimelineNum(tl, palette.purple[400])}
            {/* Message rewritten May 24 2026: previous copy said "your
                calorie target is balanced" which collided with the
                literal "Balanced" macro preset name — confusing for
                users on High-Protein / Keto / Performance who saw the
                text and thought it was misreading their pick. The
                recomp DETECTION in calcTimeline only checks small
                weight diff + mild energy adjustment; it doesn't filter
                on macro preset. So the copy is now macro-agnostic and
                describes only what actually triggers the mode. */}
            <Text style={s.timelineMsg}>
              Your goal is a small change and your calorie adjustment is gentle — this is recomposition territory.
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
            {renderTimelineNum(tl)}
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
              {tl.isLoss
                ? 'Best-case assumes full daily adherence. Realistic estimate accounts for cheat meals and rest days.'
                : 'Best-case assumes full daily adherence. Realistic estimate accounts for low-appetite days and missed meals.'}
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

/**
 * Bucket the user's progress 0..1 into one of the GOAL_MESSAGES keys.
 * Pure function (no randomness) — picking a message from the bucket
 * is a separate step done inside a useMemo keyed on bucket, so the
 * displayed message stays stable across re-renders (May 24 2026 bug
 * fix: the previous getGoalMessage() called pickMsg directly on every
 * render, which re-rolled the visible message every time the
 * AuthContext heartbeat / wizard-open / any state change re-rendered
 * the tree).
 */
function goalBucket(p: number): keyof typeof GOAL_MESSAGES {
  if (p >= 1.0)  return 'done'
  if (p >= 0.90) return 'final'
  if (p >= 0.75) return 'nearEnd'
  if (p >= 0.60) return 'dialled'
  if (p >= 0.45) return 'halfway'
  if (p >= 0.25) return 'committed'
  if (p >= 0.10) return 'building'
  if (p > 0)     return 'early'
  return 'zero'
}

function CurrentWeightGoal({
  result, plan, profile, latestBW, canEditPlanHere, openWizard,
  goalReached, onSwitchToMaintenance, onDismissGoalReached,
}: {
  result:           FullPlanResult
  plan:             CaloriePlan
  profile:          any
  latestBW:         BWRow | null
  /** True for self-coached non-admin users — they see the pencil + plan
      summary chips. Admin-coached clients and admins themselves see
      the card without the edit affordance. */
  canEditPlanHere:  boolean
  /** Wizard opener (passed down from parent so individual chips can
      deep-link to the right step). Pencil icon opens at the first
      step in full-wizard mode; chip taps open in single-screen mode. */
  openWizard:       (step?: 'pace' | 'activity' | 'macros', single?: boolean) => void
  /** True when the user just hit their goal AND hasn't dismissed the
      celebration yet. When true, the bottom of the card swaps the
      plan summary chips for the celebration block (🎉 message + 3
      action buttons). Drives behaviour the standalone goal-reached
      banner used to handle before the May 24 2026 merge. */
  goalReached:           boolean
  onSwitchToMaintenance: () => void
  onDismissGoalReached:  () => void
}) {
  const pUnit     = profile?.weight_unit || 'lb'
  const startKg   = plan.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
  const currentKg = latestBW
    ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
    : null
  const goalKg = result.goalWeightKg

  // Plan summary derivation — same lookups the standalone "My plan" card
  // used (now merged into this card per May 24 2026 UX rule). When the
  // plan was admin-tuned outside the preset grid, paceForPlan/
  // macroPresetForPlan return null and the chip falls back to "Custom".
  const paceKey       = paceForPlan(plan.energy_balance_pct ?? null)
  const paceText      = paceKey ? PACE_OPTIONS[paceKey].label : 'Custom'
  const macroKey      = macroPresetForPlan(plan.protein_level ?? null, plan.fat_level ?? null)
  // Replace the hyphen in "High-Protein" with a space so RN can wrap
  // cleanly at a word boundary inside the narrow chip. Without this,
  // RN falls back to character-level wrapping and we get "High-Protei"
  // + "n" on tight phone widths. Pure display normalization — the
  // stored MACRO_PRESETS[*].label keeps the hyphen for canonical use
  // everywhere else.
  const macroText     = macroKey
    ? MACRO_PRESETS[macroKey].label.replace('-', ' ')
    : 'Custom'
  const activityText  = plan.activity_factor != null
    ? (ACTIVITY_FACTORS[plan.activity_factor]?.label ?? '—')
    : '—'

  // Common card header — title on the left, pencil edit on the right
  // when the user can self-edit. Used by both the no-phase-start
  // fallback render below and the main render further down. Defined
  // inline so we don't have to thread props through a separate helper.
  const headerRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={s.cardHeading}>Current weight goal</Text>
      {canEditPlanHere && (
        <Pressable
          onPress={() => openWizard('activity', false)}
          hitSlop={8}
          style={s.goalEditBtn}
          accessibilityLabel="Edit plan"
        >
          <Pencil size={14} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  )

  // Plan summary row — shown at the bottom of the card so the weight
  // numbers + progress bar stay the focal point and the plan summary
  // reads as quiet context. Each chip is tappable for self-coached
  // users to deep-link into that specific wizard step. The 3 chips
  // are intentionally minimal — no body fat band (which lives in
  // Settings → Body stats) and no carb cap (Keto users see it in
  // the macros chip's "Keto" label).
  // Two-word labels (e.g. "Lose steady", "Moderately Active", "High
  // Protein") force a newline at the first space so all three chips
  // render on TWO lines, matching the visual rhythm of the wrapped
  // ones — May 24 2026 per user feedback. Single-word labels
  // ("Balanced", "Keto", "Performance", "Sedentary") stay on one line
  // and center vertically within the same fixed-height value area, so
  // the chips still look uniformly tall.
  const splitTwoWord = (s: string): string => {
    const i = s.indexOf(' ')
    return i > 0 ? `${s.slice(0, i)}\n${s.slice(i + 1)}` : s
  }
  // Bottom section has TWO mutually-exclusive modes (May 24 2026):
  //   • goalReached → celebration block (replaces the chips with 🎉
  //     + Update plan / Switch to maintenance / Keep going buttons)
  //   • otherwise   → plan summary chips
  // Both gated on canEditPlanHere (admin-coached users see neither —
  // the goal celebration for them lives in the admin Intake Plan tab).
  const planSummaryRow = canEditPlanHere ? (
    goalReached ? (
      <View style={s.planSummaryWrap}>
        <View style={s.planSummaryDivider} />
        <View style={s.goalReachedInlineRow}>
          <Text style={s.goalReachedEmoji}>🎉</Text>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.goalReachedTitle}>You hit your goal weight</Text>
            <Text style={s.goalReachedMsg}>
              Nice work. Update your plan to pick a new pace, switch to maintenance, or keep going on your current plan.
            </Text>
            <View style={s.goalReachedActions}>
              <Pressable style={s.goalReachedCTA} onPress={() => openWizard('activity', false)}>
                <Text style={s.goalReachedCTAText}>Update plan</Text>
              </Pressable>
              <Pressable style={s.goalReachedDismiss} onPress={onSwitchToMaintenance}>
                <Text style={s.goalReachedDismissText}>Switch to maintenance</Text>
              </Pressable>
              <Pressable style={s.goalReachedDismiss} onPress={onDismissGoalReached}>
                <Text style={s.goalReachedDismissText}>Keep going</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    ) : (
      <View style={s.planSummaryWrap}>
        <View style={s.planSummaryDivider} />
        <View style={s.planSummaryRow}>
          {[
            { k: 'activity' as const, label: 'Activity', value: splitTwoWord(activityText) },
            { k: 'pace'     as const, label: 'Pace',     value: splitTwoWord(paceText) },
            { k: 'macros'   as const, label: 'Macros',   value: splitTwoWord(macroText) },
          ].map(chip => (
            <Pressable
              key={chip.k}
              onPress={() => openWizard(chip.k, true)}
              style={s.planSummaryChip}
            >
              <Text style={s.planSummaryChipLabel}>{chip.label}</Text>
              <View style={s.planSummaryChipValueWrap}>
                <Text style={s.planSummaryChipValue} numberOfLines={2}>{chip.value}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    )
  ) : null

  // No-active-goal fallback. Triggered when:
  //   • goal_weight_kg is null (self-coached just tapped Keep going
  //     → plan is in "set a new target" limbo)
  //   • OR starting_weight_kg is missing (admin hasn't seeded the
  //     phase yet for an admin-coached client)
  //   • OR start ≈ goal (degenerate plan)
  // Two distinct UI branches inside this fallback:
  //   • canEditPlanHere → minimal "Plan complete — set a new one"
  //     state with a single Update plan button. Drops the stat row
  //     entirely (no plan to compare against). No chips. Pencil
  //     hides too since the Update plan button does the same job.
  //   • admin-coached    → "Your coach hasn't locked in" message
  //     (unchanged from pre-May-24-2026 behavior).
  // Maintenance state — user picked the Maintain pace (or hit Switch
  // to maintenance). Here `start ≈ goal ≈ current` AND
  // energy_balance_pct === 0. The standard stat row / progress bar
  // doesn't apply (nothing to progress toward — they're holding).
  // Show a dedicated UI: current weight + "On maintenance" message
  // + Update plan CTA. Self-coached only — admin-coached clients
  // fall through to the next branch which has its own messaging.
  const isMaintenancePhase =
    canEditPlanHere &&
    plan.energy_balance_pct != null &&
    Math.abs(plan.energy_balance_pct) < 0.005 &&
    !!startKg && !!goalKg &&
    Math.abs(startKg - goalKg) < 0.1
  if (isMaintenancePhase) {
    return (
      <AnimateRise delay={160}>
        <View style={s.cardLg}>
          {headerRow}
          <View style={s.maintenanceWrap}>
            <View style={s.maintenanceStatRow}>
              <Text style={s.goalSmallLabel}>HOLDING AT</Text>
              <Text style={s.maintenanceWeight}>
                {fromKg(currentKg ?? startKg, pUnit).toFixed(1)}<Text style={s.goalSmallUnit}> {pUnit}</Text>
              </Text>
            </View>
            <Text style={s.maintenanceMsg}>
              You're on maintenance — same calories in as out. Your daily target keeps you steady at this weight.
            </Text>
            {planSummaryRow}
          </View>
        </View>
      </AnimateRise>
    )
  }

  // No-active-goal fallback. Triggered when:
  //   • goal_weight_kg is null (self-coached just tapped Keep going
  //     → plan is in "set a new target" limbo)
  //   • OR starting_weight_kg is missing (admin hasn't seeded the
  //     phase yet for an admin-coached client)
  //   • OR start ≈ goal (degenerate plan that isn't maintenance —
  //     maintenance is caught above)
  // Two distinct UI branches inside this fallback:
  //   • canEditPlanHere → PendingView-style empty state (amber Flame
  //     icon + title + helper + lime CTA) — same chrome as the
  //     first-time "Set up your plan" surface so the user sees a
  //     familiar, inviting prompt instead of a dull text block.
  //   • admin-coached   → text-only "Your coach hasn't locked in"
  //     message (unchanged).
  if (!startKg || !goalKg || Math.abs(startKg - goalKg) < 0.1) {
    return (
      <AnimateRise delay={160}>
        <View style={s.cardLg}>
          <Text style={s.cardHeading}>Current weight goal</Text>
          {canEditPlanHere ? (
            <View style={s.noGoalEmpty}>
              <View style={s.pendingIcon}>
                <Flame size={32} color={palette.amber[400]} />
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={s.pendingTitle}>Set a new plan</Text>
                <Text style={s.pendingMsg}>
                  You wrapped your last phase. Pick your next pace, activity level, and how you eat to start your next target.
                </Text>
              </View>
              <Pressable style={s.pendingCTA} onPress={() => openWizard('activity', false)}>
                <Text style={s.pendingCTAText}>Set up my plan</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.timelineMsg}>
              Your coach hasn't locked in a phase starting weight yet. Once they do, your progress toward{' '}
              <Text style={s.timelineMsgEmph}>{fromKg(goalKg ?? 0, pUnit).toFixed(1)} {pUnit}</Text> will appear here.
            </Text>
          )}
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

  // Stabilize the motivational message — picks ONCE per bucket so the
  // visible text doesn't change on every re-render. Bucket is derived
  // from progress and only changes when the user crosses a milestone
  // (10%, 25%, 45%, 60%, 75%, 90%, 100%). Without this useMemo, the
  // AuthContext heartbeat (every 60s) + any state change (wizard open,
  // weigh-in, etc.) would re-roll pickMsg's random pick and the
  // visible message would shuffle constantly. See the May 24 2026
  // bug fix note on goalBucket() above.
  const bucket  = goalBucket(progress)
  const goalMsg = useMemo(() => pickMsg(GOAL_MESSAGES[bucket]), [bucket])

  return (
    <AnimateRise delay={160}>
      <View style={s.cardLg}>
        {headerRow}

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
          <Text style={s.goalMsgText}>{goalMsg}</Text>
        </View>

        {planSummaryRow}
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
  // Self-coached CTA inside the empty-state PendingView.
  pendingCTA: {
    marginTop: 12,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  pendingCTAText: { fontSize: 14, fontWeight: '700', color: colors.primaryForeground },

  // Pencil edit affordance — top right of the Current weight goal card.
  // Only renders for self-coached non-admin users (canEditPlanHere).
  goalEditBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.muted, 0.40),
    borderWidth: 1, borderColor: alpha(colors.border, 0.60),
  },
  // Plan summary row — sits at the bottom of the Current weight goal
  // card (May 24 2026 merge per UX rule). Three small tappable chips
  // show Activity / Pace / Macros and deep-link into the wizard. The
  // divider above gives it visual separation from the % progress
  // message without forcing a new card.
  planSummaryWrap: {
    gap: 10,
  },
  planSummaryDivider: {
    height: 1,
    backgroundColor: alpha(colors.border, 0.40),
  },
  planSummaryRow: {
    flexDirection: 'row',
    gap: 6,
  },
  planSummaryChip: {
    flex: 1,
    paddingVertical: 8,
    // Tightened from 10 → 6 (May 24 2026) so longer single-word
    // labels like "Performance" (11 chars) fit on one line without
    // RN falling back to character-level wrapping.
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: alpha(colors.border, 0.60),
    backgroundColor: alpha(colors.muted, 0.20),
    alignItems: 'center',
    gap: 2,
  },
  planSummaryChipLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  // Value wrap reserves a fixed 2-line area (32 px = lineHeight 16 × 2)
  // so all three chips render at the same height regardless of whether
  // the label is 1-word (centers single-line within the area) or
  // 2-word (fills both lines via the \n inserted by splitTwoWord).
  // May 24 2026 per user feedback — chips were previously
  // visually inconsistent because "Lose steady" sat on one line while
  // its neighbors wrapped to two.
  planSummaryChipValueWrap: {
    // 2 × lineHeight 15 = 30. Reserves space for the 2-line variants
    // (Lose\nsteady, Moderately\nActive, High\nProtein) so 1-word
    // labels (Performance, Keto, Balanced, Sedentary) stay vertically
    // centered within the same chip height.
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  planSummaryChipValue: {
    // Dropped from 12 → 11 (May 24 2026) for breathing room around
    // 11-char single-word labels (Performance) at narrow chip widths.
    fontSize: 11,
    fontWeight: '600',
    color: colors.foreground,
    textAlign: 'center',
    lineHeight: 15,
  },

  // Goal-reached celebration banner — self-coached users only.
  goalReachedCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14, marginBottom: 12,
    borderRadius: 12,
    backgroundColor: alpha(palette.emerald[500], 0.10),
    borderWidth: 1, borderColor: alpha(palette.emerald[500], 0.30),
  },
  goalReachedEmoji: { fontSize: 28, lineHeight: 32 },
  goalReachedTitle: { fontSize: 15, fontWeight: '700', color: palette.emerald[400] },
  goalReachedMsg:   { fontSize: 13, color: colors.mutedForeground, lineHeight: 18 },
  goalReachedCTA: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: palette.emerald[500],
  },
  goalReachedCTAText: { fontSize: 12, fontWeight: '700', color: '#000' },
  goalReachedDismiss: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1, borderColor: alpha(palette.emerald[400], 0.30),
  },
  goalReachedDismissText: { fontSize: 12, fontWeight: '600', color: palette.emerald[400] },
  // "No active plan" state — shown inside the Current weight goal
  // card when goal_weight_kg is null (self-coached after Keep going).
  // Mirrors PendingView's centered icon + title + msg + lime CTA so
  // the empty state reads as inviting / familiar, not dull. Lighter
  // vertical padding than PendingView (40 vs 80) since this lives
  // INSIDE a card while PendingView is a full-page surface.
  noGoalEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 16,
  },
  // Maintenance state — minimal info block when user is holding
  // steady. Shows current weight + a one-line context message. Plan
  // chips below give them quick access to switch back to a loss/gain
  // pace via the wizard.
  maintenanceWrap: {
    gap: 16,
  },
  maintenanceStatRow: {
    gap: 4,
  },
  maintenanceWeight: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.foreground,
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
  },
  maintenanceMsg: {
    fontSize: 13,
    color: colors.mutedForeground,
    lineHeight: 18,
  },
  // Inline celebration row added May 24 2026 — used when the goal-
  // reached celebration is embedded INSIDE the Current weight goal
  // card (in place of the plan summary chips). Same content as the
  // old standalone goalReachedCard but no card chrome of its own —
  // the surrounding card provides the chrome.
  goalReachedInlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 4,
  },
  goalReachedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },

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
