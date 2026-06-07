// Single source of truth for the per-day heart summary, so the dashboard Heart
// block and the Heart detail page render IDENTICAL data (resting/avg/peak).
//
// Matches AdminUserHeart.summariseByDay's chart formula exactly:
//   resting = lowest NON-workout (ambient) bpm that day; falls back to the day's
//             overall min when every sample is inside a workout.
//   avg     = mean of ALL samples that day (workout + ambient), rounded.
//   peak    = the higher of (the day's max sample) and (any workout max_bpm).
//
// Inputs (last-N-days window, any order):
//   hrSamples: [{ measured_at, bpm, workout_id }]
//   workouts:  [{ start_at, max_bpm }]
// Output: [{ day:'YYYY-MM-DD', resting, avg, peak }] oldest -> newest.

function localDayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10) }

export function summariseHeartDays(hrSamples = [], workouts = []) {
  const byDay = new Map()
  const cell = k => {
    if (!byDay.has(k)) byDay.set(k, { all: [], ambient: [], woMax: null })
    return byDay.get(k)
  }
  for (const s of hrSamples) {
    if (s.bpm == null) continue
    const c = cell(localDayKey(s.measured_at))
    c.all.push(s.bpm)
    if (s.workout_id == null) c.ambient.push(s.bpm)
  }
  for (const w of workouts) {
    if (w.max_bpm == null) continue
    const c = cell(localDayKey(w.start_at))
    c.woMax = Math.max(c.woMax ?? 0, w.max_bpm)
  }
  return [...byDay.entries()]
    .filter(([, c]) => c.all.length > 0 || c.woMax != null)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, c]) => {
      const resting = c.ambient.length ? Math.min(...c.ambient) : (c.all.length ? Math.min(...c.all) : null)
      const avg = c.all.length ? Math.round(c.all.reduce((a, b) => a + b, 0) / c.all.length) : null
      const sampleMax = c.all.length ? Math.max(...c.all) : null
      const peak = c.woMax != null ? Math.max(sampleMax ?? 0, c.woMax) : sampleMax
      return { day, resting, avg, peak }
    })
}
