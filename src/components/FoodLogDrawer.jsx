/**
 * FoodLogDrawer
 * Bottom-sheet drawer for logging food for a specific day.
 * Flow: log view → search → portion picker → back to log.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { searchFoods, getFoodPortions, calcMacros } from '../lib/usda'
import {
  X, Search, ChevronLeft, Plus, Loader2, Trash2, Check,
} from 'lucide-react'
import SwipeDelete from './SwipeDelete'

// ── Constants ─────────────────────────────────────────────────────────────────

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const TODAY_ISO = isoDate(new Date())

function fmtDay(iso) {
  if (iso === TODAY_ISO) return 'Today'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Macro row helper ──────────────────────────────────────────────────────────

function MacroPills({ calories, protein, fat, carbs, size = 'sm' }) {
  const items = [
    { label: 'P',  val: protein,  color: 'text-blue-400'   },
    { label: 'F',  val: fat,      color: 'text-amber-400'  },
    { label: 'C',  val: carbs,    color: 'text-emerald-400' },
  ]
  return (
    <div className={`flex items-center gap-${size === 'sm' ? 2 : 3} flex-wrap`}>
      {size === 'sm' && (
        <span className="text-xs font-semibold text-red-400 tabular-nums">{Math.round(calories)} kcal</span>
      )}
      {items.map(({ label, val, color }) => (
        <span key={label} className={`text-xs tabular-nums ${color}`}>
          {label} {Math.round(val * 10) / 10}g
        </span>
      ))}
    </div>
  )
}

// ── Food item row (in the log) ────────────────────────────────────────────────

function FoodItemRow({ item, onDelete }) {
  return (
    <SwipeDelete
      onDelete={onDelete}
      bg="bg-card"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate leading-snug">{item.food_name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{item.portion_label}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums text-red-400">{Math.round(item.calories)} kcal</p>
          <MacroPills
            calories={0}
            protein={item.protein_g}
            fat={item.fat_g}
            carbs={item.carbs_g}
          />
        </div>
      </div>
    </SwipeDelete>
  )
}

// ── Search result row ─────────────────────────────────────────────────────────

function SearchResult({ food, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors border-b border-border last:border-0"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-snug">{food.name}</p>
        {food.brand && (
          <p className="text-[11px] text-muted-foreground truncate">{food.brand}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold tabular-nums text-red-400">{food.per100g.calories} kcal</p>
        <p className="text-[10px] text-muted-foreground">per 100g</p>
      </div>
    </button>
  )
}

// ── Portion picker ─────────────────────────────────────────────────────────────

function PortionPicker({ food, portions, loadingPortions, mealSlot, onMealChange, onAdd, onBack }) {
  const [selectedId, setSelectedId] = useState('g')
  const [qty, setQty]               = useState('')
  const [adding, setAdding]         = useState(false)

  const selectedPortion = portions.find(p => p.id === selectedId) ?? portions[0]
  const qtyNum = parseFloat(qty)
  const isValid = !isNaN(qtyNum) && isFinite(qtyNum) && qtyNum > 0 && qtyNum <= 10000 && selectedPortion

  const totalGrams = isValid ? selectedPortion.gramWeight * qtyNum : 0
  const preview    = isValid ? calcMacros(food.per100g, totalGrams) : null

  async function handleAdd() {
    if (!isValid || adding) return
    setAdding(true)
    await onAdd({
      portion_label: qty === '1' && selectedId !== 'g' && selectedId !== 'oz'
        ? selectedPortion.label
        : `${qty} ${selectedPortion.label}`,
      portion_qty:   qtyNum,
      portion_g:     Math.round(totalGrams * 10) / 10,
      ...calcMacros(food.per100g, totalGrams),
    })
    setAdding(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Back + food name */}
      <div className="px-5 py-3 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to search
        </button>
        <p className="text-sm font-semibold leading-snug">{food.name}</p>
        {food.brand && <p className="text-[11px] text-muted-foreground">{food.brand}</p>}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Per 100g · {food.per100g.calories} kcal · P {food.per100g.protein}g · F {food.per100g.fat}g · C {food.per100g.carbs}g
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Meal slot selector */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Add to meal</p>
          <div className="flex gap-2 flex-wrap">
            {MEAL_SLOTS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => onMealChange(s.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  mealSlot === s.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Portion unit */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Unit</p>
          {loadingPortions ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading portion options…
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {portions.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedId === p.id
                      ? 'border-red-500/60 bg-red-500/10 text-red-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                  {p.gramWeight > 1 && (
                    <span className="ml-1 text-[10px] opacity-60">= {Math.round(p.gramWeight)}g</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quantity */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Quantity</p>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0.1"
            value={qty}
            onChange={e => setQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder={selectedId === 'g' ? 'e.g. 150' : 'e.g. 1'}
            autoFocus
            className="w-full rounded-lg border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30 transition-colors"
          />
          {selectedPortion && qty && (
            <p className="text-[11px] text-muted-foreground mt-1">
              ≈ {Math.round(totalGrams)}g total
            </p>
          )}
        </div>

        {/* Live macro preview */}
        {preview && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-[11px] text-muted-foreground mb-2 font-medium">Nutritional info for this portion</p>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="text-xl font-bold tabular-nums text-red-400">{preview.calories}</p>
                <p className="text-[10px] text-muted-foreground">kcal</p>
              </div>
              {[
                { label: 'Protein', val: preview.protein,  color: 'text-blue-400'   },
                { label: 'Fat',     val: preview.fat,       color: 'text-amber-400'  },
                { label: 'Carbs',   val: preview.carbs,     color: 'text-emerald-400' },
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

      {/* Add button — pinned at bottom */}
      <div className="px-5 py-4 border-t border-border shrink-0">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!isValid || adding}
          className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
            isValid && !adding
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          {adding ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Adding…
            </span>
          ) : (
            `Add to ${MEAL_SLOTS.find(s => s.id === mealSlot)?.label ?? 'Log'}`
          )}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FoodLogDrawer({ userId, day, onClose, onEntriesChange }) {
  // ── Data state ────────────────────────────────────────────────────────────
  const [entries,  setEntries]  = useState([])   // [{id, meal_slot, food_name, ...}]
  const [loading,  setLoading]  = useState(true)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState('log')  // 'log' | 'search' | 'portion'

  // Search
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError,   setSearchError]   = useState(null)
  const searchTimer = useRef(null)
  const searchInputRef = useRef(null)

  // Portion picker
  const [selectedFood,    setSelectedFood]    = useState(null)  // from search results
  const [portions,        setPortions]        = useState([{ id: 'g', label: 'gram', gramWeight: 1 }, { id: 'oz', label: 'ounce (oz)', gramWeight: 28.3495 }])
  const [portionsLoading, setPortionsLoading] = useState(false)
  const [activeMealSlot,  setActiveMealSlot]  = useState('breakfast')

  // ── Fetch entries for this day ────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !day) return
    // Reset UI state whenever the day changes (user tapped a different tile)
    setView('log')
    setSearchQuery('')
    setSearchResults([])
    setSelectedFood(null)
    setEntries([])
    setLoading(true)
    supabase
      .from('food_logs')
      .select('id, meal_slot, food_name, brand_name, portion_label, portion_qty, portion_g, calories, protein_g, fat_g, carbs_g, created_at')
      .eq('user_id', userId)
      .eq('log_date', day)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setEntries(data)
        setLoading(false)
      })
  }, [userId, day])

  // Notify parent when entries change — skip while initial fetch is in flight
  // to avoid overwriting parent's todayEntries with [] before our load resolves
  useEffect(() => {
    if (loading) return
    onEntriesChange?.(day, entries)
  }, [entries, day, loading])

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!searchQuery.trim()) { setSearchResults([]); setSearchError(null); return }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const results = await searchFoods(searchQuery)
        setSearchResults(results)
      } catch {
        setSearchError('Search failed. Check your connection and try again.')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 500)
    return () => clearTimeout(searchTimer.current)
  }, [searchQuery])

  // Focus search input when entering search view
  useEffect(() => {
    if (view === 'search') {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [view])

  // ── Load portions when a food is selected ────────────────────────────────
  async function selectFood(food) {
    setSelectedFood(food)
    setView('portion')
    setPortions([
      { id: 'g',  label: 'gram',       gramWeight: 1 },
      { id: 'oz', label: 'ounce (oz)', gramWeight: 28.3495 },
    ])
    setPortionsLoading(true)
    try {
      const p = await getFoodPortions(food.fdcId)
      setPortions(p)
    } catch {
      // Keep gram/oz as fallback — already set above
    } finally {
      setPortionsLoading(false)
    }
  }

  // ── Add entry ─────────────────────────────────────────────────────────────
  async function handleAdd({ portion_label, portion_qty, portion_g, calories, protein, fat, carbs }) {
    const row = {
      user_id:       userId,
      log_date:      day,
      meal_slot:     activeMealSlot,
      food_name:     selectedFood.name,
      brand_name:    selectedFood.brand ?? null,
      fdc_id:        selectedFood.fdcId,
      portion_label,
      portion_qty,
      portion_g,
      calories,
      protein_g:     protein,
      fat_g:         fat,
      carbs_g:       carbs,
    }
    const { data, error } = await supabase
      .from('food_logs')
      .insert(row)
      .select()
      .single()
    if (error || !data) return
    setEntries(prev => [...prev, data])
    // Return to log view
    setView('log')
    setSearchQuery('')
    setSearchResults([])
    setSelectedFood(null)
  }

  // ── Delete entry ──────────────────────────────────────────────────────────
  async function handleDelete(id) {
    const { error } = await supabase
      .from('food_logs')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) throw new Error('Delete failed')
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein:  acc.protein  + e.protein_g,
      fat:      acc.fat      + e.fat_g,
      carbs:    acc.carbs    + e.carbs_g,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-2xl flex flex-col bg-card border border-border rounded-t-2xl overflow-hidden"
           style={{ maxHeight: '92dvh' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          {view === 'log' ? (
            <>
              <div>
                <p className="text-base font-bold">Food Log</p>
                <p className="text-xs text-muted-foreground">{fmtDay(day)}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : view === 'search' ? (
            <>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => { setView('log'); setSearchQuery(''); setSearchResults([]) }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search foods…"
                    className="w-full rounded-lg border border-border bg-input/30 pl-8 pr-3 py-2 text-sm text-foreground outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30 transition-colors"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground ml-2 shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            /* portion view — header handled inside PortionPicker */
            <div className="flex items-center justify-between w-full">
              <p className="text-sm font-semibold">Choose portion</p>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* LOG VIEW */}
          {view === 'log' && (
            <div className="space-y-1 py-2">
              {loading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                MEAL_SLOTS.map(slot => {
                  const slotEntries = entries.filter(e => e.meal_slot === slot.id)
                  const slotCal    = slotEntries.reduce((s, e) => s + e.calories, 0)
                  return (
                    <div key={slot.id} className="px-4 pb-1">
                      {/* Slot header */}
                      <div className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{slot.emoji}</span>
                          <span className="text-sm font-semibold">{slot.label}</span>
                          {slotEntries.length > 0 && (
                            <span className="text-xs text-red-400 tabular-nums font-medium">
                              {Math.round(slotCal)} kcal
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setActiveMealSlot(slot.id); setView('search') }}
                          className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-red-500/30 transition-colors"
                        >
                          <Plus className="h-3 w-3" /> Add food
                        </button>
                      </div>

                      {/* Items */}
                      {slotEntries.length > 0 && (
                        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                          {slotEntries.map(item => (
                            <FoodItemRow
                              key={item.id}
                              item={item}
                              onDelete={async () => handleDelete(item.id)}
                            />
                          ))}
                        </div>
                      )}

                      {slotEntries.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/40 pb-1">Nothing logged yet</p>
                      )}
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching USDA database…
                </div>
              )}
              {searchError && (
                <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {searchError}
                </div>
              )}
              {!searchLoading && !searchError && searchQuery && searchResults.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No results for "{searchQuery}"
                </div>
              )}
              {!searchLoading && !searchQuery && (
                <div className="py-12 text-center space-y-1">
                  <Search className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">Start typing to search foods</p>
                  <p className="text-[11px] text-muted-foreground/60">Powered by USDA FoodData Central</p>
                </div>
              )}
              {searchResults.length > 0 && (
                <div>
                  {searchResults.map(food => (
                    <SearchResult
                      key={food.fdcId}
                      food={food}
                      onClick={() => selectFood(food)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PORTION VIEW */}
          {view === 'portion' && selectedFood && (
            <PortionPicker
              food={selectedFood}
              portions={portions}
              loadingPortions={portionsLoading}
              mealSlot={activeMealSlot}
              onMealChange={setActiveMealSlot}
              onAdd={handleAdd}
              onBack={() => setView('search')}
            />
          )}
        </div>

        {/* ── Daily totals bar (only in log view) ── */}
        {view === 'log' && entries.length > 0 && (
          <div className="border-t border-border px-5 py-3 shrink-0 bg-muted/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground font-medium">Total</span>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <span className="text-sm font-bold tabular-nums text-red-400">
                  {Math.round(totals.calories)} kcal
                </span>
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
