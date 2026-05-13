import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import { calcFullPlan } from '../../lib/calorieFormulas'

// Last N days as ISO date strings (today first)
function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - i)
    return d.toISOString().split('T')[0]
  })
}

function shortDay(iso) {
  const d = new Date(iso + 'T12:00:00')
  const today    = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
  if (iso === today)     return 'Today'
  if (iso === yesterday) return 'Yest'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function complianceColor(logged, target) {
  if (!logged) return 'bg-muted/40 text-muted-foreground'
  const ratio = logged / target
  if (ratio >= 0.9 && ratio <= 1.1) return 'bg-emerald-500/15 text-emerald-400 font-semibold'
  if (ratio >= 0.75 && ratio <= 1.2) return 'bg-amber-500/15 text-amber-400 font-semibold'
  return 'bg-red-500/15 text-red-400 font-semibold'
}

export default function AdminNutrition() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const days = lastNDays(7)

  useEffect(() => {
    async function load() {
      const [usersRes, plansRes, logsRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('calorie_plans').select('*'),
        supabase.from('calorie_logs')
          .select('user_id, log_date, calories')
          .gte('log_date', days[days.length - 1])
          .lte('log_date', days[0]),
      ])

      const users = usersRes.data || []
      const plans = plansRes.data || []
      const logs  = logsRes.data  || []

      // Plan map
      const planMap = {}
      plans.forEach(p => { planMap[p.user_id] = p })

      // Log map: { user_id → { log_date → calories } }
      const logMap = {}
      logs.forEach(l => {
        if (!logMap[l.user_id]) logMap[l.user_id] = {}
        logMap[l.user_id][l.log_date] = l.calories
      })

      // Build rows for clients with plans
      const built = users
        .filter(u => planMap[u.id])
        .map(u => {
          const plan = planMap[u.id]
          // Compute daily target
          let target = null
          try {
            const result = calcFullPlan(u, plan)
            target = result?.dailyTarget ?? null
          } catch {}
          return {
            id:        u.id,
            name:      u.full_name || u.email,
            email:     u.email,
            avatarUrl: u.avatar_url || null,
            target,
            dayLogs:   logMap[u.id] || {},
          }
        })

      setRows(built)
      setLoading(false)
    }
    load()
  }, [])

  // Compliance score for sorting: % of days logged on-target
  function score(row) {
    if (!row.target) return -1
    let on = 0
    days.forEach(d => {
      const kcal = row.dayLogs[d]
      if (!kcal) return
      const ratio = kcal / row.target
      if (ratio >= 0.9 && ratio <= 1.1) on++
    })
    return on
  }

  const sorted = [...rows].sort((a, b) => score(b) - score(a))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nutrition Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">7-day calorie compliance — green = on target, amber = close, red = off.</p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading nutrition data…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          No clients with active plans.
        </div>
      ) : (
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
                    <Link href={`/admin/user/${row.id}`}>
                      <a className="flex items-center gap-2 hover:text-primary transition-colors">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary overflow-hidden">
                          {row.avatarUrl
                            ? <img src={row.avatarUrl} alt={row.name} className="h-7 w-7 object-cover" />
                            : (row.name?.[0]?.toUpperCase() ?? '?')
                          }
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
      )}
    </div>
  )
}
