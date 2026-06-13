/**
 * Accept Coach Invite — web /accept-invite?token=xxx
 *
 * SMART-LINK PLACEHOLDER (locked May 27 2026).
 *
 * MyRX athletes have ZERO web surfaces — they live entirely in the mobile
 * app. This page used to host a full web acceptance flow (sign-in / create
 * account / accept RPC), but that became invalid the moment the no-athlete-
 * on-web rule landed.
 *
 * What this page does NOW:
 *   1. Read ?token=xxx from the URL.
 *   2. Call the existing `preview_coach_invite` RPC (public, returns the
 *      invite's status + coach card + invitee email + expiry).
 *   3. Render ONE of three things:
 *        - loading spinner while the RPC is in flight
 *        - friendly invalid-invite card (expired / revoked / accepted /
 *          unknown) — coach-voice copy, no dead-ends
 *        - the "coming soon" smart-link placeholder for a valid pending
 *          invite: coach name + personal message, an explanation that the
 *          mobile apps are launching shortly, UA-aware "what to do now"
 *          card, and the raw token shown in a monospace box as a manual
 *          fallback once the apps ship a paste-an-invite-code Settings
 *          screen.
 *
 * Voice rules (per CLAUDE.md):
 *   - Acknowledge: name the user's situation (they got an invite).
 *   - Explain: what's happening (apps launching, can't accept on web).
 *   - Next step: concrete, actionable (watch for launch email, save code).
 *   - No "consider", "you might want to", "in the future".
 *   - No emoji. Coach voice, not consumer voice.
 *
 * NOTE on the gracefully-degrade contract: if `preview_coach_invite` ever
 * disappears or returns an unexpected shape, the page falls through to a
 * generic "Your coach invited you" pending state (no coach name, no
 * message, no expiry copy) rather than blowing up. Better to land the
 * user on the smart-link than show them a broken page.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  Loader2, AlertCircle, UserCircle2, MessageCircle,
  Clock, Smartphone, Mail, Apple, Play,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Wordmark from '../../components/Wordmark'

// ─── Header ─────────────────────────────────────────────────────────────────
// Match the Landing page chrome: wordmark left, nothing on right.
// Wordmark is the no-slogan variant per CLAUDE.md brand rules — the
// slogan version is reserved for the signup welcome screen only.
function Header() {
  return (
    <header className="relative z-10 flex h-16 items-center px-6 md:px-10">
      <Link href="/">
        <a className="inline-flex items-center">
          <Wordmark />
        </a>
      </Link>
    </header>
  )
}

// ─── Footer (Privacy + Terms, mirrors Landing.jsx ordering) ─────────────────
function Footer() {
  return (
    <footer className="relative z-10 border-t border-border px-6 py-8 text-xs text-muted-foreground">
      <div className="mx-auto max-w-6xl space-y-4">
        <p className="text-center">MyRX · Performance Lab · Built for athletes, not beginners.</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/refund-policy" className="hover:text-foreground transition-colors">Refund Policy</Link>
          <Link href="/health-disclaimer" className="hover:text-foreground transition-colors">Health Disclaimer</Link>
          <Link href="/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link>
          <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
        </nav>
        <p className="text-center text-[10px] text-muted-foreground/60">© {new Date().getFullYear()} MyRX. All rights reserved.</p>
      </div>
    </footer>
  )
}

// ─── Ambient page wrapper (matches Landing.jsx) ─────────────────────────────
function PageShell({ children }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground flex flex-col">
      {/* Ambient grid */}
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -left-40 top-[-20%] h-[500px] w-[500px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-40 top-[10%] h-[500px] w-[500px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(220 80% 60% / 0.25), transparent 70%)' }}
        aria-hidden
      />
      <Header />
      <main className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center px-6 pb-16 pt-6 md:pt-12">
        {children}
      </main>
      <Footer />
    </div>
  )
}

