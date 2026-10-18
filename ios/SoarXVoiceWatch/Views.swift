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
            .containerBackground(Theme.bg, for: .tabView)
          RidersView(onSelect: { uid in
            model.select(uid)
            page = 0
          }).tag(1)
            .containerBackground(Theme.bg, for: .tabView)
          MessagesView().tag(2)
            .containerBackground(Theme.bg, for: .tabView)
          HistoryView().tag(3)
            .containerBackground(Theme.bg, for: .tabView)
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

/// Overview of every rider first, then one rider big (AppModel.compassRider),
/// both full screen; the talk page is above the overview (crown up or swipe
/// down from it). Crown: overview, then next / previous rider, one page each;
/// while talking, the recipient, one page per talk target.
///
/// The pages are a paged vertical ScrollView, which takes the crown natively
/// in both directions. A .focusable view with .digitalCrownRotation never got
/// the crown on a real watch (the system went back to the watch face), and a
/// vertical page TabView opened on its second page could not be crowned up
/// to the first one until the user had scrolled down once.
/// Double tap (watchOS 11+) or the Action button: talk.
struct CompassView: View {
  @EnvironmentObject var model: AppModel
  /// Page on screen: a rider uid, `overview` or `talk`; while recording a talk
  /// target uid or `group`. There is no overview or talk page while recording.
  @State private var page: Int?
  /// Page ids that are never a rider uid.
  static let overview = Int.min
  static let talk = Int.min + 1
  static let group = Int.min + 2

  var body: some View {
    Group {
      if model.isRecording {
        PagedColumn(page: $page) {
          ForEach(model.talkTargets, id: \.self) { uid in
            CompassPage(talk: .none) { TalkTargetPage(uid: uid) }.page(uid ?? CompassView.group)
          }
        }
      } else if model.riders.isEmpty {
        CompassPage {
          Spacer(minLength: 0)
          Text(model.linkUp ? "No riders yet" : "Waiting for phone")
            .font(.title3)
            .foregroundStyle(.secondary)
          Spacer(minLength: 0)
        }
      } else if let alert = model.sosAlert, let rider = model.rider(alert.uid) {
        // Nothing to scroll under the SOS alert.
        CompassPage(talk: .none) { RiderPage(rider: rider) }
      } else {
        PagedColumn(page: $page) {
          CompassPage(talk: .big) { EmptyView() }.page(CompassView.talk)
          CompassPage(talk: .none, statusOver: true) { OverviewPage() }.page(CompassView.overview)
          ForEach(model.riders) { rider in
            CompassPage(talk: .none) { RiderPage(rider: rider) }.page(rider.uid)
          }
        }
      }
    }
    // The model decides who is on screen (an SOS wins); the crown, through
    // the pages, tells the model what the user picked.
    .onAppear { page = shownByModel }
    .onChange(of: model.riders.isEmpty) { _, _ in page = shownByModel }
    .onChange(of: model.compassRider?.uid) { _, _ in if !model.isRecording { page = shownByModel } }
    .onChange(of: model.talkTarget) { _, _ in if model.isRecording { page = shownByModel } }
    .onChange(of: model.isRecording) { _, _ in page = shownByModel }
    .onChange(of: page) { _, picked in
      // The talk page is a place to go, not a pick: the model keeps its rider.
      guard let picked = picked, picked != shownByModel else { return }
      if model.isRecording {
        model.setTalkTarget(picked == CompassView.group ? nil : picked)
      } else if picked == CompassView.overview {
        model.showOverview()
      } else if picked != CompassView.talk {
        model.select(picked)
      }
    }
  }

  private var shownByModel: Int {
    model.isRecording
      ? model.talkTarget ?? CompassView.group
      : model.compassRider?.uid ?? CompassView.overview
  }
}

/// Full-screen pages stacked vertically, one page per crown or swipe step.
/// `page` is the id (`.page(_:)`) of the page on screen, read and written.
struct PagedColumn<Content: View>: View {
  @Binding var page: Int?
  @ViewBuilder var content: Content

