import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../../lib/supabase'
import { useMovements } from '../../../hooks/useMovements'
import { STRENGTH_MOVEMENTS, CARDIO_MOVEMENTS, ISOMETRIC_EXERCISE_NAMES, getCardioMode } from '../../../lib/movements'
import { estimate1RM } from '../../../lib/formulas'
import {
  BAND_LEVELS, RUCK_PACK_LADDER_LB, SPEED_MAX_KMH, SPEED_INPUT_ACTIVITIES,
  carryWeightLadder, equipmentWeightLadder, freeWeightRange, addedLoadRange,
} from '../../../lib/strengthLadders'
import MovementSearch from '../../../components/MovementSearch'
import CoachAddButton from '../../../components/CoachAddButton'
import UnitToggle from '../../../components/UnitToggle'
import Select from '../../../components/Select'
import Toggle from '../../../components/Toggle'
import {
  Dumbbell, Activity, ChevronRight,
  Loader2, Check, AlertCircle, X, Timer,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'

// Cardio direction-aware best parser — mirrors AdminUserDetail's parseCardioBest
// (and mobile dashboard's). Returns { val, lowerBetter } so the caller picks the
// right direction per activity:
//   • Pace activities ("5:30/km", "1:55/500m"): lower is better
//   • Speed / rate (cal/min, floors/min) / distance: higher is better
// The `\b` after the unit alternation stops "/min" being misread as pace via "/mi".
function parseCardioBest(v) {
  if (!v) return null
  const isPace = /\/(km|mi|500m|100m)\b/.test(v)
  if (isPace) {
    const m = v.match(/(\d+):(\d+)/)
    if (!m) return null
    return { val: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), lowerBetter: true }
  }
  const m = v.match(/(\d+(?:\.\d+)?)/)
  return m ? { val: parseFloat(m[1]), lowerBetter: false } : null
}

// ── Time helpers (for the Add Effort form) ──────────────────────────────────────

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

// ── T092: Riegel-normalize a cardio effort's pace to a common anchor distance ──
// The move-card sparklines plotted RAW pace, so a longer (harder) effort logged a
// slower pace and dipped the line — the same false-drop fixed on the detail charts.
// Parse distance+time from the label ("5 km in 25:00", "2000 m in 7:00", "1.6 mi
// in ...", "1500 m in ...") and project to an anchor: normalized = (t × (anchor/d)
// ^1.06) / anchor sec-per-km. Returns null when the label has NO distance+time
// (cal/min, floors/min efforts) so those keep their raw rate. The anchor only
// scales values by a constant, so for an axis-less sparkline any anchor reproduces
// the same trend — 5 km is used for every pace activity (incl. ergs/swim).
function riegelNormPaceSecPerKm(label, anchorKm = 5) {
  const part = (label || '').split(' · ')[1] || ''
  const m = part.match(/([\d.]+)\s*(km|mi|yd|m)\s+in\s+([\d:]+)/)
  if (!m) return null
  let distKm = parseFloat(m[1])
  if (m[2] === 'mi') distKm *= 1.60934
  else if (m[2] === 'm') distKm /= 1000
  else if (m[2] === 'yd') distKm *= 0.0009144
  const timeSecs = parseTimeStr(m[3])
  if (!distKm || distKm <= 0 || !timeSecs || timeSecs <= 0) return null
  return (timeSecs * Math.pow(anchorKm / distKm, 1.06)) / anchorKm
}

function applyTimeMask(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${digits.slice(-2)}`
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`
}

function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60), s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

// ── Add Effort Form ─────────────────────────────────────────────────────────────
// Movement-AWARE coach/admin add-effort form (T131). Mirrors the mobile per-move
// logging forms (mobile/app/(app)/strength.tsx + cardio.tsx) so the saved
// `label` + `value` strings match the formats the detail pages parse. The
// movement is classified by looking it up in the `movements` prop by name, then
// the relevant fields + the exact save format are dispatched in the SAME order
// mobile uses. Coaches log at "now" (no date field).

const round1 = x => Math.round(x * 10) / 10

