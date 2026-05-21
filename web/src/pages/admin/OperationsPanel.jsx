/**
 * OperationsPanel — the admin Food Library "control deck".
 *
 * Combines catalog stats, sync controls, progress + ETA, the dry-run
 * staged-commit flow, undo, and sync history into one collapsible card.
 *
 * Replaces the old SyncPanel. See workers/food-search/src/index.js for
 * the endpoint shape (POST /admin/sync, /sync/commit, /sync/discard,
 * /sync/undo, /sync/cancel; GET /admin/sync/status, /sync/summary,
 * /sync/history, /sync/changes, /sync/changes/csv).
 *
 * Behavior contract (matches user's requirements from the build plan):
 *
 *   1. Catalog stats card at top — total rows + per-source counts +
 *      last sync + next monthly sync window.
 *   2. Sync controls — Sync now, dry-run toggle, Cancel mid-run.
 *   3. Progress bar + ETA when status='running' or 'pending'.
 *   4. When status flips to 'completed' AND mode='staged', a review
 *      dialog mounts with Commit / Discard / View changes / Download.
 *   5. After every committed sync, an "Undo last sync" button appears
 *      next to the latest history row (only while last_committed_run_id
 *      points at it — the next sync invalidates undo).
 *   6. History — last 10 runs, expandable to 30.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  RefreshCw, Play, Pause, Loader2, X, CheckCircle2, AlertCircle,
  Clock, Calendar, Database, FileText, Download, RotateCcw,
  ChevronDown, ChevronUp, AlertTriangle, ShieldCheck, FlaskConical,
  Copy, Check, Upload, ExternalLink, FileArchive, Trash2,
} from 'lucide-react'

const WORKER_URL = 'https://myrx-food-search.motaz-jarrah.workers.dev'
const ADMIN_KEY  = import.meta.env.VITE_FOOD_ADMIN_KEY ?? ''

function workerFetch(path, options = {}) {
  return fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_KEY}`,
      ...(options.headers ?? {}),
    },
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtShort(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${date} ${time}`
  } catch { return '—' }
}

function relTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return null
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s} sec ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

function nextMonthlyCron(now = new Date()) {
  // Cron is `0 3 1 * *` — 03:00 UTC on the 1st of every month.
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3, 0, 0))
  return next.toISOString()
}

/**
 * Format the cron's recurring time-of-day in the user's local timezone +
 * timezone abbreviation, plus the canonical UTC time. Reads naturally
 * regardless of DST or timezone:
 *   "11:00 PM EDT (03:00 UTC)"
 *   "8:00 PM PDT (03:00 UTC)"
 *   "4:00 AM CET (03:00 UTC)"
 */
function cronTimeLabel(nextIso) {
  try {
    const d = new Date(nextIso)
    // Local time, e.g. "11:00 PM EDT".
    const local = d.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    })
    return `Monthly cron — 1st of each month at ${local} (03:00 UTC)`
  } catch {
    return 'Monthly cron — 1st of each month at 03:00 UTC'
  }
}

function durationMs(start, end) {
  if (!start || !end) return null
  return new Date(end).getTime() - new Date(start).getTime()
}

