import AVFAudio
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
  /// Link down for this long: tell the rider their position is frozen.
  static let linkAlertAfter: TimeInterval = 30
  private static let autoWaterLockKey = "comx.autoWaterLock"

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
  /// Last messages sent and received, newest first (History page).
  @Published private(set) var history: [HistoryItem] = []

  // Session
  @Published private(set) var workoutRunning = false
  /// Turn water lock on once per session, as soon as the group is connected.
  @Published var autoWaterLock: Bool {
    didSet { UserDefaults.standard.set(autoWaterLock, forKey: AppModel.autoWaterLockKey) }
  }
  private var lockedThisSession = false
  /// Set by End session: the app must not start a new one by itself.
  private var sessionEndedByUser = false
  private var wasLinkUp = false
  private var linkAlerted = false
  private var wasWaterLocked = false

  // Compass focus (see "Compass focus" in docs/watch-companion.md)
  /// Rider the user last picked with the crown or the list (nil = overview).
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
  private let messageHistory = MessageHistory()
  let workout = WorkoutKeeper()

  private var tick: Timer?
  private var recordTimer: Timer?
  private var bannerTimer: Timer?
  private var started = false

  private init() {
    autoWaterLock = UserDefaults.standard.object(forKey: AppModel.autoWaterLockKey) as? Bool ?? true
  }

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

    workout.onRunning = { [weak self] in self?.workoutChanged(running: $0) }
    startSession()

    tick = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      self.now = Date()
      self.watchLink()
      self.watchWaterLock()
      self.autoLockIfReady()
    }
  }

  func startSession() {
    sessionEndedByUser = false
    workout.start()
  }

  func endSession() {
    sessionEndedByUser = true
    workout.stop()
  }

  /// A session the system ended or paused comes back when the app does.
  func keepSessionAlive() {
    guard started, !sessionEndedByUser else { return }
    workout.start()
  }

  private func workoutChanged(running: Bool) {
    workoutRunning = running
    guard running else {
      lockedThisSession = false
      return
    }
    // Asked now: under water lock the prompt could not be answered.
    ClipRecorder.requestPermission { [weak self] granted in
      self?.micDenied = !granted
    }
  }

  private func autoLockIfReady() {
    guard autoWaterLock, !lockedThisSession, workoutRunning, channelConnected,
          headingProvider.permissionDecided,
          AVAudioApplication.shared.recordPermission != .undetermined,
          WKApplication.shared().applicationState == .active else { return }
    lockedThisSession = true
    InputLog.shared.system("Water lock requested")
    WKInterfaceDevice.current().enableWaterLock()
  }

  private func watchWaterLock() {
    let locked = WKInterfaceDevice.current().isWaterLockEnabled
    guard locked != wasWaterLocked else { return }
    wasWaterLocked = locked
    InputLog.shared.system("Water lock \(locked ? "on" : "off")")
  }

  /// The watch has no GPS link of its own: without the phone, the group keeps
  /// seeing the phone's last position. Say so instead of staying silent.
  private func watchLink() {
    let up = linkUp
    if up != wasLinkUp {
      wasLinkUp = up
      InputLog.shared.system(up ? "Phone link up" : "Phone link down")
    }
    if up {
      linkAlerted = false
    } else if !linkAlerted, let at = lastStateAt, now.timeIntervalSince(at) >= AppModel.linkAlertAfter {
      linkAlerted = true
      WKInterfaceDevice.current().play(.failure)
      show(Banner(title: "No phone", body: "Your position is no longer shared", at: Date()))
    }
  }

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

  /// The rider page the compass shows, nil for the overview: a rider whose
  /// SOS started after the user's last pick, else the rider the user picked.
  var compassRider: Rider? {
    let list = riders
    let newestSOS = list.filter { $0.isSOS }.max {
      (sosSeenAt[$0.uid] ?? .distantPast) < (sosSeenAt[$1.uid] ?? .distantPast)
    }
    if let s = newestSOS, (sosSeenAt[s.uid] ?? .distantPast) > selectedAt { return s }
    if let sel = selectedUid { return list.first { $0.uid == sel } }
    return nil
  }

  /// The rider talk targets start from: the one on the compass, else the
  /// nearest (SOS riders sort first).
  var focusedRider: Rider? { compassRider ?? riders.first }

  /// Back to the overview page of the compass.
  func showOverview() {
    selectedUid = nil
    selectedAt = Date()
  }

  func select(_ uid: Int) {
    selectedUid = uid
    selectedAt = Date()
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

  /// Recipient picked with the crown (a page of the compass) while recording.
  func setTalkTarget(_ uid: Int?) {
    guard isRecording, uid != talkTarget else { return }
    talkTarget = uid
    WKInterfaceDevice.current().play(uid == nil ? .directionDown : .directionUp)
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
    let targetName = talkTargetName
    talkTarget = nil
    guard let clip = result else { return }
    let (url, ms) = clip
    // Kept before the transfer, which deletes the file once delivered.
    if let kept = messageHistory.keepClip(url) {
      record(HistoryItem(who: targetName, outgoing: true, isPrivate: target != nil,
                         kind: .voice(kept, durationMs: ms)))
    }
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
    record(HistoryItem(who: "Group", outgoing: true, isPrivate: false, kind: .text(message.label)))
    WKInterfaceDevice.current().play(.success)
    show(Banner(title: "Sent", body: message.label, at: Date()))
  }

  func setSOS(_ active: Bool) {
    mySOSActive = active
    link.send(Outgoing.sos(active: active))
    WKInterfaceDevice.current().play(active ? .failure : .success)
  }

  func dismissSOSAlert() { sosAlert = nil }

  // MARK: - History

  private func record(_ item: HistoryItem) {
    messageHistory.add(item)
    history = messageHistory.items
  }

  /// Plays a voice message of the history again (after anything queued).
  func replay(_ item: HistoryItem) {
    guard case .voice(let url, _) = item.kind, !isRecording,
          let copy = messageHistory.playableCopy(of: url) else {
      WKInterfaceDevice.current().play(.failure)
      return
    }
    player.enqueue(.init(url: copy, from: item.outgoing ? "Me" : item.who))
  }

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
      let label = QuickMessage.label(forId: e.id, fallback: e.text)
      record(HistoryItem(who: from, outgoing: false, isPrivate: false, kind: .text(label)))
      show(Banner(title: from, body: label, at: Date()))
    case "sos":
      if e.active ?? true {
        sosAlert = SOSAlert(uid: uid, from: from, dist: e.dist, brg: e.brg, at: Date())
        record(HistoryItem(who: from, outgoing: false, isPrivate: false, kind: .text("SOS")))
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
    let isPrivate = meta?.isPrivate ?? false
    let label = isPrivate ? "\(from) (to you)" : from
    // Kept before playing: the player deletes what it has played.
    if let kept = messageHistory.keepClip(url) {
      record(HistoryItem(who: from, outgoing: false, isPrivate: isPrivate,
                         kind: .voice(kept, durationMs: meta?.durationMs.map { Int($0) })))
    }
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
