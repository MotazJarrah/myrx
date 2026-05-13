import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import { TrendingDown, TrendingUp, Target, ChevronRight } from 'lucide-react'

const GOALS_ACK_KEY = 'myrx_goals_acknowledged'

function getAcknowledged() {
  return JSON.parse(localStorage.getItem(GOALS_ACK_KEY) || '[]')
}

function acknowledge(userIds) {
  const existing = getAcknowledged()
  const merged = [...new Set([...existing, ...userIds])]
  localStorage.setItem(GOALS_ACK_KEY, JSON.stringify(merged))
}

function toKg(weight, unit) {
  if (!weight) return null
  return unit === 'lb' ? Math.round(weight * 0.453592 * 10) / 10 : Number(weight)
}

function progressBar(start, current, goal) {
  if (start == null || current == null || goal == null) return 0
  if (Math.abs(goal - start) < 0.01) return 1
  const p = (start - current) / (start - goal)
  return Math.max(0, Math.min(1, p))
}

function hslFromProgress(p) {
  const hue = Math.round(p * 142)
  return `hsl(${hue}, 70%, 48%)`
}

export default function AdminProgress() {
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [sort,         setSort]         = useState('progress-desc')
  const [newGoalIds,   setNewGoalIds]   = useState([])

  useEffect(() => {
    async function load() {
      const [usersRes, plansRes, bwRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('calorie_plans').select('user_id, starting_weight_kg, goal_weight_kg, goal_reached'),
        supabase.from('bodyweight').select('user_id, weight, unit, created_at').order('created_at', { ascending: false }),
      ])

      const users    = usersRes.data || []
      const plans    = plansRes.data || []
      const bwAll    = bwRes.data    || []

      const latestBW = {}
      bwAll.forEach(b => { if (!latestBW[b.user_id]) latestBW[b.user_id] = b })

      const planMap = {}
      plans.forEach(p => { planMap[p.user_id] = p })

      const built = users
        .filter(u => planMap[u.id])
        .map(u => {
          const plan    = planMap[u.id]
          const bw      = latestBW[u.id]
          const startKg = plan.starting_weight_kg
          const goalKg  = plan.goal_weight_kg
          const currentKg = bw ? toKg(bw.weight, bw.unit) : toKg(u.current_weight, u.weight_unit)
          const prog = plan.goal_reached ? 1 : progressBar(startKg, currentKg, goalKg)
          return { ...u, plan, currentKg, prog }
        })

      // Identify unacknowledged goal-reached clients ("new" badge)
      const acknowledged = getAcknowledged()
      const newIds = built
        .filter(r => r.plan.goal_reached && !acknowledged.includes(r.id))
        .map(r => r.id)
      setNewGoalIds(newIds)

      setRows(built)
      setLoading(false)

      // Acknowledge all current goal-reached clients and clear the badge
      const goalReachedIds = built.filter(r => r.plan.goal_reached).map(r => r.id)
      if (goalReachedIds.length > 0) {
        acknowledge(goalReachedIds)
      }
      window.dispatchEvent(new CustomEvent('myrx_signal', { detail: 'goals_acked' }))
    }
    load()
  }, [])

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'name')           return (a.full_name || '').localeCompare(b.full_name || '')
    if (sort === 'progress-asc')   return a.prog - b.prog
    return b.prog - a.prog
  })

  const SortBtn = ({ id, label }) => (
    <button
      onClick={() => setSort(id)}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        sort === id
          ? 'bg-primary text-primary-foreground'
          : 'border border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Weight Goal Progress</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Weight-goal progress for all clients with active plans.</p>
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap gap-2">
        <SortBtn id="progress-desc" label="Most progress" />
        <SortBtn id="progress-asc"  label="Least progress" />
        <SortBtn id="name"          label="Name A–Z" />
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading progress data…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          No clients have active plans yet.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(row => {
            const { plan, currentKg, prog } = row
            const start  = plan.starting_weight_kg
            const goal   = plan.goal_weight_kg
            const isLoss = start != null && goal != null && goal < start

            const isNew = newGoalIds.includes(row.id)
            return (
              <Link key={row.id} href={`/admin/user/${row.id}`}>
                <a className={`block rounded-xl border bg-card p-4 hover:bg-accent/20 transition-colors cursor-pointer ${
                  isNew ? 'border-emerald-500/40' : 'border-border'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    {/* Avatar */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                      {row.avatar_url
                        ? <img src={row.avatar_url} alt={row.full_name} className="h-9 w-9 object-cover" />
                        : (row.full_name?.[0]?.toUpperCase() ?? '?')
                      }
                    </div>

                    {/* Name + status */}
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

                    {/* Goal reached badge or % */}
                    {plan.goal_reached ? (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400 shrink-0">
                        <Target className="h-3 w-3" /> Goal reached
                      </span>
                    ) : (
                      <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: hslFromProgress(prog) }}>
                        {Math.round(prog * 100)}%
                      </span>
                    )}

                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </div>

                  {/* Weight waypoints */}
                  <div className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">{start != null ? `${start} kg` : '—'}</span>
                    <span className="flex-1 border-t border-dashed border-border" />
                    <span className="font-mono font-semibold text-foreground">{currentKg != null ? `${currentKg} kg` : '—'}</span>
                    <span className="flex-1 border-t border-dashed border-border" />
                    <span className="flex items-center gap-0.5 font-mono">
                      {isLoss ? <TrendingDown className="h-3 w-3 text-emerald-400" /> : <TrendingUp className="h-3 w-3 text-blue-400" />}
                      {goal != null ? `${goal} kg` : '—'}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${prog * 100}%`, backgroundColor: hslFromProgress(prog) }}
                    />
                  </div>
                </a>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
