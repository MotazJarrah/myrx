/**
 * ═══════════════════════════════════════════════════════════════════
 * APEX CALCULATORS
 * Sports-science grade projection library.
 *
 * STRENGTH: 1RM estimation using the average of Epley, Brzycki, and
 *           Lombardi formulas — more robust than any single formula.
 *
 * CARDIO:   Pace projection using Peter Riegel's endurance formula
 *           (1977), T2 = T1 * (D2/D1)^1.06.
 *
 * BODYWEIGHT: Same RM logic as strength, with rep-only unit.
 *
 * CALORIES: Standard MET (Metabolic Equivalent of Task) formula —
 *           kcal = MET * weight(kg) * hours.
 *
 * All functions are pure; no side effects.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── STRENGTH: Rep-Max Projections ──────────────────────────────────

export type Unit = "lbs" | "kg";

/** Epley (1985):  1RM = w * (1 + r/30) */
export function epley(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Brzycki (1993): 1RM = w * 36 / (37 - r). Valid for r <= 10. */
export function brzycki(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps >= 37) return weight; // avoid div-by-zero / nonsense
  return (weight * 36) / (37 - reps);
}

/** Lombardi (1989): 1RM = w * r^0.10 */
export function lombardi(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * Math.pow(reps, 0.1);
}

/**
 * Best-estimate 1RM — average of three formulas.
 * Averaging reduces model bias any single formula carries.
 */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return 0;
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  const r = Math.min(reps, 15); // accuracy degrades above ~12 reps; cap at 15
  return (epley(weight, r) + brzycki(weight, r) + lombardi(weight, r)) / 3;
}

/**
 * Given a target RM (e.g. 3RM), compute the weight at that rep count.
 * Works by inverting Epley/Brzycki/Lombardi and averaging.
 * For rep=1, returns the 1RM directly.
 */
export function weightForRepMax(oneRepMax: number, targetReps: number): number {
  if (!Number.isFinite(oneRepMax) || oneRepMax <= 0) return 0;
  if (targetReps <= 0) return 0;
  if (targetReps === 1) return oneRepMax;
  const r = Math.min(targetReps, 15);
  // Invert each formula:
  const wEpley = oneRepMax / (1 + r / 30);
  const wBrzycki = (oneRepMax * (37 - r)) / 36;
  const wLombardi = oneRepMax / Math.pow(r, 0.1);
  return (wEpley + wBrzycki + wLombardi) / 3;
}

export interface RepMaxRow {
  reps: number;
  weight: number;
  percentOfMax: number;
}

/** Generate a full 1RM → 10RM (or any range) projection table. */
export function buildRepMaxTable(weight: number, reps: number, maxReps = 10): RepMaxRow[] {
  const oneRm = estimateOneRepMax(weight, reps);
  if (oneRm <= 0) return [];
  const rows: RepMaxRow[] = [];
  for (let r = 1; r <= maxReps; r++) {
    const w = weightForRepMax(oneRm, r);
    rows.push({
      reps: r,
      weight: w,
      percentOfMax: (w / oneRm) * 100,
    });
  }
  return rows;
}

/** Typical strength-training percentage-of-1RM table (for display) */
export const PERCENT_RM_GUIDE: Array<{ pct: number; reps: string; zone: string }> = [
  { pct: 100, reps: "1", zone: "Max" },
  { pct: 95, reps: "2", zone: "Max" },
  { pct: 92, reps: "3", zone: "Strength" },
  { pct: 89, reps: "4", zone: "Strength" },
  { pct: 86, reps: "5", zone: "Strength" },
  { pct: 83, reps: "6", zone: "Hypertrophy" },
  { pct: 81, reps: "7", zone: "Hypertrophy" },
  { pct: 78, reps: "8", zone: "Hypertrophy" },
  { pct: 76, reps: "9", zone: "Hypertrophy" },
  { pct: 74, reps: "10", zone: "Hypertrophy / Endurance" },
];

/** Convert between lbs and kg */
export function convertWeight(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return from === "lbs" ? value * 0.45359237 : value / 0.45359237;
}

// ─── CARDIO: Pace & Distance Projections ────────────────────────────

export type DistanceUnit = "m" | "km" | "mi";

