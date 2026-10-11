package com.soarxvoice.watch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.garmin.android.connectiq.ConnectIQ
import com.garmin.android.connectiq.IQApp
import com.garmin.android.connectiq.IQDevice

/**
 * Phone side of the Garmin Connect IQ link (Connect IQ Android companion SDK).
 *
 * - Requires Garmin Connect Mobile on the phone. Without it the SDK reports
 *   GCM_NOT_INSTALLED, this link stays dormant and getStatus() lists no Garmin
 *   watch. No dialog is shown (autoUI = false).
 * - JSON payloads are converted to Map/List (Monkey C has no JSON parser) and
 *   messages from the watch are converted back to JSON strings.
 * - State is throttled to one message every [STATE_INTERVAL_MS] (latest
 *   wins); events go out immediately; clips are never sent.
 *
 * Every SDK call happens on the main thread.
 */
class GarminLink(context: Context) {

    companion object {
        private const val TAG = "GarminLink"
        const val PLATFORM = "garmin"
        const val APP_ID = "8ac2d628-66c4-40a4-96b0-10061a6d6519"
        const val STATE_INTERVAL_MS = 5_000L
    }

    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val app = IQApp(APP_ID)

    private var ciq: ConnectIQ? = null
    @Volatile private var ready = false

    private class Watch(val device: IQDevice) {
        @Volatile var status: IQDevice.IQDeviceStatus = device.status ?: IQDevice.IQDeviceStatus.UNKNOWN
        /** null until Connect IQ answered the app-info query. */
        @Volatile var installed: Boolean? = null
    }

    private val watches = java.util.concurrent.ConcurrentHashMap<Long, Watch>()

    private val throttle = Throttle(STATE_INTERVAL_MS) { SystemClock.elapsedRealtime() }
    private var pendingState: String? = null
    private val flushState = Runnable { pendingState?.let { pendingState = null; sendStateNow(it) } }

    private val sdkListener = object : ConnectIQ.ConnectIQListener {
        override fun onSdkReady() {
            Log.i(TAG, "Connect IQ ready")
            ready = true
            refreshDevices()
        }

        override fun onInitializeError(status: ConnectIQ.IQSdkErrorStatus?) {
            // GCM_NOT_INSTALLED is the normal case for riders without a Garmin.
            Log.i(TAG, "Connect IQ unavailable: $status")
            ready = false
        }

        override fun onSdkShutDown() {
            ready = false
        }
    }

    private val deviceListener = ConnectIQ.IQDeviceEventListener { device, status ->
        main.post {
            val w = watches[device.deviceIdentifier] ?: return@post
            w.status = status ?: IQDevice.IQDeviceStatus.UNKNOWN
            if (w.status == IQDevice.IQDeviceStatus.CONNECTED) queryApp(w)
            WatchHub.statusChanged()
        }
    }

    private val appListener = ConnectIQ.IQApplicationEventListener { _, _, messages, status ->
        if (status != ConnectIQ.IQMessageStatus.SUCCESS) {
            Log.w(TAG, "message from watch failed: $status")
            return@IQApplicationEventListener
        }
        messages?.forEach { m ->
            try {
                WatchHub.message(PLATFORM, GarminJson.fromGarmin(m))
            } catch (e: Exception) {
                Log.w(TAG, "unreadable watch message: ${e.message}")
            }
        }
    }

    /** Idempotent: a second call re-scans known devices (a watch paired since). */
    fun start() = main.post {
        if (ciq != null) {
            if (ready) refreshDevices()
            return@post
        }
        try {
            val c = ConnectIQ.getInstance(appContext, ConnectIQ.IQConnectType.WIRELESS)
            ciq = c
            c.initialize(appContext, false, sdkListener)
        } catch (e: Throwable) {
            Log.i(TAG, "Connect IQ init failed: ${e.message}")
            ciq = null
        }
    }

    fun stop() = main.post {
        main.removeCallbacks(flushState)
        val c = ciq ?: return@post
        try {
            if (ready) c.unregisterAllForEvents()
            c.shutdown(appContext)
        } catch (e: Throwable) {
            Log.d(TAG, "shutdown: ${e.message}")
        }
        ciq = null
        ready = false
        watches.clear()
    }

