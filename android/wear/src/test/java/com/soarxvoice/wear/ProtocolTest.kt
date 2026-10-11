package com.soarxvoice.wear

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {

    // The example from docs/watch-companion.md, verbatim.
    private val docState = """
        {
          "v": 1,
          "kind": "state",
          "connected": true,
          "channel": "TARIFA-01",
          "watchMode": true,
          "me": {"name": "Xav", "lat": 36.01, "lon": -5.60, "cog": 270.0, "sog": 8.2, "t": 1760000000000},
          "riders": [
            {"uid": 12345, "name": "Carlos", "lat": 36.02, "lon": -5.61, "t": 1760000000000,
             "dist": 340, "brg": 45.0, "speaking": false, "sos": false, "stale": false}
          ],
          "ts": 1760000000000
        }
    """.trimIndent()

    @Test fun parsesContractState() {
        val s = Protocol.parseState(docState)!!
        assertTrue(s.connected)
        assertEquals("TARIFA-01", s.channel)
        assertEquals(270.0, s.me!!.cog!!, 0.0)
        assertEquals(1760000000000L, s.ts)
        val r = s.riders.single()
        assertEquals(12345L, r.uid)
        assertEquals(340.0, r.dist!!, 0.0) // integer JSON number
        assertEquals(45.0, r.brg!!, 0.0)
        assertFalse(r.stale)
    }

    @Test fun nullPositionsStayNull() {
        val json = """{"v":1,"kind":"state","connected":true,"channel":"X","watchMode":false,
            "me":{"name":"Me","lat":null,"lon":null,"cog":null,"sog":null,"t":null},
            "riders":[{"uid":1,"name":"A","lat":null,"lon":null,"t":null,"dist":null,"brg":null,
            "speaking":true,"sos":false,"stale":true}],"ts":5}"""
        val s = Protocol.parseState(json)!!
        assertNull(s.me!!.cog)
        assertNull(s.riders[0].dist)
        assertNull(s.riders[0].brg)
        assertTrue(s.riders[0].speaking)
    }

    @Test fun rejectsOtherKindsAndGarbage() {
        assertNull(Protocol.parseState("""{"v":1,"kind":"event"}"""))
        assertNull(Protocol.parseState("not json"))
        assertNull(Protocol.parseEvent("""{"v":1,"kind":"event","type":"unknown"}"""))
    }

    @Test fun parsesContractEvents() {
        val sp = Protocol.parseEvent("""{"v": 1, "kind": "event", "type": "speaking", "uid": 12345, "from": "Carlos", "active": true}""")
        assertEquals(Protocol.Event.Speaking(12345, "Carlos", true), sp)
        val tx = Protocol.parseEvent("""{"v": 1, "kind": "event", "type": "text", "uid": 12345, "from": "Carlos", "id": "back", "text": "Heading back"}""")
        assertEquals(Protocol.Event.Text(12345, "Carlos", "back", "Heading back"), tx)
        val sos = Protocol.parseEvent("""{"v": 1, "kind": "event", "type": "sos", "uid": 12345, "from": "Carlos", "active": true, "dist": 800, "brg": 120.0}""")
        assertEquals(Protocol.Event.Sos(12345, "Carlos", true, 800.0, 120.0), sos)
    }

    @Test fun textFallsBackToQuickMessageLabel() {
        val tx = Protocol.parseEvent("""{"v":1,"kind":"event","type":"text","uid":1,"from":"A","id":"help"}""") as Protocol.Event.Text
        assertEquals("I need help", tx.text)
    }

    @Test fun clipMeta() {
        val m = Protocol.parseClipMeta("""{"v": 1, "kind": "clip", "uid": 12345, "from": "Carlos", "durationMs": 4200}""")
        assertEquals(Protocol.ClipMeta(12345, "Carlos", 4200), m)
        assertEquals(0L, Protocol.parseClipMeta("garbage").durationMs)
    }

    @Test fun outgoingMessagesMatchContract() {
        JSONObject(Protocol.text("help")).let {
            assertEquals(1, it.getInt("v")); assertEquals("text", it.getString("kind"))
            assertEquals("help", it.getString("id")); assertEquals("I need help", it.getString("text"))
        }
        JSONObject(Protocol.sos(true)).let { assertEquals("sos", it.getString("kind")); assertTrue(it.getBoolean("active")) }
        JSONObject(Protocol.ptt(false)).let { assertEquals("ptt", it.getString("kind")); assertFalse(it.getBoolean("active")) }
        JSONObject(Protocol.hello("Samsung SM-R960", true)).let {
            assertEquals("hello", it.getString("kind")); assertEquals("wearos", it.getString("platform"))
            assertTrue(it.getBoolean("hasCompass"))
        }
        JSONObject(Protocol.clipMeta(3100)).let {
            assertEquals("clip", it.getString("kind")); assertEquals(3100L, it.getLong("durationMs"))
        }
    }

    @Test fun quickMessageIdsAreTheContractOnes() {
        assertEquals(listOf("ok", "back", "wait", "where", "gear", "help"), Protocol.QUICK_MESSAGES.map { it.first })
    }
}
