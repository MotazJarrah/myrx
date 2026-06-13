import { Dimensions, StyleSheet } from 'react-native'
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg'
import { colors } from '../theme'

/**
 * AmbientBackground — the ONE ambient backdrop for the mobile auth/onboarding
 * screens (T253/T254). RN analog of web's AmbientBackground.
 *
 * Two LIME brand glows (top-left behind the wordmark + a top-right balance).
 * Identical on every screen — welcome, sign-in, sign-up, forgot-password,
 * accept-invite, coach-pending. App tabs/dashboards stay flat.
 *
 * T254: the grid lines were removed (user: "take out the grid lines from
 * everywhere") and the glows toned down a notch (user: "the ambient is very
 * strong"). The off-brand sky-blue glow was already dropped (T253).
 *
 * Render as the FIRST child of the screen root so it sits behind the content
 * (RN paints later siblings on top). pointerEvents none so it never
 * intercepts touches.
 */
const { width: SCR_W, height: SCR_H } = Dimensions.get('window')

export default function AmbientBackground() {
  return (
    <Svg width={SCR_W} height={SCR_H} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        {/* Top-left lime glow — sits behind the wordmark. */}
        <RadialGradient id="ambientLimeTL" cx="20%" cy="8%" rx="60%" ry="60%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.26" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
        {/* Top-right lime glow — balances the composition. */}
        <RadialGradient id="ambientLimeTR" cx="85%" cy="15%" rx="55%" ry="55%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.15" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#ambientLimeTL)" />
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#ambientLimeTR)" />
    </Svg>
  )
}
