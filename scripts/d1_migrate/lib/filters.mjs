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
 *     Rule 15  Title-case all-uppercase names ("POTATO CHIPS" → "Potato Chips")
 *              with NFS/NS/Mc preservation
 *     Rule 17  USDA leading-category prefix normalization
 *              ("Nuts, cashew nuts, raw" → "Cashew Nuts, Raw")
 *
 *   Tier 2 — REJECT structurally broken
 *     Rule 5   Wrong-category subtypes (sub_sample_food, agricultural_acquisition)
 *     Rule 1   All four macros null or zero (after Rule 9 repair)
 *     Rule 6   kcal density > 900 per 100g (physically impossible)
 *     Rule 10  Sum of macros > 105g per 100g (impossible mass)
 *     Rule 11  Any single macro > 100g per 100g (impossible mass)
 *     Rule 12  Name length < 3 characters (truncation / parsing artifact)
 *     Rule 13  Name contains QA-leak / discontinued / test phrases
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
 *     Rule 14  Cross-source UPC dedup (USDA vs ON), prefer ON on kcal match
 *     Rule 16  Intra-source UPC dedup, keep highest source_id per kcal match
 *
 * If you change a rule in this file, update docs/food_library_filters.md
 * and re-run the cleanup migration. The doc is the spec; this file is
 * its implementation.
 */

// ── Tier 1: REPAIR ───────────────────────────────────────────────────────────

/**
 * Rule 15 — Title-case all-uppercase names.
 *
 * USDA branded-food entries arrive in ALL CAPS. OpenNutrition uses Title
 * Case. After cross-source dedup keeps ON's row over USDA's, the surviving
 * USDA rows still look visually inconsistent — `POTATO CHIPS, SEA SALT`
 * sitting next to `Roasted Almonds`. This normalises any entirely-uppercase
 * name to title case.
 *
 * Boundary regex: re-uppercase the first unicode letter after start-of-string
 * or whitespace, comma, slash, paren, hyphen, ampersand, period, opening
 * bracket. Apostrophe is NOT a boundary, so "Trader Joe's" survives (the
 * "s" after the apostrophe stays lowercase).
 *
 * Tradeoff accepted: most acronyms ("BBQ", "USDA") become title case
 * ("Bbq", "Usda"). Low frequency. We DO preserve specific high-value USDA
 * tokens (NFS, NS, NFSMI) and Mc/Mac brand prefixes via a post-pass.
 *
 * Touches ONLY names where the input was entirely uppercase
 * (`UPPER(name) === name` AND at least one ASCII letter present). Mixed-case
 * names are left as-is — we trust the source's casing.
 */
