/**
 * Account Settings — shared 4-tab layout used by /admin/profile and /coach/profile.
 *
 * Mirrors the mobile profile.tsx tab structure (Account / Preferences /
 * Security / Connect / About — see mobile/app/(app)/profile.tsx) and
 * keeps only the surfaces that make sense on web for admins and coaches:
 *
 *   • Account      — name / email / phone / gender / DOB / avatar / weight /
 *                    height. Reuses the existing ProfileTab from
 *                    EditProfile.jsx for 1:1 parity with the end-user
 *                    /profile page.
 *   • Preferences  — display units (weight / height / distance / fluid) +
 *                    date format + body composition (silhouette picker) +
 *                    theme + Enter-to-send. Swim unit follows distance
 *                    (no standalone toggle, matching the client app).
 *                    Meal layout still pending (extract from EditProfile).
 *   • Security     — change password. Mobile additionally has biometric
 *                    and lock-app toggles, but those are mobile-only.
 *   • About        — legal docs + app version + support email. Identical
 *                    content on both surfaces.
 *
 * Connect (wearable integrations like Samsung Health) is mobile-only and
 * has no web equivalent — intentionally absent.
 *
 * Pattern: each tab is a small inline subcomponent; the parent renders
 * the tab bar and the active tab body. Tab bar styling mirrors AdminProfile's
 * existing 2-tab pattern (rounded outer container, inner pills with
 * primary-on-active) so the visual feels native to the admin chrome.
 */

