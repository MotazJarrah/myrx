/**
 * AthleteCoachingChip — admin's interactive 3-state coach-management
 * switcher + B2C tier picker for the AdminUserDetail page header.
 *
 * Replaces the legacy Self-managed / Coach-managed toggle. Three states:
 *
 *   Self-managed   (grey)   → coach_id IS NULL,           is_self_coached=true
 *   Coach-managed  (lime)   → coach_id = <real coach>,    is_self_coached=false
 *   Admin-managed  (lime)   → coach_id = admin's user_id, is_self_coached=false
 *
 * The chip itself is the only switcher. Click it → small dropdown listing
 * the three options. Pick a different one:
 *
 *   - Switching TO Coach-managed → opens an email/name search picker.
 *   - Switching FROM Coach-managed → destructive SWITCH-typed dialog
 *     (matches the existing AdminUserDetail delete flow) naming the
 *     coach that will be displaced. Coach loses the athlete from their
 *     roster as soon as the swap commits.
 *   - Any other transition (Self↔Admin) → single tap confirms; no
 *     destructive gate needed.
 *
 * The chip is HIDDEN entirely on coach + admin profiles — those accounts
 * never have an admin-set coaching relationship.
 *
 * Tier picker (Free / CoreRX / FullRX) sits to the LEFT of the chip and
 * is independent — writes b2c_subscription_tier on the athlete's profile.
 * Editable in every state; tier only "kicks in" when the athlete is
 * self-managed, but admin can set it proactively for future use.
 *
 * All writes route through the admin_set_athlete_coaching RPC which
 * atomically updates coach_id + is_self_coached + b2c_subscription_tier
 * and emits an activity_events row of type coach:assigned / coach:detached
 * / coach:swapped. The RPC + admin_search_coaches RPC ship with migration
 * `admin_athlete_coaching_chip_v1` (May 29 2026).
 *
 * Athlete-side: a trigger on profiles.coach_id clears
 * coach_change_acknowledged_at automatically, so the CoachChangeBanner
 * fires on the athlete's dashboard within seconds of the swap via the
 * realtime profile sub.
 */

