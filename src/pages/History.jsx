import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getEffortTags, TAG_STYLES } from '../lib/effortTags'
import { Trash2, AlertTriangle, X, Dumbbell, Activity, Weight, Flower2, Flame } from 'lucide-react'

// ── ROM metadata ──────────────────────────────────────────────────────────────

const ROM_META = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   group: 'Shoulder' },
  'shoulder-extension': { label: 'Shoulder Extension', group: 'Shoulder' },
  'shoulder-abduction': { label: 'Shoulder Abduction', group: 'Shoulder' },
  'hip-flexion':        { label: 'Hip Flexion',         group: 'Hip'      },
  'hip-abduction':      { label: 'Hip Abduction',       group: 'Hip'      },
  'knee-flexion':       { label: 'Knee Flexion',        group: 'Knee'     },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', group: 'Ankle'    },
  'spinal-flexion':     { label: 'Spinal Flexion',      group: 'Spine'    },
}

const FILTER_LABELS = {
  all:      'All',
  strength: 'Strength',
  cardio:   'Cardio',
  mobility: 'Mobility',
  weighin:  'Weigh-in',
  calories: 'Calories',
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ item, onConfirm, onCancel }) {
  const isROM     = item._kind === 'rom'
  const isWeighin = item._kind === 'weighin'
  const isCalorie = item._kind === 'calorie'
  const name = isROM
    ? `${ROM_META[item.movement_key]?.label ?? item.movement_key} · ${item.degrees}°`
    : isWeighin
      ? `Weigh-in · ${item.weight} ${item.unit}`
      : isCalorie
        ? `Intake · ${item.calories} kcal on ${item.log_date}`
        : item.label

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm animate-rise rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Delete entry</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Remove <span className="font-medium text-foreground">{name}</span> from your history? This can't be undone.
            </p>
          </div>
          <button onClick={onCancel} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function History() {
  const { user } = useAuth()
  const [efforts, setEfforts]         = useState([])
  const [romRecords, setRomRecords]   = useState([])
  const [bwLogs, setBwLogs]           = useState([])
  const [calorieLogs, setCalorieLogs] = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting]       = useState(false)

  useEffect(() => {
    if (!user) return
    let done = 0
    const finish = () => { if (++done === 4) setLoading(false) }

    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setEfforts(data || []); finish() })

    supabase
      .from('rom_records')
      .select('id, movement_key, degrees, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRomRecords(data || []); finish() })

    supabase
      .from('bodyweight')
      .select('id, weight, unit, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setBwLogs(data || []); finish() })

    supabase
      .from('calorie_logs')
      .select('id, log_date, calories, updated_at')
      .eq('user_id', user.id)
      .order('log_date', { ascending: false })
      .then(({ data }) => {
        // Synthesise a created_at from log_date so merge sort works uniformly
        setCalorieLogs((data || []).map(r => ({
          ...r,
          created_at: r.log_date + 'T12:00:00',
        })))
        finish()
      })
  }, [user])

  // Derive which filter tabs to show based on what data exists
  const availableFilters = useMemo(() => {
    const filters = ['all']
    if (efforts.some(e => e.type === 'strength')) filters.push('strength')
    if (efforts.some(e => e.type === 'cardio'))   filters.push('cardio')
    if (efforts.some(e => e.type === 'mobility') || romRecords.length > 0) filters.push('mobility')
    if (bwLogs.length > 0)      filters.push('weighin')
    if (calorieLogs.length > 0) filters.push('calories')
    return filters
  }, [efforts, romRecords, bwLogs, calorieLogs])

  // Reset to 'all' if current filter no longer has items
  useEffect(() => {
    if (filter !== 'all' && !availableFilters.includes(filter)) setFilter('all')
  }, [availableFilters, filter])

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const table = pendingDelete._kind === 'rom'     ? 'rom_records'
                : pendingDelete._kind === 'weighin' ? 'bodyweight'
                : pendingDelete._kind === 'calorie' ? 'calorie_logs'
                : 'efforts'
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', pendingDelete.id)
      .eq('user_id', user.id)
    if (!error) {
      if (pendingDelete._kind === 'rom')      setRomRecords(prev => prev.filter(r => r.id !== pendingDelete.id))
      else if (pendingDelete._kind === 'weighin')  setBwLogs(prev => prev.filter(b => b.id !== pendingDelete.id))
      else if (pendingDelete._kind === 'calorie')  setCalorieLogs(prev => prev.filter(c => c.id !== pendingDelete.id))
      else setEfforts(prev => prev.filter(e => e.id !== pendingDelete.id))
    }
    setPendingDelete(null)
    setDeleting(false)
  }

  // Merge + sort all items
  const allItems = useMemo(() => [
    ...efforts.map(e => ({ ...e, _kind: 'effort' })),
    ...romRecords.map(r => ({ ...r, _kind: 'rom' })),
    ...bwLogs.map(b => ({ ...b, _kind: 'weighin' })),
    ...calorieLogs.map(c => ({ ...c, _kind: 'calorie' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [efforts, romRecords, bwLogs, calorieLogs])

  const filtered = useMemo(() => {
    if (filter === 'all')      return allItems
    if (filter === 'mobility') return allItems.filter(i => i._kind === 'rom' || (i._kind === 'effort' && i.type === 'mobility'))
    if (filter === 'weighin')  return allItems.filter(i => i._kind === 'weighin')
    if (filter === 'calories') return allItems.filter(i => i._kind === 'calorie')
    return allItems.filter(i => i._kind === 'effort' && i.type === filter)
  }, [allItems, filter])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Every effort, ROM session, and weigh-in you've logged.</p>
      </div>

      {/* Filter tabs — only show categories that have data */}
      {!loading && availableFilters.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {availableFilters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors border ${
                filter === f
                  ? 'bg-primary text-primary-foreground border-transparent font-semibold'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {FILTER_LABELS[f] ?? f}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading your history…</div>
      ) : filtered.length === 0 ? (
        <div className="animate-rise rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No entries logged yet.
        </div>
      ) : (
        <div className="animate-rise space-y-2">
          {filtered.map(item => {
            // ── Weigh-in tile ──────────────────────────────────────────────
            if (item._kind === 'weighin') {
              return (
                <div key={`bw-${item.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <Weight className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Weigh-in · {item.weight} {item.unit}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.weighin}`}>
                        Bodyweight
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES['Weigh-in']}`}>
                        Weigh-in
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingDelete(item)}
                    className="shrink-0 ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    aria-label="Delete weigh-in entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            }

            // ── ROM tile ───────────────────────────────────────────────────
            if (item._kind === 'rom') {
              const meta = ROM_META[item.movement_key]
              return (
                <div key={`rom-${item.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
                    <Flower2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {meta?.label ?? item.movement_key} · {item.degrees}° ROM
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.mobility}`}>
                        Mobility
                      </span>
                      {meta?.group && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES[meta.group] ?? TAG_STYLES.Movement}`}>
                          {meta.group}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingDelete(item)}
                    className="shrink-0 ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    aria-label="Delete ROM entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            }

            // ── Calorie tile ───────────────────────────────────────────────
            if (item._kind === 'calorie') {
              return (
                <div key={`cal-${item.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                    <Flame className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Intake · {item.calories} kcal</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.calories}`}>
                        Calories
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES['Intake']}`}>
                        Intake
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(item.log_date + 'T12:00:00').toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingDelete(item)}
                    className="shrink-0 ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    aria-label="Delete calorie log"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            }

            // ── Effort tile ────────────────────────────────────────────────
            const { primary, secondary } = getEffortTags(item)
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  item.type === 'strength' ? 'bg-blue-500/10 text-blue-400'
                  : item.type === 'cardio' ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-primary/10 text-primary'
                }`}>
                  {item.type === 'strength' ? <Dumbbell className="h-3.5 w-3.5" />
                    : item.type === 'cardio' ? <Activity className="h-3.5 w-3.5" />
                    : <Weight className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${primary.cls}`}>
                      {primary.label}
                    </span>
                    {secondary && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${secondary.cls}`}>
                        {secondary.label}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setPendingDelete(item)}
                  className="shrink-0 ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label={`Delete ${item.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          item={pendingDelete}
          onConfirm={handleDelete}
          onCancel={() => !deleting && setPendingDelete(null)}
        />
      )}
    </div>
  )
}
