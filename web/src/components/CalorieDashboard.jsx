/**
 * CalorieDashboard — read-only coach mirror of the athlete Calories dashboard.
 *
 * Renders the same cards the athlete sees (daily intake strip with its trend
 * chart, daily-target hero, daily macros, per-meal split, today's intake,
 * timeline, weight goal) — but READ-ONLY and in the COACH's units.
 *
 * Faithful to mobile app/(app)/calories.tsx + the (deleted) web Calories.jsx.
 * Dropped vs the athlete page (those are self-coached editing affordances the
 * coach doesn't use here — the coach edits the plan from the Macro Plan tab and
 * manages entries from the Food Log tab):
 *   • PlanWizardSheet, "My plan" edit chips
 *   • FoodLogDrawer (no inline food logging)
 *   • goal-reached banner + actions
 *   • per-meal number editing (display-only here)
 *
 * Units rule (coach sees client data in the coach's units): every WEIGHT/height
 * DISPLAY converts to the coach's unit; the underlying math (calcFullPlan) runs
 * on the CLIENT profile so BMR/TDEE/target are correct regardless.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { calcFullPlan, calcPerMeal, calcAge, ACTIVITY_FACTORS } from '../lib/calorieFormulas'
import { Flame, TrendingDown, TrendingUp, Utensils, X, UtensilsCrossed } from 'lucide-react'
import CalorieStrip from './CalorieStrip'
import TickerNumber from './TickerNumber'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fromKg(kg, unit) {
  return unit === 'lb' ? kg / 0.453592 : kg
}
function fmtWeight(kg, unit) {
  return `${fromKg(kg, unit).toFixed(1)} ${unit}`
}

function getEnergyLabel(pct) {
  if (pct <= -40) return 'Aggressive fat loss'
  if (pct <= -25) return 'High fat loss'
  if (pct <= -15) return 'Moderate fat loss'
  if (pct <= -5)  return 'Gradual fat loss'
  if (pct <   5)  return 'Maintenance'
  if (pct <  15)  return 'Gradual muscle gain'
  if (pct <  25)  return 'Moderate muscle gain'
  if (pct <  40)  return 'High muscle gain'
  return 'Aggressive bulk'
}

// ── MacroBar ──────────────────────────────────────────────────────────────────

function MacroBar({ protein, fat, carbs }) {
  const total = protein + fat + carbs
  if (total === 0) return null
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full">
      <div className="bg-blue-400 transition-all"    style={{ width: `${(protein / total) * 100}%` }} />
      <div className="bg-amber-400 transition-all"   style={{ width: `${(fat     / total) * 100}%` }} />
      <div className="bg-emerald-400 transition-all" style={{ width: `${(carbs   / total) * 100}%` }} />
    </div>
  )
}

function MacroChip({ label, grams, pct, kcal, color, bg }) {
  return (
    <div className={`flex flex-col items-center rounded-xl border p-4 ${bg}`}>
      <span className={`text-2xl font-bold tabular-nums ${color}`}><TickerNumber value={grams} /><span className="text-base font-normal ml-0.5">g</span></span>
      <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
      <span className="text-[11px] text-muted-foreground/60 mt-1">{kcal} kcal · {pct}%</span>
    </div>
  )
}

// ── Today's intake (read-only — no Log-food button) ────────────────────────────

function TodayIntakeCard({ entries, dailyTarget, macroTargets }) {
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  )

  const hasData   = totals.calories > 0
  const target    = dailyTarget ?? 0
  const remaining = target - Math.round(totals.calories)
  const isOver    = remaining < 0

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
    <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Today's Intake</h2>
      </div>

      {hasData ? (
        <>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tabular-nums text-red-400">
                  {Math.round(totals.calories).toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">kcal</span>
              </div>
              {target > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  of {target.toLocaleString()} kcal target
                </p>
              )}
            </div>
            {target > 0 && (
              <div className="text-right">
                <p className={`text-sm font-semibold tabular-nums ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                  {isOver ? '+' : ''}{Math.abs(remaining).toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {isOver ? 'over target' : 'remaining'}
                </p>
              </div>
            )}
          </div>

          {target > 0 && (
            <div className="space-y-1.5">
              <div className="relative h-4 rounded-full bg-muted/40 overflow-hidden">
                <div className="absolute top-0 left-0 h-full bg-blue-400/80 rounded-l-full transition-all duration-500" style={{ width: `${pWidth}%` }} />
                <div className="absolute top-0 h-full bg-amber-400/80 transition-all duration-500" style={{ left: `${pWidth}%`, width: `${fWidth}%` }} />
                <div className="absolute top-0 h-full bg-emerald-400/80 transition-all duration-500" style={{ left: `${pWidth + fWidth}%`, width: `${cWidth}%` }} />
                <div className="absolute top-0 h-full w-0.5 bg-muted-foreground/50 transition-all duration-500" style={{ left: `${targetPct}%` }} />
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400/80 shrink-0" />P {Math.round(totals.protein)}g</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400/80 shrink-0" />F {Math.round(totals.fat)}g</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400/80 shrink-0" />C {Math.round(totals.carbs)}g</span>
              </div>
            </div>
          )}

          {macroTargets && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Protein', val: totals.protein, target: macroTargets.protein, color: 'text-blue-400',    bar: 'bg-blue-400',    bg: 'border-blue-500/20 bg-blue-500/5'    },
                { label: 'Fat',     val: totals.fat,     target: macroTargets.fat,     color: 'text-amber-400',   bar: 'bg-amber-400',   bg: 'border-amber-500/20 bg-amber-500/5'   },
                { label: 'Carbs',   val: totals.carbs,   target: macroTargets.carbs,   color: 'text-emerald-400', bar: 'bg-emerald-400', bg: 'border-emerald-500/20 bg-emerald-500/5' },
              ].map(({ label, val, target: t, color, bar, bg }) => {
                const pct   = t > 0 ? Math.round((val / t) * 100) : null
                const isOvr = t > 0 && val > t
                const fillPct = t > 0 ? Math.min(100, (val / t) * 100) : 0
                const ovrPct  = isOvr ? Math.min(100, ((val - t) / t) * 100) : 0
                return (
                  <div key={label} className={`rounded-xl border p-3 ${bg}`}>
                    <p className={`text-base font-bold tabular-nums leading-none ${color}`}>
                      {Math.round(val)}<span className="text-xs font-normal">g</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                    {t > 0 && (
                      <>
                        <div className="relative h-1 rounded-full bg-muted/40 mt-1.5 overflow-hidden">
                          <div className={`absolute top-0 left-0 h-full rounded-full transition-all ${bar}`} style={{ width: `${fillPct}%` }} />
                          {isOvr && (
                            <div className="absolute top-0 h-full rounded-full bg-red-400 transition-all" style={{ left: `${fillPct}%`, width: `${ovrPct}%` }} />
                          )}
                        </div>
                        <p className={`text-[10px] tabular-nums mt-1 ${isOvr ? 'text-red-400' : 'text-muted-foreground/60'}`}>
                          /{Math.round(t)}g · {pct}%
                        </p>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="py-4 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
            <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Nothing logged yet today</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              This client hasn't logged any food today
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function CalorieDashboard({ userId, profile, plan }) {
  const { profile: coachProfile } = useAuth()
  const wUnit = coachProfile?.weight_unit === 'kg' ? 'kg' : 'lb'
  const hUnit = coachProfile?.height_unit === 'metric' ? 'metric' : 'imperial'

  const [latestBW, setLatestBW]         = useState(null)
  const [todayEntries, setTodayEntries] = useState([])
  const [activePill, setActivePill]     = useState(null)

  const TODAY = isoToday()

  useEffect(() => {
    if (!userId) return
    supabase
      .from('bodyweight')
      .select('weight, unit')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatestBW(data ?? null))
    supabase
      .from('food_logs')
      .select('id, meal_slot, food_name, calories, protein_g, fat_g, carbs_g')
      .eq('user_id', userId)
      .eq('log_date', TODAY)
      .then(({ data }) => setTodayEntries(data || []))
  }, [userId, TODAY])

  // Current weight in kg — latest weigh-in, else profile.current_weight.
  const currentWeightKg = useMemo(() => {
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

  const result = useMemo(() => {
    if (!plan || !profile) return null
    try { return calcFullPlan(profile, plan, currentWeightKg) }
    catch { return null }
  }, [plan, profile, currentWeightKg])

  const meals   = plan?.meals ?? null
  const perMeal = useMemo(() => {
    if (!result || meals == null) return null
    return calcPerMeal(result.macros, result.dailyTarget, meals)
  }, [result, meals])

  const macroTargets = result ? {
    protein: result.macros.protein.grams,
    fat:     result.macros.fat.grams,
    carbs:   result.macros.carbs.grams,
  } : null

  const isLoss    = result ? result.energyAdj < 0 : false
  const TrendIcon = isLoss ? TrendingDown : TrendingUp
  const trendHue  = isLoss ? 'emerald' : 'blue'

  return (
    <div className="space-y-5">

      {/* Daily intake strip + trend chart (display-only for the coach) */}
      <CalorieStrip userId={userId} dailyTarget={result?.dailyTarget ?? null} />

      {/* No plan yet */}
      {!plan && (
        <>
          <TodayIntakeCard entries={todayEntries} dailyTarget={null} macroTargets={null} />
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold">No intake plan yet</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This client doesn't have a calorie plan. Set one in the <span className="font-medium text-foreground">Macro Plan</span> tab to give them daily targets.
            </p>
          </div>
        </>
      )}

      {/* Plan set but profile missing data → no computable result */}
      {plan && !result && (
        <>
          <TodayIntakeCard entries={todayEntries} dailyTarget={null} macroTargets={null} />
          <div className="rounded-2xl border border-border bg-card py-10 px-5 text-center">
            <p className="text-sm text-muted-foreground">
              A plan is set but this client's profile is missing data (weight, height, gender, or birthdate),
              so we can't compute their calorie target.
            </p>
          </div>
        </>
      )}

      {result && plan && (
        <>
          {/* Daily target hero */}
          <div className="animate-rise rounded-2xl border border-border bg-card p-6 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <Flame className="h-4 w-4 text-red-400" />
              Daily calorie target
            </div>
            <div className="text-6xl font-bold tabular-nums text-red-400">
              <TickerNumber value={result.dailyTarget} />
            </div>
            <div className="text-sm text-muted-foreground">kcal / day</div>

            {/* BMR / TDEE / Energy pills */}
            <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
              {[
                { id: 'bmr',  label: 'BMR',  value: `${result.bmr} kcal`,  cls: activePill === 'bmr'
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-red-500/30 hover:text-foreground' },
                { id: 'tdee', label: 'TDEE', value: `${result.tdee} kcal`, cls: activePill === 'tdee'
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-red-500/30 hover:text-foreground' },
              ].map(({ id, label, value, cls }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActivePill(p => p === id ? null : id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${cls}`}
                >
                  {label} <span className="tabular-nums">{value}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActivePill(p => p === 'energy' ? null : 'energy')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  activePill === 'energy'
                    ? (isLoss
                        ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300'
                        : 'border-blue-400/50   bg-blue-500/15   text-blue-300')
                    : (isLoss
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-400/50'
                        : 'border-blue-500/30   bg-blue-500/10   text-blue-400   hover:border-blue-400/50')
                }`}
              >
                <TrendIcon className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                {isLoss ? '−' : '+'}{Math.abs(result.energyAdj)} kcal
              </button>
            </div>

            {/* Dynamic description panel */}
            {(() => {
              const weightDisplay = currentWeightKg != null ? fmtWeight(currentWeightKg, wUnit) : '—'
              const heightCm = profile?.current_height != null
                ? (profile.height_unit === 'imperial' ? profile.current_height * 2.54 : Number(profile.current_height))
                : null
              const heightDisplay = heightCm == null ? '—'
                : (hUnit === 'imperial'
                    ? `${Math.floor((heightCm / 2.54) / 12)}'${Math.round((heightCm / 2.54) % 12)}"`
                    : `${Math.round(heightCm)} cm`)
              const age = calcAge(profile?.birthdate)
              const activity = ACTIVITY_FACTORS[plan.activity_factor]
              const energyPct = plan.energy_balance_pct != null
                ? Math.round(plan.energy_balance_pct * 100)
                : Math.round((result.energyAdj / result.tdee) * 100)
              const energyLabel = getEnergyLabel(energyPct)
              // Coach view: BMR/TDEE/energy are OPT-IN info pills (collapsed by
              // default). No always-visible athlete-education prose — per the
              // coach-mirror "strip athlete-only explanatory copy" rule (T086).
              if (!activePill) return null

              let title, body
              if (activePill === 'bmr') {
                title = 'Basal Metabolic Rate (BMR)'
                body = (
                  <>
                    BMR is the calories the body burns at complete rest — what they'd burn staying in bed all day, just staying alive. Theirs is{' '}
                    <span className="font-semibold text-foreground tabular-nums">{result.bmr} kcal</span>, from their weight ({weightDisplay}), height ({heightDisplay}), and age ({age ?? '—'} yrs).
                  </>
                )
              } else if (activePill === 'tdee') {
                title = 'Total Daily Energy Expenditure (TDEE)'
                body = (
                  <>
                    TDEE is the total calories burned in a typical day — BMR plus movement, exercise, and digestion. Theirs is{' '}
                    <span className="font-semibold text-foreground tabular-nums">{result.tdee} kcal</span>: BMR ({result.bmr}) at <span className="font-medium text-foreground">{activity?.label?.toLowerCase()}</span>. Eating this much holds weight steady.
                  </>
                )
              } else if (activePill === 'energy') {
                title = `Energy balance · ${energyLabel}`
                body = (
                  <>
                    Energy balance is the gap between intake and expenditure. Theirs is{' '}
                    <span className={`font-semibold tabular-nums ${isLoss ? 'text-emerald-400' : 'text-blue-400'}`}>
                      {result.energyAdj > 0 ? '+' : ''}{result.energyAdj} kcal/day
                    </span>{' '}
                    ({energyPct > 0 ? '+' : ''}{energyPct}% of TDEE), set as <span className="font-medium text-foreground">{energyLabel}</span>. Added to TDEE ({result.tdee}), this gives a daily target of{' '}
                    <span className="font-semibold text-red-400 tabular-nums">{result.dailyTarget} kcal</span>.
                  </>
                )
              }

              return (
                <div className="mt-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-left relative">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
                    {activePill && (
                      <button
                        type="button"
                        onClick={() => setActivePill(null)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Close"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              )
            })()}

            <p className="text-xs text-muted-foreground pt-1">
              {ACTIVITY_FACTORS[plan.activity_factor]?.label}
            </p>
          </div>

          {/* Daily macros */}
          <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '40ms' }}>
            <h2 className="text-sm font-semibold">Daily macros</h2>
            <MacroBar
              protein={result.macros.protein.grams}
              fat={result.macros.fat.grams}
              carbs={result.macros.carbs.grams}
            />
            <div className="grid grid-cols-3 gap-3">
              <MacroChip label="Protein" grams={result.macros.protein.grams} pct={result.macros.protein.pct} kcal={result.macros.protein.calories} color="text-blue-400"    bg="border-blue-500/20 bg-blue-500/5" />
              <MacroChip label="Fat"     grams={result.macros.fat.grams}     pct={result.macros.fat.pct}     kcal={result.macros.fat.calories}     color="text-amber-400"   bg="border-amber-500/20 bg-amber-500/5" />
              <MacroChip label="Carbs"   grams={result.macros.carbs.grams}   pct={result.macros.carbs.pct}   kcal={result.macros.carbs.calories}   color="text-emerald-400" bg="border-emerald-500/20 bg-emerald-500/5" />
            </div>
          </div>

          {/* Per-meal breakdown (read-only) */}
          <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Per meal</h2>
              </div>
              {meals != null && (
                <div className="flex items-center gap-1">
                  {[2, 3, 4, 5, 6].map(n => (
                    <span
                      key={n}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                        meals === n
                          ? 'bg-lime-500 border-lime-500 text-white'
                          : 'border-border text-muted-foreground/50'
                      }`}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {meals == null ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This client hasn't chosen a meal split yet.
              </p>
            ) : perMeal ? (
              <>
                <div className="flex flex-col items-center rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <span className="text-2xl font-bold tabular-nums text-red-400">
                    {perMeal.calories}<span className="text-base font-bold ml-0.5">kcal</span>
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">Calories per meal</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'Protein', value: `${perMeal.protein}g`, kcal: perMeal.protein * 4, color: 'text-blue-400',    bg: 'border-blue-500/20 bg-blue-500/5'    },
                    { label: 'Fat',     value: `${perMeal.fat}g`,     kcal: perMeal.fat * 9,     color: 'text-amber-400',   bg: 'border-amber-500/20 bg-amber-500/5'   },
                    { label: 'Carbs',   value: `${perMeal.carbs}g`,   kcal: perMeal.carbs * 4,   color: 'text-emerald-400', bg: 'border-emerald-500/20 bg-emerald-500/5' },
                  ].map(({ label, value, kcal, color, bg }) => (
                    <div key={label} className={`flex flex-col items-center rounded-xl border p-4 ${bg}`}>
                      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
                      <span className="text-[11px] text-muted-foreground/60 mt-1">{Math.round(kcal)} kcal</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  Split across {meals} meals a day.
                </p>
              </>
            ) : null}
          </div>

          {/* Today's intake (read-only) */}
          <TodayIntakeCard entries={todayEntries} dailyTarget={result.dailyTarget} macroTargets={macroTargets} />

          {/* Timeline */}
          {result.timeline && (
            <div className="animate-rise rounded-2xl border border-border bg-card p-5" style={{ animationDelay: '120ms' }}>
              {result.timeline.mode === 'recomp' ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendIcon className="h-4 w-4 text-purple-400" />
                    <h2 className="text-sm font-semibold">Body recomposition</h2>
                  </div>
                  {(() => {
                    const { monthsBest: b, monthsRealistic: r } = result.timeline
                    const label = b === r ? `${b}` : `${b}–${r}`
                    const unit  = (b === 1 && r === 1) ? 'month' : 'months'
                    return (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] text-muted-foreground">approx.</span>
                        <span className="text-3xl font-bold tabular-nums text-purple-400">~{label}</span>
                        <span className="text-sm text-muted-foreground">{unit}</span>
                      </div>
                    )
                  })()}
                </>
              ) : result.timeline.mode === 'mismatch' ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendIcon className="h-4 w-4 text-amber-400" />
                    <h2 className="text-sm font-semibold">Plan note</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The goal weight and calorie target are pulling in different directions — worth aligning them.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendIcon className={`h-4 w-4 text-${trendHue}-400`} />
                    <h2 className="text-sm font-semibold">Estimated timeline</h2>
                  </div>
                  {(() => {
                    const { monthsBest: b, monthsRealistic: r } = result.timeline
                    const label = b === r ? `${b}` : `${b}–${r}`
                    const unit  = (b === 1 && r === 1) ? 'month' : 'months'
                    return (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] text-muted-foreground">approx.</span>
                        <span className="text-3xl font-bold tabular-nums">~{label}</span>
                        <span className="text-sm text-muted-foreground">{unit}</span>
                      </div>
                    )
                  })()}
                  <p className="text-sm text-muted-foreground mt-1">
                    to {result.timeline.isLoss ? 'lose' : 'gain'}{' '}
                    <span className="font-medium text-foreground">{fromKg(result.timeline.weightDiffKg, wUnit).toFixed(1)} {wUnit}</span>
                    {result.goalWeightKg && (
                      <> and reach the goal weight of <span className="font-medium text-foreground">{fmtWeight(result.goalWeightKg, wUnit)}</span></>
                    )}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Current weight goal */}
          {result.goalWeightKg && (() => {
            const startKg = plan.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
            const currentKg = currentWeightKg
            const goalKg = result.goalWeightKg

            if (!startKg || !goalKg || Math.abs(startKg - goalKg) < 0.1) {
              return (
                <div className="animate-rise rounded-2xl border border-border bg-card p-5" style={{ animationDelay: '160ms' }}>
                  <h2 className="text-sm font-semibold mb-2">Current weight goal</h2>
                  <p className="text-sm text-muted-foreground">
                    No phase starting weight locked in yet. Once it's set, progress toward{' '}
                    <span className="font-medium text-foreground">{fromKg(goalKg, wUnit).toFixed(1)} {wUnit}</span> will appear here.
                  </p>
                </div>
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

            const pct = Math.round(progress * 100)
            const hue      = Math.round(progress * 142)
            const barStyle = { width: `${progress * 100}%`, backgroundColor: `hsl(${hue}, 70%, 48%)` }
            const pctColor = `hsl(${hue}, 70%, 55%)`

            // Neutral coach-facing status line (the athlete page shows a random
            // motivational message addressed to the athlete — not appropriate
            // for a coach reviewing the client).
            const statusLine = progress >= 1
              ? 'Goal weight reached.'
              : currentKg == null
                ? 'No weigh-in logged yet this phase.'
                : `${pct}% of the way from phase start to goal weight.`

            return (
              <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '160ms' }}>
                <h2 className="text-sm font-semibold">Current weight goal</h2>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Phase start</p>
                    <p className="text-lg font-bold tabular-nums">
                      {fromKg(startKg, wUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{wUnit}</span>
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current</p>
                    {currentKg != null ? (
                      <p className="text-lg font-bold tabular-nums">
                        {fromKg(currentKg, wUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{wUnit}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground/50">No weigh-in</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Goal</p>
                    <p className="text-lg font-bold tabular-nums">
                      {fromKg(goalKg, wUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{wUnit}</span>
                    </p>
                  </div>
                </div>

                <div className="relative h-3">
                  <div className="absolute inset-0 rounded-full bg-muted/40" />
                  <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={barStyle} />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full border-2 border-background shadow-md transition-all duration-500"
                    style={{ left: `${Math.max(2, progress * 100)}%`, backgroundColor: `hsl(${hue}, 70%, 48%)` }}
                  />
                </div>

                <div className="flex items-start gap-3">
                  <div className="shrink-0 text-center min-w-[2.5rem]">
                    <p className="text-2xl font-bold tabular-nums" style={{ color: pctColor }}>{pct}</p>
                    <p className="text-[10px] text-muted-foreground -mt-0.5">%</p>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pt-0.5">{statusLine}</p>
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
