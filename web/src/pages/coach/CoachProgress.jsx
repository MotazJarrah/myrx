/**
 * Coach — Weight Goal Progress (/coach/progress)
 *
 * Mirror of the admin Weight Goal Progress page (AdminProgress.jsx), scoped
 * to the COACH's own clients (coach_id = the signed-in coach). Same revamped
 * row design + per-client math via the shared WeightGoalProgressList +
 * lib/weightGoalProgress — loadWeightGoalRows scopes by coach_id = viewer, so
 * passing the coach's id naturally returns only that coach's roster (RLS
 * independently enforces the same scope on bodyweight + calorie_plans).
 * All weights/rates display in the COACH's preferred unit.
 *
 * Unlike the admin page there is no goal-reached "sidebar badge"
 * acknowledgement here (the coach shell has no goals-reached badge), so the
 * GOALS_ACK / newGoalIds logic is intentionally omitted — the list just
 * renders the coach's clients alphabetically.
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { loadWeightGoalRows } from '../../lib/weightGoalProgress'
import WeightGoalProgressList from '../../components/WeightGoalProgressList'

export default function CoachProgress() {
  const { user, profile } = useAuth()
  const weightUnit        = profile?.weight_unit || 'lb'
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      // Scope to the coach's OWN clients (coach_id = coach id).
      const built = await loadWeightGoalRows(supabase, user.id)
      if (cancelled) return
      setRows(built)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Weight Goal Progress</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Weight-goal progress for your clients with active plans.</p>
      </div>

      <WeightGoalProgressList
        rows={rows}
        weightUnit={weightUnit}
        loading={loading}
        clientHref={(id) => `/coach/client/${id}`}
      />
    </div>
  )
}
