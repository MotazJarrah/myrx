import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { MOBILITY_MOVEMENTS } from '../lib/movements'
import MovementSearch from '../components/MovementSearch'
import { Plus, Trash2, ChevronRight, Timer } from 'lucide-react'

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

function applyTimeMask(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${digits.slice(-2)}`
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

export default function Mobility() {
  const { user } = useAuth()
  const [, navigate] = useLocation()

  // Session builder state
  const [selectedMovement, setSelectedMovement] = useState('')
  const [movementTime, setMovementTime] = useState('')
  const [sessionItems, setSessionItems] = useState([]) // [{ name, timeStr, secs }]

  // Save state
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Previous sessions + my movements
  const [recentSessions, setRecentSessions] = useState([])
  const [myMovements, setMyMovements] = useState([])

  const totalSecs = sessionItems.reduce((sum, item) => sum + item.secs, 0)
  const canAdd = selectedMovement && parseTimeStr(movementTime) > 0
  const canSave = sessionItems.length > 0

  // Clear save state on session change
  useEffect(() => {
    setSaved(false)
    setSaveError('')
  }, [sessionItems])

  // Load history
  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('id, label, value, created_at')
      .eq('user_id', user.id)
      .eq('type', 'mobility')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return

        // Recent sessions (last 10)
        setRecentSessions(data.slice(0, 10))

        // Best time per movement
        const map = new Map()
        data.forEach(entry => {
          const movementsStr = entry.label.replace(/^Mobility Session\s*·\s*/i, '')
          movementsStr.split(',').forEach(chunk => {
            const trimmed = chunk.trim()
            const lastSpace = trimmed.lastIndexOf(' ')
            if (lastSpace === -1) return
            const name = trimmed.slice(0, lastSpace).trim()
            const timeStr = trimmed.slice(lastSpace + 1).trim()
            const secs = parseTimeStr(timeStr)
            if (!secs || !name) return
            const existing = map.get(name)
            if (!existing || secs > existing.secs) {
              map.set(name, { name, secs, displayTime: fmtSecs(secs) })
            }
          })
        })
        setMyMovements([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
  }, [user, saved])

  function addToSession() {
    const secs = parseTimeStr(movementTime)
    if (!selectedMovement || !secs) return
    setSessionItems(prev => [...prev, { name: selectedMovement, timeStr: movementTime, secs }])
    setSelectedMovement('')
    setMovementTime('')
  }

  function removeFromSession(index) {
    setSessionItems(prev => prev.filter((_, i) => i !== index))
  }

  async function saveSession() {
    if (!user || saved || !canSave) return
    setSaveError('')

    // "Mobility Session · Bear Crawl 1:30, Downward Dog 2:00, ..."
    const movementsStr = sessionItems.map(item => `${item.name} ${item.timeStr}`).join(', ')
    const label = `Mobility Session · ${movementsStr}`
    const value = fmtSecs(totalSecs)

    const { error } = await supabase.from('efforts').insert({
      user_id: user.id,
      type: 'mobility',
      label,
      value,
    })
    if (error) { setSaveError('Failed to save. Try again.'); return }
    setSaved(true)
    setSessionItems([])
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mobility</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Build a session — add movements and set a time for each.
        </p>
      </div>

      {/* Session builder */}
      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">

        {/* Add movement row */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Movement</label>
            <MovementSearch
              value={selectedMovement}
              onChange={setSelectedMovement}
              movements={MOBILITY_MOVEMENTS}
              placeholder="Search or type movement…"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Duration</label>
              <input
                type="text"
                inputMode="numeric"
                value={movementTime}
                onChange={e => setMovementTime(applyTimeMask(e.target.value))}
                placeholder="mm:ss"
                className={inputCls}
              />
            </div>
            <button
              onClick={addToSession}
              disabled={!canAdd}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
                canAdd
                  ? 'bg-fuchsia-500/15 text-fuchsia-400 hover:bg-fuchsia-500/25 border border-fuchsia-500/30'
                  : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
              }`}
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
        </div>

        {/* Session item list */}
        {sessionItems.length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border">
            {sessionItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-medium">{item.name}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums text-fuchsia-400 font-semibold">
                    {item.timeStr}
                  </span>
                  <button
                    onClick={() => removeFromSession(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total time banner */}
        {totalSecs > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/8 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-fuchsia-400" />
              <span className="text-xs text-muted-foreground">Total session time</span>
            </div>
            <span className="font-mono text-base tabular-nums font-bold text-fuchsia-400">
              {fmtSecs(totalSecs)}
            </span>
          </div>
        )}

        <button
          onClick={saveSession}
          disabled={saved || !canSave}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 ${
            saved
              ? 'bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30'
              : canSave
                ? 'bg-fuchsia-500 text-white hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          {saved ? '✓ Session Saved' : 'Save Session'}
        </button>

        {saveError && (
          <p className="text-xs text-destructive leading-snug">{saveError}</p>
        )}
      </div>

      {/* My movements */}
      {myMovements.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">My movements</h2>
          </div>
          <div className="divide-y divide-border">
            {myMovements.map(mov => (
              <button
                key={mov.name}
                onClick={() => navigate(`/mobility/${encodeURIComponent(mov.name)}`)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/50 transition-colors text-left"
              >
                <span className="text-sm font-medium">{mov.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Best</span>
                  <span className="font-mono text-sm tabular-nums text-fuchsia-400 font-semibold">
                    {mov.displayTime}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Recent sessions</h2>
          </div>
          <div className="divide-y divide-border">
            {recentSessions.map(session => {
              const movementsStr = session.label.replace(/^Mobility Session\s*·\s*/i, '')
              const date = new Date(session.created_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric',
              })
              return (
                <div key={session.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{date}</span>
                    <span className="font-mono text-sm tabular-nums text-fuchsia-400 font-semibold">
                      {session.value}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {movementsStr}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
