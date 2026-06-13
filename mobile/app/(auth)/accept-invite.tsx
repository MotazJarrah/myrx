/**
 * Accept Coach Invite — mobile /(auth)/accept-invite?token=xxx
 *
 * 1:1 mirror of web/src/pages/coach/AcceptInvite.jsx adapted to RN +
 * expo-router. PUBLIC — accessible WITHOUT auth so the invitee can
 * see who their coach is BEFORE deciding to sign in / sign up.
 *
 * Routing notes:
 * - Reachable via Android App Links from the email's deep link
 *   (https://myrxfit.com/coach/accept-invite?token=xxx → app open
 *   → expo-router maps it to /(auth)/accept-invite).
 * - Signed-out → Accept routes to /(auth)/sign-up?invite=<token>;
 *   the signup journey reads ?invite and stamps it into JourneyData
 *   so the final WelcomeEndScreen calls accept_coach_invite for the
 *   newly-created account.
 * - Signed-in → Accept fires accept_coach_invite RPC inline and
 *   handles all 12 result codes (success/swap/needs_swap_confirmation/
 *   already_accepted_by_you/already_used/revoked/expired/invalid/
 *   email_mismatch/phone_mismatch/is_coach/is_admin).
 *
 * Voice: every advisory follows the coach voice pattern (acknowledge →
 * biology/context → next step). No "consider", no "you might want
 * to" — every dead-end path names what to do next.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  ScrollView, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import {
  AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, Clock,
  LogOut, MessageCircle, Shield, UserCircle2,
} from 'lucide-react-native'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/contexts/AuthContext'
import AnimateRise from '../../src/components/AnimateRise'
import Wordmark from '../../src/components/Wordmark'
import AmbientBackground from '../../src/components/AmbientBackground'
import { KeyboardScreen } from '../../src/components/KeyboardScreen'
import { colors, alpha, palette, withAlpha } from '../../src/theme'

// ── Types ────────────────────────────────────────────────────────────
type PreviewStatus = 'pending' | 'invalid' | 'revoked' | 'expired' | 'accepted' | 'declined'
type AcceptResultCode =
  | 'success'
  | 'success_swap'
  | 'needs_swap_confirmation'
  | 'already_accepted_by_you'
  | 'already_used'
  | 'revoked'
  | 'expired'
  | 'invalid'
  | 'email_mismatch'
  | 'phone_mismatch'
  | 'is_coach'
  | 'is_admin'

interface CoachCardData {
  id?: string
  full_name?: string | null
  avatar_url?: string | null
}

interface PreviewResponse {
  // Web AcceptInvite reads `preview?.status` — same shape on mobile.
  status?: PreviewStatus
  // Backwards-compat alias: some RPC versions return `result`.
  result?: PreviewStatus
  invite_id?: string
  coach?: CoachCardData
  invitee_email?: string
  invitee_phone?: string
  expires_at?: string
  coach_message?: string
}

interface AcceptResponse {
  result: AcceptResultCode | 'unknown'
  coach?: CoachCardData
  current_coach?: CoachCardData
  previous_coach?: CoachCardData
  new_coach?: CoachCardData
  invite_email?: string
  invite_phone?: string
  your_email?: string
  your_phone?: string
  message?: string
}

// ── Page chrome (header with back chevron + wordmark) ────────────────
function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={8} style={s.backBtn}>
        <ChevronLeft size={20} color={colors.foreground} />
      </Pressable>
      <View style={{ flex: 1 }} />
      <Wordmark />
    </View>
  )
}

// ── Coach card (avatar + name) ───────────────────────────────────────
function CoachCard({ coach }: { coach: CoachCardData | null }) {
  return (
    <View style={s.coachCard}>
      {coach?.avatar_url ? (
        <Image
          source={{ uri: coach.avatar_url }}
          style={s.coachAvatar}
          resizeMode="cover"
        />
      ) : (
        <View style={s.coachAvatarFallback}>
          <UserCircle2 size={36} color={colors.primary} />
        </View>
      )}
      <Text style={s.coachEyebrow}>Your Coach</Text>
      <Text style={s.coachName}>{coach?.full_name || 'Your Coach'}</Text>
    </View>
  )
}

// ── Personal message quote-box ───────────────────────────────────────
function CoachMessage({ message }: { message?: string }) {
  if (!message) return null
  return (
    <View style={s.messageCard}>
      <MessageCircle size={16} color={colors.primary} style={{ marginTop: 2 }} />
      <Text style={s.messageText}>{message}</Text>
    </View>
  )
}

// ── Coverage note (always shown on pending states) ───────────────────
// Locked May 29 2026: copy is intentionally static — no coach-name
// interpolation, no fallback branch. "your coach" reads uniformly
// whether the preview RPC returns a name or not, and we already
// surface the coach's name + photo in the YOUR COACH block above
// this card, so naming them twice felt redundant.
function CoverageNote() {
  return (
    <View style={s.coverageNote}>
      <Shield size={16} color={colors.primary} style={{ marginBottom: 6 }} />
      <Text style={s.coverageText}>
        Your MyRX subscription is covered by your coach. No payment is required from you.
      </Text>
    </View>
  )
}

// ── Terminal-state card (expired / used / invalid) ───────────────────
function TerminalCard({
  Icon, tone = 'muted', title, body, action,
}: {
  Icon: typeof AlertCircle
  tone?: 'muted' | 'destructive' | 'warning'
  title: string
  body: string
  action?: React.ReactNode
}) {
  const iconBg =
    tone === 'destructive' ? withAlpha(palette.red[600], 0.15) :
    tone === 'warning'     ? withAlpha(palette.amber[500], 0.20) :
                             alpha(colors.muted, 0.40)
  const iconColor =
    tone === 'destructive' ? colors.destructive :
    tone === 'warning'     ? palette.amber[400] :
                             colors.mutedForeground
  return (
    <View style={s.terminalCard}>
      <View style={[s.terminalIconWrap, { backgroundColor: iconBg }]}>
        <Icon size={26} color={iconColor} />
      </View>
      <Text style={s.terminalTitle}>{title}</Text>
      <Text style={s.terminalBody}>{body}</Text>
      {action ? <View style={{ marginTop: 20 }}>{action}</View> : null}
    </View>
  )
}

// ── Main component ───────────────────────────────────────────────────
export default function AcceptInvite() {
  const params = useLocalSearchParams<{ token?: string }>()
  const token = typeof params.token === 'string' && params.token.length > 0
    ? params.token
    : null

  const { user, profile, signOut } = useAuth()

  const [previewLoading, setPreviewLoading] = useState(true)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptResult, setAcceptResult] = useState<AcceptResponse | null>(null)

  // ── Step 1 — Load invite preview ───────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      if (!token) {
        if (!cancelled) {
          setPreviewError('missing_token')
          setPreviewLoading(false)
        }
        return
      }
      try {
        const { data, error } = await supabase.rpc('preview_coach_invite', { p_token: token })
        if (cancelled) return
        if (error) {
          console.error('[accept-invite] preview RPC error', error)
          setPreviewError(error.message || 'preview_failed')
        } else {
          setPreview((data as PreviewResponse) || null)
        }
      } catch (err: any) {
        if (cancelled) return
        console.error('[accept-invite] preview unexpected', err)
        setPreviewError(err?.message || 'preview_failed')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    loadPreview()
    return () => { cancelled = true }
  }, [token])

  // ── Accept handler (shared by primary CTA + swap confirmation) ────
  const callAccept = useCallback(async (confirmSwap: boolean) => {
    if (!token) return
    setAccepting(true)
    setAcceptError(null)
    try {
      const { data, error } = await supabase.rpc('accept_coach_invite', {
        p_token: token,
        p_confirm_swap: confirmSwap === true,
      })
      if (error) {
        console.error('[accept-invite] accept RPC error', error)
        setAcceptError(error.message || 'accept_failed')
        return
      }
      const resp = (data as AcceptResponse) || { result: 'unknown' }
      if (resp.result === 'success' || resp.result === 'success_swap') {
        router.replace('/(app)/dashboard?invite_accepted=1' as any)
        return
      }
      setAcceptResult(resp)
    } catch (err: any) {
      console.error('[accept-invite] accept unexpected', err)
      setAcceptError(err?.message || 'accept_failed')
    } finally {
      setAccepting(false)
    }
  }, [token])

  function exitToWelcome() {
    router.replace({
      pathname: '/(auth)/welcome' as any,
      params: { skipRedirect: '1' },
    })
  }

  // ── Render: loading ────────────────────────────────────────────────
  if (previewLoading) {
    return (
      <PageShell onBack={exitToWelcome}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Loading Invite…</Text>
        </View>
      </PageShell>
    )
  }

  // ── Render: missing token ─────────────────────────────────────────
  if (previewError === 'missing_token' || !token) {
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={AlertCircle}
          tone="destructive"
          title="No Invite Link"
          body="This page needs an invite link from your coach. Ask them to send you the link again."
        />
      </PageShell>
    )
  }

  // ── Render: preview RPC failed ────────────────────────────────────
  if (previewError) {
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={AlertCircle}
          tone="destructive"
          title="Couldn't load this invite"
          body="Something went wrong on our end. Try again in a minute — if it keeps failing, ask your coach to send a fresh link."
          action={
            <Pressable
              onPress={() => {
                setPreviewLoading(true)
                setPreviewError(null)
                // Re-trigger the effect by toggling state through token re-read.
                // Simplest path: navigate to the same route again.
                router.replace({
                  pathname: '/(auth)/accept-invite' as any,
                  params: { token },
                })
              }}
              style={s.secondaryBtn}
            >
              <Text style={s.secondaryBtnText}>Try Again</Text>
            </Pressable>
          }
        />
      </PageShell>
    )
  }

  // Both `status` and `result` accepted from RPC for forward-compat.
  const status: PreviewStatus | undefined = preview?.status ?? preview?.result
  const coach = preview?.coach || null
  const coachName = coach?.full_name || 'your coach'

  // ── Render: invalid token ─────────────────────────────────────────
  if (status === 'invalid') {
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={AlertCircle}
          tone="destructive"
          title="Invite Not Found"
          body="This invite is invalid or has been removed. Ask your coach to send you a new link."
        />
      </PageShell>
    )
  }

  // ── Render: expired ────────────────────────────────────────────────
  if (status === 'expired') {
    let expiredOn = 'recently'
    if (preview?.expires_at) {
      try {
        const d = new Date(preview.expires_at)
        expiredOn = `on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`
      } catch { /* ignore */ }
    }
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={Clock}
          tone="warning"
          title="This Invite Has Expired"
          body={`This invite expired ${expiredOn}. Ask ${coachName} to resend it from their coach portal — a fresh link will let you continue.`}
        />
      </PageShell>
    )
  }

  // ── Render: revoked / accepted / declined ─────────────────────────
  if (status === 'revoked' || status === 'accepted' || status === 'declined') {
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={AlertCircle}
          tone="muted"
          title="This Invite Is No Longer Active"
          body="The link has already been used or cancelled. If you think this is a mistake, ask your coach to send you a fresh invite."
        />
      </PageShell>
    )
  }

  // ── Defensive fallback for unknown status ─────────────────────────
  if (status !== 'pending') {
    return (
      <PageShell onBack={exitToWelcome}>
        <TerminalCard
          Icon={AlertCircle}
          tone="destructive"
          title="Unrecognised Invite State"
          body="We couldn't determine the state of this invite. Try refreshing, or ask your coach to send you a new link."
        />
      </PageShell>
    )
  }

  // ── Pending state — render coach card + branch on auth state ──────
  const isSignedIn = !!user

  return (
    <PageShell onBack={exitToWelcome}>
      <AnimateRise>
        <View style={s.pendingHeader}>
          <Text style={s.pendingEyebrow}>You've Been Invited</Text>
          <Text style={s.pendingTitle}>
            {coachName} invited you to their roster
          </Text>
          <Text style={s.pendingSubtitle}>
            {isSignedIn
              ? `Accepting gives ${coachName} access to your training and turns on chat between you.`
              : 'Create an account to accept.'}
          </Text>
        </View>

        <View style={{ marginTop: 24 }}>
          <CoachCard coach={coach} />
        </View>

        <CoachMessage message={preview?.coach_message} />
        {isSignedIn ? <CoverageNote /> : null}

        {acceptResult ? (
          <AcceptResultPanel
            acceptResult={acceptResult}
            coachName={coachName}
            previewInviteeEmail={preview?.invitee_email}
            previewInviteePhone={preview?.invitee_phone}
            userEmail={user?.email}
            profilePhone={profile?.phone}
            accepting={accepting}
            onConfirmSwap={() => callAccept(true)}
            onCancelSwap={() => setAcceptResult(null)}
            onSignOut={async () => { await signOut() }}
            onGoToDashboard={() => router.replace('/(app)/dashboard' as any)}
          />
        ) : (
          <View style={{ marginTop: 24 }}>
            {acceptError ? (
              <View style={s.errorBanner}>
                <AlertCircle size={16} color={colors.destructive} />
                <Text style={s.errorText}>
                  Couldn't process your acceptance. Try again in a minute.
                </Text>
              </View>
            ) : null}

            {isSignedIn ? (
              <Pressable
                onPress={() => callAccept(false)}
                disabled={accepting}
                style={[s.primaryBtn, accepting ? s.btnDisabled : null]}
              >
                {accepting ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <>
                    <Text style={s.primaryBtnText}>Accept Invite</Text>
                    <ArrowRight size={16} color={colors.primaryForeground} />
                  </>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push({
                  pathname: '/(auth)/sign-up' as any,
                  params: { invite: token },
                })}
                style={s.primaryBtn}
              >
                <Text style={s.primaryBtnText}>Accept & Create Account</Text>
                <ArrowRight size={16} color={colors.primaryForeground} />
              </Pressable>
            )}

            <View style={s.secondaryRow}>
              {isSignedIn ? (
                <Text style={s.secondaryRowText}>
                  Signed in as{' '}
                  <Text style={s.secondaryRowEmphasis}>{user?.email}</Text>.{' '}
                  <Text
                    style={s.secondaryRowLink}
                    onPress={async () => { await signOut() }}
                  >
                    Sign out
                  </Text>
                </Text>
              ) : (
                <Text style={s.secondaryRowText}>
                  Already have an account?{' '}
                  <Text
                    style={s.secondaryRowLink}
                    onPress={() => router.push({
                      pathname: '/(auth)/sign-in' as any,
                      params: { intent: 'signin' },
                    })}
                  >
                    Sign in
                  </Text>
                  {' '}to accept.
                </Text>
              )}
            </View>
          </View>
        )}
      </AnimateRise>
    </PageShell>
  )
}

