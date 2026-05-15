/**
 * Reverse the brand-prefix damage from Rule 2's second pass.
 *
 * The second Rule 2 run with the corrected SQL filter accidentally rotated
 * 1-word brand prefixes (Pillsbury, Kellogg, Tyson, Kraft, etc.) to the end
 * of the food name. That's wrong — those are brands, not categories.
 *
 * This script reverses the rotation for the known-bad brands by detecting
 * "<food> Brand," patterns and rewriting back to "Brand, <food>,".
 *
 * Babyfood IS arguably a category (the rotated form "Apple Yogurt Dessert
 * Babyfood, Strained" reads acceptably), so it's NOT reversed here.
 *
 * Usage:
 *   node scripts/d1_migrate/reverse_brand_rotation.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_reverse_rotation')

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const RETRY_ATTEMPTS = 4
const RETRY_DELAY_MS = 6_000

// 1-word brand names that we incorrectly rotated. Babyfood deliberately
// excluded — its rotated form reads OK and it's category-adjacent.
const BRANDS_TO_REVERSE = [
  'Pillsbury', 'Kellogg', 'Tyson', 'Kraft', 'Nestle', 'Lipton',
  'Skippy', 'Hostess', 'Quaker', 'Gerber', 'Eggo', 'Bobcat',
  'Heinz', 'Campbell', 'Knorr', 'Lipton',
]

function esc(v) {
  return `'${String(v).replace(/'/g, "''")}'`
}
function fmt(n) { return n.toLocaleString() }

function execWrangler(args) {
  return execSync(`npx wrangler ${args}`, {
    cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
}

function runSelectJson(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim()
  const args = `d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --command "${flat.replace(/"/g, '\\"')}" --json`
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const out = execWrangler(args)
      const start = out.indexOf('[')
      return JSON.parse(out.slice(start))?.[0]?.results ?? []
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const end = Date.now() + RETRY_DELAY_MS * attempt
      while (Date.now() < end) { /* spin */ }
    }
  }
  return []
}

function runFile(sqlFilePath) {
  execWrangler(`d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --file "${sqlFilePath}"`)
}

// Reverse a rotated name: "<food> Brand, <rest>" → "Brand, <food>, <rest>"
function reverseRotate(name, brand) {
  // Strict pattern: brand word immediately before the first comma, with at
  // least one space before brand (i.e. brand isn't the first word).
  const re = new RegExp(`^(.+?)\\s${brand}(,\\s)(.*)$`)
  const m = name.match(re)
  if (!m) return null
  const food = m[1]
  const rest = m[3]
  return `${brand}, ${food}, ${rest}`
}

async function main() {
  console.log('Reverse brand-prefix rotation damage')
  console.log('────────────────────────────────────────────────────────────────')

  const allUpdates = []
  for (const brand of BRANDS_TO_REVERSE) {
    const rows = runSelectJson(`
      SELECT id, name FROM food_library
      WHERE name LIKE '% ${brand},%'
    `)
    let brandHits = 0
    for (const r of rows) {
      const fixed = reverseRotate(r.name, brand)
      if (fixed && fixed !== r.name) {
        allUpdates.push({ id: r.id, name: fixed })
        brandHits++
      }
    }
    if (brandHits > 0) console.log(`  ${brand}:  ${fmt(brandHits)} rows queued`)
  }

  console.log(`\n  Total: ${fmt(allUpdates.length)} rows to reverse`)
  if (!allUpdates.length) return

  // Show samples
  console.log('\n  Sample reversals:')
  for (let i = 0; i < Math.min(8, allUpdates.length); i++) {
    const before = runSelectJson(`SELECT name FROM food_library WHERE id = ${allUpdates[i].id}`)?.[0]?.name
    console.log(`    "${before}"  →  "${allUpdates[i].name}"`)
  }

  // Flush as one --file
  const fp = path.join(TMP_DIR, 'reverse.sql')
  const lines = allUpdates.map(u => `UPDATE food_library SET name = ${esc(u.name)} WHERE id = ${u.id};`)
  fs.writeFileSync(fp, lines.join('\n'))
  runFile(fp)
  fs.unlinkSync(fp)

  console.log(`\n  Done. Reversed ${fmt(allUpdates.length)} rows.`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
