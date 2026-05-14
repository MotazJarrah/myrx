-- Adds audit-trail columns to food_library for the rebuild.
--
-- Five new columns (all nullable, all populated by the bulk-import script
-- and the ongoing sync scripts):
--
--   source_subtype   — the source's own classification value:
--                      USDA: 'branded_food', 'foundation_food', 'sr_legacy_food',
--                            'survey_fndds_food', 'experimental_food',
--                            'agricultural_acquisition', 'sub_sample_food',
--                            'market_acquisition', 'sample_food' (literal USDA values)
--                      ON:   'on_branded', 'on_recipe', 'on_restaurant', 'on_generic'
--                      MYRX: 'admin_custom', 'scanned_off' (future)
--
--   imported_at      — ISO timestamp of when this row first landed in our DB.
--                      Set once at insert, never updated.
--
--   last_synced_at   — ISO timestamp of when its values were last refreshed by
--                      a sync run. Bumped every time the row gets touched.
--
--   source_version   — the dataset / API release this row came from:
--                      USDA: the FoodData_Central_csv_YYYY-MM-DD folder name
--                      ON:   the dataset version string, e.g. '2025.1'
--                      MYRX: NULL (admin entries have no version concept)
--
--   food_category    — USDA's food_category text (e.g. 'Dairy and Egg Products',
--                      'Vegetables and Vegetable Products') when the source provides
--                      it. NULL for ON and MYRX rows since those sources don't
--                      categorise consistently.

ALTER TABLE food_library ADD COLUMN source_subtype TEXT;
ALTER TABLE food_library ADD COLUMN imported_at    TEXT;
ALTER TABLE food_library ADD COLUMN last_synced_at TEXT;
ALTER TABLE food_library ADD COLUMN source_version TEXT;
ALTER TABLE food_library ADD COLUMN food_category  TEXT;

-- Backfill myrx rows so they aren't left half-populated when the wipe
-- preserves them. USDA + ON rows will be wiped and re-imported, so they
-- don't need backfilling here — the bulk-import script populates everything
-- at INSERT time.
UPDATE food_library
SET source_subtype = 'admin_custom',
    imported_at    = COALESCE(imported_at,    datetime('now')),
    last_synced_at = COALESCE(last_synced_at, datetime('now'))
WHERE source = 'myrx';
