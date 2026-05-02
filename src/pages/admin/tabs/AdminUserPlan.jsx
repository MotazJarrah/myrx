import { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  calcFullPlan, calcPerMeal,
  ACTIVITY_FACTORS, PROTEIN_LEVELS, FAT_LEVELS,
} from '../../../lib/calorieFormulas'
import {
  Check, Loader2, AlertCircle, Info,
  TrendingDown, TrendingUp, Utensils, RotateCcw,
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

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

function energyColor(pct) {
  const t = Math.abs(pct) / 50
  const hue = Math.round(142 * (1 - t))
  const light = Math.round(45 + t * 8)
  return `hsl(${hue}, 70%, ${light}%)`
}

// ── StepSlider ────────────────────────────────────────────────────────────────

function StepSlider({ options, value, onChange }) {
  const count   = options.length
  const idx     = options.findIndex(o => o.value === value)
  const safeIdx = idx === -1 ? 0 : idx
  const current = options[safeIdx]
  const stopPos = (i) => count === 1 ? 50 : (i / (count - 1)) * 100
  const fillPct = stopPos(safeIdx)

  return (
    <div className="space-y-3">
      <div className="relative h-8 select-none">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-all" style={{ width: `${fillPct}%` }} />
        {options.map((opt, i) => {
          const active     = i <= safeIdx
          const isSelected = i === safeIdx
          return (
            <div
              key={opt.value}
              className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-all"
              style={{
                left:            `${stopPos(i)}%`,
                width:           isSelected ? '20px' : '12px',
                height:          isSelected ? '20px' : '12px',
                backgroundColor: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)',
                boxShadow:       isSelected ? '0 0 0 3px hsl(var(--primary) / 0.25)' : 'none',
                zIndex:          1,
              }}
            />
          )
        })}
        <input
          type="range"
          min="0"
          max={count - 1}
          step="1"
          value={safeIdx}
          onChange={e => onChange(options[Number(e.target.value)].value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ touchAction: 'pan-y', margin: 0 }}
        />
      </div>
      <div className="flex items-end justify-between text-[10px] text-muted-foreground">
        {options.map((opt, i) => (
          <span
            key={opt.value}
            className={`flex-1 text-center transition-colors ${i === safeIdx ? 'font-semibold text-foreground' : ''}`}
            style={{ textAlign: i === 0 ? 'left' : i === count - 1 ? 'right' : 'center' }}
          >
            {opt.short || opt.label.split(' ')[0]}
          </span>
        ))}
      </div>
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-center">
        <p className="text-sm font-medium">{current.label}</p>
        {current.description && <p className="text-[11px] text-muted-foreground mt-0.5">{current.description}</p>}
      </div>
    </div>
  )
}

// ── EnergySlider ──────────────────────────────────────────────────────────────

