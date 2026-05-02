import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  calcFullPlan, calcPerMeal, calcAge,
  ACTIVITY_FACTORS, ENERGY_BALANCE_TYPES,
} from '../lib/calorieFormulas'
import {
  Flame, Clock, TrendingDown, TrendingUp, Utensils,
  X, Plus, UtensilsCrossed,
} from 'lucide-react'
import CalorieStrip from '../components/CalorieStrip'
import FoodLogDrawer from '../components/FoodLogDrawer'
import TickerNumber from '../components/TickerNumber'

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

// ── MacroBar (for daily targets section) ─────────────────────────────────────

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

// ── Today's Intake Card ───────────────────────────────────────────────────────
// Segmented horizontal intake bar — not a ring.

function TodayIntakeCard({ entries, dailyTarget, macroTargets, onLogFood }) {
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  )

  const hasData    = totals.calories > 0
  const target     = dailyTarget ?? 0
  const remaining  = target - Math.round(totals.calories)
  const isOver     = remaining < 0

  // Macro segment widths — each segment = macro kcal proportion of the bar track
  // protein = 4 kcal/g, fat = 9 kcal/g, carbs = 4 kcal/g
  const proteinKcal = totals.protein * 4
  const fatKcal     = totals.fat     * 9
  const carbsKcal   = totals.carbs   * 4
  const totalKcal   = proteinKcal + fatKcal + carbsKcal

  // Bar track = max(target, consumed) — ensures all segments are always visible
  // even when over-target. Each segment is its share of the full consumed amount,
  // then scaled so the track represents exactly the larger of the two.
  const trackKcal = target > 0 ? Math.max(target, totalKcal) : totalKcal || 300
  const pWidth    = totalKcal > 0 ? (proteinKcal / trackKcal) * 100 : 0
  const fWidth    = totalKcal > 0 ? (fatKcal     / trackKcal) * 100 : 0
  const cWidth    = totalKcal > 0 ? (carbsKcal   / trackKcal) * 100 : 0
  // Where on the bar the target marker sits (100% = end of track)
  const targetPct = target > 0 && trackKcal > 0 ? (target / trackKcal) * 100 : 100

  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Today's Intake</h2>
        <button
          type="button"
          onClick={onLogFood}
          className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <Plus className="h-3 w-3" /> Log food
        </button>
      </div>

      {hasData ? (
        <>
          {/* Big calorie number */}
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

          {/* Segmented intake bar */}
          {target > 0 && (
            <div className="space-y-1.5">
              <div className="relative h-4 rounded-full bg-muted/40 overflow-hidden">
                {/* Protein */}
                <div
                  className="absolute top-0 left-0 h-full bg-blue-400/80 rounded-l-full transition-all duration-500"
                  style={{ width: `${pWidth}%` }}
                />
                {/* Fat */}
                <div
                  className="absolute top-0 h-full bg-amber-400/80 transition-all duration-500"
                  style={{ left: `${pWidth}%`, width: `${fWidth}%` }}
                />
                {/* Carbs */}
                <div
                  className="absolute top-0 h-full bg-emerald-400/80 transition-all duration-500"
                  style={{ left: `${pWidth + fWidth}%`, width: `${cWidth}%` }}
                />
                {/* Target needle — sits at the exact % of the track that = daily target */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-muted-foreground/50 transition-all duration-500"
                  style={{ left: `${targetPct}%` }}
                />
              </div>

              {/* Macro labels */}
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400/80 shrink-0" />P {Math.round(totals.protein)}g</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400/80 shrink-0" />F {Math.round(totals.fat)}g</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400/80 shrink-0" />C {Math.round(totals.carbs)}g</span>
              </div>
            </div>
          )}

          {/* Macro vs target chips */}
          {macroTargets && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Protein', val: totals.protein,  target: macroTargets.protein, color: 'text-blue-400',    bar: 'bg-blue-400',    bg: 'border-blue-500/20 bg-blue-500/5'    },
                { label: 'Fat',     val: totals.fat,       target: macroTargets.fat,     color: 'text-amber-400',   bar: 'bg-amber-400',   bg: 'border-amber-500/20 bg-amber-500/5'   },
                { label: 'Carbs',   val: totals.carbs,     target: macroTargets.carbs,   color: 'text-emerald-400', bar: 'bg-emerald-400', bg: 'border-emerald-500/20 bg-emerald-500/5' },
              ].map(({ label, val, target: t, color, bar, bg }) => {
                const pct   = t > 0 ? Math.round((val / t) * 100) : null
                const isOvr = t > 0 && val > t
                // Bar fill: capped at 100% in normal colour; overflow segment in red
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
                        {/* Progress bar */}
                        <div className="relative h-1 rounded-full bg-muted/40 mt-1.5 overflow-hidden">
                          <div className={`absolute top-0 left-0 h-full rounded-full transition-all ${bar}`}
                               style={{ width: `${fillPct}%` }} />
                          {isOvr && (
                            <div className="absolute top-0 h-full rounded-full bg-red-400 transition-all"
                                 style={{ left: `${fillPct}%`, width: `${ovrPct}%` }} />
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
        /* Empty state */
        <div className="py-4 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
            <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Nothing logged yet today</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Tap "Log food" to start tracking your intake
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pending state ─────────────────────────────────────────────────────────────

function PendingView() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
        <Clock className="h-8 w-8 text-amber-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Your plan is on its way</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-xs">
          Your personalised calorie plan is being prepared. Check back soon — it'll be ready before you know it.
        </p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Calories() {
  const { user, profile } = useAuth()
  const [plan, setPlan]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [meals, setMealsState]  = useState(null)
  const [activePill, setActivePill] = useState(null)
  const [latestBW, setLatestBW] = useState(null)

  // ── Food log drawer ──────────────────────────────────────────────────────
  const [drawerDay, setDrawerDay]       = useState(null)   // ISO date string or null
  const [stripRefreshKey, setStripRefreshKey] = useState(0)
  const [todayEntries, setTodayEntries] = useState([])     // for TodayIntakeCard

  const TODAY = isoToday()

  // Fetch today's food log entries for TodayIntakeCard
  useEffect(() => {
    if (!user) return
    supabase
      .from('food_logs')
      .select('id, meal_slot, food_name, calories, protein_g, fat_g, carbs_g')
      .eq('user_id', user.id)
      .eq('log_date', TODAY)
      .then(({ data }) => { if (data) setTodayEntries(data) })
  }, [user, TODAY, stripRefreshKey])

  // Called by FoodLogDrawer whenever its entries change
  function handleDrawerEntriesChange(day, entries) {
    if (day === TODAY) {
      setTodayEntries(entries)
    }
    // Always bump the strip refresh so calorie sums update
    setStripRefreshKey(k => k + 1)
  }

  // ── Plan + body data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    supabase
      .from('calorie_plans')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error)
        setPlan(data)
        setMealsState(data?.meals ?? null)
        setLoading(false)
      })
    supabase
      .from('bodyweight')
      .select('weight, unit')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setLatestBW(data) })
  }, [user])

  function setMeals(updater) {
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

  const result = useMemo(() => {
    if (!plan || !profile) return null
    // Pass latest logged bodyweight so the timeline reflects real progress
    const currentKgOverride = latestBW
      ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
      : null
    return calcFullPlan(profile, plan, currentKgOverride)
  }, [plan, profile, latestBW])

  const perMeal = useMemo(() => {
    if (!result || meals == null) return null
    return calcPerMeal(result.macros, result.dailyTarget, meals)
  }, [result, meals])

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
    )
  }

  if (!plan) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calories</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your daily calorie and macro targets.</p>
        </div>
        <div className="rounded-xl border border-border bg-card">
          <PendingView />
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calories</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your daily calorie and macro targets.</p>
        </div>
        <div className="rounded-xl border border-border bg-card py-14 text-center">
          <p className="text-sm text-muted-foreground">
            Your plan is set but your profile is missing some data (weight, height, gender, or birthdate).
            Complete your profile to see your numbers.
          </p>
        </div>
      </div>
    )
  }

  const isLoss    = result.energyAdj < 0
  const TrendIcon = isLoss ? TrendingDown : TrendingUp
  const trendHue  = isLoss ? 'emerald' : 'blue'

  const macroTargets = {
    protein: result.macros.protein.grams,
    fat:     result.macros.fat.grams,
    carbs:   result.macros.carbs.grams,
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Calories</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Your personalised daily calorie and macro targets.</p>
      </div>

      {/* Daily intake strip */}
      <CalorieStrip
        dailyTarget={result?.dailyTarget}
        onDayClick={setDrawerDay}
        selectedIso={drawerDay}
        refreshKey={stripRefreshKey}
      />

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

        {/* Clickable BMR / TDEE / Energy pills */}
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
          const age = calcAge(profile?.birthdate)
          const activity = ACTIVITY_FACTORS[plan.activity_factor]
          const energyPct = plan.energy_balance_pct != null
            ? Math.round(plan.energy_balance_pct * 100)
            : Math.round((result.energyAdj / result.tdee) * 100)
          const energyLabel = getEnergyLabel(energyPct)
          const adjAbs = Math.abs(result.energyAdj)
          const adjWord = result.energyAdj < 0 ? 'minus' : result.energyAdj > 0 ? 'plus' : null

          let title, body
          if (activePill === 'bmr') {
            title = 'Basal Metabolic Rate (BMR)'
            body = (
              <>
                BMR is the calories your body burns at complete rest — what you'd burn if you stayed in bed all day, just keeping you alive. Yours is{' '}
                <span className="font-semibold text-foreground tabular-nums">{result.bmr} kcal</span>, calculated from your weight ({weightDisplay}), height ({heightDisplay}), and age ({age ?? '—'} yrs). As you grow, your metrics will too — and so will your BMR.
              </>
            )
          } else if (activePill === 'tdee') {
            title = 'Total Daily Energy Expenditure (TDEE)'
            body = (
              <>
                TDEE is the total calories you burn in a typical day — your BMR plus everything you spend through movement, exercise, and even digestion. Yours is{' '}
                <span className="font-semibold text-foreground tabular-nums">{result.tdee} kcal</span>: your BMR ({result.bmr}) considering you're <span className="font-medium text-foreground">{activity?.label?.toLowerCase()}</span>. Eating exactly this much would keep your weight stable.
              </>
            )
          } else if (activePill === 'energy') {
            title = `Energy balance · ${energyLabel}`
            body = (
              <>
                Energy balance is the gap between what you eat and what you burn. Yours is{' '}
                <span className={`font-semibold tabular-nums ${isLoss ? 'text-emerald-400' : 'text-blue-400'}`}>
                  {result.energyAdj > 0 ? '+' : ''}{result.energyAdj} kcal/day
                </span>{' '}
                ({energyPct > 0 ? '+' : ''}{energyPct}% of TDEE), set by your coach as <span className="font-medium text-foreground">{energyLabel}</span>. Added to your TDEE ({result.tdee}), this gives you a daily target of{' '}
                <span className="font-semibold text-red-400 tabular-nums">{result.dailyTarget} kcal</span>.
              </>
            )
          } else {
            title = 'Daily calorie target'
            body = (
              <>
                This is how many calories you should aim to eat each day to move toward your goal. It's your TDEE ({result.tdee}){adjWord ? <> {adjWord} your energy balance of {adjAbs}</> : ''}, giving you{' '}
                <span className="font-semibold text-red-400 tabular-nums">{result.dailyTarget} kcal/day</span>. Hit this consistently and your body will go where the plan is pointing. Tap any pill above to learn more about that number.
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

        {/* Plan label */}
        <p className="text-xs text-muted-foreground pt-1">
          {ACTIVITY_FACTORS[plan.activity_factor]?.label}
        </p>
      </div>

      {/* Macros */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '40ms' }}>
        <h2 className="text-sm font-semibold">Daily macros</h2>

        <MacroBar
          protein={result.macros.protein.grams}
          fat={result.macros.fat.grams}
          carbs={result.macros.carbs.grams}
        />

        <div className="grid grid-cols-3 gap-3">
          <MacroChip
            label="Protein"
            grams={result.macros.protein.grams}
            pct={result.macros.protein.pct}
            kcal={result.macros.protein.calories}
            color="text-blue-400"
            bg="border-blue-500/20 bg-blue-500/5"
          />
          <MacroChip
            label="Fat"
            grams={result.macros.fat.grams}
            pct={result.macros.fat.pct}
            kcal={result.macros.fat.calories}
            color="text-amber-400"
            bg="border-amber-500/20 bg-amber-500/5"
          />
          <MacroChip
            label="Carbs"
            grams={result.macros.carbs.grams}
            pct={result.macros.carbs.pct}
            kcal={result.macros.carbs.calories}
            color="text-emerald-400"
            bg="border-emerald-500/20 bg-emerald-500/5"
          />
        </div>
      </div>

      {/* Per-meal breakdown */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '80ms' }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Utensils className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Per meal</h2>
          </div>
          {meals != null && (
            <div className="flex items-center gap-1">
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setMeals(n)}
                  className={`h-8 w-8 rounded-full border text-xs font-semibold transition-all ${
                    meals === n
                      ? 'bg-lime-500 border-lime-500 text-white shadow-sm'
                      : 'border-border text-muted-foreground hover:border-lime-500/40 hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        {meals == null ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose how many meals you'd like to split your day into.
            </p>
            <div className="flex justify-center gap-2">
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setMeals(n)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-sm font-semibold text-foreground hover:bg-lime-500 hover:border-lime-500 hover:text-white transition-colors"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : perMeal ? (
          <>
            <div className="flex flex-col items-center rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <span className="text-2xl font-bold tabular-nums text-red-400">
                {perMeal.calories}<span className="text-base font-bold ml-0.5">kcal</span>
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">Calories</span>
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
              Tap a number above to change your meal frequency.
            </p>
          </>
        ) : null}
      </div>

      {/* Today's intake card */}
      <TodayIntakeCard
        entries={todayEntries}
        dailyTarget={result?.dailyTarget}
        macroTargets={macroTargets}
        onLogFood={() => setDrawerDay(TODAY)}
      />

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
              <p className="text-sm text-muted-foreground mt-1">
                Your goal is a small change and your calorie target is balanced — this is recomposition territory.
                With consistent training and adequate protein, you can lose fat and build muscle at the same time.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Net body weight in recomp typically shifts ~0.25–0.5 kg per month. Scale may stay flat while body composition improves — track progress photos and strength too.
              </p>
            </>
          ) : result.timeline.mode === 'mismatch' ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <TrendIcon className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-semibold">Plan note</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Your goal weight and calorie target are pulling in different directions. Reach out to your coach to align them.
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
                {(() => {
                  const pUnit = profile?.weight_unit || 'lb'
                  return (
                    <>
                      to {result.timeline.isLoss ? 'lose' : 'gain'}{' '}
                      <span className="font-medium text-foreground">{fromKg(result.timeline.weightDiffKg, pUnit).toFixed(1)} {pUnit}</span>
                      {result.goalWeightKg && (
                        <> and reach your goal weight of <span className="font-medium text-foreground">{fmtWeight(result.goalWeightKg, pUnit)}</span></>
                      )}
                    </>
                  )
                })()}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Best-case assumes full daily adherence. Realistic estimate accounts for rest days and variation.
              </p>
            </>
          )}
        </div>
      )}

      {/* Current weight goal */}
      {result.goalWeightKg && (() => {
        const pUnit = profile?.weight_unit || 'lb'
        const startKg = plan.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
        const currentKg = latestBW
          ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
          : null
        const goalKg = result.goalWeightKg

        if (!startKg || !goalKg || Math.abs(startKg - goalKg) < 0.1) {
          return (
            <div className="animate-rise rounded-2xl border border-border bg-card p-5" style={{ animationDelay: '160ms' }}>
              <h2 className="text-sm font-semibold mb-2">Current weight goal</h2>
              <p className="text-sm text-muted-foreground">
                Your coach hasn't locked in a phase starting weight yet. Once they do, your progress toward{' '}
                <span className="font-medium text-foreground">{fromKg(goalKg, pUnit).toFixed(1)} {pUnit}</span> will appear here.
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

        const MESSAGES = {
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

        function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
        function getMessage(p) {
          if (p >= 1.0)  return pick(MESSAGES.done)
          if (p >= 0.90) return pick(MESSAGES.final)
          if (p >= 0.75) return pick(MESSAGES.nearEnd)
          if (p >= 0.60) return pick(MESSAGES.dialled)
          if (p >= 0.45) return pick(MESSAGES.halfway)
          if (p >= 0.25) return pick(MESSAGES.committed)
          if (p >= 0.10) return pick(MESSAGES.building)
          if (p > 0)     return pick(MESSAGES.early)
          return pick(MESSAGES.zero)
        }

        const hue      = Math.round(progress * 142)
        const barStyle = { width: `${progress * 100}%`, backgroundColor: `hsl(${hue}, 70%, 48%)` }
        const pctColor = `hsl(${hue}, 70%, 55%)`

        return (
          <div className="animate-rise rounded-2xl border border-border bg-card p-5 space-y-4" style={{ animationDelay: '160ms' }}>
            <h2 className="text-sm font-semibold">Current weight goal</h2>

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Phase start</p>
                <p className="text-lg font-bold tabular-nums">
                  {fromKg(startKg, pUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{pUnit}</span>
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current</p>
                {currentKg != null ? (
                  <p className="text-lg font-bold tabular-nums">
                    {fromKg(currentKg, pUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{pUnit}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/50">No weigh-in</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Goal</p>
                <p className="text-lg font-bold tabular-nums">
                  {fromKg(goalKg, pUnit).toFixed(1)}<span className="text-sm font-normal ml-0.5 text-muted-foreground">{pUnit}</span>
                </p>
              </div>
            </div>

            <div className="relative h-3">
              <div className="absolute inset-0 rounded-full bg-muted/40" />
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={barStyle}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full border-2 border-background shadow-md transition-all duration-500"
                style={{ left: `${Math.max(2, progress * 100)}%`, backgroundColor: `hsl(${hue}, 70%, 48%)` }}
              />
            </div>

            <div className="flex items-start gap-3">
              <div className="shrink-0 text-center min-w-[2.5rem]">
                <p className="text-2xl font-bold tabular-nums" style={{ color: pctColor }}>{Math.round(progress * 100)}</p>
                <p className="text-[10px] text-muted-foreground -mt-0.5">%</p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pt-0.5">{getMessage(progress)}</p>
            </div>
          </div>
        )
      })()}

      {/* Food log drawer */}
      {drawerDay && (
        <FoodLogDrawer
          userId={user?.id}
          day={drawerDay}
          onClose={() => setDrawerDay(null)}
          onEntriesChange={handleDrawerEntriesChange}
          mealSlotsDefault={profile?.meal_slots_default ?? null}
          onSaveSlotsDefault={async (slots) => {
            await supabase.from('profiles').update({ meal_slots_default: slots }).eq('id', user.id)
          }}
        />
      )}
    </div>
  )
}
