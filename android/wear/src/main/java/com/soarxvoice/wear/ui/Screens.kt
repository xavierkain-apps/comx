package com.soarxvoice.wear.ui

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.soarxvoice.wear.ClipPlayer
import com.soarxvoice.wear.Geo
import com.soarxvoice.wear.PhoneLink
import com.soarxvoice.wear.Protocol
import com.soarxvoice.wear.RideService
import com.soarxvoice.wear.RideStore
import com.soarxvoice.wear.Talk
import kotlinx.coroutines.delay

/** Ticks once a second so ages and "phone lost" re-evaluate without new data. */
@Composable
private fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }
    return now
}

/** Heading used for arrows, from the watch compass, else the phone's COG, else north-up. */
@Composable
private fun rememberHeading(compass: Double?): Geo.Heading {
    val state by RideStore.state.collectAsState()
    return Geo.chooseHeading(compass, state?.me?.cog, state?.me?.sog)
}

@Composable
fun SoarxApp(compass: Double?, ambient: Boolean, onTalk: () -> Unit) {
    MaterialTheme {
        val nav = rememberSwipeDismissableNavController()
        Box(Modifier.fillMaxSize()) {
            SwipeDismissableNavHost(navController = nav, startDestination = "home") {
                composable("home") {
                    HomeScreen(
                        compass = compass,
                        ambient = ambient,
                        onTalk = onTalk,
                        onRider = { nav.navigate("rider/$it") },
                        onMessages = { nav.navigate("messages") },
                        onSos = { nav.navigate("sos") },
                    )
                }
                composable("rider/{uid}") { entry ->
                    val uid = entry.arguments?.getString("uid")?.toLongOrNull() ?: 0L
                    RiderScreen(uid, compass, ambient)
                }
                composable("messages") { MessagesScreen(onSent = { nav.popBackStack() }) }
                composable("sos") { SosScreen(onDone = { nav.popBackStack() }) }
            }
            Alerts(compass = compass, onShowRider = { nav.navigate("rider/$it") })
        }
    }
}

// ---- Home -------------------------------------------------------------------