// "MM:SS" — pace/duration string used in cardio labels.
function formatMmSs(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${Math.floor(m)}:${String(Math.round(s)).padStart(2, '0')}`
}

function AddEffortForm({ userId, movements = [], clientProfile = {}, onSaved, onClose }) {
  const [type,         setType]         = useState(null)
  const [exerciseName, setExerciseName] = useState('')
  const [reps,         setReps]         = useState('')
  const [weightVal,    setWeightVal]    = useState('')   // strength weight / added load / assistance / carry weight
  const [weightUnit,   setWeightUnit]   = useState('lb')
  const [timeStr,      setTimeStr]      = useState('')
  const [distVal,      setDistVal]      = useState('')   // cardio distance / carry distance
  const [distUnit,     setDistUnit]     = useState('km') // cardio km/mi
  const [carryDistUnit, setCarryDistUnit] = useState('m') // carry ft/m
  const [bandLevel,    setBandLevel]    = useState('')   // '' = none
  const [kneeAssist,   setKneeAssist]   = useState(false)
  const [addedLoad,    setAddedLoad]    = useState('')   // weighted-bodyweight + load-hold added weight
  const [calsVal,      setCalsVal]      = useState('')   // air bike
  const [floorsVal,    setFloorsVal]    = useState('')   // stairmill
  const [packVal,      setPackVal]      = useState('0')  // rucking pack lb
  const [speedVal,     setSpeedVal]     = useState('')   // speed-machine cardio
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  // ── Movement record + classification (mirror mobile flags) ──────────────────
  const rec = exerciseName ? (movements.find(m => m.name === exerciseName) ?? null) : null
  const isIso        = rec?.strength_type === 'isometric'
  const isLoadHold   = isIso && rec?.hold_type === 'load'
  const isAssisted   = rec?.equipment === 'assisted'
  const isCarry      = rec?.equipment === 'carry'
  const isBodyweight = rec?.equipment === 'bodyweight'
  const bandElig     = isBodyweight && rec?.band_assist === true
  const kneeElig     = isBodyweight && rec?.knee_assist === true
  const weightedProg = isBodyweight && rec?.weighted_progression === true
  const isDumbbell   = rec?.equipment === 'dumbbell'
  const usesPair     = rec?.uses_pair === true
  // Olympic / ballistic lifts save an Est. 1RM (consumed by their detail pages)
  // but progress on load/bar speed — so the on-form chip reads "Working set",
  // not "Estimated 1RM" (mirrors mobile). The saved value is unchanged.
  const isOlympic    = rec?.lift_type === 'olympic'
  const isBallistic  = rec?.lift_type === 'ballistic'
  const unitLock     = rec?.unit_lock || null  // 'lb'|'kg'|'mi'|'km'|null
  const cardioModeRec = rec?.cardio_mode || 'pace'
  // Fall back to the static name-based cardio-mode map when the movement isn't
  // in the catalog (custom-typed activity) — same as the legacy form did.
  const cardioMode = type === 'cardio'
    ? (rec ? cardioModeRec : getCardioMode(exerciseName))
    : 'pace'

  const isAirBike   = exerciseName === 'Air Bike'
  const isStairMill = exerciseName === 'StairMill'
  const isRucking   = exerciseName === 'Rucking'
  const isSwim      = exerciseName === 'Swimming' || exerciseName.startsWith('Swimming [')
  const isRowErg    = exerciseName === 'Row Erg'
  const isSpeed     = SPEED_INPUT_ACTIVITIES.has(exerciseName)

  // ── Client bodyweight (already in the form's weight unit — mirror mobile) ───
  const bw = Number(clientProfile?.current_weight) || null
  const swimUnit = clientProfile?.swim_unit || 'm'

  // Whichever weight unit the form should use for the selected movement.
  const defaultWeightUnit = unitLock === 'lb' || unitLock === 'kg'
    ? unitLock
    : (clientProfile?.weight_unit || 'lb')

  // Keep the strength weight unit synced to the movement's lock / client pref.
  useEffect(() => { setWeightUnit(defaultWeightUnit) }, [defaultWeightUnit])
  // Keep the cardio distance unit synced to the client pref (toggleable below
  // unless the movement is unit-locked to mi/km, which only Rucking is today).
  useEffect(() => {
    if (unitLock === 'mi' || unitLock === 'km') setDistUnit(unitLock)
    else setDistUnit(clientProfile?.distance_unit || 'km')
  }, [unitLock, clientProfile?.distance_unit])
  // Carry distance unit follows the client's distance preference (mi → ft).
  useEffect(() => {
    setCarryDistUnit(clientProfile?.distance_unit === 'mi' ? 'ft' : 'm')
  }, [clientProfile?.distance_unit])

  // Reset movement-specific fields whenever the selected movement changes so a
  // value from a previous movement never leaks into the next save.
  useEffect(() => {
    setReps(''); setWeightVal(''); setTimeStr(''); setDistVal('')
    setBandLevel(''); setKneeAssist(false); setAddedLoad('')
    setCalsVal(''); setFloorsVal(''); setPackVal('0'); setSpeedVal('')
  }, [exerciseName])

  // ── Derived numbers ─────────────────────────────────────────────────────────
  const durSecs  = parseTimeStr(timeStr) || 0
  const r        = Number(reps)
  const wNum     = Number(weightVal) || 0
  const assistNum = Number(weightVal) || 0
  const addedNum = Number(addedLoad) || 0
  const distNum  = Number(distVal) || 0
  const calsNum  = Math.round(Number(calsVal)) || 0
  const floorsNum = Math.round(Number(floorsVal)) || 0
  const packLb   = Math.round(Number(packVal)) || 0
  const speedNum = Number(speedVal) || 0

  // Carry ranges/ladder + free-weight ranges per equipment.
  const carryLadder = isCarry ? carryWeightLadder(exerciseName, weightUnit) : null
  const carryRange  = freeWeightRange('carry', weightUnit)
  const stdLadder   = (rec && (rec.equipment === 'kettlebell' || rec.equipment === 'strongman'))
    ? equipmentWeightLadder(rec.equipment, weightUnit) : null
  const stdRange    = rec ? freeWeightRange(rec.equipment, weightUnit) : freeWeightRange('barbell', weightUnit)
  const loadRange   = addedLoadRange(weightUnit)

  // Effective weight for the 1RM estimate, by class (mirror mobile).
  const effWeight = isAssisted
    ? round1(Math.max(0, (bw || 0) - assistNum))
    : isBodyweight
      ? round1((bw || 0) + addedNum)
      : wNum
  const liveOneRM = (() => {
    if (isIso || isCarry || bandLevel || kneeAssist) return null
    if (isBodyweight && !weightedProg) return null
    if (!(r >= 1 && r <= 30) || !reps) return null
    if (effWeight <= 0) return null
    return estimate1RM(effWeight, r)
  })()

  // Cardio distance in km + computed pace.
  const distKm = (() => {
    if (cardioMode !== 'pace') return 0
    if (isSwim)   return swimUnit === 'yd' ? distNum * 0.0009144 : distNum / 1000
    if (isRowErg) return distNum / 1000
    if (isRucking) return distNum * 1.60934
    if (isSpeed)  return distUnit === 'mi' ? distNum * 1.60934 : distNum
    return distUnit === 'mi' ? distNum * 1.60934 : distNum
  })()
  const speedKmh = isSpeed ? (distUnit === 'mi' ? speedNum * 1.60934 : speedNum) : 0
  const speedTimeSecs = (isSpeed && distKm > 0 && speedKmh > 0) ? Math.round((distKm / speedKmh) * 3600) : 0
  const effTimeSecs = isAirBike || isStairMill
    ? durSecs
    : (isSpeed ? speedTimeSecs : durSecs)
  const effTimeStr = isSpeed ? formatMmSs(speedTimeSecs) : timeStr

  const livePaceKm = (() => {
    if (cardioMode !== 'pace' || distKm <= 0 || !effTimeSecs) return null
    const sec = effTimeSecs / distKm
    return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}/km`
  })()
  const liveRate = (isAirBike && calsNum > 0 && effTimeSecs > 0)
    ? `${(calsNum / (effTimeSecs / 60)).toFixed(1)} cal/min` : null
  const liveFpm = (isStairMill && floorsNum > 0 && effTimeSecs > 0)
    ? `${(floorsNum / (effTimeSecs / 60)).toFixed(1)} floors/min` : null

  // ── Save-guards by class ────────────────────────────────────────────────────
  // bw-required classes: assisted, rep-only-bodyweight, and weighted bodyweight.
  const bwRequired = isAssisted || (isBodyweight && !bandLevel && !kneeAssist)
  const bwMissing  = bwRequired && bw == null

  const canSaveStrength = (() => {
    if (!exerciseName.trim()) return false
    if (isLoadHold) return durSecs >= 1
    if (isIso) return durSecs >= 1
    if (isAssisted) return bw != null && !!liveOneRM && r >= 1 && r <= 30
    if (isCarry) return wNum > 0 && distNum > 0
    if (bandLevel || kneeAssist) return r >= 1 && !!reps
    if (isBodyweight && !weightedProg) return bw != null && !!reps && r >= 1 && r <= 200
    // standard weighted (incl. weighted bodyweight w/ added load)
    if (isBodyweight) return bw != null && !!liveOneRM
    return !!liveOneRM
  })()

  const canSaveCardio = (() => {
    if (!exerciseName.trim()) return false
    if (isAirBike) return calsNum > 0 && effTimeSecs > 0
    if (isStairMill) return floorsNum > 0 && effTimeSecs > 0
    if (cardioMode === 'duration') return durSecs > 0
    return distKm > 0 && effTimeSecs > 0
  })()

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // Coach entries log at the current time (back-dating stays the athlete's job).
      const ts = new Date().toISOString()
      const ex = exerciseName
      let label, value, effType

      if (type === 'strength') {
        if (!ex.trim()) throw new Error('Enter an exercise name.')
        effType = 'strength'
        // Dispatch order MUST match mobile: load-hold → iso → assisted → carry →
        // band/knee → rep-only-bodyweight → standard weighted.
        if (isLoadHold) {
          label = wNum > 0
            ? `${ex} · ${wNum} ${weightUnit} × ${durSecs} sec`
            : `${ex} · ${durSecs} sec`
          value = `${durSecs} sec`
        } else if (isIso) {
          label = `${ex} · ${durSecs} sec`
          value = `${durSecs} sec`
        } else if (isAssisted) {
          if (bw == null) throw new Error('No bodyweight on file for this client — log their weight first.')
          const oneRM = estimate1RM(round1(Math.max(0, bw - assistNum)), r)
          label = `${ex} · ${assistNum} ${weightUnit} assist × ${reps}`
          value = `Est. 1RM ${oneRM} ${weightUnit}`
        } else if (isCarry) {
          const distM = carryDistUnit === 'ft' ? round1(distNum * 0.3048) : distNum
          label = `${ex} · ${wNum} ${weightUnit} × ${distM} m`
          value = `${distM} m @ ${wNum} ${weightUnit}`
        } else if (bandLevel && kneeAssist) {
          label = `${ex} [Band + Knee] · ${bandLevel} × ${reps}`
          value = `${reps} reps`
        } else if (bandLevel) {
          label = `${ex} [Band] · ${bandLevel} × ${reps}`
          value = `${reps} reps`
        } else if (kneeAssist) {
          label = `${ex} [Knee] · ${reps} reps`
          value = `${reps} reps`
        } else if (isBodyweight && !weightedProg) {
          if (bw == null) throw new Error('No bodyweight on file for this client — log their weight first.')
          label = `${ex} · ${bw} ${weightUnit} × ${reps}`
          value = `${reps} reps`
        } else {
          // Standard weighted (barbell / dumbbell / machine / kettlebell /
          // strongman / olympic / ballistic / weighted-bodyweight-with-load).
          if (isBodyweight && bw == null) throw new Error('No bodyweight on file for this client — log their weight first.')
          const added = addedNum
          const eff = isBodyweight ? round1((bw || 0) + added) : wNum
          const oneRM = estimate1RM(eff, r)
          if (!oneRM) throw new Error('Enter reps and weight.')
          const labelWeight = isBodyweight
            ? (added > 0 ? `${bw}+${added}` : `${bw}`)
            : wNum
          label = `${ex} · ${labelWeight} ${weightUnit} × ${reps}`
          value = `Est. 1RM ${oneRM} ${weightUnit}`
        }

      } else if (type === 'cardio') {
        if (!ex.trim()) throw new Error('Enter an activity name.')
        effType = 'cardio'
        if (isAirBike) {
          label = `${ex} · ${calsNum} cal in ${effTimeStr}`
          value = `${(calsNum / (effTimeSecs / 60)).toFixed(1)} cal/min`
        } else if (isStairMill) {
          label = `${ex} · ${floorsNum} floors in ${effTimeStr}`
          value = `${(floorsNum / (effTimeSecs / 60)).toFixed(1)} floors/min`
        } else if (cardioMode === 'duration') {
          label = `${ex} · ${effTimeStr}`
          value = effTimeStr
        } else if (isRucking) {
          const distMi = parseFloat(distNum.toFixed(2))
          label = packLb > 0
            ? `${ex} · ${packLb} lb × ${distMi} mi in ${effTimeStr}`
            : `${ex} · ${distMi} mi in ${effTimeStr}`
          value = livePaceKm
        } else if (isSwim) {
          label = `${ex} · ${Math.round(distNum)} ${swimUnit} in ${effTimeStr}`
          value = livePaceKm
        } else if (isRowErg) {
          label = `${ex} · ${Math.round(distNum)} m in ${effTimeStr}`
          value = livePaceKm
        } else if (isSpeed) {
          label = `${ex} · ${parseFloat(distNum.toFixed(3))} ${distUnit} in ${effTimeStr}`
          value = livePaceKm
        } else {
          label = `${ex} · ${parseFloat(distNum.toFixed(3))} ${distUnit} in ${effTimeStr}`
          value = livePaceKm
        }
      }

      const { error: err } = await supabase.from('efforts').insert({
        user_id: userId, type: effType, label, value, created_at: ts,
      })
      if (err) throw err

      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  // ── Small render helpers ────────────────────────────────────────────────────
  const fieldLabel = (txt) => <p className="text-[10px] text-muted-foreground mb-1">{txt}</p>
  const LockedUnit = ({ u }) => (
    <div className="flex h-full items-center justify-center rounded-md border border-border bg-input/30 px-3 py-2 text-sm font-bold text-foreground">{u}</div>
  )
  const ChipBlue = ({ icon: Icon, label, val }) => (
    <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
      <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-blue-400" /><span className="text-xs text-muted-foreground">{label}</span></div>
      <span className="font-mono text-base tabular-nums font-bold text-blue-400">{val}</span>
    </div>
  )
  const ChipAmber = ({ icon: Icon, label, val }) => (
    <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
      <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-amber-400" /><span className="text-xs text-muted-foreground">{label}</span></div>
      <span className="font-mono text-base tabular-nums font-bold text-amber-400">{val}</span>
    </div>
  )
  // Weight: a modern ladder dropdown (Select) OR a free numeric input, by equipment.
  const WeightField = ({ ladder, range, value, onChange, stepFallback }) => (
    ladder
      ? (
        <Select
          value={value}
          onChange={onChange}
          placeholder="Pick a weight"
          options={ladder.map(w => ({ value: String(w), label: `${w}` }))}
        />
      )
      : (
        <input
          type="number"
          step={range?.step ?? stepFallback ?? 5}
          min={range?.min ?? 0}
          max={range?.max}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className={inputCls}
        />
      )
  )

  // The weight column label for standard weighted movements.
  const weightFieldLabel = isBodyweight ? 'Added load' : ((isDumbbell || usesPair) ? 'Per hand' : 'Weight')

  return (
    <form onSubmit={handleSave} className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Add effort</p>
        <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Type selector */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Type</p>
        <div className="flex gap-2">
          {[
            { id: 'strength', label: 'Strength', icon: Dumbbell, cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
            { id: 'cardio',   label: 'Cardio',   icon: Activity, cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
          ].map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} type="button"
                onClick={() => { setType(t.id); setExerciseName('') }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-all ${
                  type === t.id ? t.cls : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />{t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Strength ── */}
      {type === 'strength' && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Exercise</p>
            <MovementSearch value={exerciseName} onChange={setExerciseName} movements={STRENGTH_MOVEMENTS} placeholder="Search or type exercise…" autoFocus />
          </div>

          {exerciseName && (
            bwMissing ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No bodyweight on file for this client — log their weight first.
              </div>
            ) : isLoadHold ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 0.7fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Added weight')}
                    <input type="number" step={weightUnit === 'kg' ? 2.5 : 5} min="0" max={weightUnit === 'kg' ? 100 : 200}
                      value={weightVal} onChange={e => setWeightVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    {unitLock === 'lb' || unitLock === 'kg'
                      ? <LockedUnit u={unitLock} />
                      : <UnitToggle value={weightUnit} options={['lb', 'kg']} onChange={setWeightUnit} className="w-full" />}
                  </div>
                  <div>
                    {fieldLabel('Duration')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {durSecs >= 1 && (
                  <ChipBlue icon={Timer} label="Hold" val={wNum > 0 ? `${wNum} ${weightUnit} × ${fmtDuration(durSecs)}` : `Bodyweight · ${fmtDuration(durSecs)}`} />
                )}
              </>
            ) : isIso ? (
              <>
                <div>
                  {fieldLabel('Duration')}
                  <input type="text" inputMode="numeric" autoFocus value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                </div>
                {durSecs >= 1 && <ChipBlue icon={Timer} label="Hold duration" val={fmtDuration(durSecs)} />}
              </>
            ) : isAssisted ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
                  <div>
                    {fieldLabel('Reps')}
                    <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="30" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Assistance ↓')}
                    <input type="number" step="5" min="0" max={weightUnit === 'kg' ? 90 : 200}
                      value={weightVal} onChange={e => setWeightVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    {unitLock === 'lb' || unitLock === 'kg'
                      ? <LockedUnit u={unitLock} />
                      : <UnitToggle value={weightUnit} options={['lb', 'kg']} onChange={setWeightUnit} className="w-full" />}
                  </div>
                </div>
                {bw != null && reps && r >= 1 && (
                  <ChipBlue icon={Dumbbell} label={`${bw} − ${assistNum} = ${effWeight} ${weightUnit} effective`} val={liveOneRM != null ? `${liveOneRM} ${weightUnit}` : '—'} />
                )}
                <p className="text-[10px] text-muted-foreground">Lower assistance = less help = harder · Goal: reach 0 {weightUnit}</p>
              </>
            ) : isCarry ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.2fr 0.7fr 1.2fr 0.7fr' }}>
                  <div>
                    {fieldLabel('Weight')}
                    <WeightField ladder={carryLadder} range={carryRange} value={weightVal} onChange={setWeightVal} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    {unitLock === 'lb' || unitLock === 'kg'
                      ? <LockedUnit u={unitLock} />
                      : <UnitToggle value={weightUnit} options={['lb', 'kg']} onChange={setWeightUnit} className="w-full" />}
                  </div>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="5" min={carryDistUnit === 'ft' ? 15 : 5} max={carryDistUnit === 'ft' ? 300 : 100}
                      value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    <UnitToggle value={carryDistUnit} options={['ft', 'm']} onChange={setCarryDistUnit} className="w-full" />
                  </div>
                </div>
                {wNum > 0 && distNum > 0 && (
                  <ChipBlue icon={Dumbbell} label="Work" val={`${(wNum * distNum).toLocaleString()} ${weightUnit}·${carryDistUnit}`} />
                )}
              </>
            ) : (bandLevel || kneeAssist) ? (
              <>
                <div>
                  {fieldLabel('Reps')}
                  <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="100" className={inputCls} />
                </div>
                {bandElig && (
                  <div>
                    {fieldLabel('Band assistance')}
                    <Select
                      value={bandLevel}
                      onChange={setBandLevel}
                      placeholder="None"
                      options={[{ value: '', label: 'None' }, ...BAND_LEVELS.map(b => ({ value: b, label: b }))]}
                    />
                  </div>
                )}
                {kneeElig && (
                  <Toggle checked={kneeAssist} onChange={setKneeAssist} label="Knee assisted" />
                )}
                {r >= 1 && reps && (
                  <ChipBlue icon={Check} label={
                    bandLevel && kneeAssist ? `${bandLevel} band + Knee · ${reps} reps`
                      : bandLevel ? `${bandLevel} band · ${reps} reps`
                      : `Knee assisted · ${reps} reps`
                  } val={`${reps}`} />
                )}
              </>
            ) : (isBodyweight && !weightedProg) ? (
              <>
                <div>
                  {fieldLabel('Reps')}
                  <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="200" className={inputCls} />
                </div>
                {bandElig && (
                  <div>
                    {fieldLabel('Band assistance')}
                    <Select
                      value={bandLevel}
                      onChange={setBandLevel}
                      placeholder="None"
                      options={[{ value: '', label: 'None' }, ...BAND_LEVELS.map(b => ({ value: b, label: b }))]}
                    />
                  </div>
                )}
                {kneeElig && (
                  <Toggle checked={kneeAssist} onChange={setKneeAssist} label="Knee assisted" />
                )}
                {reps && r >= 1 && <ChipBlue icon={Dumbbell} label="Reps logged" val={`${reps} reps`} />}
              </>
            ) : (
              /* Standard weighted (barbell / dumbbell / machine / kettlebell /
                 strongman / olympic / ballistic / weighted-bodyweight-with-load) */
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
                  <div>
                    {fieldLabel('Reps')}
                    <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="30" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel(weightFieldLabel)}
                    {isBodyweight
                      ? <input type="number" step={loadRange.step} min={loadRange.min} max={loadRange.max} value={addedLoad} onChange={e => setAddedLoad(e.target.value)} placeholder="0" className={inputCls} />
                      : <WeightField ladder={stdLadder} range={stdRange} value={weightVal} onChange={setWeightVal} />}
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    {unitLock === 'lb' || unitLock === 'kg'
                      ? <LockedUnit u={unitLock} />
                      : <UnitToggle value={weightUnit} options={['lb', 'kg']} onChange={setWeightUnit} className="w-full" />}
                  </div>
                </div>
                {bandElig && (
                  <div>
                    {fieldLabel('Band assistance')}
                    <Select
                      value={bandLevel}
                      onChange={setBandLevel}
                      placeholder="None"
                      options={[{ value: '', label: 'None' }, ...BAND_LEVELS.map(b => ({ value: b, label: b }))]}
                    />
                  </div>
                )}
                {kneeElig && (
                  <Toggle checked={kneeAssist} onChange={setKneeAssist} label="Knee assisted" />
                )}
                {(isOlympic || isBallistic)
                  ? (r >= 1 && reps && Number(weightVal) > 0 && (
                      <ChipBlue icon={Dumbbell} label="Working set" val={`${Number(weightVal)} ${weightUnit}${usesPair ? ' each' : ''} × ${r}`} />
                    ))
                  : (liveOneRM && (
                      <ChipBlue icon={Dumbbell} label={r === 1 ? ((isDumbbell || usesPair) ? '1RM per hand' : '1RM') : ((isDumbbell || usesPair) ? 'Est. 1RM per hand' : 'Estimated 1RM')} val={`${liveOneRM} ${weightUnit}`} />
                    ))}
              </>
            )
          )}
        </div>
      )}

      {/* ── Cardio ── */}
      {type === 'cardio' && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Activity</p>
            <MovementSearch value={exerciseName} onChange={setExerciseName} movements={CARDIO_MOVEMENTS} placeholder="Search or type activity…" autoFocus />
          </div>

          {exerciseName && (
            isAirBike ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Calories')}
                    <input type="number" step="1" min="0" max="300" value={calsVal} onChange={e => setCalsVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Time')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {liveRate && <ChipAmber icon={Activity} label="Rate" val={liveRate} />}
              </>
            ) : isStairMill ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Floors')}
                    <input type="number" step="1" min="0" max="500" value={floorsVal} onChange={e => setFloorsVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Time')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {liveFpm && <ChipAmber icon={Activity} label="Climb rate" val={liveFpm} />}
              </>
            ) : cardioMode === 'duration' ? (
              <>
                <div>
                  {fieldLabel('Duration')}
                  <input type="text" inputMode="numeric" autoFocus value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                </div>
                {durSecs > 0 && <ChipAmber icon={Timer} label="Session time" val={timeStr} />}
              </>
            ) : isRucking ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.2fr 0.7fr 1.2fr 0.7fr' }}>
                  <div>
                    {fieldLabel('Pack weight')}
                    <Select
                      value={packVal}
                      onChange={setPackVal}
                      options={RUCK_PACK_LADDER_LB.map(p => ({ value: String(p), label: `${p}` }))}
                    />
                  </div>
                  <div>{fieldLabel('Unit')}<LockedUnit u="lb" /></div>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="0.1" min="0" max="20" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>{fieldLabel('Unit')}<LockedUnit u="mi" /></div>
                </div>
                <div>
                  {fieldLabel('Time')}
                  <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                </div>
                {livePaceKm && <ChipAmber icon={Activity} label="Live pace" val={livePaceKm} />}
              </>
            ) : isSwim ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 0.7fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="25" min="0" max="5000" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>{fieldLabel('Unit')}<LockedUnit u={swimUnit} /></div>
                  <div>
                    {fieldLabel('Time')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {livePaceKm && <ChipAmber icon={Activity} label="Live pace" val={livePaceKm} />}
              </>
            ) : isRowErg ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 0.7fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="100" min="0" max="30000" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>{fieldLabel('Unit')}<LockedUnit u="m" /></div>
                  <div>
                    {fieldLabel('Time')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {livePaceKm && <ChipAmber icon={Activity} label="Live pace" val={livePaceKm} />}
              </>
            ) : isSpeed ? (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.2fr 1.2fr 0.7fr' }}>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="0.1" min="0" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Speed')}
                    <input type="number" step="0.1" min="0" max={distUnit === 'mi' ? round1((SPEED_MAX_KMH[exerciseName] || 50) / 1.60934) : (SPEED_MAX_KMH[exerciseName] || 50)}
                      value={speedVal} onChange={e => setSpeedVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    <UnitToggle value={distUnit} options={['km', 'mi']} onChange={setDistUnit} className="w-full" />
                  </div>
                </div>
                {effTimeSecs > 0 && <ChipAmber icon={Timer} label="Session time" val={formatMmSs(effTimeSecs)} />}
                {livePaceKm && <ChipAmber icon={Activity} label="Live pace" val={livePaceKm} />}
              </>
            ) : (
              /* Default pace mode (Running / Cycling / Ski Erg / etc.) */
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1.35fr 0.7fr 1.35fr' }}>
                  <div>
                    {fieldLabel('Distance')}
                    <input type="number" step="0.01" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    {fieldLabel('Unit')}
                    {unitLock === 'mi' || unitLock === 'km'
                      ? <LockedUnit u={unitLock} />
                      : <UnitToggle value={distUnit} options={['km', 'mi']} onChange={setDistUnit} className="w-full" />}
                  </div>
                  <div>
                    {fieldLabel('Time')}
                    <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                  </div>
                </div>
                {livePaceKm && <ChipAmber icon={Activity} label="Live pace" val={livePaceKm} />}
              </>
            )
          )}
        </div>
      )}

      {/* Save — appears once a movement is selected; entries log at "now". */}
      {type && exerciseName && (
        <div className="space-y-3">
          {error && <div className="flex items-center gap-2 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</div>}
          <button type="submit" disabled={saving || (type === 'strength' && !canSaveStrength) || (type === 'cardio' && !canSaveCardio)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Check className="h-4 w-4" /> Save entry</>}
          </button>
        </div>
      )}
    </form>
  )
}

