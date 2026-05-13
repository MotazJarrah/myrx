/**
 * About MyRX — sub-page reached from Settings → "About MyRX".
 *
 * Mirrors the mobile equivalent at app/(app)/about.tsx. Bundles
 * the small bits of metadata users occasionally need but don't
 * belong cluttering the main Settings card list:
 *
 *   • App version (from package.json, injected by Vite at build time)
 *   • Legal docs (Terms, Privacy, Cookies, Acceptable Use) — open in
 *     a new tab so the user keeps any in-flight Settings state.
 *   • Operating-entity disclosure
 *
 * Future home for: open-source licenses, "What's new" changelog,
 * "Contact us" link. Build them as additional sections here rather
 * than padding Settings further.
 */

import { Link, useLocation } from 'wouter'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Vite injects __APP_VERSION__ via define in vite.config.js. If the
// project doesn't have that wired up, fall back to a hard-coded
// string so this page never renders empty. (Wiring it up is a
// 2-line change in vite.config.js — see footer of this file.)
const APP_VERSION = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) || '1.0.0'

const LEGAL_LINKS = [
  { href: '/terms',          label: 'Terms of Service' },
  { href: '/privacy',        label: 'Privacy Policy' },
  { href: '/cookies',        label: 'Cookie Policy' },
  { href: '/acceptable-use', label: 'Acceptable Use' },
]

export default function AboutMyRX() {
  const [, navigate] = useLocation()
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Sub-page back button — returns to Settings (the page the
          user came from). */}
      <button
        onClick={() => navigate('/profile')}
        className="inline-flex items-center gap-1 -ml-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </button>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">About</h1>

      {/* App identity card — version. Build number / runtime
          version can go here later if needed. */}
      <div className="mt-6 rounded-2xl border border-border bg-card/80 backdrop-blur">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm font-medium text-foreground">Version</span>
          <span className="text-sm text-muted-foreground">{APP_VERSION}</span>
        </div>
      </div>

      {/* Legal — four documents, each opens in a new tab so the
          user doesn't lose any unsaved Settings state. */}
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground px-1 mb-2">
        Legal
      </p>
      <div className="rounded-2xl border border-border bg-card/80 backdrop-blur overflow-hidden">
        {LEGAL_LINKS.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            // Use a regular <a target="_blank"> rather than wouter's
            // SPA navigation: the legal docs are static reference
            // material — better UX to open in a new tab than to
            // unmount the current page.
            asChild
          >
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center justify-between px-5 py-4 transition-colors hover:bg-accent/40 ${
                i < LEGAL_LINKS.length - 1 ? 'border-b border-border/50' : ''
              }`}
            >
              <span className="text-sm font-medium text-foreground">{item.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </a>
          </Link>
        ))}
      </div>

      {/* Operating-entity footer — required disclosure (the entity
          you're contracting with for ToS / PP) and good practice. */}
      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        MyRX is operated by Northern Princess LLC, Michigan, USA.
        <br />
        © {new Date().getFullYear()} Northern Princess LLC. All rights reserved.
      </p>
    </div>
  )
}