import { useState, useRef } from 'react'
import { Link } from 'wouter'
import {
  AlertCircle, Check, Loader2, Lock, Sun, Moon, ExternalLink,
  Shield, Sliders, User, Info, Eye, EyeOff, Clock,
  Camera, Trash2, Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { ProfileTab } from '../pages/EditProfile'
import { friendlyAuthMessage } from '../lib/authErrors'
import { usePersistedState } from '../hooks/usePersistedState'
import BodyCompPicker from './BodyCompPicker'
import AvatarCropper from './AvatarCropper'
import MealLayoutEditor from './MealLayoutEditor'

// LocalStorage key shared with EditProfile.jsx / ChatDrawer.jsx so the
// preference persists across the same browser regardless of which
// surface set it.
const ENTER_KEY = 'myrx_enter_to_send'

const TABS = [
  { id: 'account',     label: 'Account',     icon: User     },
  { id: 'preferences', label: 'Preferences', icon: Sliders  },
  { id: 'security',    label: 'Security',    icon: Shield   },
  { id: 'about',       label: 'About',       icon: Info     },
]

function TabButton({ active, onClick, children, Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 min-w-fit whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}

// ── Preferences tab — full mobile parity ────────────────────────────────────
//
// Layout (mirrors mobile/app/(app)/profile.tsx PreferencesTab):
//   1. Preferred units card — Imperial | Metric column headers above the
//      unit cards. Swim distance is yd | m (imperial first), matching the
//      column-order rule on every row.
//   2. Body stats card — current weight + current height inputs.
//      (Body composition picker is mobile-only for now; web doesn't have
//      a BodyCompPicker component ported yet. A small note replaces it.)
//   3. Meal layout — DEFERRED for the admin/coach AccountSettings shell.
//      The full meal-layout editor (reorderable slots, custom add, preset
//      chips) lives in EditProfile.jsx and is only relevant for users who
//      actually log their own meals. Out of scope for the
//      shared-with-admin/coach version per the "necessary intersection"
//      brief.
//   4. Appearance — theme toggle (dark / light). Web-only addition.
//   5. Chat — Enter-to-send (matches mobile exactly).
//
// All five sections persist via the single Save button at the bottom —
// same UX as mobile (no immediate-save side effects).

function PreferencesTab({ profile, user, targetUserId = null, viewerRole = 'self' }) {
  // Path B refactor (May 26 2026):
  // When targetUserId is set, admin/coach is editing another user's
  // preferences. Save handlers write to the TARGET profile id; we skip
  // refreshProfile (that refreshes the LOGGED-IN user's profile, not
  // the target's); and per-device prefs (theme, enter-to-send) are
  // hidden because they're scoped to the viewer's browser, not the
  // target user's account.
  const effectiveUserId = targetUserId || user?.id
  const isTargetMode    = !!targetUserId
  const showPerDevice   = viewerRole === 'self'

  const { refreshProfile } = useAuth()
  const { theme, toggle }  = useTheme()

  // ── Unit state ────────────────────────────────────────────────────────────
  const [weightUnit,   setWeightUnit]   = useState(profile?.weight_unit    || 'lb')
  const [heightUnit,   setHeightUnit]   = useState(profile?.height_unit    || 'imperial')
  const [distanceUnit, setDistanceUnit] = useState(profile?.distance_unit  || 'mi')
  const [fluidUnit,    setFluidUnit]    = useState(profile?.fluid_unit     || 'oz')
  const [dateFormat,   setDateFormat]   = useState(profile?.date_format    || 'mdy')

  // ── Body stats state ──────────────────────────────────────────────────────
  // Mirror the mobile PreferencesTab's body-stats card. Heights split into
  // ft + in vs cm based on the active unit.
  const [currentWeight, setCurrentWeight] = useState(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )
  const initialH = heightToDisplay(profile?.current_height, profile?.height_unit || 'imperial')
  const [heightFt, setHeightFt] = useState(initialH.ft)
  const [heightIn, setHeightIn] = useState(initialH.inPart)
  const [heightCm, setHeightCm] = useState(initialH.cm)
  const [bodyFatBand, setBodyFatBand] = useState(profile?.body_fat_band || 'average')

  // ── Per-device preference ─────────────────────────────────────────────────
  const [enterToSend, setEnterToSend] = useState(() => localStorage.getItem(ENTER_KEY) !== 'false')

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  // Convert weight when the unit toggles so the displayed value stays
  // roughly equivalent in real terms — matches mobile's behaviour.
  function handleWeightUnitChange(newUnit) {
    if (newUnit !== weightUnit && currentWeight) {
      const val = parseFloat(currentWeight)
      if (!isNaN(val) && val > 0) {
        const converted = newUnit === 'kg'
          ? Math.round(val * 0.453592 * 10) / 10
          : Math.round(val / 0.453592 * 10) / 10
        setCurrentWeight(String(converted))
      }
    }
    setWeightUnit(newUnit)
  }

  function handleHeightUnitChange(newUnit) {
    if (newUnit !== heightUnit) {
      if (newUnit === 'metric') {
        const ft = parseFloat(heightFt) || 0
        const inches = parseFloat(heightIn) || 0
        const totalIn = ft * 12 + inches
        if (totalIn > 0) setHeightCm(String(Math.round(totalIn * 2.54)))
      } else {
        const cm = parseFloat(heightCm)
        if (!isNaN(cm) && cm > 0) {
          const totalIn = cm / 2.54
          setHeightFt(String(Math.floor(totalIn / 12)))
          setHeightIn(String(Math.round(totalIn % 12)))
        }
      }
    }
    setHeightUnit(newUnit)
  }

  function getStoredHeight() {
    if (heightUnit === 'imperial') {
      const ft = parseFloat(heightFt) || 0
      const inches = parseFloat(heightIn) || 0
      const total = ft * 12 + inches
      return total > 0 ? total : null
    }
    const cm = parseFloat(heightCm)
    return isNaN(cm) || cm <= 0 ? null : cm
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const newWeight = currentWeight ? parseFloat(currentWeight) : null
      const newHeight = getStoredHeight()

      const { error: err } = await supabase
        .from('profiles')
        .update({
          weight_unit:    weightUnit,
          height_unit:    heightUnit,
          distance_unit:  distanceUnit,
          // Swim unit follows distance (mi→yd, km→m) — the client app dropped
          // the standalone swim toggle May 2026; we mirror that here.
          swim_unit:      distanceUnit === 'mi' ? 'yd' : 'm',
          fluid_unit:     fluidUnit,
          date_format:    dateFormat,
          body_fat_band:  bodyFatBand,
          current_weight: newWeight,
          current_height: newHeight,
        })
        .eq('id', effectiveUserId)
      if (err) throw err

      // Auto-weighin if the weight meaningfully changed — same threshold
      // as mobile (>50 g once normalised to kg).
      if (newWeight && newWeight > 0) {
        const newKg = weightUnit === 'kg' ? newWeight : newWeight * 0.453592
        const oldKg = profile?.current_weight != null
          ? (profile.weight_unit === 'kg' ? profile.current_weight : profile.current_weight * 0.453592)
          : null
        const changed = oldKg === null || Math.abs(newKg - oldKg) > 0.05
        if (changed) {
          await supabase.from('bodyweight').insert({
            user_id: effectiveUserId, weight: newWeight, unit: weightUnit,
          })
        }
      }

      // Refresh the LOGGED-IN user's profile only when editing self. In
      // target mode, the admin's own profile didn't change — refreshing
      // would either no-op or pull the wrong data.
      if (!isTargetMode) await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(friendlyAuthMessage(err, 'Could not save preferences.'))
    } finally {
      setSaving(false)
    }
  }

  function handleEnterToggle() {
    const next = !enterToSend
    setEnterToSend(next)
    localStorage.setItem(ENTER_KEY, String(next))
    // Custom event so other surfaces (ChatDrawer in same tab) pick up the
    // change without needing a full reload. StorageEvent doesn't fire in
    // the same tab — only other tabs.
    window.dispatchEvent(new CustomEvent('myrx_signal', { detail: { type: 'enter_to_send', value: next } }))
  }

  const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
  const suffixCls = 'shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground'

  return (
    <form onSubmit={handleSave} className="space-y-5">

      {/* Preferred units — Imperial | Metric column headers above every row.
          Column headers stay accurate because every row below uses the
          SAME order: imperial-left, metric-right. The May 24 2026 mobile
          refactor added these headers and flipped swim from [m, yd] to
          [yd, m] to match. */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Preferred units</p>

        <div className="grid grid-cols-2 gap-2 px-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 text-center">Imperial</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 text-center">Metric</p>
        </div>

        <UnitRow
          label="Weight"
          left={{  value: 'lb', label: 'lb',     sub: 'Pounds'       }}
          right={{ value: 'kg', label: 'kg',     sub: 'Kilograms'    }}
          active={weightUnit}
          onChange={handleWeightUnitChange}
        />
        <UnitRow
          label="Height"
          left={{  value: 'imperial', label: 'ft & in', sub: 'Feet & inches' }}
          right={{ value: 'metric',   label: 'cm',      sub: 'Centimetres'   }}
          active={heightUnit}
          onChange={handleHeightUnitChange}
        />
        <UnitRow
          label="Distance"
          left={{  value: 'mi', label: 'mi',     sub: 'Miles'        }}
          right={{ value: 'km', label: 'km',     sub: 'Kilometres'   }}
          active={distanceUnit}
          onChange={setDistanceUnit}
        />
        <UnitRow
          label="Fluid"
          left={{  value: 'oz', label: 'oz',     sub: 'Ounces'       }}
          right={{ value: 'mL', label: 'mL',     sub: 'Millilitres'  }}
          active={fluidUnit}
          onChange={setFluidUnit}
        />
      </div>

      {/* Date format — not an imperial/metric pair, so it sits in its own
          section. Mirrors the client app's MM/DD vs DD/MM segmented control. */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Date format</p>
        <div className="grid grid-cols-2 gap-2">
          <UnitCard opt={{ label: 'MM / DD', sub: 'Month first' }} active={dateFormat === 'mdy'} onClick={() => setDateFormat('mdy')} />
          <UnitCard opt={{ label: 'DD / MM', sub: 'Day first'   }} active={dateFormat === 'dmy'} onClick={() => setDateFormat('dmy')} />
        </div>
      </div>

      {/* Body stats — current weight + current height. Body composition
          picker is mobile-only at the moment (no BodyCompPicker on web yet);
          a small note tells the user to set it from the mobile app. */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Body stats</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Current weight</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                value={currentWeight}
                onChange={e => setCurrentWeight(e.target.value)}
                placeholder="0.0"
                className={inputCls}
              />
              <span className={suffixCls}>{weightUnit}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Current height</label>
            {heightUnit === 'imperial' ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="8"
                    value={heightFt}
                    onChange={e => setHeightFt(e.target.value)}
                    placeholder="5"
                    className={inputCls}
                  />
                  <span className={suffixCls}>ft</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="11"
                    value={heightIn}
                    onChange={e => setHeightIn(e.target.value)}
                    placeholder="10"
                    className={inputCls}
                  />
                  <span className={suffixCls}>in</span>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={heightCm}
                  onChange={e => setHeightCm(e.target.value)}
                  placeholder="175"
                  className={inputCls}
                />
                <span className={suffixCls}>cm</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Body composition</label>
            <BodyCompPicker
              value={bodyFatBand}
              onChange={setBodyFatBand}
              gender={profile?.gender}
              footnote="The Calories plan uses this to estimate body-fat-aware targets."
            />
          </div>
        </div>
      </div>

      {/* Meal layout — default meal slots for new days. Shared editor (same
          one the end-user /profile Settings uses). Writes to the effective
          user (the client in target mode). It has its own Save button, so it
          sits outside the page-level "Save preferences" submit below. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Meal layout</p>
          <p className="text-[11px] text-muted-foreground">Default for new days</p>
        </div>
        <MealLayoutEditor
          profile={profile}
          effectiveUserId={effectiveUserId}
          refreshOnSave={!isTargetMode}
          note={isTargetMode
            ? "Removing a custom slot only removes it from the client's default layout — past food entries logged under that slot are preserved."
            : 'Removing a custom slot only removes it from your default layout — past food entries logged under that slot are preserved and will still appear when you view those days.'}
        />
      </div>

      {/* Appearance + Chat sections — both are PER-DEVICE preferences
          (theme via ThemeContext localStorage; Enter-to-send via
          ENTER_KEY localStorage). They make sense for self-editing
          only — when an admin/coach is viewing a CLIENT's preferences,
          toggling these would change the ADMIN's own browser settings,
          not the client's. Hidden in target mode for that reason. */}
      {showPerDevice && (
        <>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Appearance</p>
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card/40 hover:bg-accent/40 px-4 py-3 transition-colors"
            >
              <div className="text-left">
                <div className="text-sm font-semibold text-foreground">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Click to switch</div>
              </div>
              {theme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Chat</p>
            <button
              type="button"
              onClick={handleEnterToggle}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card/40 hover:bg-accent/40 px-4 py-3 transition-colors"
            >
              <div className="text-left">
                <div className="text-sm font-semibold text-foreground">
                  {enterToSend ? 'Enter to send' : 'Enter for new line'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {enterToSend
                    ? 'Press Enter to send · Shift+Enter for a new line'
                    : 'Press Enter for a new line · Shift+Enter to send'}
                </div>
              </div>
              <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                enterToSend ? 'bg-primary' : 'bg-muted'
              }`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  enterToSend ? 'translate-x-5' : 'translate-x-1'
                }`} />
              </span>
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {saved   ? <><Check   className="h-4 w-4" /> Saved</>
        : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        : 'Save preferences'}
      </button>
    </form>
  )
}

// Helper — convert stored height (raw number in either inches or cm) into
// display-ready ft/in/cm strings. Mirrors heightToDisplay in EditProfile.jsx.
function heightToDisplay(storedH, heightUnit) {
  if (storedH == null || storedH === '') return { ft: '', inPart: '', cm: '' }
  if (heightUnit === 'imperial') {
    const totalIn = Math.round(Number(storedH))
    return { ft: String(Math.floor(totalIn / 12)), inPart: String(totalIn % 12), cm: '' }
  }
  return { ft: '', inPart: '', cm: String(storedH) }
}

// UnitRow — Imperial-left / Metric-right pair, matching mobile.
function UnitRow({ label, left, right, active, onChange }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <UnitCard opt={left}  active={active === left.value}  onClick={() => onChange(left.value)} />
        <UnitCard opt={right} active={active === right.value} onClick={() => onChange(right.value)} />
      </div>
    </div>
  )
}

function UnitCard({ opt, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border py-3 px-4 text-left transition-all duration-200 ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/40 hover:bg-accent/40'
      }`}
    >
      <div className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{opt.label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{opt.sub}</div>
    </button>
  )
}

// ── Security tab — chat privacy + change password ──────────────────────────
//
// Chat privacy toggles (added per coach/admin clarification — they DO have
// clients who'd see them online and want the option to hide):
//   • Show online status — when off, clients see you as offline even when
//     you're actively on the platform.
//   • Show last-seen      — when off, clients don't see "last seen X
//                            minutes ago" on the chat avatar.
//
// Save-on-tap (no Save button) — matches mobile's SecurityTab pattern.
// Each toggle UPDATEs the profile row immediately.
//
// Mobile-only items intentionally absent: biometric sign-in toggle, lock-
// app-with-fingerprint toggle. A small note at the bottom tells the user
// to set those from the mobile app.

function SecurityTab({ profile, user, targetUserId = null, viewerRole = 'self' }) {
  // Path B refactor — see PreferencesTab for the full mode-branching
  // rationale. SecurityTab specifics:
  //   • Chat privacy toggles: save to TARGET id when set; skip
  //     refreshProfile (target ≠ logged-in user).
  //   • Change password form: HIDDEN in admin mode. Replaced by
  //     admin support actions (Send password reset, Send email-change
  //     link, Disable biometric stub, Sign out everywhere stub).
  //     Reason: the change-password flow re-auths via signInWithPassword
  //     using the LOGGED-IN user's credentials, which admin doesn't
  //     have for the client.
  const effectiveUserId = targetUserId || user?.id
  const isTargetMode    = !!targetUserId
  const isAdminMode     = viewerRole === 'admin'

  const { refreshProfile } = useAuth()

  // ── Chat privacy state ───────────────────────────────────────────────────
  // Both flags default to TRUE if the profile column hasn't been set yet —
  // matches the existing app behaviour (clients see online/last-seen until
  // the user opts out).
  const [shareOnline,    setShareOnline]    = useState(profile?.share_online_status ?? true)
  const [shareLastSeen,  setShareLastSeen]  = useState(profile?.share_last_seen     ?? true)
  const [shareSaving,    setShareSaving]    = useState(null)  // 'online' | 'last_seen' | null
  const [shareError,     setShareError]     = useState('')

  async function toggleShareOnline() {
    if (shareSaving) return
    const next = !shareOnline
    setShareOnline(next)
    setShareSaving('online')
    setShareError('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ share_online_status: next })
        .eq('id', effectiveUserId)
      if (error) throw error
      if (!isTargetMode) await refreshProfile()
    } catch (err) {
      // Revert on failure
      setShareOnline(!next)
      setShareError(friendlyAuthMessage(err, 'Could not save.'))
    } finally {
      setShareSaving(null)
    }
  }

  async function toggleShareLastSeen() {
    if (shareSaving) return
    const next = !shareLastSeen
    setShareLastSeen(next)
    setShareSaving('last_seen')
    setShareError('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ share_last_seen: next })
        .eq('id', effectiveUserId)
      if (error) throw error
      if (!isTargetMode) await refreshProfile()
    } catch (err) {
      setShareLastSeen(!next)
      setShareError(friendlyAuthMessage(err, 'Could not save.'))
    } finally {
      setShareSaving(null)
    }
  }

  // ── Change password state ────────────────────────────────────────────────
  const [current, setCurrent] = useState('')
  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')

  const [busy,    setBusy]    = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!current || !next || !confirm) { setError('Fill in all three fields.'); return }
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (next !== confirm) { setError('New passwords do not match.'); return }
    if (next === current) { setError('Your new password must be different from the current one.'); return }

    setBusy(true)
    try {
      // Re-auth: signInWithPassword with the email + current password verifies
      // the user knows the password before we let them change it. Standard
      // Supabase pattern — there's no built-in "verify current password"
      // endpoint, but signInWithPassword serves the same purpose.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      })
      if (signInErr) { setError('Current password is incorrect.'); setBusy(false); return }

      const { error: updateErr } = await supabase.auth.updateUser({ password: next })
      if (updateErr) { setError(friendlyAuthMessage(updateErr, 'Could not update password.')); setBusy(false); return }

      setDone(true)
      setCurrent(''); setNext(''); setConfirm('')
      setTimeout(() => setDone(false), 3000)
    } catch (err) {
      setError(friendlyAuthMessage(err, 'Could not update password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Chat privacy — save-on-tap toggles. Both default to ON; flip off
          to hide the indicator from clients. Lives on the Security tab
          per the May 17 2026 mobile refactor (privacy ACLs aren't
          preferences). */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Chat privacy</p>
        <div className="rounded-xl border border-border bg-card/40 divide-y divide-border">
          <PrivacyRow
            icon={Eye}
            title="Show online status"
            sub={shareOnline
              ? 'Clients see a green dot when you’re active on MyRX.'
              : 'You appear offline to clients even while signed in.'}
            on={shareOnline}
            saving={shareSaving === 'online'}
            onToggle={toggleShareOnline}
          />
          <PrivacyRow
            icon={Clock}
            title="Show last seen"
            sub={shareLastSeen
              ? 'Clients see "Last seen 5 min ago" on your avatar.'
              : 'Your last-seen time is hidden from clients.'}
            on={shareLastSeen}
            saving={shareSaving === 'last_seen'}
            onToggle={toggleShareLastSeen}
          />
        </div>
        {shareError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{shareError}</span>
          </div>
        )}
      </div>

      {/* Change password — SELF MODE ONLY. The flow re-auths via
          signInWithPassword using the logged-in user's email + current
          password, then calls updateUser. Neither works for admin-
          editing-client (admin doesn't have the client's password, and
          updateUser operates on the JWT-session user). Replaced in
          admin mode by support actions below. */}
      {!isTargetMode && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Change password</p>
          <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Current password</label>
              <input
                type="password"
                value={current}
                onChange={e => setCurrent(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">New password</label>
              <input
                type="password"
                value={next}
                onChange={e => setNext(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
              />
              <p className="text-[11px] text-muted-foreground mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
              />
            </div>
          </div>
        </div>
      )}

      {/* Admin support actions — ONLY in admin mode. The change-password
          UI above is hidden; these are the safe-to-do-on-behalf
          equivalents. Send password reset + Send email-change both
          fire the existing Supabase auth reset-email flow (client
          confirms via their inbox). Disable biometric + Sign out
          everywhere are stubbed pending edge-function backends. */}
      {isAdminMode && (
        <AdminSupportActions profile={profile} />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {!isTargetMode && (
        <>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {done ? <><Check className="h-4 w-4" /> Password updated</>
            : busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</>
            : <><Lock className="h-4 w-4" /> Update password</>}
          </button>

          <p className="text-[11px] text-muted-foreground text-center">
            Biometric sign-in and screen-lock options are managed in the MyRX mobile app.
          </p>
        </>
      )}
    </form>
  )
}

// ── AdminSupportActions — Security-tab admin replacement ────────────────
// When viewerRole='admin' on AccountSettings, the Change-password section
// is replaced with these support actions, all live:
//   • Send password reset / email-change link — Supabase auth API.
//   • Disable fingerprint on all devices — sets profiles.biometric_disabled_at;
//     the mobile app clears its on-device biometric + lock on next launch.
//   • Sign out everywhere — admin_revoke_user_sessions RPC (SECURITY DEFINER,
//     is_admin()-gated) deletes the client's auth.sessions rows.

function AdminSupportActions({ profile }) {
  const [pwState,    setPwState]    = useState('idle')
  const [emailState, setEmailState] = useState('idle')
  const [bioState,   setBioState]   = useState('idle')
  const [sessState,  setSessState]  = useState('idle')

  async function sendPasswordReset() {
    if (!profile?.email) return
    setPwState('sending')
    // Check the result — Supabase can rate-limit or reject. Showing "Sent ✓"
    // on a failed send would lie to the admin about an email that never went.
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email)
    setPwState(error ? 'error' : 'sent')
    setTimeout(() => setPwState('idle'), 4000)
  }

  async function sendEmailChange() {
    if (!profile?.email) return
    setEmailState('sending')
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/auth?mode=update-email`,
    })
    setEmailState(error ? 'error' : 'sent')
    setTimeout(() => setEmailState('idle'), 4000)
  }

  // Disable fingerprint on all devices — sets a server flag; the mobile app
  // clears its on-device biometric + app lock on next launch (Phase 5).
  async function disableBiometric() {
    if (!profile?.id) return
    setBioState('sending')
    const { error } = await supabase
      .from('profiles')
      .update({ biometric_disabled_at: new Date().toISOString() })
      .eq('id', profile.id)
    setBioState(error ? 'error' : 'sent')
    setTimeout(() => setBioState('idle'), 4000)
  }

  // Sign out everywhere — revokes all the client's sessions (refresh tokens
  // die now; access tokens expire within ~1h) via a SECURITY DEFINER RPC.
  async function signOutEverywhere() {
    if (!profile?.id) return
    setSessState('sending')
    const { error } = await supabase.rpc('admin_revoke_user_sessions', { p_user_id: profile.id })
    setSessState(error ? 'error' : 'sent')
    setTimeout(() => setSessState('idle'), 4000)
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Support actions</p>

      <SupportActionRow
        icon={Lock}
        title="Send password reset email"
        description="Sends a reset link to the client's email. They tap it to set a new password."
        buttonLabel="Send reset link"
        onClick={sendPasswordReset}
        state={pwState}
        disabled={!profile?.email}
      />

      <SupportActionRow
        icon={ExternalLink}
        title="Send email-change link"
        description="Sends a one-time link the client uses to change the email address on their account."
        buttonLabel="Send change link"
        onClick={sendEmailChange}
        state={emailState}
        disabled={!profile?.email}
      />

      <SupportActionRow
        icon={Shield}
        title="Disable fingerprint on all devices"
        description="Clears the saved fingerprint / face sign-in on every device the client uses. They'll need to re-enable it from Settings → Security on their phone."
        buttonLabel="Disable fingerprint"
        successLabel="Done"
        onClick={disableBiometric}
        state={bioState}
        disabled={!profile?.id}
      />

      <SupportActionRow
        icon={Lock}
        title="Sign out everywhere"
        description="Ends all the client's active sessions on web and mobile — they'll need to sign in again. Active app sessions drop within the hour."
        buttonLabel="Sign out everywhere"
        successLabel="Done"
        onClick={signOutEverywhere}
        state={sessState}
        disabled={!profile?.id}
      />

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          To deactivate the account entirely (block sign-in while preserving data), use the
          <span className="font-semibold text-foreground"> Active/Inactive </span>
          toggle on the profile card. To permanently delete, use the
          <span className="font-semibold text-destructive"> Delete </span> button.
        </p>
      </div>
    </div>
  )
}

function SupportActionRow({ icon: Icon, title, description, buttonLabel, successLabel = 'Sent', onClick, state, disabled }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || state === 'sending' || state === 'sent'}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === 'sending' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
        : state === 'sent'   ? <><Check   className="h-3.5 w-3.5 text-emerald-400" /> {successLabel}</>
        : state === 'error'  ? <><AlertCircle className="h-3.5 w-3.5 text-destructive" /> Failed — try again</>
        : buttonLabel}
      </button>
    </div>
  )
}

