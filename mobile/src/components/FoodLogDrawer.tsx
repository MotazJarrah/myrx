/**
 * FoodLogDrawer — port of MyRX/src/components/FoodLogDrawer.jsx to React Native.
 *
 * Bottom-sheet (Modal slideUp) for logging food on a specific day.
 *
 * View flow (single Modal, content swap based on `view` state):
 *   log    → list slots + entries, "Add food" → search
 *   search → search input + barcode + habit-foods + USDA results → tap food → portion
 *   portion → unit + qty + live preview → "Add to <slot>" → log
 *   edit   → same UI as portion but pre-populated, "Save changes" → log
 *
 * Hybrid meal slots: 4 anchor slots (breakfast/lunch/dinner/snacks) + custom
 * slots inserted between them. Layout can be saved as user default.
 *
 * Habit foods: per-slot exponentially-decayed score across last 90 days of logs.
 * Excluded recents are tracked in AsyncStorage, NOT localStorage like the web.
 */

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react'
import {
  View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator,
  StyleSheet, Keyboard, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  X, Search, ChevronLeft, Plus, Send, ScanLine, AlertCircle,
} from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import {
  searchFoods, getFoodPortions, calcMacros, lookupBarcode,
  type FoodItem, type PortionOption,
} from '../lib/foodLibrary'
import { NumericInput } from './NumericInput'
import DeleteAction from './DeleteAction'
import { BarcodeScanner } from './BarcodeScanner'
import { colors, alpha, palette, withAlpha, fonts } from '../theme'

// ── Constants ─────────────────────────────────────────────────────────────────

export interface MealSlot {
  id:    string
  label: string
  emoji: string
}

export const DEFAULT_SLOTS: MealSlot[] = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

export const ANCHOR_IDS = new Set(['breakfast', 'lunch', 'dinner', 'snacks'])

export const EXTRA_PRESETS: MealSlot[] = [
  { id: 'morning_snack',   label: 'Morning Snack',   emoji: '🥐' },
  { id: 'pre_workout',     label: 'Pre-Workout',     emoji: '⚡' },
  { id: 'post_workout',    label: 'Post-Workout',    emoji: '💪' },
  { id: 'afternoon_snack', label: 'Afternoon Snack', emoji: '🍇' },
  { id: 'evening_meal',    label: 'Evening Meal',    emoji: '🌆' },
]

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function todayIso(): string {
  return isoDate(new Date())
}

function fmtDay(iso: string): string {
  if (iso === todayIso()) return 'Today'
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Food log entry shape (matches food_logs row) ─────────────────────────────

export interface FoodLogEntry {
  id:            string
  meal_slot:     string
  food_name:     string
  brand_name:    string | null
  fdc_id:        string | null
  portion_label: string
  portion_qty:   number
  portion_g:     number
  calories:      number
  protein_g:     number
  fat_g:         number
  carbs_g:       number
  created_at:    string
}

// ── Macro chip row ─────────────────────────────────────────────────────────

function MacroRow({ protein, fat, carbs }: { protein: number; fat: number; carbs: number }) {
  return (
    <View style={s.macroRow}>
      <Text style={[s.macroChipText, { color: palette.blue[400] }]}>P {Math.round(protein * 10) / 10}g</Text>
      <Text style={[s.macroChipText, { color: palette.amber[400] }]}>F {Math.round(fat * 10) / 10}g</Text>
      <Text style={[s.macroChipText, { color: palette.emerald[400] }]}>C {Math.round(carbs * 10) / 10}g</Text>
    </View>
  )
}

// ── Food item row (in log view) ────────────────────────────────────────────

function FoodItemRow({
  item, onDelete, onEdit,
}: { item: FoodLogEntry; onDelete: () => Promise<void>; onEdit: () => void }) {
  return (
    <DeleteAction onDelete={onDelete} bg={colors.card}>
      <Pressable onPress={onEdit} style={s.entryRow}>
        <View style={s.entryRowLeft}>
          <Text style={s.entryName} numberOfLines={1}>{item.food_name}</Text>
          <Text style={s.entryPortion} numberOfLines={1}>{item.portion_label}</Text>
        </View>
        <View style={s.entryRowRight}>
          <Text style={s.entryKcal}>{Math.round(item.calories)} kcal</Text>
          <MacroRow protein={item.protein_g} fat={item.fat_g} carbs={item.carbs_g} />
        </View>
      </Pressable>
    </DeleteAction>
  )
}

// ── Search result row ─────────────────────────────────────────────────────────

function SearchResult({ food, onPress }: { food: FoodItem; onPress: () => void }) {
  const hasServing = (food.servingGrams ?? 0) > 0
  const displayKcal = hasServing
    ? Math.round(food.per100g.calories * (food.servingGrams ?? 0) / 100)
    : food.per100g.calories
  const servingText = hasServing
    ? `${Math.round(food.servingGrams ?? 0)}g / serving`
    : 'per 100g'

  const srcBadge = food.source === 'on'
    ? { bg: 'rgba(139,92,246,0.15)',  fg: palette.violet[400],  label: 'ON'   }
    : food.source === 'myrx'
      ? { bg: 'rgba(16,185,129,0.15)', fg: palette.emerald[400], label: 'MYRX' }
      : { bg: 'rgba(14,165,233,0.15)', fg: palette.sky[400],     label: 'USDA' }

  return (
    <Pressable onPress={onPress} style={s.searchRow}>
      <View style={s.searchRowLeft}>
        <Text style={s.searchName} numberOfLines={1}>{food.name}</Text>
        <View style={s.searchSub}>
          {food.brand ? <Text style={s.searchBrand} numberOfLines={1}>{food.brand}</Text> : null}
          <View style={[s.srcBadge, { backgroundColor: srcBadge.bg }]}>
            <Text style={[s.srcBadgeText, { color: srcBadge.fg }]}>{srcBadge.label}</Text>
          </View>
        </View>
      </View>
      <View style={s.searchRowRight}>
        <Text style={s.searchKcal}>{displayKcal} kcal</Text>
        <Text style={s.searchServing}>{servingText}</Text>
      </View>
    </Pressable>
  )
}

// ── Habit dots ─────────────────────────────────────────────────────────────

function HabitDots({ score }: { score: number }) {
  const filled = score >= 6 ? 3 : score >= 2 ? 2 : 1
  return (
    <View style={s.habitDots}>
      {[1, 2, 3].map(i => (
        <View
          key={i}
          style={[
            s.habitDot,
            {
              backgroundColor: i <= filled
                ? filled === 3 ? palette.amber[400]
                  : filled === 2 ? alpha(palette.amber[400], 0.7)
                  : alpha(colors.mutedForeground, 0.40)
                : alpha(colors.mutedForeground, 0.15),
            },
          ]}
        />
      ))}
    </View>
  )
}

// ── Recent / habit food row (search empty state) ─────────────────────────────

function RecentFoodRow({
  food, onPress, onDelete,
}: { food: FoodItem; onPress: () => void; onDelete: () => void }) {
  const hasServing = (food.servingGrams ?? 0) > 0
  const displayKcal = hasServing
    ? Math.round(food.per100g.calories * (food.servingGrams ?? 0) / 100)
    : food.per100g.calories
  const servingText = hasServing
    ? (food.servingLabel ? `${food.servingLabel}` : `${food.servingGrams}g`)
    : 'per 100g'

  return (
    <View style={s.recentRow}>
      <Pressable onPress={onPress} style={s.recentLeft}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.recentNameRow}>
            <Text style={s.searchName} numberOfLines={1}>{food.name}</Text>
            {food.habitScore != null && <HabitDots score={food.habitScore} />}
          </View>
          {food.brand ? <Text style={s.searchBrand} numberOfLines={1}>{food.brand}</Text> : null}
        </View>
        <View style={s.searchRowRight}>
          <Text style={s.searchKcal}>{displayKcal} kcal</Text>
          <Text style={s.searchServing}>{servingText}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onDelete} style={s.recentDeleteBtn} accessibilityLabel="Remove from habits" hitSlop={8}>
        <X size={14} color={alpha(colors.mutedForeground, 0.40)} />
      </Pressable>
    </View>
  )
}

