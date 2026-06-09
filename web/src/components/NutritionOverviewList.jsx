/**
 * NutritionOverviewList — shared 7-day calorie-compliance grid for the admin
 * and coach Nutrition Overview pages. Identical render on both; the page
 * supplies the scoped rows (loadNutritionRows), the day columns, and the
 * per-surface client link (clientHref).
 *
 * Props:
 *   rows       — built rows from loadNutritionRows()
 *   days       — ISO date strings (today first) from lastNDays()
 *   loading    — show the loading state
 *   clientHref — (id) => route string for the client link
 */

import { Link } from 'wouter'
import { shortDay, complianceColor, complianceScore } from '../lib/nutritionOverview'

export default function NutritionOverviewList({
  rows = [], days = [], loading = false, clientHref = (id) => `/admin/user/${id}`,
}) {
  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading nutrition data…</div>
  }
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
        No clients with active plans.
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => complianceScore(b, days) - complianceScore(a, days))

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Client
            </th>
            <th className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Target
            </th>
            {days.map(d => (
              <th key={d} className="px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {shortDay(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map(row => (
            <tr key={row.id} className="hover:bg-accent/20 transition-colors">
              <td className="px-5 py-3 whitespace-nowrap">
                <Link href={clientHref(row.id)}>
                  <a className="flex items-center gap-2 hover:text-primary transition-colors">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary overflow-hidden">
                      {row.avatarUrl
                        ? <img src={row.avatarUrl} alt={row.name} className="h-7 w-7 object-cover" />
                        : (row.name?.[0]?.toUpperCase() ?? '?')}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate max-w-[160px]">{row.name}</p>
                    </div>
                  </a>
                </Link>
              </td>
              <td className="px-3 py-3 text-center">
                <span className="text-xs font-mono text-muted-foreground">
                  {row.target ? `${row.target}` : '—'}
                </span>
              </td>
              {days.map(d => {
                const kcal = row.dayLogs[d]
                const cls  = kcal && row.target ? complianceColor(kcal, row.target) : ''
                return (
                  <td key={d} className="px-2 py-3 text-center">
                    {kcal ? (
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] tabular-nums ${cls}`}>
                        {kcal}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/40">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
