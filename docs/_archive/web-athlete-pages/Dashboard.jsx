import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getEffortTags, TAG_STYLES } from '../lib/effortTags'
import { Dumbbell, Activity, Weight, ArrowRight, User, Pencil, Flower2, Flame } from 'lucide-react'
import TickerNumber from '../components/TickerNumber'
import { dataCache } from '../lib/cache'
import SwipeDelete from '../components/SwipeDelete'

function getGreeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

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

// ── Streak helpers ─────────────────────────────────────────────────────────────

function getWeekKey(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay() === 0 ? 7 : d.getDay() // Mon=1 … Sun=7
  d.setDate(d.getDate() - (day - 1))             // rewind to Monday
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function computeWeekStreak(dates) {
  if (!dates || dates.length === 0) return 0
  const weekSet = new Set(dates.map(d => getWeekKey(d)))
  const now = new Date()
  const thisWeek = getWeekKey(now.toISOString())
  // Grace: if current week has no efforts yet, start counting from last week
  // so the streak doesn't break just because it's Monday and they haven't logged yet.
  let check = new Date(now)
  if (!weekSet.has(thisWeek)) check.setDate(check.getDate() - 7)
  let streak = 0
  while (true) {
    const key = getWeekKey(check.toISOString())
    if (weekSet.has(key)) { streak++; check.setDate(check.getDate() - 7) }
    else break
  }
  return streak
}

// ── Monthly PR helpers ─────────────────────────────────────────────────────────

function parseEffort1RM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

function computeMonthlyPRs(allStrengthEfforts, allRomRecords) {
  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth()
  const isThisMonth = ds => {
    const d = new Date(ds)
    return d.getFullYear() === y && d.getMonth() === mo
  }
  let count = 0

  // Strength: per exercise, is the all-time best 1RM set this month?
  const byEx = {}
  allStrengthEfforts.forEach(e => {
    const rm = parseEffort1RM(e.value)
    if (!rm) return
    const ex = e.label?.split(' · ')[0]
    if (!ex) return
    if (!byEx[ex]) byEx[ex] = []
    byEx[ex].push({ rm, date: e.created_at })
  })
  Object.values(byEx).forEach(arr => {
    const best = arr.reduce((b, e) => e.rm > b.rm ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })

  // Mobility: per movement, is the all-time best degrees set this month?
  const byMov = {}
  allRomRecords.forEach(r => {
    if (!byMov[r.movement_key]) byMov[r.movement_key] = []
    byMov[r.movement_key].push({ deg: r.degrees, date: r.created_at })
  })
  Object.values(byMov).forEach(arr => {
    const best = arr.reduce((b, e) => e.deg > b.deg ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })

  return count
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

  const cacheKey = user ? `dashboard:${user.id}` : null
  const cached   = cacheKey ? dataCache.get(cacheKey) : null

  const [recentEfforts, setRecentEfforts]   = useState(cached?.efforts   ?? [])
  const [recentROM, setRecentROM]           = useState(cached?.rom       ?? [])
  const [recentBW, setRecentBW]             = useState(cached?.bw        ?? [])
  const [recentCalories, setRecentCalories] = useState(cached?.calories  ?? [])
  const [totalEfforts, setTotalEfforts]     = useState(cached?.total     ?? null)
  const [trainingStreak, setTrainingStreak] = useState(cached?.streak    ?? null)
  const [monthlyPRs,     setMonthlyPRs]     = useState(cached?.prs       ?? null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('efforts').select('*', { count: 'exact', head: false }).eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('rom_records').select('id, movement_key, degrees, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('bodyweight').select('id, weight, unit, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('calorie_logs').select('id, log_date, calories').eq('user_id', user.id).order('log_date', { ascending: false }).limit(5),
      // All effort dates + labels for streak + monthly PR computation
      supabase.from('efforts').select('created_at, label, value, type').eq('user_id', user.id),
      // All ROM records for monthly mobility PR computation
      supabase.from('rom_records').select('movement_key, degrees, created_at').eq('user_id', user.id),
    ]).then(([efRes, romRes, bwRes, calRes, allEffRes, allRomRes]) => {
      const efforts  = efRes.data  || []
      const total    = efRes.count ?? efforts.length
      const rom      = romRes.data || []
      const bw       = bwRes.data  || []
      const calories = (calRes.data || []).map(r => ({ ...r, created_at: r.log_date + 'T12:00:00' }))
      const allEff   = allEffRes.data || []
      const allRom   = allRomRes.data || []

      const streak = computeWeekStreak(allEff.map(e => e.created_at))
      const prs    = computeMonthlyPRs(allEff.filter(e => e.type === 'strength'), allRom)

      setRecentEfforts(efforts)
      setTotalEfforts(total)
      setRecentROM(rom)
      setRecentBW(bw)
      setRecentCalories(calories)
      setTrainingStreak(streak)
      setMonthlyPRs(prs)

      if (cacheKey) dataCache.set(cacheKey, { efforts, total, rom, bw, calories, streak, prs })
    })
  }, [user])

  async function handleDelete(item) {
    const table = item._kind === 'rom'     ? 'rom_records'
                : item._kind === 'weighin' ? 'bodyweight'
                : item._kind === 'calorie' ? 'calorie_logs'
                : 'efforts'
    if (item._kind === 'rom')         setRecentROM(prev => prev.filter(r => r.id !== item.id))
    else if (item._kind === 'weighin') setRecentBW(prev => prev.filter(b => b.id !== item.id))
    else if (item._kind === 'calorie') setRecentCalories(prev => prev.filter(c => c.id !== item.id))
    else setRecentEfforts(prev => prev.filter(e => e.id !== item.id))
    await supabase.from(table).delete().eq('id', item.id).eq('user_id', user.id)
  }

  // Merge efforts + ROM + bodyweight + calorie logs, sorted newest first, capped at 5
  const allActivity = [
    ...recentEfforts.map(e => ({ ...e, _kind: 'effort' })),
    ...recentROM.map(r => ({ ...r, _kind: 'rom' })),
    ...recentBW.map(b => ({ ...b, _kind: 'weighin' })),
    ...recentCalories.map(c => ({ ...c, _kind: 'calorie' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)

  const ROM_META = {
    'shoulder-flexion':   { label: 'Shoulder Flexion',   group: 'Shoulder' },
    'shoulder-extension': { label: 'Shoulder Extension', group: 'Shoulder' },
    'shoulder-abduction': { label: 'Shoulder Abduction', group: 'Shoulder' },
    'hip-flexion':        { label: 'Hip Flexion',         group: 'Hip'      },
    'hip-abduction':      { label: 'Hip Abduction',       group: 'Hip'      },
    'knee-flexion':       { label: 'Knee Flexion',        group: 'Knee'     },
    'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', group: 'Ankle'    },
    'spinal-flexion':     { label: 'Spinal Flexion',      group: 'Spine'    },
  }

  const age = calcAge(profile?.birthdate)
  const gender = formatGender(profile?.gender)
  const memberSince = formatMemberSince(user?.created_at)
  const avatarUrl = profile?.avatar_url || null

  // Current weight: use profile value (set explicitly by user in Edit Profile)
  const displayWeight = profile?.current_weight
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

        {/* Greeting — same size as name, far-left, above avatar */}
        <p className="text-xl font-semibold tracking-tight mb-4 pr-9">
          {getGreeting()},
        </p>

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

          {/* Name + details */}
          <div className="min-w-0 flex-1">
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

        {/* Stats — streak · PRs this month · member since */}
        <div className="mt-5 flex flex-wrap gap-1.5 border-t border-border pt-4">
          {trainingStreak != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-400 whitespace-nowrap">
              🗓️ <span className="font-bold tabular-nums"><TickerNumber value={trainingStreak} /></span> wk streak
            </span>
          )}
          {monthlyPRs != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400 whitespace-nowrap">
              🏆 <span className="font-bold tabular-nums"><TickerNumber value={monthlyPRs} /></span> PR{monthlyPRs !== 1 ? 's' : ''} this month
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
            📅 since {memberSince}
          </span>
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

        {allActivity.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            <Link href="/strength">
              <button className="mt-3 text-sm font-medium text-primary hover:underline">
                Log your first lift →
              </button>
            </Link>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {allActivity.map(item => {
              if (item._kind === 'calorie') {
                return (
                  <SwipeDelete key={`cal-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border" bg="bg-background">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400"><Flame className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">Intake · {item.calories} kcal</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.calories}`}>Calories</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES['Intake']}`}>Intake</span>
                          <span className="text-[11px] text-muted-foreground">{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </SwipeDelete>
                )
              }
              if (item._kind === 'rom') {
                const meta = ROM_META[item.movement_key]
                return (
                  <SwipeDelete key={`rom-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border" bg="bg-background">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-400"><Flower2 className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{meta?.label ?? item.movement_key} · {item.degrees}° ROM</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.mobility}`}>Mobility</span>
                          {meta?.group && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES[meta.group] ?? TAG_STYLES.Movement}`}>{meta.group}</span>}
                          <span className="text-[11px] text-muted-foreground">{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </SwipeDelete>
                )
              }
              if (item._kind === 'weighin') {
                return (
                  <SwipeDelete key={`bw-${item.id}`} onDelete={() => handleDelete(item)} className="rounded-xl border border-border" bg="bg-background">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400"><Weight className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">Weigh-in · {item.weight} {item.unit}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES.weighin}`}>Bodyweight</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES['Weigh-in']}`}>Weigh-in</span>
                          <span className="text-[11px] text-muted-foreground">{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </SwipeDelete>
                )
              }
              const { primary, secondary } = getEffortTags(item)
              return (
                <SwipeDelete key={item.id} onDelete={() => handleDelete(item)} className="rounded-xl border border-border" bg="bg-background">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.type === 'strength' ? 'bg-blue-500/10 text-blue-400' : item.type === 'cardio' ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'}`}>
                      {item.type === 'strength' ? <Dumbbell className="h-3.5 w-3.5" /> : item.type === 'cardio' ? <Activity className="h-3.5 w-3.5" /> : <Weight className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.label}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${primary.cls}`}>{primary.label}</span>
                        {secondary && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${secondary.cls}`}>{secondary.label}</span>}
                        <span className="text-[11px] text-muted-foreground">{formatDate(item.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </SwipeDelete>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
