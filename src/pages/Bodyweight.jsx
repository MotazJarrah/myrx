import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Target, Minus, Trash2, Loader2 } from 'lucide-react'
import { TAG_STYLES } from '../lib/effortTags'
import TickerNumber from '../components/TickerNumber'
import { dataCache } from '../lib/cache'

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ title, children, delay = 0, className = '' }) {
  return (
    <div
      className={`animate-rise rounded-xl border border-border bg-card p-4 space-y-2 ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Bodyweight() {
  const { user, profile, refreshProfile } = useAuth()
  const [weight, setWeight] = useState('')
  const [unit, setUnit]     = useState(profile?.weight_unit || 'lb')
  const [confirm,  setConfirm]  = useState(null)
  const [deleting, setDeleting] = useState(false)

  const bwKey  = user ? `bodyweight:${user.id}` : null
  const [logs, setLogs] = useState(() => (bwKey && dataCache.get(bwKey)) ?? [])

  // Sync log unit with profile preference when profile loads
  useEffect(() => { if (profile?.weight_unit) setUnit(profile.weight_unit) }, [profile?.weight_unit])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bodyweight')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = data || []
        setLogs(rows)
        if (bwKey) dataCache.set(bwKey, rows)
      })
  }, [user])

  async function logWeight() {
    if (!weight || !user) return
    const { data } = await supabase
      .from('bodyweight')
      .insert({ user_id: user.id, weight: Number(weight), unit })
      .select()
      .single()
    if (!data) return

    const newLogs = [data, ...logs]
    setLogs(newLogs)
    if (bwKey) dataCache.set(bwKey, newLogs)
    setWeight('')

    // Keep profile.current_weight in sync (normalized to profile.weight_unit)
    const prefUnit  = profile?.weight_unit || 'lb'
    const weightKg  = toKg(Number(weight), unit)
    const normalized = prefUnit === 'kg'
      ? Math.round(weightKg * 10) / 10
      : Math.round((weightKg / 0.453592) * 10) / 10
    await supabase.from('profiles').update({ current_weight: normalized }).eq('id', user.id)
    refreshProfile()
  }

  async function deleteEntry(id) {
    setDeleting(id)
    const { error } = await supabase.from('bodyweight').delete().eq('id', id).eq('user_id', user.id)
    if (!error) setLogs(prev => prev.filter(l => l.id !== id))
    setDeleting(null)
    setConfirm(null)
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const preferredUnit = profile?.weight_unit || unit
  const heightM       = getHeightM(profile)

  // Source of truth: profile.current_weight (kept in sync on every log)
  // Fall back to latest log only if profile has no weight yet
  const latestLog = logs[0] ?? null
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

  // Weight trend: compare latest to log ~30 days ago (or oldest available)
  const trend = useMemo(() => {
    if (logs.length < 2) return null
    const latest        = logs[0]
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    const reference     = logs.find(l => new Date(l.created_at).getTime() <= thirtyDaysAgo) ?? logs[logs.length - 1]
    if (reference.id === latest.id) return null

    const latestKg    = toKg(latest.weight, latest.unit)
    const referenceKg = toKg(reference.weight, reference.unit)
    const deltaKg     = latestKg - referenceKg
    const deltaVal    = toDisplayUnit(Math.abs(deltaKg), preferredUnit)
    const days        = Math.round((new Date(latest.created_at) - new Date(reference.created_at)) / 86_400_000)
    return { delta: deltaKg, display: deltaVal, days }
  }, [logs, preferredUnit])

  // Chart: sorted oldest-first from logs; if no logs, use profile weight as origin dot
  const chartData = useMemo(() => {
    if (logs.length > 0) {
      return [...logs]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(l => ({
          ts:     l.created_at,
          weight: toDisplayUnit(toKg(l.weight, l.unit), preferredUnit),
        }))
    }
    // No logs yet — show a single baseline dot from the profile weight
    if (profile?.current_weight != null) {
      return [{
        ts:     user?.created_at ?? new Date().toISOString(),
        weight: toDisplayUnit(toKg(profile.current_weight, profile.weight_unit || 'lb'), preferredUnit),
      }]
    }
    return []
  }, [logs, profile, user, preferredUnit])

  const showChart = chartData.length > 0

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Bodyweight</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Track your weight and monitor body composition trends.</p>
      </div>

      {/* ── Log form ── */}
      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className={labelCls}>Weight</label>
            <input
              type="number" value={weight} placeholder="0.0"
              onChange={e => setWeight(e.target.value)}
              step="0.1" className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
              <option>lb</option>
              <option>kg</option>
            </select>
          </div>
        </div>
        <button
          onClick={logWeight}
          disabled={!weight}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Log weight
        </button>
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Current weight */}
        <StatCard title="Current Weight" delay={60}>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-400">
            {currentDisplay ? <TickerNumber value={currentDisplay} /> : '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            {latestLog
              ? `Logged ${new Date(latestLog.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              : profile?.current_weight ? 'From profile' : 'Log your first weigh-in'
            }
          </p>
        </StatCard>

        {/* BMI */}
        {bmi && bmiCat ? (
          <div
            className={`animate-rise rounded-xl border p-4 space-y-2 ${bmiCat.bg} ${bmiCat.border}`}
            style={{ animationDelay: '120ms' }}
          >
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
          <StatCard title="BMI" delay={120}>
            <p className="text-sm text-muted-foreground/60 leading-snug">
              {!latestWeightKg ? 'Log a weigh-in first' : 'Add height in profile to calculate'}
            </p>
          </StatCard>
        )}

        {/* Ideal weight range */}
        {idealMin && idealMax ? (
          <StatCard title="Ideal Weight Range" delay={180}>
            <div className="flex items-end gap-1.5">
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                <TickerNumber value={idealMin} /> – <TickerNumber value={idealMax} />
              </p>
              <p className="mb-0.5 text-sm text-muted-foreground">{preferredUnit}</p>
            </div>
            <p className="text-xs text-muted-foreground">Based on BMI 18.5 – 24.9</p>
          </StatCard>
        ) : (
          <StatCard title="Ideal Weight Range" delay={180}>
            <Target className="h-5 w-5 text-muted-foreground/30 mb-1" />
            <p className="text-xs text-muted-foreground/60">Add height in profile</p>
          </StatCard>
        )}

        {/* Weight trend */}
        {trend ? (
          <div className="animate-rise rounded-xl border border-border bg-card p-4 space-y-2" style={{ animationDelay: '240ms' }}>
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
          <StatCard title="Weight Trend" delay={240}>
            <p className="text-sm text-muted-foreground/60 leading-snug">
              Log more weigh-ins to see your trend
            </p>
          </StatCard>
        )}
      </div>

      {/* ── Progress chart ── */}
      {showChart && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">
            Progress <span className="text-muted-foreground font-normal">({preferredUnit})</span>
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis
                dataKey="ts"
                tickFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} width={40} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  color: 'hsl(var(--foreground))',
                  fontSize: 12,
                }}
                labelFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                formatter={(v) => [`${v} ${preferredUnit}`, 'Weight']}
              />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="#34d399"
                strokeWidth={2}
                dot={{ r: 4, fill: '#34d399', strokeWidth: 0 }}
                activeDot={{ r: 7, fill: '#34d399' }}
              />
            </LineChart>
          </ResponsiveContainer>
          {chartData.length === 1 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Log more weigh-ins to see your trend
            </p>
          )}
        </div>
      )}

      {/* ── Log ── */}
      {logs.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3">Log</h2>
          <div className="divide-y divide-border">
            {logs.slice(0, 30).map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2.5">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${TAG_STYLES.weighin}`}>
                    Weigh-in
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    {new Date(l.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <span className="font-mono text-sm tabular-nums font-medium shrink-0">{l.weight} {l.unit}</span>
                <div className="flex justify-end shrink-0">
                  {confirm === l.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-destructive">Delete?</span>
                      <button
                        onClick={() => deleteEntry(l.id)}
                        disabled={!!deleting}
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      >
                        {deleting === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirm(null)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:bg-accent transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirm(l.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
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
