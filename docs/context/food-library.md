# Food Library Architecture (Locked)

Reference for the MyRX food library data layer (Cloudflare D1 + search/CRUD worker) and the two pipelines that keep it up to date — the production sync orchestrator and the full-rebuild bulk import. Locked May 21 2026.

## Overview

The food library is two layers:
- A Cloudflare D1 database (`myrx-food-library`) holding ~470K curated rows from USDA + OpenNutrition + MYRX-custom.
- The search/CRUD worker (`workers/food-search/`) that fronts it.

There are **TWO paths to update the data** and they share the same core pipeline. Picking the right one matters:

| Path | When | Where it runs |
|---|---|---|
| **Sync orchestrator** (production) | Day-to-day. Admin clicks "Sync now" in the food library admin panel after USDA / ON release new data. Monthly cron also fires it. | GitHub Actions. Pulls source files from R2 mirror, processes them, writes to D1. |
| **bulk_import** (full rebuild) | One-shot. Use only when D1 needs to be wiped and rebuilt from scratch (e.g. recovering from corruption, schema migration). | Locally, on the admin's laptop. Expects pre-extracted CSV/ZIP files in `scripts/bulk_import/data/`. |

Both share the same loaders, filter rules, and dedup logic in `scripts/bulk_import/lib/`. The orchestrator at `scripts/sync/run.mjs` just adds: download from R2, diff against live food_library, write either via changelog (staged) or atomic swap (commit).

## Sync orchestrator — the production update path

**Why R2 mirror exists**: USDA's CDN at `fdc-datasets.ars.usda.gov` returns `ENOTFOUND` from every cloud-egress IP we've tested (GitHub Actions runners, Cloudflare sandbox, etc.). USDA appears to firewall or geofence non-residential IPs. **The CDN is effectively unreachable from any automated pipeline.** Direct fetch is not a viable architecture.

