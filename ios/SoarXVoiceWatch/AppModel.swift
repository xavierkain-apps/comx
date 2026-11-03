import AVFAudio
import Combine
import Foundation
import WatchKit

struct SOSAlert: Equatable {
  var uid: Int64
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
  @Published private(set) var talkingNow: [Int64: String] = [:]
  @Published private(set) var micDenied = false
  @Published private(set) var lastSent: Date?

  // Messages / SOS
  @Published var banner: Banner?
  @Published var sosAlert: SOSAlert?
  @Published private(set) var mySOSActive = false
  /// When mySOSActive last changed (epoch ms): the newest change wins on the relay.
  private var mySOSAt: Double = 0
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

  // Solo mode (see "Watch modes" in docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md)
  enum Mode { case phone, solo }

  /// Without phone state for this long, the watch goes solo.
  static let soloAfter: TimeInterval = 15
  /// Phone state for this long ends solo mode.
  static let phoneBackAfter: TimeInterval = 5
  /// ...as long as states keep coming: none for this long restarts the wait.
  static let phoneBackGap: TimeInterval = 3
  /// No relay answer for this long: say the position is not shared.
  static let noNetworkAfter: TimeInterval = 30
  /// *SOS sent* needs a relay answer within this time.
  static let sosConfirmAfter: TimeInterval = 15
  private static let batteryLogEvery: TimeInterval = 15 * 60
  private static let relayKey = "comx.relay"
  private static let nameKey = "comx.relayName"
  private static let channelKey = "comx.relayChannel"

  @Published private(set) var mode: Mode = .phone
  private let solo = SoloLink()
  private var relay: RelaySettings?
  private var relayName = ""
  private var relayChannel = ""
  private var phoneBackSince: Date?
  private var soloSince: Date?
  /// The 15 s before solo mode count from here until a first phone state.
  private var launchedAt = Date()
  private var noNetworkAlerted = false
  /// An SOS change made in solo mode that no relay answer has confirmed yet.
  /// Only such a change goes to the phone on the way back: otherwise the
  /// relay already holds it, and the phone stamps the time it receives it,
  /// so a stale state would win there.
  private var sosPendingSince: Date?
  /// *SOS not transmitted* was shown for the pending change.
  private var sosLateAlerted = false
  private var lastBatteryLog = Date.distantPast
  /// Solo mode: time of the last SOS state applied per rider, so an older
  /// state (the replay of a first sync) never raises an SOS again.
  private var sosAppliedAt: [Int64: Double] = [:]
  /// Solo mode: a voice clip the relay announced and the watch has not got yet.
  private struct PendingClip {
    var event: RelayEvent
    var since: Date
    var failures = 0
    var inFlight = false
  }
  /// Keyed by clip id; retried after each successful sync.
  private var pendingClips: [String: PendingClip] = [:]
  private static let clipMaxTries = 5
  private static let clipGiveUpAfter: TimeInterval = 15 * 60
  /// An event the relay stored this long before the last phone state was
  /// already forwarded by the phone.
  private static let phoneForwardMargin: Double = 2000

  // Compass focus (see "Compass focus" in docs/watch-companion.md)
  /// Rider the user last picked with the crown or the list (nil = overview).
  @Published private(set) var selectedUid: Int64?
  private var selectedAt: Date = .distantPast
  /// When each rider currently in SOS was first seen in SOS.
  private var sosSeenAt: [Int64: Date] = [:]

  /// Who the clip being recorded goes to: nil = the whole group (default).
  @Published private(set) var talkTarget: Int64?

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
    launchedAt = Date()

    link.onJSON = { [weak self] in self?.handle(json: $0) }
    link.onClip = { [weak self] url, meta in self?.handleClip(url, meta) }
    link.onReachability = { [weak self] in self?.reachable = $0 }
    link.onActivated = { [weak self] in self?.sendHello() }
    loadRelay()
    solo.onResponse = { [weak self] response, fix in self?.handleSolo(response, fix: fix) }
    solo.onClipSent = { WKInterfaceDevice.current().play(.success) }
    solo.onTextAcked = { WKInterfaceDevice.current().play(.success) }
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
    if mode == .solo { exitSolo() }
    clearRelay()
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