const TITLE_CASE_BOUNDARY = /(^|[\s,/()\-&.\[])(\p{L})/gu

// USDA acronyms that we restore after the naive title-case lowercases them.
const PRESERVE_ACRONYMS = [
  [/(^|[\s,(])Nfsmi(\b)/g, '$1NFSMI$2'],
  [/(^|[\s,(])Nfs(\b)/g,   '$1NFS$2'],
  // " Ns " / ", Ns " / "(Ns " contextual qualifier (avoid touching real
  // words ending in "ns" — only act on word-boundary single-token Ns).
  [/(^|[\s,(])Ns(\b)/g,    '$1NS$2'],
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

function titleCaseName(name) {
  if (name == null) return name
  const s = String(name)
  if (s.toUpperCase() !== s) return name
  if (!/[A-Z]/.test(s)) return name
  let out = s.toLowerCase().replace(TITLE_CASE_BOUNDARY, (_, sep, c) => sep + c.toUpperCase())
  // Restore acronyms and Mc prefixes that the naive title-case damaged.
  for (const [re, sub] of PRESERVE_ACRONYMS) out = out.replace(re, sub)
  for (const [re, sub] of MC_REPAIRS)        out = out.replace(re, sub)
  return out
}

/**
 * Rule 17 — USDA leading-category prefix normalization.
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
const RULE17_DROP_ONLY     = new Set(['spices', 'beverages'])
const RULE17_QUALIFIER     = /^(NFS|NS)$/
const RULE17_ADJECTIVE_S   = /(less|ous|ious|eous)$/

// CATEGORY WHITELIST — only single-word leading segments in this set get
// rewritten by Rule 17. This is the post-audit guard: an open "any single
// word is a category" approach incorrectly rotated 1-word brand names
// (Pillsbury, Kraft, Nestle, etc.). Restricting to a whitelist eliminates
// that false-positive class entirely.
const RULE17_CATEGORIES = new Set([
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

function rule17PrefixNormalize(name) {
  if (name == null) return name
  const segs = String(name).split(', ')
  if (segs.length < 2) return name

  const first = segs[0]
  const rest  = segs.slice(1)

  if (first.includes(' '))            return name  // multi-word leading segment
  if (/'s$/i.test(first))             return name  // brand prefix (apostrophe-s)
  if (rest.length === 1 && RULE17_QUALIFIER.test(rest[0])) return name

  const firstLower  = first.toLowerCase()

  // Whitelist guard — only proceed if the first word is a known food category.
  if (!RULE17_CATEGORIES.has(firstLower)) return name

  const singular    = firstLower.replace(/s$/, '')
  const plural      = singular + 's'
  const secondLower = rest[0].toLowerCase()
  const secondWords = secondLower.split(/[\s,]+/).filter(Boolean)

  if (RULE17_DROP_ONLY.has(firstLower)) return rest.join(', ')
  if (secondWords.includes(singular) || secondWords.includes(plural)) return rest.join(', ')

  if (secondWords.length === 1) {
    const w = secondWords[0]
    if (w.endsWith('s') && w.length > 3 && !RULE17_ADJECTIVE_S.test(w)) {
      return rest.join(', ')
    }
  }

  const newRest = [...rest]
  newRest[0] = newRest[0] + ' ' + first
  return newRest.join(', ')
}

/**
 * Rule 9 — Backfill missing kcal from macros.
 *
 * Returns a new row with `kcal` set to the 4/9/4 prediction when kcal was
 * null but at least one macro is present. Idempotent: rows with a non-null
 * kcal pass through unchanged. Rows with all-null macros pass through
 * unchanged (they'll be caught by Rule 1).
 *
 * Also applies Rule 15 (title-case) to the name field when applicable.
 *
 * Runs BEFORE shouldKeepFood so subsequent rules see a complete row.
 *
 * @param {object} row
 * @returns {object} — same row, possibly with kcal filled in / name normalized
 */
export function enrichFood(row) {
  const { kcal, protein_g, fat_g, carbs_g, name, brand } = row

  // Rule 17 — USDA leading-category prefix rewrite (only when no brand,
  // since brand-as-prefix patterns aren't applicable to genuinely branded
  // products). Runs BEFORE title-case so any newly-introduced lowercase
  // from the drop/rotate gets capitalised by titleCaseName().
  let workingName = name
  if (workingName != null && brand == null) {
    workingName = rule17PrefixNormalize(workingName)
  }

  // Rule 15 — title-case all-caps names (cheap; runs after Rule 17 rewrite)
  const normalizedName = titleCaseName(workingName)

  // Rule 9 — backfill kcal
  let backfilledKcal = kcal
  if (kcal == null && (protein_g != null || fat_g != null || carbs_g != null)) {
    const computed =
      (protein_g ?? 0) * 4 +
      (fat_g ?? 0) * 9 +
      (carbs_g ?? 0) * 4
    if (computed > 0) backfilledKcal = Math.round(computed * 10) / 10
  }

  // Skip the object copy if nothing changed.
  if (normalizedName === name && backfilledKcal === kcal) return row
  return { ...row, name: normalizedName, kcal: backfilledKcal }
}

// ── Tier 2: name-based rejection helpers ─────────────────────────────────────

/**
 * Rule 13 — Reject QA-leak / discontinued / test phrases inside the name.
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
 * Decide whether a candidate row should be inserted into food_library.
 * Rules are checked in the hierarchy documented at the top of this file.
 * The first matching rule wins; later checks are skipped for that row.
 *
 * NOTE: callers should run `enrichFood()` first so Rule 9's backfill has
 * already happened by the time we evaluate the rejection rules.
 *
 * @param {{
 *   name:           string | null,
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
  const { name, kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  // ── Tier 2: REJECT structurally broken ─────────────────────────────────

  // Rule 5 — wrong-category subtypes (USDA research artifacts)
  if (source_subtype === 'sub_sample_food')         return false
  if (source_subtype === 'agricultural_acquisition') return false

  // Rule 12 — name length < 3 chars (truncation / parsing artifact)
  if (name != null && String(name).trim().length < 3) return false

  // Rule 13 — name is a discontinued/test/QA-leak placeholder
  if (nameLooksLikeQaLeak(name)) return false

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
  const { name, kcal, protein_g, fat_g, carbs_g, serving_g, source_subtype } = row

  // Tier 2
  if (source_subtype === 'sub_sample_food')         return 'rule5_sub_sample'
  if (source_subtype === 'agricultural_acquisition') return 'rule5_agricultural'

  if (name != null && String(name).trim().length < 3) return 'rule12_short_name'
  if (nameLooksLikeQaLeak(name))                       return 'rule13_qa_leak'

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
