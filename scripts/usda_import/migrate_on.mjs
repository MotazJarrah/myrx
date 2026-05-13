/**
 * OpenNutrition → food_library migrator
 *
 * Copies all rows from opennutrition_foods → food_library with source='on'.
 * Uses upsert on (source, source_id) so re-running is safe.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<key> node migrate_on.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_SERVICE_KEY) {
  console.error('❌  Set SUPABASE_SERVICE_KEY env var before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const PAGE = 1000

async function run() {
  console.log('══════════════════════════════════════════')
  console.log(' OpenNutrition → food_library')
  console.log('══════════════════════════════════════════\n')

  // Count source rows
  const { count } = await supabase
    .from('opennutrition_foods')
    .select('*', { count: 'exact', head: true })
  console.log(`Source rows: ${count?.toLocaleString() ?? '?'}\n`)

  let offset = 0, total = 0

  while (true) {
    const { data, error } = await supabase
      .from('opennutrition_foods')
      .select('*')
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(`Read failed: ${error.message}`)
    if (!data || data.length === 0) break

    // Map ON schema → food_library schema
    // ON columns: id, name, brand, type, serving_unit, serving_qty, serving_g,
    //             calories, protein, fat, carbs
    const rows = data.map(r => ({
      source:                'on',
      source_id:             String(r.id),
      name:                  r.name ?? '',
      brand:                 r.brand ?? null,
      kcal:                  r.calories  ?? null,
      protein_g:             r.protein   ?? null,
      fat_g:                 r.fat       ?? null,
      carbs_g:               r.carbs     ?? null,
      fiber_g:               null,   // not in ON dataset
      sodium_mg:             null,   // not in ON dataset
      serving_g:             r.serving_g   ?? null,
      serving_label:         r.serving_qty && r.serving_unit
                               ? `${r.serving_qty} ${r.serving_unit}`
                               : null,
      servings_per_container: null,
    })).filter(r => r.name)

    const { error: upsertError } = await supabase
      .from('food_library')
      .upsert(rows, { onConflict: 'source,source_id', ignoreDuplicates: false })

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`)

    total  += rows.length
    offset += PAGE
    process.stdout.write(`\r  Migrated ${total.toLocaleString()}…`)

    if (data.length < PAGE) break
  }

  console.log(`\n\n✅ Done! ${total.toLocaleString()} OpenNutrition rows migrated into food_library.`)
}

run().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1) })