function EnergySlider({ value, onChange, tdee }) {
  const color   = energyColor(value)
  const label   = getEnergyLabel(value)
  const kcalAdj = tdee ? Math.round(tdee * (value / 100)) : null
  const gradientStyle = {
    background: 'linear-gradient(to right, hsl(0,70%,53%) 0%, hsl(60,70%,50%) 20%, hsl(142,70%,45%) 50%, hsl(60,70%,50%) 80%, hsl(0,70%,53%) 100%)',
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>
          {value > 0 ? '+' : ''}{value}%
        </span>
        <div className="text-right">
          <p className="text-sm font-medium" style={{ color }}>{label}</p>
          {kcalAdj !== null && (
            <p className="text-xs text-muted-foreground">{kcalAdj > 0 ? '+' : ''}{kcalAdj} kcal/day vs TDEE</p>
          )}
        </div>
      </div>
      <div className="relative">
        <div className="h-2 w-full rounded-full" style={gradientStyle} />
        <input
          type="range" min="-50" max="50" step="1" value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ margin: 0 }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-lg transition-all"
          style={{ left: `${((value + 50) / 100) * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>−50%</span><span>−25%</span><span>0</span><span>+25%</span><span>+50%</span>
      </div>
    </div>
  )
}

// ── MacroBar ──────────────────────────────────────────────────────────────────

function MacroBar({ protein, fat, carbs }) {
  const total = protein + fat + carbs
  if (total === 0) return null
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-blue-400"    style={{ width: `${(protein / total) * 100}%` }} />
      <div className="bg-amber-400"   style={{ width: `${(fat     / total) * 100}%` }} />
      <div className="bg-emerald-400" style={{ width: `${(carbs   / total) * 100}%` }} />
    </div>
  )
}

// ── ResultCard ────────────────────────────────────────────────────────────────

function ResultCard({ result, meals }) {
  const perMeal   = calcPerMeal(result.macros, result.dailyTarget, meals)
  const isLoss    = result.energyAdj < 0
  const TrendIcon = isLoss ? TrendingDown : TrendingUp
  const trendCls  = isLoss ? 'text-emerald-400 bg-emerald-500/10' : 'text-blue-400 bg-blue-500/10'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'BMR',    value: result.bmr,        hi: false },
          { label: 'TDEE',   value: result.tdee,        hi: false },
          { label: 'Target', value: result.dailyTarget, hi: true  },
        ].map(({ label, value, hi }) => (
          <div key={label} className={`rounded-xl border p-3 ${hi ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
            <p className={`text-xl font-bold tabular-nums ${hi ? 'text-primary' : ''}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">kcal</p>
          </div>
        ))}
      </div>
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${trendCls}`}>
        <TrendIcon className="h-4 w-4 shrink-0" />
        <span>{result.energyAdj > 0 ? '+' : ''}{result.energyAdj} kcal/day · {getEnergyLabel(Math.round((result.energyAdj / result.tdee) * 100))}</span>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">Daily macros</p>
        <MacroBar protein={result.macros.protein.grams} fat={result.macros.fat.grams} carbs={result.macros.carbs.grams} />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          {[
            { label: 'Protein', g: result.macros.protein.grams, pct: result.macros.protein.pct, color: 'text-blue-400' },
            { label: 'Fat',     g: result.macros.fat.grams,     pct: result.macros.fat.pct,     color: 'text-amber-400' },
            { label: 'Carbs',   g: result.macros.carbs.grams,   pct: result.macros.carbs.pct,   color: 'text-emerald-400' },
          ].map(({ label, g, pct, color }) => (
            <div key={label}>
              <span className={`font-semibold ${color}`}>{g}g</span>
              <span className="text-muted-foreground ml-1">({pct}%)</span>
              <p className="text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>
      {meals > 1 && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Utensils className="h-3 w-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Per meal ({meals} meals/day)</p>
          </div>
          <div className="flex gap-4 text-sm">
            <span><span className="font-semibold text-primary">{perMeal.calories}</span> <span className="text-muted-foreground text-xs">kcal</span></span>
            <span><span className="font-semibold text-blue-400">{perMeal.protein}g</span> <span className="text-muted-foreground text-xs">P</span></span>
            <span><span className="font-semibold text-amber-400">{perMeal.fat}g</span> <span className="text-muted-foreground text-xs">F</span></span>
            <span><span className="font-semibold text-emerald-400">{perMeal.carbs}g</span> <span className="text-muted-foreground text-xs">C</span></span>
          </div>
        </div>
      )}
      {result.timeline && (() => {
        const tl = result.timeline
        if (tl.mode === 'recomp') {
          const b = tl.monthsBest, r = tl.monthsRealistic
          const label = b === r ? `${b}` : `${b}–${r}`
          const unit  = (b === 1 && r === 1) ? 'month' : 'months'
          return (
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 text-sm">
              <p className="font-semibold text-purple-400">Body recomposition · approx. ~{label} {unit}</p>
            </div>
          )
        }
        if (tl.mode === 'mismatch') return (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-semibold text-amber-400">Direction mismatch</p>
          </div>
        )
        const b = tl.monthsBest, r = tl.monthsRealistic
        const label = b === r ? `${b}` : `${b}–${r}`
        const unit  = (b === 1 && r === 1) ? 'month' : 'months'
        return (
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <p className="text-xs text-muted-foreground mb-0.5">Estimated timeline</p>
            <p className="font-semibold">approx. ~{label} {unit}</p>
          </div>
        )
      })()}
    </div>
  )
}

function SectionLabel({ children, hint }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  )
}

// ── Options ───────────────────────────────────────────────────────────────────

const ACTIVITY_SHORT = { 1: 'Sedentary', 2: 'Light', 3: 'Moderate', 4: 'Very', 5: 'Extreme' }
const ACTIVITY_OPTIONS = Object.entries(ACTIVITY_FACTORS).map(([k, v]) => ({ value: Number(k), short: ACTIVITY_SHORT[k], label: v.label, description: v.description }))
const PROTEIN_OPTIONS  = Object.entries(PROTEIN_LEVELS).map(([k, v])  => ({ value: Number(k), short: v.label, label: `${v.label} · ${v.gPerKg}g per kg of goal weight` }))
const FAT_OPTIONS      = Object.entries(FAT_LEVELS).map(([k, v])      => ({ value: Number(k), short: v.label, label: `${v.label} · ${Math.round(v.pctOfCals * 100)}% of total calories` }))

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminUserPlan({ profile, existingPlan: initPlan, userId, adminUserId, onPlanSaved }) {
  const [existingPlan, setExistingPlan] = useState(initPlan)

  // ── Plan fields ──────────────────────────────────────────────────────────────
  const [activityFactor,   setActivityFactor]   = useState(() => initPlan?.activity_factor ?? 2)
  const [energyPct,        setEnergyPct]         = useState(() => initPlan?.energy_balance_pct != null ? Math.round(initPlan.energy_balance_pct * 100) : -20)
  const [proteinLevel,     setProteinLevel]      = useState(() => initPlan?.protein_level ?? 2)
  const [fatLevel,         setFatLevel]          = useState(() => initPlan?.fat_level ?? 2)
  const [startingWeightKg, setStartingWeightKg] = useState(() => {
    if (initPlan?.starting_weight_kg != null) return String(initPlan.starting_weight_kg)
    if (profile?.current_weight) {
      const kg = profile.weight_unit === 'lb'
        ? Math.round(profile.current_weight * 0.453592 * 10) / 10
        : Number(profile.current_weight)
      return String(kg)
    }
    return ''
  })
  const [goalWeightKg,     setGoalWeightKg]     = useState(() => initPlan?.goal_weight_kg != null ? String(initPlan.goal_weight_kg) : '')
  const [correctionFactor, setCorrectionFactor] = useState(() => String(initPlan?.correction_factor ?? '0.8'))
  const [notes,            setNotes]            = useState(() => initPlan?.notes || '')
  const [mealsAssignment,  setMealsAssignment]  = useState(() => initPlan?.meals ?? null)
  // Init to profile's preferred unit so the admin works in the client's unit by default
  const [weightUnit, setWeightUnit] = useState(() => profile?.weight_unit || 'kg')
  // Raw string state for number inputs — avoids the controlled-input rounding fight.
  // Display values are always in the current weightUnit.
  const [startRaw, setStartRaw] = useState(() => {
    const initUnit = profile?.weight_unit || 'kg'
    const kgToDisp = (kg) => initUnit === 'lb' ? Math.round(kg / 0.453592 * 10) / 10 : Math.round(kg * 10) / 10
    if (initPlan?.starting_weight_kg != null) return String(kgToDisp(initPlan.starting_weight_kg))
    if (profile?.current_weight) {
      const kg = profile.weight_unit === 'lb'
        ? Math.round(profile.current_weight * 0.453592 * 10) / 10
        : Number(profile.current_weight)
      return String(kgToDisp(kg))
    }
    return ''
  })
  const [goalRaw, setGoalRaw] = useState(() => {
    if (initPlan?.goal_weight_kg == null) return ''
    const initUnit = profile?.weight_unit || 'kg'
    const kg = initPlan.goal_weight_kg
    const disp = initUnit === 'lb' ? Math.round(kg / 0.453592 * 10) / 10 : Math.round(kg * 10) / 10
    return String(disp)
  })
  const [resettingGoal,    setResettingGoal]    = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // ── Live calc ─────────────────────────────────────────────────────────────
  const planForCalc = useMemo(() => ({
    activity_factor:    activityFactor,
    energy_balance_pct: energyPct / 100,
    protein_level:      proteinLevel,
    fat_level:          fatLevel,
    goal_weight_kg:     Number(goalWeightKg) || 0,
    correction_factor:  Number(correctionFactor) || 0.8,
  }), [activityFactor, energyPct, proteinLevel, fatLevel, goalWeightKg, correctionFactor])

  const result = useMemo(() => {
    if (!profile || !goalWeightKg || isNaN(Number(goalWeightKg)) || Number(goalWeightKg) <= 0) return null
    return calcFullPlan(profile, planForCalc)
  }, [profile, planForCalc, goalWeightKg])

  const previewTDEE = result?.tdee ?? null

  // Missing data check
  const { current_weight, current_height, birthdate, gender } = profile || {}
  const missingData = !current_weight || !current_height || !birthdate || !gender

  // ── Save plan ────────────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault()
    setError('')
    if (!goalWeightKg || isNaN(Number(goalWeightKg)) || Number(goalWeightKg) <= 0) {
      setError('Goal weight must be a positive number.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        user_id:             userId,
        activity_factor:     activityFactor,
        energy_balance_type: null,
        energy_balance_pct:  energyPct / 100,
        protein_level:       proteinLevel,
        fat_level:           fatLevel,
        starting_weight_kg:  Number(startingWeightKg) || null,
        goal_weight_kg:      Number(goalWeightKg),
        correction_factor:   Number(correctionFactor) || 0.8,
        notes:               notes.trim() || null,
        meals:               mealsAssignment,
        assigned_by:         adminUserId,
        assigned_at:         new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      }
      const { error: upsertError } = existingPlan
        ? await supabase.from('calorie_plans').update(payload).eq('user_id', userId)
        : await supabase.from('calorie_plans').insert(payload)
      if (upsertError) throw upsertError
      const updated = { ...existingPlan, ...payload }
      setExistingPlan(updated)
      onPlanSaved?.(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save plan.')
    } finally {
      setSaving(false)
    }
  }

  // ── Reset goal ────────────────────────────────────────────────────────────
  async function handleResetGoal() {
    if (!existingPlan) return
    setResettingGoal(true)

    // New phase: starting weight = client's current weight, goal cleared
    const currentKg = profile?.current_weight
      ? (profile.weight_unit === 'lb'
          ? Math.round(profile.current_weight * 0.453592 * 10) / 10
          : Math.round(Number(profile.current_weight) * 10) / 10)
      : null

    const updates = {
      goal_reached:       false,
      starting_weight_kg: currentKg,
      goal_weight_kg:     null,
    }

    const { error: err } = await supabase
      .from('calorie_plans')
      .update(updates)
      .eq('user_id', userId)

    if (err) {
      setError(`Reset failed: ${err.message}`)
    } else {
      setExistingPlan(p => ({ ...p, ...updates }))
      onPlanSaved?.({ ...existingPlan, ...updates })

      // Sync local form fields
      if (currentKg != null) {
        setStartingWeightKg(String(currentKg))
        const dispKg = weightUnit === 'lb' ? currentKg / 0.453592 : currentKg
        setStartRaw(String(Math.round(dispKg * 10) / 10))
      }
      setGoalWeightKg('')
      setGoalRaw('')
    }
    setResettingGoal(false)
  }

  const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      {/* ── Form ── */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Intake Plan variables</h2>
            {existingPlan && existingPlan.goal_weight_kg != null && (
              <button
                type="button"
                onClick={handleResetGoal}
                disabled={resettingGoal}
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {resettingGoal ? 'Resetting…' : 'Reset goal'}
              </button>
            )}
          </div>

          {existingPlan?.goal_reached && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-400">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>This client has reached their goal. Progress is locked at 100% until you reset it and assign a new phase.</span>
            </div>
          )}

          <div>
            <SectionLabel hint="How active is the client day-to-day?">Activity level</SectionLabel>
            <StepSlider options={ACTIVITY_OPTIONS} value={activityFactor} onChange={setActivityFactor} />
          </div>

          <div>
            <SectionLabel hint="Slide left for fat loss, right for muscle gain">Energy balance</SectionLabel>
            <EnergySlider value={energyPct} onChange={setEnergyPct} tdee={previewTDEE} />
          </div>

          <div>
            <SectionLabel hint="Grams per kg of goal weight">Protein level</SectionLabel>
            <StepSlider options={PROTEIN_OPTIONS} value={proteinLevel} onChange={setProteinLevel} />
          </div>

          <div>
            <SectionLabel hint="% of total daily calories">Fat level</SectionLabel>
            <StepSlider options={FAT_OPTIONS} value={fatLevel} onChange={setFatLevel} />
          </div>

          {/* Weight target */}
          <div>
            <SectionLabel hint="Start persists for this phase; reset goal above to begin a new phase">Weight target</SectionLabel>
            <div className="flex items-stretch gap-2">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Start (this phase)</p>
                  <input
                    type="number"
                    value={startRaw}
                    onChange={e => {
                      const raw = e.target.value
                      setStartRaw(raw)
                      if (raw === '') { setStartingWeightKg(''); return }
                      const num = Number(raw)
                      if (!isNaN(num) && num > 0) {
                        const kg = weightUnit === 'lb' ? num * 0.453592 : num
                        setStartingWeightKg(String(Math.round(kg * 10) / 10))
                      }
                    }}
                    onBlur={() => {
                      if (startingWeightKg) {
                        const kg = Number(startingWeightKg)
                        const disp = weightUnit === 'lb' ? kg / 0.453592 : kg
                        setStartRaw((Math.round(disp * 10) / 10).toString())
                      } else {
                        setStartRaw('')
                      }
                    }}
                    step="0.1"
                    className={inputCls}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Goal</p>
                  <input
                    type="number"
                    value={goalRaw}
                    onChange={e => {
                      const raw = e.target.value
                      setGoalRaw(raw)
                      if (raw === '') { setGoalWeightKg(''); return }
                      const num = Number(raw)
                      if (!isNaN(num) && num > 0) {
                        const kg = weightUnit === 'lb' ? num * 0.453592 : num
                        setGoalWeightKg(String(Math.round(kg * 10) / 10))
                      }
                    }}
                    onBlur={() => {
                      if (goalWeightKg) {
                        const kg = Number(goalWeightKg)
                        const disp = weightUnit === 'lb' ? kg / 0.453592 : kg
                        setGoalRaw((Math.round(disp * 10) / 10).toString())
                      } else {
                        setGoalRaw('')
                      }
                    }}
                    step="0.1"
                    className={inputCls}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newUnit = weightUnit === 'kg' ? 'lb' : 'kg'
                  setWeightUnit(newUnit)
                  if (startingWeightKg) {
                    const kg = Number(startingWeightKg)
                    const disp = newUnit === 'lb' ? kg / 0.453592 : kg
                    setStartRaw((Math.round(disp * 10) / 10).toString())
                  }
                  if (goalWeightKg) {
                    const kg = Number(goalWeightKg)
                    const disp = newUnit === 'lb' ? kg / 0.453592 : kg
                    setGoalRaw((Math.round(disp * 10) / 10).toString())
                  }
                }}
                className="self-end flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                {weightUnit}
              </button>
            </div>
            {startingWeightKg && goalWeightKg && Number(goalWeightKg) > 0 && Number(startingWeightKg) > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {(() => {
                  const startKg  = Number(startingWeightKg)
                  const goalKg   = Number(goalWeightKg)
                  const diffKg   = Math.abs(startKg - goalKg)
                  const diffDisp = weightUnit === 'lb' ? diffKg / 0.453592 : diffKg
                  return `${diffDisp.toFixed(1)} ${weightUnit} to ${startKg > goalKg ? 'lose' : 'gain'}`
                })()}
              </p>
            )}
          </div>

          {/* Correction factor */}
          <div>
            <SectionLabel hint="1.0 = no correction  ·  0.1 = very conservative">Correction factor</SectionLabel>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0.1" max="1.0" step="0.05"
                value={correctionFactor}
                onChange={e => setCorrectionFactor(e.target.value)}
                className="flex-1 accent-primary"
              />
              <span className="w-10 text-sm font-mono text-right tabular-nums">{Number(correctionFactor).toFixed(2)}</span>
            </div>

            {/* Inline timeline */}
            {(() => {
              const tl = result?.timeline
              if (!tl) return (
                <div className="mt-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground">
                  Set goal weight to see projected timeline
                </div>
              )
              if (tl.mode === 'recomp') {
                const b = tl.monthsBest, r = tl.monthsRealistic
                const label = b === r ? `${b}` : `${b}–${r}`
                const unit  = (b === 1 && r === 1) ? 'month' : 'months'
                return (
                  <div className="mt-3 flex items-start gap-3 rounded-lg border border-purple-500/30 bg-purple-500/5 px-3 py-2.5">
                    <Info className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-purple-400">Body recomposition</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">approx. ~{label} {unit} of consistent training.</p>
                    </div>
                  </div>
                )
              }
              if (tl.mode === 'mismatch') return (
                <div className="mt-3 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-400">Direction mismatch</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Goal is to {tl.isLoss ? 'lose' : 'gain'} {tl.weightDiffKg.toFixed(1)} kg but the energy balance pushes the other way.
                    </p>
                  </div>
                </div>
              )
              const b = tl.monthsBest, r = tl.monthsRealistic
              const label = b === r ? `${b}` : `${b}–${r}`
              const unit  = (b === 1 && r === 1) ? 'month' : 'months'
              return (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                  {tl.isLoss ? <TrendingDown className="h-4 w-4 text-emerald-400 shrink-0" /> : <TrendingUp className="h-4 w-4 text-blue-400 shrink-0" />}
                  <div>
                    <p className="text-sm font-semibold tabular-nums">approx. ~{label} {unit}</p>
                    <p className="text-[11px] text-muted-foreground">to {tl.isLoss ? 'lose' : 'gain'} {tl.weightDiffKg.toFixed(1)} kg at this correction</p>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Meals */}
          <div>
            <SectionLabel hint="UP = let the client choose; otherwise this becomes their starting point">Number of meals</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setMealsAssignment(null)}
                className={`flex h-9 items-center justify-center rounded-full border px-4 text-xs font-semibold transition-all ${mealsAssignment === null ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
                UP
              </button>
              {[2, 3, 4, 5, 6].map(n => (
                <button key={n} type="button" onClick={() => setMealsAssignment(n)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-all ${mealsAssignment === n ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {mealsAssignment === null ? 'Client will be required to choose a meal frequency.' : `Client opens to ${mealsAssignment} meals/day — they can change it any time.`}
            </p>
          </div>

          {/* Client notes */}
          <div>
            <SectionLabel>Coach notes</SectionLabel>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving || missingData}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saved   ? <><Check   className="h-4 w-4" /> Intake Plan saved</>
          : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
          : existingPlan ? 'Update Intake Plan'
          : 'Assign Intake Plan'}
        </button>
      </form>

      {/* ── Live preview ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Live preview</h2>
          <span className="text-xs text-muted-foreground">
            {mealsAssignment != null ? `${mealsAssignment} meals/day` : 'User picks meals'}
          </span>
        </div>
        {missingData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Complete the user's profile to see a preview.</p>
        ) : !result ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Set a goal weight to see the plan.</p>
        ) : (
          <ResultCard result={result} meals={mealsAssignment ?? 3} />
        )}
      </div>
    </div>
  )
}
