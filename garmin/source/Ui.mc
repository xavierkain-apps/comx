// Shared drawing helpers. Designed for sun and spray: black background,
// large high-contrast text, colour only as a secondary cue (monochrome
// Instinct screens get the same information through shapes and text).

import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.WatchUi;

module Ui {

    // Exactly one of these survives per device (see monkey.jungle).
    (:color)
    function isMono() as Boolean {
        return false;
    }

    (:mono)
    function isMono() as Boolean {
        return true;
    }

    function fg() as Number {
        return Graphics.COLOR_WHITE;
    }

    //! Background of the selected row.
    function hiBg() as Number {
        return isMono() ? Graphics.COLOR_WHITE : Graphics.COLOR_DK_BLUE;
    }

    //! Text drawn on top of hiBg().
    function hiFg() as Number {
        return isMono() ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
    }

    function sosBg() as Number {
        return isMono() ? Graphics.COLOR_WHITE : Graphics.COLOR_RED;
    }

    function sosFg() as Number {
        return isMono() ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
    }

    function talkColor() as Number {
        return isMono() ? Graphics.COLOR_WHITE : Graphics.COLOR_GREEN;
    }

    function staleColor() as Number {
        return isMono() ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY;
    }

    function warnColor() as Number {
        return isMono() ? Graphics.COLOR_WHITE : Graphics.COLOR_ORANGE;
    }

    //! "340 m", "1.2 km", "12 km"; "--" when unknown.
    function fmtDist(d as Float?) as String {
        if (d == null) {
            return "--";
        }
        if (d < 1000.0) {
            return d.toNumber().toString() + " m";
        }
        if (d < 10000.0) {
            return (d / 1000.0).format("%.1f") + " km";
        }
        return (d / 1000.0).toNumber().toString() + " km";
    }

    //! Normalise any angle in degrees to [0, 360).
    function norm(deg as Float) as Float {
        var d = (deg - 360.0 * Math.floor(deg / 360.0)).toFloat();
        return d >= 360.0 ? 0.0 : d;
    }

    //! Filled arrow centred on (cx, cy), pointing `deg` clockwise from
    //! screen-up, with "radius" r (tip to centre).
    function drawArrow(dc as Graphics.Dc, cx as Number, cy as Number, r as Number, deg as Float, color as Number) as Void {
        var a = Math.toRadians(deg);
        var s = Math.sin(a);
        var c = Math.cos(a);
        // Arrow shape in local coordinates (x right, y down, tip up).
        var pts = [[0.0, -1.0], [0.62, 0.8], [0.0, 0.42], [-0.62, 0.8]];
        var out = new [4];
        for (var i = 0; i < 4; i++) {
            var x = pts[i][0] * r;
            var y = pts[i][1] * r;
            out[i] = [cx + (x * c - y * s), cy + (x * s + y * c)];
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(out as Array<Graphics.Point2D>);
    }

    //! Placeholder when the bearing is unknown: an empty ring.
    function drawNoBearing(dc as Graphics.Dc, cx as Number, cy as Number, r as Number, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(r > 20 ? 4 : 2);
        dc.drawCircle(cx, cy, (r * 2) / 3);
        dc.setPenWidth(1);
    }

    //! Draws a centred, word-wrapped block of text inside (w x h) at (cx, top).
    function drawWrapped(dc as Graphics.Dc, cx as Number, top as Number, w as Number, h as Number, text as String, font as Graphics.FontType, color as Number) as Void {
        var fitted = Graphics.fitTextToArea(text, font, w, h, true);
        if (fitted == null) {
            fitted = text;
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, top, font, fitted, Graphics.TEXT_JUSTIFY_CENTER);
    }

    //! Half-width of a round screen's visible area at height y, minus a margin.
    function halfWidthAt(dc as Graphics.Dc, y as Number) as Number {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var r = w / 2;
        var dy = (y - h / 2).abs();
        if (dy >= r) {
            return 0;
        }
        return Math.sqrt(r * r - dy * dy).toNumber() - 4;
    }
}