  var body: some View {
    // Pages are the whole screen (the scroll view runs under the clock on
    // watchOS); each page keeps the clock row and the bottom edge free.
    GeometryReader { geo in
      ScrollViewReader { proxy in
        ScrollView(.vertical) {
          LazyVStack(spacing: 0) { content }
            .scrollTargetLayout()
            .environment(\.pageHeight, geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            .environment(\.pageInsets, EdgeInsets(top: geo.safeAreaInsets.top, leading: 0,
                                                    bottom: geo.safeAreaInsets.bottom, trailing: 0))
        }
        .contentMargins(0, for: .scrollContent)
        .ignoresSafeArea()
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $page)
        .scrollIndicators(.visible)
        .onAppear {
          // Before layout, the binding alone does not move the scroll view.
          let wanted = page
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            if let wanted = wanted { proxy.scrollTo(wanted, anchor: .top) }
          }
        }
      }
    }
  }
}

private struct PageHeightKey: EnvironmentKey {
  static let defaultValue: CGFloat? = nil
}

private struct PageInsetsKey: EnvironmentKey {
  static let defaultValue = EdgeInsets()
}

extension EnvironmentValues {
  /// Height of a PagedColumn page: the column's own height.
  var pageHeight: CGFloat? {
    get { self[PageHeightKey.self] }
    set { self[PageHeightKey.self] = newValue }
  }

  /// Space a PagedColumn page leaves free: the clock row and the bottom edge.
  var pageInsets: EdgeInsets {
    get { self[PageInsetsKey.self] }
    set { self[PageInsetsKey.self] = newValue }
  }
}

private struct PageFrame: ViewModifier {
  @Environment(\.pageHeight) private var height
  @Environment(\.pageInsets) private var insets
  let id: Int

  func body(content: Content) -> some View {
    content
      .padding(insets)
      .frame(height: height, alignment: .top)
      .id(id)
  }
}

private extension View {
  /// One page of a PagedColumn: as tall as the column, identified by `id`.
  func page(_ id: Int) -> some View { modifier(PageFrame(id: id)) }
}

/// Every rider on one radar: me in the centre, the top of the screen is the
/// heading the arrows use, the farthest rider at the edge. Each rider is a
/// round badge with initials and the distance under it. Distance from the
/// centre is the square root of the distance, so near riders do not sit on
/// me; badges that would overlap are pushed apart. Thick strokes and few
/// words, for the sun.
struct OverviewPage: View {
  @EnvironmentObject var model: AppModel

  static let badge: CGFloat = 34

