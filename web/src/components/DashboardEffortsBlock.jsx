// DashboardEffortsBlock — the Efforts snapshot block on the client-detail
// Dashboard tab. Answers "what were the last moves done + when", since the
// Efforts domain (strength + cardio, dozens of movements) has no single graph.
//
// Shows the last 10 DISTINCT moves (most-recent occurrence of each), MOST-RECENT
// FIRST, in a scroll that shows ~4 at a time. Each row is clickable and routes
// to that move's detail page, exactly like the Efforts tab does
// (/<basePath>/<userId>/effort/<type>/<navName>). navName collapses a trailing
// [Variant] so consolidated families (Swimming [Freestyle], Sled Work [Push],
// Pull Up [Band], Planche [Tuck]) route to their base detail.

import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { Dumbbell, ChevronRight } from 'lucide-react'

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// Date AND how-many-days-ago together, e.g. "Apr 30 · 38 days ago".
function fmtWhen(iso) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  const sameYear = d.getFullYear() === now.getFullYear()
  const datePart = d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
  const agoPart = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return `${datePart} · ${agoPart}`
}

// Strip a trailing " [Variant]" so consolidated families route to their base.
function baseName(head) {
  return (head || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
}

export default function DashboardEffortsBlock({ userId, basePath = '/admin/user', onViewAll }) {
  const [, navigate] = useLocation()
  const [moves, setMoves] = useState(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    supabase
      .from('efforts')
      .select('label, type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }) => {
        if (!alive) return
        const seen = new Set()
        const out = []
        for (const e of (data || [])) {
          const head = (e.label || '').split(' · ')[0]
          const nav  = baseName(head)
          if (!nav) continue
          const k = `${e.type}|${nav}`
          if (seen.has(k)) continue
          seen.add(k)
          out.push({ name: nav, type: e.type, ts: e.created_at })
          if (out.length >= 10) break
        }
        setMoves(out) // most-recent move first (descending by last-done)
      })
    return () => { alive = false }
  }, [userId])

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Recent efforts</h3>
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </button>
        )}
      </div>

      {moves === null ? (
        <div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>
      ) : moves.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted-foreground">No efforts logged yet.</div>
      ) : (
        <div className="max-h-[168px] overflow-y-auto divide-y divide-border">
          {moves.map((m, i) => (
            <button
              key={`${m.type}-${m.name}-${i}`}
              type="button"
              onClick={() => navigate(`${basePath}/${userId}/effort/${m.type}/${encodeURIComponent(m.name)}`)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${m.type === 'cardio' ? 'bg-orange-400' : 'bg-blue-400'}`} />
              <span className="flex-1 min-w-0 truncate text-sm">{m.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{fmtWhen(m.ts)}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
