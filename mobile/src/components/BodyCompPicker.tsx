/**
 * BodyCompPicker — 3-band body fat self-report via gender-aware
 * silhouettes. Output is a `BodyFatBand` string ('lean'|'average'|'high')
 * persisted on `profiles.body_fat_band`.
 *
 * Used as conditional step 1 of PlanWizardSheet (only renders when the
 * user hasn't picked yet — once stored, the wizard skips this step).
 *
 * Silhouettes are PNG assets at mobile/assets/bodycomp/, extracted from
 * branding/bfp.jpg via the script at branding/extract_bodycomp.py:
 *   • Source: Adobe Stock illustration (license before production)
 *   • Each silhouette upscaled 4× via LANCZOS so anti-aliased edges
 *     stay smooth at picker size
 *   • Stored as white-on-transparent so the picker can recolor via
 *     Image.tintColor at render time
 *
 * Gender source: `profile.gender`. Non-binary / prefer-not-to-say /
 * null all see the female silhouette set + female cutoffs, per the
 * uniform "male / else = female" rule applied across every gender-
 * driven calc in the app (see calorieFormulas.ts calcBMR canonical
 * comment).
 */

import { View, Text, Pressable, StyleSheet, Image } from 'react-native'
import { Check } from 'lucide-react-native'
import { colors, alpha, fonts } from '../theme'
import {
  BODY_FAT_BAND_INFO, BODY_FAT_BAND_ORDER, bodyFatGenderKey,
  type BodyFatBand,
} from '../lib/planPresets'

// ── Silhouette PNG assets ────────────────────────────────────────────────────
// Static require() so Metro can resolve at bundle time — dynamic
// require(string) doesn't work. Map keyed by genderKey ('male' | 'else')
// to match bodyFatGenderKey() output.
const SILHOUETTE_ASSETS: Record<'male' | 'else', Record<BodyFatBand, number>> = {
  male: {
    lean:    require('../../assets/bodycomp/male-lean.png'),
    average: require('../../assets/bodycomp/male-average.png'),
    high:    require('../../assets/bodycomp/male-high.png'),
  },
  else: {
    lean:    require('../../assets/bodycomp/female-lean.png'),
    average: require('../../assets/bodycomp/female-average.png'),
    high:    require('../../assets/bodycomp/female-high.png'),
  },
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Currently-picked band — null when nothing chosen yet (first-time flow). */
  value:    BodyFatBand | null
  onChange: (band: BodyFatBand) => void
  /** Profile gender — null/non-binary/prefer-not-to-say all use female set. */
  gender:   string | null
  /** Whether to show the "You can change this later from Profile →
      Preferences → Body stats" footnote. Defaults to true (wizard
      usage). Pass false when this picker IS the settings editor
      itself — no point telling the user where to find a setting
      they're already inside. */
  showFootnote?: boolean
}

export default function BodyCompPicker({ value, onChange, gender, showFootnote = true }: Props) {
  const genderKey = bodyFatGenderKey(gender)
  const assets    = SILHOUETTE_ASSETS[genderKey]
  const info      = BODY_FAT_BAND_INFO[genderKey]

  return (
    <View style={s.wrapper}>
      {/* Subtitle trimmed (May 24 2026) — kept only the first sentence
          per user feedback. The previous "leaner bodies lose slower,
          untrained bodies gain mostly fat" tail was extra context the
          screen didn't need; the per-card descriptions below carry
          enough specificity on their own. */}
      <Text style={s.helper}>
        Pick the silhouette that most closely matches your current body.
      </Text>

      <View style={s.row}>
        {BODY_FAT_BAND_ORDER.map(band => {
          const active = band === value
          const cfg    = info[band]
          // tintColor recolors the white silhouette pixels:
          //   • active   → brand primary (lime)
          //   • idle     → muted-foreground at 70% so cards read as
          //                "ghosted" until selected
          const tintColor = active
            ? colors.primary
            : alpha(colors.foreground, 0.7)
          return (
            <Pressable
              key={band}
              onPress={() => onChange(band)}
              style={[s.card, active && s.cardActive]}
            >
              <View style={s.imageWrap}>
                <Image
                  source={assets[band]}
                  style={[s.silhouette, { tintColor }]}
                  resizeMode="contain"
                />
                {active && (
                  <View style={s.checkBubble}>
                    <Check size={12} color={colors.primaryForeground} />
                  </View>
                )}
              </View>
              <Text style={[s.label, active && s.labelActive]}>{cfg.label}</Text>
              <Text style={s.range}>{cfg.rangeText}</Text>
              <Text style={s.description} numberOfLines={3}>{cfg.description}</Text>
            </Pressable>
          )
        })}
      </View>

      {/* Footnote — only shown when this picker is rendered OUTSIDE
          the settings editor (i.e. from the wizard's first step). When
          the user is already IN Profile → Preferences → Body stats
          (the showFootnote=false case), pointing them to that exact
          location would be silly. */}
      {showFootnote && (
        <Text style={s.footnote}>
          You can change this later from Profile → Preferences → Body stats.
        </Text>
      )}
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrapper: { gap: 12 },
  helper:  { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  row:     { flexDirection: 'row', gap: 8 },
  card: {
    flex: 1,
    gap: 4,
    paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.background, 0.40),
    alignItems: 'center',
  },
  cardActive: {
    borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.08),
  },
  imageWrap:  { position: 'relative', marginBottom: 4 },
  silhouette: { width: 80, height: 140 },
  checkBubble: {
    position: 'absolute', top: -2, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  label:       { fontSize: 13, color: colors.foreground, fontFamily: fonts.sans[600] },
  labelActive: { color: colors.primary },
  range:       { fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.mono[500] },
  description: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center', lineHeight: 13, marginTop: 4 },
  footnote:    { fontSize: 11, color: alpha(colors.mutedForeground, 0.7), textAlign: 'center', marginTop: 4 },
})
