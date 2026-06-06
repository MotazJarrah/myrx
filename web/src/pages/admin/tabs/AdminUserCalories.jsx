import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import SwipeDelete from '../../../components/SwipeDelete'
import { calcFullPlan } from '../../../lib/calorieFormulas'
import MacroPlanEditor from '../../../components/MacroPlanEditor'
import CalorieDashboard from '../../../components/CalorieDashboard'

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00')
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

function complianceCls(logged, target) {
  if (!target) return 'text-foreground'
  const r = logged / target
  if (r >= 0.9 && r <= 1.1) return 'text-emerald-400'
  if (r >= 0.75 && r <= 1.2) return 'text-amber-400'
  return 'text-red-400'
}

// ── Food Log tab (reads from food_logs — review only) ──────────────────────────

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

function FoodLogTab({ userId, dailyTarget }) {
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

export default function AdminUserCalories({ userId, existingPlan, profile, adminUserId, onPlanSaved }) {
  const [subTab, setSubTab] = useState('overview')

  const dailyTarget = (() => {
    if (!existingPlan || !profile) return null
    try { return calcFullPlan(profile, existingPlan)?.dailyTarget ?? null }
    catch { return null }
  })()

  return (
    <div className="space-y-4">

      {/* Sub-tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit flex-wrap">
        <SubTabBtn active={subTab === 'overview'} onClick={() => setSubTab('overview')}>Overview</SubTabBtn>
        <SubTabBtn active={subTab === 'foodlog'}  onClick={() => setSubTab('foodlog')}>Food Log</SubTabBtn>
        <SubTabBtn active={subTab === 'plan'}     onClick={() => setSubTab('plan')}>Macro Plan</SubTabBtn>
      </div>

      {/* Overview tab — read-only mirror of the athlete calorie dashboard */}
      {subTab === 'overview' && (
        <CalorieDashboard userId={userId} profile={profile} plan={existingPlan} />
      )}

      {/* Food Log tab — read-only review of the client's food_logs */}
      {subTab === 'foodlog' && (
        <FoodLogTab userId={userId} dailyTarget={dailyTarget} />
      )}

      {/* Macro Plan tab — unified MacroPlanEditor (coach edits the client's plan) */}
      {subTab === 'plan' && (
        <MacroPlanEditor
          profile={profile}
          user={{ id: userId, email: profile?.email ?? null }}
          existingPlan={existingPlan}
          onPlanSaved={onPlanSaved}
          savedBy={adminUserId}
        />
      )}
    </div>
  )
}
