/**
 * ReactivationGate — full-screen page rendered post-sign-in when the
 * user's account is scheduled for deletion within the 30-day grace
 * window.
 *
 * Mounted by CoachProtectedLayout (and ProtectedLayout for admin) as a
 * short-circuit BEFORE the normal shell. The user can authenticate
 * successfully but every protected route renders this gate until they
 * either:
 *   • Click "Reactivate my account" → cancel_scheduled_deletion() RPC
 *     fires → status flips back to Active → gate unmounts naturally
 *     because the auth context's profile refresh removes
 *     scheduled_for_deletion_at.
 *   • Click "Sign out" → standard sign-out flow.
 *
 * If they never reactivate within 30 days, the nightly cron calls
 * anonymize_expired_accounts(), which bans auth.users and scrubs the
 * email — they can't sign in at all after that.
 *
 * Voice (CLAUDE.md): coach voice — acknowledge their state, name the
 * specific consequence, give one clear next step. No hedging, no
 * "you might want to consider."
 */

import { useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { AlertTriangle, RotateCcw, LogOut, Loader2 } from 'lucide-react'

export default function ReactivationGate() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [, navigate] = useLocation()
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState(null)

  // Derive days remaining outside render to avoid Date.now() in JSX (React
  // 19 purity violation — same scar AdminUserDetail status banner hit).
  const scheduledAt = profile?.scheduled_for_deletion_at
  let daysLeft = null
  let formattedDate = null
  if (scheduledAt) {
    const ms = new Date(scheduledAt).getTime() - Date.now()
    daysLeft = Math.max(0, Math.ceil(ms / 86_400_000))
    formattedDate = new Date(scheduledAt).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }

  async function handleReactivate() {
    setBusy(true)
    setErr(null)
    try {
      // p_user_id=null → self. The RPC's auth check accepts that path.
      const { error } = await supabase.rpc('cancel_scheduled_deletion', { p_user_id: null })
      if (error) throw error
      // Refresh the profile so scheduled_for_deletion_at clears in
      // AuthContext, which unmounts this gate and lets the normal shell
      // render.
      await refreshProfile()
      // Explicit navigation to the user's role-home (locked May 28 2026).
      // Without this, the user lands on whatever URL the wouter location
      // was at when the gate took over — which is unpredictable after a
      // fresh sign-in. Always landing on the role's main dashboard is
      // the predictable "welcome back" experience the user spec'd.
      //   Admin (superuser)  → /admin/overview
      //   Coach              → /portal  (root-level on coach.myrxfit.com, T199)
      //   Anyone else        → /app  (the athlete placeholder; athletes
      //                                are mobile-only per CLAUDE.md, so
      //                                this branch should never fire)
      const home = profile?.is_superuser ? '/admin/overview'
                 : profile?.is_coach     ? '/portal'
                                         : '/app'
      navigate(home, { replace: true })
    } catch (e) {
      setErr(e?.message || 'Reactivation failed. Try again, or sign out and contact support.')
      setBusy(false)
    }
  }

  async function handleSignOut() {
    setBusy(true)
    try {
      await signOut()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-card p-6 shadow-xl">

        {/* Header — amber alert icon + name */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-amber-400 font-semibold">Account scheduled for deletion</p>
            <p className="text-sm text-muted-foreground truncate">
              {profile?.full_name || user?.email}
            </p>
          </div>
        </div>

        {/* Body — minimum legally required: state the deletion date.
            Retention details live in the Privacy Policy (linked in the
            footer below) — re-stating them here would be over-explanation
            and risks misleading copy. Locked May 28 2026 per user instruction. */}
        <div className="mb-6 text-sm leading-relaxed">
          {daysLeft != null && (
            <p className="text-foreground">
              Your account is scheduled for deletion on{' '}
              <span className="font-semibold text-amber-400">{formattedDate}</span>
              {' '}— in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}.
            </p>
          )}
        </div>

        {/* Error */}
        {err && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {err}
          </div>
        )}

        {/* Actions — Reactivate first (primary path), Sign out below. */}
        <div className="space-y-2">
          <button
            onClick={handleReactivate}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            Reactivate my account
          </button>
          <button
            onClick={handleSignOut}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        {/* Footnote — Privacy Policy link is the legally-required disclosure
            of what data is retained after deletion. Keeping it small + linked
            (instead of inlined) keeps the gate copy minimal. */}
        <p className="mt-5 text-center text-[11px] text-muted-foreground/60">
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            Privacy Policy
          </a>
          {' · '}
          <a href="mailto:support@myrxfit.com" className="underline hover:text-foreground">
            support@myrxfit.com
          </a>
        </p>
      </div>
    </div>
  )
}
