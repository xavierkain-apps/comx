import SwiftUI
import WatchKit

// Designed for kitesurf: wet screen, wind, sun. Black background, very large
// type and targets, high contrast colours, few words.

struct ContentView: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.isLuminanceReduced) private var luminanceReduced
  @State private var page = 0

  var body: some View {
    ZStack(alignment: .top) {
      NavigationStack {
        // Horizontal paging: the Digital Crown stays free for the compass.
        TabView(selection: $page) {
          CompassView().tag(0)
          RidersView(onSelect: { uid in
            model.select(uid)
            page = 0
          }).tag(1)
          MessagesView().tag(2)
        }
        .tabViewStyle(.page)
      }
      if let banner = model.banner {
        BannerView(banner: banner)
          .onTapGesture { model.banner = nil }
          .transition(.move(edge: .top))
      }
      if let alert = model.sosAlert {
        SOSAlertView(alert: alert)
      }
    }
    .animation(.easeInOut(duration: 0.2), value: model.banner)
    // Wrist raise / lower, logged for the Input test page.
    .onChange(of: scenePhase) { _, phase in
      InputLog.shared.record(.wrist, "scene \(phase.label)")
    }
    .onChange(of: luminanceReduced) { _, reduced in
      InputLog.shared.record(.wrist, reduced ? "dimmed (wrist down)" : "bright (wrist up)")
    }
  }
}

private extension ScenePhase {
  var label: String {
    switch self {
    case .active: return "active"
    case .inactive: return "inactive"
    case .background: return "background"
    @unknown default: return "other"
    }
  }
}

// MARK: - Compass (main page)

/// One rider big, chosen without touching (AppModel.focusedRider).
/// Crown: next / previous rider; while talking, the recipient.
/// Double tap (watchOS 11+) or the Action button: talk.
struct CompassView: View {
  @EnvironmentObject var model: AppModel
  @State private var crown: Double = 0
  @State private var crownStep = 0
  @FocusState private var crownFocused: Bool

  var body: some View {
    let rider = model.focusedRider
    VStack(spacing: 1) {
      StatusLine()
      if let rider = rider {
        HStack(spacing: 4) {
          if rider.isSOS {
            Text("SOS").font(.system(size: 16, weight: .heavy)).foregroundStyle(.red)
          }
          Text(rider.displayName)
            .font(.system(size: 20, weight: .heavy))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          if rider.isSpeaking {
            Image(systemName: "waveform").foregroundStyle(.yellow)
          }
          if let pos = model.focusPosition, pos.1 > 1 {
            Text("\(pos.0)/\(pos.1)").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
          }
        }
        DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                       color: rider.isSOS ? .red : .cyan)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(2)
          .opacity(rider.isStale ? 0.4 : 1)
        Text(rider.isStale ? "\(Format.distance(rider.dist)) old" : Format.distance(rider.dist))
          .font(.system(size: 30, weight: .heavy, design: .rounded))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      } else {
        Spacer(minLength: 0)
        Text(model.linkUp ? "No riders yet" : "Waiting for phone")
          .font(.title3)
          .foregroundStyle(.secondary)
        Spacer(minLength: 0)
      }
      if let who = model.speakingLabel, !model.isRecording {
        Text(who)
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(.yellow)
          .lineLimit(1)
      }
      TalkButton()
    }
    .padding(.horizontal, 2)
    .focusable()
    .focused($crownFocused)
    .digitalCrownRotation($crown, from: -1_000_000, through: 1_000_000, by: 1,
                          sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
    .onChange(of: crown) { _, value in
      let step = Int(value.rounded())
      guard step != crownStep else { return }
      model.crownStep(step > crownStep ? 1 : -1)
      crownStep = step
    }
    .onAppear { crownFocused = true }
  }
}

/// Big talk button: group by default; while recording, shows the recipient
/// (crown, or a tap on the label, changes it).
struct TalkButton: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(spacing: 2) {
      if model.isRecording {
        Button { model.cycleTalkTarget(1) } label: {
          Text("To: \(model.talkTargetName)")
            .font(.system(size: 16, weight: .heavy))
            .foregroundStyle(model.talkTarget == nil ? .white : .yellow)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
      }
      Button(action: { model.toggleTalk() }) {
        HStack(spacing: 6) {
          Image(systemName: model.isRecording ? "paperplane.fill" : "mic.fill")
            .font(.system(size: 22, weight: .bold))
          Text(model.isRecording ? "SEND \(Int(AppModel.maxClipSeconds - model.recordingElapsed))" : "TALK")
            .font(.system(size: 22, weight: .heavy))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(Capsule().fill(model.isRecording ? Color.red : Color.blue))
      }
      .buttonStyle(.plain)
      .primaryActionShortcut()
      .accessibilityLabel(model.isRecording ? "Stop and send" : "Talk")
      if model.micDenied {
        Text("Microphone off: allow it in Settings")
          .font(.footnote).foregroundStyle(.orange)
      }
    }
  }
}

private struct PrimaryActionShortcut: ViewModifier {
  func body(content: Content) -> some View {
    if #available(watchOS 11.0, *) {
      // Double tap (Series 9 / Ultra 2 and later) triggers talk.
      content.handGestureShortcut(.primaryAction)
    } else {
      content
    }
  }
}

extension View {
  func primaryActionShortcut() -> some View { modifier(PrimaryActionShortcut()) }
}

struct StatusLine: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    HStack(spacing: 4) {
      Circle()
        .fill(model.channelConnected ? Color.green : (model.linkUp ? Color.orange : Color.red))
        .frame(width: 10, height: 10)
      Text(statusText)
        .font(.system(size: 14, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Spacer(minLength: 0)
      if !model.workoutRunning {
        Image(systemName: "bolt.slash.fill").foregroundStyle(.orange).font(.system(size: 12))
      }
    }
  }

