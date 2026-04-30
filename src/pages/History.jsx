import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getEffortTags, TAG_STYLES } from '../lib/effortTags'
import { Dumbbell, Activity, Weight, Flower2, Flame } from 'lucide-react'
import SwipeDelete from '../components/SwipeDelete'

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function History() {
  const { user } = useAuth()
  const [efforts, setEfforts]         = useState([])
  const [romRecords, setRomRecords]   = useState([])
  const [bwLogs, setBwLogs]           = useState([])
  const [calorieLogs, setCalorieLogs] = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')

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

  async function handleDelete(item) {
    const table = item._kind === 'rom'     ? 'rom_records'
                : item._kind === 'weighin' ? 'bodyweight'
                : item._kind === 'calorie' ? 'calorie_logs'
                : 'efforts'
    if (item._kind === 'rom')      setRomRecords(prev => prev.filter(r => r.id !== item.id))
    else if (item._kind === 'weighin')  setBwLogs(prev => prev.filter(b => b.id !== item.id))
    else if (item._kind === 'calorie')  setCalorieLogs(prev => prev.filter(c => c.id !== item.id))
    else setEfforts(prev => prev.filter(e => e.id !== item.id))
    await supabase.from(table).delete().eq('id', item.id).eq('user_id', user.id)
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
                <SwipeDelete key={`bw-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border">
                  <div className="flex items-center gap-3 bg-card px-4 py-3">
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
                  </div>
                </SwipeDelete>
              )
            }

            // ── ROM tile ───────────────────────────────────────────────────
            if (item._kind === 'rom') {
              const meta = ROM_META[item.movement_key]
              return (
                <SwipeDelete key={`rom-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border">
                  <div className="flex items-center gap-3 bg-card px-4 py-3">
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
                  </div>
                </SwipeDelete>
              )
            }

            // ── Calorie tile ───────────────────────────────────────────────
            if (item._kind === 'calorie') {
              return (
                <SwipeDelete key={`cal-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border">
                  <div className="flex items-center gap-3 bg-card px-4 py-3">
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
                  </div>
                </SwipeDelete>
              )
            }

            // ── Effort tile ────────────────────────────────────────────────
            const { primary, secondary } = getEffortTags(item)
            return (
              <SwipeDelete key={item.id} onDelete={() => handleDelete(item)} className="rounded-xl border border-border">
                <div className="flex items-center gap-3 bg-card px-4 py-3">
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
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      )}
    </div>
  )
}
