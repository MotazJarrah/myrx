/**
 * Weight Goal Progress — shared row-building + classification logic for the
 * admin and coach Weight Goal Progress pages.
 *
 * Both pages render the SAME list (AdminProgress + the upcoming CoachProgress
 * mirror), so the per-client math lives here once: status classification,
 * recent rate of weight change, target rate from the plan, ETA, sparkline
 * points. The page is responsible only for fetching the right client set
 * (admin = all clients; coach = own clients) and passing the viewer's
 * preferred weight unit for display.
 *
 * Stored weights are kg (calorie_plans.starting_weight_kg / goal_weight_kg)
 * and the bodyweight log keeps its own unit per row — everything is
 * normalised to kg here, then converted to the viewer's unit at render time
 * by the list component.
 */

import { calcEnergyAdjustment, toKg } from './calorieFormulas'
import { hydrateEmails } from './hydrateEmails'

const KCAL_PER_KG = 7700

// Tunable thresholds (surfaced here so they're easy to retune after the
// page is live and the user has eyeballed real client data).
export const STALE_DAYS       = 14   // no weigh-in in this many days → "No recent weigh-in"
const RATE_WINDOW_DAYS        = 42   // trend rate is fit over the last 6 weeks of weigh-ins
const FLAT_EPS_KG_WK          = 0.05 // |rate| below this reads as "flat" (Stalled)
const ON_TRACK_FACTOR         = 0.6  // moving toward goal at ≥60% of plan pace = On track, else Slow

// ── Unit display helpers ────────────────────────────────────────────────────

/** kg → viewer's unit, rounded to 0.1. Returns null for null input. */
export function fromKg(kg, unit) {
  if (kg == null || isNaN(kg)) return null
  const v = unit === 'lb' ? kg / 0.453592 : kg
  return Math.round(v * 10) / 10
}

/** "72.6 kg" / "160 lb" / "—" */
export function fmtWeight(kg, unit) {
  const v = fromKg(kg, unit)
  return v == null ? '—' : `${v} ${unit}`
}

/** Signed weekly rate in the viewer's unit, e.g. "−0.4 kg/wk", "+0.3 lb/wk". */
export function fmtRate(kgPerWeek, unit) {
  if (kgPerWeek == null || isNaN(kgPerWeek)) return null
  const v = unit === 'lb' ? kgPerWeek / 0.453592 : kgPerWeek
  const r = Math.round(Math.abs(v) * 10) / 10
  const sign = v > 0.05 ? '+' : (v < -0.05 ? '−' : '±')
  return `${sign}${r} ${unit}/wk`
}

// ── Progress fraction + softened color ──────────────────────────────────────

/** 0..1 fraction of the start→goal distance covered. */
export function progressFraction(start, current, goal) {
  if (start == null || current == null || goal == null) return 0
  if (Math.abs(goal - start) < 0.01) return current === goal ? 1 : 0
  const p = (start - current) / (start - goal)
  return Math.max(0, Math.min(1, p))
}

/**
 * Softened progress color (replaces the old red→green ramp). Desaturated and
 * lifted, with the low end starting at a muted amber (hue 30) instead of
 * alarm-red (hue 0) — so a client at 0% reads as "early," not "failing."
 */
export function softProgressColor(p) {
  const c = Math.max(0, Math.min(1, p))
  const hue = Math.round(30 + c * 112) // 30 (soft amber) → 142 (green)
  return `hsl(${hue}, 50%, 56%)`
}

// ── Trend rate (least-squares slope over the recent window) ─────────────────

function slopeKgPerDay(points) {
  const n = points.length
  if (n < 2) return null
  const t0 = points[0].t
  const xs = points.map(p => (p.t - t0) / 86_400_000) // days since first point
  const ys = points.map(p => p.kg)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return null
  return num / den
}

// ── Status classification ────────────────────────────────────────────────────

