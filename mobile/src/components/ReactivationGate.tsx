/**
 * ReactivationGate — full-screen page rendered post-sign-in when the
 * athlete's account is scheduled for deletion within the 30-day grace
 * window.
 *
 * Mounted by mobile/app/(app)/_layout.tsx as a short-circuit BEFORE the
 * normal AppShell. The athlete can authenticate successfully but every
 * (app)/* route renders this gate until they either:
 *   • Tap "Reactivate my account" → cancel_scheduled_deletion() RPC →
 *     AuthContext refreshes profile → scheduled_for_deletion_at clears
 *     → this gate unmounts and the normal shell renders.
 *   • Tap "Sign out" → standard sign-out flow.
 *
 * If they never reactivate within 30 days, the nightly cron calls
 * anonymize_expired_accounts(), which bans auth.users and scrubs the
 * email — sign-in becomes permanently blocked after that.
 *
 * Voice (CLAUDE.md): coach voice — acknowledge their state, name the
 * specific consequence, give one clear next step. No hedging.
 *
 * Mirrors the web ReactivationGate in web/src/components/ReactivationGate.jsx
 * byte-for-byte at the UX level — same copy, same button order, same
 * deletion-grace contract. Locked May 28 2026.
 */

import { useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { AlertTriangle, RotateCcw, LogOut } from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { colors, alpha, palette, fonts } from '../theme'

export default function ReactivationGate() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)

  const scheduledAt = (profile as any)?.scheduled_for_deletion_at
  let daysLeft: number | null = null
  let formattedDate: string | null = null
  if (scheduledAt) {
    const ms = new Date(scheduledAt).getTime() - Date.now()
    daysLeft = Math.max(0, Math.ceil(ms / 86_400_000))
    formattedDate = new Date(scheduledAt).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }

  async function handleReactivate() {
    setBusy(true)
    setErr(null)
    try {
      // p_user_id=null → self. The RPC's auth check accepts that path.
      const { error } = await supabase.rpc('cancel_scheduled_deletion', { p_user_id: null })
      if (error) throw error
      await refreshProfile()
      // Explicit navigation to Dashboard (locked May 28 2026). Without
      // this, the user lands on whatever (app)/* route the URL stack
      // happened to be on before the gate took over — which after a
      // fresh sign-in is unpredictable (could be /(app)/dashboard, an
      // orphaned legacy route, or wherever expo-router last cached).
      // Always landing on Dashboard is the predictable "welcome back"
      // experience the user spec'd.
      router.replace('/(app)/dashboard' as any)
    } catch (e: any) {
      setErr(e?.message || "Couldn't reactivate. Try again, or sign out and email team@myrxfit.com.")
      setBusy(false)
    }
  }

  async function handleSignOut() {
    setBusy(true)
    try {
      await signOut()
    } catch {
      setBusy(false)
    }
  }

  function openSupportEmail() {
    Linking.openURL('mailto:support@myrxfit.com').catch(() => {})
  }
  function openPrivacyPolicy() {
    Linking.openURL('https://myrxfit.com/privacy').catch(() => {})
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.outer}>
        <View style={s.card}>

          {/* Header — amber alert icon + display name */}
          <View style={s.headerRow}>
            <View style={s.iconCircle}>
              <AlertTriangle size={20} color={palette.amber[400]} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.eyebrow}>Account scheduled for deletion</Text>
              <Text style={s.identityLine} numberOfLines={1}>
                {(profile as any)?.full_name || user?.email}
              </Text>
            </View>
          </View>

          {/* Body — minimum legally required: state the deletion date.
              Retention details live in the Privacy Policy (linked in the
              footer below). Mirrors the web ReactivationGate. */}
          <View style={s.body}>
            {daysLeft != null && (
              <Text style={s.bodyText}>
                Your account is scheduled for deletion on{' '}
                <Text style={s.bodyEmphasis}>{formattedDate}</Text>
                {' '}— in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}.
              </Text>
            )}
          </View>

          {/* Error */}
          {err ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{err}</Text>
            </View>
          ) : null}

          {/* Actions — Reactivate primary, Sign out secondary */}
          <Pressable
            onPress={handleReactivate}
            disabled={busy}
            style={({ pressed }) => [s.primaryBtn, (busy || pressed) && s.btnDim]}
          >
            {busy
              ? <ActivityIndicator color={colors.primaryForeground} size="small" />
              : <RotateCcw size={16} color={colors.primaryForeground} />}
            <Text style={s.primaryBtnLabel}>Reactivate my account</Text>
          </Pressable>

          <Pressable
            onPress={handleSignOut}
            disabled={busy}
            style={({ pressed }) => [s.secondaryBtn, (busy || pressed) && s.btnDim]}
          >
            <LogOut size={16} color={colors.mutedForeground} />
            <Text style={s.secondaryBtnLabel}>Sign out</Text>
          </Pressable>

          {/* Footnote — Privacy Policy link is the legally-required disclosure
              of what data is retained after deletion. Mirrors web. */}
          <View style={s.footnoteRow}>
            <Pressable onPress={openPrivacyPolicy} hitSlop={6}>
              <Text style={s.footnoteLink}>Privacy Policy</Text>
            </Pressable>
            <Text style={s.footnoteSep}> · </Text>
            <Pressable onPress={openSupportEmail} hitSlop={6}>
              <Text style={s.footnoteLink}>support@myrxfit.com</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: colors.background },
  outer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%', maxWidth: 420,
    borderRadius: 18, borderWidth: 1,
    borderColor: alpha(palette.amber[500], 0.30),
    backgroundColor: colors.card,
    padding: 22,
  },

  // Header
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 18,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: alpha(palette.amber[500], 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: fonts.sans[700],
    fontSize: 11, color: palette.amber[400],
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  identityLine: {
    fontFamily: fonts.sans[400],
    fontSize: 13, color: colors.mutedForeground,
    marginTop: 2,
  },

  // Body
  body: { gap: 12, marginBottom: 20 },
  bodyText:     { fontFamily: fonts.sans[400], fontSize: 14, lineHeight: 20, color: colors.foreground },
  bodyMuted:    { fontFamily: fonts.sans[400], fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
  bodyEmphasis:    { fontFamily: fonts.sans[700], color: palette.amber[400] },
  bodyEmphasisFg:  { fontFamily: fonts.sans[600], color: colors.foreground },

  // Error
  errorBox: {
    borderRadius: 10, borderWidth: 1, borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.10),
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 14,
  },
  errorText: { fontFamily: fonts.sans[400], fontSize: 12, color: colors.destructive },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12, borderRadius: 12,
    marginBottom: 8,
  },
  primaryBtnLabel: {
    fontFamily: fonts.sans[700],
    fontSize: 14, color: colors.primaryForeground,
  },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, borderRadius: 12,
  },
  secondaryBtnLabel: {
    fontFamily: fonts.sans[400],
    fontSize: 14, color: colors.mutedForeground,
  },
  btnDim: { opacity: 0.55 },

  // Footnote — Privacy Policy + support, separated by " · ".
  footnoteRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    marginTop: 18,
  },
  footnote: {
    fontFamily: fonts.sans[400], fontSize: 11,
    color: alpha(colors.mutedForeground, 0.6),
  },
  footnoteLink: {
    fontFamily: fonts.sans[400], fontSize: 11,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
  footnoteSep: {
    fontFamily: fonts.sans[400], fontSize: 11,
    color: alpha(colors.mutedForeground, 0.6),
  },
})
