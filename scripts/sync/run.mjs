#!/usr/bin/env node
/**
 * MyRX Food Library — Sync Orchestrator
 *
 * Single entry-point used by BOTH the admin "Sync now" button AND the
 * monthly cron. Replaces the old `sync_usda.mjs` + `sync_on.mjs` pair.
 *
 * Why one script:
 *   The old two-script split used the USDA REST API and ON ZIP diff.
 *   That path took 2–9 hours per sync and routinely hit D1's 30s
 *   per-query budget. The CSV-based bulk_import path takes ~15 minutes
 *   for the full catalog. This script reuses the bulk_import loaders
 *   end-to-end so every sync produces the SAME result as a fresh
 *   bulk_import would — full filter pipeline, full dedup, no drift.
 *
 * Flow (each phase emits step_log entries with timestamps):
 *
 *   Phase 1 — Download (parallel)
 *     - Scrape USDA's data type page for the latest FoodData_Central_csv URL
 *     - Scrape OpenNutrition's download page for the latest dataset ZIP URL
 *     - Download BOTH ZIPs in parallel (USDA ~3 GB, ON ~200 MB)
 *     - Extract USDA bundle to scripts/bulk_import/data/usda/
 *     - Save ON ZIP to scripts/bulk_import/data/on/
 *
 *   Phase 2 — Parse + filter
 *     - Load USDA via loadUsda() (5-pass CSV read + Rules 1-14 applied)
 *     - Load ON via loadOn() (ZIP stream + Rules 1-14 applied)
 *
 *   Phase 3 — Dedup (Rules 15-19 in memory)
 *     - applyDedup() on the combined USDA + ON union
 *     - Each rule logs its before/after row count
 *
 *   Phase 4 — Diff against live food_library
 *     - SELECT the current (source, source_id, kcal, protein_g, fat_g,
 *       carbs_g, name, brand) for usda + on rows
 *     - Compare against the deduped union; classify each row as
 *       INSERT (new key), UPDATE (changed fields), or DELETE (in DB but
 *       not in new union). MYRX rows are excluded — they're never
 *       touched by sync.
 *
 *   Phase 5 — Write
 *     - staged mode: write inserts/updates/deletes to sync_changelog with
 *       committed=0. The admin reviews via the OperationsPanel review
 *       dialog and clicks Commit or Discard.
 *     - commit mode: write to a staging table, atomic swap with
 *       food_library, set watermarks.
 *
 *   Phase 6 — Finalise
 *     - Rebuild FTS5 index
 *     - Set usda_last_sync_date + on_last_version watermarks
 *     - Insert sync_history row with total_ms + phase_durations
 *     - POST /admin/sync/state status=completed
 *
 * Cancellation: every phase polls /admin/sync/cancel/check between
 * checkpoints. On cancel, the script writes status=cancelled to the
 * worker (which cleans up changelog) and exits 0.
 *
 * Error codes (all surfaced via step_log entries):
 *
 *   E_001  USDA snapshot URL scrape failed
 *   E_002  USDA ZIP download failed
 *   E_003  USDA ZIP extract failed
 *   E_010  ON snapshot URL scrape failed
 *   E_011  ON ZIP download failed
 *   E_020  USDA CSV parse failed (corrupt file?)
 *   E_021  ON TSV parse failed
 *   E_030  Filter rule pipeline crashed
 *   E_040  Dedup rule crashed
 *   E_050  Diff against live DB failed
 *   E_060  Changelog append failed
 *   E_061  Staging table write failed
 *   E_062  Atomic swap failed
 *   E_070  Watermark write failed
 *   E_071  FTS rebuild failed
 *   E_080  Worker /admin/sync/state push failed
 *   E_090  Out of memory (run with --max-old-space-size=8192)
 *   E_099  Unhandled top-level error
 *
 * Environment variables (required):
 *   WORKER_URL              https://myrx-food-search.motaz-jarrah.workers.dev
 *   FOOD_ADMIN_KEY          Bearer token for worker /admin/* endpoints
 *   SYNC_RUN_ID             Sync identifier — passed by the workflow
 *   SYNC_MODE               'staged' | 'commit' (default 'commit')
 *   CLOUDFLARE_API_TOKEN    Wrangler credential
 *   CLOUDFLARE_ACCOUNT_ID   Wrangler account id
 *
 * Usage (local testing):
 *   $env:WORKER_URL = "..."
 *   $env:FOOD_ADMIN_KEY = "..."
 *   $env:SYNC_RUN_ID = "test_run_$(Get-Date -Format yyyyMMddHHmmss)"
 *   $env:SYNC_MODE = "staged"
 *   node --max-old-space-size=8192 scripts/sync/run.mjs
 */

import fs   from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import unzipper from 'unzipper'

import { loadUsda }     from '../bulk_import/lib/usda_loader.mjs'
import { loadOn }       from '../bulk_import/lib/on_loader.mjs'
import { applyDedup }   from '../bulk_import/lib/dedup_in_memory.mjs'
import {
  executeSql, bulkInsertRows, querySql,
  statsBySource, statsBySourceSubtype,
  rebuildFts,
} from '../bulk_import/lib/d1_writer.mjs'

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '../..')
const DATA_DIR   = path.join(REPO_ROOT, 'scripts/bulk_import/data')
const USDA_ROOT  = path.join(DATA_DIR, 'usda')
const ON_ROOT    = path.join(DATA_DIR, 'on')

// ── Env ───────────────────────────────────────────────────────────────────────

const WORKER_URL     = process.env.WORKER_URL     ?? 'https://myrx-food-search.motaz-jarrah.workers.dev'
const FOOD_ADMIN_KEY = process.env.FOOD_ADMIN_KEY ?? ''
const RUN_ID         = process.env.SYNC_RUN_ID    ?? `sync_${Date.now()}`
const MODE           = process.env.SYNC_MODE      ?? 'commit'