// ─── Coach card (avatar + name) ─────────────────────────────────────────────
function CoachCard({ coach }) {
  return (
    <div className="flex flex-col items-center text-center">
      {coach?.avatar_url ? (
        <img
          src={coach.avatar_url}
          alt={coach.full_name || 'Coach'}
          className="h-16 w-16 rounded-full object-cover border border-border"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
          <UserCircle2 className="h-9 w-9" />
        </div>
      )}
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Your coach</div>
        <div className="mt-0.5 text-xl font-bold tracking-tight">{coach?.full_name || 'Your coach'}</div>
      </div>
    </div>
  )
}

// ─── Personal coach message ─────────────────────────────────────────────────
function CoachMessage({ message }) {
  if (!message) return null
  return (
    <div className="mt-6 w-full rounded-xl border border-border bg-card/80 p-4 backdrop-blur">
      <div className="flex items-start gap-2">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{message}</p>
      </div>
    </div>
  )
}

// ─── Terminal-state card (expired / revoked / accepted / unknown) ──────────
function TerminalCard({ icon: Icon, tone = 'muted', title, body }) {
  const toneStyles = tone === 'destructive'
    ? 'bg-destructive/15 text-destructive'
    : tone === 'warning'
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-muted text-muted-foreground'
  return (
    <div className="w-full rounded-2xl border border-border bg-card/80 p-8 text-center backdrop-blur">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${toneStyles}`}>
        <Icon className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{body}</p>
    </div>
  )
}

// ─── App-store badge placeholders ───────────────────────────────────────────
// Real App Store / Play Store badges land here once the apps ship. Until
// then they're labelled placeholders so the user sees the shape of what's
// coming without being able to tap dead links.
function AppleBadge() {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2.5 text-xs font-medium text-muted-foreground"
      aria-label="App Store badge — coming soon"
    >
      <Apple className="h-4 w-4" />
      <span>App Store — coming soon</span>
    </div>
  )
}

function GoogleBadge() {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2.5 text-xs font-medium text-muted-foreground"
      aria-label="Play Store badge — coming soon"
    >
      <Play className="h-4 w-4" />
      <span>Play Store — coming soon</span>
    </div>
  )
}

// ─── What to do now (UA-aware) ──────────────────────────────────────────────
function WhatToDoNow({ isMobile }) {
  return (
    <div className="mt-6 w-full rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
      <div className="flex items-start gap-3">
        {isMobile
          ? <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          : <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">What to do now</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {isMobile
              ? "You're on a phone — once the apps ship, you'll install them straight from here. We'll email the moment they're live."
              : "Once the apps ship, you'll get download badges + a QR code right here. For now, watch your inbox."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <AppleBadge />
            <GoogleBadge />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Token fallback box ─────────────────────────────────────────────────────
// Shown at the very bottom of the valid-pending state so the invitee can
// save the code and paste it into the app's "Have an invite code?" Settings
// screen once the apps ship.
function InviteCodeBox({ token }) {
  return (
    <div className="mt-6 w-full rounded-xl border border-border bg-muted/40 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Your invite code — save this in case you need to paste it later
      </div>
      <div className="mt-1.5 break-all font-mono text-xs text-foreground">
        {token}
      </div>
    </div>
  )
}

// ─── UA detection hook ──────────────────────────────────────────────────────
// Simple regex check — good enough for "mobile vs desktop" branching in
// the copy. We don't need device-specific behaviour, just a hint about
// what the user is reading on.
function useIsMobile() {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  }, [])
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function CoachAcceptInvite() {
  // ── Parse token from URL ──────────────────────────────────────────────
  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    return params.get('token')
  }, [])

  const isMobile = useIsMobile()

  // ── State ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)

  // ── Load invite preview ───────────────────────────────────────────────
  // We call `preview_coach_invite` (public RPC, returns status + coach card
  // + invitee email + expiry). If it doesn't exist or errors out, we still
  // render the smart-link placeholder — just without coach name / message.
  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      if (!token) {
        if (!cancelled) {
          setPreviewError('missing_token')
          setLoading(false)
        }
        return
      }
      try {
        const { data, error } = await supabase.rpc('preview_coach_invite', { p_token: token })
        if (cancelled) return
        if (error) {
          console.error('preview_coach_invite error:', error)
          // Soft-degrade: render generic pending state without coach info.
          setPreviewError(error.message || 'preview_failed')
        } else {
          setPreview(data || null)
        }
      } catch (err) {
        if (cancelled) return
        console.error('preview_coach_invite unexpected:', err)
        setPreviewError(err?.message || 'preview_failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreview()
    return () => { cancelled = true }
  }, [token])

  // ── Render: loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <PageShell>
        <div className="mt-16 flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm">Looking up your invite…</p>
        </div>
      </PageShell>
    )
  }

  // ── Render: missing token in URL ──────────────────────────────────────
  if (previewError === 'missing_token' || !token) {
    return (
      <PageShell>
        <TerminalCard
          icon={AlertCircle}
          tone="destructive"
          title="No invite link"
          body={"This page needs the invite link from your coach's email. Ask them to resend — the code is baked into the link."}
        />
      </PageShell>
    )
  }

  // From here we have a token. Read status + coach defensively — RPC may
  // have failed (previewError set) or returned an unexpected shape.
  const status = preview?.status || preview?.result || null
  const coach = preview?.coach || null
  const coachName = coach?.full_name || 'your coach'
  const inviteeEmail = preview?.invitee_email || null

  // ── Render: expired ───────────────────────────────────────────────────
  if (status === 'expired') {
    let expiredOn = 'recently'
    if (preview?.expires_at) {
      try {
        const d = new Date(preview.expires_at)
        expiredOn = `on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`
      } catch { /* ignore */ }
    }
    return (
      <PageShell>
        <TerminalCard
          icon={Clock}
          tone="warning"
          title="This invite has expired"
          body={`Your invite from Coach ${coachName} expired ${expiredOn}. Ping them for a fresh one — everything's still ready on our side.`}
        />
      </PageShell>
    )
  }

  // ── Render: revoked ───────────────────────────────────────────────────
  if (status === 'revoked' || status === 'declined') {
    return (
      <PageShell>
        <TerminalCard
          icon={AlertCircle}
          tone="muted"
          title="This invite is no longer valid"
          body={`${coachName} revoked this invite. Reach out if you want back in.`}
        />
      </PageShell>
    )
  }

  // ── Render: already accepted ──────────────────────────────────────────
  if (status === 'accepted') {
    return (
      <PageShell>
        <TerminalCard
          icon={AlertCircle}
          tone="muted"
          title="This invite has already been used"
          body={"Already used. If that was you, sign in once the MyRX app ships. If not, ask your coach to send a fresh one."}
        />
      </PageShell>
    )
  }

  // ── Render: invalid token / unknown status / RPC failure ──────────────
  // Any non-pending, non-known status — or a flat-out preview failure with
  // no status — falls through to the same friendly invalid card. We don't
  // leak RPC internals; the user just needs to know to ask for a new link.
  if (status === 'invalid' || (previewError && !status)) {
    return (
      <PageShell>
        <TerminalCard
          icon={AlertCircle}
          tone="destructive"
          title="Invite not found"
          body={"We don't recognise this link. Ask your coach to resend — the original may have been mistyped or revoked."}
        />
      </PageShell>
    )
  }

  // ── Render: valid pending invite — the smart-link placeholder ─────────
  // Treat anything that isn't a known terminal state as "pending". This
  // includes the soft-degrade case (preview RPC missing): we render the
  // smart-link with generic copy rather than leaving the user stranded.
  return (
    <PageShell>
      <div className="w-full">
        {/* Headline + coach card */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Your coach invited you
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">
            {coachName} invited you to MyRX
          </h1>
        </div>

        <div className="mt-6">
          <CoachCard coach={coach} />
        </div>

        <CoachMessage message={preview?.coach_message} />

        {/* Coming-soon notice — the core of the smart-link placeholder */}
        <div className="mt-6 w-full rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="text-sm font-semibold text-foreground">The MyRX app is launching shortly</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            MyRX runs on iOS and Android. Install once it ships, sign up with{' '}
            <span className="font-medium text-foreground">
              {inviteeEmail || 'the email your coach used to invite you'}
            </span>
            , and your invite attaches itself.
          </p>
        </div>

        <WhatToDoNow isMobile={isMobile} />

        <InviteCodeBox token={token} />
      </div>
    </PageShell>
  )
}
