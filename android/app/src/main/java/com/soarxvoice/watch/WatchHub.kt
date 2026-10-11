package com.soarxvoice.watch

import android.content.Context
import android.util.Log
import java.io.File

/** One watch as reported by `getStatus()` / the `WatchStatus` event. */
data class WatchInfo(
    val platform: String,
    val name: String,
    val paired: Boolean,
    val installed: Boolean,
    val reachable: Boolean,
)

/**
 * Process-wide hand-off between the transports and the React Native module.
 *
 * The Wear OS listener service can run before React Native is up (Google Play
 * services starts the process to deliver a message). Anything that arrives
 * while no module is attached is buffered (bounded) and delivered on attach.
 */
object WatchHub {
    private const val TAG = "WatchHub"
    private const val MAX_PENDING = 32

    interface Sink {
        fun onWatchMessage(platform: String, json: String)
        fun onWatchClip(platform: String, path: String, durationMs: Long)
        fun onWatchStatusChanged()
    }

    private var sink: Sink? = null
    private val pending = ArrayDeque<(Sink) -> Unit>()

    @Synchronized
    fun attach(s: Sink) {
        sink = s
        while (pending.isNotEmpty()) pending.removeFirst().invoke(s)
    }

    @Synchronized
    fun detach(s: Sink) {
        if (sink === s) sink = null
    }

    @Synchronized
    private fun deliver(action: (Sink) -> Unit) {
        val s = sink
        if (s != null) {
            action(s)
        } else {
            if (pending.size >= MAX_PENDING) pending.removeFirst()
            pending.addLast(action)
        }
    }

    fun message(platform: String, json: String) {
        Log.d(TAG, "message from $platform: $json")
        deliver { it.onWatchMessage(platform, json) }
    }

    fun clip(platform: String, path: String, durationMs: Long) {
        Log.d(TAG, "clip from $platform: $path ($durationMs ms)")
        deliver { it.onWatchClip(platform, path, durationMs) }
    }

    /** Status changes are not buffered: getStatus() reads the live value. */
    @Synchronized
    fun statusChanged() {
        sink?.onWatchStatusChanged()
    }

    /** Directory for clips in both directions. Created on demand. */
    fun clipDir(context: Context): File =
        File(context.cacheDir, "watch-clips").apply { mkdirs() }

    /** Removes clips older than [maxAgeMs] (left over from a crash or a dropped transfer). */
    fun pruneClips(context: Context, maxAgeMs: Long = 60 * 60 * 1000L) {
        val cutoff = System.currentTimeMillis() - maxAgeMs
        clipDir(context).listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
    }
}
