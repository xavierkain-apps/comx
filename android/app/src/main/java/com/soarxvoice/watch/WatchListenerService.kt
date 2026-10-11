package com.soarxvoice.watch

import android.net.Uri
import android.util.Log
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.soarxvoice.watchshared.WatchLink
import org.json.JSONObject
import java.io.File

/**
 * Receives watch -> phone traffic from Wear OS. Google Play services binds
 * this service on demand, so it works while the app is in the background
 * (during a session the AudioForegroundService keeps the process alive) and
 * even starts the process if needed; messages are then buffered by WatchHub
 * until the React Native module attaches.
 */
class WatchListenerService : WearableListenerService() {

    companion object {
        private const val TAG = "WatchListener"

        private class Incoming(val file: File, val durationMs: Long)

        /** In-flight incoming clips, keyed by channel path (the service instance may change). */
        private val incoming = HashMap<String, Incoming>()
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == WatchLink.PATH_MSG) {
            WatchHub.message(WearLink.PLATFORM, String(event.data, Charsets.UTF_8))
        }
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        WatchHub.statusChanged()
    }

    override fun onChannelOpened(channel: ChannelClient.Channel) {
        val clip = WatchLink.parseClipPath(channel.path)
        if (clip == null || clip.prefix != WatchLink.CLIP_UP) return
        val durationMs = try {
            JSONObject(clip.metaJson).optLong("durationMs", 0L)
        } catch (e: Exception) {
            0L
        }
        val file = File(WatchHub.clipDir(this), "up-${System.currentTimeMillis()}-${clip.transferId}.m4a")
        synchronized(incoming) { incoming[channel.path] = Incoming(file, durationMs) }
        Wearable.getChannelClient(this).receiveFile(channel, Uri.fromFile(file), false)
            .addOnFailureListener {
                Log.w(TAG, "receiveFile failed: ${it.message}")
                synchronized(incoming) { incoming.remove(channel.path) }
                file.delete()
            }
    }

    override fun onInputClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
        val pending = synchronized(incoming) { incoming.remove(channel.path) } ?: return
        Wearable.getChannelClient(this).close(channel)
        if (closeReason == ChannelClient.ChannelCallback.CLOSE_REASON_NORMAL && pending.file.length() > 0) {
            // JS never deletes watch clips after injecting them: keep the cache small.
            WatchHub.pruneClips(this, maxAgeMs = 15 * 60 * 1000L)
            WatchHub.clip(WearLink.PLATFORM, pending.file.absolutePath, pending.durationMs)
        } else {
            Log.w(TAG, "clip dropped: reason=$closeReason size=${pending.file.length()}")
            pending.file.delete()
        }
    }
}
