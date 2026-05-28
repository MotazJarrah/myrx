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
import { Sparkles, ChevronRight } from 'lucide-react'
import AccountSettings from '../../components/AccountSettings'
import MacroPlanEditor from '../../components/MacroPlanEditor'
import BillingView from '../../components/BillingView'
import { supabase } from '../../lib/supabase'
import { usePersistedState } from '../../hooks/usePersistedState'

// "Subscription" tab was renamed to "Billing" (May 28 2026) when the
// BillingView component shipped. "About" added the same day so coach
// has the same legal-doc access surface athlete does on mobile (gear
// → Settings → About). Without it, the coach has zero legal-doc re-
// read surface inside the portal — they only saw the docs at signup
// time. About is at the END so it's predictable (bottom of the row).
const TABS = [
  { id: 'profile', label: 'Settings'    },
  { id: 'macro',   label: 'Macro Plan'  },
  { id: 'billing', label: 'Billing'     },
  { id: 'about',   label: 'About'       },
]

// Coach legal docs — adds Coach Agreement + Data Processing Agreement
// on top of the common 4 (TOS / Privacy / Cookie / Acceptable Use) and
// the consumer-protection 3 (Health Disclaimer / Refund Policy / How
// We Compute). 9 docs total. Stays in the same order as the public
// legal-footer convention so coaches who see it elsewhere recognise
// the layout. Mirrors the athlete-side ABOUT_LEGAL_LINKS list in
// mobile profile.tsx — keep the two in sync when a doc is added.
const COACH_ABOUT_LEGAL_LINKS = [
  { url: '/terms',             label: 'Terms of Service' },
  { url: '/privacy',           label: 'Privacy Policy' },
  { url: '/cookies',           label: 'Cookie Policy' },
  { url: '/acceptable-use',    label: 'Acceptable Use' },
  { url: '/coach-agreement',   label: 'Coach Agreement' },
  { url: '/refund-policy',     label: 'Refund Policy' },
  { url: '/health-disclaimer', label: 'Health & Medical Disclaimer' },
  { url: '/dpa',               label: 'Data Processing Agreement' },
  { url: '/how-we-compute',    label: 'How We Compute' },
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

      {activeTab === 'billing' && (
        // Billing surface is the same component admin uses on
        // /admin/user/:id → Billing tab. viewer="user" omits the
        // anonymized-account branch (coach can never be anonymized
        // while signed-in — the reactivation gate would have caught
        // them first). Shows current subscription + transactions list.
        <div className="max-w-2xl mx-auto">
          <BillingView userId={user.id} viewer="user" />

          {/* Stripe Customer Portal CTA — placeholder until Phase 4
              wires the actual portal session edge function. Until then,
              coach uses the portal link Stripe emails with every
              receipt. */}
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Card update, cancellation, and tier changes are managed via
              the Stripe Customer Portal — Stripe emails you a portal
              link with every receipt. Direct in-app portal access ships
              in the next release.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        // Coach About — version + legal docs + entity footer. Mirrors
        // the athlete AboutTab in mobile profile.tsx layout so the
        // two surfaces stay visually consistent (the legal docs are
        // shared content; coaches and athletes should see them in
        // the same arrangement). Locked May 28 2026.
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Version card */}
          <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Version</span>
            <span className="text-sm font-mono tabular-nums">1.0.0</span>
          </div>

          {/* Legal links */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Legal</p>
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {COACH_ABOUT_LEGAL_LINKS.map(item => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/40 transition-colors"
                >
                  <span>{item.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>

          {/* Operating-entity footer — required disclosure (the entity
              the coach is contracting with for ToS / Coach Agreement). */}
          <p className="text-center text-[11px] text-muted-foreground/70 leading-relaxed">
            MyRX is operated by Northern Princess LLC, Michigan, USA.<br />
            © {new Date().getFullYear()} Northern Princess LLC. All rights reserved.
          </p>
        </div>
      )}
    </div>
  )
}
