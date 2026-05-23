/**
 * PlanWizardSheet — web port of mobile/src/components/PlanWizardSheet.tsx.
 *
 * First-time setup + re-entry edit flow for the self-coached user's
 * own calorie plan. Three screens with back/next nav:
 *   1. Pace        → energy_balance_pct + (derived) goal_weight_kg
 *   2. Activity    → activity_factor (1-5)
 *   3. Macros      → (protein_level, fat_level) pair via preset
 *
 * Defaults injected silently on save (NOT shown in the wizard):
 *   correction_factor  = 0.75
 *   starting_weight_kg = current_weight
 *   goal_weight_kg     = current_weight × pace.goal_delta_pct
 *   notes              = null
 *
 * Re-entry: pass an existing plan via the `existingPlan` prop and the
 * wizard highlights the user's current selections. Reusing the same
 * sheet for the empty-state "Set up my plan" CTA and the per-chip
 * "Edit this knob" surface is intentional — fewer surfaces to maintain.
 *
 * Save path: upsert calorie_plans row. RLS allows the write because
 * profiles.is_self_coached is true for this user (see
 * supabase/migrations/20260523_self_coached_plan.sql).
 */

import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  MACRO_PRESETS, MACRO_PRESET_ORDER, DEFAULT_MACRO_PRESET,
  PACE_OPTIONS,   PACE_OPTION_ORDER,   DEFAULT_PACE,
  ACTIVITY_OPTION_ORDER, ACTIVITY_FACTORS,
  SELF_COACHED_CORRECTION_FACTOR,
  deriveGoalWeightKg, macroPresetForPlan, paceForPlan,
} from '../lib/planPresets'
import { FAT_LEVELS, PROTEIN_LEVELS } from '../lib/calorieFormulas'

const STEP_ORDER = ['pace', 'activity', 'macros']