  var body: some View {
    let placed = model.riders.filter { $0.dist != nil && $0.brg != nil }
    let unplaced = model.riders.filter { $0.dist == nil || $0.brg == nil }
    let farthest = max(placed.compactMap { $0.dist }.max() ?? 0, 50)
    VStack(spacing: 0) {
      GeometryReader { geo in
        let size = min(geo.size.width, geo.size.height)
        // The farthest badge sits on the edge ring, inside the screen.
        let radius = size / 2 - OverviewPage.badge / 2 - 2
        let centre = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
        let inner = OverviewPage.niceDistance(farthest / 2)
        let spots = OverviewPage.spread(placed.map { rider in
          point(centre, radius, angle: model.arrowAngle(bearing: rider.brg) ?? 0,
                fraction: ((rider.dist ?? 0) / farthest).squareRoot())
        }, centre: centre, radius: radius)
        ZStack {
          ring(centre, radius, label: Format.distance(farthest), lineWidth: 3)
          if inner < farthest {
            ring(centre, radius * CGFloat((inner / farthest).squareRoot()),
                 label: Format.distance(inner), lineWidth: 2)
          }
          Text("N")
            .font(.condensed(15))
            .foregroundStyle(Theme.red)
            .position(point(centre, radius + 10, angle: -model.heading.0, fraction: 1))
          Image(systemName: "location.north.fill")
            .resizable()
            .scaledToFit()
            .frame(width: 14, height: 16)
            .foregroundStyle(Theme.text)
            .position(centre)
          ForEach(Array(placed.enumerated()), id: \.element.uid) { i, rider in
            RiderBadge(rider: rider).position(spots[i])
          }
        }
      }
      if !unplaced.isEmpty {
        Text(unplaced.map { "\(RiderBadge.initials($0)) ?" }.joined(separator: "  "))
          .font(.condensed(13, .bold))
          .foregroundStyle(Theme.textMuted)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
    }
  }

  private func ring(_ c: CGPoint, _ r: CGFloat, label: String, lineWidth: CGFloat) -> some View {
    ZStack {
      Circle()
        .stroke(Theme.ring, lineWidth: lineWidth)
        .frame(width: r * 2, height: r * 2)
        .position(c)
      // Label at the bottom right of the ring, where N rarely is.
      Text(label)
        .font(.condensed(11, .semibold))
        .textCase(.uppercase)
        .foregroundStyle(Theme.textDim)
        .padding(.horizontal, 2)
        .background(Capsule().fill(Theme.bg))
        .position(point(c, r, angle: 135, fraction: 1))
    }
  }

  /// `angle` in degrees clockwise from the top of the screen.
  private func point(_ c: CGPoint, _ radius: CGFloat, angle: Double, fraction: Double) -> CGPoint {
    let a = angle * .pi / 180
    let r = radius * CGFloat(fraction)
    return CGPoint(x: c.x + r * CGFloat(sin(a)), y: c.y - r * CGFloat(cos(a)))
  }

  /// Pushes apart badges closer than a badge (and its distance label), a
  /// few relaxation passes, keeping them inside the outer ring. Riders on the
  /// same bearing are also pushed sideways, or they would only slide along
  /// the ray and out of the ring.
  static func spread(_ points: [CGPoint], centre c: CGPoint, radius: CGFloat) -> [CGPoint] {
    var p = points
    let minGap = badge + 10
    for _ in 0..<20 {
      var moved = false
      for i in p.indices {
        for j in p.indices where j > i {
          let dx = p[j].x - p[i].x, dy = p[j].y - p[i].y
          let d = (dx * dx + dy * dy).squareRoot()
          guard d < minGap else { continue }
          // Away from each other, plus sideways (perpendicular to the ray).
          let mx = (p[i].x + p[j].x) / 2 - c.x, my = (p[i].y + p[j].y) / 2 - c.y
          let m = max((mx * mx + my * my).squareRoot(), 0.01)
          var ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 1
          ux += -my / m * 0.7; uy += mx / m * 0.7
          let u = max((ux * ux + uy * uy).squareRoot(), 0.01)
          let push = (minGap - d) / 2
          p[i].x -= ux / u * push; p[i].y -= uy / u * push
          p[j].x += ux / u * push; p[j].y += uy / u * push
          moved = true
        }
      }
      for i in p.indices {
        let dx = p[i].x - c.x, dy = p[i].y - c.y
        let d = (dx * dx + dy * dy).squareRoot()
        if d > radius { p[i] = CGPoint(x: c.x + dx / d * radius, y: c.y + dy / d * radius) }
      }
      if !moved { break }
    }
    return p
  }

  /// A round ring distance: 1, 2 or 5 times a power of ten, not above `d`.
  static func niceDistance(_ d: Double) -> Double {
    guard d > 0 else { return 0 }
    let base = pow(10, floor(log10(d)))
    for m in [5.0, 2.0, 1.0] where m * base <= d { return m * base }
    return base
  }
}

/// A rider on the radar: a round badge with the initials, the distance under
/// it. Red and bigger in SOS, yellow while speaking, dimmed when stale.
struct RiderBadge: View {
  let rider: Rider

  var body: some View {
    let d: CGFloat = rider.isSOS ? OverviewPage.badge + 6 : OverviewPage.badge
    VStack(spacing: 1) {
      Text(RiderBadge.initials(rider))
        .font(.condensed(rider.isSOS ? 17 : 15))
        .foregroundStyle(rider.isSOS ? Theme.text : Theme.onAccent)
        .minimumScaleFactor(0.6)
        .frame(width: d, height: d)
        .background(Circle().fill(color))
      Text(Format.short(rider.dist))
        .font(.condensed(12, .bold))
        .foregroundStyle(Theme.text)
        .fixedSize()
    }
    // Centre the badge, not the badge + label, on the rider's spot.
    .offset(y: 8)
    .opacity(rider.isStale ? 0.4 : 1)
  }

  private var color: Color {
    if rider.isSOS { return Theme.red }
    if rider.isSpeaking { return Theme.yellow }
    return Theme.teal
  }

