/**
 * Coach signup magic ×3 — preview page
 *
 * Route: /preview/coach-magic (public, no auth)
 *
 * Standalone preview of the 3 aspirational "magic" screens we'll embed in
 * the coach signup journey. Built as a single self-contained page with
 * hardcoded mock data so the user can review the narrative + visuals
 * before we lift it into the real signup flow.
 *
 * Arc B (locked May 25 2026): coach diagnoses → MyRX prompts adjustment →
 * coach applies and watches the plan adapt live.
 *
 *   Screen 1 — diagnosis: client card blinks red. Coach drills in and sees
 *              snapshot tiles, recent strength PR, bodyweight trending down,
 *              food log that cuts off 4 days ago. Cross-domain "huh"
 *              moment that no single-domain app can produce.
 *
 *   Screen 2 — prompt: MyRX surfaces a suggestion card with a proposed
 *              macro-plan loosening, showing the current vs proposed split.
 *              "Apply suggestion" CTA.
 *
 *   Screen 3 — fix: macro plan editor with the energy slider animating from
 *              -18% → -10% on mount. Macros re-balance live in the bar
 *              alongside. Confirmation chip slides in at the end.
 *
 * Prev/Next buttons so the user can pause on any screen. Progress dots
 * at the top. Dark theme by default.
 */
import { useState, useEffect, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Sparkles, Check, AlertCircle, Loader2,
  TrendingDown, Bell, RotateCcw, MessageCircle, Send, ChevronsRight,
} from 'lucide-react'

const TOTAL = 3

const CLIENT = {
  name: 'Jake Carter',
  email: 'jake.c@myrxfit.com',
  age: 36,
  gender: 'Male',
  weight_lb: 162.9,
  height: '5\'9"',
  initials: 'JC',
  photo: '/preview-jake.png',
}

// Realistic 1RM for a ~163 lb intermediate male — 185 lb is a clean
// barbell load (45 bar + 45+25 ea side). Progression up the standard
// 5-lb jumps that match what Motaz would actually log.
const BENCH = {
  best_lb: 185,
  history: [
    { date: 'Apr 30', value: 175 },
    { date: 'May 5',  value: 180 },
    { date: 'May 8',  value: 185 },
    { date: 'May 12', value: 185 },
  ],
}

const BODYWEIGHT_HISTORY = [
  { date: 'Apr 30', value: 165.0 },
  { date: 'May 2',  value: 164.5 },
  { date: 'May 3',  value: 165.2 },
  { date: 'May 4',  value: 164.0 },
  { date: 'May 5',  value: 163.5 },
  { date: 'May 7',  value: 163.2 },
  { date: 'May 10', value: 163.0 },
  { date: 'May 12', value: 162.9 },
]

// 14-day window matching mobile CalorieStrip. First 10 days logged
// (mix of on-target/near/off), last 4 are missing (the gap the coach
// notices). Target is 2329 kcal/day.
const CAL_TARGET = 2329
const FOOD_LOG_14D = [
  { iso: '05-12', day: 'Mon', num: 12, kcal: 2280 },
  { iso: '05-13', day: 'Tue', num: 13, kcal: 2410 },
  { iso: '05-14', day: 'Wed', num: 14, kcal: 2350 },
  { iso: '05-15', day: 'Thu', num: 15, kcal: 2120 },
  { iso: '05-16', day: 'Fri', num: 16, kcal: 2256 },
  { iso: '05-17', day: 'Sat', num: 17, kcal: 2980 },
  { iso: '05-18', day: 'Sun', num: 18, kcal: 2520 },
  { iso: '05-19', day: 'Mon', num: 19, kcal: 2310 },
  { iso: '05-20', day: 'Tue', num: 20, kcal: 1850 },
  { iso: '05-21', day: 'Wed', num: 21, kcal: 2400 },
  { iso: '05-22', day: 'Thu', num: 22, kcal: null },
  { iso: '05-23', day: 'Fri', num: 23, kcal: null },
  { iso: '05-24', day: 'Sat', num: 24, kcal: null },
  { iso: '05-25', day: 'Sun', num: 25, kcal: null },
]

function statusFor(actual, target) {
  if (!actual) return 'empty'
  const ratio = actual / target
  if (ratio >= 0.92 && ratio <= 1.08) return 'on-target'
  if (ratio >= 0.80 && ratio <= 1.20) return 'near-target'
  return 'off-target'
}

