/**
 * Food search & portion helper
 * Sources: USDA FoodData Central + OpenNutrition (via Supabase)
 *
 * USDA docs:        https://fdc.nal.usda.gov/api-guide.html
 * OpenNutrition:    https://www.opennutrition.app  (ODbL license)
 */

import { searchOpenNutrition } from './opennutrition'

const USDA_KEY  = '50gIb52ZPMj4CgXeVD80PM0wNxosYm34u5ZLfPTP'
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1'

// ── Nutrient extraction ───────────────────────────────────────────────────────

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

function usdaPer100g(foodNutrients) {
  return {
    calories: Math.round(extractNutrient(foodNutrients, NIDS.calories)),
    protein:  Math.round(extractNutrient(foodNutrients, NIDS.protein)  * 10) / 10,
    fat:      Math.round(extractNutrient(foodNutrients, NIDS.fat)      * 10) / 10,
    carbs:    Math.round(extractNutrient(foodNutrients, NIDS.carbs)    * 10) / 10,
  }
}

// ── Unit label normaliser ─────────────────────────────────────────────────────

function normalizeUnitLabel(unit = '') {
  const u = unit.toLowerCase().trim()
  if (u === 'tbsp' || u.includes('tablespoon')) return 'Tbsp'
  if (u === 'tsp'  || u.includes('teaspoon'))   return 'Tsp'
  if (u === 'cup'  || u === 'cups')              return 'Cup'
  if (u === 'oz'   || u.includes('ounce'))       return 'Oz'
  if (u === 'ml'   || u === 'ml')                return 'mL'
  if (u === 'g')                                 return 'g'
  if (u === 'lb'   || u === 'lbs')               return 'Lb'
  return 'Serving'
}

// ── Unit → grams conversion ───────────────────────────────────────────────────

function unitToGrams(size, unit) {
  if (!size || !unit) return null
  const s = Number(size)
  if (!s || !isFinite(s)) return null
  switch (unit.toLowerCase().trim()) {
    case 'g':                      return s
    case 'oz':                     return s * 28.3495
    case 'tbsp':
    case 'tablespoon':
    case 'tablespoons':            return s * 14.7868
    case 'tsp':
    case 'teaspoon':
    case 'teaspoons':              return s * 4.9289
    case 'cup':
    case 'cups':                   return s * 240
    case 'ml':
    case 'mL':                     return s
    case 'lbs':
    case 'lb':                     return s * 453.592
    default:                       return null
  }
}

// ── USDA search ───────────────────────────────────────────────────────────────

async function searchUSDA(query, pageSize) {
  const url = new URL(`${USDA_BASE}/foods/search`)
  url.searchParams.set('query',    query.trim())
  url.searchParams.set('dataType', 'Foundation,SR Legacy,Branded')
  url.searchParams.set('pageSize', String(pageSize))
  url.searchParams.set('api_key',  USDA_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) return []

  const { foods = [] } = await res.json()
  return foods.map(f => {
    const p100 = usdaPer100g(f.foodNutrients)
    const servingGrams = unitToGrams(f.servingSize, f.servingSizeUnit)
    const servingLabel = f.householdServingFullText?.trim() || null
    return {
      fdcId:        f.fdcId,
      name:         f.description,
      brand:        f.brandOwner || f.brandName || null,
      dataType:     f.dataType,
      source:       'usda',
      per100g:      p100,
      servingGrams: servingGrams > 0 ? servingGrams : null,
      servingLabel,
    }
  })
}

// ── AND-filter ────────────────────────────────────────────────────────────────
// USDA uses OR logic — keep only results where every query word appears.

function andFilter(results, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return results
  return results.filter(f => {
    const haystack = `${f.name} ${f.brand ?? ''}`.toLowerCase()
    return words.every(w => haystack.includes(w))
  })
}

// ── Bad-data filter ───────────────────────────────────────────────────────────

function filterBadData(results) {
  return results.filter(f => {
    const { calories, protein, fat, carbs } = f.per100g
    if (calories > 0) return true
    if (protein === 0 && fat === 0 && carbs === 0) return true
    return false
  })
}

// ── Dedup filter ──────────────────────────────────────────────────────────────
// USDA returns multiple entries for the same food (different serving sizes).
// Keep the first (highest-priority) entry for each (name, brand, kcal/100g) key.

