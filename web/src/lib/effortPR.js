/**
 * Effort-PR parsing helpers — shared across the admin + coach client-detail
 * views (AdminUserDetail / CoachClientDetail) and the coach dashboard
 * (CoachDashboard). Extracted Jun 9 2026 (T162) from three byte-identical
 * copies. Mirrors the mobile dashboard's parsing (mobile/app/(app)/dashboard.tsx).
 */

/** Strength 1RM parser — pulls the projected 1RM out of a strength effort's
 *  stored value (e.g. "Est. 1RM 370 lb" → 370). Returns null when absent.
 *  Matches mobile's parseEffort1RM (regex + return shape). */
export function parse1RM(v) {
  const m = v?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

/** Cardio direction-aware best parser. Returns { val, lowerBetter } so callers
 *  pick the right min/max direction per activity:
 *    • Pace activities (e.g. "5:30/km", "1:55/500m") → lower is better
 *    • Speed / rate / distance activities → higher is better
 *  The `\b` after the unit alternation prevents "/min" (cal/min, floors/min)
 *  from being misread as pace via the "/mi" substring. */
export function parseCardioBest(v) {
  if (!v) return null
  const isPace = /\/(km|mi|500m|100m)\b/.test(v)
  if (isPace) {
    const m = v.match(/(\d+):(\d+)/)
    if (!m) return null
    return { val: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), lowerBetter: true }
  }
  const m = v.match(/(\d+(?:\.\d+)?)/)
  return m ? { val: parseFloat(m[1]), lowerBetter: false } : null
}

/** Group key for an effort — the exercise / activity name (the part before the
 *  first " · " in the label). Mobile groups PRs by exercise, so all variants
 *  ("Push Up · Barbell", "Push Up · Bodyweight") count as one. */
export function exerciseKey(label) {
  if (!label) return ''
  return label.split(' · ')[0]
}
