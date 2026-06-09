/**
 * Admin's own profile page
 * Route: /admin/profile
 * Tabs: My Profile (Account only) | Intake Plan (own coaching plan)
 *
 * The "My Profile" tab reuses the SAME ProfileTab component the end-users
 * see on /profile, so the admin's own Account page is byte-for-byte
 * identical to what a client sees on theirs. This was an explicit user
 * requirement (May 23 2026): "make perfect parity 1:1 to the setting's
 * account... only". Scope is limited to Account — no Preferences /
 * Security / About surfaces. Both surfaces read/write the same Supabase
 * columns via useAuth() — change once, see it everywhere.
 *
 * The Intake Plan tab is admin-only (end-users get their plan via
 * Calories page wizard) so it lives only on this page.
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import AccountSettings from '../../components/AccountSettings'
import MacroPlanEditor from '../../components/MacroPlanEditor'
import { usePersistedState } from '../../hooks/usePersistedState'

const TABS = [
  { id: 'profile', label: 'Settings'   },
  { id: 'plan',    label: 'Macro Plan Setting' },
]

export default function AdminProfile() {
  const { user, profile: ctxProfile } = useAuth()
  const [existingPlan, setExistingPlan] = useState(null)
  const [planLoading,  setPlanLoading]  = useState(true)
  // Survive reloads (bfcache eviction), reset on nav-away / sign-out.
  // See src/hooks/usePersistedState.js for why clearOnUnmount works.
  const [activeTab,    setActiveTab]    = usePersistedState('myrx:admin_profile_tab', 'profile', { clearOnUnmount: true })

  useEffect(() => {
    if (!user?.id) return
    async function load() {
      setPlanLoading(true)
      const planRes = await supabase
        .from('calorie_plans').select('*').eq('user_id', user.id).maybeSingle()
      setExistingPlan(planRes.data ?? null)
      setPlanLoading(false)
    }
    load()
  }, [user?.id])

  // Merge the auth-context profile (live, refreshed by ProfileTab/SettingsTab
  // saves) with the user.email so AdminUserPlan can read it. The end-user
  // ProfileTab/SettingsTab pull their profile directly from useAuth() so they
  // automatically pick up any updates.
  const profile = ctxProfile ? { ...ctxProfile, email: user?.email } : null

  if (!profile) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-4">

      {/* Page header — mirrors CoachProfile's "Account Settings" pattern
          (LOCKED May 26 2026 per the admin↔coach mirror rule). The
          previous greeting + name h1 was an admin-only flavor that
          diverged from coach; the user chose full mirror so both
          portals' Account Settings pages read identically. */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your account, your settings, and your plan.
        </p>
      </div>

      {/* Top-level tab bar: My Profile | Intake Plan */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 min-w-fit whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              activeTab === t.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* My Profile tab — full 4-tab AccountSettings (Account /
          Preferences / Security / About). Mirrors the mobile profile
          page's tab structure, scoped to the surfaces that make sense
          on web for an admin (Connect / wearable integrations are
          mobile-only and intentionally omitted). The same component
          renders on /coach/profile — shared layout, shared behaviour.
          May 24 2026 — replaces the previous Account-only scope. */}
      {activeTab === 'profile' && (
        <AccountSettings profile={profile} user={user} />
      )}

      {/* Macro Plan tab — admin's own plan. Uses the unified
          MacroPlanEditor (same component the coach side uses) for
          consistent behaviour. Replaces the old AdminUserPlan form
          per the May 25 2026 macro-plan refresh. */}
      {activeTab === 'plan' && (
        planLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <MacroPlanEditor
            profile={profile}
            user={user}
            existingPlan={existingPlan}
            onPlanSaved={updated => setExistingPlan(updated)}
          />
        )
      )}

    </div>
  )
}
