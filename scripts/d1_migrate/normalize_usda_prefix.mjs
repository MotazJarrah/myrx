/**
 * Rule 2 — USDA leading-category prefix normalization.
 *
 * Rewrites USDA SR-Legacy / FNDDS / Foundation style names where the first
 * comma-segment is a single broad category word (e.g. "Nuts, ...", "Beans,
 * ...", "Cheese, Brick") into natural English:
 *
 *   "Nuts, cashew nuts, raw"      →  "Cashew Nuts, Raw"
 *   "Nuts, almonds, dry roasted"  →  "Almonds, Dry Roasted"
 *   "Beans, kidney, royal red, …" →  "Kidney Beans, Royal Red, …"
 *   "Pickles, dill"               →  "Dill Pickles"
 *   "Spices, garlic powder"       →  "Garlic Powder"
 *   "Mushrooms, raw"              →  "Raw Mushrooms"
 *
 * Skipped intentionally:
 *   "Tortilla chips, low fat, …"    multi-word first segment (already specific)
 *   "APPLEBEE'S, mozzarella sticks" brand-as-prefix (ends in 's)
 *   "Milk, NFS" / "Yogurt, NFS"     short uppercase qualifier suffix
 *
 * Target cohort: ~1,740 rows. Generic only (`brand IS NULL`).
 *
 * Usage:
 *   node --max-old-space-size=4096 scripts/d1_migrate/normalize_usda_prefix.mjs
 */

import fs           from 'fs'
import os           from 'os'
import path         from 'path'
import { execSync } from 'child_process'

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT_DIR        = path.resolve(import.meta.dirname, '../..')
const WRANGLER_CONFIG = path.resolve(ROOT_DIR, 'workers/food-search/wrangler.toml')
const DB_NAME         = 'myrx-food-library'
const TMP_DIR         = path.join(os.tmpdir(), 'd1_normalize_prefix')

const SELECT_PAGE_SIZE   = 2_000
const UPDATE_BATCH_SIZE  = 500
const UPDATE_CONCURRENCY = 4
const RETRY_ATTEMPTS     = 4
const RETRY_DELAY_MS     = 6_000

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Transformations ──────────────────────────────────────────────────────────

// Always-drop prefixes — these categories are implicit in any specific spice
// or beverage so the leading category word adds no signal.
const DROP_ONLY = new Set(['spices', 'beverages'])

// 2-segment names whose second segment is a tiny uppercase qualifier (NFS =
// Not Further Specified, NS = Not Specified). These are intentional USDA
// FNDDS suffix qualifiers, not sibling food descriptors — keep as-is.
const QUALIFIER_REST = /^(NFS|NS)$/

// Words ending in 's' that are adjectives, not plural nouns. We must NOT use
// "ends-in-s" as a plural-drop trigger for these (e.g. "Bacon, meatless"
// should rotate to "Meatless Bacon", not drop "Bacon").
const ADJECTIVE_S_SUFFIX = /(less|ous|ious|eous)$/

// Category whitelist — only single-word leading segments in this set get
// rewritten. Keeps brand prefixes (Pillsbury, Kraft, Nestle, etc.) safe.
const CATEGORIES = new Set([
  'bread','breads','bagel','bagels','bun','buns','roll','rolls','crepe','crepes',
  'waffle','waffles','pancake','pancakes','tortilla','tortillas','pasta',
  'macaroni','noodle','noodles','pretzel','pretzels','cracker','crackers',
  'chip','chips','cereal','cereals','rice','flour','oat','oats','oatmeal',
  'granola','pita','naan',
  'fish','beef','pork','lamb','chicken','turkey','veal','duck','goose',
  'venison','rabbit','bacon','ham','sausage','sausages','shrimp','lobster',
  'crab','crayfish','oyster','oysters','scallop','scallops','mussel','mussels',
  'clam','clams','egg','eggs','tofu','tempeh','seitan',
  'mushroom','mushrooms','pepper','peppers','cassava','kale','cabbage',
  'broccoli','cauliflower','spinach','lettuce','celery','onion','onions',
  'potato','potatoes','tomato','tomatoes','carrot','carrots','beet','beets',
  'turnip','turnips','snowpeas','cowpeas','olives','gherkins','apple','apples',
  'banana','bananas','orange','oranges','mango','pineapple','strawberry',
  'strawberries','meyer',
  'cheese','cheeses','milk','yogurt','yogurts','butter','cream','margarine',
  'sherbet','sorbet','sherbets',
  'nuts','nut','seeds','seed','beans','bean','peas','lentils','chickpeas',
  'almond','almonds','cashews','walnuts','pecans','pistachios','hazelnuts',
  'candy','candies','cookie','cookies','pie','pies','cake','cakes','muffin',
  'muffins','doughnut','doughnuts','donut','donuts','pastry','pastries',
  'frostings','frosting','chocolate','chocolates','pudding','puddings',
  'custard','cheesecake','brownie','brownies','sundae','sundaes',
  'soup','soups','stew','stews','salad','salads','sandwich','sandwiches',
  'pizza','pizzas','sauce','sauces','dressing','dressings','relish','pickles',
  'pickle','mustard','mayonnaise','ketchup','jam','jams','jelly','jellies',
  'honey','syrup','syrups',
  'coffee','tea','soda','sodas','water','juice','juices','oil','oils',
  'vinegar','spices','spice','salt',
  'snacks','snack','beverages','beverage','vegetable','vegetables','fruit',
  'fruits','meat','meats','poultry','shellfish','seafood','babyfood','game',
])

