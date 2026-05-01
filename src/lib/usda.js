/**
 * USDA FoodData Central API wrapper
 * Docs: https://fdc.nal.usda.gov/api-guide.html
 *
 * Uses DEMO_KEY — free with no registration, 30 req/hr per IP.
 * Get a free personal key at https://fdc.nal.usda.gov/api-key-signup.html
 * and replace DEMO_KEY below for higher limits.
 */

const API_KEY = '50gIb52ZPMj4CgXeVD80PM0wNxosYm34u5ZLfPTP'
const BASE    = 'https://api.nal.usda.gov/fdc/v1'

// ── Nutrient IDs ──────────────────────────────────────────────────────────────
// Both numeric (nutrientId) and string (nutrientNumber) checked for safety
const NIDS = {
  calories: [1008, 208],
  protein:  [1003, 203],
  fat:      [1004, 204],
  carbs:    [1005, 205],
}

function extractNutrient(nutrients, ids) {
  if (!nutrients?.length) return 0
  for (const id of ids) {
    const found = nutrients.find(
      n => n.nutrientId === id || n.nutrientNumber === String(id)
    )
    if (found != null && found.value != null) return Number(found.value)
  }
  return 0
}

function per100g(foodNutrients) {
  return {
    calories: Math.round(extractNutrient(foodNutrients, NIDS.calories)),
    protein:  Math.round(extractNutrient(foodNutrients, NIDS.protein)  * 10) / 10,
    fat:      Math.round(extractNutrient(foodNutrients, NIDS.fat)      * 10) / 10,
    carbs:    Math.round(extractNutrient(foodNutrients, NIDS.carbs)    * 10) / 10,
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchFoods(query, pageSize = 25) {
  if (!query?.trim()) return []

  const url = new URL(`${BASE}/foods/search`)
  url.searchParams.set('query',    query.trim())
  url.searchParams.set('dataType', 'Foundation,SR Legacy,Branded')
  url.searchParams.set('pageSize', String(pageSize))
  url.searchParams.set('api_key',  API_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`)

  const { foods = [] } = await res.json()

  return foods.map(f => ({
    fdcId:    f.fdcId,
    name:     f.description,
    brand:    f.brandOwner || f.brandName || null,
    dataType: f.dataType,
    per100g:  per100g(f.foodNutrients),
  }))
}

// ── Portion options for a given food ─────────────────────────────────────────
// Always includes gram + oz, then any named portions from the API.

export async function getFoodPortions(fdcId) {
  const url = new URL(`${BASE}/food/${fdcId}`)
  url.searchParams.set('api_key', API_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`USDA food detail failed (${res.status})`)

  const data = await res.json()

  const named = (data.foodPortions || [])
    .filter(p => p.gramWeight > 0)
    .map(p => ({
      id:         `fdc-${p.id}`,
      label:      p.portionDescription
                  || `${p.amount ?? 1} ${p.modifier ?? 'serving'}`.trim(),
      gramWeight: p.gramWeight,
    }))

  return [
    { id: 'g',  label: 'gram',       gramWeight: 1         },
    { id: 'oz', label: 'ounce (oz)', gramWeight: 28.3495   },
    ...named,
  ]
}

// ── Macro calculator ──────────────────────────────────────────────────────────
// Given per-100g nutrients and a gram weight, returns absolute macros.

export function calcMacros(per100gNutrients, totalGrams) {
  const f = totalGrams / 100
  return {
    calories: Math.round(per100gNutrients.calories * f),
    protein:  Math.round(per100gNutrients.protein  * f * 10) / 10,
    fat:      Math.round(per100gNutrients.fat       * f * 10) / 10,
    carbs:    Math.round(per100gNutrients.carbs     * f * 10) / 10,
  }
}
