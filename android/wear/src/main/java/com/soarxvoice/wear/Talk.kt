package com.soarxvoice.wear

import android.content.Context
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * Walkie-talkie recorder: tap to start, tap to stop and send. AAC in MP4
 * (`.m4a`), mono, 16 kHz, auto-stop at [MAX_MS]. Incoming clips are held
 * while recording so the rider does not record the watch speaker.
 */
object Talk {
    private const val TAG = "Talk"
    const val MAX_MS = 30_000
    private const val MIN_MS = 400L

    enum class Phase { IDLE, RECORDING, SENDING }

    private val main = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L

    private val _phase = MutableStateFlow(Phase.IDLE)
    val phase: StateFlow<Phase> = _phase

    /** Elapsed-realtime start of the current recording, for the on-screen timer. */
    private val _since = MutableStateFlow(0L)
    val since: StateFlow<Long> = _since

    /** Result of the last send: true sent, false failed, null none yet. */
    private val _lastResult = MutableStateFlow<Boolean?>(null)
    val lastResult: StateFlow<Boolean?> = _lastResult

    fun toggle(context: Context) {
        when (_phase.value) {
            Phase.IDLE -> start(context)
            Phase.RECORDING -> stopAndSend(context)
            Phase.SENDING -> Unit
        }
    }

    fun start(context: Context) {
        if (recorder != null) return
        val app = context.applicationContext
        ClipPlayer.hold()
        val out = File(app.cacheDir, "tx-${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION")
        val r = if (android.os.Build.VERSION.SDK_INT >= 31) MediaRecorder(app) else MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(32_000)
            r.setMaxDuration(MAX_MS)
            r.setOutputFile(out.absolutePath)
            r.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                    main.post { stopAndSend(app) }
                }
            }
            r.prepare()
            r.start()
        } catch (e: Exception) {
            Log.w(TAG, "cannot record: ${e.message}")
            r.release()
            out.delete()
            ClipPlayer.release()
            Haptics.error(app)
            _lastResult.value = false
            return
        }
        recorder = r
        file = out
        startedAt = SystemClock.elapsedRealtime()
        _since.value = startedAt
        _phase.value = Phase.RECORDING
        Haptics.talkStart(app)
    }

    fun stopAndSend(context: Context) {
        val app = context.applicationContext
        val r = recorder ?: return
        val f = file
        recorder = null
        file = null
        val durationMs = SystemClock.elapsedRealtime() - startedAt
        val ok = try {
            r.stop()
            true
        } catch (e: RuntimeException) {
            // stop() throws when nothing was captured (very short press).
            false
        } finally {
            r.release()
        }
        ClipPlayer.release()
        if (!ok || f == null || durationMs < MIN_MS || f.length() == 0L) {
            f?.delete()
            _phase.value = Phase.IDLE
            Haptics.error(app)
            return
        }
        _phase.value = Phase.SENDING
        PhoneLink.sendClip(app, f, durationMs.coerceAtMost(MAX_MS.toLong())) { sent ->
            _lastResult.value = sent
            _phase.value = Phase.IDLE
            if (sent) Haptics.talkSent(app) else Haptics.error(app)
        }
    }

    /** Abandons a recording without sending (activity destroyed, permission revoked). */
    fun cancel() {
        val r = recorder ?: return
        recorder = null
        try {
            r.stop()
        } catch (_: RuntimeException) {
        }
        r.release()
        file?.delete()
        file = null
        _phase.value = Phase.IDLE
        ClipPlayer.release()
    }
}