  /// "Xavier Kain" gives "XK", "Lea (demo)" gives "L": the first letter of
  /// the first two words, ignoring anything in parentheses.
  static func initials(_ rider: Rider) -> String {
    let name = rider.displayName.replacingOccurrences(of: "\\(.*?\\)", with: "", options: .regularExpression)
    let words = name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" })
    let letters = words.prefix(2).compactMap { $0.first }.map { String($0).uppercased() }
    return letters.isEmpty ? "?" : letters.joined()
  }
}

/// A full-screen compass page: vertical pages are as tall as the screen, so
/// the status line and the talk button, when there is one, are part of each
/// page.
struct CompassPage<Content: View>: View {
  enum Talk { case none, normal, big }

  @EnvironmentObject var model: AppModel
  var talk: Talk = .normal
  /// Status line drawn over the content (the overview radar), not above it.
  var statusOver = false
  @ViewBuilder var content: Content

  var body: some View {
    VStack(spacing: 1) {
      if !statusOver { StatusLine() }
      if talk == .big {
        // The talk page: one huge button, the easiest target with wet fingers.
        VStack(spacing: 10) {
          Text("\(model.state?.channel ?? "ComX") · Group").overline()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          TalkCircle()
          if model.micDenied {
            Text("Microphone off: allow it in Settings").font(.plain(12)).foregroundStyle(Theme.amber)
          }
        }
        .frame(maxHeight: .infinity)
      } else {
        content
          .frame(maxHeight: .infinity)
          .overlay(alignment: .top) { if statusOver { StatusLine() } }
      }
      if let who = model.speakingLabel, !model.isRecording {
        Text(who)
          .font(.condensed(14, .bold))
          .textCase(.uppercase)
          .foregroundStyle(Theme.yellow)
          .lineLimit(1)
      }
      if talk == .normal { TalkButton() }
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
          Text("SOS").font(.condensed(16)).foregroundStyle(Theme.red)
        }
        Text(rider.displayName)
          .font(.condensed(26))
          .textCase(.uppercase)
          .foregroundStyle(rider.isSpeaking ? Theme.yellow : Theme.text)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .accessibilityValue(rider.isSOS ? "SOS" : (rider.isSpeaking ? "speaking" : ""))
        if let pos = position, pos.1 > 1 {
          Text("\(pos.0)/\(pos.1)").font(.condensed(13, .semibold)).foregroundStyle(Theme.textMuted)
        }
      }
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS ? Theme.red : Theme.teal)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(2)
        .opacity(rider.isStale ? 0.4 : 1)
      Text(rider.isStale ? "\(Format.distance(rider.dist)) old" : Format.distance(rider.dist))
        .font(.condensed(40))
        .textCase(.uppercase)
        .foregroundStyle(Theme.text)
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

/// While recording: who the clip goes to (nil = the whole group), over the
/// red send circle. The crown moves to the next recipient page.
struct TalkTargetPage: View {
  @EnvironmentObject var model: AppModel
  let uid: Int?

  var body: some View {
    let rider = uid.flatMap { model.rider($0) }
    VStack(spacing: 10) {
      Text("To \(uid == nil ? "Group" : rider?.displayName ?? "Rider \(uid!)")")
        .overline(uid == nil ? Theme.textMuted : Theme.yellow)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      TalkCircle()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// The big round talk control: teal "TALK" (Action button hint), red
/// "SEND n" while recording. Double tap and the Action button do the same.
struct TalkCircle: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Button(action: { model.toggleTalk() }) {
      VStack(spacing: 2) {
        Text(model.isRecording ? "SEND \(secondsLeft)" : "TALK")
          .font(.condensed(36))
          .tracking(1)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Text(model.isRecording ? "Tap to send" : "Action button")
          .font(.plain(12))
      }
      .foregroundStyle(model.isRecording ? Theme.text : Theme.onAccent)
      .padding(.horizontal, 12)
      .frame(maxWidth: 150, maxHeight: 150)
      .aspectRatio(1, contentMode: .fit)
      .background(Circle().fill(model.isRecording ? Theme.red : Theme.teal))
    }
    .buttonStyle(.plain)
    .primaryActionShortcut()
    .accessibilityLabel(model.isRecording ? "Stop and send" : "Talk")
  }

  private var secondsLeft: Int { max(0, Int(AppModel.maxClipSeconds - model.recordingElapsed)) }
}

/// Idle talk button for pages that show one (no riders yet, waiting for the
/// phone). While recording the pages use TalkCircle instead.
struct TalkButton: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(spacing: 2) {
      Button(action: { model.toggleTalk() }) {
        HStack(spacing: 6) {
          Image(systemName: "mic.fill")
            .font(.condensed(22))
          Text("TALK")
            .font(.condensed(22))
        }
        .foregroundStyle(Theme.onAccent)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(Capsule().fill(Theme.teal))
      }
      .buttonStyle(.plain)
      .primaryActionShortcut()
      .accessibilityLabel("Talk")
      if model.micDenied {
        Text("Microphone off: allow it in Settings")
          .font(.plain(12)).foregroundStyle(Theme.amber)
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
        .fill(dotColor)
        .frame(width: 8, height: 8)
      Text(statusText)
        .font(.condensed(13, .semibold))
        .tracking(2)
        .textCase(.uppercase)
        .foregroundStyle(dotColor)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Spacer(minLength: 0)
      if !model.workoutRunning {
        Image(systemName: "bolt.slash.fill").foregroundStyle(Theme.amber).font(.system(size: 12))
      }
    }
  }

