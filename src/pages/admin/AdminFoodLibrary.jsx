import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Plus, Pencil, Trash2, Check, X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Play, CheckCircle2, AlertCircle, Clock } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const FOOD_WORKER_URL  = 'https://myrx-food-search.motaz-jarrah.workers.dev'
const FOOD_ADMIN_KEY   = import.meta.env.VITE_FOOD_ADMIN_KEY ?? ''

function workerFetch(path, options = {}) {
  return fetch(`${FOOD_WORKER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FOOD_ADMIN_KEY}`,
      ...(options.headers ?? {}),
    },
  })
}

const SOURCE_FILTERS = [
  { value: '',     label: 'All'  },
  { value: 'usda', label: 'USDA' },
  { value: 'on',   label: 'ON'   },
  { value: 'myrx', label: 'MYRX' },
]

const SOURCE_BADGE = {
  usda: 'bg-sky-500/15 text-sky-400',
  on:   'bg-violet-500/15 text-violet-400',
  myrx: 'bg-emerald-500/15 text-emerald-400',
}

const EMPTY_FORM = {
  name: '', brand: '', upc: '',
  kcal: '', protein_g: '', fat_g: '', carbs_g: '', fiber_g: '', sodium_mg: '',
  serving_g: '', serving_label: '', servings_per_container: '',
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-xs text-muted-foreground'

// ── Helpers ───────────────────────────────────────────────────────────────────

function numOrNull(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

function fmtNum(v) {
  if (v == null) return '—'
  return Math.round(v * 10) / 10
}

// ── Food form (add / edit) ─────────────────────────────────────────────────────

const FOOD_MODE_KEY = id => `food_input_mode_${id}`
const NUTRIENT_KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sodium_mg']

function FoodForm({ initial, isEdit, foodId, onSave, onCancel, saving }) {
  const savedMode = isEdit && foodId
    ? localStorage.getItem(FOOD_MODE_KEY(foodId))
    : null
  const initPerServing = savedMode ? savedMode === 'serving' : true

  // When editing in per-serving mode with a known serving size,
  // convert the stored per-100g values to per-serving for display.
  function initFormValues() {
    const base = { ...EMPTY_FORM, ...initial }
    if (!isEdit) return base
    const srvG = parseFloat(initial?.serving_g)
    if (!initPerServing || isNaN(srvG) || srvG <= 0) return base
    const factor = srvG / 100
    const out = { ...base }
    for (const k of NUTRIENT_KEYS) {
      const n = parseFloat(initial?.[k])
      if (!isNaN(n)) out[k] = String(Math.round(n * factor * 100) / 100)
    }
    return out
  }

  const [form, setForm] = useState(initFormValues)
  const [perServing, setPerServing] = useState(initPerServing)

  function handleModeChange(val) {
    if (val === perServing) return
    const srvG = numOrNull(form.serving_g)
    // If we have a serving size, convert the displayed values to the new mode
    if (srvG && srvG > 0) {
      setForm(prev => {
        const next = { ...prev }
        for (const k of NUTRIENT_KEYS) {
          const n = parseFloat(prev[k])
          if (!isNaN(n)) {
            next[k] = val
              ? String(Math.round(n * (srvG / 100) * 100) / 100)  // per-100g → per-serving
              : String(Math.round(n * (100 / srvG) * 100) / 100)  // per-serving → per-100g
          }
        }
        return next
      })
    }
    setPerServing(val)
    if (isEdit && foodId) {
      localStorage.setItem(FOOD_MODE_KEY(foodId), val ? 'serving' : '100g')
    }
  }
  const set = useCallback((k, v) => setForm(p => ({ ...p, [k]: v })), [])

  const servingG = numOrNull(form.serving_g)
  const canConvert = perServing && servingG > 0

  function toStored(v) {
    // Convert per-serving input → per-100g for storage
    const n = numOrNull(v)
    if (n === null) return null
    return Math.round((n / servingG) * 100 * 100) / 100
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    if (perServing && !servingG) return  // need serving size to convert

    const nutrient = canConvert ? toStored : numOrNull

    onSave({
      name:                   form.name.trim(),
      brand:                  form.brand.trim() || null,
      upc:                    form.upc.trim()   || null,
      kcal:                   nutrient(form.kcal),
      protein_g:              nutrient(form.protein_g),
      fat_g:                  nutrient(form.fat_g),
      carbs_g:                nutrient(form.carbs_g),
      fiber_g:                nutrient(form.fiber_g),
      sodium_mg:              nutrient(form.sodium_mg),
      serving_g:              numOrNull(form.serving_g),
      serving_label:          form.serving_label.trim() || null,
      servings_per_container: numOrNull(form.servings_per_container),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <label className={labelCls}>Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Greek Yogurt, Plain" required className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Brand</label>
          <input value={form.brand} onChange={e => set('brand', e.target.value)}
            placeholder="e.g. Chobani" className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Barcode (UPC)</label>
          <input value={form.upc} onChange={e => set('upc', e.target.value)}
            placeholder="e.g. 012345678901" className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Serving label</label>
          <input value={form.serving_label} onChange={e => set('serving_label', e.target.value)}
            placeholder="e.g. 1 cup" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Serving size (g)</label>
          <input type="number" step="0.1" value={form.serving_g}
            onChange={e => set('serving_g', e.target.value)}
            placeholder="e.g. 50" className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Servings per container</label>
          <input type="number" step="0.5" value={form.servings_per_container}
            onChange={e => set('servings_per_container', e.target.value)}
            placeholder="e.g. 4" className={inputCls} />
        </div>
      </div>

      {/* Nutrient input mode segmented control */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nutrients</p>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs font-semibold gap-0.5">
          {[['Per serving', true], ['Per 100g', false]].map(([label, val]) => (
            <button key={label} type="button" onClick={() => handleModeChange(val)}
              className={`px-3 py-1 rounded-md transition-colors ${perServing === val ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {perServing && !servingG && (
        <p className="text-xs text-amber-400">Enter serving size (g) above first so we can convert correctly.</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          ['kcal',       'Calories (kcal)'],
          ['protein_g',  'Protein (g)'],
          ['fat_g',      'Fat (g)'],
          ['carbs_g',    'Carbs (g)'],
          ['fiber_g',    'Fiber (g)'],
          ['sodium_mg',  'Sodium (mg)'],
        ].map(([key, lbl]) => (
          <div key={key} className="flex flex-col gap-1">
            <label className={labelCls}>{lbl}</label>
            <input type="number" step="0.01" value={form[key]}
              onChange={e => set(key, e.target.value)}
              placeholder="0" className={inputCls} />
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Delete confirm ─────────────────────────────────────────────────────────────

function DeleteConfirm({ food, onConfirm, onCancel, deleting }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">Delete <span className="font-semibold">{food.name}</span>?</p>
      <p className="text-xs text-muted-foreground">This cannot be undone.</p>
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={deleting}
          className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Delete
        </button>
        <button onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Food row ───────────────────────────────────────────────────────────────────

function FoodRow({ food, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{food.name}</span>
          <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-bold tracking-wider uppercase ${SOURCE_BADGE[food.source] ?? 'bg-muted text-muted-foreground'}`}>
            {food.source}
          </span>
        </div>
        {food.brand && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{food.brand}</p>}
      </div>
      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs tabular-nums text-muted-foreground">
        <span className="text-red-400 font-medium w-14 text-right">{fmtNum(food.kcal)} kcal</span>
        <span className="text-blue-400  w-12 text-right">P {fmtNum(food.protein_g)}g</span>
        <span className="text-amber-400 w-12 text-right">F {fmtNum(food.fat_g)}g</span>
        <span className="text-emerald-400 w-12 text-right">C {fmtNum(food.carbs_g)}g</span>
        {food.serving_g && (
          <span className="text-muted-foreground/60 w-16 text-right">{Math.round(food.serving_g)}g srv</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {food.source === 'myrx' && (
          <button onClick={() => onEdit(food)}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={() => onDelete(food)}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Sync Panel ────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  idle:      { cls: 'border-border bg-muted/30 text-muted-foreground',                   label: 'Idle'      },
  running:   { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400',                label: 'Running'   },
  completed: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',          label: 'Completed' },
  failed:    { cls: 'border-destructive/30 bg-destructive/10 text-destructive',          label: 'Failed'    },
  unknown:   { cls: 'border-border bg-muted/30 text-muted-foreground',                   label: '—'         },
}

function fmtShort(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${date} ${time}`
  } catch { return '—' }
}

function MetaItem({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">{label}</span>
      <span className="text-xs text-foreground/80">{value}</span>
    </div>
  )
}

function SyncPanel({ onRefreshStats }) {
  const [sync,       setSync]       = useState(null)
  const [triggering, setTriggering] = useState(false)
  const [trigErr,    setTrigErr]    = useState('')
  const pollRef = useRef(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await workerFetch('/admin/sync/status')
      if (res.ok) setSync(await res.json())
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const schedule = () => {
      pollRef.current = setTimeout(async () => {
        await fetchStatus()
        schedule()
      }, sync?.status === 'running' ? 5_000 : 30_000)
    }
    schedule()
    return () => clearTimeout(pollRef.current)
  }, [fetchStatus, sync?.status])

  async function triggerSync() {
    setTriggering(true)
    setTrigErr('')
    try {
      const res  = await workerFetch('/admin/sync', { method: 'POST', body: JSON.stringify({ force: false }) })
      const data = await res.json()
      if (!res.ok) { setTrigErr(data.error ?? 'Failed to trigger sync'); return }
      await fetchStatus()
      onRefreshStats?.()
    } catch { setTrigErr('Network error') }
    finally  { setTriggering(false) }
  }

  const st      = sync?.status ?? 'unknown'
  const { cls, label } = STATUS_STYLES[st] ?? STATUS_STYLES.unknown
  const isRunning = st === 'running'

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning
            ? <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/50" />}
          <span className="text-sm font-medium">Library Sync</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchStatus}
            className="p-1.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Refresh status"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={triggerSync}
            disabled={triggering || isRunning}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {triggering ? 'Starting…' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <MetaItem label="Started"    value={fmtShort(sync?.started_at)} />
        <MetaItem label="Completed"  value={fmtShort(sync?.completed_at)} />
        <MetaItem label="USDA sync"  value={sync?.usda?.last_sync_date || '—'} />
        <MetaItem label="ON version" value={sync?.on?.last_version || '—'} />
      </div>

      {/* Running progress */}
      {isRunning && sync?.progress && Object.keys(sync.progress).length > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2 space-y-0.5">
          {sync.progress.phase     && <div>Phase: <span className="text-foreground">{sync.progress.phase}</span></div>}
          {sync.progress.usda_page && <div>USDA: <span className="text-foreground">{sync.progress.usda_page}/{sync.progress.usda_total ?? '?'}</span></div>}
          {sync.progress.on_status && <div>OpenNutrition: <span className="text-foreground">{sync.progress.on_status}</span></div>}
        </div>
      )}

      {/* Errors */}
      {(sync?.error || trigErr) && (
        <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-1.5">
          {trigErr || sync.error}
        </p>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminFoodLibrary() {
  const [query,        setQuery]        = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [foods,        setFoods]        = useState([])
  const [totalCount,   setTotalCount]   = useState(0)
  const [page,         setPage]         = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [stats,        setStats]        = useState({})

  // Panel state: null | { mode: 'add' } | { mode: 'edit', food } | { mode: 'delete', food }
  const [panel,   setPanel]   = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(false)
  const [error,   setError]   = useState('')

  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    fetch(`${FOOD_WORKER_URL}/stats`)
      .then(r => r.ok ? r.json() : {})
      .then(setStats)
      .catch(() => {})
  }, [])

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchFoods = useCallback(async (q, src, pg) => {
    setLoading(true)
    setError('')

    const trimmed = q.trim()

    // ── USDA or ON only: query Cloudflare Worker (D1) ───────────────────────
    if (src === 'usda' || src === 'on') {
      if (!trimmed) {
        setFoods([])
        setTotalCount(0)
        setLoading(false)
        return
      }
      try {
        const res  = await fetch(`${FOOD_WORKER_URL}/search?q=${encodeURIComponent(trimmed)}&source=${src}&limit=${PAGE_SIZE}`)
        const data = res.ok ? await res.json() : []
        setFoods((data ?? []).map(r => ({ ...r, id: r.source_id })))
        setTotalCount(data?.length ?? 0)
      } catch {
        setError('Failed to reach food search service.')
      }
      setLoading(false)
      return
    }

    // ── MYRX only: Worker search ────────────────────────────────────────────
    if (src === 'myrx') {
      if (!trimmed) {
        setFoods([]); setTotalCount(0); setLoading(false); return
      }
      try {
        const res  = await fetch(`${FOOD_WORKER_URL}/search?q=${encodeURIComponent(trimmed)}&source=myrx&limit=${PAGE_SIZE}`)
        const data = res.ok ? await res.json() : []
        setFoods((data ?? []).map(r => ({ ...r, id: r.source_id })))
        setTotalCount(data?.length ?? 0)
      } catch {
        setFoods([]); setTotalCount(0); setError('Failed to load MYRX foods.')
      }
      setLoading(false)
      return
    }

    // ── All sources: everything is in D1, just query the Worker ────────────
    if (!trimmed) {
      setFoods([])
      setTotalCount(0)
      setLoading(false)
      return
    }
    try {
      const res  = await fetch(`${FOOD_WORKER_URL}/search?q=${encodeURIComponent(trimmed)}&limit=${PAGE_SIZE}`)
      const data = res.ok ? await res.json() : []
      setFoods((data ?? []).map(r => ({ ...r, id: r.source_id })))
      setTotalCount(data?.length ?? 0)
    } catch {
      setError('Failed to reach food search service.')
    }
    setLoading(false)
  }, [])

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      fetchFoods(query, sourceFilter, 0)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, sourceFilter, fetchFoods])

  useEffect(() => {
    fetchFoods(query, sourceFilter, page)
  }, [page]) // eslint-disable-line

  // ── Add ────────────────────────────────────────────────────────────────────

  async function handleAdd(data) {
    setSaving(true)
    try {
      const res = await workerFetch('/food', { method: 'POST', body: JSON.stringify(data) })
      const body = await res.json()
      if (!res.ok) { setError(`Save failed: ${body.error ?? res.status}`); return }
      setPanel(null)
      setPage(0)
      fetchFoods(query, sourceFilter, 0)
    } catch (e) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  async function handleEdit(data) {
    setSaving(true)
    try {
      const res = await workerFetch(`/food/${encodeURIComponent(panel.food.source_id ?? panel.food.id)}`,
        { method: 'PUT', body: JSON.stringify(data) })
      const body = await res.json()
      if (!res.ok) { setError(`Save failed: ${body.error ?? res.status}`); return }
      setPanel(null)
      fetchFoods(query, sourceFilter, page)
    } catch (e) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await workerFetch(`/food/${encodeURIComponent(panel.food.source_id ?? panel.food.id)}`,
        { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}))
        setError(`Delete failed: ${body.error ?? res.status}`)
        return
      }
      setPanel(null)
      if (foods.length === 1 && page > 0) setPage(p => p - 1)
      else fetchFoods(query, sourceFilter, page)
    } catch (e) {
      setError(`Delete failed: ${e.message}`)
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Food Library</h1>
          <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span><span className="text-sky-400 font-medium">{(stats.usda ?? 0).toLocaleString()}</span> USDA</span>
            <span><span className="text-violet-400 font-medium">{(stats.on ?? 0).toLocaleString()}</span> OpenNutrition</span>
            <span><span className="text-emerald-400 font-medium">{(stats.myrx ?? 0).toLocaleString()}</span> MYRX</span>
          </div>
        </div>
        <button
          onClick={() => setPanel({ mode: 'add' })}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          <Plus className="h-4 w-4" /> Add food
        </button>
      </div>

      {/* Sync panel */}
      <SyncPanel onRefreshStats={() =>
        fetch(`${FOOD_WORKER_URL}/stats`).then(r => r.ok ? r.json() : {}).then(setStats).catch(() => {})
      } />

      {/* Add / Edit / Delete panel */}
      {panel && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {panel.mode === 'add'    ? 'Add custom food'
               : panel.mode === 'edit' ? `Edit — ${panel.food.name}`
               : 'Confirm deletion'}
            </h2>
            <button onClick={() => setPanel(null)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {panel.mode === 'delete' ? (
            <DeleteConfirm food={panel.food} onConfirm={handleDelete} onCancel={() => setPanel(null)} deleting={deleting} />
          ) : (
            <FoodForm
              isEdit={panel.mode === 'edit'}
              foodId={panel.mode === 'edit' ? (panel.food.source_id ?? panel.food.id) : null}
              initial={panel.mode === 'edit' ? {
                name:                   panel.food.name  ?? '',
                brand:                  panel.food.brand ?? '',
                upc:                    panel.food.upc   ?? '',
                kcal:                   panel.food.kcal                   ?? '',
                protein_g:              panel.food.protein_g              ?? '',
                fat_g:                  panel.food.fat_g                  ?? '',
                carbs_g:                panel.food.carbs_g                ?? '',
                fiber_g:                panel.food.fiber_g                ?? '',
                sodium_mg:              panel.food.sodium_mg              ?? '',
                serving_g:              panel.food.serving_g              ?? '',
                serving_label:          panel.food.serving_label          ?? '',
                servings_per_container: panel.food.servings_per_container ?? '',
              } : {}}
              onSave={panel.mode === 'add' ? handleAdd : handleEdit}
              onCancel={() => setPanel(null)}
              saving={saving}
            />
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>
        <div className="flex gap-1.5">
          {SOURCE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setSourceFilter(f.value); setPage(0) }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                sourceFilter === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:flex items-center gap-3 px-5 py-2.5 border-b border-border bg-muted/30">
          <span className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</span>
          <div className="flex items-center gap-4 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="w-14 text-right">kcal</span>
            <span className="w-12 text-right">Protein</span>
            <span className="w-12 text-right">Fat</span>
            <span className="w-12 text-right">Carbs</span>
            <span className="w-16 text-right">Serving</span>
          </div>
          <span className="w-16 shrink-0" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : foods.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {query ? `No foods matching "${query}"` : 'Type a search term to find foods'}
          </div>
        ) : (
          foods.map(food => (
            <FoodRow
              key={food.id}
              food={food}
              onEdit={f  => setPanel({ mode: 'edit',   food: f })}
              onDelete={f => setPanel({ mode: 'delete', food: f })}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page + 1} of {totalPages.toLocaleString()} ({totalCount.toLocaleString()} foods)</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-accent transition-colors"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
