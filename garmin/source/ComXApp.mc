// ComX for Garmin: application object, phone link and shared state.
//
// Everything the views draw lives here. Views are stateless renderers apart
// from their own selection, so a message arriving while a menu is open is
// never lost: the next onUpdate of whatever view is on screen picks it up.

import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Where the heading used to rotate arrows comes from.
enum HeadingSource {
    HEADING_NONE,    // north-up: arrows show true bearing
    HEADING_COMPASS, // watch magnetometer
    HEADING_GPS,     // watch GPS course (only if the system already has a fix)
    HEADING_COG      // phone's course over ground (me.cog)
}

class ComXApp extends Application.AppBase {

    const MESSAGE_SHOW_MS = 30000;  // incoming message screen closes itself
    const STATE_SILENT_MS = 20000;  // state expected every <= 5 s on Garmin
    const SPEAKING_MAX_MS = 30000;  // clear a "talking" flag nobody turned off
    const PTT_MAX_MS = 120000;      // safety: phone mic auto-off after 2 min
    const ALARM_PERIOD_TICKS = 4;   // SOS buzz every 4 s
    const ALARM_MAX_REPEATS = 30;   // ... for 2 minutes unless acknowledged

    // ---- link status ----
    var phoneOk as Boolean = false;
    var stateAt as Number? = null;      // System.getTimer() of the last state
    var badMessages as Number = 0;
    var txFailed as Boolean = false;

    // ---- last state from the phone ----
    var inChannel as Boolean = false;
    var channel as String? = null;
    var myPos as Dictionary? = null;
    var riders as Array<Dictionary> = [] as Array<Dictionary>;
    private var _maxRiders as Number = 16; // lowered on 96-128 KB heaps (Instinct)

    // ---- events ----
    var speaking as Dictionary<String, Number> = {} as Dictionary<String, Number>; // uid -> expiry
    var sosAlerts as Dictionary<String, Dictionary> = {} as Dictionary<String, Dictionary>;
    var lastText as Dictionary? = null; // {"from", "label"}

    // ---- own actions ----
    var mySos as Boolean = false;
    var ptt as Boolean = false;
    private var _pttAt as Number = 0;

    // ---- heading ----
    var headingDeg as Float? = null;
    var headingSrc as HeadingSource = HEADING_NONE;

    // ---- toast (one line at the bottom of the list) ----
    var toast as String? = null;
    private var _toastUntil as Number = 0;

