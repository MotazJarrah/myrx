/**
 * openLegalDoc — opens a legal-doc URL in an in-app browser sheet.
 *
 * Why this helper exists rather than calling `Linking.openURL`
 * directly:
 *
 *   • In-app sheet keeps the user in MyRX. The system browser
 *     (`Linking.openURL`) yeets them to Chrome / Safari and forces
 *     a swipe-back to return — minor but noticeable hiccup that
 *     every modern app (Strava, Instagram, TikTok) avoids.
 *
 *   • Implementation is platform-native:
 *       iOS    → SFSafariViewController   (slides up, swipe to close)
 *       Android → Chrome Custom Tabs       (slides up, back-press to close)
 *     Same browser engine, same cookies, same look — just rendered
 *     inside the app's process.
 *
 *   • If the in-app browser fails for any reason (rare — e.g. no
 *     compatible browser installed on Android), we fall back to
 *     `Linking.openURL` so the user still gets to the doc.
 *
 * One helper, one call site shape: `openLegalDoc(url)`. Use this
 * everywhere a legal-doc link is tapped (sign-in microcopy, sign-up
 * consent labels, profile Legal section).
 */

import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'

export async function openLegalDoc(url: string): Promise<void> {
  try {
    // Open without custom toolbar/controls tinting. The previous
    // version passed `colors.background` and `colors.primary` (HSL
    // strings like `hsl(220, 12%, 6%)`) to `toolbarColor` /
    // `controlsColor`, but those options expect HEX (`#RRGGBB`) —
    // passing HSL stalls the Chrome Custom Tabs handshake on some
    // Android versions and surfaces as the browser sheet sitting
    // forever on "loading" with the navigation bar spinner stuck.
    // Platform defaults look fine; not worth maintaining a hex
    // palette parallel to the theme HSL just to tint the toolbar.
    await WebBrowser.openBrowserAsync(url)
  } catch {
    // Fallback: system browser. Only fires if expo-web-browser
    // throws (e.g. no Custom Tabs–compatible browser on Android).
    try { await Linking.openURL(url) } catch { /* give up silently */ }
  }
}
