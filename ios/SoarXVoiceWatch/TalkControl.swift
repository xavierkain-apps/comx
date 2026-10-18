import AppIntents
import Foundation

// Talk from a control (watchOS 26+): the Apple Watch Ultra Action button,
// Control Center or the Smart Stack. The control itself lives in the
// SoarXVoiceWatchControls extension; this intent is compiled into both
// targets, and openAppWhenRun makes the system run perform() in the app.
// The App Shortcut route (ToggleTalkIntent on Action button > Shortcut) only
// opened the app on a real watch, perform() never ran.

@available(watchOS 26.0, *)
struct TalkControlIntent: AppIntent {
  static var title: LocalizedStringResource = "Talk"
  static var description = IntentDescription("Start a voice message to your riders, or stop and send it.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    #if !COMX_CONTROLS_EXTENSION
    AppModel.shared.startIfNeeded()
    // On the Input test page the press is only logged.
    if InputLog.shared.testMode {
      InputLog.shared.record(.intent, "TalkControlIntent (logged only)")
      return .result()
    }
    InputLog.shared.record(.intent, "TalkControlIntent")
    AppModel.shared.toggleTalk()
    #endif
    return .result()
  }
}
