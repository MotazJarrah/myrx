-- Food library table (mirrors Supabase schema, SQLite types)
CREATE TABLE IF NOT EXISTS food_library (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL DEFAULT 'usda',
  source_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  brand       TEXT,
  kcal        REAL,
  protein_g   REAL,
  fat_g       REAL,
  carbs_g     REAL,
  fiber_g     REAL,
  sodium_mg   REAL,
  serving_g   REAL,
  serving_label TEXT,
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