function deduplicateUSDA(results) {
  const seen = new Set()
  return results.filter(f => {
    const key = `${f.name.toLowerCase()}|${(f.brand ?? '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Public: search (USDA + OpenNutrition merged) ──────────────────────────────

export async function searchFoods(query, pageSize = 50) {
  if (!query?.trim()) return []

  const words      = query.trim().split(/\s+/).filter(Boolean)
  // Long words (4+ chars) that ES tokenisation can actually match
  const longWords  = words.filter(w => w.length >= 4)
  // If the query has short words (< 4 chars) that ES can't prefix-match,
  // also fire a second USDA query using only the long words so we get better recall.
  // Example: "act micro pop" → also search "micro" so ES can return "MICROWAVE POPCORN" items.
  const needsAltQuery = longWords.length > 0 && longWords.length < words.length
  const altQuery      = needsAltQuery ? longWords.join(' ') : null

  // Run all sources in parallel
  const [usdaRaw, usdaAltRaw, onResults] = await Promise.all([
    searchUSDA(query, pageSize).catch(() => []),
    altQuery ? searchUSDA(altQuery, pageSize).catch(() => []) : Promise.resolve([]),
    searchOpenNutrition(query, 25).catch(() => []),
  ])

  // Merge the two USDA result sets (deduplicate by fdcId)
  const seenFdcIds = new Set(usdaRaw.map(f => f.fdcId))
  const usdaMerged = [...usdaRaw, ...usdaAltRaw.filter(f => !seenFdcIds.has(f.fdcId))]

  // andFilter uses the ORIGINAL query words as substring checks so
  // "pop" still has to appear in "popcorn" even though we fetched via "micro"
  const usdaResults = deduplicateUSDA(filterBadData(andFilter(usdaMerged, query)))

  // Add ON results whose names don't already appear in USDA results
  const usdaNameSet = new Set(usdaResults.map(r => r.name.toLowerCase()))
  const onUnique    = onResults.filter(r => !usdaNameSet.has(r.name.toLowerCase()))

  return [...usdaResults, ...onUnique]
}

// ── Redundant portion filter ──────────────────────────────────────────────────

const UNIT_ONLY_LABEL = /^\s*(\d+\s*(\/\s*\d+\s*)?)?\s*(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|fluid\s+oz|fl\.?\s*oz|ounce|ounces|oz|milliliter|milliliters|ml|gram|grams|g)\s*$/i

function filterRedundantPortions(portions) {
  return portions.filter(p => !UNIT_ONLY_LABEL.test(p.label))
}

// ── Category-based fallback portions ─────────────────────────────────────────

const CATEGORY_PORTIONS = {
  egg: [
    { id: 'egg-sm', label: 'Small egg',       gramWeight: 38  },
    { id: 'egg-md', label: 'Medium egg',      gramWeight: 44  },
    { id: 'egg-lg', label: 'Large egg',       gramWeight: 50  },
    { id: 'egg-xl', label: 'Extra large egg', gramWeight: 56  },
    { id: 'egg-jb', label: 'Jumbo egg',       gramWeight: 63  },
  ],
  banana: [
    { id: 'ban-sm', label: 'Small banana',  gramWeight: 81  },
    { id: 'ban-md', label: 'Medium banana', gramWeight: 118 },
    { id: 'ban-lg', label: 'Large banana',  gramWeight: 136 },
  ],
  apple: [
    { id: 'app-sm', label: 'Small apple',   gramWeight: 149 },
    { id: 'app-md', label: 'Medium apple',  gramWeight: 182 },
    { id: 'app-lg', label: 'Large apple',   gramWeight: 223 },
  ],
  chicken: [
    { id: 'chk-3oz', label: '3 oz serving', gramWeight: 85  },
    { id: 'chk-sm',  label: 'Small breast', gramWeight: 120 },
    { id: 'chk-md',  label: 'Medium breast',gramWeight: 174 },
    { id: 'chk-lg',  label: 'Large breast', gramWeight: 220 },
  ],
  // Deli / lunch meats: turkey, ham, chicken, roast beef, salami, etc.
  deli_meat: [
    { id: 'deli-thin',  label: 'Thin slice',    gramWeight: 17 },
    { id: 'deli-reg',   label: 'Regular slice', gramWeight: 28 },
    { id: 'deli-thick', label: 'Thick slice',   gramWeight: 43 },
  ],
  // Sliced bread / toast
  bread: [
    { id: 'bread-thin',  label: 'Thin slice',    gramWeight: 20 },
    { id: 'bread-reg',   label: 'Regular slice', gramWeight: 28 },
    { id: 'bread-thick', label: 'Thick slice',   gramWeight: 38 },
  ],
  // Sliced / individual cheese
  cheese: [
    { id: 'cheese-thin', label: 'Thin slice',    gramWeight: 17 },
    { id: 'cheese-reg',  label: 'Regular slice', gramWeight: 28 },
  ],
}

// Labels already covered by the three base chips (no need to synthesise these)
const BASE_UNIT_LABELS = new Set(['g', 'Oz', 'Cup', 'mL'])

function detectCategory(name = '') {
  const n = name.toLowerCase()

  // Eggs — whole only (liquid/whites fall through to base chips)
  if (/\beggs?\b/.test(n) && !/white|liquid|substitut/.test(n)) return 'egg'

  // Deli / lunch meats — inherently sliced; match by meat type alone
  // Exclude chicken breast (has its own category) and peppercorn/bell pepper false positives
  if (
    /\b(turkey\s*breast|turkey|ham|roast\s*beef|salami|bologna|pastrami|pepperoni|prosciutto|mortadella|lunchmeat|lunch\s*meat|deli\s*meat|cold\s*cut)\b/.test(n) &&
    !/\bchicken\s*breast\b/.test(n)
  ) return 'deli_meat'

  // Bread / toast (exclude quick-breads like banana/zucchini/pumpkin bread)
  if (/\bbread\b/.test(n) && !/banana|zucchini|pumpkin|cornbread|corn\s*bread|pita|naan/.test(n)) return 'bread'

  // Sliced cheese (but not cream cheese, cottage cheese, etc.)
  if (/\bcheese\b/.test(n) && /\bslice|sliced\b/.test(n) && !/cream|cottage|ricotta|parmesan|shredded|crumbled/.test(n)) return 'cheese'

  if (/\bbanana\b/.test(n))                            return 'banana'
  if (/\bapple\b/.test(n) && !/pine/.test(n))         return 'apple'
  if (/\bchicken\b/.test(n) && /breast/.test(n))      return 'chicken'

  return null
}

// ── Public: portion options ───────────────────────────────────────────────────

export async function getFoodPortions(food) {
  const base = [
    { id: 'g',   label: 'grams',  gramWeight: 1       },
    { id: 'oz',  label: 'ounces', gramWeight: 28.3495 },
    { id: 'cup', label: 'cups',   gramWeight: 240     },
  ]

  // Universal "Serving" chip — uses food's stated serving size, or 100g fallback
  const srvG     = food.servingGrams > 0 ? food.servingGrams : 100
  const srvChip  = { id: 'srv', label: `Serving (${Math.round(srvG)}g)`, gramWeight: srvG }

  // ── OpenNutrition food: no USDA API call, use stored serving data ──────────
  if (!food.fdcId) {
    let fallback = []

    // 1. Category chips (egg sizes, etc.)
    const cat = CATEGORY_PORTIONS[detectCategory(food.name)] ?? []
    if (cat.length > 0) {
      fallback = cat
    } else if (food.servingGrams > 0 && food.servingUnit) {
      // 2. Synthesise per-unit chip from stored serving info
      //    e.g. Nutella: servingQty=2, servingUnit='tbsp', servingGrams=37 → Tbsp (1=19g)
      const qty      = food.servingQty || 1
      const perUnitG = food.servingGrams / qty
      const label    = normalizeUnitLabel(food.servingUnit)

      if (!BASE_UNIT_LABELS.has(label) && perUnitG > 0) {
        // For known units use normalized label; for custom units (slice, piece, etc.)
        // capitalize the raw servingUnit string
        const display = label !== 'Serving'
          ? label
          : food.servingUnit.charAt(0).toUpperCase() + food.servingUnit.slice(1)
        fallback = [{ id: 'on-srv', label: display, gramWeight: Math.round(perUnitG * 10) / 10 }]
      }
    }

    return { portions: [...base, srvChip, ...fallback], servingsPerContainer: null }
  }

  // ── USDA food: fetch named portions from USDA API ─────────────────────────
  const url = new URL(`${USDA_BASE}/food/${food.fdcId}`)
  url.searchParams.set('api_key', USDA_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`USDA food detail failed (${res.status})`)

  const data = await res.json()

  const named = filterRedundantPortions(
    (data.foodPortions || [])
      .filter(p => p.gramWeight > 0)
      .map(p => ({
        id:         `fdc-${p.id}`,
        label:      p.portionDescription
                    || `${p.amount ?? 1} ${p.modifier ?? 'serving'}`.trim(),
        gramWeight: p.gramWeight,
      }))
  )

  let fallback = []
  if (named.length === 0) {
    const cat = CATEGORY_PORTIONS[detectCategory(food.name || data.description)] ?? []
    if (cat.length > 0) {
      fallback = cat
    } else {
      const perUnitG = unitToGrams(1, data.servingSizeUnit)
      const label    = normalizeUnitLabel(data.servingSizeUnit)
      if (perUnitG > 0 && !BASE_UNIT_LABELS.has(label)) {
        fallback = [{ id: 'srv-default', label, gramWeight: perUnitG }]
      }
    }
  }

  // servingsPerContainer is available on Branded foods
  const servingsPerContainer = data.servingsPerContainer
    ? Math.round(data.servingsPerContainer * 10) / 10
    : null

  return {
    portions: [...base, srvChip, ...(named.length > 0 ? named : fallback)],
    servingsPerContainer,
  }
}

// ── Public: macro calculator ──────────────────────────────────────────────────

export function calcMacros(per100gNutrients, totalGrams) {
  const f = totalGrams / 100
  return {
    calories: Math.round(per100gNutrients.calories * f),
    protein:  Math.round(per100gNutrients.protein  * f * 10) / 10,
    fat:      Math.round(per100gNutrients.fat       * f * 10) / 10,
    carbs:    Math.round(per100gNutrients.carbs     * f * 10) / 10,
  }
}
