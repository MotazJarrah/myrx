/**
 * AdminStrengthFamilyDetail — WEB COACH mirror of the athlete's consolidated
 * variant-family detail (mobile/app/(app)/effort/strength/[exercise].tsx →
 * FamilyConsolidatedDetail).
 *
 * An admin-created variant family is a PARENT movement row (parent_movement_id
 * NULL, no efforts) plus CHILD rows (parent_movement_id = parent.id, name like
 * "Planche Hold [Tuck]", variant_short_label "TUCK"). Logged efforts always
 * live on the CHILDREN.
 *
 * The only families today are the 4 leverage / skill holds:
 *   Planche Hold · Front Lever Hold · Back Lever Hold · Handstand Hold.
 *
 * WEB STAYS SIMPLE: the variant selector is a CLICK-based pill row — NOT the
 * swipe carousel the athlete uses. Tapping a pill swaps the body to that
 * child's per-variant detail (AdminStrengthLeverageDetail, header suppressed).
 *
 * Structure (top → bottom):
 *   1. Back button + parent-name h1 + SKILL badge (header owned here).
 *   2. Click-based variant pill row — one pill per LOGGED child (fallback: all
 *      children when none are logged). Default = first.
 *   3. <AdminStrengthLeverageDetail … hideHeader /> for the selected child —
 *      tiles + hero + chart + log, no duplicate header.
 *
 * READ-ONLY (the embedded per-variant detail keeps its per-effort delete).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import AdminStrengthLeverageDetail from './AdminStrengthLeverageDetail'
import { ArrowLeft } from 'lucide-react'

// Pill label for a child: prefer variant_short_label, fall back to the text
// inside the child's [brackets], then to the bare name.
function variantPillLabel(child) {
  if (child.variant_short_label) return child.variant_short_label
  const m = child.name.match(/\[([^\]]+)\]/)
  return m ? m[1] : child.name
}

export default function AdminStrengthFamilyDetail({ userId, exercise, onBack }) {
  // children = movement rows whose parent is `exercise`. `shown` is the subset
  // the client has actually logged (fallback to all children when none logged).
  const [shown, setShown] = useState([])     // [{ name, variant_short_label, hold_type }]
  const [selected, setSelected] = useState(null) // selected child name
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)

      // 1. Resolve the parent row → its id.
      const { data: parent } = await supabase
        .from('movements')
        .select('id')
        .eq('name', exercise)
        .is('parent_movement_id', null)
        .maybeSingle()

      if (!alive) return
      if (!parent) { setShown([]); setSelected(null); setLoading(false); return }

      // 2. Fetch this family's children (ordered by name).
      const { data: children } = await supabase
        .from('movements')
        .select('name, variant_short_label, hold_type')
        .eq('parent_movement_id', parent.id)
        .order('name', { ascending: true })

      if (!alive) return
      const kids = children || []
      if (kids.length === 0) { setShown([]); setSelected(null); setLoading(false); return }

      // 3. For each child, check whether the client logged any efforts.
      //    Show only LOGGED children (fallback to all children when none).
      const flags = await Promise.all(
        kids.map(async (c) => {
          const { count } = await supabase
            .from('efforts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('type', 'strength')
            .ilike('label', `${c.name} · %`)
          return (count ?? 0) > 0
        })
      )

      if (!alive) return
      const logged = kids.filter((_, i) => flags[i])
      const visible = logged.length > 0 ? logged : kids
      setShown(visible)
      setSelected(visible[0]?.name ?? null)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [userId, exercise])

  const selectedChild = useMemo(
    () => shown.find(c => c.name === selected) ?? shown[0] ?? null,
    [shown, selected]
  )

  function backFn() {
    if (onBack) return onBack()
    localStorage.setItem(`admin-user-tab-${userId}`, 'activity')
    window.location.assign(`/admin/user/${userId}`)
  }

  return (
    <div className="space-y-5">
      {/* ── 1. Header (owned here; the embedded variant detail hides its own) ── */}
      <button
        onClick={backFn}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Client
      </button>

      <div>
        <h1 className="text-xl font-bold tracking-tight">{exercise}</h1>
        <div className="mt-1.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
            SKILL
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          No variants found.
        </div>
      ) : (
        <>
          {/* ── 2. Click-based variant pill row ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            {shown.map(c => {
              const isSel = c.name === selectedChild?.name
              return (
                <button
                  key={c.name}
                  onClick={() => setSelected(c.name)}
                  className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                    isSel
                      ? 'border-blue-500 bg-blue-500/15 text-blue-400'
                      : 'border-border/40 bg-card/20 text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  {variantPillLabel(c)}
                </button>
              )
            })}
          </div>

          {/* ── 3. Selected child's per-variant detail (header suppressed) ── */}
          {selectedChild && (
            <AdminStrengthLeverageDetail
              key={selectedChild.name}
              userId={userId}
              exercise={selectedChild.name}
              hideHeader
              onBack={onBack}
            />
          )}
        </>
      )}
    </div>
  )
}
