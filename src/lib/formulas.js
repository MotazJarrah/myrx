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
    const w = Math.round(oneRM * (36 / (37 - r)))
    return { reps: r, weight: w }
  })
}

// Pace projections using Riegel formula
export function projectPaces(distanceKm, timeMinutes) {
  const distances = [
    { name: '1 km', km: 1 },
    { name: '5 km', km: 5 },
    { name: '10 km', km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon', km: 42.195 },
  ]
  return distances.map(({ name, km }) => {
    const projected = timeMinutes * Math.pow(km / distanceKm, 1.06)
    const mins = Math.floor(projected)
    const secs = Math.round((projected - mins) * 60)
    const pacePerKm = projected / km
    const pMins = Math.floor(pacePerKm)
    const pSecs = Math.round((pacePerKm - pMins) * 60)
    return {
      name,
      km,
      time: `${mins}:${String(secs).padStart(2, '0')}`,
      pace: `${pMins}:${String(pSecs).padStart(2, '0')}/km`,
    }
  })
}

// Calorie burn estimate
export function estimateCalories(met, weightKg, durationMins) {
  return Math.round((met * weightKg * durationMins) / 60)
}