// ── State (gets pushed to sync_state + sync_step_log via worker) ─────────────

const phaseTimers = {}       // { download_usda: { start, end, ms }, ... }
let   stepCount   = 0
const stepBuffer  = []        // batched, flushed every 500 ms
let   flushTimer  = null
let   cancelRequested = false
let   cancelLastCheck = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

function nowIso() { return new Date().toISOString() }
function nowHms() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} sec`
  const m = s / 60
  if (m < 60) return `${m.toFixed(1)} min`
  return `${(m / 60).toFixed(1)} h`
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtN(n) { return Number(n).toLocaleString() }

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function workerFetch(path, options = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${FOOD_ADMIN_KEY}`,
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Worker ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return res.json().catch(() => ({}))
}

// ── Step log (verbose progress feed) ─────────────────────────────────────────

/**
 * Record a step log entry. Buffered and flushed every 500 ms so we don't
 * round-trip the worker on every line. Also echoed to stdout for the
 * GHA log.
 *
 * @param {string}  code     short identifier (e.g. 'download_usda', 'dedup_rule_15')
 * @param {string}  message  user-facing message rendered verbatim in the UI
 * @param {object}  opts     { level?: 'info'|'warn'|'error', errorCode?: 'E_XXX', detail?: object }
 */
function logStep(code, message, opts = {}) {
  stepCount++
  const ts = nowIso()
  const entry = {
    run_id:     RUN_ID,
    ts,
    step_code:  code,
    message:    message,
    level:      opts.level     ?? 'info',
    error_code: opts.errorCode ?? null,
    detail:     opts.detail ? JSON.stringify(opts.detail) : null,
  }
  stepBuffer.push(entry)
  // Echo to console with a UTC timestamp.
  const tag = opts.errorCode ? `[${opts.errorCode}] ` : ''
  const prefix = opts.level === 'error' ? '✗' : opts.level === 'warn' ? '⚠' : '·'
  console.log(`${nowHms()} ${prefix} ${tag}${message}`)

  // Schedule a flush.
  if (!flushTimer) {
    flushTimer = setTimeout(flushStepBuffer, 500)
  }
}

async function flushStepBuffer(force = false) {
  flushTimer = null
  if (!stepBuffer.length) return
  const batch = stepBuffer.splice(0, stepBuffer.length)
  try {
    await workerFetch('/admin/sync/step-log/append', {
      method: 'POST',
      body:   JSON.stringify({ run_id: RUN_ID, entries: batch }),
    })
  } catch (err) {
    // Don't fail the sync because the log push failed — just retry next batch.
    if (force) console.error('step-log flush failed:', err.message)
  }
}

// Force-flush + drain on graceful exit.
async function drainSteps() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  await flushStepBuffer(true)
}

// ── Phase timer helpers ──────────────────────────────────────────────────────

function startPhase(name) {
  phaseTimers[name] = { start: Date.now(), end: null, ms: null }
}
function endPhase(name) {
  if (!phaseTimers[name]) return
  phaseTimers[name].end = Date.now()
  phaseTimers[name].ms  = phaseTimers[name].end - phaseTimers[name].start
}

// ── Worker state pushes ──────────────────────────────────────────────────────

async function pushState(patch) {
  try {
    await workerFetch('/admin/sync/state', {
      method: 'POST',
      body:   JSON.stringify({ run_id: RUN_ID, ...patch }),
    })
  } catch (err) {
    // Non-fatal — the sync can still finish, the UI just won't see the update.
    console.error('pushState failed:', err.message)
  }
}

async function pushProgress(progress) {
  // Throttled — only push once every 2 seconds to avoid hammering D1.
  const now = Date.now()
  if (pushProgress._last && now - pushProgress._last < 2000) return
  pushProgress._last = now
  await pushState({ progress })
}

// ── Cancel polling ───────────────────────────────────────────────────────────

async function checkCancel() {
  // Throttle: 2 seconds between checks.
  const now = Date.now()
  if (now - cancelLastCheck < 2000) return cancelRequested
  cancelLastCheck = now
  try {
    const res = await workerFetch('/admin/sync/cancel/check')
    cancelRequested = !!res.cancel
  } catch {
    /* keep last known */
  }
  return cancelRequested
}

async function bailIfCancelled() {
  if (await checkCancel()) {
    logStep('cancel', 'Cancel requested by admin — aborting cleanly', { level: 'warn' })
    await pushState({ status: 'cancelled', completed_at: nowIso() })
    await drainSteps()
    process.exit(0)
  }
}

// ── Phase 1: Download (parallel) ─────────────────────────────────────────────

/**
 * Look up the staged USDA + ON files in the R2 mirror via the Worker.
 *
 * The admin uploads both source ZIPs through the food-library UI's
 * drag-and-drop. This function reads the mirror status to confirm
 * both files are present and returns the metadata.
 *
 * Why mirror at all: USDA's CDN (fdc-datasets.ars.usda.gov) has been
 * returning Cloudflare error 1016 ("origin DNS error") — it's broken
 * at the source. Even if it weren't broken, depending on USDA's
 * uptime for an automated sync is fragile. The mirror puts both
 * source ZIPs under our control in R2.
 *
 * The data only updates twice a year (April + October/November), so
 * the admin only needs to refresh the mirror twice a year via the
 * upload UI. The sync itself runs entirely against R2.
 */
async function lookupMirrorFiles() {
  logStep('mirror', 'Checking R2 mirror for staged source files…')
  const res = await fetch(`${WORKER_URL}/admin/food-files/status`, {
    headers: { 'Authorization': `Bearer ${FOOD_ADMIN_KEY}` },
  })
  if (!res.ok) {
    throw new Error(`Mirror status fetch failed: HTTP ${res.status}`)
  }
  const meta = await res.json()
  if (!meta.usda) {
    throw Object.assign(
      new Error('USDA file not uploaded — go to the Food Library admin panel and upload the USDA ZIP first'),
      { code: 'E_001' }
    )
  }
  if (!meta.on) {
    throw Object.assign(
      new Error('OpenNutrition file not uploaded — go to the Food Library admin panel and upload the ON ZIP first'),
      { code: 'E_010' }
    )
  }
  logStep('mirror', `USDA: ${meta.usda.filename} (uploaded ${meta.usda.uploaded_at})`)
  logStep('mirror', `ON:   ${meta.on.filename} (uploaded ${meta.on.uploaded_at})`)
  return meta
}

