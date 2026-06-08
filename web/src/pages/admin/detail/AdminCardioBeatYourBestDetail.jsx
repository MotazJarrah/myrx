/**
 * AdminCardioBeatYourBestDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's "Beat Your Best" cardio detail surface (L9 simple-progression,
 * locked May 19 2026).
 *
 * Covers the cardio activities where the app can't honestly anchor on
 * scientifically-validated zone coaching (no HR, no power telemetry, no
 * canonical training methodology):
 *
 *   • Cycling (outdoor)   — pace confounded by wind / gradient / drafting;
 *                            the cycling community programs by power (FTP),
 *                            which we don't have.
 *   • Stationary Bike     — "distance" is fake (cadence × assumed resistance,
 *                            varies by machine model).
 *   • Elliptical          — fake distance, no canonical methodology.
 *
 * For these the right model is "beat your best time at this distance" — honest
 * about what manual-logging data supports, sidesteps the false precision of
 * zone prescriptions we can't validate.
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - mobile/app/(app)/effort/cardio/[activity].tsx → BeatYourBestDetail
 *     (around line 2842) + isBeatYourBestActivity / BEAT_YOUR_BEST_CATEGORIES
 *     (around line 382) + categorizeActivity (around line 317)
 *   - CLAUDE.md → "Beat-Your-Best" locked notes (Cycling / Stationary Bike /
 *     Elliptical)
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header     — activity name + "Best 1k — m:ss" (TickerNumber, Riegel-
 *                   projected 1 km time) + category pill (CYCLING / ELLIPTICAL)
 *   2. Goals card — five stacked canonical-distance rows (500 m / 1 km / 3 km /
 *                   5 km / 10 km), each showing Best + Aim-for time + push
 *                   delta. Tappable "PROGRESSION" info pill (the WHY).
 *   3. Chart      — Recharts pace-over-time, Y-axis REVERSED so faster pace
 *                   renders at the top (line trends UP as the client improves —
 *                   NO "lower = better" copy, per the locked chart-direction
 *                   rule). Dashed reference line = the client's fastest pace.
 *   4. Efforts log — chronological list, per-effort DELETE kept (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach is
 * allowed to delete a client's efforts).
 *
 * Cardio uses an AMBER accent (amber-400 / amber-500), NOT the strength blue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * the athlete's parse / pace / Riegel helpers live in the mobile file (and the
 * web AdminCardioDetail re-derives its own simpler versions). Rather than couple
 * to either, every needed piece is reproduced here verbatim from the mobile
 * BeatYourBestDetail so the projections match the athlete exactly (canonical
 * distances, Riegel exponent 1.06, push-delta = max(2, 0.5 %)).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Time / pace helpers (verbatim mirror of mobile BeatYourBestDetail deps) ──

const KM_PER_MI = 1.60934

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs) {
  if (totalSecs == null) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceTick(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceStr(secsPerKm, distUnit = 'km') {
  if (distUnit === 'mi') {
    const secsPerMi = secsPerKm * KM_PER_MI
    const m = Math.floor(secsPerMi / 60)
    const s = Math.round(secsPerMi % 60)
    return `${m}:${String(s).padStart(2, '0')}/mi`
  }
  const m = Math.floor(secsPerKm / 60)
  const s = Math.round(secsPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

// Stored pace strings are always seconds-per-km ("4:54/km"). Convert at display
// time for a mi-preference client (mirrors mobile convertStoredPace).
function convertStoredPace(storedPaceStr, distUnit) {
  if (!storedPaceStr) return '—'
  if (distUnit !== 'mi') return storedPaceStr
  const m = storedPaceStr.match(/^(\d+):(\d{2})\//)
  if (!m) return storedPaceStr
  const secsPerKm = parseInt(m[1]) * 60 + parseInt(m[2])
  return fmtPaceStr(secsPerKm, 'mi')
}

function parsePaceToSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Parse the effort label's "<dist> <unit> in <time>" tail into { distKm,
// timeSecs }. Mirror of mobile parseEffortLabel (km / mi forms — the only
// shapes these three activities log; swim m/yd forms aren't reachable here).
function parseEffortLabel(label) {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * KM_PER_MI, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  return null
}

// ── Riegel pace normalization for the chart (Push 2, June 2026) ───────────────
// Plotting each effort's RAW pace dips the line when efforts span different
// distances (a longer/harder effort logs a slower raw pace). Project every effort
// to a common anchor distance via Riegel's law and plot the equivalent pace, so
// the line reflects true fitness. Mirrors the athlete chart fix exactly. Ergs use
// the 2 km test distance; everything else 5 km.
const PACE_CHART_ANCHOR_KM = { 'Row Erg': 2, 'Bike Erg': 2, 'Ski Erg': 2 }
function paceChartAnchorKm(activity) {
  return PACE_CHART_ANCHOR_KM[activity] ?? 5
}
function riegelNormalizedPaceSecsPerKm(effort, anchorKm) {
  const p = parseEffortLabel(effort.label)
  if (!p || p.distKm <= 0 || p.timeSecs == null || p.timeSecs <= 0) return null
  return (p.timeSecs * (anchorKm / p.distKm) ** 1.06) / anchorKm
}

// ── Canonical distances + Beat-Your-Best dispatch predicate ───────────────────

// The 5-row goal card distances (km). Same set across all three Beat-Your-Best
// activities — locked May 19 2026. Globally-recognised race / interval
// distances; per-row time targets come from Riegel-projecting EVERY logged
// effort to each distance and taking the minimum.
const CANONICAL_DISTANCES_KM = [0.5, 1, 3, 5, 10]

function fmtCanonicalDistance(distKm) {
  // Always render the canonical distance in its natural form, regardless of
  // the client's unit preference (500 m / 1 km / 3 km / 5 km / 10 km are
  // globally-recognised; converting to ugly mi values would obscure that).
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`
  return `${distKm} km`
}

// Activity categorization → Beat-Your-Best membership. Verbatim mirror of the
// mobile regex chain (categorizeActivity + BEAT_YOUR_BEST_CATEGORIES) trimmed
// to just the branches that can resolve to a Beat-Your-Best category. The
// dispatcher in AdminEffortDetail decides whether to route here with the same
// membership test — kept UN-exported so this file only exports the component
// (react-refresh / Fast-Refresh requirement; see AdminStrengthWeightedDetail's
// WEIGHTED_STANDARD_EQUIPMENT for the same convention).
//
//   • elliptical              → 'elliptical'
//   • spin/stationary/        → 'stationary_bike'
//     recumbent/bike erg
//   • cycl/bike               → 'cycling'
// (swim / ski erg / row erg / air bike / rucking / stair are filtered out
//  ABOVE these in the mobile chain, so they never reach a BYB category — they
//  return false here too.)
// eslint-disable-next-line no-unused-vars -- dispatch predicate kept for the wiring step
function isAdminCardioBeatYourBestActivity(activityName) {
  if (!activityName) return false
  const lower = activityName.toLowerCase()
  if (/swim/.test(lower))                                return false
  if (/ski erg/.test(lower))                             return false
  if (/row erg/.test(lower))                             return false
  if (/air bike|assault bike|airdyne/.test(lower))       return false
  if (/spin|stationary|recumbent|bike erg/.test(lower))  return true   // stationary_bike
  if (/ellipt/.test(lower))                              return true   // elliptical
  if (/cycl|bike/.test(lower))                           return true   // cycling
  return false
}

// Category pill label — mirror of mobile cardioCategoryPillLabel for the three
// Beat-Your-Best activities (Cycling → CYCLING, Stationary Bike → CYCLING,
// Bike Erg → CYCLING [not routed here], Elliptical → ELLIPTICAL).
function cardioCategoryPillLabel(activity) {
  if (!activity) return 'CARDIO'
  const lower = activity.toLowerCase()
  if (lower.includes('elliptical')) return 'ELLIPTICAL'
  if (/cycl|bike/.test(lower))      return 'CYCLING'
  return 'CARDIO'
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId   (string, required) — client's auth user id
//   activity (string, required) — cardio movement name, e.g. "Cycling"
//   onBack   (fn, optional)     — custom back handler. Defaults to returning to
//                                  the client's detail page (activity tab).
//
// Self-contained: fetches the client's efforts for this activity. Distance unit
// follows the COACH's profile (T093), so wiring is just
// <AdminCardioBeatYourBestDetail userId activity />.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioBeatYourBestDetail({ userId, activity, onBack }) {
  // T093: the coach views a client's cardio in the COACH's units, not the client's.
  const { profile: coachProfile } = useAuth()
  const distUnit = coachProfile?.distance_unit || 'km'
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)

  // ── Load efforts ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const efRes = await supabase
        .from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .eq('type', 'cardio')
        .ilike('label', `${activity} ·%`)
        .order('created_at', { ascending: true })
      if (cancelled) return
      setEfforts(efRes.data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId, activity])

  async function deleteEntry(id) {
    const { error } = await supabase.from('efforts').delete().eq('id', id)
    if (!error) setEfforts(prev => prev.filter(e => e.id !== id))
    else throw error
  }

  // ── Best pace overall (header subtitle anchor + chart reference line) ───────
  const { bestPaceSecs, hasBestPace } = useMemo(() => {
    let best = Infinity
    efforts.forEach(e => {
      const secs = parsePaceToSecs(e.value)
      if (secs !== null && secs < best) best = secs
    })
    return { bestPaceSecs: best, hasBestPace: best > 0 && best !== Infinity }
  }, [efforts])

  // ── Per-canonical-distance targets via Riegel projection ────────────────────
  //
  // For each canonical distance D, project every logged effort (d, t) to an
  // equivalent time at D using Riegel's law:  T_D = t × (D / d)^1.06
  //
  // Take MIN across all efforts — the client's best demonstrated ability at D.
  // Because every effort gets projected to every canonical distance, a 4.9 km
  // and a 5.1 km effort both contribute to the 5 km row with near-identical
  // projected times (Riegel's exponent is close to 1 for nearby distances), so
  // no explicit tolerance/bucketing is needed.
  //
  // Push delta scales with distance — sec-floor of 2 / proportional 0.5 % above.
  // A 500 m row gets a ~2 sec push, a 10 km row gets ~20 sec.
  const distanceTargets = useMemo(() => {
    return CANONICAL_DISTANCES_KM.map(D => {
      let bestProjectedSecs = Infinity
      for (const e of efforts) {
        const p = parseEffortLabel(e.label)
        if (!p || p.distKm <= 0 || p.timeSecs == null || p.timeSecs <= 0) continue
        const projected = p.timeSecs * (D / p.distKm) ** 1.06
        if (projected < bestProjectedSecs) bestProjectedSecs = projected
      }
      if (bestProjectedSecs === Infinity) {
        return { distanceKm: D, bestSecs: null, nextSecs: null, pushSecs: 0 }
      }
      const bestRounded = Math.round(bestProjectedSecs)
      const push = Math.max(2, Math.round(bestRounded * 0.005))
      const nextRounded = Math.max(1, bestRounded - push)
      return { distanceKm: D, bestSecs: bestRounded, nextSecs: nextRounded, pushSecs: push }
    })
  }, [efforts])

  // ── Chart data — pace over time, Riegel-normalized to a standard distance so
  //    a longer (harder) effort doesn't read as a false drop (Push 2). Mirrors
  //    the athlete chart. Y-axis is REVERSED in the chart props so faster pace
  //    renders at the TOP; the line trends UP as the client improves. No
  //    "lower is better" caption — the visual speaks for itself. Header "Best"
  //    + efforts list stay on the raw pace. ──
  const chartAnchorKm = paceChartAnchorKm(activity)
  const chartData = useMemo(() => efforts
    .map(e => {
      const secs = riegelNormalizedPaceSecsPerKm(e, chartAnchorKm) ?? parsePaceToSecs(e.value)
      if (secs === null) return null
      return { date: new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), secs }
    })
    .filter(Boolean), [efforts, chartAnchorKm])
  // Dashed PB = best normalized pace plotted (lowest secs), so it sits on the points.
  const chartBestSecs = chartData.length ? Math.min(...chartData.map(d => d.secs)) : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* ── 1. Header — h1 + "Best 1k" subtitle (Riegel-projected 1 km time, so
              it never disagrees with the 1 km goal row) + category pill. ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{activity}</h1>
        {distanceTargets[1]?.bestSecs != null ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best 1k —</span>
            <TickerNumber
              value={fmtSecs(distanceTargets[1].bestSecs)}
              className="font-mono font-semibold text-amber-400"
            />
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
          {cardioCategoryPillLabel(activity)}
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : efforts.length === 0 ? (
        <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            This client hasn't logged any sessions for this activity yet.
          </p>
        </AnimateRise>
      ) : (
        <>
          {/* ── 2. Goals card — five canonical-distance rows ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Your goals</h2>
              <button
                onClick={() => setInfoOpen(o => !o)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5"
              >
                <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  PROGRESSION
                </span>
                <Info className="h-3 w-3 text-amber-400" />
              </button>
            </div>

            {/* Inline "why this works" info panel (the WHY of the approach —
                static intent copy, not formula / per-user numbers). */}
            {infoOpen && (
              <div className="mt-1 rounded-md border border-amber-500/15 bg-card/60 px-2.5 py-2">
                <p className="mb-1 text-xs font-bold text-foreground">Beat your best</p>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  The simplest form of progression — go a little faster than your best at each
                  canonical distance, every time you train. Small consistent improvements compound.
                  Each row shows what to chase next.
                </p>
              </div>
            )}

            <div className="mt-3 space-y-1.5">
              {distanceTargets.map(t => (
                <div
                  key={t.distanceKm}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2.5"
                >
                  <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                    {fmtCanonicalDistance(t.distanceKm)}
                  </span>
                  {t.bestSecs != null && t.nextSecs != null ? (
                    <div className="flex flex-wrap items-baseline justify-end gap-x-1.5 gap-y-0.5">
                      <span className="text-[11px] text-muted-foreground">Best</span>
                      <TickerNumber value={fmtSecs(t.bestSecs)} className="font-mono font-bold text-amber-400" />
                      <span className="ml-1 text-[11px] text-muted-foreground">Aim for</span>
                      <TickerNumber value={fmtSecs(t.nextSecs)} className="font-mono font-bold text-amber-400" />
                      <span className="ml-1 font-mono text-[11px] tabular-nums text-amber-400/70">
                        ↓ {t.pushSecs}s
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              ))}
            </div>
          </AnimateRise>

          {/* ── 3. Pace-over-time chart (Y reversed → faster pace at top, line
                  trends UP as the client improves; NO "lower=better" copy) ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Pace over time</p>
              {chartData.length >= 1 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      reversed
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={fmtPaceTick}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [fmtPaceStr(v, distUnit), 'Pace']}
                    />
                    {chartBestSecs != null && (
                      <ReferenceLine y={chartBestSecs} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="secs"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#fbbf24', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-in-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Log a second session to see the trend.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Dashed = personal best · pace shown as {chartAnchorKm} km-equivalent (Riegel) so longer efforts compare fairly
              </p>
            </AnimateRise>
          )}
        </>
      )}

      {/* ── 4. Efforts log (chronological, with per-effort delete) ── */}
      {!loading && (
        <AnimateRise delay={500}>
          {efforts.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No entries found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">All entries</h2>
              </div>
              <div className="divide-y divide-border">
                {[...efforts].reverse().map(e => {
                  const detail = e.label.split(' · ').slice(1).join(' · ')
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{detail || e.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(e.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-amber-400">
                          {convertStoredPace(e.value, distUnit)}
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
