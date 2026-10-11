package com.soarxvoice.wear

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Watch compass from the rotation-vector sensor (falls back to the
 * geomagnetic rotation vector). Emits degrees TRUE, clockwise from north,
 * for the top of the screen; null when the watch has no usable sensor.
 * Only runs while the UI is visible ([start]/[stop]).
 */
class Heading(context: Context) : SensorEventListener {

    companion object {
        fun sensor(sm: SensorManager?): Sensor? =
            sm?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                ?: sm?.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)

        fun hasCompass(context: Context): Boolean =
            sensor(context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager) != null
    }

    private val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor = sensor(sm)
    private val rot = FloatArray(9)
    private val orient = FloatArray(3)

    private val _degrees = MutableStateFlow<Double?>(null)
    val degrees: StateFlow<Double?> = _degrees

    /** Magnetic declination at the rider's position, degrees east. */
    @Volatile private var declination = 0.0
    private var declinationAt: Pair<Double, Double>? = null

    val available: Boolean get() = sensor != null

    fun start() {
        sensor?.let { sm?.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
    }

    fun stop() {
        sm?.unregisterListener(this)
        _degrees.value = null
    }

    /** Updates the declination when the rider has moved more than ~10 km. */
    fun updatePosition(lat: Double?, lon: Double?) {
        if (lat == null || lon == null) return
        val prev = declinationAt
        if (prev != null && kotlin.math.abs(prev.first - lat) < 0.1 && kotlin.math.abs(prev.second - lon) < 0.1) return
        declinationAt = lat to lon
        declination = GeomagneticField(lat.toFloat(), lon.toFloat(), 0f, System.currentTimeMillis()).declination.toDouble()
    }

    override fun onSensorChanged(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rot, event.values)
        SensorManager.getOrientation(rot, orient)
        val magnetic = Math.toDegrees(orient[0].toDouble())
        val trueDeg = Geo.norm(magnetic + declination)
        _degrees.value = Geo.smooth(_degrees.value, trueDeg, 0.25)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