  private var statusText: String {
    if !model.linkUp { return "No phone" }
    if !(model.state?.connected ?? false) { return "Not in channel" }
    return model.state?.channel ?? "Connected"
  }
}

// MARK: - Riders

struct RidersView: View {
  @EnvironmentObject var model: AppModel
  var onSelect: (Int) -> Void = { _ in }

  var body: some View {
    let riders = model.riders
    List {
      HeadingSourceRow()
      if riders.isEmpty {
        Text(model.linkUp ? "No riders yet" : "Waiting for phone")
          .font(.title3)
          .foregroundStyle(.secondary)
      }
      ForEach(riders) { rider in
        Button { onSelect(rider.uid) } label: {
          RiderRow(rider: rider)
        }
        .listRowBackground(rider.isSOS ? Color.red.opacity(0.85) : Color.clear)
      }
    }
    .navigationTitle("Riders")
  }
}

struct HeadingSourceRow: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    let source: String = {
      switch model.heading.1 {
      case .compass: return "Arrows: compass"
      case .course: return "Arrows: your course"
      case .north: return "Arrows: north up"
      }
    }()
    Text(source).font(.footnote).foregroundStyle(.secondary)
  }
}

struct RiderRow: View {
  @EnvironmentObject var model: AppModel
  let rider: Rider

  var body: some View {
    HStack(spacing: 8) {
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS ? .white : .cyan)
        .frame(width: 34, height: 34)
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          Text(rider.displayName)
            .font(.system(size: 18, weight: .bold))
            .lineLimit(1)
          if rider.isSpeaking {
            Image(systemName: "waveform").foregroundStyle(.yellow)
          }
          if rider.isSOS {
            Text("SOS").font(.system(size: 14, weight: .heavy))
          }
        }
        Text(Format.distance(rider.dist))
          .font(.system(size: 22, weight: .heavy, design: .rounded))
      }
    }
    .opacity(rider.isStale ? 0.4 : 1)
  }
}

/// Arrow pointing at `angle` degrees clockwise from the top of the screen.
struct DirectionArrow: View {
  let angle: Double?
  var color: Color = .cyan

  var body: some View {
    if let angle = angle {
      Image(systemName: "location.north.fill")
        .resizable()
        .scaledToFit()
        .foregroundStyle(color)
        .rotationEffect(.degrees(angle))
        .animation(.easeOut(duration: 0.3), value: angle)
    } else {
      Image(systemName: "questionmark.circle")
        .resizable()
        .scaledToFit()
        .foregroundStyle(.gray)
    }
  }
}

// MARK: - Messages and SOS

struct MessagesView: View {
  @EnvironmentObject var model: AppModel
  @State private var confirmSOS = false

  private let columns = [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)]

  var body: some View {
    ScrollView {
      LazyVGrid(columns: columns, spacing: 6) {
        ForEach(QuickMessage.allCases) { m in
          Button { model.send(m) } label: {
            VStack(spacing: 2) {
              Image(systemName: m.symbol).font(.system(size: 20, weight: .bold))
              Text(m.label)
                .font(.system(size: 13, weight: .semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
          }
          .tint(m == .help ? .orange : .blue)
        }
      }

      if model.mySOSActive {
        Button(role: .cancel) { model.setSOS(false) } label: {
          Text("Cancel my SOS").font(.system(size: 18, weight: .heavy))
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .tint(.green)
        .padding(.top, 6)
      } else {
        // Long press, then confirm: a wet screen must not raise an SOS.
        Text("SOS")
          .font(.system(size: 26, weight: .heavy))
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity, minHeight: 60)
          .background(RoundedRectangle(cornerRadius: 14).fill(Color.red))
          .onLongPressGesture(minimumDuration: 1.2) {
            WKInterfaceDevice.current().play(.click)
            confirmSOS = true
          }
          .padding(.top, 6)
        Text("Hold to send SOS").font(.footnote).foregroundStyle(.secondary)
      }

      Button {
        WKInterfaceDevice.current().enableWaterLock()
      } label: {
        Label("Water lock", systemImage: "drop.fill")
      }
      .padding(.top, 8)

      NavigationLink {
        InputTestView()
      } label: {
        Label("Input test", systemImage: "hand.tap")
      }

      if model.workoutRunning {
        Button(role: .destructive) { model.endSession() } label: {
          Label("End session", systemImage: "stop.fill")
        }
      } else {
        Button { model.startSession() } label: {
          Label("Start session", systemImage: "play.fill")
        }
      }
    }
    .confirmationDialog("Send SOS to every rider?", isPresented: $confirmSOS) {
      Button("Send SOS", role: .destructive) { model.setSOS(true) }
      Button("Cancel", role: .cancel) {}
    }
  }
}

struct BannerView: View {
  let banner: Banner

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(banner.title).font(.system(size: 14, weight: .bold)).foregroundStyle(.yellow)
      Text(banner.body).font(.system(size: 20, weight: .heavy)).lineLimit(2).minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8)
    .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.15)))
  }
}

struct SOSAlertView: View {
  @EnvironmentObject var model: AppModel
  let alert: SOSAlert

  var body: some View {
    VStack(spacing: 2) {
      Text("SOS \(alert.from)")
        .font(.system(size: 20, weight: .heavy))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      DirectionArrow(angle: model.arrowAngle(bearing: alert.brg), color: .white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(4)
      Text(Format.distance(alert.dist))
        .font(.system(size: 30, weight: .heavy, design: .rounded))
      Button("Dismiss") { model.dismissSOSAlert() }
        .tint(.black)
    }
    .foregroundStyle(.white)
    .padding(6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.red)
    .ignoresSafeArea()
  }
}
