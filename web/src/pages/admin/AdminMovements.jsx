import { useState, useEffect, useMemo } from 'react'

const IS_TOUCH = typeof window !== 'undefined'
  && window.matchMedia('(pointer: coarse)').matches
import { supabase } from '../../lib/supabase'
import { invalidateMovements } from '../../hooks/useMovements'
import DeleteAction from '../../components/DeleteAction'
import {
  Dumbbell, Activity, Timer,
  Ruler, Check, Plus, ChevronLeft, Pencil, X,
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

const STRENGTH_TYPE_OPTIONS = [
  { value: 'isometric', label: 'Isometric hold', description: 'Timed — plank, wall sit…', icon: Timer },
  { value: 'rep-based', label: 'Rep-based',       description: 'Counted reps each set',    icon: Dumbbell },
]

const EQUIPMENT_OPTIONS = [
  { value: 'barbell',    label: 'Barbell',      description: 'Plate-loaded bar' },
  { value: 'dumbbell',   label: 'Dumbbell',     description: 'Per-hand, fixed weights' },
  { value: 'kettlebell', label: 'Kettlebell',   description: 'IKFF 4 kg ladder (16 kg, 20 kg, …)' },
  { value: 'machine',    label: 'Machine',      description: 'Weight-stack, cable, selectorized' },
  { value: 'bodyweight', label: 'Bodyweight',   description: 'Pull-ups, push-ups…' },
  { value: 'assisted',   label: 'Assisted',     description: 'Counterweight-assisted (gravitron, dip assist)' },
  { value: 'strongman',  label: 'Strongman',    description: 'Atlas stones, sandbags, kegs, yokes' },
  { value: 'carry',      label: 'Carry / Sled', description: 'Weight + distance' },
]

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

function buildSummary(category, cardioMode, strengthType, equipment, bandAssist, kneeAssist, repRangeLo, repRangeHi) {
  const parts = []
  if (category === 'cardio') {
    parts.push('Cardio')
    if (cardioMode === 'pace') parts.push('Pace-based')
    else if (cardioMode === 'duration') parts.push('Duration only')
  } else if (category === 'strength') {
    parts.push('Strength')
    if (strengthType === 'isometric') parts.push('Isometric hold')
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
      if (Number.isFinite(repRangeLo) && Number.isFinite(repRangeHi)) {
        parts.push(`${repRangeLo}–${repRangeHi} reps`)
      }
    }
  }
  return parts
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
    } else {
      const eq = EQUIPMENT_PILL[m.equipment]
      if (eq) pills.push(eq)
      if (m.band_assist) pills.push({ label: 'Band assist', cls: 'bg-muted text-muted-foreground' })
      if (m.knee_assist) pills.push({ label: 'Knee assist', cls: 'bg-muted text-muted-foreground' })
      if (m.uses_pair)   pills.push({ label: 'Pair', cls: 'bg-muted text-muted-foreground' })
      if (Number.isFinite(m.rep_range_lo) && Number.isFinite(m.rep_range_hi)) {
        pills.push({ label: `${m.rep_range_lo}–${m.rep_range_hi} reps`, cls: 'bg-muted text-muted-foreground' })
      }
      if (m.weight_ladder_override) {
        pills.push({ label: 'Custom ladder', cls: 'bg-muted text-muted-foreground' })
      }
    }
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
  const [repRangeLo,   setRepRangeLo]   = useState('')        // string state — empty = null
  const [repRangeHi,   setRepRangeHi]   = useState('')
  const [ladderOvr,    setLadderOvr]    = useState('')        // raw text the admin types: "100, 135, 150"
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [error,        setError]        = useState('')

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
  const [editRepRangeLo,   setEditRepRangeLo]   = useState('')
  const [editRepRangeHi,   setEditRepRangeHi]   = useState('')
  const [editLadderOvr,    setEditLadderOvr]    = useState('')
  const [editSaving,       setEditSaving]       = useState(false)
  const [editSaved,        setEditSaved]        = useState(false)
  const [editError,        setEditError]        = useState('')

  // ── Add panel open/close ─────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)

  // ── List state ──────────────────────────────────────────────────────────────
  const [existing,     setExisting]     = useState([])
  const [searchQuery,  setSearchQuery]  = useState('')

  // ── Load movements ──────────────────────────────────────────────────────────
  function fetchExisting() {
    supabase
      .from('movements')
      .select('*')
      .order('name')
      .then(({ data }) => setExisting(data || []))
  }

  useEffect(() => { fetchExisting() }, [])

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
    setEditRepRangeLo(editingMovement.rep_range_lo != null ? String(editingMovement.rep_range_lo) : '')
    setEditRepRangeHi(editingMovement.rep_range_hi != null ? String(editingMovement.rep_range_hi) : '')
    setEditLadderOvr(serializeLadderOverride(editingMovement.weight_ladder_override))
    setEditSaved(false)
    setEditError('')
  }, [editingMovement])

  // ── Add form: tree selection handlers ───────────────────────────────────────
  function selectCategory(val) {
    setCategory(val)
    setCardioMode(null); setStrengthType(null)
    setEquipment(null); setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    setRepRangeLo(''); setRepRangeHi(''); setLadderOvr('')
  }
  function selectStrengthType(val) {
    setStrengthType(val)
    setEquipment(null); setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    // Isometric & cardio carry no rep window — clear it.
    if (val !== 'rep-based') { setRepRangeLo(''); setRepRangeHi('') }
    setLadderOvr('')
  }
  function selectEquipment(val) {
    setEquipment(val)
    setBandAssist(false); setKneeAssist(false)
    // weighted_progression is bodyweight-only
    if (val !== 'bodyweight') setWeightedProgression(false)
    // uses_pair is kettlebell-only
    if (val !== 'kettlebell') setUsesPair(false)
    // Ladder override only makes sense for ladder-style equipment.
    if (!['kettlebell', 'strongman', 'carry'].includes(val)) setLadderOvr('')
  }

  // ── Edit form: tree selection handlers ──────────────────────────────────────
  function editSelectCategory(val) {
    setEditCategory(val)
    setEditCardioMode(null); setEditStrengthType(null)
    setEditEquipment(null); setEditBandAssist(false); setEditKneeAssist(false); setEditWeightedProgression(false); setEditUsesPair(false)
    setEditRepRangeLo(''); setEditRepRangeHi(''); setEditLadderOvr('')
  }
  function editSelectStrengthType(val) {
    setEditStrengthType(val)
    setEditEquipment(null); setEditBandAssist(false); setEditKneeAssist(false); setEditWeightedProgression(false); setEditUsesPair(false)
    if (val !== 'rep-based') { setEditRepRangeLo(''); setEditRepRangeHi('') }
    setEditLadderOvr('')
  }
  function editSelectEquipment(val) {
    setEditEquipment(val)
    setEditBandAssist(false); setEditKneeAssist(false)
    if (val !== 'bodyweight') setEditWeightedProgression(false)
    if (val !== 'kettlebell') setEditUsesPair(false)
    if (!['kettlebell', 'strongman', 'carry'].includes(val)) setEditLadderOvr('')
  }

  // ── Completion checks ────────────────────────────────────────────────────────
  // Rep range is REQUIRED for rep-based moves (except carry — its main metric
  // is distance, not reps). This guarantee lets StrengthDetail's next-target
  // card skip its fallback path. Isometric + cardio + carry don't use reps.
  function repRangeValid(loStr, hiStr) {
    const lo = parseInt(loStr, 10)
    const hi = parseInt(hiStr, 10)
    return Number.isFinite(lo) && Number.isFinite(hi) && lo >= 1 && lo <= hi
  }
  const isComplete = (() => {
    if (!name.trim() || !category) return false
    if (category === 'cardio')         return !!cardioMode
    if (strengthType === 'isometric')  return true
    if (!strengthType || !equipment)   return false
    if (equipment === 'carry')         return true
    return repRangeValid(repRangeLo, repRangeHi)
  })()

  const editIsComplete = (() => {
    if (!editName.trim() || !editCategory) return false
    if (editCategory === 'cardio')          return !!editCardioMode
    if (editStrengthType === 'isometric')   return true
    if (!editStrengthType || !editEquipment) return false
    if (editEquipment === 'carry')          return true
    return repRangeValid(editRepRangeLo, editRepRangeHi)
  })()

  // ── Add: save ────────────────────────────────────────────────────────────────
  async function save() {
    if (!isComplete || saving) return
    setSaving(true); setError('')

    const isRepBased = category === 'strength' && strengthType === 'rep-based'
    const repLoNum   = repRangeLo === '' ? null : parseInt(repRangeLo, 10)
    const repHiNum   = repRangeHi === '' ? null : parseInt(repRangeHi, 10)
    if (isRepBased && (repLoNum != null || repHiNum != null) && (repLoNum == null || repHiNum == null || repLoNum > repHiNum || repLoNum < 1)) {
      setError('Rep range must have both low and high values, with low ≥ 1 and low ≤ high.')
      setSaving(false); return
    }

    const record = {
      name:          name.trim(),
      category,
      strength_type: category === 'strength' ? strengthType : null,
      equipment:     isRepBased ? equipment : null,
      band_assist:   equipment === 'bodyweight' ? bandAssist : false,
      knee_assist:   equipment === 'bodyweight' ? kneeAssist : false,
      weighted_progression: equipment === 'bodyweight' ? weightedProgression : false,
      uses_pair:     equipment === 'kettlebell' ? usesPair : false,
      cardio_mode:   category === 'cardio' ? cardioMode : null,
      rep_range_lo:  isRepBased ? repLoNum : null,
      rep_range_hi:  isRepBased ? repHiNum : null,
      weight_ladder_override: isRepBased ? parseLadderOverride(ladderOvr) : null,
    }

    const { error: err } = await supabase.from('movements').insert(record)
    if (err) {
      setError(
        err.message?.includes('unique') || err.code === '23505'
          ? `"${record.name}" already exists in the movement list.`
          : 'Failed to save. Please try again.'
      )
      setSaving(false)
      return
    }

    invalidateMovements()
    fetchExisting()
    setName(''); setCategory(null); setCardioMode(null)
    setStrengthType(null); setEquipment(null)
    setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
    setRepRangeLo(''); setRepRangeHi(''); setLadderOvr('')
    setSaving(false); setSaved(true)
    setTimeout(() => { setSaved(false); setAddOpen(false) }, 2000)
  }

  // ── Edit: save ────────────────────────────────────────────────────────────────
  async function editSave() {
    if (!editIsComplete || editSaving) return
    setEditSaving(true); setEditError('')

    const isRepBased = editCategory === 'strength' && editStrengthType === 'rep-based'
    const repLoNum   = editRepRangeLo === '' ? null : parseInt(editRepRangeLo, 10)
    const repHiNum   = editRepRangeHi === '' ? null : parseInt(editRepRangeHi, 10)
    if (isRepBased && (repLoNum != null || repHiNum != null) && (repLoNum == null || repHiNum == null || repLoNum > repHiNum || repLoNum < 1)) {
      setEditError('Rep range must have both low and high values, with low ≥ 1 and low ≤ high.')
      setEditSaving(false); return
    }

    const record = {
      name:          editName.trim(),
      category:      editCategory,
      strength_type: editCategory === 'strength' ? editStrengthType : null,
      equipment:     isRepBased ? editEquipment : null,
      band_assist:   editEquipment === 'bodyweight' ? editBandAssist : false,
      knee_assist:   editEquipment === 'bodyweight' ? editKneeAssist : false,
      weighted_progression: editEquipment === 'bodyweight' ? editWeightedProgression : false,
      uses_pair:     editEquipment === 'kettlebell' ? editUsesPair : false,
      cardio_mode:   editCategory === 'cardio' ? editCardioMode : null,
      rep_range_lo:  isRepBased ? repLoNum : null,
      rep_range_hi:  isRepBased ? repHiNum : null,
      weight_ladder_override: isRepBased ? parseLadderOverride(editLadderOvr) : null,
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

    invalidateMovements()
    fetchExisting()
    setEditSaving(false); setEditSaved(true)
    setTimeout(() => {
      setEditingMovement(null)
      setEditSaved(false)
    }, 1500)
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteMovement(id) {
    const { error: err } = await supabase.from('movements').delete().eq('id', id)
    if (err) {
      fetchExisting() // re-sync list so the row reappears
      throw new Error(err.message) // lets DeleteAction reset its removing state
    }
    invalidateMovements()
    fetchExisting()
  }

  // ── Filtered movement list ────────────────────────────────────────────────────
  const filteredMovements = useMemo(() => {
    if (!searchQuery.trim()) return existing
    const tokens = tokenize(searchQuery)
    return existing
      .filter(m => smartMatch(m.name, tokens))
      .sort((a, b) => {
        const diff = scoreMatch(a.name, tokens) - scoreMatch(b.name, tokens)
        return diff !== 0 ? diff : a.name.localeCompare(b.name)
      })
  }, [existing, searchQuery])

  const editSummaryParts = buildSummary(
    editCategory, editCardioMode, editStrengthType, editEquipment,
    editBandAssist, editKneeAssist,
    editRepRangeLo === '' ? null : parseInt(editRepRangeLo, 10),
    editRepRangeHi === '' ? null : parseInt(editRepRangeHi, 10),
  )
  const addSummaryParts  = buildSummary(
    category, cardioMode, strengthType, equipment,
    bandAssist, kneeAssist,
    repRangeLo === '' ? null : parseInt(repRangeLo, 10),
    repRangeHi === '' ? null : parseInt(repRangeHi, 10),
  )

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
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {editingMovement ? `Edit: ${editingMovement.name}` : 'Movement Library'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {editingMovement
              ? 'Change any property — updates take effect immediately across all client search lists.'
              : 'Manage movements — they appear instantly in every client\'s search list.'}
          </p>
        </div>
      </div>

      {/* ── Edit form ── */}
      {editingMovement ? (
        <div className="animate-rise rounded-xl border border-border bg-card p-6 space-y-6">

          {/* Name */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">1</span>
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
            <TreeLevel step={2} label="Category" options={CATEGORY_OPTIONS} selected={editCategory} onSelect={editSelectCategory} />
          )}

          {/* Cardio mode */}
          {editCategory === 'cardio' && (
            <TreeLevel step={3} label="Track by" options={CARDIO_MODE_OPTIONS} selected={editCardioMode} onSelect={setEditCardioMode} />
          )}

          {/* Strength type */}
          {editCategory === 'strength' && (
            <TreeLevel step={3} label="Movement type" options={STRENGTH_TYPE_OPTIONS} selected={editStrengthType} onSelect={editSelectStrengthType} />
          )}

          {/* Equipment */}
          {editStrengthType === 'rep-based' && (
            <TreeLevel step={4} label="Equipment" options={EQUIPMENT_OPTIONS} selected={editEquipment} onSelect={editSelectEquipment} />
          )}

          {/* Bodyweight modifiers */}
          {editEquipment === 'bodyweight' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">5</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assisted variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Band-assist eligible" description="light band → unassisted progression" checked={editBandAssist} onChange={setEditBandAssist} />
                <ToggleChip label="Knee-assist eligible" description="on-knee → full rep progression" checked={editKneeAssist} onChange={setEditKneeAssist} />
                <ToggleChip
                  label="Weighted progression?"
                  description="ON → supports belt/vest/plate on same record (Pull Up, Push Up, Dip). OFF → rep-only forever (Burpee, Crunch)."
                  checked={editWeightedProgression}
                  onChange={setEditWeightedProgression}
                />
              </div>
            </div>
          )}

          {/* Kettlebell pair toggle — pair vs single */}
          {editEquipment === 'kettlebell' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">5</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kettlebell setup
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Uses a pair of kettlebells" description="e.g. Double KB Clean, Double KB Squat" checked={editUsesPair} onChange={setEditUsesPair} />
              </div>
            </div>
          )}

          {/* Rep range — REQUIRED for all rep-based moves except carry */}
          {editStrengthType === 'rep-based' && editEquipment && editEquipment !== 'carry' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">6</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Rep range <span className="font-normal normal-case text-destructive/80">(required — drives the next-target card)</span>
                </p>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Low</label>
                  <input type="number" inputMode="numeric" min="1" value={editRepRangeLo}
                         onChange={e => setEditRepRangeLo(e.target.value)} placeholder="e.g. 5"
                         className={inputCls} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">High</label>
                  <input type="number" inputMode="numeric" min="1" value={editRepRangeHi}
                         onChange={e => setEditRepRangeHi(e.target.value)} placeholder="e.g. 12"
                         className={inputCls} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Heavy compound: 3–5 · Hypertrophy: 6–12 · Endurance: 12–20
              </p>
            </div>
          )}

          {/* Ladder override (kettlebell / strongman / carry — optional) */}
          {editStrengthType === 'rep-based' && ['kettlebell', 'strongman', 'carry'].includes(editEquipment) && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">7</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <input type="text" value={editLadderOvr}
                     onChange={e => setEditLadderOvr(e.target.value)}
                     placeholder='e.g. 100, 135, 150, 180  or  {"lb":[100,135],"kg":[45,60]}'
                     className={inputCls} />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated weights for a single-unit ladder, OR JSON for separate lb/kg ladders.
                Leave blank to use the equipment's default ladder.
              </p>
            </div>
          )}

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
        <div className="animate-rise rounded-xl border border-border bg-card p-6 space-y-6">

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
                setRepRangeLo(''); setRepRangeHi(''); setLadderOvr('')
                setError('')
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">1</span>
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
            <TreeLevel step={2} label="Category" options={CATEGORY_OPTIONS} selected={category} onSelect={selectCategory} />
          )}

          {category === 'cardio' && (
            <TreeLevel step={3} label="Track by" options={CARDIO_MODE_OPTIONS} selected={cardioMode} onSelect={setCardioMode} />
          )}

          {category === 'strength' && (
            <TreeLevel step={3} label="Movement type" options={STRENGTH_TYPE_OPTIONS} selected={strengthType} onSelect={selectStrengthType} />
          )}

          {strengthType === 'rep-based' && (
            <TreeLevel step={4} label="Equipment" options={EQUIPMENT_OPTIONS} selected={equipment} onSelect={selectEquipment} />
          )}

          {equipment === 'bodyweight' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">5</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assisted variants <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Band-assist eligible" description="light band → unassisted progression" checked={bandAssist} onChange={setBandAssist} />
                <ToggleChip label="Knee-assist eligible" description="on-knee → full rep progression" checked={kneeAssist} onChange={setKneeAssist} />
                <ToggleChip
                  label="Weighted progression?"
                  description="ON → supports belt/vest/plate on same record (Pull Up, Push Up, Dip). OFF → rep-only forever (Burpee, Crunch)."
                  checked={weightedProgression}
                  onChange={setWeightedProgression}
                />
              </div>
            </div>
          )}

          {/* Kettlebell pair toggle — pair vs single */}
          {equipment === 'kettlebell' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">5</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kettlebell setup
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ToggleChip label="Uses a pair of kettlebells" description="e.g. Double KB Clean, Double KB Squat" checked={usesPair} onChange={setUsesPair} />
              </div>
            </div>
          )}

          {/* Rep range — REQUIRED for all rep-based moves except carry */}
          {strengthType === 'rep-based' && equipment && equipment !== 'carry' && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">6</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Rep range <span className="font-normal normal-case text-destructive/80">(required — drives the next-target card)</span>
                </p>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Low</label>
                  <input type="number" inputMode="numeric" min="1" value={repRangeLo}
                         onChange={e => setRepRangeLo(e.target.value)} placeholder="e.g. 5"
                         className={inputCls} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">High</label>
                  <input type="number" inputMode="numeric" min="1" value={repRangeHi}
                         onChange={e => setRepRangeHi(e.target.value)} placeholder="e.g. 12"
                         className={inputCls} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Heavy compound: 3–5 · Hypertrophy: 6–12 · Endurance: 12–20
              </p>
            </div>
          )}

          {/* Ladder override (kettlebell / strongman / carry — optional) */}
          {strengthType === 'rep-based' && ['kettlebell', 'strongman', 'carry'].includes(equipment) && (
            <div className="animate-rise space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">7</span>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight ladder override <span className="font-normal normal-case text-muted-foreground/60">(optional)</span>
                </p>
              </div>
              <input type="text" value={ladderOvr}
                     onChange={e => setLadderOvr(e.target.value)}
                     placeholder='e.g. 100, 135, 150, 180  or  {"lb":[100,135],"kg":[45,60]}'
                     className={inputCls} />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated weights for a single-unit ladder, OR JSON for separate lb/kg ladders.
                Leave blank to use the equipment's default ladder.
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
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAddOpen(false)
                    setName(''); setCategory(null); setCardioMode(null)
                    setStrengthType(null); setEquipment(null)
                    setBandAssist(false); setKneeAssist(false); setWeightedProgression(false); setUsesPair(false)
                    setRepRangeLo(''); setRepRangeHi(''); setLadderOvr('')
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
              {/* List header + search */}
              <div className="border-b border-border px-5 py-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    Movement library
                    <span className="ml-1.5 text-muted-foreground font-normal">
                      ({searchQuery.trim() ? `${filteredMovements.length} of ${existing.length}` : existing.length})
                    </span>
                  </h2>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='Search by any word — e.g. "bench" or "assisted press"'
                  className={inputCls}
                />
                <p className="text-xs text-muted-foreground">
                  Tap 🗑 to delete (confirm required) · Tap a movement to edit
                </p>
              </div>

              {filteredMovements.length > 0 ? (
                <div className="divide-y divide-border">
                  {filteredMovements.map(m => (
                    <DeleteAction
                      key={m.id}
                      onDelete={() => deleteMovement(m.id)}
                      onTap={() => setEditingMovement(m)}
                      bg="bg-card"
                    >
                      <div className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-accent/40 transition-colors">
                        <div>
                          <p className="text-sm font-medium">{m.name}</p>
                          <MovementPills m={m} />
                        </div>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                      </div>
                    </DeleteAction>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No movements match "{searchQuery}"</p>
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
    </div>
  )
}
