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
