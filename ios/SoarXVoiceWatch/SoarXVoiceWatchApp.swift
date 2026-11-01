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
    InputLog.shared.system("App launched")
    AppModel.shared.startIfNeeded()
  }

  func applicationDidBecomeActive() {
    InputLog.shared.system("App active")
    AppModel.shared.sendHello()
    AppModel.shared.keepSessionAlive()
  }

  func applicationWillResignActive() {
    InputLog.shared.system("App inactive")
  }

  func applicationDidEnterBackground() {
    InputLog.shared.system("App in background, workout \(AppModel.shared.workoutRunning ? "running" : "NOT running")")
  }

  /// Launched to run a workout (Action button, or the system relaunching us).
  func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
    InputLog.shared.record(.intent, "Workout launch (Action button > Workout)")
    AppModel.shared.startIfNeeded()
    AppModel.shared.startSession()
  }
}
