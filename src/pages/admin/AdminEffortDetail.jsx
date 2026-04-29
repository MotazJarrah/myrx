/**
 * Admin effort detail — strength or cardio
 * Route: /admin/user/:userId/effort/:kind/:slug
 * slug = exercise/activity name (groups all entries for that name)
 */
import { useState, useEffect } from 'react'
import { useParams, useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { projectAllRMs } from '../../lib/formulas'
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function parseOneRM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

function parsePaceSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\/km$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

function parseDurationSecs(value) {
  if (!value) return null
  const parts = value.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

// ── Confirm delete ────────────────────────────────────────────────────────────

function ConfirmDelete({ onConfirm, onCancel, busy }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-destructive">Delete?</span>
      <button onClick={onConfirm} disabled={busy}
        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
      </button>
      <button onClick={onCancel} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:bg-accent">
        No
      </button>
    </div>
  )
}

// ── Rep-max grid (mirrors StrengthDetail) ─────────────────────────────────────

const RM_LABELS = ['1RM','2RM','3RM','4RM','5RM','6RM','7RM','8RM','9RM','10RM']

function RMGrid({ oneRM, unit }) {
  const projections = projectAllRMs(oneRM, 1)
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground mb-3">Rep-max projections · % of 1RM</p>
      <div className="grid grid-cols-5 gap-2">
        {projections.map(({ reps, weight }, i) => {
          const pct = Math.round((weight / oneRM) * 100)
          return (
            <div
              key={reps}
              className={`flex flex-col items-center rounded-lg border py-2.5 px-1 ${
                i === 0
                  ? 'border-blue-500/40 bg-blue-500/10'
                  : 'border-border bg-muted/20'
              }`}
            >
              <span className={`text-[10px] font-semibold ${i === 0 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                {RM_LABELS[i]}
              </span>
              <span className={`text-sm font-bold tabular-nums mt-0.5 ${i === 0 ? 'text-blue-400' : 'text-foreground'}`}>
                {weight}
              </span>
              <span className="text-[9px] text-muted-foreground">{unit}</span>
              <span className={`text-[9px] tabular-nums mt-0.5 leading-none ${i === 0 ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminEffortDetail() {
  const { userId, kind, slug } = useParams()
  const [, navigate] = useLocation()
  const exercise = decodeURIComponent(slug || '')

  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [confirm,  setConfirm]  = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', kind)
        .ilike('label', `${exercise} · %`)
        .order('created_at', { ascending: true })
      setEntries(data || [])
      setLoading(false)
    }
    load()
  }, [userId, kind, exercise])

  async function deleteEntry(id) {
    setDeleting(id)
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
    setConfirm(null)
  }

  // ── Compute best 1RM for strength ────────────────────────────────────────
  const bestRM = kind === 'strength'
    ? entries.reduce((best, e) => {
        const parsed = parseOneRM(e.value)
        if (!parsed) return best
        return parsed.oneRM > best.val ? { val: parsed.oneRM, unit: parsed.unit } : best
      }, { val: 0, unit: 'lb' })
    : null

  // ── Chart data ───────────────────────────────────────────────────────────
  const chartData = entries.map(e => {
    if (kind === 'strength') {
      const parsed = parseOneRM(e.value)
      if (!parsed) return null
      return { ts: e.created_at, date: fmtShort(e.created_at), value: parsed.oneRM, unit: parsed.unit }
    }
    // cardio: pace or duration
    const paceSecs = parsePaceSecs(e.value)
    if (paceSecs != null) {
      return { ts: e.created_at, date: fmtShort(e.created_at), value: paceSecs, unit: '/km' }
    }
    const durSecs = parseDurationSecs(e.value)
    if (durSecs != null) {
      return { ts: e.created_at, date: fmtShort(e.created_at), value: durSecs, unit: 'sec' }
    }
    return null
  }).filter(Boolean)

  const values  = chartData.map(d => d.value)
  const minV    = values.length > 0 ? Math.min(...values) : 0
  const maxV    = values.length > 0 ? Math.max(...values) : 10
  const pad     = (maxV - minV) * 0.15 || 1
  const yUnit   = chartData[0]?.unit ?? ''
  const chartLabel = kind === 'strength' ? 'Est. 1RM' : (yUnit === '/km' ? 'Pace' : 'Duration')

  // Best 1RM reference line for chart
  const bestForChart = kind === 'strength' && bestRM?.val > 0 ? bestRM.val : null

  const isStrength = kind === 'strength'
  const isCardio   = kind === 'cardio'

  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={() => {
          localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
          navigate(`/admin/user/${userId}`)
        }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">{exercise}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground capitalize">
            {kind} · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        {isStrength && bestRM && bestRM.val > 0 && (
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold tabular-nums text-blue-400">{bestRM.val}</p>
            <p className="text-xs text-muted-foreground">{bestRM.unit} · Best 1RM</p>
          </div>
        )}
      </div>

      {/* 1RM projection grid (strength only) */}
      {!loading && isStrength && bestRM && bestRM.val > 0 && (
        <RMGrid oneRM={bestRM.val} unit={bestRM.unit} />
      )}

      {/* Chart */}
      {!loading && chartData.length >= 2 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-3">{chartLabel} over time</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[minV - pad, maxV + pad]}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [`${v} ${yUnit}`, chartLabel]}
              />
              {bestForChart && (
                <ReferenceLine
                  y={bestForChart}
                  stroke="#60a5fa"
                  strokeDasharray="4 3"
                  strokeOpacity={0.5}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={isStrength ? '#60a5fa' : '#fbbf24'}
                strokeWidth={2}
                dot={{ r: 3, fill: isStrength ? '#60a5fa' : '#fbbf24', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={true}
                animationDuration={900}
                animationEasing="ease-in-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Entry list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          No entries found.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {[...entries].reverse().map(e => {
              // Strip exercise name from display label
              const detail = e.label.split(' · ').slice(1).join(' · ')
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{detail || e.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                  </div>
                  {isStrength && parseOneRM(e.value) && (
                    <span className="text-xs font-semibold text-blue-400 tabular-nums shrink-0">
                      {parseOneRM(e.value).oneRM} {parseOneRM(e.value).unit} 1RM
                    </span>
                  )}
                  {isCardio && e.value && (
                    <span className="text-xs font-semibold text-amber-400 tabular-nums shrink-0">
                      {e.value}
                    </span>
                  )}
                  {confirm === e.id ? (
                    <ConfirmDelete
                      onConfirm={() => deleteEntry(e.id)}
                      onCancel={() => setConfirm(null)}
                      busy={deleting === e.id}
                    />
                  ) : (
                    <button onClick={() => setConfirm(e.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
