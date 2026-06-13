import { Dimensions, StyleSheet } from 'react-native'
import Svg, { Defs, RadialGradient, Stop, Rect, G, Line } from 'react-native-svg'
import { colors } from '../theme'

/**
 * AmbientBackground — the ONE ambient backdrop for the mobile auth/onboarding
 * screens (T253 phase 2). RN analog of web's AmbientBackground.
 *
 * Why this exists: each auth screen had its OWN backdrop with different values
 * — welcome/sign-in/forgot-password used a lime + an off-brand SKY-BLUE glow
 * (sign-in even bumped the opacities), and the signup journey dropped the glow
 * entirely (grid only). That's "different looks," not one brand. This is the
 * single source of truth: a subtle grid + two LIME brand glows (the blue is
 * gone — brand color is lime), identical on every screen.
 *
 * Render as the FIRST child of the screen root so it sits behind the content
 * (RN paints later siblings on top — no z-index needed). pointerEvents none so
 * it never intercepts touches.
 *
 * Scope: auth/onboarding only (welcome, sign-in, sign-up, forgot-password,
 * accept-invite, coach-pending). The app tabs/dashboards stay flat — same call
 * the user made for the web dashboards.
 */
const { width: SCR_W, height: SCR_H } = Dimensions.get('window')
const COLS = 12
const ROWS = 24
const cellW = SCR_W / COLS
const cellH = SCR_H / ROWS

export default function AmbientBackground() {
  return (
    <Svg width={SCR_W} height={SCR_H} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        {/* Top-left lime glow — sits behind the wordmark. */}
        <RadialGradient id="ambientLimeTL" cx="20%" cy="8%" rx="60%" ry="60%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.38" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
        {/* Top-right lime glow — balances the composition (was off-brand blue). */}
        <RadialGradient id="ambientLimeTR" cx="85%" cy="15%" rx="55%" ry="55%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.20" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#ambientLimeTL)" />
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#ambientLimeTR)" />
      <G opacity={0.1}>
        {Array.from({ length: COLS + 1 }).map((_, i) => (
          <Line
            key={`v${i}`}
            x1={i * cellW} y1={0}
            x2={i * cellW} y2={SCR_H}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: ROWS + 1 }).map((_, i) => (
          <Line
            key={`h${i}`}
            x1={0} y1={i * cellH}
            x2={SCR_W} y2={i * cellH}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
      </G>
    </Svg>
  )
}
