// Views and input delegates.
//
// Navigation (5-button watches; touch watches map swipe/tap to the same
// behaviours):
//   List   UP/DOWN move, START selects (rider -> compass, last row -> menu),
//          MENU (hold UP) -> menu, BACK exits.
//   Menu   Talk via phone (toggle), Quick message, SOS / Cancel my SOS.
//   Compass  UP/DOWN next rider, START -> menu, BACK -> list.
//   Message / SOS alert  START or BACK dismisses (SOS: START only silences).

import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

// =========================================================================
// Rider list
// =========================================================================

class ListView extends WatchUi.View {
    var sel as Number = 0;
    private var _selKey as String? = null; // keeps the selection on a rider when the order changes

    function initialize() {
        View.initialize();
    }

    //! Number of rows: one per rider plus the "Menu" row.
    function rowCount() as Number {
        return getApp().riders.size() + 1;
    }

    function move(delta as Number) as Void {
        var n = rowCount();
        sel = (sel + delta + n) % n;
        _selKey = keyAt(sel);
        WatchUi.requestUpdate();
    }

    //! Rider key at a row, or null for the menu row.
    function keyAt(i as Number) as String? {
        var riders = getApp().riders;
        if (i < riders.size()) {
            return Proto.uidKey(riders[i].get("uid"));
        }
        return null;
    }

    //! Re-anchor the selection on the same rider after a new state.
    private function resync() as Void {
        var riders = getApp().riders;
        if (_selKey != null) {
            for (var i = 0; i < riders.size(); i++) {
                if (_selKey.equals(Proto.uidKey(riders[i].get("uid")))) {
                    sel = i;
                    return;
                }
            }
        }
        if (sel >= rowCount()) {
            sel = rowCount() - 1;
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
                var ch = app.channel != null ? app.channel : "SoarX";
                dc.drawText(cx, top, Graphics.FONT_XTINY, ch, Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        // ---- rows: selected row centred, one above and one below ----
        var rowH = h / 5;
        var n = rowCount();
        if (n == 1) {
            dc.setColor(Ui.staleColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 - rowH, Graphics.FONT_SMALL, "No riders", Graphics.TEXT_JUSTIFY_CENTER);
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

        var riders = app.riders;
        var isSos = false;
        if (i < riders.size()) {
            isSos = app.isSos(riders[i]);
        }

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

        if (i >= riders.size()) {
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, ty, font, "Menu", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var r = riders[i];
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

class ListDelegate extends WatchUi.BehaviorDelegate {
    private var _view as ListView;

    function initialize(view as ListView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage() as Boolean {
        _view.move(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.move(-1);
        return true;
    }

    function onSelect() as Boolean {
        var key = _view.keyAt(_view.sel);
        if (key == null) {
            openActions();
        } else {
            var v = new CompassView(key);
            WatchUi.pushView(v, new CompassDelegate(v), WatchUi.SLIDE_LEFT);
        }
        return true;
    }

    function onMenu() as Boolean {
        openActions();
        return true;
    }
}

// =========================================================================
// Actions menu
// =========================================================================

function openActions() as Void {
    var menu = new WatchUi.Menu2({:title => "SoarX"});
    var app = getApp();
    menu.addItem(new WatchUi.MenuItem("Talk via phone", app.ptt ? "Phone mic ON" : "Phone mic off", :ptt, null));
    menu.addItem(new WatchUi.MenuItem("Quick message", null, :quick, null));
    menu.addItem(new WatchUi.MenuItem(app.mySos ? "Cancel my SOS" : "SOS", app.mySos ? "SOS is active" : null, :sos, null));
    WatchUi.pushView(menu, new ActionsDelegate(), WatchUi.SLIDE_UP);
}

class ActionsDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var app = getApp();
        var id = item.getId();
        if (id == :ptt) {
            app.setPtt(!app.ptt);
            item.setSubLabel(app.ptt ? "Phone mic ON" : "Phone mic off");
            WatchUi.requestUpdate();
        } else if (id == :quick) {
            var m = new WatchUi.Menu2({:title => "Message"});
            for (var i = 0; i < Proto.QUICK_IDS.size(); i++) {
                m.addItem(new WatchUi.MenuItem(Proto.QUICK_TEXT[i], null, i, null));
            }
            WatchUi.pushView(m, new QuickDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :sos) {
            var c = new WatchUi.Confirmation(app.mySos ? "Cancel your SOS?" : "Send SOS to all riders?");
            WatchUi.pushView(c, new SosConfirmDelegate(!app.mySos, item), WatchUi.SLIDE_IMMEDIATE);
        }
    }

    function onBack() as Void {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class QuickDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        getApp().sendQuick(item.getId() as Number);
        // Back to the list: pop this menu and the actions menu.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }

    function onBack() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

class SosConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _raise as Boolean;
    private var _item as WatchUi.MenuItem;

    function initialize(raise as Boolean, item as WatchUi.MenuItem) {
        ConfirmationDelegate.initialize();
        _raise = raise;
        _item = item;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            getApp().setMySos(_raise);
            _item.setLabel(_raise ? "Cancel my SOS" : "SOS");
            _item.setSubLabel(_raise ? "SOS is active" : null);
        }
        return true;
    }
}

// =========================================================================
// Big compass towards one rider
// =========================================================================

class CompassView extends WatchUi.View {
    var key as String;

    function initialize(k as String) {
        View.initialize();
        key = k;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var app = getApp();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;
        var r = app.findRider(key);
        var alert = app.sosAlerts.get(key);
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
            name = "Rider gone";
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

        var foot = app.linkProblem();
        if (foot == null) {
            foot = app.toast != null ? app.toast : app.headingLabel();
        }
        var xf = dc.getFontHeight(Graphics.FONT_XTINY);
        var fy = h - h / 10 - xf;
        Ui.drawWrapped(dc, cx, fy - xf / 2, Ui.halfWidthAt(dc, fy) * 2, xf * 2, foot as String, Graphics.FONT_XTINY,
            isSos ? fg : Ui.staleColor());
    }
}

class CompassDelegate extends WatchUi.BehaviorDelegate {
    private var _view as CompassView;

    function initialize(view as CompassView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    private function step(delta as Number) as Void {
        var riders = getApp().riders;
        var n = riders.size();
        if (n == 0) {
            return;
        }
        var idx = -1;
        for (var i = 0; i < n; i++) {
            if (_view.key.equals(Proto.uidKey(riders[i].get("uid")))) {
                idx = i;
                break;
            }
        }
        idx = idx < 0 ? 0 : (idx + delta + n) % n;
        var k = Proto.uidKey(riders[idx].get("uid"));
        if (k != null) {
            _view.key = k;
        }
        WatchUi.requestUpdate();
    }

    function onNextPage() as Boolean {
        step(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        step(-1);
        return true;
    }

    function onSelect() as Boolean {
        openActions();
        return true;
    }

    function onMenu() as Boolean {
        openActions();
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
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

class MessageDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
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

class SosDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! First press silences, the next one closes (the rider stays red in the list).
    function onSelect() as Boolean {
        var app = getApp();
        if (app.alarmActive()) {
            app.silenceAlarm();
            WatchUi.requestUpdate();
        } else {
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
        return true;
    }

    function onBack() as Boolean {
        getApp().silenceAlarm();
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }

    function onMenu() as Boolean {
        openActions();
        return true;
    }
}
