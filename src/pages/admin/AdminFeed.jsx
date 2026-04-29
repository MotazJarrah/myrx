import { useState, useEffect, useMemo } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import { Dumbbell, Weight, Flame, Flower2, Activity, Filter } from 'lucide-react'
import { dataCache } from '../../lib/cache'

function formatDate(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  // Negative diff = timestamp is in the future (timezone/clock skew) — show actual date
  if (isNaN(diff) || diff < 0) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const KIND_META = {
  strength: { label: 'Strength',   icon: Dumbbell,  iconCls: 'bg-blue-500/10 text-blue-400',    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  cardio:   { label: 'Cardio',     icon: Activity,  iconCls: 'bg-amber-500/10 text-amber-400',   chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  weighin:  { label: 'Weigh-in',   icon: Weight,    iconCls: 'bg-emerald-500/10 text-emerald-400', chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  calorie:  { label: 'Calories',   icon: Flame,     iconCls: 'bg-red-500/10 text-red-400',       chip: 'bg-red-500/10 text-red-400 border-red-500/20' },
  rom:      { label: 'Mobility',   icon: Flower2,   iconCls: 'bg-fuchsia-500/10 text-fuchsia-400', chip: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20' },
}

function itemKind(item) {
  if (item._kind === 'effort')  return item.type === 'strength' ? 'strength' : 'cardio'
  return item._kind
}

function fmtMovement(key) {
  if (!key) return '—'
  return key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function itemLabel(item) {
  if (item._kind === 'effort')  return item.label
  if (item._kind === 'weighin') return `Weigh-in · ${item.weight} ${item.unit}`
  if (item._kind === 'calorie') return `Intake · ${item.calories} kcal`
  if (item._kind === 'rom')     return `${fmtMovement(item.movement_key)} · ${item.degrees}°`
  return '—'
}

function tabForItem(item) {
  if (item._kind === 'effort')  return 'activity'
  if (item._kind === 'rom')     return 'activity'
  if (item._kind === 'weighin') return 'body'
  if (item._kind === 'calorie') return 'calories'
  return 'profile'
}

const ALL_KINDS = ['strength', 'cardio', 'weighin', 'calorie', 'rom']
const LIMIT_PER_TABLE = 150
const TWO_MONTHS_AGO = new Date(Date.now() - 61 * 86_400_000).toISOString()
const TWO_MONTHS_DATE = TWO_MONTHS_AGO.split('T')[0]

const FEED_KEY = 'admin-feed'

export default function AdminFeed() {
  const cached = dataCache.get(FEED_KEY)

  const [items,   setItems]   = useState(cached ?? [])
  const [loading, setLoading] = useState(!cached)
  const [filter,  setFilter]  = useState('all') // 'all' | kind

  useEffect(() => {
    async function load() {
      const [usersRes, effortsRes, bwRes, logsRes, romRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('efforts').select('id, user_id, label, type, created_at')
          .gte('created_at', TWO_MONTHS_AGO)
          .order('created_at', { ascending: false })
          .limit(LIMIT_PER_TABLE),
        supabase.from('bodyweight').select('id, user_id, weight, unit, created_at')
          .gte('created_at', TWO_MONTHS_AGO)
          .order('created_at', { ascending: false })
          .limit(LIMIT_PER_TABLE),
        supabase.from('calorie_logs').select('id, user_id, log_date, calories')
          .gte('log_date', TWO_MONTHS_DATE)
          .order('log_date', { ascending: false })
          .limit(LIMIT_PER_TABLE),
        supabase.from('rom_records').select('id, user_id, movement_key, degrees, created_at')
          .gte('created_at', TWO_MONTHS_AGO)
          .order('created_at', { ascending: false })
          .limit(LIMIT_PER_TABLE),
      ])

      const profileMap = {}
      ;(usersRes.data || []).forEach(u => { profileMap[u.id] = u })

      const merged = [
        ...(effortsRes.data || []).map(e => ({ ...e, _kind: 'effort', _ts: e.created_at })),
        ...(bwRes.data      || []).map(b => ({ ...b, _kind: 'weighin', _ts: b.created_at })),
        // Calorie logs are date-only — use midnight UTC so they are always in the past
        // and sort correctly. Never use noon or local time which can be a future timestamp.
        ...(logsRes.data    || []).map(c => ({ ...c, _kind: 'calorie', _ts: c.log_date + 'T00:00:00.000Z' })),
        ...(romRes.data     || []).map(r => ({ ...r, _kind: 'rom', _ts: r.created_at })),
      ]
        .sort((a, b) => new Date(b._ts) - new Date(a._ts))
        .map(item => ({ ...item, _profile: profileMap[item.user_id] }))

      setItems(merged)
      setLoading(false)
      dataCache.set(FEED_KEY, merged)
    }
    load()
  }, [])

  const visible = useMemo(() => {
    if (filter === 'all') return items
    return items.filter(item => itemKind(item) === filter)
  }, [items, filter])

  // Count per kind for filter buttons
  const counts = useMemo(() => {
    const c = {}
    ALL_KINDS.forEach(k => { c[k] = items.filter(i => itemKind(i) === k).length })
    return c
  }, [items])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Feed</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">All client activity — last 2 months.</p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          All ({items.length})
        </button>
        {ALL_KINDS.filter(k => counts[k] > 0).map(k => {
          const meta = KIND_META[k]
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === k
                  ? `${meta.chip} border`
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {meta.label} ({counts[k]})
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading feed…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          No activity found.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {visible.map((item, i) => {
              const kind = itemKind(item)
              const meta = KIND_META[kind]
              const Icon = meta.icon
              return (
                <Link key={i} href={`/admin/user/${item.user_id}?tab=${tabForItem(item)}`}>
                  <a className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.iconCls}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{itemLabel(item)}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${meta.chip}`}>
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {item._profile?.full_name || item._profile?.email || 'Unknown client'}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">·</span>
                        <span className="text-[11px] text-muted-foreground">{formatDate(item._ts)}</span>
                      </div>
                    </div>
                  </a>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
