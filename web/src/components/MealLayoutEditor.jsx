/**
 * MealLayoutEditor — the default meal-slot editor (anchor slots + custom
 * slots via insert-dividers + presets), extracted from EditProfile.jsx so
 * it can be shared by:
 *   • the end-user /profile Settings tab (self mode), and
 *   • the admin client-settings drawer's Preferences tab (target mode,
 *     admin editing a client).
 *
 * The component owns the slot list + the per-slot "add" dividers + the
 * reset / save controls. The PARENT supplies the section header and the
 * explanatory note (the note's voice differs — "your" for self vs "the
 * client's" for admin), so this stays surface-agnostic.
 *
 * Props:
 *   profile        — the profile whose meal_slots_default we're editing
 *   effectiveUserId — the profiles.id to write to (client in target mode,
 *                     self otherwise)
 *   onSaved        — optional ({ meal_slots_default }) fired after a save so
 *                    the parent can merge into its local state
 *   refreshOnSave  — when true (self mode) calls useAuth().refreshProfile()
 *                    after save; in target mode that would refresh the
 *                    ADMIN's profile, so leave it false there
 *   note           — explanatory line under the list (parent-supplied voice)
 */

import { useState } from 'react'
import { X as XIcon, Plus, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { DEFAULT_SLOTS, EXTRA_PRESETS, ANCHOR_IDS } from './FoodLogDrawer'

export default function MealLayoutEditor({ profile, effectiveUserId, onSaved, refreshOnSave = false, note }) {
  const { refreshProfile } = useAuth()

  const [mealSlots,      setMealSlots]      = useState(() => profile?.meal_slots_default ?? DEFAULT_SLOTS)
  const [slotPickerOpen, setSlotPickerOpen] = useState(null)  // index to insert after, or null
  const [customSlotName, setCustomSlotName] = useState('')
  const [showCustomSlot, setShowCustomSlot] = useState(false)
  const [slotSaving,     setSlotSaving]     = useState(false)
  const [slotSaved,      setSlotSaved]      = useState(false)

  const existingSlotIds  = new Set(mealSlots.map(s => s.id))
  const availablePresets = EXTRA_PRESETS.filter(p => !existingSlotIds.has(p.id))

  function insertSlotAt(afterIndex, slotDef) {
    setMealSlots(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, slotDef)
      return next
    })
    setSlotPickerOpen(null)
    setCustomSlotName('')
    setShowCustomSlot(false)
  }

  function removeSlot(slotId) {
    setMealSlots(prev => prev.filter(s => s.id !== slotId))
  }

  async function saveSlots() {
    if (slotSaving) return
    setSlotSaving(true)
    try {
      await supabase.from('profiles').update({ meal_slots_default: mealSlots }).eq('id', effectiveUserId)
      if (refreshOnSave) await refreshProfile()
      onSaved?.({ meal_slots_default: mealSlots })
      setSlotSaved(true)
      setTimeout(() => setSlotSaved(false), 2500)
    } catch { /* silent */ }
    finally { setSlotSaving(false) }
  }

  function handleCustomSlotAdd() {
    const label = customSlotName.trim()
    if (!label || slotPickerOpen === null) return
    const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom'
    let id = baseId; let n = 2
    while (existingSlotIds.has(id)) { id = `${baseId}_${n++}` }
    insertSlotAt(slotPickerOpen, { id, label, emoji: '🍽️' })
  }

  const slotsMatchDefault = JSON.stringify(mealSlots.map(s => s.id)) ===
    JSON.stringify((profile?.meal_slots_default ?? DEFAULT_SLOTS).map(s => s.id))

  return (
    <div className="space-y-4">
      {/* Slot list */}
      <div className="space-y-0">
        {mealSlots.map((slot, idx) => {
          const isCustom = !ANCHOR_IDS.has(slot.id)
          return (
            <div key={slot.id}>
              <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-accent/20 group">
                <span className="text-base shrink-0">{slot.emoji}</span>
                <span className="text-sm font-medium flex-1">{slot.label}</span>
                {isCustom ? (
                  <button
                    type="button"
                    onClick={() => removeSlot(slot.id)}
                    className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
                    aria-label={`Remove ${slot.label}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity pr-1">anchor</span>
                )}
              </div>

              {/* Insert divider */}
              <div className="px-1">
                {slotPickerOpen === idx ? (
                  <div className="my-1 rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-2">
                    {!showCustomSlot ? (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Add meal after {slot.label}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {availablePresets.map(p => (
                            <button key={p.id} type="button"
                              onClick={() => insertSlotAt(idx, p)}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                              <span>{p.emoji}</span> {p.label}
                            </button>
                          ))}
                          <button type="button"
                            onClick={() => setShowCustomSlot(true)}
                            className="flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors">
                            Custom…
                          </button>
                        </div>
                        <button type="button" onClick={() => setSlotPickerOpen(null)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customSlotName}
                            onChange={e => setCustomSlotName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCustomSlotAdd() }}
                            placeholder="e.g. Late-night snack"
                            maxLength={40}
                            autoFocus
                            className="flex-1 rounded-lg border border-border bg-input/30 px-2.5 py-1 text-sm outline-none focus:border-primary/40 transition-colors"
                          />
                          <button type="button" onClick={handleCustomSlotAdd}
                            disabled={!customSlotName.trim()}
                            className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                            Add
                          </button>
                        </div>
                        <button type="button" onClick={() => setShowCustomSlot(false)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                          ← Presets
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setSlotPickerOpen(idx); setShowCustomSlot(false); setCustomSlotName('') }}
                    className="flex w-full items-center gap-1.5 py-0.5 group/div"
                  >
                    <div className="flex-1 h-px border-t border-dashed border-border/30 group-hover/div:border-primary/30 transition-colors" />
                    <span className="text-[9px] text-muted-foreground/25 group-hover/div:text-muted-foreground/60 flex items-center gap-0.5 transition-colors shrink-0">
                      <Plus className="h-2 w-2" /> add
                    </span>
                    <div className="flex-1 h-px border-t border-dashed border-border/30 group-hover/div:border-primary/30 transition-colors" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {note && (
        <p className="text-[11px] text-muted-foreground/50 leading-relaxed">{note}</p>
      )}

      {/* Reset to defaults link */}
      {!slotsMatchDefault && (
        <button
          type="button"
          onClick={() => { setMealSlots(DEFAULT_SLOTS); setSlotPickerOpen(null) }}
          className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          Reset to defaults
        </button>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={saveSlots}
        disabled={slotSaving || slotSaved || slotsMatchDefault}
        className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-all ${
          slotSaved
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : slotsMatchDefault
            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-40'
            : 'bg-primary text-primary-foreground hover:opacity-90'
        }`}
      >
        {slotSaved
          ? <><Check className="h-3.5 w-3.5" /> Saved</>
          : slotSaving
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
          : 'Save meal layout'}
      </button>
    </div>
  )
}
