/**
 * OpenNutrition search helper
 * Queries the opennutrition_foods table stored in Supabase.
 * Data sourced from OpenNutrition (https://www.opennutrition.app) under ODbL.
 */

import { supabase } from './supabase'

/**
 * Search OpenNutrition foods by query string.
 * Uses PostgreSQL full-text search (websearch_to_tsquery) — handles AND logic
 * and word stemming automatically.
 *
 * Returns results shaped identically to USDA searchFoods results so the
 * FoodLogDrawer can consume both sources without branching.
 */
const SELECT_COLS = 'id, name, brand, type, serving_unit, serving_qty, serving_g, calories, protein, fat, carbs'

function mapRow(row) {
  return {
    fdcId:        null,
    onId:         row.id,
    name:         row.name,
    brand:        row.brand ?? null,
    dataType:     row.type,
    source:       'opennutrition',
    per100g: {
      calories: Math.round(row.calories),
      protein:  Math.round(row.protein * 10) / 10,
      fat:      Math.round(row.fat     * 10) / 10,
      carbs:    Math.round(row.carbs   * 10) / 10,
    },
    servingGrams: row.serving_g  ?? null,
    servingLabel: row.serving_qty && row.serving_unit
      ? `${row.serving_qty} ${row.serving_unit}`
      : null,
    servingQty:   row.serving_qty  ?? null,
    servingUnit:  row.serving_unit ?? null,
  }
}

export async function searchOpenNutrition(query, limit = 25) {
  if (!query?.trim()) return []

  const q = query.trim()

  // ilike pattern: each word can match a substring so "act micro pop" matches
  // "ACT II, MICROWAVE POPCORN" because "pop" is inside "popcorn".
  // Run text search AND ilike in parallel so partial-word queries always get coverage.
  const ilikePattern = `%${q.replace(/\s+/g, '%')}%`

  const [textResult, ilikeResult] = await Promise.all([
    supabase
      .from('opennutrition_foods')
      .select(SELECT_COLS)
      .textSearch('name', q, { type: 'websearch', config: 'english' })
      .limit(limit),
    supabase
      .from('opennutrition_foods')
      .select(SELECT_COLS)
      .ilike('name', ilikePattern)
      .limit(limit),
  ])

  const textRows  = textResult.data  ?? []
  const ilikeRows = ilikeResult.data ?? []

  // Merge: put text-search results first (better ranking), append ilike-only extras
  const seenIds = new Set(textRows.map(r => r.id))
  const extras  = ilikeRows.filter(r => !seenIds.has(r.id))

  return [...textRows, ...extras].slice(0, limit).map(mapRow)
}
