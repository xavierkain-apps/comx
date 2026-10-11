package com.soarxvoice.watch

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.math.BigDecimal
import java.math.BigInteger

/**
 * JSON <-> Connect IQ native values.
 *
 * Monkey C has no JSON parser, so the Garmin link carries dictionaries and
 * arrays. The Connect IQ serializer accepts String, Boolean, Integer, Long,
 * Float, Double, List, Map and null; this converts a JSON document to exactly
 * those types, and converts what a watch sends back to a JSON string.
 *
 * Numbers keep the shape JSON gave them: `270` arrives on the watch as a
 * Number (Integer), `270.5` as a Float/Double (the SDK narrows doubles that
 * fit a float). Epoch milliseconds do not fit 32 bits and become Long.
 * Watch code must therefore treat every numeric field as a generic Number.
 */
object GarminJson {

    /** Parses a JSON document into Map/List/primitives. Throws on bad JSON. */
    fun toGarmin(json: String): Any? = fromJsonValue(JSONTokener(json).nextValue())

    fun fromJsonValue(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> {
            val map = LinkedHashMap<String, Any?>()
            val keys = value.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                map[k] = fromJsonValue(value.opt(k))
            }
            map
        }
        is JSONArray -> {
            val list = ArrayList<Any?>(value.length())
            for (i in 0 until value.length()) list.add(fromJsonValue(value.opt(i)))
            list
        }
        is Int, is Long, is Double, is Boolean, is String -> value
        is Float -> value.toDouble()
        is Short -> value.toInt()
        is Byte -> value.toInt()
        is BigInteger -> if (value.bitLength() < 64) value.toLong() else value.toDouble()
        is BigDecimal -> narrow(value)
        is Number -> value.toDouble()
        else -> value.toString()
    }

    private fun narrow(d: BigDecimal): Any = try {
        val asLong = d.longValueExact()
        if (asLong in Int.MIN_VALUE..Int.MAX_VALUE) asLong.toInt() else asLong
    } catch (e: ArithmeticException) {
        d.toDouble()
    }

    /**
     * Converts a value received from a Garmin watch to a JSON string.
     * A String that already holds a JSON object is passed through unchanged.
     */
    fun fromGarmin(value: Any?): String {
        if (value is String) {
            val trimmed = value.trim()
            if (trimmed.startsWith("{")) {
                try {
                    return JSONObject(trimmed).toString()
                } catch (_: Exception) {
                    // Not JSON after all: encode as a plain string below.
                }
            }
        }
        return when (val j = toJsonValue(value)) {
            is JSONObject, is JSONArray -> j.toString()
            JSONObject.NULL -> "null"
            is String -> JSONObject.quote(j)
            else -> j.toString()
        }
    }

    fun toJsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is Map<*, *> -> {
            val o = JSONObject()
            for ((k, v) in value) o.put(k.toString(), toJsonValue(v))
            o
        }
        is List<*> -> JSONArray().also { a -> value.forEach { a.put(toJsonValue(it)) } }
        is Array<*> -> JSONArray().also { a -> value.forEach { a.put(toJsonValue(it)) } }
        is ByteArray -> JSONArray().also { a -> value.forEach { a.put(it.toInt() and 0xff) } }
        is Float -> if (value.isNaN() || value.isInfinite()) JSONObject.NULL else value.toDouble()
        is Double -> if (value.isNaN() || value.isInfinite()) JSONObject.NULL else value
        is Int, is Long, is Boolean, is String -> value
        is Char -> value.toString()
        is Number -> value.toLong()
        else -> value.toString()
    }
}