const STATUS_COLORS = {
  'on-target':   '#34d399', // emerald
  'near-target': '#fbbf24', // amber
  'off-target':  '#ef4444', // red
  'empty':       'transparent',
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProgressDots({ active, total }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === active ? 'w-8 bg-primary' :
            i  <  active ? 'w-4 bg-primary/60' :
                           'w-4 bg-muted'
          }`}
        />
      ))}
    </div>
  )
}

// MagicHeading — mirrors the mobile signup's Heading exactly (matches
// the SignupSandbox's Heading component): left-aligned eyebrow + title +
// subtitle. Used at the top of each magic screen so the magic flow
// shares the same chrome language as the rest of the journey instead
// of standing apart with its own card-style banner.
function MagicHeading({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <p className="text-[11px] font-medium uppercase tracking-wider text-primary mb-2">{eyebrow}</p>
      )}
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
      )}
    </div>
  )
}

// Small lime "Sample view" pill — pinned top-right inside every data
// block so it's unambiguous which numbers are demo vs real, even when
// the user is mid-scroll on a long page.
function SampleBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
      <Sparkles className="h-2.5 w-2.5" />
      Sample view
    </span>
  )
}

// MobileChip — mirrors the mobile end-user dashboard chips exactly
// (mobile/app/(app)/dashboard.tsx, May 24 2026 chip overhaul):
//
//   🏆 N strength PRs this month       — blue
//   🏆 N cardio PRs this month         — amber
//   🍴 N days logged in last 14 days  — red
//   ❤️ N bpm low in last 7 days        — emerald
//   ⚖️ ±N.N lb in last 7 days          — slate
//
// Emoji + value + tail-text, all in a single rounded pill with a tinted
// background matching the value color. Mobile uses emojis (not lucide
// icons) so we mirror that — the brand-rule allowance for emojis the
// source file itself uses.
function MobileChip({ emoji, value, tail, color = 'blue' }) {
  const palette = {
    blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    text: 'text-blue-400' },
    amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-400' },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-400' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    slate:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   text: 'text-foreground' },
  }[color]
  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${palette.bg} ${palette.border}`}>
      <span className="text-[12px] leading-none">{emoji}</span>
      <span className={`font-bold tabular-nums ${palette.text}`}>{value}</span>
      <span className={color === 'slate' ? 'text-muted-foreground' : palette.text}>{tail}</span>
    </div>
  )
}

