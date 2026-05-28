/**
 * Coach Profile + Subscription — /coach/profile
 *
 * Mirror of AdminProfile.jsx (the admin's own account page). For Phase 2
 * we wire the basics — name / bio / specialties / sign-in stuff — and
 * stub the subscription management section (Phase 4 wires the Stripe
 * Customer Portal link so the coach can change card / cancel / change
 * tier from inside the app).
 *
 * Until the full coach-tailored Account page lands, this page reuses the
 * end-user Profile + Settings sub-tab pattern so the coach can at least
 * update name, email, phone, units, password, and biometric prefs.
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { CreditCard, Sparkles } from 'lucide-react'
import AccountSettings from '../../components/AccountSettings'
import MacroPlanEditor from '../../components/MacroPlanEditor'
import { supabase } from '../../lib/supabase'
import { usePersistedState } from '../../hooks/usePersistedState'

const TABS = [
  { id: 'profile',      label: 'Settings'     },
  { id: 'macro',        label: 'Macro Plan'   },
  { id: 'subscription', label: 'Subscription' },
]

export default function CoachProfile() {
  const { user, profile } = useAuth()
  // Survive reloads (bfcache eviction), reset on nav-away / sign-out.
  // See src/hooks/usePersistedState.js for why clearOnUnmount works.
  const [activeTab, setActiveTab] = usePersistedState('myrx:coach_profile_tab', 'profile', { clearOnUnmount: true })

  // Coach's OWN macro plan (separate fetch — they're managing themselves)
  const [existingPlan, setExistingPlan] = useState(null)
  const [planLoading,  setPlanLoading]  = useState(true)

  useEffect(() => {
    if (!user?.id) return
    async function load() {
      setPlanLoading(true)
      const { data } = await supabase
        .from('calorie_plans').select('*').eq('user_id', user.id).maybeSingle()
      setExistingPlan(data ?? null)
      setPlanLoading(false)
    }
    load()
  }, [user?.id])

  if (!user || !profile) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
    )
  }

  // Merge user.email into profile so AccountSettings → ProfileTab can
  // render it in the email field. The ProfileTab itself reads the rest
  // straight off useAuth(), so updates flow through to both surfaces.
  const profileWithEmail = { ...profile, email: user.email }

  return (
    <div className="space-y-4">

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your account, your settings, and your billing.
        </p>
      </div>

      {/* Top-level tab bar: My Profile | Subscription. Mirrors AdminProfile's
          two-tab pattern. The My Profile tab opens AccountSettings (same
          4-tab Account/Preferences/Security/About layout as admin). The
          Subscription tab is coach-specific. */}
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

      {activeTab === 'profile' && (
        <AccountSettings profile={profileWithEmail} user={user} />
      )}

      {activeTab === 'macro' && (
        planLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <MacroPlanEditor
            profile={profileWithEmail}
            user={user}
            existingPlan={existingPlan}
            onPlanSaved={setExistingPlan}
          />
        )
      )}

      {activeTab === 'subscription' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Subscription</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Status</p>
              <p className="text-sm font-semibold">
                {profile.coach_subscription_status
                  ? profile.coach_subscription_status.charAt(0).toUpperCase() + profile.coach_subscription_status.slice(1)
                  : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Tier</p>
              <p className="text-sm font-semibold">
                {profile.coach_subscription_tier
                  ? profile.coach_subscription_tier.charAt(0).toUpperCase() + profile.coach_subscription_tier.slice(1)
                  : '—'}
              </p>
            </div>
          </div>

          {profile.coach_trial_ends_at && profile.coach_subscription_status === 'trialing' && (
            <p className="text-xs text-muted-foreground">
              Trial ends {new Date(profile.coach_trial_ends_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}. Your card will be charged on day 15.
            </p>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Subscription management (update card, cancel, change tier) ships
              in Phase 4 via a Stripe Customer Portal link. In the meantime,
              Stripe emails you a portal link with every receipt.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
