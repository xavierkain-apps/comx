package com.soarxvoice.wear

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status

/**
 * Keeps the app alive for a session (screen off, wrist down): a foreground
 * service with a Wear OS Ongoing Activity, so the watch face shows a SoarX
 * icon that returns to the app with one tap.
 *
 * Started from the activity (foreground services cannot be started from the
 * background on Android 12+). Stopped from the app's "Stop" chip.
 *
 * Every [HELLO_INTERVAL_MS] it tells the phone the watch is there: the phone
 * treats a recent `hello` as "a voice watch is active" (auto watch mode).
 */
class RideService : Service() {

    companion object {
        private const val CHANNEL_ID = "soarx_ride"
        private const val NOTIFICATION_ID = 7
        private const val HELLO_INTERVAL_MS = 120_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RideService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RideService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val hello = object : Runnable {
        override fun run() {
            PhoneLink.hello(this@RideService)
            main.postDelayed(this, HELLO_INTERVAL_MS)
        }
    }
    private var started = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!started) {
            started = true
            goForeground()
            main.post(hello)
        }
        return START_STICKY
    }

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Ride session", NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_soarx)
            .setContentTitle("SoarX")
            .setContentText("Ride session")
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setContentIntent(open)
        OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_soarx)
            .setTouchIntent(open)
            .setStatus(Status.Builder().addTemplate("SoarX").build())
            .build()
            .apply(this)

        // Microphone only when granted (claiming it without the permission throws on Android 14+).
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, builder.build(), type)
    }

    override fun onDestroy() {
        main.removeCallbacks(hello)
        Talk.cancel()
        ClipPlayer.clear()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
