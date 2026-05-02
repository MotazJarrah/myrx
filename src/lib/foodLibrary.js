/**
 * Food Library search & portion helper
 *
 * USDA foods  → Cloudflare Worker (D1)  — 2M foods, fast FTS5 search
 * Custom foods → Supabase food_library  — admin-added 'myrx' entries only
 *
 * All nutrient values are stored per 100 g.
 * Serving info (serving_g, serving_label) is the food's default portion.
 */

import { supabase } from './supabase'

const FOOD_WORKER_URL = 'https://myrx-food-search.motaz-jarrah.workers.dev'

// ── Shared portion utilities (kept from usda.js) ─────────────────────────────

function normalizeUnitLabel(unit = '') {
  const u = unit.toLowerCase().trim()
  if (u === 'tbsp' || u.includes('tablespoon')) return 'Tbsp'
  if (u === 'tsp'  || u.includes('teaspoon'))   return 'Tsp'
  if (u === 'cup'  || u === 'cups')              return 'Cup'
  if (u === 'oz'   || u.includes('ounce'))       return 'Oz'
  if (u === 'ml')                                return 'mL'
  if (u === 'g')                                 return 'g'
  if (u === 'lb'   || u === 'lbs')               return 'Lb'
  return 'Serving'
}

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
    { id: 'app-sm', label: 'Small apple',  gramWeight: 149 },
    { id: 'app-md', label: 'Medium apple', gramWeight: 182 },
    { id: 'app-lg', label: 'Large apple',  gramWeight: 223 },
  ],
  chicken: [
    { id: 'chk-3oz', label: '3 oz serving',  gramWeight: 85  },
    { id: 'chk-sm',  label: 'Small breast',  gramWeight: 120 },
    { id: 'chk-md',  label: 'Medium breast', gramWeight: 174 },
    { id: 'chk-lg',  label: 'Large breast',  gramWeight: 220 },
  ],
  deli_meat: [
    { id: 'deli-thin',  label: 'Thin slice',    gramWeight: 17 },
    { id: 'deli-reg',   label: 'Regular slice', gramWeight: 28 },
    { id: 'deli-thick', label: 'Thick slice',   gramWeight: 43 },
  ],
  bread: [
    { id: 'bread-thin',  label: 'Thin slice',    gramWeight: 20 },
    { id: 'bread-reg',   label: 'Regular slice', gramWeight: 28 },
    { id: 'bread-thick', label: 'Thick slice',   gramWeight: 38 },
  ],
  cheese: [
    { id: 'cheese-thin', label: 'Thin slice',    gramWeight: 17 },
    { id: 'cheese-reg',  label: 'Regular slice', gramWeight: 28 },
  ],
}

const BASE_UNIT_LABELS = new Set(['g', 'Oz', 'Cup', 'mL'])

function detectCategory(name = '') {
  const n = name.toLowerCase()
  if (/\beggs?\b/.test(n) && !/white|liquid|substitut/.test(n)) return 'egg'
  if (
    /\b(turkey\s*breast|turkey|ham|roast\s*beef|salami|bologna|pastrami|pepperoni|prosciutto|mortadella|lunchmeat|lunch\s*meat|deli\s*meat|cold\s*cut)\b/.test(n) &&
    !/\bchicken\s*breast\b/.test(n)
  ) return 'deli_meat'
  if (/\bbread\b/.test(n) && !/banana|zucchini|pumpkin|cornbread|corn\s*bread|pita|naan/.test(n)) return 'bread'
  if (/\bcheese\b/.test(n) && /\bslice|sliced\b/.test(n) && !/cream|cottage|ricotta|parmesan|shredded|crumbled/.test(n)) return 'cheese'
  if (/\bbanana\b/.test(n))                           return 'banana'
  if (/\bapple\b/.test(n) && !/pine/.test(n))        return 'apple'
  if (/\bchicken\b/.test(n) && /breast/.test(n))     return 'chicken'
  return null
}

// ── Row mapper ─────────────────────────────────────────────────────────────────

function mapRow(row) {
  return {
    // Prefer DB id (Supabase uuid) or fall back to source_id (Worker responses)
    libraryId:    row.id ?? row.source_id,
    fdcId:        row.source === 'usda' ? row.source_id : null,
    name:         row.name,
    brand:        row.brand ?? null,
    source:       row.source,          // 'usda' | 'myrx'
    per100g: {
      calories: row.kcal      != null ? Math.round(row.kcal)                 : 0,
      protein:  row.protein_g != null ? Math.round(row.protein_g  * 10) / 10 : 0,
      fat:      row.fat_g     != null ? Math.round(row.fat_g      * 10) / 10 : 0,
      carbs:    row.carbs_g   != null ? Math.round(row.carbs_g    * 10) / 10 : 0,
    },
    servingGrams:          row.serving_g    ?? null,
    servingLabel:          row.serving_label ?? null,
    servingsPerContainer:  row.servings_per_container ?? null,
  }
}