The R2 mirror works around it: admin downloads the USDA + ON ZIPs manually onto their laptop (where USDA's CDN works fine), uploads them via the drag-drop UI in admin Food Library, and the sync orchestrator pulls from R2 (which is always reachable from GHA).

**Release cadence reality check**: USDA publishes ~2x/year — April and October/November. OpenNutrition updates less often. The monthly cron we set up is overkill; it'll be a no-op most months because the data hasn't changed. That's fine — the diff will be empty and Phase 5 short-circuits.

**Files in R2**:
- `usda/current.zip` — latest USDA FoodData Central ZIP (~460 MB)
- `usda/meta.json` — `{ filename, size, uploaded_at }`
- `on/current.zip` — latest OpenNutrition ZIP (~60 MB)
- `on/meta.json` — same shape
- Bucket: `myrx-food-mirror`, binding: `MIRROR_BUCKET` in worker
- Files are **per-source independent** — re-upload only what's new. If only USDA has a new release, drag in just that ZIP; ON stays put.

**Sync phases** (`scripts/sync/run.mjs`, ~16 min end-to-end):
1. Phase 1 — Download both ZIPs from R2 in parallel (~25 sec)
2. Phase 2 — Parse via `loadUsda()` + `loadOn()` (filter rules 1-14 applied during parse) (~4 min, dominated by USDA's 27M-row food_nutrient.csv)
3. Phase 3 — Dedup rules 15-19 in memory via `applyDedup()` (~7 sec)
4. Phase 4 — Diff against live food_library (USDA + ON only; MYRX excluded; chunked 10k rows per query) (~5 min)
5. Phase 5 — Write changelog + apply to D1 (~1 min). **Short-circuits immediately if diff is empty** (no inserts/updates/deletes → skip). Reuses Phase 4's loaded data so we don't double-query.
6. Phase 6 — FTS rebuild + watermarks + sync_history row (~20 sec)

**Modes**:
- `staged` — changelog rows written with `committed=0`. Admin reviews the I/U/D summary, clicks Commit (apply) or Discard (drop). Used via the dry-run toggle.
- `commit` — changelog rows + atomic swap on food_library in one go. No review step.

**Cancellation**: worker has `sync_cancel_requested` flag. UI sets it on Cancel. Orchestrator polls between phases AND every 5 seconds during the download phase. On cancel: pushes status='cancelled', worker wipes the run's changelog + step_log, state resets to idle. **Don't add "clear cancel flag on running transition" anywhere** — that bug silently swallowed user cancels for half a day.

**D1 schema for sync**:
- `sync_state` (key/value) — current status, run_id, mode, cancel flag, watermarks, etc.
- `sync_changelog` (run_id, operation, food_source, food_source_id, before_data, after_data, committed, reverted) — every I/U/D per run. Used for review/commit/discard/undo.
- `sync_history` (run_id, mode, status, started_at, ended_at, total_ms, phase_durations JSON, inserts, updates, deletes) — one row per run, used for ETA computation (median of last 5).
- `sync_step_log` (run_id, ts, step_code, message, level, error_code) — verbose progress feed. Retention: most-recent 3 runs.

**Error codes** (E_001 through E_099) — short identifiers logged in sync_step_log so failures can be triaged from a glance at the log panel. Full list at top of `scripts/sync/run.mjs`.

## Bulk import — full rebuild path (rarely needed)

```powershell
cd C:\Users\motaz\OneDrive\Desktop\MyRX
node --max-old-space-size=8192 scripts/bulk_import/run.mjs
```

Pre-requisites (already in `data/usda/` and `data/on/`):
- `scripts/bulk_import/data/usda/FoodData_Central_csv_YYYY-MM-DD/` (downloaded "Full Download" ZIP from https://fdc.nal.usda.gov/download-datasets, extracted)
- `scripts/bulk_import/data/on/opennutrition-dataset-YYYY.N.zip` (downloaded as-is from https://www.opennutrition.app/download)

### What the bulk import does (in order)

1. Pre-flight check — required files present
2. Snapshot current row counts
3. Wipe USDA + ON rows from D1 (**MYRX rows are NEVER touched** — `wipeUsdaAndOn()` filters `WHERE source IN ('usda','on')`)
4. Backfill MYRX audit columns
5. Load USDA CSVs into memory + apply **Tier 1-4 filter rules (1-14)** from `scripts/d1_migrate/lib/filters.mjs` during parsing
6. Load ON ZIP into memory + apply **Tier 1-4 filter rules (1-14)**
7. **Apply Tier 5 dedup rules (15-19) IN MEMORY** to the combined USDA+ON array via `scripts/bulk_import/lib/dedup_in_memory.mjs`. This is the architectural rule — see THE LAW below for why.
8. Push the deduped union (~470K rows) to D1 via `wrangler d1 execute --file=...` in batches of 25K rows per file
9. Rebuild FTS5 search index
10. Set sync watermarks (`usda_last_sync_date` = the CSV's snapshot date, `on_last_version` = the ON ZIP's version string) so future incremental syncs only fetch deltas
11. Final row-count verification + per-rule dedup summary

**Total runtime: ~9-15 minutes.** Most of the time is the D1 push (~3-5 min) and parsing the 27M-row USDA `food_nutrient.csv` (~4 min). The in-memory dedup runs in ~14 seconds.

## THE LAW: dedup runs in memory, BEFORE the D1 write

Rules 1-14 (REPAIR + REJECT tiers) run as the loaders walk the CSV streams. Rules 15-19 (DEDUP tier) require cross-row comparison and **MUST run in Node memory before any row hits D1.**

Earlier versions of the script ran Rules 15-19 as a post-import SQL pass (`post_import_dedup.mjs`). At ~470K rows that worked. At 2M+ rows — which is what the unfiltered USDA branded food catalog is — every monolithic DELETE in that script timed out:

- **D1 has a 30-second per-query CPU budget.** Wrangler `--file` execution can't extend that.
- A `DELETE WHERE id NOT IN (SELECT MAX(id) GROUP BY ...)` over 2M rows times out, regardless of indexing.
- Even chunked self-joins on `(source, upc)` time out per chunk when the join cardinality is large.

The architecturally correct fix is to do dedup where the data already lives — in Node memory, after the loaders parse and the filter pipeline drops the Tier 1-4 rejects. Each dedup rule is then an O(n) Map operation; the whole pass finishes in ~14 seconds.

The implementation is `scripts/bulk_import/lib/dedup_in_memory.mjs`. **Do not move the dedup back into SQL. Do not try to "optimize" by deduping post-import.** Both have been tried and both don't scale.

## Common failure modes + fixes

1. **`FATAL ERROR: Ineffective mark-compacts near heap limit` / `JavaScript heap out of memory` during Pass 6 (filter rules).** Cause: Node's default 4 GB heap isn't enough for the 2.1M USDA row array. Fix: always run with `--max-old-space-size=8192` (8 GB). 12 GB if USDA ever grows past 3M rows.

2. **`UNIQUE constraint failed: food_library.source, food_library.source_id` during USDA push.** Cause: trying to re-insert a row that's still in the table. Fix: confirm Step 3 (wipe) actually ran — re-run `wipeUsdaAndOn()` manually if needed.

3. **`wrangler d1 execute … --file=… --json` retry-3-times-then-fail on a DELETE statement.** Cause: D1's 30s query budget exceeded. Almost always means someone reverted Step 7 to a post-import SQL dedup. Restore the in-memory dedup path (`applyDedup`) in run.mjs.

4. **`error code: 1101` from a `/admin/cleanup/...` Worker endpoint.** Cause: CPU limit on the Worker, NOT D1. Worker free tier is 10ms CPU per request; paid is 30s. Either chunk the worker logic into ≤1000-row batches or move the heavy work to GHA + wrangler.

5. **`spawnSync /bin/sh ENOBUFS` in Phase 4 (sync orchestrator).** Cause: wrangler `--json` output for a large D1 query (50k-row chunk) exceeded Node's default `execSync` stdout buffer (1 MB). Fix: `maxBuffer: 256 * 1024 * 1024` on `execSync` in `d1_writer.mjs::querySql` AND reduce CHUNK in `run.mjs` to 10,000 rows per query. Both layers — bigger buffer + smaller chunks — survive transient network blips too.

6. **`Wrangler requires at least Node.js v22.0.0` in GHA.** Wrangler 4.x dropped Node 20 support. `.github/workflows/sync-food-library.yml` must specify `node-version: '22'` (or higher). Not 20.

7. **USDA scrape returns `ENOTFOUND (fdc-datasets.ars.usda.gov)` in GHA.** USDA's CDN is unreachable from cloud-egress IPs. This is not a transient error — it's permanent. The architectural fix is the R2 mirror (see "Sync orchestrator" above). DO NOT try to re-implement direct scraping with a different probe technique, different host, retries, etc. — all paths through that hostname fail the same way.

8. **Sync "stuck" cancelling for minutes.** Caused by the orchestrator being inside a long phase (e.g. ZIP extract, USDA parse pass) that doesn't poll the cancel flag. Cancel is checked at phase boundaries + every 5s during downloads. ZIP extract is the longest blind spot. Acceptable behaviour — the run will exit at the next checkpoint.

## Free-tier note

Cloudflare's documented D1 free tier limits (100K writes/day, 500MB per DB) are NOT strictly enforced for `wrangler d1 execute --file=...` uploads from the CLI. We pushed 2M+ rows in 13 minutes through that path with zero rejections. The HTTP D1 API DOES enforce limits — so per-row writes via worker fetch are still the bottleneck.

This is the practical reality, not the official spec. If Cloudflare changes enforcement, the bulk_import would need to be batched across multiple days OR moved to a paid plan ($5/mo Workers Paid = 50M writes/day).

## Sync watermark contract

The bulk import sets two watermarks at Step 10. Any future incremental sync (cron or manual) reads them as the starting date filter:

- `usda_last_sync_date` (e.g., `2026-04-30`) — sync_usda.mjs uses this as `publishedDateBegin` when calling USDA's API.
- `on_last_version` (e.g., `2025.1`) — sync_on.mjs skips its work entirely if the published ON version matches.

**If you ever manually wipe + reimport without bulk_import setting these, the next sync defaults `usda_last_sync_date` to `2020-01-01` and pulls ~6 years of USDA → 2,278 pages → 6-9 hours. Set the watermark manually in that case:**

```powershell
cd C:\Users\motaz\OneDrive\Desktop\MyRX\workers\food-search
npx wrangler d1 execute myrx-food-library --remote --command `
  "UPDATE sync_state SET value='YYYY-MM-DD', updated_at=datetime('now') WHERE key='usda_last_sync_date';"
```

## What CSV files to download for a fresh import

Both downloads are public and free, no API key required:

- USDA Full Download (~500 MB zipped, ~5 GB extracted): https://fdc.nal.usda.gov/download-datasets → "Full Download"
- OpenNutrition dataset (~270 MB zipped): https://www.opennutrition.app/download → latest version

The filename's embedded date IS the watermark the sync uses. Don't rename them.
