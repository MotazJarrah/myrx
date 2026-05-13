/**
 * Performance projections — pure math used to derive a full strength /
 * cardio profile from a single logged effort.
 *
 * All weights internally use kilograms; conversion happens at I/O
 * boundaries (slider input + display output) so the formulas don't have
 * to care about units. Same idea as how databases store UTC and the UI
 * renders local time — single source of truth, conversion at the edge.
 *
 * The 1RM math is the average of two well-known formulas:
 *   • Epley:    1RM = w × (1 + r/30)
 *   • Brzycki:  1RM = w / (1.0278 − 0.0278r)
 * Epley overestimates above ~10 reps; Brzycki under-estimates above ~12.
 * Blending the two gives a more honest curve in the 1–12 rep band that
 * matters for most lifters.
 *
 * Comparable-lift ratios are rough averages from public lifting databases
 * (Strength Standards, Symmetric Strength) for intermediate lifters.
 * Real ratios vary by body proportions and training history; we surface
 * them as "expected" numbers so the user has a baseline to react to —
 * "I'm benching 200 but my projected squat is 260 and I can only do 200,
 * so my legs are lagging" — that's the value of showing them.
 */

const LB_PER_KG = 2.20462;

// ── Unit conversion ────────────────────────────────────────────────────
export const lbToKg = (lb) => lb / LB_PER_KG;
export const kgToLb = (kg) => kg * LB_PER_KG;

// ── 1RM estimates ──────────────────────────────────────────────────────
export function epley1RM(weight, reps) {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function brzycki1RM(weight, reps) {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  // Above ~12 reps the denominator approaches 0 and the formula explodes;
  // Epley alone is more honest in that range.
  if (reps >= 13) return epley1RM(weight, reps);
  return weight / (1.0278 - 0.0278 * reps);
}

/** Blended 1RM — Epley + Brzycki averaged. Most accurate for 1–10 reps. */
export function estimate1RM(weight, reps) {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return (epley1RM(weight, reps) + brzycki1RM(weight, reps)) / 2;
}

/** Inverse Epley — predict the load achievable for N reps given an estimated 1RM. */
export function loadForReps(oneRM, reps) {
  if (oneRM <= 0 || reps <= 0) return 0;
  if (reps <= 1) return oneRM;
  return oneRM / (1 + reps / 30);
}

/**
 * Build a rep-max table from a single effort.
 * Returns [{reps, weight}, …] for the standard 1/3/5/8/10/12 RM grid.
 */
export function repMaxCurve(weight, reps) {
  const oneRM = estimate1RM(weight, reps);
  return [1, 3, 5, 8, 10, 12].map((r) => ({
    reps: r,
    weight: r === 1 ? oneRM : loadForReps(oneRM, r),
  }));
}

// ── Comparable lift ratios ─────────────────────────────────────────────
// All ratios expressed relative to bench press 1RM = 1.0 for an
// intermediate lifter. Sources: Symmetric Strength (50th percentile data),
// Strength Standards. These are AVERAGES — individuals diverge widely.
export const LIFT_RATIOS_VS_BENCH = Object.freeze({
  bench:    1.00,
  squat:    1.30,
  deadlift: 1.50,
  ohp:      0.65,
  row:      0.90,
});

/**
 * Predict equivalent 1RMs in other lifts based on a single source 1RM.
 * Returns an array of {lift, weight} sorted by predicted weight desc.
 */
export function comparableLifts(sourceLift, sourceOneRM) {
  const sourceRatio = LIFT_RATIOS_VS_BENCH[sourceLift];
  if (!sourceRatio || sourceOneRM <= 0) return [];

  // Convert source 1RM → bench-equivalent → other lifts
  const benchEquivalent = sourceOneRM / sourceRatio;

  return Object.entries(LIFT_RATIOS_VS_BENCH)
    .filter(([lift]) => lift !== sourceLift)
    .map(([lift, ratio]) => ({
      lift,
      weight: benchEquivalent * ratio,
    }))
    .sort((a, b) => b.weight - a.weight);
}

// ── Training-zone classification ───────────────────────────────────────
// What zone is the user training in based on the rep count of their set?
// Useful for the demo's "what this means" interpretation.
export function trainingZone(reps) {
  if (reps <= 5)  return { zone: 'strength',    desc: 'Heavy load, low reps. Good for raw force production.' };
  if (reps <= 12) return { zone: 'hypertrophy', desc: 'Moderate load, moderate reps. Best for muscle growth.' };
  return { zone: 'endurance', desc: 'Lighter load, high reps. Builds muscular endurance.' };
}

// ── Cardio: Riegel projection ──────────────────────────────────────────
// Predict race time at a different distance from a known result.
// t2 = t1 × (d2 / d1)^1.06 — the 1.06 fatigue exponent works well from
// 800 m up to the marathon. Underestimates at very short or very long.
export function riegelProjection(timeSeconds, fromDistanceMeters, toDistanceMeters) {
  if (timeSeconds <= 0 || fromDistanceMeters <= 0 || toDistanceMeters <= 0) return 0;
  return timeSeconds * Math.pow(toDistanceMeters / fromDistanceMeters, 1.06);
}

/** Format seconds → "MM:SS" or "H:MM:SS" for display. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
