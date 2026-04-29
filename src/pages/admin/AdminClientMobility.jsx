/**
 * AdminClientMobility
 * Embedded (non-page) component — shows the full Mobility experience for a client.
 * Mirrors src/pages/Mobility.jsx exactly, using `userId` prop instead of auth user.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import ROMVisualizer, { MOVEMENT_CONFIG } from '../../components/ROMVisualizer'
import { ChevronDown, ChevronUp, Trash2, Loader2 } from 'lucide-react'

// ── Movement list ─────────────────────────────────────────────────────────────

const MOVEMENTS = [
  { key: 'shoulder-flexion',    group: 'Shoulder' },
  { key: 'shoulder-extension',  group: 'Shoulder' },
  { key: 'shoulder-abduction',  group: 'Shoulder' },
  { key: 'hip-flexion',         group: 'Hip' },
  { key: 'hip-abduction',       group: 'Hip' },
  { key: 'knee-flexion',        group: 'Knee' },
  { key: 'ankle-dorsiflexion',  group: 'Ankle' },
  { key: 'spinal-flexion',      group: 'Spine' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateLabel(isoStr) {
  return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── ROM chip ──────────────────────────────────────────────────────────────────

function ROMChip({ degrees }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40">
      {degrees}° current
    </span>
  )
}

// ── ROM Snapshot grid ─────────────────────────────────────────────────────────

function ROMSnapshot({ records, onTileClick }) {
  const trackedCount = MOVEMENTS.filter(m => records[m.key]?.length > 0).length

  return (
    <div className="animate-rise rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-fuchsia-300 uppercase tracking-wide">ROM Snapshot</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {trackedCount}/{MOVEMENTS.length} movements logged
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {MOVEMENTS.map(m => {
          const recs        = records[m.key]
          // Always show most-recent value — ROM fluctuates, not a PR metric.
          // Explicit sort so order is guaranteed regardless of fetch/insert sequence.
          const sorted = recs?.length > 0
            ? [...recs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            : []
          const best        = sorted.length > 0 ? sorted[0].degrees : null
          const clinicalMax = MOVEMENT_CONFIG[m.key].normalRange[1]
          const athleticMax = MOVEMENT_CONFIG[m.key].athleticRange[1]
          const hasData     = best !== null
          const isAthletic  = hasData && best > clinicalMax

          const barWidth = hasData ? Math.min(100, Math.round((best / clinicalMax) * 100)) : 0

          const t = isAthletic
            ? Math.min(1, (best - clinicalMax) / (athleticMax - clinicalMax))
            : 0
          const barColor = hasData
            ? `rgb(${Math.round(232 + 13 * t)},${Math.round(121 + 37 * t)},${Math.round(249 - 238 * t)})`
            : 'transparent'

          const degreeColor = isAthletic
            ? `rgb(${Math.round(232 + 13 * t)},${Math.round(121 + 37 * t)},${Math.round(249 - 238 * t)})`
            : '#E879F9'

          const clinicalPct = hasData ? Math.min(100, Math.round((best / clinicalMax) * 100)) : 0
          const lastDate = sorted.length > 0 ? dateLabel(sorted[0].created_at) : null

          return (
            <button
              key={m.key}
              type="button"
              onClick={() => hasData && onTileClick?.(m.key)}
              className={`rounded-lg px-3 py-2.5 text-left transition-colors ${
                hasData
                  ? 'bg-card border border-border hover:bg-accent/40 cursor-pointer'
                  : 'bg-muted/10 border border-transparent cursor-default'
              }`}
            >
              <div className="flex items-start justify-between gap-1 min-w-0">
                <p className={`text-[11px] leading-snug font-medium truncate ${
                  hasData ? 'text-foreground' : 'text-muted-foreground/40'
                }`}>
                  {MOVEMENT_CONFIG[m.key].label}
                </p>
                {hasData && (
                  <span
                    className="font-mono text-sm font-bold tabular-nums shrink-0 ml-1"
                    style={{ color: degreeColor }}
                  >
                    {best}°
                  </span>
                )}
              </div>

              {hasData ? (
                <div className="mt-2 space-y-1">
                  <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground">
                      {isAthletic ? 'Athletic ROM' : `${clinicalPct}% of normal`}
                    </p>
                    {lastDate && (
                      <p className="text-[10px] text-muted-foreground/60">{lastDate}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-muted-foreground/35">Not logged yet</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Movement card ─────────────────────────────────────────────────────────────

function MovementCard({ movementKey, records, onSave, onDelete, forceOpen }) {
  const config         = MOVEMENT_CONFIG[movementKey]
  const cardRef        = useRef(null)
  const initializedRef = useRef(false)
  const [expanded,   setExpanded]  = useState(false)
  const [degrees,    setDegrees]   = useState(0)
  const [saving,     setSaving]    = useState(false)
  const [justSaved,  setJustSaved] = useState(false)
  const [confirmId,  setConfirmId] = useState(null)
  const [deleting,   setDeleting]  = useState(false)

  // Sort records by date descending — always explicit, never rely on fetch/insert order
  const sortedRecords = [...records].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  // Pre-fill slider with the most recent recorded value (once)
  useEffect(() => {
    if (!initializedRef.current && sortedRecords.length > 0) {
      initializedRef.current = true
      setDegrees(sortedRecords[0].degrees)
    }
  }, [records])

  // When parent triggers forceOpen, expand and scroll
  useEffect(() => {
    if (forceOpen) {
      setExpanded(true)
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [forceOpen])

  // Last ROM = most recent record (explicit sort applied above)
  const lastROM = sortedRecords.length > 0 ? sortedRecords[0].degrees : null

  const handleSave = useCallback(async () => {
    if (!degrees || saving) return
    setSaving(true)
    const ok = await onSave(movementKey, degrees)
    setSaving(false)
    if (ok) {
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    }
  }, [degrees, movementKey, onSave, saving])

  async function handleDeleteRecord(id) {
    setDeleting(true)
    const ok = await onDelete(movementKey, id)
    setDeleting(false)
    if (ok) setConfirmId(null)
  }

  // Last 5 records (already sorted above)
  const recent = sortedRecords.slice(0, 5)

  return (
    <div ref={cardRef} className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{config.label}</p>
            <p className="text-xs text-muted-foreground truncate">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          {lastROM !== null && <ROMChip degrees={lastROM} />}
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-5">
          <ROMVisualizer
            movementKey={movementKey}
            degrees={degrees}
            onChange={setDegrees}
          />

          <button
            onClick={handleSave}
            disabled={degrees === 0 || saving || justSaved}
            className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 ${
              justSaved
                ? 'bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30'
                : degrees > 0
                  ? 'bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30 hover:bg-fuchsia-500/25'
                  : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
          >
            {justSaved ? '✓ Saved' : saving ? 'Saving…' : degrees > 0 ? `Log ${degrees}°` : 'Move slider to log'}
          </button>

          {recent.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Recent sessions</p>
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {recent.map((r, i) => {
                  const isLatest = i === 0
                  return (
                    <div key={r.id ?? i} className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">{dateLabel(r.created_at)}</span>
                      <div className="flex items-center gap-2 ml-auto">
                        <span className={`font-mono text-sm font-semibold tabular-nums ${isLatest ? 'text-fuchsia-400' : 'text-foreground'}`}>
                          {r.degrees}°{isLatest && <span className="ml-1 text-[10px] text-fuchsia-400/70">latest</span>}
                        </span>
                        {confirmId === r.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-destructive">Delete?</span>
                            <button
                              onClick={() => handleDeleteRecord(r.id)}
                              disabled={deleting}
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            >
                              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:bg-accent transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(r.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminClientMobility({ userId, onSaved }) {
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState(null)

  useEffect(() => {
    if (!userId) return
    supabase
      .from('rom_records')
      .select('id, movement_key, degrees, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!data || error) { setLoading(false); return }
        const grouped = {}
        data.forEach(row => {
          if (!grouped[row.movement_key]) grouped[row.movement_key] = []
          grouped[row.movement_key].push(row)
        })
        setRecords(grouped)
        setLoading(false)
      })
  }, [userId])

  const handleSave = useCallback(async (movementKey, degrees) => {
    if (!userId) return false
    const { data, error } = await supabase
      .from('rom_records')
      .insert({ user_id: userId, movement_key: movementKey, degrees })
      .select()
      .single()
    if (error || !data) return false
    setRecords(prev => ({
      ...prev,
      [movementKey]: [data, ...(prev[movementKey] ?? [])],
    }))
    onSaved?.()
    return true
  }, [userId, onSaved])

  const handleDelete = useCallback(async (movementKey, id) => {
    const { error } = await supabase
      .from('rom_records')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) return false
    setRecords(prev => ({
      ...prev,
      [movementKey]: (prev[movementKey] ?? []).filter(r => r.id !== id),
    }))
    onSaved?.()
    return true
  }, [userId, onSaved])

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading mobility…</div>
  }

  return (
    <div className="space-y-3 animate-rise">
      {MOVEMENTS.filter(m => records[m.key]?.length > 0).map(m => (
        <MovementCard
          key={m.key}
          movementKey={m.key}
          records={records[m.key]}
          onSave={handleSave}
          onDelete={handleDelete}
          forceOpen={openKey === m.key}
        />
      ))}
    </div>
  )
}
