-- Sync changelog — every row inserted, updated, or deleted by a sync run
-- gets logged here BEFORE it lands in food_library. Enables three workflows:
--
--   1. Staged sync ("dry-run toggle ON")
--      Sync writes changelog rows with committed=0. UI shows review dialog.
--      User clicks Commit → entries are applied to food_library, committed→1.
--      User clicks Discard → entries deleted, food_library untouched.
--
--   2. Normal sync ("dry-run toggle OFF")
--      Sync writes changelog rows with committed=0, then immediately calls
--      the commit step which flips them to committed=1 + applies to live table.
--      End-to-end identical to staged + auto-commit.
--
--   3. Undo last sync
--      Reads committed=1, reverted=0 rows for the most recent run_id, then
--      reverses each in REVERSE order: re-INSERT deleted rows from before_data,
--      UPDATE back to before_data, DELETE rows that were inserted. Flips
--      reverted=1 so we can't double-undo.
--
-- Retention: changelog rows from run_id N are purged when run_id N+1 starts.
-- Only the LATEST sync's changelog is ever kept — undo only works for the
-- most recent sync. This matches the user requirement that "undo gets
-- overwritten on next sync".
--
-- Schema rationale:
--   - food_source + food_source_id identify the target row by natural key
--     (matches the UNIQUE(source, source_id) constraint on food_library).
--     We deliberately do NOT store food_library.id — that's a churning
--     auto-increment that can shift after inserts/deletes, but the
--     (source, source_id) tuple is stable across the lifetime of a row.
--   - before_data / after_data store the full row as JSON:
--       insert: before_data NULL, after_data = full row
--       update: both populated
--       delete: before_data = full row, after_data NULL
--   - committed = 1 means "this change is now visible in food_library"
--   - reverted = 1 means "an undo has reversed this entry; ignore it"

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

-- Extend sync_state with the staged-mode + run_id + last_committed_run.
INSERT OR IGNORE INTO sync_state(key, value) VALUES
  ('sync_run_id',           ''),  -- current/most-recent sync's UUID
  ('sync_mode',             ''),  -- '' | 'staged' | 'commit'
  ('sync_staged_review',    '0'), -- '1' when a staged sync is awaiting review
  ('last_committed_run_id', ''),  -- run_id whose changelog is undo-able
  ('sync_cancel_requested', '0'); -- '1' if user clicked Cancel mid-sync