  /// Phone mode while the phone pushes state; solo mode (the watch syncs with
  /// the relay itself) once it has been silent for `soloAfter` and the watch
  /// has relay settings. Without settings the group keeps seeing the phone's
  /// last position: say so instead of staying silent.
  private func watchLink() {
    let up = linkUp
    if up != wasLinkUp {
      wasLinkUp = up
      InputLog.shared.system(up ? "Phone link up" : "Phone link down")
    }
    switch mode {
    case .phone:
      if up {
        linkAlerted = false
        return
      }
      let silent = now.timeIntervalSince(lastStateAt ?? launchedAt)
      if silent >= AppModel.soloAfter, let settings = relay {
        enterSolo(settings)
      } else if !linkAlerted, relay == nil, let at = lastStateAt,
                now.timeIntervalSince(at) >= AppModel.linkAlertAfter {
        linkAlerted = true
        WKInterfaceDevice.current().play(.failure)
        show(Banner(title: "No phone", body: "Your position is no longer shared", at: Date()))
      }
    case .solo:
      // A phone that goes quiet again restarts the wait: a single stray state
      // must not end solo mode.
      let fresh = lastStateAt.map { now.timeIntervalSince($0) < AppModel.phoneBackGap } ?? false
      if !fresh { phoneBackSince = nil }
      if let since = phoneBackSince, fresh, now.timeIntervalSince(since) >= AppModel.phoneBackAfter {
        exitSolo()
      } else {
        watchSolo()
      }
    }
  }

  private func enterSolo(_ settings: RelaySettings) {
    InputLog.shared.system("Solo mode on")
    mode = .solo
    soloSince = Date()
    noNetworkAlerted = false
    phoneBackSince = nil
    sosAppliedAt = [:]
    WKInterfaceDevice.current().isBatteryMonitoringEnabled = true
    solo.sos = mySOSActive
    solo.sosAt = mySOSAt
    solo.start(settings, name: relayName)
  }

  /// Back to the phone: what the relay has not taken yet goes to the phone.
  private func exitSolo() {
    InputLog.shared.system("Solo mode off")
    mode = .phone
    solo.stop()
    if !pendingClips.isEmpty {
      InputLog.shared.system("Clip download dropped (\(pendingClips.count)): solo mode off")
      pendingClips = [:]
    }
    let left = solo.drain()
    for t in left.texts {
      if let m = QuickMessage(rawValue: t.msg) { link.send(Outgoing.text(m)) }
    }
    for c in left.clips {
      link.sendClip(c.url, metaJSON: Outgoing.clipMeta(durationMs: c.ms, to: c.to))
    }
    if sosPendingSince != nil { link.send(Outgoing.sos(active: mySOSActive)) }
    sosPendingSince = nil
    sosLateAlerted = false
  }

  /// Solo mode and the relay answered recently. Before a first answer, the
  /// first `noNetworkAfter` of solo mode count as online (no red at entry).
  var soloOnline: Bool {
    guard let reference = solo.lastSyncOK ?? soloSince else { return false }
    return now.timeIntervalSince(reference) < AppModel.noNetworkAfter
  }

  private func watchSolo() {
    let reference = solo.lastSyncOK ?? soloSince ?? now
    let silent = now.timeIntervalSince(reference)
    if silent >= AppModel.noNetworkAfter, !noNetworkAlerted {
      noNetworkAlerted = true
      InputLog.shared.system("No network")
      WKInterfaceDevice.current().play(.failure)
      show(Banner(title: "No network", body: "Your position is no longer shared", at: Date()))
    } else if silent < AppModel.noNetworkAfter, noNetworkAlerted {
      noNetworkAlerted = false
      InputLog.shared.system("Network back")
    }
    // Only a raised SOS is chased; it keeps retrying with every sync.
    if let since = sosPendingSince, mySOSActive, !sosLateAlerted,
       now.timeIntervalSince(since) >= AppModel.sosConfirmAfter {
      sosLateAlerted = true
      WKInterfaceDevice.current().play(.failure)
      show(Banner(title: "SOS not transmitted", body: "Still trying", at: Date()))
    }
    if now.timeIntervalSince(lastBatteryLog) >= AppModel.batteryLogEvery {
      lastBatteryLog = now
      let device = WKInterfaceDevice.current()
      device.isBatteryMonitoringEnabled = true
      InputLog.shared.system("Battery \(Int(device.batteryLevel * 100))%")
    }
  }

  // MARK: - Relay settings

  private func loadRelay() {
    let d = UserDefaults.standard
    if let data = d.data(forKey: AppModel.relayKey) {
      relay = try? JSONDecoder().decode(RelaySettings.self, from: data)
    }
    relayName = d.string(forKey: AppModel.nameKey) ?? ""
    relayChannel = d.string(forKey: AppModel.channelKey) ?? ""
  }

  /// Follows the phone: a channel gives settings, leaving it clears them.
  /// After End session the phone's next state must not bring them back.
  private func storeRelay(from s: PhoneState) {
    guard !sessionEndedByUser else { return }
    let d = UserDefaults.standard
    if let r = s.relay {
      relay = r
      relayName = s.me?.name ?? relayName
      relayChannel = s.channel ?? relayChannel
      d.set(try? JSONEncoder().encode(r), forKey: AppModel.relayKey)
      d.set(relayName, forKey: AppModel.nameKey)
      d.set(relayChannel, forKey: AppModel.channelKey)
    } else if s.connected == false {
      clearRelay()
    }
  }

