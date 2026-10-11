import Combine
import Foundation
import WatchKit

struct SOSAlert: Equatable {
  var uid: Int
  var from: String
  var dist: Double?
  var brg: Double?
  var at: Date
}

struct Banner: Equatable {
  var title: String
  var body: String
  var at: Date
}

/// Single source of truth for the watch UI. Main thread only.
final class AppModel: ObservableObject {
  static let shared = AppModel()

  static let maxClipSeconds: TimeInterval = 30
  /// The phone pushes state every 2 s; older than this means the link is down.
  static let linkTimeout: TimeInterval = 10

  // Phone state
  @Published private(set) var state: PhoneState?
  @Published private(set) var lastStateAt: Date?
  @Published private(set) var reachable = false
  @Published private(set) var now = Date()

  // Compass
  @Published private(set) var compassHeading: Double?

  // Voice
  @Published private(set) var isRecording = false
  @Published private(set) var recordingElapsed: TimeInterval = 0
  @Published private(set) var playingFrom: String?
  @Published private(set) var talkingNow: [Int: String] = [:]
  @Published private(set) var micDenied = false
  @Published private(set) var lastSent: Date?

  // Messages / SOS
  @Published var banner: Banner?
  @Published var sosAlert: SOSAlert?
  @Published private(set) var mySOSActive = false

  // Session
  @Published private(set) var workoutRunning = false

  // Compass focus (see "Compass focus" in docs/watch-companion.md)
  /// Rider the user last picked with the crown or the list.
  @Published private(set) var selectedUid: Int?
  private var selectedAt: Date = .distantPast
  /// When each rider currently in SOS was first seen in SOS.
  private var sosSeenAt: [Int: Date] = [:]

  /// Who the clip being recorded goes to: nil = the whole group (default).
  @Published private(set) var talkTarget: Int?

  private let link = PhoneLink()
  private let recorder = ClipRecorder()
  private let player = ClipPlayer()
  private let headingProvider = HeadingProvider()
  let workout = WorkoutKeeper()

  private var tick: Timer?
  private var recordTimer: Timer?
  private var bannerTimer: Timer?
  private var started = false

  private init() {}

  // MARK: - Lifecycle

