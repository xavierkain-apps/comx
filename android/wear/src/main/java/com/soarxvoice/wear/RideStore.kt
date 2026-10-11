package com.soarxvoice.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Process-wide UI state, fed by [DataLayerService] (phone traffic), the
 * [ClipPlayer] and the [Talk] recorder. Compose collects the flows.
 */
object RideStore {
    /** State older than this means the phone link is down. */
    const val STATE_STALE_MS = 10_000L

    private val _state = MutableStateFlow<Protocol.State?>(null)
    val state: StateFlow<Protocol.State?> = _state

    /** Local receive time of the last state (watch clock: phone and watch clocks may differ). */
    private val _stateAt = MutableStateFlow(0L)
    val stateAt: StateFlow<Long> = _stateAt

    /** uid -> name of riders the phone currently reports as talking. */
    private val _speaking = MutableStateFlow<Map<Long, String>>(emptyMap())
    val speaking: StateFlow<Map<Long, String>> = _speaking

    /** Text alert waiting to be acknowledged (latest wins). */
    private val _textAlert = MutableStateFlow<Protocol.Event.Text?>(null)
    val textAlert: StateFlow<Protocol.Event.Text?> = _textAlert

    /** Active SOS from other riders, by uid. */
    private val _sos = MutableStateFlow<Map<Long, Protocol.Event.Sos>>(emptyMap())
    val sos: StateFlow<Map<Long, Protocol.Event.Sos>> = _sos

    /** SOS uids whose full-screen alert the rider dismissed (the banner stays). */
    private val _sosSeen = MutableStateFlow<Set<Long>>(emptySet())
    val sosSeen: StateFlow<Set<Long>> = _sosSeen

    /** This rider's own SOS. */
    private val _mySos = MutableStateFlow(false)
    val mySos: StateFlow<Boolean> = _mySos

    fun onState(s: Protocol.State) {
        _state.value = s
        _stateAt.value = System.currentTimeMillis()
        // Riders that left the channel cannot keep a speaking flag.
        val uids = s.riders.map { it.uid }.toSet()
        _speaking.update { m -> m.filterKeys { it in uids } }
        // Keep the SOS list in step with the state's per-rider flag.
        val sosInState = s.riders.filter { it.sos }.map { it.uid }.toSet()
        _sos.update { m -> m.filterKeys { it in sosInState || it !in uids } }
    }

    fun onEvent(context: Context, e: Protocol.Event) {
        when (e) {
            is Protocol.Event.Speaking -> {
                val was = _speaking.value.containsKey(e.uid)
                _speaking.update { if (e.active) it + (e.uid to e.from) else it - e.uid }
                if (e.active && !was) Haptics.speaking(context)
            }
            is Protocol.Event.Text -> {
                _textAlert.value = e
                Haptics.text(context)
            }
            is Protocol.Event.Sos -> {
                if (e.active) {
                    _sos.update { it + (e.uid to e) }
                    _sosSeen.update { it - e.uid }
                    Haptics.sos(context)
                } else {
                    _sos.update { it - e.uid }
                    _sosSeen.update { it - e.uid }
                    Haptics.text(context)
                }
            }
        }
    }

    fun dismissText() {
        _textAlert.value = null
    }

    fun dismissSos(uid: Long) {
        _sosSeen.update { it + uid }
    }

    fun setMySos(active: Boolean) {
        _mySos.value = active
    }

    fun phoneReachable(now: Long = System.currentTimeMillis()): Boolean =
        _state.value != null && now - _stateAt.value < STATE_STALE_MS
}
