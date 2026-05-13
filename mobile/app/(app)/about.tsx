/**
 * About MyRX — sub-screen reached from Settings → "About MyRX".
 *
 * Mirrors the Instagram / Spotify "About" pattern: one screen that
 * bundles the small bits of metadata users occasionally need but
 * don't belong cluttering the main Settings card list:
 *
 *   • App version + build number (from expo-constants)
 *   • Legal docs (Terms, Privacy, Cookies, Acceptable Use)
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

const LEGAL_LINKS = [
  { url: 'https://myrxfit.com/terms',          label: 'Terms of Service' },
  { url: 'https://myrxfit.com/privacy',        label: 'Privacy Policy' },
  { url: 'https://myrxfit.com/cookies',        label: 'Cookie Policy' },
  { url: 'https://myrxfit.com/acceptable-use', label: 'Acceptable Use' },
]

export default function AboutMyRX() {
  // app.json's `version` field. expo-constants reads it from the
  // running build's manifest. Falls back to "—" if anything weird.
  const version = Constants.expoConfig?.version ?? '—'

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

      {/* Legal — four documents, each opens in an in-app browser
          sheet. Right-chevron icon signals "this opens something"
          (matches the system Settings pattern across iOS + Android). */}
      <Text style={s.sectionLabel}>Legal</Text>
      <View style={s.card}>
        {LEGAL_LINKS.map((item, i) => (
          <Pressable
            key={item.url}
            onPress={() => openLegalDoc(item.url)}
            style={[
              s.linkRow,
              i < LEGAL_LINKS.length - 1 ? s.linkRowDivider : null,
            ]}
          >
            <Text style={s.linkLabel}>{item.label}</Text>
            <ChevronRight size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

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
