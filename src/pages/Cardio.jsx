import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { CARDIO_MOVEMENTS, getCardioMode } from '../lib/movements'
import MovementSearch from '../components/MovementSearch'
import { Activity, Timer, ChevronRight, Check } from 'lucide-react'


// ── Time helpers ──────────────────────────────────────────────────────────────

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs) {
  if (!totalSecs) return '0:00'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Auto-format typed digits as mm:ss or h:mm:ss (right-anchored)
function applyTimeMask(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${digits.slice(-2)}`
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`
}

// Parse stored pace value "4:54/km" → seconds per km (null if unrecognised)
function parsePaceToSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

export default function Cardio() {
  const { user, profile } = useAuth()
  const isAdmin = !!profile?.is_superuser
  const [, navigate] = useLocation()
  const [activity, setActivity]   = useState('')
  const [distValue, setDistValue] = useState('')
  const [distUnit, setDistUnit]   = useState(profile?.distance_unit || 'km')
  // Profile loads async — re-sync default distance unit once available
  useEffect(() => { if (profile?.distance_unit) setDistUnit(profile.distance_unit) }, [profile?.distance_unit])
  const [timeStr, setTimeStr]     = useState('')
  const [saved, setSaved]               = useState(false)
  const [suggestSent, setSuggestSent]   = useState(false)
  const [suggesting, setSuggesting]     = useState(false)
  const suggestingRef = useRef(false)
  const [saveError, setSaveError]       = useState('')
  const [activities, setActivities]     = useState([])
  const [pendingQuery, setPendingQuery] = useState('')
  const [movementKey, setMovementKey]   = useState(0)

  const mode = activity ? getCardioMode(activity) : 'pace'

  // Reset fields when switching between pace/duration modes
  useEffect(() => {
    setDistValue(''); setTimeStr('')
  }, [mode])

  // Clear saved/error on any input change
  useEffect(() => {
    setSaved(false); setSaveError('')
  }, [activity, distValue, distUnit, timeStr])

  const suggestionMode = !activity
    && pendingQuery.trim() !== ''
    && !CARDIO_MOVEMENTS.some(m => m.toLowerCase() === pendingQuery.trim().toLowerCase())

  async function handleSuggestMove(name) {
    if (!user || suggestingRef.current || suggestSent) return
    const n = (name || pendingQuery).trim()
    if (!n) return
    suggestingRef.current = true
    setSuggesting(true)
    const { error } = await supabase.from('messages').insert({
      user_id: user.id, from_admin: false,
      body: `New cardio move suggestion: ${n}`,
      is_suggestion: true, read: false,
    })
    suggestingRef.current = false
    setSuggesting(false)
    if (!error) {
      setSuggestSent(true)
      setPendingQuery('')
      setMovementKey(k => k + 1)
      setActivity(''); setDistValue(''); setTimeStr('')
      setTimeout(() => setSuggestSent(false), 2000)
    }
  }

  // Load "Your activities"
  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('label, value')
      .eq('user_id', user.id)
      .eq('type', 'cardio')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map()
        data.forEach(e => {
          const name    = e.label.split(' · ')[0]
          const actMode = getCardioMode(name)
          if (actMode === 'pace') {
            const secs = parsePaceToSecs(e.value)
            if (secs === null) return
            const existing = map.get(name)
            if (!existing || secs < existing.secs) {
              map.set(name, { name, displayValue: e.value, secs, mode: 'pace' })
            }
          } else {
            const secs = parseTimeStr(e.value)
            if (!secs) return
            const existing = map.get(name)
            if (!existing || secs > existing.secs) {
              map.set(name, { name, displayValue: e.value, secs, mode: 'duration' })
            }
          }
        })
        setActivities([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
  }, [user, saved])

  // ── Derived state ─────────────────────────────────────────────────────────
  const distKm = distUnit === 'mi'
    ? (Number(distValue) || 0) * 1.60934
    : (Number(distValue) || 0)

  const timeSecs = parseTimeStr(timeStr)

  // Internal pace always stored as /km (canonical). Display converts for miles users.
  const livePaceKm = (() => {
    if (mode !== 'pace' || distKm <= 0 || !timeSecs) return null
    const paceSecPerKm = timeSecs / distKm
    const m = Math.floor(paceSecPerKm / 60)
    const s = Math.round(paceSecPerKm % 60)
    return `${m}:${String(s).padStart(2, '0')}/km`
  })()

  const livePaceDisplay = (() => {
    if (!livePaceKm || distUnit !== 'mi') return livePaceKm
    const paceSecPerMi = (timeSecs / distKm) * 1.60934
    const m = Math.floor(paceSecPerMi / 60)
    const s = Math.round(paceSecPerMi % 60)
    return `${m}:${String(s).padStart(2, '0')}/mi`
  })()

  const canSave = mode === 'pace' ? (distKm > 0 && timeSecs > 0) : timeSecs > 0

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveEffort() {
    if (!user || saved || !canSave) return
    setSaveError('')

    const label = mode === 'pace'
      ? `${activity} · ${parseFloat(Number(distValue).toFixed(3))} ${distUnit} in ${timeStr}`
      : `${activity} · ${timeStr}`
    const value = mode === 'pace' ? livePaceKm : timeStr

    const { error } = await supabase.from('efforts').insert({
      user_id: user.id,
      type:    'cardio',
      label,
      value,
    })
    if (error) { setSaveError('Failed to save. Try again.'); return }
    setSaved(true)
    setTimeout(() => { setActivity(''); setDistValue(''); setTimeStr('') }, 1500)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Cardio</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {mode === 'duration'
            ? 'Log your session time to track progress.'
            : 'Log distance and time to track your pace.'}
        </p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        {/* Activity search */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Activity</label>
          <MovementSearch
            key={movementKey}
            value={activity}
            onChange={setActivity}
            onSuggest={isAdmin ? undefined : handleSuggestMove}
            onQueryChange={isAdmin ? undefined : setPendingQuery}
            movements={CARDIO_MOVEMENTS}
            placeholder="Search or type activity…"
          />
        </div>

        {/* ── Duration-only mode ── */}
        {mode === 'duration' ? (
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

            {timeSecs > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Timer className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Session time</span>
                </div>
                <span className="font-mono text-base tabular-nums font-bold text-amber-400">
                  {fmtSecs(timeSecs)}
                </span>
              </div>
            )}
          </>
        ) : (
          /* ── Pace mode: distance + time + unit ── */
          <>
            <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '1fr 0.9fr 1.35fr' }}>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Distance</label>
                <input
                  type="number"
                  value={distValue}
                  onChange={e => setDistValue(e.target.value)}
                  step="0.01"
                  placeholder="0"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Unit</label>
                <select value={distUnit} onChange={e => setDistUnit(e.target.value)} className={inputCls}>
                  <option value="km">km</option>
                  <option value="mi">mi</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Time</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={timeStr}
                  onChange={e => setTimeStr(applyTimeMask(e.target.value))}
                  placeholder="mm:ss"
                  className={inputCls}
                />
              </div>
            </div>

            {livePaceDisplay && (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Pace</span>
                </div>
                <span className="font-mono text-base tabular-nums font-bold text-amber-400">
                  {livePaceDisplay}
                </span>
              </div>
            )}
          </>
        )}

        <button
          onClick={suggestionMode ? () => handleSuggestMove(pendingQuery) : saveEffort}
          disabled={suggestionMode ? (suggesting || suggestSent) : (saved || !canSave)}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 ${
            suggestionMode
              ? suggestSent
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : suggesting
                  ? 'bg-amber-500/60 text-white cursor-wait'
                  : 'bg-amber-500 text-white hover:opacity-90'
              : saved
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : canSave
                  ? 'bg-amber-500 text-white hover:opacity-90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          {suggestionMode
            ? suggestSent ? '✓ Suggestion Sent' : suggesting ? 'Sending…' : 'Send Suggestion'
            : saved ? '✓ Saved' : 'Save Effort'}
        </button>

        {suggestSent && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Check className="h-3.5 w-3.5 shrink-0" /> Suggestion sent to your coach.
          </div>
        )}

        {saveError && (
          <p className="text-xs text-destructive leading-snug">{saveError}</p>
        )}
      </div>

      {/* Your activities */}
      {activities.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Your activities</h2>
          </div>
          <div className="divide-y divide-border">
            {activities.map(act => (
              <button
                key={act.name}
                onClick={() => navigate(`/effort/cardio/${encodeURIComponent(act.name)}`)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/50 transition-colors text-left"
              >
                <span className="text-sm font-medium">{act.name}</span>
                <div className="flex items-center gap-2">
                  {act.mode === 'duration' ? (
                    <>
                      <span className="text-xs text-muted-foreground">Best time</span>
                      <span className="font-mono text-sm tabular-nums text-amber-400 font-semibold">
                        {fmtSecs(act.secs)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Best pace</span>
                      <span className="font-mono text-sm tabular-nums text-amber-400 font-semibold">
                        {distUnit === 'mi'
                          ? (() => {
                              const m = act.displayValue?.match(/^(\d+):(\d{2})\//)
                              if (!m) return act.displayValue
                              const spm = (parseInt(m[1]) * 60 + parseInt(m[2])) * 1.60934
                              return `${Math.floor(spm / 60)}:${String(Math.round(spm % 60)).padStart(2, '0')}/mi`
                            })()
                          : act.displayValue}
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
