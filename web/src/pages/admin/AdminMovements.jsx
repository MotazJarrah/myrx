import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

const IS_TOUCH = typeof window !== 'undefined'
  && window.matchMedia('(pointer: coarse)').matches
import { supabase } from '../../lib/supabase'
import { invalidateMovements } from '../../hooks/useMovements'
import DeleteAction from '../../components/DeleteAction'
import Select from '../../components/Select'
import {
  Dumbbell, Activity, Timer,
  Ruler, Check, Plus, ChevronLeft, Pencil, X,
  AlertTriangle, Trash2, ArrowUpDown, Lock, EyeOff,
} from 'lucide-react'

// ── Tree option definitions ───────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: 'strength', label: 'Strength',  description: 'Lifting, holds, carries', icon: Dumbbell },
  { value: 'cardio',   label: 'Cardio',    description: 'Running, rowing, cycling', icon: Activity },
]

const CARDIO_MODE_OPTIONS = [
  { value: 'pace',     label: 'Pace-based',   description: 'Logs distance + time → pace', icon: Ruler },
  { value: 'duration', label: 'Duration only', description: 'Logs session time only',       icon: Timer },
]

// Rep-based first (more common — barbell, dumbbell, machine, bodyweight,
// kettlebell, strongman, carry all use it). Isometric is the smaller bucket
// (plank, wall sit, L-sit, dead hang, etc.) so it sits second.
const STRENGTH_TYPE_OPTIONS = [
  { value: 'rep-based', label: 'Rep-based',     description: 'Counted reps each set',    icon: Dumbbell },
  { value: 'isometric', label: 'Isometric hold', description: 'Timed — plank, wall sit…', icon: Timer    },
]

const EQUIPMENT_OPTIONS = [
  { value: 'barbell',    label: 'Barbell',          description: 'Plate-loaded bar' },
  { value: 'dumbbell',   label: 'Dumbbell',         description: 'Per-hand, fixed weights' },
  { value: 'kettlebell', label: 'Kettlebell',       description: 'IKFF 4 kg ladder (16 kg, 20 kg, …)' },
  { value: 'machine',    label: 'Resistance machine', description: 'ADDS load — lat pulldown, leg press, cable' },
  { value: 'bodyweight', label: 'Bodyweight',       description: 'Pull-ups, push-ups…' },
  { value: 'assisted',   label: 'Assist machine',   description: 'REDUCES bodyweight — gravitron, assisted pull-up' },
  { value: 'strongman',  label: 'Strongman',        description: 'Atlas stones, sandbags, kegs, yokes — kg-locked' },
  { value: 'carry',      label: 'Carry / Sled',     description: 'Weight + distance' },
]

// ── Lift-style options ───────────────────────────────────────────────────────
// `lift_type` (barbell / kettlebell rep-based only). Olympic lifts get a
// %-of-best coaching surface; ballistic lifts (KB swing, snatch) get a
// bell-ladder surface. None = standard lift. DB CHECK: NULL | olympic | ballistic.
const LIFT_TYPE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'olympic', label: 'Olympic' },
  { value: 'ballistic', label: 'Ballistic' },
]

// ── Hold-type options ────────────────────────────────────────────────────────
// `hold_type` (isometric only). Weighted (load) holds add an added-weight
// field when logging; leverage holds are lever-based (front lever, planche);
// standard = plain bodyweight hold. DB CHECK: NULL | leverage | load.
const HOLD_TYPE_OPTIONS = [
  { value: '', label: 'Standard hold' },
  { value: 'leverage', label: 'Leverage hold' },
  { value: 'load', label: 'Weighted (load) hold' },
]

// ── Unit-lock options ────────────────────────────────────────────────────────
// Forces a specific unit for this movement, overriding the user's profile
// preference. Strongman events use kg universally (Atlas, Husafell, etc.).
// Rucking uses mi universally (GoRuck community). When set, the log form
// hides the toggle and shows the locked unit as a static chip; the detail
// page renders all best / target / chart values in the locked unit too.
// DB CHECK constraint: NULL or one of {kg, lb, mi, km}.
const UNIT_LOCK_OPTIONS = [
  { value: null, label: 'No lock',    description: 'Follow user\'s profile preference', icon: null,  kinds: ['weight', 'distance'] },
  { value: 'kg', label: 'Kilograms',  description: 'Strongman events (Atlas, Husafell, kegs)', icon: Lock, kinds: ['weight']   },
  { value: 'lb', label: 'Pounds',     description: 'Future US-locked weight movements',          icon: Lock, kinds: ['weight']   },
  { value: 'mi', label: 'Miles',      description: 'Rucking (GoRuck community standard)',        icon: Lock, kinds: ['distance'] },
  { value: 'km', label: 'Kilometres', description: 'Future km-locked cardio movements',          icon: Lock, kinds: ['distance'] },
]

// ── Unit-lock cascade rules ─────────────────────────────────────────────────
// `shouldShowUnitLock` — whether to render the unit_lock step at all given
//   the user's selections so far. Hidden when:
//     • category not selected
//     • cardio + cardio_mode not selected
//     • strength + strength_type not selected
//     • strength + isometric (timed holds have no weight to lock)
//     • strength + rep-based + no equipment selected
//
// `relevantUnitLockOptions` — filters UNIT_LOCK_OPTIONS to only the kinds
//   that apply. Cardio movements get distance options (mi/km). Strength
//   movements get weight options (kg/lb). "No lock" is universal.
function shouldShowUnitLock(category, cardioMode, strengthType, equipment) {
  if (!category) return false
  if (category === 'cardio') return !!cardioMode
  if (!strengthType) return false
  if (strengthType === 'isometric') return false
  if (strengthType === 'rep-based') return !!equipment
  return false
}

function relevantUnitLockOptions(category) {
  if (category === 'cardio') return UNIT_LOCK_OPTIONS.filter(o => o.kinds.includes('distance'))
  if (category === 'strength') return UNIT_LOCK_OPTIONS.filter(o => o.kinds.includes('weight'))
  return UNIT_LOCK_OPTIONS
}

// ── Sort options for the list ────────────────────────────────────────────────
const SORT_OPTIONS = [
  { value: 'name-asc',     label: 'Name A→Z' },
  { value: 'name-desc',    label: 'Name Z→A' },
  { value: 'updated-desc', label: 'Recently modified' },
  { value: 'updated-asc',  label: 'Oldest modified' },
  { value: 'created-desc', label: 'Recently added' },
  { value: 'created-asc',  label: 'Oldest added' },
]

// ── Filter chip presets ──────────────────────────────────────────────────────
// One-tap narrow-down above the search input. The "All" chip clears any
// active filter; the rest each define a predicate the row must satisfy.
const FILTER_CHIPS = [
  { value: 'all',         label: 'All'         },
  { value: 'strength',    label: 'Strength'    },
  { value: 'cardio',      label: 'Cardio'      },
  { value: 'bodyweight',  label: 'Bodyweight'  },
  { value: 'isometric',   label: 'Isometric'   },
  { value: 'carry',       label: 'Carry'       },
  { value: 'strongman',   label: 'Strongman'   },
  { value: 'unit-locked', label: 'Unit-locked' },
  { value: 'deprecated',  label: 'Deprecated'  },
]

function matchesFilter(m, filter) {
  switch (filter) {
    case 'all':         return true
    case 'strength':    return m.category === 'strength'
    case 'cardio':      return m.category === 'cardio'
    case 'bodyweight':  return m.equipment === 'bodyweight'
    case 'isometric':   return m.strength_type === 'isometric'
    case 'carry':       return m.equipment === 'carry'
    case 'strongman':   return m.equipment === 'strongman'
    case 'unit-locked': return !!m.unit_lock
    case 'deprecated':  return !!m.deprecated
    default:            return true
  }
}

// ── Smart multi-token search ──────────────────────────────────────────────────
// Every token must appear somewhere in the name.
// Priority score based on where the FIRST token lands:
//   0 — name starts with the first token         ("push" → "Push Up" before "Archer Push Up")
//   1 — a later word starts with the first token ("push" → "Archer Push Up")
//   2 — first token is only a mid-word substring

function tokenize(query) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function smartMatch(name, tokens) {
  const lower = name.toLowerCase()
  return tokens.every(t => lower.includes(t))
}

function scoreMatch(name, tokens) {
  const lower = name.toLowerCase()
  const first = tokens[0]
  if (lower.startsWith(first)) return 0
  if (lower.split(/\s+/).some(w => w.startsWith(first))) return 1
  return 2
}

// ── Reusable tree-level row ───────────────────────────────────────────────────

function TreeLevel({ step, label, options, selected, onSelect }) {
  return (
    <div className="animate-rise space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
          {step}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const Icon = opt.icon
          const isSelected = selected === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-all ${
                isSelected
                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
              <span>{opt.label}</span>
              {opt.description && (
                <span className={`text-xs ${isSelected ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                  — {opt.description}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Toggle chip (for bodyweight modifiers) ────────────────────────────────────

function ToggleChip({ label, description, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-all ${
        checked
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
      }`}
    >
      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
        checked ? 'bg-primary border-primary' : 'border-current'
      }`}>
        {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </div>
      <span>{label}</span>
      {description && (
        <span className={`text-xs ${checked ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
          — {description}
        </span>
      )}
    </button>
  )
}

// ── Summary badge ─────────────────────────────────────────────────────────────

function buildSummary(category, cardioMode, strengthType, equipment, bandAssist, kneeAssist, unitLock, deprecated, liftType, holdType) {
  // Rep-range was dropped from the admin form on May 20 2026 — the columns
  // stay in the DB (existing rows preserved) but no field collects them and
  // mobile never read them anyway since the May 2026 adp-zone redesign moved
  // every weighted strength movement to the same global 1-5 / 6-12 / 13+
  // zone boundaries. See CLAUDE.md.
  const parts = []
  if (category === 'cardio') {
    parts.push('Cardio')
    if (cardioMode === 'pace') parts.push('Pace-based')
    else if (cardioMode === 'duration') parts.push('Duration only')
  } else if (category === 'strength') {
    parts.push('Strength')
    if (strengthType === 'isometric') {
      parts.push('Isometric hold')
      if (holdType === 'load')     parts.push('Load hold')
      if (holdType === 'leverage') parts.push('Leverage hold')
    }
    else if (strengthType === 'rep-based') {
      parts.push('Rep-based')
      if (equipment === 'barbell')    parts.push('Barbell')
      if (equipment === 'dumbbell')   parts.push('Dumbbell')
      if (equipment === 'kettlebell') parts.push('Kettlebell')
      if (equipment === 'machine')    parts.push('Machine')
      if (equipment === 'bodyweight') {
        parts.push('Bodyweight')
        if (bandAssist) parts.push('Band-assist ✓')
        if (kneeAssist) parts.push('Knee-assist ✓')
      }
      if (equipment === 'assisted')   parts.push('Assisted')
      if (equipment === 'strongman')  parts.push('Strongman')
      if (equipment === 'carry')      parts.push('Carry / Sled')
      if ((equipment === 'barbell' || equipment === 'kettlebell')) {
        if (liftType === 'olympic')   parts.push('Olympic')
        if (liftType === 'ballistic') parts.push('Ballistic')
      }
    }
  }
  if (unitLock) parts.push(`Locked to ${unitLock}`)
  if (deprecated) parts.push('Deprecated')
  return parts
}

// ── Smart unit-lock default ─────────────────────────────────────────────────
// Returns the suggested unit_lock for a movement based on its category /
// equipment / name. Strongman events are kg-universal; rucking is mi-universal.
// Returns null when no community standard applies. Admin can always override.
function suggestUnitLock(category, equipment, name) {
  if (category === 'strength' && equipment === 'strongman') return 'kg'
  const lower = (name || '').toLowerCase()
  if (category === 'cardio' && /ruck/.test(lower)) return 'mi'
  return null
}

// ── Last-modified formatting ─────────────────────────────────────────────────
// "5 min ago" / "2h ago" / "yesterday" / "May 15" / "Jan 12 2025" depending
// on how stale the timestamp is. Returns "—" for null / invalid input.
function formatLastModified(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diffSec = (Date.now() - d.getTime()) / 1000
  if (diffSec < 60)             return 'just now'
  if (diffSec < 3600)           return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400)         return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 2 * 86_400)     return 'yesterday'
  if (diffSec < 7 * 86_400)     return `${Math.floor(diffSec / 86_400)}d ago`
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Movement pills ────────────────────────────────────────────────────────────

