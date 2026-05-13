/**
 * Step indicator dots — 1:1 port of MyRX/src/pages/Auth.jsx's StepDots.
 *
 *   ●━━━━○──○──○──○      step 1 of 5
 *   ●──●━━━━○──○──○      step 2 of 5
 *
 * Active step = wide pill (16px), filled with primary.
 * Past steps = small dot (6px), 50% primary opacity.
 * Future steps = small dot (6px), border-color.
 */

import { View, StyleSheet } from 'react-native'
import { colors, alpha } from '../theme'

interface Props {
  step:  number   // 1-indexed (matches web)
  total: number
}

export function StepDots({ step, total }: Props) {
  return (
    <View style={s.row}>
      {Array.from({ length: total }).map((_, i) => {
        const idx     = i + 1
        const active  = idx === step
        const past    = idx < step
        return (
          <View
            key={i}
            style={[
              s.dot,
              active ? s.active : null,
              past   ? s.past : null,
            ]}
          />
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 24,
  },
  dot: {
    height: 6,
    width: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  active: {
    width: 16,
    backgroundColor: colors.primary,
  },
  past: {
    backgroundColor: alpha(colors.primary, 0.5),
  },
})
