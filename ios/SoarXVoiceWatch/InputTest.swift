import SwiftUI
import WatchKit

// "Input test" page: logs every input the watch app receives, with counters,
// timestamps and the water lock state at that moment, so the owner can find
// out in the shower / in the water what really works with water lock on and
// off. See docs/watch-ios.md ("Input test").

enum InputKind: String, CaseIterable {
  case crown = "Crown"
  case doubleTap = "Dbl tap"
  case buttonTouch = "Btn touch"
  case tap = "Tap"
  case intent = "Action"
  case wrist = "Wrist"
  case waterLock = "Lock"
}

struct InputEvent: Identifiable {
  let id = UUID()
  let at: Date
  let kind: InputKind
  let detail: String
  /// Water lock state when the input arrived.
  let locked: Bool
}

/// Process-wide log, so inputs that arrive while the page is not on screen
/// (App Intents, wrist raise) are still recorded. Main thread.
final class InputLog: ObservableObject {
  static let shared = InputLog()

  @Published private(set) var events: [InputEvent] = []
  @Published private(set) var counts: [InputKind: Int] = [:]
  @Published private(set) var waterLock = false
  /// True while the Input test page is open: talk inputs are only logged.
  @Published var testMode = false

  private var lockTimer: Timer?
  private let maxEvents = 200

  static let timeFormat: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss.S"
    return f
  }()

  func record(_ kind: InputKind, _ detail: String) {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { self.record(kind, detail) }
      return
    }
    let locked = WKInterfaceDevice.current().isWaterLockEnabled
    counts[kind, default: 0] += 1
    events.insert(InputEvent(at: Date(), kind: kind, detail: detail, locked: locked), at: 0)
    if events.count > maxEvents { events.removeLast(events.count - maxEvents) }
    NSLog("[InputTest] %@ %@ lock=%@", kind.rawValue, detail, locked ? "on" : "off")
  }

  func reset() {
    events.removeAll()
    counts.removeAll()
  }

  /// Water lock has no change notification: poll it while the page is open.
  func startWatchingWaterLock() {
    waterLock = WKInterfaceDevice.current().isWaterLockEnabled
    lockTimer?.invalidate()
    lockTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      let now = WKInterfaceDevice.current().isWaterLockEnabled
      if now != self.waterLock {
        self.waterLock = now
        self.record(.waterLock, now ? "turned ON" : "turned OFF")
      }
    }
  }

  func stopWatchingWaterLock() {
    lockTimer?.invalidate()
    lockTimer = nil
  }
}

struct InputTestView: View {
  @ObservedObject private var log = InputLog.shared
  @State private var crown: Double = 0
  @State private var crownStep = 0
  @FocusState private var crownFocused: Bool
  @State private var lastTouchAt: Date = .distantPast

  private let columns = [GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2),
                         GridItem(.flexible(), spacing: 2)]
  private let counted: [InputKind] = [.crown, .doubleTap, .buttonTouch, .tap, .intent, .wrist]

  var body: some View {
    VStack(spacing: 3) {
      HStack(spacing: 4) {
        Image(systemName: log.waterLock ? "drop.fill" : "drop")
          .foregroundStyle(log.waterLock ? .cyan : .gray)
        Text(log.waterLock ? "Lock ON" : "Lock off")
          .font(.system(size: 15, weight: .heavy))
        Spacer(minLength: 0)
        Button("Lock") {
          log.record(.waterLock, "enable requested")
          WKInterfaceDevice.current().enableWaterLock()
        }
        .font(.system(size: 14, weight: .bold))
        .frame(width: 64, height: 30)
        .tint(.cyan)
      }

      LazyVGrid(columns: columns, spacing: 1) {
        ForEach(counted, id: \.self) { kind in
          Text("\(kind.rawValue) \(log.counts[kind] ?? 0)")
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
      }
      .onLongPressGesture(minimumDuration: 1) { log.reset() }

      Button(action: primaryAction) {
        Text("Double-tap / tap")
          .font(.system(size: 15, weight: .bold))
          .frame(maxWidth: .infinity, minHeight: 34)
      }
      .tint(.blue)
      .simultaneousGesture(TapGesture().onEnded { lastTouchAt = Date() })
      .primaryActionShortcut()

      VStack(alignment: .leading, spacing: 0) {
        ForEach(log.events.prefix(5)) { e in
          HStack(spacing: 3) {
            Text(InputLog.timeFormat.string(from: e.at))
              .foregroundStyle(.secondary)
            if e.locked { Image(systemName: "drop.fill").foregroundStyle(.cyan) }
            Text("\(e.kind.rawValue) \(e.detail)")
              .lineLimit(1)
          }
          .font(.system(size: 11, design: .monospaced))
          .minimumScaleFactor(0.6)
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .padding(.horizontal, 2)
    .contentShape(Rectangle())
    .onTapGesture { log.record(.tap, "screen") }
    // A ScrollView would take the crown; this page owns it instead.
    .focusable()
    .focused($crownFocused)
    .digitalCrownRotation($crown, from: -1_000_000, through: 1_000_000, by: 1,
                          sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
    .onChange(of: crown) { _, value in
      let step = Int(value.rounded())
      guard step != crownStep else { return }
      log.record(.crown, step > crownStep ? "+1 (\(step))" : "-1 (\(step))")
      crownStep = step
    }
    .navigationTitle("Input test")
    .onAppear {
      log.testMode = true
      log.startWatchingWaterLock()
      crownFocused = true
    }
    .onDisappear {
      log.testMode = false
      log.stopWatchingWaterLock()
    }
  }

  /// The button fires both for a finger tap and for the double-tap hand
  /// gesture. A finger tap also ends the simultaneous TapGesture; the hand
  /// gesture does not, which is how the two are told apart (heuristic).
  private func primaryAction() {
    WKInterfaceDevice.current().play(.click)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
      if Date().timeIntervalSince(lastTouchAt) < 0.6 {
        log.record(.buttonTouch, "finger on button")
      } else {
        log.record(.doubleTap, "no touch: hand gesture")
      }
    }
  }
}
