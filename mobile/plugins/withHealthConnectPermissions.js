/**
 * withHealthConnectPermissions — adds Health Connect data-type
 * permissions to AndroidManifest.xml during prebuild.
 *
 * The official react-native-health-connect config plugin only adds
 * the `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent
 * filter (so Health Connect knows where to send the user when they
 * tap "Why does this app need these permissions?"). It does NOT add
 * the actual data-type `<uses-permission>` tags — those are app-
 * specific and have to be declared explicitly.
 *
 * This plugin closes that gap. Lists the four data types MyRX reads
 * (workouts, heart rate, distance, weight) plus the steps + total-
 * calories-burned permissions we'll need shortly for the activity-
 * log surface. Per-data-type granting happens at runtime via Health
 * Connect's system UI — the user can grant a subset; we just have
 * to declare them all in the manifest so they're requestable.
 *
 * See https://developer.android.com/health-connect/develop/about-android-permissions
 * for the full Health Connect permissions reference.
 */

const { withAndroidManifest } = require('@expo/config-plugins')

const HEALTH_CONNECT_READ_PERMISSIONS = [
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_WEIGHT',
]

module.exports = function withHealthConnectPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

    // Ensure `<uses-permission>` array exists.
    if (!Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = []
    }

    // De-dupe — if any of these already exist (from a prior prebuild
    // or a manual edit), skip rather than adding duplicates.
    const existing = new Set(
      manifest['uses-permission']
        .map((p) => p?.$?.['android:name'])
        .filter(Boolean),
    )

    for (const perm of HEALTH_CONNECT_READ_PERMISSIONS) {
      if (existing.has(perm)) continue
      manifest['uses-permission'].push({
        $: { 'android:name': perm },
      })
    }

    return cfg
  })
}
