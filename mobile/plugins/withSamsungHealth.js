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
} = require('@expo/config-plugins')

const SHEALTH_PACKAGE = 'com.sec.android.app.shealth'
const SAMSUNG_MIN_SDK = 29

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

module.exports = function withSamsungHealth(config) {
  config = withSamsungHealthManifest(config)
  config = withSamsungHealthGradle(config)
  config = withSamsungHealthMainApplication(config)
  config = withSamsungHealthMinSdk(config)
  return config
}
