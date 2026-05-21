/**
 * In-memory dedup — Rules 15, 16, 17, 18, 19a, 19b from
 * docs/food_library_filters.md.
 *
 * These rules require cross-row comparison. Previous design ran them
 * AFTER the rows landed in D1 (post-import SQL pass). At 2M+ rows that
 * approach hit D1's 30-second per-query budget on every monolithic
 * DELETE — even the chunked-self-join variants couldn't fit the join
 * cost into the budget.
 *
 * The right place to run dedup is HERE — in Node, before any row hits
 * D1. We already hold the full USDA + ON arrays in memory after the
 * loaders run. Dedup becomes a few Map operations over the combined
 * array — O(n) instead of D1's O(n²-ish) self-joins.
 *
 * Rule order matches the original SQL pipeline:
 *   15 → 16 → 17 → 18 → 19a → 19b
 *
 * Memory: each rule creates a temporary Map. With ~2.4M combined rows
 * and ~20 fields per row, peak memory during dedup is ~2 GB. Node must
 * run with --max-old-space-size=8192 (or higher) to avoid OOM.
 */

const fmt = n => n.toLocaleString()

// ── Rule 15 — exact cross-source dedup ────────────────────────────────────────
// Key: name + brand + 4 macros + serving_label + upc (case-insensitive,
// trimmed; NULL = empty/-1). When same key seen twice, the LAST one
// wins — mirrors the SQL "keep MAX(id)" since we process arrays in
// insertion order and later inserts always get higher D1 ids.

function rule15(rows) {
  const map = new Map()
  for (const row of rows) {
    const key = [
      (row.name  ?? '').toLowerCase().trim(),
      (row.brand ?? '').toLowerCase().trim(),
      row.kcal      ?? -1,
      row.protein_g ?? -1,
      row.fat_g     ?? -1,
      row.carbs_g   ?? -1,
      (row.serving_label ?? '').toLowerCase().trim(),
      row.upc ?? '',
    ].join('|')
    map.set(key, row)
  }
  return [...map.values()]
}

// ── Rule 16 — brand-product dedup ────────────────────────────────────────────
// Scope: brand AND name AND all 4 macros must be non-NULL.
// Key: name + brand + 4 macros + serving_g.
// Winner: highest source_id (numeric DESC, then string DESC).

function rule16(rows) {
  const map = new Map()
  const orphans = []  // rows out of scope, keep as-is

  for (const row of rows) {
    if (!row.brand || !row.name
        || row.kcal == null || row.protein_g == null
        || row.fat_g == null || row.carbs_g == null) {
      orphans.push(row)
      continue
    }
    const key = [
      row.name.toLowerCase().trim(),
      row.brand.toLowerCase().trim(),
      row.kcal, row.protein_g, row.fat_g, row.carbs_g,
      row.serving_g ?? -1,
    ].join('|')

    const existing = map.get(key)
    if (!existing) { map.set(key, row); continue }

    // source_id winner: numeric DESC, then string DESC.
    const newNum = parseInt(row.source_id, 10) || 0
    const exNum  = parseInt(existing.source_id, 10) || 0
    if (newNum > exNum || (newNum === exNum && (row.source_id || '') > (existing.source_id || ''))) {
      map.set(key, row)
    }
  }
  return [...orphans, ...map.values()]
}

// ── Rule 17 — cross-source UPC dedup (USDA loses to ON when kcal matches) ────
// Key: upc + ROUND(kcal, 0). Build a set of all ON keys; any USDA row
// matching is dropped.

function rule17(rows) {
  const onKeys = new Set()
  for (const row of rows) {
    if (row.source !== 'on' || !row.upc) continue
    onKeys.add(`${row.upc}|${Math.round(row.kcal ?? -1)}`)
  }
  return rows.filter(row => {
    if (row.source !== 'usda' || !row.upc) return true
    return !onKeys.has(`${row.upc}|${Math.round(row.kcal ?? -1)}`)
  })
}

