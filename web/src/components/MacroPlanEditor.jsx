/**
 * MacroPlanEditor — the unified macro-plan UI used on all 4 planning surfaces:
 *
 *   • /admin/profile          → Macro Plan tab (admin's own plan)
 *   • /admin/user/:id         → Macro Plan tab (admin manages client)
 *   • /coach/profile          → Macro Plan tab (coach's own plan)
 *   • /coach/client/:id       → Macro Plan section (coach manages client)
 *
 * Structure (mirrors the old AdminUserPlan flow that the user already
 * knew, plus the new pieces):
 *
 *   1. Body composition picker (silhouettes) — refines BMR ±5%
 *   2. Activity level (StepSlider, 5 discrete stops)
 *   3. Goal & pace — preset chips that snap the energy slider, PLUS
 *      the gradient slider for free-hand adjustment
 *   4. Goal weight (start + goal inputs with kg/lb toggle)
 *   5. Macro split — preset chips that seed the 3 macro grams sliders,
 *      PLUS the sliders with hard caps + proportional auto-balance
 *   6. Correction factor slider
 *   7. Meals chips (UP + 2-6)
 *   8. Coach notes
 *
 * Live preview pane on the right with BMR / TDEE / Target tiles, macro
 * bar, per-meal breakdown, timeline projection. Scroll-drift inertia
 * via useScrollDrift hook.
 */

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import {
  AlertCircle, Check, Loader2, TrendingDown, TrendingUp,
  Utensils, Info, Sparkles,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  calcBMR, calcTDEE, calcDailyTarget, calcTimeline, calcPerMeal,
  ACTIVITY_FACTORS, toKg, calcAge,
} from '../lib/calorieFormulas'
import { useScrollDrift } from '../lib/useScrollDrift'
import BodyCompPicker from './BodyCompPicker'

// ── Constants ───────────────────────────────────────────────────────────────

const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 }

const PROTEIN_FLOOR_G_PER_KG = 1.6
const FAT_FLOOR_G_PER_KG     = 0.5
const FAT_FLOOR_PCT_OF_CALS  = 0.20

// Pace presets — map to a specific energy_balance_pct so picking a chip
// snaps the gradient slider. Mirrors the mobile wizard's pace options.
const PACE_PRESETS = [
  { key: 'lose_hard',     label: 'Lose: Aggressive',  pct: -25 },
  { key: 'lose_steady',   label: 'Lose: Steady',      pct: -15 },
  { key: 'lose_gradual',  label: 'Lose: Gradual',     pct: -10 },
  { key: 'maintain',      label: 'Maintain',          pct:   0 },
  { key: 'gain_gradual',  label: 'Gain: Gradual',     pct:  10 },
  { key: 'gain_steady',   label: 'Gain: Steady',      pct:  15 },
  { key: 'gain_hard',     label: 'Gain: Aggressive',  pct:  25 },
]