function rule2(name) {
  if (name == null) return name
  const segs = String(name).split(', ')
  if (segs.length < 2) return name

  const first = segs[0]
  const rest  = segs.slice(1)

  // Guard 1 — multi-word first segment means it's already a specific food.
  if (first.includes(' ')) return name

  // Guard 2 — brand-as-prefix (apostrophe-s).
  if (/'s$/i.test(first)) return name

  // Guard 3 — single short uppercase qualifier as the rest.
  if (rest.length === 1 && QUALIFIER_REST.test(rest[0])) return name

  const firstLower   = first.toLowerCase()

  // Guard 4 — whitelist of known food categories (the real fix for the
  // 1-word brand false-positive class).
  if (!CATEGORIES.has(firstLower)) return name

  const singular     = firstLower.replace(/s$/, '')
  const plural       = singular + 's'
  const secondLower  = rest[0].toLowerCase()
  const secondWords  = secondLower.split(/[\s,]+/).filter(Boolean)

  // Rule A — always-drop categories
  if (DROP_ONLY.has(firstLower)) return rest.join(', ')

  // Rule B — second already contains the category word
  if (secondWords.includes(singular) || secondWords.includes(plural)) {
    return rest.join(', ')
  }

  // Rule C — single plural noun second segment (not an -less/-ous adjective)
  if (secondWords.length === 1) {
    const w = secondWords[0]
    if (w.endsWith('s') && w.length > 3 && !ADJECTIVE_S_SUFFIX.test(w)) {
      return rest.join(', ')
    }
  }

  // Rule D — rotate: append category to the first remaining segment
  const newRest = [...rest]
  newRest[0] = newRest[0] + ' ' + first
  return newRest.join(', ')
}

// Same title-case helper as Rule 3. Applied after Rule 2's drop/rotate so
// any lowercase introduced by the source data becomes proper Title Case.
// Preserves USDA acronyms (NFS, NS, NFSMI) and Mc/Mac brand prefixes so we
// don't damage rows that ALREADY had those tokens in the source.
const TITLE_CASE_BOUNDARY = /(^|[\s,/()\-&.\[])(\p{L})/gu
const PRESERVE_ACRONYMS = [
  [/(^|[\s,(])Nfsmi(\b)/g, '$1NFSMI$2'],
  [/(^|[\s,(])Nfs(\b)/g,   '$1NFS$2'],
  [/(^|[\s,(])Ns(\b)/g,    '$1NS$2'],
]
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

function titleCase(s) {
  if (s == null) return s
  let out = String(s).toLowerCase().replace(TITLE_CASE_BOUNDARY, (_, sep, c) => sep + c.toUpperCase())
  for (const [re, sub] of PRESERVE_ACRONYMS) out = out.replace(re, sub)
  for (const [re, sub] of MC_REPAIRS)        out = out.replace(re, sub)
  return out
}

// Run Rule 2 first, then title-case the result so any lowercase introduced
// by the source data becomes proper Title Case. Only act on rows where
// Rule 2 itself changed something OR the input was entirely uppercase —
// avoid touching already-good mixed-case names (e.g. "McDONALD'S, …").
function transform(name) {
  const transformed = rule2(name)
  // If Rule 2 didn't change anything AND the name isn't entirely uppercase,
  // leave it alone — title-case would damage mixed-case brands.
  if (transformed === name && name.toUpperCase() !== name) return name
  return titleCase(transformed)
}

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function fmt(n)    { return n.toLocaleString() }
function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s` }

// ── Wrangler runners ─────────────────────────────────────────────────────────

function execWrangler(args, opts = {}) {
  return execSync(`npx wrangler ${args}`, {
    cwd:       ROOT_DIR,
    stdio:     ['ignore', 'pipe', 'pipe'],
    encoding:  'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  })
}

function runSelectJson(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim()
  const args = `d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --command "${flat.replace(/"/g, '\\"')}" --json`
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const out = execWrangler(args)
      const start = out.indexOf('[')
      if (start < 0) throw new Error(`No JSON in wrangler output: ${out.slice(0, 200)}`)
      return JSON.parse(out.slice(start))?.[0]?.results ?? []
    } catch (err) {
      if (attempt === RETRY_ATTEMPTS) throw err
      const msg = err.stderr?.toString().slice(0, 200) ?? err.message
      console.warn(`  [retry ${attempt}] select: ${msg}`)
      const end = Date.now() + RETRY_DELAY_MS * attempt
      while (Date.now() < end) { /* spin */ }
    }
  }
  return []
}

