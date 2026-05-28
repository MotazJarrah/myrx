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
import { Sparkles, ChevronRight, Trash2, AlertTriangle, X, Loader2, Clock } from 'lucide-react'
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
  const { user, profile, refreshProfile } = useAuth()
  // Survive reloads (bfcache eviction), reset on nav-away / sign-out.
  // See src/hooks/usePersistedState.js for why clearOnUnmount works.
  const [activeTab, setActiveTab] = usePersistedState('myrx:coach_profile_tab', 'profile', { clearOnUnmount: true })

  // Coach's OWN macro plan (separate fetch — they're managing themselves)
  const [existingPlan, setExistingPlan] = useState(null)
  const [planLoading,  setPlanLoading]  = useState(true)

  // Self-service delete account modal state. Calls schedule_account_deletion
  // RPC with p_user_id=null (defaults to auth.uid()), which sets
  // scheduled_for_deletion_at = now() + 30 days. Once that column flips on
  // the profile, CoachProtectedLayout's ReactivationGate takes over the
  // page automatically — no manual redirect needed here.
  const [deleteOpen,        setDeleteOpen]        = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]       = useState('')

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

  // Schedule the coach's own account for deletion. Calls the
  // schedule_account_deletion RPC with p_user_id=null so the function
  // defaults to auth.uid() (the signed-in coach). The RPC sets
  // profiles.scheduled_for_deletion_at = now() + 30 days; once the auth
  // context picks up the updated profile via refreshProfile(),
  // CoachProtectedLayout's ReactivationGate short-circuits every coach
  // route until the coach either reactivates or signs out. After 30
  // days, the anonymize_expired_accounts pg_cron job permanently wipes
  // their coach profile, releases client links, and bans auth.users.
  // Billing records + activity log are retained per legal-compliance
  // policy (Privacy Policy §retention).
  async function doScheduleSelfDeletion() {
    if (deleting) return
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm.')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const { error } = await supabase.rpc('schedule_account_deletion', { p_user_id: null })
      if (error) throw error
      // Refresh the auth context's profile so scheduled_for_deletion_at
      // becomes visible to CoachProtectedLayout's gate. The gate
      // unmounts this page and renders ReactivationGate in its place.
      await refreshProfile()
      // Close the modal in case the gate's mount is delayed a tick.
      setDeleteOpen(false)
    } catch (err) {
      setDeleteError(err?.message || 'Failed to schedule deletion. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  // Date 30 days from now, formatted for the modal copy. Computed once per
  // render (outside JSX) so React 19's strict-purity rule doesn't flag the
  // Date.now() call — same scar AdminUserDetail status banner hit.
  const deletionDate = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

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
        <>
          <AccountSettings profile={profileWithEmail} user={user} />

          {/* Danger zone — self-service delete account. Mirrors the admin's
              schedule_account_deletion flow but with p_user_id=null so the
              RPC defaults to auth.uid(). Once the coach confirms, the
              ReactivationGate takes over via CoachProtectedLayout. They
              have 30 days to sign in and reactivate before permanent
              anonymization. Lives inside CoachProfile (not AccountSettings)
              because AccountSettings is shared across surfaces — only the
              coach owns the self-delete path on web. */}
          <div className="max-w-2xl mx-auto mt-4 rounded-2xl border border-destructive/30 bg-card overflow-hidden">
            <div className="border-b border-destructive/20 bg-destructive/5 px-5 py-3">
              <h2 className="text-sm font-bold text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Danger zone
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Deleting your account starts a 30-day grace period. You can sign
                in any time within those 30 days to reactivate. After that,
                your coach profile, client links, and account data are
                permanently wiped — billing records are retained per legal
                requirement.
              </p>
              <button
                onClick={() => {
                  setDeleteConfirmText('')
                  setDeleteError('')
                  setDeleteOpen(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete account
              </button>
            </div>
          </div>
        </>
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

      {/* ── Self-service delete-account confirm modal ── */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/15">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Delete your MyRX coach account</h2>
                  <p className="text-xs text-muted-foreground">30-day grace period · reversible until then</p>
                </div>
              </div>
              <button
                onClick={() => !deleting && setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-foreground leading-relaxed">
                Your account will be deleted on{' '}
                <span className="font-semibold">{deletionDate}</span>.
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Until then, sign in to reactivate. After that, your coach
                profile, client links, and account data are permanently wiped.
                Billing records are retained per legal requirement —{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </p>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Type DELETE to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={e => {
                    setDeleteConfirmText(e.target.value)
                    if (deleteError) setDeleteError('')
                  }}
                  disabled={deleting}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono tracking-wider text-foreground focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive disabled:opacity-50"
                />
              </div>

              {deleteError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doScheduleSelfDeletion}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scheduling…</>
                  : <><Clock className="h-3.5 w-3.5" /> Schedule deletion</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