  private var dotColor: Color {
    model.channelConnected ? Theme.teal : (model.linkUp ? Theme.amber : Theme.red)
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
          .font(.condensed(18, .bold))
          .foregroundStyle(Theme.textMuted)
      }
      ForEach(riders) { rider in
        Button { onSelect(rider.uid) } label: {
          RiderRow(rider: rider)
        }
        .listRowBackground(
          RoundedRectangle(cornerRadius: 14)
            .fill(rider.isSOS ? Theme.red : (rider.isSpeaking ? Theme.yellow : Theme.surfaceAlt)))
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
    Text(source).overline().listRowBackground(Color.clear)
  }
}

struct RiderRow: View {
  @EnvironmentObject var model: AppModel
  let rider: Rider

  var body: some View {
    let ink: Color = rider.isSOS ? Theme.text : (rider.isSpeaking ? Theme.onAccent : Theme.text)
    let distText = rider.dist == nil ? "No GPS" : Format.distance(rider.dist)
    let state = rider.isSOS ? ", SOS" : (rider.isSpeaking ? ", speaking" : "")
    HStack(spacing: 8) {
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS || rider.isSpeaking ? ink : Theme.teal)
        .frame(width: 22, height: 24)
      Text(rider.displayName)
        .font(.condensed(20))
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Spacer(minLength: 0)
      if rider.isSOS {
        Text("SOS").font(.condensed(14)).fixedSize()
      }
      Text(distText)
        .font(rider.dist == nil ? .plain(13) : .condensed(22))
        .textCase(rider.dist == nil ? nil : .uppercase)
        .lineLimit(1)
        .fixedSize()
    }
    .foregroundStyle(ink)
    .opacity(!rider.isSOS && (rider.isStale || rider.dist == nil) ? 0.45 : 1)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(rider.displayName)\(state), \(distText)")
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
        .foregroundStyle(color)
    }
  }
}

// MARK: - Messages and SOS

/// The last messages sent and received, newest first. Tap a voice message
/// to hear it again. The list scrolls with the crown.
struct HistoryView: View {
  @EnvironmentObject var model: AppModel