// Macro presets — seed initial P/F/C ratios.
const MACRO_PRESETS = [
  { key: 'balanced',     label: 'Balanced',     sub: 'Default starting point', protein: 0.30, fat: 0.30, carbs: 0.40, keto: false },
  { key: 'high_protein', label: 'High-Protein', sub: 'Cuts, lifters, recomp',  protein: 0.40, fat: 0.30, carbs: 0.30, keto: false },
  { key: 'high_carb',    label: 'High-Carb',    sub: 'Endurance athletes',     protein: 0.25, fat: 0.20, carbs: 0.55, keto: false },
  { key: 'keto',         label: 'Keto',         sub: '≤ 50g carbs, fat fueled', protein: 0.25, fat: 0.70, carbs: 0.05, keto: true  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function bodyCompFactor(band) {
  if (band === 'lean') return 1.05
  if (band === 'high') return 0.95
  return 1.00
}

function getEnergyLabel(pct) {
  if (pct <= -25) return 'Aggressive fat loss'
  if (pct <= -15) return 'Moderate fat loss'
  if (pct <= -5)  return 'Gradual fat loss'
  if (pct <   5)  return 'Maintenance'
  if (pct <  15)  return 'Gradual muscle gain'
  if (pct <  25)  return 'Moderate muscle gain'
  return 'Aggressive bulk'
}

function energyColor(pct) {
  const t = Math.abs(pct) / 50
  const hue = Math.round(142 * (1 - t))
  const light = Math.round(45 + t * 8)
  return `hsl(${hue}, 70%, ${light}%)`
}

function computeFloors({ weight_kg, total_kcal, isKeto }) {
  if (!weight_kg || !total_kcal) return { protein: 0, fat: 0, carbs: 0, carbsCeiling_g: Infinity }
  return {
    protein: Math.round(weight_kg * PROTEIN_FLOOR_G_PER_KG),
    fat:     Math.max(
      Math.round(weight_kg * FAT_FLOOR_G_PER_KG),
      Math.round((total_kcal * FAT_FLOOR_PCT_OF_CALS) / KCAL_PER_G.fat),
    ),
    carbs:           0,
    carbsCeiling_g:  isKeto ? 50 : Infinity,
  }
}

// Apply a preset to total kcal, respecting floors AND making the grams
// sum to EXACTLY total_kcal (within 1 kcal of rounding noise).
//
// Why: simple `target * preset.protein / 4` produces values that ignore
// the protein/fat floors (e.g. a small woman with target 1228 kcal and
// floor 118g protein needs P locked at 118 even if Balanced wants 92).
// Without this clamping, the macro bar shows e.g. 92P/41F/123C summing
// to 1229 — but the slider then clamps protein up to 118 silently and
// the totals go out of sync. This function does the floor enforcement
// up front and rebalances the remainder.
function applyPreset(preset, total_kcal, floors) {
  if (!total_kcal) return { protein: 0, fat: 0, carbs: 0 }

  // Ideal grams from preset ratios
  let p = (total_kcal * preset.protein) / KCAL_PER_G.protein
  let f = (total_kcal * preset.fat)     / KCAL_PER_G.fat
  let c = (total_kcal * preset.carbs)   / KCAL_PER_G.carbs

  // If protein < floor, lock to floor and re-split remainder F:C in
  // their preset ratio.
  if (p < floors.protein) {
    p = floors.protein
    const remaining = total_kcal - p * KCAL_PER_G.protein
    const fcSum     = preset.fat + preset.carbs || 1
    f = (remaining * (preset.fat   / fcSum)) / KCAL_PER_G.fat
    c = (remaining * (preset.carbs / fcSum)) / KCAL_PER_G.carbs
  }
  // If fat now < floor, lock fat and give the rest to carbs.
  if (f < floors.fat) {
    f = floors.fat
    c = (total_kcal - p * KCAL_PER_G.protein - f * KCAL_PER_G.fat) / KCAL_PER_G.carbs
  }
  // Keto ceiling on carbs: cap, push the excess to fat.
  if (floors.carbsCeiling_g !== Infinity && c > floors.carbsCeiling_g) {
    c = floors.carbsCeiling_g
    f = (total_kcal - p * KCAL_PER_G.protein - c * KCAL_PER_G.carbs) / KCAL_PER_G.fat
  }

  // Round + reconcile drift into the most flexible macro (carbs if not
  // keto-capped, else fat).
  const out = {
    protein: Math.max(floors.protein, Math.round(p)),
    fat:     Math.max(floors.fat,     Math.round(f)),
    carbs:   Math.max(0,              Math.round(c)),
  }
  if (floors.carbsCeiling_g !== Infinity && out.carbs > floors.carbsCeiling_g) {
    out.carbs = floors.carbsCeiling_g
  }
  return reconcileDrift(out, total_kcal, floors)
}

// Scale existing macros proportionally to a new target, preserving the
// user's relative P:F:C split. Used when the user moves the energy
// balance slider — we want the slider positions to stay PUT (because
// position == caloric %) while only the absolute grams change to match
// the new calorie budget. Floors are honored via reconcileDrift.
function scaleToTarget(prev, total_kcal, floors) {
  const prevTotal = prev.protein * KCAL_PER_G.protein +
                    prev.fat     * KCAL_PER_G.fat     +
                    prev.carbs   * KCAL_PER_G.carbs
  if (prevTotal <= 0) return prev
  const ratio = total_kcal / prevTotal
  const scaled = {
    protein: Math.max(floors.protein, Math.round(prev.protein * ratio)),
    fat:     Math.max(floors.fat,     Math.round(prev.fat     * ratio)),
    carbs:   Math.max(floors.carbs,   Math.round(prev.carbs   * ratio)),
  }
  if (floors.carbsCeiling_g !== Infinity && scaled.carbs > floors.carbsCeiling_g) {
    scaled.carbs = floors.carbsCeiling_g
  }
  return reconcileDrift(scaled, total_kcal, floors)
}

// Force `macros` to sum to exactly `total_kcal` by adjusting whichever
// macro has the most headroom. Always called as the LAST step so the
// macro bar's % labels add to 100% on every render.
function reconcileDrift(macros, total_kcal, floors) {
  const currentKcal = macros.protein * KCAL_PER_G.protein +
                      macros.fat     * KCAL_PER_G.fat     +
                      macros.carbs   * KCAL_PER_G.carbs
  let drift = total_kcal - currentKcal  // +ve = under target, -ve = over

  if (drift === 0) return macros
  const next = { ...macros }

  // Prefer carbs (4 kcal/g → finer adjustments). Fall back to fat if
  // carbs are at floor (drift down) or ceiling (drift up).
  const carbsCeil = floors.carbsCeiling_g
  const canMoveCarbs =
    (drift > 0 && (carbsCeil === Infinity || next.carbs < carbsCeil)) ||
    (drift < 0 && next.carbs > floors.carbs)

  if (canMoveCarbs) {
    const deltaG = Math.round(drift / KCAL_PER_G.carbs)
    let newCarbs = next.carbs + deltaG
    newCarbs = Math.max(floors.carbs, newCarbs)
    if (carbsCeil !== Infinity) newCarbs = Math.min(carbsCeil, newCarbs)
    next.carbs = newCarbs
  } else {
    const deltaG = Math.round(drift / KCAL_PER_G.fat)
    next.fat = Math.max(floors.fat, next.fat + deltaG)
  }
  return next
}

// Auto-rebalance: user dragged `changedKey` to `newValue`. The OTHER two
// macros absorb the calorie delta, distributed by their previous ratio.
// Always returns a result that sums to total_kcal exactly (via
// reconcileDrift).
function rebalance(prev, changedKey, newValue, floors, total_kcal) {
  // 1. Clamp the changed macro to its own floor/ceiling.
  let changed = Math.max(floors[changedKey], newValue)
  if (changedKey === 'carbs' && floors.carbsCeiling_g !== Infinity) {
    changed = Math.min(changed, floors.carbsCeiling_g)
  }

  const others = ['protein', 'fat', 'carbs'].filter(k => k !== changedKey)
  const [a, b] = others
  const remainingKcal = total_kcal - changed * KCAL_PER_G[changedKey]
  if (remainingKcal < 0) {
    // Changed macro alone already exceeds target — pin others to floor
    // and reconcile the changed one back down.
    const next = { ...prev, [changedKey]: changed, [a]: floors[a], [b]: floors[b] }
    const usedByFloors = floors[a] * KCAL_PER_G[a] + floors[b] * KCAL_PER_G[b]
    next[changedKey] = Math.max(
      floors[changedKey],
      Math.floor((total_kcal - usedByFloors) / KCAL_PER_G[changedKey]),
    )
    return reconcileDrift(next, total_kcal, floors)
  }

  // 2. Split remaining proportionally to a/b's previous kcal share.
  const prevAKcal = prev[a] * KCAL_PER_G[a]
  const prevBKcal = prev[b] * KCAL_PER_G[b]
  const prevSum   = prevAKcal + prevBKcal
  let aKcal, bKcal
  if (prevSum > 0) {
    aKcal = remainingKcal * (prevAKcal / prevSum)
    bKcal = remainingKcal - aKcal
  } else {
    aKcal = remainingKcal / 2
    bKcal = remainingKcal / 2
  }
  let aG = Math.round(aKcal / KCAL_PER_G[a])
  let bG = Math.round(bKcal / KCAL_PER_G[b])

  // 3. Apply floors/ceilings to a, then re-balance b with leftover.
  const aMin = floors[a]
  const bMin = floors[b]
  const aMax = a === 'carbs' && floors.carbsCeiling_g !== Infinity ? floors.carbsCeiling_g : Infinity
  const bMax = b === 'carbs' && floors.carbsCeiling_g !== Infinity ? floors.carbsCeiling_g : Infinity

  if (aG < aMin) {
    aG = aMin
    bG = Math.round((remainingKcal - aG * KCAL_PER_G[a]) / KCAL_PER_G[b])
  } else if (aG > aMax) {
    aG = aMax
    bG = Math.round((remainingKcal - aG * KCAL_PER_G[a]) / KCAL_PER_G[b])
  }
  if (bG < bMin) {
    bG = bMin
    aG = Math.round((remainingKcal - bG * KCAL_PER_G[b]) / KCAL_PER_G[a])
    aG = Math.max(aMin, Math.min(aMax, aG))
  } else if (bG > bMax) {
    bG = bMax
    aG = Math.round((remainingKcal - bG * KCAL_PER_G[b]) / KCAL_PER_G[a])
    aG = Math.max(aMin, Math.min(aMax, aG))
  }

  const next = { ...prev, [changedKey]: changed, [a]: aG, [b]: bG }
  return reconcileDrift(next, total_kcal, floors)
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children, hint }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  )
}

