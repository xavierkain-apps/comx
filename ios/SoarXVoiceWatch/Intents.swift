import AppIntents
import Foundation

// Hands-off controls.
//
// - StartSessionIntent conforms to StartWorkoutIntent, which makes ComX
//   selectable as the workout app of the Apple Watch Ultra Action button
//   (Settings > Action Button > Workout > ComX). The first press starts
//   the session.
// - ToggleTalkIntent is exposed as an App Shortcut, so it can be put on the
//   Action button through the Shortcuts app (Action Button > Shortcut) and run
//   from Siri / the Smart Stack.
// See docs/watch-ios.md for what has and has not been verified on a device.

enum SessionStyle: String, AppEnum {
  case kitesurf

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Session"
  static var caseDisplayRepresentations: [SessionStyle: DisplayRepresentation] = [
    .kitesurf: "Kitesurf session",
  ]
}

struct StartSessionIntent: StartWorkoutIntent {
  static var title: LocalizedStringResource = "Start ComX session"

  @Parameter(title: "Session")
  var workoutStyle: SessionStyle

  static var suggestedWorkouts: [StartSessionIntent] { [StartSessionIntent()] }

  var displayRepresentation: DisplayRepresentation {
    SessionStyle.caseDisplayRepresentations[workoutStyle] ?? "Session"
  }

  init() {
    workoutStyle = .kitesurf
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    InputLog.shared.record(.intent, "StartSessionIntent")
    AppModel.shared.startIfNeeded()
    AppModel.shared.startSession()
    return .result()
  }
}

struct ToggleTalkIntent: AppIntent {
  static var title: LocalizedStringResource = "Talk to riders"
  static var description = IntentDescription("Start a voice message, or stop and send it.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AppModel.shared.startIfNeeded()
    // On the Input test page the press is only logged.
    if InputLog.shared.testMode {
      InputLog.shared.record(.intent, "ToggleTalkIntent (logged only)")
      return .result()
    }
    InputLog.shared.record(.intent, "ToggleTalkIntent")
    AppModel.shared.toggleTalk()
    return .result()
  }
}

struct SoarXShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ToggleTalkIntent(),
      phrases: ["Talk with \(.applicationName)"],
      shortTitle: "Talk",
      systemImageName: "mic.fill"
    )
  }
}
