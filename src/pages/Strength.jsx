import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { estimate1RM, getEquipmentType } from '../lib/formulas'
import { STRENGTH_MOVEMENTS, ISOMETRIC_EXERCISE_NAMES } from '../lib/movements'
import MovementSearch from '../components/MovementSearch'
import { Dumbbell, Timer, ChevronRight } from 'lucide-react'

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

export default function Strength() {
  const { user, profile } = useAuth()
  const [, navigate] = useLocation()
  const [exercise, setExercise] = useState('')
  const [weight, setWeight]     = useState('')
  const [reps, setReps]         = useState('')
  const [timeStr, setTimeStr]   = useState('')
  const [unit, setUnit]         = useState(profile?.weight_unit || 'lb')
  // Profile loads async — re-sync default unit once it's available
  useEffect(() => { if (profile?.weight_unit) setUnit(profile.weight_unit) }, [profile?.weight_unit])
  const [saved, setSaved]       = useState(false)
  const [saveError, setSaveError] = useState('')
  const [movements, setMovements] = useState([])
  const [suggestionSent, setSuggestionSent] = useState('')

  // Reset state whenever inputs change
  useEffect(() => { setSaved(false); setSaveError('') }, [exercise, weight, reps, timeStr, unit])

  function handleSuggestMove(name) {
    if (!user) return
    setSuggestionSent(name)
    setTimeout(() => setSuggestionSent(''), 3000)
    supabase.from('messages').insert({
      user_id: user.id, from_admin: false,
      body: `New strength move suggestion: ${name}`,
      is_suggestion: true, read: false,
    })
  }

  // Reset input fields when exercise type changes
  const isIsometric          = exercise ? ISOMETRIC_EXERCISE_NAMES.has(exercise) : false
  const isBodyweightExercise = exercise && !isIsometric && getEquipmentType(exercise) === 'bodyweight'

  useEffect(() => {
    setWeight(''); setReps(''); setTimeStr('')
  }, [isIsometric])

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
          if (ISOMETRIC_EXERCISE_NAMES.has(name)) {
            // Isometric: track best duration
            const secs = parseDurationSecs(e.value)
            if (secs === null) return
            const existing = map.get(name)
            if (!existing || secs > existing.bestSecs) {
              map.set(name, { name, bestSecs: secs, kind: 'isometric' })
            }
          } else {
            // Rep-based: track best 1RM
            const parsed = parseOneRM(e.value)
            if (!parsed) return
            const existing = map.get(name)
            if (!existing || parsed.oneRM > existing.oneRM) {
              map.set(name, { name, oneRM: parsed.oneRM, unit: parsed.unit, kind: 'strength' })
            }
          }
        })
        setMovements([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
  }, [user, saved])

  // ── Derived state (rep-based) ─────────────────────────────────────────────
  const profileBodyWeight = profile?.current_weight ?? null
  const addedWeight       = Number(weight) || 0
  const effectiveWeight   = isBodyweightExercise
    ? (profileBodyWeight ?? 0) + addedWeight
    : Number(weight)

  const r = Number(reps)
  const liveOneRM = !isIsometric && r >= 1 && r <= 30 && reps && effectiveWeight > 0
    ? estimate1RM(effectiveWeight, r)
    : null

  // ── Derived state (isometric) ─────────────────────────────────────────────
  const durSecs    = parseTimeStr(timeStr) || 0
  const canSaveIso = isIsometric && durSecs >= 1

  // ── Save handlers ─────────────────────────────────────────────────────────
  async function saveEffort() {
    if (!user || saved) return

    if (isIsometric) {
      if (!canSaveIso) return
      await supabase.from('efforts').insert({
        user_id: user.id,
        type:    'strength',
        label:   `${exercise} · ${durSecs} sec`,
        value:   `${durSecs} sec`,
      })
      setSaved(true)
      setTimeout(() => { setExercise(''); setTimeStr('') }, 1500)
      return
    }

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
      user_id: user.id,
      type:    'strength',
      label:   `${exercise} · ${labelWeight} ${unit} × ${reps}`,
      value:   `Est. 1RM ${liveOneRM} ${unit}`,
    })
    setSaved(true)
    setTimeout(() => { setExercise(''); setWeight(''); setReps(''); setTimeStr('') }, 1500)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {suggestionSent && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm rounded-xl border border-amber-500/30 bg-card shadow-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Dumbbell className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Suggestion sent!</p>
              <p className="text-xs text-muted-foreground truncate">&ldquo;{suggestionSent}&rdquo; added to your coach&rsquo;s review queue.</p>
            </div>
          </div>
          <div className="h-1 bg-amber-500/20">
            <div className="h-full bg-amber-500 origin-left animate-shrink" />
          </div>
        </div>
      )}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Strength</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isIsometric ? 'Log a timed hold to track your progress.' : 'Enter any set to project your 1RM.'}
        </p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Exercise</label>
          <MovementSearch
            value={exercise}
            onChange={setExercise}
            onSuggest={handleSuggestMove}
            movements={STRENGTH_MOVEMENTS}
            placeholder="Search or type movement…"
          />
        </div>

        {/* ── Isometric: single duration input ── */}
        {isIsometric ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Duration</label>
              <input
                type="text"
                inputMode="numeric"
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
                <span className="font-mono text-base tabular-nums font-bold text-blue-400">
                  {fmtDuration(durSecs)}
                </span>
              </div>
            )}
          </>
        ) : (
          /* ── Rep-based: reps + weight + unit ── */
          <>
            <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '1fr 1.35fr 1fr' }}>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Reps</label>
                <input
                  type="number" value={reps}
                  onChange={e => setReps(e.target.value)}
                  min="1" max="30" className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                {isBodyweightExercise ? (
                  <div className="flex items-center gap-0.5">
                    <span className={labelCls}>Added weight</span>
                    <span className="text-blue-400 text-sm leading-none shrink-0">*</span>
                  </div>
                ) : (
                  <label className={labelCls}>Weight</label>
                )}
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
                  <option>lb</option>
                  <option>kg</option>
                </select>
              </div>
            </div>

            {liveOneRM && (
              <div className="flex items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs text-muted-foreground">Estimated 1RM</span>
                </div>
                <span className="font-mono text-base tabular-nums font-bold text-blue-400">
                  {liveOneRM} {unit}
                </span>
              </div>
            )}
          </>
        )}

        <button
          onClick={saveEffort}
          disabled={saved || (isIsometric ? !canSaveIso : (!liveOneRM && !(isBodyweightExercise && reps && r >= 1 && r <= 30)))}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 ${
            saved
              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
              : (isIsometric ? canSaveIso : (liveOneRM || (isBodyweightExercise && reps && r >= 1 && r <= 30)))
                ? 'bg-blue-500 text-white hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          {saved ? '✓ Saved' : 'Save Effort'}
        </button>

        {saveError && (
          <p className="text-xs text-destructive leading-snug">{saveError}</p>
        )}

        {isBodyweightExercise && !isIsometric && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="text-blue-400 font-semibold">*</span> Optional — this movement uses your latest logged bodyweight for calculations.
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
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">
                        {fmtDuration(mov.bestSecs)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Est. 1RM</span>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">
                        {mov.oneRM} {mov.unit}
                      </span>
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
