import Foundation
import React
import WatchConnectivity

// Phone side of the watch link. See docs/watch-companion.md (contract) and
// docs/watch-ios.md (iOS specifics).
//
// Two pieces:
//  - WatchHub: a process-wide WCSession delegate. It is activated from
//    AppDelegate at launch so files and messages the watch sends while React
//    Native is still loading (or before JS calls start()) are not lost; they
//    are buffered until the JS side listens.
//  - WatchBridge: the React Native module. It forwards calls to the hub and
//    emits the hub's events to JS.
//
// Garmin watches (Connect IQ iOS SDK) live in GarminLink.m; the hub fans
// state and events out to both and merges their status.

private let kPlatform = "watchos"
private let kGarminPlatform = "garmin"
private let kJsonKey = "json"

final class WatchHub: NSObject, WCSessionDelegate {
  static let shared = WatchHub()

  typealias Emitter = (_ name: String, _ body: [String: Any]) -> Void
  /// Set by WatchBridge while JS has listeners; only touched on `queue`.
  private var emit: Emitter?

  func setEmitter(_ emitter: Emitter?) {
    queue.async {
      self.emit = emitter
      if emitter != nil { self.flushPending() }
    }
  }

  override private init() {
    super.init()
    let garmin = GarminLink.shared
    garmin.onMessage = { [weak self] json in
      self?.post("WatchMessage", ["platform": kGarminPlatform, "json": json])
    }
    garmin.onStatusChange = { [weak self] in self?.postStatus() }
  }

  private let queue = DispatchQueue(label: "soarx.watchhub")
  private var pending: [(String, [String: Any])] = []
  private let maxPending = 50
  /// Outgoing clip copies, deleted once their transfer finishes.
  private var outgoing: Set<String> = []

  private var session: WCSession? {
    WCSession.isSupported() ? WCSession.default : nil
  }

  // MARK: - Directories

