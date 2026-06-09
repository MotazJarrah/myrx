/**
 * WeightGoalProgressList — the shared client list for the admin and coach
 * Weight Goal Progress pages.
 *
 * Renders the EXISTING row design unchanged (avatar · name · email ·
 * % / "Goal reached" badge · start→current→goal waypoints · progress bar)
 * and ADDS, per the Jun 2026 revamp:
 *   • a meaning-colored status chip in the header (hidden for "reached",
 *     where the existing "Goal reached" badge already says it),
 *   • a trend sub-row under the bar: a mini weigh-in sparkline + a "lately"
 *     line (actual rate · target rate · ETA) + a recency stamp.
 *
 * Display weights/rates use the VIEWER's preferred unit (weightUnit prop):
 * admin → admin's unit, coach → coach's unit. The list is alphabetical by
 * name (no sort/filter controls — the page only shows the viewer's own
 * clients, so the set is small).
 *
 * Props:
 *   rows         — built rows from buildProgressRow()
 *   weightUnit   — 'lb' | 'kg' (viewer preference)
 *   loading      — show the loading state
 *   newGoalIds   — ids to flag with the "New" emerald badge (admin sidebar
 *                  goals-reached acknowledgement; coach passes []/omits)
 *   clientHref   — (id) => route string for the client detail link
 */

import { Link } from 'wouter'
import { TrendingDown, TrendingUp, Target, ChevronRight, Clock } from 'lucide-react'
import {
  STATUS_META, STALE_DAYS, softProgressColor, sparkColor, fmtWeight, fmtRate,
} from '../lib/weightGoalProgress'

function Sparkline({ points, color }) {
  // Fixed footprint so rows stay aligned whether or not there's enough data.
  const W = 64, H = 20, PAD = 2
  if (!points || points.length < 2) return <span className="inline-block shrink-0" style={{ width: W, height: H }} />
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = (max - min) || 1
  const stepX = (W - PAD * 2) / (points.length - 1)
  // Higher weight sits higher on the chart — so a losing client's line slopes down.
  const d = points.map((v, i) => {
    const x = PAD + i * stepX
    const y = PAD + (H - PAD * 2) * (1 - (v - min) / span)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function WeightGoalProgressList({
  rows = [], weightUnit = 'lb', loading = false, newGoalIds = [], clientHref = (id) => `/admin/user/${id}`,
}) {
  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading progress data…</div>
  }
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
        No clients have active plans yet.
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) =>
    (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''),
  )

  return (
    <div className="space-y-3">
      {sorted.map(row => {
        const meta    = STATUS_META[row.status] || STATUS_META.new
        const isLoss  = row.direction === 'loss'
        const isNew   = newGoalIds.includes(row.id)

        // "Lately" line: actual rate · target rate · ETA.
        const lately = []
        if (row.actualRateKgWk != null)      lately.push(fmtRate(row.actualRateKgWk, weightUnit))
        else if (row.status === 'new')       lately.push('not enough weigh-ins yet')
        if (row.targetRateKgWk != null)      lately.push(`target ${fmtRate(row.targetRateKgWk, weightUnit)}`)
        if (row.etaWeeks != null) {
          lately.push(row.etaWeeks <= 12
            ? `~${Math.ceil(row.etaWeeks)} wk to goal`
            : `~${Math.max(1, Math.round(row.etaWeeks / 4.345))} mo to goal`)
        }
        const latelyText = lately.filter(Boolean).join('  ·  ')

        // Recency stamp (amber once stale).
        const stale = row.recencyDays != null && row.recencyDays > STALE_DAYS
        const recency = row.recencyDays == null
          ? null
          : stale
            ? `no weigh-in in ${row.recencyDays}d`
            : `weighed ${row.recencyDays === 0 ? 'today' : `${row.recencyDays}d ago`}`

        return (
          <Link key={row.id} href={clientHref(row.id)}>
            <a className={`block rounded-xl border bg-card p-4 hover:bg-accent/20 transition-colors cursor-pointer ${
              isNew ? 'border-emerald-500/40' : 'border-border'
            }`}>
              {/* Header — existing layout + status chip */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                  {row.avatar_url
                    ? <img src={row.avatar_url} alt={row.full_name} className="h-9 w-9 object-cover" />
                    : (row.full_name?.[0]?.toUpperCase() ?? '?')}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{row.full_name || row.email}</p>
                    {isNew && (
                      <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                        New
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{row.email}</p>
                </div>

                {/* Status chip — skipped for "reached" (existing badge covers it) */}
                {row.status !== 'reached' && (
                  <span className={`hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.chip}`}>
                    {row.status === 'no_recent' && <Clock className="h-3 w-3" />}
                    {meta.label}
                  </span>
                )}

                {/* Existing goal-reached badge OR % (softened color) */}
                {row.goal_reached ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400 shrink-0">
                    <Target className="h-3 w-3" /> Goal reached
                  </span>
                ) : (
                  <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: softProgressColor(row.prog) }}>
                    {Math.round(row.prog * 100)}%
                  </span>
                )}

                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </div>

              {/* Weight waypoints (viewer's unit) */}
              <div className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{fmtWeight(row.startKg, weightUnit)}</span>
                <span className="flex-1 border-t border-dashed border-border" />
                <span className="font-mono font-semibold text-foreground">{fmtWeight(row.currentKg, weightUnit)}</span>
                <span className="flex-1 border-t border-dashed border-border" />
                <span className="flex items-center gap-0.5 font-mono">
                  {isLoss ? <TrendingDown className="h-3 w-3 text-emerald-400" /> : <TrendingUp className="h-3 w-3 text-blue-400" />}
                  {fmtWeight(row.goalKg, weightUnit)}
                </span>
              </div>

              {/* Progress bar (softened color) */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${row.prog * 100}%`, backgroundColor: softProgressColor(row.prog) }}
                />
              </div>

              {/* NEW — trend sub-row: sparkline · lately · recency.
                  Hidden once the goal is reached: hitting goal LOCKS the
                  phase, so there's no forward rate / target / ETA to compute
                  until a new goal is set. Showing "~1 wk to goal" on a
                  reached client is meaningless. */}
              {row.status !== 'reached' && (
                <div className="mt-2.5 flex items-center gap-3">
                  <Sparkline points={row.spark} color={sparkColor(row.status)} />
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {latelyText || '—'}
                  </p>
                  {recency && (
                    <span className={`shrink-0 text-[11px] ${stale ? 'text-amber-400' : 'text-muted-foreground'}`}>
                      {recency}
                    </span>
                  )}
                </div>
              )}

              {/* Status chip for narrow screens (header chip is sm+ only) */}
              {row.status !== 'reached' && (
                <div className="mt-2 sm:hidden">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                    {row.status === 'no_recent' && <Clock className="h-3 w-3" />}
                    {meta.label}
                  </span>
                </div>
              )}
            </a>
          </Link>
        )
      })}
    </div>
  )
}
