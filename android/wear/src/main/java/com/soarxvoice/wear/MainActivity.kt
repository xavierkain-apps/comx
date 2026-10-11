package com.soarxvoice.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.wear.ambient.AmbientLifecycleObserver
import com.soarxvoice.wear.ui.SoarxApp
import kotlinx.coroutines.launch

/**
 * Single activity. Talk is a tap on the big button (tap again to send) or a
 * press on a programmable stem button where the watch has one.
 */
class MainActivity : ComponentActivity() {

    private lateinit var heading: Heading
    private val ambient = mutableStateOf(false)

    private val ambientObserver by lazy {
        AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
                ambient.value = true
                heading.stop()
            }

            override fun onExitAmbient() {
                ambient.value = false
                heading.start()
            }
        })
    }

    private var talkAfterGrant = false
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.RECORD_AUDIO] == true && talkAfterGrant) Talk.start(this)
        talkAfterGrant = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        heading = Heading(this)
        lifecycle.addObserver(ambientObserver)
        PhoneLink.init(this)

        val wanted = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (wanted.isNotEmpty()) permissions.launch(wanted.toTypedArray())

        RideService.start(this)

        // Keep the screen on while recording so the press-to-send stays visible.
        lifecycleScope.launch {
            Talk.phase.collect { p ->
                if (p == Talk.Phase.RECORDING) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        // The compass fixes magnetic declination from the phone's GPS.
        lifecycleScope.launch {
            RideStore.state.collect { s -> heading.updatePosition(s?.me?.lat, s?.me?.lon) }
        }

        setContent {
            val compass by heading.degrees.collectAsState()
            SoarxApp(compass = compass, ambient = ambient.value, onTalk = ::onTalk)
        }
    }

    override fun onStart() {
        super.onStart()
        if (!ambient.value) heading.start()
        PhoneLink.hello(this)
    }

    override fun onStop() {
        heading.stop()
        super.onStop()
    }

    private fun onTalk() {
        if (Talk.phase.value == Talk.Phase.IDLE &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            talkAfterGrant = true
            permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            return
        }
        Talk.toggle(this)
    }

    /** Programmable stem buttons (Pixel Watch, some Wear OS models). Galaxy Watch keys are system-reserved. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (event.repeatCount == 0 &&
            (keyCode == KeyEvent.KEYCODE_STEM_1 || keyCode == KeyEvent.KEYCODE_STEM_2 || keyCode == KeyEvent.KEYCODE_STEM_3)
        ) {
            onTalk()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
