/**
 * AdminStrengthBallisticDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's BALLISTIC KETTLEBELL detail screen (Layout 10).
 *
 * Covers movements whose `movements.lift_type === 'ballistic'`: the kettlebell
 * swing / snatch / clean / jerk / push-press / high-pull family + their double-
 * and single-arm variants. These are trained for high-power reps at a given bell,
 * NOT a 1-rep max — so NO rep-max grid. Progression is a BELL LADDER: own a bell
 * at a clean rep volume, then size up. (T088 Model 1 / Fix 1.2b)
 *
 * Faithfully reproduces the athlete surface in:
 *   - mobile/app/(app)/effort/strength/[exercise].tsx → function BallisticLiftDetail
 *   - CLAUDE.md → "Layout 10 — Ballistic"
 *
 * Sections: 1. Header (name + Best — N unit + BALLISTIC pill) · 2. "Move up the
 * bells" card (bell-ladder strip + next-bell hero + cue + attribution) ·
 * 3. bell-weight-over-time chart · 4. efforts log (read-only + per-effort delete).
 *
 * Math inlined (kettlebell ladder + label parse) rather than touching the frozen
 * web lib. Kettlebell ladder mirrors mobile EQUIPMENT_LADDERS.kettlebell.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import CueText from '../../../components/CueText'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Check } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Helpers ─────────────────────────────────────────────────────────────────
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
// Parse "Name · 24 kg × 20" → { weight: 24, unit: 'kg', reps: 20 }.
function parseBell(label) {
  const m = label?.match(/·\s*(\d+(?:\.\d+)?)\s*(kg|lb)\s*[×x]\s*(\d+)/i)
  if (!m) return null
  return { weight: parseFloat(m[1]), unit: m[2].toLowerCase(), reps: parseInt(m[3], 10) }
}

// Kettlebell ladder — verbatim mirror of mobile EQUIPMENT_LADDERS.kettlebell.
const KETTLEBELL_LADDER = {
  kg: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48],
  lb: [9, 18, 26, 35, 44, 53, 62, 70, 80, 88, 97, 106],
}
function nextBellAbove(bell, unit) {
  const ladder = KETTLEBELL_LADDER[unit] ?? KETTLEBELL_LADDER.kg
  for (const w of ladder) if (w > bell) return w
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Component — props: userId (required), exercise (required), onBack (optional).
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthBallisticDetail({ userId, exercise, onBack }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', 'strength')
        .ilike('label', `${exercise} · %`)
        .order('created_at', { ascending: true })
      if (cancelled) return
      setEntries(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, exercise])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  const parsed = useMemo(
    () => entries.map(e => { const b = parseBell(e.label); return b ? { ts: e.created_at, ...b } : null }).filter(Boolean),
    [entries]
  )
  const unit     = (parsed.length ? parsed[parsed.length - 1].unit : 'kg')
  const bestBell = parsed.length ? Math.max(...parsed.map(p => p.weight)) : 0
  const ladder   = KETTLEBELL_LADDER[unit] ?? KETTLEBELL_LADDER.kg
  const targetBell = nextBellAbove(bestBell, unit) ?? bestBell
  // Top-of-ladder state — no broken "move up to {same bell}" (T088 round-2 #3).
  const atTopBell  = bestBell > 0 && nextBellAbove(bestBell, unit) == null
  // Benchmark text carries NO attribution (round-2 #3); credit is on its own line.
  const benchmark = /swing/i.test(exercise)  ? 'Benchmark: 100 swings in 5 min.'
    : /snatch/i.test(exercise) ? 'Benchmark: 100 snatches in 5 min.'
    : null
  // 100-in-5-min standard is set at the 24-32 kg test bell; hide it past that.
  const benchmarkApplies = benchmark != null && bestBell > 0 && bestBell <= (unit === 'kg' ? 32 : 70)

  const chartData = useMemo(
    () => parsed.map(p => ({ ts: p.ts, date: fmtShort(p.ts), value: p.weight })),
    [parsed]
  )
  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const yMin   = Math.max(0, Math.round(minV * 0.9))
  const yMax   = Math.round(maxV * 1.1)
  const bestForChart = chartData.length > 1 ? bestBell : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  function renderBell(kg) {
    const achieved = kg <= bestBell
    const isTarget = kg === targetBell && kg > bestBell
    return (
      <div
        key={kg}
        className={`flex shrink-0 flex-col items-center gap-0.5 rounded-[9px] border px-2 py-2 ${
          isTarget ? 'border-blue-500 bg-blue-500/15'
            : achieved ? 'border-blue-500/40 bg-blue-500/[0.08]'
              : 'border-border/30 bg-card/20 opacity-40'
        }`}
        style={{ minWidth: 56 }}
      >
        <span className={`font-mono text-sm font-bold tabular-nums ${(achieved || isTarget) ? 'text-blue-400' : 'text-muted-foreground'}`}>{kg}</span>
        <div className="flex h-3 items-center justify-center">
          {achieved
            ? <Check className="h-2.5 w-2.5 text-blue-400" strokeWidth={3} />
            : isTarget
              ? <span className="text-[9px] font-bold text-blue-400">NEXT</span>
              : <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* ── 1. Header ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
          {bestBell > 0 ? (
            <>
              <span>Best —</span>
              <TickerNumber value={bestBell} className="font-mono font-semibold text-blue-400" />
              <span>{unit}</span>
            </>
          ) : (
            <span>No efforts logged yet</span>
          )}
        </p>
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            BALLISTIC
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. "Move up the bells" card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Move up the bells</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Trained on power, not a 1-rep max — own a bell, then size up.</p>

            {bestBell > 0 ? (
              <>
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {ladder.map(renderBell)}
                </div>

                <div className="mt-3 flex flex-col gap-2 rounded-[9px] border border-blue-500/30 bg-blue-500/[0.08] p-4">
                  {atTopBell ? (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <TickerNumber value={bestBell} className="font-mono text-3xl font-bold text-blue-400" />
                        <span className="text-sm text-muted-foreground">{unit} — top bell</span>
                      </div>
                      <div className="mt-2.5 flex flex-col gap-1 border-t border-blue-500/15 pt-2.5">
                        <CueText>{`On the heaviest bell, so keep the sets explosive (5–10 powerful reps), resting at least as long as each set takes.`}</CueText>
                        {benchmarkApplies && <p className="text-[11px] text-muted-foreground">{benchmark}</p>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <TickerNumber value={targetBell} className="font-mono text-3xl font-bold text-blue-400" />
                        <span className="text-sm text-muted-foreground">{unit} — next bell</span>
                      </div>
                      <div className="mt-2.5 flex flex-col gap-1 border-t border-blue-500/15 pt-2.5">
                        <CueText>{`Train the ${bestBell} ${unit} bell in explosive sets of 5–10, resting at least as long as each set takes. Own ~100 clean reps, then move up to ${targetBell} ${unit}.`}</CueText>
                        {benchmarkApplies && <p className="text-[11px] text-muted-foreground">{benchmark}</p>}
                      </div>
                    </>
                  )}
                </div>

                <p className="mt-2 text-[11px] text-muted-foreground">{'StrongFirst · Simple & Sinister (Pavel) · RKC/SFG snatch test'}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                This client hasn't logged any efforts for this movement yet.
              </p>
            )}
          </AnimateRise>

          {/* ── 3. Bell-weight chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Bell weight over time</p>
              {chartData.length >= 1 ? (
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
                      domain={[yMin, yMax]}
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
                      formatter={(v) => [`${Math.round(v)} ${unit}`, 'Bell']}
                    />
                    {bestForChart && (
                      <ReferenceLine y={bestForChart} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-in-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Log a second effort to see the trend.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = heaviest bell</p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No efforts found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const b = parseBell(e.label)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-blue-400">
                          {b ? `${b.weight} ${b.unit} × ${b.reps}` : '—'}
                        </span>
                      </div>
                    </SwipeDelete>
                  )
                })}
              </div>
            </div>
          )}
        </AnimateRise>
      )}
    </div>
  )
}
