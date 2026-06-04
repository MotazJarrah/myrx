import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../../lib/supabase'
import { Dumbbell, Activity, ChevronRight } from 'lucide-react'

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

// ── Move card ─────────────────────────────────────────────────────────────────

function MoveCard({ label, type, count, stat, onClick }) {
  const meta = {
    strength: { icon: Dumbbell, cls: 'bg-blue-500/10 text-blue-400',       chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20'       },
    cardio:   { icon: Activity, cls: 'bg-amber-500/10 text-amber-400',     chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20'     },
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

export default function AdminUserActivity({ userId }) {
  const [, navigate] = useLocation()
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [view,    setView]    = useState('strength')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const efRes = await supabase.from('efforts')
        .select('id, label, value, type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      setEfforts(efRes.data || [])
      setLoading(false)
    }
    load()
  }, [userId])

  // ── Group by exercise name ────────────────────────────────────────────────
  const { strengthMoves, cardioMoves } = useMemo(() => {
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
        if (!cardioMap[name]) cardioMap[name] = { count: 0, bestVal: null, bestStr: null }
        cardioMap[name].count++
        // Direction-aware best across ALL cardio formats (pace, speed, cal/min,
        // floors/min, distance) — not just "/km" pace.
        const parsed = parseCardioBest(e.value)
        if (parsed) {
          const c = cardioMap[name]
          const better = c.bestVal === null
            || (parsed.lowerBetter ? parsed.val < c.bestVal : parsed.val > c.bestVal)
          if (better) {
            c.bestVal = parsed.val
            c.bestStr = e.value
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
        stat:  d.bestStr
          ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'} · Best ${d.bestStr}`
          : `${d.count} ${d.count === 1 ? 'entry' : 'entries'}`,
      }))
      .sort((a, b) => b.count - a.count)

    return { strengthMoves, cardioMoves }
  }, [efforts])

  const visibleMoves = view === 'cardio' ? cardioMoves : strengthMoves

  function handleMoveClick(move) {
    navigate(`/admin/user/${userId}/effort/${move.type}/${encodeURIComponent(move.label)}`)
  }

  return (
    <div className="space-y-4">

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

      {/* Move cards for the selected type */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visibleMoves.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {view === 'cardio' ? 'No cardio logged yet' : 'No strength logged yet'}
        </div>
      ) : (
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
    </div>
  )
}
