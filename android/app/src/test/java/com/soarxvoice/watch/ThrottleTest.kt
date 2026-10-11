package com.soarxvoice.watch

import org.junit.Assert.assertEquals
import org.junit.Test

class ThrottleTest {
    @Test fun firstSendIsImmediateThenSpacedByInterval() {
        var now = 1_000L
        val t = Throttle(5_000) { now }
        assertEquals(0L, t.delayBeforeNext())
        t.mark()
        now += 2_000
        assertEquals(3_000L, t.delayBeforeNext())
        now += 3_000
        assertEquals(0L, t.delayBeforeNext())
    }
}
