/**
 * CoachChangeBanner — mobile dashboard notice shown to athletes when
 * their coach attachment changes (assigned, detached, or swapped).
 *
 * Replaces the older CoachLostBanner (May 29 2026) which only handled
 * the "lost coach" path. Now handles all three transitions through one
 * unified component + dismissal column.
 *
 * Trigger conditions (ALL must be true):
 *   • profile.coach_change_acknowledged_at IS NULL  (athlete hasn't
 *     dismissed the latest change yet)
 *   • profile.previously_had_coach === true OR profile.coach_id != null
 *     (one or the other has to be true; the no-coach-now + no-prior-
 *     coach case is a fresh signup and shouldn't see anything)
 *
 * The acknowledgment column resets to NULL automatically whenever
 * coach_id transitions, via the trg_clear_coach_ack trigger on
 * profiles.coach_id. So every admin-driven coach swap fires a fresh
 * banner without the athlete having to do anything.
 *
 * Three display modes based on current coach_id state:
 *
 *   1. ATTACHED (coach_id != null) — "Your coach changed. [Name] is now
 *      your coach." Lime/emerald tone. Coach name comes from the
 *      get_coach_info RPC (already used by the profile card).
 *
 *   2. LOST (coach_id == null AND previously_had_coach) — "Your coach
 *      changed. You're now managing your own plan." Amber tone — matches
 *      the prior CoachLostBanner copy verbatim so the experience is
 *      stable for users who've already seen it.
 *
 *   3. (No banner) — coach_id == null AND !previously_had_coach. Fresh
 *      signup. Nothing to show.
 *
 * Dismiss writes profiles.coach_change_acknowledged_at = now(). The
 * realtime profile sub picks the change up and hides the banner.
 * Optimistic local hide so the X feels instant.
 *
 * Voice (CLAUDE.md "Voice and Coaching Philosophy"):
 * Coach voice — acknowledge the change, name what it means, give a
 * realistic next step. No marketing, no "find a new coach today!" CTA.
 *
 * Locked May 29 2026.
 */

import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { UserCheck, UserX, X } from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { colors, alpha, palette, fonts } from '../theme'

interface CoachInfo {
  full_name: string | null
}

export default function CoachChangeBanner() {
  const { user, profile, refreshProfile } = useAuth()
  const [busy,        setBusy]        = useState(false)
  const [hidden,      setHidden]      = useState(false)
  const [coachInfo,   setCoachInfo]   = useState<CoachInfo | null>(null)

  // Read profile flags defensively — legacy rows may not have the
  // newer columns until the realtime sub catches up.
  const coachId            = (profile as any)?.coach_id ?? null
  const previouslyHadCoach = (profile as any)?.previously_had_coach === true
  const alreadyAcked       = (profile as any)?.coach_change_acknowledged_at != null

  // Banner only renders for legitimate change events.
  const hasCoachNow = coachId != null
  const lostCoach   = !hasCoachNow && previouslyHadCoach
  const showBanner  = !hidden && !alreadyAcked && !!user?.id && !!profile &&
                      (hasCoachNow || lostCoach)

  // Resolve the current coach's name for the "attached" banner. Falls
  // back to a generic phrase if the RPC returns no row (e.g. coach got
  // anonymized before the realtime sub fired).
  useEffect(() => {
    if (!hasCoachNow || !showBanner) return
    let cancelled = false
    supabase.rpc('get_coach_info').then(({ data }) => {
      if (cancelled) return
      setCoachInfo((data as CoachInfo | null) ?? null)
    })
    return () => { cancelled = true }
  }, [hasCoachNow, showBanner, coachId])

  if (!showBanner) return null

  async function handleDismiss() {
    setBusy(true)
    setHidden(true)  // optimistic
    try {
      await supabase
        .from('profiles')
        .update({ coach_change_acknowledged_at: new Date().toISOString() })
        .eq('id', user!.id)
      refreshProfile().catch(() => { /* best-effort */ })
    } catch {
      setHidden(false)  // failed — let the user retry
    } finally {
      setBusy(false)
    }
  }

  // ── Render the right variant ─────────────────────────────────────
  // Title-only banners — just announce the state change. No body copy,
  // no CTA. The icon + title + dismiss is the entire UX. User locked
  // May 29 2026 — "just inform of the change, that's it." If the user
  // needs more context (find a new coach, etc.) they go to settings;
  // the banner doesn't push behaviour.
  if (hasCoachNow) {
    const coachName = coachInfo?.full_name || 'Your new coach'
    return (
      <View style={[s.wrap, s.wrapEmerald]}>
        <View style={[s.iconCircle, s.iconCircleEmerald]}>
          {/* Pure-white glyph on the tinted plate — warm-on-warm fix.
              Plate's emerald tint carries the color signal; the icon
              just needs to be a clear shape. */}
          <UserCheck size={18} color="#ffffff" strokeWidth={2.25} />
        </View>
        <Text style={[s.title, s.titleEmerald]}>
          {coachName} is now your coach
        </Text>
        <DismissButton onPress={handleDismiss} busy={busy} />
      </View>
    )
  }

  // Lost-coach branch — title-only too.
  return (
    <View style={[s.wrap, s.wrapAmber]}>
      <View style={[s.iconCircle, s.iconCircleAmber]}>
        <UserX size={18} color="#ffffff" strokeWidth={2.25} />
      </View>
      <Text style={[s.title, s.titleAmber]}>You're now self-managed</Text>
      <DismissButton onPress={handleDismiss} busy={busy} />
    </View>
  )
}

function DismissButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={10}
      accessibilityLabel="Dismiss"
      style={({ pressed }) => [s.dismissBtn, (busy || pressed) && s.btnDim]}
    >
      <X size={16} color={colors.mutedForeground} />
    </Pressable>
  )
}

// Contrast notes (locked May 29 2026, second pass):
//   • Banner bg is now solid `colors.card` (hsl(220, 12%, 8%) — same as
//     every other card on the page). Previously we used amber/emerald
//     tinted backgrounds at 7–10% opacity, which created a "warm wash"
//     on the dark page and dragged body-text contrast down. The fix is
//     to NOT tint the bg at all; let the accent color live in the
//     border + icon plate + title only. Body text gets full contrast
//     against solid dark.
//   • Border stays tinted (amber[500] / emerald[500] @ 0.40) so the
//     banner still reads as a distinct callout, not a regular card.
//     Bumped from 0.35 to compensate for the missing bg tint.
//   • Icon plate goes more saturated (0.25) for the same reason — the
//     icon was the most visible accent, and dropping the bg wash made
//     it look isolated. Bumping the plate keeps the warmth centered
//     there.
//   • Title is amber[300] / emerald[300] (lighter than 400) for pop.
//   • Body text is `colors.foreground` (off-white) — fine against the
//     solid card bg; no more warm-on-warm wash.

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    // Center-aligned now that the banner is single-line (title only).
    // Was flex-start when we had a multi-line body block underneath.
    alignItems: 'center',
    gap: 12,
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: colors.card,  // solid dark, no warm tint
  },
  wrapAmber:   { borderColor: alpha(palette.amber[500],   0.40) },
  wrapEmerald: { borderColor: alpha(palette.emerald[500], 0.40) },
  iconCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircleAmber:   { backgroundColor: alpha(palette.amber[500],   0.25) },
  iconCircleEmerald: { backgroundColor: alpha(palette.emerald[500], 0.25) },
  title: {
    // flex:1 so the title takes available width and pushes the dismiss
    // button to the right edge. minWidth:0 so long names/coach labels
    // can wrap gracefully if they ever exceed one line.
    flex: 1, minWidth: 0,
    fontFamily: fonts.sans[700],
    fontSize: 14,
  },
  titleAmber:   { color: palette.amber[300]   },
  titleEmerald: { color: palette.emerald[300] },
  line: {
    fontFamily: fonts.sans[400],
    fontSize: 13, lineHeight: 18, color: colors.foreground,
  },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDim: { opacity: 0.5 },
})