    // ---- internals ----
    private var _timer as Timer.Timer?;
    private var _tick as Number = 0;
    private var _dirty as Boolean = true;
    private var _drawnHeading as Float? = null;
    private var _queue as Array<Proto.Msg> = [] as Array<Proto.Msg>;
    private var _tries as Array<Number> = [] as Array<Number>; // tries left, parallel to _queue
    private var _busy as Boolean = false;
    private var _busyAt as Number = 0;
    private var _txSeq as Number = 0;   // ignores listener calls for a transmit we gave up on
    private var _alarmKey as String? = null;
    private var _alarmLeft as Number = 0;
    private var _lastBuzz as Dictionary<String, Number> = {} as Dictionary<String, Number>;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        if (System.getSystemStats().totalMemory < 200000) {
            _maxRiders = 8;
        }
        if (Communications has :registerForPhoneAppMessages) {
            Communications.registerForPhoneAppMessages(method(:onPhone));
        }
        phoneOk = System.getDeviceSettings().phoneConnected;
        updateHeading();
        sendHello();
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
    }

    function onStop(state as Dictionary?) as Void {
        if (_timer != null) {
            _timer.stop();
        }
        // Never leave the phone mic open behind us. Best effort: the app is
        // going away and the listener may never be called.
        if (ptt) {
            ptt = false;
            try {
                Communications.transmit(Proto.ptt(false), null, new TxListener(-1));
            } catch (e) {
            }
        }
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        var view = new ListView();
        return [view, new ListDelegate(view)];
    }

    // =====================================================================
    // Incoming
    // =====================================================================

    function onPhone(msg as Communications.PhoneAppMessage) as Void {
        var d = msg.data;
        if (!(d instanceof Dictionary)) {
            badMessages++;
            return;
        }
        var kind = Proto.str(d.get("kind"));
        if ("state".equals(kind)) {
            applyState(d);
        } else if ("event".equals(kind)) {
            applyEvent(d);
        } else if (!"clip".equals(kind)) {
            // Clips are never sent to Garmin; anything else is unexpected.
            badMessages++;
        }
        _dirty = true;
        WatchUi.requestUpdate();
    }

    private function applyState(d as Dictionary) as Void {
        stateAt = System.getTimer();
        inChannel = Proto.flag(d.get("connected"));
        channel = Proto.str(d.get("channel"));
        var m = d.get("me");
        myPos = (m instanceof Dictionary) ? m : null;

        var list = [] as Array<Dictionary>;
        var raw = d.get("riders");
        if (raw instanceof Array) {
            for (var i = 0; i < raw.size(); i++) {
                var r = raw[i];
                if (r instanceof Dictionary && Proto.uidKey(r.get("uid")) != null) {
                    insertSorted(list, r);
                }
            }
        }
        if (list.size() > _maxRiders) {
            list = list.slice(0, _maxRiders);
        }
        riders = list;
    }

    // Order: SOS first, then live riders by distance, then stale/unknown.
    private function rank(r as Dictionary) as Float {
        var d = Proto.num(r.get("dist"));
        var base = d == null ? 5.0e7 : d;
        if (Proto.flag(r.get("stale"))) {
            base += 1.0e8;
        }
        if (Proto.flag(r.get("sos"))) {
            base -= 1.0e9;
        }
        return base;
    }

    private function insertSorted(list as Array<Dictionary>, r as Dictionary) as Void {
        var k = rank(r);
        var i = list.size();
        list.add(r);
        while (i > 0 && rank(list[i - 1]) > k) {
            list[i] = list[i - 1];
            i--;
        }
        list[i] = r;
    }

    private function applyEvent(d as Dictionary) as Void {
        var type = Proto.str(d.get("type"));
        var key = Proto.uidKey(d.get("uid"));
        var from = Proto.str(d.get("from"));
        if (from == null) {
            from = "Rider";
        }
        var now = System.getTimer();

        if ("speaking".equals(type)) {
            if (key == null) {
                return;
            }
            if (Proto.flag(d.get("active"))) {
                speaking.put(key, now + SPEAKING_MAX_MS);
                // One buzz per burst, not one per chatty volume indication.
                var last = _lastBuzz.get(key);
                if (last == null || now - last > 4000) {
                    _lastBuzz.put(key, now);
                    buzz(VIBE_TALK);
                    showToast(from + " talking", 4000);
                }
            } else {
                speaking.remove(key);
            }
        } else if ("text".equals(type)) {
            var id = Proto.str(d.get("id"));
            var label = Proto.quickLabel(id);
            if (label == null) {
                label = Proto.str(d.get("text"));
            }
            if (label == null) {
                label = id != null ? id : "?";
            }
            lastText = {"from" => from, "label" => label};
            buzz(VIBE_TEXT);
            light();
            showMessage();
        } else if ("sos".equals(type)) {
            if (key == null) {
                return;
            }
            if (Proto.flag(d.get("active"))) {
                sosAlerts.put(key, {"from" => from, "dist" => Proto.num(d.get("dist")), "brg" => Proto.num(d.get("brg"))});
                _alarmKey = key;
                _alarmLeft = ALARM_MAX_REPEATS;
                alarmBuzz();
                light();
                showSos(key);
            } else {
                sosAlerts.remove(key);
                if (key.equals(_alarmKey)) {
                    silenceAlarm();
                }
                var top = topView();
                if (top instanceof SosView && key.equals(top.key)) {
                    WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
                }
                buzz(VIBE_TALK);
                showToast("SOS over: " + from, 8000);
            }
        }
    }

    // =====================================================================
    // Outgoing
    // =====================================================================

    function sendHello() as Void {
        if (!phoneOk) {
            return; // sent again when the link comes up (onTick)
        }
        var s = System.getDeviceSettings();
        var model = s.partNumber;
        var hasCompass = (Sensor.getInfo() has :heading) && Sensor.getInfo().heading != null;
        send(Proto.hello(model != null ? model : "garmin", hasCompass), 2);
    }

    function sendQuick(index as Number) as Void {
        send(Proto.text(Proto.QUICK_IDS[index], Proto.QUICK_TEXT[index]), 2);
        showToast("Sending: " + Proto.QUICK_TEXT[index], 5000);
    }

    function setMySos(active as Boolean) as Void {
        mySos = active;
        // SOS keeps retrying for about a minute (one try every 2 s).
        send(Proto.sos(active), 30);
        showToast(active ? "SOS sent" : "SOS cancelled", 6000);
        _dirty = true;
    }

    function setPtt(active as Boolean) as Void {
        ptt = active;
        _pttAt = System.getTimer();
        send(Proto.ptt(active), 3);
        showToast(active ? "Phone mic ON" : "Phone mic off", 3000);
        _dirty = true;
    }

    //! Queue a message. One transmit is in flight at a time; failures are
    //! retried every 2 s (onTick) while tries remain.
    private function send(msg as Proto.Msg, tries as Number) as Void {
        // A newer ptt/sos supersedes a queued one of the same kind.
        var kind = msg.get("kind") as String;
        if ("ptt".equals(kind) || "sos".equals(kind)) {
            for (var i = _queue.size() - 1; i >= 1; i--) { // [0] may be in flight
                if (kind.equals(_queue[i].get("kind"))) {
                    _queue.remove(_queue[i]);
                    _tries = _tries.slice(0, i).addAll(_tries.slice(i + 1, null));
                }
            }
        }
        if (_queue.size() >= 8) {
            // Drop the oldest message that is not in flight.
            _queue.remove(_queue[1]);
            _tries = [_tries[0]].addAll(_tries.slice(2, null));
        }
        _queue.add(msg);
        _tries.add(tries);
        pump();
    }

    private function pump() as Void {
        if (_busy || _queue.size() == 0) {
            return;
        }
        _busy = true;
        _busyAt = System.getTimer();
        _txSeq++;
        try {
            Communications.transmit(_queue[0], null, new TxListener(_txSeq));
        } catch (e) {
            onTxDone(false);
        }
    }

    private function dropHead() as Void {
        _queue = _queue.slice(1, null);
        _tries = _tries.slice(1, null);
    }

    //! Called by TxListener; drops answers for a transmit already abandoned.
    function onTxResult(seq as Number, ok as Boolean) as Void {
        if (seq == _txSeq && _busy) {
            onTxDone(ok);
        }
    }

    private function onTxDone(ok as Boolean) as Void {
        _busy = false;
        if (_queue.size() == 0) {
            return;
        }
        var msg = _queue[0];
        var kind = msg.get("kind") as String;
        if (ok) {
            dropHead();
            txFailed = false;
            if ("text".equals(kind)) {
                showToast("Sent: " + msg.get("text"), 4000);
            }
            pump();
        } else {
            var left = _tries[0] - 1;
            if (left <= 0) {
                dropHead();
                if (!"hello".equals(kind)) {
                    txFailed = true;
                    showToast("Not sent - phone unreachable", 6000);
                    buzz(VIBE_TALK);
                }
                pump();
            } else {
                _tries[0] = left; // retried by onTick
            }
        }
        _dirty = true;
        WatchUi.requestUpdate();
    }

    // =====================================================================
    // Periodic work (1 Hz)
    // =====================================================================

    function onTick() as Void {
        _tick++;
        var now = System.getTimer();

        var ok = System.getDeviceSettings().phoneConnected;
        if (ok != phoneOk) {
            phoneOk = ok;
            _dirty = true;
            if (ok) {
                sendHello();
            }
        }
        // A transmit whose listener never fires would block the queue for
        // good; after 20 s count it as failed.
        if (_busy && now - _busyAt > 20000) {
            _txSeq++; // a late answer for the abandoned transmit is ignored
            onTxDone(false);
        }
        if (_tick % 2 == 0) {
            pump(); // retry anything that failed
        }

        // Expire "talking" flags.
        var keys = speaking.keys();
        for (var i = 0; i < keys.size(); i++) {
            if (now - (speaking.get(keys[i]) as Number) > 0) {
                speaking.remove(keys[i]);
                _dirty = true;
            }
        }
        var top = topView();
        if (top instanceof MessageView && now - top.shownAt > MESSAGE_SHOW_MS) {
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
        if (toast != null && now - _toastUntil > 0) {
            toast = null;
            _dirty = true;
        }
        if (ptt && now - _pttAt > PTT_MAX_MS) {
            setPtt(false);
            buzz(VIBE_TEXT);
        }
        if (_alarmKey != null && _tick % ALARM_PERIOD_TICKS == 0) {
            _alarmLeft--;
            if (_alarmLeft <= 0) {
                _alarmKey = null;
            } else {
                alarmBuzz();
            }
        }

        updateHeading();
        var moved = false;
        if (headingDeg != _drawnHeading) {
            if (headingDeg == null || _drawnHeading == null) {
                moved = true;
            } else {
                var diff = Ui.norm(headingDeg - _drawnHeading + 180.0) - 180.0;
                moved = diff.abs() >= 4.0;
            }
        }

        // Redraw on change, or every 5 s so ages and staleness stay honest.
        if (_dirty || moved || _tick % 5 == 0) {
            _dirty = false;
            _drawnHeading = headingDeg;
            WatchUi.requestUpdate();
        }
    }

    //! Watch compass, else watch GPS course (only if the system already has a
    //! moving fix; we do not switch the GPS on), else the phone's course over
    //! ground, else north-up.
    function updateHeading() as Void {
        var si = Sensor.getInfo();
        var mag = (si has :heading) ? si.heading : null;
        if (mag != null) {
            headingDeg = Ui.norm(Math.toDegrees(mag).toFloat());
            headingSrc = HEADING_COMPASS;
            return;
        }
        var pi = Position.getInfo();
        var course = pi.heading;
        var speed = pi.speed;
        if (course != null && speed != null && speed > 1.0 && pi.accuracy >= Position.QUALITY_USABLE) {
            headingDeg = Ui.norm(Math.toDegrees(course).toFloat());
            headingSrc = HEADING_GPS;
            return;
        }
        var cog = Proto.num(Proto.get(myPos, "cog"));
        if (cog != null) {
            headingDeg = Ui.norm(cog);
            headingSrc = HEADING_COG;
            return;
        }
        headingDeg = null;
        headingSrc = HEADING_NONE;
    }

    //! Screen angle for a true bearing, or null if unknown.
    function arrowAngle(brg as Float?) as Float? {
        if (brg == null) {
            return null;
        }
        return Ui.norm(headingDeg == null ? brg : brg - headingDeg);
    }

    // =====================================================================
    // Queries used by the views
    // =====================================================================

    function stateAgeMs() as Number? {
        return stateAt == null ? null : System.getTimer() - stateAt;
    }

    function isSpeaking(r as Dictionary) as Boolean {
        if (Proto.flag(r.get("speaking"))) {
            return true;
        }
        var k = Proto.uidKey(r.get("uid"));
        return k != null && speaking.hasKey(k);
    }

    //! SOS from the state flag or from a live SOS event.
    function isSos(r as Dictionary) as Boolean {
        if (Proto.flag(r.get("sos"))) {
            return true;
        }
        var k = Proto.uidKey(r.get("uid"));
        return k != null && sosAlerts.hasKey(k);
    }

    function findRider(key as String) as Dictionary? {
        for (var i = 0; i < riders.size(); i++) {
            if (key.equals(Proto.uidKey(riders[i].get("uid")))) {
                return riders[i];
            }
        }
        return null;
    }

    //! One-line link status, or null when everything is fine.
    function linkProblem() as String? {
        if (!phoneOk) {
            return "No phone link";
        }
        var age = stateAgeMs();
        if (age == null) {
            return "Open ComX on phone";
        }
        if (age > STATE_SILENT_MS) {
            return "Phone silent " + (age / 1000) + "s";
        }
        if (!inChannel) {
            return "Phone not in channel";
        }
        if (txFailed) {
            return "Last send failed";
        }
        return null;
    }

    function headingLabel() as String {
        if (headingSrc == HEADING_COMPASS) {
            return "compass";
        } else if (headingSrc == HEADING_GPS) {
            return "watch GPS";
        } else if (headingSrc == HEADING_COG) {
            return "course";
        }
        return "north-up";
    }

    function alarmActive() as Boolean {
        return _alarmKey != null;
    }

    function silenceAlarm() as Void {
        _alarmKey = null;
        _alarmLeft = 0;
    }

    function showToast(text as String, ms as Number) as Void {
        toast = text;
        _toastUntil = System.getTimer() + ms;
        _dirty = true;
    }

    // =====================================================================
    // Attention
    // =====================================================================

    enum {
        VIBE_TALK,
        VIBE_TEXT,
        VIBE_SOS
    }

    private function buzz(kind as Number) as Void {
        if (!(Attention has :vibrate)) {
            return;
        }
        var p;
        if (kind == VIBE_TALK) {
            p = [new Attention.VibeProfile(60, 200)];
        } else if (kind == VIBE_TEXT) {
            p = [new Attention.VibeProfile(100, 250), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 250)];
        } else {
            p = [new Attention.VibeProfile(100, 600), new Attention.VibeProfile(0, 200),
                 new Attention.VibeProfile(100, 600), new Attention.VibeProfile(0, 200),
                 new Attention.VibeProfile(100, 600)];
        }
        Attention.vibrate(p);
    }

    private function alarmBuzz() as Void {
        buzz(VIBE_SOS);
        if (Attention has :playTone) {
            Attention.playTone(Attention.TONE_ALARM);
        }
    }

    private function light() as Void {
        if (Attention has :backlight) {
            try {
                Attention.backlight(true);
            } catch (e) {
                // BacklightOnTooLongException on some devices: harmless.
            }
        }
    }

    // =====================================================================
    // Pushing alert screens from a message callback
    // =====================================================================

    private function topView() as WatchUi.View? {
        return WatchUi.getCurrentView()[0];
    }

    private function showMessage() as Void {
        var top = topView();
        if (top instanceof MessageView) {
            top.restart();
            WatchUi.requestUpdate();
        } else if (!(top instanceof SosView)) {
            var v = new MessageView();
            WatchUi.pushView(v, new MessageDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
        // Under an SOS screen the message waits; the toast still tells.
        showToast(((lastText as Dictionary).get("from") as String) + ": " + ((lastText as Dictionary).get("label") as String), 10000);
    }

    private function showSos(key as String) as Void {
        var top = topView();
        if (top instanceof SosView) {
            top.setKey(key);
            WatchUi.requestUpdate();
        } else {
            var v = new SosView(key);
            WatchUi.pushView(v, new SosDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
    }
}

class TxListener extends Communications.ConnectionListener {
    private var _seq as Number;

    //! seq < 0: fire and forget.
    function initialize(seq as Number) {
        ConnectionListener.initialize();
        _seq = seq;
    }

    function onComplete() as Void {
        if (_seq >= 0) {
            getApp().onTxResult(_seq, true);
        }
    }

    function onError() as Void {
        if (_seq >= 0) {
            getApp().onTxResult(_seq, false);
        }
    }
}

function getApp() as ComXApp {
    return Application.getApp() as ComXApp;
}
