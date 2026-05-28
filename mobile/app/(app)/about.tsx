/**
 * About MyRX — sub-screen reached from Settings → "About MyRX".
 *
 * Mirrors the Instagram / Spotify "About" pattern: one screen that
 * bundles the small bits of metadata users occasionally need but
 * don't belong cluttering the main Settings card list:
 *
 *   • App version + build number (from expo-constants)
 *   • Legal docs (Terms, Privacy, Cookies, Acceptable Use, Coach
 *     Agreement, Refund Policy, Health Disclaimer, DPA)
 *   • Operating-entity disclosure (Northern Princess LLC, Michigan, USA)
 *
 * Future home for: open-source licenses, "What's new" changelog,
 * "Contact us" email link, "Send feedback" form. Build them as
 * additional sections on this same screen rather than padding
 * Settings further.
 *
 * Each legal-doc tap opens the doc as an in-app browser sheet via
 * openLegalDoc — same UX as Strava / Instagram (slides up, swipe
 * to dismiss, never leaves the app).
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { openLegalDoc } from '../../src/lib/openLegalDoc'
import { colors, alpha } from '../../src/theme'
import { useAuth } from '../../src/contexts/AuthContext'

// Two groups so the user can quickly find the doc they're looking for
// instead of scrolling a long flat list. Order + labels mirror web's
// LegalLayout.jsx FOOTER_LINKS so the two surfaces stay in lockstep —
// when a new doc lands on web, add it here too.
const GENERAL_LEGAL_LINKS = [
  { url: 'https://myrxfit.com/terms',              label: 'Terms of Service' },
  { url: 'https://myrxfit.com/privacy',            label: 'Privacy Policy' },
  { url: 'https://myrxfit.com/cookies',            label: 'Cookie Policy' },
  { url: 'https://myrxfit.com/acceptable-use',     label: 'Acceptable Use' },
  { url: 'https://myrxfit.com/health-disclaimer',  label: 'Health & Medical Disclaimer' },
  { url: 'https://myrxfit.com/refund-policy',      label: 'Refund Policy' },
]

// Coach-specific docs. Gated on profile.is_coach (or is_superuser for
// platform owners). Athletes don't see these — Coach Agreement + DPA
// are B2B docs that don't apply to them. A coach who signs in on
// mobile (e.g. to log their own training) still sees these because
// their coach role makes the docs relevant.
// Mirrors web's AccountSettings.jsx AboutTab gating rule.
const COACH_LEGAL_LINKS = [
  { url: 'https://myrxfit.com/coach-agreement', label: 'Coach Agreement' },
  { url: 'https://myrxfit.com/dpa',             label: 'Data Processing Agreement' },
]

export default function AboutMyRX() {
  // app.json's `version` field. expo-constants reads it from the
  // running build's manifest. Falls back to "—" if anything weird.
  const version = Constants.expoConfig?.version ?? '—'

  // Role-gate the Coach Platform docs section. Coaches and the
  // platform owner (superuser) see it; athletes don't.
  const { profile } = useAuth()
  const showCoachDocs = profile?.is_coach === true || profile?.is_superuser === true

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {/* Sub-screen header — chevron back to Settings. The (app)
          layout's TopBar with the logo is hidden for sub-pages
          via the route's options elsewhere; here we render our own
          inline header so the user always has a back affordance. */}
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        style={s.backBtn}
      >
        <ChevronLeft size={20} color={colors.foreground} />
        <Text style={s.backText}>Settings</Text>
      </Pressable>

      <Text style={s.title}>About</Text>

      {/* App identity card — version + build. Build number isn't
          surfaced by Expo Constants for non-EAS builds, so for now
          we just show the version. Add `Constants.expoConfig?.runtimeVersion`
          or platform-specific build numbers later if needed. */}
      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.rowLabel}>Version</Text>
          <Text style={s.rowValue}>{version}</Text>
        </View>
      </View>

      {/* Legal — split into two groups so the long list isn't a wall.
          Each row opens in an in-app browser sheet. Right-chevron icon
          signals "this opens something" (matches the system Settings
          pattern across iOS + Android). */}
      <Text style={s.sectionLabel}>Legal</Text>
      <View style={s.card}>
        {GENERAL_LEGAL_LINKS.map((item, i) => (
          <Pressable
            key={item.url}
            onPress={() => openLegalDoc(item.url)}
            style={[
              s.linkRow,
              i < GENERAL_LEGAL_LINKS.length - 1 ? s.linkRowDivider : null,
            ]}
          >
            <Text style={s.linkLabel}>{item.label}</Text>
            <ChevronRight size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      {/* Coach platform docs — only render for coaches + platform
          superusers. Athletes don't see this section. Same chrome as
          the general legal card. */}
      {showCoachDocs && (
        <>
          <Text style={s.sectionLabel}>Coach Platform</Text>
          <View style={s.card}>
            {COACH_LEGAL_LINKS.map((item, i) => (
              <Pressable
                key={item.url}
                onPress={() => openLegalDoc(item.url)}
                style={[
                  s.linkRow,
                  i < COACH_LEGAL_LINKS.length - 1 ? s.linkRowDivider : null,
                ]}
              >
                <Text style={s.linkLabel}>{item.label}</Text>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </>
      )}

      {/* Operating-entity footer — required disclosure (the entity
          you're contracting with for ToS / PP) and good practice. */}
      <Text style={s.entityFooter}>
        MyRX is operated by Northern Princess LLC, Michigan, USA.{'\n'}
        © {new Date().getFullYear()} Northern Princess LLC. All rights reserved.
      </Text>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40, gap: 16 },

  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginLeft: -6,
    paddingVertical: 4,
  },
  backText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },

  title: {
    color: colors.foreground,
    fontSize: 28, fontWeight: '600', letterSpacing: -0.5,
    marginTop: 8, marginBottom: 8,
  },

  sectionLabel: {
    color: colors.mutedForeground,
    fontSize: 12, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: 8, marginBottom: -8, paddingHorizontal: 4,
  },

  card: {
    backgroundColor: alpha(colors.card, 0.80),
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  rowValue: { color: colors.mutedForeground, fontSize: 14 },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  linkRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: alpha(colors.border, 0.5),
  },
  linkLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },

  entityFooter: {
    color: colors.mutedForeground,
    fontSize: 11, lineHeight: 16,
    textAlign: 'center', marginTop: 16,
  },
})
