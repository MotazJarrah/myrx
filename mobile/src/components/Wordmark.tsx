import { Image, type ImageStyle, type StyleProp } from 'react-native'

/**
 * Wordmark — the ONE MyRX wordmark for the mobile app (T253).
 *
 * The RN analog of web's Wordmark component. The wordmark had drifted to
 * several sizes across screens — 24px (sign-in, accept-invite), 28px (the
 * app top bar), 36px (welcome/carousel) — which reads as "different looks,"
 * not one brand. Every chrome wordmark now renders THIS, so the size can't
 * diverge again.
 *
 * Canonical height: 28px — matches the always-visible app top bar (the
 * wordmark users see on every screen during use) and the web's 28px. Width
 * is derived from the asset's true aspect (1781×390 ≈ 4.567:1) so it never
 * distorts. Callers pass `style` for POSITIONING only (margins/alignment),
 * never height/width.
 *
 * The mobile app is dark-only chrome, so this always uses the white
 * (dark-surface) wordmark — matching every existing usage. The signup
 * welcome screen keeps its larger slogan wordmark as the one intentional
 * hero exception (same carve-out as web), and the LoadingScreen splash uses
 * its own animated logo.
 */
const WORDMARK_HEIGHT = 28
const WORDMARK_WIDTH = Math.round(WORDMARK_HEIGHT * (1781 / 390)) // ≈ 128
const SRC = require('../../assets/myrx-wordmark-dark.png')

export default function Wordmark({ style }: { style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={SRC}
      style={[{ height: WORDMARK_HEIGHT, width: WORDMARK_WIDTH }, style]}
      resizeMode="contain"
      accessibilityLabel="MyRX"
    />
  )
}
