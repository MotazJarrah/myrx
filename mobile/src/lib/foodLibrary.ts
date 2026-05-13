/**
 * Food Library search & portion helper — port of MyRX/src/lib/foodLibrary.js.
 *
 * USDA foods    → Cloudflare Worker (D1)        — 2M foods, fast FTS5 search
 * Custom foods  → Supabase food_library         — admin-added 'myrx' entries only
 *
 * All nutrient values are stored per 100 g.
 * Serving info (serving_g, serving_label) is the food's default portion.
 */

import { supabase } from './supabase'

const FOOD_WORKER_URL = 'https://myrx-food-search.motaz-jarrah.workers.dev'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Per100gNutrients {
  calories: number
  protein:  number
  fat:      number
  carbs:    number
}

export interface FoodItem {
  libraryId:            string | null
  fdcId:                string | null
  /** OpenNutrition id (set by mapRow only when source === 'on'). */
  onId?:                string | null
  name:                 string
  brand:                string | null
  source:               'usda' | 'myrx' | 'on' | string
  per100g:              Per100gNutrients
  servingGrams:         number | null
  servingLabel:         string | null
  servingsPerContainer: number | null
  /** Habit score (0..N) attached by FoodLogDrawer when reading recents. */
  habitScore?:          number
}

export interface PortionOption {
  id:         string
  label:      string
  gramWeight: number
}

// ── Shared portion utilities ─────────────────────────────────────────────────

function normalizeUnitLabel(unit = ''): string {
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

const CATEGORY_PORTIONS: Record<string, PortionOption[]> = {
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

function detectCategory(name = ''): string | null {
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

interface FoodRowFromDB {
  id?:                       string
  source_id?:                string
  source:                    string
  name:                      string
  brand?:                    string | null
  kcal?:                     number | null
  protein_g?:                number | null
  fat_g?:                    number | null
  carbs_g?:                  number | null
  serving_g?:                number | null
  serving_label?:            string | null
  servings_per_container?:   number | null
  upc?:                      string | null
}

function mapRow(row: FoodRowFromDB): FoodItem {
  return {
    // Prefer DB id (Supabase uuid) or fall back to source_id (Worker responses)
    libraryId:    (row.id ?? row.source_id) ?? null,
    fdcId:        row.source === 'usda' ? (row.source_id ?? null) : null,
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

/** Search USDA foods via Cloudflare Worker (D1 + FTS5). */
async function searchWorker(query: string, limit: number): Promise<FoodItem[]> {
  try {
    const url = `${FOOD_WORKER_URL}/search?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as FoodRowFromDB[] | null
    return (data ?? []).map(r => mapRow({ ...r, id: r.source_id, source: r.source ?? 'usda' }))
  } catch {
    return []
  }
}

/** Search custom admin-added foods from Supabase (source='myrx' only). */
async function searchMyrx(query: string, limit: number): Promise<FoodItem[]> {
  try {
    const digits = query.replace(/\s/g, '')
    const isUpc  = /^\d{3,}$/.test(digits)

    const cols = 'id, source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g, serving_g, serving_label, servings_per_container, upc'

    let req = supabase
      .from('food_library')
      .select(cols)
      .eq('source', 'myrx')
      .limit(limit)

    if (isUpc) {
      // Partial UPC → prefix match; full UPC → exact match
      const upcPattern = digits.length >= 12 ? digits : digits + '%'
      req = digits.length >= 12
        ? req.eq('upc', upcPattern)
        : req.ilike('upc', upcPattern)
    } else {
      const ilikePattern = '%' + query.replace(/\s+/g, '%') + '%'
      req = req.ilike('name', ilikePattern)
    }

    const { data, error } = await req
    if (error || !data) return []
    return (data as FoodRowFromDB[])
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
export async function searchFoods(query: string, limit = 60): Promise<FoodItem[]> {
  if (!query?.trim()) return []
  const q = query.trim()

  const [myrxResults, workerResults] = await Promise.all([
    searchMyrx(q, limit),
    searchWorker(q, limit),
  ])

  // Merge — custom foods first, then USDA; deduplicate by name+brand
  const seen   = new Set<string>()
  const merged: FoodItem[] = []
  for (const r of [...myrxResults, ...workerResults]) {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (!seen.has(key)) { seen.add(key); merged.push(r) }
  }
  return merged.slice(0, limit)
}

// ── Portions ───────────────────────────────────────────────────────────────────

export interface FoodPortionsResult {
  portions:             PortionOption[]
  servingsPerContainer: number | null
}

/**
 * Build portion options for a food.
 * Uses stored serving_g / serving_label — no external API calls.
 */
export function getFoodPortions(food: FoodItem): FoodPortionsResult {
  const base: PortionOption[] = [
    { id: 'g',   label: 'grams',  gramWeight: 1       },
    { id: 'oz',  label: 'ounces', gramWeight: 28.3495 },
    { id: 'cup', label: 'cups',   gramWeight: 240     },
  ]

  const srvG    = food.servingGrams && food.servingGrams > 0 ? food.servingGrams : 100
  const srvChip: PortionOption = { id: 'srv', label: `Serving (${Math.round(srvG)}g)`, gramWeight: srvG }

  // Category chips (egg sizes, bread slices, etc.)
  const cat = CATEGORY_PORTIONS[detectCategory(food.name) ?? ''] ?? []

  // Synthesise a named unit chip from the stored serving label if available
  let labelChip: PortionOption[] = []
  if (cat.length === 0 && food.servingGrams && food.servingGrams > 0 && food.servingLabel) {
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

export interface CalcMacrosResult {
  calories: number
  protein:  number
  fat:      number
  carbs:    number
}

export function calcMacros(per100gNutrients: Per100gNutrients, totalGrams: number): CalcMacrosResult {
  const f = totalGrams / 100
  return {
    calories: Math.round(per100gNutrients.calories * f),
    protein:  Math.round(per100gNutrients.protein  * f * 10) / 10,
    fat:      Math.round(per100gNutrients.fat      * f * 10) / 10,
    carbs:    Math.round(per100gNutrients.carbs    * f * 10) / 10,
  }
}

// ── Barcode lookup (worker endpoint) ─────────────────────────────────────────

/**
 * Resolve a UPC string to a FoodItem via the food worker.
 * Throws on unexpected errors; returns null on 404 ("not in our library").
 */
export async function lookupBarcode(rawUpc: string): Promise<FoodItem | null> {
  const res = await fetch(`${FOOD_WORKER_URL}/barcode/${encodeURIComponent(rawUpc)}`)
  if (res.status === 404) return null
  if (!res.ok)            throw new Error(`Lookup failed (HTTP ${res.status})`)

  const row = await res.json() as FoodRowFromDB
  return mapRow(row)
}
