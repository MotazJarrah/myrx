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

function ProgressBar({ status, progress, startedAt }) {
  // Use whatever progress signal the sync scripts have written.
  // Branded pass: progress.page / progress.total_pages
  // Foundation/SR Legacy: similar shape
  // Fallback: indeterminate
  const page  = progress?.page  ?? 0
  const pages = progress?.total_pages ?? progress?.usda_total ?? null
  const phase = progress?.phase || '—'

  let pct = null
  if (pages && page) pct = Math.min(100, Math.max(0, (page / pages) * 100))

  // ETA computation. Linear extrapolation from `elapsed / pct` is wildly
  // unstable in the first 1-2 minutes of a sync because the elapsed
  // clock starts at workflow dispatch (which includes GHA runner boot,
  // npm install, USDA cold-start, etc.) but real work doesn't begin
  // until the first page is processed. From 0.4% complete the ratio
  // produces ~28h estimates that are pure noise.
  //
  // Suppress ETA until we have enough data points to be meaningful:
  //   - elapsed > 60s (past the startup spike)
  //   - pct >= 3%  (past the warm-up phase)
  // Past those thresholds the rate stabilises and ETA reads sensibly.
  const eta = useMemo(() => {
    if (!startedAt || pct == null || pct < 3) return null
    const elapsed = Date.now() - new Date(startedAt).getTime()
    if (elapsed < 60_000) return null
    const totalEstimated = elapsed / (pct / 100)
    const remaining = totalEstimated - elapsed
    if (remaining < 0) return null
    return fmtDuration(remaining)
  }, [pct, startedAt])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Phase: <span className="text-foreground/80 font-medium">{phase}</span></span>
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
        <div className="text-[10px] text-muted-foreground/60 tabular-nums">
          {page.toLocaleString()} / {pages.toLocaleString()} pages — {pct.toFixed(1)}%
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
  // displayError is the ephemeral copy of sync_error we show in the banner.
  // The server-side sync_error is cleared the first time we observe it in a
  // non-running state, so subsequent mounts won't re-display it. This
  // matches user expectation: "show only until the page refreshes or I
  // navigate away and come back."
  const [displayError, setDisplayError] = useState('')
  const errorClearedRef = useRef(false)
  const [collapsed,   setCollapsed]   = useState(false)
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

  useEffect(() => {
    fetchStatus()
    fetchHistory()
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
  }, [fetchStatus, fetchHistory, sync?.status])

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
      // A new run started — drop any stale banner and re-arm.
      if (displayError) setDisplayError('')
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
  }, [sync, displayError])

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
      {/* Header — title + status chip + collapse toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
          <Database className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-sm font-medium">Library Operations</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${chip.bg}`}>{chip.label}</span>
        </button>
        <button
          onClick={() => { fetchStatus(); fetchHistory() }}
          className="p-1.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
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
              label={isRunning ? 'Last committed sync' : 'Last sync'}
              value={sync?.last_committed_sync_at ? fmtShort(sync.last_committed_sync_at) : '—'}
              hint={
                isRunning
                  ? 'a new sync is in progress — this date is the last commit'
                  : (sync?.last_committed_sync_at
                       ? relTime(sync.last_committed_sync_at)
                       : 'no sync committed yet')
              }
            />
            <Stat
              label="Next scheduled"
              value={fmtShort(nextMonthlyCron())}
              hint="Monthly cron — 1st of each month at 03:00 UTC"
            />
          </div>

          {/* Progress bar (when running) */}
          {isRunning && (
            <ProgressBar status={status} progress={sync?.progress} startedAt={sync?.started_at} />
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
                ) : (
                  <button
                    onClick={triggerSync}
                    disabled={triggering}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {triggering ? 'Starting…' : 'Sync now'}
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
