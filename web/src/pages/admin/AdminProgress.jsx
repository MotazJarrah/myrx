/**
 * Admin — Weight Goal Progress (/admin/progress)
 *
 * Lists the ADMIN's own managed clients (coach_id = admin's user id) with an
 * active nutrition plan, alphabetically, showing start→current→goal weight,
 * % covered, plus (Jun 2026 revamp) a status chip, weigh-in trend sparkline,
 * actual-vs-target weekly rate, ETA, and weigh-in recency. All weights/rates
 * display in the ADMIN's preferred unit.
 *
 * Scope: admin-managed clients ONLY — NOT the full platform roster. Other
 * coaches' clients and self-coached users never appear here. The row design,
 * per-client math, AND the scoped fetch are shared with the coach Weight Goal
 * Progress page via WeightGoalProgressList + lib/weightGoalProgress
 * (loadWeightGoalRows scopes by coach_id = the signed-in viewer).
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { loadWeightGoalRows } from '../../lib/weightGoalProgress'
import WeightGoalProgressList from '../../components/WeightGoalProgressList'

const GOALS_ACK_KEY = 'myrx_goals_acknowledged'

function getAcknowledged() {
  return JSON.parse(localStorage.getItem(GOALS_ACK_KEY) || '[]')
}

function acknowledge(userIds) {
  const existing = getAcknowledged()
  const merged = [...new Set([...existing, ...userIds])]
  localStorage.setItem(GOALS_ACK_KEY, JSON.stringify(merged))
}

export default function AdminProgress() {
  const { user, profile } = useAuth()
  const weightUnit        = profile?.weight_unit || 'lb'
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [newGoalIds, setNewGoalIds] = useState([])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      // Scope to the admin's OWN managed clients (coach_id = admin id).
      const built = await loadWeightGoalRows(supabase, user.id)
      if (cancelled) return

      // "New" badge for goal-reached clients the admin hasn't seen yet.
      const acknowledged = getAcknowledged()
      const newIds = built.filter(r => r.goal_reached && !acknowledged.includes(r.id)).map(r => r.id)
      setNewGoalIds(newIds)

      setRows(built)
      setLoading(false)

      // Acknowledge all current goal-reached clients + clear the sidebar badge.
      const goalReachedIds = built.filter(r => r.goal_reached).map(r => r.id)
      if (goalReachedIds.length > 0) acknowledge(goalReachedIds)
      window.dispatchEvent(new CustomEvent('myrx_signal', { detail: 'goals_acked' }))
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
        newGoalIds={newGoalIds}
        clientHref={(id) => `/admin/user/${id}`}
      />
    </div>
  )
}