// ── Strength per-effort metric parsers ─────────────────────────────────────────
// Each mirrors the parse logic in the matching detail surface so the mini-graph
// plots the SAME progression metric the detail page plots.

// Est. 1RM — weighted / olympic / ballistic / weighted-bodyweight Full-RX.
// Effort value shape: "Est. 1RM 370 lb" (athlete also saves bare "1RM N unit").
function parseOneRM(value) {
  const m = value?.match(/(?:Est\. )?1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  return m ? { val: parseFloat(m[1]), unit: m[2] } : null
}
// Hold seconds — isometric / leverage / load. Value shape: "45 sec".
function parseHoldSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1], 10) : null
}
// Reps — bodyweight tiers / rep-only families. Label shapes:
//   "... × 8"  (band / band+knee / Full-RX weighted) OR "... · 8 reps" (knee).
function parseReps(label) {
  let m = label?.match(/×\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  m = label?.match(/·\s*(\d+)\s*reps?/)
  return m ? parseInt(m[1], 10) : null
}
// Carry weight + distance — "Farmer's Carry · 100 kg × 50 m" →
// { weight: 100, unit: 'kg', distM: 50 }. Carry/Sled progress is two-
// dimensional (heavier OR farther); the detail pages plot ONE workload score
// (weight × distance) so a distance-only PR still reads as progress, and the
// card mirrors that.
function parseCarryWD(label) {
  const w = label?.match(/·\s*([\d.]+)\s*(\w+)\s*×/)
  const d = label?.match(/×\s*([\d.]+)\s*m\b/)
  if (!w || !d) return null
  return { weight: parseFloat(w[1]), unit: w[2], distM: parseFloat(d[1]) }
}
// Rucking weight + distance — "Rucking · 35 lb × 2.5 mi in 45:00" →
// { packLb: 35, distMi: 2.5 }. Legacy "Rucking · 2.5 mi in 45:00" (no pack) →
// packLb 0. Workload = packLb × distMi.
function parseRuckWD(label) {
  let m = label?.match(/·\s*(\d+)\s*lb\s*×\s*([\d.]+)\s*mi/)
  if (m) return { packLb: parseInt(m[1], 10), distMi: parseFloat(m[2]) }
  m = label?.match(/·\s*([\d.]+)\s*mi/)
  if (m) return { packLb: 0, distMi: parseFloat(m[1]) }
  return null
}
// Workload "Best" line for carry/sled: "10 lb × 262 ft" (lb→ft) or
// "100 kg × 50 m" (kg→m). The card has no profile, so we infer the distance
// display unit from the logged weight unit (imperial logs → ft), matching how
// the carry detail derives its distance unit.
function fmtCarryWorkloadBest(weight, unit, distM) {
  const imperial = unit === 'lb'
  const dDisp = imperial ? Math.round(distM / 0.3048) : Math.round(distM)
  return `${weight} ${unit} × ${dDisp} ${imperial ? 'ft' : 'm'}`
}
// Assisted-machine assistance — "Assisted Pull Up · 60 lb assist · X × 8".
// LOWER is better (less help = harder), so the chart Y-axis is reversed.
function parseAssistance(label) {
  const m = label?.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
  return m ? { val: parseFloat(m[1]), unit: m[2] } : null
}

// fmtDurationLong → "30s", "1m 10s" for the hold-seconds PR line.
function fmtHold(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

// ── Variant-family collapse helpers (mirror the athlete index) ─────────────────
//
// The athlete's "Your movements" (mobile/app/(app)/strength.tsx) and "Your
// activities" (mobile/app/(app)/cardio.tsx) lists collapse variant families
// into a single row keyed by the BASE name, with a small badge for the
// most-recently-trained (or highest-reached) variant. We replicate that here
// so the coach sees the same shape. Navigation for a collapsed row targets the
// BASE / consolidated route — the admin detail dispatchers
// (AdminEffortDetail + AdminCardioDetail) already special-case those base
// names and self-fetch every variant's efforts.

// Bodyweight assist tiers — highest tier reached drives the badge.
// FULL RX (no assist) > BAND (band only) > KNEE (knee only) > B+K (both).
const BW_TIER_RANK = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }
const BW_TIER_BADGE = { 'band+knee': 'B+K', 'knee': 'KNEE', 'band': 'BAND', 'rx': 'FULL RX' }

function bwTierFromVariantName(name) {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwBaseName(name) {
  return name
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
}

// Sled Work — two parallel variants ([Push] / [Drag]) collapse into one
// "Sled Work" row, badge = best-load variant (parallel, no hardness ranking).
const SLED_WORK_BASE_NAME = 'Sled Work'
function sledVariantFromName(name) {
  if (name === 'Sled Work [Push]') return 'push'
  if (name === 'Sled Work [Drag]') return 'drag'
  return null
}

// Swimming — four stroke variants ([Freestyle] / [Backstroke] / [Breaststroke]
// / [Butterfly], plus legacy bare "Swimming") collapse into one "Swimming"
// row, badge = best-pace stroke (parallel, no hardness ranking).
const SWIMMING_BASE_NAME = 'Swimming'
const SWIM_STROKE_BADGE = {
  freestyle: 'FREE', backstroke: 'BACK', breaststroke: 'BREAST', butterfly: 'FLY',
}
function isSwimHead(head) {
  return head === SWIMMING_BASE_NAME || head.startsWith('Swimming [')
}
function swimStrokeFromHead(head) {
  // Bare "Swimming" (legacy effort labels) defaults to freestyle — same as the
  // athlete's parseSwimStroke read path.
  const m = head.match(/^Swimming\s+\[(\w+)\]$/i)
  if (!m) return 'freestyle'
  const stroke = m[1].toLowerCase()
  return SWIM_STROKE_BADGE[stroke] ? stroke : 'freestyle'
}

// ── Recency formatter ──────────────────────────────────────────────────────────
function fmtRecency(ts) {
  if (!ts || ts < 0) return null
  const now = new Date()
  const then = new Date(ts)
  // Compare calendar days so "today / yesterday" read naturally regardless of time.
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return 'Last trained today'
  if (days === 1) return 'Last trained yesterday'
  return `Last trained ${days} days ago`
}

// Short date for the card hover popup, e.g. "Jun 6".
function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Per-point value string for the card hover popup, matching the move's metric
// (mirrors the mobile tap-to-pin tooltip — e.g. "Workload: 2625", "225 lb 1RM",
// "12 reps", "1m 30s", "60 lb assist").
function fmtMetricDisp(kind, val, unit) {
  switch (kind) {
    case 'workload': return `Total work: ${val}`
    case 'onerm':    return `${val} ${unit} 1RM`
    case 'hold':     return fmtHold(val)
    case 'reps':     return `${val} reps`
    case 'assist':   return `${val} ${unit} assist`
    default:         return `${val}${unit ? ` ${unit}` : ''}`
  }
}

// Hover popup for the card mini-graph — date + the point's display value.
// Same role as the mobile chart's tap-to-pin tooltip.
function MiniTip({ active, payload, color }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-md">
      <div className="text-[11px] text-muted-foreground">{p.date}</div>
      <div className="text-xs font-semibold" style={{ color }}>{p.disp}</div>
    </div>
  )
}

// ── Mini progress sparkline ─────────────────────────────────────────────────────
// Compact Recharts line, sparkline-style (no axes). Plots `points` oldest→newest.
// `reversed` flips the Y-axis so lower-is-better metrics still read "up = better"
// (locked chart-direction rule). <2 points → single-dot or placeholder.
function MiniGraph({ points, color, reversed }) {
  if (!points || points.length === 0) {
    return (
      <div className="flex h-[90px] items-center justify-center text-[11px] text-muted-foreground/60">
        Not enough data yet
      </div>
    )
  }
  // Each point carries a ready-to-show `disp` string + a short date so the hover
  // popup matches the mobile chart's tap-to-pin tooltip ("Jun 6 / Workload: 2625").
  // Dots mark every logged session so the data points are visible.
  const mk = p => ({ v: p.val, date: fmtShortDate(p.ts), disp: p.disp ?? String(p.val) })
  if (points.length === 1) {
    const one = mk(points[0])
    const data = [one, one]
    return (
      <div className="h-[90px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={['dataMin', 'dataMax']} reversed={reversed} />
            <Tooltip content={<MiniTip color={color} />} cursor={false} />
            <Line
              type="monotone" dataKey="v" stroke={color} strokeWidth={2}
              dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }
  const data = points.map(mk)
  const vals = data.map(d => d.v)
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const pad = (maxV - minV) * 0.18 || 1
  return (
    <div className="h-[90px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[minV - pad, maxV + pad]} reversed={reversed} />
          <Tooltip content={<MiniTip color={color} />} cursor={{ stroke: color, strokeOpacity: 0.35, strokeDasharray: '3 3' }} />
          <Line
            type="monotone" dataKey="v" stroke={color} strokeWidth={2}
            dot={{ r: 2, fill: color, strokeWidth: 0 }} activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Move card (block) ──────────────────────────────────────────────────────────

function MoveCard({ move, onClick }) {
  const meta = {
    strength: { icon: Dumbbell, cls: 'bg-blue-500/10 text-blue-400',   chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   line: '#60a5fa' },
    cardio:   { icon: Activity, cls: 'bg-amber-500/10 text-amber-400', chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20', line: '#fbbf24' },
  }[move.type] ?? { icon: Dumbbell, cls: 'bg-muted text-muted-foreground', chip: 'bg-muted text-muted-foreground border-border', line: '#94a3b8' }
  const Icon = meta.icon

  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/30 transition-colors"
    >
      {/* Title row — icon + name + variant badge */}
      <div className="flex items-center gap-2.5">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{move.label}</p>
        {/* Variant badge — which variant the graph below represents (collapsed
            families: bodyweight tier, Sled PUSH/DRAG, Swimming stroke, admin
            family short label). */}
        {move.badge && (
          <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
            {move.badge}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>

      {/* Mini progress graph */}
      <MiniGraph points={move.points} color={meta.line} reversed={move.reversed} />

      {/* PR / best + recency, stacked under the graph */}
      <div className="flex flex-col gap-0.5">
        <p className={`text-xs font-semibold tabular-nums ${move.type === 'cardio' ? 'text-amber-400' : 'text-blue-400'}`}>
          {move.bestText || '—'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {move.recencyText || `${move.count} ${move.count === 1 ? 'entry' : 'entries'}`}
        </p>
      </div>
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserActivity({ userId, onEffortSaved, basePath = '/admin/user', clientProfile = {} }) {
  const [, navigate]  = useLocation()
  const [efforts,  setEfforts]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState('strength')
  const [showForm, setShowForm] = useState(false)

  // Movements table (cached) — used to detect equipment / bodyweight tier
  // eligibility, exactly as the athlete index does via useMovements().
  const dbMovements = useMovements()

  // Lifted out of the effect so the Add-effort form's onSaved can re-fetch.
  async function load() {
    setLoading(true)
    const efRes = await supabase.from('efforts')
      .select('id, label, value, type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    setEfforts(efRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [userId])

  // ── Admin-added variant families (parent → children) ──────────────────────
  // Build childName → { parentName, shortLabel } from the movements catalog so
  // we can collapse a family's children (e.g. "Planche Hold [Tuck]" /
  // "[Straddle]" / "[Full]") into ONE row keyed by the PARENT ("Planche Hold"),
  // mirroring the athlete strength index. The badge = variant_short_label of
  // the most-recently-logged child; the row routes to the PARENT name so the
  // AdminEffortDetail dispatch renders the consolidated family detail.
  const familyChildMap = useMemo(() => {
    const byId = {}
    dbMovements.forEach(m => { byId[m.id] = m })
    const map = {}
    dbMovements.forEach(m => {
      if (!m.parent_movement_id) return
      const parent = byId[m.parent_movement_id]
      if (!parent) return
      map[m.name] = { parentName: parent.name, shortLabel: m.variant_short_label || null }
    })
    return map
  }, [dbMovements])

  // Movement record lookup by name — for equipment detection (carry / assisted).
  const movementByName = useMemo(() => {
    const map = {}
    dbMovements.forEach(m => { map[m.name] = m })
    return map
  }, [dbMovements])

  // ── Group efforts into collapsed family rows ──────────────────────────────
  const { strengthMoves, cardioMoves } = useMemo(() => {
    const strengthMap = {}
    const cardioMap   = {}

    // Parse the progression metric for ONE strength effort, given the group's
    // equipment hint. Mirrors the matching detail surface:
    //   carry    → weight   (parseCarryWeight)
    //   assisted → assistance, LOWER better (parseAssistance)
    //   else     → 1RM if present, else hold-seconds, else reps
    // Returns { val, unit, kind } or null. `kind` drives the PR line formatter.
    function strengthMetric(e, equipment) {
      if (equipment === 'carry') {
        // Workload = weight × distance. Use the DISPLAY distance (lb logs → ft,
        // else m) so the card's workload numbers match the detail page's chart
        // and the athlete app. `val` drives the graph + best comparison; weight +
        // distM ride along for the "w × d" best line.
        const c = parseCarryWD(e.label)
        if (!c) return null
        const distDisp = c.unit === 'lb' ? c.distM / 0.3048 : c.distM
        return { val: Math.round(c.weight * distDisp), unit: c.unit, kind: 'workload', weight: c.weight, distM: c.distM }
      }
      if (equipment === 'assisted') {
        const a = parseAssistance(e.label)
        return a ? { val: a.val, unit: a.unit, kind: 'assist' } : null
      }
      const rm = parseOneRM(e.value)
      if (rm) return { val: rm.val, unit: rm.unit, kind: 'onerm' }
      const secs = parseHoldSecs(e.value)
      if (secs !== null) return { val: secs, unit: 'sec', kind: 'hold' }
      const reps = parseReps(e.label)
      if (reps !== null) return { val: reps, unit: 'reps', kind: 'reps' }
      return null
    }

    // efforts arrive newest-first; track the most-recent variant by comparing
    // created_at so the badge always reflects the latest logged variant
    // regardless of map insertion order.
    efforts.forEach(e => {
      // Exercise / activity name is everything before the first ' · '
      const head = e.label.split(' · ')[0]
      const ts   = new Date(e.created_at).getTime()

      if (e.type === 'strength') {
        // ── Sled Work consolidation ────────────────────────────────────────
        const sledVariant = sledVariantFromName(head)
        if (sledVariant !== null) {
          const key = SLED_WORK_BASE_NAME
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'sled', count: 0,
            maxTs: -1, metricKind: 'weight', unit: 'lb',
            byVariant: {}, // variant → { best, unit, points: [{ts,val}] }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const m = strengthMetric(e, 'carry') // sled is carry-equipment → workload (w × d)
          if (m) {
            const v = g.byVariant[sledVariant] ??= { best: null, unit: m.unit, points: [] }
            v.points.push({ ts, val: m.val, disp: `Total work: ${m.val}` })
            if (v.best === null || m.val > v.best) {
              v.best = m.val; v.unit = m.unit
              v.bestW = m.weight; v.bestWUnit = m.unit; v.bestDistM = m.distM
            }
          }
          return
        }

        // ── Admin-added variant family consolidation ───────────────────────
        // If this effort's movement head is a family CHILD, group it under the
        // PARENT name. Badge = variant_short_label of the HARDEST/best variant
        // (no known hardness order → best metric value). navName = PARENT so
        // tapping routes to the consolidated family detail. Runs AFTER the Sled
        // block (Sled is hardcoded, not catalog-driven).
        const family = familyChildMap[head]
        if (family) {
          const key = family.parentName
          // The family's metric kind comes from the PARENT movement's equipment.
          const parentEquip = movementByName[key]?.equipment
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'family', count: 0,
            maxTs: -1, parentEquip,
            byVariant: {}, // childShortLabel → { best, unit, kind, points }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const m = strengthMetric(e, parentEquip)
          if (m) {
            const vk = family.shortLabel || head // group by short label (fallback child name)
            const v = g.byVariant[vk] ??= { best: null, unit: m.unit, kind: m.kind, points: [], short: family.shortLabel }
            v.points.push({ ts, val: m.val, disp: fmtMetricDisp(m.kind, m.val, m.unit) })
            const better = v.best === null
              || (m.kind === 'assist' ? m.val < v.best : m.val > v.best)
            if (better) { v.best = m.val; v.unit = m.unit }
          }
          return
        }

        // ── Bodyweight assist-tier consolidation ───────────────────────────
        const tier      = bwTierFromVariantName(head)
        const isVariant = tier !== 'rx'
        const base      = isVariant ? bwBaseName(head) : head
        const rec       = movementByName[base]
        const isBodyweight = rec?.equipment === 'bodyweight'
        // Only Pull-Up / Dip / Chin-Up family (band/knee eligible) movements
        // actually have tier variants — gate the badge on that, mirroring the
        // athlete's `canHaveTiers`. A plain bodyweight movement (Plank, Leg
        // Raise) never shows a tier badge even though it's bodyweight.
        const canHaveTiers = !!(rec?.band_assist || rec?.knee_assist)
        if (isBodyweight && (isVariant || canHaveTiers)) {
          const key = base
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'bw', count: 0,
            maxTs: -1, highestTier: tier, canHaveTiers,
            byTier: {}, // tier → { best, points: [{ts,val}] } — reps metric
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          g.canHaveTiers = g.canHaveTiers || canHaveTiers
          if (BW_TIER_RANK[tier] > BW_TIER_RANK[g.highestTier]) g.highestTier = tier
          // Plotting metric depends on whether the tier carries added load.
          // Rep count alone hides load: "15 reps at bodyweight" then "1 rep at
          // +150 lb" makes a rep-count line DROP even though the loaded single
          // is harder. So when a tier has ANY weighted effort (Full-RX with
          // weighted progression stores "Est. 1RM N unit" in `value` —
          // computed as estimate1RM(bodyweight + addedWeight, reps) at log
          // time), we plot e1RM; pure-bodyweight tiers (band / knee, or rep-only
          // Full-RX where value is "N reps") keep plotting reps. We track BOTH
          // series per tier + a hasWeighted flag, then choose at card-build time.
          const reps = parseReps(e.label)
          const rm   = parseOneRM(e.value)   // "Est. 1RM N unit" → present only on weighted efforts
          const v = g.byTier[tier] ??= { best: 0, points: [], e1rmBest: 0, e1rmPoints: [], hasWeighted: false }
          if (reps !== null) {
            v.points.push({ ts, val: reps, disp: `${reps} reps` })
            if (reps > v.best) v.best = reps
          }
          if (rm) {
            v.hasWeighted = true
            v.e1rmPoints.push({ ts, val: rm.val, disp: `${rm.val} ${rm.unit} 1RM`, unit: rm.unit })
            if (rm.val > v.e1rmBest) { v.e1rmBest = rm.val; v.e1rmUnit = rm.unit }
          }
          return
        }

        // ── Regular strength movement (no variants) ────────────────────────
        const key = head
        const equip = movementByName[key]?.equipment
        const g = strengthMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0,
          maxTs: -1, best: null, unit: null, metricKind: null, points: [], equip,
        }
        g.count++
        if (ts > g.maxTs) g.maxTs = ts
        const m = strengthMetric(e, equip)
        if (m) {
          g.metricKind = m.kind
          g.points.push({ ts, val: m.val, disp: fmtMetricDisp(m.kind, m.val, m.unit) })
          const better = g.best === null
            || (m.kind === 'assist' ? m.val < g.best : m.val > g.best)
          if (better) {
            g.best = m.val; g.unit = m.unit
            // Carry (workload): remember the best effort's weight + distance
            // for the "w × d" best line.
            if (m.kind === 'workload') { g.bestW = m.weight; g.bestWUnit = m.unit; g.bestDistM = m.distM }
          }
        }
      } else if (e.type === 'cardio') {
        // ── Swimming stroke consolidation ──────────────────────────────────
        if (isSwimHead(head)) {
          const key = SWIMMING_BASE_NAME
          const g = cardioMap[key] ??= {
            label: key, navName: key, kind: 'swim', count: 0,
            maxTs: -1, byStroke: {}, // stroke → { best, str, lowerBetter, points }
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const stroke = swimStrokeFromHead(head)
          const parsed = parseCardioBest(e.value)
          if (parsed) {
            const v = g.byStroke[stroke] ??= { best: null, str: null, lowerBetter: parsed.lowerBetter, points: [] }
            v.lowerBetter = parsed.lowerBetter
            // T092: plot the Riegel-normalized pace so a longer swim doesn't dip the
            // line; the hover (disp) still shows the raw logged pace.
            const norm = parsed.lowerBetter ? riegelNormPaceSecPerKm(e.label) : null
            const pv = norm != null ? norm : parsed.val
            v.points.push({ ts, val: pv, disp: e.value })
            const better = v.best === null
              || (parsed.lowerBetter ? pv < v.best : pv > v.best)
            if (better) { v.best = pv; v.str = e.value }
          }
          return
        }

        // ── Rucking workload (cardio tab, but carry-like: pack × distance) ──
        // Rucking improves on two axes (heavier pack OR farther), so we plot a
        // workload score = packLb × distMi instead of pace — mirrors the
        // rucking detail's single workload chart.
        if (head === 'Rucking') {
          const key = head
          const g = cardioMap[key] ??= {
            label: key, navName: key, kind: 'ruck', count: 0,
            maxTs: -1, best: null, bestW: null, bestDistMi: null, points: [],
          }
          g.count++
          if (ts > g.maxTs) g.maxTs = ts
          const r = parseRuckWD(e.label)
          if (r) {
            const wl = r.packLb * r.distMi
            g.points.push({ ts, val: wl, disp: `Total work: ${Math.round(wl)}` })
            if (g.best === null || wl > g.best) { g.best = wl; g.bestW = r.packLb; g.bestDistMi = r.distMi }
          }
          return
        }

        // ── Regular cardio activity (no variants) ──────────────────────────
        const key = head
        const g = cardioMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0,
          maxTs: -1, best: null, str: null, lowerBetter: false, points: [],
        }
        g.count++
        if (ts > g.maxTs) g.maxTs = ts
        // Direction-aware best across ALL cardio formats (pace, speed, cal/min,
        // floors/min, distance) — not just "/km" pace.
        const parsed = parseCardioBest(e.value)
        if (parsed) {
          g.lowerBetter = parsed.lowerBetter
          // T092: pace points plot the Riegel-normalized pace (so a longer/harder
          // effort doesn't dip the sparkline); cal/min + floors keep their raw rate.
          const norm = parsed.lowerBetter ? riegelNormPaceSecPerKm(e.label) : null
          const pv = norm != null ? norm : parsed.val
          g.points.push({ ts, val: pv, disp: e.value })
          const better = g.best === null
            || (parsed.lowerBetter ? pv < g.best : pv > g.best)
          if (better) { g.best = pv; g.str = e.value }
        }
      }
    })

    const sortAsc = pts => [...pts].sort((a, b) => a.ts - b.ts)

    // ── Build strength cards ──────────────────────────────────────────────
    const strengthMoves = Object.values(strengthMap).map(d => {
      let badge = null
      let points = []
      let bestText = '—'
      let reversed = false

      if (d.kind === 'sled') {
        // Best-load variant (parallel — no hardness order).
        const variants = Object.entries(d.byVariant)
        const winner = variants.reduce((best, [k, v]) =>
          (best === null || (v.best ?? -Infinity) > (best[1].best ?? -Infinity)) ? [k, v] : best, null)
        if (winner) {
          const [vk, v] = winner
          badge = vk === 'push' ? 'PUSH' : 'DRAG'
          points = sortAsc(v.points)
          bestText = v.bestW != null ? `Best ${fmtCarryWorkloadBest(v.bestW, v.bestWUnit, v.bestDistM)}` : '—'
        }
      } else if (d.kind === 'family') {
        // Hardest variant has no reliable order → pick best metric value.
        const variants = Object.entries(d.byVariant)
        const winner = variants.reduce((best, [k, v]) => {
          if (best === null) return [k, v]
          const bv = best[1].best, cv = v.best
          if (bv === null) return [k, v]
          if (cv === null) return best
          // assist lower-is-better; everything else higher-is-better.
          const cWins = v.kind === 'assist' ? cv < bv : cv > bv
          return cWins ? [k, v] : best
        }, null)
        if (winner) {
          const [, v] = winner
          badge = v.short || null
          points = sortAsc(v.points)
          reversed = v.kind === 'assist'
          bestText = formatStrengthBest(v.best, v.unit, v.kind)
        }
      } else if (d.kind === 'bw') {
        // Highest tier reached drives badge + graph. When that tier carries
        // added load, plot est. 1RM (rises with reps AND load) instead of reps,
        // so a heavier-but-fewer-reps session doesn't read as a drop.
        badge = d.canHaveTiers ? BW_TIER_BADGE[d.highestTier] : null
        const v = d.byTier[d.highestTier]
        if (v) {
          if (v.hasWeighted) {
            points = sortAsc(v.e1rmPoints)
            bestText = v.e1rmBest > 0 ? `Best ${v.e1rmBest} ${v.e1rmUnit} 1RM` : '—'
          } else {
            points = sortAsc(v.points)
            bestText = v.best > 0 ? `Best ${v.best} reps` : '—'
          }
        }
      } else {
        // plain
        points = sortAsc(d.points)
        reversed = d.metricKind === 'assist'
        bestText = d.metricKind === 'workload'
          ? (d.bestW != null ? `Best ${fmtCarryWorkloadBest(d.bestW, d.bestWUnit, d.bestDistM)}` : '—')
          : formatStrengthBest(d.best, d.unit, d.metricKind)
      }

      return {
        label: d.label, navName: d.navName, type: 'strength', count: d.count,
        badge, points, reversed, bestText,
        recencyText: fmtRecency(d.maxTs),
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    // ── Build cardio cards ────────────────────────────────────────────────
    const cardioMoves = Object.values(cardioMap).map(d => {
      let badge = null
      let points = []
      let bestText = '—'
      let reversed = false

      if (d.kind === 'swim') {
        // Best-pace stroke (parallel — no hardness order). Pace lowerBetter.
        const strokes = Object.entries(d.byStroke)
        const winner = strokes.reduce((best, [k, v]) => {
          if (best === null || v.best === null) return v.best === null ? best : (best === null ? [k, v] : best)
          const bv = best[1].best, cv = v.best
          const cWins = v.lowerBetter ? cv < bv : cv > bv
          return cWins ? [k, v] : best
        }, null)
        if (winner) {
          const [stroke, v] = winner
          badge = SWIM_STROKE_BADGE[stroke]
          points = sortAsc(v.points)
          reversed = v.lowerBetter
          bestText = v.str ? `Best ${v.str}` : '—'
        }
      } else if (d.kind === 'ruck') {
        // Total work (pack weight × distance) — higher = better, no reversal.
        points = sortAsc(d.points)
        reversed = false
        bestText = d.bestW != null ? `Best ${d.bestW} lb × ${d.bestDistMi} mi` : '—'
      } else {
        points = sortAsc(d.points)
        reversed = d.lowerBetter
        bestText = d.str ? `Best ${d.str}` : '—'
      }

      return {
        label: d.label, navName: d.navName, type: 'cardio', count: d.count,
        badge, points, reversed, bestText,
        recencyText: fmtRecency(d.maxTs),
      }
    }).sort((a, b) => a.label.localeCompare(b.label))

    return { strengthMoves, cardioMoves }
  }, [efforts, dbMovements, familyChildMap, movementByName])

  const visibleMoves = view === 'cardio' ? cardioMoves : strengthMoves

  function handleMoveClick(move) {
    // Navigate to the BASE / consolidated route. The admin detail dispatchers
    // (AdminEffortDetail / AdminCardioDetail) recognise "Sled Work",
    // "Swimming", and bodyweight base names and self-fetch every variant.
    navigate(`${basePath}/${userId}/effort/${move.type}/${encodeURIComponent(move.navName)}`)
  }

  return (
    <div className="space-y-4">

      {/* Unified action row — segmented toggle (left) + Add effort (right) */}
      <div className="flex items-center justify-between gap-3">
        {/* Segmented Strength ⇄ Cardio toggle */}
        <div className="border border-border rounded-lg p-0.5 inline-flex">
          {[
            { id: 'strength', label: 'Strength', icon: Dumbbell },
            { id: 'cardio',   label: 'Cardio',   icon: Activity },
          ].map(t => {
            const Icon = t.icon
            const active = view === t.id
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />{t.label}
              </button>
            )
          })}
        </div>
        <CoachAddButton label="Add effort" onClick={() => setShowForm(f => !f)} />
      </div>

      {/* Add effort form (toggled by the action-row button) */}
      {showForm && (
        <AddEffortForm
          userId={userId}
          movements={dbMovements}
          clientProfile={clientProfile}
          onSaved={() => { load(); onEffortSaved?.() }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Move cards for the selected type */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleMoves.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {view === 'cardio' ? 'No cardio logged yet' : 'No strength logged yet'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleMoves.map(move => (
            <MoveCard
              key={`${move.type}-${move.navName}`}
              move={move}
              onClick={() => handleMoveClick(move)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// PR-line formatter for strength metrics by kind.
function formatStrengthBest(val, unit, kind) {
  if (val === null || val === undefined) return '—'
  switch (kind) {
    case 'onerm':  return `Best ${val} ${unit} 1RM`
    case 'hold':   return `Best ${fmtHold(val)}`
    case 'reps':   return `Best ${val} reps`
    case 'weight': return `Best ${val} ${unit}`
    case 'assist': return `Best ${val} ${unit} assist`
    default:       return `Best ${val}${unit ? ` ${unit}` : ''}`
  }
}
