/**
 * Coach Portal — web /coach/portal
 *
 * Empty shell. Populated in Phase 4 of the Coach Platform v1 update
 * (CLAUDE.md Lock 12 — the 8 coach surfaces: per-client snapshot,
 * coach private notes, parameter templates, suggested adjustments
 * queue, morning briefing, coach profile, subscription, invite client).
 *
 * For now: greets the coach, shows their trial status, links to
 * placeholder destinations. Real surfaces land in Phase 4.
 *
 * Auth gate: requires the user to be signed in AND is_coach=true.
 * Non-coaches get redirected to /dashboard (their normal app).
 */

import { useEffect, useState } from 'react'
import { useLocation, Link } from 'wouter'
import {
  LayoutDashboard, Users, MessageCircle, BarChart3, Settings, LogOut,
  UserPlus, Clock, CheckCircle2, Sparkles,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

export default function CoachPortal() {
  const { user, profile, signOut } = useAuth()
  const [, setLocation] = useLocation()
  const [loading, setLoading] = useState(true)

  // Auth gate
  useEffect(() => {
    if (!user) {
      setLocation('/auth?next=/coach/portal')
      return
    }
    if (profile === null) return  // wait for profile load
    if (profile.is_coach !== true && profile.is_superuser !== true) {
      // Not a coach — kick to normal user dashboard
      setLocation('/dashboard')
      return
    }
    setLoading(false)
  }, [user, profile, setLocation])

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading your portal...</p>
      </div>
    )
  }

  const trialEnds = profile?.coach_trial_ends_at ? new Date(profile.coach_trial_ends_at) : null
  const daysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000)) : null
  const isTrialing = profile?.coach_subscription_status === 'trialing'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <span className="font-semibold">MyRX Coach</span>
        </div>
        <button
          onClick={() => signOut().then(() => setLocation('/'))}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">
            Welcome, Coach {profile?.full_name?.split(' ')[0] || ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your portal is set up. The full coach surfaces (roster, per-client snapshot,
            parameter templates, suggested adjustments, morning briefing) ship in the
            coming weeks.
          </p>
        </div>

        {isTrialing && daysLeft != null && (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex items-start gap-3">
            <Clock className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-primary">
                {daysLeft === 0 ? 'Trial ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plan: {profile?.coach_subscription_tier?.charAt(0).toUpperCase()}{profile?.coach_subscription_tier?.slice(1)}.
                Your first invoice arrives on day 15. Cancel anytime before then with no charge.
              </p>
            </div>
          </div>
        )}

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Quick actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <PlaceholderCard
              icon={UserPlus}
              title="Invite your first client"
              description="Send an email or SMS invite link. They'll sign up with full feature access for free, on you."
              status="Coming in Phase 3"
            />
            <PlaceholderCard
              icon={Users}
              title="My roster"
              description="See every client on your coaching list with at-a-glance status indicators."
              status="Coming in Phase 4"
            />
            <PlaceholderCard
              icon={MessageCircle}
              title="Messages"
              description="Chat with each of your clients — encourage, course-correct, ask questions."
              status="Coming in Phase 4"
            />
            <PlaceholderCard
              icon={BarChart3}
              title="Morning briefing"
              description="Daily aggregate of who needs attention, new check-ins, unread messages, weekly PRs across your roster."
              status="Coming in Phase 4"
            />
            <PlaceholderCard
              icon={Sparkles}
              title="Suggested adjustments"
              description="System-generated prompts: 'Sarah hit her weight goal — switch to maintenance?', 'Mike's been below his calorie target 6 of 7 days', etc."
              status="Coming in Phase 4"
            />
            <PlaceholderCard
              icon={Settings}
              title="Your profile + subscription"
              description="Update your bio, specialties, billing details, and subscription tier."
              status="Coming in Phase 4"
            />
          </div>
        </section>

        <section className="p-4 rounded-xl bg-card border border-border">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" /> Your subscription is active
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Stripe will email you a receipt + the link to manage your subscription
            (update card, cancel, change tier). You can also reach all of that from this
            portal once Phase 4 lands.
          </p>
        </section>
      </main>
    </div>
  )
}

function PlaceholderCard({ icon: Icon, title, description, status }) {
  return (
    <div className="p-4 rounded-xl bg-card border border-border opacity-70 cursor-not-allowed">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-input">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          <p className="text-xs text-primary mt-2">{status}</p>
        </div>
      </div>
    </div>
  )
}
