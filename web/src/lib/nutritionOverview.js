/**
 * Nutrition Overview — shared loader + helpers for the admin and coach
 * Nutrition Overview pages (7-day calorie compliance grid).
 *
 * Same scoping rule as the Weight Goal Progress pages (lib/weightGoalProgress):
 * the list is scoped to the VIEWER's own managed clients (profiles.coach_id =
 * viewerId) — a coach passes their id and sees their roster; an admin passes
 * their id and sees the clients THEY manage. RLS independently scopes
 * calorie_plans / calorie_logs to the coach roster. Body-comp fields are
 * fetched because calcFullPlan needs them to derive each client's daily target.
 */

import { calcFullPlan } from './calorieFormulas'
import { hydrateEmails } from './hydrateEmails'

/** Last N days as ISO date strings (today first). */
export function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - i)
    return d.toISOString().split('T')[0]
  })
}

/** Short column label for a day (Today / Yest / "Jun 7"). */
export function shortDay(iso) {
  const d = new Date(iso + 'T12:00:00')
  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
  if (iso === today)     return 'Today'
  if (iso === yesterday) return 'Yest'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Compliance cell color: green on-target, amber close, red off. */
export function complianceColor(logged, target) {
  if (!logged) return 'bg-muted/40 text-muted-foreground'
  const ratio = logged / target
  if (ratio >= 0.9 && ratio <= 1.1)  return 'bg-emerald-500/15 text-emerald-400 font-semibold'
  if (ratio >= 0.75 && ratio <= 1.2) return 'bg-amber-500/15 text-amber-400 font-semibold'
  return 'bg-red-500/15 text-red-400 font-semibold'
}

/** Compliance score for sorting: # of days logged on-target (0.9–1.1×). */
export function complianceScore(row, days) {
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

/**
 * Load the 7-day compliance rows for the VIEWER's own managed clients
 * (coach_id = viewerId). Returns rows with a per-day calorie map + the
 * computed daily target. Clients without a plan are dropped.
 */
export async function loadNutritionRows(supabase, viewerId, days) {
  if (!viewerId) return []

  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, current_weight, weight_unit, current_height, height_unit, gender, birthdate')
    .eq('coach_id', viewerId)
    .is('deactivated_at', null)
    .is('anonymized_at', null)

  if (error || !profs || profs.length === 0) return []

  const clients = await hydrateEmails(supabase, profs)
  const ids = clients.map(c => c.id)

  const [plansRes, logsRes] = await Promise.all([
    supabase.from('calorie_plans').select('*').in('user_id', ids),
    supabase.from('calorie_logs')
      .select('user_id, log_date, calories')
      .in('user_id', ids)
      .gte('log_date', days[days.length - 1])
      .lte('log_date', days[0]),
  ])

  const planMap = {}
  ;(plansRes.data || []).forEach(p => { planMap[p.user_id] = p })

  const logMap = {}
  ;(logsRes.data || []).forEach(l => {
    if (!logMap[l.user_id]) logMap[l.user_id] = {}
    logMap[l.user_id][l.log_date] = l.calories
  })

  return clients
    .filter(u => planMap[u.id])
    .map(u => {
      const plan = planMap[u.id]
      let target = null
      try {
        target = calcFullPlan(u, plan)?.dailyTarget ?? null
      } catch { /* missing body data — target stays null */ }
      return {
        id:        u.id,
        name:      u.full_name || u.email,
        email:     u.email,
        avatarUrl: u.avatar_url || null,
        target,
        dayLogs:   logMap[u.id] || {},
      }
    })
}
