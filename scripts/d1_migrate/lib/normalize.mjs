/**
 * Shared normalization, parsing, and filtering helpers.
 * All functions are pure — no mutations, no side effects.
 */

/**
 * Normalize any barcode format to 12-digit UPC-A.
 * Handles UPC-A (12), EAN-13 (13), GTIN-14 (14).
 * Returns null for invalid / all-zero barcodes.
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null   // all-zero GTIN = no real barcode
  return stripped.padStart(12, '0')
}

/**
 * Parse "Product Name by Brand Name" into { name, brand }.
 * Splits on the LAST occurrence of " by " so names like
 * "Fire Roasted by Trader Joe's" work correctly.
 * If no " by " is found, brand is null.
 * @param {string} str
 * @returns {{ name: string, brand: string | null }}
 */
export function parseNameByBrand(str) {
  const trimmed = str.trim()
  const idx = trimmed.lastIndexOf(' by ')
  if (idx <= 0) return { name: trimmed, brand: null }
  return {
    name:  trimmed.slice(0, idx).trim(),
    brand: trimmed.slice(idx + 4).trim() || null,
  }
}

const NUTRIENT_KEY = {
  1008: 'kcal',
  1003: 'protein_g',
  1004: 'fat_g',
  1005: 'carbs_g',
  1079: 'fiber_g',
  1093: 'sodium_mg',
}

/**
 * Extract macros from a USDA FDC food's `foodNutrients` array.
 * Returns an object with kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg.
 * @param {any[]} foodNutrients
 * @returns {Record<string, number | null>}
 */
export function extractMacros(foodNutrients) {
  const macros = { kcal: null, protein_g: null, fat_g: null, carbs_g: null, fiber_g: null, sodium_mg: null }
  for (const fn of foodNutrients ?? []) {
    const id = fn.nutrient?.id ?? fn.nutrientId
    const key = NUTRIENT_KEY[id]
    if (!key) continue
    const val = fn.amount ?? fn.value
    if (val != null && isFinite(val)) macros[key] = Math.round(val * 100) / 100
  }
  return macros
}

/**
 * Normalize USDA serving info into { serving_g, serving_label }.
 * Converts oz → g when the unit is 'oz'.
 * @param {any} food  USDA FDC food object
 * @returns {{ serving_g: number | null, serving_label: string | null }}
 */
export function extractServing(food) {
  let serving_g = null
  const sz = parseFloat(food.servingSize)
  if (!isNaN(sz) && sz > 0) {
    const unit = (food.servingSizeUnit || '').toLowerCase()
    if (unit === 'g')  serving_g = Math.round(sz * 10) / 10
    if (unit === 'ml') serving_g = Math.round(sz * 10) / 10
    if (unit === 'oz') serving_g = Math.round(sz * 28.3495 * 10) / 10
  }
  return {
    serving_g,
    serving_label: food.householdServingFullText?.trim() || null,
  }
}

/**
 * Decide whether a food should be excluded from the DB.
 * @param {{ upc: string | null, kcal: number | null, discontinued?: boolean }} food
 * @returns {boolean}
 */
export function shouldSkip({ upc, kcal, discontinued = false }) {
  if (!upc)           return true   // no barcode = not scannable
  if (kcal === 0)     return true   // zero-calorie items not tracked
  if (discontinued)   return true   // discontinued products removed
  return false
}

/**
 * Compare two food records to detect changes.
 * Returns true if they are functionally identical.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @returns {boolean}
 */
export function foodsEqual(a, b) {
  const FIELDS = ['name', 'brand', 'kcal', 'protein_g', 'fat_g', 'carbs_g',
                  'fiber_g', 'sodium_mg', 'serving_g', 'serving_label', 'upc']
  return FIELDS.every(f => {
    const av = a[f] ?? null
    const bv = b[f] ?? null
    if (typeof av === 'number' && typeof bv === 'number')
      return Math.abs(av - bv) < 0.001
    return av === bv
  })
}