function classify({ goalReached, direction, currentKg, goalKg, actualRateKgWk, targetRateKgWk, recencyDays }) {
  const atGoal = currentKg != null && goalKg != null && (
    (direction === 'loss'     && currentKg <= goalKg) ||
    (direction === 'gain'     && currentKg >= goalKg) ||
    (direction === 'maintain' && Math.abs(currentKg - goalKg) < 0.3)
  )
  if (goalReached || atGoal) return 'reached'

  if (recencyDays == null || recencyDays > STALE_DAYS) return 'no_recent'

  // Recent weigh-in, but not enough history in the window to fit a trend.
  if (actualRateKgWk == null) return 'new'

  const away = (direction === 'loss' && actualRateKgWk >  FLAT_EPS_KG_WK) ||
               (direction === 'gain' && actualRateKgWk < -FLAT_EPS_KG_WK)
  if (away) return 'off_track'

  if (Math.abs(actualRateKgWk) <= FLAT_EPS_KG_WK) return 'stalled'

  // Moving toward goal — fast enough vs the plan's target rate?
  if (targetRateKgWk != null && Math.abs(targetRateKgWk) > 0.01) {
    return Math.abs(actualRateKgWk) >= ON_TRACK_FACTOR * Math.abs(targetRateKgWk) ? 'on_track' : 'slow'
  }
  return 'on_track'
}

export const STATUS_META = {
  reached:   { label: 'Reached',            chip: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
  on_track:  { label: 'On track',           chip: 'bg-green-500/10 border-green-500/20 text-green-400'       },
  slow:      { label: 'Slow',               chip: 'bg-amber-500/10 border-amber-500/20 text-amber-400'       },
  stalled:   { label: 'Stalled',            chip: 'bg-muted border-border text-muted-foreground'             },
  off_track: { label: 'Off track',          chip: 'bg-red-500/10 border-red-500/20 text-red-400'             },
  no_recent: { label: 'No recent weigh-in', chip: 'bg-muted/40 border-border text-muted-foreground'          },
  new:       { label: 'Getting started',    chip: 'bg-blue-500/10 border-blue-500/20 text-blue-400'          },
}

/** Sparkline stroke color, keyed to the status (subtle, muted for neutral). */
export function sparkColor(status) {
  switch (status) {
    case 'reached':   return 'hsl(160 60% 50%)'
    case 'on_track':  return 'hsl(142 55% 50%)'
    case 'slow':      return 'hsl(38 90% 55%)'
    case 'off_track': return 'hsl(0 70% 58%)'
    default:          return 'hsl(220 9% 55%)' // stalled / no_recent / new
  }
}

// ── Row builder ──────────────────────────────────────────────────────────────

/**
 * Build one progress row from a client profile (as returned by
 * get_users_for_admin / the coach equivalent), their plan, and their
 * bodyweight history (ascending by created_at).
 */
export function buildProgressRow(user, plan, bwRowsAsc, now = Date.now()) {
  const startKg = plan?.starting_weight_kg != null ? Number(plan.starting_weight_kg) : null
  const goalKg  = plan?.goal_weight_kg     != null ? Number(plan.goal_weight_kg)     : null

  const points = (bwRowsAsc || [])
    .map(b => ({ t: new Date(b.created_at).getTime(), kg: toKg(Number(b.weight), b.unit) }))
    .filter(p => p.kg != null && !isNaN(p.kg) && !isNaN(p.t))

  const latest = points.length ? points[points.length - 1] : null
  const currentKg = latest
    ? latest.kg
    : (user.current_weight != null ? toKg(Number(user.current_weight), user.weight_unit || 'lb') : null)

  const prog = plan?.goal_reached ? 1 : progressFraction(startKg, currentKg, goalKg)

  const direction = (startKg != null && goalKg != null)
    ? (goalKg < startKg ? 'loss' : (goalKg > startKg ? 'gain' : 'maintain'))
    : 'loss'

  // Target weekly rate from the plan's daily energy adjustment.
  let targetRateKgWk = null
  try {
    const energyAdj = calcEnergyAdjustment(
      {
        current_weight: user.current_weight, weight_unit: user.weight_unit,
        current_height: user.current_height, height_unit: user.height_unit,
        gender: user.gender, birthdate: user.birthdate,
      },
      plan,
    )
    if (energyAdj != null) targetRateKgWk = (energyAdj * 7) / KCAL_PER_KG
  } catch { /* missing body data — leave target null, classify on direction only */ }

  // Actual recent rate (least-squares over the trend window).
  const windowStart = now - RATE_WINDOW_DAYS * 86_400_000
  const recent = points.filter(p => p.t >= windowStart)
  const slope = recent.length >= 2 ? slopeKgPerDay(recent) : null
  const actualRateKgWk = slope == null ? null : slope * 7

  const recencyDays = latest ? Math.floor((now - latest.t) / 86_400_000) : null
  const spark = points.slice(-12).map(p => p.kg)

  const status = classify({
    goalReached: !!plan?.goal_reached, direction, currentKg, goalKg,
    actualRateKgWk, targetRateKgWk, recencyDays,
  })

  // ETA in weeks at the current actual pace — only when genuinely moving toward goal.
  let etaWeeks = null
  if (currentKg != null && goalKg != null && actualRateKgWk != null) {
    const toward = (direction === 'loss' && actualRateKgWk < 0) ||
                   (direction === 'gain' && actualRateKgWk > 0)
    if (toward && Math.abs(actualRateKgWk) > FLAT_EPS_KG_WK) {
      etaWeeks = Math.abs(currentKg - goalKg) / Math.abs(actualRateKgWk)
    }
  }

  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    avatar_url: user.avatar_url,
    startKg, goalKg, currentKg, prog, direction,
    targetRateKgWk, actualRateKgWk, recencyDays, spark, status, etaWeeks,
    goal_reached: !!plan?.goal_reached,
  }
}

