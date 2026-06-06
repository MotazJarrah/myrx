import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  Flame, Clock, UtensilsCrossed, TrendingDown, TrendingUp, Loader2,
} from 'lucide-react'
import SwipeDelete from '../../../components/SwipeDelete'
import { calcFullPlan, ACTIVITY_FACTORS } from '../../../lib/calorieFormulas'
import MacroPlanEditor from '../../../components/MacroPlanEditor'
import { useAuth } from '../../../contexts/AuthContext'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

// ── Date helpers ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function isoToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return isoDate(d)
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00')
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

// 13 past days + today = 14 tiles, no future
function buildDayWindow() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = isoDate(today)
  const days = []
  for (let offset = -13; offset <= 0; offset++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset)
    days.push({
      date:    d,
      iso:     isoDate(d),
      day:     DAY_LABELS[d.getDay()],
      num:     d.getDate(),
      isToday: isoDate(d) === todayIso,
    })
  }
  return days
}

// ── Weight unit helpers ─────────────────────────────────────────────────────────

function fromKg(kg, unit) {
  return unit === 'lb' ? kg / 0.453592 : kg
}

// ── Day-tile status ─────────────────────────────────────────────────────────────

function statusFor(actual, target) {
  if (!actual)  return 'empty'
  if (!target)  return 'logged'
  const ratio = actual / target
  if (ratio >= 0.92 && ratio <= 1.08) return 'on-target'
  if (ratio >= 0.80 && ratio <= 1.20) return 'near-target'
  return 'off-target'
}

const STATUS_DOT = {
  'on-target':   'bg-emerald-400',
  'near-target': 'bg-amber-400',
  'off-target':  'bg-red-400',
  'logged':      'bg-muted-foreground/40',
  'empty':       'bg-transparent',
}

function complianceCls(logged, target) {
  if (!target) return 'text-foreground'
  const r = logged / target
  if (r >= 0.9 && r <= 1.1) return 'text-emerald-400'
  if (r >= 0.75 && r <= 1.2) return 'text-amber-400'
  return 'text-red-400'
}

// ── CalorieDayStrip ─────────────────────────────────────────────────────────────
//
// Read-only mirror of the athlete's day strip (the mobile CalorieStrip /
// the deleted web CalorieStrip). Self-contained here because the shared web
// component was removed in the dead-code cleanup. Sums the CLIENT's food_logs
// per day over a rolling 14-day window and lets the coach tap a day to drive
// the selected-day intake card below. The coach never logs food — this is a
// review affordance only, so copy reads "review" not "log".
//
// Props:
//   userId      — the CLIENT's user id (NOT the coach's)
//   logs        — { [iso]: { calories } } pre-summed by the parent fetch
//   loading     — parent's load flag
//   dailyTarget — coach-set kcal target (number | null)
//   onDayClick  — (isoDateStr) => void
//   selectedIso — which tile is highlighted (controlled from parent)

