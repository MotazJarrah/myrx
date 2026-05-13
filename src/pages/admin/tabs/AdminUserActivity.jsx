import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../../lib/supabase'
import { STRENGTH_MOVEMENTS, CARDIO_MOVEMENTS, ISOMETRIC_EXERCISE_NAMES, getCardioMode } from '../../../lib/movements'
import { estimate1RM } from '../../../lib/formulas'
import MovementSearch from '../../../components/MovementSearch'
import ROMVisualizer from '../../../components/ROMVisualizer'
import AdminClientMobility from '../AdminClientMobility'
import {
  Dumbbell, Activity, Flower2, Plus, ChevronRight,
  Loader2, Check, AlertCircle, X, Timer,
} from 'lucide-react'

// ── Time helpers ──────────────────────────────────────────────────────────────

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
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

// ── ROM movement list ─────────────────────────────────────────────────────────

const ROM_MOVEMENTS = [
  { key: 'shoulder-flexion',   label: 'Shoulder Flexion',   group: 'Shoulder', maxDeg: 180 },
  { key: 'shoulder-extension', label: 'Shoulder Extension', group: 'Shoulder', maxDeg: 60  },
  { key: 'shoulder-abduction', label: 'Shoulder Abduction', group: 'Shoulder', maxDeg: 180 },
  { key: 'hip-flexion',        label: 'Hip Flexion',        group: 'Hip',      maxDeg: 120 },
  { key: 'hip-abduction',      label: 'Hip Abduction',      group: 'Hip',      maxDeg: 45  },
  { key: 'knee-flexion',       label: 'Knee Flexion',       group: 'Knee',     maxDeg: 135 },
  { key: 'ankle-dorsiflexion', label: 'Ankle Dorsiflexion', group: 'Ankle',    maxDeg: 20  },
  { key: 'spinal-flexion',     label: 'Spinal Flexion',     group: 'Spine',    maxDeg: 90  },
]

// ── Add Effort Form ───────────────────────────────────────────────────────────

