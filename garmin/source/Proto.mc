// Phone <-> watch protocol helpers (docs/watch-companion.md, v: 1).
//
// On the Garmin link the phone bridge converts each JSON payload to a native
// Dictionary / Array. Values arrive with whatever numeric type the phone SDK
// chose (Number, Long, Float or Double), and any field may be missing or
// null, so every read goes through the tolerant accessors below.

import Toybox.Communications;
import Toybox.Lang;

module Proto {

    const VERSION = 1;

    //! A watch -> phone message, as Communications.transmit expects it.
    typedef Msg as Dictionary<Communications.TransmitKeyType, Communications.TransmitType>;

    // Quick messages: fixed ids, English labels (contract table).
    const QUICK_IDS = ["ok", "back", "wait", "where", "gear", "help"] as Array<String>;
    const QUICK_TEXT = ["All good", "Heading back", "Wait for me", "Where are you?", "Gear broken", "I need help"] as Array<String>;

    //! English label for a quick message id, or null when the id is unknown.
    function quickLabel(id as String?) as String? {
        if (id == null) {
            return null;
        }
        for (var i = 0; i < QUICK_IDS.size(); i++) {
            if (QUICK_IDS[i].equals(id)) {
                return QUICK_TEXT[i];
            }
        }
        return null;
    }

    //! Any numeric value as a Float; null for null, missing or non-numeric.
    function num(v as Object?) as Float? {
        if (v instanceof Number || v instanceof Long || v instanceof Float || v instanceof Double) {
            return (v as Numeric).toFloat();
        }
        return null;
    }

    //! Truthy check that accepts Boolean or a non-zero number.
    function flag(v as Object?) as Boolean {
        if (v instanceof Boolean) {
            return v;
        }
        if (v instanceof Number || v instanceof Long) {
            return (v as Number or Long) != 0;
        }
        return false;
    }

    //! String value or null.
    function str(v as Object?) as String? {
        if (v instanceof String) {
            return v;
        }
        return null;
    }

    //! Stable key for a rider uid. Agora uids are unsigned 32-bit, so the
    //! phone may send them as Number or Long; both stringify identically.
    function uidKey(v as Object?) as String? {
        if (v == null) {
            return null;
        }
        if (v instanceof Float || v instanceof Double) {
            return (v as Float or Double).toLong().toString();
        }
        return v.toString() as String;
    }

    //! Dictionary field lookup that tolerates a non-Dictionary container.
    function get(d as Object?, key as String) as Object? {
        if (d instanceof Dictionary) {
            return (d as Dictionary).get(key);
        }
        return null;
    }

    // ---- Watch -> phone messages ----------------------------------------

    function hello(model as String, hasCompass as Boolean) as Msg {
        return {"v" => VERSION, "kind" => "hello", "platform" => "garmin", "model" => model, "hasCompass" => hasCompass};
    }

    function text(id as String, label as String) as Msg {
        return {"v" => VERSION, "kind" => "text", "id" => id, "text" => label};
    }

    function sos(active as Boolean) as Msg {
        return {"v" => VERSION, "kind" => "sos", "active" => active};
    }

    function ptt(active as Boolean) as Msg {
        return {"v" => VERSION, "kind" => "ptt", "active" => active};
    }
}

// Compass focus rule (docs/watch-companion.md, "Compass focus"): the rider
// in SOS first, else the one the user last selected, else the nearest.
module Focus {

    //! keys: rider keys in display order (SOS first, then by distance).
    //! sosKey: first rider in SOS, or null. sel: last selected key, or null.
    //! selAfterSos: the user selected `sel` after the latest SOS started, so
    //! an SOS does not keep yanking the focus back once seen.
    function pick(keys as Array<String>, sosKey as String?, sel as String?, selAfterSos as Boolean) as String? {
        if (sosKey != null && (sel == null || !selAfterSos)) {
            return sosKey;
        }
        if (sel != null && (keys.indexOf(sel) >= 0 || sel.equals(sosKey))) {
            return sel;
        }
        if (keys.size() > 0) {
            return keys[0];
        }
        return sosKey;
    }

    //! Key `delta` steps away from `cur` in `keys`, wrapping; the first key
    //! when `cur` is not in the list; null when the list is empty.
    function step(keys as Array<String>, cur as String?, delta as Number) as String? {
        var n = keys.size();
        if (n == 0) {
            return null;
        }
        var i = cur == null ? -1 : keys.indexOf(cur);
        if (i < 0) {
            return keys[0];
        }
        return keys[((i + delta) % n + n) % n];
    }

    //! True when a bearing lies within `tol` degrees of the heading.
    function aligned(brg as Float, heading as Float, tol as Float) as Boolean {
        var off = Ui.norm(brg - heading + 180.0) - 180.0;
        return off.abs() <= tol;
    }
}
