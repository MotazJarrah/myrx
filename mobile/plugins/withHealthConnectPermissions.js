/**
 * withHealthConnectPermissions — adds Health Connect data-type
 * permissions AND the package-query for the system HC provider to
 * AndroidManifest.xml during prebuild.
 *
 * The official react-native-health-connect config plugin only adds
 * the `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent
 * filter (so Health Connect knows where to send the user when they
 * tap "Why does this app need these permissions?"). It does NOT add
 * the actual data-type `<uses-permission>` tags — those are app-
 * specific and have to be declared explicitly. It also only declares
 * a `<queries><package>` for the LEGACY HC provider package
 * `com.google.android.apps.healthdata`, which on Android 14+ is no
 * longer the active provider — Android ships HC as a system module
 * named `com.google.android.healthconnect.controller`. Without the
 * controller package in `<queries>`, our app can't resolve the HC
 * provider's permission Activity, so the SDK silently auto-dismisses
 * the permission flow ("no data types granted" with no UI shown).
 *
 * This plugin closes both gaps:
 *
 *   1. Adds the six READ_* `<uses-permission>` entries for the data
 *      types MyRX reads (exercise, heart rate, steps, distance,
 *      total-calories-burned, weight).
 *   2. Adds `<queries><package
 *      android:name="com.google.android.healthconnect.controller"/>
 *      </queries>` so the SDK can resolve the system HC provider on
 *      Android 14+ devices (Galaxy S25 / Pixel 8+ etc.).
 *
 * Per-data-type granting happens at runtime via Health Connect's
 * system UI — the user can grant a subset; we just have to declare
 * them all in the manifest so they're requestable.
 *
 * See https://developer.android.com/health-connect/develop/about-android-permissions
 * for the full Health Connect permissions reference.
 */

const { withAndroidManifest } = require('@expo/config-plugins')

const HEALTH_CONNECT_READ_PERMISSIONS = [
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_HEART_RATE',
  // Separate record type from HeartRate — daily resting HR readings
  // (one per day) used for recovery scoring + as the floor of the
  // daily HR timeline chart.
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_WEIGHT',
]

// Android 14+ system HC module. The legacy `com.google.android.apps.healthdata`
// package is queried by the library's own manifest; we add the new one here.
const HEALTH_CONNECT_PROVIDER_PACKAGE = 'com.google.android.healthconnect.controller'

module.exports = function withHealthConnectPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

    // ── 1. `<uses-permission>` for each data type ─────────────────────
    if (!Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = []
    }
    const existingPerms = new Set(
      manifest['uses-permission']
        .map((p) => p?.$?.['android:name'])
        .filter(Boolean),
    )
    for (const perm of HEALTH_CONNECT_READ_PERMISSIONS) {
      if (existingPerms.has(perm)) continue
      manifest['uses-permission'].push({
        $: { 'android:name': perm },
      })
    }

    // ── 2. `<queries><package>` for the system HC provider ───────────
    // Android 11+ requires apps to declare packages they want to query
    // via `getPackageInfo` / Intent resolution. The HC SDK uses
    // PackageManager to locate the provider; without this entry the
    // provider is invisible to us on Android 14+ devices.
    if (!Array.isArray(manifest.queries)) {
      manifest.queries = []
    }
    // Find an existing <queries> element (manifest can have multiple);
    // pick the first one and append our <package>, or create a new
    // element if there are none.
    let queries = manifest.queries[0]
    if (!queries) {
      queries = {}
      manifest.queries.push(queries)
    }
    if (!Array.isArray(queries.package)) {
      queries.package = []
    }
    const existingQueriedPkgs = new Set(
      queries.package
        .map((p) => p?.$?.['android:name'])
        .filter(Boolean),
    )
    if (!existingQueriedPkgs.has(HEALTH_CONNECT_PROVIDER_PACKAGE)) {
      queries.package.push({
        $: { 'android:name': HEALTH_CONNECT_PROVIDER_PACKAGE },
      })
    }

    // ── 3. `<activity-alias>` for Android 14+ rationale rendezvous ───
    // Android 14+ Health Connect requires an activity-alias declaring
    // VIEW_PERMISSION_USAGE + HEALTH_PERMISSIONS so the OS can verify
    // the app supports privacy-policy rationale rendering. WITHOUT this
    // alias declared, the HC permission Activity launches and immediately
    // auto-dismisses on Android 14+ — symptom is "no UI shown, no data
    // types granted" on every Connect tap, with logcat showing
    // PermissionsActivity + GrantPermissionsActivity both being created
    // and destroyed in milliseconds without ever becoming visible.
    //
    // The alias targets MainActivity for v1; we don't yet have a dedicated
    // PermissionsRationaleActivity — if HC actually routes a user there
    // via the "why does this app need these permissions?" link, MainActivity
    // just renders normally. Once we ship a privacy-policy screen, retarget.
    const application = manifest.application?.[0]
    if (application) {
      if (!Array.isArray(application['activity-alias'])) {
        application['activity-alias'] = []
      }
      const existingAliases = new Set(
        application['activity-alias']
          .map((a) => a?.$?.['android:name'])
          .filter(Boolean),
      )
      if (!existingAliases.has('ViewPermissionUsageActivity')) {
        application['activity-alias'].push({
          $: {
            'android:name':           'ViewPermissionUsageActivity',
            'android:exported':       'true',
            'android:targetActivity': '.MainActivity',
            'android:permission':     'android.permission.START_VIEW_PERMISSION_USAGE',
          },
          'intent-filter': [
            {
              action:   [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
              category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
            },
          ],
        })
      }
    }

    return cfg
  })
}
