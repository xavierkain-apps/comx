// Unit tests, compiled only with `monkeyc -t` and run in the simulator by CI
// (`monkeydo app.prg <device> -t`). They cover the parsing of what the phone
// bridge sends, since that is where Garmin's numeric types bite.

import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

//! Equality that accepts null on either side (strict typing forbids passing
//! a nullable value to Test.assertEqual). Not annotated (:test) on purpose:
//! the runner would try to call it as a test.
function eq(actual as Object?, expected as Object?) as Void {
    var same = actual == null ? expected == null : actual.equals(expected);
    if (!same) {
        System.println("MISMATCH expected " + expected + ", got " + actual);
    }
    Test.assert(same);
}

(:test)
function testNumAcceptsEveryNumericType(logger as Test.Logger) as Boolean {
    eq(Proto.num(340), 340.0);
    eq(Proto.num(340l), 340.0);
    eq(Proto.num(45.5f), 45.5);
    eq(Proto.num(45.5d), 45.5);
    Test.assert(Proto.num(null) == null);
    Test.assert(Proto.num("12") == null);
    Test.assert(Proto.num(true) == null);
    return true;
}

(:test)
function testFlag(logger as Test.Logger) as Boolean {
    Test.assert(Proto.flag(true));
    Test.assert(!Proto.flag(false));
    Test.assert(Proto.flag(1));
    Test.assert(!Proto.flag(0));
    Test.assert(!Proto.flag(null));
    Test.assert(!Proto.flag("true"));
    return true;
}

(:test)
function testUidKeyIsStableAcrossTypes(logger as Test.Logger) as Boolean {
    eq(Proto.uidKey(12345), "12345");
    eq(Proto.uidKey(12345l), "12345");
    eq(Proto.uidKey(12345.0d), "12345");
    // Agora uid above 2^31: arrives as Long (or Double) from the bridge.
    eq(Proto.uidKey(3000000000l), "3000000000");
    eq(Proto.uidKey(3000000000.0d), "3000000000");
    Test.assert(Proto.uidKey(null) == null);
    return true;
}

(:test)
function testGetToleratesNonDictionary(logger as Test.Logger) as Boolean {
    Test.assert(Proto.get(null, "cog") == null);
    Test.assert(Proto.get([1, 2], "cog") == null);
    eq(Proto.num(Proto.get({"cog" => 270}, "cog")), 270.0);
    Test.assert(Proto.get({"cog" => null}, "cog") == null);
    return true;
}

(:test)
function testQuickLabels(logger as Test.Logger) as Boolean {
    eq(Proto.QUICK_IDS.size(), Proto.QUICK_TEXT.size());
    eq(Proto.quickLabel("back"), "Heading back");
    eq(Proto.quickLabel("help"), "I need help");
    Test.assert(Proto.quickLabel("custom") == null);
    Test.assert(Proto.quickLabel(null) == null);
    return true;
}

(:test)
function testOutgoingMessages(logger as Test.Logger) as Boolean {
    var h = Proto.hello("006-B3943-00", true);
    eq(h.get("v"), 1);
    eq(h.get("kind"), "hello");
    eq(h.get("platform"), "garmin");
    eq(h.get("model"), "006-B3943-00");
    eq(h.get("hasCompass"), true);

    var t = Proto.text("wait", "Wait for me");
    eq(t.get("kind"), "text");
    eq(t.get("id"), "wait");
    eq(t.get("text"), "Wait for me");

    eq(Proto.sos(true).get("active"), true);
    eq(Proto.sos(false).get("kind"), "sos");
    eq(Proto.ptt(false).get("active"), false);
    eq(Proto.ptt(true).get("kind"), "ptt");
    return true;
}

(:test)
function testFmtDist(logger as Test.Logger) as Boolean {
    eq(Ui.fmtDist(null), "--");
    eq(Ui.fmtDist(0.0), "0 m");
    eq(Ui.fmtDist(340.7), "340 m");
    eq(Ui.fmtDist(1234.0), "1.2 km");
    eq(Ui.fmtDist(12500.0), "12 km");
    return true;
}

(:test)
function testNorm(logger as Test.Logger) as Boolean {
    eq(Ui.norm(0.0), 0.0);
    eq(Ui.norm(360.0), 0.0);
    eq(Ui.norm(-90.0), 270.0);
    eq(Ui.norm(725.0), 5.0);
    // Arrow angle = brg - heading: rider at 45 deg, rider facing 270 deg.
    eq(Ui.norm(45.0 - 270.0), 135.0);
    return true;
}
