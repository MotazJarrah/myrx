# Bulk Import — food_library seed

One-shot tool to populate Cloudflare D1's `food_library` table from local USDA and OpenNutrition source files.

Replaces the old `scripts/d1_migrate/d1_import_from_csv.mjs` (archived) which had known parser bugs, missing data types, and per-row D1 round-trips that made it too slow for full rebuilds.

## What it does

1. Reads USDA's full CSV bundle from `data/usda/` — pulls in **all** USDA data types (branded, foundation, sr_legacy, survey_fndds, experimental, plus the rare sub_sample, market_acquisition, sample, agricultural_acquisition variants).
2. Reads OpenNutrition's ZIP from `data/on/` — streams the TSV without full extraction.
3. Maps every row to our schema (see `workers/food-search/schema.sql`), including the audit-trail columns from migration 0006.
4. Wipes existing USDA + ON rows from D1 (MYRX preserved + audit-backfilled).
5. Bulk-inserts new rows in batches using `wrangler d1 execute --file`.
6. Rebuilds the FTS5 search index.
7. Logs a verification summary (counts by source × subtype).

Filter philosophy: **no filters during this import.** Every parseable row goes in. We audit + design filter rules from the full dataset afterwards (see `docs/food_library_filters.md`).

## How to use

### 1. Download source files

USDA Full Download (~500 MB zipped, ~5 GB extracted):
- Go to https://fdc.nal.usda.gov/download-datasets
- Pick "Full Download" (NOT "Branded Only" — we want everything)
- Download the ZIP, extract it
- Put the extracted folder (e.g. `FoodData_Central_csv_2026-04-30/`) directly inside `data/usda/`
- Resulting layout:
  ```
  data/usda/FoodData_Central_csv_2026-04-30/
    food.csv
    branded_food.csv
    food_nutrient.csv
    food_portion.csv
    food_category.csv
    nutrient.csv
    ... (other CSVs)
  ```

OpenNutrition dataset (~270 MB zipped, ~1.2 GB extracted):
- Go to https://www.opennutrition.app/download
- Download the latest `opennutrition-dataset-YYYY.N.zip`
- Put it as-is (do NOT extract) inside `data/on/`
- Resulting layout:
  ```
  data/on/opennutrition-dataset-2025.1.zip
  ```

### 2. Verify env

The script uses `wrangler` to push to D1. Wrangler reads `CLOUDFLARE_API_TOKEN` from your shell env. Verify:

```powershell
echo $env:CLOUDFLARE_API_TOKEN  # should be set
```

If empty, set it (one-time) in your PowerShell profile.

### 3. Install deps

```powershell
cd scripts/bulk_import
npm install
```

### 4. Run

From the repo root (not the bulk_import folder — paths are repo-relative):

```powershell
node scripts/bulk_import/run.mjs
```

The script logs every step. Total runtime: ~5-15 minutes depending on disk speed.

## Cleanup

After the import succeeds and the verification report looks right, you can delete the source files to free disk:

```powershell
Remove-Item -Recurse data/usda
Remove-Item -Recurse data/on
```

The `data/` folder itself is gitignored so leaving it empty is fine.
