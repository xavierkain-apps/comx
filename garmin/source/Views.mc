// Views and their button delegates (all delegates extend ButtonDelegate,
// source/Input.mc: buttons only, taps ignored).
//
//   Compass (start screen)  one rider big: arrow, distance, name.
//       UP / DOWN  previous / next rider (short buzz)
//       START      actions menu            MENU (hold UP)  actions menu
//       hold START (1.5 s)  SOS / cancel my SOS, then a confirmation
//       BACK       exit confirmation
//   Actions  Quick message, Talk via phone, All riders, Heading cue, SOS.
//       UP/DOWN move, START chooses, BACK closes.
//   All riders  list sorted SOS first then by distance; START focuses the
//       compass on that rider, BACK returns.
//   Confirmation  START = yes, BACK = no; unanswered for 15 s = no.
//   Message / SOS alert  START or BACK dismisses (SOS: START first silences).

import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

// =========================================================================
// Big compass towards one rider (start screen, and the SOS alert)
// =========================================================================

class CompassView extends WatchUi.View {
    var key as String?;
    private var _follow as Boolean; // true: always show the app's focused rider

    //! k == null: follow the focus rule (start screen); else a fixed rider.
    function initialize(k as String?) {
        View.initialize();
        key = k;
        _follow = k == null;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var app = getApp();
        if (_follow) {
            key = app.focusKey();
        }
        var k = key;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;
        var r = k != null ? app.findRider(k) : null;
        var alert = k != null ? app.sosAlerts.get(k) : null;
        var isSos = (r != null && app.isSos(r)) || alert != null;

        var bg = isSos ? Ui.sosBg() : Graphics.COLOR_BLACK;
        var fg = isSos ? Ui.sosFg() : Ui.fg();
        dc.setColor(fg, bg);
        dc.clear();

        var name = null;
        var dist = null;
        var brg = null;
        var stale = false;
        if (r != null) {
            name = Proto.str(r.get("name"));
            dist = Proto.num(r.get("dist"));
            brg = Proto.num(r.get("brg"));
            stale = Proto.flag(r.get("stale"));
        }
        if (alert != null) {
            if (name == null) {
                name = alert.get("from") as String?;
            }
            if (brg == null) {
                brg = alert.get("brg") as Float?;
                dist = alert.get("dist") as Float?;
            }
        }
        if (name == null) {
            name = k == null ? "No riders" : "Rider gone";
        }

        var fh = dc.getFontHeight(Graphics.FONT_SMALL);
        var title = isSos ? "SOS " + name : name;
        Ui.drawWrapped(dc, cx, h / 10, Ui.halfWidthAt(dc, h / 10 + fh / 2) * 2, fh, title, Graphics.FONT_SMALL,
            app.isSpeaking(r != null ? r : {}) && !isSos ? Ui.talkColor() : fg);

        // North tick on the rim when the heading is known.
        var heading = app.headingDeg;
        var ring = (h < w ? h : w) * 3 / 10;
        if (heading != null) {
            var a = Math.toRadians(Ui.norm(-heading));
            var nx = cx + (ring + fh / 2) * Math.sin(a);
            var ny = cy - (ring + fh / 2) * Math.cos(a);
            dc.setColor(isSos ? fg : Ui.warnColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(nx, ny, Graphics.FONT_XTINY, "N", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var color = (stale && !isSos) ? Ui.staleColor() : fg;
        var angle = app.arrowAngle(brg);
        if (angle == null) {
            Ui.drawNoBearing(dc, cx, cy, ring * 3 / 4, color);
        } else {
            Ui.drawArrow(dc, cx, cy, ring * 3 / 4, angle, color);
        }

        var bottom = Ui.fmtDist(dist);
        if (stale) {
            bottom = bottom + " (old)";
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var df = Graphics.FONT_MEDIUM;
        dc.drawText(cx, cy + ring - dc.getFontHeight(df) / 4 + 4, df, bottom, Graphics.TEXT_JUSTIFY_CENTER);

        // Footer: own SOS, else link problem, else toast, else phone mic,
        // else heading source and the rider's position in the list.
        var foot = null;
        var footColor = isSos ? fg : Ui.staleColor();
        if (app.mySos && !isSos) {
            foot = "MY SOS ON";
            footColor = Ui.warnColor();
        }
        if (foot == null) {
            foot = app.linkProblem();
        }
        if (foot == null) {
            foot = app.toast;
        }
        if (foot == null && app.ptt) {
            foot = "PHONE MIC ON";
            footColor = isSos ? fg : Ui.talkColor();
        }
        if (foot == null) {
            var hl = app.headingLabel();
            if (_follow && k != null) {
                var keys = app.riderKeys();
                var i = keys.indexOf(k);
                if (i >= 0) {
                    hl = hl + "  " + (i + 1).toString() + "/" + keys.size().toString();
                }
            }
            foot = hl;
        }
        var xf = dc.getFontHeight(Graphics.FONT_XTINY);
        var fy = h - h / 10 - xf;
        Ui.drawWrapped(dc, cx, fy - xf / 2, Ui.halfWidthAt(dc, fy) * 2, xf * 2, foot as String, Graphics.FONT_XTINY, footColor);
    }
}

class CompassDelegate extends ButtonDelegate {
    function initialize() {
        ButtonDelegate.initialize();
    }

    function onUp() as Void {
        getApp().stepFocus(-1);
    }

    function onDown() as Void {
        getApp().stepFocus(1);
    }

    function onStart() as Void {
        openActions();
    }

    function onMenuKey() as Void {
        openActions();
    }

    function hasLongStart() as Boolean {
        return true;
    }

    //! Hold START: SOS (or cancel my SOS), behind a confirmation.
    function onLongStart() as Void {
        var app = getApp();
        app.buzzShort();
        openConfirm(app.mySos ? CONFIRM_SOS_OFF : CONFIRM_SOS_ON, 1);
    }

    //! BACK never exits straight away: a wave on the button must not close
    //! the app in the water.
    function onBackKey() as Void {
        openConfirm(CONFIRM_EXIT, 1);
    }
}

// =========================================================================
// Button-driven pick list (actions menu, quick messages)
// =========================================================================

class PickView extends WatchUi.View {
    var sel as Number = 0;

    function initialize() {
        View.initialize();
    }

    function title() as String {
        return "";
    }

    function count() as Number {
        return 0;
    }

    function label(i as Number) as String {
        return "";
    }

    function sub(i as Number) as String? {
        return null;
    }

    function danger(i as Number) as Boolean {
        return false;
    }

    function pick(i as Number) as Void {
    }

    function move(delta as Number) as Void {
        var n = count();
        if (n > 0) {
            sel = ((sel + delta) % n + n) % n;
            WatchUi.requestUpdate();
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Ui.fg(), Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Ui.staleColor(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h / 10, Graphics.FONT_XTINY, title(), Graphics.TEXT_JUSTIFY_CENTER);

        var rowH = h / 5;
        var n = count();
        for (var k = -1; k <= 1; k++) {
            var i = sel + k;
            if (i < 0 || i >= n) {
                continue;
            }
            drawRow(dc, i, h / 2 + k * rowH - rowH / 2, rowH, k == 0);
        }

        var toast = getApp().toast;
        if (toast != null) {
            var fh = dc.getFontHeight(Graphics.FONT_XTINY);
            var fy = h - h / 10 - fh;
            Ui.drawWrapped(dc, cx, fy - fh / 2, Ui.halfWidthAt(dc, fy) * 2, fh * 2, toast, Graphics.FONT_XTINY, Ui.fg());
        }
    }

    private function drawRow(dc as Graphics.Dc, i as Number, y as Number, rowH as Number, selected as Boolean) as Void {
        var cx = dc.getWidth() / 2;
        var mid = y + rowH / 2;
        var half = Ui.halfWidthAt(dc, mid < dc.getHeight() / 2 ? y : y + rowH);
        if (half < rowH) {
            half = rowH;
        }
        var fg = Ui.fg();
        if (selected) {
            var bg = danger(i) ? Ui.sosBg() : Ui.hiBg();
            dc.setColor(bg, bg);
            dc.fillRectangle(cx - half, y + 2, half * 2, rowH - 4);
            fg = danger(i) ? Ui.sosFg() : Ui.hiFg();
        } else if (danger(i)) {
            fg = Ui.warnColor();
        }

        var font = selected ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL;
        var fh = dc.getFontHeight(font);
        var s = selected ? sub(i) : null;
        var xf = dc.getFontHeight(Graphics.FONT_XTINY);
        var ty = s == null ? mid - fh / 2 : mid - (fh + xf) / 2;
        var fitted = Graphics.fitTextToArea(label(i), font, half * 2 - 8, fh, true);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        if (fitted != null) {
            dc.drawText(cx, ty, font, fitted, Graphics.TEXT_JUSTIFY_CENTER);
        }
        if (s != null) {
            dc.drawText(cx, ty + fh, Graphics.FONT_XTINY, s, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class PickDelegate extends ButtonDelegate {
    private var _view as PickView;

    function initialize(view as PickView) {
        ButtonDelegate.initialize();
        _view = view;
    }

    function onUp() as Void {
        _view.move(-1);
    }

    function onDown() as Void {
        _view.move(1);
    }

    function onStart() as Void {
        _view.pick(_view.sel);
    }

    function onBackKey() as Void {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

// =========================================================================
// Actions menu
// =========================================================================

function openActions() as Void {
    var v = new ActionsView();
    WatchUi.pushView(v, new PickDelegate(v), WatchUi.SLIDE_UP);
}

//! Order matters: SOS is last so START, START from the compass never
//! reaches it.
class ActionsView extends PickView {
    function initialize() {
        PickView.initialize();
    }

    function title() as String {
        return "ComX";
    }

    function count() as Number {
        return 5;
    }

    function label(i as Number) as String {
        if (i == 0) {
            return "Quick message";
        } else if (i == 1) {
            return "Talk via phone";
        } else if (i == 2) {
            return "All riders";
        } else if (i == 3) {
            return "Heading cue";
        }
        return getApp().mySos ? "Cancel my SOS" : "SOS";
    }

    function sub(i as Number) as String? {
        var app = getApp();
        if (i == 1) {
            return app.ptt ? "Phone mic ON" : "Phone mic off";
        } else if (i == 2) {
            return app.riders.size().toString() + " riders";
        } else if (i == 3) {
            return app.cueOn ? "On: buzz when facing" : "Off";
        } else if (i == 4) {
            return app.mySos ? "SOS is active" : "Alert every rider";
        }
        return null;
    }

    function danger(i as Number) as Boolean {
        return i == 4;
    }

    function pick(i as Number) as Void {
        var app = getApp();
        if (i == 0) {
            var q = new QuickView();
            WatchUi.pushView(q, new PickDelegate(q), WatchUi.SLIDE_LEFT);
        } else if (i == 1) {
            app.setPtt(!app.ptt);
            WatchUi.requestUpdate();
        } else if (i == 2) {
            var l = new ListView();
            WatchUi.pushView(l, new ListDelegate(l), WatchUi.SLIDE_LEFT);
        } else if (i == 3) {
            app.setCue(!app.cueOn);
            WatchUi.requestUpdate();
        } else {
            openConfirm(app.mySos ? CONFIRM_SOS_OFF : CONFIRM_SOS_ON, 2);
        }
    }
}

class QuickView extends PickView {
    function initialize() {
        PickView.initialize();
    }

    function title() as String {
        return "Message";
    }

    function count() as Number {
        return Proto.QUICK_IDS.size();
    }

    function label(i as Number) as String {
        return Proto.QUICK_TEXT[i];
    }

    //! Send, then back to the compass (pop this list and the actions menu).
    function pick(i as Number) as Void {
        getApp().sendQuick(i);
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

// =========================================================================
// Confirmation (buttons only): exit, SOS, cancel SOS
// =========================================================================

enum {
    CONFIRM_EXIT,
    CONFIRM_SOS_ON,
    CONFIRM_SOS_OFF
}

//! depth: views to pop on "yes" (1 = just the confirmation; 2 = also the
//! menu it came from). For CONFIRM_EXIT the compass is popped too, which
//! closes the app.
function openConfirm(kind as Number, depth as Number) as Void {
    var v = new ConfirmView(kind, depth);
    WatchUi.pushView(v, new ConfirmDelegate(v), WatchUi.SLIDE_IMMEDIATE);
}

class ConfirmView extends WatchUi.View {
    var kind as Number;
    var depth as Number;
    var shownAt as Number;

    function initialize(k as Number, d as Number) {
        View.initialize();
        kind = k;
        depth = d;
        shownAt = System.getTimer();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var red = kind == CONFIRM_SOS_ON;
        var fg = red ? Ui.sosFg() : Ui.fg();
        dc.setColor(fg, red ? Ui.sosBg() : Graphics.COLOR_BLACK);
        dc.clear();

        var q = "Exit ComX?";
        if (kind == CONFIRM_SOS_ON) {
            q = "Send SOS to all riders?";
        } else if (kind == CONFIRM_SOS_OFF) {
            q = "Cancel your SOS?";
        }
        Ui.drawWrapped(dc, cx, h / 5, Ui.halfWidthAt(dc, h / 5) * 2, h * 3 / 10, q, Graphics.FONT_MEDIUM, fg);

        var fh = dc.getFontHeight(Graphics.FONT_SMALL);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 11 / 20, Graphics.FONT_SMALL, "START: yes", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h * 11 / 20 + fh + 2, Graphics.FONT_SMALL, "BACK: no", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class ConfirmDelegate extends ButtonDelegate {
    private var _view as ConfirmView;

    function initialize(view as ConfirmView) {
        ButtonDelegate.initialize();
        _view = view;
    }

    function onStart() as Void {
        var kind = _view.kind;
        var n = _view.depth;
        if (kind == CONFIRM_EXIT) {
            n = 2; // the confirmation, then the compass: the app closes
        } else {
            getApp().setMySos(kind == CONFIRM_SOS_ON);
        }
        for (var i = 0; i < n; i++) {
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
    }

    function onBackKey() as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }
}

// =========================================================================
// All riders (SOS first, then by distance)
// =========================================================================

class ListView extends WatchUi.View {
    var sel as Number = 0;
    private var _selKey as String? = null; // keeps the selection on a rider when the order changes

    function initialize() {
        View.initialize();
        _selKey = getApp().focusKey();
    }

    function rowCount() as Number {
        return getApp().riders.size();
    }

    function move(delta as Number) as Void {
        var n = rowCount();
        if (n == 0) {
            return;
        }
        sel = ((sel + delta) % n + n) % n;
        _selKey = keyAt(sel);
        WatchUi.requestUpdate();
    }

    //! Rider key at a row, or null.
    function keyAt(i as Number) as String? {
        var riders = getApp().riders;
        if (i >= 0 && i < riders.size()) {
            return Proto.uidKey(riders[i].get("uid"));
        }
        return null;
    }

    //! Re-anchor the selection on the same rider after a new state.
    private function resync() as Void {
        var riders = getApp().riders;
        var sk = _selKey;
        if (sk != null) {
            for (var i = 0; i < riders.size(); i++) {
                if (sk.equals(Proto.uidKey(riders[i].get("uid")))) {
                    sel = i;
                    return;
                }
            }
        }
        if (sel >= rowCount()) {
            sel = rowCount() > 0 ? rowCount() - 1 : 0;
        }
        _selKey = keyAt(sel);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var app = getApp();
        resync();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Ui.fg(), Graphics.COLOR_BLACK);
        dc.clear();

        // ---- header: own SOS, link problem or channel ----
        var top = h / 10;
        var fh = dc.getFontHeight(Graphics.FONT_XTINY);
        if (app.mySos) {
            dc.setColor(Ui.sosBg(), Ui.sosBg());
            dc.fillRectangle(0, 0, w, top + fh + 2);
            dc.setColor(Ui.sosFg(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, top, Graphics.FONT_XTINY, "MY SOS ON", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            var problem = app.linkProblem();
            if (problem != null) {
                dc.setColor(Ui.warnColor(), Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, top, Graphics.FONT_XTINY, problem, Graphics.TEXT_JUSTIFY_CENTER);
            } else {
                dc.setColor(Ui.staleColor(), Graphics.COLOR_TRANSPARENT);
                var ch = app.channel != null ? app.channel : "ComX";
                dc.drawText(cx, top, Graphics.FONT_XTINY, ch, Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        // ---- rows: selected row centred, one above and one below ----
        var rowH = h / 5;
        var n = rowCount();
        if (n == 0) {
            dc.setColor(Ui.staleColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 - dc.getFontHeight(Graphics.FONT_SMALL) / 2, Graphics.FONT_SMALL, "No riders", Graphics.TEXT_JUSTIFY_CENTER);
        }
        for (var k = -1; k <= 1; k++) {
            var i = sel + k;
            if (i < 0 || i >= n) {
                continue;
            }
            var y = h / 2 + k * rowH - rowH / 2;
            drawRow(dc, i, y, rowH, k == 0);
        }

        // ---- footer: toast, else mic state, else heading source ----
        var fy = h - h / 10 - fh;
        if (app.toast != null) {
            Ui.drawWrapped(dc, cx, fy - fh, Ui.halfWidthAt(dc, fy) * 2, fh * 2, app.toast as String, Graphics.FONT_XTINY, Ui.fg());
        } else if (app.ptt) {
            dc.setColor(Ui.talkColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, fy, Graphics.FONT_XTINY, "PHONE MIC ON", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Ui.staleColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, fy, Graphics.FONT_XTINY, app.headingLabel(), Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    private function drawRow(dc as Graphics.Dc, i as Number, y as Number, rowH as Number, selected as Boolean) as Void {
        var app = getApp();
        var riders = app.riders;
        if (i >= riders.size()) {
            return;
        }
        var w = dc.getWidth();
        var cx = w / 2;
        var mid = y + rowH / 2;
        // Usable width is set by the row edge farthest from the screen centre.
        var half = Ui.halfWidthAt(dc, mid < dc.getHeight() / 2 ? y : y + rowH);
        if (half < rowH) {
            half = rowH;
        }
        var left = cx - half;
        var right = cx + half;

        var r = riders[i];
        var isSos = app.isSos(r);
        var fg = Ui.fg();
        if (isSos) {
            dc.setColor(Ui.sosBg(), Ui.sosBg());
            dc.fillRectangle(left, y + 2, right - left, rowH - 4);
            fg = Ui.sosFg();
        } else if (selected) {
            dc.setColor(Ui.hiBg(), Ui.hiBg());
            dc.fillRectangle(left, y + 2, right - left, rowH - 4);
            fg = Ui.hiFg();
        }
        if (isSos && selected) {
            // Selection on a red row: a frame instead of a fill.
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            dc.drawRectangle(left + 1, y + 3, right - left - 2, rowH - 6);
            dc.setPenWidth(1);
        }

        var font = selected ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL;
        var fhh = dc.getFontHeight(font);
        var ty = mid - fhh / 2;

        var stale = Proto.flag(r.get("stale"));
        var talking = app.isSpeaking(r);
        var color = fg;
        if (stale && !isSos && !selected) {
            color = Ui.staleColor();
        }

        // Arrow at the left.
        var ar = rowH * 2 / 7;
        var ax = left + ar + 4;
        var angle = app.arrowAngle(Proto.num(r.get("brg")));
        if (angle == null) {
            Ui.drawNoBearing(dc, ax, mid, ar, color);
        } else {
            Ui.drawArrow(dc, ax, mid, ar, angle, color);
        }

        // Distance at the right.
        var dist = Ui.fmtDist(Proto.num(r.get("dist")));
        if (stale && Ui.isMono()) {
            dist = "~" + dist; // no grey on 1-bit screens
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(right - 4, ty, font, dist, Graphics.TEXT_JUSTIFY_RIGHT);
        var distW = dc.getTextWidthInPixels(dist, font);

        // Name in between, talking marker in front of it.
        var nx = ax + ar + 6;
        if (talking) {
            var tr = fhh / 5;
            dc.setColor((isSos || selected) ? fg : Ui.talkColor(), Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(nx + tr, mid, tr);
            nx += tr * 2 + 4;
        }
        var name = Proto.str(r.get("name"));
        if (name == null) {
            name = "?";
        }
        var room = right - 4 - distW - 6 - nx;
        if (room > 0) {
            var fitted = Graphics.fitTextToArea(name, font, room, fhh, true);
            if (fitted != null) {
                dc.setColor(talking && !isSos && !selected ? Ui.talkColor() : color, Graphics.COLOR_TRANSPARENT);
                dc.drawText(nx, ty, font, fitted, Graphics.TEXT_JUSTIFY_LEFT);
            }
        }
    }
}

class ListDelegate extends ButtonDelegate {
    private var _view as ListView;

    function initialize(view as ListView) {
        ButtonDelegate.initialize();
        _view = view;
    }

    function onUp() as Void {
        _view.move(-1);
    }

    function onDown() as Void {
        _view.move(1);
    }

    //! Focus the compass on this rider and go back to it.
    function onStart() as Void {
        var key = _view.keyAt(_view.sel);
        if (key == null) {
            return;
        }
        getApp().selectRider(key);
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE); // the list
        WatchUi.popView(WatchUi.SLIDE_RIGHT);     // the actions menu
    }
}

// =========================================================================
// Incoming quick message
// =========================================================================

class MessageView extends WatchUi.View {
    var shownAt as Number;

    function initialize() {
        View.initialize();
        shownAt = System.getTimer();
    }

    function restart() as Void {
        shownAt = System.getTimer();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var app = getApp();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Ui.fg(), Graphics.COLOR_BLACK);
        dc.clear();
        var t = app.lastText;
        if (t == null) {
            return;
        }
        var fh = dc.getFontHeight(Graphics.FONT_SMALL);
        var top = h / 6;
        dc.setColor(Ui.talkColor(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, top, Graphics.FONT_SMALL, t.get("from") as String, Graphics.TEXT_JUSTIFY_CENTER);
        var boxTop = top + fh + 4;
        var boxH = h - boxTop - h / 6;
        Ui.drawWrapped(dc, cx, boxTop, Ui.halfWidthAt(dc, h / 2) * 2, boxH, t.get("label") as String, Graphics.FONT_LARGE, Ui.fg());
    }
}

class MessageDelegate extends ButtonDelegate {
    function initialize() {
        ButtonDelegate.initialize();
    }

    function onStart() as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }

    function onBackKey() as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }
}

// =========================================================================
// Incoming SOS: persistent until dismissed or cancelled by the sender
// =========================================================================

class SosView extends CompassView {
    function initialize(k as String) {
        CompassView.initialize(k);
    }

    function setKey(k as String) as Void {
        key = k;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        CompassView.onUpdate(dc);
        var app = getApp();
        if (app.alarmActive()) {
            var h = dc.getHeight();
            var cx = dc.getWidth() / 2;
            var y = h / 10 + dc.getFontHeight(Graphics.FONT_SMALL);
            dc.setColor(Ui.sosFg(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y, Graphics.FONT_XTINY, "START: silence", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class SosDelegate extends ButtonDelegate {
    function initialize() {
        ButtonDelegate.initialize();
    }

    //! First press silences, the next one closes (the compass then stays on
    //! the SOS rider, red, until the phone sends `sos` `active: false`).
    function onStart() as Void {
        var app = getApp();
        if (app.alarmActive()) {
            app.silenceAlarm();
            WatchUi.requestUpdate();
        } else {
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
    }

    function onBackKey() as Void {
        getApp().silenceAlarm();
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }

    function onMenuKey() as Void {
        openActions();
    }
}