function fmtDuration(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60)  return remS ? `${m}m ${remS}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM ? `${h}h ${remM}m` : `${h}h`
}

const STATUS_CHIP = {
  idle:          { bg: 'border-border bg-muted/30 text-muted-foreground',          label: 'Idle' },
  pending:       { bg: 'border-amber-500/30 bg-amber-500/10 text-amber-400',       label: 'Pending' },
  starting:      { bg: 'border-amber-500/30 bg-amber-500/10 text-amber-400',       label: 'Starting…' },
  running:       { bg: 'border-amber-500/30 bg-amber-500/10 text-amber-400',       label: 'Running' },
  cancelling:    { bg: 'border-rose-500/30 bg-rose-500/10 text-rose-400',          label: 'Cancelling…' },
  cancelled:     { bg: 'border-muted-foreground/30 bg-muted/30 text-muted-foreground', label: 'Cancelled' },
  completed:     { bg: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', label: 'Completed' },
  failed:        { bg: 'border-destructive/30 bg-destructive/10 text-destructive', label: 'Failed' },
  staged_review: { bg: 'border-violet-500/30 bg-violet-500/10 text-violet-400',    label: 'Awaiting review' },
  unknown:       { bg: 'border-border bg-muted/30 text-muted-foreground',          label: '—' },
}

// ─── Stat tile ──────────────────────────────────────────────────────────────

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</div>}
    </div>
  )
}

// ─── Progress bar + ETA ─────────────────────────────────────────────────────

function ProgressBar({ status, progress, startedAt, etaBaselineMs }) {
  // Progress shape from the new sync orchestrator:
  //   progress.phase   — string identifier ('download_usda', 'parse_usda', ...)
  //   progress.pushed  — running write count (commit + staged modes)
  //   progress.total   — expected total for the active phase
  //   progress.inserted, .updated, .removed — final counters once known
  // Fallback signals retained for back-compat with older sync runs.
  const page  = progress?.pushed ?? progress?.page ?? 0
  const pages = progress?.total  ?? progress?.total_pages ?? progress?.usda_total ?? null
  const phase = progress?.phase || '—'

  let pct = null
  if (pages && page) pct = Math.min(100, Math.max(0, (page / pages) * 100))

  // ETA — two-tier strategy:
  //
  // 1. Baseline estimate from sync_history (median of last 5 successful runs).
  //    Available from the moment the sync starts → no "Calculating…" gap.
  //    Computed server-side via GET /admin/sync/eta and passed in as
  //    `etaBaselineMs`. Fallback: 15 min if history is empty.
  //
  // 2. Adaptive refinement once pct >= 3% AND elapsed > 60s — blend
  //    the linear extrapolation with the baseline using a 50/50 weight
  //    so the displayed ETA shifts smoothly toward reality without
  //    jumping if one is dramatically off.
  //
  // Result: ETA is shown from t=0, gracefully approaches truth, and
  // never produces "28h remaining" garbage from a 0.4% data point.
  const eta = useMemo(() => {
    if (!startedAt) return etaBaselineMs ? fmtDuration(etaBaselineMs) : null
    const elapsed = Date.now() - new Date(startedAt).getTime()
    const baselineRemaining = etaBaselineMs != null
      ? Math.max(0, etaBaselineMs - elapsed)
      : null

    // Until pct is meaningful, use the baseline straight.
    if (pct == null || pct < 3 || elapsed < 60_000) {
      return baselineRemaining != null ? fmtDuration(baselineRemaining) : null
    }

    // Linear extrapolation: elapsed/pct -> total -> remaining.
    const linearTotal     = elapsed / (pct / 100)
    const linearRemaining = Math.max(0, linearTotal - elapsed)

    // Blend.
    const blended = baselineRemaining != null
      ? (linearRemaining * 0.5 + baselineRemaining * 0.5)
      : linearRemaining
    return fmtDuration(blended)
  }, [pct, startedAt, etaBaselineMs])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* Phase chip — only shown when there's a real phase string.
            Empty/unknown phase renders nothing rather than 'Phase: —'. */}
        {phase && phase !== '—' ? (
          <span>Phase: <span className="text-foreground/80 font-medium">{phase}</span></span>
        ) : <span />}
        {/* ETA — only shown when we have a real number. No
            "Calculating…" placeholder. */}
        {eta && <span>~{eta} remaining</span>}
      </div>
      {/*
        Progress bar — two visual modes:

        Indeterminate (pct unknown): a thin amber stripe sweeps L→R
        continuously across a dim track. Same UX pattern as Linear's
        loading bars and GitHub Actions' "queued" runner indicator.
        Pure CSS keyframe animation (`@keyframes op-bar-sweep` in
        index.css) — no React re-paint per frame, so the animation
        runs at native compositor 60fps and never visibly stutters
        regardless of how often we poll status.

        Determinate (pct known): the filled portion grows smoothly
        with `transition-[width] duration-1000 ease-in-out`. The 1s
        easing absorbs the "step-up" between poll intervals so the
        bar visibly creeps instead of jumping. A secondary "shimmer"
        overlay slides L→R inside the filled portion for the same
        modern-app feel as Vercel deploy bars.
      */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/40">
        {pct == null ? (
          <div
            className="absolute inset-y-0 w-1/4 rounded-full bg-gradient-to-r from-transparent via-amber-400 to-transparent"
            style={{ animation: 'op-bar-sweep 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite' }}
          />
        ) : (
          <div
            className="relative h-full rounded-full bg-amber-500 overflow-hidden"
            style={{
              width: `${pct}%`,
              transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              style={{ animation: 'op-bar-shimmer 2s ease-in-out infinite' }}
            />
          </div>
        )}
      </div>
      {pct != null && (
        <div className="text-xs text-muted-foreground/60 tabular-nums">
          {page.toLocaleString()} / {pages.toLocaleString()} — {pct.toFixed(1)}%
        </div>
      )}

      {/* Live counters — show running tallies from the sync's progress
          payload. Same color palette as the Recent syncs row + the
          review dialog tiles so the user has a consistent visual
          vocabulary: green=insert, blue=update, red=delete. */}
      {(progress?.inserted != null || progress?.updated != null || progress?.removed != null) && (
        <div className="flex items-center gap-3 text-xs tabular-nums pt-1">
          <span className="text-emerald-400 font-medium">
            +{(progress.inserted ?? 0).toLocaleString()} <span className="text-muted-foreground/60 font-normal">inserts</span>
          </span>
          <span className="text-sky-400 font-medium">
            ~{(progress.updated ?? 0).toLocaleString()} <span className="text-muted-foreground/60 font-normal">updates</span>
          </span>
          <span className="text-rose-400 font-medium">
            −{(progress.removed ?? 0).toLocaleString()} <span className="text-muted-foreground/60 font-normal">deletes</span>
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Source files (drag-drop uploader for USDA + ON ZIPs) ──────────────────

/**
 * SourceFiles — admin uploader for the two source ZIPs.
 *
 * USDA's CDN keeps breaking (Cloudflare 1016 origin-DNS errors), so we
 * mirror both source files to R2 instead of trying to scrape USDA at
 * sync time. This component:
 *   - Shows what's currently uploaded (filename + size + when)
 *   - Offers a single button to open both source download pages
 *   - Provides a drag-drop / click-to-browse staging area
 *   - Uploads files via R2 multipart (50 MB chunks) so the Worker's
 *     100 MB request-body limit doesn't matter
 *
 * The morphing-button logic lives in the parent OperationsPanel so it
 * can coordinate with the existing sync controls. This component only
 * handles upload itself; it calls `onUploadStateChange` to bubble
 * state up.
 *
 * File type detection is filename-based:
 *   FoodData_Central_csv_*.zip       → USDA
 *   opennutrition-dataset-*.zip      → OpenNutrition
 *
 * Uploads progress per-file; both files can stage and upload
 * independently. Sync becomes available once BOTH show as uploaded
 * (status comes from the worker, not this component).
 */
function SourceFiles({ status, onUploadStateChange, onRefreshStatus, syncRunning }) {
  // staged: { usda: File|null, on: File|null } — picked but not yet uploaded
  const [staged, setStaged] = useState({ usda: null, on: null })
  // progress: { usda: { pct, sent, total } | null, on: ... }
  const [progress, setProgress] = useState({ usda: null, on: null })
  // uploading: bool — true while one or both uploads are in flight
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  // Detect file type from filename. Returns 'usda' | 'on' | null.
  function detectType(file) {
    const name = file.name || ''
    if (/FoodData_Central_csv.*\.zip$/i.test(name)) return 'usda'
    if (/opennutrition-dataset.*\.zip$/i.test(name)) return 'on'
    return null
  }

  // Stage a list of dropped/selected files. Classify each into usda/on
  // slots; reject unrecognised files with a brief error.
  function stageFiles(fileList) {
    setError('')
    const next = { ...staged }
    const unknown = []
    for (const f of fileList) {
      const type = detectType(f)
      if (!type) { unknown.push(f.name); continue }
      next[type] = f
    }
    setStaged(next)
    if (unknown.length) {
      setError(`Unrecognised filename(s): ${unknown.join(', ')}. Expected FoodData_Central_csv_*.zip or opennutrition-dataset-*.zip.`)
    }
  }

  function clearStaged(type) {
    setStaged(s => ({ ...s, [type]: null }))
  }

  // Drag handlers
  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (uploading) return
    stageFiles(Array.from(e.dataTransfer.files || []))
  }
  function onDragOver(e) {
    e.preventDefault()
    if (!uploading) setDragOver(true)
  }
  function onDragLeave(e) {
    e.preventDefault()
    setDragOver(false)
  }
  function onBrowse() {
    if (uploading) return
    fileInputRef.current?.click()
  }
  function onFileInputChange(e) {
    stageFiles(Array.from(e.target.files || []))
    // Reset so re-picking the same file fires onChange again.
    e.target.value = ''
  }

  // Open both source-download pages in new tabs with one click.
  function openDownloadPages() {
    window.open('https://fdc.nal.usda.gov/download-datasets', '_blank', 'noopener,noreferrer')
    window.open('https://www.opennutrition.app/download',    '_blank', 'noopener,noreferrer')
  }

  // ── Upload pipeline ─────────────────────────────────────────────────
  // Multipart chunks: 50 MB each. R2 requires part size >= 5 MB (except
  // the last part) and supports up to 10,000 parts. 50 MB gives a
  // good balance for 460 MB files (10 parts) vs upload concurrency.
  const CHUNK_SIZE = 50 * 1024 * 1024

  async function uploadOne(type, file) {
    setProgress(p => ({ ...p, [type]: { pct: 0, sent: 0, total: file.size } }))

    // 1. Start multipart upload
    const startRes = await workerFetch('/admin/food-files/upload/start', {
      method: 'POST',
      body: JSON.stringify({ type, filename: file.name, size: file.size }),
    })
    if (!startRes.ok) throw new Error(`${type} start failed: ${startRes.status}`)
    const { upload_id } = await startRes.json()

    // 2. Upload each chunk sequentially. We could parallelise but
    // residential upload bandwidth is usually the bottleneck —
    // sending one chunk at a time saturates it without overwhelming
    // the worker.
    const parts = []
    const totalParts = Math.ceil(file.size / CHUNK_SIZE)
    let sent = 0
    for (let i = 0; i < totalParts; i++) {
      const start = i * CHUNK_SIZE
      const end   = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)
      const partNumber = i + 1

      const partRes = await fetch(
        `${WORKER_URL}/admin/food-files/upload/part?upload_id=${encodeURIComponent(upload_id)}&part_number=${partNumber}&type=${type}`,
        {
          method:  'PUT',
          headers: { 'Authorization': `Bearer ${ADMIN_KEY}` },
          body:    chunk,
        }
      )
      if (!partRes.ok) {
        throw new Error(`${type} part ${partNumber} failed: HTTP ${partRes.status}`)
      }
      const partData = await partRes.json()
      parts.push({ part_number: partNumber, etag: partData.etag })
      sent += (end - start)
      setProgress(p => ({
        ...p,
        [type]: { pct: Math.round((sent / file.size) * 100), sent, total: file.size },
      }))
    }

    // 3. Complete multipart upload
    const completeRes = await workerFetch('/admin/food-files/upload/complete', {
      method: 'POST',
      body: JSON.stringify({
        upload_id, type, parts,
        filename: file.name, size: file.size,
      }),
    })
    if (!completeRes.ok) throw new Error(`${type} complete failed: ${completeRes.status}`)

    setProgress(p => ({ ...p, [type]: { pct: 100, sent: file.size, total: file.size } }))
  }

  async function startUpload() {
    setError('')
    setUploading(true)
    onUploadStateChange?.('uploading')
    try {
      // Upload both staged files in parallel.
      const tasks = []
      if (staged.usda) tasks.push(uploadOne('usda', staged.usda))
      if (staged.on)   tasks.push(uploadOne('on',   staged.on))
      await Promise.all(tasks)
      setStaged({ usda: null, on: null })
      await onRefreshStatus?.()
    } catch (e) {
      setError(`Upload failed: ${e.message}`)
    } finally {
      setUploading(false)
      onUploadStateChange?.('idle')
      // Clear per-file progress after a beat so the user sees 100%.
      setTimeout(() => setProgress({ usda: null, on: null }), 1500)
    }
  }

  async function deleteFile(type) {
    if (!confirm(`Remove the uploaded ${type === 'usda' ? 'USDA' : 'OpenNutrition'} file from the mirror?`)) return
    try {
      await workerFetch(`/admin/food-files/${type}`, { method: 'DELETE' })
      await onRefreshStatus?.()
    } catch (e) {
      setError(`Delete failed: ${e.message}`)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────
  const hasStaged   = !!(staged.usda || staged.on)
  const bothUploaded = !!(status?.usda && status?.on)
  // Expose computed state to parent so it can drive the morphing
  // bottom button (Upload → Uploading → Sync now).
  useEffect(() => {
    onUploadStateChange?.({
      hasStaged,
      bothUploaded,
      uploading,
      staged,
      startUpload,
    })
  }, [hasStaged, bothUploaded, uploading, staged.usda, staged.on])

  function fmtFileSize(bytes) {
    if (!bytes) return '0 B'
    if (bytes < 1024)            return `${bytes} B`
    if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  function fmtUploadedAt(iso) {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return '' }
  }

  // Relative-time helper for the "uploaded N ago" hint. Caps at 'over
  // a year' so we don't drift into noise for very old uploads.
  function relativeTime(iso) {
    if (!iso) return ''
    try {
      const ms = Date.now() - new Date(iso).getTime()
      const days = Math.floor(ms / 86_400_000)
      if (days < 1)   return 'today'
      if (days === 1) return 'yesterday'
      if (days < 7)   return `${days} days ago`
      if (days < 30)  return `${Math.floor(days / 7)} weeks ago`
      if (days < 365) return `${Math.floor(days / 30)} months ago`
      return `${Math.floor(days / 365)}+ years ago`
    } catch { return '' }
  }

  // Extract the version/date marker from the filename so the admin can
  // compare it against what's posted on USDA / ON download pages.
  //   FoodData_Central_csv_2026-04-30.zip   → "2026-04-30"
  //   opennutrition-dataset-2025.1.zip      → "2025.1"
  function versionFromFilename(name) {
    if (!name) return null
    const usdaMatch = /FoodData_Central_csv_(\d{4}-\d{2}-\d{2})/.exec(name)
    if (usdaMatch) return usdaMatch[1]
    const onMatch = /opennutrition-dataset-(\d{4}\.\d+)/.exec(name)
    if (onMatch) return onMatch[1]
    return null
  }

  // ── Render ─────────────────────────────────────────────────────────
  const usdaMissing = !status?.usda
  const onMissing   = !status?.on
  // "Upload only what's new" hint — visible when at least one file
  // is already in the mirror. New admins (both files missing) see
  // a simpler "upload both" prompt instead so they don't get
  // confused before they have a baseline.
  const hasAnyMirror = !!(status?.usda || status?.on)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground/70 font-medium">
          Source files
        </div>
        <button
          onClick={openDownloadPages}
          className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <ExternalLink className="h-3 w-3" /> Open download pages
        </button>
      </div>

      {/* Helper line — explains the upload rule. Different copy
          depending on whether the mirror has any files yet. */}
      <div className="text-xs text-muted-foreground/70 leading-snug">
        {hasAnyMirror
          ? <>Upload only the file(s) with a newer version on the source page. The other one stays put — both versions in the mirror are used for every sync.</>
          : <>Upload both ZIPs to populate the mirror. After that, only re-upload the file that has a new version.</>}
      </div>

      {/* Currently-uploaded cards — one per source. Cards collapse to
          a single line if no file is uploaded yet. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(['usda', 'on']).map(type => {
          const meta = status?.[type]
          const stagedFile = staged[type]
          const prog = progress[type]
          const label = type === 'usda' ? 'USDA FoodData Central' : 'OpenNutrition'

          // Three display states:
          // 1. Uploading right now → show progress bar
          // 2. File staged but not uploaded → show staged file info
          // 3. File already in mirror → show meta + delete button
          // 4. Nothing → show empty placeholder
          if (prog) {
            return (
              <div key={type} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {label}
                </div>
                <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {fmtFileSize(prog.sent)} / {fmtFileSize(prog.total)} — {prog.pct}%
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full bg-amber-500 transition-[width] duration-200"
                    style={{ width: `${prog.pct}%` }}
                  />
                </div>
              </div>
            )
          }

          if (stagedFile) {
            return (
              <div key={type} className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-violet-300 min-w-0">
                    <FileArchive className="h-3 w-3 shrink-0" />
                    <span className="truncate">{stagedFile.name}</span>
                  </div>
                  <button
                    onClick={() => clearStaged(type)}
                    className="text-muted-foreground/60 hover:text-foreground"
                    title="Remove from upload queue"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground/70 tabular-nums">
                  {fmtFileSize(stagedFile.size)} · staged for upload
                </div>
              </div>
            )
          }

          if (meta) {
            const version = versionFromFilename(meta.filename)
            return (
              <div key={type} className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400/90 min-w-0">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={meta.filename}>{label}</span>
                  </div>
                  <button
                    onClick={() => deleteFile(type)}
                    disabled={syncRunning || uploading}
                    className="text-muted-foreground/60 hover:text-destructive disabled:opacity-30 disabled:cursor-default"
                    title="Remove from mirror"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {/* Version + size on the first sub-line so admins can
                    eyeball "is this the latest?" against the source page. */}
                {version && (
                  <div className="mt-1 text-xs tabular-nums text-foreground/85 font-mono">
                    {version}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground/70 tabular-nums">
                  {fmtFileSize(meta.size)} · uploaded {fmtUploadedAt(meta.uploaded_at)} ({relativeTime(meta.uploaded_at)})
                </div>
              </div>
            )
          }

          return (
            <div key={type} className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <FileArchive className="h-3 w-3" />
                {label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground/50 italic">Not uploaded yet</div>
            </div>
          )
        })}
      </div>

      {/* Drag-drop / click-to-browse zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onBrowse}
        className={[
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
          'cursor-pointer select-none px-4 py-6',
          dragOver
            ? 'border-violet-400 bg-violet-500/10'
            : 'border-border/50 bg-muted/10 hover:bg-muted/20 hover:border-border/70',
          uploading && 'opacity-50 cursor-default pointer-events-none',
        ].filter(Boolean).join(' ')}
      >
        <Upload className="h-5 w-5 text-muted-foreground/60 mb-1.5" />
        <div className="text-xs font-medium text-muted-foreground">
          Drop ZIPs here, or click to browse
        </div>
        <div className="text-xs text-muted-foreground/50 mt-0.5">
          USDA FoodData_Central_csv_*.zip + OpenNutrition opennutrition-dataset-*.zip
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          multiple
          onChange={onFileInputChange}
          className="hidden"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

// ─── Step log (verbose progress feed) ───────────────────────────────────────

/**
 * StepLog — live verbose feed shown while a sync is running, and the
 * full transcript for the most recent runs after they finish.
 *
 * Architecture:
 *   - Polls /admin/sync/step-log?run_id=X&after_id=N every 2 seconds.
 *   - Maintains a local `entries` array, appended monotonically.
 *   - Auto-scrolls to the bottom on new entries UNLESS the user has
 *     scrolled up manually (preserves their reading position).
 *   - Entries past the most-recent 3 runs are purged server-side, so
 *     the polling cursor naturally resets when the run rotates.
 *
 * Levels are colour-tinted: info = neutral, warn = amber, error = rose.
 * Timestamps are rendered in HH:MM:SS local time (parsed from the UTC
 * `ts` field).
 */
function StepLog({ runId, active }) {
  const [entries, setEntries]   = useState([])
  const [autoScroll, setAuto]   = useState(true)
  const [copied, setCopied]     = useState(false)
  const cursorRef               = useRef(0)
  const containerRef            = useRef(null)
  const lastRunIdRef            = useRef(runId)

  // Reset cursor on run change.
  useEffect(() => {
    if (runId !== lastRunIdRef.current) {
      cursorRef.current = 0
      setEntries([])
      lastRunIdRef.current = runId
    }
  }, [runId])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const interval = active ? 2000 : 10000

    async function tick() {
      try {
        const res = await workerFetch(`/admin/sync/step-log?run_id=${runId}&after_id=${cursorRef.current}&limit=500`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (data.rows?.length) {
          cursorRef.current = data.next_id
          setEntries(prev => prev.concat(data.rows))
        }
      } catch { /* silent */ }
    }
    tick()
    const id = setInterval(tick, interval)
    return () => { cancelled = true; clearInterval(id) }
  }, [runId, active])

  // Auto-scroll on new entries.
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return
    const el = containerRef.current
    el.scrollTop = el.scrollHeight
  }, [entries, autoScroll])

  function onScroll(e) {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    setAuto(atBottom)
  }

  // Copy the full log to the clipboard. Format: `HH:MM:SS message`,
  // one entry per line — matches what the user sees on screen so they
  // can paste it directly into chat/email without reformatting.
  async function copyLog() {
    const text = entries.map(e => {
      let ts = ''
      try {
        const d = new Date(e.ts)
        if (!isNaN(d.getTime())) {
          const pad = n => String(n).padStart(2, '0')
          ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} `
        }
      } catch {}
      const code = e.error_code ? `[${e.error_code}] ` : ''
      return `${ts}${code}${e.message}`
    }).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard write blocked — silent */ }
  }

  if (!runId || (!active && entries.length === 0)) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground/70 font-medium">
          Sync progress log
        </div>
        {/* Copy button — appears only when there's something to copy.
            Click → copies HH:MM:SS-prefixed log lines to clipboard,
            shows a 1.5s "Copied" check-mark confirmation. */}
        {entries.length > 0 && (
          <button
            onClick={copyLog}
            className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Copy log to clipboard"
          >
            {copied
              ? <><Check className="h-3 w-3 text-emerald-400" /> Copied</>
              : <><Copy className="h-3 w-3" /> Copy</>}
          </button>
        )}
      </div>
      {/* Box is FIXED height (h-48 = 12rem = 192 px). Always exactly
          that tall regardless of entry count, so the panel layout
          doesn't shift around as the feed grows. Older entries scroll
          out of view (with auto-scroll to bottom on new entries). */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="h-48 overflow-y-auto rounded-lg border border-border/40 bg-muted/10 px-3 py-2 font-mono"
        style={{ fontSize: '12px', lineHeight: '1.5' }}
      >
        {entries.length === 0 ? null : (
          entries.map(e => {
            const ts = (() => {
              try {
                const d = new Date(e.ts)
                // Guard against invalid dates (returns NaN from get* methods).
                // The worker now branches on whether ts contains 'T' so
                // already-ISO values pass through verbatim — but old rows
                // written before that fix may still produce NaN here.
                if (isNaN(d.getTime())) return ''
                const pad = n => String(n).padStart(2, '0')
                return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
              } catch { return '' }
            })()
            const tint =
              e.level === 'error' ? 'text-rose-400'
              : e.level === 'warn' ? 'text-amber-400'
              : 'text-foreground/80'
            return (
              <div key={e.id} className="flex items-start gap-2 py-0.5">
                <span className="text-muted-foreground/50 tabular-nums shrink-0">{ts}</span>
                {e.error_code && (
                  <span className="text-rose-400/80 font-medium shrink-0">[{e.error_code}]</span>
                )}
                <span className={`${tint} break-words flex-1`}>{e.message}</span>
              </div>
            )
          })
        )}
      </div>
      {!autoScroll && active && (
        <button
          onClick={() => { setAuto(true) }}
          className="text-xs text-amber-400 hover:underline"
        >
          ↓ Resume auto-scroll
        </button>
      )}
    </div>
  )
}

