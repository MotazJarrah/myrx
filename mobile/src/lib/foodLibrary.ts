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

/** Worker row shape from GET /portions. */
interface WorkerPortionRow {
  id:           number
  seq_num:      number | null
  amount:       number | null
  measure_unit: string | null
  modifier:     string | null
  portion_desc: string | null
  gram_weight:  number
}

const BASE_PORTIONS: PortionOption[] = [
  { id: 'g',   label: 'grams',  gramWeight: 1       },
  { id: 'oz',  label: 'ounces', gramWeight: 28.3495 },
  { id: 'cup', label: 'cups',   gramWeight: 240     },
]

/**
 * Strip dimensional parentheticals from a USDA modifier — e.g.
 * `"medium (7\" to 7-7/8\" long)"` → `"medium"`,
 * `"extra small (less than 6\" long)"` → `"extra small"`.
 *
 * We DO NOT strip parentheticals that carry content (no measurement
 * keywords), so `"cup (4.86 large eggs)"` survives intact — the
 * "4.86 large eggs" info actually helps the user.
 */
function stripDimensionalParens(s: string): string {
  if (!s) return s
  const stripped = s.replace(
    /\s*\([^)]*(?:["']|inch|cm|mm|long|wide|tall|short|less than|greater than)[^)]*\)/gi,
    '',
  ).trim()
  return stripped.length >= 2 ? stripped : s
}

/** Title-case every word in a portion label so "1 medium" → "1 Medium". */
function titleCaseLabel(s: string): string {
  return s.replace(/(^|[\s,/\-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

/** Build a human-readable label from a worker portion row. */
function formatPortionLabel(p: WorkerPortionRow): string {
  const cleanMod  = p.modifier      ? stripDimensionalParens(p.modifier)      : null
  const cleanDesc = p.portion_desc  ? stripDimensionalParens(p.portion_desc)  : null

  // 1. Free-text portion_description takes precedence when present.
  if (cleanDesc && cleanDesc.length > 0) {
    let s = cleanDesc
    if (cleanMod && !s.toLowerCase().includes(cleanMod.toLowerCase())) {
      s += `, ${cleanMod}`
    }
    return titleCaseLabel(s)
  }

  // 2. Build "{amount} {unit}{, modifier}" or "{amount} {modifier}" if
  //    measure_unit is null (USDA 9999 sentinel). Always include the
  //    amount prefix even when it's 1 — "1 Large" reads better than
  //    just "Large" in a portion picker.
  const parts: string[] = []
  if (p.amount != null) parts.push(String(p.amount))

  if (p.measure_unit) {
    parts.push(p.measure_unit)
    if (cleanMod) parts.push(`, ${cleanMod}`)
  } else if (cleanMod) {
    parts.push(cleanMod)
  }

  // Join with spaces, then squash any "  ," from the comma-prefixed
  // modifier so we don't get double spaces.
  const joined = parts.join(' ').replace(/\s+,/g, ',').trim()
  return joined ? titleCaseLabel(joined) : 'Serving'
}

/**
 * Relevance score for ordering portion chips. Lower = more relevant.
 *
 * Strategy: size-descriptor portions (1 medium, 1 large, 1 small) win
 * over volume measures (1 cup, 1 tbsp) for any food that has both.
 * This normalises across foods where USDA's seq_num is inconsistent —
 * for bananas USDA puts cup variants at seq 1-2 (would otherwise win);
 * for eggs USDA already puts "large" at seq 1.
 *
 * Size keywords are checked against a parenthetical-stripped modifier
 * so `"cup (4.86 large eggs)"` doesn't accidentally match the "large"
 * size boost.
 */
function scorePortion(p: WorkerPortionRow): number {
  let score = p.seq_num ?? 1000

  // Build a normalised string for keyword detection — strip parentheticals
  // first so "cup (4.86 large eggs)" doesn't trigger the "large" boost.
  const stripParens = (s: string | null) => (s ?? '').replace(/\s*\([^)]*\)/g, ' ').toLowerCase()
  const combined = `${stripParens(p.portion_desc)} ${(p.measure_unit ?? '').toLowerCase()} ${stripParens(p.modifier)}`

  // Promotion: size-descriptor portions are the most intuitive.
  // Order: medium > large > small > extra-large > jumbo > extra-small.
  // Check compound sizes (extra X) first to avoid double-matching.
  if      (/\bextra\s+small\b/.test(combined)) score -= 20
  else if (/\bextra\s+large\b/.test(combined)) score -= 40
  else if (/\bmedium\b/.test(combined))        score -= 100
  else if (/\blarge\b/.test(combined))         score -= 80
  else if (/\bsmall\b/.test(combined))         score -= 60
  else if (/\bjumbo\b/.test(combined))         score -= 30

  // Single-unit ("1 X") portions edge out multi-unit ones.
  if (p.amount === null || p.amount === 1) score -= 5

  // Demotion: volume / weight units are less intuitive than size descriptors.
  if (/\bcup\b/.test(combined))                          score += 30
  if (/\btbsp\b|\btablespoon\b/.test(combined))          score += 60
  if (/\btsp\b|\bteaspoon\b/.test(combined))             score += 80
  // NLEA serving = USDA's regulatory serving; rarely what the user wants.
  if (/\bnlea\b/.test(combined))                         score += 200

  return score
}

async function fetchWorkerPortions(source: string, sourceId: string): Promise<WorkerPortionRow[]> {
  try {
    const url = `${FOOD_WORKER_URL}/portions?source=${encodeURIComponent(source)}&source_id=${encodeURIComponent(sourceId)}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as WorkerPortionRow[] | null
    return data ?? []
  } catch {
    return []
  }
}

/**
 * Branded → generic fallback. When a branded food has no portion variants
 * beyond its single package serving, search for a generic equivalent
 * (canonical name minus brand) and pull THAT food's portion list too.
 *
 * Returns portions ALREADY ranked, so the caller can concat without
 * re-sorting.
 */
async function fetchGenericFallbackPortions(food: FoodItem): Promise<WorkerPortionRow[]> {
  if (!food.brand) return []
  // Strip the brand to derive a generic search term. Reuse the existing
  // helper that already handles size/quantity/pack-count stripping.
  const generic = stripNameForGenericSearch(food.name, food.brand)
  if (!generic || generic.length < 2) return []

  const candidates = await searchFoods(generic, 12)
  // Find the first non-branded match — prefer USDA generic foods
  // (foundation/sr_legacy) over ON generic ones, since USDA generally
  // has richer multi-portion data.
  const generics = candidates.filter(c =>
    !c.brand && (c.source === 'usda' || c.source === 'on'),
  )
  if (generics.length === 0) return []
  // Try the top candidates in order — first one with portion data wins.
  for (const cand of generics.slice(0, 3)) {
    const sid = cand.fdcId ?? cand.onId ?? cand.libraryId
    if (!sid) continue
    const portions = await fetchWorkerPortions(cand.source, String(sid))
    if (portions.length > 0) return portions
  }
  return []
}

/**
 * Build portion options for a food.
 *
 * Strategy (in order):
 *   1. Fetch worker portions for this food via /portions.
 *   2. If branded food returned ≤1 portion, also fetch the generic
 *      equivalent's portions (branded → generic fallback) and merge.
 *   3. Format + rank the worker portions by relevance.
 *   4. Interleave with base units (g / Oz / Cup) — base units go AFTER
 *      named portions so the user sees the most-recognisable chips first.
 *   5. If everything above produces nothing useful, fall back to the
 *      hardcoded CATEGORY_PORTIONS list (egg sizes, bread slices, etc.)
 *      that ships in the bundle.
 *
 * The function is async because (1) and (2) hit the network. Callers
 * should already be handling a loading state on the picker.
 */
export async function getFoodPortions(food: FoodItem): Promise<FoodPortionsResult> {
  const sourceId = food.fdcId ?? food.onId ?? food.libraryId
  let workerPortions: WorkerPortionRow[] = []

  if (sourceId && (food.source === 'usda' || food.source === 'on')) {
    workerPortions = await fetchWorkerPortions(food.source, String(sourceId))
  }

  // Branded → generic fallback (decision #2 from the May 22 2026 spec).
  // Trigger when a branded food has only its single package serving
  // (≤1 portion), look up the generic equivalent's portions.
  if (food.brand && workerPortions.length <= 1) {
    const fallback = await fetchGenericFallbackPortions(food)
    if (fallback.length > 0) {
      // Merge — generic portions appended. They'll get sorted into place
      // by scorePortion, but mark them with a high seq_num offset so the
      // branded food's own serving (if any) still leads.
      const offset = (workerPortions[0]?.seq_num ?? 0) + 1000
      const offsetted = fallback.map(p => ({ ...p, seq_num: (p.seq_num ?? 0) + offset }))
      workerPortions = [...workerPortions, ...offsetted]
    }
  }

  // Format + rank + dedupe near-duplicates by gram weight (within 1g).
  let named: PortionOption[] = []
  if (workerPortions.length > 0) {
    const ranked = [...workerPortions].sort((a, b) => scorePortion(a) - scorePortion(b))
    const seenGrams = new Set<number>()
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

  // CATEGORY_PORTIONS fallback when worker had nothing.
  if (named.length === 0) {
    const cat = CATEGORY_PORTIONS[detectCategory(food.name) ?? ''] ?? []
    if (cat.length > 0) named = [...cat]
  }

  // Synthesise a chip from the stored serving label as a last resort
  // (covers the case where the food has no portions in D1 yet — e.g.
  // a freshly-added myrx food with just its serving_g + serving_label).
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

  // Always ALSO show the food's default serving chip (e.g. "Serving (50g)")
  // when we have a server-stored serving_g — gives users a quick "one full
  // serving as labeled on the package" tap.
  const srvG = food.servingGrams && food.servingGrams > 0 ? food.servingGrams : null
  const srvChip: PortionOption | null = srvG
    ? { id: 'srv', label: `Serving (${Math.round(srvG)}g)`, gramWeight: srvG }
    : null

  // Final ordering — interleaved by relevance:
  //   1. Named portions, sorted by score (most relevant first)
  //   2. Default serving chip (if any)
  //   3. Base units (g / Oz / Cup)
  const portions: PortionOption[] = [
    ...named,
    ...(srvChip ? [srvChip] : []),
    ...BASE_PORTIONS,
  ]

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

/**
 * Strip a food product name down to a generic search term.
 *
 * UPC lookups often return the wrong item (mislinked entries, stale data,
 * the user is actually eating a different variant). Instead of trusting
 * the UPC match, we use its name as a seed for a regular FTS search so
 * the user can pick the right variant from a list.
 *
 * The strip rules remove the parts of a product name that ANCHOR it to
 * a specific SKU but aren't useful for finding generic equivalents:
 *   - brand prefix         "Trader Joe's Almond Butter" → "almond butter"
 *   - size / quantity      "Coca-Cola 12 fl oz"          → "coca cola"
 *   - pack count           "Oreos 6 ct"                  → "oreos"
 *   - packaging words      "Heinz Ketchup Bottle"        → "ketchup"
 *   - parenthesized notes  "Greek Yogurt (Plain)"        → "greek yogurt"
 *   - trailing punctuation
 *
 * If the strip removes everything (unusual brand-only name), falls back
 * to the original name so the search still has something to match on.
 */
export function stripNameForGenericSearch(name: string, brand?: string | null): string {
  if (!name) return ''
  let s = name.toLowerCase().trim()

  // Drop the brand if it appears anywhere in the name (some entries put
  // the brand at the front, others in the middle).
  if (brand) {
    const b = brand.toLowerCase().trim()
    if (b.length >= 2) {
      // Escape regex special chars in the brand.
      const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), ' ')
    }
  }

  // Drop parenthesized descriptors.
  s = s.replace(/\([^)]*\)/g, ' ')
  s = s.replace(/\[[^\]]*\]/g, ' ')

  // Drop size / quantity tokens (any number followed by a unit).
  s = s.replace(/\b\d+(\.\d+)?\s*(fl\s*oz|fluid\s*ounces?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|litres?)\b/gi, ' ')
  // Drop pack-count tokens.
  s = s.replace(/\b\d+\s*(ct|count|pack|pk|pieces?|servings?|bars?|cans?|bottles?|pouches?)\b/gi, ' ')
  // Drop any leftover bare numbers (catches "12 pack" → "12" after the unit was stripped).
  s = s.replace(/\b\d+(\.\d+)?\b/g, ' ')

  // Drop common packaging words.
  s = s.replace(/\b(can|cans|bottle|bottles|jar|jars|bag|bags|box|boxes|carton|cartons|pouch|pouches|container|containers|case|cases|tray|trays|tub|tubs|stick|sticks|tube|tubes|wrapper|sleeve|family\s*size|family\s*pack|value\s*pack|jumbo|original|classic|new|improved)\b/gi, ' ')

  // Collapse punctuation + whitespace.
  s = s.replace(/[,.\-_/:;'"!?®™©]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  // If we stripped everything (e.g. the name was all brand + size), fall
  // back to the original name minus the brand so search has SOMETHING.
  if (s.length < 2) {
    s = name.toLowerCase().replace(/[,.\-_/:;'"!?®™©]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  return s
}
