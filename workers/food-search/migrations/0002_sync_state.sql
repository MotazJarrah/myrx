-- Sync state tracking for food library update jobs
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO sync_state(key, value) VALUES
  ('sync_status',        'idle'),
  ('usda_last_sync_date',''),
  ('on_last_checksum',   ''),
  ('on_last_version',    ''),
  ('sync_started_at',    ''),
  ('sync_completed_at',  ''),
  ('sync_progress',      '{}'),
  ('sync_error',         '');