// StepSlider — discrete-stop slider (Activity level uses it)
function StepSlider({ options, value, onChange }) {
  const count = options.length
  const idx = options.findIndex(o => o.value === value)
  const safeIdx = idx === -1 ? 0 : idx
  const current = options[safeIdx]
  const stopPos = (i) => count === 1 ? 50 : (i / (count - 1)) * 100
  const fillPct = stopPos(safeIdx)
  return (
    <div className="space-y-3">
      <div className="relative h-8 select-none">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-all" style={{ width: `${fillPct}%` }} />
        {options.map((opt, i) => {
          const active = i <= safeIdx
          const isSelected = i === safeIdx
          return (
            <div
              key={opt.value}
              className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-all"
              style={{
                left: `${stopPos(i)}%`,
                width: isSelected ? '20px' : '12px',
                height: isSelected ? '20px' : '12px',
                backgroundColor: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)',
                boxShadow: isSelected ? '0 0 0 3px hsl(var(--primary) / 0.25)' : 'none',
                zIndex: 1,
              }}
            />
          )
        })}
        <input
          type="range" min="0" max={count - 1} step="1" value={safeIdx}
          onChange={e => onChange(options[Number(e.target.value)].value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ touchAction: 'none', margin: 0 }}
        />
      </div>
      <div className="flex items-end justify-between text-[10px] text-muted-foreground">
        {options.map((opt, i) => (
          <span key={opt.value}
            className={`flex-1 text-center transition-colors ${i === safeIdx ? 'font-semibold text-foreground' : ''}`}
            style={{ textAlign: i === 0 ? 'left' : i === count - 1 ? 'right' : 'center' }}>
            {opt.short || opt.label.split(' ')[0]}
          </span>
        ))}
      </div>
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-center">
        <p className="text-sm font-medium">{current.label}</p>
        {current.description && <p className="text-[11px] text-muted-foreground mt-0.5">{current.description}</p>}
      </div>
    </div>
  )
}