function runFileAsync(sqlFilePath) {
  return new Promise((resolve, reject) => {
    import('child_process').then(({ spawn }) => {
      const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --config "${WRANGLER_CONFIG}" --file "${sqlFilePath}"`
      let attempt = 0
      const try1 = () => {
        attempt++
        const p = spawn(cmd, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
        let err = ''
        p.stderr.on('data', d => { err += d.toString() })
        p.on('close', code => {
          if (code === 0) return resolve()
          if (attempt >= RETRY_ATTEMPTS) return reject(new Error(`wrangler exited ${code}: ${err.slice(0, 200)}`))
          console.warn(`  [retry ${attempt}] update: ${err.slice(0, 120)}`)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
        p.on('error', e => {
          if (attempt >= RETRY_ATTEMPTS) return reject(e)
          setTimeout(try1, RETRY_DELAY_MS * attempt)
        })
      }
      try1()
    })
  })
}

async function pmap(items, concurrency, task) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await task(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  console.log('Rule 2 — USDA leading-category prefix normalization')
  console.log('────────────────────────────────────────────────────────────────')

  // Target: first comma-segment is a single word, generic row
  const countRow = runSelectJson(`
    SELECT COUNT(*) AS n FROM food_library
    WHERE INSTR(name, ',') > 0
        AND SUBSTR(name, 1, INSTR(name, ',') - 1) NOT LIKE '% %'
        AND brand IS NULL
  `)
  const target = countRow?.[0]?.n ?? 0
  console.log(`  Target: ${fmt(target)} rows`)
  if (target === 0) { console.log('  Nothing to do.'); return }

  // Drain the cohort in pages
  console.log(`\n  Pulling rows (${fmt(SELECT_PAGE_SIZE)} per page)…`)
  const allRows = []
  let lastId = 0
  while (true) {
    const rows = runSelectJson(`
      SELECT id, name FROM food_library
      WHERE id > ${lastId}
        AND INSTR(name, ',') > 0
        AND SUBSTR(name, 1, INSTR(name, ',') - 1) NOT LIKE '% %'
        AND brand IS NULL
      ORDER BY id ASC
      LIMIT ${SELECT_PAGE_SIZE}
    `)
    if (!rows.length) break
    allRows.push(...rows)
    lastId = rows[rows.length - 1].id
    process.stdout.write(`\r    Pulled: ${fmt(allRows.length)}/${fmt(target)}`)
  }
  console.log('')

  // Compute updates
  console.log(`\n  Transforming names…`)
  const updates = []
  let unchanged = 0
  for (const r of allRows) {
    const next = transform(r.name)
    if (next !== r.name) updates.push({ id: r.id, name: next })
    else unchanged++
  }
  console.log(`  Will update: ${fmt(updates.length)} (${fmt(unchanged)} no-ops)`)

  // Show a sample of before/after for sanity
  console.log('\n  Sample transformations:')
  for (let i = 0; i < Math.min(10, updates.length); i++) {
    const before = allRows.find(r => r.id === updates[i].id)?.name
    console.log(`    "${before}"  →  "${updates[i].name}"`)
  }

  if (!updates.length) { console.log('  Nothing changed.'); return }

  // Flush updates in parallel batches
  console.log(`\n  Writing updates (${fmt(UPDATE_BATCH_SIZE)} per batch, concurrency ${UPDATE_CONCURRENCY})…`)
  const batches = []
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    batches.push(updates.slice(i, i + UPDATE_BATCH_SIZE))
  }
  const batchFiles = batches.map((batch, idx) => {
    const fp = path.join(TMP_DIR, `batch_${idx}.sql`)
    const lines = batch.map(u => `UPDATE food_library SET name = ${esc(u.name)} WHERE id = ${u.id};`)
    fs.writeFileSync(fp, lines.join('\n'))
    return fp
  })

  let completed = 0
  const writeStart = Date.now()
  await pmap(batchFiles, UPDATE_CONCURRENCY, async (fp) => {
    await runFileAsync(fp)
    fs.unlinkSync(fp)
    completed++
    process.stdout.write(`\r    Batches: ${completed}/${batchFiles.length}`)
  })
  console.log('')

  console.log(`\nDone in ${fmtMs(Date.now() - t0)}: ${fmt(updates.length)} updated, ${fmt(unchanged)} unchanged.`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
