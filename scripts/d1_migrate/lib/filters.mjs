/**
 * Shared filter library — applied at INSERT time during bulk import AND
 * by the ongoing sync scripts (sync_usda.mjs / sync_on.mjs).
 *
 * Single source of truth for the per-row rules that came out of the
 * 2026-05-14 audit. Approved rules from docs/food_library_filters.md.
 *
 * IMPORTANT: dedup rules (Rule 2 and Rule 3) are NOT here — they need
 * cross-row comparison and run as post-import DELETE passes. See
 * scripts/bulk_import/post_import_dedup.mjs.
 *
 * If you change a rule in this file, update docs/food_library_filters.md
 * and re-run the cleanup migration. The doc is the spec; this file is
 * its implementation.
 */

/**
 * Decide whether a candidate row should be inserted into food_library.
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

  // ── Rule 5: drop USDA research-only subtypes ─────────────────────────────
  // sub_sample_food and agricultural_acquisition are USDA's research intermediate
  // data (sample IDs in names, partial nutrition). Not consumer food records.
  if (source_subtype === 'sub_sample_food')         return false
  if (source_subtype === 'agricultural_acquisition') return false

  // ── Rule 6: physically-impossible kcal density ──────────────────────────
  // Pure fat is ~884 kcal/100g — the theoretical ceiling for any food.
  // Anything above 900 is a unit-conversion error at the source.
  if (kcal != null && kcal > 900) return false

  // ── Rule 1: all four primary macros missing (null or zero) ──────────────
  // Without kcal/protein/fat/carbs the row is unusable for tracking.
  const macroEmpty = v => v == null || v === 0
  if (macroEmpty(kcal) && macroEmpty(protein_g) && macroEmpty(fat_g) && macroEmpty(carbs_g)) {
    return false
  }

  // ── Rule 4: kcal mismatch >50% from predicted (4/9/4 formula) ───────────
  // predicted = protein*4 + fat*9 + carbs*4. Mismatches above 50% are
  // almost always real data errors (under-reported fat, "0 cal" claims that
  // contradict actual macros). Safety floor of pred>=20 avoids false flags on
  // very-low-cal items where small absolute differences look proportionally
  // large.
  if (kcal != null && protein_g != null && fat_g != null && carbs_g != null) {
    const pred = protein_g * 4 + fat_g * 9 + carbs_g * 4
    if (pred >= 20 && Math.abs(kcal - pred) / pred > 0.50) return false
  }

  // ── Rule 7: per-serving kcal sanity ceiling ─────────────────────────────
  // kcal × serving_g / 100 > 3000 = single-serving calories exceeding ~3000.
  // Above this, serving_g is almost certainly a whole-package value mistakenly
  // entered as a per-serving size.
  if (kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing > 3000) return false
  }

  return true
}

/**
 * Return a short human-readable reason why a row was filtered out.
 * Useful for stats and debugging the import pipeline. Returns null when
 * the row passes all filters.
 *
 * @param {Parameters<typeof shouldKeepFood>[0]} row
 * @returns {string | null}
 */
export function getFilterReason(row) {
  const { kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  if (source_subtype === 'sub_sample_food')          return 'rule5_sub_sample'
  if (source_subtype === 'agricultural_acquisition') return 'rule5_agricultural'
  if (kcal != null && kcal > 900)                    return 'rule6_density'

  const macroEmpty = v => v == null || v === 0
  if (macroEmpty(kcal) && macroEmpty(protein_g) && macroEmpty(fat_g) && macroEmpty(carbs_g)) {
    return 'rule1_no_macros'
  }

  if (kcal != null && protein_g != null && fat_g != null && carbs_g != null) {
    const pred = protein_g * 4 + fat_g * 9 + carbs_g * 4
    if (pred >= 20 && Math.abs(kcal - pred) / pred > 0.50) return 'rule4_kcal_mismatch'
  }

  if (kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing > 3000) return 'rule7_per_serving_ceiling'
  }

  return null
}
