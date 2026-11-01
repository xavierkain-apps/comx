import CoreLocation
import Foundation
import HealthKit

/// Watch compass. `heading` stays nil on models without a magnetometer.
final class HeadingProvider: NSObject, CLLocationManagerDelegate {
  var onHeading: ((Double) -> Void)?
  private let manager = CLLocationManager()

  static var hasCompass: Bool { CLLocationManager.headingAvailable() }

  /// False while the system prompt may still be on screen.
  var permissionDecided: Bool {
    !HeadingProvider.hasCompass || manager.authorizationStatus != .notDetermined
  }

  func start() {
    guard HeadingProvider.hasCompass else { return }
    manager.delegate = self
    manager.headingFilter = 3
    // True north needs a location fix; magnetic heading works without one.
    manager.requestWhenInUseAuthorization()
    manager.startUpdatingHeading()
  }

  func stop() { manager.stopUpdatingHeading() }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    guard newHeading.headingAccuracy >= 0 else { return }
    let value = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    onHeading?(value)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("[Watch] heading error: \(error)")
  }
}

/// Keeps the app running and frontmost for the whole session (wrist down,
/// screen off, water lock) by running a water-sports workout session. No
/// workout builder is attached, so nothing is saved to Health.
final class WorkoutKeeper: NSObject, HKWorkoutSessionDelegate {
  var onRunning: ((Bool) -> Void)?

  private let store = HKHealthStore()
  private var session: HKWorkoutSession?
  private var starting = false

  var isRunning: Bool { session?.state == .running }

  /// Safe to call at any time: starts a session, resumes a paused one, or
  /// takes back the one the system kept after a crash.
  func start() {
    guard HKHealthStore.isHealthDataAvailable(), !starting else { return }
    if let s = session {
      switch s.state {
      case .running, .prepared:
        return
      case .paused:
        s.resume()
        return
      case .notStarted:
        s.startActivity(with: Date())
        return
      default:
        // Stopped or ended: a new session replaces it.
        s.end()
        session = nil
      }
    }
    starting = true
    store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: nil) { [weak self] _, error in
      if let error = error { InputLog.shared.system("HealthKit authorization: \(error.localizedDescription)") }
      self?.store.recoverActiveWorkoutSession { recovered, _ in
        DispatchQueue.main.async { self?.adopt(recovered) }
      }
    }
  }

  private func adopt(_ recovered: HKWorkoutSession?) {
    starting = false
    if let s = recovered {
      InputLog.shared.system("Workout recovered after a restart")
      s.delegate = self
      session = s
      onRunning?(s.state == .running)
    } else {
      begin()
    }
  }

  private func begin() {
    guard session == nil else { return }
    let config = HKWorkoutConfiguration()
    config.activityType = .surfingSports
    config.locationType = .outdoor
    do {
      let s = try HKWorkoutSession(healthStore: store, configuration: config)
      s.delegate = self
      session = s
      s.startActivity(with: Date())
    } catch {
      InputLog.shared.system("Workout cannot start: \(error.localizedDescription)")
      onRunning?(false)
    }
  }

  func stop() {
    session?.end()
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                      from fromState: HKWorkoutSessionState, date: Date) {
    DispatchQueue.main.async {
      guard workoutSession === self.session else { return }
      InputLog.shared.system("Workout \(fromState.logName) > \(toState.logName)")
      switch toState {
      case .running:
        self.onRunning?(true)
      case .paused:
        // A paused session does not keep the app alive.
        workoutSession.resume()
      case .ended:
        self.session = nil
        self.onRunning?(false)
      default:
        self.onRunning?(false)
      }
    }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    DispatchQueue.main.async {
      guard workoutSession === self.session else { return }
      InputLog.shared.system("Workout failed: \(error.localizedDescription)")
      self.session = nil
      self.onRunning?(false)
    }
  }
}

private extension HKWorkoutSessionState {
  var logName: String {
    switch self {
    case .notStarted: return "not started"
    case .running: return "running"
    case .ended: return "ended"
    case .paused: return "paused"
    case .prepared: return "prepared"
    case .stopped: return "stopped"
    @unknown default: return "unknown"
    }
  }
}