  private func clearRelay() {
    relay = nil
    UserDefaults.standard.removeObject(forKey: AppModel.relayKey)
  }

  func sendHello() {
    link.send(Outgoing.hello(model: AppModel.hardwareModel(), hasCompass: HeadingProvider.hasCompass))
  }

  // MARK: - Derived

  var linkUp: Bool {
    guard let at = lastStateAt else { return false }
    return now.timeIntervalSince(at) < AppModel.linkTimeout
  }

  var channelConnected: Bool {
    mode == .solo ? solo.lastSyncOK != nil && soloOnline : linkUp && (state?.connected ?? false)
  }

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

  func rider(_ uid: Int64) -> Rider? { state?.riders?.first { $0.uid == uid } }

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

  func select(_ uid: Int64) {
    selectedUid = uid
    selectedAt = Date()
  }

  /// Recipients in crown order: group, the rider on the compass, the others.
  var talkTargets: [Int64?] {
    let focused = focusedRider?.uid
    var out: [Int64?] = [nil]
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
  func setTalkTarget(_ uid: Int64?) {
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
    // In solo mode the success haptic waits for the upload (solo.onClipSent);
    // the queued file stays until uploaded or handed to the phone.
    if mode == .solo, let settings = relay, let data = try? Data(contentsOf: url) {
      let clip = RelayClip(id: UUID().uuidString, uid: settings.uid, from: relayName, to: target ?? 0,
                           durationMs: ms, ext: url.pathExtension, data: data.base64EncodedString())
      solo.enqueue(clip: QueuedClip(clip: clip, url: url, to: target, ms: ms))
    } else {
      link.sendClip(url, metaJSON: Outgoing.clipMeta(durationMs: ms, to: target))
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        WKInterfaceDevice.current().play(.success)
      }
    }
    lastSent = Date()
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

  /// In solo mode the success haptic waits for the relay's answer (solo.onTextAcked).
  func send(_ message: QuickMessage) {
    let queued = mode == .solo
    if queued {
      solo.enqueue(text: RelayOutEvent(id: UUID().uuidString, msg: message.rawValue, text: message.label))
    } else {
      link.send(Outgoing.text(message))
    }
    record(HistoryItem(who: "Group", outgoing: true, isPrivate: false, kind: .text(message.label)))
    if !queued { WKInterfaceDevice.current().play(.success) }
    show(Banner(title: queued ? "Queued" : "Sent", body: message.label, at: Date()))
  }

  /// In solo mode the state goes with every sync; the success haptic comes
  /// with the first relay answer that holds it (handleSolo).
  func setSOS(_ active: Bool) {
    mySOSActive = active
    mySOSAt = Date().timeIntervalSince1970 * 1000
    if mode == .solo {
      solo.sos = active
      solo.sosAt = mySOSAt
      sosPendingSince = Date()
      sosLateAlerted = false
      if active { WKInterfaceDevice.current().play(.failure) }
    } else {
      link.send(Outgoing.sos(active: active))
      WKInterfaceDevice.current().play(active ? .failure : .success)
    }
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
      storeRelay(from: s)
      lastStateAt = Date()
      if mode == .solo {
        // The relay feeds the compass until solo mode ends.
        if phoneBackSince == nil { phoneBackSince = Date() }
        return
      }
      adopt(s)
    case .event(let e):
      handle(event: e)
    case .unknown:
      break
    }
  }

  /// Shows a state, from the phone or built from a relay answer.
  private func adopt(_ s: PhoneState) {
    state = s
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
  }

  // MARK: - Relay answers (solo mode)

