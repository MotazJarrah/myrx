/**
 * withSamsungHealth — Expo config plugin that wires the Samsung Health Data
 * SDK into the Android project so the integration survives `expo prebuild --clean`.
 *
 * The Samsung Health Data SDK is distributed as a vendored AAR under
 * `app/libs/samsung-health-data-api-1.1.0.aar` (downloaded by the developer
 * from https://developer.samsung.com/health/data — Samsung's license forbids
 * Maven/jitpack redistribution). The SDK calls into the Samsung Health app on
 * the device via local IPC, NOT OAuth — the host app is verified by package
 * name + signing-key SHA-256, both registered with Samsung at app-approval
 * time. There is no Client ID or Client Key embedded anywhere in the project.
 *
 * What this plugin does on every prebuild:
 *
 *   1. AndroidManifest.xml — adds the `<queries><package
 *      android:name="com.sec.android.app.shealth"/></queries>` entry. Without
 *      this, Android 11+ package-visibility rules hide Samsung Health from
 *      our `PackageManager` lookups and the SDK reports the provider as
 *      unavailable.
 *
 *   2. app/build.gradle — adds `apply plugin: kotlin-parcelize` (SDK's
 *      @Parcelize'd data classes won't compile without it), pulls in
 *      `gson`, `lifecycle-runtime-ktx`, and `kotlinx-coroutines-android`,
 *      and adds `fileTree(libs/*.aar)` so the vendored AAR gets resolved.
 *
 *   3. MainApplication.kt — adds the SamsungHealthPackage import + the
 *      `add(SamsungHealthPackage())` line inside `getPackages()`. Without
 *      this the JS-side NativeModules.SamsungHealth is undefined.
 *
 *   4. gradle.properties — bumps `android.minSdkVersion` to 29 if the
 *      current value is lower (Samsung Health Data SDK requires Android 10+).
 *
 * Edits are idempotent: running prebuild N times produces the same result
 * (each mutation checks for existing presence before appending).
 */

const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withGradleProperties,
  withDangerousMod,
} = require('@expo/config-plugins')
const fs   = require('fs')
const path = require('path')

const SHEALTH_PACKAGE = 'com.sec.android.app.shealth'
const SAMSUNG_MIN_SDK = 29

// ── Source-of-truth locations under mobile/plugins/samsung-sdk/ ───────────────
// These files survive `expo prebuild --clean` because they live OUTSIDE the
// generated android/ folder. The plugin copies them into android/ every time
// prebuild runs, so the Samsung Health integration is reproducible from source.
const SAMSUNG_SDK_DIR = path.join(__dirname, 'samsung-sdk')
const AAR_FILENAME    = 'samsung-health-data-api-1.1.0.aar'
const KT_SOURCES      = ['SamsungHealthPackage.kt', 'SamsungHealthModule.kt']

function withSamsungHealthManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

    if (!Array.isArray(manifest.queries)) {
      manifest.queries = []
    }
    let queries = manifest.queries[0]
    if (!queries) {
      queries = {}
      manifest.queries.push(queries)
    }
    if (!Array.isArray(queries.package)) {
      queries.package = []
    }
    const present = new Set(
      queries.package.map((p) => p?.$?.['android:name']).filter(Boolean),
    )
    if (!present.has(SHEALTH_PACKAGE)) {
      queries.package.push({ $: { 'android:name': SHEALTH_PACKAGE } })
    }

    return cfg
  })
}

function withSamsungHealthGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents

    // 1. Apply kotlin-parcelize plugin right after the kotlin.android plugin.
    if (!src.includes('org.jetbrains.kotlin.plugin.parcelize')) {
      src = src.replace(
        /apply plugin:\s*"org\.jetbrains\.kotlin\.android"/,
        `apply plugin: "org.jetbrains.kotlin.android"\napply plugin: "org.jetbrains.kotlin.plugin.parcelize"`,
      )
    }

    // 2. Inject the Samsung-related dependency block right after the first
    //    react-android implementation line inside `dependencies { ... }`.
    const samsungBlock = `\n    // ── Samsung Health Data SDK (vendored AAR + gson) ───────────────────────\n    // The AAR is dropped into app/libs/ by hand from Samsung Developer Console\n    // (it is not on Maven Central — Samsung distributes it via developer.samsung.com).\n    // Required version: samsung-health-data-api-1.1.0.aar (March 12 2026, latest).\n    implementation fileTree(dir: 'libs', include: ['*.aar'])\n    implementation("com.google.code.gson:gson:2.13.2")\n    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")\n`
    if (!src.includes('samsung-health-data-api')) {
      src = src.replace(
        /(implementation\("com\.facebook\.react:react-android"\))/,
        `$1${samsungBlock}`,
      )
    }

    cfg.modResults.contents = src
    return cfg
  })
}

function withSamsungHealthMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents

    // 1. Add the import.
    if (!src.includes('import com.myrx.app.samsung.SamsungHealthPackage')) {
      src = src.replace(
        /import expo\.modules\.ReactNativeHostWrapper/,
        `import expo.modules.ReactNativeHostWrapper\n\nimport com.myrx.app.samsung.SamsungHealthPackage`,
      )
    }

    // 2. Register the package inside getPackages().apply { ... } — replace
    //    the boilerplate comment with our add() call. Idempotent.
    if (!src.includes('add(SamsungHealthPackage())')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{([^}]*)\}/,
        (match, inner) => {
          const trimmed = inner.replace(
            /\/\/ Packages that cannot be autolinked yet[\s\S]*?\/\/ add\(MyReactNativePackage\(\)\)/,
            '',
          )
          return `PackageList(this).packages.apply {\n              add(SamsungHealthPackage())${trimmed}}`
        },
      )
    }

    cfg.modResults.contents = src
    return cfg
  })
}

function withSamsungHealthMinSdk(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults
    const existing = props.find(
      (p) => p.type === 'property' && p.key === 'android.minSdkVersion',
    )
    if (existing) {
      const current = parseInt(existing.value, 10)
      if (!Number.isFinite(current) || current < SAMSUNG_MIN_SDK) {
        existing.value = String(SAMSUNG_MIN_SDK)
      }
    } else {
      props.push({
        type: 'property',
        key: 'android.minSdkVersion',
        value: String(SAMSUNG_MIN_SDK),
      })
    }
    cfg.modResults = props
    return cfg
  })
}

// ── Asset deployment (the May 29 2026 fix that closes the prebuild-wipe trap) ─
// `expo prebuild --clean` regenerates android/ from scratch, wiping any files
// not produced by the prebuild pipeline. Before this hook existed, the May 29
// 2026 incident wiped the vendored AAR + the two Kotlin source files and broke
// the build until they were restored manually.
//
// This dangerous-mod copies:
//   1. samsung-health-data-api-1.1.0.aar → android/app/libs/
//   2. SamsungHealthPackage.kt           → android/app/src/main/java/com/myrx/app/samsung/
//   3. SamsungHealthModule.kt            → android/app/src/main/java/com/myrx/app/samsung/
//
// All three files live under mobile/plugins/samsung-sdk/ which is the
// source-of-truth — edit there, not in the generated android/ copies.
function withSamsungHealthAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformRoot = cfg.modRequest.platformProjectRoot
      const libsDir = path.join(platformRoot, 'app', 'libs')
      const ktDir = path.join(
        platformRoot,
        'app', 'src', 'main', 'java',
        'com', 'myrx', 'app', 'samsung',
      )

      // Ensure source-of-truth folder exists. If not, fail loudly with a clear
      // message rather than silently producing a broken build.
      if (!fs.existsSync(SAMSUNG_SDK_DIR)) {
        throw new Error(
          `[withSamsungHealth] source-of-truth folder missing: ${SAMSUNG_SDK_DIR}\n` +
          `Re-download the Samsung Health Data SDK (https://developer.samsung.com/health/data)\n` +
          `and place the AAR + Kotlin sources at mobile/plugins/samsung-sdk/.`,
        )
      }

      const aarSrc = path.join(SAMSUNG_SDK_DIR, AAR_FILENAME)
      if (!fs.existsSync(aarSrc)) {
        throw new Error(
          `[withSamsungHealth] AAR missing at ${aarSrc} — Samsung license forbids ` +
          `redistribution via git/Maven so the .aar must be hand-placed once per ` +
          `clone. Drop it in mobile/plugins/samsung-sdk/ and re-run prebuild.`,
        )
      }

      fs.mkdirSync(libsDir, { recursive: true })
      fs.copyFileSync(aarSrc, path.join(libsDir, AAR_FILENAME))

      fs.mkdirSync(ktDir, { recursive: true })
      for (const fileName of KT_SOURCES) {
        const src = path.join(SAMSUNG_SDK_DIR, fileName)
        if (!fs.existsSync(src)) {
          throw new Error(
            `[withSamsungHealth] Kotlin source missing at ${src}. ` +
            `Restore it from the most recent working build or git history.`,
          )
        }
        fs.copyFileSync(src, path.join(ktDir, fileName))
      }

      return cfg
    },
  ])
}

module.exports = function withSamsungHealth(config) {
  config = withSamsungHealthManifest(config)
  config = withSamsungHealthGradle(config)
  config = withSamsungHealthMainApplication(config)
  config = withSamsungHealthMinSdk(config)
  config = withSamsungHealthAssets(config)
  return config
}
