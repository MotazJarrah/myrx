/**
 * Onboarding demo — Act II of the new sign-up journey.
 *
 * Standalone testbed at /onboarding-demo. This is the "magic moment" screen:
 * the user picks one lift, enters one weight × one rep count, and the app
 * reveals their full strength profile (rep-max curve + comparable lifts).
 *
 * Design constraints baked in here:
 *   • No typing — sliders + tap selections only
 *   • Input pinned to the top of the screen (keyboard-safe)
 *   • Unit toggle (lb / kg) honored throughout — math stored in kg
 *   • Animated reveal so the math feels diagnostic, not transactional
 *
 * Once the rest of the journey (Acts I / III–VI) is built around this,
 * this page gets folded in. Until then it lives at its own URL so the
 * production sign-up flow stays untouched.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'
import { ChevronLeft, Sparkles, Sun, Moon, ArrowRight } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import {
  estimate1RM,
  repMaxCurve,
  comparableLifts,
  trainingZone,
  lbToKg,
  kgToLb,
} from '../lib/projections'

// ── Lift catalog ──────────────────────────────────────────────────────
// Stuck to barbell compounds for v1: weight × reps maps cleanly to load.
// Pull-up / push-up are added later once the pre-onboarding flow has
// captured bodyweight (their 1RM math is BW-relative).
const LIFTS = [
  { id: 'bench',    name: 'Bench Press',     desc: 'Barbell • upper body push',   defaultLb: 135 },
  { id: 'squat',    name: 'Back Squat',      desc: 'Barbell • lower body',        defaultLb: 185 },
  { id: 'deadlift', name: 'Deadlift',        desc: 'Barbell • total body',        defaultLb: 225 },
  { id: 'ohp',      name: 'Overhead Press',  desc: 'Barbell • shoulders',         defaultLb: 95  },
  { id: 'row',      name: 'Bent-over Row',   desc: 'Barbell • upper body pull',   defaultLb: 115 },
]

const LIFT_NAMES = Object.fromEntries(LIFTS.map((l) => [l.id, l.name]))
LIFT_NAMES.bench    = 'Bench Press'
LIFT_NAMES.squat    = 'Back Squat'
LIFT_NAMES.deadlift = 'Deadlift'
LIFT_NAMES.ohp      = 'Overhead Press'
LIFT_NAMES.row      = 'Bent-over Row'

// ── Counter animation hook ────────────────────────────────────────────
// Eased count-up from 0 → target. The reveal screen calls this for the
// 1RM number so it ticks up over ~900ms instead of just slamming in.
function useCountUp(target, duration = 900, deps = []) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let raf
    let start = null
    function step(ts) {
      if (start === null) start = ts
      const elapsed = ts - start
      const t = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(target * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, ...deps])
  return val
}

// ── Format helpers ────────────────────────────────────────────────────
const round5 = (n) => Math.round(n / 5) * 5

function displayWeight(weightKg, unit) {
  const v = unit === 'lb' ? kgToLb(weightKg) : weightKg
  return round5(v)
}

// ── Shell ─────────────────────────────────────────────────────────────
function Logo() {
  return (
    <span className="text-lg font-bold" style={{ letterSpacing: '-0.02em' }}>
      My<span className="text-primary">RX</span>
    </span>
  )
}

export default function OnboardingDemo() {
  const { theme, toggle } = useTheme()
  const [stage, setStage] = useState('select') // 'select' | 'effort' | 'reveal'
  const [lift, setLift] = useState(null)
  const [unit, setUnit] = useState('lb')
  // weight is stored in the user's currently-selected unit; converted
  // to kg inside the math layer.
  const [weight, setWeight] = useState(135)
  const [reps, setReps] = useState(5)

  // When the user picks a lift, seed the weight slider with a sane default
  // so they're not staring at "0 lb".
  function pickLift(l) {
    setLift(l)
    const def = unit === 'lb' ? l.defaultLb : Math.round(lbToKg(l.defaultLb))
    setWeight(def)
    setReps(5)
    setStage('effort')
  }

  function changeUnit(newUnit) {
    if (newUnit === unit) return
    // Preserve approximate physical load when toggling: 135 lb → 60 kg, etc.
    setWeight((w) =>
      newUnit === 'kg' ? Math.round(lbToKg(w)) : Math.round(kgToLb(w)),
    )
    setUnit(newUnit)
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Ambient backdrop — same gradient + grid as Auth screens */}
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-6">
        <Link href="/"><Logo /></Link>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-start px-6 pt-8 pb-12">
        <div className="w-full">
          {stage === 'select' && (
            <SelectStage onPick={pickLift} />
          )}
          {stage === 'effort' && lift && (
            <EffortStage
              lift={lift}
              unit={unit}
              weight={weight}
              reps={reps}
              onUnitChange={changeUnit}
              onWeightChange={setWeight}
              onRepsChange={setReps}
              onBack={() => setStage('select')}
              onContinue={() => setStage('reveal')}
            />
          )}
          {stage === 'reveal' && lift && (
            <RevealStage
              lift={lift}
              unit={unit}
              weight={weight}
              reps={reps}
              onBack={() => setStage('effort')}
              onRestart={() => { setStage('select'); setLift(null) }}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Stage 1 — Pick a lift
// ────────────────────────────────────────────────────────────────────────
function SelectStage({ onPick }) {
  return (
    <div className="animate-rise">
      <p className="text-xs uppercase tracking-wider text-primary font-medium mb-2">Step 1 of 3</p>
      <h1 className="text-2xl font-semibold tracking-tight">Pick a lift you've done before</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We'll project your full strength profile from a single set. Don't have to choose your strongest — just pick one you remember.
      </p>

      <div className="mt-8 space-y-2.5">
        {LIFTS.map((l, i) => (
          <button
            key={l.id}
            onClick={() => onPick(l)}
            className="group w-full flex items-center justify-between gap-4 rounded-xl border border-border bg-card/80 px-5 py-4 text-left backdrop-blur transition-all hover:border-primary/50 hover:bg-card animate-rise"
            style={{ animationDelay: `${60 + i * 40}ms` }}
          >
            <div>
              <div className="text-sm font-semibold text-foreground">{l.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{l.desc}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Stage 2 — Effort entry (sliders, no typing)
// ────────────────────────────────────────────────────────────────────────
function EffortStage({ lift, unit, weight, reps, onUnitChange, onWeightChange, onRepsChange, onBack, onContinue }) {
  // Slider ranges. Wide enough for novice → strong-advanced lifters.
  const weightRange = unit === 'lb' ? { min: 0, max: 600, step: 5 } : { min: 0, max: 275, step: 2.5 }
  const repsRange = { min: 1, max: 15, step: 1 }

  return (
    <div className="animate-rise">
      <button
        onClick={onBack}
        className="inline-flex h-9 w-9 -ml-2 mb-4 items-center justify-center rounded-full text-foreground hover:bg-accent/40 transition-colors"
        aria-label="Back"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <p className="text-xs uppercase tracking-wider text-primary font-medium mb-2">Step 2 of 3</p>
      <h1 className="text-2xl font-semibold tracking-tight">{lift.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        How heavy and for how many reps? Be honest — overestimates skew everything downstream.
      </p>

      {/* Unit toggle */}
      <div className="mt-6 inline-flex rounded-full border border-border p-1 bg-card/40 backdrop-blur">
        {['lb', 'kg'].map((u) => (
          <button
            key={u}
            onClick={() => onUnitChange(u)}
            className={`px-4 py-1 text-xs font-semibold rounded-full transition-all ${
              unit === u
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {u.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Weight slider */}
      <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Weight</label>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums text-foreground">{weight}</span>
          <span className="text-base text-muted-foreground">{unit}</span>
        </div>
        <input
          type="range"
          min={weightRange.min}
          max={weightRange.max}
          step={weightRange.step}
          value={weight}
          onChange={(e) => onWeightChange(Number(e.target.value))}
          className="mt-4 w-full accent-primary"
        />
      </div>

      {/* Reps slider */}
      <div className="mt-3 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Reps</label>
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums text-foreground">{reps}</span>
          <span className="text-base text-muted-foreground">reps</span>
        </div>
        <input
          type="range"
          min={repsRange.min}
          max={repsRange.max}
          step={repsRange.step}
          value={reps}
          onChange={(e) => onRepsChange(Number(e.target.value))}
          className="mt-4 w-full accent-primary"
        />
      </div>

      <button
        onClick={onContinue}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <Sparkles className="h-4 w-4" />
        See my projections
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Stage 3 — The reveal (animated diagnostic)
// ────────────────────────────────────────────────────────────────────────
function RevealStage({ lift, unit, weight, reps, onBack, onRestart }) {
  // Convert input to kg for the math, results stay in kg until display.
  const weightKg = unit === 'lb' ? lbToKg(weight) : weight
  const oneRMKg = useMemo(() => estimate1RM(weightKg, reps), [weightKg, reps])
  const curve   = useMemo(() => repMaxCurve(weightKg, reps), [weightKg, reps])
  const comp    = useMemo(() => comparableLifts(lift.id, oneRMKg), [lift.id, oneRMKg])
  const zone    = trainingZone(reps)

  // Counter for the headline 1RM number — eases up from 0
  const oneRMDisplay = displayWeight(oneRMKg, unit)
  const counted = useCountUp(oneRMDisplay, 900)

  // Brief "thinking" delay before the numbers appear, to sell the idea
  // that the projection is a computation rather than a static lookup.
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 700)
    return () => clearTimeout(t)
  }, [])

  if (!revealed) {
    return (
      <div className="animate-rise flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <div className="relative h-12 w-12">
          <Sparkles className="h-12 w-12 text-primary animate-pulse" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Computing your strength profile…</p>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="inline-flex h-9 w-9 -ml-2 mb-4 items-center justify-center rounded-full text-foreground hover:bg-accent/40 transition-colors"
        aria-label="Back"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <p className="text-xs uppercase tracking-wider text-primary font-medium mb-2 animate-rise">Step 3 of 3</p>
      <h1 className="text-2xl font-semibold tracking-tight animate-rise">Your strength profile</h1>
      <p className="mt-1.5 text-sm text-muted-foreground animate-rise">
        Based on <span className="text-foreground font-medium">{weight} {unit} × {reps} reps</span> of {lift.name.toLowerCase()}.
      </p>

      {/* Headline 1RM */}
      <div className="mt-6 rounded-2xl border border-primary/30 bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '60ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Estimated 1-rep max</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-5xl font-bold tabular-nums text-primary">
            {round5(counted)}
          </span>
          <span className="text-lg text-muted-foreground font-medium">{unit}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The most you could lift {lift.name.toLowerCase()} for a single rep, projected from your set.
        </p>
      </div>

      {/* Rep-max table */}
      <div className="mt-3 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '180ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Your rep-max curve
        </p>
        <div className="space-y-2">
          {curve.map((row) => (
            <div key={row.reps} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground tabular-nums w-10">{row.reps} rep{row.reps > 1 ? 's' : ''}</span>
              <div className="mx-3 flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${(displayWeight(row.weight, unit) / oneRMDisplay) * 100}%`,
                  }}
                />
              </div>
              <span className="font-semibold tabular-nums text-foreground w-20 text-right">
                {displayWeight(row.weight, unit)} {unit}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Comparable lifts */}
      <div className="mt-3 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '300ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Where your other lifts should land
        </p>
        <div className="space-y-2.5">
          {comp.map((c) => (
            <div key={c.lift} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{LIFT_NAMES[c.lift]}</span>
              <span className="font-semibold tabular-nums text-foreground">
                {displayWeight(c.weight, unit)} {unit}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Average ratios for an intermediate lifter. If a lift is well below
          its expected number, that's a focus area worth working on.
        </p>
      </div>

      {/* Training zone */}
      <div className="mt-3 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '420ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Training zone
        </p>
        <p className="text-base font-semibold text-foreground capitalize">
          {zone.zone}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {zone.desc}
        </p>
      </div>

      <button
        onClick={onRestart}
        className="mt-8 w-full rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground hover:bg-card transition-colors animate-rise"
        style={{ animationDelay: '540ms' }}
      >
        Try a different lift
      </button>
    </div>
  )
}