// ── Rule 18 — intra-source UPC dedup ─────────────────────────────────────────
// Key: source + upc + ROUND(kcal, 0). Keep the LAST row per group
// (equivalent to MAX(id) since later array entries get higher D1 ids).

function rule18(rows) {
  const map = new Map()
  const orphans = []

  for (const row of rows) {
    if (!row.upc) { orphans.push(row); continue }
    const key = `${row.source}|${row.upc}|${Math.round(row.kcal ?? -1)}`
    map.set(key, row)
  }
  return [...orphans, ...map.values()]
}

// ── Rule 19a — cross-source UPC dedup with ≤5 kcal tolerance ─────────────────
// Like Rule 17 but allow up to 5 kcal of diff between USDA and ON
// values (label-rounding artifacts).

function rule19a(rows) {
  const onByUpc = new Map()
  for (const row of rows) {
    if (row.source !== 'on' || !row.upc || row.kcal == null) continue
    if (!onByUpc.has(row.upc)) onByUpc.set(row.upc, [])
    onByUpc.get(row.upc).push(row.kcal)
  }
  return rows.filter(row => {
    if (row.source !== 'usda' || !row.upc || row.kcal == null) return true
    const onKcals = onByUpc.get(row.upc)
    if (!onKcals) return true
    return !onKcals.some(k => Math.abs(k - row.kcal) <= 5)
  })
}

// ── Rule 19b — intra-source UPC dedup with ≤5 kcal spread per cluster ────────
// For each (source, upc) cluster: if max(kcal) - min(kcal) ≤ 5, the
// cluster is "all the same product with label-rounding noise" — collapse
// to one row (keep the last). If spread > 5, the rows are genuinely
// different products sharing a UPC (rare but possible) — keep all.

function rule19b(rows) {
  const groups = new Map()
  const orphans = []

  for (const row of rows) {
    if (!row.upc || row.kcal == null) { orphans.push(row); continue }
    const key = `${row.source}|${row.upc}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const kept = []
  for (const group of groups.values()) {
    if (group.length === 1) { kept.push(group[0]); continue }
    let min = Infinity, max = -Infinity
    for (const r of group) {
      if (r.kcal < min) min = r.kcal
      if (r.kcal > max) max = r.kcal
    }
    if (max - min <= 5) {
      // Collapse cluster — keep last row.
      kept.push(group[group.length - 1])
    } else {
      kept.push(...group)
    }
  }
  return [...orphans, ...kept]
}

// ── Public API ────────────────────────────────────────────────────────────────

// Rules in the same order as the original SQL pipeline.
const RULES = [
  { name: 'rule15_exact',           fn: rule15  },
  { name: 'rule16_brand_product',   fn: rule16  },
  { name: 'rule17_cross_upc_exact', fn: rule17  },
  { name: 'rule18_intra_upc',       fn: rule18  },
  { name: 'rule19a_cross_upc_5kcal',fn: rule19a },
  { name: 'rule19b_intra_upc_5kcal',fn: rule19b },
]

/**
 * Apply Rules 15-19 to a combined array of food_library rows.
 *
 * Returns { rows, stats } where rows is the deduped array and stats is
 * `{ ruleName: rowsRemoved }` for each rule, in execution order.
 */
export function applyDedup(rows, log = console.log) {
  const start = rows.length
  log(`\n  In-memory dedup starting from ${fmt(start)} rows`)
  const stats = {}

  let cur = rows
  for (const { name, fn } of RULES) {
    const before = cur.length
    cur = fn(cur)
    const removed = before - cur.length
    stats[name] = removed
    log(`    ${name.padEnd(28)} removed ${fmt(removed).padStart(10)}  (${fmt(cur.length)} remaining)`)
  }

  log(`  Dedup complete: ${fmt(start)} → ${fmt(cur.length)} (removed ${fmt(start - cur.length)})`)
  return { rows: cur, stats }
}