// ── Scoped data loader (shared by admin + coach pages) ───────────────────────

/**
 * Load the progress rows for the VIEWER's own managed clients only.
 *
 * Scoping is by `profiles.coach_id = viewerId` — the single rule that serves
 * both surfaces: a coach passes their own id and sees their roster; an admin
 * passes their own id and sees the clients THEY manage (admin-managed =
 * coach_id = admin's user_id). The platform's other coaches' clients and
 * self-coached users never appear. RLS independently enforces the same scope
 * on calorie_plans / bodyweight ("Coaches see roster …" policies), so a coach
 * only ever reads their own clients' rows.
 *
 * Deactivated + anonymized profiles are excluded (mirrors CoachClients).
 * Emails are hydrated via the SECURITY DEFINER RPC (profiles has no email
 * column). Returns rows alphabetical by name, filtered to clients with a plan.
 */
export async function loadWeightGoalRows(supabase, viewerId) {
  if (!viewerId) return []

  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, gender, birthdate, current_weight, weight_unit, current_height, height_unit')
    .eq('coach_id', viewerId)
    .is('deactivated_at', null)
    .is('anonymized_at', null)

  if (error || !profs || profs.length === 0) return []

  const clients = await hydrateEmails(supabase, profs)
  const ids = clients.map(c => c.id)

  const [plansRes, bwRes] = await Promise.all([
    supabase.from('calorie_plans')
      .select('user_id, starting_weight_kg, goal_weight_kg, goal_reached, energy_balance_type, energy_balance_pct, activity_factor')
      .in('user_id', ids),
    supabase.from('bodyweight')
      .select('user_id, weight, unit, created_at')
      .in('user_id', ids)
      .order('created_at', { ascending: true }),
  ])

  const planMap = {}
  ;(plansRes.data || []).forEach(p => { planMap[p.user_id] = p })

  const bwByUser = {}
  ;(bwRes.data || []).forEach(b => { (bwByUser[b.user_id] ||= []).push(b) })

  return clients
    .filter(u => planMap[u.id])
    .map(u => buildProgressRow(u, planMap[u.id], bwByUser[u.id] || []))
    .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''))
}
