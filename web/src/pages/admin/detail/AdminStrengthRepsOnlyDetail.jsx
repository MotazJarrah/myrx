/**
 * AdminStrengthRepsOnlyDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's REPS-ONLY (band / knee / band+knee assisted) strength detail.
 *
 * Covers NON-bodyweight movements logged with an assist suffix:
 *   "<Name> [Band]"         · <bandLevel> × <reps>
 *   "<Name> [Knee]"         · <reps> reps
 *   "<Name> [Band + Knee]"  · <bandLevel> × <reps>
 *
 * These are the "rep-only" assisted edge cases the athlete routes to
 * `RepsOnlyDetail` in mobile/app/(app)/effort/strength/[exercise].tsx
 * (around line 3707). For TRUE bodyweight movements (Pull-Up / Dip / Chin-Up
 * family) the same suffixes route through the consolidated bodyweight page
 * instead — this file is ONLY for movements whose BASE-name `movements.equipment`
 * is NOT 'bodyweight'. The dispatcher decides that; see the wiring notes
 * returned with this task.
 *
 * Sections, top to bottom (matching the athlete's RepsOnlyDetail):
 *   1. Header      — base movement name + "<assist label> · Best — N reps"
 *                    (TickerNumber) + STRENGTH category pill
 *   2. Progress    — "Personal best" hero: big bestReps (TickerNumber) + a
 *                    static progression hint line
 *   3. Chart       — Recharts reps-over-time line + personal-best reference line
 *   4. Efforts log — chronological list, per-effort DELETE kept (SwipeDelete);
 *                    band level chip on the left, reps on the right
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * Mirrors AdminStrengthWeightedDetail.jsx conventions exactly: self-fetch of
 * efforts + profile, SwipeDelete per effort, TickerNumber on the big number +
 * "Best — N reps" subtitle, AnimateRise cascade (0 / 250 / 500), Recharts
 * (NOT Skia), Tailwind tokens only (hex only on Recharts strokes), lucide
 * icons, blue strength accent, category pill.
 *
 * Simplifications vs. the athlete (faithful to the read-only goal):
 *   - No swipe / gesture choreography (web reads, doesn't gesture).
 *   - No band-level sub-progression auto-advance logic — that lives on the
 *     bodyweight consolidated page; this rep-only edge case just shows the
 *     overall best reps + the per-effort band chip, exactly like the athlete's
 *     RepsOnlyDetail (which itself only tracks `bestReps = max(reps)`).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Assist-type derivation from the exercise name suffix ─────────────────────
// Mirror of mobile's `assistType` dispatch (lines 4311-4313 of [exercise].tsx).
// Longest suffix first so " [Band + Knee]" wins over " [Band]".
function assistTypeFromName(name) {
  if (name?.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name?.endsWith(' [Knee]'))        return 'knee'
  if (name?.endsWith(' [Band]'))        return 'band'
  return 'band'   // sensible default; the dispatcher only routes suffixed names here
}

// Base movement name with the assist suffix stripped (for the header h1).
function stripAssistSuffix(name) {
  return (name || '')
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
}

// ── Label parsers (verbatim logic mirror of the athlete) ─────────────────────
// Band / Band+Knee labels read "<Name> [Band] · <level> × <reps>" so reps come
// after the "×". Knee labels read "<Name> [Knee] · <reps> reps".
function parseRepsOnlyFromLabel(label, isBand) {
  if (isBand) {
    const m = label?.match(/×\s*(\d+)/)
    return m ? parseInt(m[1], 10) : null
  }
  const m = label?.match(/·\s*(\d+)\s*reps/)
  return m ? parseInt(m[1], 10) : null
}

// Band level (e.g. "Heavy", "Extra Heavy", "Light") parsed out of a band /
// band+knee label. Knee-only labels have no band level → null.
function parseBandLevelFromLabel(label) {
  const m = label?.match(/\[Band(?:\s*\+\s*Knee)?\]\s*·\s*([\w\s]+?)\s*×/)
  return m ? m[1].trim() : null
}

// ── Misc helpers (match AdminStrengthWeightedDetail) ─────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId      (string, required) — client's auth user id
//   exercise    (string, required) — suffixed movement name, e.g.
//                                     "Pull Up [Band]" / "Dip [Knee]"
//   assistType  ('band'|'knee'|'band+knee', optional) — derived from the
//                                     exercise suffix when omitted.
//   onBack      (fn, optional)      — custom back handler. Defaults to
//                                     returning to the client's detail page.
//
// Self-contained: fetches efforts (filtered to the suffixed movement) + the
// client's profile unit (unused for math but kept for parity with the weighted
// mirror's fetch shape). Wiring is just:
//   <AdminStrengthRepsOnlyDetail userId exercise assistType={...} />
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthRepsOnlyDetail({
  userId,
  exercise,
  assistType: assistTypeProp,
  onBack,
}) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  // Assist type: prop wins (dispatcher passes it from the suffix), else derive.
  const assistType = assistTypeProp ?? assistTypeFromName(exercise)
  const isBand     = assistType !== 'knee'    // band + band+knee both use "× N" labels

  const baseName = stripAssistSuffix(exercise)

  const assistLabel =
    assistType === 'band+knee' ? 'Band + Knee assisted'
    : assistType === 'knee'    ? 'Knee assisted'
                               : 'Band assisted'

  // Static progression hint (mirror of the athlete's `hintText`).
  const hintText =
    assistType === 'band+knee'
      ? 'Progress by using lighter bands and removing knee assist one step at a time'
      : assistType === 'knee'
        ? 'Build strength in the knee-assisted position to progress to full reps'
        : 'Work towards unassisted reps by progressively using lighter bands'

  // ── Load efforts (suffixed movement only) + profile ──────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [efRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'strength')
          .ilike('label', `${exercise} · %`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('weight_unit')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setEntries(efRes.data || [])
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

  // ── Parsed efforts → best reps + chart series ────────────────────────────────
  const parsed = useMemo(() => entries
    .map(e => {
      const reps = parseRepsOnlyFromLabel(e.label, isBand)
      return reps !== null
        ? { reps, bandLevel: isBand ? parseBandLevelFromLabel(e.label) : null, ts: e.created_at, id: e.id }
        : null
    })
    .filter(Boolean), [entries, isBand])

  const bestReps = parsed.length > 0 ? Math.max(...parsed.map(p => p.reps)) : 0

  const chartData = useMemo(
    () => parsed.map(p => ({ ts: p.ts, date: fmtShort(p.ts), value: p.reps })),
    [parsed]
  )
  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  // Mirror the athlete's yDomain: min clamps to >= 0 (mn - 1), max = mx + 2.
  const yMin   = Math.max(0, minV - 1)
  const yMax   = maxV + 2
  const bestForChart = chartData.length > 1 ? bestReps : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
        <h1 className="text-xl font-bold tracking-tight">{baseName}</h1>
        {bestReps > 0 ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>{assistLabel} · Best —</span>
            <TickerNumber value={bestReps} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">reps</span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">{assistLabel} · No efforts logged yet</p>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : bestReps <= 0 ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            This client hasn't logged any efforts for this movement yet.
          </p>
        </AnimateRise>
      ) : (
        <>
          {/* ── 2. Progress hero card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Progress</h2>

            <div
              className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] p-4"
              style={{ minHeight: 140 }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">
                Personal best
              </p>
              <div className="mt-1 flex items-baseline gap-1">
                <TickerNumber value={bestReps} className="font-mono text-3xl font-bold text-blue-400" />
                <span className="text-blue-400">reps</span>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{hintText}</p>
            </div>
          </AnimateRise>

          {/* ── 3. Reps-over-time chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold">Reps over time</h2>
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
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${v}`, 'Reps']}
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
              <div className="border-b border-border px-5 py-3.5">
                <h2 className="text-sm font-bold">Efforts history</h2>
              </div>
              <div className="divide-y divide-border">
                {[...entries].reverse().map(e => {
                  const reps      = parseRepsOnlyFromLabel(e.label, isBand)
                  const bandLevel = isBand ? parseBandLevelFromLabel(e.label) : null
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          {bandLevel && (
                            <p className="truncate text-sm font-medium">{bandLevel} band</p>
                          )}
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">reps</span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-blue-400">
                            {reps ?? '—'}
                          </span>
                        </div>
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
