import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Flame, Plus, Check, AlertCircle, Trash2 } from 'lucide-react'
import SwipeDelete from '../../../components/SwipeDelete'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { calcFullPlan } from '../../../lib/calorieFormulas'
import AdminUserPlan from './AdminUserPlan'

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00')
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

function fmtDatetime(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function CaloriesChart({ entries, dailyTarget }) {
  if (entries.length < 2) return null

  const sorted = [...entries].sort((a, b) => a.log_date.localeCompare(b.log_date))
  const data = sorted.map(e => ({ date: fmtDate(e.log_date), kcal: e.calories }))

  const values = data.map(d => d.kcal)
  const allVals = dailyTarget ? [...values, dailyTarget] : values
  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const pad  = (maxV - minV) * 0.15 || 100

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground">Calorie intake</p>
        {dailyTarget && (
          <span className="text-[11px] text-muted-foreground">
            target <span className="font-semibold text-foreground">{dailyTarget} kcal</span>
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[Math.max(0, minV - pad), maxV + pad]}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickCount={4}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: 12,
            }}
            formatter={(v) => [`${v} kcal`, 'Intake']}
          />
          {dailyTarget && (
            <ReferenceLine
              y={dailyTarget}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
            />
          )}
          <Line
            type="monotone"
            dataKey="kcal"
            stroke="#f87171"
            strokeWidth={2}
            dot={{ r: 3, fill: '#f87171', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={true}
            animationDuration={900}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function complianceCls(logged, target) {
  if (!target) return 'text-foreground'
  const r = logged / target
  if (r >= 0.9 && r <= 1.1) return 'text-emerald-400'
  if (r >= 0.75 && r <= 1.2) return 'text-amber-400'
  return 'text-red-400'
}

// ── Food Log tab (reads from food_logs) ───────────────────────────────────────

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

function FoodLogTab({ userId, dailyTarget }) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [groupBy,  setGroupBy]  = useState('day')   // 'day' | 'meal'
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

export default function AdminUserCalories({ userId, existingPlan, profile, adminUserId, onPlanSaved, onSaved }) {
  const [subTab,   setSubTab]   = useState('foodlog')
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)

  const [showForm,    setShowForm]    = useState(false)
  const [newCalories, setNewCalories] = useState('')
  const [newDate,     setNewDate]     = useState(() => new Date().toISOString().split('T')[0])
  const [saving,      setSaving]      = useState(false)
  const [saveErr,     setSaveErr]     = useState('')
  const [saved,       setSaved]       = useState(false)

  const dailyTarget = (() => {
    if (!existingPlan || !profile) return null
    try { return calcFullPlan(profile, existingPlan)?.dailyTarget ?? null }
    catch { return null }
  })()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('calorie_logs')
        .select('id, log_date, calories')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .limit(100)
      setEntries(data || [])
      setLoading(false)
    }
    load()
  }, [userId])

  async function deleteEntry(id) {
    setEntries(prev => prev.filter(e => e.id !== id))
    await supabase.from('calorie_logs').delete().eq('id', id)
  }

  async function handleAdd(e) {
    e.preventDefault()
    setSaveErr('')
    const kcal = Number(newCalories)
    if (!newCalories || isNaN(kcal) || kcal <= 0) { setSaveErr('Enter a valid calorie amount.'); return }
    setSaving(true)
    const { data, error } = await supabase
      .from('calorie_logs')
      .upsert({ user_id: userId, log_date: newDate, calories: kcal }, { onConflict: 'user_id,log_date' })
      .select().single()
    if (error) {
      setSaveErr(error.message || 'Failed to save.')
    } else {
      setEntries(prev => {
        const filtered = prev.filter(e => e.log_date !== newDate)
        return [data, ...filtered].sort((a, b) => b.log_date.localeCompare(a.log_date))
      })
      setNewCalories('')
      setShowForm(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    }
    setSaving(false)
  }

  const inputCls = 'rounded-md border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  return (
    <div className="space-y-4">

      {/* Sub-tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit flex-wrap">
        <SubTabBtn active={subTab === 'foodlog'} onClick={() => setSubTab('foodlog')}>Food Log</SubTabBtn>
        <SubTabBtn active={subTab === 'intake'}  onClick={() => setSubTab('intake')}>Manual Logs</SubTabBtn>
        <SubTabBtn active={subTab === 'plan'}    onClick={() => setSubTab('plan')}>Intake Plan</SubTabBtn>
      </div>

      {/* Food Log tab — reads from food_logs */}
      {subTab === 'foodlog' && (
        <FoodLogTab userId={userId} dailyTarget={dailyTarget} />
      )}

      {/* Intake Plan tab */}
      {subTab === 'plan' && (
        <AdminUserPlan
          profile={profile}
          existingPlan={existingPlan}
          userId={userId}
          adminUserId={adminUserId}
          onPlanSaved={onPlanSaved}
        />
      )}

      {/* Manual (legacy) calorie logs tab */}
      {subTab === 'intake' && <>

      {/* Graph */}
      {!loading && entries.length >= 2 && <CaloriesChart entries={entries} dailyTarget={dailyTarget} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{loading ? '…' : `${entries.length} entries`}</p>
          {dailyTarget && (
            <span className="text-xs text-muted-foreground">· target <span className="font-semibold text-foreground">{dailyTarget} kcal</span></span>
          )}
        </div>
        <button onClick={() => setShowForm(f => !f)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
          <Plus className="h-3.5 w-3.5" /> Add entry
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">New calorie log</p>
          <div className="flex gap-2 flex-wrap">
            <input type="number" step="1" value={newCalories} onChange={e => setNewCalories(e.target.value)} placeholder="Calories (kcal)" className={inputCls + ' flex-1 min-w-[140px]'} />
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className={inputCls} />
          </div>
          {saveErr && <div className="flex items-center gap-2 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" />{saveErr}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : <><Check className="h-3.5 w-3.5" /> Save</>}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setSaveErr('') }}
              className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          <Check className="h-3.5 w-3.5" /> Calorie log saved.
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">No calorie logs yet.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map(e => {
              const cls = complianceCls(e.calories, dailyTarget)
              const pct = dailyTarget ? Math.round((e.calories / dailyTarget) * 100) : null
              return (
                <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-card">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                      <Flame className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm text-muted-foreground flex-1 whitespace-nowrap">{fmtDate(e.log_date)}</span>
                    <span className={`text-sm font-bold tabular-nums font-mono ${cls}`}>{e.calories}</span>
                    <span className="text-xs text-muted-foreground w-8">kcal</span>
                    {pct != null && (
                      <span className={`text-[11px] font-medium w-10 text-right shrink-0 ${cls}`}>{pct}%</span>
                    )}
                  </div>
                </SwipeDelete>
              )
            })}
          </div>
        </div>
      )}

      </>}
    </div>
  )
}
