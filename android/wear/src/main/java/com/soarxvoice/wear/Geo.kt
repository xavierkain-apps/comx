package com.soarxvoice.wear

import kotlin.math.roundToInt

/** Arrow and heading math. Pure functions, unit-tested. */
object Geo {

    enum class HeadingSource { COMPASS, COG, NORTH_UP }

    data class Heading(val degrees: Double, val source: HeadingSource)

    /**
     * Heading used to rotate arrows: the watch compass when there is one,
     * else the phone's course over ground, else north-up (0).
     * COG is ignored below [minSogMs]: at a standstill GPS course is noise.
     */
    fun chooseHeading(compass: Double?, cog: Double?, sog: Double?, minSogMs: Double = 1.0): Heading = when {
        compass != null && compass.isFinite() -> Heading(norm(compass), HeadingSource.COMPASS)
        cog != null && cog.isFinite() && (sog == null || sog >= minSogMs) -> Heading(norm(cog), HeadingSource.COG)
        else -> Heading(0.0, HeadingSource.NORTH_UP)
    }

    /** Arrow angle on screen, degrees clockwise from 12 o'clock: `brg - heading`, in [0, 360). */
    fun arrowAngle(brg: Double, heading: Double): Double = norm(brg - heading)

    /** Normalises to [0, 360). */
    fun norm(deg: Double): Double {
        val r = deg % 360.0
        val n = if (r < 0) r + 360.0 else r
        return if (n >= 360.0) 0.0 else n
    }

    /** Signed shortest difference `to - from`, in (-180, 180]. */
    fun delta(from: Double, to: Double): Double {
        val d = norm(to - from)
        return if (d > 180.0) d - 360.0 else d
    }

    /**
     * Exponential smoothing on a circle (no jump at 359 -> 0).
     * [alpha] = 1 means no smoothing.
     */
    fun smooth(prev: Double?, next: Double, alpha: Double): Double =
        if (prev == null) norm(next) else norm(prev + alpha * delta(prev, next))

    /** "85 m", "340 m", "1.2 km", "12 km", or "--" when unknown. */
    fun formatDistance(m: Double?): String = when {
        m == null || !m.isFinite() || m < 0 -> "--"
        m < 1000 -> "${(m / 5).roundToInt() * 5} m"
        m < 10_000 -> String.format(java.util.Locale.US, "%.1f km", m / 1000)
        else -> "${(m / 1000).roundToInt()} km"
    }
}