// ── Accept result panel (renders one of ~8 inline states) ────────────
function AcceptResultPanel({
  acceptResult, coachName,
  previewInviteeEmail, previewInviteePhone,
  userEmail, profilePhone,
  accepting,
  onConfirmSwap, onCancelSwap, onSignOut, onGoToDashboard,
}: {
  acceptResult: AcceptResponse
  coachName: string
  previewInviteeEmail?: string
  previewInviteePhone?: string
  userEmail?: string
  profilePhone?: string | null
  accepting: boolean
  onConfirmSwap: () => void
  onCancelSwap: () => void
  onSignOut: () => Promise<void>
  onGoToDashboard: () => void
}) {
  const r = acceptResult.result

  if (r === 'needs_swap_confirmation') {
    const currentCoach = acceptResult.current_coach?.full_name || 'your current coach'
    return (
      <View style={[s.panel, s.panelWarning]}>
        <View style={s.panelRow}>
          <AlertCircle size={18} color={palette.amber[400]} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>Switch Coaches?</Text>
            <Text style={s.panelBody}>
              <Text style={s.panelEmphasis}>{currentCoach}</Text> is your current coach. Switching gives {coachName} access going forward — your training history stays with you, but {currentCoach} loses access from now on.
            </Text>
            <View style={s.panelBtnRow}>
              <Pressable
                onPress={onConfirmSwap}
                disabled={accepting}
                style={[s.primaryBtn, s.primaryBtnInline, accepting ? s.btnDisabled : null]}
              >
                {accepting ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={s.primaryBtnText}>Switch to {coachName}</Text>
                )}
              </Pressable>
              <Pressable
                onPress={onCancelSwap}
                disabled={accepting}
                style={[s.secondaryBtn, accepting ? s.btnDisabled : null]}
              >
                <Text style={s.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    )
  }

  if (r === 'already_accepted_by_you') {
    return (
      <View style={[s.panel, s.panelSuccess]}>
        <CheckCircle2 size={36} color={colors.primary} style={{ alignSelf: 'center' }} />
        <Text style={[s.panelTitle, { textAlign: 'center', marginTop: 12 }]}>
          You're already on {coachName}'s roster
        </Text>
        <Text style={[s.panelBody, { textAlign: 'center' }]}>
          Head to your dashboard to keep training.
        </Text>
        <Pressable
          onPress={onGoToDashboard}
          style={[s.primaryBtn, { marginTop: 16, alignSelf: 'center' }]}
        >
          <Text style={s.primaryBtnText}>Go to dashboard</Text>
          <ArrowRight size={16} color={colors.primaryForeground} />
        </Pressable>
      </View>
    )
  }

  if (r === 'already_used') {
    return (
      <View style={s.panel}>
        <AlertCircle size={36} color={colors.mutedForeground} style={{ alignSelf: 'center' }} />
        <Text style={[s.panelTitle, { textAlign: 'center', marginTop: 12 }]}>
          This Invite Is No Longer Active
        </Text>
        <Text style={[s.panelBody, { textAlign: 'center' }]}>
          The link has already been used. Ask {coachName} for a fresh one if you need it.
        </Text>
      </View>
    )
  }

  if (r === 'expired') {
    return (
      <View style={[s.panel, s.panelWarning]}>
        <Clock size={36} color={palette.amber[400]} style={{ alignSelf: 'center' }} />
        <Text style={[s.panelTitle, { textAlign: 'center', marginTop: 12 }]}>
          This Invite Has Expired
        </Text>
        <Text style={[s.panelBody, { textAlign: 'center' }]}>
          Ask {coachName} to resend it from their coach portal — a fresh link
          will let you continue.
        </Text>
      </View>
    )
  }

  if (r === 'revoked' || r === 'invalid') {
    return (
      <View style={s.panel}>
        <AlertCircle size={36} color={colors.mutedForeground} style={{ alignSelf: 'center' }} />
        <Text style={[s.panelTitle, { textAlign: 'center', marginTop: 12 }]}>
          This Invite Is No Longer Active
        </Text>
        <Text style={[s.panelBody, { textAlign: 'center' }]}>
          If you think this is a mistake, ask {coachName} to send you a fresh invite.
        </Text>
      </View>
    )
  }

  if (r === 'email_mismatch') {
    const inviteEmail = acceptResult.invite_email || previewInviteeEmail || 'a different email'
    const yourEmail = acceptResult.your_email || userEmail || 'your current email'
    return (
      <View style={[s.panel, s.panelDestructive]}>
        <View style={s.panelRow}>
          <AlertCircle size={18} color={colors.destructive} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>Wrong Account Signed In</Text>
            <Text style={s.panelBody}>
              This invite was sent to{' '}
              <Text style={s.panelEmphasis}>{inviteEmail}</Text>. You're signed in as{' '}
              <Text style={s.panelEmphasis}>{yourEmail}</Text>.
              Sign out and use the right account to accept.
            </Text>
            <Pressable onPress={onSignOut} style={[s.destructiveBtn, { marginTop: 16 }]}>
              <LogOut size={16} color={colors.destructiveForeground} />
              <Text style={s.destructiveBtnText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  if (r === 'phone_mismatch') {
    const invitePhone = acceptResult.invite_phone || previewInviteePhone || 'a different phone number'
    const yourPhone = acceptResult.your_phone || profilePhone || 'the phone on your account'
    return (
      <View style={[s.panel, s.panelDestructive]}>
        <View style={s.panelRow}>
          <AlertCircle size={18} color={colors.destructive} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>Wrong Account Signed In</Text>
            <Text style={s.panelBody}>
              This invite was sent to{' '}
              <Text style={s.panelEmphasis}>{invitePhone}</Text>. You're signed in as{' '}
              <Text style={s.panelEmphasis}>{yourPhone}</Text>.
              Sign out and use the right account to accept.
            </Text>
            <Pressable onPress={onSignOut} style={[s.destructiveBtn, { marginTop: 16 }]}>
              <LogOut size={16} color={colors.destructiveForeground} />
              <Text style={s.destructiveBtnText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  if (r === 'is_coach') {
    return (
      <View style={[s.panel, s.panelWarning]}>
        <View style={s.panelRow}>
          <AlertCircle size={18} color={palette.amber[400]} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>Coach Accounts Can't Be Coached</Text>
            <Text style={s.panelBody}>
              {acceptResult.message
                || `Coach accounts run their own roster — they can't also be on the client side. Sign out and use a separate athlete account if you want ${coachName} to coach you.`}
            </Text>
            <Pressable onPress={onSignOut} style={[s.destructiveBtn, { marginTop: 16 }]}>
              <LogOut size={16} color={colors.destructiveForeground} />
              <Text style={s.destructiveBtnText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  if (r === 'is_admin') {
    return (
      <View style={[s.panel, s.panelWarning]}>
        <View style={s.panelRow}>
          <AlertCircle size={18} color={palette.amber[400]} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>Admin Accounts Can't Be Coached</Text>
            <Text style={s.panelBody}>
              {acceptResult.message
                || `Admin accounts manage the platform — they can't be on the client side. Sign out and use a separate athlete account if you want ${coachName} to coach you.`}
            </Text>
            <Pressable onPress={onSignOut} style={[s.destructiveBtn, { marginTop: 16 }]}>
              <LogOut size={16} color={colors.destructiveForeground} />
              <Text style={s.destructiveBtnText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  // Defensive fallback for unknown / unexpected codes.
  return (
    <View style={[s.panel, s.panelDestructive]}>
      <AlertCircle size={36} color={colors.destructive} style={{ alignSelf: 'center' }} />
      <Text style={[s.panelTitle, { textAlign: 'center', marginTop: 12 }]}>
        Something Went Wrong
      </Text>
      <Text style={[s.panelBody, { textAlign: 'center' }]}>
        We couldn't process your acceptance. Try again in a minute,
        or ask {coachName} for a fresh link.
      </Text>
    </View>
  )
}

// ── Page shell wrapper ───────────────────────────────────────────────
function PageShell({
  children, onBack,
}: { children: React.ReactNode; onBack: () => void }) {
  return (
    <KeyboardScreen style={s.flex}>
      <View style={s.flex}>
        <AmbientBackground />
        <SafeAreaView style={s.flex} edges={['top']}>
          <Header onBack={onBack} />
          <ScrollView
            contentContainerStyle={s.scrollInner}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.container}>{children}</View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </KeyboardScreen>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  logo: { height: 24, width: 110 },

  scrollInner: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  container: { width: '100%', maxWidth: 500, alignSelf: 'center' },

  // Loading
  loadingWrap: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 80 },
  loadingText: { color: colors.mutedForeground, fontSize: 14 },

  // Coach card
  coachCard: { alignItems: 'center' },
  coachAvatar: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 1, borderColor: colors.border,
  },
  coachAvatarFallback: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: alpha(colors.primary, 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  coachEyebrow: {
    color: colors.mutedForeground,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 12,
  },
  coachName: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 2,
  },

  // Message quote-box
  messageCard: {
    flexDirection: 'row', gap: 8,
    marginTop: 24,
    padding: 16,
    backgroundColor: alpha(colors.card, 0.80),
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 12,
  },
  messageText: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  // Coverage note
  coverageNote: {
    marginTop: 16,
    paddingHorizontal: 16, paddingVertical: 12,
    borderColor: alpha(colors.primary, 0.30),
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: alpha(colors.primary, 0.06),
    alignItems: 'center',
  },
  coverageText: {
    color: colors.foreground,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },

  // Terminal card
  terminalCard: {
    width: '100%',
    padding: 28,
    borderRadius: 16,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.card, 0.80),
    alignItems: 'center',
  },
  terminalIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  terminalTitle: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginTop: 16,
    textAlign: 'center',
  },
  terminalBody: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },

  // Pending headline
  pendingHeader: { alignItems: 'center' },
  pendingEyebrow: {
    color: colors.mutedForeground,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  pendingTitle: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 6,
    textAlign: 'center',
  },
  pendingSubtitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    textAlign: 'center',
  },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 20,
  },
  primaryBtnInline: { alignSelf: 'flex-start' },
  primaryBtnText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '600' },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.card, 0.40),
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  secondaryBtnText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },

  destructiveBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8,
    backgroundColor: colors.destructive,
    borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  destructiveBtnText: {
    color: colors.destructiveForeground, fontSize: 14, fontWeight: '600',
  },

  btnDisabled: { opacity: 0.6 },

  // Secondary line under primary action
  secondaryRow: { marginTop: 16, alignItems: 'center' },
  secondaryRowText: {
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: 'center',
  },
  secondaryRowEmphasis: { color: colors.foreground },
  secondaryRowLink: { color: colors.primary, textDecorationLine: 'underline' },

  // Error banner
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 6, borderWidth: 1,
    borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.10),
    marginBottom: 16,
  },
  errorText: { color: colors.destructive, fontSize: 13, flex: 1 },

  // Accept-result panel
  panel: {
    marginTop: 24,
    padding: 20,
    borderRadius: 16,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.card, 0.80),
  },
  panelWarning: {
    borderColor: withAlpha(palette.amber[500], 0.40),
    backgroundColor: withAlpha(palette.amber[500], 0.10),
  },
  panelDestructive: {
    borderColor: alpha(colors.destructive, 0.40),
    backgroundColor: alpha(colors.destructive, 0.10),
  },
  panelSuccess: {
    borderColor: alpha(colors.primary, 0.40),
    backgroundColor: alpha(colors.primary, 0.10),
  },
  panelRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  panelTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  panelBody: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  panelEmphasis: { color: colors.foreground, fontWeight: '500' },
  panelBtnRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16,
  },
})
