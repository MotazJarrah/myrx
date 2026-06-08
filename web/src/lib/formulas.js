// 1RM estimation formulas (averaged)
export function estimate1RM(weight, reps) {
  if (reps === 1) return weight
  const epley = weight * (1 + reps / 30)
  const brzycki = weight * (36 / (37 - reps))
  const lombardi = weight * Math.pow(reps, 0.1)
  return Math.round((epley + brzycki + lombardi) / 3)
}

export function projectAllRMs(weight, reps) {
  const oneRM = estimate1RM(weight, reps)
  return Array.from({ length: 10 }, (_, i) => {
    const r = i + 1
    if (r === 1) return { reps: 1, weight: oneRM }
    // Invert each formula to project the weight you can lift for r reps
    const brzycki  = oneRM * (37 - r) / 36      // inverse Brzycki
    const epley    = oneRM / (1 + r / 30)        // inverse Epley
    const lombardi = oneRM / Math.pow(r, 0.1)   // inverse Lombardi
    return { reps: r, weight: Math.round((brzycki + epley + lombardi) / 3) }
  })
}

// ─── Pace projections (Riegel formula) ───────────────────────────────────────
// distanceKm  – the distance of the known effort in km
// timeSecs    – the time of the known effort in seconds
// distances   – array of { name: string, km: number } to project onto

function fmtTimeSecs(totalSecs) {
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function projectPaces(distanceKm, timeSecs, distances) {
  const dists = distances ?? [
    { name: '1 km',          km: 1 },
    { name: '5 km',          km: 5 },
    { name: '10 km',         km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
  return dists.map(({ name, km }) => {
    const projectedSecs = timeSecs * Math.pow(km / distanceKm, 1.06)
    const paceSecPerKm  = projectedSecs / km
    const pMins = Math.floor(paceSecPerKm / 60)
    const pSecs = Math.round(paceSecPerKm % 60)
    return {
      name,
      km,
      timeSecs: Math.round(projectedSecs),
      time:     fmtTimeSecs(Math.round(projectedSecs)),
      pace:     `${pMins}:${String(pSecs).padStart(2, '0')}/km`,
      paceSecPerKm,
    }
  })
}