import { useState, useEffect, useRef } from 'react'
import {
  UserCog, ChevronDown, Search, X, AlertTriangle, Check, Loader2,
  UserX, UserCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

// ── State resolver ──────────────────────────────────────────────────
function resolveCoachState(profile, adminUserId) {
  if (!profile.coach_id) return 'self'
  if (profile.coach_id === adminUserId) return 'admin'
  return 'coach'
}

const STATE_META = {
  self: {
    label: 'Self-managed',
    classes: 'border-border text-muted-foreground hover:border-border hover:text-muted-foreground',
    icon: UserX,
  },
  coach: {
    label: 'Coach-managed',
    classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20',
    icon: UserCog,
  },
  admin: {
    label: 'Admin-managed',
    classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20',
    icon: UserCheck,
  },
}

const TIER_META = [
  { key: 'free',   label: 'Free' },
  { key: 'corerx', label: 'CoreRX' },
  { key: 'fullrx', label: 'FullRX' },
]

// ── Main component ─────────────────────────────────────────────────
export default function AthleteCoachingChip({
  athleteProfile,
  adminUserId,
  onProfileUpdated,
}) {
  // Hide entirely on coach + admin profiles
  if (athleteProfile?.is_coach || athleteProfile?.is_superuser) return null
  // Anonymized accounts have nothing to manage
  if (athleteProfile?.anonymized_at) return null

  const currentState = resolveCoachState(athleteProfile, adminUserId)
  const currentTier  = athleteProfile?.b2c_subscription_tier || 'free'

  // ── UI state ────────────────────────────────────────────────────
  const [chipOpen,         setChipOpen]         = useState(false)
  const [tierOpen,         setTierOpen]         = useState(false)
  const [searchOpen,       setSearchOpen]       = useState(false)
  const [switchOpen,       setSwitchOpen]       = useState(false)
  const [busy,             setBusy]             = useState(false)
  const [error,            setError]            = useState('')

  // For the destructive SWITCH dialog
  const [pendingState,     setPendingState]     = useState(null) // 'self' | 'admin'
  const [pendingCoach,     setPendingCoach]     = useState(null) // {id, full_name, email} when going B→B'
  const [switchText,       setSwitchText]       = useState('')

  // For the coach search picker
  const [searchQuery,      setSearchQuery]      = useState('')
  const [searchResults,    setSearchResults]    = useState([])
  const [searchLoading,    setSearchLoading]    = useState(false)
  const searchDebounceRef = useRef(null)

  // ── Close dropdowns on outside click ────────────────────────────
  const chipRef = useRef(null)
  const tierRef = useRef(null)
  useEffect(() => {
    function onDocClick(e) {
      if (chipRef.current && !chipRef.current.contains(e.target)) setChipOpen(false)
      if (tierRef.current && !tierRef.current.contains(e.target)) setTierOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // ── Coach search effect ─────────────────────────────────────────
  useEffect(() => {
    if (!searchOpen) return
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true)
      const { data, error: rpcErr } = await supabase.rpc('admin_search_coaches', {
        p_query: searchQuery || null,
      })
      if (!rpcErr) setSearchResults(data || [])
      setSearchLoading(false)
    }, 200)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, searchOpen])

  // Reset search state every time the picker opens fresh
  useEffect(() => {
    if (searchOpen) {
      setSearchQuery('')
      setSearchResults([])
    }
  }, [searchOpen])

  // Reset SWITCH dialog when it closes
  useEffect(() => {
    if (!switchOpen) {
      setSwitchText('')
      setError('')
    }
  }, [switchOpen])

  // ── Action: dropdown picked a new state ─────────────────────────
  function handleChipPick(targetState) {
    setChipOpen(false)
    setError('')
    if (targetState === currentState) return // no-op

    // TO coach-managed → open search picker (no SWITCH gate; picking a
    // specific coach is the confirmation gesture)
    if (targetState === 'coach') {
      // BUT — if we're currently coach-managed, this is a coach swap.
      // Same destructive flow as detaching: confirm SWITCH, then pick.
      if (currentState === 'coach') {
        setPendingState('coach')
        setSwitchOpen(true)
        return
      }
      setSearchOpen(true)
      return
    }

    // FROM coach-managed → destructive SWITCH dialog
    if (currentState === 'coach') {
      setPendingState(targetState)
      setSwitchOpen(true)
      return
    }

    // Self ↔ Admin transitions — no destructive gate
    if (targetState === 'self' || targetState === 'admin') {
      applySwitch(targetState, null)
    }
  }

  // ── Action: apply the switch (atomic RPC call) ──────────────────
  async function applySwitch(targetState, coachId) {
    setBusy(true)
    setError('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_set_athlete_coaching', {
        p_user_id:      athleteProfile.id,
        p_target_state: targetState,
        p_coach_id:     coachId,
        p_tier:         null, // tier is changed via its own picker
      })
      if (rpcErr) throw rpcErr
      // Update local state via the parent callback
      onProfileUpdated({
        coach_id:        data?.new_coach_id ?? null,
        is_self_coached: targetState === 'self',
      })
      setSwitchOpen(false)
      setSearchOpen(false)
      setPendingState(null)
      setPendingCoach(null)
    } catch (e) {
      setError(e?.message || 'Failed to apply change.')
    } finally {
      setBusy(false)
    }
  }

  // ── Action: tier picker ─────────────────────────────────────────
  async function pickTier(tier) {
    setTierOpen(false)
    if (tier === currentTier) return
    setBusy(true)
    setError('')
    try {
      // Use the same RPC — it passes through coach state unchanged when
      // p_target_state matches the current state.
      const { data, error: rpcErr } = await supabase.rpc('admin_set_athlete_coaching', {
        p_user_id:      athleteProfile.id,
        p_target_state: currentState,
        p_coach_id:     currentState === 'coach' ? athleteProfile.coach_id : null,
        p_tier:         tier,
      })
      if (rpcErr) throw rpcErr
      onProfileUpdated({ b2c_subscription_tier: tier })
    } catch (e) {
      setError(e?.message || 'Failed to update tier.')
    } finally {
      setBusy(false)
    }
  }

  // ── Action: coach picker selected a coach ───────────────────────
  function handleCoachPicked(coach) {
    if (currentState === 'coach') {
      // We're in the middle of a swap — committed via the SWITCH dialog,
      // not directly here. This path is unreachable but defensive.
      setPendingCoach(coach)
      return
    }
    applySwitch('coach', coach.id)
  }

  // ── Action: SWITCH dialog confirm ───────────────────────────────
  function handleSwitchConfirm() {
    if (switchText !== 'SWITCH') return
    // For coach-swap path: close the SWITCH dialog and open the search
    // picker. Picker's selection will call applySwitch directly.
    if (pendingState === 'coach') {
      setSwitchOpen(false)
      setSwitchText('')
      setSearchOpen(true)
      return
    }
    // For self / admin transitions: apply directly.
    applySwitch(pendingState, null)
  }

  // ── Render ──────────────────────────────────────────────────────
  const StateIcon = STATE_META[currentState].icon

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {/* Tier picker */}
      <div className="relative" ref={tierRef}>
        <button
          onClick={() => { setTierOpen(o => !o); setChipOpen(false) }}
          disabled={busy}
          className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title="Athlete subscription tier (Free / CoreRX / FullRX)"
        >
          {TIER_META.find(t => t.key === currentTier)?.label ?? 'Free'}
          <ChevronDown className="h-3 w-3" />
        </button>
        {tierOpen && (
          <div className="absolute right-0 z-30 mt-1 min-w-[140px] rounded-md border border-border bg-card shadow-lg ring-1 ring-black/5">
            {TIER_META.map(t => (
              <button
                key={t.key}
                onClick={() => pickTier(t.key)}
                disabled={busy}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted/30 transition-colors ${t.key === currentTier ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {t.label}
                {t.key === currentTier && <Check className="h-3 w-3 text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* State chip */}
      <div className="relative" ref={chipRef}>
        <button
          onClick={() => { setChipOpen(o => !o); setTierOpen(false) }}
          disabled={busy}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${STATE_META[currentState].classes} ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title="Click to change who manages this athlete's plan"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <StateIcon className="h-3 w-3" />}
          {STATE_META[currentState].label}
          <ChevronDown className="h-3 w-3" />
        </button>
        {chipOpen && (
          <div className="absolute right-0 z-30 mt-1 min-w-[180px] rounded-md border border-border bg-card shadow-lg ring-1 ring-black/5">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              Switch to
            </div>
            {Object.entries(STATE_META).map(([key, meta]) => {
              const Icon = meta.icon
              const active = key === currentState
              return (
                <button
                  key={key}
                  onClick={() => handleChipPick(key)}
                  disabled={active}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${active ? 'text-muted-foreground/60 cursor-default' : 'text-foreground hover:bg-muted/30'}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                  {active && <Check className="h-3 w-3 text-primary" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Error banner (inline below the chip row) */}
      {error && !switchOpen && !searchOpen && (
        <div className="basis-full mt-1 flex items-center gap-1 text-[10px] text-destructive">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </div>
      )}

      {/* Coach search modal */}
      {searchOpen && (
        <CoachSearchModal
          onClose={() => setSearchOpen(false)}
          onPick={handleCoachPicked}
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          loading={searchLoading}
          busy={busy}
        />
      )}

      {/* Destructive SWITCH-typed confirmation */}
      {switchOpen && (
        <SwitchConfirmModal
          currentState={currentState}
          pendingState={pendingState}
          athleteName={athleteProfile.full_name}
          switchText={switchText}
          setSwitchText={setSwitchText}
          onCancel={() => { setSwitchOpen(false); setPendingState(null); setSwitchText('') }}
          onConfirm={handleSwitchConfirm}
          busy={busy}
          error={error}
        />
      )}
    </div>
  )
}

// ── Coach search modal ──────────────────────────────────────────────
function CoachSearchModal({ onClose, onPick, query, setQuery, results, loading, busy }) {
  return (
    <Modal onClose={onClose} title="Pick a coach">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="max-h-72 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {loading && (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {query ? 'No coaches matched.' : 'Start typing to find a coach.'}
            </div>
          )}
          {!loading && results.map(coach => (
            <button
              key={coach.id}
              onClick={() => onPick(coach)}
              disabled={busy}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted/30 transition-colors ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="h-7 w-7 rounded-full bg-muted/40 overflow-hidden flex-shrink-0">
                {coach.avatar_url ? (
                  <img src={coach.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">
                    {(coach.full_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground truncate">{coach.full_name || '(no name)'}</div>
                <div className="text-muted-foreground truncate">{coach.email}</div>
              </div>
              <SubscriptionDot status={coach.subscription_status} />
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SubscriptionDot({ status }) {
  const map = {
    trialing:  { color: 'bg-blue-400',    label: 'Trial' },
    active:    { color: 'bg-emerald-400', label: 'Active' },
    past_due:  { color: 'bg-amber-400',   label: 'Past due' },
    lapsed:    { color: 'bg-zinc-400',    label: 'Lapsed' },
    suspended: { color: 'bg-red-400',     label: 'Suspended' },
    cancelled: { color: 'bg-zinc-500',    label: 'Cancelled' },
  }
  const meta = map[status] || { color: 'bg-zinc-600', label: 'No subscription' }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title={meta.label}>
      <span className={`h-2 w-2 rounded-full ${meta.color}`} />
    </span>
  )
}

// ── Destructive SWITCH-typed confirmation ───────────────────────────
function SwitchConfirmModal({
  currentState, pendingState, athleteName, switchText, setSwitchText,
  onCancel, onConfirm, busy, error,
}) {
  // Copy varies by direction. currentState is always 'coach' for this dialog
  // (the only path that triggers it). pendingState tells us where we're going.
  const isToCoach = pendingState === 'coach'
  const isToSelf  = pendingState === 'self'
  const isToAdmin = pendingState === 'admin'

  let title, body
  if (isToCoach) {
    title = `Swap ${athleteName}'s coach`
    body  = `This athlete will be removed from their current coach's roster, then you'll pick a new coach to assign them to. Both coaches will see the change in their activity feed.`
  } else if (isToSelf) {
    title = `Make ${athleteName} self-managed`
    body  = `This athlete will be removed from their current coach's roster. They'll own their plan from the mobile app and see a notice on their dashboard that their coach changed.`
  } else if (isToAdmin) {
    title = `Take over coaching ${athleteName}`
    body  = `This athlete will be removed from their current coach's roster and assigned to you. They'll see a notice on their dashboard that their coach changed. Their current coach will see them disappear from the roster within seconds.`
  }

  return (
    <Modal onClose={onCancel} title={title}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-relaxed">{body}</p>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Type <span className="font-mono font-bold text-foreground">SWITCH</span> to confirm
          </label>
          <input
            autoFocus
            type="text"
            value={switchText}
            onChange={e => setSwitchText(e.target.value)}
            placeholder="SWITCH"
            className="w-full px-3 py-2 text-sm bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {error && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={switchText !== 'SWITCH' || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {isToCoach ? 'Pick new coach' : 'Confirm switch'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Tiny shared modal shell ─────────────────────────────────────────
function Modal({ onClose, title, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