function CalorieDayStrip({ logs, loading, dailyTarget, onDayClick, selectedIso }) {
  const stripRef = useRef(null)
  const todayRef = useRef(null)
  const days = useMemo(() => buildDayWindow(), [])

  // Auto-scroll today into view once the data resolves.
  useEffect(() => {
    if (todayRef.current && stripRef.current) {
      const tile  = todayRef.current
      const strip = stripRef.current
      const left  = tile.offsetLeft - strip.clientWidth / 2 + tile.clientWidth / 2
      strip.scrollTo({ left, behavior: 'instant' })
    }
  }, [loading])

  const targetText = dailyTarget ? `${dailyTarget} kcal` : null

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Daily intake log</h2>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Tap a day to review intake</p>
        </div>
        {targetText && (
          <span className="text-[11px] text-muted-foreground">Target {targetText}</span>
        )}
      </div>

      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-6">
          <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…
        </div>
      ) : (
        <div
          ref={stripRef}
          className="flex gap-1.5 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1 -mx-1 px-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {days.map(day => {
            const log        = logs[day.iso]
            const status     = statusFor(log?.calories, dailyTarget)
            const isSelected = selectedIso === day.iso

            return (
              <button
                key={day.iso}
                ref={day.isToday ? todayRef : null}
                type="button"
                data-iso={day.iso}
                onClick={() => onDayClick?.(day.iso)}
                className={`relative shrink-0 snap-center flex flex-col items-center justify-between rounded-xl border transition-all px-2 py-2 w-[58px] h-[72px]
                  ${isSelected
                    ? 'border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30'
                    : day.isToday
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-border bg-muted/20'}
                  hover:border-red-500/40 hover:bg-red-500/5 active:scale-95
                `}
              >
                <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground leading-none">
                  {day.day}
                </div>
                <div className={`text-base font-bold tabular-nums leading-none ${day.isToday ? 'text-red-400' : ''}`}>
                  {day.num}
                </div>
                <div className="text-[10px] tabular-nums leading-none">
                  {log
                    ? <span className="font-semibold">{Math.round(log.calories)}</span>
                    : <span className="text-muted-foreground/60">—</span>}
                </div>
                <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-5 rounded-full ${STATUS_DOT[status]}`} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── MacroBar (segmented protein/fat/carbs bar) ──────────────────────────────────

function MacroBar({ protein, fat, carbs }) {
  const total = protein + fat + carbs
  if (total === 0) return null
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div style={{ width: `${(protein / total) * 100}%` }} className="bg-blue-400/80 h-full" />
      <div style={{ width: `${(fat     / total) * 100}%` }} className="bg-amber-400/80 h-full" />
      <div style={{ width: `${(carbs   / total) * 100}%` }} className="bg-emerald-400/80 h-full" />
    </div>
  )
}

// ── Daily-target hero (BMR / TDEE / Energy pills + target kcal + macros) ────────
//
// Mirrors the athlete's daily-target hero. `result` is the full calcFullPlan
// output (bmr / tdee / dailyTarget / energyAdj / macros). Read-only — no pill
// info panels, no editing. The energy pill colours track loss (emerald) vs
// gain (blue) the same way the athlete page does.

function DailyTargetHero({ result, plan }) {
  const isLoss    = result.energyAdj < 0
  const TrendIcon = isLoss ? TrendingDown : TrendingUp
  const energyHue = isLoss ? 'text-emerald-400' : 'text-blue-400'
  const energyBg  = isLoss
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : 'border-blue-500/30 bg-blue-500/10'

  const macros = result.macros

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-red-400" />
        <p className="text-sm font-semibold text-muted-foreground">Daily calorie target</p>
      </div>

      <div className="text-center">
        <p className="text-5xl font-bold tabular-nums font-mono text-red-400 leading-none">
          {result.dailyTarget.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">kcal / day</p>
      </div>

      {/* BMR / TDEE / Energy pills */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          BMR <span className="font-semibold tabular-nums font-mono text-foreground">{result.bmr} kcal</span>
        </span>
        <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          TDEE <span className="font-semibold tabular-nums font-mono text-foreground">{result.tdee} kcal</span>
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${energyBg}`}>
          <TrendIcon className={`h-3 w-3 ${energyHue}`} />
          <span className={`font-semibold tabular-nums font-mono ${energyHue}`}>
            {isLoss ? '−' : '+'}{Math.abs(result.energyAdj)} kcal
          </span>
        </span>
      </div>

      {plan?.activity_factor != null && ACTIVITY_FACTORS[plan.activity_factor] && (
        <p className="text-center text-[11px] text-muted-foreground/70">
          {ACTIVITY_FACTORS[plan.activity_factor].label}
        </p>
      )}

      {/* Macro targets */}
      <div className="space-y-3 pt-1">
        <MacroBar protein={macros.protein.grams} fat={macros.fat.grams} carbs={macros.carbs.grams} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Protein', m: macros.protein, color: 'text-blue-400',    bg: 'bg-blue-500/5    border-blue-500/20'    },
            { label: 'Fat',     m: macros.fat,     color: 'text-amber-400',   bg: 'bg-amber-500/5   border-amber-500/20'   },
            { label: 'Carbs',   m: macros.carbs,   color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20' },
          ].map(({ label, m, color, bg }) => (
            <div key={label} className={`rounded-xl border p-3 text-center ${bg}`}>
              <p className={`text-xl font-bold tabular-nums font-mono ${color}`}>{m.grams}<span className="text-xs"> g</span></p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
              <p className="text-[10px] text-muted-foreground/70">{m.calories} kcal · {m.pct}%</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Selected-day intake card (sums client's food_logs for the chosen day) ───────
//
// Mirrors the athlete's Today's-intake card, generalised to ANY selected day
// (the coach can review history). Shows total calories vs target, remaining /
// over, a segmented macro bar with a target needle, and per-macro chips vs the
// plan's macro targets.

function SelectedDayIntakeCard({ iso, entries, dailyTarget, macroTargets }) {
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  )

  const hasData   = totals.calories > 0
  const target    = dailyTarget ?? 0
  const remaining = target - Math.round(totals.calories)
  const isOver    = remaining < 0

  const proteinKcal = totals.protein * 4
  const fatKcal     = totals.fat     * 9
  const carbsKcal   = totals.carbs   * 4
  const totalKcal   = proteinKcal + fatKcal + carbsKcal

  const trackKcal = target > 0 ? Math.max(target, totalKcal) : (totalKcal || 300)
  const pWidth    = totalKcal > 0 ? (proteinKcal / trackKcal) * 100 : 0
  const fWidth    = totalKcal > 0 ? (fatKcal     / trackKcal) * 100 : 0
  const cWidth    = totalKcal > 0 ? (carbsKcal   / trackKcal) * 100 : 0
  const targetPct = target > 0 && trackKcal > 0 ? (target / trackKcal) * 100 : 100

  const isToday = iso === isoToday()
  const dayLabel = isToday ? "Today's intake" : `Intake — ${fmtDate(iso)}`

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{dayLabel}</h2>
      </div>

      {hasData ? (
        <>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold tabular-nums font-mono leading-none">
                {Math.round(totals.calories).toLocaleString()}<span className="text-sm text-muted-foreground"> kcal</span>
              </p>
              {target > 0 && (
                <p className="text-xs text-muted-foreground mt-1">of {target.toLocaleString()} kcal target</p>
              )}
            </div>
            {target > 0 && (
              <div className="text-right">
                <p className={`text-2xl font-bold tabular-nums font-mono leading-none ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                  {isOver ? '+' : ''}{Math.abs(remaining).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{isOver ? 'over target' : 'remaining'}</p>
              </div>
            )}
          </div>

          {target > 0 && (
            <div className="space-y-1.5">
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/30">
                <div className="absolute top-0 h-full rounded-l-full bg-blue-400/80"
                     style={{ left: '0%', width: `${pWidth}%` }} />
                <div className="absolute top-0 h-full bg-amber-400/80"
                     style={{ left: `${pWidth}%`, width: `${fWidth}%` }} />
                <div className="absolute top-0 h-full bg-emerald-400/80"
                     style={{ left: `${pWidth + fWidth}%`, width: `${cWidth}%` }} />
                <div className="absolute top-0 h-full w-0.5 bg-foreground/70"
                     style={{ left: `${targetPct}%` }} />
              </div>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400/80" /> P {Math.round(totals.protein)}g
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80" /> F {Math.round(totals.fat)}g
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" /> C {Math.round(totals.carbs)}g
                </span>
              </div>
            </div>
          )}

          {macroTargets && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Protein', val: totals.protein, target: macroTargets.protein, color: 'text-blue-400',    bar: 'bg-blue-400',    bg: 'bg-blue-500/5    border-blue-500/20'    },
                { label: 'Fat',     val: totals.fat,     target: macroTargets.fat,     color: 'text-amber-400',   bar: 'bg-amber-400',   bg: 'bg-amber-500/5   border-amber-500/20'   },
                { label: 'Carbs',   val: totals.carbs,   target: macroTargets.carbs,   color: 'text-emerald-400', bar: 'bg-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20' },
              ].map(({ label, val, target: t, color, bar, bg }) => {
                const pct     = t > 0 ? Math.round((val / t) * 100) : null
                const isOvr   = t > 0 && val > t
                const fillPct = t > 0 ? Math.min(100, (val / t) * 100) : 0
                const ovrPct  = isOvr ? Math.min(100, ((val - t) / t) * 100) : 0
                return (
                  <div key={label} className={`rounded-xl border p-3 ${bg}`}>
                    <p className={`text-lg font-bold tabular-nums font-mono ${color}`}>{Math.round(val)}<span className="text-xs"> g</span></p>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    {t > 0 && (
                      <>
                        <div className="relative mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
                          <div className={`absolute top-0 h-full ${bar}`} style={{ width: `${fillPct}%` }} />
                          {isOvr && (
                            <div className="absolute top-0 h-full bg-red-400" style={{ left: `${fillPct}%`, width: `${ovrPct}%` }} />
                          )}
                        </div>
                        <p className={`text-[10px] mt-1 tabular-nums ${isOvr ? 'text-red-400' : 'text-muted-foreground/70'}`}>
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
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/30">
            <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-medium">{isToday ? 'Nothing logged yet today' : 'Nothing logged this day'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Pick another day from the strip above to review intake</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Weight-goal progress (start / current / goal + progress bar) ────────────────
//
// Mirrors the athlete's Current-weight-goal card. Weights render in the COACH's
// unit (useAuth().profile) per the AdminUserBody convention. Start + goal come
// from calorie_plans (kg); current comes from the client's latest bodyweight log
// (kg), falling back to the client's profile weight. Read-only.

function WeightGoalCard({ plan, clientProfile, latestBW, coachUnit }) {
  const startKg = plan?.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
  const goalKg  = plan?.goal_weight_kg     != null ? Number(plan.goal_weight_kg)     : null

  const currentKg = latestBW
    ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
    : (clientProfile?.current_weight != null
        ? (clientProfile.weight_unit === 'lb' ? clientProfile.current_weight * 0.453592 : Number(clientProfile.current_weight))
        : null)

  // No usable phase → minimal "no goal yet" state.
  if (!startKg || !goalKg || Math.abs(startKg - goalKg) < 0.1) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">Current weight goal</h2>
        <p className="text-sm text-muted-foreground leading-snug">
          {goalKg
            ? <>No phase starting weight set yet. Once a phase is started, progress toward{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {fromKg(goalKg, coachUnit).toFixed(1)} {coachUnit}
                </span> will appear here.</>
            : 'No weight goal set in the plan yet.'}
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

  const hue      = Math.round(progress * 142)
  const barColor = `hsl(${hue}, 70%, 48%)`
  const pctColor = `hsl(${hue}, 70%, 55%)`

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">Current weight goal</h2>

      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Phase start</p>
          <p className="text-xl font-bold tabular-nums font-mono mt-0.5">
            {fromKg(startKg, coachUnit).toFixed(1)}<span className="text-xs text-muted-foreground"> {coachUnit}</span>
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current</p>
          {currentKg != null
            ? <p className="text-xl font-bold tabular-nums font-mono mt-0.5">
                {fromKg(currentKg, coachUnit).toFixed(1)}<span className="text-xs text-muted-foreground"> {coachUnit}</span>
              </p>
            : <p className="text-sm text-muted-foreground mt-1.5">No weigh-in</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Goal</p>
          <p className="text-xl font-bold tabular-nums font-mono mt-0.5">
            {fromKg(goalKg, coachUnit).toFixed(1)}<span className="text-xs text-muted-foreground"> {coachUnit}</span>
          </p>
        </div>
      </div>

      <div className="relative h-2.5 w-full rounded-full bg-muted/30">
        <div className="absolute top-0 h-full rounded-full" style={{ width: `${progress * 100}%`, backgroundColor: barColor }} />
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
             style={{ left: `${Math.max(2, progress * 100)}%`, backgroundColor: barColor }} />
      </div>

      <div className="flex items-center gap-3">
        <p className="text-2xl font-bold tabular-nums font-mono" style={{ color: pctColor }}>
          {Math.round(progress * 100)}<span className="text-sm">%</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {plan.goal_reached ? 'Goal reached.' : 'of the way to the goal weight'}
        </p>
      </div>
    </div>
  )
}

// ── Calorie-intake trend chart ────────────────────────────────────────────────
// The athlete page itself has no line chart, but every other coach tab (Bodyweight
// / Sleep / Hydration) shows a trend chart, and the old Manual-Logs tab had the
// calorie chart. This restores a graph: daily logged calories (from food_logs)
// over the 14-day window, with a dashed reference line at the plan's daily target.
// Days over target render amber, at/under target emerald (mirrors Hydration's bar
// chart style). Renders only once there's at least one logged day.
function CaloriesTrendChart({ logsMap, dailyTarget }) {
  const data = buildDayWindow().map(d => ({
    label:    `${d.day} ${d.num}`,
    calories: Math.round(logsMap[d.iso]?.calories || 0),
  }))
  if (!data.some(d => d.calories > 0)) return null
  const yMax = Math.ceil(Math.max(dailyTarget || 0, ...data.map(d => d.calories), 1) * 1.1)
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold mb-3">
        Calorie intake <span className="text-muted-foreground font-normal">(last 14 days)</span>
      </h2>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, yMax]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickCount={4} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${v} kcal`, 'Intake']}
          />
          {dailyTarget > 0 && <ReferenceLine y={dailyTarget} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />}
          <Bar dataKey="calories" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700}>
            {data.map((d, i) => (
              <Cell key={i} fill={dailyTarget > 0 && d.calories > dailyTarget ? '#f59e0b' : '#34d399'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {dailyTarget > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Dashed line = daily target ({Math.round(dailyTarget)} kcal). Days over target in amber.
        </p>
      )}
    </div>
  )
}

// ── Food Log tab (reads from food_logs) ───────────────────────────────────────

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

function FoodLogTab({ userId, dailyTarget, onEntriesChange }) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [limit,    setLimit]    = useState(50)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('food_logs')
      .select('id, log_date, meal_slot, food_name, brand_name, portion_label, calories, protein_g, fat_g, carbs_g, created_at')
      .eq('user_id', userId)
      .order('log_date',    { ascending: false })
      .order('created_at',  { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        setEntries(data || [])
        setLoading(false)
      })
  }, [userId, limit])

  async function deleteEntry(id) {
    const { error } = await supabase.from('food_logs').delete().eq('id', id)
    if (error) throw new Error('Delete failed')
    setEntries(prev => prev.filter(e => e.id !== id))
    onEntriesChange?.()
  }

  // Group entries by log_date for the day view
  const byDate = {}
  entries.forEach(e => {
    if (!byDate[e.log_date]) byDate[e.log_date] = []
    byDate[e.log_date].push(e)
  })
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading food log…</div>
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        No food entries logged yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sortedDates.map(date => {
        const dayEntries = byDate[date]
        const dayTotal   = dayEntries.reduce((s, e) => s + e.calories, 0)
        const pTotal     = dayEntries.reduce((s, e) => s + e.protein_g, 0)
        const fTotal     = dayEntries.reduce((s, e) => s + e.fat_g, 0)
        const cTotal     = dayEntries.reduce((s, e) => s + e.carbs_g, 0)
        const cls        = complianceCls(dayTotal, dailyTarget)

        return (
          <div key={date} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Day header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <p className="text-sm font-semibold">{fmtDate(date)}</p>
              <div className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-blue-400">P {Math.round(pTotal)}g</span>
                <span className="text-xs tabular-nums text-amber-400">F {Math.round(fTotal)}g</span>
                <span className="text-xs tabular-nums text-emerald-400">C {Math.round(cTotal)}g</span>
                <span className={`text-sm font-bold tabular-nums ${cls}`}>
                  {Math.round(dayTotal)} kcal
                </span>
                {dailyTarget && (
                  <span className={`text-[11px] tabular-nums ${cls}`}>
                    {Math.round((dayTotal / dailyTarget) * 100)}%
                  </span>
                )}
              </div>
            </div>

            {/* Items grouped by meal slot */}
            <div className="divide-y divide-border">
              {MEAL_SLOTS.map(slot => {
                const slotItems = dayEntries.filter(e => e.meal_slot === slot.id)
                if (slotItems.length === 0) return null
                return (
                  <div key={slot.id}>
                    <div className="px-4 py-1.5 bg-muted/10">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        {slot.emoji} {slot.label}
                      </p>
                    </div>
                    {slotItems.map(item => (
                      <SwipeDelete
                        key={item.id}
                        onDelete={() => deleteEntry(item.id)}
                        bg="bg-card"
                      >
                        <div className="flex items-center gap-3 px-4 py-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-snug">{item.food_name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{item.portion_label}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold tabular-nums text-red-400">{Math.round(item.calories)} kcal</p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              P {Math.round(item.protein_g)}g · F {Math.round(item.fat_g)}g · C {Math.round(item.carbs_g)}g
                            </p>
                          </div>
                        </div>
                      </SwipeDelete>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {entries.length === limit && (
        <button
          type="button"
          onClick={() => setLimit(l => l + 50)}
          className="w-full rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
        >
          Load more entries
        </button>
      )}
    </div>
  )
}

// ── Sub-tab button ────────────────────────────────────────────────────────────

function SubTabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
//
// T079: the coach's Calories tab now MIRRORS the athlete's read-only Calories
// dashboard (day strip → daily-target hero → selected-day intake → weight-goal
// progress) as the LANDING view, then keeps the coach's planning + review tools
// (Macro Plan editor + Food Log review) reachable as sub-tabs below. The legacy
// "Manual Logs" (calorie_logs) surface is fully removed.

export default function AdminUserCalories({ userId, existingPlan, profile, adminUserId, onPlanSaved, onSaved }) {
  // `profile` here is the CLIENT. The COACH's profile (units only) comes from auth.
  const { profile: coachProfile } = useAuth()
  const coachUnit = coachProfile?.weight_unit || 'lb'

  const [subTab, setSubTab] = useState('dashboard')   // 'dashboard' | 'plan' | 'foodlog'

  // ── Self-fetched read-only data ──────────────────────────────────────────
  const [windowLogs, setWindowLogs] = useState([])    // all food_logs rows in the 14-day window
  const [latestBW,   setLatestBW]   = useState(null)  // { weight, unit }
  const [loading,    setLoading]    = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)     // bump to re-fetch the dashboard data

  const TODAY = isoToday()
  const [selectedIso, setSelectedIso] = useState(TODAY)

  // Daily target + macros from the client's plan (calcFullPlan). Null when no
  // plan or the client's profile is missing fields required by the formula.
  const result = useMemo(() => {
    if (!existingPlan || !profile) return null
    try {
      const currentKgOverride = latestBW
        ? (latestBW.unit === 'lb' ? latestBW.weight * 0.453592 : Number(latestBW.weight))
        : null
      return calcFullPlan(profile, existingPlan, currentKgOverride)
    } catch {
      return null
    }
  }, [existingPlan, profile, latestBW])

  const dailyTarget = result?.dailyTarget ?? null
  const macroTargets = result ? {
    protein: result.macros.protein.grams,
    fat:     result.macros.fat.grams,
    carbs:   result.macros.carbs.grams,
  } : null

  // Per-day calorie sums (drives the strip tiles) — derived from the window.
  const logsMap = useMemo(() => {
    const map = {}
    windowLogs.forEach(e => {
      if (!map[e.log_date]) map[e.log_date] = { calories: 0 }
      map[e.log_date].calories += e.calories
    })
    return map
  }, [windowLogs])

  // Selected day's full rows — filtered in-memory (the window already holds
  // every day's rows, so switching days needs no network round-trip).
  const dayEntries = useMemo(
    () => windowLogs.filter(e => e.log_date === selectedIso),
    [windowLogs, selectedIso],
  )

  // ── Load latest bodyweight + 14-day food_logs window ─────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const fromIso = (() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13)
        return isoDate(d)
      })()

      const [bwRes, logsRes] = await Promise.all([
        supabase.from('bodyweight').select('weight, unit').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('food_logs')
          .select('id, log_date, meal_slot, food_name, calories, protein_g, fat_g, carbs_g')
          .eq('user_id', userId).gte('log_date', fromIso),
      ])
      if (cancelled) return

      setLatestBW(bwRes.data ?? null)
      setWindowLogs(logsRes.data ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, refreshKey])

  function handleDayClick(iso) {
    setSelectedIso(iso)
  }

  const inDashboard = subTab === 'dashboard'

  return (
    <div className="space-y-4">

      {/* Sub-tab bar — dashboard lands first, then planning + review tools */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit flex-wrap">
        <SubTabBtn active={subTab === 'dashboard'} onClick={() => setSubTab('dashboard')}>Overview</SubTabBtn>
        <SubTabBtn active={subTab === 'plan'}      onClick={() => setSubTab('plan')}>Macro Plan</SubTabBtn>
        <SubTabBtn active={subTab === 'foodlog'}   onClick={() => setSubTab('foodlog')}>Food Log</SubTabBtn>
      </div>

      {/* ── Read-only athlete-dashboard mirror (landing view) ──────────────── */}
      {inDashboard && (
        <div className="space-y-4">
          <CalorieDayStrip
            logs={logsMap}
            loading={loading}
            dailyTarget={dailyTarget}
            onDayClick={handleDayClick}
            selectedIso={selectedIso}
          />

          {/* Daily-target hero — only when the plan + profile yield a result */}
          {result && existingPlan && (
            <DailyTargetHero result={result} plan={existingPlan} />
          )}

          {/* No plan at all → "plan on its way" notice (coach-managed client) */}
          {!existingPlan && (
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
                <Clock className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">No calorie plan yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Set up this client's macro plan from the <span className="font-medium text-foreground">Macro Plan</span> tab to calculate their daily calorie + macro targets.
                </p>
              </div>
            </div>
          )}

          {/* Plan exists but profile incomplete → calcFullPlan returns null */}
          {existingPlan && !result && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Almost there</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The plan is set, but this client's profile is missing the weight, height, age, or sex needed to compute a calorie target. Complete their profile to see the daily target here.
                </p>
              </div>
            </div>
          )}

          {/* Selected-day intake card */}
          <SelectedDayIntakeCard
            iso={selectedIso}
            entries={dayEntries}
            dailyTarget={dailyTarget}
            macroTargets={macroTargets}
          />

          {/* Calorie-intake trend (last 14 days) — restores a graph to this tab */}
          <CaloriesTrendChart logsMap={logsMap} dailyTarget={dailyTarget} />

          {/* Weight-goal progress (coach's units) */}
          <WeightGoalCard
            plan={existingPlan}
            clientProfile={profile}
            latestBW={latestBW}
            coachUnit={coachUnit}
          />
        </div>
      )}

      {/* ── Macro Plan editor (coach's planning tool) ──────────────────────── */}
      {subTab === 'plan' && (
        <MacroPlanEditor
          profile={profile}
          user={{ id: userId, email: profile?.email ?? null }}
          existingPlan={existingPlan}
          onPlanSaved={(updated) => { onPlanSaved?.(updated); setRefreshKey(k => k + 1) }}
          savedBy={adminUserId}
        />
      )}

      {/* ── Food Log review (read-only client food entries) ────────────────── */}
      {subTab === 'foodlog' && (
        <FoodLogTab
          userId={userId}
          dailyTarget={dailyTarget}
          onEntriesChange={() => { setRefreshKey(k => k + 1); onSaved?.() }}
        />
      )}
    </div>
  )
}
