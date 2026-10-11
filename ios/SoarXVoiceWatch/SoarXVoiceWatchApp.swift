import HealthKit
import SwiftUI
import WatchKit

@main
struct SoarXVoiceWatchApp: App {
  @WKApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
  @StateObject private var model = AppModel.shared

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .onAppear { model.startIfNeeded() }
    }
  }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    AppModel.shared.startIfNeeded()
  }

  func applicationDidBecomeActive() {
    AppModel.shared.sendHello()
  }

  /// Launched to run a workout (Action button, or the system relaunching us).
  func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
    InputLog.shared.record(.intent, "Workout launch (Action button > Workout)")
    AppModel.shared.startIfNeeded()
    AppModel.shared.startSession()
  }
}
