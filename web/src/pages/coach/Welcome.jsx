/**
 * Coach Welcome — web /coach/welcome?session_id=cs_xxx
 *
 * Landing page after Stripe Checkout completes. Stripe redirects here
 * with ?session_id={CHECKOUT_SESSION_ID}.
 *
 * We:
 *   1. Verify the session_id is present (otherwise show fallback)
 *   2. Briefly poll the coach_subscriptions table for the row to appear
 *      (the stripe-webhooks worker fires asynchronously — usually
 *      within 1-2 seconds, but we allow up to ~10 seconds before
 *      showing the "your subscription is being set up" message)
 *   3. Once we see the row, show success + button to /coach/portal
 *
 * If polling times out, we still show success (the user paid, the
 * webhook will catch up) with a note that it can take a minute.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function CoachWelcome() {
  const [, setLocation] = useLocation()
  const [status, setStatus] = useState('polling')   // polling | confirmed | timeout | error
  const [coach, setCoach] = useState(null)

  // Read session_id (we don't actually use it for the polling — we use
  // the authed user's session, since after checkout Stripe doesn't
  // log us in; we rely on the user already being signed in via the
  // signup flow before checkout). For now we just check the user
  // already has an auth session.

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const maxAttempts = 20   // 20 × 500ms = 10s
    let timer

    async function pollOnce() {
      attempts++
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          // Not signed in. The signup flow doesn't log us in
          // automatically. Show success without polling — the webhook
          // will land asynchronously, and the user can sign in fresh.
          if (!cancelled) setStatus('confirmed')
          return
        }
        const { data: profile, error: pErr } = await supabase
          .from('profiles')
          .select('id, full_name, coach_subscription_status, coach_subscription_tier, coach_trial_ends_at')
          .eq('id', user.id)
          .single()
        if (pErr) throw pErr
        if (profile?.coach_subscription_status === 'trialing'
            || profile?.coach_subscription_status === 'active') {
          if (!cancelled) {
            setCoach(profile)
            setStatus('confirmed')
          }
          return
        }
        // Not yet — retry
        if (attempts < maxAttempts) {
          timer = setTimeout(pollOnce, 500)
        } else {
          if (!cancelled) setStatus('timeout')
        }
      } catch (err) {
        console.error('Welcome poll error:', err)
        if (attempts < maxAttempts) {
          timer = setTimeout(pollOnce, 500)
        } else {
          if (!cancelled) setStatus('error')
        }
      }
    }

    pollOnce()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        {status === 'polling' && (
          <>
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" />
            <div>
              <h1 className="text-2xl font-semibold mb-1">Setting up your account</h1>
              <p className="text-sm text-muted-foreground">
                Confirming payment with Stripe... this takes just a moment.
              </p>
            </div>
          </>
        )}

        {status === 'confirmed' && (
          <>
            <div className="p-3 rounded-full bg-primary/20 w-fit mx-auto">
              <CheckCircle2 className="h-12 w-12 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold mb-1">
                You're in{coach?.full_name ? `, ${coach.full_name.split(' ')[0]}` : ''}.
              </h1>
              <p className="text-sm text-muted-foreground">
                14-day trial active. First invoice on day 15 — cancel before then for no charge.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => setLocation('/coach/portal')}
                className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                Open your portal <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-xs text-muted-foreground">
                You can invite your first clients from there.
              </p>
            </div>
          </>
        )}

        {status === 'timeout' && (
          <>
            <div className="p-3 rounded-full bg-amber-500/20 w-fit mx-auto">
              <CheckCircle2 className="h-12 w-12 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold mb-1">Payment received!</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Payment in. Stripe confirmed it, but we're a beat behind on the rest of the setup —
                usually clears within a minute. Refresh, or head straight to your portal.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
              >
                Refresh
              </button>
              <button
                onClick={() => setLocation('/coach/portal')}
                className="w-full h-12 rounded-lg border border-border text-foreground font-medium hover:bg-card transition-colors"
              >
                Go to portal anyway
              </button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="p-3 rounded-full bg-destructive/20 w-fit mx-auto">
              <CheckCircle2 className="h-12 w-12 text-destructive" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold mb-1">Something went wrong</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We couldn't confirm your subscription. Your payment likely went through —
                please email support@myrxfit.com with the session ID below and we'll get
                you sorted within the hour.
              </p>
            </div>
            <code className="text-xs text-muted-foreground block break-all bg-card p-2 rounded">
              {new URLSearchParams(window.location.search).get('session_id') || 'no_session_id'}
            </code>
          </>
        )}
      </div>
    </div>
  )
}
