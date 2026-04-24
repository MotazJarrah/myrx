import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getEffortTags } from '../lib/effortTags'
import { Trash2, AlertTriangle, X, Dumbbell, Activity, Weight } from 'lucide-react'

function ConfirmDialog({ effort, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative w-full max-w-sm animate-rise rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Delete entry</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Remove <span className="font-medium text-foreground">{effort.label}</span> ({effort.value}) from your history? This can't be undone.
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

export default function History() {
  const { user } = useAuth()
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEfforts(data || [])
        setLoading(false)
      })
  }, [user])

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const { error } = await supabase
      .from('efforts')
      .delete()
      .eq('id', pendingDelete.id)
      .eq('user_id', user.id)
    if (!error) {
      setEfforts(prev => prev.filter(e => e.id !== pendingDelete.id))
    }
    setPendingDelete(null)
    setDeleting(false)
  }

  const filtered = filter === 'all' ? efforts : efforts.filter(e => e.type === filter)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Every effort you've logged.</p>
      </div>

      <div className="flex gap-2">
        {['all', 'strength', 'cardio'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors border ${
              filter === f
                ? 'bg-primary text-primary-foreground border-transparent font-semibold'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading your history…</div>
      ) : filtered.length === 0 ? (
        <div className="animate-rise rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No efforts logged yet.
        </div>
      ) : (
        <div className="animate-rise space-y-2">
          {filtered.map(e => {
            const { primary, secondary } = getEffortTags(e)
            return (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  e.type === 'strength' ? 'bg-blue-500/10 text-blue-400'
                  : e.type === 'cardio' ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-primary/10 text-primary'
                }`}>
                  {e.type === 'strength' ? <Dumbbell className="h-3.5 w-3.5" />
                    : e.type === 'cardio' ? <Activity className="h-3.5 w-3.5" />
                    : <Weight className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.label}</p>
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
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setPendingDelete(e)}
                  className="shrink-0 ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label={`Delete ${e.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirmation dialog */}
      {pendingDelete && (
        <ConfirmDialog
          effort={pendingDelete}
          onConfirm={handleDelete}
          onCancel={() => !deleting && setPendingDelete(null)}
        />
      )}
    </div>
  )
}