  func startIfNeeded() {
    guard !started else { return }
    started = true

    link.onJSON = { [weak self] in self?.handle(json: $0) }
    link.onClip = { [weak self] url, meta in self?.handleClip(url, meta) }
    link.onReachability = { [weak self] in self?.reachable = $0 }
    link.onActivated = { [weak self] in self?.sendHello() }
    link.activate()

    player.onStart = { [weak self] from in
      WKInterfaceDevice.current().play(.notification)
      self?.playingFrom = from
    }
    player.onIdle = { [weak self] in self?.playingFrom = nil }

    headingProvider.onHeading = { [weak self] in self?.compassHeading = $0 }
    headingProvider.start()

    workout.onRunning = { [weak self] in self?.workoutRunning = $0 }
    startSession()

    tick = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      self?.now = Date()
    }
  }

  func startSession() { workout.start() }
  func endSession() { workout.stop() }

  func sendHello() {
    link.send(Outgoing.hello(model: AppModel.hardwareModel(), hasCompass: HeadingProvider.hasCompass))
  }

  // MARK: - Derived

  var linkUp: Bool {
    guard let at = lastStateAt else { return false }
    return now.timeIntervalSince(at) < AppModel.linkTimeout
  }

  var channelConnected: Bool { linkUp && (state?.connected ?? false) }

  enum HeadingSource { case compass, course, north }

  /// The reference the arrows are drawn against: compass, else course over
  /// ground from the phone, else north-up.
  var heading: (Double, HeadingSource) {
    if let h = compassHeading { return (h, .compass) }
    if let cog = state?.me?.cog, cog.isFinite { return (cog, .course) }
    return (0, .north)
  }

  func arrowAngle(bearing: Double?) -> Double? {
    guard let b = bearing, b.isFinite else { return nil }
    return b - heading.0
  }

  var riders: [Rider] {
    (state?.riders ?? []).sorted { a, b in
      if a.isSOS != b.isSOS { return a.isSOS }
      switch (a.dist, b.dist) {
      case let (x?, y?): return x < y
      case (_?, nil): return true
      case (nil, _?): return false
      default: return a.displayName < b.displayName
      }
    }
  }

  func rider(_ uid: Int) -> Rider? { state?.riders?.first { $0.uid == uid } }

  /// The one rider shown big: a rider whose SOS started after the user's
  /// last pick, else the rider the user picked, else the nearest (SOS riders
  /// sort first, so an older SOS still wins over distance).
  var focusedRider: Rider? {
    let list = riders
    guard !list.isEmpty else { return nil }
    let newestSOS = list.filter { $0.isSOS }.max {
      (sosSeenAt[$0.uid] ?? .distantPast) < (sosSeenAt[$1.uid] ?? .distantPast)
    }
    if let s = newestSOS, (sosSeenAt[s.uid] ?? .distantPast) > selectedAt { return s }
    if let sel = selectedUid, let r = list.first(where: { $0.uid == sel }) { return r }
    return list.first
  }

  /// Position of the focused rider, 1-based, and the rider count.
  var focusPosition: (Int, Int)? {
    let list = riders
    guard let f = focusedRider, let i = list.firstIndex(where: { $0.uid == f.uid }) else { return nil }
    return (i + 1, list.count)
  }

  func select(_ uid: Int) {
    selectedUid = uid
    selectedAt = Date()
  }

  /// One Digital Crown detent. While recording it picks the recipient,
  /// otherwise it moves the compass to the next / previous rider.
  func crownStep(_ delta: Int) {
    if isRecording {
      cycleTalkTarget(delta)
      return
    }
    let list = riders
    guard list.count > 1 else { return }
    let index = focusedRider.flatMap { f in list.firstIndex { $0.uid == f.uid } } ?? 0
    let n = list.count
    select(list[((index + delta) % n + n) % n].uid)
  }

  /// Recipients in crown order: group, the rider on the compass, the others.
  var talkTargets: [Int?] {
    let focused = focusedRider?.uid
    var out: [Int?] = [nil]
    if let f = focused { out.append(f) }
    for r in riders where r.uid != focused { out.append(r.uid) }
    return out
  }

  func cycleTalkTarget(_ delta: Int) {
    let targets = talkTargets
    guard targets.count > 1 else { return }
    let index = targets.firstIndex { $0 == talkTarget } ?? 0
    let n = targets.count
    talkTarget = targets[((index + delta) % n + n) % n]
    WKInterfaceDevice.current().play(talkTarget == nil ? .directionDown : .directionUp)
  }

  var talkTargetName: String {
    guard let uid = talkTarget else { return "Group" }
    return rider(uid)?.displayName ?? "Rider \(uid)"
  }

  var speakingLabel: String? {
    if let from = playingFrom { return from }
    let names = talkingNow.values.sorted()
    return names.isEmpty ? nil : names.joined(separator: ", ")
  }

  // MARK: - Talk

  func toggleTalk() {
    isRecording ? stopAndSend() : startTalking()
  }

  func startTalking() {
    guard !isRecording else { return }
    ClipRecorder.requestPermission { [weak self] granted in
      guard let self = self else { return }
      self.micDenied = !granted
      guard granted else {
        WKInterfaceDevice.current().play(.failure)
        return
      }
      self.player.paused = true
      self.player.interrupt()
      do {
        try self.recorder.start()
      } catch {
        NSLog("[Watch] cannot record: \(error)")
        self.player.paused = false
        WKInterfaceDevice.current().play(.failure)
        return
      }
      self.isRecording = true
      self.talkTarget = nil // group unless the crown picks someone
      self.recordingElapsed = 0
      WKInterfaceDevice.current().play(.start)
      self.recordTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        guard let self = self else { return }
        self.recordingElapsed = self.recorder.elapsed
        if self.recordingElapsed >= AppModel.maxClipSeconds { self.stopAndSend() }
      }
    }
  }

  func stopAndSend() {
    guard isRecording else { return }
    recordTimer?.invalidate()
    recordTimer = nil
    isRecording = false
    let result = recorder.stop()
    WKInterfaceDevice.current().play(.stop)
    player.paused = false
    let target = talkTarget
    talkTarget = nil
    guard let clip = result else { return }
    let (url, ms) = clip
    link.sendClip(url, metaJSON: Outgoing.clipMeta(durationMs: ms, to: target))
    lastSent = Date()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      WKInterfaceDevice.current().play(.success)
    }
  }

  func cancelTalking() {
    guard isRecording else { return }
    recordTimer?.invalidate()
    recordTimer = nil
    isRecording = false
    talkTarget = nil
    recorder.cancel()
    player.paused = false
    WKInterfaceDevice.current().play(.retry)
  }

  // MARK: - Messages

  func send(_ message: QuickMessage) {
    link.send(Outgoing.text(message))
    WKInterfaceDevice.current().play(.success)
    show(Banner(title: "Sent", body: message.label, at: Date()))
  }

  func setSOS(_ active: Bool) {
    mySOSActive = active
    link.send(Outgoing.sos(active: active))
    WKInterfaceDevice.current().play(active ? .failure : .success)
  }

  func dismissSOSAlert() { sosAlert = nil }

  private func show(_ b: Banner) {
    banner = b
    bannerTimer?.invalidate()
    bannerTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: false) { [weak self] _ in
      self?.banner = nil
    }
  }

  // MARK: - Incoming

  private func handle(json: String) {
    switch Incoming.parse(json) {
    case .state(let s):
      state = s
      lastStateAt = Date()
      now = Date()
      // Talking indicators expire with the state if an "inactive" event is lost.
      let speaking = Set((s.riders ?? []).filter { $0.isSpeaking }.map { $0.uid })
      talkingNow = talkingNow.filter { speaking.contains($0.key) }
      for r in s.riders ?? [] where r.isSpeaking { talkingNow[r.uid] = r.displayName }
      let inSOS = Set((s.riders ?? []).filter { $0.isSOS }.map { $0.uid })
      sosSeenAt = sosSeenAt.filter { inSOS.contains($0.key) }
      for uid in inSOS where sosSeenAt[uid] == nil { sosSeenAt[uid] = Date() }
      if var alert = sosAlert, let r = rider(alert.uid) {
        alert.dist = r.dist ?? alert.dist
        alert.brg = r.brg ?? alert.brg
        sosAlert = alert
      }
    case .event(let e):
      handle(event: e)
    case .unknown:
      break
    }
  }

  private func handle(event e: PhoneEvent) {
    let uid = e.uid ?? -1
    let from = e.from ?? rider(uid)?.displayName ?? "Rider"
    switch e.type {
    case "speaking":
      if e.active ?? false {
        if talkingNow[uid] == nil { WKInterfaceDevice.current().play(.directionUp) }
        talkingNow[uid] = from
      } else {
        talkingNow[uid] = nil
      }
    case "text":
      WKInterfaceDevice.current().play(.notification)
      show(Banner(title: from, body: QuickMessage.label(forId: e.id, fallback: e.text), at: Date()))
    case "sos":
      if e.active ?? true {
        sosAlert = SOSAlert(uid: uid, from: from, dist: e.dist, brg: e.brg, at: Date())
        if sosSeenAt[uid] == nil { sosSeenAt[uid] = Date() }
        AppModel.alarmHaptics()
      } else if sosAlert?.uid == uid {
        sosAlert = nil
        WKInterfaceDevice.current().play(.success)
        show(Banner(title: from, body: "SOS cancelled", at: Date()))
      }
    default:
      break
    }
  }

  private func handleClip(_ url: URL, _ meta: ClipMeta?) {
    let from = meta?.from ?? meta?.uid.flatMap { rider($0)?.displayName } ?? "Rider"
    let label = (meta?.isPrivate ?? false) ? "\(from) (to you)" : from
    player.enqueue(.init(url: url, from: label))
  }

  // MARK: - Helpers

  static func alarmHaptics() {
    let device = WKInterfaceDevice.current()
    for i in 0..<4 {
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.7) { device.play(.failure) }
    }
  }

  static func hardwareModel() -> String {
    var info = utsname()
    uname(&info)
    let mirror = Mirror(reflecting: info.machine)
    return mirror.children.reduce(into: "") { result, element in
      if let v = element.value as? Int8, v != 0 { result.append(Character(UnicodeScalar(UInt8(v)))) }
    }
  }
}
