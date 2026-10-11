import CoreLocation
import Foundation
import HealthKit

/// Watch compass. `heading` stays nil on models without a magnetometer.
final class HeadingProvider: NSObject, CLLocationManagerDelegate {
  var onHeading: ((Double) -> Void)?
  private let manager = CLLocationManager()

  static var hasCompass: Bool { CLLocationManager.headingAvailable() }

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

  var isRunning: Bool { session?.state == .running }

  func start() {
    guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
    store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: nil) { [weak self] ok, error in
      if let error = error { NSLog("[Watch] HealthKit authorization: \(error)") }
      DispatchQueue.main.async { self?.begin() }
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
      NSLog("[Watch] cannot start workout session: \(error)")
      onRunning?(false)
    }
  }

  func stop() {
    session?.end()
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                      from fromState: HKWorkoutSessionState, date: Date) {
    DispatchQueue.main.async {
      if toState == .ended || toState == .stopped {
        if toState == .ended { self.session = nil }
        self.onRunning?(false)
      } else {
        self.onRunning?(toState == .running)
      }
    }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    NSLog("[Watch] workout session failed: \(error)")
    DispatchQueue.main.async {
      self.session = nil
      self.onRunning?(false)
    }
  }
}