export default function PlanWizardSheet({
  isOpen, onClose, userId, currentWeightKg, existingPlan,
  startStep = 'pace',
  singleScreen = false,
  onSaved,
}) {
  const [step, setStep]     = useState(startStep)
  const [pace, setPace]     = useState(
    paceForPlan(existingPlan?.energy_balance_pct ?? null) ?? DEFAULT_PACE,
  )
  const [activity, setActivity] = useState(existingPlan?.activity_factor ?? 0)
  const [macro, setMacro]   = useState(
    macroPresetForPlan(
      existingPlan?.protein_level ?? null,
      existingPlan?.fat_level     ?? null,
    ) ?? DEFAULT_MACRO_PRESET,
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  // Re-seed when the wizard re-opens with fresh data.
  useEffect(() => {
    if (!isOpen) return
    setStep(startStep)
    setPace(paceForPlan(existingPlan?.energy_balance_pct ?? null) ?? DEFAULT_PACE)
    setActivity(existingPlan?.activity_factor ?? 0)
    setMacro(macroPresetForPlan(
      existingPlan?.protein_level ?? null,
      existingPlan?.fat_level     ?? null,
    ) ?? DEFAULT_MACRO_PRESET)
    setError(null)
  }, [isOpen, startStep, existingPlan])

  const stepIdx   = STEP_ORDER.indexOf(step)
  const isFirst   = stepIdx === 0
  const isLast    = stepIdx === STEP_ORDER.length - 1
  const stepValid =
    (step === 'pace'     && !!pace) ||
    (step === 'activity' && activity > 0) ||
    (step === 'macros'   && !!macro)
  const canSave   = activity > 0 && !!pace && !!macro

  function goNext() {
    if (!stepValid) return
    if (singleScreen) { handleSave(); return }
    if (isLast)       { handleSave(); return }
    setStep(STEP_ORDER[stepIdx + 1])
  }

  function goBack() {
    if (singleScreen) { onClose(); return }
    if (isFirst)      { onClose(); return }
    setStep(STEP_ORDER[stepIdx - 1])
  }

  async function handleSave() {
    if (!userId || !canSave || !currentWeightKg) {
      setError(currentWeightKg
        ? 'Please fill in every step before saving.'
        : 'We need your current weight first. Go to the Bodyweight page and log it.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const paceOpt    = PACE_OPTIONS[pace]
      const macroOpt   = MACRO_PRESETS[macro]
      const goalWeight = deriveGoalWeightKg(currentWeightKg, pace)

      const payload = {
        user_id:             userId,
        activity_factor:     activity,
        energy_balance_pct:  paceOpt.energy_balance_pct,
        energy_balance_type: null,
        protein_level:       macroOpt.protein_level,
        fat_level:           macroOpt.fat_level,
        goal_weight_kg:      goalWeight,
        starting_weight_kg:  Math.round(currentWeightKg * 10) / 10,
        correction_factor:   SELF_COACHED_CORRECTION_FACTOR,
        notes:               null,
        assigned_at:         new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      }

      const { error: err } = await supabase
        .from('calorie_plans')
        .upsert(payload, { onConflict: 'user_id' })

      if (err) {
        console.error('[PlanWizardSheet] upsert failed:', err)
        setError(err.message ?? 'Unknown error.')
        return
      }
      onSaved?.()
      onClose()
    } catch (e) {
      console.error('[PlanWizardSheet] save threw:', e)
      setError(e?.message ?? 'Unknown error.')
    } finally {
      setSaving(false)
    }
  }

  const title =
    step === 'pace'     ? 'How fast do you want to move?' :
    step === 'activity' ? 'How active are you?' :
                          'How do you eat?'

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border border-border bg-card shadow-2xl md:bottom-1/2 md:left-1/2 md:right-auto md:max-w-md md:w-full md:translate-x-[-50%] md:translate-y-1/2 md:rounded-2xl"
        style={{ maxHeight: '85dvh' }}
      >
        {/* Drag handle pill — mobile-only affordance, kept for consistency */}
        <div className="flex justify-center pt-2.5 pb-1.5 md:hidden">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
          {!singleScreen && !isFirst ? (
            <button
              onClick={goBack}
              className="flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-accent transition-colors"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : <div className="w-7" />}

          <div className="flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {!singleScreen && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Step {stepIdx + 1} of {STEP_ORDER.length}
              </p>
            )}
          </div>

          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {step === 'pace'     && <PaceScreen     value={pace}     onChange={setPace} />}
          {step === 'activity' && <ActivityScreen value={activity} onChange={setActivity} />}
          {step === 'macros'   && <MacrosScreen   value={macro}    onChange={setMacro} />}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Footer — Next / Save */}
        <div className="border-t border-border px-4 py-3">
          <button
            onClick={goNext}
            disabled={!stepValid || saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                {singleScreen || isLast ? 'Save' : 'Next'}
                {!(singleScreen || isLast) && <ChevronRight className="h-4 w-4" />}
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Per-screen renderers ─────────────────────────────────────────────────────

function PaceScreen({ value, onChange }) {
  return (
    <div className="space-y-2">
      {PACE_OPTION_ORDER.map(key => {
        const opt    = PACE_OPTIONS[key]
        const active = key === value
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background/40 hover:bg-accent/30'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>
            </div>
            {active && <Check className="h-4 w-4 text-primary shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

function ActivityScreen({ value, onChange }) {
  return (
    <div className="space-y-2">
      {ACTIVITY_OPTION_ORDER.map(key => {
        const opt    = ACTIVITY_FACTORS[key]
        const active = key === value
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background/40 hover:bg-accent/30'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
            </div>
            {active && <Check className="h-4 w-4 text-primary shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

function MacrosScreen({ value, onChange }) {
  return (
    <div className="space-y-2">
      {MACRO_PRESET_ORDER.map(key => {
        const opt     = MACRO_PRESETS[key]
        const active  = key === value
        const fatPct  = Math.round(FAT_LEVELS[opt.fat_level].pctOfCals * 100)
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background/40 hover:bg-accent/30'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>
              <div className="flex gap-1.5 mt-2">
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/15 text-blue-400">
                  P · {PROTEIN_LEVELS[opt.protein_level].label}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400">
                  F · {fatPct}%
                </span>
              </div>
            </div>
            {active && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
          </button>
        )
      })}
    </div>
  )
}
