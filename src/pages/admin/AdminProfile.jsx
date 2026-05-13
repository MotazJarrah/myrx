/**
 * Admin's own profile page
 * Route: /admin/profile
 * Tabs: My Profile (edit) | Intake Plan (assign)
 *
 * After every save, refreshProfile() is called so the AuthContext cache
 * stays in sync — ensuring the client view (EditProfile) and intake plan
 * calculations always use up-to-date weight/height/metrics.
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import AdminUserProfile from './tabs/AdminUserProfile'
import AdminUserPlan    from './tabs/AdminUserPlan'

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
  const { user, refreshProfile } = useAuth()
  const [profile,      setProfile]      = useState(null)
  const [existingPlan, setExistingPlan] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [activeTab,    setActiveTab]    = useState('profile')

  useEffect(() => {
    if (!user?.id) return
    async function load() {
      setLoading(true)
      const [profileRes, planRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('calorie_plans').select('*').eq('user_id', user.id).maybeSingle(),
      ])
      setProfile(profileRes.data ? { ...profileRes.data, email: user.email } : null)
      setExistingPlan(planRes.data ?? null)
      setLoading(false)
    }
    load()
  }, [user?.id])

  // Called after any profile save — updates local state AND refreshes AuthContext
  // so the client view (EditProfile + calorie plan) sees the new metrics immediately
  async function handleProfileSaved(updated) {
    setProfile(prev => ({ ...prev, ...updated }))
    await refreshProfile()
  }

  if (loading) {
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

      {/* Tab bar */}
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

      {/* Profile tab */}
      {activeTab === 'profile' && profile && (
        <AdminUserProfile
          profile={profile}
          userId={user.id}
          onProfileSaved={handleProfileSaved}
        />
      )}

      {/* Intake Plan tab */}
      {activeTab === 'plan' && (
        <AdminUserPlan
          profile={profile}
          existingPlan={existingPlan}
          userId={user.id}
          adminUserId={user.id}
          onPlanSaved={updated => setExistingPlan(updated)}
        />
      )}

    </div>
  )
}
