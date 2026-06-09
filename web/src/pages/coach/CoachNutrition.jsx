/**
 * Coach — Nutrition Overview (/coach/nutrition)
 *
 * Mirror of the admin Nutrition Overview, scoped to the COACH's own clients
 * (coach_id = the signed-in coach). Reuses the shared loadNutritionRows loader
 * + NutritionOverviewList grid (T145), so the coach gets the identical 7-day
 * calorie-compliance view as admin. RLS independently scopes calorie_plans /
 * calorie_logs to the coach roster.
 */

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { lastNDays, loadNutritionRows } from '../../lib/nutritionOverview'
import NutritionOverviewList from '../../components/NutritionOverviewList'

export default function CoachNutrition() {
  const { user } = useAuth()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const days = useMemo(() => lastNDays(7), [])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    async function load() {
      // Scope to the coach's OWN clients (coach_id = coach id).
      const built = await loadNutritionRows(supabase, user.id, days)
      if (cancelled) return
      setRows(built)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user?.id, days])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nutrition Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          7-day calorie compliance for your clients — green = on target, amber = close, red = off.
        </p>
      </div>

      <NutritionOverviewList
        rows={rows}
        days={days}
        loading={loading}
        clientHref={(id) => `/coach/client/${id}`}
      />
    </div>
  )
}
