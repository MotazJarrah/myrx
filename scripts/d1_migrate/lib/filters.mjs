/**
 * Shared filter library — applied at INSERT time during bulk import AND
 * by the ongoing sync scripts (sync_usda.mjs / sync_on.mjs).
 *
 * Single source of truth for the per-row rules that came out of the
 * 2026-05-14 audit. Approved rules from docs/food_library_filters.md.
 *
 * ── Usage in loaders ───────────────────────────────────────────────────────
 *   const enriched = enrichFood(rawRow)
 *   if (!shouldKeepFood(enriched)) continue
 *   pushRow(enriched)
 *
 * ── Rule evaluation hierarchy (see docs/food_library_filters.md) ──────────
 *
 *   Tier 1 — REPAIR
 *     Rule 9   Backfill missing kcal from macros (4p + 9f + 4c)
 *
 *   Tier 2 — REJECT structurally broken
 *     Rule 5   Wrong-category subtypes (sub_sample_food, agricultural_acquisition)
 *     Rule 1   All four macros null or zero (after Rule 9 repair)
 *     Rule 6   kcal density > 900 per 100g (physically impossible)
 *     Rule 10  Sum of macros > 105g per 100g (impossible mass)
 *     Rule 11  Any single macro > 100g per 100g (impossible mass)
 *
 *   Tier 3 — REJECT internally inconsistent
 *     Rule 4   kcal differs from (4p + 9f + 4c) by > 50%
 *     Rule 7   Per-serving kcal > 3,000 (single-serving impossibility)
 *
 *   Tier 4 — REJECT negligible
 *     Rule 8   Branded entries with per-serving < 5 kcal
 *
 *   Tier 5 — DEDUP (cross-row, runs post-import as DELETEs)
 *     Rule 2   Exact dedup on name + brand + macros + serving_label + upc
 *     Rule 3   Brand-product dedup on name + brand + macros + serving_g
 *
 * If you change a rule in this file, update docs/food_library_filters.md
 * and re-run the cleanup migration. The doc is the spec; this file is
 * its implementation.
 */

// ── Tier 1: REPAIR ───────────────────────────────────────────────────────────

/**
 * Rule 9 — Backfill missing kcal from macros.
 *
 * Returns a new row with `kcal` set to the 4/9/4 prediction when kcal was
 * null but at least one macro is present. Idempotent: rows with a non-null
 * kcal pass through unchanged. Rows with all-null macros pass through
 * unchanged (they'll be caught by Rule 1).
 *
 * Runs BEFORE shouldKeepFood so subsequent rules see a complete row.
 *
 * @param {object} row
 * @returns {object} — same row, possibly with kcal filled in
 */
export function enrichFood(row) {
  const { kcal, protein_g, fat_g, carbs_g } = row
  if (kcal != null) return row
  if (protein_g == null && fat_g == null && carbs_g == null) return row

  const computed =
    (protein_g ?? 0) * 4 +
    (fat_g ?? 0) * 9 +
    (carbs_g ?? 0) * 4
  if (computed <= 0) return row

  return { ...row, kcal: Math.round(computed * 10) / 10 }
}

// ── Tier 2-4: PER-ROW REJECTION ──────────────────────────────────────────────

/**
 * Decide whether a candidate row should be inserted into food_library.
 * Rules are checked in the hierarchy documented at the top of this file.
 * The first matching rule wins; later checks are skipped for that row.
 *
 * NOTE: callers should run `enrichFood()` first so Rule 9's backfill has
 * already happened by the time we evaluate the rejection rules.
 *
 * @param {{
 *   kcal:           number | null,
 *   protein_g:      number | null,
 *   fat_g:          number | null,
 *   carbs_g:        number | null,
 *   serving_g:      number | null,
 *   source_subtype: string | null,
 * }} row
 * @returns {boolean}  true if row should be kept, false to filter out
 */