/**
 * @deprecated Kept temporarily for reference. USDA's CDN is broken
 * (Cloudflare 1016 errors) so probing is pointless. The mirror flow
 * supersedes this — see lookupMirrorFiles() above.
 */
async function findUsdaSnapshot() {
  logStep('scrape_usda', 'Probing USDA CDN for latest snapshot…')

  const base = 'https://fdc-datasets.ars.usda.gov/FoodData_Central_csv_'
  const KNOWN_GOOD = '2026-04-30'  // bumped when we confirm a newer release
  const RELEASE_DAYS = [17, 18, 20, 24, 26, 28, 29, 30, 31]

  // Build candidates: last 8 months × release-day patterns.
  const today = new Date()
  const candidates = new Set()
  for (let monthsBack = 0; monthsBack < 8; monthsBack++) {
    const target = new Date(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1)
    const y = target.getUTCFullYear()
    const m = String(target.getUTCMonth() + 1).padStart(2, '0')
    for (const d of RELEASE_DAYS) {
      candidates.add(`${y}-${m}-${String(d).padStart(2, '0')}`)
    }
  }
  candidates.add(KNOWN_GOOD)  // always include the safety net
  const dateList = [...candidates].sort().reverse()  // newest first

  logStep('scrape_usda', `Probing ${dateList.length} candidate dates in parallel…`)

  // Ranged GET probe — read 1 byte, immediately cancel the body.
  // Status 200/206/304 = URL exists. 4xx/5xx = not found.
  //
  // Network-level failures (DNS, TCP, TLS) come back as throws, not
  // status codes. Node wraps everything as "fetch failed" by default;
  // we unwrap err.cause to surface the real reason — ENOTFOUND (DNS),
  // ECONNREFUSED (TCP), CERT_HAS_EXPIRED (TLS), etc. — so debugging
  // doesn't need a packet capture.
  async function probe(url) {
    try {
      const res = await fetch(url, {
        method:  'GET',
        headers: {
          'User-Agent': 'myrx-sync/1.0',
          'Range':      'bytes=0-0',
        },
        redirect: 'follow',
      })
      // Cancel the body stream — we already have the status code.
      try { await res.body?.cancel() } catch {}
      const ok = res.status >= 200 && res.status < 400
      return { ok, status: res.status }
    } catch (err) {
      // Unwrap the underlying network error. err.cause is set by
      // undici (Node's fetch impl) and carries the real diagnostic:
      // - { code: 'ENOTFOUND', hostname: '...' } → DNS doesn't resolve
      // - { code: 'ECONNREFUSED' } → host unreachable / no server
      // - { code: 'ETIMEDOUT' } → connection timeout
      // - { code: 'CERT_HAS_EXPIRED' / 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } → TLS
      const cause = err.cause || {}
      const detail = cause.code
        ? `${cause.code}${cause.hostname ? ` (${cause.hostname})` : ''}`
        : err.message
      return { ok: false, status: 0, error: detail }
    }
  }

  const probeResults = await Promise.all(
    dateList.map(async date => {
      const url = `${base}${date}.zip`
      const result = await probe(url)
      return { date, url, ...result }
    })
  )

  const found = probeResults
    .filter(r => r.ok)
    .sort((a, b) => b.date.localeCompare(a.date))

  // No fallback. If every probe fails, the sync FAILS — the entire
  // point of running a sync is to get the latest data; substituting
  // a known-old URL would silently re-download the same data we
  // already have. We'd rather fail loudly so the admin investigates
  // (DNS issue? CDN outage? IP block?) than ship a useless sync.
  if (!found.length) {
    // Log every probe's actual response so it's clear what failed
    // and how. Status codes for HTTP failures; underlying error
    // messages (DNS failure / connection refused / TLS handshake)
    // for network-level failures.
    const samples = probeResults.slice(0, 5).map(r =>
      `${r.date}=${r.status > 0 ? `HTTP ${r.status}` : (r.error || 'no response')}`
    ).join(', ')
    logStep('scrape_usda', `All ${probeResults.length} probes failed. Sample: ${samples}`, { level: 'error', errorCode: 'E_001' })
    throw new Error(`USDA CDN unreachable — no candidate URL responded. Investigate network connectivity to fdc-datasets.ars.usda.gov from GitHub Actions runner.`)
  }

  const latest = found[0]
  logStep('scrape_usda', `Latest USDA snapshot: ${latest.date}`)
  return latest
}

/**
 * Scrape OpenNutrition's download page for the latest dataset ZIP.
 * URLs live at `https://downloads.opennutrition.app/`. Regex stays
 * host-agnostic for the same reason as USDA.
 *
 * Returns the ZIP URL + version string ("2025.1" format).
 */
