/**
 * AcceptInviteModal — bottom sheet that walks the user through accepting
 * a pending coach invite.
 *
 * Opened from:
 *   - InviteBanner (dashboard) tap → passes the top pending invite
 *   - Settings "Have an invite code?" submit → passes the looked-up invite
 *   - Custom URL scheme deep-link handler (myrx://accept-invite?token=...)
 *
 * Branching copy based on current user state (Q6 accept-time rules):
 *   - Free athlete (no coach attached) → simple "Accept invite?" + benefit copy
 *   - Self-coached → "Your plan stays in place." reassurance
 *   - On another coach's roster → swap confirmation ("Swap from Coach Bob?")
 *
 * Server-side validation runs in the attach-invite-to-current-user edge
 * function. This UI's job is to set expectations + show clear post-action
 * confirmation. Error codes the modal handles explicitly:
 *   - email_mismatch       → "This invite was sent to <email>. Sign out + back in."
 *   - cant_accept_as_coach → "Coaches can't accept invites." (gates ahead)
 *   - cant_accept_as_admin → "Admins can't accept invites."
 *   - invite_expired       → "Expired. Ask for a fresh one."
 *   - invite_revoked       → "Your coach revoked this invite."
 *   - invite_already_used  → "Already used."
 *   - account_deactivated  → "Your account is deactivated."
 *   - generic              → server-supplied error message
 *
 * Voice rules (per CLAUDE.md): acknowledge → biology/context → concrete
 * next step. No "consider", no "maybe", no emoji.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Image, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
  LinearTransition,
} from 'react-native-reanimated'
import {
  UserCircle2, AlertCircle,
  Sparkles, ArrowRightLeft, CheckCircle2,
} from 'lucide-react-native'

import { useAuth, type PendingInvite, type AttachInviteResult } from '../contexts/AuthContext'
import { colors, alpha, palette, withAlpha, fonts, radius } from '../theme'

interface Props {
  isOpen:           boolean
  onClose:          () => void
  invite:           PendingInvite | null
  additionalCount?: number
}

type Phase = 'review' | 'submitting' | 'success' | 'error'

export default function AcceptInviteModal({ isOpen, onClose, invite, additionalCount = 0 }: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const { profile, attachInviteToken } = useAuth()
  const [phase, setPhase]   = useState<Phase>('review')
  const [result, setResult] = useState<AttachInviteResult | null>(null)

  // ── Swipe-down to dismiss ────────────────────────────────────────────────
  // Same mechanics as PlanWizardSheet / ChatSheet / SuggestionSheet /
  // FoodLogDrawer: drag the handle / top area down, release past 120 px
  // (or with velocity > 800 px/s) and the sheet animates off-screen +
  // closes. activeOffsetY(8) + failOffsetX([-20,20]) ensure small touches
  // still register as Pressable taps on the close X button, but a
  // deliberate downward drag wins.
  const dragY = useSharedValue(0)
  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }))
  const headerCloseGesture = useMemo(() => {
    return Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-20, 20])
      .onUpdate(e => {
        'worklet'
        dragY.value = Math.max(0, e.translationY)
      })
      .onEnd(e => {
        'worklet'
        const passedThreshold = e.translationY > 120 || e.velocityY > 800
        if (passedThreshold) {
          const remaining = screenH - dragY.value
          const duration = Math.max(120, Math.min(300, remaining * 0.5))
          dragY.value = withTiming(screenH, { duration }, () => {
            runOnJS(onClose)()
          })
        } else {
          dragY.value = withTiming(0, { duration: 180 })
        }
      })
  }, [onClose, screenH, dragY])

  // Reset to review phase whenever a fresh invite enters the modal.
  // Also reset dragY so a previous half-dismissed swipe doesn't bleed
  // into the next open (would render the sheet partly off-screen).
  useEffect(() => {
    if (isOpen) {
      dragY.value = 0
      setPhase('review')
      setResult(null)
    }
  }, [isOpen, invite?.invite_id, dragY])

  if (!invite) return null

  const isSwap = !!profile?.coach_id && profile.coach_id !== invite.coach_id
  const isSelfCoached = profile?.is_self_coached === true

  async function handleAccept() {
    if (!invite) return
    setPhase('submitting')
    const r = await attachInviteToken(invite.token)
    setResult(r)
    setPhase(r.success ? 'success' : 'error')
  }

  function handleClose() {
    // If accepted, AuthContext already refreshed profile + pendingInvites,
    // so closing just returns the user to the dashboard with the new
    // coached state visible. If errored, the user can try again later
    // (banner persists until invite is accepted / revoked / expires).
    onClose()
  }

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={s.root}>
        <Pressable style={s.backdrop} onPress={handleClose} />
        {/* layout={LinearTransition.duration(220)} animates the sheet's
            intrinsic height changes (phase transitions: review →
            submitting → success/error) so the sheet smoothly resizes
            instead of snap-jumping. 220 ms matches the swipe-dismiss
            timing so the whole sheet feels like one animation system. */}
        <Animated.View
          style={[s.sheet, sheetAnimStyle, { paddingBottom: insets.bottom + 12 }]}
          layout={LinearTransition.duration(220)}
        >
          {/* Drag handle + Close X area — wrapped in GestureDetector so
              a downward swipe on the top portion of the sheet dismisses
              it. Same Pan mechanics as PlanWizardSheet / FoodLogDrawer /
              ChatSheet / SuggestionSheet — small touches still register
              as Pressable taps on the X button (failOffsetX guard +
              activeOffsetY threshold), deliberate downward drags win. */}
          <GestureDetector gesture={headerCloseGesture}>
            <View style={s.dragArea}>
              <View style={s.dragHandle} />
              {/* Close X removed May 27 2026 — swipe-down on the
                  drag handle dismisses the sheet (uniform across all
                  bottom drawers in the app). */}
            </View>
          </GestureDetector>

          <ScrollView
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {phase === 'review' && (
              <ReviewView
                invite={invite}
                isSwap={isSwap}
                isSelfCoached={isSelfCoached}
                additionalCount={additionalCount}
                onAccept={handleAccept}
                onClose={handleClose}
              />
            )}

            {phase === 'submitting' && (
              <View style={s.center}>
                <ActivityIndicator size="large" color={palette.myrx.lime} />
                <Text style={s.submittingText}>Connecting you to your coach…</Text>
              </View>
            )}

            {phase === 'success' && result?.success && (
              <SuccessView
                invite={invite}
                result={result}
                onClose={handleClose}
              />
            )}

            {phase === 'error' && result && !result.success && (
              <ErrorView
                result={result}
                invite={invite}
                onRetry={handleAccept}
                onClose={handleClose}
              />
            )}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ── REVIEW PHASE ────────────────────────────────────────────────────────────