export function shouldKeepFood(row) {
  const { kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  // ── Tier 2: REJECT structurally broken ─────────────────────────────────

  // Rule 5 — wrong-category subtypes (USDA research artifacts)
  if (source_subtype === 'sub_sample_food')         return false
  if (source_subtype === 'agricultural_acquisition') return false

  // Rule 1 — all four primary macros missing (after Rule 9's backfill attempt)
  const empty = v => v == null || v === 0
  if (empty(kcal) && empty(protein_g) && empty(fat_g) && empty(carbs_g)) {
    return false
  }

  // Rule 6 — kcal density > 900 per 100g (physically impossible; pure fat ≈ 884)
  if (kcal != null && kcal > 900) return false

  // Rule 10 — macro sum > 105g per 100g (more macro mass than food mass)
  //   Threshold 105 (vs strict 100) preserves rounding artifacts where pure-sugar
  //   items and similar can legitimately round to 101-104g.
  const macroSum = (protein_g ?? 0) + (fat_g ?? 0) + (carbs_g ?? 0)
  if (macroSum > 105) return false

  // Rule 11 — any single macro > 100g per 100g (impossible — would exceed total mass)
  if (protein_g != null && protein_g > 100) return false
  if (fat_g     != null && fat_g     > 100) return false
  if (carbs_g   != null && carbs_g   > 100) return false

  // ── Tier 3: REJECT internally inconsistent ─────────────────────────────

  // Rule 4 — kcal mismatch > 50% from 4/9/4 prediction (safety floor pred ≥ 20)
  //   Won't fire on Rule-9-backfilled rows (they match by construction).
  if (kcal != null && protein_g != null && fat_g != null && carbs_g != null) {
    const pred = protein_g * 4 + fat_g * 9 + carbs_g * 4
    if (pred >= 20 && Math.abs(kcal - pred) / pred > 0.50) return false
  }

  // Rule 7 — per-serving kcal > 3,000 (single-serving impossibility)
  if (kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing > 3000) return false
  }

  // ── Tier 4: REJECT negligible ──────────────────────────────────────────

  // Rule 8 — branded entries with per-serving < 5 kcal
  //   Canonical reference subtypes are exempt: real low-cal foods with tiny
  //   natural servings (mustard, olives, herbs) are kept.
  if ((source_subtype === 'branded_food' || source_subtype === 'on_branded')
      && kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing < 5) return false
  }

  return true
}

/**
 * Return a short human-readable reason why a row was filtered out.
 * Useful for stats and debugging the import pipeline. Returns null when
 * the row passes all filters.
 *
 * Rules are checked in the same order as shouldKeepFood().
 *
 * @param {Parameters<typeof shouldKeepFood>[0]} row
 * @returns {string | null}
 */
export function getFilterReason(row) {
  const { kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  // Tier 2
  if (source_subtype === 'sub_sample_food')         return 'rule5_sub_sample'
  if (source_subtype === 'agricultural_acquisition') return 'rule5_agricultural'

  const empty = v => v == null || v === 0
  if (empty(kcal) && empty(protein_g) && empty(fat_g) && empty(carbs_g)) {
    return 'rule1_no_macros'
  }

  if (kcal != null && kcal > 900) return 'rule6_density'

  const macroSum = (protein_g ?? 0) + (fat_g ?? 0) + (carbs_g ?? 0)
  if (macroSum > 105) return 'rule10_macro_sum'
  if (protein_g != null && protein_g > 100) return 'rule11_single_macro'
  if (fat_g     != null && fat_g     > 100) return 'rule11_single_macro'
  if (carbs_g   != null && carbs_g   > 100) return 'rule11_single_macro'

  // Tier 3
  if (kcal != null && protein_g != null && fat_g != null && carbs_g != null) {
    const pred = protein_g * 4 + fat_g * 9 + carbs_g * 4
    if (pred >= 20 && Math.abs(kcal - pred) / pred > 0.50) return 'rule4_kcal_mismatch'
  }

  if (kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing > 3000) return 'rule7_per_serving_ceiling'
  }

  // Tier 4
  if ((source_subtype === 'branded_food' || source_subtype === 'on_branded')
      && kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing < 5) return 'rule8_branded_negligible'
  }

  return null
}