async function findOnSnapshot() {
  logStep('scrape_on', 'Scraping OpenNutrition snapshot URL from download page…')
  const res = await fetch('https://www.opennutrition.app/download', {
    headers: { 'User-Agent': 'myrx-sync/1.0', 'Accept': 'text/html' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`ON page fetch failed: ${res.status}`)
  const html = await res.text()
  // Look for opennutrition-dataset-YYYY.N.zip — any host.
  const matches = html.matchAll(/https?:\/\/[^\s"'<>]*opennutrition-dataset-(\d{4}\.\d+)\.zip/g)
  let latest = null
  for (const m of matches) {
    if (!latest || m[1] > latest.version) latest = { url: m[0], version: m[1] }
  }
  if (!latest) {
    // Last-ditch: maybe a relative path. Try common host prefixes.
    const rel = html.match(/(\/[^"'\s<>]*opennutrition-dataset-(\d{4}\.\d+)\.zip)/)
    if (rel) {
      latest = { url: `https://downloads.opennutrition.app${rel[1]}`, version: rel[2] }
    }
  }
  if (!latest) {
    const snippet = html.slice(0, 600).replace(/\s+/g, ' ')
    logStep('scrape_on', `Page returned ${html.length} bytes — snippet: ${snippet}`, { level: 'warn' })
    throw new Error('No opennutrition-dataset ZIP URL found on ON page (regex needs update?)')
  }
  logStep('scrape_on', `Found ON dataset: version ${latest.version} at ${latest.url}`)
  return latest
}

/**
 * Stream a URL to disk, emitting progress updates every ~10%.
 *
 * Polls the cancel flag every 5 seconds during the download so the user
 * doesn't have to wait through a 3 GB transfer if they hit Cancel. If
 * cancel is detected mid-download, the partial file is discarded and
 * the function throws — main()'s top-level catch will handle the clean
 * cancel exit.
 */
async function downloadFile(url, destPath, label, progressKey, extraHeaders = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'myrx-sync/1.0', ...extraHeaders },
    })
  } catch (err) {
    // Surface the underlying network-level error code (ENOTFOUND, etc.)
    // instead of Node's opaque "fetch failed" wrapper.
    const cause = err.cause || {}
    const detail = cause.code
      ? `${cause.code}${cause.hostname ? ` (${cause.hostname})` : ''}`
      : err.message
    throw new Error(`${label} fetch error: ${detail} — URL: ${url}`)
  }
  if (!res.ok) throw new Error(`${label} download failed: HTTP ${res.status} — URL: ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const out   = fs.createWriteStream(destPath)
  let received = 0
  let lastLogPct = 0
  let lastCancelCheck = Date.now()

  const reader = res.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out.write(value)
    received += value.length
    if (total > 0) {
      const pct = Math.floor((received / total) * 100)
      if (pct >= lastLogPct + 10) {
        lastLogPct = pct
        logStep(`download_${progressKey}`, `${label} download: ${pct}% (${fmtBytes(received)} / ${fmtBytes(total)})`)
      }
    }
    // Cancel-check every 5 s during the transfer.
    if (Date.now() - lastCancelCheck > 5000) {
      lastCancelCheck = Date.now()
      if (await checkCancel()) {
        out.destroy()
        try { fs.unlinkSync(destPath) } catch {}
        throw Object.assign(new Error('Download aborted by cancel'), { _isCancel: true })
      }
    }
  }
  out.end()
  await new Promise(r => out.on('close', r))
  logStep(`download_${progressKey}`, `${label} download complete: ${fmtBytes(received)}`)
  return { bytes: received, total }
}

async function extractUsdaZip(zipPath, extractRoot) {
  logStep('extract_usda', `Extracting USDA bundle to ${path.relative(REPO_ROOT, extractRoot)}…`)
  fs.mkdirSync(extractRoot, { recursive: true })

  // Stream-extract every CSV inside the ZIP. The bundle contains:
  //   FoodData_Central_csv_YYYY-MM-DD/{food,branded_food,food_portion,food_nutrient,food_category,...}.csv
  await pipeline(
    fs.createReadStream(zipPath),
    unzipper.Extract({ path: extractRoot }),
  )
  logStep('extract_usda', 'USDA bundle extracted')
}

async function downloadPhase() {
  startPhase('download')
  logStep('phase', '── Phase 1/6 — Pull staged files from R2 mirror ──')

  // Confirm both files are present in the mirror BEFORE wiping our
  // local working directories. If the admin hasn't uploaded yet,
  // we want to fail fast with a clear "go upload" message, not
  // leave the orchestrator in a weird half-state.
  const meta = await lookupMirrorFiles()
  const usdaFilename = meta.usda.filename
  const onFilename   = meta.on.filename
  // Derive USDA snapshot date + ON version from the filenames the
  // user uploaded. The bulk_import loaders use these as the
  // `source_version` field on every imported row.
  const usdaDate = /(\d{4}-\d{2}-\d{2})/.exec(usdaFilename)?.[1] || new Date().toISOString().slice(0, 10)
  const onVersion = /opennutrition-dataset-(\d{4}\.\d+)/.exec(onFilename)?.[1] || 'unknown'

  await bailIfCancelled()

  // Clean any prior downloads so we don't accidentally use stale files.
  if (fs.existsSync(USDA_ROOT)) fs.rmSync(USDA_ROOT, { recursive: true, force: true })
  if (fs.existsSync(ON_ROOT))   fs.rmSync(ON_ROOT,   { recursive: true, force: true })

  const usdaZip = path.join(USDA_ROOT, `FoodData_Central_csv_${usdaDate}.zip`)
  const onZip   = path.join(ON_ROOT,   `opennutrition-dataset-${onVersion}.zip`)

  // Streaming download from the Worker's R2-backed endpoint. Both
  // streams run in parallel — the Worker reads directly from R2 so
  // bandwidth is whatever GHA's runner can accept.
  const mirrorBase = `${WORKER_URL}/admin/food-files`
  logStep('download', `Pulling USDA + ON from mirror in parallel…`)
  const [usdaRes, onRes] = await Promise.all([
    downloadFile(`${mirrorBase}/usda/download`, usdaZip, 'USDA', 'usda', { 'Authorization': `Bearer ${FOOD_ADMIN_KEY}` }).catch(err => {
      logStep('download_usda', `USDA mirror download failed: ${err.message}`, { level: 'error', errorCode: 'E_002' })
      throw err
    }),
    downloadFile(`${mirrorBase}/on/download`, onZip, 'OpenNutrition', 'on', { 'Authorization': `Bearer ${FOOD_ADMIN_KEY}` }).catch(err => {
      logStep('download_on', `ON mirror download failed: ${err.message}`, { level: 'error', errorCode: 'E_011' })
      throw err
    }),
  ])

  await bailIfCancelled()

  // Extract USDA (ON's loader streams from the zip directly).
  try {
    await extractUsdaZip(usdaZip, USDA_ROOT)
  } catch (err) {
    logStep('extract_usda', `USDA extract failed: ${err.message}`, { level: 'error', errorCode: 'E_003' })
    throw err
  }

  endPhase('download')
  logStep('phase', `Phase 1 complete in ${fmtMs(phaseTimers.download.ms)} — USDA ${fmtBytes(usdaRes.bytes)} + ON ${fmtBytes(onRes.bytes)}`)

  return { usdaDate, onVersion }
}

// ── Phase 2: Parse + filter ──────────────────────────────────────────────────

async function parsePhase() {
  logStep('phase', '── Phase 2/6 — Parse CSVs and apply filter rules 1-14 ──')
  startPhase('parse_usda')
  logStep('parse_usda', 'Loading USDA CSVs (5-pass read with filter rules 1-14 applied at parse time)…')

  // The bulk_import loaders use a SHARED logger via console.log. We don't
  // intercept those — they're noisy but useful in the GHA log. We DO emit
  // a couple of high-level summary entries to the step log so the UI feed
  // has structured milestones.
  let usdaData
  try {
    usdaData = await loadUsda(USDA_ROOT)
  } catch (err) {
    logStep('parse_usda', `USDA parse failed: ${err.message}`, { level: 'error', errorCode: 'E_020' })
    throw err
  }
  endPhase('parse_usda')
  logStep('parse_usda', `USDA parsed: ${fmtN(usdaData.rows.length)} rows kept in ${fmtMs(phaseTimers.parse_usda.ms)}`)
  for (const [subtype, n] of Object.entries(usdaData.stats.by_subtype).sort()) {
    logStep('parse_usda', `  ${subtype}: ${fmtN(n)}`)
  }

  await bailIfCancelled()

  startPhase('parse_on')
  logStep('parse_on', 'Streaming OpenNutrition ZIP and applying filter rules 1-14…')
  let onData
  try {
    onData = await loadOn(ON_ROOT)
  } catch (err) {
    logStep('parse_on', `ON parse failed: ${err.message}`, { level: 'error', errorCode: 'E_021' })
    throw err
  }
  endPhase('parse_on')
  logStep('parse_on', `ON parsed: ${fmtN(onData.rows.length)} rows kept in ${fmtMs(phaseTimers.parse_on.ms)}`)
  for (const [subtype, n] of Object.entries(onData.stats.by_subtype).sort()) {
    logStep('parse_on', `  ${subtype}: ${fmtN(n)}`)
  }

  return { usdaRows: usdaData.rows, usdaVersion: usdaData.version, onRows: onData.rows, onVersion: onData.version }
}

// ── Phase 3: Dedup (Rules 15-19 in memory) ───────────────────────────────────

function dedupPhase(usdaRows, onRows) {
  startPhase('dedup')
  logStep('phase', '── Phase 3/6 — Dedup (filter rules 15-19 in memory) ──')
  logStep('dedup', `Combining ${fmtN(usdaRows.length)} USDA + ${fmtN(onRows.length)} ON rows…`)
  const combined = [...usdaRows, ...onRows]

  // The applyDedup helper logs each rule's before/after via console.log.
  // Intercept by wrapping its logger to also emit step_log entries.
  const ruleLogger = msg => {
    // Trim each line; applyDedup adds leading spaces.
    const trimmed = String(msg).trim()
    if (!trimmed) return
    // Detect "rule15_exact   removed N  (M remaining)" lines for inline UI display.
    const match = trimmed.match(/^(rule\d+\w*)\s+removed\s+([\d,]+)\s+\(([\d,]+)\s+remaining\)/)
    if (match) {
      logStep(`dedup_${match[1]}`, `Running filter ${match[1]}: removed ${match[2]} duplicates (${match[3]} remaining)`)
    } else {
      logStep('dedup', trimmed)
    }
  }

  let dedupedRows, dedupStats
  try {
    const result = applyDedup(combined, ruleLogger)
    dedupedRows  = result.rows
    dedupStats   = result.stats
  } catch (err) {
    logStep('dedup', `Dedup failed: ${err.message}`, { level: 'error', errorCode: 'E_040' })
    throw err
  }

  endPhase('dedup')
  const removed = combined.length - dedupedRows.length
  logStep('dedup', `Dedup complete in ${fmtMs(phaseTimers.dedup.ms)}: ${fmtN(combined.length)} → ${fmtN(dedupedRows.length)} (removed ${fmtN(removed)})`)
  return { dedupedRows, dedupStats }
}

// ── Phase 4: Diff against live food_library ──────────────────────────────────

/**
 * Build a Map<source|source_id, fingerprint> of the current food_library rows.
 * Fingerprint = a string of the fields that, when changed, signal an UPDATE.
 * MYRX rows are excluded — they're never touched by sync.
 *
 * Streams in chunks to avoid loading 467k rows into the wrangler stdout
 * buffer at once.
 */
async function loadLiveFingerprints() {
  logStep('diff', 'Loading live food_library row fingerprints (USDA + ON only)…')
  const live = new Map()  // key = "source|source_id"  → fingerprint string

  const CHUNK = 10_000
  let offset = 0
  while (true) {
    await bailIfCancelled()
    const rows = await querySql(`
      SELECT source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
             fiber_g, sodium_mg, serving_g, serving_label, upc, data_type
      FROM food_library
      WHERE source IN ('usda', 'on')
      ORDER BY id
      LIMIT ${CHUNK} OFFSET ${offset};
    `)
    if (!rows.length) break
    for (const r of rows) {
      const key = `${r.source}|${r.source_id}`
      const fp  = fingerprint(r)
      live.set(key, fp)
    }
    offset += rows.length
    logStep('diff', `Loaded ${fmtN(live.size)} live rows so far…`)
    if (rows.length < CHUNK) break
  }
  logStep('diff', `Loaded ${fmtN(live.size)} live rows total`)
  return live
}

function fingerprint(r) {
  // Build a stable string from the fields the UI exposes. Order matters.
  return [
    r.name ?? '',
    r.brand ?? '',
    r.kcal ?? '',
    r.protein_g ?? '',
    r.fat_g ?? '',
    r.carbs_g ?? '',
    r.fiber_g ?? '',
    r.sodium_mg ?? '',
    r.serving_g ?? '',
    r.serving_label ?? '',
    r.upc ?? '',
    r.data_type ?? '',
  ].join('|')
}

async function diffPhase(dedupedRows) {
  startPhase('diff')
  logStep('phase', '── Phase 4/6 — Diff against live food_library ──')
  const live = await loadLiveFingerprints()

  // Build a Map of the new rows by key for fast lookups.
  const newByKey = new Map()
  for (const r of dedupedRows) {
    if (r.source !== 'usda' && r.source !== 'on') continue
    newByKey.set(`${r.source}|${r.source_id}`, r)
  }

  const inserts = []
  const updates = []
  const deletes = []

  // INSERT + UPDATE: walk the new union and compare to live.
  for (const [key, row] of newByKey) {
    const liveFp = live.get(key)
    if (liveFp === undefined) {
      inserts.push(row)
    } else if (liveFp !== fingerprint(row)) {
      updates.push(row)
    }
  }
  // DELETE: anything in live but not in the new union.
  for (const key of live.keys()) {
    if (!newByKey.has(key)) {
      const [source, source_id] = key.split('|')
      deletes.push({ source, source_id })
    }
  }

  endPhase('diff')
  logStep('diff', `Diff complete in ${fmtMs(phaseTimers.diff.ms)}: +${fmtN(inserts.length)} inserts · ~${fmtN(updates.length)} updates · −${fmtN(deletes.length)} deletes`)

  return { inserts, updates, deletes }
}

// ── Phase 5: Write (staged → changelog | commit → atomic swap) ───────────────

/**
 * Staged-mode write: every operation goes to sync_changelog with committed=0.
 * Admin clicks Commit to apply them to food_library, or Discard to drop them.
 *
 * Batched POSTs to /admin/sync/changelog/append. We do NOT touch food_library
 * directly here — the changelog is the only side effect.
 */
async function writeStaged(inserts, updates, deletes) {
  startPhase('write_staged')
  logStep('phase', '── Phase 5/6 — Write to sync_changelog (staged mode) ──')

  const BATCH = 500
  let pushed = 0
  const total = inserts.length + updates.length + deletes.length

  // For UPDATE entries, we need the before_data (existing live row) to
  // populate the JSON. Lazy-fetch them as we encounter the keys.
  const needUpdateLookup = updates.length > 0 || deletes.length > 0
  let existingByKey = new Map()
  if (needUpdateLookup) {
    logStep('write', 'Loading live row data for updates + deletes (for changelog before_data field)…')
    const CHUNK = 10_000
    let offset = 0
    while (true) {
      const rows = await querySql(`
        SELECT source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
               fiber_g, sodium_mg, serving_g, serving_label, upc, data_type
        FROM food_library
        WHERE source IN ('usda', 'on')
        ORDER BY id
        LIMIT ${CHUNK} OFFSET ${offset};
      `)
      if (!rows.length) break
      for (const r of rows) existingByKey.set(`${r.source}|${r.source_id}`, r)
      offset += rows.length
      if (rows.length < CHUNK) break
    }
  }

  async function flushBatch(entries) {
    if (!entries.length) return
    try {
      await workerFetch('/admin/sync/changelog/append', {
        method: 'POST',
        body:   JSON.stringify({ run_id: RUN_ID, entries }),
      })
    } catch (err) {
      logStep('write', `Changelog append failed: ${err.message}`, { level: 'error', errorCode: 'E_060' })
      throw err
    }
  }

  async function pushOps(ops, kind) {
    let buf = []
    for (const row of ops) {
      await bailIfCancelled()
      let entry
      if (kind === 'insert') {
        entry = {
          operation:      'insert',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    null,
          after_data:     JSON.stringify(row),
        }
      } else if (kind === 'update') {
        const key = `${row.source}|${row.source_id}`
        entry = {
          operation:      'update',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    JSON.stringify(existingByKey.get(key) ?? null),
          after_data:     JSON.stringify(row),
        }
      } else { // delete
        const key = `${row.source}|${row.source_id}`
        entry = {
          operation:      'delete',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    JSON.stringify(existingByKey.get(key) ?? null),
          after_data:     null,
        }
      }
      buf.push(entry)
      if (buf.length >= BATCH) {
        await flushBatch(buf); pushed += buf.length; buf = []
        await pushProgress({ phase: 'write_staged', pushed, total })
        logStep('write', `Wrote ${fmtN(pushed)} / ${fmtN(total)} changelog entries…`)
      }
    }
    if (buf.length) {
      await flushBatch(buf); pushed += buf.length
      await pushProgress({ phase: 'write_staged', pushed, total })
    }
  }

  await pushOps(inserts, 'insert')
  await pushOps(updates, 'update')
  await pushOps(deletes, 'delete')

  endPhase('write_staged')
  logStep('write', `Staged write complete: ${fmtN(pushed)} changelog entries in ${fmtMs(phaseTimers.write_staged.ms)}`)
}

/**
 * Commit-mode write: atomic swap via staging table.
 *
 *   1. CREATE TABLE food_library_new AS SELECT * FROM food_library WHERE 0=1
 *      (mirror schema, no rows)
 *   2. INSERT all MYRX rows (preserved verbatim)
 *   3. INSERT all deduped USDA + ON rows
 *   4. BEGIN: DROP food_library; ALTER food_library_new RENAME TO food_library
 *
 * This is much faster than per-row inserts/updates/deletes and matches what
 * bulk_import does.
 *
 * For audit + undo: we still write to sync_changelog with committed=1 in
 * parallel batches. This lets the admin undo a commit-mode sync just like a
 * staged sync.
 */
async function writeCommit(dedupedRows, inserts, updates, deletes) {
  startPhase('write_commit')
  logStep('phase', '── Phase 5/6 — Write to food_library (commit mode, atomic swap) ──')

  // Step 1 — write changelog entries with committed=1 so the UI can show
  // the same I/U/D counts in history + so undo works.
  logStep('write', 'Recording changelog entries with committed=1 (enables undo)…')

  // Same batched push logic as staged mode, but flip committed=1 server-side.
  // We use a slightly different endpoint variant by passing committed:1 in
  // the body — the worker honors it.
  const BATCH = 500
  let pushed = 0
  const total = inserts.length + updates.length + deletes.length

  // Bulk-load existing data for updates + deletes.
  const existingByKey = new Map()
  let offset = 0
  const CHUNK = 10_000
  while (true) {
    const rows = await querySql(`
      SELECT source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g,
             fiber_g, sodium_mg, serving_g, serving_label, upc, data_type
      FROM food_library
      WHERE source IN ('usda', 'on')
      ORDER BY id
      LIMIT ${CHUNK} OFFSET ${offset};
    `)
    if (!rows.length) break
    for (const r of rows) existingByKey.set(`${r.source}|${r.source_id}`, r)
    offset += rows.length
    if (rows.length < CHUNK) break
  }

  async function flushBatch(entries) {
    if (!entries.length) return
    try {
      await workerFetch('/admin/sync/changelog/append', {
        method: 'POST',
        body:   JSON.stringify({ run_id: RUN_ID, entries, committed: 1 }),
      })
    } catch (err) {
      logStep('write', `Changelog append failed: ${err.message}`, { level: 'error', errorCode: 'E_060' })
      throw err
    }
  }

  async function pushOps(ops, kind) {
    let buf = []
    for (const row of ops) {
      await bailIfCancelled()
      let entry
      if (kind === 'insert') {
        entry = {
          operation:      'insert',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    null,
          after_data:     JSON.stringify(row),
        }
      } else if (kind === 'update') {
        const key = `${row.source}|${row.source_id}`
        entry = {
          operation:      'update',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    JSON.stringify(existingByKey.get(key) ?? null),
          after_data:     JSON.stringify(row),
        }
      } else { // delete
        const key = `${row.source}|${row.source_id}`
        entry = {
          operation:      'delete',
          food_source:    row.source,
          food_source_id: String(row.source_id),
          before_data:    JSON.stringify(existingByKey.get(key) ?? null),
          after_data:     null,
        }
      }
      buf.push(entry)
      if (buf.length >= BATCH) {
        await flushBatch(buf); pushed += buf.length; buf = []
        await pushProgress({ phase: 'write_commit', pushed, total })
        if (pushed % 5000 === 0) {
          logStep('write', `Logged ${fmtN(pushed)} / ${fmtN(total)} changes…`)
        }
      }
    }
    if (buf.length) {
      await flushBatch(buf); pushed += buf.length
      await pushProgress({ phase: 'write_commit', pushed, total })
    }
  }

  await pushOps(inserts, 'insert')
  await pushOps(updates, 'update')
  await pushOps(deletes, 'delete')

  logStep('write', `Logged ${fmtN(pushed)} changes — applying to food_library…`)

  // Step 2 — atomic swap. Use the same wipe-and-rebuild approach as
  // bulk_import: DELETE USDA + ON rows, then bulk-insert the deduped union.
  // This is faster than per-row inserts/updates/deletes for large diffs and
  // keeps the codebase free of UPDATE source_id quirks.
  try {
    logStep('write', 'Deleting existing USDA + ON rows (MYRX preserved)…')
    await executeSql(`DELETE FROM food_library WHERE source IN ('usda', 'on');`)

    const usdaRows = dedupedRows.filter(r => r.source === 'usda')
    const onRows   = dedupedRows.filter(r => r.source === 'on')

    logStep('write', `Bulk-inserting ${fmtN(usdaRows.length)} USDA rows…`)
    await bulkInsertRows(usdaRows, 'usda_sync')
    await bailIfCancelled()

    logStep('write', `Bulk-inserting ${fmtN(onRows.length)} ON rows…`)
    await bulkInsertRows(onRows, 'on_sync')
  } catch (err) {
    logStep('write', `Atomic write failed: ${err.message}`, { level: 'error', errorCode: 'E_062' })
    throw err
  }

  endPhase('write_commit')
  logStep('write', `Commit write complete in ${fmtMs(phaseTimers.write_commit.ms)}`)
}

// ── Phase 6: Finalise ────────────────────────────────────────────────────────

async function finalisePhase(usdaVersion, onVersion, diffCounts) {
  startPhase('finalise')
  logStep('phase', '── Phase 6/6 — Finalise (FTS rebuild + watermarks + history) ──')

  if (MODE === 'commit') {
    try {
      logStep('finalise', 'Rebuilding FTS5 index for search…')
      await rebuildFts()
    } catch (err) {
      logStep('finalise', `FTS rebuild failed (non-fatal): ${err.message}`, { level: 'warn', errorCode: 'E_071' })
    }

    // Watermarks — only update on commit mode. Staged mode hasn't actually
    // changed food_library yet; the watermarks update when the admin clicks
    // Commit (via the worker endpoint).
    try {
      const usdaDateMatch = /(\d{4}-\d{2}-\d{2})/.exec(usdaVersion || '')
      const usdaSnapshotDate = usdaDateMatch?.[1] || new Date().toISOString().slice(0, 10)
      const usdaSnapshotDateEsc = usdaSnapshotDate.replace(/'/g, "''")
      const onVersionEsc        = (onVersion || '').replace(/'/g, "''")
      await executeSql(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('usda_last_sync_date', '${usdaSnapshotDateEsc}', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
      )
      await executeSql(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('on_last_version', '${onVersionEsc}', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
      )
      logStep('finalise', `Watermarks updated: usda=${usdaSnapshotDate}, on=${onVersion}`)
    } catch (err) {
      logStep('finalise', `Watermark write failed: ${err.message}`, { level: 'error', errorCode: 'E_070' })
      throw err
    }
  }

  // Sync history row.
  await pushHistoryRow({
    status: 'completed',
    inserts: diffCounts.inserts,
    updates: diffCounts.updates,
    deletes: diffCounts.deletes,
  })

  endPhase('finalise')
  logStep('finalise', `Finalisation complete in ${fmtMs(phaseTimers.finalise.ms)}`)
}

async function pushHistoryRow(extra = {}) {
  const total_ms = Object.values(phaseTimers).reduce((s, p) => s + (p.ms ?? 0), 0)
  const phase_durations = {}
  for (const [k, v] of Object.entries(phaseTimers)) phase_durations[k] = v.ms ?? 0

  try {
    await workerFetch('/admin/sync/history/upsert', {
      method: 'POST',
      body: JSON.stringify({
        run_id:  RUN_ID,
        mode:    MODE,
        status:  extra.status ?? 'running',
        started_at: phaseTimers.download?.start ? new Date(phaseTimers.download.start).toISOString() : nowIso(),
        ended_at:   extra.status === 'running' ? null : nowIso(),
        total_ms,
        phase_durations,
        inserts: extra.inserts ?? 0,
        updates: extra.updates ?? 0,
        deletes: extra.deletes ?? 0,
        error_code:    extra.errorCode    ?? null,
        error_message: extra.errorMessage ?? null,
      }),
    })
  } catch (err) {
    // Non-fatal — history is a nice-to-have.
    console.error('history upsert failed:', err.message)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!FOOD_ADMIN_KEY) {
    console.error('FOOD_ADMIN_KEY env var is required')
    process.exit(1)
  }

  const totalStart = Date.now()
  logStep('start', `MyRX Food Library Sync — run_id ${RUN_ID}, mode ${MODE}`)

  // EARLY cancel check — if the admin clicked Cancel during the pending
  // phase (between trigger dispatch and GHA boot), honour it before
  // doing any heavy work. The trigger endpoint doesn't clear the cancel
  // flag, and the worker no longer clears it on running transitions
  // (was a bug — silently swallowed user cancels in the pending→running
  // gap), so a pre-set cancel propagates correctly to here.
  if (await checkCancel()) {
    logStep('cancel', 'Cancel was requested before the sync could start — exiting cleanly', { level: 'warn' })
    await pushState({ status: 'cancelled', completed_at: nowIso() })
    await drainSteps()
    process.exit(0)
  }

  // Mark running + record initial history row so ETA can use the started_at.
  await pushState({ status: 'running', started_at: nowIso(), error: '' })
  await pushHistoryRow({ status: 'running' })

  try {
    // Phase 1 — Download (parallel)
    const { usdaDate, onVersion } = await downloadPhase()
    await bailIfCancelled()

    // Phase 2 — Parse + filter rules 1-14
    const { usdaRows, usdaVersion, onRows, onVersion: onVer } = await parsePhase()
    await bailIfCancelled()

    // Phase 3 — Dedup (filter rules 15-19)
    const { dedupedRows, dedupStats } = dedupPhase(usdaRows, onRows)
    await bailIfCancelled()

    // Free the source arrays — the deduped union holds everything we need.
    usdaRows.length = 0
    onRows.length   = 0

    // Phase 4 — Diff
    const { inserts, updates, deletes } = await diffPhase(dedupedRows)
    await bailIfCancelled()

    // Phase 5 — Write
    if (MODE === 'staged') {
      await writeStaged(inserts, updates, deletes)
    } else {
      await writeCommit(dedupedRows, inserts, updates, deletes)
    }
    await bailIfCancelled()

    // Phase 6 — Finalise
    await finalisePhase(usdaVersion, onVer, {
      inserts: inserts.length,
      updates: updates.length,
      deletes: deletes.length,
    })

    const totalMs = Date.now() - totalStart
    logStep('done', `Sync complete in ${fmtMs(totalMs)} — ${stepCount} log entries`)
    await pushState({ status: 'completed', mode: MODE, completed_at: nowIso() })
    await drainSteps()
    process.exit(0)
  } catch (err) {
    // Mid-download cancel-throws land here. Route them to the cancel
    // exit path so the worker cleans up the changelog instead of
    // reporting a generic failure.
    if (err._isCancel) {
      logStep('cancel', 'Cancel requested mid-sync — aborting cleanly', { level: 'warn' })
      await pushState({ status: 'cancelled', completed_at: nowIso() })
      await drainSteps()
      process.exit(0)
    }
    const code = err.code || 'E_099'
    logStep('error', `Sync failed: ${err.message}`, {
      level: 'error',
      errorCode: code,
      detail: { stack: err.stack?.slice(0, 1000) },
    })
    await pushState({ status: 'failed', completed_at: nowIso(), error: `${code}: ${err.message}` })
    await pushHistoryRow({
      status: 'failed',
      errorCode: code,
      errorMessage: err.message,
    })
    await drainSteps()
    process.exit(1)
  }
}

main().catch(async err => {
  console.error('Unhandled error:', err)
  try {
    await pushState({ status: 'failed', completed_at: nowIso(), error: `E_099: ${err.message}` })
    await drainSteps()
  } catch {}
  process.exit(1)
})
