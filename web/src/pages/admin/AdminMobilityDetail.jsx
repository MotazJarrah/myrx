/**
 * Admin ROM / mobility detail
 * Route: /admin/user/:userId/effort/mobility/:movement
 */
import { useState, useEffect } from 'react'
import { useParams, useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const ROM_META = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   normal: 180, athletic: 190 },
  'shoulder-extension': { label: 'Shoulder Extension', normal: 60,  athletic: 75  },
  'shoulder-abduction': { label: 'Shoulder Abduction', normal: 180, athletic: 190 },
  'hip-flexion':        { label: 'Hip Flexion',        normal: 120, athletic: 135 },
  'hip-abduction':      { label: 'Hip Abduction',      normal: 45,  athletic: 60  },
  'knee-flexion':       { label: 'Knee Flexion',       normal: 135, athletic: 150 },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', normal: 20,  athletic: 30  },
  'spinal-flexion':     { label: 'Spinal Flexion',     normal: 90,  athletic: 110 },
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ConfirmDelete({ onConfirm, onCancel, busy }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-destructive">Delete?</span>
      <button onClick={onConfirm} disabled={busy}
        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
      </button>
      <button onClick={onCancel} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:bg-accent">
        No
      </button>
    </div>
  )
}

export default function AdminMobilityDetail() {
  const { userId, movement } = useParams()
  const [, navigate] = useLocation()
  const movKey = decodeURIComponent(movement || '')
  const meta   = ROM_META[movKey] ?? { label: movKey, normal: 180, athletic: 190 }

  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [confirm,  setConfirm]  = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('rom_records')
        .select('id, movement_key, degrees, created_at')
        .eq('user_id', userId)
        .eq('movement_key', movKey)
        .order('created_at', { ascending: true })
      setEntries(data || [])
      setLoading(false)
    }
    load()
  }, [userId, movKey])

  async function deleteEntry(id) {
    setDeleting(id)
    const { error } = await supabase.from('rom_records').delete().eq('id', id)
    if (!error) setEntries(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
    setConfirm(null)
  }

  const chartData = entries.map(e => ({
    date:    fmtShort(e.created_at),
    degrees: e.degrees,
  }))

  const maxDeg  = chartData.length > 0 ? Math.max(...chartData.map(d => d.degrees)) : meta.normal
  const yMax    = Math.max(maxDeg, meta.normal) * 1.15

  const best    = entries.length > 0 ? Math.max(...entries.map(e => e.degrees)) : null

  return (
    <div className="space-y-5">

      {/* Back */}
      <button
        onClick={() => {
          localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
          navigate(`/admin/user/${userId}`)
        }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{meta.label}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mobility · {entries.length} entries
            {best != null && (
              <> · best <span className="font-semibold text-fuchsia-400">{best}°</span></>
            )}
          </p>
        </div>
        {best != null && (
          <div className="ml-auto text-right">
            <p className="text-3xl font-bold tabular-nums text-fuchsia-400">{best}°</p>
            <p className="text-xs text-muted-foreground">Best ROM</p>
          </div>
        )}
      </div>

      {/* Chart */}
      {!loading && chartData.length >= 2 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-3">ROM over time</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, yMax]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickCount={4} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${v}°`, 'ROM']}
              />
              <ReferenceLine y={meta.normal} stroke="#e879f9" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: 'Normal', position: 'right', fontSize: 9, fill: '#e879f9' }} />
              <Bar dataKey="degrees" fill="#e879f9" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[10px] text-muted-foreground text-right">Dashed line = normal range ({meta.normal}°)</p>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">No entries found.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {[...entries].reverse().map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-sm font-bold tabular-nums font-mono text-fuchsia-400 w-12">{e.degrees}°</span>
                <span className="text-sm text-muted-foreground flex-1">{fmtDate(e.created_at)}</span>
                {confirm === e.id ? (
                  <ConfirmDelete onConfirm={() => deleteEntry(e.id)} onCancel={() => setConfirm(null)} busy={deleting === e.id} />
                ) : (
                  <button onClick={() => setConfirm(e.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