  static func directory(_ name: String) -> URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let dir = caches.appendingPathComponent(name, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  /// Where JS records remote audio before sending it (getClipDir).
  static var clipDir: URL { directory("watch-clips") }
  /// Clips received from the watch.
  static var inboxDir: URL { directory("watch-inbox") }
  /// Private copies of clips being transferred to the watch.
  static var outboxDir: URL { directory("watch-outbox") }

  // MARK: - Activation

  func activate() {
    GarminLink.shared.startIfConfigured()
    guard let session = session else {
      NSLog("[WatchBridge] WatchConnectivity not supported on this device")
      return
    }
    if session.delegate == nil { session.delegate = self }
    if session.activationState != .activated {
      session.activate()
    }
  }

  // MARK: - Outgoing

  func sendState(_ json: String) {
    GarminLink.shared.sendState(json)
    guard let session = readySession() else { return }
    do {
      try session.updateApplicationContext([kJsonKey: json])
    } catch {
      NSLog("[WatchBridge] updateApplicationContext failed: \(error.localizedDescription)")
    }
    // Low latency path while the watch app is in front.
    if session.isReachable {
      session.sendMessage([kJsonKey: json], replyHandler: nil, errorHandler: nil)
    }
  }

  func sendEvent(_ json: String) {
    GarminLink.shared.sendEvent(json)
    guard let session = readySession() else { return }
    let payload = [kJsonKey: json]
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { error in
        NSLog("[WatchBridge] sendMessage failed, queueing: \(error.localizedDescription)")
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
  }

  /// Sends a private copy of the clip, so JS may reuse or delete its file at
  /// once. A source file inside clipDir (getClipDir) is deleted by this call,
  /// whether or not a watch was there to receive it; the copy is deleted when
  /// the WCSession transfer finishes.
  func sendClip(path: String, metaJson: String) {
    let source = WatchHub.fileURL(from: path)
    let ownsSource = source.deletingLastPathComponent().standardizedFileURL.path
      == WatchHub.clipDir.standardizedFileURL.path
    defer { if ownsSource { try? FileManager.default.removeItem(at: source) } }

    guard let session = readySession() else { return }
    guard FileManager.default.fileExists(atPath: source.path) else {
      NSLog("[WatchBridge] sendClip: no file at \(source.path)")
      return
    }
    let ext = source.pathExtension.isEmpty ? "aac" : source.pathExtension
    let copy = WatchHub.outboxDir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    do {
      try FileManager.default.copyItem(at: source, to: copy)
    } catch {
      NSLog("[WatchBridge] sendClip copy failed: \(error.localizedDescription)")
      return
    }
    queue.sync { _ = outgoing.insert(copy.path) }
    session.transferFile(copy, metadata: [kJsonKey: metaJson])
  }

  func status() -> [[String: Any]] {
    let garmin: [[String: Any]] = GarminLink.shared.status()
    return appleWatchStatus() + garmin
  }

  private func appleWatchStatus() -> [[String: Any]] {
    guard let session = session, session.activationState == .activated else { return [] }
    guard session.isPaired else { return [] }
    return [[
      "platform": kPlatform,
      "name": "Apple Watch",
      "paired": session.isPaired,
      "installed": session.isWatchAppInstalled,
      "reachable": session.isReachable,
    ]]
  }

  private func readySession() -> WCSession? {
    guard let session = session, session.activationState == .activated,
          session.isPaired, session.isWatchAppInstalled else { return nil }
    return session
  }

  static func fileURL(from path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path) { return url }
    return URL(fileURLWithPath: path)
  }

  // MARK: - Event plumbing

  private func post(_ name: String, _ body: [String: Any], buffer: Bool = true) {
    queue.async {
      if let emit = self.emit {
        emit(name, body)
      } else if buffer {
        self.pending.append((name, body))
        if self.pending.count > self.maxPending { self.pending.removeFirst() }
      }
    }
  }

  /// Runs on `queue`.
  private func flushPending() {
    guard let emit = emit else { return }
    let items = pending
    pending.removeAll()
    for (name, body) in items { emit(name, body) }
    emit("WatchStatus", ["watches": status()])
  }

  private func postStatus() {
    post("WatchStatus", ["watches": status()], buffer: false)
  }

  private func handleIncoming(_ payload: [String: Any]) {
    guard let json = WatchHub.jsonString(from: payload) else { return }
    post("WatchMessage", ["platform": kPlatform, "json": json])
  }

  /// Payloads carry the JSON string under "json". Tolerate a bare dictionary.
  static func jsonString(from payload: [String: Any]) -> String? {
    if let s = payload[kJsonKey] as? String { return s }
    guard !payload.isEmpty, JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  // MARK: - WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error = error {
      NSLog("[WatchBridge] activation failed: \(error.localizedDescription)")
    }
    postStatus()
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switching to another paired watch: reactivate for the new one.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) { postStatus() }

