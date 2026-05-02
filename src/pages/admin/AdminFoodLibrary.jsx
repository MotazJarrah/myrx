import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, Plus, Pencil, Trash2, Check, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const FOOD_WORKER_URL = 'https://myrx-food-search.motaz-jarrah.workers.dev'

const SOURCE_FILTERS = [
  { value: '',     label: 'All'  },
  { value: 'usda', label: 'USDA' },
  { value: 'myrx', label: 'Custom' },
]

const SOURCE_BADGE = {
  usda: 'bg-sky-500/15 text-sky-400',
  myrx: 'bg-emerald-500/15 text-emerald-400',
}

const EMPTY_FORM = {
  name: '', brand: '',
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

function FoodForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial })
  const set = useCallback((k, v) => setForm(p => ({ ...p, [k]: v })), [])

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({
      name:                   form.name.trim(),
      brand:                  form.brand.trim() || null,
      kcal:                   numOrNull(form.kcal),
      protein_g:              numOrNull(form.protein_g),
      fat_g:                  numOrNull(form.fat_g),
      carbs_g:                numOrNull(form.carbs_g),
      fiber_g:                numOrNull(form.fiber_g),
      sodium_mg:              numOrNull(form.sodium_mg),
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
          <label className={labelCls}>Serving label</label>
          <input value={form.serving_label} onChange={e => set('serving_label', e.target.value)}
            placeholder="e.g. 1 cup" className={inputCls} />
        </div>
      </div>

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nutrients (per 100 g)</p>
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Serving size (g)</label>
          <input type="number" step="0.1" value={form.serving_g}
            onChange={e => set('serving_g', e.target.value)}
            placeholder="e.g. 170" className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Servings per container</label>
          <input type="number" step="0.5" value={form.servings_per_container}
            onChange={e => set('servings_per_container', e.target.value)}
            placeholder="e.g. 4" className={inputCls} />
        </div>
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
        <button onClick={() => onEdit(food)}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onDelete(food)}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
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

  // Panel state: null | { mode: 'add' } | { mode: 'edit', food } | { mode: 'delete', food }
  const [panel,   setPanel]   = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(false)
  const [error,   setError]   = useState('')

  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchFoods = useCallback(async (q, src, pg) => {
    setLoading(true)
    setError('')

    const trimmed = q.trim()

    // ── USDA-only: query Cloudflare Worker (D1) ─────────────────────────────
    if (src === 'usda') {
      if (!trimmed) {
        setFoods([])
        setTotalCount(0)
        setLoading(false)
        return
      }
      try {
        const res  = await fetch(`${FOOD_WORKER_URL}/search?q=${encodeURIComponent(trimmed)}&limit=${PAGE_SIZE}`)
        const data = res.ok ? await res.json() : []
        setFoods((data ?? []).map(r => ({ ...r, id: r.source_id, source: 'usda' })))
        setTotalCount(data?.length ?? 0)
      } catch {
        setError('Failed to reach food search service.')
      }
      setLoading(false)
      return
    }

    // ── Custom (myrx) only: Supabase paginated ──────────────────────────────
    if (src === 'myrx') {
      const from = pg * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1
      let countQ = supabase.from('food_library').select('*', { count: 'exact', head: true }).eq('source', 'myrx')
      let dataQ  = supabase.from('food_library')
        .select('id, source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg, serving_g, serving_label, servings_per_container')
        .eq('source', 'myrx').order('name').range(from, to)
      if (trimmed) {
        const pat = '%' + trimmed.replace(/\s+/g, '%') + '%'
        countQ = countQ.ilike('name', pat)
        dataQ  = dataQ.ilike('name', pat)
      }
      const [{ count }, { data, error: err }] = await Promise.all([countQ, dataQ])
      setLoading(false)
      if (err) { setError('Failed to load custom foods.'); return }
      setFoods(data ?? [])
      setTotalCount(count ?? 0)
      return
    }

    // ── All sources: myrx from Supabase + USDA from Worker (when searching) ─
    const myrxQ = supabase.from('food_library')
      .select('id, source, source_id, name, brand, kcal, protein_g, fat_g, carbs_g, fiber_g, sodium_mg, serving_g, serving_label, servings_per_container')
      .eq('source', 'myrx').order('name').limit(PAGE_SIZE)
    if (trimmed) myrxQ.ilike('name', '%' + trimmed.replace(/\s+/g, '%') + '%')

    const workerPromise = trimmed
      ? fetch(`${FOOD_WORKER_URL}/search?q=${encodeURIComponent(trimmed)}&limit=${PAGE_SIZE}`)
          .then(r => r.ok ? r.json() : [])
          .then(data => (data ?? []).map(r => ({ ...r, id: r.source_id, source: 'usda' })))
          .catch(() => [])
      : Promise.resolve([])

    const [{ data: myrxData }, workerData] = await Promise.all([myrxQ, workerPromise])

    const seen = new Set()
    const merged = []
    for (const r of [...(myrxData ?? []), ...workerData]) {
      const key = `${r.name?.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
      if (!seen.has(key)) { seen.add(key); merged.push(r) }
    }

    setLoading(false)
    setFoods(merged.slice(0, PAGE_SIZE * 2))
    setTotalCount(merged.length)
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
    const { error: err } = await supabase.from('food_library').insert({ ...data, source: 'myrx' })
    setSaving(false)
    if (err) { setError(`Save failed: ${err.message}`); return }
    setPanel(null)
    setPage(0)
    fetchFoods(query, sourceFilter, 0)
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  async function handleEdit(data) {
    setSaving(true)
    const { error: err } = await supabase.from('food_library').update(data).eq('id', panel.food.id)
    setSaving(false)
    if (err) { setError(`Save failed: ${err.message}`); return }
    setPanel(null)
    fetchFoods(query, sourceFilter, page)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true)
    const { error: err } = await supabase.from('food_library').delete().eq('id', panel.food.id)
    setDeleting(false)
    if (err) { setError(`Delete failed: ${err.message}`); return }
    setPanel(null)
    if (foods.length === 1 && page > 0) setPage(p => p - 1)
    else fetchFoods(query, sourceFilter, page)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Food Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="text-sky-400">2M+ USDA foods</span> via Cloudflare D1 ·
            <span className="text-emerald-400"> Custom</span> foods in Supabase
          </p>
        </div>
        <button
          onClick={() => setPanel({ mode: 'add' })}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> Add food
        </button>
      </div>

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
              initial={panel.mode === 'edit' ? {
                name:                   panel.food.name  ?? '',
                brand:                  panel.food.brand ?? '',
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
            {sourceFilter === 'usda' && !query
              ? 'Type a search term to browse USDA foods'
              : query ? `No foods matching "${query}"` : 'No custom foods yet — add one above'}
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
