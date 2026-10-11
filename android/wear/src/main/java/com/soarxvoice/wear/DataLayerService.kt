package com.soarxvoice.wear

import android.net.Uri
import android.util.Log
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.soarxvoice.watchshared.WatchLink
import java.io.File

/**
 * Phone -> watch traffic. Google Play services binds this service on demand,
 * so state, events and clips arrive with the app in the background; the
 * [RideService] foreground service keeps the process (and the clip player)
 * alive during a session.
 */
class DataLayerService : WearableListenerService() {

    companion object {
        private const val TAG = "DataLayerService"

        private class Incoming(val file: File, val meta: Protocol.ClipMeta)
        private val incoming = HashMap<String, Incoming>()

        fun clipDir(context: android.content.Context): File =
            File(context.cacheDir, "clips").apply { mkdirs() }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { e ->
            if (e.type == DataEvent.TYPE_CHANGED && e.dataItem.uri.path == WatchLink.PATH_STATE) {
                val json = DataMapItem.fromDataItem(e.dataItem).dataMap.getString(WatchLink.KEY_JSON)
                json?.let { Protocol.parseState(it) }?.let { RideStore.onState(it) }
            }
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WatchLink.PATH_EVENT) return
        Protocol.parseEvent(String(event.data, Charsets.UTF_8))?.let { RideStore.onEvent(this, it) }
    }

    override fun onChannelOpened(channel: ChannelClient.Channel) {
        val clip = WatchLink.parseClipPath(channel.path)
        if (clip == null || clip.prefix != WatchLink.CLIP_DOWN) return
        val meta = Protocol.parseClipMeta(clip.metaJson)
        // Extension is only a hint: the player accepts ADTS .aac and .m4a alike.
        val file = File(clipDir(this), "rx-${System.currentTimeMillis()}-${clip.transferId}.aac")
        synchronized(incoming) { incoming[channel.path] = Incoming(file, meta) }
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
            ClipPlayer.enqueue(this, pending.file, pending.meta)
        } else {
            Log.w(TAG, "clip dropped: reason=$closeReason size=${pending.file.length()}")
            pending.file.delete()
        }
    }
}