    private fun refreshDevices() {
        val c = ciq ?: return
        val known = try {
            c.knownDevices.orEmpty()
        } catch (e: Throwable) {
            Log.w(TAG, "known devices: ${e.message}")
            return
        }
        for (d in known) {
            if (watches.containsKey(d.deviceIdentifier)) continue
            val w = Watch(d)
            watches[d.deviceIdentifier] = w
            try {
                w.status = c.getDeviceStatus(d) ?: IQDevice.IQDeviceStatus.UNKNOWN
                c.registerForDeviceEvents(d, deviceListener)
                c.registerForAppEvents(d, app, appListener)
            } catch (e: Throwable) {
                Log.w(TAG, "register ${d.friendlyName}: ${e.message}")
            }
            if (w.status == IQDevice.IQDeviceStatus.CONNECTED) queryApp(w)
        }
        WatchHub.statusChanged()
    }

    private fun queryApp(w: Watch) {
        val c = ciq ?: return
        try {
            c.getApplicationInfo(APP_ID, w.device, object : ConnectIQ.IQApplicationInfoListener {
                override fun onApplicationInfoReceived(info: IQApp?) {
                    main.post {
                        w.installed = info?.status != IQApp.IQAppStatus.NOT_INSTALLED
                        WatchHub.statusChanged()
                    }
                }

                override fun onApplicationNotInstalled(applicationId: String?) {
                    main.post {
                        w.installed = false
                        WatchHub.statusChanged()
                    }
                }
            })
        } catch (e: Throwable) {
            Log.w(TAG, "app info ${w.device.friendlyName}: ${e.message}")
        }
    }

    /** Latest wins, at most one message per [STATE_INTERVAL_MS]. */
    fun sendState(json: String) = main.post {
        if (!ready) return@post
        val wait = throttle.delayBeforeNext()
        if (wait == 0L) {
            pendingState = null
            main.removeCallbacks(flushState)
            sendStateNow(json)
        } else {
            val alreadyScheduled = pendingState != null
            pendingState = json
            if (!alreadyScheduled) main.postDelayed(flushState, wait)
        }
    }

    private fun sendStateNow(json: String) {
        throttle.mark()
        send(json)
    }

    fun sendEvent(json: String) = main.post { if (ready) send(json) }

    private fun send(json: String) {
        val c = ciq ?: return
        val payload = try {
            GarminJson.toGarmin(json)
        } catch (e: Exception) {
            Log.w(TAG, "bad JSON not sent: ${e.message}")
            return
        } ?: return
        for (w in watches.values) {
            // Unknown install state is tried anyway: the query may not have answered yet.
            if (w.status != IQDevice.IQDeviceStatus.CONNECTED || w.installed == false) continue
            try {
                c.sendMessage(w.device, app, payload) { _, _, status ->
                    if (status != ConnectIQ.IQMessageStatus.SUCCESS) {
                        Log.d(TAG, "send to ${w.device.friendlyName}: $status")
                    }
                }
            } catch (e: Throwable) {
                Log.w(TAG, "send to ${w.device.friendlyName} failed: ${e.message}")
            }
        }
    }

    /** Snapshot for getStatus(). Called on any thread. */
    fun status(): List<WatchInfo> {
        if (!ready) return emptyList()
        return watches.values.toList().map { w ->
            WatchInfo(
                platform = PLATFORM,
                name = w.device.friendlyName ?: "Garmin",
                paired = w.status != IQDevice.IQDeviceStatus.NOT_PAIRED,
                installed = w.installed == true,
                reachable = w.status == IQDevice.IQDeviceStatus.CONNECTED,
            )
        }
    }
}

/**
 * Minimum-interval gate: [delayBeforeNext] is 0 when a send may go out now,
 * otherwise the milliseconds to wait. Pure, so it is unit-tested.
 */
class Throttle(private val intervalMs: Long, private val clock: () -> Long) {
    private var last = Long.MIN_VALUE

    fun delayBeforeNext(): Long {
        if (last == Long.MIN_VALUE) return 0
        val elapsed = clock() - last
        return if (elapsed >= intervalMs) 0 else intervalMs - elapsed
    }

    fun mark() {
        last = clock()
    }
}
