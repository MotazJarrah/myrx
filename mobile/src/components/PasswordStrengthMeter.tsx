/**
 * Password strength meter — 4 bars + label.
 *
 * 1:1 port of the inline strength indicator in MyRX/src/pages/Auth.jsx
 * step 1 (signup). Same `checkStrength()` algorithm so the verdict matches
 * across web and mobile.
 */

import { View, Text, StyleSheet } from 'react-native'
import { colors, alpha, palette, withAlpha } from '../theme'

export function checkStrength(pw: string): number {
  let score = 0
  if (pw.length >= 8)                        score++
  if (pw.length >= 12)                       score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw))  score++
  if (/\d/.test(pw))                          score++
  if (/[^A-Za-z0-9]/.test(pw))               score++
  return Math.min(score, 4)
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Strong', 'Excellent'] as const

// Bar fill colors per strength level — matches web's
// `bg-muted | bg-destructive/70 | bg-yellow-500/80 | bg-primary/70 | bg-[#00BFFF]`.
function barColor(strength: number): string {
  if (strength === 0) return colors.muted
  if (strength === 1) return alpha(colors.destructive, 0.70)
  if (strength === 2) return withAlpha(palette.yellow[500], 0.80)
  if (strength === 3) return alpha(colors.primary, 0.70)
  return '#00BFFF'  // "Excellent" — bright sky-blue (matches web)
}

function labelColor(strength: number): string {
  if (strength === 4) return '#00BFFF'
  if (strength >= 3)  return colors.primary
  return colors.mutedForeground
}

interface Props {
  password: string
}

export function PasswordStrengthMeter({ password }: Props) {
  const strength = checkStrength(password)
  const empty    = password.length === 0
  const fill     = barColor(strength)
  return (
    <View style={s.row}>
      <View style={s.barTrack}>
        {[1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[
              s.barCell,
              { backgroundColor: i <= strength ? fill : colors.muted },
            ]}
          />
        ))}
      </View>
      <Text style={[s.label, { color: labelColor(strength) }]}>
        {empty ? ' ' /* keep height stable */ : LABELS[strength]}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  barTrack: {
    flex: 1, height: 4,
    flexDirection: 'row',
    gap: 2,
    backgroundColor: colors.muted,
    borderRadius: 9999,
    overflow: 'hidden',
  },
  barCell: { flex: 1, borderRadius: 9999 },
  label:   { fontSize: 11, width: 64, textAlign: 'right' },
})