function AddEffortForm({ userId, onSaved, onClose }) {
  const [type,         setType]         = useState(null)
  const [exerciseName, setExerciseName] = useState('')
  const [reps,         setReps]         = useState('')
  const [weightVal,    setWeightVal]    = useState('')
  const [weightUnit,   setWeightUnit]   = useState('lb')
  const [timeStr,      setTimeStr]      = useState('')
  const [distVal,      setDistVal]      = useState('')
  const [distUnit,     setDistUnit]     = useState('km')
  const [romKey,       setRomKey]       = useState('')
  const [degrees,      setDegrees]      = useState(90)
  const [date,         setDate]         = useState(() => new Date().toISOString().split('T')[0])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const romVisualizerRef = useRef(null)

  // Scroll to ROM visualizer when a pill is selected
  useEffect(() => {
    if (romKey && type === 'mobility') {
      setTimeout(() => {
        romVisualizerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [romKey])

  const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  // Strength derived state
  const isIsometric = exerciseName ? ISOMETRIC_EXERCISE_NAMES.has(exerciseName) : false
  const durSecs     = parseTimeStr(timeStr) || 0
  const r           = Number(reps)
  const w           = Number(weightVal)
  const liveOneRM   = !isIsometric && r >= 1 && r <= 30 && reps && w > 0
    ? estimate1RM(w, r)
    : null
  const canSaveStrength = isIsometric ? durSecs >= 1 : liveOneRM != null

  useEffect(() => { setTimeStr(''); setReps(''); setWeightVal('') }, [isIsometric])

  // Cardio derived state
  const cardioMode = exerciseName && type === 'cardio' ? getCardioMode(exerciseName) : 'pace'
  const distKm     = distUnit === 'mi' ? (Number(distVal) || 0) * 1.60934 : (Number(distVal) || 0)
  const timeSecs   = parseTimeStr(timeStr) || 0

  const livePaceKm = (() => {
    if (cardioMode !== 'pace' || distKm <= 0 || !timeSecs) return null
    const sec = timeSecs / distKm
    return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}/km`
  })()

  const canSaveCardio = cardioMode === 'pace' ? (distKm > 0 && timeSecs > 0) : timeSecs > 0

  useEffect(() => { setDistVal(''); setTimeStr('') }, [cardioMode])

  // Pre-populate ROM degrees from last saved record
  useEffect(() => {
    if (!romKey || type !== 'mobility') return
    supabase
      .from('rom_records')
      .select('degrees')
      .eq('user_id', userId)
      .eq('movement_key', romKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { setDegrees(data?.degrees ?? 0) })
  }, [romKey, type, userId])

  function resetForm() {
    setExerciseName(''); setReps(''); setWeightVal(''); setTimeStr('')
    setDistVal(''); setRomKey(''); setDegrees(90)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // Use actual current time for today; UTC noon (Z) for past dates so we
      // never create a future timestamp regardless of the admin's local timezone.
      const today = new Date().toISOString().split('T')[0]
      const ts    = date === today
        ? new Date().toISOString()
        : new Date(date + 'T12:00:00Z').toISOString()

      if (type === 'mobility') {
        if (!romKey) throw new Error('Select a movement.')
        const { error: err } = await supabase.from('rom_records').insert({
          user_id: userId, movement_key: romKey, degrees: Number(degrees), created_at: ts,
        })
        if (err) throw err

      } else if (type === 'strength') {
        if (!exerciseName.trim()) throw new Error('Enter an exercise name.')
        let label, value
        if (isIsometric) {
          label = `${exerciseName} · ${durSecs} sec`
          value = `${durSecs} sec`
        } else {
          label = `${exerciseName} · ${w} ${weightUnit} × ${reps}`
          value = `Est. 1RM ${liveOneRM} ${weightUnit}`
        }
        const { error: err } = await supabase.from('efforts').insert({
          user_id: userId, type: 'strength', label, value, created_at: ts,
        })
        if (err) throw err

      } else if (type === 'cardio') {
        if (!exerciseName.trim()) throw new Error('Enter an activity name.')
        const label = cardioMode === 'pace'
          ? `${exerciseName} · ${parseFloat(Number(distVal).toFixed(3))} ${distUnit} in ${timeStr}`
          : `${exerciseName} · ${timeStr}`
        const value = cardioMode === 'pace' ? livePaceKm : timeStr
        const { error: err } = await supabase.from('efforts').insert({
          user_id: userId, type: 'cardio', label, value, created_at: ts,
        })
        if (err) throw err
      }

      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

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
            { id: 'mobility', label: 'Mobility', icon: Flower2,  cls: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30' },
          ].map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} type="button"
                onClick={() => { setType(t.id); resetForm() }}
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
            <MovementSearch value={exerciseName} onChange={setExerciseName} movements={STRENGTH_MOVEMENTS} placeholder="Search or type exercise…" />
          </div>

          {isIsometric ? (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Duration</p>
                <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
              </div>
              {durSecs >= 1 && (
                <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                  <div className="flex items-center gap-2"><Timer className="h-3.5 w-3.5 text-blue-400" /><span className="text-xs text-muted-foreground">Hold duration</span></div>
                  <span className="font-mono text-base tabular-nums font-bold text-blue-400">{fmtDuration(durSecs)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Reps</p>
                  <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="30" className={inputCls} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Weight</p>
                  <input type="number" step="0.5" value={weightVal} onChange={e => setWeightVal(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Unit</p>
                  <select value={weightUnit} onChange={e => setWeightUnit(e.target.value)} className={inputCls}>
                    <option>lb</option><option>kg</option>
                  </select>
                </div>
              </div>
              {liveOneRM && (
                <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                  <div className="flex items-center gap-2"><Dumbbell className="h-3.5 w-3.5 text-blue-400" /><span className="text-xs text-muted-foreground">Estimated 1RM</span></div>
                  <span className="font-mono text-base tabular-nums font-bold text-blue-400">{liveOneRM} {weightUnit}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Cardio ── */}
      {type === 'cardio' && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Activity</p>
            <MovementSearch value={exerciseName} onChange={setExerciseName} movements={CARDIO_MOVEMENTS} placeholder="Search or type activity…" />
          </div>

          {cardioMode === 'duration' ? (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Duration</p>
                <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
              </div>
              {timeSecs > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
                  <div className="flex items-center gap-2"><Timer className="h-3.5 w-3.5 text-amber-400" /><span className="text-xs text-muted-foreground">Session time</span></div>
                  <span className="font-mono text-base tabular-nums font-bold text-amber-400">{timeStr}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 0.9fr 1.35fr' }}>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Distance</p>
                  <input type="number" step="0.01" value={distVal} onChange={e => setDistVal(e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Unit</p>
                  <select value={distUnit} onChange={e => setDistUnit(e.target.value)} className={inputCls}>
                    <option value="km">km</option><option value="mi">mi</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Time</p>
                  <input type="text" inputMode="numeric" value={timeStr} onChange={e => setTimeStr(applyTimeMask(e.target.value))} placeholder="mm:ss" className={inputCls} />
                </div>
              </div>
              {livePaceKm && (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
                  <div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-amber-400" /><span className="text-xs text-muted-foreground">Live pace</span></div>
                  <span className="font-mono text-base tabular-nums font-bold text-amber-400">{livePaceKm}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Mobility ── */}
      {type === 'mobility' && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Movement</p>
            <div className="flex flex-wrap gap-1.5">
              {ROM_MOVEMENTS.map(m => (
                <button key={m.key} type="button" onClick={() => setRomKey(m.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    romKey === m.key ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300' : 'border-border text-muted-foreground hover:border-fuchsia-500/30 hover:text-foreground'
                  }`}
                >{m.label}</button>
              ))}
            </div>
          </div>
          {romKey && (
            <div ref={romVisualizerRef}>
              <ROMVisualizer movementKey={romKey} degrees={degrees} onChange={setDegrees} />
            </div>
          )}
        </div>
      )}

      {/* Date + save */}
      {type && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>
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

// ── Move card ─────────────────────────────────────────────────────────────────

function MoveCard({ label, type, count, stat, onClick }) {
  const meta = {
    strength: { icon: Dumbbell, cls: 'bg-blue-500/10 text-blue-400',       chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20'       },
    cardio:   { icon: Activity, cls: 'bg-amber-500/10 text-amber-400',     chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20'     },
    mobility: { icon: Flower2,  cls: 'bg-fuchsia-500/10 text-fuchsia-400', chip: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20' },
  }[type] ?? { icon: Dumbbell, cls: 'bg-muted text-muted-foreground', chip: 'bg-muted text-muted-foreground border-border' }
  const Icon = meta.icon

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-accent/30 transition-colors"
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.cls}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{stat || `${count} ${count === 1 ? 'entry' : 'entries'}`}</p>
      </div>
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.chip}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserActivity({ userId, onEffortSaved }) {
  const [, navigate]  = useLocation()
  const [efforts,  setEfforts]  = useState([])
  const [romRecs,  setRomRecs]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [refresh,  setRefresh]  = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [efRes, romRes] = await Promise.all([
        supabase.from('efforts')
          .select('id, label, value, type, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase.from('rom_records')
          .select('id, movement_key, degrees, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ])
      setEfforts(efRes.data || [])
      setRomRecs(romRes.data || [])
      setLoading(false)
    }
    load()
  }, [userId, refresh])

  // ── Group by exercise name ────────────────────────────────────────────────
  const { strengthMoves, cardioMoves, mobilityMoves } = useMemo(() => {
    const strengthMap = {}
    const cardioMap   = {}

    efforts.forEach(e => {
      // Exercise name is everything before the first ' · '
      const name = e.label.split(' · ')[0]

      if (e.type === 'strength') {
        if (!strengthMap[name]) strengthMap[name] = { count: 0, best1RM: null, unit: 'lb' }
        strengthMap[name].count++
        const m = e.value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
        if (m) {
          const rm = parseFloat(m[1])
          if (strengthMap[name].best1RM === null || rm > strengthMap[name].best1RM) {
            strengthMap[name].best1RM = rm
            strengthMap[name].unit    = m[2]
          }
        }
      } else if (e.type === 'cardio') {
        if (!cardioMap[name]) cardioMap[name] = { count: 0, bestSecs: null, bestPaceStr: null }
        cardioMap[name].count++
        // Pace format: "5:00/km"
        const pace = e.value?.match(/^(\d+):(\d{2})\/km$/)
        if (pace) {
          const secs = parseInt(pace[1]) * 60 + parseInt(pace[2])
          if (cardioMap[name].bestSecs === null || secs < cardioMap[name].bestSecs) {
            cardioMap[name].bestSecs    = secs
            cardioMap[name].bestPaceStr = e.value
          }
        }
      }
    })

    const strengthMoves = Object.entries(strengthMap)
      .map(([name, d]) => ({
        label: name,
        count: d.count,
        type:  'strength',
        stat:  d.best1RM !== null
          ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'} · Best 1RM ${d.best1RM} ${d.unit}`
          : `${d.count} ${d.count === 1 ? 'entry' : 'entries'}`,
      }))
      .sort((a, b) => b.count - a.count)

    const cardioMoves = Object.entries(cardioMap)
      .map(([name, d]) => ({
        label: name,
        count: d.count,
        type:  'cardio',
        stat:  d.bestPaceStr
          ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'} · Best ${d.bestPaceStr}`
          : `${d.count} ${d.count === 1 ? 'entry' : 'entries'}`,
      }))
      .sort((a, b) => b.count - a.count)

    const mobilityCounts = {}
    romRecs.forEach(r => {
      mobilityCounts[r.movement_key] = (mobilityCounts[r.movement_key] || 0) + 1
    })
    const mobilityMoves = Object.entries(mobilityCounts).map(([key, count]) => ({
      label: ROM_MOVEMENTS.find(m => m.key === key)?.label ?? key,
      key,
      count,
      type:  'mobility',
      stat:  `${count} ${count === 1 ? 'entry' : 'entries'}`,
    }))

    return { strengthMoves, cardioMoves, mobilityMoves }
  }, [efforts, romRecs])

  // Available filters (only show if data exists)
  const availableFilters = [
    'all',
    ...(strengthMoves.length > 0 ? ['strength'] : []),
    ...(cardioMoves.length   > 0 ? ['cardio']   : []),
    ...(mobilityMoves.length > 0 ? ['mobility'] : []),
  ]

  // Mobility is shown via embedded AdminClientMobility — excluded from card list
  const visibleMoves = useMemo(() => {
    if (filter === 'strength') return strengthMoves
    if (filter === 'cardio')   return cardioMoves
    if (filter === 'mobility') return []
    return [...strengthMoves, ...cardioMoves]
  }, [filter, strengthMoves, cardioMoves])

  const showMobility = filter === 'all' || filter === 'mobility'

  const totalMoves = strengthMoves.length + cardioMoves.length + mobilityMoves.length

  function handleMoveClick(move) {
    navigate(`/admin/user/${userId}/effort/${move.type}/${encodeURIComponent(move.label)}`)
  }

  const FILTER_LABELS = { all: 'All', strength: 'Strength', cardio: 'Cardio', mobility: 'Mobility' }

  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {availableFilters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {FILTER_LABELS[f]}
              {f !== 'all' && (() => {
                const n = f === 'strength' ? strengthMoves.length : f === 'cardio' ? cardioMoves.length : mobilityMoves.length
                return n > 0 ? ` (${n})` : ''
              })()}
            </button>
          ))}
        </div>

        {/* Add button */}
        <button onClick={() => setShowForm(f => !f)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity shrink-0">
          <Plus className="h-3.5 w-3.5" /> Add effort
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <AddEffortForm
          userId={userId}
          onSaved={() => {
            setRefresh(r => r + 1)
            onEffortSaved?.()
          }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Strength + cardio move cards */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : totalMoves === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          No efforts logged yet.
        </div>
      ) : (
        <>
          {visibleMoves.length > 0 && (
            <div className="space-y-2">
              {visibleMoves.map(move => (
                <MoveCard
                  key={`${move.type}-${move.label}`}
                  label={move.label}
                  type={move.type}
                  count={move.count}
                  stat={move.stat}
                  onClick={() => handleMoveClick(move)}
                />
              ))}
            </div>
          )}

          {/* Embedded mobility view — full ROM snapshot + movement cards */}
          {showMobility && (
            <AdminClientMobility
              userId={userId}
              onSaved={() => {
                setRefresh(r => r + 1)
                onEffortSaved?.()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
