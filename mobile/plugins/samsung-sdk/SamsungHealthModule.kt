// PLUGIN-MANAGED SOURCE (mobile/plugins/samsung-sdk/SamsungHealthModule.kt)
// Copied into android/app/src/main/java/com/myrx/app/samsung/ by withSamsungHealth.js
// on every `expo prebuild --clean`. Do NOT edit the generated copy in android/ —
// edits there get wiped on next prebuild. Edit THIS file, then re-run prebuild.
//
// ── Samsung Health Data SDK v1.1.0 native bridge ─────────────────────────────
//
// Surfaces the 6 methods the TS layer in mobile/src/lib/integrations/samsungHealth.ts
// calls:
//
//   isAvailable()          → SDK reachable on this device?
//   getPermissionStatus()  → which of the 4 data-type permissions are granted?
//   requestPermissions()   → launch Samsung Health's consent UI
//   readHeartRate(s, e)    → HR samples in the time window (includes SERIES_DATA
//                            so per-second readings from a Galaxy Watch are
//                            expanded individually for the Heart page)
//   readSteps(s, e)        → step counts bucketed hourly via aggregateData
//   readWorkouts(s, e)     → ExerciseSession rows + per-second hrLog from
//                            ExerciseSession.getLog()
//
// SDK class-name landmarks (reverse-engineered May 29 2026 via javap on the
// v1.1.0 AAR — Samsung's published docs don't fully cover these):
//
//   DataTypes.{HEART_RATE, STEPS, EXERCISE, BODY_COMPOSITION}     — the 4 we use
//   DataType.HeartRateType.{HEART_RATE, MIN/MAX_HEART_RATE, SERIES_DATA}
//     ─ Field<Float>, Field<Float>, Field<Float>, Field<List<HeartRate>>
//   DataType.StepsType.TOTAL                — aggregate op for STEPS (Long)
//   DataType.ExerciseType.{SESSIONS, EXERCISE_TYPE, CUSTOM_TITLE}
//     ─ Field<List<ExerciseSession>>, Field<PredefinedExerciseType>, Field<String>
//   HealthDataStore.readDataAsync()         → AsyncSingleFuture<DataResponse<T>>
//   HealthDataStore.aggregateDataAsync()    → AsyncSingleFuture<DataResponse<AggregatedData<T>>>
//   HealthDataPoint.getValue(Field<T>)      — pull a typed value from a point
//   AggregatedData<T>.getValue()            — pull the aggregated value (the sum/etc)
//   LocalTimeGroup.of(LocalTimeGroupUnit.HOURLY, 1)
//                                            — hourly bucketing for STEPS
//   ExerciseSession.getLog(): List<ExerciseLog>
//                                            — per-second telemetry; ExerciseLog
//                                              has .getHeartRate(): Float?, .getTimestamp()
//
// Field-naming quirks worth remembering (CLAUDE.md "Wearable data —
// debugging cheatsheet"):
//   - DataSource.getAppId()    (NOT packageName — docs are stale)
//   - DataSource.getDeviceId() (NOT deviceUid)

package com.myrx.app.samsung

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.data.entries.ExerciseLog
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.data.entries.HeartRate
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import com.samsung.android.sdk.health.data.request.LocalTimeGroup
import com.samsung.android.sdk.health.data.request.LocalTimeGroupUnit
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

class SamsungHealthModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SamsungHealth"

    // Single-thread executor for AsyncSingleFuture.get() blocking calls — keeps
    // the bridge thread free. All resolve()/reject() calls remain thread-safe.
    private val executor = Executors.newSingleThreadExecutor()

    // Lazily acquired; throws on devices without Samsung Health installed.
    // Catching any Throwable surfaces "not available" instead of crashing the bridge.
    private val store: HealthDataStore? by lazy {
        try {
            HealthDataService.getStore(reactApplicationContext)
        } catch (e: Throwable) {
            null
        }
    }

    // ── 1. isAvailable ────────────────────────────────────────────────────

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val s = store
        if (s == null) {
            promise.resolve(buildMap {
                putBoolean("available", false)
                putString("reason", "samsung_health_not_installed")
                putString("message", "Samsung Health app is not installed on this device.")
            })
            return
        }
        promise.resolve(buildMap { putBoolean("available", true) })
    }

    // ── 2. getPermissionStatus ────────────────────────────────────────────

    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        val s = store
        if (s == null) {
            promise.resolve(emptyPermissionStatus())
            return
        }
        executor.execute {
            try {
                val perms = requiredPermissions()
                val granted: Set<Permission> = s.getGrantedPermissionsAsync(perms).get()
                promise.resolve(buildPermissionStatusMap(granted))
            } catch (e: Throwable) {
                promise.resolve(emptyPermissionStatus())
            }
        }
    }

    // ── 3. requestPermissions ─────────────────────────────────────────────

    @ReactMethod
    fun requestPermissions(promise: Promise) {
        // NOTE: must call getCurrentActivity() as a method, not as a property.
        // RN 0.81's Kotlin synthesis explicitly skips this getter (CLAUDE.md
        // "Wearable data — debugging cheatsheet" #3).
        val activity: Activity = getCurrentActivity()
            ?: run {
                promise.reject("no_activity", "No foreground Activity to attach permission dialog to.")
                return
            }
        val s = store
        if (s == null) {
            promise.reject("not_available", "Samsung Health Data SDK is not available on this device.")
            return
        }
        executor.execute {
            try {
                val perms = requiredPermissions()
                val granted: Set<Permission> = s.requestPermissionsAsync(perms, activity).get()
                promise.resolve(buildPermissionStatusMap(granted))
            } catch (e: Throwable) {
                promise.reject("error", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    // ── 4. readHeartRate ──────────────────────────────────────────────────
    //
    // HEART_RATE points carry an aggregated value (HEART_RATE field) plus
    // optional per-second SERIES_DATA. We emit one sample per series entry if
    // present (so the Heart page's time-in-zone math gets the high-resolution
    // signal from Galaxy Watch), and fall back to a single sample carrying the
    // aggregated value when no series exists (older devices, manual entries).

    @ReactMethod
    fun readHeartRate(startMs: Double, endMs: Double, promise: Promise) {
        val s = store
        if (s == null) {
            promise.resolve(Arguments.createArray())
            return
        }
        executor.execute {
            try {
                val filter = timeFilterFrom(startMs.toLong(), endMs.toLong())
                val out = Arguments.createArray()
                var pageToken: String? = null
                // PAGINATION: Samsung's readDataAsync returns one page at a time.
                // If we ignore getPageToken(), we silently lose every row past
                // the first page (~100 rows default). Loop until pageToken is
                // null. Page size 1000 keeps us under any latency ceiling
                // while drastically reducing round-trips for dense data.
                // Hard safety cap of 50 pages prevents runaway loops.
                var pagesPulled = 0
                do {
                    val builder = DataTypes.HEART_RATE.readDataRequestBuilder
                    builder.setLocalTimeFilter(filter)
                    builder.setPageSize(1000)
                    if (pageToken != null) builder.setPageToken(pageToken)
                    val req = builder.build()
                    val response = s.readDataAsync(req).get()
                    for (point in response.dataList) {
                        emitHrPoint(point, out)
                    }
                    pageToken = response.pageToken
                    pagesPulled += 1
                } while (pageToken != null && pagesPulled < 50)
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("hr_read_error", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    private fun emitHrPoint(point: HealthDataPoint, out: WritableArray) {
        val series: List<HeartRate>? = try {
            point.getValue(DataType.HeartRateType.SERIES_DATA)
        } catch (_: Throwable) { null }

        if (series != null && series.isNotEmpty()) {
            // Per-second readings — emit one sample per series entry. The
            // sourceRecordId is suffixed with the timestamp to keep the
            // (user_id, source, source_record_id) uniqueness constraint
            // happy for the high-resolution rows.
            val parentUid = point.uid ?: ""
            val appId     = point.dataSource?.appId ?: ""
            val deviceId  = point.dataSource?.deviceId ?: ""
            for (entry in series) {
                val bpm = entry.heartRate
                if (bpm <= 20.0f || bpm >= 250.0f) continue
                val map = Arguments.createMap()
                map.putString("measuredAt", isoFromInstant(entry.startTime))
                map.putString("endAt",      isoFromInstant(entry.endTime))
                map.putDouble("bpm",        bpm.toDouble())
                map.putDouble("minBpm",     entry.min.toDouble())
                map.putDouble("maxBpm",     entry.max.toDouble())
                map.putString("sourceRecordId", "$parentUid:${entry.startTime.toEpochMilli()}")
                map.putString("deviceUuid",     deviceId)
                map.putString("packageName",    appId)
                out.pushMap(map)
            }
            return
        }

        // No series → single aggregated sample for this point.
        val avg: Float? = try { point.getValue(DataType.HeartRateType.HEART_RATE) } catch (_: Throwable) { null }
        if (avg == null || avg <= 20.0f || avg >= 250.0f) return
        val min: Float? = try { point.getValue(DataType.HeartRateType.MIN_HEART_RATE) } catch (_: Throwable) { null }
        val max: Float? = try { point.getValue(DataType.HeartRateType.MAX_HEART_RATE) } catch (_: Throwable) { null }

        val map = Arguments.createMap()
        map.putString("measuredAt", isoFromInstant(point.startTime))
        map.putString("endAt",      point.endTime?.let { isoFromInstant(it) })
        map.putDouble("bpm",        avg.toDouble())
        if (min != null) map.putDouble("minBpm", min.toDouble()) else map.putNull("minBpm")
        if (max != null) map.putDouble("maxBpm", max.toDouble()) else map.putNull("maxBpm")
        map.putString("sourceRecordId", point.uid ?: "")
        map.putString("deviceUuid",     point.dataSource?.deviceId ?: "")
        map.putString("packageName",    point.dataSource?.appId ?: "")
        out.pushMap(map)
    }

    // ── 5. readSteps ──────────────────────────────────────────────────────
    //
    // STEPS is aggregate-only on Samsung Health Data SDK — readDataAsync
    // returns nothing for STEPS, you must use aggregateDataAsync with a
    // bucketing window. Hourly is the canonical Galaxy Watch granularity.

    @ReactMethod
    fun readSteps(startMs: Double, endMs: Double, promise: Promise) {
        val s = store
        if (s == null) {
            promise.resolve(Arguments.createArray())
            return
        }
        executor.execute {
            try {
                val filter = timeFilterFrom(startMs.toLong(), endMs.toLong())
                val out = Arguments.createArray()
                var pageToken: String? = null
                var pagesPulled = 0
                // PAGINATION — see comment in readHeartRate. Aggregated step
                // buckets at hourly resolution × 7 days = 168 rows, well
                // under one page, but pagination is essentially free and
                // future-proofs us against wider windows.
                do {
                    val builder = DataType.StepsType.TOTAL.requestBuilder
                    builder.setLocalTimeFilterWithGroup(
                        filter,
                        LocalTimeGroup.of(LocalTimeGroupUnit.HOURLY, 1),
                    )
                    builder.setPageSize(1000)
                    if (pageToken != null) builder.setPageToken(pageToken)
                    val req = builder.build()
                    val response = s.aggregateDataAsync(req).get()
                    for (agg in response.dataList) {
                        // AggregatedData<Long>.getValue() — zero-arg Java getter, so
                        // Kotlin sees it as a property `value`. Same for startTime/
                        // endTime. (Calling `agg.getValue()` is a compile error
                        // because the property name has eaten the method form.)
                        val count: Long = agg.value ?: continue
                        if (count <= 0) continue
                        val map = Arguments.createMap()
                        map.putString("startAt", isoFromInstant(agg.startTime))
                        map.putString("endAt",   isoFromInstant(agg.endTime))
                        map.putDouble("steps",   count.toDouble())
                        map.putString("sourceRecordId", "${agg.startTime.toEpochMilli()}_$count")
                        map.putString("packageName", "")  // aggregate rows don't carry a single source
                        out.pushMap(map)
                    }
                    pageToken = response.pageToken
                    pagesPulled += 1
                } while (pageToken != null && pagesPulled < 50)
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("steps_read_error", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    // ── 6. readWorkouts ───────────────────────────────────────────────────
    //
    // Each EXERCISE HealthDataPoint can contain multiple ExerciseSessions.
    // Each session carries metadata + per-second telemetry via getLog(),
    // which the Heart page consumes for time-in-zone calculation.

    @ReactMethod
    fun readWorkouts(startMs: Double, endMs: Double, promise: Promise) {
        val s = store
        if (s == null) {
            promise.resolve(Arguments.createArray())
            return
        }
        executor.execute {
            try {
                val filter = timeFilterFrom(startMs.toLong(), endMs.toLong())
                val out = Arguments.createArray()
                var pageToken: String? = null
                var pagesPulled = 0
                // PAGINATION — the original single-page read was the actual
                // root cause of the May 30 2026 "missing workouts" bug.
                // Samsung's EXERCISE store typically returns ~10 sessions per
                // page; without paginating, we lost every workout past the
                // most-recent page, including the user's auto-detected
                // 5/25 Running + Other workout sessions even though Samsung
                // had them in its proper Exercise history.
                do {
                    val builder = DataTypes.EXERCISE.readDataRequestBuilder
                    builder.setLocalTimeFilter(filter)
                    builder.setPageSize(1000)
                    if (pageToken != null) builder.setPageToken(pageToken)
                    val req = builder.build()
                    val response = s.readDataAsync(req).get()
                    for (point in response.dataList) {
                        val sessions: List<ExerciseSession>? = try {
                            point.getValue(DataType.ExerciseType.SESSIONS)
                        } catch (_: Throwable) { null }
                        val parentUid = point.uid ?: ""
                        val appId     = point.dataSource?.appId ?: ""
                        for ((idx, sess) in (sessions ?: emptyList()).withIndex()) {
                            val map = Arguments.createMap()
                            map.putString("sourceRecordId", if (sessions != null && sessions.size > 1) "$parentUid:$idx" else parentUid)
                            map.putString("packageName",    appId)
                            map.putString("exerciseType",   sess.exerciseType?.name ?: "")
                            if (sess.customTitle != null) map.putString("customTitle", sess.customTitle)
                            else                          map.putNull("customTitle")
                            map.putString("startAt",        isoFromInstant(sess.startTime))
                            map.putString("endAt",          sess.endTime?.let { isoFromInstant(it) })
                            map.putDouble("durationS",      sess.duration?.seconds?.toDouble() ?: 0.0)
                            putNullableFloat(map, "distanceM",   sess.distance)
                            map.putDouble("caloriesKcal",   sess.calories.toDouble())
                            putNullableFloat(map, "avgBpm",      sess.meanHeartRate)
                            putNullableFloat(map, "maxBpm",      sess.maxHeartRate)
                            putNullableFloat(map, "minBpm",      sess.minHeartRate)
                            putNullableInt  (map, "steps",       sess.count)

                            // Per-second HR log — Heart page time-in-zone source.
                            val hrLog = Arguments.createArray()
                            val log: List<ExerciseLog>? = try { sess.log } catch (_: Throwable) { null }
                            for (entry in log ?: emptyList()) {
                                val bpm = entry.heartRate
                                if (bpm != null && bpm > 0f) hrLog.pushDouble(bpm.toDouble())
                            }
                            map.putArray("hrLog", hrLog)

                            out.pushMap(map)
                        }
                    }
                    pageToken = response.pageToken
                    pagesPulled += 1
                } while (pageToken != null && pagesPulled < 50)
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("workouts_read_error", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun requiredPermissions(): Set<Permission> = setOf(
        Permission.of(DataTypes.HEART_RATE,       AccessType.READ),
        Permission.of(DataTypes.STEPS,            AccessType.READ),
        Permission.of(DataTypes.EXERCISE,         AccessType.READ),
        Permission.of(DataTypes.BODY_COMPOSITION, AccessType.READ),
    )

    private fun buildPermissionStatusMap(granted: Set<Permission>): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("heartRate",       granted.any { it.dataType == DataTypes.HEART_RATE })
        map.putBoolean("steps",           granted.any { it.dataType == DataTypes.STEPS })
        map.putBoolean("exercise",        granted.any { it.dataType == DataTypes.EXERCISE })
        map.putBoolean("bodyComposition", granted.any { it.dataType == DataTypes.BODY_COMPOSITION })
        return map
    }

    private fun emptyPermissionStatus(): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("heartRate", false)
        map.putBoolean("steps", false)
        map.putBoolean("exercise", false)
        map.putBoolean("bodyComposition", false)
        return map
    }

    private fun timeFilterFrom(startMs: Long, endMs: Long): LocalTimeFilter {
        val z = ZoneId.systemDefault()
        val start = LocalDateTime.ofInstant(Instant.ofEpochMilli(startMs), z)
        val end   = LocalDateTime.ofInstant(Instant.ofEpochMilli(endMs),   z)
        return LocalTimeFilter.of(start, end)
    }

    private fun isoFromInstant(t: Instant): String =
        DateTimeFormatter.ISO_INSTANT.format(t)

    private fun putNullableFloat(map: WritableMap, key: String, value: Float?) {
        if (value == null) map.putNull(key) else map.putDouble(key, value.toDouble())
    }

    private fun putNullableInt(map: WritableMap, key: String, value: Int?) {
        if (value == null) map.putNull(key) else map.putDouble(key, value.toDouble())
    }

    private inline fun buildMap(block: WritableMap.() -> Unit): WritableMap {
        val m = Arguments.createMap()
        m.block()
        return m
    }
}
