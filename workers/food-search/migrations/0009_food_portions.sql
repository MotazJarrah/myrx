-- Food portions table — one food → many portion options.
--
-- Until this migration, food_library stored exactly ONE portion per food
-- via the (serving_g, serving_label) pair. USDA's food_portion.csv actually
-- carries many portions per food (e.g. raw banana has small / medium /
-- large / extra small / 1 cup mashed / 1 cup sliced / NLEA serving) — we
-- were reading the CSV but only keeping the first row encountered.
-- OpenNutrition's `serving` JSON likewise carries variants we collapsed
-- into a single label.
--
-- This table holds the full variant list. The mobile food drawer's
-- portion picker queries it via GET /portions?source=X&source_id=Y on
-- the food worker; results are interleaved with base units (g / Oz / Cup)
-- by relevance.
--
-- Source/source_id pair joins to food_library.(source, source_id). We
-- don't use a FK constraint because (a) D1 enforces FKs only when
-- PRAGMA foreign_keys=ON which the worker doesn't set, and (b) the bulk
-- import + sync orchestrator delete-and-replace the food_portions rows
-- per sync, so dangling-portion rows are not a real risk.
--
-- Column semantics:
--   seq_num       — USDA's portion ordering hint (lower = more canonical
--                   variant per FoodData Central convention). NULL for ON.
--   amount        — quantity (e.g. 1.0 for "1 large", 0.5 for "0.5 cup").
--                   May be null if portion_desc carries the whole label
--                   (some USDA rows are free-text only).
--   measure_unit  — unit label (e.g. "large", "cup", "leaf", "tbsp").
--                   Joined from USDA's measure_unit.csv table.
--   modifier      — qualifier text (e.g. "mashed", "sliced", "without
--                   shell"). USDA stores this separately from the unit.
--   portion_desc  — full free-text fallback if neither
--                   amount+measure_unit nor modifier produce a clean label.
--   gram_weight   — required. The portion's actual mass in grams.

CREATE TABLE IF NOT EXISTS food_portions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,
  source_id       TEXT    NOT NULL,
  seq_num         INTEGER,
  amount          REAL,
  measure_unit    TEXT,
  modifier        TEXT,
  portion_desc    TEXT,
  gram_weight     REAL    NOT NULL,
  imported_at     TEXT,
  last_synced_at  TEXT
);

-- Primary lookup: "give me all portions for THIS food". The mobile drawer
-- hits this on every food selection.
CREATE INDEX IF NOT EXISTS food_portions_lookup_idx
  ON food_portions(source, source_id, seq_num);
