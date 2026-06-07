/**
 * ClientSettingsDrawer — shared right-side drawer for viewing/editing
 * a client's account settings from the admin OR coach detail page.
 *
 * Mounted from `/admin/user/:id` (viewerRole='admin') and (Phase 3+)
 * `/coach/client/:id` (viewerRole='coach'). Single component → admin↔coach
 * mirror is automatic per the CLAUDE.md mirror rule.
 *
 * v1 (May 26 2026): wraps the shared AccountSettings component (the
 * Edit profile / Edit settings forms). These were previously rendered
 * inside the Profile tab of AdminUserDetail; this drawer pulls them
 * BEHIND the gear icon so the top-level tabs are pure read-only
 * dashboards.
 *
 * v2 (next iteration): split into 3 tabs (Account / Preferences /
 * Security) matching the end-user /profile shape. Security tab gets
 * admin-mode support actions (send password reset, disable biometric
 * on all devices) that the client themselves can't perform from
 * inside their own settings. Coach mode goes read-only.
 *
 * Props:
 *   open            — boolean, controls visibility (controlled component)
 *   onClose         — fired when the user dismisses (overlay click, X button, Esc)
 *   clientUserId    — the target client's profile id
 *   clientProfile   — the target client's profile object (or null while loading)
 *   viewerRole      — 'admin' | 'coach'; gates support actions and edit affordances
 *   onProfileSaved  — fired when the target client's profile is edited; parent
 *                     should merge into its local state to reflect the change
 */

import { useEffect } from 'react'
import { X } from 'lucide-react'
import AccountSettings from './AccountSettings'

export default function ClientSettingsDrawer({
  open,
  onClose,
  clientUserId,
  clientProfile,
  viewerRole = 'admin',
  onProfileSaved,
  dangerZone,        // optional node rendered under a "Danger zone" heading (e.g. Delete)
}) {
  // Close on Esc — standard drawer affordance.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open so the page underneath doesn't
  // scroll when the user scrolls the drawer content.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-background shadow-2xl animate-rise"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {clientProfile?.full_name ? `${clientProfile.full_name}'s Settings` : 'Client Settings'}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {viewerRole === 'admin'
                ? 'Edit on behalf of this client. Changes take effect immediately.'
                : 'Read-only view of this client\'s settings.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — renders the shared AccountSettings in target-user mode.
            Path B refactor (May 26 2026): AccountSettings is the ONE
            source of truth for the settings UI across 4 surfaces
            (end-user /profile, admin /admin/profile, coach /coach/profile,
            and admin-editing-client here). Passing targetUserId flips
            the relevant tabs into target-aware mode automatically. */}
        <div className="p-5">
          {clientProfile ? (
            <AccountSettings
              profile={clientProfile}
              user={{ id: clientUserId, email: clientProfile?.email }}
              targetUserId={clientUserId}
              viewerRole={viewerRole}
              onProfileSaved={onProfileSaved}
            />
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading client profile…
            </div>
          )}

          {/* Danger zone — destructive account actions (Delete) live here now,
              out of the everyday profile-card flow. The action itself is owned
              by the parent and passed in as a node. */}
          {dangerZone && (
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">Danger zone</h3>
              {dangerZone}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
