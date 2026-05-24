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
import { ProfileTab } from '../EditProfile'
import AdminUserPlan from './tabs/AdminUserPlan'

function getGreeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const TABS = [
  { id: 'profile', label: 'My Profile'  },
  { id: 'plan',    label: 'Intake Plan' },
]

export default function AdminProfile() {
  const { user, profile: ctxProfile } = useAuth()
  const [existingPlan, setExistingPlan] = useState(null)
  const [planLoading,  setPlanLoading]  = useState(true)
  const [activeTab,    setActiveTab]    = useState('profile')

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

      {/* Greeting */}
      <div>
        <p className="text-sm text-muted-foreground">{getGreeting()},</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {profile?.full_name || user?.email?.split('@')[0] || 'Admin'}
        </h1>
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

      {/* My Profile tab — Account only. Reuses the end-user ProfileTab
          (from EditProfile.jsx) so it's byte-for-byte identical to what
          a client sees on /profile. Preferences / Security / About were
          intentionally NOT mirrored — scope is Account only per the
          May 23 2026 lock. */}
      {activeTab === 'profile' && (
        <div className="max-w-lg mx-auto">
          <ProfileTab profile={profile} user={user} />
        </div>
      )}

      {/* Intake Plan tab — admin-only feature, kept as-is */}
      {activeTab === 'plan' && (
        planLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <AdminUserPlan
            profile={profile}
            existingPlan={existingPlan}
            userId={user.id}
            adminUserId={user.id}
            onPlanSaved={updated => setExistingPlan(updated)}
          />
        )
      )}

    </div>
  )
}
