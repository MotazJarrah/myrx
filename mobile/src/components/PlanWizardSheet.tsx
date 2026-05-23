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
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react-native'

import { supabase } from '../lib/supabase'
import {
  MACRO_PRESETS, MACRO_PRESET_ORDER, DEFAULT_MACRO_PRESET, type MacroPresetKey,
  PACE_OPTIONS,   PACE_OPTION_ORDER,   DEFAULT_PACE,          type PaceKey,
  ACTIVITY_OPTION_ORDER, ACTIVITY_FACTORS,
  SELF_COACHED_CORRECTION_FACTOR,
  deriveGoalWeightKg, macroPresetForPlan, paceForPlan,
} from '../lib/planPresets'
import { FAT_LEVELS, PROTEIN_LEVELS } from '../lib/calorieFormulas'
import { colors, alpha, palette } from '../theme'

// ── Props ────────────────────────────────────────────────────────────────────

interface ExistingPlan {
  activity_factor?:     number | null
  energy_balance_pct?:  number | null
  protein_level?:       number | null
  fat_level?:           number | null
}

type StartStep = 'pace' | 'activity' | 'macros'

interface Props {
  isOpen:           boolean
  onClose:          () => void
  userId:           string | null | undefined
  currentWeightKg:  number | null    // from bodyweight log or profile
  existingPlan:     ExistingPlan | null
  /** Optional: deep-link the wizard straight to a specific screen
      (used by the inline edit chips so each chip opens only its
      relevant screen). Defaults to 'pace' (the first screen). */
  startStep?:       StartStep
  /** Optional: when set, only show the one screen referenced by
      startStep — no back/next, just Save. Used by inline edit chips. */
  singleScreen?:    boolean
  onSaved?:         () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlanWizardSheet({
  isOpen, onClose, userId, currentWeightKg, existingPlan,
  startStep = 'pace', singleScreen = false, onSaved,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()

  // ── State seeded from existingPlan when present ──────────────────────────
  const [step, setStep]     = useState<StartStep>(startStep)
  const [pace, setPace]     = useState<PaceKey>(() =>
    paceForPlan(existingPlan?.energy_balance_pct ?? null) ?? DEFAULT_PACE,
  )
  const [activity, setActivity] = useState<number>(
    () => existingPlan?.activity_factor ?? 0,
  )
  const [macro, setMacro] = useState<MacroPresetKey>(() =>
    macroPresetForPlan(
      existingPlan?.protein_level ?? null,
      existingPlan?.fat_level     ?? null,
    ) ?? DEFAULT_MACRO_PRESET,
  )
  const [saving, setSaving] = useState(false)

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
  }, [isOpen, startStep, existingPlan])

  // ── Validation ────────────────────────────────────────────────────────────
  const canSave   = activity > 0 && !!pace && !!macro
  const stepOrder: StartStep[] = ['pace', 'activity', 'macros']
  const stepIdx   = stepOrder.indexOf(step)
  const isFirst   = stepIdx === 0
  const isLast    = stepIdx === stepOrder.length - 1
  const stepValid =
    (step === 'pace'     && !!pace) ||
    (step === 'activity' && activity > 0) ||
    (step === 'macros'   && !!macro)

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
      const goalWeight = deriveGoalWeightKg(currentWeightKg, pace)

      const payload = {
        user_id:             userId,
        activity_factor:     activity,
        energy_balance_pct:  paceOpt.energy_balance_pct,
        energy_balance_type: null,                          // legacy field — not used by new flow
        protein_level:       macroOpt.protein_level,
        fat_level:           macroOpt.fat_level,
        goal_weight_kg:      goalWeight,
        starting_weight_kg:  Math.round(currentWeightKg * 10) / 10,
        correction_factor:   SELF_COACHED_CORRECTION_FACTOR,
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
    step === 'pace'     ? 'How fast do you want to move?' :
    step === 'activity' ? 'How active are you?' :
                          'How do you eat?'

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
          <View style={[s.sheet, { marginBottom: insets.bottom, maxHeight: screenH - insets.top - 40 }]}>
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
              <Pressable onPress={onClose} hitSlop={8} style={s.headerBtn}>
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
              {step === 'pace'     && <PaceScreen     value={pace}     onChange={setPace} />}
              {step === 'activity' && <ActivityScreen value={activity} onChange={setActivity} />}
              {step === 'macros'   && <MacrosScreen   value={macro}    onChange={setMacro} />}
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
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ── Per-screen renderers ─────────────────────────────────────────────────────

function PaceScreen({ value, onChange }: { value: PaceKey; onChange: (k: PaceKey) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {PACE_OPTION_ORDER.map(key => {
        const opt    = PACE_OPTIONS[key]
        const active = key === value
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[s.optionRow, active && s.optionRowActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.optionLabel, active && s.optionLabelActive]}>{opt.label}</Text>
              <Text style={s.optionTagline}>{opt.tagline}</Text>
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
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[s.optionRow, active && s.optionRowActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.optionLabel, active && s.optionLabelActive]}>{opt.label}</Text>
              <Text style={s.optionTagline}>{opt.description}</Text>
            </View>
            {active && <Check size={16} color={colors.primary} />}
          </Pressable>
        )
      })}
    </View>
  )
}

function MacrosScreen({ value, onChange }: { value: MacroPresetKey; onChange: (k: MacroPresetKey) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {MACRO_PRESET_ORDER.map(key => {
        const opt    = MACRO_PRESETS[key]
        const active = key === value
        const pPct   = Math.round(PROTEIN_LEVELS[opt.protein_level].gPerKg * 4 / 10 * 100) / 100   // ~heuristic visual badge
        const fPct   = Math.round(FAT_LEVELS[opt.fat_level].pctOfCals * 100)
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
                <View style={[s.macroBadge, { backgroundColor: alpha(palette.blue[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.blue[400] }]}>P · {PROTEIN_LEVELS[opt.protein_level].label}</Text>
                </View>
                <View style={[s.macroBadge, { backgroundColor: alpha(palette.amber[400], 0.15) }]}>
                  <Text style={[s.macroBadgeText, { color: palette.amber[400] }]}>F · {fPct}%</Text>
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

  macroBadgeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  macroBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  macroBadgeText:{ fontSize: 10, fontWeight: '600' },

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
