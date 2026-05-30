/**
 * InviteBanner — surfaces pending coach invites on the dashboard.
 *
 * "Patient invite" mechanism: even if the user never tapped the original
 * email link, the get_pending_invites_for_current_user RPC (called by
 * AuthContext on sign-in + every hour-buckets foreground transition)
 * surfaces invites addressed to their email. This banner is the visible
 * end of that mechanism — once invites exist, the user sees them and
 * can accept.
 *
 * Stacking: if multiple coaches have outstanding invites to the same
 * email, the banner shows ONE card at a time (the most recent — first
 * in the array per the RPC's ORDER BY created_at DESC). Tapping it
 * opens AcceptInviteModal which can show "+ N more pending" if the
 * stack is deep, so the user can step through them.
 *
 * Voice rules: acknowledge (you got an invite), explain (their coach
 * sent it), next step (tap to accept). No filler.
 *
 * Visual: lime-tinted card matching the primary color so it stands
 * out against the dashboard's default surfaces. Same visual weight
 * as the bodyweight / calories cards but slightly more attention-
 * grabbing chrome.
 */

import { useEffect, useState } from 'react'
import { View, Text, Pressable, Image, StyleSheet } from 'react-native'
import { UserCircle2, ChevronRight, Sparkles } from 'lucide-react-native'

import { useAuth, type PendingInvite } from '../contexts/AuthContext'
import AcceptInviteModal from './AcceptInviteModal'
import { colors, alpha, palette, withAlpha, fonts, radius } from '../theme'

export default function InviteBanner() {
  const { pendingInvites } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // Snapshot of the invite the modal is currently showing. We KEEP this
  // populated even after pendingInvites empties (e.g. after a successful
  // accept) so the AcceptInviteModal stays mounted long enough to show
  // its success state. Without this, attachInviteToken's downstream
  // fetchPendingInvites empties the list → InviteBanner unmounts the
  // modal → user sees the success view flash for a frame then
  // disappear. Cleared on close so the next reopen starts clean.
  const [activeInvite, setActiveInvite] = useState<PendingInvite | null>(null)

  // Sync activeInvite from the top pending invite whenever the modal
  // is CLOSED. While open, leave it alone so a downstream pendingInvites
  // change (the success-path refetch) can't yank the rug.
  useEffect(() => {
    if (modalOpen) return
    setActiveInvite(pendingInvites?.[0] ?? null)
  }, [pendingInvites, modalOpen])

  const top = pendingInvites?.[0] ?? null
  const additional = (pendingInvites?.length ?? 0) - 1
  const showBanner = !!top

  function handleBannerTap() {
    if (!top) return
    setActiveInvite(top)
    setModalOpen(true)
  }

  function handleClose() {
    setModalOpen(false)
  }

  return (
    <>
      {showBanner ? (
        <Pressable
          onPress={handleBannerTap}
          style={({ pressed }) => [
            s.card,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={s.iconWrap}>
            {top.coach_avatar_url ? (
              <Image source={{ uri: top.coach_avatar_url }} style={s.avatar} />
            ) : (
              <View style={s.avatarFallback}>
                <UserCircle2 size={28} color={palette.myrx.lime} />
              </View>
            )}
            <View style={s.sparkBadge}>
              <Sparkles size={12} color={palette.myrx.lime} />
            </View>
          </View>

          <View style={s.body}>
            <Text style={s.eyebrow}>Coach invite</Text>
            <Text style={s.title} numberOfLines={2}>
              {top.coach_full_name ? `${top.coach_full_name} invited you to their roster` : 'A coach invited you'}
            </Text>
            {additional > 0 ? (
              <Text style={s.stack}>+ {additional} more pending</Text>
            ) : null}
          </View>

          <ChevronRight size={20} color={alpha(colors.foreground, 0.6)} />
        </Pressable>
      ) : null}

      {/* Modal stays mounted while open even if pendingInvites empties.
          Uses activeInvite (the snapshot at open-time) so the success
          view renders fully and the user can tap Done. */}
      <AcceptInviteModal
        isOpen={modalOpen}
        onClose={handleClose}
        invite={activeInvite}
        additionalCount={Math.max(additional, 0)}
      />
    </>
  )
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: withAlpha(palette.myrx.lime, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(palette.myrx.lime, 0.35),
    borderRadius: radius.xl,
    padding: 14,
    marginBottom: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: withAlpha(palette.myrx.lime, 0.18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: withAlpha(palette.myrx.lime, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: fonts.sans[600],
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: palette.myrx.lime,
  },
  title: {
    fontFamily: fonts.sans[600],
    fontSize: 14,
    lineHeight: 18,
    color: colors.foreground,
  },
  stack: {
    fontFamily: fonts.sans[500],
    fontSize: 11,
    color: alpha(colors.foreground, 0.55),
    marginTop: 2,
  },
})
