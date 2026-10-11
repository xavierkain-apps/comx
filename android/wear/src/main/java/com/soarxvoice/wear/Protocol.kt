package com.soarxvoice.wear

import org.json.JSONObject

/**
 * Phone <-> watch JSON payloads (docs/watch-companion.md, `v: 1`).
 * Parsing is lenient: a missing or mistyped field becomes null/false rather
 * than dropping the whole message, so a newer phone app still works.
 */
object Protocol {
    const val VERSION = 1

    data class Me(
        val name: String,
        val lat: Double?,
        val lon: Double?,
        val cog: Double?,
        val sog: Double?,
        val t: Long?,
    )

    data class Rider(
        val uid: Long,
        val name: String,
        val lat: Double?,
        val lon: Double?,
        val t: Long?,
        val dist: Double?,
        val brg: Double?,
        val speaking: Boolean,
        val sos: Boolean,
        val stale: Boolean,
    )

    data class State(
        val connected: Boolean,
        val channel: String,
        val watchMode: Boolean,
        val me: Me?,
        val riders: List<Rider>,
        val ts: Long,
    )

    sealed class Event {
        data class Speaking(val uid: Long, val from: String, val active: Boolean) : Event()
        data class Text(val uid: Long, val from: String, val id: String, val text: String) : Event()
        data class Sos(val uid: Long, val from: String, val active: Boolean, val dist: Double?, val brg: Double?) : Event()
    }

    data class ClipMeta(val uid: Long, val from: String, val durationMs: Long)

    /** Quick message ids are fixed by the contract; the label is local. */
    val QUICK_MESSAGES: List<Pair<String, String>> = listOf(
        "ok" to "All good",
        "back" to "Heading back",
        "wait" to "Wait for me",
        "where" to "Where are you?",
        "gear" to "Gear broken",
        "help" to "I need help",
    )

    fun quickText(id: String): String = QUICK_MESSAGES.firstOrNull { it.first == id }?.second ?: id

    fun parseState(json: String): State? {
        val o = obj(json) ?: return null
        if (o.optString("kind") != "state") return null
        val meObj = o.optJSONObject("me")
        val me = meObj?.let {
            Me(
                name = it.optString("name", ""),
                lat = it.num("lat"),
                lon = it.num("lon"),
                cog = it.num("cog"),
                sog = it.num("sog"),
                t = it.num("t")?.toLong(),
            )
        }
        val arr = o.optJSONArray("riders")
        val riders = ArrayList<Rider>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val r = arr.optJSONObject(i) ?: continue
                riders.add(
                    Rider(
                        uid = r.optLong("uid", 0L),
                        name = r.optString("name", "").ifEmpty { "Rider" },
                        lat = r.num("lat"),
                        lon = r.num("lon"),
                        t = r.num("t")?.toLong(),
                        dist = r.num("dist"),
                        brg = r.num("brg"),
                        speaking = r.optBoolean("speaking", false),
                        sos = r.optBoolean("sos", false),
                        stale = r.optBoolean("stale", false),
                    )
                )
            }
        }
        return State(
            connected = o.optBoolean("connected", false),
            channel = o.optString("channel", ""),
            watchMode = o.optBoolean("watchMode", false),
            me = me,
            riders = riders,
            ts = o.num("ts")?.toLong() ?: 0L,
        )
    }

    fun parseEvent(json: String): Event? {
        val o = obj(json) ?: return null
        if (o.optString("kind") != "event") return null
        val uid = o.optLong("uid", 0L)
        val from = o.optString("from", "").ifEmpty { "A rider" }
        return when (o.optString("type")) {
            "speaking" -> Event.Speaking(uid, from, o.optBoolean("active", false))
            "text" -> {
                val id = o.optString("id", "custom")
                val text = o.optString("text", "").ifEmpty { quickText(id) }
                Event.Text(uid, from, id, text)
            }
            "sos" -> Event.Sos(uid, from, o.optBoolean("active", false), o.num("dist"), o.num("brg"))
            else -> null
        }
    }

    fun parseClipMeta(json: String): ClipMeta {
        val o = obj(json) ?: JSONObject()
        return ClipMeta(
            uid = o.optLong("uid", 0L),
            from = o.optString("from", "").ifEmpty { "A rider" },
            durationMs = o.optLong("durationMs", 0L),
        )
    }

    // ---- Watch -> phone ----------------------------------------------------

    fun text(id: String): String =
        JSONObject().put("v", VERSION).put("kind", "text").put("id", id).put("text", quickText(id)).toString()

    fun sos(active: Boolean): String =
        JSONObject().put("v", VERSION).put("kind", "sos").put("active", active).toString()

    fun ptt(active: Boolean): String =
        JSONObject().put("v", VERSION).put("kind", "ptt").put("active", active).toString()

    fun hello(model: String, hasCompass: Boolean): String =
        JSONObject().put("v", VERSION).put("kind", "hello").put("platform", "wearos")
            .put("model", model).put("hasCompass", hasCompass).toString()

    fun clipMeta(durationMs: Long): String =
        JSONObject().put("v", VERSION).put("kind", "clip").put("durationMs", durationMs).toString()

    // ---- helpers -----------------------------------------------------------

    private fun obj(json: String): JSONObject? = try {
        JSONObject(json)
    } catch (e: Exception) {
        null
    }

    /** A finite number, or null for absent / JSON null / non-numeric. */
    private fun JSONObject.num(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        val v = opt(key)
        val d = when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull()
            else -> null
        } ?: return null
        return if (d.isNaN() || d.isInfinite()) null else d
    }
}
