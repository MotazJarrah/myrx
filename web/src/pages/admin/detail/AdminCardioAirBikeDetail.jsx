/**
 * AdminCardioAirBikeDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's AIR BIKE cardio detail screen.
 *
 * Covers the single cardio activity "Air Bike" (Assault / Echo / Rogue /
 * Schwinn Airdyne fan-resistance bikes). Air bike training is programmed in
 * CALORIES, not distance/pace — so this surface is fundamentally different
 * from the generic pace/duration cardio detail. The user's training anchor is
 * their peak CAL/MIN rate; everything else (zone targets, estimated rep
 * times) derives from it.
 *
 * Faithfully reproduces the athlete surface defined in:
 *   - CLAUDE.md → "Air Bike detail card — locked design spec"
 *   - mobile/app/(app)/effort/cardio/[activity].tsx → AirBikeDetail (~line 3333)
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header   — "Air Bike" h1 + "Best — N cal/min" (TickerNumber) or the
 *                 cold-start estimate line + AIR BIKE category pill (amber)
 *   2. Plan card — zone pill row (SPRINT / THRESHOLD / AEROBIC, hardest-first,
 *                 click chevrons/pill to switch) + tappable info panel +
 *                 2-row hero (work cals / est time) + cue  [watts overlay removed — T088]
 *   3. Chart    — Recharts cal/min-over-time line + personal-best reference.
 *                 Y-axis NOT reversed (higher rate = better = line trends UP).
 *   4. Efforts log — chronological list, per-effort DELETE kept (SwipeDelete),
 *                 each row shows the derived cal/min rate on the right.
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach
 * is allowed to delete a client's efforts).
 *
 * Cardio is AMBER end-to-end (amber-400 / amber-500), mirroring CardioDetail —
 * strength uses blue, cardio uses amber. No blue chrome anywhere here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * The web lib does not export the air-bike helpers (parseAirBikeLabel,
 * calsPerMinFromEffort, calsPerMinToWatts, genderBaselineCalsPerMin), nor the
 * AIR_BIKE_ZONE_CONFIG / buildAirBikeZoneRx / getAirBikeZoneCue logic — those
 * live in mobile (mobile/src/lib/movements.ts + the AirBikeDetail component).
 * Rather than mutate the frozen web lib, every needed piece is reproduced here
 * verbatim from the mobile source so the projections match the athlete exactly.
 *
 * Mobile→web simplifications (no behavioural change):
 *   - Skia LineChart → Recharts (the established web admin chart lib).
 *   - Reanimated `Gesture.Pan` swipe pill + AmberAnimatedChevron → plain
 *     clickable double-chevron buttons + a static centered pill (same as the
 *     blue weighted-standard web mirror, recolored amber). No physical slide.
 *   - TickerNumber is the web component (slot-machine WAAPI digits); it tickers
 *     the digits inside mixed strings like "8 × 9 cal" / "≥ 313 W" / "5:00".
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import CueText from '../../../components/CueText'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ═══════════════════════════════════════════════════════════════════════════
// Air-bike formulas (verbatim mirror of mobile/src/lib/movements.ts)
// ═══════════════════════════════════════════════════════════════════════════

const AIR_BIKE_ACTIVITY = 'Air Bike'

/**
 * Baseline cal/min rate for users who haven't logged an air bike effort yet
 * (cold start). Gender-scaled because cal accumulation is power-dependent
 * (watts) and men generate more power on average. Once the user logs any
 * effort, their actual peak rate replaces this baseline.
 *
 * NOTE: mirrors the LIVE mobile code, which returns 18 (male) / 13 (else).
 * The CLAUDE.md spec text mentions a 15 cal/min "other/unset" branch, but the
 * shipped `genderBaselineCalsPerMin` collapses non-male to 13 — we match the
 * code so the coach view shows the same numbers the athlete sees.
 */
function genderBaselineCalsPerMin(gender) {
  return gender === 'male' ? 18 : 13
}

/**
 * Parse a cal-mode effort label "Air Bike · 50 cal in 5:00" → { cals, timeSecs }.
 * Returns null for labels that don't match the air-bike format.
 */
function parseAirBikeLabel(label) {
  if (!label) return null
  const part = label.split(' · ')[1] ?? ''
  const m = part.match(/^(\d+)\s*cal\s+in\s+(\d+):(\d{2}(?::\d{2})?)$/)
  if (!m) return null
  const cals = parseInt(m[1], 10)
  const timeStr = `${m[2]}:${m[3]}`
  const timeParts = timeStr.split(':').map(Number)
  let timeSecs = null
  if (timeParts.length === 3) timeSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
  else if (timeParts.length === 2) timeSecs = timeParts[0] * 60 + timeParts[1]
  return { cals, timeSecs }
}

