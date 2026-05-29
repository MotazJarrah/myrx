/**
 * InviteDeepLinkHost — global deep-link handler for two URL shapes:
 *
 *   A. Coach invite tokens:
 *      - myrx://accept-invite?token=ABC123...          (custom scheme)
 *      - https://myrxfit.com/coach/accept-invite?token=...  (App Link)
 *      → Opens AcceptInviteModal pre-populated with the invite.
 *
 *   B. Email-confirmation handoff from web AuthConfirm:
 *      - myrx://auth/confirmed?type=signup
 *      → Calls supabase.auth.refreshSession() so the local session
 *        picks up the freshly-set email_confirmed_at. The cross-tab
 *        useEffect in app/(auth)/sign-up.tsx is already watching for
 *        user.email_confirmed_at — once it flips, the signup screen
 *        auto-advances past the OTP step. No additional UI needed
 *        here; the handoff is silent.
 *
 *      Why this exists: Supabase email-confirmation links route
 *      through `supabase.co` first, then 302 to `myrxfit.com`. Android
 *      App Links only intercept the FIRST tap as an intent; the
 *      browser 302 doesn't fire a new intent. So Android opens the
 *      browser instead of the app. After web confirmation succeeds,
 *      AuthConfirm.jsx triggers `window.location = 'myrx://auth/
 *      confirmed?type=signup'` to hand off back to the app. That URL
 *      arrives here.
 *
 * Mounted ONCE at the root layout (inside AuthProvider).
 *
 * On INVITE URL receipt:
 *   - Extract token from query param
 *   - Call preview_coach_invite RPC for metadata (coach name + avatar + msg)
 *   - Build a PendingInvite-shaped object
 *   - Open AcceptInviteModal with it
 *
 * The modal walks the user through the same confirmation flow that the
 * dashboard banner uses, so we get free coach-swap handling, error
 * surfaces, etc. without duplicating UI logic.
 *
 * Edge cases:
 *   - User not signed in → modal can't attach (attach edge fn requires
 *     JWT). For v1 we surface a friendly "Sign in first" prompt.
 *     Stashing the token for post-sign-in attachment is v2 — the
 *     patient-invite email-match path covers it in practice.
 *   - Token is shapeless / preview returns 'invalid' → silently no-op
 *     (don't pop a modal for garbage tokens, e.g. someone forwarded
 *     a stale link)
 *   - Token already accepted / expired / revoked → modal renders the
 *     standard error state on accept attempt; that's fine.
 *
 * Note: when Universal Links / App Links open the app, the OS calls
 * Linking.getInitialURL() (cold start) OR fires the 'url' event on
 * Linking (warm start). We handle both via expo-linking's useURL().
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import * as Linking from 'expo-linking'
import { usePathname } from 'expo-router'

import { useAuth, type PendingInvite } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AcceptInviteModal from './AcceptInviteModal'
import { extractInviteToken } from './CoachInviteCodeCard'

// Token shape sanity — match what the edge function accepts. Skips the
// preview RPC roundtrip for obvious junk (e.g. a malformed URL that
// produces a non-hex token).
const TOKEN_RE = /^[a-f0-9]{32,128}$/i

export default function InviteDeepLinkHost() {
  const { user } = useAuth()
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  // Suppress the modal when the user is already on a route that owns the
  // accept-invite UI. Otherwise the deep link would render both the
  // route's full-page UX AND a modal popover with the same content —
  // confusing at best, double-attempt at worst. Two paths reach the
  // page: /accept-invite (in-app navigation from sign-up) and
  // /coach/accept-invite (Android App Link from the email).
  const pathname = usePathname()
  const onAcceptInviteRoute =
    pathname === '/accept-invite' || pathname === '/coach/accept-invite'

  // Track which tokens we've already processed so the same URL firing
  // twice (cold start + warm start can both deliver it) doesn't pop the
  // modal twice in a row.
  const seenTokensRef = useRef<Set<string>>(new Set())

  const handleToken = useCallback(async (token: string) => {
    if (!token || !TOKEN_RE.test(token)) return
    if (seenTokensRef.current.has(token)) return
    seenTokensRef.current.add(token)

    // Hit the preview RPC to get coach metadata. The RPC is public
    // (callable without JWT) so it works whether the user is signed
    // in or not — we still gate the actual accept on auth via the
    // edge function.
    try {
      const { data, error } = await supabase.rpc('preview_coach_invite', { p_token: token })
      if (error) {
        console.warn('[invite deep-link] preview RPC failed:', error.message)
        return
      }
      // RPC returns: { status, coach: { id, full_name, avatar_url }, coach_message, invitee_email, expires_at }
      // status ∈ 'pending' | 'expired' | 'accepted' | 'revoked' | 'invalid'
      const meta = data as {
        status?:        string
        coach?:         { id?: string; full_name?: string | null; avatar_url?: string | null }
        coach_message?: string | null
        expires_at?:    string
      } | null
      if (!meta || meta.status === 'invalid') return

      // Build a PendingInvite-shaped object so AcceptInviteModal can
      // render uniformly with the banner-driven flow. The modal calls
      // attachInviteToken on Accept, which re-validates server-side
      // and returns the appropriate error code (invite_expired etc.)
      // — so even if the preview says 'expired' here, the modal will
      // surface the right friendly error when the user taps Accept.
      const invite: PendingInvite = {
        invite_id:        '',                              // unknown until accept; modal doesn't use it for the review state
        token,
        coach_id:         meta.coach?.id ?? '',
        coach_full_name:  meta.coach?.full_name ?? null,
        coach_avatar_url: meta.coach?.avatar_url ?? null,
        coach_message:    meta.coach_message ?? null,
        expires_at:       meta.expires_at ?? new Date(Date.now() + 14 * 86_400_000).toISOString(),
        created_at:       new Date().toISOString(),
      }
      setPendingInvite(invite)
      setModalOpen(true)
    } catch (err) {
      console.warn('[invite deep-link] handler threw:', (err as Error).message)
    }
  }, [])

  // Auth-confirmation handoff from web AuthConfirm.jsx. Triggered when
  // an athlete signs up on mobile, taps the magic-link in their email,
  // gets bounced through the browser (because Supabase 302 breaks
  // App Link interception), web confirmation completes, and AuthConfirm
  // does `window.location = 'myrx://auth/confirmed?type=signup'` to
  // hand back to the app. We refresh the local session so the in-app
  // `user` object picks up the now-set email_confirmed_at — which the
  // existing useEffect in sign-up.tsx watches to auto-advance the OTP
  // screen. No UI here; this is a silent state sync.
  const handleAuthConfirmation = useCallback(async () => {
    try {
      await supabase.auth.refreshSession()
    } catch (err) {
      console.warn('[auth deep-link] refreshSession failed:', (err as Error).message)
    }
  }, [])

  // Parse a URL → branch on shape. Handles:
  //   myrx://accept-invite?token=...                       → invite flow (modal)
  //   myrx://coach/accept-invite?token=...                 → route owns it; skip
  //   https://myrxfit.com/coach/accept-invite?token=...    → route owns it; skip
  //   myrx://auth/confirmed?type=signup                    → auth handoff
  const handleUrl = useCallback((url: string | null) => {
    if (!url) return
    // Auth-handoff URLs come in as myrx://auth/* — short-circuit those
    // before falling through to the invite-token extractor (which would
    // otherwise hit an empty token and silently no-op).
    if (/^myrx:\/\/auth\/(confirmed|recovered)/i.test(url)) {
      handleAuthConfirmation()
      return
    }
    // The /coach/accept-invite URL — whether arriving as the custom-
    // scheme form (myrx://coach/accept-invite?token=…) or the App-Link
    // HTTPS form (https://myrxfit.com/coach/accept-invite?token=…) —
    // is owned by app/coach/accept-invite.tsx (the expo-router screen).
    // Don't also pop the modal here, otherwise the user sees the
    // full-page UX AND the popover with identical content.
    //
    // The bare `myrx://accept-invite?token=…` shape (no `/coach`) still
    // falls through to the modal — that's the in-app paste-code path
    // and there's no expo-router screen for it.
    if (/^myrx:\/\/coach\/accept-invite/i.test(url)) return
    if (/^https?:\/\/myrxfit\.com\/coach\/accept-invite/i.test(url)) return

    const token = extractInviteToken(url)
    if (token) handleToken(token)
  }, [handleToken, handleAuthConfirmation])

  // Subscribe to the URL stream. expo-linking's useURL() returns the
  // current incoming URL and updates when a new one arrives — covering
  // both cold-start (initial URL) and warm-start (foreground) cases.
  const incomingUrl = Linking.useURL()
  useEffect(() => {
    handleUrl(incomingUrl)
  }, [incomingUrl, handleUrl])

  function handleClose() {
    setModalOpen(false)
    // Keep the invite ref in case the user re-taps to re-open; the
    // seenTokensRef prevents loops if the URL stream re-emits.
  }

  // Only render the modal when:
  //   - A token was parsed
  //   - The user is signed in (the edge function requires JWT)
  //   - We're NOT already on an accept-invite route (which owns the
  //     full-page UX for the same flow — see usePathname guard above)
  // For a not-signed-in user with a deep-link token, the patient-invite
  // email-match path handles attachment once they sign in. We don't pop
  // a modal in that case to avoid confusing the sign-in flow.
  if (!user || !pendingInvite || onAcceptInviteRoute) return null

  return (
    <AcceptInviteModal
      isOpen={modalOpen}
      onClose={handleClose}
      invite={pendingInvite}
    />
  )
}
