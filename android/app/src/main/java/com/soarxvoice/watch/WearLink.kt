package com.soarxvoice.watch

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.soarxvoice.watchshared.WatchLink
import java.io.File
import java.util.UUID

/**
 * Phone side of the Wear OS Data Layer link. Every call is fire-and-forget:
 * a phone without Google Play services or without a paired Wear OS watch just
 * logs a failed Task and carries on.
 */
class WearLink(context: Context) {

    companion object {
        private const val TAG = "WearLink"
        private const val CLIP_TIMEOUT_MS = 90_000L
        const val PLATFORM = "wearos"
    }

    private val appContext = context.applicationContext
    private val dataClient = Wearable.getDataClient(appContext)
    private val messageClient = Wearable.getMessageClient(appContext)
    private val channelClient = Wearable.getChannelClient(appContext)
    private val nodeClient = Wearable.getNodeClient(appContext)
    private val capabilityClient = Wearable.getCapabilityClient(appContext)
    private val main = Handler(Looper.getMainLooper())

    private val capabilityListener = CapabilityClient.OnCapabilityChangedListener {
        WatchHub.statusChanged()
    }

    /** Outgoing clip transfers, keyed by channel path, with the node ids still sending. */
    private class Transfer(val file: File, val deleteWhenDone: Boolean, val pending: MutableSet<String>)
    private val transfers = HashMap<String, Transfer>()

    private val channelCallback = object : ChannelClient.ChannelCallback() {
        override fun onOutputClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
            if (closeReason != CLOSE_REASON_NORMAL) {
                Log.w(TAG, "clip to ${channel.nodeId} closed abnormally: $closeReason/$appSpecificErrorCode")
            }
            channelClient.close(channel)
            finishOne(channel.path, channel.nodeId)
        }

        override fun onChannelClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
            // The watch may close the whole channel before our output side reports.
            finishOne(channel.path, channel.nodeId)
        }
    }

    fun start() {
        capabilityClient.addListener(capabilityListener, WatchLink.CAPABILITY_WATCH)
            .addOnFailureListener { Log.i(TAG, "Wear OS unavailable: ${it.message}") }
        channelClient.registerChannelCallback(channelCallback)
            .addOnFailureListener { Log.i(TAG, "channel callback not registered: ${it.message}") }
    }

    fun stop() {
        capabilityClient.removeListener(capabilityListener)
        channelClient.unregisterChannelCallback(channelCallback)
    }

    /** Latest-wins state as an urgent DataItem: a watch that reconnects gets it at once. */
    fun sendState(json: String) {
        val req = PutDataMapRequest.create(WatchLink.PATH_STATE).apply {
            dataMap.putString(WatchLink.KEY_JSON, json)
            // Forces a change even if the JSON is byte-identical.
            dataMap.putLong("sentAt", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        dataClient.putDataItem(req)
            .addOnFailureListener { Log.d(TAG, "state not stored: ${it.message}") }
    }

    fun sendEvent(json: String) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        withTargets { nodes ->
            nodes.forEach { node ->
                messageClient.sendMessage(node.id, WatchLink.PATH_EVENT, bytes)
                    .addOnFailureListener { Log.w(TAG, "event to ${node.displayName} failed: ${it.message}") }
            }
        }
    }

    /**
     * Streams [file] to every reachable watch running the app. Metadata rides
     * in the channel path (see WatchLink). When [deleteWhenDone] the file is
     * removed once every transfer has finished or failed (or after a timeout).
     */
    fun sendClip(file: File, metaJson: String, deleteWhenDone: Boolean) {
        val channelPath = WatchLink.clipPath(
            WatchLink.CLIP_DOWN, UUID.randomUUID().toString().take(8), metaJson
        )
        withTargets { nodes ->
            if (nodes.isEmpty()) {
                if (deleteWhenDone) file.delete()
                return@withTargets
            }
            val transfer = Transfer(file, deleteWhenDone, nodes.map { it.id }.toMutableSet())
            synchronized(transfers) { transfers[channelPath] = transfer }
            main.postDelayed({ forceFinish(channelPath) }, CLIP_TIMEOUT_MS)
            nodes.forEach { node ->
                channelClient.openChannel(node.id, channelPath)
                    .onSuccessTask { channel ->
                        channelClient.sendFile(channel!!, Uri.fromFile(file))
                    }
                    .addOnFailureListener {
                        Log.w(TAG, "clip to ${node.displayName} failed: ${it.message}")
                        finishOne(channelPath, node.id)
                    }
            }
        }
    }

    private fun finishOne(channelPath: String, nodeId: String) {
        val done = synchronized(transfers) {
            val t = transfers[channelPath] ?: return
            t.pending.remove(nodeId)
            if (t.pending.isEmpty()) transfers.remove(channelPath) else null
        } ?: return
        if (done.deleteWhenDone) done.file.delete()
    }

    private fun forceFinish(channelPath: String) {
        val t = synchronized(transfers) { transfers.remove(channelPath) } ?: return
        Log.w(TAG, "clip transfer timed out: $channelPath")
        if (t.deleteWhenDone) t.file.delete()
    }

    /**
     * Connected nodes that run the watch app. Before the capability lookup
     * has ever answered (or if it fails) every connected node is targeted: an
     * unknown path is simply ignored by a node without the app.
     */
    private fun withTargets(block: (List<Node>) -> Unit) {
        val connected = nodeClient.connectedNodes
        val capable = capabilityClient.getCapability(WatchLink.CAPABILITY_WATCH, CapabilityClient.FILTER_REACHABLE)
        Tasks.whenAllComplete(connected, capable).addOnCompleteListener {
            val nodes = if (connected.isSuccessful) connected.result.orEmpty() else emptyList()
            val capIds = if (capable.isSuccessful) capable.result?.nodes?.map { it.id }?.toSet() else null
            val targets = if (capIds.isNullOrEmpty()) nodes else nodes.filter { it.id in capIds }
            block(targets)
        }
    }

    /** Status of each Wear OS watch the phone knows about. */
    fun status(callback: (List<WatchInfo>) -> Unit) {
        val connected = nodeClient.connectedNodes
        val capable: Task<CapabilityInfo> =
            capabilityClient.getCapability(WatchLink.CAPABILITY_WATCH, CapabilityClient.FILTER_ALL)
        Tasks.whenAllComplete(connected, capable).addOnCompleteListener {
            val nodes = if (connected.isSuccessful) connected.result.orEmpty() else emptyList()
            val withApp = if (capable.isSuccessful) capable.result?.nodes.orEmpty() else emptySet()
            val appIds = withApp.map { it.id }.toSet()
            val byId = LinkedHashMap<String, WatchInfo>()
            nodes.forEach { n ->
                byId[n.id] = WatchInfo(PLATFORM, n.displayName, true, n.id in appIds, true)
            }
            withApp.forEach { n ->
                if (n.id !in byId) byId[n.id] = WatchInfo(PLATFORM, n.displayName, true, true, false)
            }
            callback(byId.values.toList())
        }
    }
}