  func sessionReachabilityDidChange(_ session: WCSession) { postStatus() }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handleIncoming(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any],
               replyHandler: @escaping ([String: Any]) -> Void) {
    handleIncoming(message)
    replyHandler([:])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handleIncoming(userInfo)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    handleIncoming(applicationContext)
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    // The inbox file is deleted when this method returns: move it now.
    let ext = file.fileURL.pathExtension.isEmpty ? "m4a" : file.fileURL.pathExtension
    let dest = WatchHub.inboxDir.appendingPathComponent("watch-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).\(ext)")
    do {
      try FileManager.default.moveItem(at: file.fileURL, to: dest)
    } catch {
      NSLog("[WatchBridge] could not keep received clip: \(error.localizedDescription)")
      return
    }
    var durationMs: Double = 0
    // `to`: uid of the one rider the clip is for; absent / null = the group.
    var to: Any = NSNull()
    if let meta = file.metadata,
       let json = WatchHub.jsonString(from: meta),
       let data = json.data(using: .utf8),
       let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      if let d = obj["durationMs"] as? NSNumber { durationMs = d.doubleValue }
      if let t = obj["to"] as? NSNumber, CFGetTypeID(t) != CFBooleanGetTypeID() { to = t }
    }
    post("WatchClip", ["platform": kPlatform, "path": dest.path, "durationMs": durationMs, "to": to])
    WatchHub.pruneInbox()
  }

  func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
    if let error = error {
      NSLog("[WatchBridge] clip transfer failed: \(error.localizedDescription)")
    }
    let path = fileTransfer.file.fileURL.path
    queue.async {
      if self.outgoing.remove(path) != nil {
        try? FileManager.default.removeItem(atPath: path)
      }
    }
  }

  /// Received clips are only needed until JS has injected them into the
  /// channel; keep the inbox from growing without bound.
  static func pruneInbox(keep: Int = 30) {
    let fm = FileManager.default
    guard let files = try? fm.contentsOfDirectory(at: inboxDir, includingPropertiesForKeys: [.creationDateKey]) else { return }
    guard files.count > keep else { return }
    let sorted = files.sorted {
      let a = (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
      let b = (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
      return a < b
    }
    for url in sorted.prefix(files.count - keep) { try? fm.removeItem(at: url) }
  }
}

@objc(WatchBridge)
class WatchBridge: RCTEventEmitter {

  override func supportedEvents() -> [String]! {
    return ["WatchMessage", "WatchClip", "WatchStatus"]
  }

  override func startObserving() {
    WatchHub.shared.setEmitter { [weak self] name, body in
      self?.sendEvent(withName: name, body: body)
    }
  }

  override func stopObserving() {
    WatchHub.shared.setEmitter(nil)
  }

  @objc override static func requiresMainQueueSetup() -> Bool { return false }

  @objc func start() {
    WatchHub.shared.activate()
  }

  @objc func sendState(_ json: String) {
    WatchHub.shared.sendState(json)
  }

  @objc func sendEvent(_ json: String) {
    WatchHub.shared.sendEvent(json)
  }

  @objc func sendClip(_ path: String, metaJson: String) {
    WatchHub.shared.sendClip(path: path, metaJson: metaJson)
  }

  @objc func getStatus(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(WatchHub.shared.status())
  }

  @objc func getClipDir(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(WatchHub.clipDir.path)
  }

  /// Base64 of a clip file (plain path or file:// URL), to send it over the
  /// Agora data stream.
  @objc func readClipBase64(_ path: String, resolver resolve: RCTPromiseResolveBlock,
                            rejecter reject: RCTPromiseRejectBlock) {
    let url = WatchHub.fileURL(from: path)
    do {
      let data = try Data(contentsOf: url)
      resolve(data.base64EncodedString())
    } catch {
      reject("E_READ_CLIP", "Cannot read \(url.path): \(error.localizedDescription)", error)
    }
  }

  /// Writes a received clip into getClipDir() and resolves its absolute path.
  /// Like any file there, it is deleted by sendClip.
  @objc func writeClip(_ base64: String, ext: String, resolver resolve: RCTPromiseResolveBlock,
                       rejecter reject: RCTPromiseRejectBlock) {
    guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters), !data.isEmpty else {
      reject("E_WRITE_CLIP", "Clip is not valid base64", nil)
      return
    }
    let clean = ext.lowercased().filter { $0.isLetter || $0.isNumber }
    let suffix = clean.isEmpty || clean.count > 5 ? "m4a" : clean
    let name = "vc-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).\(suffix)"
    let url = WatchHub.clipDir.appendingPathComponent(name)
    do {
      try data.write(to: url, options: .atomic)
      resolve(url.path)
    } catch {
      reject("E_WRITE_CLIP", "Cannot write \(url.path): \(error.localizedDescription)", error)
    }
  }

  /// Opens Garmin Connect so the user picks the Garmin watches ComX may use.
  /// Rejects with E_GARMIN_CONNECT_MISSING when Garmin Connect is not installed.
  @objc func selectGarminDevices(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    GarminLink.shared.selectDevices { error in
      if let error = error {
        reject("E_GARMIN_CONNECT_MISSING", error, nil)
      } else {
        resolve(nil)
      }
    }
  }
}
