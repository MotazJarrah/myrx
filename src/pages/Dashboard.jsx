import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getEffortTags } from '../lib/effortTags'
import { Dumbbell, Activity, Weight, ArrowRight, User, Pencil } from 'lucide-react'

function calcAge(birthdate) {
  if (!birthdate) return null
  const today = new Date()
  const birth = new Date(birthdate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function formatGender(g) {
  if (!g) return null
  const map = {
    male: 'Male', female: 'Female',
    'non-binary': 'Non-binary', 'prefer-not-to-say': 'Prefer not to say',
  }
  return map[g] ?? g
}

function formatDate(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMemberSince(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatHeight(height, unit) {
  if (!height) return null
  if (unit === 'imperial') {
    const total = Math.round(height)
    const ft = Math.floor(total / 12)
    const inches = total % 12
    return `${ft}'${inches}"`
  }
  return `${height} cm`
}

export default function Dashboard() {
  const { user, profile } = useAuth()
  const [recentEfforts, setRecentEfforts] = useState([])
  const [totalEfforts, setTotalEfforts] = useState(null)
  const [latestBW, setLatestBW] = useState(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('efforts')
      .select('*', { count: 'exact', head: false })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data, count }) => {
        setRecentEfforts(data || [])
        setTotalEfforts(count ?? (data?.length ?? 0))
      })
    // Latest bodyweight log
    supabase
      .from('bodyweight')
      .select('weight, unit, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.[0]) setLatestBW(data[0]) })
  }, [user])

  const age = calcAge(profile?.birthdate)
  const gender = formatGender(profile?.gender)
  const memberSince = formatMemberSince(user?.created_at)
  const avatarUrl = profile?.avatar_url || null

  // Current weight: latest BW log takes priority over profile value
  const displayWeight = latestBW
    ? `${latestBW.weight} ${latestBW.unit}`
    : profile?.current_weight
      ? `${profile.current_weight} ${profile.weight_unit || 'lb'}`
      : null

  const displayHeight = formatHeight(profile?.current_height, profile?.height_unit || 'imperial')

  const detailChips = [gender, age != null ? `${age} yrs` : null, profile?.phone || null].filter(Boolean)
  const bodyChips = [displayWeight, displayHeight].filter(Boolean)

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* ── Profile card ── */}
      <div className="animate-rise relative rounded-2xl border border-border bg-card p-6" style={{ animationDelay: '0ms' }}>

        {/* Edit icon — top-right corner of card */}
        <Link href="/profile">
          <button
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            aria-label="Edit profile"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </Link>

        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={profile?.full_name} className="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 ring-2 ring-border">
                <User className="h-9 w-9 text-primary" />
              </div>
            )}
          </div>

          {/* Name + details — full width, no competition */}
          <div className="min-w-0 flex-1 pr-6">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {profile?.full_name || user?.email?.split('@')[0] || 'Athlete'}
            </h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{user?.email}</p>
            {detailChips.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {detailChips.map(chip => (
                  <span key={chip} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground">
                    {chip}
                  </span>
                ))}
              </div>
            )}
            {bodyChips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {bodyChips.map(chip => (
                  <span key={chip} className="rounded-full border border-primary/30 bg-primary/8 px-2.5 py-0.5 text-[11px] font-mono tabular-nums text-primary">
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats — single line */}
        <div className="mt-5 flex items-center gap-1.5 border-t border-border pt-4 text-sm">
          <span className="font-bold tabular-nums text-foreground">{totalEfforts ?? '—'}</span>
          <span className="text-muted-foreground">efforts</span>
          <span className="mx-2 select-none text-border">·</span>
          <span className="text-muted-foreground">member since</span>
          <span className="font-semibold text-foreground">{memberSince}</span>
        </div>
      </div>

      {/* ── Recent activity ── */}
      <div className="animate-rise rounded-2xl border border-border bg-card" style={{ animationDelay: '240ms' }}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <Link href="/history">
            <button className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>

        {recentEfforts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">No efforts logged yet.</p>
            <Link href="/strength">
              <button className="mt-3 text-sm font-medium text-primary hover:underline">
                Log your first lift →
              </button>
            </Link>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {recentEfforts.map(e => {
              const { primary, secondary } = getEffortTags(e)
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    e.type === 'strength' ? 'bg-blue-500/10 text-blue-400'
                    : e.type === 'cardio' ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-primary/10 text-primary'
                  }`}>
                    {e.type === 'strength' ? <Dumbbell className="h-3.5 w-3.5" />
                      : e.type === 'cardio' ? <Activity className="h-3.5 w-3.5" />
                      : <Weight className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.label}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${primary.cls}`}>
                        {primary.label}
                      </span>
                      {secondary && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${secondary.cls}`}>
                          {secondary.label}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(e.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