  private func handleSolo(_ r: SyncResponse, fix: RelayPosition?) {
    guard mode == .solo, let settings = relay else { return }
    // One SOS state per rider, the newest change wins: a change made on the
    // phone after the watch's own wins here too. The relay's own answer for
    // this uid comes first; an older relay only has the rows.
    let ownRow = r.riders.first { $0.uid == settings.uid && $0.source == "phone" }
      ?? r.riders.first { $0.uid == settings.uid }
    let mine = r.own.map { (sos: $0.sos, at: $0.sosAt) }
      ?? ownRow.flatMap { row in row.sosAt.map { (sos: row.sos, at: $0) } }
    if let mine = mine {
      if mine.at > mySOSAt, mine.sos != mySOSActive {
        mySOSActive = mine.sos
        mySOSAt = mine.at
        solo.sos = mine.sos
        solo.sosAt = mine.at
        sosPendingSince = nil // the phone made the newer change
        sosLateAlerted = false
        InputLog.shared.system("SOS \(mine.sos ? "on" : "off") from the phone")
      } else if sosPendingSince != nil, mine.at >= mySOSAt, mine.sos == mySOSActive {
        // The relay holds the watch's latest change.
        sosPendingSince = nil
        sosLateAlerted = false
        WKInterfaceDevice.current().play(.success)
        show(Banner(title: mySOSActive ? "SOS sent" : "SOS cancelled", body: "The group has been told", at: Date()))
      }
    }
    // Other riders' SOS: rows first, then events, each only if newer.
    var changedByRow = Set<Int64>()
    var rows: [Int64: RelayRider] = [:]
    for row in r.riders where row.uid != settings.uid { rows[row.uid] = row }
    for (uid, row) in rows {
      let at = row.sosAt ?? 0
      let applied = sosAppliedAt[uid]
      guard at > (applied ?? 0) else { continue }
      sosAppliedAt[uid] = at
      // A newer state after one already applied is a new SOS; at first sight,
      // only a rider not already shown in SOS (by the phone) raises the alarm.
      if row.sos, applied != nil || sosSeenAt[uid] == nil {
        changedByRow.insert(uid)
        handle(event: PhoneEvent(type: "sos", uid: uid, from: row.name, active: true))
      } else if !row.sos, sosAlert?.uid == uid {
        changedByRow.insert(uid)
        handle(event: PhoneEvent(type: "sos", uid: uid, from: row.name, active: false))
      }
    }
    let riders = SoloGeometry.riders(r, me: fix, myUid: settings.uid)
    adopt(PhoneState(v: 2, kind: "state", connected: true, channel: relayChannel, watchMode: true,
                     me: MePosition(name: relayName, lat: fix?.lat, lon: fix?.lon, cog: fix?.cog,
                                    sog: fix?.sog, t: fix?.t),
                     riders: riders, ts: r.now, relay: settings))
    // Texts and clips the relay stored before the last phone state came
    // through the phone already. An event without sentAt counts as new.
    let forwardedBefore = lastStateAt.map { $0.timeIntervalSince1970 * 1000 - AppModel.phoneForwardMargin }
    for e in r.events {
      if e.type == "text" || e.type == "clip", let sent = e.sentAt, let before = forwardedBefore,
         sent < before { continue }
      if e.type == "sos" {
        let at = e.at ?? r.now
        // Already applied from the rows of this answer, or older than what was.
        guard !changedByRow.contains(e.uid), at > (sosAppliedAt[e.uid] ?? 0) else { continue }
        sosAppliedAt[e.uid] = at
      }
      handle(relayEvent: e)
    }
    retryClips()
  }

  private func handle(relayEvent e: RelayEvent) {
    switch e.type {
    case "text":
      handle(event: PhoneEvent(type: "text", uid: e.uid, from: e.from, id: e.msg, text: e.text))
    case "sos":
      handle(event: PhoneEvent(type: "sos", uid: e.uid, from: e.from, active: e.active))
    case "clip":
      guard let id = e.clip, pendingClips[id] == nil else { return }
      pendingClips[id] = PendingClip(event: e, since: Date())
      fetchClip(id)
    default:
      break
    }
  }

  /// Tries again the clips not downloaded yet (after a successful sync).
  private func retryClips() {
    for (id, p) in pendingClips where !p.inFlight { fetchClip(id) }
  }

  private func fetchClip(_ id: String) {
    guard var p = pendingClips[id], !p.inFlight else { return }
    p.inFlight = true
    pendingClips[id] = p
    let e = p.event
    solo.download(id: id) { [weak self] clip in
      guard let self = self, var p = self.pendingClips[id] else { return }
      p.inFlight = false
      guard let clip = clip, let data = Data(base64Encoded: clip.data) else {
        p.failures += 1
        if p.failures >= AppModel.clipMaxTries || Date().timeIntervalSince(p.since) >= AppModel.clipGiveUpAfter {
          self.pendingClips[id] = nil
          InputLog.shared.system("Clip download failed, given up after \(p.failures) tries")
        } else {
          self.pendingClips[id] = p
          InputLog.shared.system("Clip download failed (try \(p.failures))")
        }
        return
      }
      self.pendingClips[id] = nil
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("rx-\(id).\(clip.ext)")
      do {
        try data.write(to: url)
      } catch {
        InputLog.shared.system("Clip write failed: \(error.localizedDescription)")
        return
      }
      self.handleClip(url, ClipMeta(uid: e.uid, from: e.from, durationMs: e.durationMs,
                                    isPrivate: (e.to ?? 0) != 0))
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