// ── Insert divider between meal slots ─────────────────────────────────────────

function InsertDivider({
  open, onOpen, onInsert, existingIds, customLabel, onCustomLabelChange,
}: {
  open:                 boolean
  onOpen:               () => void
  onInsert:             (slot: MealSlot) => void
  existingIds:          Set<string>
  customLabel:          string
  onCustomLabelChange:  (v: string) => void
}) {
  const [showCustom, setShowCustom] = useState(false)

  useEffect(() => {
    if (!open) setShowCustom(false)
  }, [open])

  const availablePresets = EXTRA_PRESETS.filter(p => !existingIds.has(p.id))

  function handleCustomSubmit() {
    const label = customLabel.trim()
    if (!label) return
    const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom'
    let id = baseId
    let n = 2
    while (existingIds.has(id)) { id = `${baseId}_${n++}` }
    onInsert({ id, label, emoji: '🍽️' })
  }

  return (
    <View style={s.dividerWrap}>
      <Pressable onPress={onOpen} style={s.dividerTrigger}>
        <View style={[s.dividerLine, open && s.dividerLineOpen]} />
        <View style={s.dividerLabelRow}>
          <Plus size={10} color={open ? colors.primary : alpha(colors.mutedForeground, 0.35)} />
          <Text style={[s.dividerLabel, { color: open ? colors.primary : alpha(colors.mutedForeground, 0.35) }]}>
            {open ? 'Cancel' : 'Add meal'}
          </Text>
        </View>
        <View style={[s.dividerLine, open && s.dividerLineOpen]} />
      </Pressable>

      {open && (
        <View style={s.dividerPanel}>
          {!showCustom ? (
            <>
              <Text style={s.dividerHelp}>Insert a meal between these slots</Text>
              <View style={s.presetWrap}>
                {availablePresets.map(p => (
                  <Pressable
                    key={p.id}
                    onPress={() => onInsert(p)}
                    style={s.presetPill}
                  >
                    <Text style={s.presetPillText}>{p.emoji} {p.label}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setShowCustom(true)} style={[s.presetPill, s.presetPillDashed]}>
                  <Text style={s.presetPillText}>Custom…</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={s.dividerHelp}>Custom meal name</Text>
              <View style={s.customRow}>
                <TextInput
                  value={customLabel}
                  onChangeText={onCustomLabelChange}
                  onSubmitEditing={handleCustomSubmit}
                  placeholder="e.g. Late-night snack"
                  placeholderTextColor={alpha(colors.mutedForeground, 0.6)}
                  maxLength={40}
                  style={s.customInput}
                  autoFocus
                />
                <Pressable
                  onPress={handleCustomSubmit}
                  disabled={!customLabel.trim()}
                  style={[s.customBtn, !customLabel.trim() && { opacity: 0.4 }]}
                >
                  <Text style={s.customBtnText}>Add</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setShowCustom(false)}>
                <Text style={s.customBack}>← Back to presets</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  )
}

// ── Portion picker (used by both 'portion' and 'edit' views) ─────────────────

function PortionPicker({
  food, portions, loadingPortions, servingsPerContainer, mealSlot, onMealChange, slots,
  onSubmit, onBack, mode, initialSelectedId, initialQty,
}: {
  food:                 FoodItem
  portions:             PortionOption[]
  loadingPortions:      boolean
  servingsPerContainer: number | null
  mealSlot:             string
  onMealChange:         (id: string) => void
  slots:                MealSlot[]
  onSubmit:             (payload: PortionSubmitPayload) => Promise<void>
  onBack:               () => void
  mode:                 'add' | 'edit'
  initialSelectedId?:   string | null
  initialQty?:          string | null
}) {
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId ?? 'g')
  const [qty,        setQty]        = useState<string>(initialQty ?? '')
  const [adding,     setAdding]     = useState(false)

  useEffect(() => { if (initialSelectedId) setSelectedId(initialSelectedId) }, [initialSelectedId])
  useEffect(() => { if (initialQty)        setQty(String(initialQty))      }, [initialQty])

  const selectedPortion = portions.find(p => p.id === selectedId) ?? portions[0]
  const qtyNum  = parseFloat(qty)
  const isValid = !isNaN(qtyNum) && isFinite(qtyNum) && qtyNum > 0 && qtyNum <= 10000 && !!selectedPortion
  const totalG  = isValid && selectedPortion ? selectedPortion.gramWeight * qtyNum : 0
  const preview = isValid ? calcMacros(food.per100g, totalG) : null

  const hasDefaultServing = (food.servingGrams ?? 0) > 0
  const defaultServingMacros = hasDefaultServing
    ? calcMacros(food.per100g, food.servingGrams ?? 0)
    : null

  const isCountUnit = !['g', 'oz', 'cup'].includes(selectedId)

  async function handleSubmit() {
    if (!isValid || adding || !selectedPortion) return
    setAdding(true)
    Keyboard.dismiss()
    const macroPart = calcMacros(food.per100g, totalG)
    await onSubmit({
      portion_label: isCountUnit
        ? (qtyNum === 1 ? selectedPortion.label : `${qty} × ${selectedPortion.label}`)
        : `${qty} ${selectedPortion.label}`,
      portion_qty: qtyNum,
      portion_g:   Math.round(totalG * 10) / 10,
      ...macroPart,
    })
    setAdding(false)
  }

  const activeSlot = slots.find(sl => sl.id === mealSlot) ?? slots[0]
  const backLabel  = mode === 'edit' ? 'Back to log' : 'Back to search'
  const btnLabel   = mode === 'edit' ? 'Save changes' : `Add to ${activeSlot?.label ?? 'Log'}`

  return (
    <View style={{ flex: 1 }}>
      {/* Food info header (sticky) */}
      <View style={s.portionHeader}>
        <Pressable onPress={onBack} style={s.portionBackRow} hitSlop={6}>
          <ChevronLeft size={14} color={colors.mutedForeground} />
          <Text style={s.portionBackText}>{backLabel}</Text>
        </Pressable>
        <Text style={s.portionFoodName}>{food.name}</Text>
        {food.brand ? <Text style={s.portionBrand}>{food.brand}</Text> : null}

        {hasDefaultServing && defaultServingMacros ? (
          <View style={s.portionDefaultBox}>
            <View style={s.portionDefaultBoxHeader}>
              <Text style={s.portionPerLabel}>Per serving ({food.servingGrams}g)</Text>
              {servingsPerContainer != null && (
                <Text style={s.portionContainerLabel}>{servingsPerContainer} servings / container</Text>
              )}
            </View>
            <View style={s.portionDefaultMacros}>
              <Text style={[s.portionDefaultKcal,    { color: palette.red[400]     }]}>{defaultServingMacros.calories} kcal</Text>
              <Text style={[s.portionDefaultMacro,   { color: palette.blue[400]    }]}>P {defaultServingMacros.protein}g</Text>
              <Text style={[s.portionDefaultMacro,   { color: palette.amber[400]   }]}>F {defaultServingMacros.fat}g</Text>
              <Text style={[s.portionDefaultMacro,   { color: palette.emerald[400] }]}>C {defaultServingMacros.carbs}g</Text>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 6 }}>
            <Text style={s.portionPerLabel}>
              Per 100g · {food.per100g.calories} kcal · P {food.per100g.protein}g · F {food.per100g.fat}g · C {food.per100g.carbs}g
            </Text>
            {servingsPerContainer != null && (
              <Text style={[s.portionContainerLabel, { marginTop: 2 }]}>{servingsPerContainer} servings / container</Text>
            )}
          </View>
        )}
      </View>

      {/* Body (scrollable) */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.portionBody} keyboardShouldPersistTaps="handled">
        {/* Meal slot selector */}
        <View>
          <Text style={s.portionSectionLabel}>{mode === 'edit' ? 'Move to meal' : 'Add to meal'}</Text>
          <View style={s.slotChipsWrap}>
            {slots.map(sl => (
              <Pressable
                key={sl.id}
                onPress={() => onMealChange(sl.id)}
                style={[s.slotChip, mealSlot === sl.id && s.slotChipActive]}
              >
                <Text style={[s.slotChipText, mealSlot === sl.id && s.slotChipTextActive]}>
                  {sl.emoji} {sl.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Unit chips */}
        <View>
          <Text style={s.portionSectionLabel}>Unit</Text>
          {loadingPortions ? (
            <View style={s.portionLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.portionLoadingText}>Loading options…</Text>
            </View>
          ) : (
            <View style={s.unitChipsWrap}>
              {portions.map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedId(p.id)}
                  style={[s.unitChip, selectedId === p.id && s.unitChipActive]}
                >
                  <Text style={[s.unitChipText, selectedId === p.id && s.unitChipTextActive]}>
                    {p.label}
                    {p.gramWeight > 1 && (
                      <Text style={s.unitChipPerG}> (1={Math.round(p.gramWeight)}g)</Text>
                    )}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Quantity */}
        <View>
          <Text style={s.portionSectionLabel}>
            {selectedId === 'g' ? 'Amount (grams)'
              : selectedId === 'oz' ? 'Amount (ounces)'
              : selectedId === 'cup' ? 'Amount (cups)'
              : selectedId === 'srv' ? 'Servings'
              : 'How many?'}
          </Text>
          <NumericInput value={qty} onChange={setQty} />
          {/* `isValid` already implies selectedPortion truthy and qty parses to
             > 0; using the boolean directly avoids `qty && …` returning the
             empty string "" when the field is blank, which RN would render as
             a bare text node and warn about. */}
          {isValid ? (
            <Text style={s.portionApprox}>≈ {Math.round(totalG)}g total</Text>
          ) : null}
        </View>

        {/* Live preview */}
        {preview && (
          <View style={s.portionPreviewBox}>
            <Text style={s.portionPreviewLabel}>Nutritional info for this portion</Text>
            <View style={s.portionPreviewRow}>
              <View style={{ alignItems: 'center' }}>
                <Text style={[s.portionPreviewBig, { color: palette.red[400] }]}>{preview.calories}</Text>
                <Text style={s.portionPreviewSmall}>kcal</Text>
              </View>
              {[
                { label: 'Protein', val: preview.protein, color: palette.blue[400]    },
                { label: 'Fat',     val: preview.fat,     color: palette.amber[400]   },
                { label: 'Carbs',   val: preview.carbs,   color: palette.emerald[400] },
              ].map(m => (
                <View key={m.label} style={{ alignItems: 'center' }}>
                  <Text style={[s.portionPreviewMid, { color: m.color }]}>{Math.round(m.val * 10) / 10}g</Text>
                  <Text style={s.portionPreviewSmall}>{m.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Footer button */}
      <View style={s.portionFooter}>
        <Pressable
          onPress={handleSubmit}
          disabled={!isValid || adding}
          style={[s.portionSubmit, (!isValid || adding) && s.portionSubmitDisabled]}
        >
          {adding ? (
            <View style={s.btnLoading}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={s.portionSubmitText}>{mode === 'edit' ? 'Saving…' : 'Adding…'}</Text>
            </View>
          ) : (
            <Text style={s.portionSubmitText}>{btnLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

// ── Public component ─────────────────────────────────────────────────────────

export interface PortionSubmitPayload {
  portion_label: string
  portion_qty:   number
  portion_g:     number
  calories:      number
  protein:       number
  fat:           number
  carbs:         number
}

interface Props {
  userId:              string | undefined
  /** ISO date this drawer is logging for, or null to close. */
  day:                 string | null
  onClose:             () => void
  /** Fires whenever the entry list changes (so parent can refresh aggregates). */
  onEntriesChange?:    (day: string, entries: FoodLogEntry[]) => void
  /** User's saved meal-slot layout from profile (null = use defaults). */
  mealSlotsDefault?:   MealSlot[] | null
  /** Persist a layout as the user's new default. */
  onSaveSlotsDefault?: (slots: MealSlot[]) => Promise<void>
}

const BASE_PORTIONS: PortionOption[] = [
  { id: 'g',   label: 'grams',           gramWeight: 1       },
  { id: 'oz',  label: 'ounces',          gramWeight: 28.3495 },
  { id: 'cup', label: 'cups',            gramWeight: 240     },
  { id: 'srv', label: 'Serving (100g)',  gramWeight: 100     },
]

type View_ = 'log' | 'search' | 'portion' | 'edit'
type ScanState = null | 'loading' | { type: 'notfound' } | { type: 'error'; msg: string }

export default function FoodLogDrawer({
  userId, day, onClose, onEntriesChange, mealSlotsDefault, onSaveSlotsDefault,
}: Props) {
  // Sheet shifts up by kbHeight when the keyboard opens so the
  // search/portion inputs stay visible above it. See ChatSheet for
  // the full rationale — Android Modals don't inherit the Activity's
  // adjustResize so we need explicit handling.
  const kbHeight = useKeyboardHeight()
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()

  // ── Interactive drawer-style swipe-to-close ─────────────────────────────
  // Same pattern as ChatSheet / SuggestionSheet — drag the header down to
  // pull the sheet, release past 120 px (or with downward velocity) to
  // commit the close. Below threshold, snaps back.
  const dragY = useSharedValue(0)

  // Reset drag offset whenever the drawer (re-)opens. Without this a
  // previous close-drag could leave the sheet pre-translated.
  useEffect(() => {
    if (day) dragY.value = 0
  }, [day, dragY])

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

  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<View_>('log')

  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError,   setSearchError]   = useState<string | null>(null)
  const searchTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [scanning,  setScanning]  = useState(false)
  const [scanState, setScanState] = useState<ScanState>(null)

  const [suggesting,  setSuggesting]  = useState(false)
  const [suggestSent, setSuggestSent] = useState(false)
  const suggestingRef = useRef(false)

  // ── Meal slots state ────────────────────────────────────────────────────────
  const mealSlotsDefaultRef = useRef(mealSlotsDefault)
  useEffect(() => { mealSlotsDefaultRef.current = mealSlotsDefault }, [mealSlotsDefault])

  const [localSlots,    setLocalSlots]    = useState<MealSlot[]>(() => mealSlotsDefault ?? DEFAULT_SLOTS)
  const [baselineSlots, setBaselineSlots] = useState<MealSlot[]>(() => mealSlotsDefault ?? DEFAULT_SLOTS)
  const [addSlotAt,       setAddSlotAt]       = useState<number | null>(null)
  const [customSlotLabel, setCustomSlotLabel] = useState('')
  const [savingDefault,   setSavingDefault]   = useState(false)

  // ── Habit foods ─────────────────────────────────────────────────────────────
  const [habitFoodsBySlot, setHabitFoodsBySlot] = useState<Record<string, FoodItem[]>>({})
  const [excludedRecents,  setExcludedRecents]  = useState<Set<string>>(() => new Set())

  const [selectedFood,         setSelectedFood]         = useState<FoodItem | null>(null)
  const [portions,             setPortions]             = useState<PortionOption[]>(BASE_PORTIONS)
  const [portionsLoading,      setPortionsLoading]      = useState(false)
  const [servingsPerContainer, setServingsPerContainer] = useState<number | null>(null)
  const [activeMealSlot,       setActiveMealSlot]       = useState<string>('breakfast')

  const [editingItem,    setEditingItem]    = useState<FoodLogEntry | null>(null)
  const [editInitialId,  setEditInitialId]  = useState<string | null>(null)
  const [editInitialQty, setEditInitialQty] = useState<string>('')

  // ── Fetch entries + reset slots whenever day changes ─────────────────────
  useEffect(() => {
    if (!userId || !day) return
    setView('log')
    setSearchQuery('')
    setSearchResults([])
    setSelectedFood(null)
    setEditingItem(null)
    setEntries([])
    setLoading(true)
    setAddSlotAt(null)

    const dayDefault = mealSlotsDefaultRef.current ?? DEFAULT_SLOTS
    setLocalSlots(dayDefault)
    setBaselineSlots(dayDefault)

    supabase
      .from('food_logs')
      .select('id, meal_slot, food_name, brand_name, fdc_id, portion_label, portion_qty, portion_g, calories, protein_g, fat_g, carbs_g, created_at')
      .eq('user_id', userId)
      .eq('log_date', day)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          const rows = data as FoodLogEntry[]
          setEntries(rows)
          // Surface any slots in existing logs that aren't in localSlots yet
          const knownIds = new Set((mealSlotsDefaultRef.current ?? DEFAULT_SLOTS).map(sl => sl.id))
          const extra: MealSlot[] = []
          const seen = new Set<string>()
          for (const entry of rows) {
            const id = entry.meal_slot
            if (!knownIds.has(id) && !seen.has(id)) {
              seen.add(id)
              const preset = EXTRA_PRESETS.find(p => p.id === id)
              extra.push(preset ?? {
                id,
                label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                emoji: '🍽️',
              })
            }
          }
          if (extra.length > 0) {
            const inject = (prev: MealSlot[]) => {
              const snacksIdx = prev.findIndex(sl => sl.id === 'snacks')
              const insertAt  = snacksIdx >= 0 ? snacksIdx : prev.length
              const next = [...prev]
              next.splice(insertAt, 0, ...extra)
              return next
            }
            setLocalSlots(inject)
            setBaselineSlots(inject)
          }
        }
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, day])

  // ── Load excluded recents from AsyncStorage (RN equivalent of localStorage) ──
  useEffect(() => {
    if (!userId) return
    AsyncStorage.getItem(`myrx_excluded_recents_${userId}`).then(raw => {
      if (!raw) return
      try {
        const arr = JSON.parse(raw) as string[]
        setExcludedRecents(new Set(arr))
      } catch { /* corrupt — ignore */ }
    })
  }, [userId])

  // ── Habit foods — exponential decay scoring ───────────────────────────────
  const loadHabitFoods = useCallback(async () => {
    if (!userId) return
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data } = await supabase
      .from('food_logs')
      .select('meal_slot, food_name, brand_name, fdc_id, portion_g, calories, protein_g, fat_g, carbs_g, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    if (!data?.length) return

    const now = Date.now()
    const habitMap: Record<string, { score: number; food: FoodItem }> = {}

    for (const row of data as Array<{
      meal_slot: string; food_name: string; brand_name: string | null; fdc_id: string | null;
      portion_g: number; calories: number; protein_g: number; fat_g: number; carbs_g: number;
      created_at: string;
    }>) {
      const slot      = row.meal_slot || 'breakfast'
      const nameLower = row.food_name.toLowerCase()
      const key       = `${slot}:${nameLower}`
      const daysSince = (now - new Date(row.created_at).getTime()) / 86_400_000
      const contribution = Math.exp(-0.05 * daysSince)

      if (!habitMap[key]) {
        const factor = row.portion_g > 0 ? row.portion_g / 100 : 1
        habitMap[key] = {
          score: 0,
          food: {
            libraryId:    null,
            fdcId:        row.fdc_id ?? null,
            onId:         null,
            name:         row.food_name,
            brand:        row.brand_name ?? null,
            source:       row.fdc_id ? 'usda' : 'on',
            per100g: {
              calories: Math.round(row.calories  / factor),
              protein:  Math.round(row.protein_g / factor * 10) / 10,
              fat:      Math.round(row.fat_g     / factor * 10) / 10,
              carbs:    Math.round(row.carbs_g   / factor * 10) / 10,
            },
            servingGrams:         null,
            servingLabel:         null,
            servingsPerContainer: null,
          },
        }
      }
      habitMap[key].score += contribution
    }

    const bySlot: Record<string, FoodItem[]> = {}
    for (const [key, { food, score }] of Object.entries(habitMap)) {
      if (score < 0.5) continue
      const slot = key.split(':')[0]
      if (!bySlot[slot]) bySlot[slot] = []
      bySlot[slot].push({ ...food, habitScore: score })
    }
    for (const slot of Object.keys(bySlot)) {
      bySlot[slot].sort((a, b) => (b.habitScore ?? 0) - (a.habitScore ?? 0))
      bySlot[slot] = bySlot[slot].slice(0, 20)
    }
    setHabitFoodsBySlot(bySlot)
  }, [userId])

  useEffect(() => { loadHabitFoods() }, [loadHabitFoods])

  // ── Delete a recent item ──────────────────────────────────────────────────
  const handleDeleteRecent = useCallback((mealSlot: string, foodName: string) => {
    if (!userId) return
    const key = `${mealSlot}:${foodName.toLowerCase()}`
    setExcludedRecents(prev => {
      const next = new Set(prev)
      next.add(key)
      AsyncStorage.setItem(`myrx_excluded_recents_${userId}`, JSON.stringify([...next])).catch(() => {})
      return next
    })
  }, [userId])

  // Notify parent of entry list changes (after initial load completes)
  useEffect(() => {
    if (loading || !day) return
    onEntriesChange?.(day, entries)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, day, loading])

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) { setSearchResults([]); setSearchError(null); setSearchLoading(false); return }
    setSearchLoading(true)
    searchTimer.current = setTimeout(async () => {
      setSearchError(null)
      try {
        setSearchResults(await searchFoods(searchQuery))
      } catch {
        setSearchError('Search failed. Check your connection and try again.')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 500)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchQuery])

  // ── Suggest missing food ──────────────────────────────────────────────────
  async function handleSuggestFood() {
    const name = searchQuery.trim()
    if (!name || suggestingRef.current || suggestSent || !userId) return
    suggestingRef.current = true
    setSuggesting(true)
    const { error } = await supabase.from('messages').insert({
      user_id:       userId,
      from_admin:    false,
      body:          `New food suggestion: ${name}`,
      is_suggestion: true,
      read:          false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setTimeout(() => setSuggestSent(false), 3000)
    }
  }

  // ── Slot management ───────────────────────────────────────────────────────
  function insertSlot(afterIndex: number, slotDef: MealSlot) {
    setLocalSlots(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, slotDef)
      return next
    })
    setAddSlotAt(null)
    setCustomSlotLabel('')
  }

  function removeSlot(slotId: string) {
    setLocalSlots(prev => prev.filter(sl => sl.id !== slotId))
  }

  const slotsChanged = JSON.stringify(localSlots.map(sl => sl.id)) !==
                       JSON.stringify(baselineSlots.map(sl => sl.id))

  async function handleSaveDefault() {
    if (!onSaveSlotsDefault || savingDefault) return
    setSavingDefault(true)
    try {
      await onSaveSlotsDefault(localSlots)
      setBaselineSlots(localSlots)
    } finally {
      setSavingDefault(false)
    }
  }

  // ── Barcode scan ──────────────────────────────────────────────────────────
  async function handleBarcodeScanned(rawUpc: string) {
    setScanning(false)
    setScanState('loading')
    setSearchQuery('')
    setSearchResults([])
    try {
      const food = await lookupBarcode(rawUpc)
      if (food) {
        setScanState(null)
        selectFood(food)
      } else {
        setScanState({ type: 'notfound' })
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '').toLowerCase().includes('network')
        ? 'Network error. Check your connection.'
        : 'Lookup failed. Try searching by name.'
      setScanState({ type: 'error', msg })
    }
  }

  // ── Food selection + portions ─────────────────────────────────────────────
  async function selectFood(food: FoodItem) {
    setSelectedFood(food)
    setView('portion')
    setPortions(BASE_PORTIONS)
    setServingsPerContainer(null)
    setPortionsLoading(true)
    try {
      const { portions: loaded, servingsPerContainer: spc } = getFoodPortions(food)
      setPortions(loaded)
      setServingsPerContainer(spc)
    } catch { /* keep base units */ }
    finally { setPortionsLoading(false) }
  }

  async function openEdit(item: FoodLogEntry) {
    setEditingItem(item)
    const factor = item.portion_g > 0 ? item.portion_g / 100 : 1
    const per100g = {
      calories: Math.round(item.calories  / factor),
      protein:  Math.round(item.protein_g / factor * 10) / 10,
      fat:      Math.round(item.fat_g     / factor * 10) / 10,
      carbs:    Math.round(item.carbs_g   / factor * 10) / 10,
    }
    const foodObj: FoodItem = {
      libraryId:    null,
      fdcId:        item.fdc_id ?? null,
      name:         item.food_name,
      brand:        item.brand_name ?? null,
      source:       'usda',
      per100g,
      servingGrams: null,
      servingLabel: null,
      servingsPerContainer: null,
    }

    setSelectedFood(foodObj)
    setActiveMealSlot(item.meal_slot)
    setEditInitialId(null)
    setEditInitialQty(String(item.portion_qty))
    setView('edit')

    setPortions(BASE_PORTIONS)
    setServingsPerContainer(null)
    setPortionsLoading(true)
    try {
      const { portions: loaded, servingsPerContainer: spc } = getFoodPortions(foodObj)
      setPortions(loaded)
      setServingsPerContainer(spc)
      const perUnitG = item.portion_qty > 0 ? item.portion_g / item.portion_qty : 1
      let bestMatch = loaded[0]; let bestDiff = Infinity
      for (const p of loaded) {
        const diff = Math.abs(p.gramWeight - perUnitG)
        if (diff < bestDiff) { bestDiff = diff; bestMatch = p }
      }
      setEditInitialId(bestMatch?.id ?? 'g')
    } catch {
      setEditInitialId('g')
    } finally {
      setPortionsLoading(false)
    }
  }

  // ── DB operations ─────────────────────────────────────────────────────────
  async function handleAdd(payload: PortionSubmitPayload) {
    if (!userId || !day || !selectedFood) return
    const { data, error } = await supabase
      .from('food_logs')
      .insert({
        user_id:    userId,
        log_date:   day,
        meal_slot:  activeMealSlot,
        food_name:  selectedFood.name,
        brand_name: selectedFood.brand ?? null,
        fdc_id:     selectedFood.fdcId ?? null,
        portion_label: payload.portion_label,
        portion_qty:   payload.portion_qty,
        portion_g:     payload.portion_g,
        calories:      payload.calories,
        protein_g:     payload.protein,
        fat_g:         payload.fat,
        carbs_g:       payload.carbs,
      })
      .select()
      .single()
    if (error || !data) return
    setEntries(prev => [...prev, data as FoodLogEntry])
    loadHabitFoods()
    setView('log')
    setSearchQuery('')
    setSearchResults([])
    setSelectedFood(null)
  }

  async function handleEditSave(payload: PortionSubmitPayload) {
    if (!editingItem || !userId) return
    const updates = {
      meal_slot:     activeMealSlot,
      portion_label: payload.portion_label,
      portion_qty:   payload.portion_qty,
      portion_g:     payload.portion_g,
      calories:      payload.calories,
      protein_g:     payload.protein,
      fat_g:         payload.fat,
      carbs_g:       payload.carbs,
    }
    const { error } = await supabase.from('food_logs').update(updates).eq('id', editingItem.id).eq('user_id', userId)
    if (error) return
    setEntries(prev => prev.map(e => e.id === editingItem.id ? { ...e, ...updates } : e))
    setEditingItem(null)
    setView('log')
  }

  async function handleDelete(id: string) {
    if (!userId) return
    const { error } = await supabase.from('food_logs').delete().eq('id', id).eq('user_id', userId)
    if (error) throw new Error('Delete failed')
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  )

  function cancelEdit() {
    setEditingItem(null)
    setView('log')
  }

  const existingSlotIds = new Set(localSlots.map(sl => sl.id))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={!!day}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={view === 'log' ? onClose : cancelEdit}
    >
      {scanning && (
        <BarcodeScanner
          onScan={handleBarcodeScanned}
          onClose={() => setScanning(false)}
        />
      )}
      {/* GestureHandlerRootView is REQUIRED inside a Modal for RNGH
          gestures (the header swipe-to-close Pan) to fire. Android
          Modals render in a separate Window, so the app's root
          GestureHandlerRootView (in app/_layout.tsx) doesn't reach
          here. Without this wrapper the Pan gesture never activates
          and the drawer can't be swiped closed. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Backdrop is a plain View — taps outside the sheet do NOT close
          it. Closing is reserved for the X button (CloseBtn) in the
          header and the swipe-down gesture on the header. Matches
          ChatSheet / SuggestionSheet. */}
      <View style={s.backdrop}>
        <Animated.View
          style={[
            kbHeight > 0
              ? [
                  s.sheetOpen,
                  {
                    position: 'absolute',
                    left: 0, right: 0,
                    top: insets.top + 12,
                    // Bottom = kbHeight + insets.bottom — see ChatSheet.
                    bottom: kbHeight + insets.bottom,
                  },
                ]
              : s.sheet,
            // translateY follows finger during header swipe-to-close
            // drag, then either continues off-screen (commit) or snaps
            // back (cancel). Same pattern as ChatSheet / SuggestionSheet.
            sheetAnimStyle,
          ]}
        >
          {/* Sheet shifts up by kbHeight when keyboard opens — same
              pattern as ChatSheet / SuggestionSheet. The previous
              KAV wrapper inside the sheet didn't push the sheet
              above the keyboard on Android Modals; shifting the
              sheet itself does. */}

          {/* Drag handle + Header — both wrapped in GestureDetector so a
              downward swipe dismisses the drawer.
              The drag-handle pill is the unambiguous swipe affordance
              (matches iOS / Material sheet patterns). The header itself
              also responds to swipes EXCEPT where a TextInput sits (the
              input grabs the touch responder before our 8 px threshold
              fires — known limitation, the drag handle is the workaround).
              The Pan's failOffsetX constraint means horizontal taps inside
              the header (back button, search input) still register
              normally. */}
          <GestureDetector gesture={headerCloseGesture}>
            <View>
              <View style={s.dragHandleArea}>
                <View style={s.dragHandlePill} />
              </View>
              <View style={s.sheetHeader}>
            {view === 'log' && (
              <>
                <View>
                  <Text style={s.sheetTitle}>Food Log</Text>
                  <Text style={s.sheetSub}>{day ? fmtDay(day) : ''}</Text>
                </View>
                <CloseBtn onPress={onClose} />
              </>
            )}
            {view === 'search' && (
              <View style={s.searchHeaderRow}>
                <Pressable
                  onPress={() => {
                    setView('log'); setSearchQuery(''); setSearchResults([])
                    setSuggestSent(false); setScanState(null)
                  }}
                  hitSlop={8}
                >
                  <ChevronLeft size={16} color={colors.mutedForeground} />
                </Pressable>
                <View style={s.searchInputWrap}>
                  <Search size={14} color={colors.mutedForeground} style={s.searchInputIcon} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={v => { setSearchQuery(v); if (scanState) setScanState(null) }}
                    placeholder="Search by name or UPC…"
                    placeholderTextColor={alpha(colors.mutedForeground, 0.6)}
                    style={s.searchInput}
                  />
                  {/* Clear-text X — only when the input has content. Replaces
                      the old standalone close button in the search header;
                      drawer dismissal now relies on the chevron-back to log
                      view + the X there, or the swipe-down gesture. */}
                  {searchQuery.length > 0 && (
                    <Pressable
                      onPress={() => { setSearchQuery(''); setSearchResults([]) }}
                      style={s.searchClearBtn}
                      hitSlop={6}
                      accessibilityLabel="Clear search"
                    >
                      <X size={14} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setScanning(true)}
                    style={s.scanBtn}
                    hitSlop={6}
                  >
                    <ScanLine size={16} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
            )}
            {view === 'portion' && (
              <View style={s.headerRowWide}>
                <Text style={s.sheetSubTitle}>Choose portion</Text>
                <CloseBtn onPress={onClose} />
              </View>
            )}
            {view === 'edit' && (
              <View style={s.headerRowWide}>
                <Text style={s.sheetSubTitle}>Edit entry</Text>
                <CloseBtn onPress={cancelEdit} />
              </View>
            )}
              </View>
            </View>
          </GestureDetector>

          {/* Body */}
          <View style={{ flex: 1, minHeight: 0 }}>

            {view === 'log' && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
                {loading ? (
                  <View style={s.bodyLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={s.bodyLoadingText}>Loading…</Text>
                  </View>
                ) : (
                  localSlots.map((slot, idx) => {
                    const slotEntries = entries.filter(e => e.meal_slot === slot.id)
                    const slotTotals = slotEntries.reduce(
                      (acc, e) => ({
                        calories: acc.calories + e.calories,
                        protein:  acc.protein  + e.protein_g,
                        fat:      acc.fat      + e.fat_g,
                        carbs:    acc.carbs    + e.carbs_g,
                      }),
                      { calories: 0, protein: 0, fat: 0, carbs: 0 },
                    )
                    const isCustom  = !ANCHOR_IDS.has(slot.id)
                    const canRemove = isCustom && slotEntries.length === 0

                    return (
                      <View key={slot.id}>
                        <View style={s.slotBlock}>
                          <View style={s.slotHeader}>
                            <View style={{ flex: 1 }}>
                              <View style={s.slotNameRow}>
                                <Text style={s.slotEmoji}>{slot.emoji}</Text>
                                <Text style={s.slotName}>{slot.label}</Text>
                                {isCustom && (
                                  <Pressable
                                    onPress={canRemove ? () => removeSlot(slot.id) : undefined}
                                    disabled={!canRemove}
                                    hitSlop={6}
                                    style={[
                                      s.slotRemoveBtn,
                                      canRemove ? s.slotRemoveEnabled : s.slotRemoveDisabled,
                                    ]}
                                  >
                                    <X size={10} color={canRemove ? alpha(colors.mutedForeground, 0.4) : alpha(colors.mutedForeground, 0.15)} />
                                  </Pressable>
                                )}
                              </View>
                              {slotEntries.length > 0 && (
                                <View style={s.slotMacroRow}>
                                  <Text style={[s.slotKcal,    { color: palette.red[400]     }]}>{Math.round(slotTotals.calories)} kcal</Text>
                                  <Text style={[s.slotMacro,   { color: palette.blue[400]    }]}>P {Math.round(slotTotals.protein)}g</Text>
                                  <Text style={[s.slotMacro,   { color: palette.amber[400]   }]}>F {Math.round(slotTotals.fat)}g</Text>
                                  <Text style={[s.slotMacro,   { color: palette.emerald[400] }]}>C {Math.round(slotTotals.carbs)}g</Text>
                                </View>
                              )}
                            </View>
                            <Pressable
                              onPress={() => { setActiveMealSlot(slot.id); setView('search') }}
                              style={s.addFoodBtn}
                            >
                              <Plus size={12} color={colors.mutedForeground} />
                              <Text style={s.addFoodBtnText}>Add food</Text>
                            </Pressable>
                          </View>

                          {slotEntries.length > 0 ? (
                            <View style={s.slotEntriesBox}>
                              {slotEntries.map((item, eIdx) => (
                                <View key={item.id} style={eIdx > 0 ? s.entryDivider : undefined}>
                                  <FoodItemRow
                                    item={item}
                                    onDelete={() => handleDelete(item.id)}
                                    onEdit={() => openEdit(item)}
                                  />
                                </View>
                              ))}
                            </View>
                          ) : (
                            <Text style={s.slotEmpty}>Nothing logged yet</Text>
                          )}
                        </View>

                        <InsertDivider
                          open={addSlotAt === idx}
                          onOpen={() => setAddSlotAt(prev => {
                            if (prev !== idx) setCustomSlotLabel('')
                            return prev === idx ? null : idx
                          })}
                          onInsert={slotDef => insertSlot(idx, slotDef)}
                          existingIds={existingSlotIds}
                          customLabel={customSlotLabel}
                          onCustomLabelChange={setCustomSlotLabel}
                        />
                      </View>
                    )
                  })
                )}
              </ScrollView>
            )}

            {view === 'search' && (
              <ScrollView
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled       /* required on Android so the inner
                                              "Frequently used foods" ScrollView
                                              can capture vertical pans */
              >
                {scanState === 'loading' && (
                  <View style={s.scanStateBlock}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Looking up barcode…</Text>
                  </View>
                )}
                {scanState && typeof scanState === 'object' && scanState.type === 'notfound' && (
                  <View style={[s.scanResultBox, { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.20)' }]}>
                    <View style={s.scanResultHeader}>
                      <AlertCircle size={14} color={palette.amber[400]} />
                      <Text style={[s.scanResultTitle, { color: palette.amber[400] }]}>Not in our library</Text>
                    </View>
                    <Text style={s.scanResultMsg}>We don't have this item yet. Try searching by name above or scan a different product.</Text>
                    <Pressable onPress={() => setScanState(null)}>
                      <Text style={s.scanResultDismiss}>Dismiss</Text>
                    </Pressable>
                  </View>
                )}
                {scanState && typeof scanState === 'object' && scanState.type === 'error' && (
                  <View style={[s.scanResultBox, { backgroundColor: withAlpha('#ef4444', 0.10), borderColor: withAlpha('#ef4444', 0.30) }]}>
                    <View style={s.scanResultHeader}>
                      <AlertCircle size={14} color={colors.destructive} />
                      <Text style={[s.scanResultTitle, { color: colors.destructive }]}>Scan failed</Text>
                    </View>
                    <Text style={s.scanResultMsg}>{scanState.msg}</Text>
                    <View style={s.scanRetryRow}>
                      <Pressable onPress={() => setScanning(true)} style={s.scanRetryBtn}>
                        <ScanLine size={12} color="#fff" />
                        <Text style={s.scanRetryText}>Try again</Text>
                      </Pressable>
                      <Pressable onPress={() => setScanState(null)}>
                        <Text style={s.scanResultDismiss}>Dismiss</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {!scanState && searchLoading && (
                  <View style={s.searchStatusRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={s.searchStatusText}>Searching…</Text>
                  </View>
                )}
                {!scanState && searchError && (
                  <View style={s.searchErrorBox}>
                    <Text style={s.searchErrorText}>{searchError}</Text>
                  </View>
                )}
                {!searchLoading && !searchError && searchQuery.trim() !== '' && searchResults.length === 0 && (
                  <View style={s.noResultsBlock}>
                    <Text style={s.noResultsText}>No results for "{searchQuery}"</Text>
                    <Text style={s.noResultsHelp}>
                      Can't find this food? Send it as a suggestion and your coach will add it to the database.
                    </Text>
                    <Pressable
                      onPress={handleSuggestFood}
                      disabled={suggesting || suggestSent}
                      style={[
                        s.suggestBtn,
                        suggestSent ? s.suggestBtnSent : suggesting ? s.suggestBtnSending : s.suggestBtnDefault,
                      ]}
                    >
                      {suggestSent ? <Text style={s.suggestBtnText}>✓ Suggestion Sent</Text>
                        : suggesting ? (
                          <View style={s.btnLoading}>
                            <ActivityIndicator size="small" color="#fff" />
                            <Text style={s.suggestBtnText}>Sending…</Text>
                          </View>
                        ) : (
                          <View style={s.btnLoading}>
                            <Send size={14} color="#fff" />
                            <Text style={s.suggestBtnText}>Send Suggestion</Text>
                          </View>
                        )}
                    </Pressable>
                  </View>
                )}
                {!scanState && !searchLoading && searchQuery.trim() === '' && (() => {
                  // Per-meal frequently-used foods. The score key is `${slot}:${name}`
                  // so eggs-at-breakfast and eggs-at-lunch are separate buckets.
                  // habitFoodsBySlot[activeMealSlot] filters to only foods that have
                  // been logged in this specific meal slot — never cross-meal.
                  const slotFrequent = (habitFoodsBySlot[activeMealSlot] || [])
                    .filter(f => !excludedRecents.has(`${activeMealSlot}:${f.name.toLowerCase()}`))
                  return slotFrequent.length > 0 ? (
                    <>
                      <Text style={s.habitsHeader}>Frequently used foods</Text>
                      {/* Fixed-height scrollable area — shows ~5 rows; if more
                         than 5, the inner list scrolls. nestedScrollEnabled is
                         required on Android for the inner ScrollView to capture
                         vertical pans inside the parent search ScrollView. */}
                      <View style={s.frequentList}>
                        <ScrollView
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          keyboardShouldPersistTaps="handled"
                        >
                          {slotFrequent.map((food, i) => (
                            <RecentFoodRow
                              key={`habit-${activeMealSlot}-${i}`}
                              food={food}
                              onPress={() => selectFood(food)}
                              onDelete={() => handleDeleteRecent(activeMealSlot, food.name)}
                            />
                          ))}
                        </ScrollView>
                      </View>
                    </>
                  ) : (
                    <View style={s.searchEmpty}>
                      <Search size={32} color={alpha(colors.mutedForeground, 0.3)} />
                      <Text style={s.searchEmptyTitle}>Start typing to search foods</Text>
                      <Text style={s.searchEmptyHint}>USDA FoodData Central & OpenNutrition</Text>
                    </View>
                  )
                })()}

                {!scanState && searchResults.length > 0 && (
                  <>
                    {searchResults.map(food => (
                      <SearchResult
                        key={food.fdcId ?? food.libraryId ?? food.name}
                        food={food}
                        onPress={() => selectFood(food)}
                      />
                    ))}
                    <Text style={s.attribution}>USDA FoodData Central & OpenNutrition</Text>
                  </>
                )}
              </ScrollView>
            )}

            {view === 'portion' && selectedFood && (
              <PortionPicker
                food={selectedFood}
                portions={portions}
                loadingPortions={portionsLoading}
                servingsPerContainer={servingsPerContainer}
                mealSlot={activeMealSlot}
                onMealChange={setActiveMealSlot}
                slots={localSlots}
                onSubmit={handleAdd}
                onBack={() => setView('search')}
                mode="add"
              />
            )}
            {view === 'edit' && selectedFood && (
              <PortionPicker
                food={selectedFood}
                portions={portions}
                loadingPortions={portionsLoading}
                servingsPerContainer={servingsPerContainer}
                mealSlot={activeMealSlot}
                onMealChange={setActiveMealSlot}
                slots={localSlots}
                onSubmit={handleEditSave}
                onBack={cancelEdit}
                mode="edit"
                initialSelectedId={editInitialId}
                initialQty={editInitialQty}
              />
            )}
          </View>

          {/* Save-as-default banner */}
          {view === 'log' && !loading && slotsChanged && onSaveSlotsDefault && (
            <View style={s.saveDefaultBanner}>
              <Text style={s.saveDefaultLabel}>Meal layout changed</Text>
              <Pressable onPress={handleSaveDefault} disabled={savingDefault}>
                <Text style={[s.saveDefaultBtn, savingDefault && { opacity: 0.5 }]}>
                  {savingDefault ? 'Saving…' : 'Save as default'}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Daily totals */}
          {view === 'log' && entries.length > 0 && (
            <View style={s.totalsBar}>
              <Text style={s.totalsLabel}>Total</Text>
              <View style={s.totalsRow}>
                <Text style={[s.totalsKcal,  { color: palette.red[400]     }]}>{Math.round(totals.calories)} kcal</Text>
                <Text style={[s.totalsMacro, { color: palette.blue[400]    }]}>P {Math.round(totals.protein)}g</Text>
                <Text style={[s.totalsMacro, { color: palette.amber[400]   }]}>F {Math.round(totals.fat)}g</Text>
                <Text style={[s.totalsMacro, { color: palette.emerald[400] }]}>C {Math.round(totals.carbs)}g</Text>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ── Reusable little close button ─────────────────────────────────────────────

function CloseBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.closeBtn} hitSlop={8}>
      <X size={16} color={colors.mutedForeground} />
    </Pressable>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Modal frame
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,10,0.80)',
    justifyContent: 'flex-end',
  },
  // KAV fills the sheet so its bottom-padding behavior pushes the
  // scroll content + input fields above the soft keyboard.
  kav: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    // Use HEIGHT (not maxHeight) so the sheet always takes 92% of the screen.
    // With maxHeight only, the sheet sizes to its non-flex content (just the
    // header) and the inner ScrollView's `flex: 1` has no bounded parent to
    // expand into, leaving the body invisible below the screen.
    height: '92%',
    overflow: 'hidden',
  },
  // Open-keyboard variant — same visuals but no `height` so inline
  // top/bottom can size the sheet between status bar and keyboard.
  // See ChatSheet for full rationale.
  sheetOpen: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },

  // Sheet header
  // Drag-handle pill at the very top of the sheet. The 12-px vertical
  // padding gives the user a generous hit area to grab the handle without
  // making the visual indicator itself huge. Matches the iOS sheet grabber
  // size convention (~40 px wide, ~4 px tall).
  dragHandleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  dragHandlePill: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: alpha(colors.mutedForeground, 0.35),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle:    { fontSize: 16, fontWeight: '700', color: colors.foreground },
  sheetSub:      { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  sheetSubTitle: { fontSize: 14, fontWeight: '600', color: colors.foreground },

  headerRowWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 9999,
    alignItems: 'center', justifyContent: 'center',
  },

  // Search header
  searchHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  // Pill-shaped search input — matches the ChatSheet input pill so the
  // typography and chrome feel consistent across surfaces. Icons sit as
  // flex children (no absolute positioning) so they vertically centre
  // automatically and stay aligned regardless of font / device scaling.
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12, paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
    minHeight: 36,
  },
  // No more absolute positioning — the icon is a flex child so its
  // vertical centring comes from `alignItems: center` on the pill.
  searchInputIcon: {},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
    padding: 0,
  },
  searchClearBtn: {
    // Same 28×28 tap target as scanBtn so the two trailing buttons read
    // as visual siblings inside the pill. Only rendered when the input has
    // text, so when it appears it pushes the scan icon slightly leftward —
    // expected behavior, mirrors iOS / Material clear-text affordances.
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtn: {
    // Tap target: 28 px square inside the pill, right-aligned.
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Loading body
  bodyLoading:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 48 },
  bodyLoadingText:{ fontSize: 14, color: colors.mutedForeground },

  // Slot block
  slotBlock: { paddingHorizontal: 16, paddingBottom: 4 },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  slotNameRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotEmoji:  { fontSize: 16 },
  slotName:   { fontSize: 14, fontWeight: '600', color: colors.foreground },
  slotRemoveBtn: { width: 16, height: 16, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  slotRemoveEnabled:  { },
  slotRemoveDisabled: { opacity: 0.6 },
  slotMacroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  slotKcal:     { fontSize: 12, fontWeight: '600', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
  slotMacro:    { fontSize: 11, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },

  addFoodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border, borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  addFoodBtnText: { fontSize: 11, color: colors.mutedForeground, fontWeight: '500' },

  slotEntriesBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden',
  },
  entryDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  slotEmpty: { fontSize: 11, color: alpha(colors.mutedForeground, 0.40), paddingBottom: 4 },

  // Entry row (in slot)
  entryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, backgroundColor: colors.card },
  entryRowLeft: { flex: 1, minWidth: 0 },
  entryName:    { fontSize: 14, fontWeight: '500', color: colors.foreground, lineHeight: 18 },
  entryPortion: { fontSize: 11, color: colors.mutedForeground },
  entryRowRight:{ alignItems: 'flex-end', flexShrink: 0 },
  entryKcal:    { fontSize: 14, fontWeight: '600', color: palette.red[400], fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },

  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroChipText: { fontSize: 11, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },

  // Insert divider
  dividerWrap: { paddingHorizontal: 16 },
  dividerTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dividerLine: {
    flex: 1, height: 1,
    borderTopWidth: 1, borderStyle: 'dashed',
    borderColor: alpha(colors.border, 0.4),
  },
  dividerLineOpen: { borderColor: alpha(colors.primary, 0.4) },
  dividerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dividerLabel: { fontSize: 10, fontWeight: '500' },

  dividerPanel: {
    marginBottom: 12, marginTop: 2,
    borderRadius: 12, borderWidth: 1,
    borderColor: alpha(colors.primary, 0.20),
    backgroundColor: alpha(colors.primary, 0.05),
    padding: 12, gap: 10,
  },
  dividerHelp: {
    fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
    color: colors.mutedForeground,
  },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetPill: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 9999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  presetPillDashed: { borderStyle: 'dashed', borderColor: alpha(colors.border, 0.6) },
  presetPillText:   { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
  customRow: { flexDirection: 'row', gap: 8 },
  customInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 9,
    backgroundColor: alpha(colors.input, 0.30),
    paddingHorizontal: 12, paddingVertical: 6,
    fontSize: 14, color: colors.foreground,
  },
  customBtn: {
    backgroundColor: colors.primary, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  customBtnText: { fontSize: 12, fontWeight: '600', color: colors.primaryForeground },
  customBack:    { fontSize: 10, color: colors.mutedForeground },

  // Search results
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  searchRowLeft:  { flex: 1, minWidth: 0, gap: 2 },
  searchName:     { fontSize: 14, fontWeight: '500', color: colors.foreground, lineHeight: 18 },
  searchSub:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchBrand:    { fontSize: 11, color: colors.mutedForeground },
  srcBadge:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  srcBadgeText:   { fontSize: 9, fontWeight: '600', letterSpacing: 1 },
  searchRowRight: { alignItems: 'flex-end' },
  searchKcal:     { fontSize: 12, fontWeight: '600', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'], color: palette.red[400] },
  searchServing:  { fontSize: 10, color: colors.mutedForeground },

  // Habit
  habitDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  habitDot:  { width: 6, height: 6, borderRadius: 9999 },
  recentRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  recentLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  recentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recentDeleteBtn: { paddingHorizontal: 12, paddingVertical: 12 },

  habitsHeader: {
    fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1.2,
    color: colors.mutedForeground,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  // Frequently-used-foods scrollable window. Each RecentFoodRow is ~58px tall
  // (py-3 + ~34px content). 5 rows × 58 = 290; round to 300 so we don't clip
  // the divider on the last visible row.
  frequentList: { maxHeight: 300 },

  // Empty / status
  searchEmpty:      { paddingVertical: 48, alignItems: 'center', gap: 6 },
  searchEmptyTitle: { fontSize: 14, color: colors.mutedForeground },
  searchEmptyHint:  { fontSize: 11, color: alpha(colors.mutedForeground, 0.60) },

  attribution: {
    paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 10, color: alpha(colors.mutedForeground, 0.50), textAlign: 'center',
    borderTopWidth: 1, borderTopColor: colors.border,
  },

  searchStatusRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 40 },
  searchStatusText:{ fontSize: 14, color: colors.mutedForeground },
  searchErrorBox:  {
    margin: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
    backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 9, paddingHorizontal: 16, paddingVertical: 12,
  },
  searchErrorText: { fontSize: 14, color: colors.destructive },

  // No-results / suggest
  noResultsBlock:  { paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center', gap: 12 },
  noResultsText:   { fontSize: 14, color: colors.mutedForeground },
  noResultsHelp:   { fontSize: 11, color: alpha(colors.mutedForeground, 0.60), textAlign: 'center', maxWidth: 280 },
  suggestBtn:      { borderRadius: 9, paddingHorizontal: 16, paddingVertical: 10 },
  suggestBtnDefault:{ backgroundColor: palette.blue[500] },
  suggestBtnSending:{ backgroundColor: alpha(palette.blue[500], 0.6) },
  suggestBtnSent:  { backgroundColor: alpha(palette.blue[500], 0.15), borderWidth: 1, borderColor: alpha(palette.blue[500], 0.30) },
  suggestBtnText:  { fontSize: 14, fontWeight: '600', color: '#fff' },

  // Scan banners
  scanStateBlock: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 64 },
  scanResultBox: {
    margin: 16, borderRadius: 9, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 16, gap: 8,
  },
  scanResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanResultTitle:  { fontSize: 14, fontWeight: '600' },
  scanResultMsg:    { fontSize: 12, color: colors.mutedForeground },
  scanResultDismiss:{ fontSize: 12, color: colors.mutedForeground, textDecorationLine: 'underline' },
  scanRetryRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  scanRetryBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6 },
  scanRetryText:    { fontSize: 12, fontWeight: '600', color: colors.primaryForeground },

  // Save-default banner
  saveDefaultBanner: {
    borderTopWidth: 1, borderTopColor: alpha(colors.primary, 0.20),
    backgroundColor: alpha(colors.primary, 0.05),
    paddingHorizontal: 20, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  saveDefaultLabel: { fontSize: 12, color: colors.mutedForeground },
  saveDefaultBtn:   { fontSize: 12, fontWeight: '600', color: colors.primary },

  // Daily totals
  totalsBar: {
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: 20, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: alpha(colors.muted, 0.10),
  },
  totalsLabel: { fontSize: 11, fontWeight: '500', color: colors.mutedForeground },
  totalsRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' },
  totalsKcal:  { fontSize: 14, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  totalsMacro: { fontSize: 12, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },

  // PortionPicker
  portionHeader:  { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  portionBackRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  portionBackText:{ fontSize: 12, color: colors.mutedForeground },
  portionFoodName:{ fontSize: 14, fontWeight: '600', color: colors.foreground, lineHeight: 18 },
  portionBrand:   { fontSize: 11, color: colors.mutedForeground },

  portionDefaultBox: {
    marginTop: 6, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: alpha(colors.muted, 0.20),
  },
  portionDefaultBoxHeader: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 2, columnGap: 12 },
  portionPerLabel:        { fontSize: 11, color: colors.mutedForeground, fontWeight: '500' },
  portionContainerLabel:  { fontSize: 10, color: alpha(colors.mutedForeground, 0.60), fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },
  portionDefaultMacros:   { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  portionDefaultKcal:     { fontSize: 12, fontWeight: '600', fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
  portionDefaultMacro:    { fontSize: 12, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },

  portionBody:           { paddingHorizontal: 20, paddingVertical: 16, gap: 20 },
  portionSectionLabel:   { fontSize: 12, fontWeight: '600', color: colors.mutedForeground, marginBottom: 8 },

  slotChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip:      {
    borderRadius: 9999, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  slotChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  slotChipText:        { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
  slotChipTextActive:  { color: colors.primaryForeground },

  unitChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unitChip: {
    borderRadius: 9, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  unitChipActive:    { borderColor: 'rgba(239,68,68,0.60)', backgroundColor: 'rgba(239,68,68,0.10)' },
  unitChipText:      { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
  unitChipTextActive:{ color: palette.red[400] },
  unitChipPerG:      { fontSize: 10, opacity: 0.6 },

  portionLoading:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  portionLoadingText:{ fontSize: 12, color: colors.mutedForeground },
  portionApprox:     { fontSize: 11, color: colors.mutedForeground, marginTop: 4 },

  portionPreviewBox: {
    borderRadius: 12, borderWidth: 1, padding: 16,
    backgroundColor: 'rgba(239,68,68,0.05)',
    borderColor: 'rgba(239,68,68,0.20)',
  },
  portionPreviewLabel: { fontSize: 11, color: colors.mutedForeground, marginBottom: 8, fontWeight: '500' },
  portionPreviewRow:   { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  portionPreviewBig:   { fontSize: 20, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  portionPreviewMid:   { fontSize: 16, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'] },
  portionPreviewSmall: { fontSize: 10, color: colors.mutedForeground },

  portionFooter: { paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.border },
  portionSubmit: {
    borderRadius: 12, paddingVertical: 12,
    backgroundColor: palette.red[500], alignItems: 'center', justifyContent: 'center',
  },
  portionSubmitDisabled: { backgroundColor: alpha(colors.muted, 0.40), opacity: 0.5 },
  portionSubmitText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  btnLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})

// (un-used `ReactNode` import kept for callers that may pass nodes; suppress lint)
void ({} as ReactNode)
