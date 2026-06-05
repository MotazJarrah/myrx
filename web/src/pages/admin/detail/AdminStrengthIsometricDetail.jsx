/**
 * AdminStrengthIsometricDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's ISOMETRIC strength detail screen.
 *
 * Covers movements whose `movements.strength_type === 'isometric'`:
 *   Plank Hold · Wall Sit · Side Plank · L-sit · Hollow Hold · Glute Bridge
 *   Hold · Superman Hold · Handstand Hold · Active Hang · etc. — any hold
 *   measured in seconds of unbroken hold time (not reps or weight).
 *
 * This faithfully reproduces the athlete surface defined in:
 *   - CLAUDE.md → "Isometric detail card — locked design spec"
 *   - mobile/app/(app)/effort/strength/[exercise].tsx → function IsometricDetail
 *
 * Sections, top to bottom (matching the athlete — verified against the ACTUAL
 * mobile IsometricDetail render, not the CLAUDE.md spec which describes an
 * older design):
 *   1. Header        — movement name + "Personal best — N" (TickerNumber on the
 *                      mixed min/sec string, ALWAYS shown — "0 sec" when empty)
 *                      + BODYWEIGHT category pill + the current PHASE pill, both
 *                      static status chips stacked under the subtitle.
 *   2. Milestone card — "Hold time milestones" heading, then the 3-6-3 milestone
 *                      grid (10s…120s, display-only), then the greyed-out caption,
 *                      then the "Your next training target" hero (titled, no
 *                      min-height) with the mixed min/sec TickerNumber format +
 *                      cue line, OR the all-cleared trophy state.
 *                      NOTE: the athlete card has NO phase pill and NO info panel
 *                      inside it — the phase chip lives ONLY in the header. Do not
 *                      re-add an in-card pill/info panel (that was the stale-spec
 *                      mistake this mirror was fixed to avoid).
 *   3. Chart         — Recharts hold-time-over-time line + personal-best ref line
 *   4. Efforts log   — chronological list, with per-effort DELETE kept (SwipeDelete)
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts), mirroring AdminStrengthWeightedDetail.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the math is re-implemented inline:
 * web/src/lib/formulas.js does NOT contain any isometric milestone/phase logic
 * (it's a rep-max + pace + plate library). The athlete's isometric surface uses
 * a small set of pure helpers (ISO_MILESTONES, ISO_PHASE_CONFIG, the duration
 * formatters, parseDurationSecs) that live only in the mobile screen file.
 * Rather than touch the frozen web lib, every needed piece is reproduced here
 * verbatim from mobile/app/(app)/effort/strength/[exercise].tsx so the
 * displayed milestones, phases, next-target and cue match the athlete exactly.
 *
 * Web substitutions for athlete (RN) constructs:
 *   - Reanimated/Skia chart      → Recharts LineChart (same as weighted mirror).
 *   - <BackButton>               → inline back <button> (same as weighted mirror).
 *   - The phase pill is a STATIC, non-interactive status badge on the athlete
 *     (it sits in the header, NOT in the milestone card) — reproduced here as a
 *     plain stacked chip with no tap behaviour and no info panel.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import CueText from '../../../components/CueText'
import { ArrowLeft, Trophy, Check } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Duration formatters (verbatim mirror of mobile fmtDuration / fmtDurationLong) ──
// fmtDuration → compact tile labels: "30s", "1m", "1m 10s".
function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}
// fmtDurationLong → spoken-form: "30 sec", "1 min", "1 min 10 sec". Used in the
// header subtitle, the cue line, and each log row's right-hand value.
function fmtDurationLong(secs) {
  if (!secs) return '0 sec'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s} sec`
  if (s === 0) return `${m} min`
  return `${m} min ${s} sec`
}

// ── Isometric milestones / phases (verbatim mirror of mobile) ─────────────────
// Locked in CLAUDE.md "Isometric detail card — locked design spec". Single
// milestone set for ALL isometric movements; capped at 2 min because past that
// you're testing pain tolerance, not strength (McGill, Behm & Colado, Stronger
// By Science). The 12 milestones are partitioned into three proficiency phases
// by hold time: ≤30 s = STABILITY, 30-90 s = DURABILITY, 90 s+ = MASTERY.
const ISO_MILESTONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

const ISO_PHASE_CONFIG = {
  stability: {
    label:   'STABILITY PHASE',
    tiles:   [10, 20, 30],
    whyText: 'Short max-effort holds train your biggest motor units to fire harder and faster. The adaptation is neural — you build raw isometric force without much time-under-tension.',
  },
  durability: {
    label:   'DURABILITY PHASE',
    tiles:   [40, 50, 60, 70, 80, 90],
    whyText: 'Mid-range holds put your muscles and connective tissue under sustained tension. The adaptation is endurance and stiffness — the sweet spot for everyday stability and athletic transfer.',
  },
  mastery: {
    label:   'MASTERY PHASE',
    tiles:   [100, 110, 120],
    whyText: "Long holds train connective-tissue endurance and mental fortitude. Returns diminish past 2 min — beyond that you're testing pain tolerance, not strength.",
  },
}

// Phase classification is a pure function of the user's best hold time.
function isoPhaseForBest(bestSecs) {
  if (bestSecs >= 90) return 'mastery'
  if (bestSecs >= 30) return 'durability'
  return 'stability'
}

// ── Misc helpers ──────────────────────────────────────────────────────────────
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

// Matches the stored isometric effort `value` shape: "45 sec" (mirror of mobile
// parseDurationSecs — the athlete saves `value: "${durSecs} sec"`).
function parseDurationSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1], 10) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props (all optional except userId + exercise):
//   userId    (string, required) — client's auth user id
//   exercise  (string, required) — movement name, e.g. "Plank Hold"
//   onBack    (fn)               — optional custom back handler. Defaults to
//                                  returning to the client's detail page.
//
// Self-contained: fetches the client's efforts for this movement itself, so
// wiring is just <AdminStrengthIsometricDetail userId exercise />. No movement
// row / profile fetch is needed — isometric progression is purely seconds of
// hold time and uses no unit, equipment, or bodyweight.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthIsometricDetail({ userId, exercise, onBack }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  // ── Load efforts ─────────────────────────────────────────────────────────────
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

  // ── Best hold time (max across all logged efforts) ───────────────────────────
  const durations = useMemo(
    () => entries.map(e => parseDurationSecs(e.value)).filter(s => s !== null),
    [entries]
  )
  const bestSecs      = durations.length > 0 ? Math.max(...durations) : 0
  const nextMilestone = ISO_MILESTONES.find(m => m > bestSecs) ?? null
  const allCleared    = bestSecs >= ISO_MILESTONES[ISO_MILESTONES.length - 1]
  const currentPhase  = isoPhaseForBest(bestSecs)
  const phaseCfg      = ISO_PHASE_CONFIG[currentPhase]

  const hasData = entries.length > 0

  // ── Chart data — hold time over time ─────────────────────────────────────────
  const chartData = useMemo(() => entries
    .map(e => {
      const secs = parseDurationSecs(e.value)
      return secs !== null ? { ts: e.created_at, date: fmtShort(e.created_at), value: secs } : null
    })
    .filter(Boolean), [entries])

  const values   = chartData.map(d => d.value)
  const minV     = values.length ? Math.min(...values) : 0
  const maxV     = values.length ? Math.max(...values) : 10
  // yDomain mirrors the athlete: min = max(0, round(mn * 0.85)), max = round(mx * 1.15).
  const yMin     = Math.max(0, Math.round(minV * 0.85))
  const yMax     = Math.round(maxV * 1.15)
  const bestForChart = chartData.length > 1 ? bestSecs : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // Tile renderer — display-only status indicator. Achieved (≤ bestSecs) →
  // blue chrome + check; locked → greyed em-dash. Mirrors the athlete tile.
  function renderTile(ms) {
    const achieved = ms <= bestSecs
    return (
      <div
        key={ms}
        className={`flex flex-col items-center rounded-[9px] border px-0.5 py-1.5 ${
          achieved
            ? 'border-blue-500/40 bg-blue-500/[0.08]'
            : 'border-border/30 bg-card/20 opacity-35'
        }`}
        style={{ width: 48 }}
      >
        <span
          className={`whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums ${
            achieved ? 'text-blue-400' : 'text-muted-foreground/40'
          }`}
        >
          {fmtDuration(ms)}
        </span>
        <div className="mt-0.5 flex h-3 items-center justify-center">
          {achieved
            ? <Check className="h-2.5 w-2.5 text-blue-400" strokeWidth={3} />
            : <span className="font-mono text-[10px] text-muted-foreground/40">—</span>}
        </div>
      </div>
    )
  }

  // Mixed min/sec next-target hero. Display logic (verbatim from athlete):
  //   < 60 s        → big "[N] seconds"
  //   exact minute  → big "[M] minute(s)"
  //   mixed (>60 s) → big "[M] min(s) [S] sec"
  // Each numeric segment keeps its own TickerNumber so the slot-machine fires
  // when bestSecs advances past a milestone.
  function renderNextTarget() {
    const nm = nextMilestone ?? 0
    const mm = Math.floor(nm / 60)
    const ss = nm % 60
    return (
      <>
        {mm === 0 ? (
          <div className="flex items-baseline gap-1.5">
            <TickerNumber value={nm} className="font-mono text-3xl font-bold text-blue-400" />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <TickerNumber value={mm} className="font-mono text-3xl font-bold text-blue-400" />
              <span className="text-sm text-muted-foreground">{mm === 1 ? 'minute' : 'minutes'}</span>
            </div>
            {ss > 0 && (
              <div className="flex items-baseline gap-1.5">
                <TickerNumber value={ss} className="font-mono text-3xl font-bold text-blue-400" />
                <span className="text-sm text-muted-foreground">seconds</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
          <CueText>{`Hold for ${nm < 60 ? `${nm} seconds` : fmtDurationLong(nm)} without breaking form`}</CueText>
        </div>
      </>
    )
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

      {/* ── 1. Header ──
          Mirrors the athlete exactly: the "Personal best —" subtitle and BOTH
          status chips (BODYWEIGHT + phase) render unconditionally. When the
          client has no efforts, fmtDurationLong(0) → "0 sec" and the phase
          resolves to STABILITY — same as the athlete's empty state. */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
          <span>Personal best —</span>
          <TickerNumber value={fmtDurationLong(bestSecs)} className="font-mono font-semibold text-blue-400" />
        </p>
        {/* Stacked status pills: BODYWEIGHT category + current phase. Both are
            static, non-interactive badges (the athlete's phase chip lives here
            in the header, NOT inside the milestone card). */}
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            BODYWEIGHT
          </span>
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            {phaseCfg.label}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !hasData ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            This client hasn't logged any efforts for this movement yet.
          </p>
        </AnimateRise>
      ) : (
        <>
          {/* ── 2. Milestone card ──
              The athlete card is exactly: heading → 3-6-3 grid → caption →
              "Your next training target" hero. NO phase pill and NO info panel
              inside the card (the phase chip is a header-only status badge). */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Hold time milestones</h2>

            {/* 3-6-3 milestone grid, rows centered. Tiles are display-only —
                a status visualisation, not navigation. */}
            <div className="mt-3 flex flex-col gap-1">
              <div className="flex justify-center gap-1">
                {ISO_PHASE_CONFIG.stability.tiles.map(renderTile)}
              </div>
              <div className="flex justify-center gap-1">
                {ISO_PHASE_CONFIG.durability.tiles.map(renderTile)}
              </div>
              <div className="flex justify-center gap-1">
                {ISO_PHASE_CONFIG.mastery.tiles.map(renderTile)}
              </div>
            </div>

            {/* Next-target hero (or all-cleared trophy). Mirrors the athlete's
                NextTargetCallout: blue chrome + uppercase title, NO min-height
                (the iso callout deliberately uses the base style with no
                weighted modifier, so it sizes to its content). */}
            <div className="mt-3 flex flex-col gap-2 rounded-[9px] border border-blue-500/30 bg-blue-500/[0.08] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-blue-400">
                Your next training target
              </p>
              {allCleared ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Trophy className="h-7 w-7 text-blue-400" strokeWidth={2} />
                  <p className="text-sm font-medium text-foreground">All milestones cleared</p>
                </div>
              ) : (
                renderNextTarget()
              )}
            </div>
          </AnimateRise>

          {/* ── 3. Hold-time chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Hold time over time</p>
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
                      tickFormatter={(v) => fmtDuration(Math.round(v))}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [fmtDurationLong(Math.round(v)), 'Hold time']}
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
