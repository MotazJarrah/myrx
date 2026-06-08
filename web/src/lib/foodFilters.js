/**
 * Shared filter library — applied at INSERT time during bulk import AND
 * by the ongoing sync scripts (sync_usda.mjs / sync_on.mjs).
 *
 * Single source of truth for the per-row rules that came out of the
 * 2026-05-14 audit. Approved rules from docs/food_library_filters.md.
 *
 * Rule numbers reflect EXECUTION ORDER, not chronological history. Rule 1
 * runs first, Rule 19 last. See `docs/food_library_filters.md` for the
 * history of when each rule was added.
 *
 * ── Usage in loaders ───────────────────────────────────────────────────────
 *   const enriched = enrichFood(rawRow)
 *   if (!shouldKeepFood(enriched)) continue
 *   pushRow(enriched)
 *
 * ── Rule evaluation hierarchy (see docs/food_library_filters.md) ──────────
 *
 *   Tier 1 — REPAIR (executed in this order inside enrichFood)
 *     Rule 1   Drop redundant tail-comma duplication
 *              ("Italian Style Meatballs, Italian Style" → "Italian Style Meatballs")
 *     Rule 2   USDA leading-category prefix normalization
 *              ("Nuts, cashew nuts, raw" → "Cashew Nuts, Raw")
 *     Rule 3   Title-case all-uppercase names ("POTATO CHIPS" → "Potato Chips")
 *              with NFS/NS/Mc preservation
 *     Rule 4   Backfill missing kcal from macros (4p + 9f + 4c)
 *
 *   Tier 2 — REJECT structurally broken
 *     Rule 5   Wrong-category subtypes (sub_sample_food, agricultural_acquisition)
 *     Rule 6   Name length < 3 characters (truncation / parsing artifact)
 *     Rule 7   Name contains QA-leak / discontinued / test phrases
 *     Rule 8   All four macros null or zero (after Rule 4 repair)
 *     Rule 9   kcal density > 900 per 100g (physically impossible)
 *     Rule 10  Sum of macros > 105g per 100g (impossible mass)
 *     Rule 11  Any single macro > 100g per 100g (impossible mass)
 *
 *   Tier 3 — REJECT internally inconsistent
 *     Rule 12  kcal differs from (4p + 9f + 4c) by > 50%
 *     Rule 13  Per-serving kcal > 3,000 (single-serving impossibility)
 *
 *   Tier 4 — REJECT negligible
 *     Rule 14  Branded entries with per-serving < 5 kcal
 *
 *   Tier 5 — DEDUP (cross-row, runs post-import as DELETEs)
 *     Rule 15  Exact dedup on name + brand + macros + serving_label + upc
 *     Rule 16  Brand-product dedup on name + brand + macros + serving_g
 *     Rule 17  Cross-source UPC dedup (USDA vs ON), prefer ON on kcal match
 *     Rule 18  Intra-source UPC dedup, keep highest source_id per kcal match
 *     Rule 19  UPC dedup with ≤5 kcal tolerance (label-rounding cleanup)
 *
 * If you change a rule in this file, update docs/food_library_filters.md
 * and re-run the cleanup migration. The doc is the spec; this file is
 * its implementation.
 */

// ── Tier 1: REPAIR ───────────────────────────────────────────────────────────

/**
 * Rule 3 — Title-case all-uppercase text (applied to both name + brand).
 *
 * USDA branded-food entries arrive in ALL CAPS in both the description AND
 * the brand_owner field. OpenNutrition uses Title Case. After cross-source
 * dedup keeps ON's row over USDA's, the surviving USDA rows still look
 * visually inconsistent — `POTATO CHIPS, SEA SALT` (or brand `CAMPBELL SOUP
 * COMPANY`) sitting next to `Roasted Almonds` (brand `Good & Gather`). This
 * normalises any entirely-uppercase string to title case.
 *
 * Boundary regex: re-uppercase the first unicode letter after start-of-string
 * or whitespace, comma, slash, paren, hyphen, ampersand, period, opening
 * bracket. Apostrophe is NOT a boundary, so "Trader Joe's" survives (the
 * "s" after the apostrophe stays lowercase).
 *
 * Tradeoff accepted: most acronyms ("BBQ", "USDA") become title case
 * ("Bbq", "Usda"). Low frequency. We DO preserve specific high-value
 * tokens via post-pass:
 *   - USDA name qualifiers: NFS, NS, NFSMI
 *   - Mc/Mac brand prefixes: McDonald's, McKee, McGriddles, etc.
 *   - Corporate suffixes in brand strings: LLC, USA, US, GmbH
 *     (Inc., Co., Ltd., Corp., S.A. handle themselves because the period
 *      is already a title-case boundary)
 *
 * Touches ONLY strings where the input was entirely uppercase
 * (`UPPER(x) === x` AND at least one ASCII letter present). Mixed-case
 * inputs are left as-is — we trust the source's casing.
 */
