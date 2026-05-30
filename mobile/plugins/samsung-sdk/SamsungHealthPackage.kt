// PLUGIN-MANAGED SOURCE (mobile/plugins/samsung-sdk/SamsungHealthPackage.kt)
// Copied into android/app/src/main/java/com/myrx/app/samsung/ by withSamsungHealth.js
// on every `expo prebuild --clean`. Do NOT edit the generated copy in android/ —
// edits there get wiped on next prebuild. Edit THIS file, then re-run prebuild.

package com.myrx.app.samsung

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers SamsungHealthModule with the React Native bridge so JS can reach it
 * as `NativeModules.SamsungHealth`. Referenced by MainApplication.kt's
 * getPackages() — the withSamsungHealth.js plugin injects both the import and
 * the `add(SamsungHealthPackage())` call.
 */
class SamsungHealthPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(SamsungHealthModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