// MiniCalorieStrip — preview of the mobile CalorieStrip pattern:
// 14-day SVG chart with vertical status bands + dashed target line +
// polyline + dots, sitting above a row of compact day tiles. Each day
// tile shows day-abbrev / date number / kcal value (or em-dash for
// empty). Days without logs paint a faint red band in the chart and a
// muted tile below — exactly how the mobile CalorieStrip surfaces gaps.
function MiniCalorieStrip({ data, target, highlightEmpty = false }) {
  const VBW = 700
  const VBH = 90
  const padX = 4
  const padTop = 8
  const padBottom = 6
  const slotW = (VBW - padX * 2) / data.length
  const maxVal = Math.max(target * 1.3, ...data.map(d => d.kcal || 0))
  const minVal = 0
  const range = maxVal - minVal
  const yFor = (v) => padTop + (1 - (v - minVal) / range) * (VBH - padTop - padBottom)
  const targetY = yFor(target)

  // Dot positions + polyline path (skips missing days, splits the line)
  const segments = []
  let current = []
  data.forEach((d, i) => {
    if (d.kcal == null) {
      if (current.length) { segments.push(current); current = [] }
      return
    }
    const cx = padX + i * slotW + slotW / 2
    const cy = yFor(d.kcal)
    current.push({ x: cx, y: cy, status: statusFor(d.kcal, target) })
  })
  if (current.length) segments.push(current)

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full" style={{ height: 76 }}>
        {/* Per-day vertical status bands. Empty/missing-log days
            render as TRANSPARENT (no fill) — a logged-but-no-data slot
            shouldn't paint a band at all. Only days with actual food
            log entries get a coloured band reflecting target adherence. */}
        {data.map((d, i) => {
          const status = statusFor(d.kcal, target)
          if (status === 'empty') return null
          const fill = `${STATUS_COLORS[status]}26` // 15% opacity
          return (
            <rect key={i}
              x={padX + i * slotW + 2}
              y={padTop}
              width={slotW - 4}
              height={VBH - padTop - padBottom}
              rx={4}
              fill={fill}
            />
          )
        })}
        {/* Dashed target reference line */}
        <line x1={padX} x2={VBW - padX} y1={targetY} y2={targetY}
          stroke="#a3a3a3" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
        {/* Polyline segments (skip missing days) */}
        {segments.map((seg, si) => (
          <polyline key={si}
            points={seg.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke="hsl(75 70% 60%)" strokeWidth="1.5" opacity="0.7"
          />
        ))}
        {/* Dots per logged day */}
        {data.map((d, i) => {
          if (d.kcal == null) return null
          const status = statusFor(d.kcal, target)
          const cx = padX + i * slotW + slotW / 2
          const cy = yFor(d.kcal)
          return (
            <circle key={i} cx={cx} cy={cy} r="4.5"
              fill={STATUS_COLORS[status]}
              stroke="hsl(0 0% 7%)" strokeWidth="1.5"
            />
          )
        })}
      </svg>
      {/* Compact day tiles — empty (missing-log) days pulse in lime when
          `highlightEmpty` is true, to draw the coach's eye to the gap. */}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d, i) => {
          const empty = d.kcal == null
          const status = statusFor(d.kcal, target)
          const accent = STATUS_COLORS[status]
          return (
            <div key={i}
              className={`flex flex-col items-center justify-center rounded-md border px-0.5 py-1.5 text-center transition-all ${
                empty
                  ? (highlightEmpty
                      ? 'border-red-500 bg-red-500/20 animate-pulse-red'
                      : 'border-red-500/30 bg-red-500/5')
                  : 'border-border bg-muted/20'
              }`}
            >
              <p className="text-[8px] uppercase tracking-wide text-muted-foreground leading-none">{d.day}</p>
              <p className={`mt-0.5 text-xs font-bold tabular-nums leading-none ${
                empty ? 'text-red-400' : 'text-foreground'
              }`}>{d.num}</p>
              <p className={`mt-1 text-[9px] tabular-nums leading-none ${
                empty ? 'text-red-400/70' : ''
              }`}
                 style={empty ? undefined : { color: accent }}
              >
                {empty ? '—' : d.kcal}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusDot({ color = 'red', size = 12 }) {
  const colors = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' }
  return (
    <span className="relative flex" style={{ height: size, width: size }}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
        style={{ backgroundColor: colors[color], animationDuration: '0.9s' }} />
      <span className="relative inline-flex rounded-full border-2 border-card"
        style={{ height: size, width: size, backgroundColor: colors[color] }} />
    </span>
  )
}

function MiniChart({ data, color = '#60a5fa', dashedReference = null, height = 100 }) {
  if (!data || data.length < 2) return null
  const width = 320
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const padY = 10
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padY + (1 - (d.value - min) / range) * (height - padY * 2)
    return { x, y, value: d.value }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const refY = dashedReference != null
    ? padY + (1 - (dashedReference - min) / range) * (height - padY * 2)
    : null
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      {refY != null && (
        <line x1={0} x2={width} y1={refY} y2={refY}
          stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
      ))}
    </svg>
  )
}

// SnapshotPill + FoodLogStrip removed — replaced by MobileChip (mirrors
// mobile end-user dashboard chips) and MiniCalorieStrip (mirrors mobile
// CalorieStrip pattern). May 25 2026.

// ── Screen 1 — Diagnosis ────────────────────────────────────────────────────

// Speech bubble pointing down at the food log card — gives the coach
// the "next thought" they should be having, and primes them to click.
function ThoughtBubble({ children }) {
  return (
    <div className="relative animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="relative mx-auto max-w-md rounded-2xl border-2 border-primary bg-primary/15 px-4 py-3 shadow-[0_0_24px_-4px_hsl(75_70%_60%/0.4)]">
        <p className="text-sm text-foreground leading-relaxed text-center">{children}</p>
        {/* Down-pointing tail */}
        <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 h-0 w-0"
             style={{
               borderLeft: '8px solid transparent',
               borderRight: '8px solid transparent',
               borderTop: '8px solid hsl(75 70% 60%)',
             }} />
      </div>
    </div>
  )
}

// Convert pounds to kilograms with 1-decimal precision. Used to project
// all display values when `units === 'metric'` so the sandbox respects
// the user's units pick from step 2 of the signup journey.
const LB_PER_KG = 2.2046
const lbToKg = (lb) => Math.round((lb / LB_PER_KG) * 10) / 10

export function ScreenDiagnosis({ onAdvance, units = 'imperial' }) {
  const isMetric = units === 'metric'
  // Convert every weight display to the user's chosen unit
  const wt        = isMetric ? lbToKg(CLIENT.weight_lb) : CLIENT.weight_lb
  const wtUnit    = isMetric ? 'kg' : 'lb'
  const ht        = isMetric ? '175 cm' : CLIENT.height
  const benchBest = isMetric ? lbToKg(BENCH.best_lb)    : BENCH.best_lb
  const benchHistory = isMetric
    ? BENCH.history.map(d => ({ ...d, value: lbToKg(d.value) }))
    : BENCH.history
  const bwHistory = isMetric
    ? BODYWEIGHT_HISTORY.map(d => ({ ...d, value: lbToKg(d.value) }))
    : BODYWEIGHT_HISTORY
  // Static deltas — -2.1 lb ≈ -1.0 kg (rounded)
  const bwDeltaStr = isMetric ? '-1.0 kg' : '-2.1 lb'
  const chipDeltaValue = isMetric ? '−1.0' : '−2.1'
  const chipDeltaUnit  = wtUnit

  return (
    <div className="animate-in fade-in duration-500">
      <MagicHeading
        eyebrow="Quick demo"
        title="Inside your client dashboard"
        subtitle="Rep-max progressions, weight trends, daily calorie adherence, and more — all on one page."
      />

      <div className="space-y-5">
        {/* Client header card */}
        <div className="relative rounded-2xl border border-border bg-card p-5">
          <div className="absolute top-3 right-3"><SampleBadge /></div>
          <div className="flex items-start gap-4">
            <div className="relative">
              <img
                src={CLIENT.photo}
                alt={CLIENT.name}
                className="h-14 w-14 rounded-full object-cover"
              />
              <div className="absolute -top-1 -right-1">
                <StatusDot color="red" size={14} />
              </div>
            </div>
            <div className="flex-1 min-w-0 pr-24">
              <p className="text-base font-semibold">{CLIENT.name}</p>
              <p className="text-xs text-muted-foreground truncate">{CLIENT.email}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                <span className="text-muted-foreground">Age</span> <span className="text-foreground">{CLIENT.age}y</span>
                <span className="text-muted-foreground/40 mx-1.5">·</span>
                <span className="text-muted-foreground">Weight</span> <span className="text-foreground">{wt} {wtUnit}</span>
                <span className="text-muted-foreground/40 mx-1.5">·</span>
                <span className="text-muted-foreground">Height</span> <span className="text-foreground">{ht}</span>
              </p>
            </div>
          </div>
          {/* Mobile end-user chip set (mirror of dashboard.tsx, May 24 2026 overhaul) */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <MobileChip color="blue"    emoji="🏆"  value="6" tail=" strength PRs this month" />
            <MobileChip color="amber"   emoji="🏆"  value="4" tail=" cardio PRs this month" />
            <MobileChip color="red"     emoji="🍴"  value="10" tail=" days logged in last 14 days" />
            <MobileChip color="emerald" emoji="❤️" value="58" tail=" bpm low in last 7 days" />
            <MobileChip color="slate"   emoji="⚖️" value={chipDeltaValue} tail={` ${chipDeltaUnit} in last 7 days`} />
          </div>
        </div>

        {/* Two-column data */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Strength effort card */}
          <div className="relative rounded-2xl border border-border bg-card p-4">
            <div className="absolute top-3 right-3"><SampleBadge /></div>
            <div className="mb-3 pr-24">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Bench Press</p>
              <p className="text-[10px] text-muted-foreground">Strength · 4 entries</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-blue-400">
                {benchBest}
                <span className="text-[10px] text-muted-foreground/70 ml-1">{wtUnit} · Best 1RM</span>
              </p>
            </div>
            <MiniChart data={benchHistory} color="#60a5fa" dashedReference={benchBest} height={80} />
            <p className="mt-2 text-[10px] text-muted-foreground text-center">Est. 1RM trend · trending up</p>
          </div>

          {/* Bodyweight card */}
          <div className="relative rounded-2xl border border-border bg-card p-4">
            <div className="absolute top-3 right-3"><SampleBadge /></div>
            <div className="mb-3 pr-24">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Bodyweight</p>
              <p className="text-[10px] text-muted-foreground">8 entries · last 2 weeks</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-400">
                {wt}
                <span className="text-[10px] text-muted-foreground/70 ml-1">{wtUnit}</span>
              </p>
            </div>
            <MiniChart data={bwHistory} color="#34d399" height={80} />
            <p className="mt-2 text-[10px] text-emerald-400/70 text-center flex items-center justify-center gap-1">
              <TrendingDown className="h-3 w-3" /> {bwDeltaStr} over 12 days
            </p>
          </div>
        </div>

        {/* Thought bubble — coach's reaction to the cross-section.
            Sits ABOVE the food log card so the coach's eye reads "huh,
            what's going on with the food log?" then drops down to find
            the answer right there. Tail points at the card below. */}
        <ThoughtBubble>
          Jake hasn't been logging his food intake for the past few days. Let's check out his food log and give him a call.
        </ThoughtBubble>

        {/* Food log — mobile-style CalorieStrip. The card is the click
            target that advances the magic flow. The 4 missing-log days
            pulse in lime to draw the eye, and the whole card has a soft
            lime border + cursor-pointer so it reads as the action. */}
        <button
          type="button"
          onClick={onAdvance}
          className="relative w-full rounded-2xl border-2 border-primary bg-card p-4 text-left transition-all hover:bg-primary/5 hover:shadow-[0_0_32px_-8px_hsl(75_70%_60%/0.5)] active:scale-[0.995] cursor-pointer"
        >
          <div className="absolute top-3 right-3"><SampleBadge /></div>
          <div className="mb-3 pr-24">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Daily intake</p>
            <p className="text-[10px] text-muted-foreground">Last 14 days · target {CAL_TARGET} kcal/day</p>
          </div>
          <MiniCalorieStrip data={FOOD_LOG_14D} target={CAL_TARGET} highlightEmpty />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="font-medium">Logs stopped 4 days ago</span>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              Open food log <ChevronsRight className="h-3 w-3" />
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}


// ── Screen 2 — Fix (drag-and-lock slider) ───────────────────────────────────

export function ScreenFix({ active, onAdvance }) {
  // Immersive drag-and-lock slider. The coach is asked to physically
  // drag the energy slider until it hits −10%. The moment the value
  // touches −10 (going either direction), the slider LOCKS there and
  // becomes disabled. Apply adjustment button stays disabled until
  // lock. Click Apply → onAdvance to chat screen.
  const [energy, setEnergy] = useState(-18)
  const [locked, setLocked] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!active) {
      setEnergy(-18)
      setLocked(false)
      setConfirmed(false)
    }
  }, [active])

  function handleSliderChange(e) {
    if (locked) return
    const newVal = Number(e.target.value)
    const TARGET = -10
    // If the new value crosses or lands ON the target, snap to it and lock.
    if (newVal === TARGET || (energy < TARGET && newVal >= TARGET) || (energy > TARGET && newVal <= TARGET)) {
      setEnergy(TARGET)
      setLocked(true)
    } else {
      setEnergy(newVal)
    }
  }

  function handleApply() {
    if (!locked) return
    setConfirmed(true)
    // Give the confirmation chip a moment to land before advancing
    setTimeout(() => onAdvance?.(), 1200)
  }

  // Derive target + macros live from energy %
  const tdee = 2840
  const target = Math.round(tdee * (1 + energy / 100))
  // 30/30/40 P/F/C ratio scaled to target
  const protein = Math.round((target * 0.30) / 4)
  const fat     = Math.round((target * 0.27) / 9)
  const carbs   = Math.round((target * 0.43) / 4)
  const total   = protein * 4 + fat * 9 + carbs * 4
  const pPct = Math.round((protein * 4 / total) * 100)
  const fPct = Math.round((fat     * 9 / total) * 100)
  const cPct = 100 - pPct - fPct

  const thumbColor =
    energy <= -25 ? 'hsl(0,70%,53%)' :
    energy <= -15 ? 'hsl(20,70%,53%)' :
    energy <= -5  ? 'hsl(70,70%,50%)' :
                    'hsl(142,70%,45%)'

  const energyLabel =
    energy <= -25 ? 'Aggressive fat loss' :
    energy <= -15 ? 'Moderate fat loss' :
                    'Gradual fat loss'

  return (
    <div className="animate-in fade-in duration-500">
      <MagicHeading
        eyebrow="Quick demo"
        title="The macro planner"
        subtitle="Adjust any client's calorie target, macro split, and activity level — every change recomputes live and syncs to their phone."
      />

      <div className="space-y-5">
      {/* Narrative thought bubble — mirrors Screen 1's pattern: page
          subtitle describes the surface generically, thought bubble
          drives the specific in-demo action. */}
      <ThoughtBubble>
        Just got off the phone with Jake — he's been on the road and his commitment is slipping. Before he falls off completely, let's ease his deficit to −10% so he can stay in the game.
      </ThoughtBubble>

      {/* Macro plan card */}
      <div className="relative rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="absolute top-3 right-3"><SampleBadge /></div>
        <div className="flex items-center justify-between pr-24">
          <p className="text-xs font-semibold text-foreground">Macro plan · {CLIENT.name}</p>
        </div>

        {/* Energy slider — DRAGGABLE native range. Locks at −10%. */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: thumbColor }}>
              {energy > 0 ? '+' : ''}{Math.round(energy)}%
            </span>
            <div className="text-right">
              <p className="text-sm font-medium" style={{ color: thumbColor }}>{energyLabel}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{Math.round(tdee * (energy / 100))} kcal/day vs TDEE</p>
            </div>
          </div>
          {/* Interactive track: gradient + −10 target marker + thumb + native input */}
          <div className="relative h-5">
            <div className="absolute inset-0 rounded-full"
              style={{ background: 'linear-gradient(to right, hsl(0,70%,53%) 0%, hsl(60,70%,50%) 20%, hsl(142,70%,45%) 50%, hsl(60,70%,50%) 80%, hsl(0,70%,53%) 100%)' }}
            />
            {/* Thumb */}
            <div className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-lg"
              style={{
                left: `${((energy + 50) / 100) * 100}%`,
                backgroundColor: thumbColor,
                transition: 'background-color 200ms',
                boxShadow: locked
                  ? '0 0 0 4px hsl(75 70% 60% / 0.4), 0 0 16px hsl(75 70% 60% / 0.6)'
                  : '0 2px 8px rgba(0,0,0,0.4)',
              }}
            />
            {/* Native input — invisible but owns gestures */}
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={energy}
              onChange={handleSliderChange}
              disabled={locked}
              className="absolute inset-0 w-full h-full opacity-0"
              style={{ cursor: locked ? 'not-allowed' : 'grab', touchAction: 'none' }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>−50%</span><span>−25%</span><span>0</span><span>+25%</span><span>+50%</span>
          </div>
          {/* Drag hint — guides the user to interact, disappears on lock */}
          <p className={`mt-3 text-center text-xs transition-all ${locked ? 'text-primary font-semibold' : 'text-muted-foreground animate-pulse'}`}>
            {locked
              ? 'Perfect, now let\'s apply'
              : '👆 Drag the slider toward −10%'}
          </p>
        </div>

        {/* Target + macro bar */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'BMR',    value: 1647, hi: false },
            { label: 'TDEE',   value: tdee, hi: false },
            { label: 'Target', value: target, hi: true  },
          ].map(({ label, value, hi }) => (
            <div key={label} className={`rounded-xl border p-3 text-center ${hi ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${hi ? 'text-primary' : ''}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground">kcal</p>
            </div>
          ))}
        </div>

        {/* Macro bar */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Daily macros</p>
          <div className="flex h-2 w-full overflow-hidden rounded-full">
            <div className="bg-blue-400"    style={{ width: `${pPct}%`, transition: 'width 200ms' }} />
            <div className="bg-amber-400"   style={{ width: `${fPct}%`, transition: 'width 200ms' }} />
            <div className="bg-emerald-400" style={{ width: `${cPct}%`, transition: 'width 200ms' }} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div><span className="font-semibold text-blue-400 tabular-nums">{protein}g</span> <span className="text-muted-foreground">({pPct}%)</span><p className="text-muted-foreground mt-0.5">Protein</p></div>
            <div><span className="font-semibold text-amber-400 tabular-nums">{fat}g</span> <span className="text-muted-foreground">({fPct}%)</span><p className="text-muted-foreground mt-0.5">Fat</p></div>
            <div><span className="font-semibold text-emerald-400 tabular-nums">{carbs}g</span> <span className="text-muted-foreground">({cPct}%)</span><p className="text-muted-foreground mt-0.5">Carbs</p></div>
          </div>
        </div>
      </div>

      {/* Apply adjustment — disabled until the slider locks at −10%.
          Once clicked, fires the confirmation chip and advances. */}
      <button
        type="button"
        onClick={handleApply}
        disabled={!locked || confirmed}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {confirmed ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Syncing to {CLIENT.name.split(' ')[0]}...</>
        ) : (
          <><Sparkles className="h-4 w-4" /> Apply adjustment</>
        )}
      </button>

      </div>
    </div>
  )
}

// ── Screen 3 — Chat (auto-type → send → typing → reply → end) ──────────────

const COACH_NAME = 'Coach Taz'
const COACH_PHOTO = '/preview-coach-taz.jpg'

// Pre-existing thread — visible the moment the screen opens. Establishes
// that this is an ongoing relationship, not a fresh chat. The celebration
// exchange from May 20 is the LAST positive contact before Jake went on
// the road and stopped logging (the gap surfaced on Screen 1).
const OLD_JAKE_MESSAGE =
  "Just hit a 58 bpm resting low today 🔥🔥 PR'd the bench yesterday 💪 Can't believe how far I've come 🙏"
const OLD_COACH_REPLY =
  "That's the result of all the cardio and hard work you've been putting in. I'm just guiding, this is all you, buddy. So proud of you 🙌"
const OLD_JAKE_TIMESTAMP = 'May 20, 6:42 PM'
const OLD_COACH_TIMESTAMP = 'May 20, 6:51 PM'

// Today's new exchange — coach informs Jake of the plan adjustment from
// Screen 2 (calorie target derived from TDEE 2840 × 0.90 = 2,556 kcal).
// If the slider lock value or TDEE constant on Screen 2 changes, update
// the number here too.
const COACH_NEW_MESSAGE =
  "Hey Jake, just updated your plan like we agreed. Your daily calories are now at 2,556, so you've got room to breathe while you're traveling. Take a look when you get a minute and let me know if you need anything! 👊"
const JAKE_NEW_REPLY =
  "Yep, just saw it. I really appreciate you keeping up with me, it's just a struggle sometimes. I definitely can manage this new plan till I'm back."
const NEW_COACH_TIMESTAMP = '2:34 PM'
const NEW_JAKE_TIMESTAMP = '2:36 PM'

// Timing — pacing the demo so the user can read each step without it
// dragging. 2s initial pause so the user takes in the pre-existing
// thread + sees the cursor blinking in the empty input, then auto-type
// at ~55ms/char (slow enough to read along).
const CHAT_INITIAL_PAUSE_MS = 2000
const CHAT_TYPE_SPEED_MS = 55
const CHAT_SENT_TO_ACTIVE_MS = 1000   // status flips Active 1s after send
const CHAT_ACTIVE_TO_TYPING_MS = 1200 // Jake starts typing 1.2s after going online
const CHAT_TYPING_TO_REPLY_MS = 2800  // Jake's typing duration

function ChatBubble({ side, name, photo, timestamp, children }) {
  const isOut = side === 'out'
  return (
    <div className={`flex items-end gap-2 ${isOut ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <img src={photo} alt={name} className="h-7 w-7 rounded-full object-cover shrink-0" />
      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
        isOut
          ? 'bg-primary text-primary-foreground rounded-br-sm'
          : 'bg-card border border-border text-foreground rounded-bl-sm'
      }`}>
        <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${isOut ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{name}</p>
        <p className="text-sm leading-relaxed">{children}</p>
        {timestamp && (
          <p className={`text-[10px] mt-1 ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground/60'}`}>{timestamp}</p>
        )}
      </div>
    </div>
  )
}

