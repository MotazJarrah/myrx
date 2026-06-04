/**
 * AdminStrengthAssistedDetail — READ-ONLY (+ delete) coach mirror of the
 * athlete's ASSISTED MACHINE strength detail screen.
 *
 * Covers movements whose `movements.equipment` is `'assisted'` — Assisted
 * Pull-up, Assisted Dip, Assisted Chin-up, etc. The machine provides a
 * counterweight that *reduces* the user's effective bodyweight; progression
 * is measured in how LITTLE assistance the user needs, with the eventual goal
 * of 0 (graduate to the unassisted bodyweight variant).
 *
 * Distinction from `equipment === 'machine'`: resistance-ADDING machines (lat
 * pulldown, leg press, etc.) route through AdminStrengthWeightedDetail and
 * progress UPWARD. This file applies ONLY to `equipment === 'assisted'`.
 *
 * Faithful reproduction of the athlete surface defined in:
 *   - CLAUDE.md → "Assisted Machine detail card — locked design spec"
 *   - mobile/app/(app)/effort/strength/[exercise].tsx → AssistedMachineDetail
 *
 * Sections, top to bottom (matching the athlete):
 *   1. Header               — movement name + "Best Est. 1RM — N <unit> assist"
 *                             (TickerNumber) + "ASSIST MACHINE" category pill
 *   2. Bodyweight gate       — if no bodyweight log ≤ 30 days, the rep-max card
 *                             + hero are REPLACED by a CTA pointing at the
 *                             athlete's weight log. Chart + log still render.
 *   3. Reliability warning   — amber chip when the best effort had the machine
 *                             carrying > 75 % of bodyweight (projection noisy).
 *   4. Rep-max card          — adp-zone pill row (STRENGTH/HYPERTROPHY/ENDURANCE)
 *                             + horizontal 1RM…20RM tile row (assistance value +
 *                             "% BW") + source attribution.
 *   5. Hero card             — big TARGET assistance snapped to a pin (TickerNumber)
 *                             + "Target X% BW" chip + adp-zone info pill (whyText)
 *                             + cue line, OR the "Attempt unassisted" graduation
 *                             cue when the next pin would hit 0.
 *   6. Chart                 — Recharts "Assistance over time" line, Y-axis
 *                             REVERSED so reducing assistance trends UP (locked
 *                             chart-direction rule), + personal-best ref line.
 *   7. Efforts log           — chronological list, per-effort DELETE kept
 *                             (SwipeDelete).
 *
 * READ-ONLY: no log / add form. Delete is intentionally retained (the coach is
 * allowed to delete a client's efforts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the formulas are re-implemented inline:
 * web/src/lib/formulas.js is the OLDER web copy whose `projectAllRMs` is
 * hard-capped at 10 tiles (1RM…10RM) and still averages Brzycki past 10 reps.
 * The athlete shows 1RM…20RM and drops Brzycki when reps > 10. Rather than
 * mutate the frozen web lib, `estimate1RM` + `projectAllRMs` are reproduced
 * here verbatim from mobile/src/lib/formulas.ts so the projections match the
 * athlete exactly. The inverted effective-load math is reproduced inline from
 * the athlete component (mobile AssistedMachineDetail).
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import TickerNumber from '../../../components/TickerNumber'
import AnimateRise from '../../../components/AnimateRise'
import SwipeDelete from '../../../components/SwipeDelete'
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const LB_PER_KG = 0.453592
const THIRTY_DAYS_MS = 30 * 86_400_000

// ── 1RM estimation (Epley + Lombardi, +Brzycki ≤10 reps) ─────────────────────
// Verbatim mirror of mobile estimate1RM. Brzycki's linear assumption breaks
// past ~10 reps (under-projects load), so it's dropped from the average when
// reps > 10 and only Epley + Lombardi are used (both behave asymptotically).
function estimate1RM(weight, reps) {
  if (reps === 1) return weight
  const epley    = weight * (1 + reps / 30)
  const lombardi = weight * Math.pow(reps, 0.1)
  if (reps > 10) return Math.round((epley + lombardi) / 2)
  const brzycki  = weight * (36 / (37 - reps))
  return Math.round((epley + brzycki + lombardi) / 3)
}

// Verbatim mirror of mobile projectAllRMs(weight, reps, 20). Per-rep weight is
// the average of inverse Epley / Brzycki / Lombardi, dropping Brzycki past 10.
function projectAllRMs(weight, reps, maxReps = 20) {
  const oneRM = estimate1RM(weight, reps)
  return Array.from({ length: maxReps }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    const epley    = oneRM / (1 + r / 30)
    const lombardi = oneRM / Math.pow(r, 0.1)
    if (r > 10) return { reps: r, weight: Math.round((epley + lombardi) / 2) }
    const brzycki  = oneRM * (37 - r) / 36
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

// ── adp-zone (adaptation zone) classification + locked defaults ──────────────
// Verbatim mirror of mobile ADP_ZONE_CONFIG. Per-movement overrides NOT allowed.
function adpZoneFor(reps) {
  if (reps <= 5)  return 'strength'
  if (reps <= 12) return 'hypertrophy'
  return 'endurance'
}

const ADP_ZONE_ORDER = ['strength', 'hypertrophy', 'endurance']

const ADP_ZONE_CONFIG = Object.freeze({
  strength: {
    label:    'Build Strength',
    setsText: '4-5 sets',
    restText: '3-5 min',
    whyText:
      'Heavy loads at low reps recruit your biggest motor units and train them to fire harder and faster. The adaptation is neural — you get stronger without adding muscle size.',
  },
  hypertrophy: {
    label:    'Increase Hypertrophy',
    setsText: '3-4 sets',
    restText: '2-3 min',
    whyText:
      'Moderate loads taken close to failure put muscle fibers under sustained mechanical tension and metabolic stress. Both signals trigger growth of the fibers themselves.',
  },
  endurance: {
    label:    'Boost Endurance',
    setsText: '2-3 sets',
    restText: '45-60 sec',
    whyText:
      'Lighter loads at high reps drive capillary and mitochondrial growth inside the muscle. The adaptation is in stamina and waste clearance, not raw force — your muscles work longer before fatigue.',
  },
})

const ZONE_FIRST_REP = { strength: 1, hypertrophy: 6, endurance: 13 }

// ── Label parsing (mirror of mobile parseAssistanceFromLabel) ────────────────
// Effort label shape: "Assisted Pull Up · 60 lb assist · X × 8"
//   assistance + unit from "· N unit assist"; reps from "× N".
function parseAssistanceFromLabel(label) {
  const m = label?.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
  if (!m) return null
  return { assistance: parseFloat(m[1]), unit: m[2] }
}
function parseRepsFromLabel(label) {
  const m = label?.match(/×\s*(\d+)/)
  return m ? parseInt(m[1]) : null
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
//
// Props (all optional except userId + exercise):
//   userId    (string, required) — client's auth user id
//   exercise  (string, required) — movement name, e.g. "Assisted Pull Up"
//   onBack    (fn)               — optional custom back handler. Defaults to
//                                  returning to the client's detail page.
//
// Self-contained: fetches efforts, profile (weight_unit + current_weight), and
// the client's latest bodyweight row itself, so wiring is just
// <AdminStrengthAssistedDetail userId exercise />.
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminStrengthAssistedDetail({ userId, exercise, onBack }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileUnit, setProfileUnit] = useState('lb')

  // Bodyweight: { bwKg, isStale } | null. Fresh log < 30 d wins (used for math);
  // profile.current_weight falls back as stale (triggers the gate). Mirrors the
  // athlete's bw fetch — there's no recent-log timestamp on the profile row, so
  // the profile fallback is always treated as stale.
  const [bwInfo, setBwInfo]     = useState(null)
  const [bwLoaded, setBwLoaded] = useState(false)

  // adp-zone + selected tile state. Default landing tile = 1RM (matches the
  // athlete's "always open on 1RM / STRENGTH zone").
  const [selectedRM, setSelectedRM]     = useState(1)
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  const tileEls = useRef({}) // reps → DOM node, for scroll-into-view

  // ── Load efforts + profile (unit + current_weight) + latest bodyweight ──────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setBwLoaded(false)

      const [efRes, profRes, bwRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .eq('type', 'strength')
          .ilike('label', `${exercise} · %`)
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('weight_unit, current_weight')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('bodyweight')
          .select('weight, unit, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1),
      ])
      if (cancelled) return

      setEntries(efRes.data || [])

      const prof = profRes.data || null
      const pUnit = prof?.weight_unit || 'lb'
      setProfileUnit(pUnit)

      // Resolve bodyweight: fresh log < 30d → fresh; else profile fallback → stale.
      const row = bwRes.data?.[0]
      if (row && (Date.now() - new Date(row.created_at).getTime()) < THIRTY_DAYS_MS) {
        const rowKg = row.unit === 'lb' ? row.weight * LB_PER_KG : row.weight
        setBwInfo({ bwKg: rowKg, isStale: false })
      } else if (prof?.current_weight != null) {
        const pKg = pUnit === 'lb' ? prof.current_weight * LB_PER_KG : prof.current_weight
        setBwInfo({ bwKg: pKg, isStale: true })
      } else {
        setBwInfo(null)
      }

      setBwLoaded(true)
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

  // ── Parse efforts → { assistance, unit, reps, ts, id } ──────────────────────
  const parsed = useMemo(() => entries
    .map(e => {
      const p = parseAssistanceFromLabel(e.label)
      if (!p) return null
      return { ...p, reps: parseRepsFromLabel(e.label), ts: e.created_at, id: e.id }
    })
    .filter(Boolean), [entries])

  const labelUnit = parsed[0]?.unit || profileUnit

  // ── Inverted assistance math (CLAUDE.md "Assisted Machine detail card") ─────
  //   effective_load(effort) = max(0, bodyweight − assistance)
  //   best_effective_1RM     = max(estimate1RM(effective_load, reps)) across efforts
  //   best_1RM_assistance    = max(0, bodyweight − best_effective_1RM)  (header)
  //   tile assistance(r)     = max(0, bodyweight − projected_effective(r))
  //   tile bw_pct(r)         = round(assistance(r) / bodyweight × 100)
  // Only meaningful with a NON-STALE bodyweight; everything below derives from it.
  const incLb = labelUnit === 'kg' ? 2.5 : 5
  const bwForMath = bwInfo && !bwInfo.isStale ? bwInfo : null
  const bwInLabelUnit = bwForMath
    ? (labelUnit === 'kg' ? bwForMath.bwKg : bwForMath.bwKg / LB_PER_KG)
    : null

  const bestEff1RM = bwForMath && bwInLabelUnit != null
    ? parsed
        .filter(p => p.reps && p.reps > 0)
        .reduce((max, p) => Math.max(max, estimate1RM(Math.max(0, bwInLabelUnit - p.assistance), p.reps)), 0)
    : 0

  const best1RMAssistance = bwInLabelUnit != null && bestEff1RM > 0
    ? Math.max(0, Math.round(bwInLabelUnit - bestEff1RM))
    : null

  const projections = bestEff1RM > 0 ? projectAllRMs(bestEff1RM, 1) : []
  const assistProjections = bwInLabelUnit != null && projections.length > 0
    ? projections.map(({ reps: r, weight: projEff }) => {
        const projAssist = Math.max(0, Math.round(bwInLabelUnit - projEff))
        const bwPct = bwInLabelUnit > 0 ? Math.round((projAssist / bwInLabelUnit) * 100) : 0
        return { reps: r, assistance: projAssist, bwPct }
      })
    : []

  const selZone    = adpZoneFor(selectedRM)
  const selZoneCfg = ADP_ZONE_CONFIG[selZone]
  const selProj    = assistProjections.find(p => p.reps === selectedRM) ?? null
  const selRepRange = selectedRM

  // Hero "next training target" — must land on a valid pin slot (5 lb / 2.5 kg)
  // because assisted machines have fixed pin holes. Two cases:
  //   • Projection sits exactly on a pin → target = pin one increment lower
  //   • Projection lands between pins   → target = pin immediately below it
  // Floored at 0 so a fully-graduated projection renders as "0 lb assistance".
  const currentProjection = selProj?.assistance ?? 0
  const snappedDownPin    = Math.floor(currentProjection / incLb) * incLb
  const targetAssistance  = Math.abs(snappedDownPin - currentProjection) < 0.01
    ? Math.max(0, snappedDownPin - incLb)
    : Math.max(0, snappedDownPin)
  const targetBwPct = bwInLabelUnit != null && bwInLabelUnit > 0
    ? Math.round((targetAssistance / bwInLabelUnit) * 100)
    : 0

  // Reliability warning: best effort had effective load < 25 % of BW (machine
  // carried > 75 %). Purely informational; doesn't block any card.
  const reliabilityWarn = bwForMath && bwInLabelUnit != null && bwInLabelUnit > 0
    ? (bestEff1RM / bwInLabelUnit) < 0.25
    : false

  // Attempt-unassisted (graduation) cue — fires whenever the next reduction
  // would take the user to 0 assistance (the pin comes off the stack). Driven
  // by targetAssistance so a best 1RM-assist of one pin above zero at the 1RM
  // tile correctly triggers it.
  const showAttemptUnassisted = targetAssistance === 0
  const bareName = exercise.startsWith('Assisted ')
    ? exercise.slice('Assisted '.length)
    : 'the unassisted version'

  // Whether the rep-max projections card + hero should render. Gated on a fresh
  // bodyweight AND at least one usable effort, exactly like the athlete.
  const showProjectionAndHero = bwLoaded && bwForMath != null && bestEff1RM > 0

  // ── Zone navigation (click chevrons / pills) ─────────────────────────────────
  const zoneIdx   = ADP_ZONE_ORDER.indexOf(selZone)
  const canGoPrev = zoneIdx > 0
  const canGoNext = zoneIdx >= 0 && zoneIdx < ADP_ZONE_ORDER.length - 1

  function goToZone(zone) {
    if (!zone || zone === selZone) return
    const firstRep = ZONE_FIRST_REP[zone]
    setZoneInfoOpen(false) // auto-close info panel on zone change (Pattern 5)
    setSelectedRM(firstRep)
    requestAnimationFrame(() => {
      const el = tileEls.current[firstRep]
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })
  }
  function navigateZone(dir) {
    const next = ADP_ZONE_ORDER[zoneIdx + dir]
    if (next) goToZone(next)
  }
  function onTilePress(reps) {
    setZoneInfoOpen(false)
    setSelectedRM(reps)
  }

  // ── Chart data — assistance over time ────────────────────────────────────────
  const chartData = useMemo(() => parsed
    .map(p => ({ ts: p.ts, date: fmtShort(p.ts), value: p.assistance })),
    [parsed])

  const values = chartData.map(d => d.value)
  const maxV   = values.length ? Math.max(...values) : 10
  // Best progress = LOWEST assistance. Reference line sits there; Y-axis is
  // reversed so the line trends UP as assistance drops (locked chart-direction
  // rule — never frame the win as a downward number movement).
  const bestAssistance = values.length ? Math.min(...values) : null
  const yMax = Math.round(maxV * 1.1) || 10

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
        <h1 className="text-xl font-bold tracking-tight">{exercise}</h1>
        {best1RMAssistance != null ? (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best Est. 1RM —</span>
            <TickerNumber value={best1RMAssistance} className="font-mono font-semibold text-blue-400" />
            <span className="text-blue-400">{labelUnit} assist</span>
          </p>
        ) : parsed.length === 0 ? (
          <p className="mt-0.5 text-sm text-muted-foreground">No efforts logged yet</p>
        ) : (
          <p className="mt-0.5 flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>Best Est. 1RM —</span>
            <span className="text-blue-400">— {labelUnit} assist</span>
          </p>
        )}
        <span className="mt-1 inline-flex items-center rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-400">
          ASSIST MACHINE
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* ── 2. Bodyweight gate — replaces projection + hero when bw missing/stale ── */}
          {bwLoaded && !showProjectionAndHero && (
            <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Recent bodyweight required</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {parsed.length === 0
                  ? 'This client hasn’t logged any assisted efforts for this movement yet.'
                  : 'We need a recent bodyweight to project assistance accurately. The client should log their current weight.'}
              </p>
            </AnimateRise>
          )}

          {/* ── 3. Reliability warning — best effort had machine carrying > 75 % BW ── */}
          {showProjectionAndHero && reliabilityWarn && (
            <AnimateRise delay={0} className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2.5">
              <p className="text-[11px] leading-4 text-amber-300">
                Heads up — this client’s best effort had the machine carrying most of the load. Projections may be imprecise. Try a set with less assistance.
              </p>
            </AnimateRise>
          )}

          {/* ── 4 + 5. Rep-max projections card + hero ── */}
          {showProjectionAndHero && (
            <AnimateRise delay={0} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Rep-max projections</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pick an adaptation zone, then tap a rep target.
              </p>

              {/* adp-zone pill row — single active pill flanked by chevrons.
                  Web stays simple click-to-navigate (no swipe choreography). */}
              <div className="mt-3 mb-2 flex items-center justify-center gap-3">
                <div className="flex w-14 items-center justify-end">
                  {canGoPrev && (
                    <button
                      onClick={() => navigateZone(-1)}
                      aria-label="Previous zone"
                      className="text-blue-400/80 hover:text-blue-400 transition-colors"
                    >
                      <ChevronLeft className="h-5 w-5 -mr-2" />
                      <ChevronLeft className="h-5 w-5 -mt-5" />
                    </button>
                  )}
                </div>

                <div className="rounded-full border border-blue-500 bg-blue-500/15 px-4 py-2">
                  <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-blue-400">
                    {selZoneCfg.label}
                  </span>
                </div>

                <div className="flex w-14 items-center">
                  {canGoNext && (
                    <button
                      onClick={() => navigateZone(1)}
                      aria-label="Next zone"
                      className="text-blue-400/80 hover:text-blue-400 transition-colors"
                    >
                      <ChevronRight className="h-5 w-5 -mr-2" />
                      <ChevronRight className="h-5 w-5 -mt-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Horizontal scrollable tile row 1RM…20RM. Plain scroll row —
                  the athlete component has no fading-edge gradient overlays. */}
              <div
                className="-mx-0.5 flex gap-2 overflow-x-auto py-1 px-0.5 scrollbar-hide"
                style={{ scrollbarWidth: 'none' }}
              >
                {assistProjections.map(({ reps: r, assistance: a, bwPct }) => {
                  const isSelected = selectedRM === r
                  return (
                    <button
                      key={r}
                      ref={el => { tileEls.current[r] = el }}
                      onClick={() => onTilePress(r)}
                      className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/15'
                          : 'border-border bg-card/40 hover:border-blue-500/40'
                      }`}
                      style={{ minWidth: 68 }}
                    >
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-blue-400' : 'text-muted-foreground'}`}>
                        {r}RM
                      </span>
                      <span className={`mt-0.5 font-mono text-base font-bold tabular-nums ${isSelected ? 'text-blue-400' : 'text-foreground'}`}>
                        {a}
                      </span>
                      <span className={`mt-0.5 font-mono text-[9px] tabular-nums leading-none ${isSelected ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
                        {bwPct}% BW
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                Epley · Brzycki · Lombardi averaged · % of bodyweight
              </p>

              {/* ── 5. Next-target hero card ── */}
              {selProj && (
                <div
                  className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] p-4"
                  style={{ minHeight: 220 }}
                >
                  {/* Tappable adp-zone info pill (right-aligned). */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => setZoneInfoOpen(o => !o)}
                      className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5"
                    >
                      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-blue-400">
                        {selZoneCfg.label}
                      </span>
                      <Info className="h-3 w-3 text-blue-400" />
                    </button>
                  </div>

                  {/* Inline "why this adaptation" info panel (the WHY, not the prescription). */}
                  {zoneInfoOpen && (
                    <div className="mt-1 rounded-md border border-blue-500/15 bg-card/60 px-2.5 py-2">
                      <p className="mb-1 text-xs font-bold text-foreground">{selZoneCfg.label}</p>
                      <p className="text-[11px] leading-4 text-muted-foreground">{selZoneCfg.whyText}</p>
                    </div>
                  )}

                  {/* Big TARGET assistance + "assist" label. */}
                  <div className="mt-1">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-1">
                        <TickerNumber value={targetAssistance} className="font-mono text-3xl font-bold text-blue-400" />
                        <span className="text-blue-400">{labelUnit}</span>
                      </div>
                      <span className="text-blue-400">assist</span>
                    </div>

                    {/* Single Target BW% chip. Tile shows the current projection;
                        hero shows the next reduction target. */}
                    <div className="mt-2 flex items-center justify-start">
                      <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-400">
                        Target {targetBwPct}% BW
                      </span>
                    </div>
                  </div>

                  {/* Thin separator + cue line. */}
                  <div className="mt-2.5 border-t border-blue-500/15 pt-2.5">
                    {showAttemptUnassisted ? (
                      selRepRange === 1 ? (
                        <p className="flex flex-wrap items-baseline text-sm">
                          <span className="text-foreground">Attempt an unassisted&nbsp;</span>
                          <span className="font-bold text-blue-400">{bareName}</span>
                          <span className="text-foreground">&nbsp;— they&apos;re ready.</span>
                        </p>
                      ) : (
                        <p className="flex flex-wrap items-baseline text-sm">
                          <span className="text-foreground">Attempt&nbsp;</span>
                          <TickerNumber value={selRepRange} className="font-mono font-bold text-foreground" />
                          <span className="text-foreground">&nbsp;unassisted&nbsp;</span>
                          <span className="whitespace-nowrap font-bold text-blue-400">{bareName}s</span>
                          <span className="text-foreground">&nbsp;— they&apos;re ready.</span>
                        </p>
                      )
                    ) : selRepRange === 1 ? (
                      <>
                        <p className="flex flex-wrap items-baseline text-sm">
                          <span className="text-foreground">Hit one clean rep with&nbsp;</span>
                          <TickerNumber value={targetAssistance} className="font-mono font-bold text-blue-400" />
                          <span className="font-mono font-bold text-blue-400">&nbsp;{labelUnit}</span>
                          <span className="text-foreground">&nbsp;assistance</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">Benchmark attempt</p>
                      </>
                    ) : (
                      <>
                        <p className="flex flex-wrap items-baseline text-sm">
                          <span className="text-foreground">Do&nbsp;</span>
                          <span className="font-mono font-bold text-foreground">{selZoneCfg.setsText}</span>
                          <span className="text-foreground">&nbsp;of&nbsp;</span>
                          <TickerNumber value={selRepRange} className="font-mono font-bold text-foreground" />
                          <span className="font-mono font-bold text-foreground">&nbsp;reps</span>
                          <span className="text-foreground">&nbsp;with&nbsp;</span>
                          <TickerNumber value={targetAssistance} className="font-mono font-bold text-blue-400" />
                          <span className="font-mono font-bold text-blue-400">&nbsp;{labelUnit}</span>
                          <span className="text-foreground">&nbsp;assistance</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">Rest {selZoneCfg.restText} between sets</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </AnimateRise>
          )}

          {/* ── 6. Assistance chart ── */}
          {chartData.length >= 1 && (
            <AnimateRise delay={250} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">Assistance over time</p>
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
                    {/* Reversed so reducing assistance over time renders as the
                        line trending UP — consistent with every other progression
                        chart in the app (never "lower is better"). */}
                    <YAxis
                      domain={[0, yMax]}
                      reversed
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
                      formatter={(v) => [`${v} ${labelUnit}`, 'Assistance']}
                    />
                    {bestAssistance != null && (
                      <ReferenceLine y={bestAssistance} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.5} />
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

      {/* ── 7. Efforts log (chronological, with per-effort delete) ── */}
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
                  const p = parseAssistanceFromLabel(e.label)
                  const reps = parseRepsFromLabel(e.label)
                  return (
                    <SwipeDelete key={e.id} onDelete={() => deleteEntry(e.id)}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {reps ? `${reps} rep${reps !== 1 ? 's' : ''}` : (e.label.split(' · ').slice(1).join(' · ') || e.label)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</p>
                        </div>
                        {p && (
                          <span className="shrink-0 text-right">
                            <span className="block text-[10px] text-muted-foreground">assistance</span>
                            <span className="block font-mono text-xs font-semibold tabular-nums text-blue-400">
                              {p.assistance} {p.unit}
                            </span>
                          </span>
                        )}
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