const TITLE_CASE_BOUNDARY = /(^|[\s,/()\-&.\[])(\p{L})/gu

// USDA acronyms, corporate suffixes, and known acronym brand names that we
// restore after the naive title-case lowercases them. Each entry is
// `[regex, replacement]`. Only fires on standalone tokens (word boundaries)
// so we don't damage substrings.
const PRESERVE_ACRONYMS = [
  // USDA name qualifiers.
  [/(^|[\s,(])Nfsmi(\b)/g, '$1NFSMI$2'],
  [/(^|[\s,(])Nfs(\b)/g,   '$1NFS$2'],
  [/(^|[\s,(])Ns(\b)/g,    '$1NS$2'],
  // Corporate suffixes (live mostly in brand strings).
  //   LLC / Llc → LLC
  //   USA / Usa → USA
  //   US / Us   → US (rare false-positive risk; word boundary + acceptable tradeoff)
  //   GmbH      → GmbH (mixed-case German corporate suffix)
  [/(^|[\s,(])Llc(\b)/g,   '$1LLC$2'],
  [/(^|[\s,(])Usa(\b)/g,   '$1USA$2'],
  [/(^|[\s,(])Us(\b)/g,    '$1US$2'],
  [/(^|[\s,(])Gmbh(\b)/g,  '$1GmbH$2'],
  // Known acronym brands (would otherwise round-trip to title case and lose
  // their all-caps form). Examples: PB2, IGA, IHOP, KFC, GNC, EAS.
  [/(^|[\s,(])Pb2(\b)/g,   '$1PB2$2'],
  [/(^|[\s,(])Iga(\b)/g,   '$1IGA$2'],
  [/(^|[\s,(])Ihop(\b)/g,  '$1IHOP$2'],
  [/(^|[\s,(])Kfc(\b)/g,   '$1KFC$2'],
  [/(^|[\s,(])Gnc(\b)/g,   '$1GNC$2'],
  [/(^|[\s,(])Eas(\b)/g,   '$1EAS$2'],
  // Mixed-case brand stylings (MiO drink mix, SoBe lifewater).
  [/(^|[\s,(])Mio(\b)/g,   '$1MiO$2'],
  [/(^|[\s,(])Sobe(\b)/g,  '$1SoBe$2'],
]

// Mc/Mac brand fragments that lose their inner capital after lowercase +
// title-case. Whitelist on purpose so legitimate "Macaroni" / "Machine"
// stay correctly lowercased after the "M".
const MC_REPAIRS = [
  [/\bMcdonald\b/g,    'McDonald'],
  [/\bMckee\b/g,       'McKee'],
  [/\bMcgriddles?\b/g, 'McGriddles'],
  [/\bMcmuffin\b/g,    'McMuffin'],
  [/\bMcnuggets\b/g,   'McNuggets'],
  [/\bMcflurry\b/g,    'McFlurry'],
  [/\bMcchicken\b/g,   'McChicken'],
  [/\bMcrib\b/g,       'McRib'],
]

// Title-case any all-uppercase string. Used for both the `name` and `brand`
// fields of food_library — same logic, same preservation lists.
function titleCaseAllCaps(s) {
  if (s == null) return s
  const str = String(s)
  if (str.toUpperCase() !== str) return s
  if (!/[A-Z]/.test(str)) return s
  let out = str.toLowerCase().replace(TITLE_CASE_BOUNDARY, (_, sep, c) => sep + c.toUpperCase())
  // Restore acronyms, corporate suffixes, and Mc prefixes that the naive
  // title-case damaged.
  for (const [re, sub] of PRESERVE_ACRONYMS) out = out.replace(re, sub)
  for (const [re, sub] of MC_REPAIRS)        out = out.replace(re, sub)
  return out
}

// Backward-compatible alias — keeps any existing callers working.
const titleCaseName = titleCaseAllCaps

/**
 * Rule 2 — USDA leading-category prefix normalization.
 *
 * Rewrites SR-Legacy / FNDDS / Foundation names where the first
 * comma-segment is a single broad category word into natural English:
 *
 *   "Nuts, cashew nuts, raw"      →  "Cashew Nuts, Raw"     (drop, category in second)
 *   "Nuts, almonds, dry roasted"  →  "Almonds, Dry Roasted" (drop, plural noun)
 *   "Beans, kidney, royal red,…"  →  "Kidney Beans, Royal Red,…" (rotate)
 *   "Pickles, dill"               →  "Dill Pickles"           (rotate)
 *   "Spices, garlic powder"       →  "Garlic Powder"          (always-drop)
 *
 * Skipped on purpose:
 *   "Tortilla chips, low fat, …"     multi-word first segment
 *   "APPLEBEE'S, mozzarella sticks"  brand-as-prefix
 *   "Milk, NFS" / "Soup, NFS"        single short-acronym qualifier
 */
const RULE2_DROP_ONLY     = new Set(['spices', 'beverages'])
const RULE2_QUALIFIER     = /^(NFS|NS)$/
const RULE2_ADJECTIVE_S   = /(less|ous|ious|eous)$/

// CATEGORY WHITELIST — only single-word leading segments in this set get
// rewritten by Rule 2. This is the post-audit guard: an open "any single
// word is a category" approach incorrectly rotated 1-word brand names
// (Pillsbury, Kraft, Nestle, etc.). Restricting to a whitelist eliminates
// that false-positive class entirely.
const RULE2_CATEGORIES = new Set([
  // grains, breads, pasta
  'bread', 'breads', 'bagel', 'bagels', 'bun', 'buns', 'roll', 'rolls',
  'crepe', 'crepes', 'waffle', 'waffles', 'pancake', 'pancakes',
  'tortilla', 'tortillas', 'pasta', 'macaroni', 'noodle', 'noodles',
  'pretzel', 'pretzels', 'cracker', 'crackers', 'chip', 'chips',
  'cereal', 'cereals', 'rice', 'flour', 'oat', 'oats', 'oatmeal',
  'granola', 'pita', 'naan',
  // proteins
  'fish', 'beef', 'pork', 'lamb', 'chicken', 'turkey', 'veal', 'duck',
  'goose', 'venison', 'rabbit', 'bacon', 'ham', 'sausage', 'sausages',
  'shrimp', 'lobster', 'crab', 'crayfish', 'oyster', 'oysters',
  'scallop', 'scallops', 'mussel', 'mussels', 'clam', 'clams',
  'egg', 'eggs', 'tofu', 'tempeh', 'seitan',
  // produce
  'mushroom', 'mushrooms', 'pepper', 'peppers', 'cassava', 'kale',
  'cabbage', 'broccoli', 'cauliflower', 'spinach', 'lettuce',
  'celery', 'onion', 'onions', 'potato', 'potatoes', 'tomato',
  'tomatoes', 'carrot', 'carrots', 'beet', 'beets', 'turnip',
  'turnips', 'snowpeas', 'cowpeas', 'olives', 'gherkins', 'apple',
  'apples', 'banana', 'bananas', 'orange', 'oranges', 'mango',
  'pineapple', 'strawberry', 'strawberries', 'meyer',
  // dairy
  'cheese', 'cheeses', 'milk', 'yogurt', 'yogurts', 'butter', 'cream',
  'margarine', 'sherbet', 'sorbet', 'sherbets',
  // nuts and legumes
  'nuts', 'nut', 'seeds', 'seed', 'beans', 'bean', 'peas', 'lentils',
  'chickpeas', 'almond', 'almonds', 'cashews', 'walnuts', 'pecans',
  'pistachios', 'hazelnuts',
  // sweets
  'candy', 'candies', 'cookie', 'cookies', 'pie', 'pies', 'cake',
  'cakes', 'muffin', 'muffins', 'doughnut', 'doughnuts', 'donut',
  'donuts', 'pastry', 'pastries', 'frostings', 'frosting',
  'chocolate', 'chocolates', 'pudding', 'puddings', 'custard',
  'cheesecake', 'brownie', 'brownies', 'sundae', 'sundaes',
  // savory dishes
  'soup', 'soups', 'stew', 'stews', 'salad', 'salads', 'sandwich',
  'sandwiches', 'pizza', 'pizzas', 'sauce', 'sauces', 'dressing',
  'dressings', 'relish', 'pickles', 'pickle', 'mustard', 'mayonnaise',
  'ketchup', 'jam', 'jams', 'jelly', 'jellies', 'honey', 'syrup',
  'syrups',
  // beverages / oils / spices
  'coffee', 'tea', 'soda', 'sodas', 'water', 'juice', 'juices',
  'oil', 'oils', 'vinegar', 'spices', 'spice', 'salt',
  // misc generic
  'snacks', 'snack', 'beverages', 'beverage', 'vegetable', 'vegetables',
  'fruit', 'fruits', 'meat', 'meats', 'poultry', 'shellfish', 'seafood',
  'babyfood', 'game',
])

/**
 * Rule 1 — Drop redundant tail-comma duplication.
 *
 * USDA / ON branded names often concatenate the description with a flavor
 * variant or subBrand string, producing redundant tail segments:
 *
 *   "Italian Style Meatballs, Italian Style"
 *      → "Italian Style Meatballs"
 *
 *   "Cookies 'n' Creme Bars, Cookies 'n' Creme"
 *      → "Cookies 'n' Creme Bars"
 *
 *   "Mango, Carrot & Banana Smoothie Blends, Mango, Carrot & Banana"
 *      → "Mango, Carrot & Banana Smoothie Blends"
 *
 * Algorithm: scan left-to-right for the leftmost ", " position where the
 * tail (everything after) appears as a substring of the head (everything
 * before). First match wins, which yields the LARGEST tail dropped.
 *
 * Safeguards (avoid trivial coincidental matches):
 *   - tail length > 4 chars
 *   - head length > 6 chars (don't truncate result to near-nothing)
 *   - case-insensitive substring check
 *
 * Pure substring check — no whitelist needed. If the head genuinely
 * contains the tail, it's redundant.
 */
function rule1DropRedundantTail(name) {
  if (name == null) return name
  const s = String(name)
  const lower = s.toLowerCase()
  let pos = lower.indexOf(', ')
  while (pos !== -1) {
    const head = lower.substring(0, pos)
    const tail = lower.substring(pos + 2)
    if (tail.length > 4 && head.length > 6 && head.includes(tail)) {
      return s.substring(0, pos)
    }
    pos = lower.indexOf(', ', pos + 1)
  }
  return s
}

function rule2PrefixNormalize(name) {
  if (name == null) return name
  const segs = String(name).split(', ')
  if (segs.length < 2) return name

  const first = segs[0]
  const rest  = segs.slice(1)

  if (first.includes(' '))            return name  // multi-word leading segment
  if (/'s$/i.test(first))             return name  // brand prefix (apostrophe-s)
  if (rest.length === 1 && RULE2_QUALIFIER.test(rest[0])) return name

  const firstLower  = first.toLowerCase()

  // Whitelist guard — only proceed if the first word is a known food category.
  if (!RULE2_CATEGORIES.has(firstLower)) return name

  const singular    = firstLower.replace(/s$/, '')
  const plural      = singular + 's'
  const secondLower = rest[0].toLowerCase()
  const secondWords = secondLower.split(/[\s,]+/).filter(Boolean)

  if (RULE2_DROP_ONLY.has(firstLower)) return rest.join(', ')
  if (secondWords.includes(singular) || secondWords.includes(plural)) return rest.join(', ')

  if (secondWords.length === 1) {
    const w = secondWords[0]
    if (w.endsWith('s') && w.length > 3 && !RULE2_ADJECTIVE_S.test(w)) {
      return rest.join(', ')
    }
  }

  const newRest = [...rest]
  newRest[0] = newRest[0] + ' ' + first
  return newRest.join(', ')
}

/**
 * Rule 4 — Backfill missing kcal from macros.
 *
 * Returns a new row with `kcal` set to the 4/9/4 prediction when kcal was
 * null but at least one macro is present. Idempotent: rows with a non-null
 * kcal pass through unchanged. Rows with all-null macros pass through
 * unchanged (they'll be caught by Rule 8).
 *
 * Also applies Rules 1, 2, and 3 to the name field when applicable.
 *
 * Runs BEFORE shouldKeepFood so subsequent rules see a complete row.
 *
 * @param {object} row
 * @returns {object} — same row, possibly with kcal filled in / name normalized
 */
export function enrichFood(row) {
  const { kcal, protein_g, fat_g, carbs_g, name, brand } = row

  // Rule 1 — drop redundant tail-comma duplication. Pure substring check,
  // applies to all rows (branded or not). Runs first so subsequent
  // rules see the de-duplicated name.
  let workingName = rule1DropRedundantTail(name)

  // Rule 2 — USDA leading-category prefix rewrite (only when no brand,
  // since brand-as-prefix patterns aren't applicable to genuinely branded
  // products). Runs after Rule 1 (so the tail-trimmed name is what gets
  // analyzed) and BEFORE title-case so any newly-introduced lowercase
  // from the drop/rotate gets capitalised by titleCaseName().
  if (workingName != null && brand == null) {
    workingName = rule2PrefixNormalize(workingName)
  }

  // Rule 3 — title-case all-caps strings (applied to BOTH name and brand).
  // Same helper, same preservation list. Brand strings benefit too:
  // "CAMPBELL SOUP COMPANY" → "Campbell Soup Company",
  // "WAL-MART STORES, INC." → "Wal-Mart Stores, Inc.", etc.
  const normalizedName  = titleCaseAllCaps(workingName)
  const normalizedBrand = titleCaseAllCaps(brand)

  // Rule 4 — backfill kcal
  let backfilledKcal = kcal
  if (kcal == null && (protein_g != null || fat_g != null || carbs_g != null)) {
    const computed =
      (protein_g ?? 0) * 4 +
      (fat_g ?? 0) * 9 +
      (carbs_g ?? 0) * 4
    if (computed > 0) backfilledKcal = Math.round(computed * 10) / 10
  }

  // Skip the object copy if nothing changed.
  if (normalizedName === name && normalizedBrand === brand && backfilledKcal === kcal) return row
  return { ...row, name: normalizedName, brand: normalizedBrand, kcal: backfilledKcal }
}

// ── Tier 2: name-based rejection helpers ─────────────────────────────────────

/**
 * Rule 7 — Reject QA-leak / discontinued / test phrases inside the name.
 *
 * Patterns observed in USDA branded data — rows that survive the dataset
 * pipeline despite the brand or USDA having marked the product as dead or
 * never-real. Examples:
 *   "CAMPBELL'S SOUP DISCONTINUED"
 *   "DISCONTINUED STOUFFER'S Mac & Cheese 4×64oz"
 *   "This product has been discontinued. 1979: Breakfast Bun..."
 *   "TEST FLAVOR: 855" (Frito-Lay)
 *   "Training Supplier Test Item" (Training Supplier Company)
 *   "SLTEST_DISCONTINUED_USI_NESTLE POPPIN' POPS"
 *
 * Patterns are kept narrow on purpose so legitimate brands stay in
 * ("Testify Sweet & Savory BBQ Sauce" survives — Testify is a real brand).
 */
function nameLooksLikeQaLeak(name) {
  if (!name) return false
  const lower = String(name).toLowerCase()
  // Starts with the word "discontinued"
  if (/^discontinued[\s_]/i.test(name)) return true
  // Embedded "This product has been discontinued."
  if (lower.includes('this product has been discontinued')) return true
  // USDA QA-suite leftovers
  if (/\btest flavor\b/i.test(name)) return true
  if (lower.startsWith('training supplier test')) return true
  if (/^sltest/i.test(name)) return true
  if (lower.includes('sprinkle test tube')) return true
  return false
}

// ── Tier 2-4: PER-ROW REJECTION ──────────────────────────────────────────────

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
  const { name, kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  // Tier 2
  if (source_subtype === 'sub_sample_food')         return 'rule5_sub_sample'
  if (source_subtype === 'agricultural_acquisition') return 'rule5_agricultural'

  if (name != null && String(name).trim().length < 3) return 'rule6_short_name'
  if (nameLooksLikeQaLeak(name))                       return 'rule7_qa_leak'

  const empty = v => v == null || v === 0
  if (empty(kcal) && empty(protein_g) && empty(fat_g) && empty(carbs_g)) {
    return 'rule8_no_macros'
  }

  if (kcal != null && kcal > 900) return 'rule9_density'

  const macroSum = (protein_g ?? 0) + (fat_g ?? 0) + (carbs_g ?? 0)
  if (macroSum > 105) return 'rule10_macro_sum'
  if (protein_g != null && protein_g > 100) return 'rule11_single_macro'
  if (fat_g     != null && fat_g     > 100) return 'rule11_single_macro'
  if (carbs_g   != null && carbs_g   > 100) return 'rule11_single_macro'

  // Tier 3
  if (kcal != null && protein_g != null && fat_g != null && carbs_g != null) {
    const pred = protein_g * 4 + fat_g * 9 + carbs_g * 4
    if (pred >= 20 && Math.abs(kcal - pred) / pred > 0.50) return 'rule12_kcal_mismatch'
  }

  if (kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing > 3000) return 'rule13_per_serving_ceiling'
  }

  // Tier 4
  if ((source_subtype === 'branded_food' || source_subtype === 'on_branded')
      && kcal != null && serving_g != null) {
    const perServing = (kcal * serving_g) / 100
    if (perServing < 5) return 'rule14_branded_negligible'
  }

  return null
}