@Composable
fun HomeScreen(
    compass: Double?,
    ambient: Boolean,
    onTalk: () -> Unit,
    onRider: (Long) -> Unit,
    onMessages: () -> Unit,
    onSos: () -> Unit,
) {
    val context = LocalContext.current
    val state by RideStore.state.collectAsState()
    val stateAt by RideStore.stateAt.collectAsState()
    val speaking by RideStore.speaking.collectAsState()
    val sos by RideStore.sos.collectAsState()
    val mySos by RideStore.mySos.collectAsState()
    val nowPlaying by ClipPlayer.nowPlaying.collectAsState()
    val queued by ClipPlayer.queued.collectAsState()
    val phase by Talk.phase.collectAsState()
    val since by Talk.since.collectAsState()
    val now = rememberNow()
    val heading = rememberHeading(compass)
    val listState = rememberScalingLazyListState()

    val phoneOk = state != null && now - stateAt < RideStore.STATE_STALE_MS
    val status = when {
        !phoneOk -> "Phone not connected"
        state?.connected != true -> "Not in a channel"
        else -> state!!.channel
    }

    Scaffold(
        timeText = { if (!ambient) TimeText() },
        positionIndicator = { if (!ambient) PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    status,
                    color = if (phoneOk) Palette.Text else Palette.Recording,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            item {
                TalkButton(phase = phase, since = since, ambient = ambient, onClick = onTalk)
            }
            item {
                val who = nowPlaying?.let { "Hearing $it" + if (queued > 0) " (+$queued)" else "" }
                    ?: speaking.values.firstOrNull()?.let { "$it is talking" }
                if (who != null) {
                    Text(
                        who,
                        color = Palette.Speaking,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable(enabled = nowPlaying != null) { ClipPlayer.clear() },
                    )
                }
            }
            if (mySos) {
                item {
                    Chip(
                        onClick = onSos,
                        label = { Text("MY SOS IS ON", fontWeight = FontWeight.Bold) },
                        secondaryLabel = { Text("Tap to cancel") },
                        colors = ChipDefaults.primaryChipColors(backgroundColor = Palette.Sos),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            items(sos.values.toList(), key = { "sos-${it.uid}" }) { e ->
                val rider = state?.riders?.firstOrNull { it.uid == e.uid }
                val brg = rider?.brg ?: e.brg
                Chip(
                    onClick = { onRider(e.uid) },
                    label = { Text("SOS ${e.from}", fontWeight = FontWeight.Bold) },
                    secondaryLabel = { Text(Geo.formatDistance(rider?.dist ?: e.dist)) },
                    icon = {
                        Arrow(brg?.let { Geo.arrowAngle(it, heading.degrees) }, Color.White, 28.dp)
                    },
                    colors = ChipDefaults.primaryChipColors(backgroundColor = Palette.Sos),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            val riders = state?.riders.orEmpty().sortedBy { it.dist ?: Double.MAX_VALUE }
            if (phoneOk && state?.connected == true && riders.isEmpty()) {
                item { Text("No other rider yet", fontSize = 13.sp) }
            }
            items(riders, key = { "r-${it.uid}" }) { r ->
                RiderRow(r, speaking.containsKey(r.uid) || r.speaking, heading, ambient) { onRider(r.uid) }
            }
            if (!ambient) {
                item {
                    Chip(
                        onClick = onMessages,
                        label = { Text("Messages") },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Chip(
                        onClick = onSos,
                        label = { Text("SOS", fontWeight = FontWeight.Bold) },
                        colors = ChipDefaults.primaryChipColors(backgroundColor = Palette.Sos),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Chip(
                        onClick = { RideService.stop(context) },
                        label = { Text("Stop session") },
                        secondaryLabel = { Text("Saves battery") },
                        colors = ChipDefaults.childChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item { Text(headingLabel(heading.source), fontSize = 11.sp, color = Palette.Stale) }
            }
        }
    }
}

private fun headingLabel(s: Geo.HeadingSource) = when (s) {
    Geo.HeadingSource.COMPASS -> "Arrows: watch compass"
    Geo.HeadingSource.COG -> "Arrows: direction of travel"
    Geo.HeadingSource.NORTH_UP -> "Arrows: north up"
}

@Composable
private fun TalkButton(phase: Talk.Phase, since: Long, ambient: Boolean, onClick: () -> Unit) {
    val elapsed by produceState(0L, phase, since) {
        while (phase == Talk.Phase.RECORDING) {
            value = (SystemClock.elapsedRealtime() - since) / 1000
            delay(250)
        }
    }
    val (label, sub, color) = when (phase) {
        Talk.Phase.IDLE -> Triple("TALK", "tap", Palette.Talk)
        Talk.Phase.RECORDING -> Triple("SEND", "${elapsed}s / ${Talk.MAX_MS / 1000}s", Palette.Recording)
        Talk.Phase.SENDING -> Triple("...", "sending", Palette.Stale)
    }
    Button(
        onClick = onClick,
        enabled = phase != Talk.Phase.SENDING,
        colors = ButtonDefaults.buttonColors(backgroundColor = if (ambient) Color.Black else color),
        modifier = Modifier.padding(vertical = 4.dp).size(112.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, fontSize = 28.sp, fontWeight = FontWeight.Black, color = Color.White)
            Text(sub, fontSize = 12.sp, color = Color.White)
        }
    }
}

@Composable
private fun RiderRow(r: Protocol.Rider, talking: Boolean, heading: Geo.Heading, ambient: Boolean, onClick: () -> Unit) {
    val color = when {
        r.sos -> Palette.Sos
        r.stale -> Palette.Stale
        talking -> Palette.Speaking
        else -> Palette.Text
    }
    val detail = buildString {
        append(Geo.formatDistance(r.dist))
        if (talking) append("  talking")
        if (r.sos) append("  SOS")
        if (r.stale) append("  old fix")
    }
    Chip(
        onClick = onClick,
        label = { Text(r.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = color) },
        secondaryLabel = { Text(detail, maxLines = 1, color = color) },
        icon = {
            if (!ambient) Arrow(r.brg?.let { Geo.arrowAngle(it, heading.degrees) }, color, 30.dp)
        },
        colors = if (ambient) ChipDefaults.outlinedChipColors() else ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ---- Single rider: compass view --------------------------------------------

@Composable
fun RiderScreen(uid: Long, compass: Double?, ambient: Boolean) {
    val state by RideStore.state.collectAsState()
    val sos by RideStore.sos.collectAsState()
    val speaking by RideStore.speaking.collectAsState()
    val heading = rememberHeading(compass)
    val r = state?.riders?.firstOrNull { it.uid == uid }
    val sosEvent = sos[uid]
    val brg = r?.brg ?: sosEvent?.brg
    val dist = r?.dist ?: sosEvent?.dist
    val isSos = r?.sos == true || sosEvent != null
    val color = when {
        isSos -> Palette.Sos
        r?.stale == true -> Palette.Stale
        else -> Palette.Text
    }
    Column(
        Modifier.fillMaxSize().padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            r?.name ?: sosEvent?.from ?: "Rider",
            fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            color = color,
        )
        Arrow(brg?.let { Geo.arrowAngle(it, heading.degrees) }, color, if (ambient) 70.dp else 96.dp)
        Text(Geo.formatDistance(dist), fontSize = 30.sp, fontWeight = FontWeight.Black, color = color)
        val notes = listOfNotNull(
            if (isSos) "SOS" else null,
            if (speaking.containsKey(uid) || r?.speaking == true) "talking" else null,
            if (r?.stale == true) "old fix" else null,
            if (r == null && sosEvent == null) "left the channel" else null,
        )
        if (notes.isNotEmpty()) Text(notes.joinToString("  "), fontSize = 13.sp, color = color)
        if (!ambient) Text(headingLabel(heading.source), fontSize = 10.sp, color = Palette.Stale, textAlign = TextAlign.Center)
    }
}

// ---- Quick messages ---------------------------------------------------------

@Composable
fun MessagesScreen(onSent: () -> Unit) {
    val context = LocalContext.current
    val listState = rememberScalingLazyListState()
    var result by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(result) {
        if (result == "Sent") {
            delay(900)
            onSent()
        }
    }
    Scaffold(positionIndicator = { PositionIndicator(scalingLazyListState = listState) }) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item { Text(result ?: "Send to everyone", fontSize = 14.sp, textAlign = TextAlign.Center) }
            items(Protocol.QUICK_MESSAGES) { (id, text) ->
                Chip(
                    onClick = {
                        result = "Sending..."
                        PhoneLink.sendJson(context, Protocol.text(id)) { ok ->
                            result = if (ok) "Sent" else "Phone not reachable"
                            if (ok) com.soarxvoice.wear.Haptics.talkSent(context) else com.soarxvoice.wear.Haptics.error(context)
                        }
                    },
                    label = { Text(text, fontSize = 16.sp) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

// ---- SOS (confirm / cancel) ------------------------------------------------

@Composable
fun SosScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val mySos by RideStore.mySos.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    fun send(active: Boolean) {
        PhoneLink.sendJson(context, Protocol.sos(active)) { ok ->
            if (ok) {
                RideStore.setMySos(active)
                com.soarxvoice.wear.Haptics.talkSent(context)
                onDone()
            } else {
                error = "Phone not reachable - try again"
                com.soarxvoice.wear.Haptics.error(context)
            }
        }
    }
    Column(
        Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            error ?: if (mySos) "Your SOS is on" else "Send SOS to all riders?",
            textAlign = TextAlign.Center, fontSize = 15.sp,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { send(!mySos) },
            colors = ButtonDefaults.buttonColors(backgroundColor = if (mySos) Palette.Stale else Palette.Sos),
            modifier = Modifier.size(96.dp),
        ) {
            Text(if (mySos) "CANCEL\nSOS" else "SEND\nSOS", fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(6.dp))
        if (!mySos) {
            Text("Back", modifier = Modifier.clickable { onDone() }.padding(8.dp), fontSize = 14.sp)
        }
    }
}

// ---- Incoming alerts --------------------------------------------------------

/** Full-screen alert for a received quick message or SOS, on top of any screen. */
@Composable
fun Alerts(compass: Double?, onShowRider: (Long) -> Unit) {
    val text by RideStore.textAlert.collectAsState()
    val sos by RideStore.sos.collectAsState()
    val seen by RideStore.sosSeen.collectAsState()
    val state by RideStore.state.collectAsState()
    val heading = rememberHeading(compass)

    val sosAlert = sos.values.firstOrNull { it.uid !in seen }
    if (sosAlert != null) {
        val r = state?.riders?.firstOrNull { it.uid == sosAlert.uid }
        val brg = r?.brg ?: sosAlert.brg
        Column(
            Modifier.fillMaxSize().clip(CircleShape).background(Palette.Sos)
                .clickable {
                    RideStore.dismissSos(sosAlert.uid)
                    onShowRider(sosAlert.uid)
                },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("SOS", fontSize = 26.sp, fontWeight = FontWeight.Black, color = Color.White)
            Text(sosAlert.from, fontSize = 18.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Arrow(brg?.let { Geo.arrowAngle(it, heading.degrees) }, Color.White, 70.dp)
            Text(Geo.formatDistance(r?.dist ?: sosAlert.dist), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text("tap to follow", fontSize = 11.sp, color = Color.White)
        }
        return
    }
    val t = text ?: return
    // Hands are busy on the water: the message clears itself.
    LaunchedEffect(t) {
        delay(20_000)
        if (RideStore.textAlert.value === t) RideStore.dismissText()
    }
    Column(
        Modifier.fillMaxSize().background(Color(0xFF0D47A1)).clickable { RideStore.dismissText() }.padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(t.from, fontSize = 16.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            t.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White,
            textAlign = TextAlign.Center, maxLines = 4,
        )
        Row(Modifier.padding(top = 6.dp)) { Text("tap to close", fontSize = 11.sp, color = Color.White) }
    }
}