/** cal/min rate from a single effort. Returns 0 for invalid input. */
function calsPerMinFromEffort(cals, timeSecs) {
  if (!cals || !timeSecs || timeSecs <= 0) return 0
  return cals / (timeSecs / 60)
}

// ── Time formatter (mirror of mobile fmtSecs — m:ss / h:mm:ss) ───────────────
function fmtSecs(totalSecs) {
  if (!totalSecs && totalSecs !== 0) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Adaptation zones (verbatim mirror of mobile AIR_BIKE_ZONE_CONFIG)
// SPRINT → THRESHOLD → AEROBIC, hardest-first per the carousel rule (Pattern 4).
// ═══════════════════════════════════════════════════════════════════════════

const AIR_BIKE_ZONE_ORDER = ['sprint', 'threshold', 'aerobic']

const AIR_BIKE_ZONE_CONFIG = Object.freeze({
  sprint: {
    label:       'SPRINT',
    whyText:
      'Max-effort calorie sprints with full recovery. Builds peak power output and trains the body to clear lactate during all-out work. The bread and butter of air bike training — Tabata-style intervals, EMOM cal sprints, and famous benchmark tests like the 100-cal time trial. 1–2 sessions per week with full recovery between.',
    durationMin: 0.5,   // ~30 sec per rep at peak intensity
    intensity:   1.0,   // 100 % of peak rate
    reps:        8,
    restSecs:    45,
  },
  threshold: {
    label:       'THRESHOLD',
    whyText:
      'Sustained hard intervals at the edge of what you can hold. Trains lactate clearance and the ability to maintain high output past the burn. Longer intervals than sprint, less rest. The most productive zone for improving the cal/min rate that anchors every other prescription.',
    durationMin: 1.0,   // ~1 min per rep
    intensity:   0.85,  // 85 % of peak rate
    reps:        5,
    restSecs:    30,
  },
  aerobic: {
    label:       'AEROBIC',
    whyText:
      "Steady continuous ride at a comfortable pace — conversational on dry land. Builds the aerobic engine that supports the harder zones. Air bike doesn't really do 'easy' (fan resistance is exponential), but the lowest-intensity work the machine handles still has training value as recovery + base.",
    durationMin: 5.0,   // ~5 min continuous
    intensity:   0.65,  // 65 % of peak rate
    reps:        1,
    restSecs:    0,
  },
})

/**
 * Build a zone prescription from the user's peak cal/min rate. Verbatim mirror
 * of mobile `buildAirBikeZoneRx`:
 *   calsPerRep         = peakRate × durationMin × intensity, ≥ 1, rounded
 *   estimatedSecsPerRep = (calsPerRep / (peakRate × intensity)) × 60, rounded
 *   shortWork          = "N × X cal" (intervals) or "X cal" (continuous)
 */
function buildAirBikeZoneRx(zone, peakCalsPerMin) {
  const cfg = AIR_BIKE_ZONE_CONFIG[zone]
  const rawCals    = peakCalsPerMin * cfg.durationMin * cfg.intensity
  const calsPerRep = Math.max(1, Math.round(rawCals))
  const estimatedSecsPerRep = Math.round((calsPerRep / (peakCalsPerMin * cfg.intensity)) * 60)
  const shortWork  = cfg.reps > 1 ? `${cfg.reps} × ${calsPerRep} cal` : `${calsPerRep} cal`
  return { calsPerRep, estimatedSecsPerRep, reps: cfg.reps, restSecs: cfg.restSecs, shortWork }
}

/** Single coaching cue for the active zone (verbatim mirror of mobile). */
function getAirBikeZoneCue(zone, rx) {
  const cfg = AIR_BIKE_ZONE_CONFIG[zone]
  if (cfg.reps === 1) {
    return `Pedal ${rx.calsPerRep} cals at a steady aerobic effort, about ${Math.round(cfg.durationMin)} min total.`
  }
  if (zone === 'sprint') {
    return `Sprint ${rx.calsPerRep} cals as fast as you can. Rest ${rx.restSecs} sec, repeat ${rx.reps} times. Each interval should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
  }
  // threshold
  return `Hold ${rx.calsPerRep} cals at a sustained hard pace. Rest ${rx.restSecs} sec, repeat ${rx.reps} times. Each interval should take about ${fmtSecs(rx.estimatedSecsPerRep)}.`
}

// ── Misc date helpers ─────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props:
//   userId   (string, required) — client's auth user id
//   activity (string)           — activity name. Defaults to "Air Bike"; the
//                                 dispatcher passes it through for symmetry with
//                                 the other admin detail mirrors.
//   onBack   (fn)               — optional custom back handler. Defaults to
//                                 returning to the client's detail page.
//
// Self-contained: fetches the client's Air Bike efforts + the client's
// profile.gender (needed for the cold-start cal/min baseline) itself.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminCardioAirBikeDetail({
  userId,
  activity = AIR_BIKE_ACTIVITY,
  onBack,
}) {
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [gender, setGender]   = useState(null)

  // Zone selection state. Default = SPRINT (slot 0, hardest-first) per the
  // universal "always open on slot 0" landing rule (Pattern 4).
  const [selectedZone, setSelectedZone] = useState(AIR_BIKE_ZONE_ORDER[0])
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  // ── Load efforts + profile gender ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [efRes, profRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'cardio')
          .ilike('label', `${activity} ·%`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('gender')
          .eq('id', userId)
          .maybeSingle(),
      ])
      if (cancelled) return
      setEfforts(efRes.data || [])
      setGender(profRes.data?.gender ?? null)
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

  // ── Peak cal/min rate across all efforts (the athlete's training anchor) ───
  const peakCalsPerMin = useMemo(() => {
    let peak = 0
    for (const e of efforts) {
      const parsed = parseAirBikeLabel(e.label)
      if (!parsed || !parsed.timeSecs) continue
      const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
      if (rate > peak) peak = rate
    }
    return peak
  }, [efforts])

  // Cold-start: gender-aware baseline until the first effort lands.
  const baselineCalsPerMin = useMemo(() => genderBaselineCalsPerMin(gender), [gender])
  const effectiveRate = peakCalsPerMin > 0 ? peakCalsPerMin : baselineCalsPerMin
  const hasLoggedRate = peakCalsPerMin > 0

  // ── Active-zone prescription + cue ─────────────────────────────────────────
  const selectedCfg = AIR_BIKE_ZONE_CONFIG[selectedZone]
  const selectedRx  = useMemo(
    () => buildAirBikeZoneRx(selectedZone, effectiveRate),
    [selectedZone, effectiveRate],
  )
  const selectedCue = useMemo(
    () => getAirBikeZoneCue(selectedZone, selectedRx),
    [selectedZone, selectedRx],
  )

  // ── Zone navigation (click chevrons / pill). Mirrors the carousel order;
  //    chevrons only render on the side where another zone exists. ───────────
  const zoneIdx   = AIR_BIKE_ZONE_ORDER.indexOf(selectedZone)
  const canGoPrev = zoneIdx > 0
  const canGoNext = zoneIdx >= 0 && zoneIdx < AIR_BIKE_ZONE_ORDER.length - 1

  function navigateZone(dir) {
    const target = zoneIdx + dir
    if (target < 0 || target >= AIR_BIKE_ZONE_ORDER.length) return
    setSelectedZone(AIR_BIKE_ZONE_ORDER[target])
    setZoneInfoOpen(false)  // auto-close info panel on zone change (Pattern 5)
  }

  // ── Chart data — cal/min over time (higher = better; NOT reversed) ─────────
  const chartData = useMemo(() => efforts
    .map(e => {
      const parsed = parseAirBikeLabel(e.label)
      if (!parsed || !parsed.timeSecs) return null
      const rate = calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
      return { date: fmtShort(e.created_at), value: rate }
    })
    .filter(Boolean), [efforts])

  const values = chartData.map(d => d.value)
  const minV   = values.length ? Math.min(...values) : 0
  const maxV   = values.length ? Math.max(...values) : 10
  // Match mobile's yDomain: min = max(0, mn × 0.95), max = mx × 1.05.
  const domainMin = Math.max(0, Math.round(minV * 0.95 * 10) / 10)
  const domainMax = Math.round(maxV * 1.05 * 10) / 10
  const bestForChart = peakCalsPerMin > 0 ? peakCalsPerMin : null

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* ── 1. Header — h1 + best cal/min subtitle + AIR BIKE category pill ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{activity}</h1>
        {hasLoggedRate ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best —</span>
            <TickerNumber
              value={`${effectiveRate.toFixed(1)} cal/min`}
              className="font-mono font-semibold text-amber-400"
            />
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            No efforts logged yet
          </p>
        )}
        <span className="mt-1.5 inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
          AIR BIKE
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Progression plan card ── */}
          <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Your progression plan</h2>

            {/* Zone pill row — single active pill flanked by chevrons. Web stays
                simple click-to-navigate (no swipe choreography). Amber theme. */}
            <div className="mt-3 mb-2 flex items-center justify-center gap-3">
              <div className="flex w-14 items-center justify-end">
                {canGoPrev && (
                  <button
                    onClick={() => navigateZone(-1)}
                    aria-label="Previous zone"
                    className="text-amber-400/80 hover:text-amber-400 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5 -mr-2" />
                    <ChevronLeft className="h-5 w-5 -mt-5" />
                  </button>
                )}
              </div>

              <div className="rounded-full border border-amber-500 bg-amber-500/15 px-4 py-2">
                <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-amber-400">
                  {selectedCfg.label}
                </span>
              </div>

              <div className="flex w-14 items-center">
                {canGoNext && (
                  <button
                    onClick={() => navigateZone(1)}
                    aria-label="Next zone"
                    className="text-amber-400/80 hover:text-amber-400 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5 -mr-2" />
                    <ChevronRight className="h-5 w-5 -mt-5" />
                  </button>
                )}
              </div>
            </div>

            {/* ── 3-row hero card ── */}
            <div
              className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4"
              style={{ minHeight: 220 }}
            >
              {/* Tappable adp-zone info pill (right-aligned). */}
              <div className="flex justify-end">
                <button
                  onClick={() => setZoneInfoOpen(o => !o)}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5"
                >
                  <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-amber-400">
                    {selectedCfg.label}
                  </span>
                  <Info className="h-3 w-3 text-amber-400" />
                </button>
              </div>

              {/* Inline "why this zone" info panel. */}
              {zoneInfoOpen && (
                <div className="mt-1 rounded-md border border-amber-500/15 bg-card/60 px-2.5 py-2">
                  <p className="mb-1 text-xs font-bold text-foreground">{selectedCfg.label}</p>
                  <p className="text-[11px] leading-4 text-muted-foreground">{selectedCfg.whyText}</p>
                </div>
              )}

              {/* Stacked TickerNumber rows: work / est time. */}
              <div className="mt-3 space-y-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <TickerNumber value={selectedRx.shortWork} className="font-mono text-3xl font-bold text-amber-400" />
                  <span className="shrink-0 text-[11px] text-muted-foreground">the work</span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <TickerNumber value={fmtSecs(selectedRx.estimatedSecsPerRep)} className="font-mono text-3xl font-bold text-amber-400" />
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {selectedRx.reps > 1 ? 'est. per interval' : 'est. total'}
                  </span>
                </div>
              </div>

              {/* Thin separator + full coaching cue. */}
              <div className="mt-2.5 border-t border-amber-500/15 pt-2.5">
                <CueText className="text-sm text-foreground">{selectedCue}</CueText>
              </div>
            </div>
          </AnimateRise>

          {/* ── 3. Cal/min over time chart (higher = better; NOT reversed) ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Cal/min over time</p>
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
                      domain={[domainMin, domainMax]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      tickFormatter={(v) => v.toFixed(1)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v.toFixed(1)} cal/min`, 'Rate']}
                    />
                    {bestForChart && (
                      <ReferenceLine y={bestForChart} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.5} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
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
                  Log a second effort to see the trend.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Dashed = personal best
              </p>
            </AnimateRise>
          )}

          {/* ── 4. Efforts log (chronological, per-effort delete) ── */}
          <AnimateRise delay={500}>
            {efforts.length === 0 ? (
              <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                No entries found for {activity}.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">All entries</h2>
                </div>
                <div className="divide-y divide-border">
                  {[...efforts].reverse().map(e => {
                    const detail = e.label.split(' · ').slice(1).join(' · ')
                    const parsed = parseAirBikeLabel(e.label)
                    const rate = parsed && parsed.timeSecs
                      ? calsPerMinFromEffort(parsed.cals, parsed.timeSecs)
                      : 0
                    return (
                      <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{detail || e.label}</p>
                            <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                          </div>
                          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-amber-400">
                            {rate > 0 ? `${rate.toFixed(1)} cal/min` : '—'}
                          </span>
                        </div>
                      </SwipeDelete>
                    )
                  })}
                </div>
              </div>
            )}
          </AnimateRise>
        </>
      )}
    </div>
  )
}
