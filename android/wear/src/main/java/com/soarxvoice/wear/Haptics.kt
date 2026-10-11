package com.soarxvoice.wear

import android.content.Context
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.os.Build

/**
 * Strong, distinct patterns: on the water the watch is felt, not looked at.
 * Amplitude 255 everywhere; timings alternate off/on (ms).
 */
object Haptics {
    private fun vibrator(context: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    private fun play(context: Context, timings: LongArray, alarm: Boolean = false) {
        val v = vibrator(context) ?: return
        if (!v.hasVibrator()) return
        val amps = IntArray(timings.size) { i -> if (i % 2 == 0) 0 else 255 }
        val effect = if (v.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(timings, amps, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            // Alarm usage still vibrates when the watch is in a quieter mode.
            val usage = if (alarm) VibrationAttributes.USAGE_ALARM else VibrationAttributes.USAGE_COMMUNICATION_REQUEST
            v.vibrate(effect, VibrationAttributes.createForUsage(usage))
        } else {
            v.vibrate(effect)
        }
    }

    /** Talk started: one firm pulse. */
    fun talkStart(c: Context) = play(c, longArrayOf(0, 120))

    /** Talk stopped and sent: two short pulses. */
    fun talkSent(c: Context) = play(c, longArrayOf(0, 60, 80, 60))

    /** Recording failed or nothing reached the phone: long buzz. */
    fun error(c: Context) = play(c, longArrayOf(0, 400))

    /** Someone started talking. */
    fun speaking(c: Context) = play(c, longArrayOf(0, 80, 60, 80))

    /** A voice clip is about to play. */
    fun clip(c: Context) = play(c, longArrayOf(0, 200))

    /** Quick message received. */
    fun text(c: Context) = play(c, longArrayOf(0, 150, 100, 150, 100, 150))

    /** SOS received: long, repeated, at alarm priority. */
    fun sos(c: Context) = play(c, longArrayOf(0, 600, 200, 600, 200, 600, 200, 600), alarm = true)
}
