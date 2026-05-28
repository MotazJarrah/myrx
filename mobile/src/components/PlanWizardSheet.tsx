/**
 * PlanWizardSheet — first-time setup + re-entry edit flow for the user's
 * own calorie plan (self-coached users only).
 *
 * Three screens with back/next nav:
 *   1. Pace        → maps to energy_balance_pct + (derived) goal_weight_kg
 *   2. Activity    → maps to activity_factor (1-5)
 *   3. Macros      → maps to (protein_level, fat_level) pair
 *
 * Defaults injected silently on save (NOT shown in the wizard):
 *   correction_factor  = 0.75
 *   starting_weight_kg = current_weight (from profile, or latest bodyweight log)
 *   goal_weight_kg     = current_weight × pace.goal_delta_pct
 *   notes              = null
 *
 * Re-entry: the parent passes the existing plan (if any) so the wizard
 * highlights the user's current selections. Reusing the same sheet for
 * the empty-state "Set up my plan" and the chip-driven "Edit this knob"
 * is intentional — fewer surfaces to maintain.
 *
 * Save path: upsert calorie_plans row. RLS allows the write because
 * profiles.is_self_coached is true for this user (see
 * supabase/migrations/20260523_self_coached_plan.sql).
 *
 * Mirrors the ChatSheet / SuggestionSheet / FoodLogDrawer modal shape:
 *   statusBarTranslucent Modal + GestureHandlerRootView + bottom sheet
 *   with marginBottom: insets.bottom so the sheet lifts above the
 *   Android gesture-nav bar.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
  LinearTransition,
} from 'react-native-reanimated'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react-native'

import { supabase } from '../lib/supabase'
import {
  MACRO_PRESETS, MACRO_PRESET_ORDER, type MacroPresetKey,
  PACE_OPTIONS,   PACE_OPTION_ORDER,   type PaceKey,
  ACTIVITY_OPTION_ORDER, ACTIVITY_FACTORS,
  SELF_COACHED_CORRECTION_FACTOR,
  deriveGoalWeightKg, predictLbDeltaForPace, predictLeanFatSplit, paceProfileWarning,
  macroProfileWarning,
  macroPresetForPlan, paceForPlan, resolveCarbCap,
  BODY_FAT_BAND_INFO, bodyFatGenderKey,
  evaluateRealism,
  formatLbDelta, formatWeightFromKg, formatProteinPerWeight,
  type BodyFatBand, type WeightUnit,
} from '../lib/planPresets'
import { FAT_LEVELS, PROTEIN_LEVELS, calcBMR } from '../lib/calorieFormulas'
import BodyCompPicker from './BodyCompPicker'
import TickerNumber from './TickerNumber'
import { colors, alpha, palette, withAlpha, fonts } from '../theme'

// ── Props ────────────────────────────────────────────────────────────────────

interface ExistingPlan {
  activity_factor?:     number | null
  energy_balance_pct?:  number | null
  protein_level?:       number | null
  fat_level?:           number | null
}

type StartStep = 'bodyComp' | 'pace' | 'activity' | 'macros' | 'reality'

interface Props {
  isOpen:           boolean
  onClose:          () => void
  userId:           string | null | undefined
  currentWeightKg:  number | null    // from bodyweight log or profile
  /** Profile fields needed for per-user TDEE math on the Pace step.
      Passed in by the Calories page from profiles.current_height +
      birthdate + gender. When any is null the Pace badges fall back
      to a relative-% display since BMR can't be computed. */
  heightCm:         number | null
  age:              number | null
  gender:           string | null
  /** Self-reported body fat band from profiles.body_fat_band. When
      null (first-time user, never picked) the wizard auto-prepends
      a BodyComp step. Once picked it's persisted server-side and
      this prop arrives populated so future opens skip the step. */
  bodyFatBand:      BodyFatBand | null
  /** User's preferred display unit for body weight (profile.weight_unit).
      Drives every weight + protein display in the wizard:
        • PaceScreen outcome badges (5.5 lb vs 2.5 kg, sign-aware)
        • PaceScreen lean/fat split lines (gains only)
        • MacrosScreen protein g/kg vs g/lb badges
        • RealityCheckScreen outcome card (delta, goal, BMI)
      Math layer stays canonical (kg + g/kg) — only display converts. */
  weightUnit:       WeightUnit
  existingPlan:     ExistingPlan | null
  /** Optional: deep-link the wizard straight to a specific screen
      (used by the inline edit chips so each chip opens only its
      relevant screen). Defaults to 'activity' (the first screen
      since the May 24 2026 reorder — activity drives TDEE which
      drives the pace screen's concrete weight outcomes). */
  startStep?:       StartStep
  /** Optional: when set, only show the one screen referenced by
      startStep — no back/next, just Save. Used by inline edit chips. */
  singleScreen?:    boolean
  onSaved?:         () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlanWizardSheet({
  isOpen, onClose, userId, currentWeightKg, heightCm, age, gender, bodyFatBand, weightUnit,
  existingPlan, startStep = 'activity', singleScreen = false, onSaved,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()

  // ── State seeded from existingPlan when present ──────────────────────────
  // First-time setup (no existingPlan): every value starts UNSET (null / 0)
  // so the user makes deliberate choices instead of accepting whichever
  // pre-selected default. The Next/Save CTA stays disabled until they pick
  // — see `stepValid` below. When the user re-opens the wizard to edit an
  // existing plan, we seed from that plan so the current pick is shown
  // and they can re-tap to confirm or change.
  // Body fat band state. Seeded from profile prop; updates locally when
  // the user picks on the BodyComp step; persisted to profiles.body_fat_band
  // in handleSave below so future wizard opens skip the picker.
  const [bodyFat, setBodyFat] = useState<BodyFatBand | null>(bodyFatBand)

  // Whether this wizard SESSION includes the BodyComp step. Locked at
  // open-time — NOT derived from current bodyFat state. If we recomputed
  // every render, the BodyComp step would vanish from stepOrder the
  // moment the user picked a band, breaking the step counter ("Step 1
  // of 4" → "Step 0 of 3") and triggering the back button on what's
  // still the first screen the user sees. Re-seeded by the open effect.
  //
  // Per May 24 2026 user request: the BodyComp step is ALWAYS included
  // in the full wizard flow (not just for first-time users without a
  // saved body_fat_band). When the user already has a band saved, the
  // step renders with that band pre-selected so the user can simply
  // tap Next to confirm — no force re-pick. singleScreen edits still
  // skip it (those are point edits to one knob, not the full flow).
  const [includeBodyComp, setIncludeBodyComp] = useState<boolean>(
    () => !singleScreen,
  )

  // Compute the initial step: if startStep was 'activity' (the default)
  // and this session includes BodyComp, override to 'bodyComp' so the
  // wizard opens at the picker. Inline single-screen edits
  // (startStep='pace'/'macros') are NOT redirected — they keep their
  // explicit destination.
  const effectiveStart: StartStep =
    includeBodyComp && startStep === 'activity'
      ? 'bodyComp'
      : startStep

  const [step, setStep]     = useState<StartStep>(effectiveStart)
  const [pace, setPace]     = useState<PaceKey | null>(() =>
    paceForPlan(existingPlan?.energy_balance_pct ?? null),
  )
  const [activity, setActivity] = useState<number>(
    () => existingPlan?.activity_factor ?? 0,
  )
  const [macro, setMacro] = useState<MacroPresetKey | null>(() =>
    macroPresetForPlan(
      existingPlan?.protein_level ?? null,
      existingPlan?.fat_level     ?? null,
    ),
  )
  const [saving, setSaving] = useState(false)

  // ── Swipe-down to dismiss ────────────────────────────────────────────────
  // Mirrors FoodLogDrawer / ChatSheet / SuggestionSheet exactly so the
  // wizard feels like every other bottom sheet in the app: drag the
  // handle/header down, release past 120 px (or with velocity > 800 px/s)
  // and it animates off-screen + closes. Mid-wizard swipe is equivalent
  // to tapping the X button — abandons whatever step the user was on,
  // nothing is persisted. Next open re-seeds from `existingPlan` (or
  // defaults if no plan exists yet) per the re-seed effect below.
  const dragY = useSharedValue(0)
  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }))
  const headerCloseGesture = useMemo(() => {
    return Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-20, 20])
      .onUpdate(e => {
        'worklet'
        dragY.value = Math.max(0, e.translationY)
      })
      .onEnd(e => {
        'worklet'
        const passedThreshold = e.translationY > 120 || e.velocityY > 800
        if (passedThreshold) {
          const remaining = screenH - dragY.value
          const duration = Math.max(120, Math.min(300, remaining * 0.5))
          dragY.value = withTiming(screenH, { duration }, () => {
            runOnJS(onClose)()
          })
        } else {
          dragY.value = withTiming(0, { duration: 180 })
        }
      })
  }, [onClose, screenH, dragY])

  // Re-seed when the wizard re-opens with fresh data. Also reset dragY
  // so the previous close-animation's final position doesn't bleed into
  // the next open (sheet starting half-dismissed would look wrong).
  // First-time open (existingPlan == null) leaves every pick blank.
  // BodyComp step ALWAYS included in the full flow (May 24 2026) —
  // pre-selected from saved profile.body_fat_band so returning users
  // can confirm with one Next tap. Inline edits (singleScreen) skip
  // BodyComp since they target one specific knob.
  useEffect(() => {
    if (!isOpen) return
    dragY.value = 0
    setBodyFat(bodyFatBand)
    const includeBC = !singleScreen
    setIncludeBodyComp(includeBC)
    const seed: StartStep =
      includeBC && startStep === 'activity' ? 'bodyComp' : startStep
    setStep(seed)
    setPace(paceForPlan(existingPlan?.energy_balance_pct ?? null))
    setActivity(existingPlan?.activity_factor ?? 0)
    setMacro(macroPresetForPlan(
      existingPlan?.protein_level ?? null,
      existingPlan?.fat_level     ?? null,
    ))
  }, [isOpen, startStep, existingPlan, bodyFatBand, singleScreen, dragY])

  // ── TDEE — recomputed live from chosen activity ──────────────────────────
  // BMR comes from height / age / gender / weight (Mifflin-St Jeor). Multiply
  // by the chosen activity factor to get TDEE, then the PaceScreen uses
  // TDEE × pace's energy_balance_pct × timeline to predict the concrete
  // weight outcome per option. Falls back to null when profile fields are
  // missing — PaceScreen handles the no-TDEE case with a relative-% display.
  const tdee = useMemo<number | null>(() => {
    if (!currentWeightKg || !heightCm || age == null) return null
    const bmr = calcBMR(currentWeightKg, heightCm, age, gender)
    if (activity > 0 && ACTIVITY_FACTORS[activity]) {
      return bmr * ACTIVITY_FACTORS[activity].value
    }
    // Activity not yet picked — TDEE undefined until step 1 completes.
    return null
  }, [currentWeightKg, heightCm, age, gender, activity])

  // ── Validation ────────────────────────────────────────────────────────────
  const canSave   = activity > 0 && !!pace && !!macro && !!bodyFat
  // Step order is fixed for the SESSION (see includeBodyComp state +
  // its locked-at-open behaviour above). BodyComp is prepended when
  // the user opened the wizard without an existing body_fat_band.
  // Activity goes before Pace so Pace can compute per-user weight
  // outcomes from TDEE. The 'reality' step (May 24 2026 lock) is the
  // final synthesis screen — runs evaluateRealism across all four
  // picks and renders a coach-voice plan summary + per-issue cards +
  // optional consolidated apply. ALWAYS the last step in the full
  // wizard flow; never present in singleScreen edit mode (inline edit
  // chips open one screen + Save, not the deep reality check).
  const stepOrder: StartStep[] = singleScreen
    ? [startStep]
    : includeBodyComp
      ? ['bodyComp', 'activity', 'pace', 'macros', 'reality']
      : ['activity', 'pace', 'macros', 'reality']
  const stepIdx   = stepOrder.indexOf(step)
  const isFirst   = stepIdx === 0
  const isLast    = stepIdx === stepOrder.length - 1
  const stepValid =
    (step === 'bodyComp' && !!bodyFat) ||
    (step === 'pace'     && !!pace) ||
    (step === 'activity' && activity > 0) ||
    (step === 'macros'   && !!macro)   ||
    // Reality step is always navigable forward (the screen itself
    // handles its own apply-suggestion CTA inline; the wizard's
    // Save button just needs all four picks to be valid).
    (step === 'reality'  && canSave)

  // Breadcrumb chips — accumulated selections from steps STRICTLY
  // before the current one. Gives the user a running snapshot at the
  // top of the wizard ("Lean · Very Active · Lose hard") so they
  // remember what they've already chosen as they progress. Hidden in
  // singleScreen edit mode (no notion of "previous steps" there).
  // 'reality' step doesn't contribute a breadcrumb of its own — it's
  // the synthesis OF the previous steps, not a pick.
  const breadcrumbChips = useMemo<string[]>(() => {
    if (singleScreen) return []
    const out: string[] = []
    for (let i = 0; i < stepIdx; i++) {
      const k = stepOrder[i]
      if (k === 'bodyComp' && bodyFat) {
        out.push(BODY_FAT_BAND_INFO[bodyFatGenderKey(gender)][bodyFat].label)
      } else if (k === 'activity' && activity > 0 && ACTIVITY_FACTORS[activity]) {
        out.push(ACTIVITY_FACTORS[activity].label)
      } else if (k === 'pace' && pace) {
        out.push(PACE_OPTIONS[pace].label)
      } else if (k === 'macros' && macro) {
        out.push(MACRO_PRESETS[macro].label)
      }
    }
    return out
  }, [stepIdx, stepOrder, bodyFat, activity, pace, macro, singleScreen, gender])

  // ── Apply suggested changes (called from RealityCheckScreen) ─────────────
  // The reality screen renders the consolidatedSuggestion as an "Apply
  // suggested changes" button. Tapping it flips parent state to match
  // the suggestion's fields (pace/macro/activity), which causes the
  // evaluator to re-run on the next render and the screen to show the
  // new (probably on_track) verdict. User then taps Save below to
  // commit. We never touch bodyFat from a suggestion — body fat is
  // self-reported, not coachable.
  function applySuggestion(s: { pace?: PaceKey; macro?: MacroPresetKey; activity?: number }) {
    if (s.pace     != null) setPace(s.pace)
    if (s.macro    != null) setMacro(s.macro)
    if (s.activity != null) setActivity(s.activity)
  }

  function goNext() {
    if (!stepValid) return
    if (singleScreen) { void handleSave(); return }
    if (isLast)       { void handleSave(); return }
    setStep(stepOrder[stepIdx + 1])
  }

  function goBack() {
    if (singleScreen) { onClose(); return }
    if (isFirst)      { onClose(); return }
    setStep(stepOrder[stepIdx - 1])
  }

  // ── Save → upsert calorie_plans ──────────────────────────────────────────
  async function handleSave() {
    if (!userId || !canSave || !currentWeightKg) {
      // currentWeightKg is required to derive goal_weight + protein. The
      // Calories page won't open the wizard without it, but guard anyway.
      Alert.alert(
        "Couldn't save",
        currentWeightKg
          ? 'Please fill in every step before saving.'
          : 'We need your current weight first. Go to the Bodyweight tab and log it.',
      )
      return
    }

    setSaving(true)
    try {
      const paceOpt    = PACE_OPTIONS[pace]
      const macroOpt   = MACRO_PRESETS[macro]
      // TDEE may be null at save time if profile fields are missing —
      // fall back to a generic 2000 cal/day TDEE so we still persist
      // some goal weight. The PaceScreen would have shown a relative
      // -% display in that case so the user knew their numbers were
      // approximate.
      const tdeeForSave = tdee ?? 2000
      // Pass activity + bodyFat into the goal derivation so the persisted
      // goal_weight_kg uses the SAME realism matrix as the badge the user
      // committed to. Without these, the helper falls back to 0.75 and the
      // stored goal mismatches the badge.
      const goalWeight  = deriveGoalWeightKg(currentWeightKg, pace, tdeeForSave, activity, bodyFat)

      const payload = {
        user_id:             userId,
        activity_factor:     activity,
        energy_balance_pct:  paceOpt.energy_balance_pct,
        energy_balance_type: null,                          // legacy field — not used by new flow
        protein_level:       macroOpt.protein_level,
        fat_level:           macroOpt.fat_level,
        // Carb cap (null for everything except Keto). Resolved per the
        // user's activity tier — Keto's cap scales 20g (sedentary) →
        // 50g (extreme). The DB column stores a single int; the
        // per-activity variation lives only in the in-memory preset.
        // calcMacros downstream uses this int directly to lock carbs
        // and make fat the residual (instead of fat_level as a %).
        carb_cap_g:          resolveCarbCap(macroOpt, activity),
        goal_weight_kg:      goalWeight,
        starting_weight_kg:  Math.round(currentWeightKg * 10) / 10,
        correction_factor:   SELF_COACHED_CORRECTION_FACTOR,
        // Reset goal_reached every time a NEW plan is saved (May 24
        // 2026 fix). The DB column is sticky — once set true, the
        // Calories page's progress formula forces 100% forever. When
        // the user re-runs the wizard with new picks, they're starting
        // a fresh phase, so progress should restart at 0% from the new
        // starting_weight_kg toward the new goal_weight_kg.
        goal_reached:        false,
        notes:               null,
        // assigned_by left null — distinguishes self-set plans from
        // admin-set plans in the audit trail.
        assigned_at:         new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      }

      const { error } = await supabase
        .from('calorie_plans')
        .upsert(payload, { onConflict: 'user_id' })

      if (error) {
        console.error('[PlanWizardSheet] upsert failed:', error)
        Alert.alert("Couldn't save", error.message ?? 'Unknown error.')
        return
      }

      // Persist body fat band on profile if it changed (or is newly set).
      // Errors here are non-fatal — the calorie_plans save already
      // succeeded. The realtime profile subscription in AuthContext will
      // pick up the update and refresh local profile cache automatically.
      if (bodyFat && bodyFat !== bodyFatBand) {
        const { error: bfErr } = await supabase
          .from('profiles')
          .update({ body_fat_band: bodyFat })
          .eq('id', userId)
        if (bfErr) console.warn('[PlanWizardSheet] body_fat_band update failed:', bfErr)
      }

      onSaved?.()
      onClose()
    } catch (e: any) {
      console.error('[PlanWizardSheet] save threw:', e)
      Alert.alert("Couldn't save", e?.message ?? 'Unknown error.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const title =
    step === 'bodyComp' ? 'Where are you starting from?' :
    step === 'pace'     ? 'How fast do you want to move?' :
    step === 'activity' ? 'How active are you?' :
    step === 'macros'   ? 'How do you eat?' :
                          'Lets get real now'

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={s.backdrop}>
          {/* layout={LinearTransition.duration(220)} animates ANY height
              change on this view — switching steps, showing/hiding the
              amber warning chip, even the ScrollView's intrinsic content
              re-flow. Without this, the sheet snap-resizes to the new
              content height which reads as a jump. 220 ms matches the
              swipe-dismiss timing so opening/closing/resizing all feel
              like part of the same animation system. */}
          <Animated.View
            style={[s.sheet, sheetAnimStyle, { marginBottom: insets.bottom, maxHeight: screenH - insets.top - 40 }]}
            layout={LinearTransition.duration(220)}
          >
            {/* Drag handle + Header — both wrapped in GestureDetector so
                a downward swipe on the top portion of the sheet dismisses
                it. Same mechanics as FoodLogDrawer / ChatSheet — Pan
                gesture with activeOffsetY(8) + failOffsetX([-20,20]) so
                small touches still register as Pressable taps on the
                back/close buttons, but a deliberate downward drag wins. */}
            <GestureDetector gesture={headerCloseGesture}>
              <View>
                {/* Drag handle */}
                <View style={s.dragHandleArea}>
                  <View style={s.dragHandlePill} />
                </View>

                {/* Header */}
                <View style={s.header}>
                  {!singleScreen && !isFirst ? (
                    <Pressable onPress={goBack} hitSlop={8} style={s.headerBtn}>
                      <ChevronLeft size={18} color={colors.foreground} />
                    </Pressable>
                  ) : <View style={s.headerBtn} />}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={s.headerTitle}>{title}</Text>
                    {!singleScreen && (
                      <Text style={s.headerSub}>Step {stepIdx + 1} of {stepOrder.length}</Text>
                    )}
                  </View>
                  {/* Close X removed May 27 2026 — swipe-down on the
                      drag handle / header area dismisses the sheet
                      (mirrors every other drawer in the app). The
                      empty headerBtn keeps the back-arrow centered. */}
                  <View style={s.headerBtn} />
                </View>
              </View>
            </GestureDetector>

            {/* Breadcrumb chip row — only renders once the user has at
                least one previous-step selection. Hidden in singleScreen
                edit mode. Quiet styling so it reads as a summary, not
                another action. */}
            {breadcrumbChips.length > 0 && (
              <View style={s.breadcrumbRow}>
                {breadcrumbChips.map((label, i) => (
                  <View key={`${i}-${label}`} style={s.breadcrumbChip}>
                    <Text style={s.breadcrumbChipText}>{label}</Text>
                  </View>
                ))}
              </View>
            )}

            <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
              {step === 'bodyComp' && <BodyCompPicker  value={bodyFat} onChange={setBodyFat} gender={gender} />}
              {step === 'pace'     && <PaceScreen     value={pace}     onChange={setPace}    currentWeightKg={currentWeightKg} tdee={tdee} activity={activity} bodyFat={bodyFat} weightUnit={weightUnit} />}
              {step === 'activity' && <ActivityScreen value={activity} onChange={setActivity} />}
              {step === 'macros'   && <MacrosScreen   value={macro}    onChange={setMacro}   currentWeightKg={currentWeightKg} tdee={tdee} activity={activity} bodyFat={bodyFat} weightUnit={weightUnit} />}
              {step === 'reality'  && (
                <RealityCheckScreen
                  pace={pace}
                  macro={macro}
                  activity={activity}
                  bodyFat={bodyFat}
                  currentWeightKg={currentWeightKg}
                  tdee={tdee}
                  weightUnit={weightUnit}
                  heightCm={heightCm}
                  onApplySuggestion={applySuggestion}
                />
              )}
            </ScrollView>

            {/* Footer — Next/Save */}
            <View style={[s.footer, { paddingBottom: 16 }]}>
              <Pressable
                onPress={goNext}
                disabled={!stepValid || saving}
                style={[s.cta, (!stepValid || saving) && s.ctaDisabled]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <>
                    <Text style={s.ctaText}>
                      {singleScreen || isLast ? 'Save' : 'Next'}
                    </Text>
                    {!(singleScreen || isLast) && <ChevronRight size={16} color={colors.primaryForeground} />}
                  </>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ── Per-screen renderers ─────────────────────────────────────────────────────

function PaceScreen({
  value, onChange, currentWeightKg, tdee, activity, bodyFat, weightUnit,
}: {
  value: PaceKey | null
  onChange: (k: PaceKey) => void
  currentWeightKg: number | null
  tdee: number | null
  activity: number
  bodyFat: BodyFatBand | null
  weightUnit: WeightUnit
}) {
  // Two-badge layout (May 24 2026 lock):
  //   1. PRIMARY badge — concrete commitment: "≈ -11 lb in 2 months" or
  //      "Stay at 175 lb". The lb delta is COMPUTED from the user's
  //      actual TDEE (BMR × activity factor picked on step 1):
  //        daily_delta = TDEE × energy_balance_pct
  //        total_cal   = daily_delta × timeline_months × 30
  //        lb_delta    = total_cal / 3500
  //      Two users at the same pace but different activity levels see
  //      different predicted outcomes — sedentary deficit produces less
  //      loss than active deficit at the same %, which is honest.
  //   2. SECONDARY badge — daily calorie change: "-25%". The means
  //      behind the commitment, not the commitment itself.
  // Both badges colored by direction: red lose, green gain, gray
  // maintain. Pace direction inferred from energy_balance_pct sign.
  return (
    <View style={{ gap: 8 }}>
      {PACE_OPTION_ORDER.map(key => {
        const opt    = PACE_OPTIONS[key]
        const active = key === value
        const calPct = Math.round(opt.energy_balance_pct * 100)
        const directionColor =
          opt.energy_balance_pct < 0 ? palette.red[400]
          : opt.energy_balance_pct > 0 ? palette.emerald[400]
          : palette.slate[400]
        // Outcome string — respects user's weight_unit (lb / kg). The
        // canonical math returns lb deltas + kg absolute weights;
        // formatters handle the conversion. Round to nearest 0.5 of
        // the display unit.
        const outcomeText = (() => {
          if (opt.timeline_months === 0) {
            return currentWeightKg
              ? `Stay at ${formatWeightFromKg(currentWeightKg, weightUnit)}`
              : 'Stay at current weight'
          }
          // No TDEE — should never happen under normal flow (Activity
          // is step 1; user can't reach Pace without picking activity
          // first). Defensive fallback shows "—" so we don't render
          // misleading numbers based on incomplete inputs. Only path
          // that could hit this: inline edit chip opens Pace directly
          // on a plan that was somehow saved with activity_factor=0,
          // OR profile is missing height/age/gender.
          if (tdee == null) {
            const monthTxt = opt.timeline_months === 1 ? '1 month' : `${opt.timeline_months} months`
            return `— in ${monthTxt}`
          }
          const lbDelta  = predictLbDeltaForPace(key, tdee, activity, bodyFat)
          const monthTxt = opt.timeline_months === 1 ? '1 month' : `${opt.timeline_months} months`
          return `${formatLbDelta(lbDelta, weightUnit, { withSign: true })} in ${monthTxt}`
        })()
        // Lean/fat split for GAIN rows. Null on loss/maintain — those
        // rows just show the scale outcome. For gain we render a small
        // second line: "≈ 2 lb muscle, ≈ 3 lb fat" — concrete numbers
        // so the user sees what their surplus actually produces (which
        // is mostly fat without training, per NASM partition tables).
        const split = (() => {
          if (tdee == null || !bodyFat || opt.energy_balance_pct <= 0) return null
          const scaleLb = predictLbDeltaForPace(key, tdee, activity, bodyFat)
          return predictLeanFatSplit(scaleLb, activity, bodyFat)
        })()
        // Inline amber warning chip removed (May 24 2026) — the
        // "Lets get real now" reality step now covers every concern
        // across all 4 picks in one consolidated view. Surfacing the
        // same warning twice (once on the row, once on the reality
        // step) was redundant and pre-empted the synthesis. The
        // paceProfileWarning() helper stays in planPresets.ts in case
        // we want to re-introduce per-step nudges later.
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[s.optionRow, active && s.optionRowActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.optionLabel, active && s.optionLabelActive]}>{opt.label}</Text>
              <Text style={s.optionTagline}>{opt.tagline}</Text>
              <View style={s.macroBadgeRow}>
                {/* Primary — concrete outcome */}
                <View style={[s.macroBadge, { backgroundColor: withAlpha(directionColor, 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: directionColor }]}>
                    {outcomeText}
                  </Text>
                </View>
                {/* Secondary — daily calorie change. Hidden for maintain
                    (calPct = 0 is "no change", showing it would just be
                    a "0%" chip with no info). */}
                {calPct !== 0 && (
                  <View style={[s.macroBadge, { backgroundColor: withAlpha(directionColor, 0.10) }]}>
                    <Text style={[s.macroBadgeText, { color: directionColor }]}>
                      {calPct > 0 ? `+${calPct}` : calPct}% daily cals
                    </Text>
                  </View>
                )}
              </View>
              {/* Lean/fat split — gain rows only. Shows the composition
                  of the scale gain so the user knows how much is muscle
                  vs fat. Sedentary → "~0 lb muscle" (honest). */}
              {split && (
                <Text style={s.splitLine}>
                  ≈ {formatLbDelta(split.leanLb, weightUnit)} muscle, ≈ {formatLbDelta(split.fatLb, weightUnit)} fat
                </Text>
              )}
            </View>
            {active && <Check size={16} color={colors.primary} />}
          </Pressable>
        )
      })}
    </View>
  )
}

function ActivityScreen({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {ACTIVITY_OPTION_ORDER.map(key => {
        const opt    = ACTIVITY_FACTORS[key]
        const active = key === value
        // Show the activity multiplier (e.g. ×1.55) — this is the number
        // BMR is multiplied by to get TDEE, so users can see exactly how
        // much higher their daily calorie target is per activity tier.
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[s.optionRow, active && s.optionRowActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.optionLabel, active && s.optionLabelActive]}>{opt.label}</Text>
              <Text style={s.optionTagline}>{opt.description}</Text>
              <View style={s.macroBadgeRow}>
                <View style={[s.macroBadge, { backgroundColor: withAlpha(palette.amber[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.amber[400] }]}>
                    ×{opt.value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} BMR
                  </Text>
                </View>
              </View>
            </View>
            {active && <Check size={16} color={colors.primary} />}
          </Pressable>
        )
      })}
    </View>
  )
}

function MacrosScreen({
  value, onChange, currentWeightKg, tdee, activity, bodyFat, weightUnit,
}: {
  value: MacroPresetKey | null
  onChange: (k: MacroPresetKey) => void
  currentWeightKg: number | null
  tdee: number | null
  activity: number
  bodyFat: BodyFatBand | null
  weightUnit: WeightUnit
}) {
  return (
    <View style={{ gap: 8 }}>
      {MACRO_PRESET_ORDER.map(key => {
        const opt     = MACRO_PRESETS[key]
        const active  = key === value
        const pGperKg = PROTEIN_LEVELS[opt.protein_level].gPerKg
        // Compute all three macro percentages dynamically using the
        // SAME math calcMacros() uses downstream — so the wizard's
        // preview matches the daily target the user actually gets.
        // Branches on carb_cap_g: when set (Keto), carbs lock at the
        // cap and fat is the residual; otherwise fat is fixed % and
        // carbs are residual. Falls back to generic weight/TDEE when
        // those inputs are missing (rare with activity-first order).
        const { fPct, cPct } = (() => {
          const w = currentWeightKg ?? 75
          const t = tdee ?? 2500
          const proteinCals = pGperKg * w * 4
          // Resolve the carb cap per the user's activity tier — Keto's
          // cap scales 20g (sedentary) → 50g (extreme) so the preview
          // matches what the user will actually be told to eat. Other
          // presets return null here and fall through to the fat-pct
          // residual model.
          const cap = resolveCarbCap(opt, activity)
          if (cap != null && cap > 0) {
            const carbCals = cap * 4
            const fatCals  = Math.max(0, t - proteinCals - carbCals)
            return {
              fPct: Math.max(0, Math.round((fatCals  / t) * 100)),
              cPct: Math.max(0, Math.round((carbCals / t) * 100)),
            }
          }
          const fatPct  = FAT_LEVELS[opt.fat_level].pctOfCals
          const fatCals = fatPct * t
          const carbCals = Math.max(0, t - proteinCals - fatCals)
          return {
            fPct: Math.round(fatPct * 100),
            cPct: Math.max(0, Math.round((carbCals / t) * 100)),
          }
        })()
        // Inline amber warning chip removed (May 24 2026) — the
        // "Lets get real now" reality step handles synthesis across
        // all 4 picks. The macroProfileWarning() helper stays in
        // planPresets.ts in case we want to re-introduce per-step
        // nudges later.
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[s.optionRow, active && s.optionRowActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.optionLabel, active && s.optionLabelActive]}>{opt.label}</Text>
              <Text style={s.optionTagline}>{opt.tagline}</Text>
              <View style={s.macroBadgeRow}>
                <View style={[s.macroBadge, { backgroundColor: withAlpha(palette.blue[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.blue[400] }]}>
                    P · {formatProteinPerWeight(pGperKg, weightUnit)}
                  </Text>
                </View>
                <View style={[s.macroBadge, { backgroundColor: withAlpha(palette.amber[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.amber[400] }]}>F · {fPct}%</Text>
                </View>
                <View style={[s.macroBadge, { backgroundColor: withAlpha(palette.emerald[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.emerald[400] }]}>C · {cPct}%</Text>
                </View>
              </View>
            </View>
            {active && <Check size={16} color={colors.primary} />}
          </Pressable>
        )
      })}
    </View>
  )
}

// ── HeroRow — stable presentational helper for RealityCheckScreen ────────────
//
// IMPORTANT: lives at MODULE scope, NOT inside RealityCheckScreen.
// Defining it inside would give it a fresh function identity on every
// parent re-render, which would unmount + remount TickerNumber and
// re-fire the slot-machine animation. The AuthContext heartbeat
// writes profiles.last_seen_at every 60s and our realtime sub echoes
// that back as a re-render — so an inline HeroRow would re-animate
// every minute for no reason. Module scope = stable identity = silent.
//
// Layout (v3 — May 24 2026 per user spec): each row is a two-line
// block where the inline descriptor sits ON THE SAME LINE as the big
// number (left-aligned, separated by a gap), and an optional secondary
// line sits underneath the big number — also left-aligned. Example:
//
//     +5 lb     weight to gain          ← top line: big + inline desc
//     ~2.5 lb muscle, ~2.5 lb fat       ← secondary, left-aligned
//
// `secondary` is optional — when absent the row collapses to just the
// top line (useful for loss rows where there's no lean/fat split).
function HeroRow({
  big, inlineDescriptor, secondary, color, useTicker = true,
}: {
  big:               string
  /** Sits on the SAME line as the big number, separated by a small
      gap. Muted styling so the big number remains the focal point. */
  inlineDescriptor:  string
  /** Optional second line BELOW the big number, also left-aligned.
      Used for the lean/fat split (Row 1), timeline-in-months (Row 2),
      BMI (Row 3), and the macro breakdown (Row 4). */
  secondary?:        string
  color?:            string
  /** False for non-digit-strong values (e.g. "by July 2026") that
      shouldn't try to slot-machine each character. */
  useTicker?:        boolean
}) {
  return (
    <View style={heroStyles.row}>
      <View style={heroStyles.topLine}>
        {useTicker ? (
          <TickerNumber
            value={big}
            fontSize={26}
            color={color ?? colors.foreground}
            fontWeight="700"
          />
        ) : (
          <Text style={[heroStyles.bigStatic, color ? { color } : null]}>{big}</Text>
        )}
        <Text style={heroStyles.inlineDescriptor} numberOfLines={2}>{inlineDescriptor}</Text>
      </View>
      {secondary != null && secondary !== '' && (
        <Text style={heroStyles.secondary}>{secondary}</Text>
      )}
    </View>
  )
}

const heroStyles = StyleSheet.create({
  // Per-row container — column so the secondary line wraps beneath
  // the topLine block. Tight gap (2px) because the secondary is a
  // continuation of the row, not a separate visual unit.
  row: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  // Top line — big number anchored LEFT, inline descriptor anchored
  // RIGHT (space-between pushes them to opposite ends of the row).
  // alignSelf: stretch on the row container is what gives us a
  // full-width row to span the card. The descriptor's right alignment
  // matches every other hero card's right-side descriptor pattern.
  topLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: 10,
  },
  bigStatic: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
    color: colors.foreground,
    lineHeight: 30,
  },
  inlineDescriptor: {
    fontSize: 12,
    color: colors.mutedForeground,
    lineHeight: 16,
    textAlign: 'right',
    flexShrink: 1,
  },
  secondary: {
    fontSize: 11,
    color: colors.mutedForeground,
    lineHeight: 15,
  },
})

/**
 * RealityCheckScreen — the 5th and final wizard step ("Lets get real now").
 * real now"). Renders the output of evaluateRealism() as a coach-voice
 * conversation about the user's plan as a whole.
 *
 * Layout (v2 — May 24 2026 lock per user feedback about text density):
 *
 *   1. Classification pill — color-coded summary of plan fit, with
 *      DYNAMIC issue-count text ("Two things to adjust" not "One thing").
 *   2. Brief intro line — one-sentence frame for the page. Replaces the
 *      long summary paragraph that was redundant with the issue cards
 *      and outcome card below.
 *   3. Issue cards (zero or more) — one per RealismIssue, each in
 *      coach voice (acknowledge → biology → next step), severity-
 *      coloured. Order: major first, then caution.
 *   4. Outcome card — moved BELOW the explanation per user UX rule
 *      "outcome naturally falls after the explanation, not before".
 *      Hero-card 3-line format (matches strength's NextTargetCallout
 *      pattern): big weight delta + timeline-with-date sub-line + thin
 *      separator + footer with goal weight & BMI.
 *   5. Consolidated apply card (when suggestions exist) — single tap
 *      flips parent state to the suggested package, reality re-
 *      evaluates on next render, classification typically becomes
 *      on_track. User then taps Save below to commit.
 *
 * Unit respect: every weight + protein display routes through formatters
 * in planPresets.ts that honor the user's profile.weight_unit setting.
 * Math layer stays in kg + g/kg (canonical) so the formulas never branch.
 *
 * Coach voice rule: see CLAUDE.md "Voice and Coaching Philosophy" —
 * all human-readable strings on this screen come from evaluateRealism
 * so updating the voice means editing the evaluator's message tables,
 * not this renderer.
 */
function RealityCheckScreen({
  pace, macro, activity, bodyFat, currentWeightKg, tdee, weightUnit, heightCm,
  onApplySuggestion,
}: {
  pace:             PaceKey | null
  macro:            MacroPresetKey | null
  activity:         number
  bodyFat:          BodyFatBand | null
  currentWeightKg:  number | null
  tdee:             number | null
  weightUnit:       WeightUnit
  heightCm:         number | null
  onApplySuggestion: (s: { pace?: PaceKey; macro?: MacroPresetKey; activity?: number }) => void
}) {
  // Defensive — under normal flow the user can't reach the reality
  // step without all four picks (the per-step stepValid gate blocks
  // the Next button). This handles the tiny edge where the wizard is
  // somehow opened on the reality step directly via startStep prop
  // without the other state hydrated.
  const verdict = useMemo(() => {
    if (!pace || !macro || !bodyFat || activity < 1 || !currentWeightKg || !tdee) return null
    return evaluateRealism({ pace, macro, activity, bodyFat, currentWeightKg, tdee })
  }, [pace, macro, activity, bodyFat, currentWeightKg, tdee])

  if (!verdict) {
    return (
      <View style={s.realityFallback}>
        <Text style={s.realityFallbackText}>
          Complete the previous steps so we can put your plan together.
        </Text>
      </View>
    )
  }

  // ── Pill: color + label ───────────────────────────────────────────
  // on_track → "Plan looks realistic" (green pill); anything else →
  // "Plan requires optimization" (amber for needs_tuning, red for
  // needs_rework — color still signals severity, label is shared).
  // The number of issue cards below already tells the user how many
  // tune-ups are needed; the pill is just the overall verdict.
  const headerColor =
    verdict.classification === 'on_track'     ? palette.emerald[400] :
    verdict.classification === 'needs_tuning' ? palette.amber[400]   :
                                                 palette.red[400]
  const classificationLabel = verdict.classification === 'on_track'
    ? 'Plan looks realistic'
    : 'Plan requires optimization'

  // ── Brief intro line — replaces the old summary paragraph ─────────
  // Single sentence framing the page; the issue cards + outcome card
  // below carry the actual content. "Here's how to optimize your plan"
  // when there are issues, "Here's what to expect" when on_track.
  const introLine = verdict.classification === 'on_track'
    ? "Your plan is well-matched — here's what to expect."
    : "Here's how to optimize your plan."

  // ── Outcome math + display strings ────────────────────────────────
  // All weights go through formatLbDelta / formatWeightFromKg so the
  // display respects the user's lb/kg setting. The big number's color
  // mirrors the direction (red for loss, green for gain, slate for
  // hold-steady). Sign character is the proper minus dash for parity
  // with the PaceScreen badges.
  const isLose = verdict.outcomeLb < -0.001
  const isGain = verdict.outcomeLb >  0.001
  const outcomeColor =
    isLose ? palette.red[400]
    : isGain ? palette.emerald[400]
    : palette.slate[400]
  // formatLbDelta with withSign:true produces "−5.5 lb" / "+3.5 lb" /
  // "0 lb" with the user's chosen unit. Maintain mode never reaches
  // here because predictLbDeltaForPace returns 0 (timeline_months===0),
  // which produces "0 lb" — we override below with "Hold steady".
  const bigDeltaText = isLose || isGain
    ? formatLbDelta(verdict.outcomeLb, weightUnit, { withSign: true })
    : 'Hold steady'

  // Row 2 — target date string ("by July 2026"). Month + year matches
  // the user-locked format: 1-2 month timelines all land within a
  // single calendar year, so day-precision isn't useful here; month-
  // year reads as a clear "by-the-end-of" commitment.
  const targetDateText = (() => {
    if (verdict.timelineMonths === 0) return 'ongoing'
    const d = new Date()
    d.setMonth(d.getMonth() + verdict.timelineMonths)
    return `by ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
  })()
  // Row 2 inline descriptor (next to date) + secondary line (below)
  // — per the new HeroRow contract. Inline names the concept; the
  // secondary gives the duration.
  const timelineInlineDescriptor = 'timeline to goal'
  const timelineSecondary = verdict.timelineMonths === 0
    ? ''
    : verdict.timelineMonths === 1
      ? '~1 month'
      : `~${verdict.timelineMonths} months`

  // Row 3 — goal weight. Inline descriptor names it; secondary
  // surfaces BMI when height is known (BMI uses goal weight as input,
  // not current — the user's looking at where they'll end up).
  const goalWeightText = formatWeightFromKg(verdict.goalWeightKg, weightUnit)
  const bmiText = (() => {
    if (!heightCm || heightCm <= 0) return null
    const heightM = heightCm / 100
    const bmi = verdict.goalWeightKg / (heightM * heightM)
    return (Math.round(bmi * 10) / 10).toFixed(1)
  })()
  const goalSecondary = bmiText ? `~${bmiText} BMI` : ''

  // Row 4 — daily calorie target + macro breakdown. Computed inline
  // because the math is small and only used here. Mirrors what
  // calcMacros() produces downstream so the wizard preview matches
  // the daily target the user will actually be given when they save.
  //   • dailyTarget = TDEE + (TDEE × energy_balance_pct)
  //   • protein     = pGperKg × goalWeightKg (sport-science convention
  //                   uses goal weight, not current — the user is
  //                   building the composition they're targeting)
  //   • fat / carb  → carb_cap_g branch when set (Keto), else fat-pct
  //                   residual branch (everything else)
  // Maintain mode → dailyTarget === TDEE, delta is 0.
  const macroSnapshot = (() => {
    if (!macro || !pace) return null
    const macroOpt    = MACRO_PRESETS[macro]
    const paceOpt     = PACE_OPTIONS[pace]
    const dailyDelta  = Math.round(tdee! * paceOpt.energy_balance_pct)
    const dailyTarget = Math.round(tdee! + dailyDelta)
    const pGperKg     = PROTEIN_LEVELS[macroOpt.protein_level].gPerKg
    const proteinG    = Math.round(pGperKg * verdict.goalWeightKg)
    const proteinCals = proteinG * 4
    const cap         = resolveCarbCap(macroOpt, activity)
    let fatG: number, carbG: number
    if (cap != null && cap > 0) {
      carbG = cap
      const carbCals = cap * 4
      const fatCals  = Math.max(0, dailyTarget - proteinCals - carbCals)
      fatG = Math.round(fatCals / 9)
    } else {
      const fatPct  = FAT_LEVELS[macroOpt.fat_level].pctOfCals
      const fatCals = fatPct * dailyTarget
      fatG = Math.round(fatCals / 9)
      const carbCals = Math.max(0, dailyTarget - proteinCals - fatCals)
      carbG = Math.round(carbCals / 4)
    }
    return { dailyTarget, dailyDelta, proteinG, fatG, carbG }
  })()

  // Outcome card label depends on classification: "Realistic outcome"
  // only when the plan is on_track (math + reality align). When picks
  // conflict, the projection is what the math says but the body will
  // fight it, so we call it "Expected outcome" — honest about the gap.
  const outcomeCardLabel = verdict.classification === 'on_track'
    ? 'Realistic outcome'
    : 'Expected outcome'

  // Row 1 descriptor — context-aware (May 24 2026). Earlier version
  // was the generic "weight to lose or gain" which read awkwardly
  // when the big number was "Hold steady" (no weight movement) or
  // when it was clearly a loss / gain (one or the other, not both).
  const row1Descriptor =
    isLose ? 'weight to lose'
    : isGain ? 'weight to gain'
    : 'no weight change planned'

  return (
    <View style={{ gap: 12 }}>
      {/* 1. Classification pill — first visual the user sees. */}
      <View style={[s.realityPill, { backgroundColor: withAlpha(headerColor, 0.15), borderColor: withAlpha(headerColor, 0.30) }]}>
        <Text style={[s.realityPillText, { color: headerColor }]}>{classificationLabel}</Text>
      </View>

      {/* 2. Brief intro line — single-sentence frame. */}
      <Text style={s.realityIntroLine}>{introLine}</Text>

      {/* 3. Issue cards — one per detected RealismIssue, severity-
            coloured. Each card has a short severity label + the full
            coach-voice paragraph from the evaluator's message table.
            Order: major first, then caution (sorted by evaluateRealism). */}
      {verdict.issues.map((issue, i) => {
        const issueColor =
          issue.severity === 'major' ? palette.red[400] : palette.amber[400]
        const issueLabel =
          issue.severity === 'major' ? 'Conflict with your goal' : 'Could be more efficient'
        return (
          <View
            key={`${issue.field}-${i}`}
            style={[
              s.realityIssueCard,
              {
                borderColor:     withAlpha(issueColor, 0.30),
                backgroundColor: withAlpha(issueColor, 0.08),
              },
            ]}
          >
            <Text style={[s.realityIssueLabel, { color: issueColor }]}>{issueLabel}</Text>
            <Text style={s.realityIssueText}>{issue.message}</Text>
          </View>
        )
      })}

      {/* 4. Consolidated apply card — only renders when the evaluator
            produced a suggestion. Single tap flips parent state; the
            screen re-evaluates with the new picks and shows the new
            (probably on_track) outcome. User then taps Save below. */}
      {verdict.consolidatedSuggestion && (
        <View style={s.realityActionCard}>
          <Text style={s.realityActionLabel}>{verdict.consolidatedSuggestion.label}</Text>
          <Text style={s.realityActionRationale}>{verdict.consolidatedSuggestion.rationale}</Text>
          <Pressable
            style={s.realityApplyBtn}
            onPress={() => onApplySuggestion(verdict.consolidatedSuggestion!)}
          >
            <Text style={s.realityApplyBtnText}>Apply suggested changes</Text>
          </Pressable>
          <Text style={s.realityKeepNote}>
            Or tap Save below to keep your original choices — your plan, your call.
          </Text>
        </View>
      )}

      {/* 5. Outcome card — moved to BOTTOM of the screen per UX rule
            (May 24 2026): outcome is the "if you save now, here's what
            you're committing to" view, sitting between any alternative
            (the apply card above) and the Save button (in the wizard
            footer below). Layout mirrors StairMill's hero card: 4
            stacked rows of big-number + descriptor, neutral chrome.
            Label flips between "Realistic outcome" (on_track) and
            "Expected outcome" (non-on_track) — honest about whether
            the math + the user's choices actually line up. */}
      <View style={s.realityOutcomeCard}>
        <Text style={s.realityCardLabel}>{outcomeCardLabel}</Text>
        <View style={s.realityHeroBody}>
          {/* Row 1 — weight delta. Inline descriptor adapts to
              direction (lose / gain / no change). Secondary line
              carries the lean/fat split on gain rows; null on loss
              and maintain so the row collapses to a single line. */}
          <HeroRow
            big={bigDeltaText}
            inlineDescriptor={row1Descriptor}
            color={outcomeColor}
            secondary={
              verdict.split
                ? `~${formatLbDelta(verdict.split.leanLb, weightUnit)} muscle, ~${formatLbDelta(verdict.split.fatLb, weightUnit)} fat`
                : undefined
            }
          />

          {/* Row 2 — target date + timeline. Hidden in maintain mode
              (no timeline). Date is not digit-strong (contains a month
              name), so useTicker={false}. */}
          {verdict.timelineMonths > 0 && (
            <HeroRow
              big={targetDateText}
              inlineDescriptor={timelineInlineDescriptor}
              secondary={timelineSecondary}
              useTicker={false}
            />
          )}

          {/* Row 3 — goal weight. Always renders. Secondary shows BMI
              when height is on file; collapses to a single line
              otherwise. */}
          <HeroRow
            big={goalWeightText}
            inlineDescriptor="goal weight"
            secondary={goalSecondary}
          />

          {/* Row 4 — daily delta vs maintenance (deficit or surplus).
              Color-coded by direction (red deficit / green surplus).
              Secondary line surfaces the macro breakdown so the user
              gets the full daily plan at a glance: HOW MUCH to add
              or subtract (top line) + WHAT to eat (secondary).
              Hidden when delta is 0 (maintain mode). */}
          {macroSnapshot && macroSnapshot.dailyDelta !== 0 && (
            <HeroRow
              big={
                macroSnapshot.dailyDelta > 0
                  ? `+${macroSnapshot.dailyDelta} cal`
                  : `−${Math.abs(macroSnapshot.dailyDelta)} cal`
              }
              inlineDescriptor={
                macroSnapshot.dailyDelta > 0
                  ? 'daily surplus'
                  : 'daily deficit'
              }
              secondary={`P ${macroSnapshot.proteinG}g · F ${macroSnapshot.fatG}g · C ${macroSnapshot.carbG}g per day`}
              color={
                macroSnapshot.dailyDelta > 0
                  ? palette.emerald[400]
                  : palette.red[400]
              }
            />
          )}
        </View>
      </View>
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.50)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  dragHandleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  dragHandlePill: { width: 40, height: 4, borderRadius: 2, backgroundColor: alpha(colors.mutedForeground, 0.35) },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  headerSub:   { fontSize: 11, color: colors.mutedForeground, marginTop: 2 },

  body:        { flexGrow: 0, flexShrink: 1 },
  bodyContent: { padding: 16, gap: 8 },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.background, 0.40),
  },
  optionRowActive: {
    borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.08),
  },
  optionLabel:       { fontSize: 14, fontWeight: '600', color: colors.foreground },
  optionLabelActive: { color: colors.primary },
  optionTagline:     { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },

  macroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  macroBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  macroBadgeText:{ fontSize: 10, fontWeight: '600' },
  // Breadcrumb row sits below the header, between the title strip and
  // the body content. Pill-style chips show accumulated selections
  // from previous steps. Quiet primary tint — informational, not
  // actionable.
  breadcrumbRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  breadcrumbChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: alpha(colors.primary, 0.10),
    borderColor: alpha(colors.primary, 0.30), borderWidth: 1,
  },
  breadcrumbChipText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  // Lean/fat split shown below the badge row on gain rows. Quiet line,
  // sits right under the badges so the eye reads "scale gain" then
  // "what that gain actually is".
  splitLine: {
    fontSize: 11,
    color: colors.mutedForeground,
    marginTop: 6,
  },
  // Tier 3 amber warning chip — sits at the bottom of the selected
  // row's content, under the badges + lean/fat split. Its own amber
  // tint sits on top of the green selection shade so it reads cleanly.
  // marginTop separates it from the badges above. Soft amber tint so
  // it reads as informational, not error.
  warningChip: {
    marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: withAlpha(palette.amber[500], 0.12),
    borderColor: withAlpha(palette.amber[500], 0.30), borderWidth: 1,
  },
  warningChipText: { fontSize: 11, color: palette.amber[400], lineHeight: 15 },

  // ── Reality check screen ─────────────────────────────────────────────
  // The 5th wizard step's visual language: pill + cards + issue cards
  // + action card. Cards stack vertically with 12 px gap (from parent
  // View's gap: 12). Each card has consistent inner padding + a quiet
  // dark background so the page reads as one scrolling conversation
  // rather than a grid of widgets.
  realityFallback: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: alpha(colors.background, 0.40),
    borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  realityFallbackText: {
    fontSize: 13,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
  },
  realityPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  realityPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  // Brief intro line — replaces the heavy summary card. Sits between
  // the classification pill and the issue cards. Quiet typography so
  // it reads as a frame, not another claim.
  realityIntroLine: {
    fontSize: 13,
    color: colors.mutedForeground,
    lineHeight: 18,
    marginBottom: 4,
  },
  realityCardLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    color: colors.mutedForeground,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  // Outcome card — StairMill hero pattern (v3, May 24 2026). Four
  // stacked rows of (big-number + descriptor) instead of the earlier
  // headline + sub-line + separator + footer layout. Quiet neutral
  // chrome (dark fill, neutral border) so it reads as a synthesis card,
  // not a domain-themed card. Sits BELOW the apply card now (last
  // thing before Save).
  realityOutcomeCard: {
    padding: 14,
    backgroundColor: alpha(colors.background, 0.40),
    borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  // Body wrapper around the 4 rows — gap controls vertical rhythm
  // between rows. Tighter than the previous side-by-side layout
  // because each row is now ~50px tall (big + descriptor stacked)
  // instead of one ~30px line, so we shrink the inter-row gap.
  realityHeroBody: {
    marginTop: 6,
    gap: 12,
  },
  // HeroRow + its sub-styles live at MODULE scope in heroStyles
  // (immediately above the RealityCheckScreen function) — see the big
  // comment there for the reason. Don't redefine them here.

  // Lean/fat split sub-line — sits under Row 1 on gain-direction
  // outcomes only. Pulled up slightly to read as Row 1's caption.
  realityOutcomeSplit: {
    fontSize: 11,
    color: colors.mutedForeground,
    marginTop: -6,
    marginLeft: 2,
  },
  realityIssueCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  realityIssueLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  realityIssueText: { fontSize: 13, color: colors.foreground, lineHeight: 19 },
  realityActionCard: {
    padding: 14,
    backgroundColor: alpha(colors.primary, 0.08),
    borderRadius: 10,
    borderWidth: 1, borderColor: alpha(colors.primary, 0.30),
    gap: 8,
  },
  realityActionLabel: { fontSize: 13, fontWeight: '700', color: colors.primary },
  realityActionRationale: { fontSize: 12, color: colors.foreground, lineHeight: 17 },
  realityApplyBtn: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  realityApplyBtnText: { fontSize: 13, fontWeight: '700', color: colors.primaryForeground },
  realityKeepNote: { fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },

  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText:     { fontSize: 14, fontWeight: '700', color: colors.primaryForeground },
})
