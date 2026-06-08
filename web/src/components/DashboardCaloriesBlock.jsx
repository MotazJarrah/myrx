// Calories snapshot block for the client-detail Dashboard tab.
// Main graph = the shared CalorieTrendGraph (status-coloured bands + line + dots +
// dashed target) — the SAME component the Calories detail strip uses, so they
// can't drift. Quick stats = Daily target / BMR / TDEE / Energy balance (from the
// already-fetched calorie plan). Click-through opens the full Calories tab.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Apple, TrendingDown, TrendingUp } from 'lucide-react'
import { calcFullPlan } from '../lib/calorieFormulas'
import { SnapshotCard, SnapshotLoading, SnapshotEmpty, StatStrip } from './DashboardSnapshotShell'
import CalorieTrendGraph from './CalorieTrendGraph'

function isoDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10) }
function buildWindow(n = 14) {
  const out = []
  const base = new Date(); base.setHours(0, 0, 0, 0)
  for (let off = -(n - 1); off <= 0; off++) { const d = new Date(base); d.setDate(base.getDate() + off); out.push(isoDay(d)) }
  return out
}

export default function DashboardCaloriesBlock({ userId, profile, plan, onViewAll }) {
  const [logsByDay, setLogsByDay] = useState(null)
  const days = useMemo(() => buildWindow(14), [])

  useEffect(() => {
    if (!userId) return
    let alive = true
    const from = days[0], to = days[days.length - 1]
    supabase
      .from('food_logs')
      .select('log_date, calories')
      .eq('user_id', userId)
      .gte('log_date', from)
      .lte('log_date', to)
      .then(({ data }) => {
        if (!alive) return
        const map = {}
        for (const r of (data || [])) { map[r.log_date] = (map[r.log_date] || 0) + Number(r.calories || 0) }
        setLogsByDay(map)
      })
    return () => { alive = false }
  }, [userId, days])

  // Full plan (BMR/TDEE/target/energy) from the already-fetched calorie plan.
  const result = useMemo(() => {
    if (!plan || !profile) return null
    try { return calcFullPlan(profile, plan) } catch { return null }
  }, [plan, profile])
  const target = result?.dailyTarget ?? null

  // Shapes for the shared graph: days -> [{iso}], logsByDay -> {iso:{calories}}.
  const trendDays = useMemo(() => days.map(iso => ({ iso })), [days])
  const trendLogs = useMemo(() => {
    const o = {}
    for (const [k, v] of Object.entries(logsByDay || {})) o[k] = { calories: v }
    return o
  }, [logsByDay])

  const stats = useMemo(() => {
    if (!result) return []
    const eb = Math.round(result.energyAdj)
    const isLoss = eb < 0 // mobile: deficit -> emerald + down arrow, surplus -> blue + up arrow
    return [
      { label: 'Daily target', value: result.dailyTarget, unit: 'kcal', tint: 'text-red-400' },
      { label: 'BMR', value: Math.round(result.bmr), unit: 'kcal', tint: 'text-foreground' },
      { label: 'TDEE', value: Math.round(result.tdee), unit: 'kcal', tint: 'text-foreground' },
      { label: 'Energy balance', value: `${eb > 0 ? '+' : ''}${eb}`, unit: 'kcal', tint: isLoss ? 'text-emerald-400' : 'text-blue-400', icon: isLoss ? TrendingDown : TrendingUp },
    ]
  }, [result])

  const hasLogs = logsByDay && Object.keys(logsByDay).length > 0

  return (
    <SnapshotCard icon={Apple} iconTint="text-red-400" title="Calories" onViewAll={onViewAll}>
      {logsByDay === null ? (
        <SnapshotLoading />
      ) : !hasLogs ? (
        <SnapshotEmpty>No food logged in the last 14 days.</SnapshotEmpty>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-3 flex items-center">
            <CalorieTrendGraph days={trendDays} logs={trendLogs} dailyTarget={target} />
          </div>
          <StatStrip stats={stats} />
        </>
      )}
    </SnapshotCard>
  )
}