// Day separator — thin centered label flanked by hairlines. Visually
// punctuates the gap between the older conversation (May 20) and today's
// exchange. Matches the iMessage / WhatsApp pattern for day breaks.
function DaySeparator({ label }) {
  return (
    <div className="flex items-center gap-3 py-1 my-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function TypingIndicator({ name, photo }) {
  return (
    <div className="flex items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <img src={photo} alt={name} className="h-7 w-7 rounded-full object-cover shrink-0" />
      <div className="rounded-2xl rounded-bl-sm bg-card border border-border px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

export function ScreenChat({ active, onAdvance }) {
  // Phases:
  //   idle           → 2s pause. Pre-existing thread visible, status
  //                    "Last seen 2 hours ago", cursor blinks in empty
  //                    input (coach about to type).
  //   typing         → coach's calorie-update message auto-types in
  //                    input at ~55ms/char. Cursor stays SOLID.
  //   ready-to-send  → typing done, Send glows. Waits for click.
  //   sent           → coach's bubble lands in thread (with "Today"
  //                    separator above). Status still offline for 1s.
  //   jake-active    → status flips to "Active now". Jake hasn't
  //                    typed yet (1.2s pause).
  //   jake-typing    → typing indicator appears.
  //   jake-replied   → Jake's reply lands. End conversation arms.
  const [phase, setPhase] = useState('idle')
  const [draft, setDraft] = useState('')
  const threadRef = useRef(null)

  // Reset state when screen becomes inactive (back nav, etc.)
  useEffect(() => {
    if (!active) {
      setPhase('idle')
      setDraft('')
    }
  }, [active])

  // 2-second pause before typing starts — gives the user time to take
  // in the pre-existing thread + the "Last seen" status + the blinking
  // cursor in the empty input.
  useEffect(() => {
    if (phase !== 'idle' || !active) return
    const t = setTimeout(() => setPhase('typing'), CHAT_INITIAL_PAUSE_MS)
    return () => clearTimeout(t)
  }, [phase, active])

  // Auto-type the coach's new message char-by-char during typing phase
  useEffect(() => {
    if (phase !== 'typing' || !active) return
    if (draft.length >= COACH_NEW_MESSAGE.length) {
      setPhase('ready-to-send')
      return
    }
    const t = setTimeout(() => {
      setDraft(COACH_NEW_MESSAGE.slice(0, draft.length + 1))
    }, CHAT_TYPE_SPEED_MS)
    return () => clearTimeout(t)
  }, [phase, draft, active])

  // Auto-scroll the thread as new bubbles arrive
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [phase])

  // Header status — offline until 1s after coach's send, then flips
  // to "Active now" (Jake comes online) BEFORE the typing indicator.
  const isJakeOnline =
    phase === 'jake-active' || phase === 'jake-typing' || phase === 'jake-replied'
  const headerStatus = isJakeOnline
    ? { dotColor: 'bg-emerald-500', text: 'Active now', animate: true }
    : { dotColor: 'bg-muted-foreground/40', text: 'Last seen 2 hours ago', animate: false }

  function handleSend() {
    if (phase !== 'ready-to-send') return
    setPhase('sent')
    setDraft('')
    setTimeout(() => setPhase('jake-active'), CHAT_SENT_TO_ACTIVE_MS)
    setTimeout(() => setPhase('jake-typing'), CHAT_SENT_TO_ACTIVE_MS + CHAT_ACTIVE_TO_TYPING_MS)
    setTimeout(
      () => setPhase('jake-replied'),
      CHAT_SENT_TO_ACTIVE_MS + CHAT_ACTIVE_TO_TYPING_MS + CHAT_TYPING_TO_REPLY_MS
    )
  }

  // Cursor visibility + blink rules:
  //   - idle    → empty input, cursor BLINKS (coach about to type)
  //   - typing  → input filling, cursor STAYS SOLID (mid-keystroke)
  //   - rest    → no cursor
  const showCursor = phase === 'idle' || phase === 'typing'
  const cursorBlinks = phase === 'idle'

  // "Today" separator + today's new exchange appear once coach sends
  const newExchangeVisible =
    phase === 'sent' ||
    phase === 'jake-active' ||
    phase === 'jake-typing' ||
    phase === 'jake-replied'

  return (
    <div className="animate-in fade-in duration-500">
      <MagicHeading
        eyebrow="Quick demo"
        title="Send Jake the update"
        subtitle="A direct line to every client. Updates, check-ins, the kind of touchpoints that keep them in the game."
      />

      <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
        {/* Header — status flips from "Last seen 2 hours ago" → "Active
            now" 1s after the coach sends, BEFORE Jake's typing dots. */}
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <img src={CLIENT.photo} alt={CLIENT.name} className="h-9 w-9 rounded-full object-cover" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{CLIENT.name}</p>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${headerStatus.dotColor} ${headerStatus.animate ? 'animate-pulse' : ''}`} />
              <span className="transition-colors">{headerStatus.text}</span>
            </p>
          </div>
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Thread — pre-existing convo from May 20 always visible to
            establish ongoing relationship. Today's exchange appends
            below once coach sends. */}
        <div ref={threadRef} className="bg-muted/10 px-4 py-4 space-y-3 min-h-[340px] max-h-[460px] overflow-y-auto">
          <DaySeparator label="May 20" />
          <ChatBubble side="in" name={CLIENT.name} photo={CLIENT.photo} timestamp={OLD_JAKE_TIMESTAMP}>
            {OLD_JAKE_MESSAGE}
          </ChatBubble>
          <ChatBubble side="out" name={COACH_NAME} photo={COACH_PHOTO} timestamp={OLD_COACH_TIMESTAMP}>
            {OLD_COACH_REPLY}
          </ChatBubble>

          {newExchangeVisible && (
            <>
              <DaySeparator label="Today" />
              <ChatBubble side="out" name={COACH_NAME} photo={COACH_PHOTO} timestamp={NEW_COACH_TIMESTAMP} key="coach-new">
                {COACH_NEW_MESSAGE}
              </ChatBubble>
            </>
          )}
          {phase === 'jake-typing' && (
            <TypingIndicator name={CLIENT.name} photo={CLIENT.photo} />
          )}
          {phase === 'jake-replied' && (
            <ChatBubble side="in" name={CLIENT.name} photo={CLIENT.photo} timestamp={NEW_JAKE_TIMESTAMP} key="jake-new">
              {JAKE_NEW_REPLY}
            </ChatBubble>
          )}
        </div>

        {/* Input row — cursor BLINKS during idle (the pause before typing
            starts, mimicking a coach about to write) and STAYS SOLID
            while typing (real text cursors don't blink mid-keystroke).
            Disappears once typing is done or the message is sent. */}
        <div className="border-t border-border bg-card px-3 py-3 flex items-end gap-2">
          <div className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2.5 min-h-[40px]">
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {draft}
              {showCursor && (
                <span className={`inline-block w-0.5 h-4 bg-primary ml-0.5 align-middle ${cursorBlinks ? 'animate-caret-blink' : ''}`} />
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={phase !== 'ready-to-send'}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all shrink-0 ${
              phase === 'ready-to-send'
                ? 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95 shadow-[0_0_16px_-2px_hsl(75_70%_60%/0.6)] animate-pulse'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* End conversation button — appears once Jake's reply lands */}
      <div className={`mt-5 transition-all duration-500 ${phase === 'jake-replied' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
        <button
          type="button"
          onClick={onAdvance}
          disabled={phase !== 'jake-replied'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all"
        >
          End conversation <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function CoachMagicPreview() {
  const [screen, setScreen] = useState(0)

  function go(delta) {
    setScreen(s => Math.max(0, Math.min(TOTAL - 1, s + delta)))
  }
  function advance() {
    setScreen(s => Math.min(TOTAL - 1, s + 1))
  }

  // Force dark theme for the preview
  useEffect(() => {
    document.documentElement.classList.remove('light')
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Top chrome */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Preview · Coach signup magic ×3</p>
            <p className="text-xs text-muted-foreground/70">Arc B · drafted May 25 2026</p>
          </div>
          <ProgressDots active={screen} total={TOTAL} />
        </div>

        {/* Screen content — each screen drives its own advancement via the
            onAdvance callback. The Back/Next nav stays for review. */}
        <div className="min-h-[600px]">
          {screen === 0 && <ScreenDiagnosis onAdvance={advance} />}
          {screen === 1 && <ScreenFix active={screen === 1} onAdvance={advance} />}
          {screen === 2 && <ScreenChat active={screen === 2} onAdvance={advance} />}
        </div>

        {/* Nav — Back always available, Next disabled on the last screen */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button onClick={() => go(-1)} disabled={screen === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <p className="text-xs text-muted-foreground tabular-nums">{screen + 1} / {TOTAL}</p>
          <button onClick={() => go(+1)} disabled={screen === TOTAL - 1}
            className="flex items-center gap-1.5 rounded-lg bg-primary/30 px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed">
            Skip <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
