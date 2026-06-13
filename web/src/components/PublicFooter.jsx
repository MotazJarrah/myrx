import { Link } from 'wouter'

/**
 * PublicFooter — the ONE footer for every public-facing page (T248).
 *
 * Same footer on the athlete landing, coach landing, pricing, sign-in,
 * confirm, legal docs, invite, and download-app pages. Rendered by
 * PageShell so it lands on every page automatically — pages never write
 * their own footer (that's how footers drifted: AcceptInvite, LegalLayout,
 * and the marketing pages each had a different one or none).
 *
 * Links point at the legal routes, which are host-agnostic (registered
 * outside the host conditional in App.jsx), so they resolve on both
 * myrxfit.com and coach.myrxfit.com.
 */
const FOOTER_LINKS = [
  { href: '/terms',             label: 'Terms' },
  { href: '/privacy',           label: 'Privacy' },
  { href: '/cookies',           label: 'Cookies' },
  { href: '/refund-policy',     label: 'Refund Policy' },
  { href: '/acceptable-use',    label: 'Acceptable Use' },
  { href: '/health-disclaimer', label: 'Health Disclaimer' },
]

export default function PublicFooter() {
  return (
    <footer className="relative z-10 border-t border-border/40 px-6 md:px-10 py-8 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
        <p className="font-medium text-foreground/80">MyRX · Performance Lab</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <p>© MyRX. All rights reserved.</p>
      </div>
    </footer>
  )
}
