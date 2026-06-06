/**
 * AdminStrengthLoadDetail — READ-ONLY (+ delete) coach mirror of the athlete's
 * LOADABLE hold detail screen (Layout 12).
 *
 * Covers isometric movements whose `movements.hold_type === 'load'`: wall sit,
 * calf-raise hold, glute-bridge holds, dead hang, split-squat hold, squat hold.
 * Build the bodyweight hold to ~60 s, THEN add external load — grinding to 2 min
 * trains endurance, not strength. Two phases: time milestones (15-60 s) → an
 * add-load progression. (T088 Model 3 — load family.)
 *
 * Mirrors mobile/app/(app)/effort/strength/[exercise].tsx → function LoadHoldDetail.
 * Read-only; per-effort delete retained. (The coach can't log — the weight input
 * lives only in the athlete's app; this view just displays the progression.)
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
import { useAuth } from '../../../contexts/AuthContext'

// ── Coach-units conversion (T093) ────────────────────────────────────────────
// The coach views a client's strength in the COACH's weight unit. The added load
// is stored/parsed in the unit the athlete logged; convert to the coach's unit
// for display ONLY. Durations (seconds) are never weights and stay untouched.
const KG_PER_LB_W = 0.453592
function convW(w, from, to) {
  if (w == null || !from || from === to) return w
  return Math.round((to === 'kg' ? w * KG_PER_LB_W : w / KG_PER_LB_W) * 10) / 10
}
// NOTE: the template's convDetail (rewrites "<n> lb/kg" inside a raw effort-detail
// string) is intentionally NOT included here — this view rebuilds its efforts-list
// rows from parsed numerics (load + formatted duration), so there's no raw
// detail string to rewrite. The numeric load is converted directly via convW;
// durations are never weights and stay as-is.

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
function parseDurationSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1], 10) : null
}
// Added weight + unit from a load-hold label: "Wall Sit · 25 lb × 45 sec".
function parseLoadHold(label) {
  const m = label?.match(/·\s*([\d.]+)\s*(lb|kg)\s*×/i)
  return m ? { weight: parseFloat(m[1]), unit: m[2].toLowerCase() } : { weight: 0, unit: null }
}

const LOAD_HOLD_BUILD_MILESTONES = [15, 30, 45, 60]   // bodyweight build-phase tiles
const LOAD_HOLD_DURATIONS = [10, 20, 30, 45, 60, 90]  // TUT tiles in the loaded phase
const LOAD_HOLD_GATE = 60
const LOAD_HOLD_TARGET_SECS = 30

// Rohmert isometric-endurance curve (verbatim mirror of mobile): fraction of a
// brief-max isometric force holdable for a given duration; scales a logged loaded
// hold to a target at any other duration. (T088 round-2 #6.)
const ROHMERT_POINTS = [[6, 1.00], [10, 0.90], [20, 0.72], [30, 0.62], [45, 0.53], [60, 0.46], [90, 0.38], [120, 0.32]]
function rohmertFactor(secs) {
  const pts = ROHMERT_POINTS
  if (secs <= pts[0][0]) return pts[0][1]
  if (secs >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) {
    if (secs <= pts[i][0]) {
      const [t0, f0] = pts[i - 1]
      const [t1, f1] = pts[i]
      return f0 + (f1 - f0) * ((secs - t0) / (t1 - t0))
    }
  }
  return pts[pts.length - 1][1]
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthLoadDetail({ userId, exercise, unitLock = null, onBack }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  // T093: the coach views a client's strength in the COACH's weight unit (via
  // useAuth), not the client's. Load-holds have no unit_lock today, but honor it
  // defensively if ever passed (strongman kg lock precedence).
  const { profile: coachProfile } = useAuth()
  const coachUnit = coachProfile?.weight_unit || 'lb'

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
    () => entries.map(e => ({ dur: parseDurationSecs(e.value) ?? 0, ...parseLoadHold(e.label) })),
    [entries]
  )
  const bestBwHold  = useMemo(() => { const bw = parsed.filter(p => p.weight === 0).map(p => p.dur); return bw.length ? Math.max(...bw) : 0 }, [parsed])
  const weighted    = useMemo(() => parsed.filter(p => p.weight > 0), [parsed])
  const hasWeighted = weighted.length > 0
  // Anchor on the heaviest loaded hold + the duration it was held for.
  const bestWeightedEffort = useMemo(
    () => (hasWeighted ? weighted.reduce((b, p) => (p.weight > b.weight ? p : b), weighted[0]) : null),
    [weighted, hasWeighted]
  )
  const bestLoad    = bestWeightedEffort?.weight ?? 0
  const bestLoadDur = (bestWeightedEffort && bestWeightedEffort.dur > 0) ? bestWeightedEffort.dur : LOAD_HOLD_TARGET_SECS
  // srcUnit = the unit the client logged in (drives all load MATH below, unchanged).
  // unit    = the coach's DISPLAY unit (T093): unit_lock → coach unit → lb.
  const srcUnit     = (parsed.find(p => p.unit)?.unit) || 'lb'
  const unit        = unitLock || coachUnit || 'lb'

  const LOAD_INC      = srcUnit === 'kg' ? 2.5 : 5
  const nextMilestone = LOAD_HOLD_BUILD_MILESTONES.find(m => m > bestBwHold) ?? null

  // Project the added weight to aim for at a given hold duration (Rohmert ratio),
  // snapped to a loadable increment, floored at 0 (= bodyweight).
  const projectedAddedFor = (secs) => {
    if (!hasWeighted) return 0
    const raw = bestLoad * (rohmertFactor(secs) / rohmertFactor(bestLoadDur))
    return Math.max(0, Math.round(raw / LOAD_INC) * LOAD_INC)
  }
  const [selLoadDur, setSelLoadDur] = useState(LOAD_HOLD_TARGET_SECS)
  const selAdded = projectedAddedFor(selLoadDur)

  const chartData = useMemo(() => (hasWeighted
    ? entries.map(e => { const lh = parseLoadHold(e.label); return lh.weight > 0 ? { ts: e.created_at, date: fmtShort(e.created_at), value: convW(lh.weight, lh.unit, unit) } : null })
    : entries.map(e => { const d = parseDurationSecs(e.value); return d !== null ? { ts: e.created_at, date: fmtShort(e.created_at), value: d } : null })
  ).filter(Boolean), [entries, hasWeighted, unit])
  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  const yMin   = Math.max(0, Math.round(minV * 0.85))
  const yMax   = Math.round(maxV * 1.15)
  const refY   = chartData.length > 1 ? (hasWeighted ? convW(bestLoad, srcUnit, unit) : bestBwHold) : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  function renderTile(sec) {
    if (!hasWeighted) {
      // Build phase: bodyweight duration achievement.
      const achieved = sec <= bestBwHold
      return (
        <div
          key={sec}
          className={`flex flex-col items-center rounded-[9px] border py-1.5 ${
            achieved ? 'border-blue-500/40 bg-blue-500/[0.08]' : 'border-border/30 bg-card/20 opacity-35'
          }`}
          style={{ width: 56 }}
        >
          <span className={`font-mono text-xs font-semibold tabular-nums ${achieved ? 'text-blue-400' : 'text-muted-foreground/40'}`}>{sec}s</span>
          <div className="mt-0.5 flex h-3 items-center justify-center">
            {achieved
              ? <Check className="h-2.5 w-2.5 text-blue-400" strokeWidth={3} />
              : <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
          </div>
        </div>
      )
    }
    // Loaded phase: projected added weight per duration; click drives the hero.
    // Math runs in srcUnit; display in the coach's unit (T093).
    const added  = convW(projectedAddedFor(sec), srcUnit, unit)
    const active = sec === selLoadDur
    return (
      <button
        key={sec}
        onClick={() => setSelLoadDur(sec)}
        className={`flex flex-col items-center gap-0.5 rounded-[9px] border py-1.5 transition-colors ${
          active ? 'border-blue-500/60 bg-blue-500/[0.12]' : 'border-border/40 bg-card/20 hover:bg-card/40'
        }`}
        style={{ width: 56 }}
      >
        <span className={`whitespace-nowrap font-mono text-[11px] tabular-nums ${active ? 'text-blue-400' : 'text-muted-foreground'}`}>{fmtDuration(sec)}</span>
        <span className={`whitespace-nowrap font-mono text-[13px] font-bold tabular-nums ${active ? 'text-blue-400' : 'text-foreground'}`}>{added > 0 ? `+${added}` : 'BW'}</span>
      </button>
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
          {hasWeighted ? (
            <><span>Best —</span><TickerNumber value={convW(bestLoad, srcUnit, unit)} className="font-mono font-semibold text-blue-400" /><span>{unit}</span></>
          ) : bestBwHold > 0 ? (
            <><span>Best —</span><TickerNumber value={fmtDurationLong(bestBwHold)} className="font-mono font-semibold text-blue-400" /></>
          ) : (
            <span>No efforts logged yet</span>
          )}
        </p>
        <div className="mt-1.5">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            LOADABLE HOLD
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Hold card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">{hasWeighted ? 'Load targets by hold time' : 'Build the hold'}</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {hasWeighted
                ? 'Hold heavier for short sets, lighter for long ones. Tap a duration to see its target.'
                : 'Build a clean 60 s bodyweight hold first; past that, longer just trains endurance — add load instead.'}
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {(hasWeighted ? LOAD_HOLD_DURATIONS : LOAD_HOLD_BUILD_MILESTONES).map(renderTile)}
            </div>

            {/* Hero */}
            <div className="mt-3 flex flex-col gap-2 rounded-[9px] border border-blue-500/30 bg-blue-500/[0.08] p-4">
              {hasWeighted ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    {selAdded > 0 ? (
                      <><TickerNumber value={convW(selAdded, srcUnit, unit)} className="font-mono text-3xl font-bold text-blue-400" /><span className="text-sm text-muted-foreground">{unit} added</span></>
                    ) : (
                      <span className="text-2xl font-bold text-blue-400">Bodyweight</span>
                    )}
                  </div>
                  <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                    <CueText>{selAdded > 0
                      ? `Hold ${selLoadDur < 60 ? `${selLoadDur} sec` : fmtDurationLong(selLoadDur)} with ${convW(selAdded, srcUnit, unit)} ${unit} added, then add ${convW(LOAD_INC, srcUnit, unit)} ${unit} once you hold it clean.`
                      : `Hold ${selLoadDur < 60 ? `${selLoadDur} sec` : fmtDurationLong(selLoadDur)} at bodyweight — at that duration bodyweight alone is the work.`}</CueText>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <TickerNumber value={nextMilestone ?? LOAD_HOLD_GATE} className="font-mono text-3xl font-bold text-blue-400" />
                    <span className="text-sm text-muted-foreground">seconds</span>
                  </div>
                  <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                    <CueText>{`Hold a clean ${nextMilestone ?? LOAD_HOLD_GATE}s, build to ${LOAD_HOLD_GATE}s, then start adding load.`}</CueText>
                  </div>
                </>
              )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">{'Rohmert isometric-endurance curve · Oranchuk 2019 · ACSM'}</p>
          </AnimateRise>

          {/* ── 3. Chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">{hasWeighted ? 'Load over time' : 'Hold time over time'}</p>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickCount={4} tickFormatter={(v) => hasWeighted ? `${Math.round(v)}` : fmtDuration(Math.round(v))} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => [hasWeighted ? `${Math.round(v)} ${unit}` : fmtDurationLong(Math.round(v)), hasWeighted ? 'Load' : 'Hold time']}
                    />
                    {refY && <ReferenceLine y={refY} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />}
                    <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive animationDuration={900} animationEasing="ease-in-out" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">Log a second effort to see the trend.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">{hasWeighted ? 'Dashed line = heaviest hold' : 'Dashed line = personal best'}</p>
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
                  const { weight: w, unit: wUnit } = parseLoadHold(e.label)
                  // Convert the logged added-load to the coach's display unit (T093).
                  // Durations (fmtDuration / fmtDurationLong) are not weights — kept as-is.
                  const wDisp = convW(w, wUnit, unit)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-blue-400">
                          {w > 0 ? `${wDisp} ${unit} × ${fmtDuration(secs ?? 0)}` : fmtDurationLong(secs)}
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
