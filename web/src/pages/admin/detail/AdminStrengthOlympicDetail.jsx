/**
 * AdminStrengthOlympicDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's OLYMPIC-LIFT strength detail screen (Layout 9).
 *
 * Covers movements whose `movements.lift_type === 'olympic'`: the snatch /
 * clean & jerk family and their power / hang / block variants + the pulls
 * (Snatch Pull, Clean Pull, High Pull). These lifts fail on TECHNIQUE and BAR
 * SPEED, not muscular fatigue, so they get NO rep-max grid and NO
 * hypertrophy/endurance zones — instead, three %-of-best intensity targets
 * (Technique 70% / Build 85% / Peak = next PR) and a "stop when the bar slows"
 * cue. (T088 Model 1 / Fix 1.2)
 *
 * Faithfully reproduces the athlete surface in:
 *   - mobile/app/(app)/effort/strength/[exercise].tsx → function OlympicLiftDetail
 *   - CLAUDE.md → "Layout 9 — Olympic / Ballistic"
 *
 * Sections, top to bottom (matching the athlete render):
 *   1. Header        — movement name + "Best — N unit" (TickerNumber) + OLYMPIC pill.
 *   2. Percentage card — "Train by percentage" heading, the 3 intensity tiles
 *                        (tap to select), the next-target hero (selected weight +
 *                        cue), and the source attribution line.
 *   3. Chart         — Recharts est-1RM-over-time line + personal-best ref line.
 *   4. Efforts log   — chronological list, per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach may
 * delete a client's efforts), mirroring the other strength mirrors.
 *
 * The barbell loadable math is inlined (all Olympic lifts are barbell) rather
 * than touching the frozen web lib — nearest-rung for technique/build, next-rung
 * above best for the peak PR.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import CueText from '../../../components/CueText'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft } from 'lucide-react'
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
// Matches the stored weighted effort `value`: "Est. 1RM 135 lb".
function parseOneRM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

// Barbell loadable math (Olympic lifts are always barbell). Mirror of mobile
// nearestLoadableWeight / nextLoadableAbove for the barbell branch.
const BAR = { lb: 45, kg: 20 }
const INC = { lb: 5, kg: 2.5 }
function nearestBarbell(raw, unit) {
  const bar = BAR[unit] ?? 45, inc = INC[unit] ?? 5
  const above = Math.max(0, raw - bar)
  return bar + Math.round(above / inc) * inc
}
function nextBarbellAbove(raw, unit) {
  const bar = BAR[unit] ?? 45, inc = INC[unit] ?? 5
  const above = Math.max(0, raw - bar)
  const next = (above % inc === 0) ? above + inc : Math.ceil(above / inc) * inc
  return bar + next
}

// Verbatim mirror of the mobile OLYMPIC_TARGETS.
const OLYMPIC_TARGETS = [
  { key: 'technique', label: 'TECHNIQUE', pct: 0.70, pctText: '70%',   repsText: '× 2-3', reps: '2-3' },
  { key: 'build',     label: 'BUILD',     pct: 0.85, pctText: '85%',   repsText: '× 1-2', reps: '1-2' },
  { key: 'peak',      label: 'PEAK',      pct: 1.00, pctText: '100%+', repsText: '× 1',   reps: '1'   },
]

// Warm-up ramp baked into the Olympic cue as prose (T088 round-2 #2) — mirror of
// the mobile olympicRamp / buildOlympicCue. Two loadable jumps at ~60% & ~80% of
// the working weight, between the empty bar and the work set (0-2 rungs).
function olympicRamp(working, unit) {
  const bar = BAR[unit] ?? 45
  const out = []
  for (const frac of [0.6, 0.8]) {
    const w = nearestBarbell(working * frac, unit)
    if (w > bar && w < working && !out.includes(w)) out.push(w)
  }
  return out
}
function buildOlympicCue(t, working, unit) {
  const ramp = olympicRamp(working, unit)
  const rampStr = ramp.length === 2 ? `${ramp[0]} and ${ramp[1]}` : ramp.length === 1 ? `${ramp[0]}` : ''
  const warm = rampStr
    ? `Warm up from the empty bar through ${rampStr} before `
    : 'Warm up from the empty bar, then '
  if (t.key === 'peak')
    return `${warm}a heavy single at ${working} ${unit}, a new PR. Make or miss, never grind it out, speed is the signal.`
  const coaching = t.key === 'technique'
    ? 'Keep it light and fast on the positions, ending each set the instant bar speed drops.'
    : 'Crisp singles and doubles, stopping the moment the bar slows.'
  return `${warm}${t.reps} reps at ${working} ${unit}, around ${t.pctText} of your best. ${coaching}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Component — props: userId (required), exercise (required), onBack (optional).
// Self-contained: fetches the client's efforts for this movement itself.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthOlympicDetail({ userId, exercise, onBack }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selKey, setSelKey]   = useState('build')

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

  // Best single — parseOneRM is valid here because Olympic lifts are logged low-rep.
  const best = useMemo(() => entries.reduce((b, e) => {
    const p = parseOneRM(e.value)
    return p && p.oneRM > (b?.oneRM ?? 0) ? p : b
  }, null), [entries])
  const unit    = best?.unit || 'lb'
  const best1RM = best?.oneRM ?? 0

  const selTarget = OLYMPIC_TARGETS.find(t => t.key === selKey) ?? OLYMPIC_TARGETS[1]
  const weightFor = (t) => {
    if (best1RM <= 0) return 0
    return t.key === 'peak' ? nextBarbellAbove(best1RM, unit) : nearestBarbell(best1RM * t.pct, unit)
  }
  const selWeight = weightFor(selTarget)

  const chartData = useMemo(() => entries
    .map(e => { const p = parseOneRM(e.value); return p ? { ts: e.created_at, date: fmtShort(e.created_at), value: p.oneRM } : null })
    .filter(Boolean), [entries])
  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const yMin   = Math.max(0, Math.round(minV * 0.9))
  const yMax   = Math.round(maxV * 1.1)
  const bestForChart = chartData.length > 1 ? best1RM : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  function renderTile(t) {
    const active = t.key === selKey
    const w = weightFor(t)
    return (
      <button
        key={t.key}
        onClick={() => setSelKey(t.key)}
        className={`flex flex-1 flex-col items-center gap-0.5 rounded-[10px] border px-1 py-2.5 transition-colors ${
          active ? 'border-blue-500/60 bg-blue-500/10' : 'border-border/40 bg-card/20 hover:bg-card/40'
        }`}
      >
        <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? 'text-blue-400' : 'text-muted-foreground'}`}>{t.label}</span>
        <span className={`font-mono text-base font-bold tabular-nums ${active ? 'text-blue-400' : 'text-foreground'}`}>{w}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{t.pctText}</span>
        <span className="text-[10px] text-muted-foreground">{t.repsText}</span>
      </button>
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
          {best1RM > 0 ? (
            <>
              <span>Best —</span>
              <TickerNumber value={best1RM} className="font-mono font-semibold text-blue-400" />
              <span>{unit}</span>
            </>
          ) : (
            <span>No efforts logged yet</span>
          )}
        </p>
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            OLYMPIC
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Percentage card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Train by percentage</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">These lifts build on bar speed, not reps.</p>

            {best1RM > 0 ? (
              <>
                <div className="mt-3 flex gap-2">
                  {OLYMPIC_TARGETS.map(renderTile)}
                </div>

                {/* Next-target hero — mirrors the athlete NextTargetCallout chrome. */}
                <div className="mt-3 flex flex-col gap-2 rounded-[9px] border border-blue-500/30 bg-blue-500/[0.08] p-4">
                  <div className="flex items-baseline gap-1.5">
                    <TickerNumber value={selWeight} className="font-mono text-3xl font-bold text-blue-400" />
                    <span className="text-sm text-muted-foreground">{unit}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{selTarget.label} · {selTarget.pctText} · {selTarget.repsText}</p>
                  <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                    <CueText className="text-sm text-muted-foreground">{buildOlympicCue(selTarget, selWeight, unit)}</CueText>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-muted-foreground">{'NSCA (Haff & Triplett) · Catalyst Athletics · velocity-based training'}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                This client hasn't logged any efforts for this movement yet.
              </p>
            )}
          </AnimateRise>

          {/* ── 3. Est-1RM chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Best lift over time</p>
              {chartData.length >= 2 ? (
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
                      formatter={(v) => [`${Math.round(v)} ${unit}`, 'Est. 1RM']}
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
              <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log (chronological, with per-effort delete) ── */}
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
                  const p = parseOneRM(e.value)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-blue-400">
                          {p ? `${p.oneRM} ${p.unit}` : '—'}
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
