package com.soarxvoice.wear

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import com.soarxvoice.watchshared.WatchLink
import java.io.File
import java.util.UUID

/**
 * Watch side of the Data Layer: watch -> phone messages and clips, plus a
 * one-shot read of the last state DataItem at start-up.
 */
object PhoneLink {
    private const val TAG = "PhoneLink"
    private const val CLIP_TIMEOUT_MS = 90_000L

    private val main = Handler(Looper.getMainLooper())
    private var callbackRegistered = false

    private class Upload(val file: File, val pending: MutableSet<String>)
    private val uploads = HashMap<String, Upload>()

    private fun callback(context: Context) = object : ChannelClient.ChannelCallback() {
        override fun onOutputClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
            if (closeReason != CLOSE_REASON_NORMAL) Log.w(TAG, "clip upload closed: $closeReason")
            Wearable.getChannelClient(context).close(channel)
            finishOne(channel.path, channel.nodeId)
        }

        override fun onChannelClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
            finishOne(channel.path, channel.nodeId)
        }
    }

    fun init(context: Context) {
        val app = context.applicationContext
        if (!callbackRegistered) {
            callbackRegistered = true
            Wearable.getChannelClient(app).registerChannelCallback(callback(app))
        }
        // The state DataItem persists: show the last known state immediately.
        Wearable.getDataClient(app).getDataItems(Uri.parse("wear://*" + WatchLink.PATH_STATE))
            .addOnSuccessListener { buf ->
                try {
                    buf.forEach { item ->
                        val json = DataMapItem.fromDataItem(item).dataMap.getString(WatchLink.KEY_JSON)
                        json?.let { Protocol.parseState(it) }?.let { s ->
                            if (RideStore.state.value == null) RideStore.onState(s)
                        }
                    }
                } finally {
                    buf.release()
                }
            }
    }

    fun sendJson(context: Context, json: String, onResult: ((Boolean) -> Unit)? = null) {
        val app = context.applicationContext
        val bytes = json.toByteArray(Charsets.UTF_8)
        withPhones(app) { nodes ->
            if (nodes.isEmpty()) {
                onResult?.invoke(false)
                return@withPhones
            }
            val sends = nodes.map { Wearable.getMessageClient(app).sendMessage(it.id, WatchLink.PATH_MSG, bytes) }
            Tasks.whenAllComplete(sends).addOnCompleteListener {
                onResult?.invoke(sends.any { it.isSuccessful })
            }
        }
    }

    fun hello(context: Context) {
        sendJson(context, Protocol.hello("${Build.MANUFACTURER} ${Build.MODEL}", Heading.hasCompass(context)))
    }

    /** Uploads a recorded clip; the file is deleted once sent (or failed). */
    fun sendClip(context: Context, file: File, durationMs: Long, onResult: (Boolean) -> Unit) {
        val app = context.applicationContext
        val path = WatchLink.clipPath(WatchLink.CLIP_UP, UUID.randomUUID().toString().take(8), Protocol.clipMeta(durationMs))
        val channels = Wearable.getChannelClient(app)
        withPhones(app) { nodes ->
            if (nodes.isEmpty()) {
                file.delete()
                onResult(false)
                return@withPhones
            }
            synchronized(uploads) { uploads[path] = Upload(file, nodes.map { it.id }.toMutableSet()) }
            main.postDelayed({ forceFinish(path) }, CLIP_TIMEOUT_MS)
            var reported = false
            nodes.forEach { node ->
                channels.openChannel(node.id, path)
                    .onSuccessTask { ch -> channels.sendFile(ch!!, Uri.fromFile(file)) }
                    .addOnSuccessListener { if (!reported) { reported = true; onResult(true) } }
                    .addOnFailureListener {
                        Log.w(TAG, "clip upload to ${node.displayName} failed: ${it.message}")
                        finishOne(path, node.id)
                        if (!reported && synchronized(uploads) { uploads[path] == null }) {
                            reported = true
                            onResult(false)
                        }
                    }
            }
        }
    }

    private fun finishOne(path: String, nodeId: String) {
        val done = synchronized(uploads) {
            val u = uploads[path] ?: return
            u.pending.remove(nodeId)
            if (u.pending.isEmpty()) uploads.remove(path) else null
        } ?: return
        done.file.delete()
    }

    private fun forceFinish(path: String) {
        synchronized(uploads) { uploads.remove(path) }?.file?.delete()
    }

    /** Phones running ComX; every connected node if the capability is unknown. */
    private fun withPhones(context: Context, block: (List<Node>) -> Unit) {
        val connected = Wearable.getNodeClient(context).connectedNodes
        val capable = Wearable.getCapabilityClient(context)
            .getCapability(WatchLink.CAPABILITY_PHONE, CapabilityClient.FILTER_REACHABLE)
        Tasks.whenAllComplete(connected, capable).addOnCompleteListener {
            val nodes = if (connected.isSuccessful) connected.result.orEmpty() else emptyList()
            val capIds = if (capable.isSuccessful) capable.result?.nodes?.map { it.id }?.toSet() else null
            block(if (capIds.isNullOrEmpty()) nodes else nodes.filter { it.id in capIds })
        }
    }
}
