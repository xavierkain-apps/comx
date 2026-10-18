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

/// Overview of every rider first, then one rider big (AppModel.compassRider).
/// Crown: overview, then next / previous rider, one vertical page each; while
/// talking, the recipient, one page per talk target. A vertical page TabView takes the
/// crown natively, like the List on the riders page: a .focusable view with
/// .digitalCrownRotation never got it on a real watch (the system took the
/// rotation and went back to the watch face).
/// Double tap (watchOS 11+) or the Action button: talk.
struct CompassView: View {
  @EnvironmentObject var model: AppModel
  /// Page on screen: a rider uid or `overview`; while recording a talk target
  /// (nil = group). The overview page does not exist while recording.
  @State private var page: Int?
  /// Tag of the overview page, never a rider uid.
  static let overview = Int.min

  var body: some View {
    Group {
      if model.isRecording {
        TabView(selection: $page) {
          ForEach(model.talkTargets, id: \.self) { uid in
            CompassPage { TalkTargetPage(uid: uid) }.tag(uid)
          }
        }
        .tabViewStyle(.verticalPage)
      } else if model.riders.isEmpty {
        CompassPage {
          Spacer(minLength: 0)
          Text(model.linkUp ? "No riders yet" : "Waiting for phone")
            .font(.title3)
            .foregroundStyle(.secondary)
          Spacer(minLength: 0)
        }
      } else if let alert = model.sosAlert, let rider = model.rider(alert.uid) {
        // No pages under the SOS alert: their indicator draws over it.
        CompassPage { RiderPage(rider: rider) }
      } else {
        TabView(selection: $page) {
          CompassPage { OverviewPage() }.tag(Optional(CompassView.overview))
          ForEach(model.riders) { rider in
            CompassPage { RiderPage(rider: rider) }.tag(Optional(rider.uid))
          }
        }
        .tabViewStyle(.verticalPage)
      }
    }
    // The model decides who is on screen (an SOS wins); the crown, through
    // the pages, tells the model what the user picked.
    .onAppear { page = shownByModel }
    .onChange(of: model.compassRider?.uid) { _, _ in if !model.isRecording { page = shownByModel } }
    .onChange(of: model.talkTarget) { _, _ in if model.isRecording { page = shownByModel } }
    .onChange(of: model.isRecording) { _, _ in page = shownByModel }
    .onChange(of: page) { _, picked in
      guard picked != shownByModel else { return }
      if model.isRecording {
        model.setTalkTarget(picked)
      } else if picked == CompassView.overview {
        model.showOverview()
      } else if let uid = picked {
        model.select(uid)
      }
    }
  }

  private var shownByModel: Int? {
    model.isRecording ? model.talkTarget : model.compassRider?.uid ?? CompassView.overview
  }
}

/// Every rider on one radar: me in the centre, the top of the screen is the
/// heading the arrows use, the farthest rider on the ring. Distance from the
/// centre is the square root of the distance, so near riders do not sit on
/// me. Thick strokes and few words, for the sun.
struct OverviewPage: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    let placed = model.riders.filter { $0.dist != nil && $0.brg != nil }
    let unplaced = model.riders.filter { $0.dist == nil || $0.brg == nil }
    let farthest = max(placed.compactMap { $0.dist }.max() ?? 0, 50)
    VStack(spacing: 0) {
      GeometryReader { geo in
        let size = min(geo.size.width, geo.size.height)
        let radius = size / 2 - 2
        let centre = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
        ZStack {
          Circle()
            .stroke(Color(white: 0.35), lineWidth: 3)
            .frame(width: radius * 1.8, height: radius * 1.8)
            .position(centre)
          // Ring radius, in the corner so it never covers a rider.
          Text(Format.distance(farthest))
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(Color(white: 0.6))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
          Text("N")
            .font(.system(size: 14, weight: .heavy))
            .foregroundStyle(.red)
            .position(point(centre, radius, angle: -model.heading.0, fraction: 1))
          Image(systemName: "location.north.fill")
            .font(.system(size: 14, weight: .heavy))
            .foregroundStyle(.white)
            .position(centre)
          ForEach(placed) { rider in
            let at = point(centre, radius,
                           angle: model.arrowAngle(bearing: rider.brg) ?? 0,
                           fraction: 0.9 * ((rider.dist ?? 0) / farthest).squareRoot())
            RadarDot(rider: rider).position(at)
          }
        }
      }
      if !unplaced.isEmpty {
        Text(unplaced.map { "\(RadarDot.shortName($0)) ?" }.joined(separator: "  "))
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
    }
  }

  /// `angle` in degrees clockwise from the top of the screen.
  private func point(_ c: CGPoint, _ radius: CGFloat, angle: Double, fraction: Double) -> CGPoint {
    let a = angle * .pi / 180
    let r = radius * CGFloat(fraction)
    return CGPoint(x: c.x + r * CGFloat(sin(a)), y: c.y - r * CGFloat(cos(a)))
  }
}

struct RadarDot: View {
  let rider: Rider

  var body: some View {
    let d: CGFloat = rider.isSOS ? 20 : 14
    // The name sits right of the dot, off the vertical axis where N often is.
    Circle().fill(color).frame(width: d, height: d)
      .overlay(alignment: .leading) {
        Text(RadarDot.shortName(rider))
          .font(.system(size: rider.isSOS ? 15 : 13, weight: .heavy))
          .foregroundStyle(color)
          .fixedSize()
          .alignmentGuide(.leading) { _ in -(d + 2) }
      }
      .opacity(rider.isStale ? 0.4 : 1)
  }

  private var color: Color {
    if rider.isSOS { return .red }
    if rider.isSpeaking { return .yellow }
    return .cyan
  }

  /// First word of the name, at most 4 letters: "Lea (demo)" gives "Lea".
  static func shortName(_ rider: Rider) -> String {
    String((rider.displayName.split(separator: " ").first.map(String.init) ?? rider.displayName).prefix(4))
  }
}

/// A full-screen compass page: vertical pages are as tall as the screen, so
/// the status line and the talk button are part of each page.
struct CompassPage<Content: View>: View {
  @EnvironmentObject var model: AppModel
  @ViewBuilder var content: Content

  var body: some View {
    VStack(spacing: 1) {
      StatusLine()
      content
      if let who = model.speakingLabel, !model.isRecording {
        Text(who)
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(.yellow)
          .lineLimit(1)
      }
      TalkButton()
    }
    .padding(.horizontal, 2)
  }
}

/// One rider: name, arrow, distance.
struct RiderPage: View {
  @EnvironmentObject var model: AppModel
  let rider: Rider

  var body: some View {
    VStack(spacing: 1) {
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
        if let pos = position, pos.1 > 1 {
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
    }
  }

  private var position: (Int, Int)? {
    let list = model.riders
    guard let i = list.firstIndex(where: { $0.uid == rider.uid }) else { return nil }
    return (i + 1, list.count)
  }
}

/// While recording: who the clip goes to (nil = the whole group).
struct TalkTargetPage: View {
  @EnvironmentObject var model: AppModel
  let uid: Int?

  var body: some View {
    let rider = uid.flatMap { model.rider($0) }
    VStack(spacing: 2) {
      Text("To").font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
      Text(uid == nil ? "Group" : rider?.displayName ?? "Rider \(uid!)")
        .font(.system(size: 26, weight: .heavy))
        .foregroundStyle(uid == nil ? .white : .yellow)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      if let rider = rider {
        Text(Format.distance(rider.dist))
          .font(.system(size: 18, weight: .bold, design: .rounded))
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
    .background(Color.red.ignoresSafeArea())
  }
}
