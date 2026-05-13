import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { estimate1RM } from '../lib/formulas'
import { useMovements } from '../hooks/useMovements'
import MovementSearch from '../components/MovementSearch'
import { Dumbbell, Timer, ChevronRight, Check } from 'lucide-react'

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

function parseOneRM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

function parseDurationSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1]) : null
}

function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

const BAND_LEVELS = ['Light', 'Medium', 'Heavy', 'Extra Heavy']

export default function Strength() {
  const { user, profile } = useAuth()
  const isAdmin = !!profile?.is_superuser
  const [, navigate] = useLocation()

  // ── Core fields ──────────────────────────────────────────────────────────
  const [exercise,  setExercise]  = useState('')
  const [weight,    setWeight]    = useState('')
  const [reps,      setReps]      = useState('')
  const [timeStr,   setTimeStr]   = useState('')
  const [distance,  setDistance]  = useState('')  // metres, for carries
  const [bandLevel, setBandLevel] = useState(null) // null | 'Light' | 'Medium' | 'Heavy' | 'Extra Heavy'
  const [kneeAssist,setKneeAssist]= useState(false)
  const [unit,      setUnit]      = useState(profile?.weight_unit || 'lb')
  useEffect(() => { if (profile?.weight_unit) setUnit(profile.weight_unit) }, [profile?.weight_unit])

  // ── UI state ─────────────────────────────────────────────────────────────
  const [saved,        setSaved]        = useState(false)
  const [suggestSent,  setSuggestSent]  = useState(false)
  const [suggesting,   setSuggesting]   = useState(false)
  const suggestingRef  = useRef(false)
  const [saveError,    setSaveError]    = useState('')
  const [movements,    setMovements]    = useState([])
  const [pendingQuery, setPendingQuery] = useState('')
  const [movementKey,  setMovementKey]  = useState(0)

  // ── DB movements (cached, fetched once per session) ──────────────────────
  const dbMovements     = useMovements()
  const strengthRecords = useMemo(() => dbMovements.filter(m => m.category === 'strength'), [dbMovements])
  const strengthNames   = useMemo(() => strengthRecords.map(m => m.name), [strengthRecords])

  // ── Reset on any meaningful field change ─────────────────────────────────
  useEffect(() => { setSaved(false); setSaveError('') },
    [exercise, weight, reps, timeStr, unit, distance, bandLevel, kneeAssist]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset modifiers when exercise changes ─────────────────────────────────
  useEffect(() => {
    setBandLevel(null)
    setKneeAssist(false)
    setDistance('')
    setWeight('')
    setReps('')
    setTimeStr('')
  }, [exercise])

  // ── Reset weight/reps/time when isometric flips ──────────────────────────
  const movementRecord    = exercise ? (strengthRecords.find(m => m.name === exercise) ?? null) : null
  const isIsometric       = movementRecord?.strength_type === 'isometric'
  const isAssistedMachine = movementRecord?.equipment === 'assisted'
  const isCarry           = movementRecord?.equipment === 'carry'
  const isBodyweightExercise = movementRecord?.equipment === 'bodyweight'
  const isBandEligible    = isBodyweightExercise && movementRecord?.band_assist === true
  const isKneeEligible    = isBodyweightExercise && movementRecord?.knee_assist === true
  const isDumbbell        = movementRecord?.equipment === 'dumbbell'

  useEffect(() => {
    setWeight(''); setReps(''); setTimeStr('')
  }, [isIsometric])

  // ── Suggestion mode (unknown exercise typed — end users only) ────────────
  const suggestionMode = !isAdmin && !exercise
    && pendingQuery.trim() !== ''
    && !strengthNames.some(m => {
        const tokens = pendingQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
        return tokens.every(t => m.toLowerCase().includes(t))
      })

  async function handleSuggestMove(name) {
    if (!user || suggestingRef.current || suggestSent) return
    const n = (name || pendingQuery).trim()
    if (!n) return
    suggestingRef.current = true
    setSuggesting(true)
    const { error } = await supabase.from('messages').insert({
      user_id: user.id, from_admin: false,
      body: `New strength move suggestion: ${n}`,
      is_suggestion: true, read: false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setPendingQuery('')
      setMovementKey(k => k + 1)
      setExercise(''); setWeight(''); setReps(''); setTimeStr(''); setDistance('')
      setTimeout(() => setSuggestSent(false), 2000)
    }
  }

  // ── Weight calculations ───────────────────────────────────────────────────
  const profileBodyWeight = profile?.current_weight ?? null
  const addedWeight       = isBodyweightExercise ? (Number(weight) || 0) : 0
  const assistanceWeight  = isAssistedMachine    ? (Number(weight) || 0) : 0

  const effectiveWeight = isAssistedMachine
    ? Math.max(0, (profileBodyWeight ?? 0) - assistanceWeight)
    : isBodyweightExercise
      ? (profileBodyWeight ?? 0) + addedWeight
      : Number(weight)

  const r = Number(reps)
  const liveOneRM = !isIsometric && !isCarry && !bandLevel && !kneeAssist
    && r >= 1 && r <= 30 && reps && effectiveWeight > 0
    ? estimate1RM(effectiveWeight, r)
    : null

  const durSecs    = parseTimeStr(timeStr) || 0
  const canSaveIso = isIsometric && durSecs >= 1

  const canSaveRep = (() => {
    if (!exercise.trim())  return false
    if (isIsometric)       return canSaveIso
    if (isAssistedMachine) return !!liveOneRM && r >= 1 && r <= 30
    if (isCarry)           return !!Number(weight) && !!Number(distance) && Number(distance) > 0
    if (bandLevel)         return r >= 1 && !!reps
    if (kneeAssist)        return r >= 1 && !!reps
    return liveOneRM || (isBodyweightExercise && reps && r >= 1 && r <= 30)
  })()

  const buttonDisabled = suggestionMode
    ? (suggesting || suggestSent)
    : (saved || !canSaveRep)

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveEffort() {
    if (!user || saved) return

    // Shared post-save cleanup: clears all fields AND resets MovementSearch
    // (bumping movementKey remounts it, wiping its internal query so the
    //  stale pendingQuery can't re-trigger suggestion mode on an empty field)
    function resetForm() {
      setExercise(''); setWeight(''); setReps(''); setTimeStr('')
      setDistance(''); setBandLevel(null); setKneeAssist(false)
      setPendingQuery(''); setMovementKey(k => k + 1)
    }

    // Isometric hold
    if (isIsometric) {
      if (!canSaveIso) return
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${durSecs} sec`,
        value: `${durSecs} sec`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Assisted machine (Assisted Dip / Pull Up)
    if (isAssistedMachine) {
      if (!profileBodyWeight) {
        setSaveError('No bodyweight on file — please log your weight in the Bodyweight section first.')
        return
      }
      if (!liveOneRM) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${assistanceWeight} ${unit} assist × ${reps}`,
        value: `Est. 1RM ${liveOneRM} ${unit}`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Carry (weight + distance)
    if (isCarry) {
      const w = Number(weight)
      const d = Number(distance)
      if (!w || !d || d <= 0) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} · ${w} ${unit} × ${d} m`,
        value: `${d} m @ ${w} ${unit}`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Band + Knee combined
    if (bandLevel && kneeAssist) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Band + Knee] · ${bandLevel} × ${reps}`,
        value: `${reps} reps`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Band-assisted bodyweight
    if (bandLevel) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Band] · ${bandLevel} × ${reps}`,
        value: `${reps} reps`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Knee-assisted bodyweight
    if (kneeAssist) {
      if (r < 1 || !reps) return
      setSaveError('')
      await supabase.from('efforts').insert({
        user_id: user.id, type: 'strength',
        label: `${exercise} [Knee] · ${reps} reps`,
        value: `${reps} reps`,
      })
      setSaved(true)
      setTimeout(resetForm, 1500)
      return
    }

    // Standard bodyweight or weighted
    if (isBodyweightExercise && !profileBodyWeight && addedWeight <= 0) {
      setSaveError('No bodyweight on file — please log your weight in the Bodyweight section first.')
      return
    }
    if (!liveOneRM) return
    setSaveError('')
    const labelWeight = isBodyweightExercise
      ? (addedWeight > 0 ? `${profileBodyWeight}+${addedWeight}` : `${profileBodyWeight}`)
      : Number(weight)
    await supabase.from('efforts').insert({
      user_id: user.id, type: 'strength',
      label: `${exercise} · ${labelWeight} ${unit} × ${reps}`,
      value: `Est. 1RM ${liveOneRM} ${unit}`,
    })
    setSaved(true)
    setTimeout(resetForm, 1500)
  }

  // ── Load "Your movements" list ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('label, value')
      .eq('user_id', user.id)
      .eq('type', 'strength')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map()
        data.forEach(e => {
          const name = e.label.split(' · ')[0]

          const isBandKnee = name.endsWith(' [Band + Knee]')
          const isBand     = name.endsWith(' [Band]')
          const isKnee     = name.endsWith(' [Knee]')
          const baseName   = isBandKnee || isBand || isKnee
            ? name.replace(/ \[Band \+ Knee\]$/, '').replace(/ \[Band\]$/, '').replace(/ \[Knee\]$/, '')
            : name
          const rec = dbMovements.find(m => m.name === baseName)

          if (rec?.strength_type === 'isometric') {
            const secs = parseDurationSecs(e.value)
            if (secs === null) return
            const ex = map.get(name)
            if (!ex || secs > ex.bestSecs) map.set(name, { name, bestSecs: secs, kind: 'isometric' })

          } else if (rec?.equipment === 'assisted') {
            const assistM = e.label.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
            if (!assistM) return
            const assistance = parseFloat(assistM[1])
            const u = assistM[2]
            const ex = map.get(name)
            if (!ex || assistance < (ex.bestAssistance ?? Infinity))
              map.set(name, { name, bestAssistance: assistance, unit: u, kind: 'assisted' })

          } else if (rec?.equipment === 'carry') {
            const distM = e.label.match(/×\s*([\d.]+)\s*m/)
            if (!distM) return
            const dist = parseFloat(distM[1])
            const ex = map.get(name)
            if (!ex || dist > (ex.bestDist ?? 0)) map.set(name, { name, bestDist: dist, kind: 'carry' })

          } else if (isBandKnee || isBand || isKnee) {
            const repsM = e.label.match(/×\s*(\d+)/) || e.value.match(/^(\d+)/)
            const repsVal = repsM ? parseInt(repsM[1]) : null
            if (!repsVal) return
            const ex = map.get(name)
            if (!ex || repsVal > (ex.bestReps ?? 0)) map.set(name, { name, bestReps: repsVal, kind: 'reps-only' })

          } else {
            const parsed = parseOneRM(e.value)
            if (!parsed) return
            const ex = map.get(name)
            if (!ex || parsed.oneRM > ex.oneRM) map.set(name, { name, oneRM: parsed.oneRM, unit: parsed.unit, kind: 'strength' })
          }
        })
        setMovements([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
  }, [user, saved, dbMovements])

  // ── Render ────────────────────────────────────────────────────────────────
  const headerSubtext = isIsometric       ? 'Log a timed hold to track your progress.'
    : isAssistedMachine ? 'Lower assistance = less help = harder. Goal: reach 0.'
    : isCarry           ? 'Log the weight carried and distance covered in metres.'
    : 'Enter any set to project your 1RM.'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Strength</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{headerSubtext}</p>
      </div>

      <div className="animate-rise relative z-10 rounded-xl border border-border bg-card p-5 space-y-4">

        {/* Movement search */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Exercise</label>
          <MovementSearch
            key={movementKey}
            value={exercise}
            onChange={setExercise}
            onSuggest={isAdmin ? undefined : handleSuggestMove}
            onQueryChange={isAdmin ? undefined : setPendingQuery}
            movements={strengthNames}
            placeholder="Search or type movement…"
          />
        </div>

        {/* ── Input fields — only shown once an exercise is selected ── */}
        {suggestionMode ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            This exercise isn't in our list yet. Send it as a suggestion and your coach will add it.
          </p>

        ) : !exercise ? null : isIsometric ? (
        /* ── Isometric: duration ── */
          <>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Duration</label>
              <input
                type="text" inputMode="numeric"
                value={timeStr}
                onChange={e => setTimeStr(applyTimeMask(e.target.value))}
                placeholder="mm:ss"
                className={inputCls}
              />
            </div>
            {durSecs >= 1 && (
              <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Timer className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">Hold duration</span>
                </div>
                <span className="font-mono text-base tabular-nums font-bold text-blue-400">{fmtDuration(durSecs)}</span>
              </div>
            )}
          </>

        ) : isAssistedMachine ? (
        /* ── Assisted machine: assistance + reps ── */
          <>
            <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Reps</label>
                <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="30" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Assistance ↓</label>
                <input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Unit</label>
                <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
                  <option>lb</option><option>kg</option>
                </select>
              </div>
            </div>

            {profileBodyWeight !== null && reps && r >= 1 && (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-muted-foreground">
                    {profileBodyWeight} − {assistanceWeight} = <strong>{effectiveWeight} {unit}</strong> effective
                  </span>
                </div>
                {liveOneRM && (
                  <span className="font-mono text-base tabular-nums font-bold text-blue-400">{liveOneRM} {unit}</span>
                )}
              </div>
            )}
            {!profileBodyWeight && (
              <p className="text-xs text-muted-foreground">
                Log your bodyweight in the Bodyweight section to enable assistance calculations.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Lower assistance = less help = harder · Goal: reach 0 {unit}
            </p>
          </>

        ) : isCarry ? (
        /* ── Carry: weight + distance ── */
          <>
            <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '1.35fr 1fr 1fr' }}>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Weight</label>
                <input type="number" value={weight} onChange={e => setWeight(e.target.value)} className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Unit</label>
                <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
                  <option>lb</option><option>kg</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Distance (m)</label>
                <input type="number" value={distance} onChange={e => setDistance(e.target.value)} placeholder="0" className={inputCls} />
              </div>
            </div>
            {Number(weight) > 0 && Number(distance) > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">
                    {Number(weight)} {unit} × {Number(distance)} m
                  </span>
                </div>
              </div>
            )}
          </>

        ) : (
        /* ── Standard rep-based (bodyweight or weighted) with optional modifiers ── */
          <>
            {/* When a modifier is active, hide the weight field — reps only */}
            {bandLevel || kneeAssist ? (
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Reps</label>
                <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="100" className={inputCls} />
              </div>
            ) : (
              <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Reps</label>
                  <input type="number" value={reps} onChange={e => setReps(e.target.value)} min="1" max="30" className={inputCls} />
                </div>
                <div className="flex flex-col gap-1.5">
                  {isBodyweightExercise
                    ? <div className="flex items-center gap-0.5">
                        <span className={labelCls}>Added weight</span>
                        <span className="text-blue-400 text-sm leading-none shrink-0">*</span>
                      </div>
                    : <label className={labelCls}>{isDumbbell ? 'Per hand' : 'Weight'}</label>
                  }
                  <input
                    type="number" value={weight}
                    onChange={e => setWeight(e.target.value)}
                    placeholder={isBodyweightExercise ? '0' : ''}
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Unit</label>
                  <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
                    <option>lb</option><option>kg</option>
                  </select>
                </div>
              </div>
            )}

            {/* Band level picker */}
            {isBandEligible && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Band Assistance</p>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...BAND_LEVELS].map(level => (
                    <button
                      key={level ?? 'none'}
                      type="button"
                      onClick={() => setBandLevel(level)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        bandLevel === level
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }`}
                    >
                      {level ?? 'None'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Knee assist toggle */}
            {isKneeEligible && (
              <button
                type="button"
                onClick={() => setKneeAssist(k => !k)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  kneeAssist
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                }`}
              >
                <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                  kneeAssist ? 'bg-primary border-primary' : 'border-current'
                }`}>
                  {kneeAssist && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                Knee assisted
              </button>
            )}

            {/* Live feedback chip */}
            {liveOneRM && (
              <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">
                    {isDumbbell ? 'Est. 1RM per hand' : 'Estimated 1RM'}
                  </span>
                </div>
                <span className="font-mono text-base tabular-nums font-bold text-blue-400">{liveOneRM} {unit}</span>
              </div>
            )}
            {(bandLevel || kneeAssist) && r >= 1 && reps && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                <Check className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {bandLevel && kneeAssist
                    ? `${bandLevel} band + Knee · ${reps} reps`
                    : bandLevel
                      ? `${bandLevel} band · ${reps} reps`
                      : `Knee assisted · ${reps} reps`}
                </span>
              </div>
            )}
          </>
        )}

        {/* Save / Suggest button — only shown once an exercise is selected or in suggestion mode */}
        {(exercise || suggestionMode) && (
          <>
            <button
              onClick={suggestionMode ? () => handleSuggestMove(pendingQuery) : saveEffort}
              disabled={buttonDisabled}
              className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 ${
                suggestionMode
                  ? suggestSent  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : suggesting ? 'bg-blue-500/60 text-white cursor-wait'
                                 : 'bg-blue-500 text-white hover:opacity-90'
                  : saved        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : canSaveRep   ? 'bg-blue-500 text-white hover:opacity-90'
                                 : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
              }`}
            >
              {suggestionMode
                ? suggestSent ? '✓ Suggestion Sent' : suggesting ? 'Sending…' : 'Send Suggestion'
                : saved ? '✓ Saved' : 'Save Effort'}
            </button>

            {suggestSent && (
              <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-400">
                <Check className="h-3.5 w-3.5 shrink-0" /> Suggestion sent to your coach.
              </div>
            )}

            {saveError && (
              <p className="text-xs text-destructive leading-snug">{saveError}</p>
            )}
          </>
        )}

        {exercise && isBodyweightExercise && !isIsometric && !bandLevel && !kneeAssist && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="text-blue-400 font-semibold">*</span> Optional — uses your latest logged bodyweight for calculations.
          </p>
        )}
      </div>

      {/* Your movements */}
      {movements.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Your movements</h2>
          </div>
          <div className="divide-y divide-border">
            {movements.map(mov => (
              <button
                key={mov.name}
                onClick={() => navigate(`/effort/strength/${encodeURIComponent(mov.name)}`)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/50 transition-colors text-left"
              >
                <span className="text-sm font-medium">{mov.name}</span>
                <div className="flex items-center gap-2">
                  {mov.kind === 'isometric' ? (
                    <>
                      <span className="text-xs text-muted-foreground">Best hold</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{fmtDuration(mov.bestSecs)}</span>
                    </>
                  ) : mov.kind === 'assisted' ? (
                    <>
                      <span className="text-xs text-muted-foreground">Best assist</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{mov.bestAssistance} {mov.unit}</span>
                    </>
                  ) : mov.kind === 'carry' ? (
                    <>
                      <span className="text-xs text-muted-foreground">Best dist.</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{mov.bestDist} m</span>
                    </>
                  ) : mov.kind === 'reps-only' ? (
                    <>
                      <span className="text-xs text-muted-foreground">Best</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{mov.bestReps} reps</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Est. 1RM</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{mov.oneRM} {mov.unit}</span>
                    </>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