  private static let time: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f
  }()

  var body: some View {
    // The newest voice message gets a highlighted row (the one to replay).
    let newest = model.history.first(where: { $0.isVoice })?.id
    return List {
      Section {
        if model.history.isEmpty {
          Text("No messages yet").font(.plain(13)).foregroundStyle(Theme.textMuted)
            .listRowBackground(Color.clear)
        }
        ForEach(model.history) { item in
          Group {
            if item.isVoice {
              Button { model.replay(item) } label: { row(item) }
                .accessibilityHint("Plays the message again")
            } else {
              row(item)
                .accessibilityElement(children: .combine)
            }
          }
          .listRowBackground(
            RoundedRectangle(cornerRadius: 12)
              .fill(item.id == newest ? Theme.surfaceAlt : Color.clear))
        }
      } header: {
        HStack {
          Text("History").overline()
          Spacer(minLength: 0)
          if let who = model.playingFrom {
            Label(who, systemImage: "speaker.wave.2.fill")
              .font(.condensed(12, .bold))
              .foregroundStyle(Theme.yellow)
              .lineLimit(1)
          }
        }
      }
    }
  }

  private func row(_ item: HistoryItem) -> some View {
    HStack(spacing: 8) {
      // Yellow dot = voice (tap to replay), teal ring = text.
      Group {
        if item.isVoice {
          Circle().fill(Theme.yellow)
        } else {
          Circle().strokeBorder(item.summary == "SOS" ? Theme.red : Theme.teal, lineWidth: 2)
        }
      }
      .frame(width: 26, height: 26)
      VStack(alignment: .leading, spacing: 0) {
        Text("\(item.outgoing ? "To \(item.who)" : item.who) · \(HistoryView.time.string(from: item.at))")
          .font(.condensed(14, .bold))
          .textCase(.uppercase)
          .foregroundStyle(item.isPrivate ? Theme.yellow : Theme.text)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(item.summary)
          .font(.plain(13))
          .foregroundStyle(item.summary == "SOS" ? Theme.red : (item.isVoice ? Theme.textMuted : Theme.text))
          .lineLimit(2)
          .minimumScaleFactor(0.7)
      }
    }
  }
}

private extension HistoryItem {
  var isVoice: Bool {
    if case .voice = kind { return true }
    return false
  }

  var summary: String {
    switch kind {
    case .text(let text): return text
    case .voice(_, let ms):
      guard let ms = ms else { return "Voice message" }
      return "Voice, \(max(1, Int((Double(ms) / 1000).rounded()))) s"
    }
  }
}

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
              Image(systemName: m.symbol).font(.system(size: 18, weight: .bold))
              Text(m.label)
                .font(.condensed(15, .bold))
                .tracking(1)
                .textCase(.uppercase)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            }
            .foregroundStyle(m == .help ? Theme.amber : Theme.text)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(RoundedRectangle(cornerRadius: 22).fill(Theme.surfaceAlt))
          }
          .buttonStyle(PressFade())
        }
      }

      if model.mySOSActive {
        Button { model.setSOS(false) } label: {
          Text("Cancel my SOS")
            .font(.condensed(20))
            .tracking(1)
            .textCase(.uppercase)
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(Capsule().fill(Theme.red))
        }
        .buttonStyle(PressFade())
        .padding(.top, 6)
      } else {
        // Long press, then confirm: a wet screen must not raise an SOS.
        Text("Hold · SOS")
          .font(.condensed(22))
          .tracking(1)
          .textCase(.uppercase)
          .foregroundStyle(Theme.red)
          .frame(maxWidth: .infinity, minHeight: 58)
          .overlay(Capsule().strokeBorder(Theme.red, lineWidth: 2))
          .contentShape(Capsule())
          .onLongPressGesture(minimumDuration: 1.2) {
            WKInterfaceDevice.current().play(.click)
            confirmSOS = true
          }
          .accessibilityHint("Hold, then confirm, to send an SOS")
          .accessibilityAddTraits(.isButton)
          .accessibilityAction { confirmSOS = true }
          .padding(.top, 6)
      }

      Button {
        WKInterfaceDevice.current().enableWaterLock()
      } label: {
        Label("Water lock", systemImage: "drop.fill")
          .font(.plain(14))
          .foregroundStyle(Theme.textMuted)
      }
      .padding(.top, 8)

      NavigationLink {
        InputTestView()
      } label: {
        Label("Input test", systemImage: "hand.tap")
          .font(.plain(14))
          .foregroundStyle(Theme.textMuted)
      }

      if model.workoutRunning {
        Button(role: .destructive) { model.endSession() } label: {
          Label("End session", systemImage: "stop.fill")
            .font(.plain(14))
            .foregroundStyle(Theme.textMuted)
        }
      } else {
        Button { model.startSession() } label: {
          Label("Start session", systemImage: "play.fill")
            .font(.plain(14))
            .foregroundStyle(Theme.textMuted)
        }
      }
    }
    .confirmationDialog("Send SOS to every rider?", isPresented: $confirmSOS) {
      Button("Send SOS", role: .destructive) { model.setSOS(true) }
      Button("Cancel", role: .cancel) {}
    }
  }
}

private struct PressFade: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
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
