package com.soarxvoice.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class GeoTest {
    private val eps = 1e-9

    @Test fun arrowIsBearingMinusHeading() {
        assertEquals(45.0, Geo.arrowAngle(45.0, 0.0), eps)
        assertEquals(0.0, Geo.arrowAngle(90.0, 90.0), eps)
        assertEquals(270.0, Geo.arrowAngle(0.0, 90.0), eps) // target due north, riding east: arrow points left
        assertEquals(20.0, Geo.arrowAngle(10.0, 350.0), eps) // across north
        assertEquals(340.0, Geo.arrowAngle(350.0, 10.0), eps)
        assertEquals(180.0, Geo.arrowAngle(225.0, 45.0), eps)
    }

    @Test fun normWrapsIntoZeroTo360() {
        assertEquals(0.0, Geo.norm(360.0), eps)
        assertEquals(0.0, Geo.norm(-360.0), eps)
        assertEquals(350.0, Geo.norm(-10.0), eps)
        assertEquals(10.0, Geo.norm(730.0), eps)
        assertEquals(0.0, Geo.norm(-1e-14), eps) // must never return 360
    }

    @Test fun deltaIsShortestSignedTurn() {
        assertEquals(20.0, Geo.delta(350.0, 10.0), eps)
        assertEquals(-20.0, Geo.delta(10.0, 350.0), eps)
        assertEquals(180.0, Geo.delta(0.0, 180.0), eps)
    }

    @Test fun smoothingCrossesNorthTheShortWay() {
        assertEquals(0.0, Geo.smooth(350.0, 10.0, 0.5), eps)
        assertEquals(355.0, Geo.smooth(350.0, 10.0, 0.25), eps)
        assertEquals(42.0, Geo.smooth(null, 42.0, 0.25), eps)
    }

    @Test fun headingPrefersCompassThenCogThenNorth() {
        assertEquals(Geo.HeadingSource.COMPASS, Geo.chooseHeading(100.0, 200.0, 5.0).source)
        assertEquals(100.0, Geo.chooseHeading(100.0, 200.0, 5.0).degrees, eps)
        val cog = Geo.chooseHeading(null, 200.0, 5.0)
        assertEquals(Geo.HeadingSource.COG, cog.source)
        assertEquals(200.0, cog.degrees, eps)
        // Unknown speed: trust the COG the phone sent.
        assertEquals(Geo.HeadingSource.COG, Geo.chooseHeading(null, 200.0, null).source)
        // Standing still: COG is noise.
        assertEquals(Geo.HeadingSource.NORTH_UP, Geo.chooseHeading(null, 200.0, 0.3).source)
        val north = Geo.chooseHeading(null, null, null)
        assertEquals(Geo.HeadingSource.NORTH_UP, north.source)
        assertEquals(0.0, north.degrees, eps)
        assertEquals(Geo.HeadingSource.NORTH_UP, Geo.chooseHeading(Double.NaN, null, null).source)
    }

    @Test fun distanceFormatting() {
        assertEquals("--", Geo.formatDistance(null))
        assertEquals("--", Geo.formatDistance(Double.NaN))
        assertEquals("0 m", Geo.formatDistance(1.0))
        assertEquals("340 m", Geo.formatDistance(341.0))
        assertEquals("1.2 km", Geo.formatDistance(1234.0))
        assertEquals("12 km", Geo.formatDistance(12_400.0))
    }
}
