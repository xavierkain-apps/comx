package com.soarxvoice.watchshared

import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Wear OS Data Layer protocol shared verbatim by the phone module (:app) and
 * the watch module (:wear). Both modules compile this directory as a source
 * set, so the two ends cannot drift apart.
 *
 * Payloads are the JSON documents defined in docs/watch-companion.md; this
 * file only defines how they travel over the Data Layer.
 *
 * | What                       | Direction     | Transport                                  |
 * |----------------------------|---------------|--------------------------------------------|
 * | state (latest wins)        | phone → watch | DataItem [PATH_STATE], key [KEY_JSON], urgent |
 * | event                      | phone → watch | MessageClient [PATH_EVENT], UTF-8 JSON     |
 * | voice clip                 | phone → watch | ChannelClient, path [clipPath] with [CLIP_DOWN] |
 * | message (text/sos/ptt/hello)| watch → phone | MessageClient [PATH_MSG], UTF-8 JSON      |
 * | voice clip                 | watch → phone | ChannelClient, path [clipPath] with [CLIP_UP] |
 *
 * Clip metadata travels **inside the channel path**:
 * `<prefix>/<transferId>/<URL-encoded metadata JSON>`. The receiver gets it in
 * `onChannelOpened` before the first byte of audio, with no ordering problem
 * between a message and a channel. `transferId` keeps two clips with identical
 * metadata apart.
 */
object WatchLink {
    const val PATH_STATE = "/soarx/state"
    const val PATH_EVENT = "/soarx/event"
    const val PATH_MSG = "/soarx/msg"

    /** Channel path prefixes. The trailing slash keeps them prefix-disjoint. */
    const val CLIP_DOWN = "/soarx/clip/"
    const val CLIP_UP = "/soarx/clip-up/"

    /** DataMap key holding the state JSON string. */
    const val KEY_JSON = "json"

    /** Capabilities declared in res/values/wear.xml of each side. */
    const val CAPABILITY_WATCH = "soarx_watch"
    const val CAPABILITY_PHONE = "soarx_phone"

    /** Builds a clip channel path carrying [metaJson]. */
    fun clipPath(prefix: String, transferId: String, metaJson: String): String {
        require(prefix == CLIP_DOWN || prefix == CLIP_UP) { "unknown clip prefix $prefix" }
        require(transferId.isNotEmpty() && !transferId.contains('/')) { "bad transfer id" }
        return prefix + transferId + "/" + URLEncoder.encode(metaJson, "UTF-8")
    }

    /** Parsed clip channel path. */
    data class ClipPath(val prefix: String, val transferId: String, val metaJson: String)

    /** Parses a clip channel path, or returns null when it is not one. */
    fun parseClipPath(path: String): ClipPath? {
        val prefix = when {
            path.startsWith(CLIP_UP) -> CLIP_UP
            path.startsWith(CLIP_DOWN) -> CLIP_DOWN
            else -> return null
        }
        val rest = path.substring(prefix.length)
        val slash = rest.indexOf('/')
        if (slash <= 0) return null
        val id = rest.substring(0, slash)
        val meta = try {
            URLDecoder.decode(rest.substring(slash + 1), "UTF-8")
        } catch (e: IllegalArgumentException) {
            return null
        }
        return ClipPath(prefix, id, meta.ifEmpty { "{}" })
    }
}
