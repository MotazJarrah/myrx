-- Sync step log — every step the sync script executes records a row here.
-- Powers the verbose real-time progress feed in the Operations Panel: each
-- log line in the UI is one row in this table.
--
-- The OperationsPanel UI polls /admin/sync/step-log?run_id=X every 2 seconds
-- and renders entries chronologically as they arrive. The sync script POSTs
-- batches of new entries to /admin/sync/step-log/append every ~500ms.
--
-- Retention rule:
--   When a new sync run starts, the worker deletes rows for ALL runs except
--   the most recent 3 (this one + 2 previous). Three runs is enough for
--   "compare this sync to the last one" debugging without unbounded growth.
--
-- Field semantics:
--   step_code   — short machine-readable identifier (e.g. 'usda_download',
--                 'parse_pass_1', 'dedup_rule_15'). Used by the UI to render
--                 icons / groupings if desired.
--   message     — human-readable progress text rendered verbatim in the UI.
--                 May include numbers, file sizes, ETA estimates, etc.
--   level       — 'info' | 'warn' | 'error'. The UI tints the row by level.
--   error_code  — optional E_XXX system code for failures. Cross-references
--                 the codes documented in scripts/sync/run.mjs header.
--   detail      — optional JSON blob for structured debugging (stack
--                 traces, HTTP response bodies, file sizes).

CREATE TABLE IF NOT EXISTS sync_step_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  ts          TEXT    NOT NULL DEFAULT (datetime('now')),
  step_code   TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  level       TEXT    NOT NULL DEFAULT 'info'
              CHECK (level IN ('info', 'warn', 'error')),
  error_code  TEXT,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS sync_step_log_run_id_idx
  ON sync_step_log(run_id, id);


-- Sync history — one row per completed sync run. Used to:
--   1. Compute ETA for a new run by averaging the durations of recent runs.
--   2. Render the "Last sync took N min Y sec" stat in the OperationsPanel
--      without scanning sync_step_log.
--   3. Show "Recent syncs" with quick stats.
--
-- A row is INSERTed when the sync run starts (run_id + started_at), and
-- UPDATEd when the run completes / fails / cancels (ended_at + status +
-- counts + phase_durations JSON).
--
-- Phase durations are stored as JSON because the schema is descriptive
-- ("download_usda", "parse_usda", "dedup", "diff", "write") and may
-- expand over time without migrations.

CREATE TABLE IF NOT EXISTS sync_history (
  run_id            TEXT    PRIMARY KEY,
  mode              TEXT,                          -- 'staged' | 'commit'
  status            TEXT,                          -- 'running' | 'completed' | 'failed' | 'cancelled'
  started_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,
  total_ms          INTEGER,
  phase_durations   TEXT,                          -- JSON: {"download_usda": 12345, ...}
  inserts           INTEGER DEFAULT 0,
  updates           INTEGER DEFAULT 0,
  deletes           INTEGER DEFAULT 0,
  error_code        TEXT,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS sync_history_started_at_idx
  ON sync_history(started_at DESC);
