# food_library — Audit Notebook

This is the living document that records every audit query, observation, and pattern we discover about the `food_library` table after the bulk import. The goal is to understand the data completely before designing filter rules (see `food_library_filters.md`).

Update this doc after every audit session. Don't delete old observations — they're the history of how our understanding evolved.

---

## Session log

### 2026-05-14 — Initial bulk import

*(To be populated after the rebuild runs.)*

Expected baseline:
- Total rows: ~700-750k
- By source: usda ~470k, on ~270k, myrx 6
- By source_subtype: branded_food ~455k, survey_fndds_food ~5.4k, sr_legacy_food ~7.8k, foundation_food ~400, experimental_food <100, on_branded ~?, on_recipe ~?, on_generic ~?, admin_custom 6

---

## Named queries

All queries live in `scripts/audit/`. Run any of them via:

```powershell
npx wrangler d1 execute myrx-food-library --remote --file=scripts/audit/<query>.sql --config=workers/food-search/wrangler.toml
```

| Query | Purpose | Last run | Result summary |
|---|---|---|---|
| `source_subtype_distribution.sql` | Count of rows per `source × source_subtype` combination | — | — |
| `null_macros.sql` | Rows with all macros null — candidate for filtering | — | — |
| `duplicate_upcs.sql` | UPCs that appear in 2+ rows (intra-source and cross-source) | — | — |
| `discontinued_branded.sql` | USDA branded rows with discontinued_date set (if we kept the field) | — | — |
| `name_anomalies.sql` | Rows with names < 3 chars, all-caps short, all-numeric, etc. | — | — |
| `macro_outliers.sql` | Rows with kcal > 900/100g (impossibly high — pure fat is ~890) or < 0 | — | — |
| `brand_field_anomalies.sql` | Rows where brand looks like a name fragment or vice versa | — | — |
| `foundation_food_sample.sql` | 50 random Foundation Foods — for human eyeball | — | — |
| `sr_legacy_sample.sql` | 50 random SR Legacy — for human eyeball | — | — |
| `survey_fndds_sample.sql` | 50 random Survey FNDDS — to decide if we want to keep them | — | — |
| `on_recipe_sample.sql` | 50 random ON recipes — to decide if they're useful | — | — |

---

## Observations

*(Append to this list as we discover patterns. Each entry: date, query that surfaced it, what we saw, what it implies.)*

### TEMPLATE

**Date:** YYYY-MM-DD
**Query / Source:** `query_name.sql` or "manual inspection of UPC 012345..."
**What we saw:** Describe the pattern in plain English.
**Implications:** What this might mean for filter design or sync logic.
**Action:** What we did about it (queued for filter, ignored, needs more investigation, etc.)

---

## Open questions

*(Things we need to investigate but haven't yet.)*

- Are USDA branded entries with all-null macros consistently junk, or do some have valid `serving_label` we want to preserve?
- ON's `category` field — what are the actual distinct values? Maps cleanly to source_subtype or do we need finer logic?
- Cross-source UPC overlap rate — how often does the same product appear in both USDA and ON?
- What fraction of USDA's discontinued branded products are still useful for users logging old packaging?
