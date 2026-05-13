/**
 * FoodLogDrawer
 * Bottom-sheet drawer for logging food for a specific day.
 * Flow: log view → search → portion picker → back to log.
 *       log view → tap item → edit view (same PortionPicker, pre-populated)
 *
 * Hybrid meal slots: 4 fixed anchor slots + user-insertable custom slots.
 * Custom slots can be added between any two existing slots; layout can be
 * saved as the user's default via the onSaveSlotsDefault callback.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { searchFoods, getFoodPortions, calcMacros } from '../lib/foodLibrary'
import { X, Search, ChevronLeft, Plus, Loader2, Send } from 'lucide-react'
import SwipeDelete from './SwipeDelete'

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

// Anchor slots cannot be removed by the user
export const ANCHOR_IDS = new Set(['breakfast', 'lunch', 'dinner', 'snacks'])

// Pre-built extra meal options shown in the insert picker
export const EXTRA_PRESETS = [
  { id: 'morning_snack',   label: 'Morning Snack',   emoji: '🥐' },
  { id: 'pre_workout',     label: 'Pre-Workout',     emoji: '⚡' },
  { id: 'post_workout',    label: 'Post-Workout',    emoji: '💪' },
  { id: 'afternoon_snack', label: 'Afternoon Snack', emoji: '🍇' },
  { id: 'evening_meal',    label: 'Evening Meal',    emoji: '🌆' },
]

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const TODAY_ISO = isoDate(new Date())

function fmtDay(iso) {
  if (iso === TODAY_ISO) return 'Today'
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Macro chips ───────────────────────────────────────────────────────────────

function MacroRow({ protein, fat, carbs }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs tabular-nums text-blue-400">P {Math.round(protein * 10) / 10}g</span>
      <span className="text-xs tabular-nums text-amber-400">F {Math.round(fat * 10) / 10}g</span>
      <span className="text-xs tabular-nums text-emerald-400">C {Math.round(carbs * 10) / 10}g</span>
    </div>
  )
}

// ── Food item row ─────────────────────────────────────────────────────────────

function FoodItemRow({ item, onDelete, onEdit }) {
  return (
    <SwipeDelete onDelete={onDelete} bg="bg-card">
      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-3 px-4 py-2.5 min-w-0 text-left hover:bg-accent/20 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate leading-snug">{item.food_name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{item.portion_label}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums text-red-400">{Math.round(item.calories)} kcal</p>
          <MacroRow protein={item.protein_g} fat={item.fat_g} carbs={item.carbs_g} />
        </div>
      </button>
    </SwipeDelete>
  )
}

// ── Search result row ─────────────────────────────────────────────────────────

function SearchResult({ food, onClick }) {
  const hasServing = food.servingGrams > 0
  const displayKcal = hasServing
    ? Math.round(food.per100g.calories * food.servingGrams / 100)
    : food.per100g.calories
  const servingText = hasServing
    ? `${Math.round(food.servingGrams)}g / serving`
    : 'per 100g'

  const srcBadge = food.source === 'on'
    ? { cls: 'bg-violet-500/15 text-violet-400', label: 'ON' }
    : food.source === 'myrx'
      ? { cls: 'bg-emerald-500/15 text-emerald-400', label: 'MYRX' }
      : { cls: 'bg-sky-500/15 text-sky-400', label: 'USDA' }

  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-snug">{food.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {food.brand && <p className="text-[11px] text-muted-foreground truncate">{food.brand}</p>}
          <span className={`shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase ${srcBadge.cls}`}>
            {srcBadge.label}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold tabular-nums text-red-400">{displayKcal} kcal</p>
        <p className="text-[10px] text-muted-foreground">{servingText}</p>
      </div>
    </button>
  )
}

// ── Habit food row ────────────────────────────────────────────────────────────

function HabitDots({ score }) {
  const filled = score >= 6 ? 3 : score >= 2 ? 2 : 1
  return (
    <div className="flex items-center gap-[3px]" title={`Habit score: ${score.toFixed(1)}`}>
      {[1, 2, 3].map(i => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full transition-colors ${
            i <= filled
              ? filled === 3 ? 'bg-amber-400'
                : filled === 2 ? 'bg-amber-400/70'
                : 'bg-muted-foreground/40'
              : 'bg-muted-foreground/15'
          }`}
        />
      ))}
    </div>
  )
}

function RecentFoodRow({ food, onClick, onDelete }) {
  const hasServing = food.servingGrams > 0
  const displayKcal = hasServing
    ? Math.round(food.per100g.calories * food.servingGrams / 100)
    : food.per100g.calories
  const servingText = hasServing
    ? (food.servingLabel ? `${food.servingLabel}` : `${food.servingGrams}g`)
    : 'per 100g'

  return (
    <div className="flex items-center border-b border-border last:border-0 group">
      <button type="button" onClick={onClick}
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate leading-snug">{food.name}</p>
            {food.habitScore != null && <HabitDots score={food.habitScore} />}
          </div>
          {food.brand && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{food.brand}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-semibold tabular-nums text-red-400">{displayKcal} kcal</p>
          <p className="text-[10px] text-muted-foreground">{servingText}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="px-3 py-3 text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
        aria-label="Remove from habits"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Insert slot divider ───────────────────────────────────────────────────────
// Renders a subtle "+ Add meal" affordance between two meal slots.
// When open, shows preset chips and a custom-name input.

function InsertDivider({ open, onOpen, onInsert, existingIds, customLabel, onCustomLabelChange }) {
  const [showCustom, setShowCustom] = useState(false)
  const inputRef = useRef(null)

  // Reset inner state when the picker closes
  useEffect(() => {
    if (!open) {
      setShowCustom(false)
    }
  }, [open])

  useEffect(() => {
    if (showCustom && inputRef.current) inputRef.current.focus()
  }, [showCustom])

  const availablePresets = EXTRA_PRESETS.filter(p => !existingIds.has(p.id))

  function handlePreset(preset) {
    onInsert(preset)
  }

  function handleCustomSubmit() {
    const label = customLabel.trim()
    if (!label) return
    // Generate a URL-friendly unique ID from the label
    const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom'
    let id = baseId
    let n = 2
    while (existingIds.has(id)) { id = `${baseId}_${n++}` }
    onInsert({ id, label, emoji: '🍽️' })
  }

  return (
    <div className="px-4">
      {/* Trigger row */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 py-1 group"
        aria-label="Add a meal here"
      >
        <div className={`flex-1 h-px border-t border-dashed transition-colors ${open ? 'border-primary/40' : 'border-border/40 group-hover:border-primary/25'}`} />
        <span className={`flex items-center gap-1 text-[10px] font-medium transition-colors shrink-0 ${
          open ? 'text-primary' : 'text-muted-foreground/35 group-hover:text-muted-foreground/70'
        }`}>
          <Plus className="h-2.5 w-2.5" />
          {open ? 'Cancel' : 'Add meal'}
        </span>
        <div className={`flex-1 h-px border-t border-dashed transition-colors ${open ? 'border-primary/40' : 'border-border/40 group-hover:border-primary/25'}`} />
      </button>

      {/* Picker panel */}
      {open && (
        <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5">
          {!showCustom ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Insert a meal between these slots
              </p>
              <div className="flex flex-wrap gap-1.5">
                {availablePresets.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePreset(p)}
                    className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    <span>{p.emoji}</span> {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowCustom(true)}
                  className="flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  Custom…
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Custom meal name
              </p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={customLabel}
                  onChange={e => onCustomLabelChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCustomSubmit() }}
                  placeholder="e.g. Late-night snack"
                  maxLength={40}
                  className="flex-1 rounded-lg border border-border bg-input/30 px-3 py-1.5 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customLabel.trim()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40 transition-opacity"
                >
                  Add
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowCustom(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to presets
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Portion picker ─────────────────────────────────────────────────────────────

function PortionPicker({
  food, portions, loadingPortions, servingsPerContainer, mealSlot, onMealChange, slots, onAdd, onBack,
  mode = 'add', initialSelectedId, initialQty,
}) {
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? 'g')
  const [qty, setQty]               = useState(initialQty ?? '')
  const [adding, setAdding]         = useState(false)

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId)
  }, [initialSelectedId])

  useEffect(() => {
    if (initialQty) setQty(String(initialQty))
  }, [initialQty])

  const selectedPortion = portions.find(p => p.id === selectedId) ?? portions[0]
  const qtyNum  = parseFloat(qty)
  const isValid = !isNaN(qtyNum) && isFinite(qtyNum) && qtyNum > 0 && qtyNum <= 10000 && selectedPortion
  const totalG  = isValid ? selectedPortion.gramWeight * qtyNum : 0
  const preview = isValid ? calcMacros(food.per100g, totalG) : null

  const hasDefaultServing = food.servingGrams > 0
  const defaultServingMacros = hasDefaultServing
    ? calcMacros(food.per100g, food.servingGrams)
    : null

  const isCountUnit = !['g', 'oz', 'cup'].includes(selectedId)

  async function handleAdd() {
    if (!isValid || adding) return
    setAdding(true)
    await onAdd({
      portion_label: isCountUnit
        ? (qtyNum === 1 ? selectedPortion.label : `${qty} × ${selectedPortion.label}`)
        : `${qty} ${selectedPortion.label}`,
      portion_qty: qtyNum,
      portion_g:   Math.round(totalG * 10) / 10,
      ...calcMacros(food.per100g, totalG),
    })
    setAdding(false)
  }

  const activeSlot = slots.find(s => s.id === mealSlot) ?? slots[0]
  const backLabel  = mode === 'edit' ? 'Back to log' : 'Back to search'
  const btnLabel   = mode === 'edit' ? 'Save changes' : `Add to ${activeSlot?.label ?? 'Log'}`

  return (
    <div className="flex flex-col h-full">
      {/* Food info header */}
      <div className="px-5 py-3 border-b border-border shrink-0">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
          <ChevronLeft className="h-3.5 w-3.5" /> {backLabel}
        </button>
        <p className="text-sm font-semibold leading-snug">{food.name}</p>
        {food.brand && <p className="text-[11px] text-muted-foreground">{food.brand}</p>}

        {hasDefaultServing && defaultServingMacros ? (
          <div className="mt-1.5 rounded-lg bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-0.5 mb-0.5">
              <p className="text-[11px] text-muted-foreground font-medium">
                Per serving ({food.servingGrams}g)
              </p>
              {servingsPerContainer != null && (
                <p className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {servingsPerContainer} servings / container
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-red-400 tabular-nums">{defaultServingMacros.calories} kcal</span>
              <span className="text-xs text-blue-400 tabular-nums">P {defaultServingMacros.protein}g</span>
              <span className="text-xs text-amber-400 tabular-nums">F {defaultServingMacros.fat}g</span>
              <span className="text-xs text-emerald-400 tabular-nums">C {defaultServingMacros.carbs}g</span>
            </div>
          </div>
        ) : (
          <div className="mt-1.5">
            <p className="text-[11px] text-muted-foreground">
              Per 100g · {food.per100g.calories} kcal · P {food.per100g.protein}g · F {food.per100g.fat}g · C {food.per100g.carbs}g
            </p>
            {servingsPerContainer != null && (
              <p className="text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
                {servingsPerContainer} servings / container
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Meal slot selector — shows all current slots */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            {mode === 'edit' ? 'Move to meal' : 'Add to meal'}
          </p>
          <div className="flex gap-2 flex-wrap">
            {slots.map(s => (
              <button key={s.id} type="button" onClick={() => onMealChange(s.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  mealSlot === s.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}>
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Unit chips */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Unit</p>
          {loadingPortions ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading options…
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {portions.map(p => (
                <button key={p.id} type="button" onClick={() => setSelectedId(p.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedId === p.id
                      ? 'border-red-500/60 bg-red-500/10 text-red-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}>
                  {p.label}
                  {p.gramWeight > 1 && (
                    <span className="ml-1 text-[10px] opacity-60">(1={Math.round(p.gramWeight)}g)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quantity */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            {selectedId === 'g' ? 'Amount (grams)' : selectedId === 'oz' ? 'Amount (ounces)' : selectedId === 'cup' ? 'Amount (cups)' : selectedId === 'srv' ? 'Servings' : 'How many?'}
          </p>
          <input
            type="number" inputMode="decimal" step="any" min="0.1"
            value={qty}
            onChange={e => setQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            className="w-full rounded-lg border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30 transition-colors"
          />
          {selectedPortion && qty && isValid && (
            <p className="text-[11px] text-muted-foreground mt-1">≈ {Math.round(totalG)}g total</p>
          )}
        </div>

        {/* Live preview */}
        {preview && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-[11px] text-muted-foreground mb-2 font-medium">Nutritional info for this portion</p>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="text-xl font-bold tabular-nums text-red-400">{preview.calories}</p>
                <p className="text-[10px] text-muted-foreground">kcal</p>
              </div>
              {[
                { label: 'Protein', val: preview.protein,  color: 'text-blue-400'    },
                { label: 'Fat',     val: preview.fat,      color: 'text-amber-400'   },
                { label: 'Carbs',   val: preview.carbs,    color: 'text-emerald-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="text-center">
                  <p className={`text-base font-bold tabular-nums ${color}`}>{Math.round(val * 10) / 10}g</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border shrink-0">
        <button type="button" onClick={handleAdd} disabled={!isValid || adding}
          className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
            isValid && !adding ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}>
          {adding
            ? <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === 'edit' ? 'Saving…' : 'Adding…'}
              </span>
            : btnLabel}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FoodLogDrawer({
  userId, day, onClose, onEntriesChange,
  mealSlotsDefault,    // array of {id, label, emoji} from profile, or null
  onSaveSlotsDefault,  // (slots) => void — called when user taps "Save as default"
}) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)

  const [view, setView] = useState('log')  // 'log' | 'search' | 'portion' | 'edit'

  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError,   setSearchError]   = useState(null)
  const searchTimer    = useRef(null)

  const [suggesting,  setSuggesting]  = useState(false)
  const [suggestSent, setSuggestSent] = useState(false)
  const suggestingRef = useRef(false)

  const BASE_PORTIONS = [
    { id: 'g',   label: 'grams',           gramWeight: 1       },
    { id: 'oz',  label: 'ounces',          gramWeight: 28.3495 },
    { id: 'cup', label: 'cups',            gramWeight: 240     },
    { id: 'srv', label: 'Serving (100g)',  gramWeight: 100     },
  ]

  // ── Meal slots state ────────────────────────────────────────────────────────
  // Initialise from saved default; reset each time `day` changes so every
  // day starts from the user's saved arrangement.
  const mealSlotsDefaultRef = useRef(mealSlotsDefault)
  useEffect(() => { mealSlotsDefaultRef.current = mealSlotsDefault }, [mealSlotsDefault])

  const [localSlots,    setLocalSlots]    = useState(() => mealSlotsDefault ?? DEFAULT_SLOTS)
  // Baseline tracks what we consider "saved" — includes auto-injected slots so
  // they never trigger the "Meal layout changed" banner.
  const [baselineSlots, setBaselineSlots] = useState(() => mealSlotsDefault ?? DEFAULT_SLOTS)
  // Which divider is open: index after slot[i] (null = none)
  const [addSlotAt,       setAddSlotAt]       = useState(null)
  const [customSlotLabel, setCustomSlotLabel] = useState('')
  const [savingDefault,   setSavingDefault]   = useState(false)

  // ── Habit foods ─────────────────────────────────────────────────────────────
  const [habitFoodsBySlot,    setHabitFoodsBySlot]    = useState({})
  const [excludedRecents,     setExcludedRecents]     = useState(() => new Set())

  const [selectedFood,          setSelectedFood]          = useState(null)
  const [portions,              setPortions]              = useState(BASE_PORTIONS)
  const [portionsLoading,       setPortionsLoading]       = useState(false)
  const [servingsPerContainer,  setServingsPerContainer]  = useState(null)
  const [activeMealSlot,        setActiveMealSlot]        = useState('breakfast')

  const [editingItem,    setEditingItem]    = useState(null)
  const [editInitialId,  setEditInitialId]  = useState(null)
  const [editInitialQty, setEditInitialQty] = useState('')

  // ── Fetch entries + reset slots ───────────────────────────────────────────
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
    // Reset to saved default (or app default) for this new day
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
          setEntries(data)
          // Surface any slots in existing logs that aren't in localSlots yet
          // (e.g., user logs from a different device with a different layout)
          const knownIds = new Set((mealSlotsDefaultRef.current ?? DEFAULT_SLOTS).map(s => s.id))
          const extra = []
          const seen  = new Set()
          for (const entry of data) {
            const id = entry.meal_slot
            if (!knownIds.has(id) && !seen.has(id)) {
              seen.add(id)
              // Try to match against preset label; otherwise generate from id
              const preset = EXTRA_PRESETS.find(p => p.id === id)
              extra.push(preset ?? {
                id,
                label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                emoji: '🍽️',
              })
            }
          }
          if (extra.length > 0) {
            // Insert before 'snacks' for a sensible default position.
            // Also update the baseline so auto-injected slots don't trigger
            // the "Meal layout changed" save-as-default banner.
            const inject = (prev) => {
              const snacksIdx = prev.findIndex(s => s.id === 'snacks')
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
  }, [userId, day]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load excluded recents ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    try {
      const stored = localStorage.getItem(`myrx_excluded_recents_${userId}`)
      if (stored) setExcludedRecents(new Set(JSON.parse(stored)))
    } catch { /* ignore */ }
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
    const habitMap = {}

    for (const row of data) {
      const slot       = row.meal_slot || 'breakfast'
      const nameLower  = row.food_name.toLowerCase()
      const key        = `${slot}:${nameLower}`
      const daysSince  = (now - new Date(row.created_at).getTime()) / 86_400_000
      const contribution = Math.exp(-0.05 * daysSince)

      if (!habitMap[key]) {
        const factor = row.portion_g > 0 ? row.portion_g / 100 : 1
        habitMap[key] = {
          score: 0,
          food: {
            fdcId:       row.fdc_id ?? null,
            onId:        null,
            name:        row.food_name,
            brand:       row.brand_name ?? null,
            source:      row.fdc_id ? 'usda' : 'on',
            per100g: {
              calories: Math.round(row.calories  / factor),
              protein:  Math.round(row.protein_g / factor * 10) / 10,
              fat:      Math.round(row.fat_g     / factor * 10) / 10,
              carbs:    Math.round(row.carbs_g   / factor * 10) / 10,
            },
            servingGrams: null,
            servingLabel: null,
          },
        }
      }
      habitMap[key].score += contribution
    }

    const bySlot = {}
    for (const [key, { food, score }] of Object.entries(habitMap)) {
      if (score < 0.5) continue
      const slot = key.split(':')[0]
      if (!bySlot[slot]) bySlot[slot] = []
      bySlot[slot].push({ ...food, habitScore: score })
    }
    for (const slot of Object.keys(bySlot)) {
      bySlot[slot].sort((a, b) => b.habitScore - a.habitScore)
      bySlot[slot] = bySlot[slot].slice(0, 20)
    }
    setHabitFoodsBySlot(bySlot)
  }, [userId])

  useEffect(() => { loadHabitFoods() }, [loadHabitFoods])

  // ── Delete a recent item ──────────────────────────────────────────────────
  const handleDeleteRecent = useCallback((mealSlot, foodName) => {
    const key = `${mealSlot}:${foodName.toLowerCase()}`
    setExcludedRecents(prev => {
      const next = new Set(prev)
      next.add(key)
      try {
        localStorage.setItem(`myrx_excluded_recents_${userId}`, JSON.stringify([...next]))
      } catch { /* ignore */ }
      return next
    })
  }, [userId])

  useEffect(() => {
    if (loading) return
    onEntriesChange?.(day, entries)
  }, [entries, day, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchTimer.current)
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
    return () => clearTimeout(searchTimer.current)
  }, [searchQuery])

  // ── Suggest missing food ──────────────────────────────────────────────────
  async function handleSuggestFood() {
    const name = searchQuery.trim()
    if (!name || suggestingRef.current || suggestSent) return
    suggestingRef.current = true
    setSuggesting(true)
    const { error } = await supabase.from('messages').insert({
      user_id:      userId,
      from_admin:   false,
      body:         `New food suggestion: ${name}`,
      is_suggestion: true,
      read:         false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setTimeout(() => setSuggestSent(false), 3000)
    }
  }

  // ── Slot management ───────────────────────────────────────────────────────
  function insertSlot(afterIndex, slotDef) {
    setLocalSlots(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, slotDef)
      return next
    })
    setAddSlotAt(null)
    setCustomSlotLabel('')
  }

  function removeSlot(slotId) {
    setLocalSlots(prev => prev.filter(s => s.id !== slotId))
  }

  // Banner only appears when the user *explicitly* changes the layout vs the
  // baseline (which includes any auto-injected slots from existing log entries).
  const slotsChanged = JSON.stringify(localSlots.map(s => s.id)) !==
                       JSON.stringify(baselineSlots.map(s => s.id))

  async function handleSaveDefault() {
    if (!onSaveSlotsDefault || savingDefault) return
    setSavingDefault(true)
    try {
      await onSaveSlotsDefault(localSlots)
      // Update baseline so the banner dismisses immediately after saving
      setBaselineSlots(localSlots)
    } finally {
      setSavingDefault(false)
    }
  }

  // ── Food selection + portions ─────────────────────────────────────────────
  async function selectFood(food) {
    setSelectedFood(food)
    setView('portion')
    setPortions(BASE_PORTIONS)
    setServingsPerContainer(null)
    setPortionsLoading(true)
    try {
      const { portions: loaded, servingsPerContainer: spc } = await getFoodPortions(food)
      setPortions(loaded)
      setServingsPerContainer(spc)
    } catch { /* keep base units */ }
    finally { setPortionsLoading(false) }
  }

  async function openEdit(item) {
    setEditingItem(item)
    const factor = item.portion_g > 0 ? item.portion_g / 100 : 1
    const per100g = {
      calories: Math.round(item.calories / factor),
      protein:  Math.round(item.protein_g / factor * 10) / 10,
      fat:      Math.round(item.fat_g     / factor * 10) / 10,
      carbs:    Math.round(item.carbs_g   / factor * 10) / 10,
    }
    const foodObj = { fdcId: item.fdc_id ?? null, name: item.food_name, brand: item.brand_name ?? null, per100g, servingGrams: null, servingLabel: null }

    setSelectedFood(foodObj)
    setActiveMealSlot(item.meal_slot)
    setEditInitialId(null)
    setEditInitialQty(String(item.portion_qty))
    setView('edit')

    setPortions(BASE_PORTIONS)
    setServingsPerContainer(null)
    setPortionsLoading(true)
    try {
      const { portions: loaded, servingsPerContainer: spc } = await getFoodPortions(foodObj)
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
  async function handleAdd({ portion_label, portion_qty, portion_g, calories, protein, fat, carbs }) {
    const { data, error } = await supabase
      .from('food_logs')
      .insert({
        user_id:   userId,
        log_date:  day,
        meal_slot: activeMealSlot,
        food_name: selectedFood.name,
        brand_name: selectedFood.brand ?? null,
        fdc_id:    selectedFood.fdcId ?? null,
        portion_label, portion_qty, portion_g,
        calories, protein_g: protein, fat_g: fat, carbs_g: carbs,
      })
      .select().single()
    if (error || !data) return
    setEntries(prev => [...prev, data])
    loadHabitFoods()
    setView('log')
    setSearchQuery('')
    setSearchResults([])
    setSelectedFood(null)
  }

  async function handleEditSave({ portion_label, portion_qty, portion_g, calories, protein, fat, carbs }) {
    const updates = { meal_slot: activeMealSlot, portion_label, portion_qty, portion_g, calories, protein_g: protein, fat_g: fat, carbs_g: carbs }
    const { error } = await supabase.from('food_logs').update(updates).eq('id', editingItem.id).eq('user_id', userId)
    if (error) return
    setEntries(prev => prev.map(e => e.id === editingItem.id ? { ...e, ...updates } : e))
    setEditingItem(null)
    setView('log')
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('food_logs').delete().eq('id', id).eq('user_id', userId)
    if (error) throw new Error('Delete failed')
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = entries.reduce(
    (acc, e) => ({ calories: acc.calories + e.calories, protein: acc.protein + e.protein_g, fat: acc.fat + e.fat_g, carbs: acc.carbs + e.carbs_g }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  )

  function cancelEdit() {
    setEditingItem(null)
    setView('log')
  }

  const existingSlotIds = new Set(localSlots.map(s => s.id))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm"
           onClick={view === 'log' ? onClose : undefined} />

      <div className="relative w-full max-w-2xl flex flex-col bg-card border border-border rounded-t-2xl overflow-hidden"
           style={{ maxHeight: '92dvh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          {view === 'log' ? (
            <>
              <div>
                <p className="text-base font-bold">Food Log</p>
                <p className="text-xs text-muted-foreground">{fmtDay(day)}</p>
              </div>
              <button type="button" onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : view === 'search' ? (
            <>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button type="button"
                  onClick={() => { setView('log'); setSearchQuery(''); setSearchResults([]); setSuggestSent(false) }}
                  className="text-muted-foreground hover:text-foreground shrink-0">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input type="text" value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search foods…"
                    className="w-full rounded-lg border border-border bg-input/30 pl-8 pr-3 py-2 text-sm outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30" />
                </div>
              </div>
              <button type="button" onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground ml-2 shrink-0">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : view === 'portion' ? (
            <div className="flex items-center justify-between w-full">
              <p className="text-sm font-semibold">Choose portion</p>
              <button type="button" onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <p className="text-sm font-semibold">Edit entry</p>
              <button type="button" onClick={cancelEdit}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* LOG VIEW */}
          {view === 'log' && (
            <div className="py-2">
              {loading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                localSlots.map((slot, idx) => {
                  const slotEntries = entries.filter(e => e.meal_slot === slot.id)
                  const slotTotals  = slotEntries.reduce(
                    (acc, e) => ({ calories: acc.calories + e.calories, protein: acc.protein + e.protein_g, fat: acc.fat + e.fat_g, carbs: acc.carbs + e.carbs_g }),
                    { calories: 0, protein: 0, fat: 0, carbs: 0 }
                  )
                  const isCustom   = !ANCHOR_IDS.has(slot.id)
                  const canRemove  = isCustom && slotEntries.length === 0

                  return (
                    <div key={slot.id}>
                      <div className="px-4 pb-1">
                        {/* Slot header */}
                        <div className="flex items-center justify-between py-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-base">{slot.emoji}</span>
                              <span className="text-sm font-semibold">{slot.label}</span>
                              {/* Remove button — only for empty custom slots */}
                              {isCustom && (
                                <button
                                  type="button"
                                  onClick={canRemove ? () => removeSlot(slot.id) : undefined}
                                  disabled={!canRemove}
                                  title={canRemove ? `Remove ${slot.label}` : 'Remove entries first'}
                                  className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                                    canRemove
                                      ? 'text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 cursor-pointer'
                                      : 'text-muted-foreground/15 cursor-not-allowed'
                                  }`}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                            {slotEntries.length > 0 && (
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-xs text-red-400 tabular-nums font-semibold">{Math.round(slotTotals.calories)} kcal</span>
                                <span className="text-[11px] text-blue-400 tabular-nums">P {Math.round(slotTotals.protein)}g</span>
                                <span className="text-[11px] text-amber-400 tabular-nums">F {Math.round(slotTotals.fat)}g</span>
                                <span className="text-[11px] text-emerald-400 tabular-nums">C {Math.round(slotTotals.carbs)}g</span>
                              </div>
                            )}
                          </div>
                          <button type="button"
                            onClick={() => { setActiveMealSlot(slot.id); setView('search') }}
                            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-red-500/30 transition-colors shrink-0">
                            <Plus className="h-3 w-3" /> Add food
                          </button>
                        </div>

                        {slotEntries.length > 0 && (
                          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                            {slotEntries.map(item => (
                              <FoodItemRow key={item.id} item={item}
                                onDelete={async () => handleDelete(item.id)}
                                onEdit={() => openEdit(item)} />
                            ))}
                          </div>
                        )}
                        {slotEntries.length === 0 && (
                          <p className="text-[11px] text-muted-foreground/40 pb-1">Nothing logged yet</p>
                        )}
                      </div>

                      {/* Insert divider after every slot (including after the last) */}
                      <InsertDivider
                        open={addSlotAt === idx}
                        onOpen={() => setAddSlotAt(prev => {
                          // Reset label when switching to a different divider
                          if (prev !== idx) setCustomSlotLabel('')
                          return prev === idx ? null : idx
                        })}
                        onInsert={(slotDef) => insertSlot(idx, slotDef)}
                        existingIds={existingSlotIds}
                        customLabel={customSlotLabel}
                        onCustomLabelChange={setCustomSlotLabel}
                      />
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* SEARCH VIEW */}
          {view === 'search' && (
            <div>
              {searchLoading && (
                <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              )}
              {searchError && (
                <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {searchError}
                </div>
              )}
              {!searchLoading && !searchError && searchQuery && searchResults.length === 0 && (
                <div className="py-10 px-6 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-muted-foreground">No results for "{searchQuery}"</p>
                  <p className="text-[11px] text-muted-foreground/60 max-w-xs">
                    Can't find this food? Send it as a suggestion and your coach will add it to the database.
                  </p>
                  <button
                    type="button"
                    onClick={handleSuggestFood}
                    disabled={suggesting || suggestSent}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
                      suggestSent  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30 cursor-default'
                      : suggesting ? 'bg-blue-500/60 text-white cursor-wait'
                                   : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    {suggestSent ? (
                      '✓ Suggestion Sent'
                    ) : suggesting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                    ) : (
                      <><Send className="h-3.5 w-3.5" /> Send Suggestion</>
                    )}
                  </button>
                </div>
              )}
              {!searchLoading && !searchQuery && (() => {
                const slotHabits = (habitFoodsBySlot[activeMealSlot] || [])
                  .filter(f => !excludedRecents.has(`${activeMealSlot}:${f.name.toLowerCase()}`))
                return slotHabits.length > 0 ? (
                  <>
                    <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Your habits
                    </p>
                    {slotHabits.map((food, i) => (
                      <RecentFoodRow
                        key={`habit-${activeMealSlot}-${i}`}
                        food={food}
                        onClick={() => selectFood(food)}
                        onDelete={() => handleDeleteRecent(activeMealSlot, food.name)}
                      />
                    ))}
                  </>
                ) : (
                  <div className="py-12 text-center space-y-1">
                    <Search className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">Start typing to search foods</p>
                    <p className="text-[11px] text-muted-foreground/60">
                      USDA FoodData Central &amp;{' '}
                      <a href="https://www.opennutrition.app" target="_blank" rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-muted-foreground transition-colors">
                        OpenNutrition
                      </a>
                    </p>
                  </div>
                )
              })()}
              {searchResults.length > 0 && (
                <>
                  {searchResults.map(food => (
                    <SearchResult key={food.fdcId ?? food.onId} food={food} onClick={() => selectFood(food)} />
                  ))}
                  <p className="px-4 py-3 text-[10px] text-muted-foreground/50 text-center border-t border-border">
                    USDA FoodData Central &amp;{' '}
                    <a href="https://www.opennutrition.app" target="_blank" rel="noopener noreferrer"
                      className="underline underline-offset-2">
                      OpenNutrition
                    </a>
                  </p>
                </>
              )}
            </div>
          )}

          {/* PORTION VIEW */}
          {view === 'portion' && selectedFood && (
            <PortionPicker
              food={selectedFood} portions={portions} loadingPortions={portionsLoading}
              servingsPerContainer={servingsPerContainer}
              mealSlot={activeMealSlot} onMealChange={setActiveMealSlot}
              slots={localSlots}
              onAdd={handleAdd} onBack={() => setView('search')}
              mode="add" />
          )}

          {/* EDIT VIEW */}
          {view === 'edit' && selectedFood && (
            <PortionPicker
              food={selectedFood} portions={portions} loadingPortions={portionsLoading}
              servingsPerContainer={servingsPerContainer}
              mealSlot={activeMealSlot} onMealChange={setActiveMealSlot}
              slots={localSlots}
              onAdd={handleEditSave} onBack={cancelEdit}
              mode="edit"
              initialSelectedId={editInitialId}
              initialQty={editInitialQty} />
          )}
        </div>

        {/* Save-as-default banner — shown when layout differs from saved default */}
        {view === 'log' && !loading && slotsChanged && onSaveSlotsDefault && (
          <div className="border-t border-primary/20 bg-primary/5 px-5 py-2.5 shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Meal layout changed</p>
            <button
              type="button"
              onClick={handleSaveDefault}
              disabled={savingDefault}
              className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 shrink-0"
            >
              {savingDefault ? 'Saving…' : 'Save as default'}
            </button>
          </div>
        )}

        {/* Daily totals */}
        {view === 'log' && entries.length > 0 && (
          <div className="border-t border-border px-5 py-3 shrink-0 bg-muted/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground font-medium">Total</span>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <span className="text-sm font-bold tabular-nums text-red-400">{Math.round(totals.calories)} kcal</span>
                <span className="text-xs tabular-nums text-blue-400">P {Math.round(totals.protein)}g</span>
                <span className="text-xs tabular-nums text-amber-400">F {Math.round(totals.fat)}g</span>
                <span className="text-xs tabular-nums text-emerald-400">C {Math.round(totals.carbs)}g</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
