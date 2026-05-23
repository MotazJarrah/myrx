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
//
// May 23 2026 port from mobile/src/lib/foodLibrary.ts. The mobile rewrite
// added:
//   1. Multi-portion fetch via the worker's GET /portions?source=&source_id=
//   2. Relevance ranking (single-unit size descriptors win over cup/tbsp/tsp)
//   3. Label cleanup (strip dimensional parentheticals + title-case)
//   4. Branded → generic fallback (when branded ≤1 portion, search generic
//      equivalent and merge that food's portions in)
//   5. CATEGORY_PORTIONS fallback when worker returns empty
//
// getFoodPortions is now ASYNC. Callers must await it.

const BASE_PORTIONS = [
  { id: 'g',   label: 'grams',  gramWeight: 1       },
  { id: 'oz',  label: 'ounces', gramWeight: 28.3495 },
  { id: 'cup', label: 'cups',   gramWeight: 240     },
]

/** Strip dimensional parentheticals like "(7" to 7-7/8" long)" from a
 *  modifier — keeps content-bearing parentheticals like "(4.86 large eggs)". */
function stripDimensionalParens(s) {
  if (!s) return s
  const stripped = s.replace(
    /\s*\([^)]*(?:["']|inch|cm|mm|long|wide|tall|short|less than|greater than)[^)]*\)/gi,
    '',
  ).trim()
  return stripped.length >= 2 ? stripped : s
}

/** Title-case every word in a portion label so "1 medium" → "1 Medium". */
function titleCaseLabel(s) {
  return s.replace(/(^|[\s,/\-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

/** Build a human-readable label from a worker portion row. */
function formatPortionLabel(p) {
  const cleanMod  = p.modifier      ? stripDimensionalParens(p.modifier)      : null
  const cleanDesc = p.portion_desc  ? stripDimensionalParens(p.portion_desc)  : null

  if (cleanDesc && cleanDesc.length > 0) {
    let s = cleanDesc
    if (cleanMod && !s.toLowerCase().includes(cleanMod.toLowerCase())) {
      s += `, ${cleanMod}`
    }
    return titleCaseLabel(s)
  }

  const parts = []
  if (p.amount != null) parts.push(String(p.amount))
  if (p.measure_unit) {
    parts.push(p.measure_unit)
    if (cleanMod) parts.push(`, ${cleanMod}`)
  } else if (cleanMod) {
    parts.push(cleanMod)
  }
  const joined = parts.join(' ').replace(/\s+,/g, ',').trim()
  return joined ? titleCaseLabel(joined) : 'Serving'
}

/** Relevance score for ordering portion chips. Lower = more relevant. */
function scorePortion(p) {
  let score = p.seq_num ?? 1000

  const stripParens = s => (s ?? '').replace(/\s*\([^)]*\)/g, ' ').toLowerCase()
  const combined = `${stripParens(p.portion_desc)} ${(p.measure_unit ?? '').toLowerCase()} ${stripParens(p.modifier)}`

  if      (/\bextra\s+small\b/.test(combined)) score -= 20
  else if (/\bextra\s+large\b/.test(combined)) score -= 40
  else if (/\bmedium\b/.test(combined))        score -= 100
  else if (/\blarge\b/.test(combined))         score -= 80
  else if (/\bsmall\b/.test(combined))         score -= 60
  else if (/\bjumbo\b/.test(combined))         score -= 30

  if (p.amount === null || p.amount === 1) score -= 5

  if (/\bcup\b/.test(combined))                          score += 30
  if (/\btbsp\b|\btablespoon\b/.test(combined))          score += 60
  if (/\btsp\b|\bteaspoon\b/.test(combined))             score += 80
  if (/\bnlea\b/.test(combined))                         score += 200

  return score
}

async function fetchWorkerPortions(source, sourceId) {
  try {
    const url = `${FOOD_WORKER_URL}/portions?source=${encodeURIComponent(source)}&source_id=${encodeURIComponent(sourceId)}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data ?? []
  } catch {
    return []
  }
}

/** Branded → generic fallback. */
async function fetchGenericFallbackPortions(food) {
  if (!food.brand) return []
  const generic = stripNameForGenericSearch(food.name, food.brand)
  if (!generic || generic.length < 2) return []

  const candidates = await searchFoods(generic, 12)
  const generics = candidates.filter(c =>
    !c.brand && (c.source === 'usda' || c.source === 'on'),
  )
  if (generics.length === 0) return []
  for (const cand of generics.slice(0, 3)) {
    const sid = cand.fdcId ?? cand.onId ?? cand.libraryId
    if (!sid) continue
    const portions = await fetchWorkerPortions(cand.source, String(sid))
    if (portions.length > 0) return portions
  }
  return []
}

/**
 * Build portion options for a food. Now async — fetches multi-portion
 * data from the worker, ranks by relevance, interleaves base units,
 * falls back to CATEGORY_PORTIONS + the stored serving label.
 */
export async function getFoodPortions(food) {
  const sourceId = food.fdcId ?? food.onId ?? food.libraryId
  let workerPortions = []

  if (sourceId && (food.source === 'usda' || food.source === 'on')) {
    workerPortions = await fetchWorkerPortions(food.source, String(sourceId))
  }

  // Branded → generic fallback.
  if (food.brand && workerPortions.length <= 1) {
    const fallback = await fetchGenericFallbackPortions(food)
    if (fallback.length > 0) {
      const offset = (workerPortions[0]?.seq_num ?? 0) + 1000
      const offsetted = fallback.map(p => ({ ...p, seq_num: (p.seq_num ?? 0) + offset }))
      workerPortions = [...workerPortions, ...offsetted]
    }
  }

  let named = []
  if (workerPortions.length > 0) {
    const ranked = [...workerPortions].sort((a, b) => scorePortion(a) - scorePortion(b))
    const seenGrams = new Set()
    for (const p of ranked) {
      const roundedG = Math.round(p.gram_weight)
      if (seenGrams.has(roundedG)) continue
      seenGrams.add(roundedG)
      named.push({
        id:         `wp-${p.id}`,
        label:      formatPortionLabel(p),
        gramWeight: Math.round(p.gram_weight * 10) / 10,
      })
    }
  }

  if (named.length === 0) {
    const cat = CATEGORY_PORTIONS[detectCategory(food.name)] ?? []
    if (cat.length > 0) named = [...cat]
  }

  if (named.length === 0 && food.servingGrams && food.servingGrams > 0 && food.servingLabel) {
    const match = food.servingLabel.match(/^([\d./]+)\s+(.+)$/)
    if (match) {
      const qty      = parseFloat(match[1]) || 1
      const unit     = match[2].trim()
      const label    = normalizeUnitLabel(unit)
      const perUnitG = food.servingGrams / qty
      if (!BASE_UNIT_LABELS.has(label) && perUnitG > 0) {
        const display = label !== 'Serving'
          ? label
          : unit.charAt(0).toUpperCase() + unit.slice(1)
        named = [{ id: 'lib-srv', label: display, gramWeight: Math.round(perUnitG * 10) / 10 }]
      }
    }
  }

  const srvG = food.servingGrams && food.servingGrams > 0 ? food.servingGrams : null
  const srvChip = srvG
    ? { id: 'srv', label: `Serving (${Math.round(srvG)}g)`, gramWeight: srvG }
    : null

  const portions = [
    ...named,
    ...(srvChip ? [srvChip] : []),
    ...BASE_PORTIONS,
  ]
  return { portions, servingsPerContainer: food.servingsPerContainer ?? null }
}

// ── Generic-search helper (used by branded fallback) ─────────────────────────

/**
 * Strip a food product name down to a generic search term. Mirror of
 * mobile's stripNameForGenericSearch (kept here so the branded fallback
 * runs without needing the mobile module).
 */
export function stripNameForGenericSearch(name, brand) {
  if (!name) return ''
  let s = name.toLowerCase().trim()

  if (brand) {
    const b = brand.toLowerCase().trim()
    if (b.length >= 2) {
      const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), ' ')
    }
  }

  s = s.replace(/\([^)]*\)/g, ' ')
  s = s.replace(/\[[^\]]*\]/g, ' ')
  s = s.replace(/\b\d+(\.\d+)?\s*(fl\s*oz|fluid\s*ounces?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|litres?)\b/gi, ' ')
  s = s.replace(/\b\d+\s*(ct|count|pack|pk|pieces?|servings?|bars?|cans?|bottles?|pouches?)\b/gi, ' ')
  s = s.replace(/\b\d+(\.\d+)?\b/g, ' ')
  s = s.replace(/\b(can|cans|bottle|bottles|jar|jars|bag|bags|box|boxes|carton|cartons|pouch|pouches|container|containers|case|cases|tray|trays|tub|tubs|stick|sticks|tube|tubes|wrapper|sleeve|family\s*size|family\s*pack|value\s*pack|jumbo|original|classic|new|improved)\b/gi, ' ')
  s = s.replace(/[,.\-_/:;'"!?®™©]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length < 2) {
    s = name.toLowerCase().replace(/[,.\-_/:;'"!?®™©]/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return s
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
