import Foundation
import WatchConnectivity

/// WatchConnectivity on the watch side. Callbacks are delivered on the main
/// queue. Payloads carry the JSON string under "json" (see WatchBridge.swift).
final class PhoneLink: NSObject, WCSessionDelegate {
  var onJSON: ((String) -> Void)?
  var onClip: ((URL, ClipMeta?) -> Void)?
  var onReachability: ((Bool) -> Void)?
  var onActivated: (() -> Void)?

  private let jsonKey = "json"
  private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

  func activate() {
    guard let session = session else { return }
    session.delegate = self
    session.activate()
  }

  var isReachable: Bool { session?.isReachable ?? false }

  /// Last state the phone pushed while the app was not running.
  var lastContextJSON: String? {
    session?.receivedApplicationContext[jsonKey] as? String
  }

  /// Message when the phone is reachable, queued user-info transfer otherwise
  /// (delivered in order once the link is back).
  func send(_ json: String) {
    guard let session = session, session.activationState == .activated else { return }
    let payload: [String: Any] = [jsonKey: json]
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { _ in
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
  }

  func sendClip(_ url: URL, metaJSON: String) {
    guard let session = session, session.activationState == .activated else { return }
    session.transferFile(url, metadata: [jsonKey: metaJSON])
  }

  // MARK: - WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async {
      self.onActivated?()
      self.onReachability?(session.isReachable)
      if let json = self.lastContextJSON { self.onJSON?(json) }
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    DispatchQueue.main.async { self.onReachability?(reachable) }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    deliver(applicationContext)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    deliver(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    deliver(message)
    replyHandler([:])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    deliver(userInfo)
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    // The system deletes the inbox file when this returns: move it first.
    let fm = FileManager.default
    let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("rx", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let ext = file.fileURL.pathExtension.isEmpty ? "aac" : file.fileURL.pathExtension
    let dest = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    do {
      try fm.moveItem(at: file.fileURL, to: dest)
    } catch {
      NSLog("[Watch] could not keep clip: \(error)")
      return
    }
    var meta: ClipMeta?
    if let json = file.metadata?[jsonKey] as? String, let data = json.data(using: .utf8) {
      meta = try? JSONDecoder().decode(ClipMeta.self, from: data)
    }
    DispatchQueue.main.async { self.onClip?(dest, meta) }
  }

  func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
    if let error = error { NSLog("[Watch] clip upload failed: \(error)") }
    try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
  }

  private func deliver(_ payload: [String: Any]) {
    guard let json = payload[jsonKey] as? String else { return }
    DispatchQueue.main.async { self.onJSON?(json) }
  }
}
