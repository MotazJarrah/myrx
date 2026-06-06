import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../../lib/supabase'
import { useMovements } from '../../../hooks/useMovements'
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

// ── Variant-family collapse helpers (mirror the athlete index) ─────────────────
//
// The athlete's "Your movements" (mobile/app/(app)/strength.tsx) and "Your
// activities" (mobile/app/(app)/cardio.tsx) lists collapse variant families
// into a single row keyed by the BASE name, with a small badge for the
// most-recently-trained (or highest-reached) variant. We replicate that here
// so the coach sees the same shape. Navigation for a collapsed row targets the
// BASE / consolidated route — the admin detail dispatchers
// (AdminEffortDetail + AdminCardioDetail) already special-case those base
// names and self-fetch every variant's efforts.

// Bodyweight assist tiers — highest tier reached drives the badge.
// FULL RX (no assist) > BAND (band only) > KNEE (knee only) > B+K (both).
const BW_TIER_RANK = { 'band+knee': 1, 'knee': 2, 'band': 3, 'rx': 4 }
const BW_TIER_BADGE = { 'band+knee': 'B+K', 'knee': 'KNEE', 'band': 'BAND', 'rx': 'FULL RX' }

function bwTierFromVariantName(name) {
  if (name.endsWith(' [Band + Knee]')) return 'band+knee'
  if (name.endsWith(' [Knee]'))        return 'knee'
  if (name.endsWith(' [Band]'))        return 'band'
  return 'rx'
}

function bwBaseName(name) {
  return name
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
}

// Sled Work — two parallel variants ([Push] / [Drag]) collapse into one
// "Sled Work" row, badge = most-recently-logged variant.
const SLED_WORK_BASE_NAME = 'Sled Work'
function sledVariantFromName(name) {
  if (name === 'Sled Work [Push]') return 'push'
  if (name === 'Sled Work [Drag]') return 'drag'
  return null
}

// Swimming — four stroke variants ([Freestyle] / [Backstroke] / [Breaststroke]
// / [Butterfly], plus legacy bare "Swimming") collapse into one "Swimming"
// row, badge = most-recently-logged stroke.
const SWIMMING_BASE_NAME = 'Swimming'
const SWIM_STROKE_BADGE = {
  freestyle: 'FREE', backstroke: 'BACK', breaststroke: 'BREAST', butterfly: 'FLY',
}
function isSwimHead(head) {
  return head === SWIMMING_BASE_NAME || head.startsWith('Swimming [')
}
function swimStrokeFromHead(head) {
  // Bare "Swimming" (legacy effort labels) defaults to freestyle — same as the
  // athlete's parseSwimStroke read path.
  const m = head.match(/^Swimming\s+\[(\w+)\]$/i)
  if (!m) return 'freestyle'
  const stroke = m[1].toLowerCase()
  return SWIM_STROKE_BADGE[stroke] ? stroke : 'freestyle'
}

// ── Move card ─────────────────────────────────────────────────────────────────

