/**
 * AdminStrengthLeverageDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's LEVERAGE / SKILL hold detail screen (Layout 11).
 *
 * Covers isometric movements whose `movements.hold_type === 'leverage'`: planche,
 * front/back lever, human flag, L-sit, V-sit, handstand, headstand, crow, dip/ring
 * support, pike compression. These fail on LEVERAGE, not endurance — a full planche
 * maxes at ~10-20 s, so the 10-120 s time grid + 2-min cap is meaningless. Instead:
 * short milestones (5-30 s) + a SKILL LADDER — hold the current variant clean for
 * 30 s, then progress to the next harder variant (tuck → straddle → full). Standalone
 * holds just chase the 30 s "mastered" mark. (T088 Model 3 — leverage family.)
 *
 * Mirrors mobile/app/(app)/effort/strength/[exercise].tsx → function LeverageHoldDetail.
 * Read-only; per-effort delete retained (the coach may delete a client's efforts).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Trophy, Check } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Duration formatters (verbatim mirror of mobile) ───────────────────────────
function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60), s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}
function fmtDurationLong(secs) {
  if (!secs) return '0 sec'
  const m = Math.floor(secs / 60), s = secs % 60
  if (m === 0) return `${s} sec`
  if (s === 0) return `${m} min`
  return `${m} min ${s} sec`
}
function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
// Isometric efforts store value as "45 sec".
function parseDurationSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1], 10) : null
}

// ── Leverage progression (verbatim mirror of mobile) ──────────────────────────
const LEVERAGE_MILESTONES = [5, 10, 15, 20, 30]
const LEVERAGE_GATE = 30
const LEVERAGE_LADDERS = [
  ['Planche Hold (Tuck)', 'Planche Hold (Straddle)', 'Planche Hold'],
  ['Front Lever Hold (Tuck)', 'Front Lever Hold'],
  ['Back Lever Hold (Tuck)', 'Back Lever Hold'],
  ['Handstand Hold (Wall)', 'Handstand Hold (Freestanding)'],
]
function leverageLadderFor(name) {
  for (const l of LEVERAGE_LADDERS) if (l.includes(name)) return l
  return null
}
function leverageVariantLabel(name) {
  const m = name.match(/\(([^)]+)\)/)
  return m ? m[1] : 'Full'
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthLeverageDetail({ userId, exercise, onBack }) {
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

  const durations = useMemo(
    () => entries.map(e => parseDurationSecs(e.value)).filter(x => x !== null),
    [entries]
  )
  const bestSecs    = durations.length ? Math.max(...durations) : 0
  const ladder      = leverageLadderFor(exercise)
  const ladderIdx   = ladder ? ladder.indexOf(exercise) : -1
  const nextVariant = ladder && ladderIdx >= 0 && ladderIdx < ladder.length - 1 ? ladder[ladderIdx + 1] : null
  const gateReached = bestSecs >= LEVERAGE_GATE
  const nextMilestone = LEVERAGE_MILESTONES.find(m => m > bestSecs) ?? null

  const chartData = useMemo(() => entries
    .map(e => { const x = parseDurationSecs(e.value); return x !== null ? { ts: e.created_at, date: fmtShort(e.created_at), value: x } : null })
    .filter(Boolean), [entries])
  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const yMin   = Math.max(0, Math.round(minV * 0.85))
  const yMax   = Math.round(maxV * 1.15)
  const bestForChart = chartData.length > 1 ? bestSecs : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  function renderTile(sec) {
    const achieved = sec <= bestSecs
    return (
      <div
        key={sec}
        className={`flex flex-col items-center rounded-[9px] border py-1.5 ${
          achieved ? 'border-blue-500/40 bg-blue-500/[0.08]' : 'border-border/30 bg-card/20 opacity-35'
        }`}
        style={{ width: 52 }}
      >
        <span className={`font-mono text-[11px] font-semibold tabular-nums ${achieved ? 'text-blue-400' : 'text-muted-foreground/40'}`}>{sec}s</span>
        <div className="mt-0.5 flex h-3 items-center justify-center">
          {achieved
            ? <Check className="h-2.5 w-2.5 text-blue-400" strokeWidth={3} />
            : <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
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
          {bestSecs > 0 ? (
            <>
              <span>Best —</span>
              <TickerNumber value={fmtDurationLong(bestSecs)} className="font-mono font-semibold text-blue-400" />
            </>
          ) : (
            <span>No efforts logged yet</span>
          )}
        </p>
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            SKILL
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Skill card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Hold the position</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">A skill, not an endurance test — short clean holds, then a harder variant.</p>

            {/* Skill ladder (only when harder variants exist) */}
            {ladder && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {ladder.map((v, i) => {
                  const isCurrent = v === exercise
                  return (
                    <div key={v} className="flex items-center gap-1.5">
                      <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                        isCurrent ? 'border-blue-500 bg-blue-500/15 text-blue-400' : 'border-border/40 bg-card/20 text-muted-foreground'
                      }`}>
                        {leverageVariantLabel(v)}
                      </span>
                      {i < ladder.length - 1 && <span className="text-xs text-muted-foreground/50">→</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Milestone tiles */}
            <div className="mt-3 flex justify-center gap-1.5">
              {LEVERAGE_MILESTONES.map(renderTile)}
            </div>

            {/* Hero */}
            <div className="mt-3 flex flex-col gap-2 rounded-[9px] border border-blue-500/30 bg-blue-500/[0.08] p-4">
              {gateReached ? (
                <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                  <Trophy className="h-6 w-6 text-blue-400" strokeWidth={2} />
                  <p className="text-sm font-semibold text-foreground">
                    {nextVariant ? `Ready for ${leverageVariantLabel(nextVariant)}` : 'Skill mastered'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {nextVariant
                      ? `Can hold a clean ${LEVERAGE_GATE}s, log a ${nextVariant} effort to progress`
                      : `Holding ${LEVERAGE_GATE}s+ clean, keep it sharp or chase a harder skill`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <TickerNumber value={nextMilestone ?? LEVERAGE_GATE} className="font-mono text-3xl font-bold text-blue-400" />
                    <span className="text-sm text-muted-foreground">seconds</span>
                  </div>
                  <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                    <p className="text-sm text-muted-foreground">
                      Hold a clean <span className="font-mono font-semibold text-foreground">{nextMilestone ?? LEVERAGE_GATE}s</span>
                      {nextVariant
                        ? <>, then at <span className="font-mono font-semibold text-foreground">{LEVERAGE_GATE}s</span> clean progress to {leverageVariantLabel(nextVariant)}.</>
                        : <>, building to a solid <span className="font-mono font-semibold text-foreground">{LEVERAGE_GATE}s</span>.</>}
                    </p>
                  </div>
                </>
              )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">{'Gymnastics leverage progression · GMB · Steven Low (Overcoming Gravity)'}</p>
          </AnimateRise>

          {/* ── 3. Hold-time chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Hold time over time</p>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickCount={4} tickFormatter={(v) => fmtDuration(Math.round(v))} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => [fmtDurationLong(Math.round(v)), 'Hold time']}
                    />
                    {bestForChart && <ReferenceLine y={bestForChart} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />}
                    <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive animationDuration={900} animationEasing="ease-in-out" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">Log a second effort to see the trend.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
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
                  const secs = parseDurationSecs(e.value)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-blue-400">
                          {fmtDurationLong(secs)}
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
