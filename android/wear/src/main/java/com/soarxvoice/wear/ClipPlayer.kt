package com.soarxvoice.wear

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * Plays incoming voice clips one after another on the watch speaker.
 * A haptic pulse comes first so the rider lifts the wrist. Playback holds
 * while the rider is recording ([hold]) and resumes after.
 *
 * MediaPlayer accepts AAC in ADTS (`.aac`, what Agora records on the phone)
 * and in MP4 (`.m4a`, what other watches record) alike.
 */
object ClipPlayer {
    private const val TAG = "ClipPlayer"
    private const val MAX_QUEUE = 8
    /** Gain added on top of media volume, millibels. Tune after a sea test. */
    private const val LOUDNESS_GAIN_MB = 600

    private data class Item(val file: File, val meta: Protocol.ClipMeta)

    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<Item>()
    private var player: MediaPlayer? = null
    private var current: Item? = null
    private var enhancer: LoudnessEnhancer? = null
    private var focus: AudioFocusRequest? = null
    private var held = false
    /** Bumped whenever playback is cut, so a delayed start of a stale item is ignored. */
    private var generation = 0
    private lateinit var app: Context

    /** Name of the rider being played right now, or null. */
    private val _nowPlaying = MutableStateFlow<String?>(null)
    val nowPlaying: StateFlow<String?> = _nowPlaying

    private val _queued = MutableStateFlow(0)
    val queued: StateFlow<Int> = _queued

    fun enqueue(context: Context, file: File, meta: Protocol.ClipMeta) = main.post {
        app = context.applicationContext
        while (queue.size >= MAX_QUEUE) queue.removeFirst().file.delete()
        queue.addLast(Item(file, meta))
        _queued.value = queue.size
        if (current == null && !held) playNext()
    }

    /** Pauses the queue (the rider is talking). The current clip restarts afterwards. */
    fun hold() = main.post {
        held = true
        current?.let { queue.addFirst(it) }
        _queued.value = queue.size
        stopCurrent()
    }

    fun release() = main.post {
        held = false
        if (current == null) playNext()
    }

    /** Drops everything (rider tapped "skip"). */
    fun clear() = main.post {
        queue.forEach { it.file.delete() }
        queue.clear()
        _queued.value = 0
        current?.file?.delete()
        stopCurrent()
        abandonFocus()
    }

    private fun playNext() {
        val item = queue.removeFirstOrNull()
        _queued.value = queue.size
        if (item == null) {
            _nowPlaying.value = null
            abandonFocus()
            return
        }
        current = item
        val gen = ++generation
        Haptics.clip(app)
        _nowPlaying.value = item.meta.from
        // Let the pulse finish before sound: a motor and a speaker share a small case.
        main.postDelayed({ if (gen == generation) start(item) }, 250)
    }

    private fun start(item: Item) {
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        requestFocus(am, attrs)
        val mp = MediaPlayer()
        player = mp
        try {
            mp.setAudioAttributes(attrs)
            mp.setDataSource(item.file.absolutePath)
            speaker(am)?.let { mp.setPreferredDevice(it) }
            mp.setOnCompletionListener { finish(mp, item) }
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "playback error $what/$extra on ${item.file.name}")
                finish(mp, item)
                true
            }
            mp.prepare()
            enhancer = try {
                LoudnessEnhancer(mp.audioSessionId).apply {
                    setTargetGain(LOUDNESS_GAIN_MB)
                    enabled = true
                }
            } catch (e: Throwable) {
                null
            }
            mp.start()
        } catch (e: Exception) {
            Log.w(TAG, "cannot play ${item.file.name}: ${e.message}")
            finish(mp, item)
        }
    }

    private fun finish(mp: MediaPlayer, item: Item) {
        if (player !== mp) return
        current = null
        releasePlayer()
        item.file.delete()
        playNext()
    }

    private fun stopCurrent() {
        current = null
        generation++
        releasePlayer()
        _nowPlaying.value = null
    }

    private fun releasePlayer() {
        try {
            enhancer?.release()
        } catch (_: Throwable) {
        }
        enhancer = null
        player?.let {
            try {
                it.stop()
            } catch (_: Throwable) {
            }
            it.release()
        }
        player = null
    }

    /** The built-in speaker: Wear OS may otherwise prefer a paired headset or nothing. */
    private fun speaker(am: AudioManager): AudioDeviceInfo? =
        am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }

    private fun requestFocus(am: AudioManager, attrs: AudioAttributes) {
        if (focus != null) return
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .build()
        focus = req
        am.requestAudioFocus(req)
    }

    private fun abandonFocus() {
        val req = focus ?: return
        focus = null
        if (::app.isInitialized) {
            (app.getSystemService(Context.AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(req)
        }
    }

    /** True when the watch has a speaker at all (some Wear OS models do not). */
    fun hasSpeaker(context: Context): Boolean {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return context.packageManager.hasSystemFeature("android.hardware.audio.output") && speaker(am) != null
    }
}
