import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Flame, Plus, Trash2, Loader2, Check, AlertCircle } from 'lucide-react'
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

// ── Confirm delete ────────────────────────────────────────────────────────────

function ConfirmDelete({ onConfirm, onCancel, busy }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-destructive">Delete?</span>
      <button onClick={onConfirm} disabled={busy}
        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
      </button>
      <button onClick={onCancel} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:bg-accent transition-colors">
        No
      </button>
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
  const [subTab,   setSubTab]   = useState('intake')
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [confirm,  setConfirm]  = useState(null)

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
    setDeleting(id)
    const { error } = await supabase.from('calorie_logs').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
    setConfirm(null)
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
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit">
        <SubTabBtn active={subTab === 'intake'} onClick={() => setSubTab('intake')}>Calorie Intake</SubTabBtn>
        <SubTabBtn active={subTab === 'plan'}   onClick={() => setSubTab('plan')}>Intake Plan</SubTabBtn>
      </div>

      {subTab === 'plan' && (
        <AdminUserPlan
          profile={profile}
          existingPlan={existingPlan}
          userId={userId}
          adminUserId={adminUserId}
          onPlanSaved={onPlanSaved}
        />
      )}

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
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Save</>}
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
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                    <Flame className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm text-muted-foreground flex-1 whitespace-nowrap">{fmtDate(e.log_date)}</span>
                  {confirm !== e.id && (
                    <>
                      <span className={`text-sm font-bold tabular-nums font-mono ${cls}`}>{e.calories}</span>
                      <span className="text-xs text-muted-foreground w-8">kcal</span>
                      {pct != null && (
                        <span className={`text-[11px] font-medium w-10 text-right shrink-0 ${cls}`}>{pct}%</span>
                      )}
                    </>
                  )}
                  <div className="flex justify-end shrink-0">
                    {confirm === e.id ? (
                      <ConfirmDelete onConfirm={() => deleteEntry(e.id)} onCancel={() => setConfirm(null)} busy={deleting === e.id} />
                    ) : (
                      <button onClick={() => setConfirm(e.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      </>}
    </div>
  )
}
