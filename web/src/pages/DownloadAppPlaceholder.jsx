/**
 * DownloadAppPlaceholder — the ONLY web surface an athlete can land on.
 *
 * Per CLAUDE.md "Web / Mobile role rule" (LOCKED May 27 2026):
 *   - Athletes have ZERO web surfaces. Every athlete URL returns 404.
 *   - The single exception is this placeholder, which shows up:
 *       (a) when an athlete somehow successfully signs into web
 *           (sign-in itself isn't blocked — it's role-routed AFTER
 *           creds succeed; the only sign-in entry point is the
 *           /for-coaches Sign in button, intended for coaches/admins)
 *       (b) when an athlete clicks a /coach/accept-invite?token=…
 *           email link from desktop. The token stays in the URL so
 *           when they install the mobile app later, the invite
 *           auto-attaches.
 *
 * The page is intentionally a PLACEHOLDER right now — iOS + Android
 * apps haven't shipped yet. When they do, this page becomes the
 * download/launch surface (App Store badge, Play Store badge, QR
 * code, hero copy, etc.). The full checklist of what needs to land
 * here at app-launch time lives in docs/launch_checklist.xlsx.
 *
 * For now: a clean holding page that signals what's coming without
 * making any false promises.
 */
import { Link, Redirect } from 'wouter'
import { Smartphone } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function DownloadAppPlaceholder() {
  // Coaches and admins must never see this athlete placeholder. They land
  // here only via stale links, direct URL typing, or fallback redirects
  // after stale sessions. Bounce them to their actual portal so a coach
  // landing on /app doesn't see the "Download the MyRX app" pitch meant
  // for athletes. Added May 30 2026 after Test Coach (motaz.j@prdxfit.com,
  // elite tier) hit this page and reported they had no access. Athletes
  // (no role flags) fall through to the placeholder JSX below.
  const { profile } = useAuth()
  if (profile?.is_superuser) return <Redirect to="/admin/overview" />
  if (profile?.is_coach)     return <Redirect to="/coach/portal" />

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 flex items-center justify-center">
          <Smartphone className="h-8 w-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            MyRX is mobile-first.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your athlete account lives on the MyRX mobile app —
            track strength, cardio, mobility, and nutrition from your phone,
            wherever your training happens.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-left space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            Coming soon
          </p>
          <p className="text-sm text-foreground/90 leading-relaxed">
            The MyRX app for iOS and Android is launching shortly.
            We'll send you a link to download it once it's ready.
          </p>
          <p className="text-xs text-muted-foreground">
            If you arrived here via a coach's invite link, your invite is
            saved — sign up in the app when it launches and your coach will
            be connected automatically.
          </p>
        </div>

        <div className="pt-2 text-xs text-muted-foreground">
          Coach or admin? <Link href="/for-coaches"><a className="text-primary hover:underline">Sign in here</a></Link>
        </div>
      </div>
    </div>
  )
}
