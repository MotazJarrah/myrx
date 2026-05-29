/**
 * CoachInviteCodeCard — Settings → Preferences card that lets an athlete
 * manually attach a coach invite by pasting a token OR the full
 * accept-invite URL from the email.
 *
 * Fallback for the email-mismatch edge case: invitee signed up with a
 * different email than the one the coach addressed the invite to. The
 * patient-invite RPC (get_pending_invites_for_current_user) only matches
 * by email, so the dashboard banner wouldn't appear for them. They paste
 * the code here and it attaches via the same attach-invite-to-current-user
 * edge function the banner uses.
 *
 * Per CLAUDE.md voice rules: acknowledge (they have a code), explain
 * (their coach gave it to them), next step (paste it). No filler.
 *
 * Hidden for coaches + admins — same gate as InviteBanner.
 * They'd hit cant_accept_as_coach / cant_accept_as_admin on submit,
 * so we skip the card entirely instead of letting them tap a button
 * that's guaranteed to fail.
 */

import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react-native'

import { useAuth, type AttachInviteResult } from '../contexts/AuthContext'
import { colors, alpha, palette, withAlpha, fonts, radius } from '../theme'

// Parse a token out of a full URL or return the trimmed string as-is.
// Accepts shapes:
//   - bare token: "abc123def456..." (64-char hex)
//   - full URL:   "https://myrxfit.com/coach/accept-invite?token=abc123..."
//   - URL fragment: "/coach/accept-invite?token=abc123..."
// Returns the token (trimmed, hex-only) OR the raw trimmed input if no
// token query param was extractable. The edge function does its own
// strict shape validation, so we don't need to be perfect here — just
// helpful.
export function extractInviteToken(input: string): string {
  const trimmed = (input || '').trim()
  if (!trimmed) return ''
  // Try URL parse first
  try {
    // Handle bare paths by prepending a stub origin
    const candidate = trimmed.startsWith('http') ? trimmed : `https://x${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
    const u = new URL(candidate)
    const tok = u.searchParams.get('token')
    if (tok) return tok.trim()
  } catch { /* not a URL — fall through */ }
  return trimmed
}

export default function CoachInviteCodeCard() {
  const { profile, attachInviteToken } = useAuth()
  const [input,   setInput]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState<AttachInviteResult | null>(null)

  // Don't render the card for coaches / admins — they can't accept invites.
  if (profile?.is_coach === true || profile?.is_superuser === true) return null

  async function handleSubmit() {
    if (busy) return
    const token = extractInviteToken(input)
    if (!token) {
      setResult({ success: false, code: 'missing_token', error: 'Paste the code from your email first.' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await attachInviteToken(token)
      setResult(r)
      if (r.success) setInput('')   // clear on success so the field doesn't look stale
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.iconBadge}>
          <Sparkles size={14} color={palette.green[400]} />
        </View>
        <Text style={s.cardLabel}>Paste an invite code</Text>
      </View>

      <Text style={s.helper}>
        If your coach invited a different email than the one you signed up with, paste the code from their email here. It attaches you to their roster.
      </Text>

      <TextInput
        value={input}
        onChangeText={(v) => { setInput(v); if (result) setResult(null) }}
        placeholder="Paste the code or link from your email"
        placeholderTextColor={alpha(colors.foreground, 0.4)}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        editable={!busy}
        multiline
        numberOfLines={2}
        style={s.input}
      />

      {result ? (
        result.success ? (
          <View style={s.successBanner}>
            <CheckCircle2 size={14} color={palette.green[400]} />
            <Text style={s.successText}>
              {result.already_attached
                ? "You're already on their roster."
                : `Attached to ${result.coach_full_name || 'your coach'}.`}
            </Text>
          </View>
        ) : (
          <View style={s.errorBanner}>
            <AlertCircle size={14} color={palette.amber[400]} />
            <Text style={s.errorText}>{result.error || 'Something went wrong.'}</Text>
          </View>
        )
      ) : null}

      <Pressable
        onPress={handleSubmit}
        disabled={busy || !input.trim()}
        style={[s.submitBtn, (busy || !input.trim()) && s.submitBtnDisabled]}
      >
        {busy
          ? <ActivityIndicator size="small" color="#0a0a0a" />
          : <Text style={s.submitBtnText}>Attach to coach</Text>}
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: withAlpha(palette.green[500], 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontFamily: fonts.sans[600],
    fontSize: 14,
    color: colors.foreground,
  },
  helper: {
    fontFamily: fonts.sans[500],
    fontSize: 12,
    lineHeight: 16,
    color: alpha(colors.foreground, 0.65),
  },
  input: {
    fontFamily: fonts.mono[500],
    fontSize: 12,
    color: colors.foreground,
    backgroundColor: alpha(colors.input, 0.4),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: withAlpha(palette.green[500], 0.12),
    borderWidth: 1,
    borderColor: withAlpha(palette.green[500], 0.35),
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  successText: {
    flex: 1,
    fontFamily: fonts.sans[500],
    fontSize: 12,
    color: palette.green[400],
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: withAlpha(palette.amber[400], 0.12),
    borderWidth: 1,
    borderColor: withAlpha(palette.amber[400], 0.3),
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.sans[500],
    fontSize: 12,
    color: palette.amber[400],
  },
  submitBtn: {
    backgroundColor: palette.green[500],
    paddingVertical: 12,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontFamily: fonts.sans[700],
    fontSize: 14,
    color: '#0a0a0a',
  },
})
