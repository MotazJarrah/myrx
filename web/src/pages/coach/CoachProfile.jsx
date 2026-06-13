/**
 * Coach Profile + Subscription — /profile
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
import { Sparkles, Trash2, AlertTriangle, X, Loader2, Clock } from 'lucide-react'
import AccountSettings from '../../components/AccountSettings'
import BillingView from '../../components/BillingView'
import { supabase } from '../../lib/supabase'
import { usePersistedState } from '../../hooks/usePersistedState'

// "Subscription" tab was renamed to "Billing" (May 28 2026) when the
// BillingView component shipped. The standalone "About" tab was removed
// (Jun 8 2026): About + legal docs now live in ONE place — the Settings
// tab's About sub-section (AccountSettings → About, which shows the coach
// docs via its is_coach/superuser gate) — so the coach no longer sees
// About twice. Mirrors the admin's single-About layout.
// Macro Plan Setting moved OUT of Settings into the coach's "My Profile"
// self-view (its Calories tab) — Jun 9 2026. Settings is now Settings + Billing.
const TABS = [
  { id: 'profile', label: 'Settings'    },
  { id: 'billing', label: 'Billing'     },
]

export default function CoachProfile() {
  const { user, profile, refreshProfile } = useAuth()
  // Survive reloads (bfcache eviction), reset on nav-away / sign-out.
  // See src/hooks/usePersistedState.js for why clearOnUnmount works.
  const [activeTab, setActiveTab] = usePersistedState('myrx:coach_profile_tab', 'profile', { clearOnUnmount: true })

  // If a stale 'about' tab was persisted before the standalone About tab was
  // removed (Jun 8 2026), fall back to Settings so the body never renders blank.
  useEffect(() => {
    if (!['profile', 'billing'].includes(activeTab)) setActiveTab('profile')
  }, [activeTab, setActiveTab])

  // Self-service delete account modal state. Calls schedule_account_deletion
  // RPC with p_user_id=null (defaults to auth.uid()), which sets
  // scheduled_for_deletion_at = now() + 30 days. Once that column flips on
  // the profile, CoachProtectedLayout's ReactivationGate takes over the
  // page automatically — no manual redirect needed here.
  const [deleteOpen,        setDeleteOpen]        = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]       = useState('')

  // "Manage plan" → opens the Stripe Billing Portal (T194 step 8) via the
  // coach-billing-portal edge fn. Stripe hosts card update / cancel / tier
  // switch; the resulting webhook events update is_coach + coach_subscription_
  // status for us, so there's nothing to sync here beyond the redirect.
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError,   setPortalError]   = useState('')
  async function openBillingPortal() {
    if (portalLoading) return
    setPortalError('')
    setPortalLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('coach-billing-portal', { body: {} })
      if (error) {
        // supabase-js wraps a non-2xx as FunctionsHttpError whose generic
        // message ("Edge Function returned a non-2xx status code") HIDES our
        // friendly { error } body — that lives on error.context (the Response),
        // not on error.message. Pull it out so the coach sees the real reason
        // (e.g. "No billing account found for your coach plan.").
        let msg = ''
        try { const body = await error.context?.json?.(); msg = body?.error || '' } catch { /* body not JSON */ }
        throw new Error(msg || "Couldn't open the billing portal. Try again.")
      }
      if (!data?.url) throw new Error("Couldn't open the billing portal. Try again.")
      window.location.href = data.url
    } catch (e) {
      setPortalError(e.message || 'Something went wrong. Try again.')
      setPortalLoading(false)
    }
  }


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
          Account, settings, billing.
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
        // Self-service delete lives at the bottom of the Account sub-tab via
        // AccountSettings' dangerZone slot — mirrors the mobile placement
        // (Settings → Account, final entry). The full grace-period detail is
        // in the confirm modal below; the inline note stays brief. Only the
        // coach passes dangerZone here (self-mode), so it never leaks onto
        // other surfaces that reuse AccountSettings.
        <AccountSettings
          profile={profileWithEmail}
          user={user}
          dangerZone={
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Deleting starts a 30-day grace period — sign back in within 30 days to undo. After that, your account and data are permanently wiped.
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
          }
        />
      )}


      {activeTab === 'billing' && (
        // Billing surface is the same component admin uses on
        // /admin/user/:id → Billing tab. viewer="user" omits the
        // anonymized-account branch (coach can never be anonymized
        // while signed-in — the reactivation gate would have caught
        // them first). Shows current subscription + transactions list.
        <div className="max-w-2xl mx-auto">
          <BillingView userId={user.id} viewer="user" />

          {/* Stripe Billing Portal — "Manage plan" (T194 step 8). Opens
              Stripe's hosted portal where the coach can update their card,
              switch tier, or cancel. Any change there flows back through the
              stripe-webhook → is_coach + coach_subscription_status. */}
          <div className="mt-4">
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={portalLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {portalLoading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</>
                : <>Manage plan</>}
            </button>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Update your card, switch tier, or cancel — all handled securely
              by Stripe.
            </p>
            {portalError && (
              <p className="mt-2 text-xs text-destructive">{portalError}</p>
            )}
          </div>
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
                Billing records stay on file — we're required to keep those for
                tax + dispute resolution.{' '}
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
                className="rounded-md border border-primary/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
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
