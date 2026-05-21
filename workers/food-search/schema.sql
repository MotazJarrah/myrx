-- Food library table — complete schema for a fresh install.
--
-- Column conventions:
--   source           top-level provenance: 'usda', 'on', 'myrx'
--   source_id        unique stable ID within source (USDA fdc_id, ON id, MYRX uuid)
--   source_subtype   source-specific category (e.g. 'branded_food', 'foundation_food',
--                    'on_branded', 'admin_custom'). See migration 0006 for full list.
--   data_type        universal classification: 'branded', 'generic', 'recipe',
--                    'restaurant', 'aggregated'. Used for cross-source filtering.
--                    Derived from upc/brand presence by lib/normalize.mjs.
--   upc              barcode if known
--   imported_at      ISO timestamp when row first inserted into our DB
--   last_synced_at   ISO timestamp when row was last refreshed by a sync run
--   source_version   dataset/API release identifier (e.g. 'FoodData_Central_csv_2026-04-30')
--   servings_per_container  for MYRX entries that store package size
--
-- (food_category was removed during the post-audit cleanup — coarse USDA
--  category column that didn't carry enough signal to warrant the storage.)
CREATE TABLE IF NOT EXISTS food_library (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT    NOT NULL DEFAULT 'usda',
  source_id      TEXT    NOT NULL,
  source_subtype TEXT,
  name           TEXT    NOT NULL,
  brand          TEXT,
  kcal           REAL,
  protein_g      REAL,
  fat_g          REAL,
  carbs_g        REAL,
  fiber_g        REAL,
  sodium_mg      REAL,
  serving_g      REAL,
  serving_label  TEXT,
  servings_per_container REAL,
  data_type      TEXT,
  upc            TEXT,
  imported_at    TEXT,
  last_synced_at TEXT,
  source_version TEXT,
  UNIQUE(source, source_id)
);

-- FTS5 virtual table for fast full-text search
-- content= keeps FTS index in sync with food_library rows
CREATE VIRTUAL TABLE IF NOT EXISTS food_fts USING fts5(
  name,
  brand,
  content = food_library,
  content_rowid = id,
  tokenize = 'unicode61 remove_diacritics 1'
);

-- Sync changelog table — full schema in migrations/0007_sync_changelog.sql.
-- Captures every insert/update/delete from a sync run so we can support
-- the dry-run-toggle staged-commit model and undo-last-sync. See the
-- migration file for the full rationale.
CREATE TABLE IF NOT EXISTS sync_changelog (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT    NOT NULL,
  operation       TEXT    NOT NULL CHECK (operation IN ('insert','update','delete')),
  food_source     TEXT    NOT NULL,
  food_source_id  TEXT    NOT NULL,
  before_data     TEXT,
  after_data      TEXT,
  committed       INTEGER NOT NULL DEFAULT 0,
  reverted        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS sync_changelog_run_id_idx
  ON sync_changelog(run_id);

CREATE INDEX IF NOT EXISTS sync_changelog_run_committed_idx
  ON sync_changelog(run_id, committed, reverted);
