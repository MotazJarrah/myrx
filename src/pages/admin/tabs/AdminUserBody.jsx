import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Weight, Plus, Trash2, Loader2, Check, AlertCircle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts'

function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return Number(weight)
  if (toUnit === 'kg') return Math.round(Number(weight) * 0.453592 * 10) / 10
  return Math.round(Number(weight) * 2.20462 * 10) / 10
}

function fmtDateShort(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: '2-digit' }
  )
}

function fmtDateFull(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

// ── Compact chart ─────────────────────────────────────────────────────────────

function BodyweightChart({ entries }) {
  if (entries.length < 2) return null

  // Pick display unit = most common unit in entries (or lb by default)
  const unitCounts = entries.reduce((acc, e) => {
    acc[e.unit] = (acc[e.unit] || 0) + 1
    return acc
  }, {})
  const displayUnit = Object.keys(unitCounts).sort((a, b) => unitCounts[b] - unitCounts[a])[0] || 'lb'

  // Sort ascending for chart, use timestamp as unique key to avoid duplicate date strings
  const sorted = [...entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const data = sorted.map(e => ({
    ts:     e.created_at,
    date:   fmtDateShort(e.created_at),
    weight: convertWeight(e.weight, e.unit, displayUnit),
  }))

  const weights = data.map(d => d.weight)
  const minW    = Math.min(...weights)
  const maxW    = Math.max(...weights)
  const pad     = (maxW - minW) * 0.15 || 1

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground mb-3">Weight over time ({displayUnit})</p>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="ts"
            tickFormatter={fmtDateShort}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minW - pad, maxW + pad]}
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
            labelFormatter={fmtDateShort}
            formatter={(v) => [`${v} ${displayUnit}`, 'Weight']}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserBody({ userId, onSaved }) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [confirm,  setConfirm]  = useState(null)

  const [showForm,   setShowForm]   = useState(false)
  const [newWeight,  setNewWeight]  = useState('')
  const [newUnit,    setNewUnit]    = useState('lb')
  const [newDate,    setNewDate]    = useState(() => new Date().toISOString().split('T')[0])
  const [saving,     setSaving]     = useState(false)
  const [saveErr,    setSaveErr]    = useState('')
  const [saved,      setSaved]      = useState(false)

  useEffect(() => { load() }, [userId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('bodyweight')
      .select('id, weight, unit, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
    setEntries(data || [])
    setLoading(false)
  }

  async function deleteEntry(id) {
    setDeleting(id)
    const { error } = await supabase.from('bodyweight').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
    setConfirm(null)
  }

  async function handleAdd(e) {
    e.preventDefault()
    setSaveErr('')
    if (!newWeight || isNaN(Number(newWeight)) || Number(newWeight) <= 0) { setSaveErr('Enter a valid weight.'); return }
    setSaving(true)
    // Use current time for today; UTC noon (Z) for past dates — prevents future
    // timestamps regardless of the admin's local timezone offset.
    const today = new Date().toISOString().split('T')[0]
    const created_at = newDate === today
      ? new Date().toISOString()
      : new Date(newDate + 'T12:00:00Z').toISOString()
    const payload = { user_id: userId, weight: Number(newWeight), unit: newUnit, created_at }
    const { data, error } = await supabase.from('bodyweight').insert(payload).select().single()
    if (error) {
      setSaveErr(error.message || 'Failed to save.')
    } else {
      setEntries(prev => [data, ...prev].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
      setNewWeight('')
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

      {/* Graph */}
      {!loading && entries.length >= 2 && <BodyweightChart entries={entries} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? '…' : `${entries.length} entries`}</p>
        <button onClick={() => setShowForm(f => !f)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
          <Plus className="h-3.5 w-3.5" /> Add weigh-in
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">New weigh-in</p>
          <div className="flex gap-2 flex-wrap">
            <input type="number" step="0.1" value={newWeight} onChange={e => setNewWeight(e.target.value)} placeholder="Weight" className={inputCls + ' flex-1 min-w-[100px]'} />
            <select value={newUnit} onChange={e => setNewUnit(e.target.value)} className={inputCls}>
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
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
          <Check className="h-3.5 w-3.5" /> Weigh-in added.
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">No weigh-ins logged yet.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Weight className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm text-muted-foreground flex-1 whitespace-nowrap">{fmtDateFull(e.created_at)}</span>
                <span className="text-sm font-bold tabular-nums font-mono">{e.weight}</span>
                <span className="text-xs text-muted-foreground w-6">{e.unit}</span>
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
