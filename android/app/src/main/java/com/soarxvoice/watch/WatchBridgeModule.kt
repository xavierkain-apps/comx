package com.soarxvoice.watch

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * `WatchBridge` native module — Android side of docs/watch-companion.md.
 *
 * Hides the two watch platforms present on Android:
 *   - Wear OS (Galaxy Watch, Pixel Watch) through the Wearable Data Layer;
 *   - Garmin through the Connect IQ companion SDK (no voice clips).
 *
 * Events: `WatchMessage` {platform, json}, `WatchClip` {platform, path,
 * durationMs}, `WatchStatus` {watches: [...]}.
 */
class WatchBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), WatchHub.Sink {

    companion object {
        private const val TAG = "WatchBridge"
    }

    private val wear by lazy { WearLink(reactContext) }
    private val garmin by lazy { GarminLink(reactContext) }
    @Volatile private var started = false

    override fun getName(): String = "WatchBridge"

    @ReactMethod
    fun start() {
        if (started) {
            garmin.start() // re-scan for a Garmin paired since
            return
        }
        started = true
        WatchHub.pruneClips(reactContext)
        try {
            wear.start()
        } catch (e: Throwable) {
            Log.i(TAG, "Wear OS link not started: ${e.message}")
        }
        garmin.start()
        WatchHub.attach(this)
    }

    @ReactMethod
    fun sendState(json: String) {
        if (!started) return
        wear.sendState(json)
        garmin.sendState(json)
    }

    @ReactMethod
    fun sendEvent(json: String) {
        if (!started) return
        wear.sendEvent(json)
        garmin.sendEvent(json)
    }

    /**
     * Sends an audio file to every Wear OS watch (Garmin cannot play audio).
     * A file inside [getClipDir] is the phone's own recording and is deleted
     * once every transfer has finished; a file elsewhere is left alone.
     */
    @ReactMethod
    fun sendClip(path: String, metaJson: String) {
        if (!started) return
        val file = File(path.removePrefix("file://"))
        if (!file.isFile || file.length() == 0L) {
            Log.w(TAG, "clip not sent, missing or empty: $path")
            return
        }
        val owned = file.canonicalPath.startsWith(WatchHub.clipDir(reactContext).canonicalPath + File.separator)
        wear.sendClip(file, metaJson, deleteWhenDone = owned)
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        collectStatus { promise.resolve(it) }
    }

    /** Absolute, writable directory (no `file://`) where the phone records clips for the watch. */
    @ReactMethod
    fun getClipDir(promise: Promise) {
        try {
            promise.resolve(WatchHub.clipDir(reactContext).absolutePath)
        } catch (e: Exception) {
            promise.reject("E_CLIP_DIR", e)
        }
    }

    // Required by NativeEventEmitter on Android.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    // ---- WatchHub.Sink ----------------------------------------------------

    override fun onWatchMessage(platform: String, json: String) {
        emit("WatchMessage", Arguments.createMap().apply {
            putString("platform", platform)
            putString("json", json)
        })
    }

    override fun onWatchClip(platform: String, path: String, durationMs: Long) {
        emit("WatchClip", Arguments.createMap().apply {
            putString("platform", platform)
            putString("path", path)
            putDouble("durationMs", durationMs.toDouble())
        })
    }

    override fun onWatchStatusChanged() {
        collectStatus { watches ->
            emit("WatchStatus", Arguments.createMap().apply { putArray("watches", watches) })
        }
    }

    private fun collectStatus(done: (WritableArray) -> Unit) {
        val garminWatches = if (started) garmin.status() else emptyList()
        val finish = { wearWatches: List<WatchInfo> ->
            val arr = Arguments.createArray()
            (wearWatches + garminWatches).forEach { w ->
                arr.pushMap(Arguments.createMap().apply {
                    putString("platform", w.platform)
                    putString("name", w.name)
                    putBoolean("paired", w.paired)
                    putBoolean("installed", w.installed)
                    putBoolean("reachable", w.reachable)
                })
            }
            done(arr)
        }
        if (!started) {
            finish(emptyList())
            return
        }
        try {
            wear.status(finish)
        } catch (e: Throwable) {
            finish(emptyList())
        }
    }

    private fun emit(event: String, payload: Any) {
        if (!reactContext.hasActiveReactInstance()) return
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(event, payload)
        } catch (e: Exception) {
            Log.w(TAG, "emit $event failed: ${e.message}")
        }
    }

    override fun invalidate() {
        WatchHub.detach(this)
        if (started) {
            try {
                wear.stop()
            } catch (_: Throwable) {
            }
            garmin.stop()
        }
        started = false
        super.invalidate()
    }
}