// ── PrivacyRow — save-on-tap toggle with optimistic UI + saving spinner ──

function PrivacyRow({ icon: Icon, title, sub, on, saving, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={saving}
      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors disabled:opacity-60"
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
      ) : (
        <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-primary' : 'bg-muted'
        }`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </span>
      )}
    </button>
  )
}

// ── About tab — legal docs + version + support ───────────────────────────────

const APP_VERSION = '1.0.0'  // Bump when shipping production releases

function AboutTab({ profile }) {
  // Coach-specific docs only render for users with a coach role (coaches
  // signed up via /coach/signup, OR superusers who manage the platform).
  // Athletes don't see Coach Agreement / DPA in their About — those are
  // B2B docs that don't apply to them. Mirrors the mobile About page
  // (mobile/app/(app)/about.tsx) which uses the same is_coach gate.
  const showCoachDocs = profile?.is_coach === true || profile?.is_superuser === true

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">How It Works</p>
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
          <LegalRow href="/how-we-compute" label="How We Compute Your Numbers" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Legal</p>
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden divide-y divide-border">
          <LegalRow href="/terms"              label="Terms of Service"            />
          <LegalRow href="/privacy"            label="Privacy Policy"               />
          <LegalRow href="/cookies"            label="Cookie Policy"                />
          <LegalRow href="/acceptable-use"     label="Acceptable Use Policy"        />
          <LegalRow href="/health-disclaimer"  label="Health & Medical Disclaimer"  />
          <LegalRow href="/refund-policy"      label="Refund Policy"                />
        </div>
      </div>

      {showCoachDocs && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Coach Platform</p>
          <div className="rounded-xl border border-border bg-card/40 overflow-hidden divide-y divide-border">
            <LegalRow href="/coach-agreement" label="Coach Agreement"           />
            <LegalRow href="/dpa"             label="Data Processing Agreement" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Support</p>
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <p className="text-sm text-foreground mb-1">Need help?</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Email us at <a href="mailto:team@myrxfit.com" className="text-primary hover:underline">team@myrxfit.com</a>.
            We typically reply within one business day.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">About</p>
        <div className="rounded-xl border border-border bg-card/40 p-4 text-xs text-muted-foreground space-y-1">
          <div className="flex items-center justify-between">
            <span>MyRX — Performance Lab</span>
            <span className="font-mono">v{APP_VERSION}</span>
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            © {new Date().getFullYear()} Northern Princess LLC. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  )
}

function LegalRow({ href, label }) {
  return (
    <Link href={href}>
      <a className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors">
        <span className="text-sm text-foreground">{label}</span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </a>
    </Link>
  )
}

// ── TargetAccountTab — admin-editing-client Account form ───────────────────
// Used when targetUserId is set on AccountSettings (admin in the
// Client Settings drawer). The auth-bound ProfileTab from EditProfile.jsx
// is self-only — it does email verify, phone OTP, avatar upload via
// useAuth.uploadAvatar. None of that works for admin-editing-client
// (admin can't OTP-verify on the client's behalf). This component
// covers the fields admin CAN safely edit directly: name / phone /
// gender / DOB / weight / height. Email is read-only — to change it,
// admin uses the Security tab's "Send email-change link" support action.

function TargetAccountTab({ profile, targetUserId, onSaved }) {
  const [fullName,      setFullName]      = useState(profile?.full_name || '')
  const [gender,        setGender]        = useState(profile?.gender    || '')
  const [birthdate,     setBirthdate]     = useState(profile?.birthdate || '')
  const [phone,         setPhone]         = useState(profile?.phone     || '')
  const [currentWeight, setCurrentWeight] = useState(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )

  // Avatar — admin sets/replaces/removes the client's profile photo.
  const [avatarUrl,  setAvatarUrl]  = useState(profile?.avatar_url || '')
  const [cropFile,   setCropFile]   = useState(null)   // raw picked File → cropper
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarErr,  setAvatarErr]  = useState('')
  const fileInputRef = useRef(null)

  // Phone — admin changes the number + texts the client a code; the client
  // enters it in their app to verify. phoneVerified/phoneChanged drive the badge.
  const [phoneCode, setPhoneCode] = useState('idle')   // idle|sending|sent|error
  const phoneVerified = !!profile?.phone_verified_at
  const phoneChanged  = phone.trim() !== (profile?.phone || '')

  const weightUnit = profile?.weight_unit || 'lb'
  const heightUnit = profile?.height_unit || 'imperial'
  const initialH   = heightToDisplay(profile?.current_height, heightUnit)
  const [heightFt, setHeightFt] = useState(initialH.ft)
  const [heightIn, setHeightIn] = useState(initialH.inPart)
  const [heightCm, setHeightCm] = useState(initialH.cm)

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  function getStoredHeight() {
    if (heightUnit === 'imperial') {
      const ft  = parseFloat(heightFt) || 0
      const ins = parseFloat(heightIn) || 0
      const total = ft * 12 + ins
      return total > 0 ? total : null
    }
    const cm = parseFloat(heightCm)
    return isNaN(cm) || cm <= 0 ? null : cm
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const newWeight = currentWeight ? parseFloat(currentWeight) : null
      const updates = {
        full_name:      fullName.trim() || null,
        gender:         gender || null,
        birthdate:      birthdate || null,
        phone:          phone.trim() || null,
        current_weight: newWeight,
        current_height: getStoredHeight(),
      }
      // Changing the number invalidates verification — the client re-verifies
      // the new number from their own device (admin sends them the code).
      if (phone.trim() !== (profile?.phone || '')) updates.phone_verified_at = null
      const { error: err } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', targetUserId)
      if (err) throw err

      // Auto weigh-in on meaningful weight change (mirrors PreferencesTab).
      if (newWeight && newWeight > 0) {
        const newKg = weightUnit === 'kg' ? newWeight : newWeight * 0.453592
        const oldKg = profile?.current_weight != null
          ? (profile.weight_unit === 'kg' ? profile.current_weight : profile.current_weight * 0.453592)
          : null
        const changed = oldKg === null || Math.abs(newKg - oldKg) > 0.05
        if (changed) {
          await supabase.from('bodyweight').insert({
            user_id: targetUserId, weight: newWeight, unit: weightUnit,
          })
        }
      }

      onSaved?.(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  // Avatar — upload the cropped 512² blob to the CLIENT's folder. The
  // "Admins can ... any avatar" storage policy authorises writing another
  // user's folder; useAuth.uploadAvatar is self-bound, so we write directly.
  async function applyAvatar(blob) {
    setAvatarBusy(true); setAvatarErr('')
    try {
      const path = `${targetUserId}/avatar`
      const { error: upErr } = await supabase.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${data.publicUrl}?t=${Date.now()}`
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', targetUserId)
      if (dbErr) throw dbErr
      setAvatarUrl(url); setCropFile(null); onSaved?.({ avatar_url: url })
    } catch (e) {
      setAvatarErr(e.message || 'Could not update photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true); setAvatarErr('')
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', targetUserId)
      if (error) throw error
      setAvatarUrl(''); onSaved?.({ avatar_url: null })
    } catch (e) {
      setAvatarErr(e.message || 'Could not remove photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  // Send an OTP to the (typed) number via Twilio Verify. The client enters
  // it in their own app's "verify phone" flow — admin can't complete it for them.
  async function sendPhoneCode() {
    const p = phone.trim()
    if (!/^\+[1-9]\d{6,14}$/.test(p)) { setPhoneCode('error'); setTimeout(() => setPhoneCode('idle'), 4000); return }
    setPhoneCode('sending')
    const { data, error } = await supabase.functions.invoke('send-phone-otp', { body: { phone: p } })
    setPhoneCode(error || data?.error ? 'error' : 'sent')
    setTimeout(() => setPhoneCode('idle'), 4000)
  }

  const inputCls  = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
  const suffixCls = 'shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground'

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Profile photo — pick → crop (512²) → upload to the client's folder */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Profile photo</label>
        {cropFile ? (
          <AvatarCropper file={cropFile} onApply={applyAvatar} onCancel={() => setCropFile(null)} />
        ) : (
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted/40 flex items-center justify-center">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="h-16 w-16 object-cover" />
                : <User className="h-7 w-7 text-muted-foreground/50" />}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={avatarBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent transition-colors disabled:opacity-50">
                {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {avatarUrl ? 'Change' : 'Upload'}
              </button>
              {avatarUrl && (
                <button type="button" onClick={removeAvatar} disabled={avatarBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = '' }} />
          </div>
        )}
        {avatarErr && <p className="mt-1.5 text-[11px] text-destructive">{avatarErr}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Full name</label>
        <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Email</label>
        <input type="email" value={profile?.email || ''} disabled className={inputCls + ' opacity-50 cursor-not-allowed'} />
        <p className="mt-1 text-[11px] text-muted-foreground/70">To change, use the Security tab's "Send email-change link" button.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Gender</label>
        <select value={gender} onChange={e => setGender(e.target.value)} className={inputCls + ' cursor-pointer'}>
          <option value="">Not set</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="non-binary">Non-binary</option>
          <option value="prefer-not-to-say">Prefer not to say</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Date of birth</label>
        <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">
          Phone
          {phone.trim() && (phoneVerified && !phoneChanged
            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 normal-case tracking-normal"><Check className="h-3 w-3" /> Verified</span>
            : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 normal-case tracking-normal">Not verified</span>)}
        </label>
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15550000000" className={inputCls} />
        <button type="button" onClick={sendPhoneCode}
          disabled={phoneCode === 'sending' || phoneCode === 'sent' || !phone.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent transition-colors disabled:opacity-50">
          {phoneCode === 'sending' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
          : phoneCode === 'sent'   ? <><Check className="h-3.5 w-3.5 text-emerald-400" /> Code sent</>
          : phoneCode === 'error'  ? <><AlertCircle className="h-3.5 w-3.5 text-destructive" /> Failed — check number</>
          : <><Send className="h-3.5 w-3.5" /> Send code to client</>}
        </button>
        <p className="mt-1.5 text-[11px] text-muted-foreground/70 leading-relaxed">
          Use international format (e.g. +15550000000). Save the number first, then send the code — the client enters it in their app to verify.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Current weight</label>
        <div className="flex gap-2">
          <input type="number" step="0.1" min="0" value={currentWeight} onChange={e => setCurrentWeight(e.target.value)} placeholder="0.0" className={inputCls} />
          <span className={suffixCls}>{weightUnit}</span>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">Current height</label>
        {heightUnit === 'imperial' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-2">
              <input type="number" min="0" max="8" value={heightFt} onChange={e => setHeightFt(e.target.value)} placeholder="5" className={inputCls} />
              <span className={suffixCls}>ft</span>
            </div>
            <div className="flex gap-2">
              <input type="number" min="0" max="11" value={heightIn} onChange={e => setHeightIn(e.target.value)} placeholder="10" className={inputCls} />
              <span className={suffixCls}>in</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input type="number" step="0.1" min="0" value={heightCm} onChange={e => setHeightCm(e.target.value)} placeholder="175" className={inputCls} />
            <span className={suffixCls}>cm</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saved   ? <><Check   className="h-4 w-4" /> Saved</>
        : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        : 'Save'}
      </button>
    </form>
  )
}

// ── Main exported component ─────────────────────────────────────────────────
//
// Path B refactor (May 26 2026): accepts optional `targetUserId` +
// `viewerRole` props to power admin-editing-client mode (rendered from
// ClientSettingsDrawer on the admin client detail page).
//
// Default props ('self' mode, no target) mean ZERO change for the 3
// existing callers — admin's own profile, coach's own profile,
// end-user profile all continue to render the same UI as before.
//
// In admin mode:
//   • About tab is hidden (admin doesn't need to see client's legal-doc links)
//   • Account tab renders TargetAccountTab (not the auth-bound ProfileTab)
//   • Preferences tab saves to target id; hides per-device sections (theme + enter-to-send)
//   • Security tab hides Change-password (auth-bound); shows admin support actions

export default function AccountSettings({ profile, user, targetUserId = null, viewerRole = 'self', onProfileSaved }) {
  const isTargetMode = !!targetUserId
  // Namespace the persisted-tab key so the client-settings drawer (target
  // mode) doesn't share — and on close, wipe — the admin's OWN /admin/profile
  // tab choice. They're never mounted together, so independent keys are safe.
  const [activeTab, setActiveTab] = usePersistedState(
    isTargetMode ? 'myrx:settings_tab:client' : 'myrx:settings_tab',
    'account',
    { clearOnUnmount: true },
  )

  // Tab visibility — About hidden in target/admin modes (legal docs are
  // for the user themselves, not for an admin viewing the user).
  const visibleTabs = TABS.filter(t => {
    if (t.id === 'about' && viewerRole !== 'self') return false
    return true
  })

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="flex gap-1 rounded-xl border border-border bg-muted/20 p-1">
        {visibleTabs.map(t => (
          <TabButton
            key={t.id}
            active={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            Icon={t.icon}
          >
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {activeTab === 'account' && (
          isTargetMode
            ? <TargetAccountTab profile={profile} targetUserId={targetUserId} onSaved={onProfileSaved} />
            : <ProfileTab       profile={profile} user={user} />
        )}
        {activeTab === 'preferences' && (
          <PreferencesTab
            profile={profile} user={user}
            targetUserId={targetUserId} viewerRole={viewerRole}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab
            profile={profile} user={user}
            targetUserId={targetUserId} viewerRole={viewerRole}
          />
        )}
        {activeTab === 'about' && viewerRole === 'self' && <AboutTab profile={profile} />}
      </div>
    </div>
  )
}
