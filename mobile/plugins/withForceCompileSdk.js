/**
 * withForceCompileSdk — Expo config plugin that forces all Android subprojects
 * (including unmaintained third-party RN libraries) to compile against modern
 * SDK + build tools, surviving `expo prebuild --clean`.
 *
 * Background: react-native-sms-user-consent v1.4.0 hardcodes
 *     compileSdkVersion 23
 *     buildToolsVersion "23.0.1"
 * in its own android/build.gradle. AGP 8 + Java 9+ source compilation refuses
 * any compileSdkVersion below 30, so a fresh `expo prebuild --clean` build
 * fails immediately with:
 *     In order to compile Java 9+ source, please set compileSdkVersion to 30 or above
 *
 * The library is unmaintained (last release 2020) so patching it upstream isn't
 * an option, and we don't want to fork. The standard Gradle pattern is a
 * `subprojects { afterEvaluate { ... } }` block in the ROOT build.gradle that
 * mutates every subproject's android extension after it's been declared.
 *
 * Without this plugin the override would need to be manually re-added after
 * every `expo prebuild --clean` (the same trap that caused the May 18 2026
 * MainActivity Samsung Health regression).
 *
 * Idempotent — checks for the marker string before appending.
 */

const { withProjectBuildGradle } = require('@expo/config-plugins')

const MARKER = '// MyRX: force compileSdk 36 on third-party libs'

module.exports = function withForceCompileSdk(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `withForceCompileSdk only supports Groovy build.gradle (got ${cfg.modResults.language})`,
      )
    }

    let src = cfg.modResults.contents

    if (src.includes(MARKER)) {
      return cfg
    }

    const override = `

${MARKER}
// react-native-sms-user-consent v1.4.0 hardcodes compileSdkVersion 23 in its
// own build.gradle, which AGP 8 / Java 9+ rejects. Bump every subproject's
// android.compileSdk to the project default (36 — required since Rive 9.8.3
// pulls in androidx.core 1.17.0, which mandates compileSdk 36), but only if
// it's missing
// or below 30 so we don't accidentally downgrade libs that declare something
// higher.
//
// Uses plugins.withId() (a listener) instead of afterEvaluate() so the
// override works whether a given subproject has already been evaluated by
// expo-root-project (which runs before us) or hasn't yet. afterEvaluate
// throws "project is already evaluated" for the already-evaluated ones.
subprojects { p ->
  p.plugins.withId('com.android.library') {
    p.android {
      if (compileSdk == null || compileSdk < 30) {
        compileSdk 36
        buildToolsVersion '36.0.0'
      }
    }
  }
  p.plugins.withId('com.android.application') {
    p.android {
      if (compileSdk == null || compileSdk < 30) {
        compileSdk 36
        buildToolsVersion '36.0.0'
      }
    }
  }
}
`

    cfg.modResults.contents = src + override
    return cfg
  })
}
