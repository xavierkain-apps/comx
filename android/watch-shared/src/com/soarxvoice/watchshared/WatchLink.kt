package com.soarxvoice.watchshared

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
 * `<prefix>/<transferId>/<hex of the UTF-8 metadata JSON>`. The receiver gets
 * it in `onChannelOpened` before the first byte of audio, with no ordering
 * problem between a message and a channel. Hex (not URL encoding) keeps the
 * path to `[0-9a-z/-]`, so no layer can decode or reinterpret `%`, `+` or `/`
 * on the way (manifest path matching works on a decoded Uri). `transferId`
 * keeps two clips with identical metadata apart.
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
        return prefix + transferId + "/" + toHex(metaJson.toByteArray(Charsets.UTF_8))
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
        val bytes = fromHex(rest.substring(slash + 1)) ?: return null
        return ClipPath(prefix, id, String(bytes, Charsets.UTF_8).ifEmpty { "{}" })
    }

    private const val HEX = "0123456789abcdef"

    internal fun toHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            sb.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
        }
        return sb.toString()
    }

    /** Decodes lowercase or uppercase hex; null when malformed. */
    internal fun fromHex(s: String): ByteArray? {
        if (s.length % 2 != 0) return null
        val out = ByteArray(s.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(s[2 * i], 16)
            val lo = Character.digit(s[2 * i + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }
}
