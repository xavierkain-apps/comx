package com.soarxvoice.watch

import com.garmin.monkeybrains.serialization.MonkeyHash
import com.garmin.monkeybrains.serialization.Serializer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GarminJsonTest {

    private val state = """{"v":1,"kind":"state","connected":true,"channel":"TARIFA-01","watchMode":true,
        "me":{"name":"Xav","lat":36.01,"lon":-5.6,"cog":270.0,"sog":8.2,"t":1760000000000},
        "riders":[{"uid":12345,"name":"Carlos","lat":36.02,"lon":-5.61,"t":1760000000000,
        "dist":340,"brg":45.5,"speaking":false,"sos":false,"stale":false}],"ts":1760000000000}"""

    @Test fun jsonBecomesMapsListsAndPrimitives() {
        @Suppress("UNCHECKED_CAST")
        val m = GarminJson.toGarmin(state) as Map<String, Any?>
        assertEquals(1, m["v"])
        assertEquals(true, m["connected"])
        assertEquals(1760000000000L, m["ts"]) // does not fit 32 bits
        val rider = (m["riders"] as List<*>)[0] as Map<*, *>
        assertEquals(12345, rider["uid"])
        assertEquals(340, rider["dist"])
        assertEquals(45.5, rider["brg"])
    }

    @Test fun jsonNullBecomesNull() {
        @Suppress("UNCHECKED_CAST")
        val m = GarminJson.toGarmin("""{"dist":null,"brg":null}""") as Map<String, Any?>
        assertTrue(m.containsKey("dist"))
        assertNull(m["dist"])
    }

    /** What we hand to Connect IQ must survive its own serializer (the one sendMessage uses). */
    @Test fun survivesTheConnectIqSerializer() {
        val bytes = Serializer.serialize(GarminJson.toGarmin(state))
        val back = Serializer.deserialize(bytes)
        assertEquals(1, back.size)
        assertTrue(back[0] is MonkeyHash)
    }

    @Test fun watchDictionaryBecomesJson() {
        val fromWatch = linkedMapOf<Any, Any?>("v" to 1, "kind" to "text", "id" to "help", "text" to "I need help")
        val o = JSONObject(GarminJson.fromGarmin(fromWatch))
        assertEquals("text", o.getString("kind"))
        assertEquals("help", o.getString("id"))
        assertEquals(1, o.getInt("v"))
    }

    @Test fun watchValuesConvert() {
        val o = JSONObject(GarminJson.fromGarmin(mapOf("kind" to "sos", "active" to true, "x" to 1.5f, "n" to null)))
        assertEquals(true, o.getBoolean("active"))
        assertEquals(1.5, o.getDouble("x"), 1e-6)
        assertTrue(o.isNull("n"))
    }

    @Test fun jsonStringFromWatchPassesThrough() {
        val raw = """{"v":1,"kind":"ptt","active":true}"""
        // Compared as converted values: tests compile against android.jar, which has no JSONObject.similar.
        assertEquals(GarminJson.toGarmin(raw), GarminJson.toGarmin(GarminJson.fromGarmin(raw)))
    }

    @Test fun roundTrip() {
        val once = GarminJson.toGarmin(state)
        assertEquals(once, GarminJson.toGarmin(GarminJson.fromGarmin(once)))
    }
}