// ─── Review dialog ───────────────────────────────────────────────────────────

function ReviewDialog({ runId, onCommit, onDiscard, onDownload, working, error }) {
  const [summary, setSummary]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [expandedOp, setExpand] = useState(null)
  const [rows, setRows]         = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await workerFetch(`/admin/sync/summary?run_id=${runId}`)
        if (!res.ok) throw new Error('Failed to load summary')
        const data = await res.json()
        if (!cancelled) setSummary(data)
      } catch (e) {
        if (!cancelled) setSummary({ error: e.message })
      }
      if (!cancelled) setLoading(false)
    }
    if (runId) load()
    return () => { cancelled = true }
  }, [runId])

  async function loadRows(op) {
    setExpand(op)
    setRows([])
    try {
      const res = await workerFetch(`/admin/sync/changes?run_id=${runId}&op=${op}&limit=200`)
      const data = await res.json()
      setRows(data.rows || [])
    } catch {
      setRows([])
    }
  }

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-violet-300">Staged sync — awaiting review</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        The sync finished but no changes have been applied yet. Review the
        proposed inserts/updates/deletes below, then commit or discard.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading change set…
        </div>
      )}

      {summary && !loading && !summary.error && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => loadRows('insert')}
            className={`rounded-lg border border-border/60 bg-emerald-500/5 px-3 py-2 text-left transition-colors hover:bg-emerald-500/10 ${expandedOp === 'insert' ? 'ring-1 ring-emerald-400' : ''}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Inserts</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">{(summary.inserts ?? 0).toLocaleString()}</div>
          </button>
          <button
            onClick={() => loadRows('update')}
            className={`rounded-lg border border-border/60 bg-sky-500/5 px-3 py-2 text-left transition-colors hover:bg-sky-500/10 ${expandedOp === 'update' ? 'ring-1 ring-sky-400' : ''}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold">Updates</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">{(summary.updates ?? 0).toLocaleString()}</div>
          </button>
          <button
            onClick={() => loadRows('delete')}
            className={`rounded-lg border border-border/60 bg-rose-500/5 px-3 py-2 text-left transition-colors hover:bg-rose-500/10 ${expandedOp === 'delete' ? 'ring-1 ring-rose-400' : ''}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold">Deletes</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums">{(summary.deletes ?? 0).toLocaleString()}</div>
          </button>
        </div>
      )}

      {expandedOp && (
        <div className="rounded-lg border border-border/40 bg-card p-3 max-h-64 overflow-y-auto space-y-1">
          {rows.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No rows</div>
          ) : (
            rows.map(r => {
              let data = {}
              try { data = JSON.parse(r.after_data || r.before_data || '{}') } catch {}
              return (
                <div key={r.id} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className="text-muted-foreground/60 tabular-nums w-12">{r.food_source}</span>
                  <span className="truncate flex-1">{data.name || '(no name)'}</span>
                  {data.brand && <span className="text-muted-foreground/60 truncate max-w-[200px]">{data.brand}</span>}
                </div>
              )
            })
          )}
          {rows.length >= 200 && (
            <div className="text-[10px] text-muted-foreground/60 italic text-center py-1">
              Showing first 200. Download CSV for the full list.
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
        <button
          onClick={onCommit}
          disabled={working}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/80 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 transition-opacity"
        >
          {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Commit changes
        </button>
        <button
          onClick={onDiscard}
          disabled={working}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <X className="h-3 w-3" />
          Discard
        </button>
        <button
          onClick={onDownload}
          disabled={working}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <Download className="h-3 w-3" />
          Download log (CSV)
        </button>
      </div>
    </div>
  )
}

// ─── Sync history ────────────────────────────────────────────────────────────

function HistoryList({ history, lastCommittedRunId, onUndo, undoing }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? history : history.slice(0, 5)
  if (!history?.length) return null

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground/70 font-medium">
        Recent syncs
      </div>
      <div className="space-y-1.5">
        {visible.map(h => {
          const canUndo = h.run_id === lastCommittedRunId && (h.committed > 0) && (h.reverted < h.committed)
          return (
            <div key={h.run_id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
              <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium tabular-nums">{fmtShort(h.started_at)}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2.5 flex-wrap mt-1">
                  <span className="text-emerald-400 font-medium">+{(h.inserts ?? 0).toLocaleString()}</span>
                  <span className="text-sky-400 font-medium">~{(h.updates ?? 0).toLocaleString()}</span>
                  <span className="text-rose-400 font-medium">−{(h.deletes ?? 0).toLocaleString()}</span>
                  {h.reverted > 0 && <span className="text-amber-400 font-medium">reverted</span>}
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-muted-foreground/70">{fmtDuration(durationMs(h.started_at, h.ended_at))}</span>
                </div>
              </div>
              {canUndo && (
                <button
                  onClick={() => onUndo(h.run_id)}
                  disabled={undoing}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 transition-colors shrink-0"
                >
                  {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Undo
                </button>
              )}
            </div>
          )
        })}
      </div>
      {history.length > 5 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? 'Show less' : `Show all ${history.length}`}
        </button>
      )}
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function OperationsPanel({ stats: pageStats, onRefreshStats }) {
  const [sync,        setSync]        = useState(null)
  const [history,     setHistory]     = useState([])
  // ETA baseline (ms) pulled from /admin/sync/eta — the median of the
  // last 5 successful sync durations. Lets the progress bar show a
  // sensible ETA from t=0 instead of "Calculating…".
  const [etaBaseline, setEtaBaseline] = useState(null)
  // R2 mirror metadata — { usda: {filename, size, uploaded_at}|null, on: ... }
  const [filesStatus, setFilesStatus] = useState({ usda: null, on: null })
  // Upload state surfaced by SourceFiles for the morphing bottom button.
  const [uploadState, setUploadState] = useState({ hasStaged: false, bothUploaded: false, uploading: false, staged: { usda: null, on: null }, startUpload: null })
  // displayError is the ephemeral copy of sync_error we show in the banner.
  // The server-side sync_error is cleared the first time we observe it in a
  // non-running state, so subsequent mounts won't re-display it. This
  // matches user expectation: "show only until the page refreshes or I
  // navigate away and come back."
  const [displayError, setDisplayError] = useState('')
  const errorClearedRef = useRef(false)
  // Start COLLAPSED on page load — the panel is the user's "control deck"
  // for sync operations, not a primary surface. They open it deliberately
  // (or it auto-opens when something needs attention; see effect below).
  const [collapsed,   setCollapsed]   = useState(true)
  // Tracks whether we've auto-expanded for the current actionable state so
  // we don't fight the user if they collapse again mid-run.
  const autoExpandedRef = useRef(false)
  const [stagedToggle,setStagedToggle]= useState(false)
  const [triggering,  setTriggering]  = useState(false)
  const [reviewing,   setReviewing]   = useState(false)
  const [undoing,     setUndoing]     = useState(false)
  const [error,       setError]       = useState('')
  const [reviewError, setReviewError] = useState('')
  const pollRef = useRef(null)

  // ── Status polling ──────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await workerFetch('/admin/sync/status')
      if (res.ok) setSync(await res.json())
    } catch { /* silent */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await workerFetch('/admin/sync/history?limit=30')
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
  }, [])

  const fetchFilesStatus = useCallback(async () => {
    try {
      const res = await workerFetch('/admin/food-files/status')
      if (res.ok) setFilesStatus(await res.json())
    } catch { /* silent */ }
  }, [])

  // Fetch the ETA baseline once on mount AND whenever a fresh run starts.
  // The endpoint returns the median of the most-recent 5 successful runs,
  // so it stays accurate across syncs without per-render recomputation.
  const fetchEta = useCallback(async () => {
    try {
      const res = await workerFetch('/admin/sync/eta')
      if (res.ok) {
        const data = await res.json()
        if (typeof data.estimate_ms === 'number') setEtaBaseline(data.estimate_ms)
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchHistory()
    fetchEta()
    fetchFilesStatus()
    function schedule() {
      const interval = (sync?.status === 'running' || sync?.status === 'pending') ? 3000 : 30000
      pollRef.current = setTimeout(async () => {
        await fetchStatus()
        // History refreshes once per minute regardless of sync state.
        if (Math.random() < interval / 60000) await fetchHistory()
        schedule()
      }, interval)
    }
    schedule()
    return () => clearTimeout(pollRef.current)
  }, [fetchStatus, fetchHistory, fetchEta, sync?.status])

  // Re-fetch the baseline when a sync starts so the bar reflects the
  // most recent run history (especially useful right after the first
  // successful run lands in history).
  useEffect(() => {
    if (sync?.status === 'running' || sync?.status === 'pending') {
      fetchEta()
    }
  }, [sync?.status, fetchEta])

  // ── Ephemeral error display ────────────────────────────────────────────
  // First time we observe sync.error in a non-running state (i.e. after
  // a cancel/fail/completion), capture it for the banner AND clear it on
  // the server. The banner stays visible (via displayError) until the
  // component unmounts; the server-side clear means a fresh mount won't
  // re-display the same error.
  //
  // Reset when a new sync starts (status becomes running/pending), so
  // any error that surfaces from THAT run gets shown too.
  useEffect(() => {
    if (!sync) return
    const isActive = sync.status === 'running' || sync.status === 'pending'
    if (isActive) {
      // A new run started — drop any stale banner and re-arm BOTH error
      // sources. `error` carries local handler failures (e.g. the trigger
      // POST timed out and surfaced "Network error: Failed to fetch");
      // `displayError` carries the ephemeral copy of the server-side
      // sync_error. Both need clearing on a fresh run or the banner
      // sticks around throughout the new sync's pending/running phase.
      if (displayError) setDisplayError('')
      if (error)        setError('')
      errorClearedRef.current = false
      return
    }
    // Non-running state with an error → capture + clear server-side once.
    if (sync.error && !displayError) {
      setDisplayError(sync.error)
      if (!errorClearedRef.current) {
        errorClearedRef.current = true
        workerFetch('/admin/sync/state', {
          method: 'POST',
          body: JSON.stringify({ error: '' }),
        }).catch(() => {})
      }
    }
  }, [sync, displayError, error])

  // ── Derived state ───────────────────────────────────────────────────────
  // Cancel flow:
  //   user clicks Cancel  → cancel_requested flag goes 1 on the worker
  //   sync script notices → it pushes status='cancelled' from GHA
  //   between those two moments, status is still 'running' AND
  //   cancel_requested is true → show 'cancelling' so the user knows
  //   their click was registered and the script is winding down.
  //
  // Starting vs Running:
  //   The GHA workflow's first step posts status='running' before the
  //   sync script makes its first USDA API call. There's a 1-3s gap
  //   between that "I'm alive" handshake and the first page of progress
  //   data (which carries total_pages). During that gap the progress bar
  //   has no determinate data so it shows the indeterminate sweep.
  //   To keep the pill consistent with the bar, we display 'starting'
  //   (chip label "Starting…") whenever status is 'running' but no
  //   total_pages has been reported yet. Once the first real progress
  //   update lands, the pill flips to 'Running' and the bar transitions
  //   from sweep to fill in the same beat.
  const status = useMemo(() => {
    if (sync?.staged_review_pending) return 'staged_review'
    if ((sync?.status === 'running' || sync?.status === 'pending') && sync?.cancel_requested) {
      return 'cancelling'
    }
    if (sync?.status === 'running') {
      const hasProgress = sync?.progress?.total_pages && sync?.progress?.page
      if (!hasProgress) return 'starting'
    }
    return sync?.status || 'unknown'
  }, [sync])

  const chip = STATUS_CHIP[status] || STATUS_CHIP.unknown
  const isRunning = status === 'running' || status === 'pending' || status === 'starting' || status === 'cancelling'
  const isCancelling = status === 'cancelling'
  const reviewPending = status === 'staged_review' && sync?.run_id

  // Auto-expand the panel when something actionable is happening: an
  // active sync, a failure (so the error is visible), or a staged review
  // waiting on the admin. Idle / completed / cancelled states leave the
  // user-chosen collapse state alone (so the panel stays out of the way
  // unless the admin opens it).
  //
  // The ref tracks "have we already auto-expanded for this state?" so
  // we don't keep re-opening after the user manually collapses mid-run.
  useEffect(() => {
    const needsAttention = isRunning || status === 'failed' || reviewPending
    if (needsAttention && !autoExpandedRef.current) {
      setCollapsed(false)
      autoExpandedRef.current = true
    } else if (!needsAttention) {
      // Reset the auto-expand latch when the state clears, so the next
      // problem reopens the panel.
      autoExpandedRef.current = false
    }
  }, [isRunning, status, reviewPending])

  // Step-log visibility rule (mirrors common DevOps UX):
  //   - Show while a sync is running (live progress feed)
  //   - Show on failure (so the error trail is visible for debugging)
  //   - HIDE after successful completion (the result is in history)
  //   - HIDE after cancellation (the sync was abandoned; log is noise)
  //   - HIDE on staged review (the review dialog has its own summary)
  // Same logic as a terminal: log streams while the command runs, the
  // output stays put if it errored, but `make clean` doesn't keep
  // showing the last build's stdout forever.
  const showStepLog = isRunning || status === 'failed'

  // ── Actions ─────────────────────────────────────────────────────────────
  async function triggerSync() {
    setTriggering(true)
    setError('')
    try {
      const res = await workerFetch('/admin/sync', {
        method: 'POST',
        body: JSON.stringify({ force: false, staged: stagedToggle }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to trigger sync')
        return
      }
      await fetchStatus()
    } catch (e) { setError('Network error: ' + e.message) }
    finally  { setTriggering(false) }
  }

  async function cancelSync() {
    try {
      await workerFetch('/admin/sync/cancel', { method: 'POST' })
      await fetchStatus()
    } catch (e) { setError('Cancel failed: ' + e.message) }
  }

  async function commitStaged() {
    if (!sync?.run_id) return
    setReviewing(true)
    setReviewError('')
    try {
      const res = await workerFetch('/admin/sync/commit', {
        method: 'POST',
        body: JSON.stringify({ run_id: sync.run_id }),
      })
      const data = await res.json()
      if (!res.ok) { setReviewError(data.error ?? 'Commit failed'); return }
      await fetchStatus()
      await fetchHistory()
      onRefreshStats?.()
    } catch (e) { setReviewError('Commit failed: ' + e.message) }
    finally  { setReviewing(false) }
  }

  async function discardStaged() {
    if (!sync?.run_id) return
    setReviewing(true)
    setReviewError('')
    try {
      const res = await workerFetch('/admin/sync/discard', {
        method: 'POST',
        body: JSON.stringify({ run_id: sync.run_id }),
      })
      const data = await res.json()
      if (!res.ok) { setReviewError(data.error ?? 'Discard failed'); return }
      await fetchStatus()
      await fetchHistory()
    } catch (e) { setReviewError('Discard failed: ' + e.message) }
    finally  { setReviewing(false) }
  }

  function downloadChangelog() {
    if (!sync?.run_id) return
    // The fetch needs Authorization. Pull via fetch, convert to blob,
    // synthesize an <a download> click. (Direct anchor href can't carry
    // a custom Authorization header.)
    workerFetch(`/admin/sync/changes/csv?run_id=${sync.run_id}`)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `sync-changelog-${sync.run_id}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
      .catch(() => setReviewError('Download failed'))
  }

  async function undoLastSync(runId) {
    if (!confirm('Undo the last sync? All inserts/updates/deletes from that run will be reversed. This cannot be undone.')) return
    setUndoing(true)
    try {
      const res = await workerFetch('/admin/sync/undo', {
        method: 'POST',
        body: JSON.stringify({ run_id: runId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Undo failed'); return }
      await fetchStatus()
      await fetchHistory()
      onRefreshStats?.()
    } catch (e) { setError('Undo failed: ' + e.message) }
    finally  { setUndoing(false) }
  }

  // ── Catalog stats numbers ───────────────────────────────────────────────
  const totalRows  = pageStats?.total ?? null
  const sourceBreakdown = pageStats?.by_source ?? {}

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {/* Header — title + status chip + collapse toggle. Status auto-polls
          every 3s while a sync runs and every 30s when idle, so there's
          no manual refresh button — anything visible is up to date. */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
          <Database className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-sm font-medium">Library Operations</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${chip.bg}`}>{chip.label}</span>
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Catalog stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Total foods" value={totalRows?.toLocaleString() ?? '—'} />
            <Stat label="USDA"        value={(sourceBreakdown.usda ?? 0).toLocaleString()} />
            <Stat label="OpenNutrition" value={(sourceBreakdown.on ?? 0).toLocaleString()} />
            <Stat label="MYRX (custom)" value={(sourceBreakdown.myrx ?? 0).toLocaleString()} />
          </div>

          {/* Sync timing.
              "Last sync" shows the last actually-COMMITTED sync only —
              never updates on cancellations, staged-but-not-committed
              syncs, or failures. Reads sync.last_committed_sync_at
              (server-side timestamp stamped only when a commit happens).
              If no sync has been committed yet, shows '—' / 'Never'. */}
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Last sync"
              value={sync?.last_committed_sync_at ? fmtShort(sync.last_committed_sync_at) : '—'}
            />
            <Stat
              label="Next scheduled"
              value={fmtShort(nextMonthlyCron())}
            />
          </div>

          {/* Source-file uploader — sits between the stat tiles and
              the sync progress bar so admins see it before the sync
              controls. Hidden during an active sync (so it doesn't
              distract from progress feedback). */}
          {!isRunning && !reviewPending && (
            <SourceFiles
              status={filesStatus}
              onUploadStateChange={(s) => {
                if (typeof s === 'object' && s !== null) setUploadState(s)
              }}
              onRefreshStatus={fetchFilesStatus}
              syncRunning={isRunning}
            />
          )}

          {/* Progress bar (when running) */}
          {isRunning && (
            <ProgressBar
              status={status}
              progress={sync?.progress}
              startedAt={sync?.started_at}
              etaBaselineMs={etaBaseline}
            />
          )}

          {/* Verbose step log — shown only when something actionable is
              happening (sync running OR sync failed). Successful and
              cancelled runs hide the log so the panel doesn't carry
              stale noise; the result lives in the history list. */}
          {sync?.run_id && showStepLog && (
            <StepLog runId={sync.run_id} active={isRunning} />
          )}

          {/* Review dialog (when staged) */}
          {reviewPending && (
            <ReviewDialog
              runId={sync.run_id}
              working={reviewing}
              error={reviewError}
              onCommit={commitStaged}
              onDiscard={discardStaged}
              onDownload={downloadChangelog}
            />
          )}

          {/* Trigger controls */}
          {!reviewPending && (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border/40">
              {/*
                Dry-run toggle.

                While a sync is running, the toggle is locked at the
                state level (disabled prop on the input prevents change)
                AND the displayed value is derived from the CURRENT RUN's
                mode so the UI always reflects what's actually happening.
                Visual treatment: just dim the toggle + label to gray —
                no cursor change, no "locked" text. Simple disabled-look.

                When idle, the toggle returns to normal interactive state
                and the local `stagedToggle` governs the next sync's mode.
              */}
              {(() => {
                const liveStaged = isRunning ? sync?.mode === 'staged' : stagedToggle
                return (
                  <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
                    <span className={`relative inline-flex items-center ${isRunning ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={liveStaged}
                        onChange={e => setStagedToggle(e.target.checked)}
                        disabled={isRunning}
                        className="sr-only peer"
                      />
                      <span className="h-4 w-7 rounded-full bg-muted border border-border peer-checked:bg-violet-500/40 peer-checked:border-violet-400 transition-colors" />
                      <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-foreground transition-transform peer-checked:translate-x-3" />
                    </span>
                    <span className={
                      isRunning
                        ? 'text-muted-foreground/50'
                        : (liveStaged ? 'text-violet-300' : 'text-muted-foreground')
                    }>
                      Dry-run (review before commit)
                    </span>
                  </label>
                )
              })()}

              <div className="flex items-center gap-2">
                {/*
                  Morphing bottom button. Five states:
                    1. Sync running        → 'Cancel sync' (destructive red)
                    2. Uploading           → 'Uploading…' disabled (with spinner)
                    3. Files staged        → 'Upload' enabled (primary)
                    4. No files in mirror  → 'Upload' disabled (gray; user must
                                              drop files before sync is possible)
                    5. Both files in mirror → 'Sync now' enabled (primary)
                  Order matters: uploading > staged > sync-ready > pre-upload.
                */}
                {isRunning ? (
                  <button
                    onClick={cancelSync}
                    disabled={isCancelling}
                    className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-60 disabled:cursor-default transition-colors"
                  >
                    {isCancelling
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Pause className="h-3 w-3" />}
                    {isCancelling ? 'Cancelling…' : 'Cancel sync'}
                  </button>
                ) : uploadState.uploading ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 rounded-lg bg-primary/40 px-3 py-1.5 text-xs font-semibold text-primary-foreground cursor-default"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading…
                  </button>
                ) : uploadState.hasStaged ? (
                  <button
                    onClick={() => uploadState.startUpload?.()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <Upload className="h-3 w-3" />
                    Upload
                  </button>
                ) : uploadState.bothUploaded ? (
                  <button
                    onClick={triggerSync}
                    disabled={triggering}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {triggering ? 'Starting…' : 'Sync now'}
                  </button>
                ) : (
                  <button
                    disabled
                    title="Upload USDA + OpenNutrition ZIPs before syncing"
                    className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-default"
                  >
                    <Upload className="h-3 w-3" />
                    Upload
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error display. Two sources:
              - `error`: transient errors from the local trigger / commit /
                discard / undo handlers. Lives in local state until the
                next action overwrites it.
              - `displayError`: the ephemeral copy of the server-side
                sync_error captured on first non-running observation.
                The server-side value is cleared immediately when captured,
                so refreshing the page drops the banner. */}
          {(error || displayError) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error || displayError}</span>
            </div>
          )}

          {/* History list */}
          <HistoryList
            history={history}
            lastCommittedRunId={sync?.last_committed_run_id}
            onUndo={undoLastSync}
            undoing={undoing}
          />
        </>
      )}
    </div>
  )
}