function ReviewView({
  invite, isSwap, isSelfCoached, additionalCount, onAccept, onClose,
}: {
  invite:           PendingInvite
  isSwap:           boolean
  isSelfCoached:    boolean
  additionalCount:  number
  onAccept:         () => void
  onClose:          () => void
}) {
  const coachName = invite.coach_full_name?.trim() || 'Your coach'

  // Generic copy across all current-user states (free / self-coached /
  // swap). Earlier per-state branches mentioned things like "your
  // current calorie plan stays in place" — confusing for brand-new
  // users who never set one up. Keep the in-app message short and
  // accurate for every scenario; the rich pitch (coach's personal
  // note, what MyRX is, etc.) already lives in the invite email so
  // repeating it here is redundant.
  let headline: string
  let subline: string
  let ctaLabel: string

  if (isSwap) {
    headline = `Swap to ${coachName}?`
    subline = `${coachName} replaces your current coach and will see your training data. Your MyRX subscription stays covered.`
    ctaLabel = 'Swap coaches'
  } else {
    headline = `Accept ${coachName}'s invite?`
    subline = `${coachName} will see your training data and can program for you. Your MyRX subscription is covered while they coach you.`
    ctaLabel = 'Accept invite'
  }
  // isSelfCoached reserved for future use (e.g. preserve-plan
  // confirmation chip on the swap path); not surfaced in copy today.
  void isSelfCoached

  return (
    <>
      {/* Coach card */}
      <View style={s.coachCard}>
        {invite.coach_avatar_url ? (
          <Image source={{ uri: invite.coach_avatar_url }} style={s.coachAvatar} />
        ) : (
          <View style={s.coachAvatarFallback}>
            <UserCircle2 size={36} color={palette.myrx.lime} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.coachEyebrow}>{isSwap ? 'New coach' : 'Your coach'}</Text>
          <Text style={s.coachName}>{coachName}</Text>
        </View>
        {isSwap ? (
          <View style={s.swapBadge}>
            <ArrowRightLeft size={14} color={palette.amber[400]} />
          </View>
        ) : (
          <View style={s.sparkBadge}>
            <Sparkles size={14} color={palette.myrx.lime} />
          </View>
        )}
      </View>

      {/* Headline + subline */}
      <Text style={s.headline}>{headline}</Text>
      <Text style={s.subline}>{subline}</Text>

      {/* Additional pending invites note */}
      {additionalCount > 0 ? (
        <View style={s.additionalNote}>
          <Text style={s.additionalText}>
            {additionalCount} more {additionalCount === 1 ? 'coach' : 'coaches'} also invited you. Accepting this one leaves the others available — you can switch later.
          </Text>
        </View>
      ) : null}

      {/* CTA buttons */}
      <View style={s.buttonRow}>
        <Pressable onPress={onClose} style={[s.secondaryBtn, { flex: 1 }]}>
          <Text style={s.secondaryBtnText}>Not now</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          style={[s.primaryBtn, isSwap ? s.swapBtnStyle : null, { flex: 1.5 }]}
        >
          <Text style={[s.primaryBtnText, isSwap ? s.swapBtnText : null]}>{ctaLabel}</Text>
        </Pressable>
      </View>
    </>
  )
}

// ── SUCCESS PHASE ───────────────────────────────────────────────────────────
function SuccessView({
  invite, result, onClose,
}: {
  invite:  PendingInvite
  result:  AttachInviteResult
  onClose: () => void
}) {
  const coachName = result.coach_full_name?.trim() || invite.coach_full_name?.trim() || 'Your coach'
  const wasSwap = !!result.swapped_from_coach_id

  let headline: string
  let subline: string

  if (result.already_attached) {
    headline = `Already on ${coachName}'s roster`
    subline = `You're already on ${coachName}'s roster — nothing to do.`
  } else if (wasSwap) {
    headline = `You're now training with ${coachName}`
    subline = `${coachName} has full access to your training history. Your previous coach's access ended. Chat is on — they can message you.`
  } else {
    headline = `You're now training with ${coachName}`
    subline = `${coachName} has full access to your training history and can start programming for you. Chat is on — they can message you.`
  }

  return (
    <>
      <View style={s.successIcon}>
        <CheckCircle2 size={56} color={palette.myrx.lime} />
      </View>
      <Text style={[s.headline, { textAlign: 'center' }]}>{headline}</Text>
      <Text style={[s.subline, { textAlign: 'center' }]}>{subline}</Text>

      <Pressable onPress={onClose} style={[s.primaryBtn, { marginTop: 20 }]}>
        <Text style={s.primaryBtnText}>Done</Text>
      </Pressable>
    </>
  )
}

// ── ERROR PHASE ─────────────────────────────────────────────────────────────
function ErrorView({
  result, invite, onRetry, onClose,
}: {
  result:  AttachInviteResult
  invite:  PendingInvite
  onRetry: () => void
  onClose: () => void
}) {
  // Map server codes → friendly headline + retry behavior.
  let headline = "That didn't go through"
  let subline  = result.error || 'Connection dropped before we could attach you. Tap Try again — your invite is still valid.'
  let allowRetry = true

  switch (result.code) {
    case 'cant_accept_as_coach':
      headline = "Coaches can't accept invites"
      subline = "Coaches can't be on their own roster. Sign out and sign in with your athlete account to accept."
      allowRetry = false
      break
    case 'cant_accept_as_admin':
      headline = "Admins can't accept invites"
      subline = "Admin accounts don't get coached. Sign out and sign in with an athlete account to accept."
      allowRetry = false
      break
    case 'account_deactivated':
      headline = 'Your account is deactivated'
      subline = 'Your account is within its 14-day reactivation window. Email team@myrxfit.com to reactivate before accepting this invite.'
      allowRetry = false
      break
    case 'email_mismatch':
      headline = "This invite isn't for this account"
      subline = `Your coach sent this to ${result.invitee_email}. Either sign out and back in with that address, or ask your coach to resend to your current email.`
      allowRetry = false
      break
    case 'invite_expired':
      headline = 'This invite expired'
      subline = `This invite passed its 14-day window. Ask ${invite.coach_full_name || 'your coach'} to resend — your account is ready to attach the moment they do.`
      allowRetry = false
      break
    case 'invite_revoked':
      headline = 'Your coach revoked this invite'
      subline = 'Message your coach if you still want to join their roster. They can send a fresh invite.'
      allowRetry = false
      break
    case 'invite_already_used':
      headline = 'Already used'
      subline = "This invite was already accepted. If it was you, check your dashboard — you're on their roster."
      allowRetry = false
      break
    case 'invite_not_found':
      headline = "Invite not found"
      subline = "That code doesn't match an active invite. Ask your coach to resend."
      allowRetry = false
      break
    case 'invalid_token_shape':
      headline = "That code doesn't look right"
      subline = 'The code is 64 characters of letters and numbers. Copy the whole thing from your invite email.'
      allowRetry = false
      break
    default:
      // Network or unexpected — allow retry
      break
  }

  return (
    <>
      <View style={s.errorIcon}>
        <AlertCircle size={48} color={palette.amber[400]} />
      </View>
      <Text style={[s.headline, { textAlign: 'center' }]}>{headline}</Text>
      <Text style={[s.subline, { textAlign: 'center' }]}>{subline}</Text>

      <View style={[s.buttonRow, { marginTop: 20 }]}>
        <Pressable onPress={onClose} style={[s.secondaryBtn, { flex: allowRetry ? 1 : 2 }]}>
          <Text style={s.secondaryBtnText}>{allowRetry ? 'Close' : 'OK'}</Text>
        </Pressable>
        {allowRetry ? (
          <Pressable onPress={onRetry} style={[s.primaryBtn, { flex: 1.5 }]}>
            <Text style={s.primaryBtnText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Top drag-affordance zone — captures the swipe-down gesture. Hosts
  // the centered drag-handle pill AND the absolute-positioned close X.
  // Keeping both inside the same GestureDetector means the user can
  // drag from anywhere along the top edge.
  dragArea: {
    position: 'relative',
    paddingTop: 12,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: alpha(colors.foreground, 0.2),
    borderRadius: 2,
    alignSelf: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.background, 0.4),
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  // ── Coach card
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  coachAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  coachAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: withAlpha(palette.myrx.lime, 0.18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachEyebrow: {
    fontFamily: fonts.sans[600],
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: alpha(colors.foreground, 0.55),
  },
  coachName: {
    fontFamily: fonts.sans[700],
    fontSize: 20,
    color: colors.foreground,
    marginTop: 2,
  },
  sparkBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: withAlpha(palette.myrx.lime, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: withAlpha(palette.amber[400], 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Message card
  messageCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: alpha(colors.input, 0.4),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 4,
  },
  messageText: {
    flex: 1,
    fontFamily: fonts.sans[500],
    fontSize: 13,
    lineHeight: 18,
    color: colors.foreground,
  },
  // ── Headline + subline
  headline: {
    fontFamily: fonts.sans[700],
    fontSize: 22,
    color: colors.foreground,
    marginTop: 8,
  },
  subline: {
    fontFamily: fonts.sans[500],
    fontSize: 14,
    lineHeight: 20,
    color: alpha(colors.foreground, 0.75),
  },
  // ── Additional invites note
  additionalNote: {
    backgroundColor: alpha(colors.input, 0.3),
    borderRadius: radius.md,
    padding: 12,
    marginTop: 4,
  },
  additionalText: {
    fontFamily: fonts.sans[500],
    fontSize: 12,
    lineHeight: 16,
    color: alpha(colors.foreground, 0.7),
  },
  // ── Buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  primaryBtn: {
    backgroundColor: palette.myrx.lime,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.sans[700],
    fontSize: 15,
    color: colors.background,
  },
  swapBtnStyle: {
    backgroundColor: palette.amber[400],
  },
  swapBtnText: {
    color: colors.background,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.4),
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.sans[600],
    fontSize: 15,
    color: colors.foreground,
  },
  // ── Phase containers
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  submittingText: {
    fontFamily: fonts.sans[500],
    fontSize: 14,
    color: alpha(colors.foreground, 0.7),
  },
  successIcon: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  errorIcon: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
})
