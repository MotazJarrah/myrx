// Single source of truth for the per-day heart summary, so the dashboard Heart
// block and the Heart detail page render IDENTICAL data to each other AND to the
// mobile HrRangeChart. Ports mobile heart.tsx's summariseByDay exactly:
//
//   resting    = lowest NON-workout (ambient) bpm; falls back to the day's min.
//   avg        = mean of ALL samples that day, rounded.
//   peak       = the higher of (the day's max sample) and (any workout max_bpm).
//   timeInZone = per-zone sample/second counts, summed across every workout
//                (per-second hr_log when present, else an aggregate approximation
//                from min/avg/max/duration) PLUS the ambient samples. This is
//                what drives the band's colour-by-time-in-zone gradient.
//
// Returns the last `days` calendar days (padded, oldest -> newest) so the column
// count matches mobile.

function localDayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10) }

// Classify a bpm into a zone bucket and add `weight` to it (mutates buckets).
function addToZone(b, bpm, hrMax, weight) {
  const z1Lo = hrMax * 0.50, z2Lo = hrMax * 0.60, z3Lo = hrMax * 0.70, z4Lo = hrMax * 0.80, z5Lo = hrMax * 0.90
  if (bpm < z1Lo) b.belowZ1 += weight
  else if (bpm < z2Lo) b.z1 += weight
  else if (bpm < z3Lo) b.z2 += weight
  else if (bpm < z4Lo) b.z3 += weight
  else if (bpm < z5Lo) b.z4 += weight
  else b.z5 += weight
}
function bucketHrLog(hrLog, hrMax) {
  const b = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  for (const bpm of hrLog) addToZone(b, bpm, hrMax, 1)
  return b
}
// No per-second log: distribute duration across min/avg/max so the synthetic
// mean matches avg (w_avg=0.5, w_min=(max-avg)/(2*range) clamped, w_max=0.5-w_min).
function approximateZonesFromAggregates(minBpm, avgBpm, maxBpm, durationS, hrMax) {
  const b = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  if (durationS <= 0) return b
  const range = maxBpm - minBpm
  if (range <= 0) { addToZone(b, avgBpm, hrMax, durationS); return b }
  const wMin = Math.max(0, Math.min(0.5, (maxBpm - avgBpm) / (2 * range)))
  const wMax = 0.5 - wMin
  addToZone(b, minBpm, hrMax, durationS * wMin)
  addToZone(b, avgBpm, hrMax, durationS * 0.5)
  addToZone(b, maxBpm, hrMax, durationS * wMax)
  return b
}

export function summariseHeartDays(hrSamples = [], workouts = [], hrMax = 180, days = 7) {
  const byDay = new Map()
  const cell = k => {
    if (!byDay.has(k)) byDay.set(k, { all: [], ambient: [], wos: [] })
    return byDay.get(k)
  }
  for (const s of hrSamples) {
    if (s.bpm == null) continue
    const c = cell(localDayKey(s.measured_at))
    c.all.push(s.bpm)
    if (s.workout_id == null) c.ambient.push(s.bpm)
  }
  for (const w of workouts) cell(localDayKey(w.start_at)).wos.push(w)

  function summarise(key) {
    const c = byDay.get(key)
    if (!c || (c.all.length === 0 && c.wos.length === 0)) {
      return { day: key, resting: null, avg: null, peak: null, timeInZone: null }
    }
    const all = c.all
    const resting = c.ambient.length ? Math.min(...c.ambient) : (all.length ? Math.min(...all) : null)
    const avg = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null
    const sampleMax = all.length ? Math.max(...all) : null
    let woMax = null
    for (const w of c.wos) if (w.max_bpm != null && w.max_bpm > 0) woMax = Math.max(woMax ?? 0, w.max_bpm)
    const peak = woMax != null ? Math.max(sampleMax ?? 0, woMax) : sampleMax

    let tz = null
    const ensure = () => { if (!tz) tz = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, belowZ1: 0 }; return tz }
    const add = b => { const t = ensure(); t.z1 += b.z1; t.z2 += b.z2; t.z3 += b.z3; t.z4 += b.z4; t.z5 += b.z5; t.belowZ1 += b.belowZ1 }
    for (const w of c.wos) {
      const log = w.raw_meta?.hr_log
      if (Array.isArray(log) && log.length > 0) add(bucketHrLog(log, hrMax))
      else if (w.min_bpm > 0 && w.avg_bpm > 0 && w.max_bpm > 0 && w.duration_s > 0) {
        add(approximateZonesFromAggregates(w.min_bpm, w.avg_bpm, w.max_bpm, w.duration_s, hrMax))
      }
    }
    if (all.length > 0) add(bucketHrLog(all, hrMax))

    return { day: key, resting, avg, peak, timeInZone: tz }
  }

  // Last `days` calendar days, oldest -> newest (padded like mobile's dailyFull).
  const base = new Date(); base.setHours(0, 0, 0, 0)
  const keys = []
  for (let off = days - 1; off >= 0; off--) { const d = new Date(base); d.setDate(base.getDate() - off); keys.push(localDayKey(d)) }
  return keys.map(summarise)
}