// ── Search ─────────────────────────────────────────────────────────────────────

/**
 * Search USDA foods via Cloudflare Worker (D1 + FTS5).
 * Returns results in mapRow shape.
 */
async function searchWorker(query, limit) {
  try {
    const url = `${FOOD_WORKER_URL}/search?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data ?? []).map(r => mapRow({ ...r, id: r.source_id, source: 'usda' }))
  } catch {
    return []
  }
}

/**
 * Search custom admin-added foods from Supabase (source='myrx' only).
 */
async function searchMyrx(query, limit) {
  try {
    const ilikePattern = '%' + query.replace(/\s+/g, '%') + '%'
    const { data, error } = await supabase
      .from('food_library')
      .select('id, source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g, serving_g, serving_label, servings_per_container')
      .eq('source', 'myrx')
      .ilike('name', ilikePattern)
      .limit(limit)
    if (error || !data) return []
    return data
      .filter(r => r.kcal != null || r.protein_g != null || r.fat_g != null || r.carbs_g != null)
      .map(mapRow)
  } catch {
    return []
  }
}

/**
 * Search foods — fans out to Worker (USDA) and Supabase (custom), merged.
 * Custom myrx results appear first.
 */
export async function searchFoods(query, limit = 60) {
  if (!query?.trim()) return []
  const q = query.trim()

  const [myrxResults, workerResults] = await Promise.all([
    searchMyrx(q, limit),
    searchWorker(q, limit),
  ])

  // Merge — custom foods first, then USDA; deduplicate by name+brand
  const seen   = new Set()
  const merged = []
  for (const r of [...myrxResults, ...workerResults]) {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (!seen.has(key)) { seen.add(key); merged.push(r) }
  }
  return merged.slice(0, limit)
}

// ── Portions ───────────────────────────────────────────────────────────────────

/**
 * Build portion options for a food.
 * Uses stored serving_g / serving_label — no external API calls.
 */
export function getFoodPortions(food) {
  const base = [
    { id: 'g',   label: 'grams',  gramWeight: 1       },
    { id: 'oz',  label: 'ounces', gramWeight: 28.3495 },
    { id: 'cup', label: 'cups',   gramWeight: 240     },
  ]

  const srvG    = food.servingGrams > 0 ? food.servingGrams : 100
  const srvChip = { id: 'srv', label: `Serving (${Math.round(srvG)}g)`, gramWeight: srvG }

  // Category chips (egg sizes, bread slices, etc.)
  const cat = CATEGORY_PORTIONS[detectCategory(food.name)] ?? []

  // Synthesise a named unit chip from the stored serving label if available
  // e.g. servingLabel="1 Tbsp", servingGrams=14 → Tbsp chip at 14g
  let labelChip = []
  if (cat.length === 0 && food.servingGrams > 0 && food.servingLabel) {
    // Try to parse "qty unit" from servingLabel
    const match = food.servingLabel.match(/^([\d./]+)\s+(.+)$/)
    if (match) {
      const qty   = parseFloat(match[1]) || 1
      const unit  = match[2].trim()
      const label = normalizeUnitLabel(unit)
      const perUnitG = food.servingGrams / qty
      if (!BASE_UNIT_LABELS.has(label) && perUnitG > 0) {
        const display = label !== 'Serving'
          ? label
          : unit.charAt(0).toUpperCase() + unit.slice(1)
        labelChip = [{ id: 'lib-srv', label: display, gramWeight: Math.round(perUnitG * 10) / 10 }]
      }
    }
  }

  const portions = [...base, srvChip, ...(cat.length > 0 ? cat : labelChip)]
  return { portions, servingsPerContainer: food.servingsPerContainer ?? null }
}

// ── Macros ─────────────────────────────────────────────────────────────────────

export function calcMacros(per100gNutrients, totalGrams) {
  const f = totalGrams / 100
  return {
    calories: Math.round(per100gNutrients.calories * f),
    protein:  Math.round(per100gNutrients.protein  * f * 10) / 10,
    fat:      Math.round(per100gNutrients.fat       * f * 10) / 10,
    carbs:    Math.round(per100gNutrients.carbs     * f * 10) / 10,
  }
}
