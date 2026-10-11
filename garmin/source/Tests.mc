// Unit tests, compiled only with `monkeyc -t` and run in the simulator by CI
// (`monkeydo app.prg <device> -t`). They cover the parsing of what the phone
// bridge sends, since that is where Garmin's numeric types bite.

import Toybox.Lang;
import Toybox.Test;

(:test)
function testNumAcceptsEveryNumericType(logger as Test.Logger) as Boolean {
    Test.assertEqual(Proto.num(340), 340.0);
    Test.assertEqual(Proto.num(340l), 340.0);
    Test.assertEqual(Proto.num(45.5f), 45.5);
    Test.assertEqual(Proto.num(45.5d), 45.5);
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
    Test.assertEqual(Proto.uidKey(12345), "12345");
    Test.assertEqual(Proto.uidKey(12345l), "12345");
    Test.assertEqual(Proto.uidKey(12345.0d), "12345");
    // Agora uid above 2^31: arrives as Long (or Double) from the bridge.
    Test.assertEqual(Proto.uidKey(3000000000l), "3000000000");
    Test.assertEqual(Proto.uidKey(3000000000.0d), "3000000000");
    Test.assert(Proto.uidKey(null) == null);
    return true;
}

(:test)
function testGetToleratesNonDictionary(logger as Test.Logger) as Boolean {
    Test.assert(Proto.get(null, "cog") == null);
    Test.assert(Proto.get([1, 2], "cog") == null);
    Test.assertEqual(Proto.num(Proto.get({"cog" => 270}, "cog")), 270.0);
    Test.assert(Proto.get({"cog" => null}, "cog") == null);
    return true;
}

(:test)
function testQuickLabels(logger as Test.Logger) as Boolean {
    Test.assertEqual(Proto.QUICK_IDS.size(), Proto.QUICK_TEXT.size());
    Test.assertEqual(Proto.quickLabel("back"), "Heading back");
    Test.assertEqual(Proto.quickLabel("help"), "I need help");
    Test.assert(Proto.quickLabel("custom") == null);
    Test.assert(Proto.quickLabel(null) == null);
    return true;
}

(:test)
function testOutgoingMessages(logger as Test.Logger) as Boolean {
    var h = Proto.hello("006-B3943-00", true);
    Test.assertEqual(h.get("v"), 1);
    Test.assertEqual(h.get("kind"), "hello");
    Test.assertEqual(h.get("platform"), "garmin");
    Test.assertEqual(h.get("model"), "006-B3943-00");
    Test.assertEqual(h.get("hasCompass"), true);

    var t = Proto.text("wait", "Wait for me");
    Test.assertEqual(t.get("kind"), "text");
    Test.assertEqual(t.get("id"), "wait");
    Test.assertEqual(t.get("text"), "Wait for me");

    Test.assertEqual(Proto.sos(true).get("active"), true);
    Test.assertEqual(Proto.sos(false).get("kind"), "sos");
    Test.assertEqual(Proto.ptt(false).get("active"), false);
    Test.assertEqual(Proto.ptt(true).get("kind"), "ptt");
    return true;
}

(:test)
function testFmtDist(logger as Test.Logger) as Boolean {
    Test.assertEqual(Ui.fmtDist(null), "--");
    Test.assertEqual(Ui.fmtDist(0.0), "0 m");
    Test.assertEqual(Ui.fmtDist(340.7), "340 m");
    Test.assertEqual(Ui.fmtDist(1234.0), "1.2 km");
    Test.assertEqual(Ui.fmtDist(12500.0), "12 km");
    return true;
}

(:test)
function testNorm(logger as Test.Logger) as Boolean {
    Test.assertEqual(Ui.norm(0.0), 0.0);
    Test.assertEqual(Ui.norm(360.0), 0.0);
    Test.assertEqual(Ui.norm(-90.0), 270.0);
    Test.assertEqual(Ui.norm(725.0), 5.0);
    // Arrow angle = brg - heading: rider at 45 deg, rider facing 270 deg.
    Test.assertEqual(Ui.norm(45.0 - 270.0), 135.0);
    return true;
}