// EnergySlider — gradient slider with visible thumb (−50% to +50%).
//
// Commit-on-release pattern (LOCKED May 25 2026): the parent's `value`
// is the COMMITTED energy %. While the user drags, the slider keeps an
// internal `draft` that drives its own visual (thumb position, color,
// label, kcalAdj). The parent's onChange only fires on release
// (pointerup / mouseup / touchend / blur / Enter / keyup-on-arrows).
// This stops the target kcal and the macro sliders from recomputing on
// every pixel of drag — they update once, cleanly, when the user lets
// go. External value updates (e.g. pace-preset chip click) override the
// draft via the sync useEffect.
function EnergySlider({ value, onChange, tdee }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  const color = energyColor(draft)
  const label = getEnergyLabel(draft)
  const kcalAdj = tdee ? Math.round(tdee * (draft / 100)) : null
  const gradientStyle = {
    background: 'linear-gradient(to right, hsl(0,70%,53%) 0%, hsl(60,70%,50%) 20%, hsl(142,70%,45%) 50%, hsl(60,70%,50%) 80%, hsl(0,70%,53%) 100%)',
  }

  const commit = () => {
    if (draft !== value) onChange(draft)
  }
  const commitOnArrow = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp'   || e.key === 'ArrowDown' ||
        e.key === 'Home'      || e.key === 'End'       ||
        e.key === 'PageUp'    || e.key === 'PageDown') commit()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>
          {draft > 0 ? '+' : ''}{draft}%
        </span>
        <div className="text-right">
          <p className="text-sm font-medium" style={{ color }}>{label}</p>
          {kcalAdj !== null && (
            <p className="text-xs text-muted-foreground">{kcalAdj > 0 ? '+' : ''}{kcalAdj} kcal/day vs TDEE</p>
          )}
        </div>
      </div>
      <div className="relative">
        <div className="h-2 w-full rounded-full" style={gradientStyle} />
        <input
          type="range" min="-50" max="50" step="1" value={draft}
          onChange={e => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commitOnArrow}
          onBlur={commit}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ margin: 0 }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-lg transition-all"
          style={{ left: `${((draft + 50) / 100) * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>−50%</span><span>−25%</span><span>0</span><span>+25%</span><span>+50%</span>
      </div>
    </div>
  )
}

// MacroSlider — REAL native range input with CSS-styled thumb. The track
// + fill divs sit BEHIND (pointer-events-none) so the input owns gestures
// cleanly. Fixes the "page scrolls when I grab the slider" bug — the
// previous opacity-0 overlay pattern leaked drag events to the document.
//
// Position semantics (LOCKED May 25 2026):
//   • slider range = [0, maxAtTarget] where maxAtTarget = round(target/kcal)
//   • thumb position = value / maxAtTarget = caloric % of target
//   • So a 40%-of-cals macro sits at the 40% mark on the slider, not at
//     ~5% above floor. Position visually matches the % shown next to the
//     grams. Floor is enforced via onChange clamp + a dim "below-floor"
//     zone painted on the track so the user can see where the floor sits.
function MacroSlider({ label, color, value, floor, ceiling, max, onChange, totalKcal }) {
  const kcalPerG = color === 'amber' ? 9 : 4
  const kcal = value * kcalPerG
  const pct = totalKcal > 0 ? Math.round((kcal / totalKcal) * 100) : 0

  const palette = {
    blue:    { fill: 'bg-blue-500',    fg: 'text-blue-400'    },
    amber:   { fill: 'bg-amber-500',   fg: 'text-amber-400'   },
    emerald: { fill: 'bg-emerald-500', fg: 'text-emerald-400' },
  }[color]

  // Slider range is 0..ceiling-or-maxAtTarget so position == caloric %
  const sliderMax = ceiling !== Infinity ? ceiling : max
  const safeMax = Math.max(sliderMax, value, 1)
  const fillPct  = Math.min(100, Math.max(0, (value / safeMax) * 100))
  const floorPct = Math.min(100, Math.max(0, (floor / safeMax) * 100))
  const atFloor   = value <= floor
  const atCeiling = ceiling !== Infinity && value >= ceiling

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${palette.fill}`} />
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-base font-bold tabular-nums ${palette.fg}`}>{value}g</span>
          <span className="text-xs text-muted-foreground tabular-nums">({pct}%)</span>
        </div>
      </div>
      <div className="relative h-6">
        {/* Track + fill — behind the input, ignore pointer events so the
            input is the sole click/drag target. */}
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {/* Below-floor zone — striped to telegraph "thumb can't go here" */}
        {floor > 0 && (
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/30"
            style={{ width: `${floorPct}%` }}
          />
        )}
        {/* Active fill — colored portion from 0 to value */}
        <div
          className={`pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full ${palette.fill}`}
          style={{ width: `${fillPct}%` }}
        />
        {/* Native input with custom-styled thumb (see .macro-slider in
            web/src/index.css). min=0 so position is value/max. onChange
            clamps to the floor — thumb visually snaps back if user tries
            to drag below. */}
        <input
          type="range"
          min={0}
          max={sliderMax}
          step="1"
          value={value}
          onChange={e => {
            const raw = Number(e.target.value)
            const clamped = Math.max(floor, ceiling !== Infinity ? Math.min(ceiling, raw) : raw)
            onChange(clamped)
          }}
          className={`macro-slider macro-slider-${color}`}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Floor: {floor}g</span>
        <span>{atFloor ? 'At floor — locked' : atCeiling ? 'At ceiling — locked' : 'Drag for more / less'}</span>
        <span>{sliderMax === Infinity ? '∞' : `${sliderMax}g`}</span>
      </div>
    </div>
  )
}

// MacroBar — flat 3-segment bar for the live preview
function MacroBar({ protein, fat, carbs }) {
  const total = protein + fat + carbs
  if (total === 0) return null
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-blue-400"    style={{ width: `${(protein / total) * 100}%` }} />
      <div className="bg-amber-400"   style={{ width: `${(fat     / total) * 100}%` }} />
      <div className="bg-emerald-400" style={{ width: `${(carbs   / total) * 100}%` }} />
    </div>
  )
}

// ── Main editor ─────────────────────────────────────────────────────────────

const CORRECTION_DEFAULT = '0.80'

export default function MacroPlanEditor({
  profile, user, existingPlan, onPlanSaved, savedBy, readOnly = false,
}) {
  const actorId = savedBy || user?.id

  const previewRef = useRef(null)
  useScrollDrift(previewRef, { factor: 0.15, maxLag: 50 })

  // ── Body data ────────────────────────────────────────────────────────────
  const weight_kg = toKg(profile?.current_weight, profile?.weight_unit || 'lb')
  const height_cm = profile?.height_unit === 'imperial'
    ? (profile?.current_height ? profile.current_height * 2.54 : null)
    : profile?.current_height
  const age    = calcAge(profile?.birthdate)
  const gender = profile?.gender
  const missingData = !weight_kg || !height_cm || !age || !gender

  // ── State (seeded from existingPlan when present) ────────────────────────
  // Body composition is a CLIENT METRIC, not a coach default — seed it ONLY
  // from the saved profile value. When the DB has no body_fat_band, start with
  // NO selection (null) rather than silently pre-picking 'average'. The preview
  // (BMR/TDEE/Target) gates to "—" until a real selection is made, so we never
  // show numbers built on a fabricated body-comp input. (The sliders below —
  // activity / pace / correction — keep sensible defaults by design.)
  const [bodyFatBand,    setBodyFatBand]    = useState(profile?.body_fat_band || null)
  const [activityFactor, setActivityFactor] = useState(() => existingPlan?.activity_factor ?? 2)
  const [energyPct,      setEnergyPct]      = useState(() =>
    existingPlan?.energy_balance_pct != null ? Math.round(existingPlan.energy_balance_pct * 100) : -20
  )
  const [presetKey,      setPresetKey]      = useState(existingPlan?.macro_preset || 'balanced')
  const [correctionFactor, setCorrectionFactor] = useState(
    () => String(existingPlan?.correction_factor ?? CORRECTION_DEFAULT)
  )
  const [notes,            setNotes]            = useState(() => existingPlan?.notes || '')
  const [mealsAssignment,  setMealsAssignment]  = useState(() => existingPlan?.meals ?? null)

  // Weight target —
  //
  //   • Start (this phase) is ALWAYS the user's current weight (latest
  //     bodyweight log via profile.current_weight) — read-only display,
  //     no input. The plan's stored starting_weight_kg gets refreshed to
  //     this value on every save. Locked May 25 2026 per the user:
  //     "the start hit phase should be current weight and it should
  //     always read the last weight logged or input and its uneditbale".
  //   • Goal is the only editable field. Unit toggle applies to it only.
  const [weightUnit, setWeightUnit] = useState(() => profile?.weight_unit || 'kg')
  const startingWeightKg = useMemo(() => weight_kg ? Math.round(weight_kg * 10) / 10 : null, [weight_kg])
  const [goalWeightKg, setGoalWeightKg] = useState(() =>
    existingPlan?.goal_weight_kg != null ? String(existingPlan.goal_weight_kg) : ''
  )
  const [goalRaw, setGoalRaw] = useState(() => {
    if (existingPlan?.goal_weight_kg == null) return ''
    const initUnit = profile?.weight_unit || 'kg'
    const kg = existingPlan.goal_weight_kg
    return String(initUnit === 'lb' ? Math.round(kg / 0.453592 * 10) / 10 : Math.round(kg * 10) / 10)
  })

  // Display-formatted starting weight in the active unit (lb or kg)
  const startingWeightDisplay = useMemo(() => {
    if (startingWeightKg == null) return null
    const disp = weightUnit === 'lb' ? startingWeightKg / 0.453592 : startingWeightKg
    return (Math.round(disp * 10) / 10).toString()
  }, [startingWeightKg, weightUnit])

  // ── Computed BMR / TDEE / target ─────────────────────────────────────────
  const bmr = useMemo(() => {
    // No body-comp selection → no BMR. Forces an explicit pick before any
    // calorie math runs (3a — never compute off a fabricated 'average').
    if (missingData || !bodyFatBand) return null
    const raw = calcBMR(weight_kg, height_cm, age, gender)
    return raw ? Math.round(raw * bodyCompFactor(bodyFatBand)) : null
  }, [weight_kg, height_cm, age, gender, bodyFatBand, missingData])

  // Round TDEE at source — calcTDEE returns bmr * multiplier without
  // rounding, which renders as a 16-digit float string in the preview
  // tile and overflows into the neighbouring Target tile.
  const tdee = useMemo(() => {
    if (!bmr) return null
    const raw = calcTDEE(bmr, activityFactor)
    return raw ? Math.round(raw) : null
  }, [bmr, activityFactor])

  const targetKcal = useMemo(() => tdee ? Math.round(tdee * (1 + energyPct / 100)) : null, [tdee, energyPct])

  // Floors depend on body weight + target + whether preset is keto. Moved
  // ABOVE the macros state so the seed/re-sync useEffect can call
  // applyPreset(preset, target, floors) without forward-reference issues.
  const floors = useMemo(() => {
    const isKeto = MACRO_PRESETS.find(p => p.key === presetKey)?.keto === true
    return computeFloors({ weight_kg, total_kcal: targetKcal, isKeto })
  }, [weight_kg, targetKcal, presetKey])

  // ── Macro grams state ────────────────────────────────────────────────────
  const [macros, setMacros] = useState(() => {
    if (existingPlan?.macros_p_g != null) {
      return {
        protein: existingPlan.macros_p_g,
        fat:     existingPlan.macros_f_g,
        carbs:   existingPlan.macros_c_g,
      }
    }
    return null
  })

  // Macro re-sync — uses useLayoutEffect (NOT useEffect) so the scale
  // happens between the DOM update and the browser paint. Without this,
  // when targetKcal changes the MacroSlider components re-render with
  // the new target's `max` prop but the OLD macros value, the browser
  // paints that intermediate frame (showing the thumbs at wrong
  // positions), then useEffect fires and corrects on the next paint —
  // producing the visible flash. useLayoutEffect runs synchronously,
  // triggers another render, and the browser only ever sees the final
  // state.
  //
  //   • First mount (macros null)      → seed from current preset NOW.
  //   • Macros in sync (within 1 kcal) → no-op.
  //   • Target moved                   → scale proportionally, PRESERVING
  //                                      the user's relative split (P:F:C
  //                                      ratio stays put → slider positions
  //                                      stay put, since position == % of
  //                                      cals).
  //
  // We do NOT reseed from preset here — that would wipe any custom split.
  // Preset reseeding only happens via applyMacroPreset on preset-chip click.
  useLayoutEffect(() => {
    if (!targetKcal) return
    setMacros(prev => {
      if (!prev) {
        const preset = MACRO_PRESETS.find(p => p.key === presetKey) || MACRO_PRESETS[0]
        return applyPreset(preset, targetKcal, floors)
      }
      const prevTotal = prev.protein * 4 + prev.fat * 9 + prev.carbs * 4
      if (Math.abs(prevTotal - targetKcal) <= 1) return prev
      return scaleToTarget(prev, targetKcal, floors)
    })
    // presetKey intentionally omitted — applyMacroPreset handles preset
    // change directly. Floors picks up keto-toggle and weight-change cases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKcal, floors])

  function applyMacroPreset(key) {
    setPresetKey(key)
    if (targetKcal) {
      const preset    = MACRO_PRESETS.find(p => p.key === key)
      const isKeto    = preset?.keto === true
      const newFloors = computeFloors({ weight_kg, total_kcal: targetKcal, isKeto })
      setMacros(applyPreset(preset, targetKcal, newFloors))
    }
  }

  function handleMacroChange(macroKey, newValue) {
    if (!macros || !targetKcal) return
    setMacros(prev => rebalance(prev, macroKey, newValue, floors, targetKcal))
  }

  // ── Timeline (only when goal weight + plan complete) ─────────────────────
  const timeline = useMemo(() => {
    if (!goalWeightKg || isNaN(Number(goalWeightKg)) || startingWeightKg == null || !tdee) return null
    const energyAdjustment = Math.round(tdee * (energyPct / 100))
    return calcTimeline(
      startingWeightKg,
      Number(goalWeightKg),
      energyAdjustment,
      Number(correctionFactor) || 0.8,
      energyPct,
    )
  }, [goalWeightKg, startingWeightKg, tdee, energyPct, correctionFactor])

  // ── Save / reset ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  async function handleSave(e) {
    e?.preventDefault?.()
    setError('')
    if (missingData) { setError('Profile is missing weight / height / age / gender.'); return }
    if (!bodyFatBand) { setError('Pick a body composition to compute the plan.'); return }
    if (!macros || !targetKcal) { setError('Macros not initialised yet.'); return }
    if (timeline?.mode === 'mismatch') {
      setError("Goal weight and pace point opposite directions. Adjust one of them before saving.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        user_id:            user.id,
        activity_factor:    activityFactor,
        energy_balance_pct: energyPct / 100,
        // Start is always current weight (read-only field, auto-synced)
        starting_weight_kg: startingWeightKg ?? weight_kg ?? null,
        goal_weight_kg:     Number(goalWeightKg) || null,
        correction_factor:  Number(correctionFactor) || 0.8,
        notes:              notes.trim() || null,
        meals:              mealsAssignment,
        macro_preset:       presetKey,
        macros_p_g:         macros.protein,
        macros_f_g:         macros.fat,
        macros_c_g:         macros.carbs,
        assigned_by:        actorId,
        assigned_at:        new Date().toISOString(),
        updated_at:         new Date().toISOString(),
      }
      const { data: savedRow, error: dbErr } = existingPlan
        ? await supabase.from('calorie_plans').update(payload).eq('user_id', user.id).select().single()
        : await supabase.from('calorie_plans').insert(payload).select().single()
      if (dbErr) throw dbErr

      if (bodyFatBand !== profile?.body_fat_band) {
        await supabase.from('profiles').update({ body_fat_band: bodyFatBand }).eq('id', user.id)
      }

      setSaved(true)
      // Use the DB-returned row so goal_reached reflects the reset trigger — a
      // plan re-baseline (start/goal change) clears it, so the "Goal reached"
      // banner disappears right after Update plan instead of lingering on a
      // stale local copy. Fall back to an optimistic merge (goal_reached: false,
      // since a save always re-baselines the phase) if select() returns nothing.
      onPlanSaved?.(savedRow ?? { ...existingPlan, ...payload, goal_reached: false })
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err?.message || 'Could not save the macro plan.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  // Activity options derived from ACTIVITY_FACTORS
  const ACTIVITY_SHORT = { 1: 'Sedentary', 2: 'Light', 3: 'Moderate', 4: 'Very', 5: 'Extreme' }
  const activityOptions = Object.entries(ACTIVITY_FACTORS).map(([k, v]) => ({
    value: Number(k), short: ACTIVITY_SHORT[k], label: v.label, description: v.description,
  }))

  if (missingData) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-400">Incomplete profile</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Macro plan calculations need gender, date of birth, current weight, and current height.
              Fill those in on the Account tab first.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const energyAdj = tdee ? Math.round(tdee * (energyPct / 100)) : 0
  const perMeal = macros && targetKcal && mealsAssignment != null
    ? calcPerMeal(
        {
          protein: { grams: macros.protein, pct: Math.round((macros.protein * 4 / targetKcal) * 100) },
          fat:     { grams: macros.fat,     pct: Math.round((macros.fat     * 9 / targetKcal) * 100) },
          carbs:   { grams: macros.carbs,   pct: Math.round((macros.carbs   * 4 / targetKcal) * 100) },
        },
        targetKcal,
        mealsAssignment,
      )
    : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      {/* ── Form ── */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-6">

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Macro Plan Setting variables</h2>
          </div>

          {existingPlan?.goal_reached && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-400">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Goal reached — progress stays at 100% until you set a new goal and hit Update plan.</span>
            </div>
          )}

          {/* Body composition */}
          <div>
            <SectionLabel hint="Refines BMR up to ±5% based on lean mass.">Body composition</SectionLabel>
            <BodyCompPicker value={bodyFatBand} onChange={setBodyFatBand} gender={gender} compact />
          </div>

          {/* Activity */}
          <div>
            <SectionLabel hint="Day-to-day activity. Drives the TDEE multiplier.">Activity level</SectionLabel>
            <StepSlider options={activityOptions} value={activityFactor} onChange={setActivityFactor} />
          </div>

          {/* Goal & pace — presets + free slider */}
          <div>
            <SectionLabel hint="Pick a preset or drag the slider for finer control.">Goal & pace</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
              {PACE_PRESETS.map(p => {
                const active = energyPct === p.pct
                return (
                  <button
                    key={p.key} type="button" onClick={() => setEnergyPct(p.pct)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >{p.label}</button>
                )
              })}
            </div>
            <EnergySlider value={energyPct} onChange={setEnergyPct} tdee={tdee} />
          </div>

          {/* Weight target — Start is read-only (always current weight) */}
          <div>
            <SectionLabel hint="Start is auto-synced from the latest bodyweight log. Saving the plan begins a new phase from there.">Weight target</SectionLabel>
            <div className="flex items-stretch gap-2">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current weight</p>
                  <div className={`${inputCls} flex items-baseline justify-between bg-muted/30 cursor-not-allowed`}>
                    <span className="tabular-nums">{startingWeightDisplay ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">{weightUnit}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Goal</p>
                  <input
                    type="number" step="0.1"
                    value={goalRaw}
                    onChange={e => {
                      const raw = e.target.value
                      setGoalRaw(raw)
                      if (raw === '') { setGoalWeightKg(''); return }
                      const num = Number(raw)
                      if (!isNaN(num) && num > 0) {
                        const kg = weightUnit === 'lb' ? num * 0.453592 : num
                        setGoalWeightKg(String(Math.round(kg * 10) / 10))
                      }
                    }}
                    onBlur={() => {
                      if (goalWeightKg) {
                        const kg = Number(goalWeightKg)
                        const disp = weightUnit === 'lb' ? kg / 0.453592 : kg
                        setGoalRaw((Math.round(disp * 10) / 10).toString())
                      } else { setGoalRaw('') }
                    }}
                    className={inputCls}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newUnit = weightUnit === 'kg' ? 'lb' : 'kg'
                  setWeightUnit(newUnit)
                  if (goalWeightKg) {
                    const kg = Number(goalWeightKg)
                    const disp = newUnit === 'lb' ? kg / 0.453592 : kg
                    setGoalRaw((Math.round(disp * 10) / 10).toString())
                  }
                }}
                className="self-end flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                {weightUnit}
              </button>
            </div>
            {startingWeightKg != null && goalWeightKg && Number(goalWeightKg) > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {(() => {
                  const goalKg  = Number(goalWeightKg)
                  const diffKg  = Math.abs(startingWeightKg - goalKg)
                  const diffDisp = weightUnit === 'lb' ? diffKg / 0.453592 : diffKg
                  return `${diffDisp.toFixed(1)} ${weightUnit} to ${startingWeightKg > goalKg ? 'lose' : 'gain'}`
                })()}
              </p>
            )}
          </div>

          {/* Macro split — presets + new grams sliders */}
          <div>
            <SectionLabel hint="Pick a preset, then drag the sliders to customize. Floors are hard-capped.">Macro split</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-4">
              {MACRO_PRESETS.map(p => {
                const active = presetKey === p.key
                return (
                  <button
                    key={p.key} type="button" onClick={() => applyMacroPreset(p.key)}
                    className={`rounded-md border px-2 py-2 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary/15'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className={`text-[11px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{p.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{p.sub}</p>
                  </button>
                )
              })}
            </div>
            {macros && targetKcal ? (
              <div className="space-y-4 pt-2 border-t border-border">
                <MacroSlider label="Protein" color="blue"
                  value={macros.protein} floor={floors.protein} ceiling={Infinity}
                  max={Math.round(targetKcal / 4)}
                  onChange={v => handleMacroChange('protein', v)}
                  totalKcal={targetKcal}
                />
                <MacroSlider label="Fat" color="amber"
                  value={macros.fat} floor={floors.fat} ceiling={Infinity}
                  max={Math.round(targetKcal / 9)}
                  onChange={v => handleMacroChange('fat', v)}
                  totalKcal={targetKcal}
                />
                <MacroSlider label="Carbs" color="emerald"
                  value={macros.carbs} floor={floors.carbs} ceiling={floors.carbsCeiling_g}
                  max={Math.round(targetKcal / 4)}
                  onChange={v => handleMacroChange('carbs', v)}
                  totalKcal={targetKcal}
                />
                <p className="text-[11px] text-muted-foreground/80">
                  <Sparkles className="inline h-3 w-3 text-primary mr-1" />
                  Floors at <span className="text-foreground">{floors.protein}g protein</span> and <span className="text-foreground">{floors.fat}g fat</span> — sliders won't drag below.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Pick a body composition to unlock macro sliders.</p>
            )}
          </div>

          {/* Correction factor */}
          <div>
            <SectionLabel hint="1.0 = no correction · 0.1 = very conservative">Correction factor</SectionLabel>
            <div className="flex items-center gap-3">
              <input type="range" min="0.1" max="1.0" step="0.05"
                value={correctionFactor}
                onChange={e => setCorrectionFactor(e.target.value)}
                className="flex-1 accent-primary"
              />
              <span className="w-10 text-sm font-mono text-right tabular-nums">{Number(correctionFactor).toFixed(2)}</span>
            </div>
          </div>

          {/* Meals */}
          <div>
            <SectionLabel hint="UP = User Preference — allows the client to choose the number of meals per day for the breakdown.">Number of meals</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setMealsAssignment(null)}
                className={`flex h-9 items-center justify-center rounded-full border px-4 text-xs font-semibold transition-all ${mealsAssignment === null ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>UP</button>
              {[2, 3, 4, 5, 6].map(n => (
                <button key={n} type="button" onClick={() => setMealsAssignment(n)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-all ${mealsAssignment === n ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>{n}</button>
              ))}
            </div>
          </div>

          {/* Coach notes */}
          <div>
            <SectionLabel>Coach notes</SectionLabel>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {timeline?.mode === 'mismatch' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Your goal weight and pace are pointing opposite ways — a {timeline.isLoss ? 'loss' : 'gain'} goal with a {timeline.isLoss ? 'surplus' : 'deficit'} pace. The math can't take you there, so save is locked until they agree. Drag the pace slider {timeline.isLoss ? 'left (red)' : 'right (red)'} to put it in {timeline.isLoss ? 'fat-loss' : 'muscle-gain'} territory.
            </span>
          </div>
        )}

        <button type="submit" disabled={saving || readOnly || timeline?.mode === 'mismatch'}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
          {saved ? <><Check className="h-4 w-4" /> Macro Plan Setting saved</>
          : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
          : timeline?.mode === 'mismatch' ? 'Fix direction mismatch to save'
          : existingPlan ? 'Update Macro Plan Setting'
          : 'Save Macro Plan Setting'}
        </button>
      </form>

      {/* ── Live preview ── */}
      <div
        ref={previewRef}
        className="rounded-xl border border-border bg-card p-5 space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto will-change-transform"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Live preview</h2>
          <span className="text-xs text-muted-foreground">
            {mealsAssignment != null ? `${mealsAssignment} meals/day` : 'User picks meals'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'BMR',    value: bmr || '—',        hi: false },
            { label: 'TDEE',   value: tdee || '—',       hi: false },
            { label: 'Target', value: targetKcal || '—', hi: true  },
          ].map(({ label, value, hi }) => (
            <div key={label} className={`rounded-xl border p-3 ${hi ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${hi ? 'text-primary' : ''}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground">kcal</p>
            </div>
          ))}
        </div>

        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${energyAdj < 0 ? 'text-emerald-400 bg-emerald-500/10' : energyAdj > 0 ? 'text-blue-400 bg-blue-500/10' : 'text-muted-foreground bg-muted/30'}`}>
          {energyAdj < 0 ? <TrendingDown className="h-4 w-4 shrink-0" /> : energyAdj > 0 ? <TrendingUp className="h-4 w-4 shrink-0" /> : null}
          <span>{energyAdj > 0 ? '+' : ''}{energyAdj} kcal/day · {getEnergyLabel(energyPct)}</span>
        </div>

        {macros && targetKcal && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Daily macros</p>
            <MacroBar protein={macros.protein} fat={macros.fat} carbs={macros.carbs} />
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              {[
                { label: 'Protein', g: macros.protein, kcal: macros.protein * 4, color: 'text-blue-400' },
                { label: 'Fat',     g: macros.fat,     kcal: macros.fat * 9,     color: 'text-amber-400' },
                { label: 'Carbs',   g: macros.carbs,   kcal: macros.carbs * 4,   color: 'text-emerald-400' },
              ].map(({ label, g, kcal, color }) => {
                const pct = targetKcal > 0 ? Math.round((kcal / targetKcal) * 100) : 0
                return (
                  <div key={label}>
                    <span className={`font-semibold ${color}`}>{g}g</span>
                    <span className="text-muted-foreground ml-1">({pct}%)</span>
                    <p className="text-muted-foreground mt-0.5">{label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {perMeal && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Utensils className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Per meal ({mealsAssignment} meals/day)</p>
            </div>
            <div className="flex gap-4 text-sm flex-wrap">
              <span><span className="font-semibold text-primary">{perMeal.calories}</span> <span className="text-muted-foreground text-xs">kcal</span></span>
              <span><span className="font-semibold text-blue-400">{perMeal.protein}g</span> <span className="text-muted-foreground text-xs">P</span></span>
              <span><span className="font-semibold text-amber-400">{perMeal.fat}g</span> <span className="text-muted-foreground text-xs">F</span></span>
              <span><span className="font-semibold text-emerald-400">{perMeal.carbs}g</span> <span className="text-muted-foreground text-xs">C</span></span>
            </div>
          </div>
        )}

        {timeline && (() => {
          if (timeline.mode === 'recomp') {
            const m    = timeline.monthsBest
            const unit = m === 1 ? 'month' : 'months'
            return (
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 text-sm">
                <p className="font-semibold text-purple-400">Body recomposition · approx. ~{m} {unit}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Scale moves slowly here — muscle gain offsets fat loss, so treat it as a best case.</p>
              </div>
            )
          }
          if (timeline.mode === 'mismatch') return (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="font-semibold text-amber-400">Direction mismatch</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Goal is to {timeline.isLoss ? 'lose' : 'gain'} {timeline.weightDiffKg.toFixed(1)} kg but the energy balance pushes the other way.
              </p>
            </div>
          )
          const m    = timeline.monthsBest
          const unit = m === 1 ? 'month' : 'months'
          return (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-0.5">Estimated timeline</p>
              <p className="font-semibold">approx. ~{m} {unit}</p>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
