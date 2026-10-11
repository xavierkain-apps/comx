// Button-first input for every ComX screen.
//
// In the water the touchscreen is useless (wet, water lock) and dangerous
// (a drop of spray is a tap), so every screen is driven by the physical
// buttons through one base delegate:
//
//   UP / DOWN          onUp / onDown   (touch: vertical swipes, harmless)
//   START short        onStart         (acts on release, see below)
//   START held 1.5 s   onLongStart     (only where hasLongStart() is true)
//   BACK               onBackKey
//   MENU (hold UP)     onMenuKey
//   taps, holds, horizontal swipes: swallowed, never an action.
//
// START short vs long: on devices that report onKeyPressed/onKeyReleased,
// START acts on release so a hold can mean something else; a timer fires
// the long action while the button is still down, with a vibration, so the
// rider knows when to let go. Devices that never send onKeyPressed fall
// back to acting on onKey (no long press there; the menu still has SOS).

import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

module Btn {
    const HOLD_MS = 1500;

    //! Set by the first onKeyPressed: from then on START acts on release.
    var pressEvents as Boolean = false;
}

class ButtonDelegate extends WatchUi.InputDelegate {
    private var _downAt as Number? = null; // START pressed on this screen, not yet released
    private var _held as Boolean = false;  // the long action already fired for this press
    private var _timer as Timer.Timer? = null;

    function initialize() {
        InputDelegate.initialize();
    }

    // ---- what screens override ------------------------------------------

    function onUp() as Void {
    }

    function onDown() as Void {
    }

    function onStart() as Void {
    }

    function hasLongStart() as Boolean {
        return false;
    }

    function onLongStart() as Void {
    }

    function onBackKey() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }

    function onMenuKey() as Void {
    }

    // ---- buttons ----------------------------------------------------------

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var k = evt.getKey();
        if (k == WatchUi.KEY_UP) {
            onUp();
        } else if (k == WatchUi.KEY_DOWN) {
            onDown();
        } else if (k == WatchUi.KEY_ENTER) {
            if (!Btn.pressEvents) {
                onStart(); // no press/release events on this device
            }
        } else if (k == WatchUi.KEY_ESC) {
            onBackKey();
        } else if (k == WatchUi.KEY_MENU) {
            onMenuKey();
        } else {
            return false; // LIGHT, LAP...: leave them to the system
        }
        return true;
    }

    function onKeyPressed(evt as WatchUi.KeyEvent) as Boolean {
        if (evt.getKey() != WatchUi.KEY_ENTER) {
            return false;
        }
        Btn.pressEvents = true;
        _downAt = System.getTimer();
        _held = false;
        stopTimer();
        if (hasLongStart()) {
            var t = new Timer.Timer();
            t.start(method(:onHoldTimer), Btn.HOLD_MS, false);
            _timer = t;
        }
        return true;
    }

    function onKeyReleased(evt as WatchUi.KeyEvent) as Boolean {
        if (evt.getKey() != WatchUi.KEY_ENTER) {
            return false;
        }
        stopTimer();
        var down = _downAt;
        _downAt = null;
        // Ignore a release whose press began on another screen (e.g. the
        // hold that opened this one), and a hold that already acted.
        if (down != null && !_held) {
            onStart();
        }
        return true;
    }

    function onHoldTimer() as Void {
        _timer = null;
        if (_downAt == null || _held) {
            return;
        }
        // Only if this screen is still on top (an alert may have covered it).
        var cur = WatchUi.getCurrentView();
        if (cur[1] != self) {
            _downAt = null;
            return;
        }
        _held = true;
        onLongStart();
    }

    private function stopTimer() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }

    // ---- touch: never an action ---------------------------------------------

    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        return true;
    }

    function onHold(evt as WatchUi.ClickEvent) as Boolean {
        return true;
    }

    function onRelease(evt as WatchUi.ClickEvent) as Boolean {
        return true;
    }

    //! Vertical swipes browse (needed on 2-button watches such as Venu);
    //! horizontal ones (right = back on touch watches) are swallowed.
    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        var d = evt.getDirection();
        if (d == WatchUi.SWIPE_UP) {
            onDown();
        } else if (d == WatchUi.SWIPE_DOWN) {
            onUp();
        }
        return true;
    }
}
