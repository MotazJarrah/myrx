import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { Weight, Check, AlertCircle, Loader2, TrendingUp, TrendingDown, Target, Minus } from 'lucide-react'
import SwipeDelete from '../../../components/SwipeDelete'
import CoachAddButton from '../../../components/CoachAddButton'
import UnitToggle from '../../../components/UnitToggle'
import TickerNumber from '../../../components/TickerNumber'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return Number(weight)
  if (toUnit === 'kg') return Math.round(Number(weight) * 0.453592 * 10) / 10
  return Math.round(Number(weight) * 2.20462 * 10) / 10
}

// ── Body-composition helpers (ported from web/src/pages/Bodyweight.jsx) ──────────

function toKg(weight, unit) {
  return unit === 'lb' ? weight * 0.453592 : weight
}

function toDisplayUnit(kg, unit) {
  const val = unit === 'lb' ? kg / 0.453592 : kg
  return Math.round(val * 10) / 10
}

function getHeightM(profile) {
  if (!profile?.current_height) return null
  if (profile.height_unit === 'metric') return profile.current_height / 100
  return profile.current_height * 0.0254 // imperial: stored as total inches
}

function calcBMI(weightKg, heightM) {
  if (!weightKg || !heightM) return null
  return weightKg / (heightM * heightM)
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Underweight', color: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20'     }
  if (bmi < 25)   return { label: 'Normal',      color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' }
  if (bmi < 30)   return { label: 'Overweight',  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20'   }
  return              { label: 'Obese',       color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20'     }
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

// ── Insight stat card (mirrors the athlete Bodyweight page) ─────────────────────

function StatCard({ title, children, className = '' }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 space-y-2 ${className}`}>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

// ── Progress chart (emerald, mirrors the athlete page) ──────────────────────────

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
      <h2 className="text-sm font-semibold mb-3">
        Progress <span className="text-muted-foreground font-normal">({displayUnit})</span>
      </h2>
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
            stroke="#34d399"
            strokeWidth={2}
            dot={{ r: 3, fill: '#34d399', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#34d399' }}
            isAnimationActive={true}
            animationDuration={900}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserBody({ userId, profile, onSaved }) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)

  const [showForm,   setShowForm]   = useState(false)
  const [newWeight,  setNewWeight]  = useState('')
  const [newUnit,    setNewUnit]    = useState('lb')
  const [newDate,    setNewDate]    = useState(() => new Date().toISOString().split('T')[0])
  const [saving,     setSaving]     = useState(false)
  const [saveErr,    setSaveErr]    = useState('')
  const [saved,      setSaved]      = useState(false)

  useEffect(() => { load() }, [userId])

  // Default the new-weigh-in unit to the client's preferred unit once profile loads.
  useEffect(() => { if (profile?.weight_unit) setNewUnit(profile.weight_unit) }, [profile?.weight_unit])

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
    setEntries(prev => prev.filter(e => e.id !== id))
    await supabase.from('bodyweight').delete().eq('id', id)
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

  // ── Derived stats (use the CLIENT's units from the profile prop) ─────────────

  const preferredUnit = profile?.weight_unit || newUnit
  const heightM       = getHeightM(profile)

  // Source of truth for "current": profile.current_weight; fall back to latest log.
  const latestLog = entries[0] ?? null
  const profileWeightKg = profile?.current_weight != null
    ? toKg(profile.current_weight, profile.weight_unit || 'lb')
    : null
  const latestWeightKg = profileWeightKg
    ?? (latestLog ? toKg(latestLog.weight, latestLog.unit) : null)

  const currentDisplay = profile?.current_weight != null
    ? `${profile.current_weight} ${profile.weight_unit || 'lb'}`
    : latestLog
      ? `${latestLog.weight} ${latestLog.unit}`
      : null

  // BMI
  const bmi    = calcBMI(latestWeightKg, heightM)
  const bmiCat = bmi ? bmiCategory(bmi) : null

  // Ideal weight range (BMI 18.5 – 24.9)
  const idealMin = heightM ? toDisplayUnit(18.5 * heightM * heightM, preferredUnit) : null
  const idealMax = heightM ? toDisplayUnit(24.9 * heightM * heightM, preferredUnit) : null

  // Weight trend: compare latest to entry ~30 days ago (or oldest available)
  const trend = useMemo(() => {
    if (entries.length < 2) return null
    const latest        = entries[0]
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    const reference     = entries.find(l => new Date(l.created_at).getTime() <= thirtyDaysAgo) ?? entries[entries.length - 1]
    if (reference.id === latest.id) return null

    const latestKg    = toKg(latest.weight, latest.unit)
    const referenceKg = toKg(reference.weight, reference.unit)
    const deltaKg     = latestKg - referenceKg
    const deltaVal    = toDisplayUnit(Math.abs(deltaKg), preferredUnit)
    const days        = Math.round((new Date(latest.created_at) - new Date(reference.created_at)) / 86_400_000)
    return { delta: deltaKg, display: deltaVal, days }
  }, [entries, preferredUnit])

  const inputCls = 'rounded-md border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  return (
    <div className="space-y-4">

      {/* Unified action row — entries count (left) + Add weigh-in (right) */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{loading ? '…' : `${entries.length} entries`}</p>
        <CoachAddButton label="Add weigh-in" onClick={() => setShowForm(f => !f)} />
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">New weigh-in</p>
          <div className="flex gap-2 flex-wrap">
            <input type="number" step="0.1" autoFocus value={newWeight} onChange={e => setNewWeight(e.target.value)} placeholder="Weight" className={inputCls + ' flex-1 min-w-[100px]'} />
            <UnitToggle value={newUnit} options={['lb', 'kg']} onChange={setNewUnit} />
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

      {/* Insight cards — mirror the athlete Bodyweight page */}
      <div className="grid grid-cols-2 gap-3">

        {/* Current weight */}
        <StatCard title="Current Weight">
          <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-400">
            {currentDisplay ? <TickerNumber value={currentDisplay} /> : '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            {latestLog
              ? `Logged ${new Date(latestLog.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              : profile?.current_weight ? 'From profile' : 'No weigh-in yet'
            }
          </p>
        </StatCard>

        {/* BMI */}
        {bmi && bmiCat ? (
          <div className={`rounded-xl border p-4 space-y-2 ${bmiCat.bg} ${bmiCat.border}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">BMI</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${bmiCat.bg} ${bmiCat.border} ${bmiCat.color}`}>
                {bmiCat.label}
              </span>
            </div>
            <p className={`text-2xl font-bold tabular-nums tracking-tight ${bmiCat.color}`}>
              <TickerNumber value={bmi.toFixed(1)} />
            </p>
            <p className="text-xs text-muted-foreground">Normal range: 18.5 – 24.9</p>
          </div>
        ) : (
          <StatCard title="BMI">
            <p className="text-sm text-muted-foreground/60 leading-snug">
              {!latestWeightKg ? 'Log a weigh-in first' : 'Add height in profile to calculate'}
            </p>
          </StatCard>
        )}

        {/* Ideal weight range */}
        {idealMin && idealMax ? (
          <StatCard title="Ideal Weight Range">
            <div className="flex items-end gap-1.5">
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                <TickerNumber value={idealMin} /> – <TickerNumber value={idealMax} />
              </p>
              <p className="mb-0.5 text-sm text-muted-foreground">{preferredUnit}</p>
            </div>
            <p className="text-xs text-muted-foreground">Based on BMI 18.5 – 24.9</p>
          </StatCard>
        ) : (
          <StatCard title="Ideal Weight Range">
            <Target className="h-5 w-5 text-muted-foreground/30 mb-1" />
            <p className="text-xs text-muted-foreground/60">Add height in profile</p>
          </StatCard>
        )}

        {/* Weight trend */}
        {trend ? (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Weight Trend</p>
              {trend.delta < -0.05 ? <TrendingDown className="h-4 w-4 text-emerald-400" />
                : trend.delta > 0.05 ? <TrendingUp className="h-4 w-4 text-amber-400" />
                : <Minus className="h-4 w-4 text-muted-foreground" />}
            </div>
            <p className={`text-2xl font-bold tabular-nums tracking-tight ${
              trend.delta < -0.05 ? 'text-emerald-400'
              : trend.delta > 0.05 ? 'text-amber-400'
              : 'text-foreground'
            }`}>
              {trend.delta > 0.05 ? '+' : trend.delta < -0.05 ? '−' : ''}
              <TickerNumber value={trend.display} /> {preferredUnit}
            </p>
            <p className="text-xs text-muted-foreground">Over {trend.days} day{trend.days !== 1 ? 's' : ''} of tracking</p>
          </div>
        ) : (
          <StatCard title="Weight Trend">
            <p className="text-sm text-muted-foreground/60 leading-snug">
              Log more weigh-ins to see the trend
            </p>
          </StatCard>
        )}
      </div>

      {/* Chart */}
      {!loading && entries.length >= 2 && <BodyweightChart entries={entries} />}

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">No weigh-ins logged yet.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map(e => (
              <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                <div className="flex items-center gap-3 px-4 py-2.5 bg-card">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <Weight className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm text-muted-foreground flex-1 whitespace-nowrap">{fmtDateFull(e.created_at)}</span>
                  <span className="text-sm font-bold tabular-nums font-mono">{e.weight}</span>
                  <span className="text-xs text-muted-foreground w-6">{e.unit}</span>
                </div>
              </SwipeDelete>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