const EQUIPMENT_PILL = {
  barbell:    { label: 'Barbell',     cls: 'bg-amber-500/10  text-amber-600  dark:text-amber-400'   },
  dumbbell:   { label: 'Dumbbell',    cls: 'bg-blue-500/10   text-blue-600   dark:text-blue-400'    },
  kettlebell: { label: 'Kettlebell',  cls: 'bg-sky-500/10    text-sky-600    dark:text-sky-400'     },
  bodyweight: { label: 'Bodyweight',  cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  carry:      { label: 'Carry',       cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'  },
  assisted:   { label: 'Assisted',    cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'  },
  machine:    { label: 'Machine',     cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'  },
  strongman:  { label: 'Strongman',   cls: 'bg-rose-500/10   text-rose-600   dark:text-rose-400'    },
}

function MovementPills({ m }) {
  const pills = []

  if (m.category === 'cardio') {
    pills.push({ label: 'Cardio', cls: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' })
    if (m.cardio_mode === 'pace')     pills.push({ label: 'Pace',     cls: 'bg-muted text-muted-foreground' })
    if (m.cardio_mode === 'duration') pills.push({ label: 'Duration', cls: 'bg-muted text-muted-foreground' })
  } else {
    if (m.strength_type === 'isometric') {
      pills.push({ label: 'Isometric', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' })
      if (m.hold_type === 'load')     pills.push({ label: 'Load hold', cls: 'bg-muted text-muted-foreground' })
      if (m.hold_type === 'leverage') pills.push({ label: 'Leverage hold', cls: 'bg-muted text-muted-foreground' })
    } else {
      const eq = EQUIPMENT_PILL[m.equipment]
      if (eq) pills.push(eq)
      if (m.band_assist) pills.push({ label: 'Band assist', cls: 'bg-muted text-muted-foreground' })
      if (m.knee_assist) pills.push({ label: 'Knee assist', cls: 'bg-muted text-muted-foreground' })
      if (m.uses_pair)   pills.push({ label: 'Pair', cls: 'bg-muted text-muted-foreground' })
      if (m.lift_type === 'olympic')   pills.push({ label: 'Olympic', cls: 'bg-muted text-muted-foreground' })
      if (m.lift_type === 'ballistic') pills.push({ label: 'Ballistic', cls: 'bg-muted text-muted-foreground' })
      if (m.weight_ladder_override) {
        pills.push({ label: 'Custom ladder', cls: 'bg-muted text-muted-foreground' })
      }
    }
  }

  // Universal pills — apply across all categories.
  if (m.unit_lock) {
    pills.push({ label: `${m.unit_lock}-locked`, cls: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' })
  }
  if (m.isometric_ladder_override) {
    pills.push({ label: 'Custom milestones', cls: 'bg-muted text-muted-foreground' })
  }
  if (m.deprecated) {
    pills.push({ label: 'Deprecated', cls: 'bg-destructive/10 text-destructive' })
  }
  if (m.variantCount > 0) {
    pills.push({
      label: `${m.variantCount} variant${m.variantCount === 1 ? '' : 's'}`,
      cls: 'bg-primary/10 text-primary',
    })
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {pills.map((p, i) => (
        <span key={i} className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${p.cls}`}>
          {p.label}
        </span>
      ))}
    </div>
  )
}

// ── Title-case helper ─────────────────────────────────────────────────────────
// Capitalises the first letter of every word as the user types.

function toTitleCase(str) {
  return str.replace(/\b([a-z])/g, c => c.toUpperCase())
}

// Variant label helpers — variant rows are stored with names like
// "Swimming [Freestyle]" so the existing log + detail page parsers
// keep working. extractVariantLabel pulls just the bracketed portion
// for display in the admin form ("Freestyle"); buildVariantName
// composes it back into the storage form when saving.
function extractVariantLabel(fullName, parentName) {
  if (!fullName || !parentName) return ''
  const prefix = `${parentName} [`
  if (!fullName.startsWith(prefix) || !fullName.endsWith(']')) return fullName
  return fullName.slice(prefix.length, -1).trim()
}

function buildVariantName(parentName, label) {
  return `${parentName.trim()} [${label.trim()}]`
}

// Live-preview modal (PreviewModal + detailSurfaceFor + sample-data
// dictionary) was removed May 20 2026 — the structured approximation
// diverged too far from the actual mobile rendering to be useful, so
// admin now just navigates to /effort/<name> directly if they want to
// QA. See git history for the prior block (~200 LOC).

// ── Variant chip-input ───────────────────────────────────────────────────────
// Each variant carries TWO labels:
//   - full  → goes in the row name's brackets, e.g. "Swimming [Freestyle]".
//             Displayed on detail-page pill row.
//   - short → max 10 chars, stored on the row as `variant_short_label`.
//             Displayed as a tiny badge on the strength/cardio index when
//             the row's last-logged variant is this one. Mirrors the
//             Swimming FREE/BACK/BREAST/FLY and Sled Work PUSH/DRAG
//             pattern.
//
// Admin types the full label, the short label autofills (uppercase first
// 4-6 chars), and admin can override the short before committing. Hit
// Enter → chip appears. Click × on a chip to remove. Order preserved
// (mobile pill carousel renders in admin's input order). Duplicate full
// labels (case-insensitive) are silently dropped.
//
// `variants` is now {full, short}[] — never a bare string[].

function suggestShortLabel(full) {
  // Take the first word (or full text if single word), uppercase, max 10
  // chars. Examples: "Freestyle" → "FREESTYLE", "Push" → "PUSH",
  // "Open water" → "OPEN".
  const first = (full || '').trim().split(/\s+/)[0] || ''
  return first.toUpperCase().slice(0, 10)
}

function VariantChipInput({ variants, inputValue, shortInputValue, onInputChange, onShortInputChange, onAdd, onRemove, placeholder }) {
  function commit() {
    const trimmedFull  = inputValue.trim()
    const trimmedShort = (shortInputValue || '').trim().toUpperCase().slice(0, 10) || suggestShortLabel(trimmedFull)
    if (!trimmedFull) return
    // Dedupe by full label — case-insensitive compare, preserve admin's casing.
    if (variants.some(v => v.full.toLowerCase() === trimmedFull.toLowerCase())) {
      onInputChange('')
      onShortInputChange('')
      return
    }
    onAdd({ full: toTitleCase(trimmedFull), short: trimmedShort })
    onInputChange('')
    onShortInputChange('')
  }
  return (
    <div className="space-y-2">
      {variants.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {variants.map((v, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {v.full} <span className="opacity-70 font-mono">({v.short})</span>
              <button
                onClick={() => onRemove(idx)}
                className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                aria-label={`Remove ${v.full}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={e => {
            onInputChange(e.target.value)
            // Auto-suggest the short label as admin types the full label,
            // but only if admin hasn't manually edited the short field yet.
            if (!shortInputValue) onShortInputChange(suggestShortLabel(e.target.value))
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && inputValue === '' && variants.length > 0) {
              onRemove(variants.length - 1)
            }
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        <input
          type="text"
          value={shortInputValue}
          onChange={e => onShortInputChange(e.target.value.toUpperCase().slice(0, 10))}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="SHORT"
          maxLength={10}
          className={inputCls + ' w-28 font-mono uppercase tracking-wider'}
          title="Short label (max 10 chars) shown as the badge on the mobile index"
        />
        <button
          onClick={commit}
          disabled={!inputValue.trim()}
          className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ── Shared input style ────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

// ── Ladder-override serialization ────────────────────────────────────────────
// The DB stores `weight_ladder_override` as JSONB. Admin convenience: accept
// a comma-separated list of numbers ("100, 135, 150, 180") that we serialize
// to a number[] array. If the admin needs separate lb / kg ladders they can
// type valid JSON ({"lb":[100,135],"kg":[45,60]}). Empty input → null.
function parseLadderOverride(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  // Try JSON first (object with lb/kg or full array form).
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const nums = parsed.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
        return nums.length > 0 ? nums.sort((a, b) => a - b) : null
      }
      if (parsed && typeof parsed === 'object') {
        const out = {}
        for (const k of ['lb', 'kg']) {
          if (Array.isArray(parsed[k])) {
            const nums = parsed[k].map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
            if (nums.length > 0) out[k] = nums.sort((a, b) => a - b)
          }
        }
        return Object.keys(out).length > 0 ? out : null
      }
      return null
    } catch { return null }
  }
  // Fallback: comma-separated numeric list.
  const nums = trimmed.split(/[,\s]+/).map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0)
  return nums.length > 0 ? nums.sort((a, b) => a - b) : null
}

function serializeLadderOverride(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return ''
}

// ── Structured ladder editor ────────────────────────────────────────────────
// Replaces the fragile JSON / comma-separated input with two number-list
// inputs (one lb, one kg). The admin types comma-separated numbers in each
// row; the editor serialises to the same JSONB shape the math layer expects:
//   • Both rows filled → { lb: [...], kg: [...] }
//   • Only one row filled → number[] (single-unit ladder)
//   • Both empty → null (use the equipment's default ladder)
// Isometric variant lives in `IsoLadderEditor` below — same shape, different
// unit (seconds) and a single row.

function parseStructuredLadder(lbStr, kgStr) {
  const parseRow = (str) => {
    const nums = (str || '').split(/[,\s]+/).map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0)
    return nums.length > 0 ? nums.sort((a, b) => a - b) : null
  }
  const lb = parseRow(lbStr)
  const kg = parseRow(kgStr)
  if (lb && kg) return { lb, kg }
  if (lb) return lb
  if (kg) return kg
  return null
}

// Convert stored ladder back to two display strings — { lb / kg } maps to
// two filled rows; a bare number[] populates one row, leaving the other empty.
// The destination row defaults to lb (the more common community convention
// for non-strongman movements). Caller decides via `defaultUnit`.
function ladderToRows(value, defaultUnit = 'lb') {
  if (!value) return { lb: '', kg: '' }
  if (Array.isArray(value)) {
    return defaultUnit === 'kg'
      ? { lb: '', kg: value.join(', ') }
      : { lb: value.join(', '), kg: '' }
  }
  if (typeof value === 'object') {
    return {
      lb: Array.isArray(value.lb) ? value.lb.join(', ') : '',
      kg: Array.isArray(value.kg) ? value.kg.join(', ') : '',
    }
  }
  return { lb: '', kg: '' }
}

function StructuredLadderEditor({ lbStr, kgStr, onChangeLb, onChangeKg }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">lb ladder</label>
        <input
          type="text"
          value={lbStr}
          onChange={e => onChangeLb(e.target.value)}
          placeholder="e.g. 100, 135, 150, 180"
          className={inputCls}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">kg ladder</label>
        <input
          type="text"
          value={kgStr}
          onChange={e => onChangeKg(e.target.value)}
          placeholder="e.g. 60, 80, 100, 120"
          className={inputCls}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Comma-separated weights. Fill one row for single-unit ladders; fill both to override per-unit. Leave both blank to use the equipment's default ladder.
      </p>
    </div>
  )
}

// ── Isometric milestone ladder ──────────────────────────────────────────────
// Custom hold-time milestones for isometric movements (Plank Hold, L-sit, etc.).
// Default ladder is [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] secs
// — hard-coded in the mobile detail page. This editor stores an array of
// seconds; null = use the default. Mobile reads `isometric_ladder_override`
// when present and falls back to the default otherwise.
function parseIsoLadder(str) {
  const nums = (str || '').split(/[,\s]+/).map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0)
  return nums.length > 0 ? nums.sort((a, b) => a - b) : null
}

function serializeIsoLadder(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(', ')
  return ''
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminMovements() {
  // ── Add form state ──────────────────────────────────────────────────────────
  const [name,         setName]         = useState('')
  const [category,     setCategory]     = useState(null)
  const [cardioMode,   setCardioMode]   = useState(null)
  const [strengthType, setStrengthType] = useState(null)
  const [equipment,    setEquipment]    = useState(null)
  const [bandAssist,   setBandAssist]   = useState(false)
  const [kneeAssist,   setKneeAssist]   = useState(false)
  const [weightedProgression, setWeightedProgression] = useState(false)  // bodyweight: supports added load
  const [usesPair,     setUsesPair]     = useState(false)  // kettlebell pair flag
  const [liftType,     setLiftType]     = useState('')    // '' | 'olympic' | 'ballistic' (barbell/kettlebell rep-based)
  const [holdType,     setHoldType]     = useState('')    // '' | 'leverage' | 'load' (isometric)
  const [ladderLb,     setLadderLb]     = useState('')        // structured ladder rows
  const [ladderKg,     setLadderKg]     = useState('')
  const [isoLadderStr, setIsoLadderStr] = useState('')        // isometric milestone override (seconds)
  const [unitLock,     setUnitLock]     = useState(null)      // 'kg' | 'lb' | 'mi' | 'km' | null
  const [unitLockTouched, setUnitLockTouched] = useState(false) // tracks manual overrides so smart defaults stop firing
  const [deprecated,   setDeprecated]   = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [error,        setError]        = useState('')

  // Variants — array of {full, short} objects.
  //   full  → goes in the row name's brackets (e.g. "Swimming [Freestyle]").
  //   short → max 10 chars, stored on the row as `variant_short_label`.
  // Each entry becomes a child movement row at save time, with parent_movement_id
  // pointing back at the parent row. Empty array = no variants (common case).
  const [variants,            setVariants]            = useState([])
  const [variantInput,        setVariantInput]        = useState('')
  const [variantShortInput,   setVariantShortInput]   = useState('')

  // ── Edit form state ─────────────────────────────────────────────────────────
  const [editingMovement, setEditingMovement] = useState(null)
  const [editName,         setEditName]         = useState('')
  const [editCategory,     setEditCategory]     = useState(null)
  const [editCardioMode,   setEditCardioMode]   = useState(null)
  const [editStrengthType, setEditStrengthType] = useState(null)
  const [editEquipment,    setEditEquipment]    = useState(null)
  const [editBandAssist,   setEditBandAssist]   = useState(false)
  const [editKneeAssist,   setEditKneeAssist]   = useState(false)
  const [editWeightedProgression, setEditWeightedProgression] = useState(false)
  const [editUsesPair,     setEditUsesPair]     = useState(false)
  const [editLiftType,     setEditLiftType]     = useState('')
  const [editHoldType,     setEditHoldType]     = useState('')
  const [editLadderLb,     setEditLadderLb]     = useState('')
  const [editLadderKg,     setEditLadderKg]     = useState('')
  const [editIsoLadderStr, setEditIsoLadderStr] = useState('')
  const [editUnitLock,     setEditUnitLock]     = useState(null)
  const [editDeprecated,   setEditDeprecated]   = useState(false)
  const [editSaving,       setEditSaving]       = useState(false)
  const [editSaved,        setEditSaved]        = useState(false)
  const [editError,        setEditError]        = useState('')
  const [editVariants,     setEditVariants]     = useState([])  // {full, short}[] populated from DB on edit open
  const [editVariantInput, setEditVariantInput] = useState('')
  const [editVariantShortInput, setEditVariantShortInput] = useState('')
  // Track which variant rows existed when the form opened, so the save
  // path can diff and only INSERT new variants / DELETE removed ones.
  const [editVariantsOriginal, setEditVariantsOriginal] = useState([])  // {full, short}[]

  // ── Add panel open/close ─────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)

  // ── List state ──────────────────────────────────────────────────────────────
  const [existing,     setExisting]     = useState([])
  const [searchQuery,  setSearchQuery]  = useState('')
  const [filterChip,   setFilterChip]   = useState('all')
  const [sortMode,     setSortMode]     = useState('name-asc')
  const [bulkMode,     setBulkMode]     = useState(false)
  const [bulkSelected, setBulkSelected] = useState(() => new Set())

  // ── Delete-with-warning state ───────────────────────────────────────────────
  // Counts efforts referencing the movement's NAME (the label prefix) before
  // letting admin confirm a hard delete. Effort labels look like
  //   "Atlas Stone Bear Hug Carry · 100 kg × 15 m"
  // so we look up by `label LIKE 'name · %'`.
  const [pendingDelete,      setPendingDelete]      = useState(null)
  const [pendingDeleteCount, setPendingDeleteCount] = useState(null)
  const [pendingDeleteMany,  setPendingDeleteMany]  = useState(null) // array of movements for bulk-delete confirm

  // ── Load movements ──────────────────────────────────────────────────────────
  // Pull ALL rows including variant children — the variant child rows are
  // hidden from the main list display, but we count them per parent to
  // show "3 variants" pills, and we let admin opt into showing them via
  // the "Variants" filter chip.
  function fetchExisting() {
    supabase
      .from('movements')
      .select('*')
      .order('name')
      .then(({ data }) => setExisting(data || []))
  }

  useEffect(() => { fetchExisting() }, [])

  // Pre-compute the variant count for each parent so the list row can show
  // "3 variants" pill without re-scanning the array per render.
  const variantCountByParent = useMemo(() => {
    const counts = new Map()
    for (const m of existing) {
      if (!m.parent_movement_id) continue
      counts.set(m.parent_movement_id, (counts.get(m.parent_movement_id) || 0) + 1)
    }
    return counts
  }, [existing])

  // ── Populate edit form when editingMovement changes ─────────────────────────
  useEffect(() => {
    if (!editingMovement) return
    setEditName(editingMovement.name)
    setEditCategory(editingMovement.category)
    setEditCardioMode(editingMovement.cardio_mode ?? null)
    setEditStrengthType(editingMovement.strength_type ?? null)
    setEditEquipment(editingMovement.equipment ?? null)
    setEditBandAssist(editingMovement.band_assist ?? false)
    setEditKneeAssist(editingMovement.knee_assist ?? false)
    setEditWeightedProgression(editingMovement.weighted_progression ?? false)
    setEditUsesPair(editingMovement.uses_pair ?? false)
    setEditLiftType(editingMovement.lift_type ?? '')
    setEditHoldType(editingMovement.hold_type ?? '')
    const rows = ladderToRows(
      editingMovement.weight_ladder_override,
      editingMovement.unit_lock === 'kg' ? 'kg' : 'lb',
    )
    setEditLadderLb(rows.lb)
    setEditLadderKg(rows.kg)
    setEditIsoLadderStr(serializeIsoLadder(editingMovement.isometric_ladder_override))
    setEditUnitLock(editingMovement.unit_lock ?? null)
    setEditDeprecated(!!editingMovement.deprecated)
    setEditSaved(false)
    setEditError('')
    setEditVariantInput('')
    setEditVariantShortInput('')
    // Load variants for this parent — extract the full label from the bracket
    // and the short label from the variant_short_label column. UI chips show
    // "Freestyle (FREE)" so admin sees both at a glance. A row that's itself
    // a variant (has its own parent_movement_id) has no children → show empty.
    if (editingMovement.parent_movement_id) {
      setEditVariants([])
      setEditVariantsOriginal([])
    } else {
      const entries = existing
        .filter(m => m.parent_movement_id === editingMovement.id)
        .map(m => {
          const full = extractVariantLabel(m.name, editingMovement.name)
          if (!full) return null
          const short = m.variant_short_label || suggestShortLabel(full)
          return { full, short }
        })
        .filter(Boolean)
      setEditVariants(entries)
      setEditVariantsOriginal(entries)
    }
  }, [editingMovement, existing])

  // ── Smart unit-lock default (Add form only) ─────────────────────────────────
  // When admin picks strongman or types "ruck…" in the name, auto-suggest
  // the community-standard unit lock. The admin can override (the manual
  // override sticks via `unitLockTouched`). Edit form doesn't auto-suggest
  // — it always shows what's currently on the row.
  //
  // We ALSO clear unit_lock automatically when its current value doesn't
  // belong to the active category's option set — e.g., admin picks strength
  // → strongman (auto-sets `kg`), then changes their mind to cardio → the
  // `kg` value is no longer valid (cardio's options are mi/km only). Without
  // this clear, the DB would receive a nonsensical save.
  useEffect(() => {
    const validOptions = relevantUnitLockOptions(category).map(o => o.value)
    if (unitLock != null && !validOptions.includes(unitLock)) {
      setUnitLock(null)
      setUnitLockTouched(false)
      return
    }
    if (unitLockTouched) return
    const suggested = suggestUnitLock(category, equipment, name)
    if (suggested !== unitLock) setUnitLock(suggested)
  }, [category, equipment, name, unitLock, unitLockTouched])

  // ── Add form: tree selection handlers ───────────────────────────────────────
  function selectCategory(val) {
    setCategory(val)
    setCardioMode(null); setStrengthType(null)
    setEquipment(null); setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    setLiftType(''); setHoldType('')
    setLadderLb(''); setLadderKg(''); setIsoLadderStr('')
  }
  function selectStrengthType(val) {
    setStrengthType(val)
    setEquipment(null); setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    setLadderLb(''); setLadderKg('')
    // lift_type is rep-based-only; hold_type is isometric-only.
    setLiftType('')
    if (val !== 'isometric') setHoldType('')
    // Isometric ladder only meaningful when the movement IS isometric.
    if (val !== 'isometric') setIsoLadderStr('')
  }
  function selectEquipment(val) {
    setEquipment(val)
    setBandAssist(false); setKneeAssist(false)
    // weighted_progression is bodyweight-only
    if (val !== 'bodyweight') setWeightedProgression(false)
    // uses_pair is kettlebell-only
    if (val !== 'kettlebell') setUsesPair(false)
    // lift_type only applies to barbell / kettlebell.
    if (!['barbell', 'kettlebell'].includes(val)) setLiftType('')
    // Ladder override only makes sense for ladder-style equipment.
    if (!['kettlebell', 'strongman', 'carry'].includes(val)) { setLadderLb(''); setLadderKg('') }
  }

  // ── Edit form: tree selection handlers ──────────────────────────────────────
  function editSelectCategory(val) {
    setEditCategory(val)
    setEditCardioMode(null); setEditStrengthType(null)
    setEditEquipment(null); setEditBandAssist(false); setEditKneeAssist(false); setEditWeightedProgression(false); setEditUsesPair(false)
    setEditLiftType(''); setEditHoldType('')
    setEditLadderLb(''); setEditLadderKg(''); setEditIsoLadderStr('')
  }
  function editSelectStrengthType(val) {
    setEditStrengthType(val)
    setEditEquipment(null); setEditBandAssist(false); setEditKneeAssist(false); setEditWeightedProgression(false); setEditUsesPair(false)
    setEditLadderLb(''); setEditLadderKg('')
    setEditLiftType('')
    if (val !== 'isometric') setEditHoldType('')
    if (val !== 'isometric') setEditIsoLadderStr('')
  }
  function editSelectEquipment(val) {
    setEditEquipment(val)
    setEditBandAssist(false); setEditKneeAssist(false)
    if (val !== 'bodyweight') setEditWeightedProgression(false)
    if (val !== 'kettlebell') setEditUsesPair(false)
    if (!['barbell', 'kettlebell'].includes(val)) setEditLiftType('')
    if (!['kettlebell', 'strongman', 'carry'].includes(val)) { setEditLadderLb(''); setEditLadderKg('') }
  }

  // ── Completion checks ────────────────────────────────────────────────────────
  // Rep range was REQUIRED in the old design but no longer collected — every
  // weighted-standard strength movement uses the same global adp-zone
  // boundaries (1-5 / 6-12 / 13+). Save button enables as soon as the tree
  // selection is unambiguous.
  const isComplete = (() => {
    if (!name.trim() || !category) return false
    if (category === 'cardio')         return !!cardioMode
    if (strengthType === 'isometric')  return true
    if (!strengthType || !equipment)   return false
    return true
  })()

  const editIsComplete = (() => {
    if (!editName.trim() || !editCategory) return false
    if (editCategory === 'cardio')          return !!editCardioMode
    if (editStrengthType === 'isometric')   return true
    if (!editStrengthType || !editEquipment) return false
    return true
  })()

  // ── Add: save ────────────────────────────────────────────────────────────────
  // Creates the parent movement row first, then inserts one variant row per
  // label in the `variants` array — each variant inherits the parent's
  // cascade config (category, equipment, unit_lock, modifiers, ladders) and
  // gets `parent_movement_id` set so the consolidation logic on mobile can
  // group them. Variant rows are named `${parent} [${label}]` to match the
  // historical naming pattern used by existing effort labels (e.g.
  // "Swimming [Freestyle] · 1500m in 25:00"). If the variants array is
  // empty, only the parent row is created (the common case).
  async function save() {
    if (!isComplete || saving) return
    setSaving(true); setError('')

    const isRepBased = category === 'strength' && strengthType === 'rep-based'
    const isIso      = category === 'strength' && strengthType === 'isometric'

    const ladderOverride = isRepBased && ['kettlebell', 'strongman', 'carry'].includes(equipment)
      ? parseStructuredLadder(ladderLb, ladderKg)
      : null

    // rep_range_lo / rep_range_hi are deliberately NOT included — the field
    // was retired May 20 2026. New rows insert with NULL via the column
    // default; existing values stay untouched on Edit (UPDATE only writes
    // the keys we list here).
    const record = {
      name:          name.trim(),
      category,
      strength_type: category === 'strength' ? strengthType : null,
      equipment:     isRepBased ? equipment : null,
      band_assist:   equipment === 'bodyweight' ? bandAssist : false,
      knee_assist:   equipment === 'bodyweight' ? kneeAssist : false,
      weighted_progression: equipment === 'bodyweight' ? weightedProgression : false,
      uses_pair:     equipment === 'kettlebell' ? usesPair : false,
      lift_type:     (equipment === 'barbell' || equipment === 'kettlebell') && strengthType === 'rep-based' ? (liftType || null) : null,
      hold_type:     strengthType === 'isometric' ? (holdType || null) : null,
      cardio_mode:   category === 'cardio' ? cardioMode : null,
      weight_ladder_override:    ladderOverride,
      isometric_ladder_override: isIso ? parseIsoLadder(isoLadderStr) : null,
      unit_lock:     unitLock || null,
      deprecated:    !!deprecated,
    }

    // Insert the parent row first — we need its generated id to point
    // the variant rows at via parent_movement_id.
    const { data: parentRow, error: err } = await supabase
      .from('movements')
      .insert(record)
      .select()
      .single()
    if (err || !parentRow) {
      setError(
        err?.message?.includes('unique') || err?.code === '23505'
          ? `"${record.name}" already exists in the movement list.`
          : 'Failed to save. Please try again.'
      )
      setSaving(false)
      return
    }

    // Insert variant rows. Each inherits the parent's cascade config
    // verbatim and adds parent_movement_id + the suffixed name
    // ("Swimming [Freestyle]" etc.) + variant_short_label (the badge
    // shown on the mobile index when the row's last-logged variant is
    // this one). Skipped when the admin didn't add any variants.
    if (variants.length > 0) {
      const variantRows = variants.map(v => ({
        ...record,
        name:                 buildVariantName(record.name, v.full),
        parent_movement_id:   parentRow.id,
        variant_short_label:  v.short,
      }))
      const { error: variantErr } = await supabase.from('movements').insert(variantRows)
      if (variantErr) {
        // Parent landed but at least one variant failed (most likely a
        // duplicate name). Roll back the parent so the admin can fix it.
        await supabase.from('movements').delete().eq('id', parentRow.id)
        setError(
          variantErr.code === '23505'
            ? 'One of the variant names already exists. Pick different labels.'
            : 'Failed to save variants. Please try again.'
        )
        setSaving(false)
        return
      }
    }

    invalidateMovements()
    fetchExisting()
    setName(''); setCategory(null); setCardioMode(null)
    setStrengthType(null); setEquipment(null)
    setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    setLiftType(''); setHoldType('')
    setLadderLb(''); setLadderKg('')
    setIsoLadderStr(''); setUnitLock(null); setUnitLockTouched(false); setDeprecated(false)
    setVariants([]); setVariantInput(''); setVariantShortInput('')
    setSaving(false); setSaved(true)
    setTimeout(() => { setSaved(false); setAddOpen(false) }, 2000)
  }

  // ── Edit: save ────────────────────────────────────────────────────────────────
  async function editSave() {
    if (!editIsComplete || editSaving) return
    setEditSaving(true); setEditError('')

    const isRepBased = editCategory === 'strength' && editStrengthType === 'rep-based'
    const isIso      = editCategory === 'strength' && editStrengthType === 'isometric'

    const ladderOverride = isRepBased && ['kettlebell', 'strongman', 'carry'].includes(editEquipment)
      ? parseStructuredLadder(editLadderLb, editLadderKg)
      : null

    // rep_range_lo / rep_range_hi deliberately NOT in the UPDATE — preserves
    // historical values on existing rows so we can resurrect them if we ever
    // wire the field back up (Option 2 from the May 20 2026 audit).
    const record = {
      name:          editName.trim(),
      category:      editCategory,
      strength_type: editCategory === 'strength' ? editStrengthType : null,
      equipment:     isRepBased ? editEquipment : null,
      band_assist:   editEquipment === 'bodyweight' ? editBandAssist : false,
      knee_assist:   editEquipment === 'bodyweight' ? editKneeAssist : false,
      weighted_progression: editEquipment === 'bodyweight' ? editWeightedProgression : false,
      uses_pair:     editEquipment === 'kettlebell' ? editUsesPair : false,
      lift_type:     (editEquipment === 'barbell' || editEquipment === 'kettlebell') && editStrengthType === 'rep-based' ? (editLiftType || null) : null,
      hold_type:     editStrengthType === 'isometric' ? (editHoldType || null) : null,
      cardio_mode:   editCategory === 'cardio' ? editCardioMode : null,
      weight_ladder_override:    ladderOverride,
      isometric_ladder_override: isIso ? parseIsoLadder(editIsoLadderStr) : null,
      unit_lock:     editUnitLock || null,
      deprecated:    !!editDeprecated,
    }

    const { error: err } = await supabase.from('movements').update(record).eq('id', editingMovement.id)
    if (err) {
      setEditError(
        err.message?.includes('unique') || err.code === '23505'
          ? `"${record.name}" already exists.`
          : 'Failed to save. Try again.'
      )
      setEditSaving(false)
      return
    }

    // ── Variant diff: insert added, delete removed ────────────────────────────
    // Variant rows are themselves stored as movements with parent_movement_id
    // pointing at the parent. We only do this when editing a PARENT row
    // (the movement being edited has no parent itself). Edits on a variant
    // row leave its siblings alone.
    if (!editingMovement.parent_movement_id) {
      // Diff key = full label (lowercase). Short label changes on EXISTING
      // chips are picked up by the survivor-update pass below; new chips
      // carry their short label into the INSERT.
      const beforeMap = new Map(editVariantsOriginal.map(v => [v.full.toLowerCase(), v]))
      const afterMap  = new Map(editVariants.map(v => [v.full.toLowerCase(), v]))
      const added    = editVariants.filter(v => !beforeMap.has(v.full.toLowerCase()))
      const removed  = editVariantsOriginal.filter(v => !afterMap.has(v.full.toLowerCase()))

      if (added.length > 0) {
        const addedRows = added.map(v => ({
          ...record,
          name:                 buildVariantName(record.name, v.full),
          parent_movement_id:   editingMovement.id,
          variant_short_label:  v.short,
        }))
        const { error: addErr } = await supabase.from('movements').insert(addedRows)
        if (addErr) {
          setEditError(
            addErr.code === '23505'
              ? 'One of the new variant names already exists.'
              : 'Failed to save new variants. Try again.'
          )
          setEditSaving(false)
          return
        }
      }
      if (removed.length > 0) {
        const removedNames = removed.map(v => buildVariantName(editingMovement.name, v.full))
        // CASCADE: wipe every effort logged under any of the removed
        // variants FIRST, so deleting a variant via the edit form's chip
        // input mirrors the trash-icon's clean-wipe semantics. Without
        // this, the variant row would be gone but its effort labels
        // would orphan in the efforts table.
        const effortFilters = removedNames.map(n => `label.like.${n} · %`).join(',')
        await supabase.from('efforts').delete().or(effortFilters)
        await supabase
          .from('movements')
          .delete()
          .eq('parent_movement_id', editingMovement.id)
          .in('name', removedNames)
      }

      // Survivor pass: rename rows if the parent's name changed AND/OR
      // update the variant_short_label if admin edited the short field
      // on an existing chip.
      const survivors = editVariants.filter(v => beforeMap.has(v.full.toLowerCase()))
      for (const v of survivors) {
        const prev = beforeMap.get(v.full.toLowerCase())
        const renamed     = record.name !== editingMovement.name
        const shortDirty  = (prev?.short || '') !== v.short
        if (!renamed && !shortDirty) continue
        const oldName = buildVariantName(editingMovement.name, v.full)
        const patch = {}
        if (renamed)    patch.name = buildVariantName(record.name, v.full)
        if (shortDirty) patch.variant_short_label = v.short
        await supabase
          .from('movements')
          .update(patch)
          .eq('parent_movement_id', editingMovement.id)
          .eq('name', oldName)
      }
    }

    invalidateMovements()
    fetchExisting()
    setEditSaving(false); setEditSaved(true)
    setTimeout(() => {
      setEditingMovement(null)
      setEditSaved(false)
    }, 1500)
  }

  // ── Effort count ────────────────────────────────────────────────────────────
  // Family-aware label set for a movement. For a family parent, returns
  // the parent's name + every variant's name (so cascade-delete catches
  // efforts logged against any variant). For a plain movement or a single
  // variant row, returns just its own name.
  const familyLabelsFor = useCallback((movement) => {
    if (!movement) return []
    const names = [movement.name]
    // If `movement` is a family parent (no parent_movement_id but has
    // children pointing at it), collect every variant's name too.
    if (!movement.parent_movement_id) {
      existing
        .filter(m => m.parent_movement_id === movement.id)
        .forEach(v => names.push(v.name))
    }
    return names
  }, [existing])

  // Effort labels are stored as `"<movement name> · …"` so we can count how
  // many efforts reference a movement by name. Wrapped in a stable callback
  // for re-use in single + bulk delete. Family-aware: counts across every
  // variant in a family when the target is a parent.
  const countEffortsForMovement = useCallback(async (movement) => {
    const names = familyLabelsFor(movement)
    if (names.length === 0) return 0
    // `like` with %  matches "Name · …" prefix (including the canonical
    // " · " separator used by every effort label). OR each name's prefix.
    const filters = names.map(n => `label.like.${n} · %`).join(',')
    const { count } = await supabase
      .from('efforts')
      .select('id', { count: 'exact', head: true })
      .or(filters)
    return Number(count) || 0
  }, [familyLabelsFor])

  // ── Delete (single) — pre-fetches effort count, opens confirm dialog ────────
  // The dialog is the GO/NO-GO gate: hitting Cancel leaves the movement intact;
  // hitting Confirm CLEAN-WIPES: deletes the movement (+ its variants via FK
  // CASCADE) AND every effort whose label starts with the movement's name or
  // any of its variant names. The warning surfaces the effort count so the
  // admin sees exactly how much data they're about to destroy.
  //
  // If the admin wants to preserve historical efforts, they should use the
  // "Deprecate" toggle in the Edit form instead — which hides the movement
  // from search but keeps the row + all efforts intact.
  async function requestDeleteMovement(movement) {
    setPendingDelete(movement)
    setPendingDeleteCount(null) // loading
    const count = await countEffortsForMovement(movement)
    setPendingDeleteCount(count)
  }

  async function confirmDeleteMovement() {
    if (!pendingDelete) return
    // STEP 1 — wipe matching efforts FIRST (before the movements row is
    // gone, so we can still look up its family variant names). For a
    // family parent, this catches efforts under every variant's name in
    // one query.
    const names = familyLabelsFor(pendingDelete)
    if (names.length > 0) {
      const filters = names.map(n => `label.like.${n} · %`).join(',')
      await supabase.from('efforts').delete().or(filters)
    }
    // STEP 2 — delete the movement. FK CASCADE removes any child variant
    // rows automatically.
    const { error: err } = await supabase.from('movements').delete().eq('id', pendingDelete.id)
    if (err) {
      fetchExisting()
      setPendingDelete(null); setPendingDeleteCount(null)
      return
    }
    invalidateMovements()
    fetchExisting()
    setPendingDelete(null); setPendingDeleteCount(null)
  }

  // ── Bulk delete (after admin selects 2+ rows in bulk mode) ──────────────────
  async function requestBulkDelete() {
    if (bulkSelected.size === 0) return
    const selectedMovements = existing.filter(m => bulkSelected.has(m.id))
    setPendingDeleteMany(selectedMovements)
  }

  async function confirmBulkDelete() {
    if (!pendingDeleteMany) return
    // STEP 1 — wipe all matching efforts across every selected movement
    // (and their variants if any are family parents).
    const allNames = pendingDeleteMany.flatMap(m => familyLabelsFor(m))
    if (allNames.length > 0) {
      const filters = allNames.map(n => `label.like.${n} · %`).join(',')
      await supabase.from('efforts').delete().or(filters)
    }
    // STEP 2 — delete the movements. FK CASCADE removes child variants.
    const ids = pendingDeleteMany.map(m => m.id)
    const { error: err } = await supabase.from('movements').delete().in('id', ids)
    if (!err) {
      invalidateMovements()
      fetchExisting()
      setBulkSelected(new Set())
      setBulkMode(false)
    }
    setPendingDeleteMany(null)
  }

  // ── Filtered + sorted movement list ─────────────────────────────────────────
  // Three-stage pipeline:
  //   1. Filter chip narrows by category / equipment / type (or "All").
  //      Deprecated rows are hidden by default UNLESS the chip is
  //      "Deprecated" (which scopes to deprecated only).
  //   2. Search tokens — every token must appear in the name.
  //   3. Sort mode — admin-chosen ordering (name / created / updated).
  const filteredMovements = useMemo(() => {
    const tokens = searchQuery.trim() ? tokenize(searchQuery) : null

    // Helper — does this row pass the filter chip + deprecated rule + search?
    const rowPasses = (m) => {
      if (!matchesFilter(m, filterChip)) return false
      if (m.deprecated && filterChip !== 'deprecated') return false
      if (tokens && !smartMatch(m.name, tokens)) return false
      return true
    }

    // STEP 1 — identify which top-level rows (parents + standalones) to
    // include. A top-level row is included if EITHER it matches itself OR
    // any of its variants match the search (so searching "Ex 1" still
    // surfaces the parent "Test" with its matching variant below).
    const topLevel = existing.filter(m => {
      if (m.parent_movement_id) return false
      if (rowPasses(m)) return true
      // Parent didn't match — does any variant match the search?
      if (tokens) {
        const variantMatches = existing.some(v =>
          v.parent_movement_id === m.id && rowPasses(v)
        )
        if (variantMatches) return true
      }
      return false
    })

    // STEP 2 — apply sort mode to top-level rows. Family parents stay
    // anchored to their position in this sorted list; variants follow
    // immediately after their parent regardless of the sort mode.
    const augmented = topLevel.map(m => ({ ...m, variantCount: variantCountByParent.get(m.id) || 0 }))

    if (tokens) {
      // Search-relevance sort
      augmented.sort((a, b) => {
        const diff = scoreMatch(a.name, tokens) - scoreMatch(b.name, tokens)
        return diff !== 0 ? diff : a.name.localeCompare(b.name)
      })
    } else {
      const ts = (m, key) => new Date(m[key] || 0).getTime()
      switch (sortMode) {
        case 'name-desc':    augmented.sort((a, b) => b.name.localeCompare(a.name)); break
        case 'updated-desc': augmented.sort((a, b) => ts(b, 'updated_at') - ts(a, 'updated_at')); break
        case 'updated-asc':  augmented.sort((a, b) => ts(a, 'updated_at') - ts(b, 'updated_at')); break
        case 'created-desc': augmented.sort((a, b) => ts(b, 'created_at') - ts(a, 'created_at')); break
        case 'created-asc':  augmented.sort((a, b) => ts(a, 'created_at') - ts(b, 'created_at')); break
        case 'name-asc':
        default:             augmented.sort((a, b) => a.name.localeCompare(b.name))
      }
    }

    // STEP 3 — interleave variants directly after their parent. Each
    // variant carries `_isVariant` + `_isLastVariant` flags so the row
    // renderer can apply the L-shape tree connector. Variants are
    // ordered by created_at within each family.
    const flat = []
    augmented.forEach(parent => {
      flat.push(parent)
      const variants = existing
        .filter(v => v.parent_movement_id === parent.id)
        .filter(v => !v.deprecated || filterChip === 'deprecated')
        .slice()
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      variants.forEach((v, i) => {
        flat.push({ ...v, _isVariant: true, _isLastVariant: i === variants.length - 1 })
      })
    })
    return flat
  }, [existing, searchQuery, filterChip, sortMode, variantCountByParent])

  const editSummaryParts = buildSummary(
    editCategory, editCardioMode, editStrengthType, editEquipment,
    editBandAssist, editKneeAssist,
    editUnitLock, editDeprecated,
    editLiftType, editHoldType,
  )
  const addSummaryParts  = buildSummary(
    category, cardioMode, strengthType, equipment,
    bandAssist, kneeAssist,
    unitLock, deprecated,
    liftType, holdType,
  )

  // ── Dynamic step numbering ─────────────────────────────────────────────────
  // Counts only the steps that are currently rendered, so step labels stay
  // consecutive across every cascade path (cardio = ~4 steps; strength
  // rep-based bodyweight = ~6 steps; strength iso = ~3 steps; etc.).
  // Returns the 1-indexed position of a step key, or 0 if not present.
  //
  // MUST be declared BEFORE the auto-scroll useEffects below — the effects
  // read `addStepList.length` / `editStepList.length` in their dependency
  // arrays, which are evaluated synchronously during render. Putting the
  // declarations after the effects throws a TDZ ReferenceError that
  // crashes the whole component → blank page.
  function computeSteps({ nameFilled, category, cardioMode, strengthType, equipment, includeVisibility }) {
    const steps = ['name']
    if (nameFilled) steps.push('category')
    if (category === 'cardio') steps.push('cardioMode')
    if (category === 'strength') steps.push('strengthType')
    if (category === 'strength' && strengthType === 'rep-based') steps.push('equipment')
    // Modifier blocks ALSO require strength_type === 'rep-based' — defensive
    // against stale DB rows that carry an `equipment` value while the
    // strength_type is 'isometric' (legacy data from before the cascade
    // constraint was added). Without this check, the form would surface
    // bodyweight / kettlebell modifier blocks on isometric movements.
    if (strengthType === 'rep-based' && equipment === 'bodyweight') steps.push('bwModifiers')
    if (strengthType === 'rep-based' && equipment === 'kettlebell') steps.push('kbSetup')
    if (strengthType === 'rep-based' && (equipment === 'barbell' || equipment === 'kettlebell')) steps.push('liftStyle')
    if (strengthType === 'rep-based' && ['kettlebell', 'strongman', 'carry'].includes(equipment)) steps.push('weightLadder')
    if (category === 'strength' && strengthType === 'isometric') steps.push('holdType')
    if (category === 'strength' && strengthType === 'isometric') steps.push('isoLadder')
    if (shouldShowUnitLock(category, cardioMode, strengthType, equipment)) steps.push('unitLock')
    // Variants step renders for BOTH strength and cardio once the core
    // cascade is unambiguous. Cardio routes through
    // CardioFamilyConsolidatedDetail (mirror of strength's wrapper).
    if (shouldShowUnitLock(category, cardioMode, strengthType, equipment)) steps.push('variants')
    if (includeVisibility) steps.push('visibility')
    return steps
  }
  const addStepList  = computeSteps({ nameFilled: name.trim().length > 0,  category, cardioMode, strengthType, equipment, includeVisibility: false })
  const editStepList = computeSteps({ nameFilled: editName.trim().length > 0, category: editCategory, cardioMode: editCardioMode, strengthType: editStrengthType, equipment: editEquipment, includeVisibility: true })
  const addStep      = (key) => Math.max(1, addStepList.indexOf(key) + 1)
  const editStep     = (key) => Math.max(1, editStepList.indexOf(key) + 1)

  // ── Auto-scroll to the newest cascade step ─────────────────────────────────
  // Strategy: only scroll when the cascade GROWS (a new step appears). When
  // the user picks an option within an existing step — toggling a bodyweight
  // modifier, choosing a unit-lock value, etc. — the step list length stays
  // the same so we don't scroll (no more jarring "scroll back up" when the
  // user clicks the last visible step's options).
  //
  // Target: the LAST step's element, centered in the viewport via
  // `block: 'center'`. Each cascade step has a `data-step="<key>"` attribute
  // so we querySelector for it inside the form's wrapper ref. Centering means
  // the new step lands in the middle of the screen — easier to scan than
  // bottom-aligned.
  const addFormRef          = useRef(null)
  const editFormRef         = useRef(null)
  const prevAddStepCount    = useRef(0)
  const prevEditStepCount   = useRef(0)
  const isInitialAddRender  = useRef(true)
  const isInitialEditRender = useRef(true)
  // Reset on form-open so the very first cascade transition after opening
  // the form doesn't trigger a scroll (the user just opened it; let them
  // start at the top without a jump).
  useEffect(() => { isInitialAddRender.current = true;  prevAddStepCount.current  = 0 }, [addOpen])
  useEffect(() => { isInitialEditRender.current = true; prevEditStepCount.current = 0 }, [editingMovement])

  // Scroll to the FIRST step that just appeared, not the last. When the
  // cascade grows by multiple steps at once (e.g. selecting kettlebell
  // reveals kbSetup + weightLadder + unitLock + variants together), the
  // admin's eye should land on the IMMEDIATE NEXT question (kbSetup),
  // not skip ahead to the bottom. Since computeSteps appends in a fixed
  // order, the step at index `prevCount` in the new list is the first
  // newly-added step.
  function scrollToFirstNewStep(formRef, stepList, prevCount) {
    const targetKey = stepList[prevCount]
    if (!targetKey) return
    const el = formRef.current?.querySelector(`[data-step="${targetKey}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  useEffect(() => {
    if (isInitialAddRender.current) {
      isInitialAddRender.current = false
      prevAddStepCount.current   = addStepList.length
      return
    }
    if (addStepList.length > prevAddStepCount.current) {
      const prev = prevAddStepCount.current
      const id = setTimeout(() => scrollToFirstNewStep(addFormRef, addStepList, prev), 150)
      prevAddStepCount.current = addStepList.length
      return () => clearTimeout(id)
    }
    prevAddStepCount.current = addStepList.length
  }, [addStepList.length])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isInitialEditRender.current) {
      isInitialEditRender.current = false
      prevEditStepCount.current   = editStepList.length
      return
    }
    if (editStepList.length > prevEditStepCount.current) {
      const prev = prevEditStepCount.current
      const id = setTimeout(() => scrollToFirstNewStep(editFormRef, editStepList, prev), 150)
      prevEditStepCount.current = editStepList.length
      return () => clearTimeout(id)
    }
    prevEditStepCount.current = editStepList.length
  }, [editStepList.length])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bulk select helpers ─────────────────────────────────────────────────────
  function toggleBulkRow(id) {
    setBulkSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function exitBulkMode() {
    setBulkMode(false)
    setBulkSelected(new Set())
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-center gap-3">
        {editingMovement && (
          <button
            onClick={() => setEditingMovement(null)}
            aria-label="Go back"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {/* Header — page-level "Libraries" title is owned by the parent
            AdminLibraries.jsx (May 28 2026 nav rebuild). This block now
            renders only the edit-mode heading (so the user knows they
            switched to edit mode) + the contextual subtitle. The static
            "Movement Library" h1 was dropped because the parent tab bar
            already says "Movements". */}
        <div>
          {editingMovement && (
            <h2 className="text-xl font-semibold tracking-tight">
              Edit: {editingMovement.name}
            </h2>
          )}
          <p className={`text-sm text-muted-foreground ${editingMovement ? 'mt-0.5' : ''}`}>
            {editingMovement
              ? 'Change any property — updates take effect immediately across all client search lists.'
              : 'Manage movements — they appear instantly in every client\'s search list.'}
          </p>
        </div>
      </div>

      {/* ── Edit form ── */}
      {editingMovement ? (
        <div ref={editFormRef} className="animate-rise rounded-xl border border-border bg-card p-6 space-y-6">

          {/* Name */}
          <div data-step="name" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('name')}</span>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Movement name</p>
            </div>
            <input
              type="text"
              value={editName}
              onChange={e => { setEditName(toTitleCase(e.target.value)); setEditError('') }}
              placeholder="e.g. Romanian Deadlift…"
              className={inputCls}
            />
          </div>

          {/* Category */}
          {editName.trim().length > 0 && (
            <div data-step="category">
              <TreeLevel step={editStep('category')} label="Category" options={CATEGORY_OPTIONS} selected={editCategory} onSelect={editSelectCategory} />
            </div>
          )}

          {/* Cardio mode */}
          {editCategory === 'cardio' && (
            <div data-step="cardioMode">
              <TreeLevel step={editStep('cardioMode')} label="Track by" options={CARDIO_MODE_OPTIONS} selected={editCardioMode} onSelect={setEditCardioMode} />
            </div>
          )}

          {/* Strength type */}
          {editCategory === 'strength' && (
            <div data-step="strengthType">
              <TreeLevel step={editStep('strengthType')} label="Movement type" options={STRENGTH_TYPE_OPTIONS} selected={editStrengthType} onSelect={editSelectStrengthType} />
            </div>
          )}

          {/* Equipment */}
          {editStrengthType === 'rep-based' && (
            <div data-step="equipment">
              <TreeLevel step={editStep('equipment')} label="Equipment" options={EQUIPMENT_OPTIONS} selected={editEquipment} onSelect={editSelectEquipment} />
            </div>
          )}

          {/* Bodyweight modifiers — gated on BOTH strength_type AND equipment
              so stale rows carrying equipment='bodyweight' while
              strength_type='isometric' don't surface this block. */}
          {editStrengthType === 'rep-based' && editEquipment === 'bodyweight' && (
            <div data-step="bwModifiers" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('bwModifiers')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assisted variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip
                  label="Band-assist eligible"
                  description="Allow band assistance — banded pull up"
                  checked={editBandAssist}
                  onChange={setEditBandAssist}
                />
                <ToggleChip
                  label="Knee-assist eligible"
                  description="Allow knee assistance — knee push up"
                  checked={editKneeAssist}
                  onChange={setEditKneeAssist}
                />
                <ToggleChip
                  label="Weight progression eligible"
                  description="Add weight via belt, vest, or plate — pull up, push up, dip"
                  checked={editWeightedProgression}
                  onChange={setEditWeightedProgression}
                />
              </div>
            </div>
          )}

          {/* Kettlebell pair toggle — gated on BOTH strength_type AND equipment. */}
          {editStrengthType === 'rep-based' && editEquipment === 'kettlebell' && (
            <div data-step="kbSetup" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('kbSetup')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kettlebell setup
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Uses a pair of kettlebells" description="e.g. Double KB Clean, Double KB Squat" checked={editUsesPair} onChange={setEditUsesPair} />
              </div>
            </div>
          )}

          {/* Lift style — barbell / kettlebell rep-based only. Olympic →
              %-of-best surface; ballistic → bell-ladder. None = standard lift. */}
          {editStrengthType === 'rep-based' && (editEquipment === 'barbell' || editEquipment === 'kettlebell') && (
            <div data-step="liftStyle" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('liftStyle')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lift style <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <Select
                value={editLiftType}
                options={LIFT_TYPE_OPTIONS}
                onChange={setEditLiftType}
                placeholder="None"
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Olympic → %-of-best surface; Ballistic → bell-ladder. Leave None for standard lifts.
              </p>
            </div>
          )}

          {/* Ladder override (kettlebell / strongman / carry — optional) */}
          {editStrengthType === 'rep-based' && ['kettlebell', 'strongman', 'carry'].includes(editEquipment) && (
            <div data-step="weightLadder" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('weightLadder')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <StructuredLadderEditor
                lbStr={editLadderLb}
                kgStr={editLadderKg}
                onChangeLb={setEditLadderLb}
                onChangeKg={setEditLadderKg}
              />
            </div>
          )}

          {/* Hold type — isometric strength only. Weighted (load) adds an
              added-weight field when logging; leverage = lever holds. */}
          {editStrengthType === 'isometric' && (
            <div data-step="holdType" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('holdType')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hold type <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <Select
                value={editHoldType}
                options={HOLD_TYPE_OPTIONS}
                onChange={setEditHoldType}
                placeholder="Standard hold"
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Weighted (load) adds an added-weight field when logging; Leverage = lever holds; Standard = plain hold.
              </p>
            </div>
          )}

          {/* Isometric milestone ladder override — only for isometric strength */}
          {editStrengthType === 'isometric' && (
            <div data-step="isoLadder" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('isoLadder')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Milestone ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <input type="text" value={editIsoLadderStr}
                     onChange={e => setEditIsoLadderStr(e.target.value)}
                     placeholder="e.g. 5, 10, 15, 20, 30, 45, 60"
                     className={inputCls} />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated hold times in <strong>seconds</strong>. Leave blank to use the standard 10/20/30/…/120 s ladder.
              </p>
            </div>
          )}

          {/* Unit lock — only when the cascade is ready AND the kind of unit
              is meaningful (weight for strength, distance for cardio).
              Isometric, undeclared strength type, and unselected equipment
              all skip this step. */}
          {shouldShowUnitLock(editCategory, editCardioMode, editStrengthType, editEquipment) && (
            <div data-step="unitLock" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('unitLock')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit lock <span className="font-normal normal-case text-muted-foreground/60">(community standard override)</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {relevantUnitLockOptions(editCategory).map(opt => {
                  const Icon = opt.icon
                  const isSelected = (editUnitLock || null) === opt.value
                  return (
                    <button
                      key={opt.value || 'none'}
                      onClick={() => setEditUnitLock(opt.value)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }`}
                    >
                      {Icon && <Icon className="h-3 w-3 shrink-0" />}
                      <span>{opt.label}</span>
                      <span className={`text-[10px] ${isSelected ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                        — {opt.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Variants — appears once the cascade is unambiguous. Each chip
              becomes a separate movement row at save time, named
              "${parent} [${label}]", with parent_movement_id pointing back
              at this movement. Editing a row that's itself a variant
              (parent_movement_id set) hides this step — variants don't
              have children of their own. */}
          {/* Edit form — variants section renders for any category once
              the cascade is unambiguous, mirroring the Add form. Variant
              rows themselves still hide the chip via !parent_movement_id. */}
          {shouldShowUnitLock(editCategory, editCardioMode, editStrengthType, editEquipment) && !editingMovement.parent_movement_id && (
            <div data-step="variants" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('variants')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <VariantChipInput
                variants={editVariants}
                inputValue={editVariantInput}
                shortInputValue={editVariantShortInput}
                onInputChange={setEditVariantInput}
                onShortInputChange={setEditVariantShortInput}
                onAdd={entry => setEditVariants(prev => [...prev, entry])}
                onRemove={idx => setEditVariants(prev => prev.filter((_, i) => i !== idx))}
                placeholder="Variant name — Freestyle, Push, …"
              />
              <p className="text-[11px] text-muted-foreground">
                Each variant becomes its own loggable movement that shares this row's config — saved as "{editName.trim() || 'Parent'} [Variant]". The SHORT label (max 10 chars, e.g. FREE / BACK / PUSH) is the small badge shown on the mobile index next to the parent's name when the last-logged effort was this variant. Mirrors Swimming and Sled Work.
              </p>
            </div>
          )}

          {/* Visibility — Edit form only. New movements always start visible;
              admins flip them deprecated from this Edit form later when a
              movement is retired without removing historical efforts. */}
          <div data-step="visibility" className="animate-rise space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{editStep('visibility')}</span>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Visibility
              </p>
            </div>
            <ToggleChip
              label="Mark as deprecated"
              description="Hides from client search lists. Historical efforts stay intact."
              checked={editDeprecated}
              onChange={setEditDeprecated}
            />
          </div>

          {/* Summary + save */}
          {editIsComplete && (
            <div className="animate-rise space-y-3 pt-2 border-t border-border">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Will be saved as:</span>
                {editSummaryParts.map((part, i) => (
                  <span key={i} className="inline-flex items-center rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary">
                    {part}
                  </span>
                ))}
              </div>
              {editError && <p className="text-xs text-destructive">{editError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingMovement(null)}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={editSave}
                  disabled={editSaving || editSaved}
                  className={`flex-[2] rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    editSaved    ? 'bg-primary/15 text-primary border border-primary/30'
                    : editSaving ? 'bg-primary/60 text-white cursor-wait'
                                 : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                >
                  {editSaved ? <><Check className="h-4 w-4" /> Saved</> : editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : addOpen ? (

        /* ── Add form ── */
        <div ref={addFormRef} className="animate-rise rounded-xl border border-border bg-card p-6 space-y-6">

          {/* Form header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-semibold">New movement</p>
            </div>
            <button
              onClick={() => {
                setAddOpen(false)
                setName(''); setCategory(null); setCardioMode(null)
                setStrengthType(null); setEquipment(null)
                setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
                setLiftType(''); setHoldType('')
                setLadderLb(''); setLadderKg(''); setIsoLadderStr('')
                setUnitLock(null); setUnitLockTouched(false); setDeprecated(false)
                setError('')
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div data-step="name" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('name')}</span>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Movement name</p>
            </div>
            <input
              type="text"
              value={name}
              onChange={e => { setName(toTitleCase(e.target.value)); setError('') }}
              placeholder="e.g. Romanian Deadlift, Box Jump…"
              className={inputCls}
              autoFocus
            />
          </div>

          {name.trim().length > 0 && (
            <div data-step="category">
              <TreeLevel step={addStep('category')} label="Category" options={CATEGORY_OPTIONS} selected={category} onSelect={selectCategory} />
            </div>
          )}

          {category === 'cardio' && (
            <div data-step="cardioMode">
              <TreeLevel step={addStep('cardioMode')} label="Track by" options={CARDIO_MODE_OPTIONS} selected={cardioMode} onSelect={setCardioMode} />
            </div>
          )}

          {category === 'strength' && (
            <div data-step="strengthType">
              <TreeLevel step={addStep('strengthType')} label="Movement type" options={STRENGTH_TYPE_OPTIONS} selected={strengthType} onSelect={selectStrengthType} />
            </div>
          )}

          {strengthType === 'rep-based' && (
            <div data-step="equipment">
              <TreeLevel step={addStep('equipment')} label="Equipment" options={EQUIPMENT_OPTIONS} selected={equipment} onSelect={selectEquipment} />
            </div>
          )}

          {strengthType === 'rep-based' && equipment === 'bodyweight' && (
            <div data-step="bwModifiers" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('bwModifiers')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assisted variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip
                  label="Band-assist eligible"
                  description="Allow band assistance — banded pull up"
                  checked={bandAssist}
                  onChange={setBandAssist}
                />
                <ToggleChip
                  label="Knee-assist eligible"
                  description="Allow knee assistance — knee push up"
                  checked={kneeAssist}
                  onChange={setKneeAssist}
                />
                <ToggleChip
                  label="Weight progression eligible"
                  description="Add weight via belt, vest, or plate — pull up, push up, dip"
                  checked={weightedProgression}
                  onChange={setWeightedProgression}
                />
              </div>
            </div>
          )}

          {/* Kettlebell pair toggle — gated on BOTH strength_type AND equipment. */}
          {strengthType === 'rep-based' && equipment === 'kettlebell' && (
            <div data-step="kbSetup" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('kbSetup')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kettlebell setup
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Uses a pair of kettlebells" description="e.g. Double KB Clean, Double KB Squat" checked={usesPair} onChange={setUsesPair} />
              </div>
            </div>
          )}

          {/* Lift style — barbell / kettlebell rep-based only. Olympic →
              %-of-best surface; ballistic → bell-ladder. None = standard lift. */}
          {strengthType === 'rep-based' && (equipment === 'barbell' || equipment === 'kettlebell') && (
            <div data-step="liftStyle" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('liftStyle')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lift style <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <Select
                value={liftType}
                options={LIFT_TYPE_OPTIONS}
                onChange={setLiftType}
                placeholder="None"
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Olympic → %-of-best surface; Ballistic → bell-ladder. Leave None for standard lifts.
              </p>
            </div>
          )}

          {/* Ladder override (kettlebell / strongman / carry — optional) */}
          {strengthType === 'rep-based' && ['kettlebell', 'strongman', 'carry'].includes(equipment) && (
            <div data-step="weightLadder" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('weightLadder')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <StructuredLadderEditor
                lbStr={ladderLb}
                kgStr={ladderKg}
                onChangeLb={setLadderLb}
                onChangeKg={setLadderKg}
              />
            </div>
          )}

          {/* Hold type — isometric strength only. Weighted (load) adds an
              added-weight field when logging; leverage = lever holds. */}
          {strengthType === 'isometric' && (
            <div data-step="holdType" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('holdType')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hold type <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <Select
                value={holdType}
                options={HOLD_TYPE_OPTIONS}
                onChange={setHoldType}
                placeholder="Standard hold"
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Weighted (load) adds an added-weight field when logging; Leverage = lever holds; Standard = plain hold.
              </p>
            </div>
          )}

          {/* Isometric milestone ladder override — only for isometric strength */}
          {strengthType === 'isometric' && (
            <div data-step="isoLadder" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('isoLadder')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Milestone ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <input type="text" value={isoLadderStr}
                     onChange={e => setIsoLadderStr(e.target.value)}
                     placeholder="e.g. 5, 10, 15, 20, 30, 45, 60"
                     className={inputCls} />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated hold times in <strong>seconds</strong>. Leave blank to use the standard 10/20/30/…/120 s ladder.
              </p>
            </div>
          )}

          {/* Unit lock — only when the cascade is ready and the unit kind is
              meaningful (weight for strength, distance for cardio). Smart
              defaults auto-fill strongman → kg and rucking → mi; admin can
              override (sticky once touched). The Visibility step is
              intentionally NOT in the Add form — new movements always start
              visible. Visibility lives in Edit only. */}
          {shouldShowUnitLock(category, cardioMode, strengthType, equipment) && (
            <div data-step="unitLock" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('unitLock')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit lock
                  {' '}
                  <span className="font-normal normal-case text-muted-foreground/60">
                    (community standard override
                    {!unitLockTouched && unitLock && ' — auto-suggested'}
                    )
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {relevantUnitLockOptions(category).map(opt => {
                  const Icon = opt.icon
                  const isSelected = (unitLock || null) === opt.value
                  return (
                    <button
                      key={opt.value || 'none'}
                      onClick={() => { setUnitLock(opt.value); setUnitLockTouched(true) }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }`}
                    >
                      {Icon && <Icon className="h-3 w-3 shrink-0" />}
                      <span>{opt.label}</span>
                      <span className={`text-[10px] ${isSelected ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                        — {opt.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Variants — Add form. Appears once the cascade is unambiguous;
              admin can leave it empty (most movements have no variants).
              Each chip becomes its own movement row at save time. */}
          {/* Variants chip — both strength AND cardio now supported.
              Cardio routes through CardioFamilyConsolidatedDetail
              (mirror of strength's wrapper) and every inner cardio
              detail component honors hideHeader. */}
          {shouldShowUnitLock(category, cardioMode, strengthType, equipment) && (
            <div data-step="variants" className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{addStep('variants')}</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <VariantChipInput
                variants={variants}
                inputValue={variantInput}
                shortInputValue={variantShortInput}
                onInputChange={setVariantInput}
                onShortInputChange={setVariantShortInput}
                onAdd={entry => setVariants(prev => [...prev, entry])}
                onRemove={idx => setVariants(prev => prev.filter((_, i) => i !== idx))}
                placeholder="Variant name — Freestyle, Push, …"
              />
              <p className="text-[11px] text-muted-foreground">
                Each variant becomes its own loggable movement that shares this row's config — saved as "{name.trim() || 'Parent'} [Variant]". Use for stroke families (Swimming), direction families (Sled Work [Push] / [Drag]), or any movement with sub-types that share a coaching surface.
              </p>
            </div>
          )}

          {isComplete && (
            <div className="animate-rise space-y-3 pt-2 border-t border-border">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Will be added as:</span>
                {addSummaryParts.map((part, i) => (
                  <span key={i} className="inline-flex items-center rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary">
                    {part}
                  </span>
                ))}
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {variants.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  + {variants.length} variant row{variants.length === 1 ? '' : 's'} will be created alongside the parent.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAddOpen(false)
                    setName(''); setCategory(null); setCardioMode(null)
                    setStrengthType(null); setEquipment(null)
                    setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
                    setLiftType(''); setHoldType('')
                    setLadderLb(''); setLadderKg(''); setIsoLadderStr('')
                    setUnitLock(null); setUnitLockTouched(false); setDeprecated(false)
                    setVariants([]); setVariantInput(''); setVariantShortInput('')
                    setError('')
                  }}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || saved}
                  className={`flex-[2] rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    saved    ? 'bg-primary/15 text-primary border border-primary/30'
                    : saving ? 'bg-primary/60 text-white cursor-wait'
                             : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                >
                  {saved ? (
                    <><Check className="h-4 w-4" /> Movement added — now live</>
                  ) : saving ? 'Saving…' : (
                    <><Plus className="h-4 w-4" /> Add to library</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

      ) : (

        /* ── Add movement button ── */
        <button
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-4 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all"
        >
          <Plus className="h-4 w-4" />
          Add movement
        </button>
      )}

      {/* ── Movement library list ── */}
      {!editingMovement && (
        <>
          {existing.length > 0 ? (
            <div className="animate-rise rounded-xl border border-border bg-card">
              {/* List header — title, bulk toggle, filter chips, search, sort */}
              <div className="border-b border-border px-5 py-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    Movement library
                    <span className="ml-1.5 text-muted-foreground font-normal">
                      ({filteredMovements.length === existing.length ? existing.length : `${filteredMovements.length} of ${existing.length}`})
                    </span>
                  </h2>
                  <div className="flex items-center gap-1.5">
                    {bulkMode ? (
                      <>
                        <span className="text-xs text-muted-foreground">{bulkSelected.size} selected</span>
                        <button
                          onClick={requestBulkDelete}
                          disabled={bulkSelected.size === 0}
                          className="flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                        <button
                          onClick={exitBulkMode}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setBulkMode(true)}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Bulk select
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter chips */}
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_CHIPS.map(chip => {
                    const isSelected = filterChip === chip.value
                    return (
                      <button
                        key={chip.value}
                        onClick={() => setFilterChip(chip.value)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                      >
                        {chip.label}
                      </button>
                    )
                  })}
                </div>

                {/* Search + sort */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder='Search by any word — e.g. "bench" or "assisted press"'
                    className={`${inputCls} flex-1`}
                  />
                  <div className="relative">
                    <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <select
                      value={sortMode}
                      onChange={e => setSortMode(e.target.value)}
                      className="appearance-none rounded-md border border-border bg-input/30 pl-7 pr-3 py-2.5 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                      title="Sort"
                    >
                      {SORT_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {bulkMode ? 'Tap rows to select. Bulk delete prompts for confirmation.' : 'Tap a movement to edit · Swipe / click 🗑 to delete (confirm required)'}
                </p>
              </div>

              {filteredMovements.length > 0 ? (
                <div className="divide-y divide-border">
                  {filteredMovements.map(m => {
                    const checked = bulkSelected.has(m.id)
                    const isVariant = m._isVariant === true
                    const isLastVariant = m._isLastVariant === true
                    const rowContent = (
                      <div
                        className={`relative flex items-center justify-between ${isVariant ? 'pl-12 pr-5' : 'px-5'} py-3.5 transition-colors ${
                          bulkMode ? (checked ? 'bg-primary/5' : 'hover:bg-accent/40') : 'cursor-pointer hover:bg-accent/40'
                        }`}
                      >
                        {/* L-shape tree connector for variant rows. The
                            vertical line runs from the top of THIS row to
                            its vertical midpoint, then bends right to meet
                            the row content. For the LAST variant in a
                            family, the vertical line stops at the midpoint
                            (no continuation downward). For non-last
                            variants, the line continues full-height so
                            the connectors line up between siblings.
                            Position: left-7 puts the line at ~28px, which
                            sits inside the pl-12 (48px) indent area. */}
                        {isVariant && (
                          <>
                            <div className={`pointer-events-none absolute left-7 top-0 w-px bg-border ${isLastVariant ? 'h-1/2' : 'h-full'}`} />
                            <div className="pointer-events-none absolute left-7 top-1/2 h-px w-4 bg-border" />
                          </>
                        )}
                        {bulkMode && (
                          <div className={`mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? 'bg-primary border-primary' : 'border-border'
                          }`}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${m.deprecated ? 'line-through text-muted-foreground' : ''} ${isVariant ? 'text-muted-foreground' : ''}`}>
                            {m.name}
                          </p>
                          <MovementPills m={m} />
                          <p className="mt-1 text-[10px] text-muted-foreground/70">
                            Modified {formatLastModified(m.updated_at || m.created_at)}
                          </p>
                        </div>
                        <div className="ml-3 flex items-center gap-2 shrink-0">
                          {!bulkMode && <Pencil className="h-3.5 w-3.5 text-muted-foreground/50" />}
                        </div>
                      </div>
                    )

                    if (bulkMode) {
                      return (
                        <div
                          key={m.id}
                          onClick={() => toggleBulkRow(m.id)}
                          className="cursor-pointer"
                        >
                          {rowContent}
                        </div>
                      )
                    }
                    return (
                      <DeleteAction
                        key={m.id}
                        onDelete={() => { requestDeleteMovement(m); return Promise.reject(new Error('confirm-required')) }}
                        onTap={() => setEditingMovement(m)}
                        bg="bg-card"
                      >
                        {rowContent}
                      </DeleteAction>
                    )
                  })}
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {searchQuery.trim()
                      ? `No movements match "${searchQuery}"`
                      : 'No movements match the current filter.'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">Movement library is empty.</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Add movements above — they appear instantly in all client search lists.</p>
            </div>
          )}
        </>
      )}

      {/* ── Single-delete confirmation dialog ── */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Delete "{pendingDelete.name}"?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingDeleteCount === null
                    ? 'Checking for logged efforts…'
                    : pendingDeleteCount === 0
                      ? (
                        <>
                          No clients have logged this movement. Safe to delete.
                          {!pendingDelete.parent_movement_id && existing.some(m => m.parent_movement_id === pendingDelete.id) && (
                            <> The movement and all its variants will be removed.</>
                          )}
                        </>
                      )
                      : (
                        <>
                          ⚠ This will <strong className="text-destructive">PERMANENTLY DELETE</strong> the movement
                          {!pendingDelete.parent_movement_id && existing.some(m => m.parent_movement_id === pendingDelete.id) && ' + all its variants'}
                          {' '}AND wipe <strong className="text-destructive">{pendingDeleteCount}</strong> logged {pendingDeleteCount === 1 ? 'effort' : 'efforts'} from every client's history. <strong>This cannot be undone.</strong>{' '}
                          <span className="text-foreground">To keep the data, use Deprecate instead</span> (hides from search, leaves everything intact).
                        </>
                      )}
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPendingDelete(null)}
                className="flex-1 rounded-lg border border-border py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              {pendingDeleteCount != null && pendingDeleteCount > 0 && (
                <button
                  onClick={async () => {
                    // Mark as deprecated instead — keep historical data intact.
                    await supabase.from('movements').update({ deprecated: true }).eq('id', pendingDelete.id)
                    invalidateMovements(); fetchExisting()
                    setPendingDelete(null); setPendingDeleteCount(null)
                  }}
                  className="flex-1 rounded-lg border border-amber-500/40 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <EyeOff className="inline h-3 w-3 mr-1" /> Deprecate
                </button>
              )}
              <button
                onClick={confirmDeleteMovement}
                disabled={pendingDeleteCount === null}
                className="flex-1 rounded-lg bg-destructive py-2 text-xs font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <Trash2 className="inline h-3 w-3 mr-1" /> Delete anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk-delete confirmation dialog ── */}
      {pendingDeleteMany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setPendingDeleteMany(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Delete {pendingDeleteMany.length} movement{pendingDeleteMany.length === 1 ? '' : 's'}?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  ⚠ This will <strong className="text-destructive">PERMANENTLY DELETE</strong> these movements (plus any variants), AND wipe every logged effort for them from every client's history. <strong>This cannot be undone.</strong> To keep the data, mark them as deprecated individually instead.
                </p>
                <ul className="mt-2 max-h-32 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                  {pendingDeleteMany.map(m => (
                    <li key={m.id} className="truncate py-0.5">• {m.name}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPendingDeleteMany(null)}
                className="flex-1 rounded-lg border border-border py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ids = pendingDeleteMany.map(m => m.id)
                  await supabase.from('movements').update({ deprecated: true }).in('id', ids)
                  invalidateMovements(); fetchExisting()
                  setBulkSelected(new Set()); setBulkMode(false)
                  setPendingDeleteMany(null)
                }}
                className="flex-1 rounded-lg border border-amber-500/40 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                <EyeOff className="inline h-3 w-3 mr-1" /> Deprecate all
              </button>
              <button
                onClick={confirmBulkDelete}
                className="flex-1 rounded-lg bg-destructive py-2 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                <Trash2 className="inline h-3 w-3 mr-1" /> Delete all
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