function MoveCard({ label, type, count, stat, badge, onClick }) {
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
      {/* Variant badge — shown only for collapsed families (bodyweight tier,
          Sled Work PUSH/DRAG, Swimming stroke). Mirrors the athlete index's
          small variant chip. */}
      {badge && (
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border shrink-0 ${meta.chip}`}>
          {badge}
        </span>
      )}
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

  // Movements table (cached) — used to detect equipment / bodyweight tier
  // eligibility, exactly as the athlete index does via useMovements().
  const dbMovements = useMovements()

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

  // ── Admin-added variant families (parent → children) ──────────────────────
  // Build childName → { parentName, shortLabel } from the movements catalog so
  // we can collapse a family's children (e.g. "Planche Hold [Tuck]" /
  // "[Straddle]" / "[Full]") into ONE row keyed by the PARENT ("Planche Hold"),
  // mirroring the athlete strength index. The badge = variant_short_label of
  // the most-recently-logged child; the row routes to the PARENT name so the
  // AdminEffortDetail dispatch renders the consolidated family detail.
  const familyChildMap = useMemo(() => {
    const byId = {}
    dbMovements.forEach(m => { byId[m.id] = m })
    const map = {}
    dbMovements.forEach(m => {
      if (!m.parent_movement_id) return
      const parent = byId[m.parent_movement_id]
      if (!parent) return
      map[m.name] = { parentName: parent.name, shortLabel: m.variant_short_label || null }
    })
    return map
  }, [dbMovements])

  // ── Group efforts into collapsed family rows ──────────────────────────────
  const { strengthMoves, cardioMoves } = useMemo(() => {
    const strengthMap = {}
    const cardioMap   = {}

    // efforts arrive newest-first; track the most-recent variant by comparing
    // created_at so the badge always reflects the latest logged variant
    // regardless of map insertion order.
    efforts.forEach(e => {
      // Exercise / activity name is everything before the first ' · '
      const head = e.label.split(' · ')[0]
      const ts   = new Date(e.created_at).getTime()

      if (e.type === 'strength') {
        // ── Sled Work consolidation ────────────────────────────────────────
        const sledVariant = sledVariantFromName(head)
        if (sledVariant !== null) {
          const key = SLED_WORK_BASE_NAME
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'sled', count: 0,
            best1RM: null, unit: 'lb', recentTs: -1, recentVariant: sledVariant,
          }
          g.count++
          if (ts > g.recentTs) { g.recentTs = ts; g.recentVariant = sledVariant }
          const m = e.value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
          if (m) {
            const rm = parseFloat(m[1])
            if (g.best1RM === null || rm > g.best1RM) { g.best1RM = rm; g.unit = m[2] }
          }
          return
        }

        // ── Admin-added variant family consolidation ───────────────────────
        // If this effort's movement head is a family CHILD, group it under the
        // PARENT name. Badge = variant_short_label of the most-recently-logged
        // child (tracked via recentTs — efforts arrive newest-first but the
        // ts comparison is order-independent). navName = PARENT so tapping
        // routes to the consolidated family detail. Runs AFTER the Sled block
        // (Sled is hardcoded, not catalog-driven) so Sled is never
        // double-handled here.
        const family = familyChildMap[head]
        if (family) {
          const key = family.parentName
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'family', count: 0,
            best1RM: null, unit: 'lb', recentTs: -1, recentShort: family.shortLabel,
          }
          g.count++
          if (ts > g.recentTs) { g.recentTs = ts; g.recentShort = family.shortLabel }
          // Leverage holds store durations, not Est. 1RM — but capture a 1RM if
          // a future weighted family ever logs one, so the stat line can show it.
          const m = e.value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
          if (m) {
            const rm = parseFloat(m[1])
            if (g.best1RM === null || rm > g.best1RM) { g.best1RM = rm; g.unit = m[2] }
          }
          return
        }

        // ── Bodyweight assist-tier consolidation ───────────────────────────
        const tier      = bwTierFromVariantName(head)
        const isVariant = tier !== 'rx'
        const base      = isVariant ? bwBaseName(head) : head
        const rec       = dbMovements.find(m => m.name === base)
        const isBodyweight = rec?.equipment === 'bodyweight'
        // Only Pull-Up / Dip / Chin-Up family (band/knee eligible) movements
        // actually have tier variants — gate the badge on that, mirroring the
        // athlete's `canHaveTiers`. A plain bodyweight movement (Plank, Leg
        // Raise) never shows a tier badge even though it's bodyweight.
        const canHaveTiers = !!(rec?.band_assist || rec?.knee_assist)
        if (isBodyweight && (isVariant || canHaveTiers)) {
          const key = base
          const g = strengthMap[key] ??= {
            label: key, navName: key, kind: 'bw', count: 0,
            best1RM: null, unit: 'lb', highestTier: tier, canHaveTiers,
          }
          g.count++
          g.canHaveTiers = g.canHaveTiers || canHaveTiers
          if (BW_TIER_RANK[tier] > BW_TIER_RANK[g.highestTier]) g.highestTier = tier
          // Bodyweight tiers store rep-count efforts; weighted Full-RX efforts
          // store an Est. 1RM. Capture the 1RM when present so the row can show
          // a best-1RM line for weighted bodyweight work.
          const m = e.value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
          if (m) {
            const rm = parseFloat(m[1])
            if (g.best1RM === null || rm > g.best1RM) { g.best1RM = rm; g.unit = m[2] }
          }
          return
        }

        // ── Regular strength movement (no variants) ────────────────────────
        const key = head
        const g = strengthMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0, best1RM: null, unit: 'lb',
        }
        g.count++
        const m = e.value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
        if (m) {
          const rm = parseFloat(m[1])
          if (g.best1RM === null || rm > g.best1RM) { g.best1RM = rm; g.unit = m[2] }
        }
      } else if (e.type === 'cardio') {
        // ── Swimming stroke consolidation ──────────────────────────────────
        if (isSwimHead(head)) {
          const key = SWIMMING_BASE_NAME
          const g = cardioMap[key] ??= {
            label: key, navName: key, kind: 'swim', count: 0,
            bestVal: null, bestStr: null, recentTs: -1, recentStroke: 'freestyle',
          }
          g.count++
          const stroke = swimStrokeFromHead(head)
          if (ts > g.recentTs) { g.recentTs = ts; g.recentStroke = stroke }
          const parsed = parseCardioBest(e.value)
          if (parsed) {
            const better = g.bestVal === null
              || (parsed.lowerBetter ? parsed.val < g.bestVal : parsed.val > g.bestVal)
            if (better) { g.bestVal = parsed.val; g.bestStr = e.value }
          }
          return
        }

        // ── Regular cardio activity (no variants) ──────────────────────────
        const key = head
        const g = cardioMap[key] ??= {
          label: key, navName: key, kind: 'plain', count: 0, bestVal: null, bestStr: null,
        }
        g.count++
        // Direction-aware best across ALL cardio formats (pace, speed, cal/min,
        // floors/min, distance) — not just "/km" pace.
        const parsed = parseCardioBest(e.value)
        if (parsed) {
          const better = g.bestVal === null
            || (parsed.lowerBetter ? parsed.val < g.bestVal : parsed.val > g.bestVal)
          if (better) { g.bestVal = parsed.val; g.bestStr = e.value }
        }
      }
    })

    const entryStr = n => `${n} ${n === 1 ? 'entry' : 'entries'}`

    const strengthMoves = Object.values(strengthMap)
      .map(d => ({
        label:   d.label,
        navName: d.navName,
        count:   d.count,
        type:    'strength',
        stat:    d.best1RM !== null ? `${entryStr(d.count)} · Best 1RM ${d.best1RM} ${d.unit}` : entryStr(d.count),
        badge:
          d.kind === 'sled' ? (d.recentVariant === 'push' ? 'PUSH' : 'DRAG')
          : d.kind === 'bw'  ? (d.canHaveTiers ? BW_TIER_BADGE[d.highestTier] : null)
          : d.kind === 'family' ? d.recentShort
          : null,
      }))
      .sort((a, b) => b.count - a.count)

    const cardioMoves = Object.values(cardioMap)
      .map(d => ({
        label:   d.label,
        navName: d.navName,
        count:   d.count,
        type:    'cardio',
        stat:    d.bestStr ? `${entryStr(d.count)} · Best ${d.bestStr}` : entryStr(d.count),
        badge:   d.kind === 'swim' ? SWIM_STROKE_BADGE[d.recentStroke] : null,
      }))
      .sort((a, b) => b.count - a.count)

    return { strengthMoves, cardioMoves }
  }, [efforts, dbMovements, familyChildMap])

  const visibleMoves = view === 'cardio' ? cardioMoves : strengthMoves

  function handleMoveClick(move) {
    // Navigate to the BASE / consolidated route. The admin detail dispatchers
    // (AdminEffortDetail / AdminCardioDetail) recognise "Sled Work",
    // "Swimming", and bodyweight base names and self-fetch every variant.
    navigate(`/admin/user/${userId}/effort/${move.type}/${encodeURIComponent(move.navName)}`)
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
              key={`${move.type}-${move.navName}`}
              label={move.label}
              type={move.type}
              count={move.count}
              stat={move.stat}
              badge={move.badge}
              onClick={() => handleMoveClick(move)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
