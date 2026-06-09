/**
 * Admin's own profile page
 * Route: /admin/profile
 *
 * Reuses the SAME AccountSettings component (Account / Preferences / Security /
 * About) end-users and coaches see, scoped to the admin's own account via
 * useAuth() — byte-for-byte parity with what a client sees on theirs.
 *
 * The admin's Macro Plan moved OUT of here (Jun 9 2026) into the "My Profile"
 * self-view (/admin/me → AdminUserDetail in self-mode, Calories tab). So this
 * page is now purely account settings — the old Settings | Macro Plan tab bar
 * is gone (single content, no tab bar needed).
 */
import { useAuth } from '../../contexts/AuthContext'
import AccountSettings from '../../components/AccountSettings'

export default function AdminProfile() {
  const { user, profile: ctxProfile } = useAuth()

  // Merge the live auth-context profile with user.email so AccountSettings can
  // read it. ProfileTab / SettingsTab pull from useAuth() directly, so saves
  // propagate automatically.
  const profile = ctxProfile ? { ...ctxProfile, email: user?.email } : null

  if (!profile) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-4">
      {/* Page header — mirrors CoachProfile's "Account Settings" pattern
          (LOCKED May 26 2026 per the admin↔coach mirror rule). */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your account and your settings.
        </p>
      </div>

      <AccountSettings profile={profile} user={user} />
    </div>
  )
}