/** Convert any distance to meters */
export function toMeters(value: number, unit: DistanceUnit): number {
  if (unit === "m") return value;
  if (unit === "km") return value * 1000;
  return value * 1609.344; // miles
}

/** Convert meters to desired unit */
export function fromMeters(meters: number, unit: DistanceUnit): number {
  if (unit === "m") return meters;
  if (unit === "km") return meters / 1000;
  return meters / 1609.344;
}

/** Parse "mm:ss" or "h:mm:ss" into seconds. Accepts plain seconds too. */
export function parseTime(input: string): number {
  const s = input.trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/** Format seconds into h:mm:ss or mm:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${Math.floor(m)}:${pad(s)}`;
}

/** Format pace into m:ss per unit */
export function formatPace(secondsPerUnit: number): string {
  return formatTime(secondsPerUnit);
}

/**
 * Riegel's formula (1977): Predicts time at a new distance given a known
 * time/distance, using a fatigue coefficient of 1.06. Highly accurate for
 * distances from 800m to marathon.
 *   T2 = T1 * (D2/D1)^1.06
 */
export function riegelTime(
  knownDistanceM: number,
  knownTimeS: number,
  targetDistanceM: number,
  fatigueCoeff = 1.06,
): number {
  if (knownDistanceM <= 0 || knownTimeS <= 0 || targetDistanceM <= 0) return 0;
  return knownTimeS * Math.pow(targetDistanceM / knownDistanceM, fatigueCoeff);
}

/** Inverse Riegel: required pace (s/km) to achieve target time at target distance */
export function requiredPacePerKm(targetDistanceM: number, targetTimeS: number): number {
  if (targetDistanceM <= 0) return 0;
  return (targetTimeS / targetDistanceM) * 1000;
}

export interface CardioProjection {
  label: string;
  distanceM: number;
  timeS: number;
  paceSecPerKm: number;
  paceSecPer500m: number;
  paceSecPerMile: number;
  speedKmh: number;
  speedMph: number;
}

/** Standard projection distances, selected by activity type. */
const RUN_DISTANCES = [
  { label: "400 m", m: 400 },
  { label: "800 m", m: 800 },
  { label: "1 km", m: 1000 },
  { label: "1 mile", m: 1609.344 },
  { label: "5 km", m: 5000 },
  { label: "10 km", m: 10000 },
  { label: "Half Marathon", m: 21097.5 },
  { label: "Marathon", m: 42195 },
];

const ROW_DISTANCES = [
  { label: "500 m", m: 500 },
  { label: "1000 m", m: 1000 },
  { label: "2000 m", m: 2000 },
  { label: "5000 m", m: 5000 },
  { label: "6000 m", m: 6000 },
  { label: "10,000 m", m: 10000 },
  { label: "Half Marathon", m: 21097.5 },
  { label: "Marathon", m: 42195 },
];

const CYCLE_DISTANCES = [
  { label: "1 km", m: 1000 },
  { label: "5 km", m: 5000 },
  { label: "10 km", m: 10000 },
  { label: "20 km", m: 20000 },
  { label: "40 km", m: 40000 },
  { label: "100 km", m: 100000 },
  { label: "Century (100 mi)", m: 160934 },
];

const SWIM_DISTANCES = [
  { label: "50 m", m: 50 },
  { label: "100 m", m: 100 },
  { label: "200 m", m: 200 },
  { label: "400 m", m: 400 },
  { label: "800 m", m: 800 },
  { label: "1500 m", m: 1500 },
];

export type CardioMode = "run" | "row" | "cycle" | "swim" | "walk";

export function distancesForMode(mode: CardioMode) {
  switch (mode) {
    case "row":
      return ROW_DISTANCES;
    case "cycle":
      return CYCLE_DISTANCES;
    case "swim":
      return SWIM_DISTANCES;
    default:
      return RUN_DISTANCES;
  }
}

/** Fatigue coefficients tuned per modality (rowing ~1.05, swim ~1.03) */
export function fatigueCoeffFor(mode: CardioMode): number {
  switch (mode) {
    case "row":
      return 1.05;
    case "swim":
      return 1.03;
    case "cycle":
      return 1.04;
    case "walk":
      return 1.01;
    default:
      return 1.06; // run default
  }
}

/** Build full projection across reference distances for the given mode. */
export function buildCardioProjections(
  knownDistanceM: number,
  knownTimeS: number,
  mode: CardioMode,
): CardioProjection[] {
  if (knownDistanceM <= 0 || knownTimeS <= 0) return [];
  const coeff = fatigueCoeffFor(mode);
  const dists = distancesForMode(mode);
  return dists.map(({ label, m }) => {
    const t = riegelTime(knownDistanceM, knownTimeS, m, coeff);
    const paceKm = (t / m) * 1000;
    const pace500 = (t / m) * 500;
    const paceMi = (t / m) * 1609.344;
    const speedKmh = m / 1000 / (t / 3600);
    const speedMph = m / 1609.344 / (t / 3600);
    return {
      label,
      distanceM: m,
      timeS: t,
      paceSecPerKm: paceKm,
      paceSecPer500m: pace500,
      paceSecPerMile: paceMi,
      speedKmh,
      speedMph,
    };
  });
}

// ─── TARGET: "Given I want X distance in Y time, what pace?" ────────

export interface TargetProjection {
  requiredTimeS: number;
  requiredPaceSecPerKm: number;
  requiredPaceSecPer500m: number;
  requiredPaceSecPerMile: number;
  currentTimeS: number;
  deltaS: number; // positive = need to improve
  percentImprovement: number; // positive = need to get faster
}

export function buildTargetProjection(
  knownDistanceM: number,
  knownTimeS: number,
  targetDistanceM: number,
  targetTimeS: number,
  mode: CardioMode,
): TargetProjection {
  const coeff = fatigueCoeffFor(mode);
  const currentPredictedTime = riegelTime(knownDistanceM, knownTimeS, targetDistanceM, coeff);
  const requiredTimeS = targetTimeS > 0 ? targetTimeS : currentPredictedTime;
  const requiredPaceKm = (requiredTimeS / targetDistanceM) * 1000;
  const requiredPace500 = (requiredTimeS / targetDistanceM) * 500;
  const requiredPaceMi = (requiredTimeS / targetDistanceM) * 1609.344;
  const delta = currentPredictedTime - requiredTimeS;
  const pct = currentPredictedTime > 0 ? (delta / currentPredictedTime) * 100 : 0;
  return {
    requiredTimeS,
    requiredPaceSecPerKm: requiredPaceKm,
    requiredPaceSecPer500m: requiredPace500,
    requiredPaceSecPerMile: requiredPaceMi,
    currentTimeS: currentPredictedTime,
    deltaS: delta,
    percentImprovement: pct,
  };
}

// ─── CALORIES: MET-based estimation ─────────────────────────────────

/** MET values sourced from the Compendium of Physical Activities (Ainsworth et al.) */
export const MET_VALUES: Record<string, number> = {
  "walking (3.5 mph)": 4.3,
  "walking (4 mph, brisk)": 5.0,
  "running (5 mph / 12 min/mi)": 8.3,
  "running (6 mph / 10 min/mi)": 9.8,
  "running (7 mph / 8.5 min/mi)": 11.0,
  "running (8 mph / 7.5 min/mi)": 11.8,
  "running (9 mph / 6.5 min/mi)": 12.8,
  "running (10 mph / 6 min/mi)": 14.5,
  "cycling (leisure, 10-12 mph)": 6.8,
  "cycling (moderate, 12-14 mph)": 8.0,
  "cycling (vigorous, 14-16 mph)": 10.0,
  "cycling (racing, 16-20 mph)": 12.0,
  "rowing (moderate)": 7.0,
  "rowing (vigorous)": 8.5,
  "swimming (freestyle, moderate)": 8.3,
  "swimming (freestyle, vigorous)": 10.0,
  "weight training (general)": 3.5,
  "weight training (vigorous)": 6.0,
  "circuit training": 8.0,
  "yoga": 2.5,
  "hiit": 8.0,
  "jump rope": 12.3,
  "stair climbing": 8.8,
  "elliptical": 5.0,
};

export function estimateCalories(met: number, weightKg: number, minutes: number): number {
  if (met <= 0 || weightKg <= 0 || minutes <= 0) return 0;
  return met * weightKg * (minutes / 60);
}
