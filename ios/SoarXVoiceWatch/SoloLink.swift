import Foundation

// Solo mode: the watch talks to the relay itself. See "Watch modes" in
// docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md.

struct QueuedClip {
  var clip: RelayClip
  var url: URL
  var to: Int64?
  var ms: Int
}

final class SoloLink {
  static let syncInterval: TimeInterval = 10
  static let maxTexts = 20
  static let maxClips = 5
  /// A watch fix younger than this wins (same value as the phone).
  static let watchFixMaxAge: TimeInterval = 30

  /// The answer and the fix sent with that request.
  var onResponse: ((SyncResponse, RelayPosition?) -> Void)?
  var onClipSent: (() -> Void)?
  var onTextAcked: (() -> Void)?

  private(set) var lastSyncOK: Date?
  private(set) var texts: [RelayOutEvent] = []
  private(set) var clips: [QueuedClip] = []
  var name = ""
  var sos = false
  /// When `sos` last changed (epoch ms).
  var sosAt: Double = 0

  private let client = RelayClient()
  private let location = SoloLocation()
  private var settings: RelaySettings?
  private var timer: Timer?
  private var cursor: RelayCursor = 0
  private var syncing = false
  private var uploading = false

  func start(_ settings: RelaySettings, name: String) {
    self.settings = settings
    self.name = name
    cursor = 0
    lastSyncOK = nil
    location.start()
    tick()
    timer = Timer.scheduledTimer(withTimeInterval: SoloLink.syncInterval, repeats: true) { [weak self] _ in
      self?.tick()
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
    location.stop()
    settings = nil
  }

  /// What is left to hand over to the phone when it comes back.
  func drain() -> (texts: [RelayOutEvent], clips: [QueuedClip]) {
    defer {
      texts = []
      clips = []
    }
    return (texts, clips)
  }

  func enqueue(text: RelayOutEvent) {
    texts.append(text)
    if texts.count > SoloLink.maxTexts { texts.removeFirst() }
    tick()
  }

  func enqueue(clip: QueuedClip) {
    clips.append(clip)
    if clips.count > SoloLink.maxClips {
      // Oldest dropped; History keeps its own copy.
      try? FileManager.default.removeItem(at: clips.removeFirst().url)
    }
    uploadNext()
  }

  func download(id: String, done: @escaping (RelayClip?) -> Void) {
    guard let settings = settings else { return done(nil) }
    client.download(settings, id: id, done: done)
  }

  private func tick() {
    guard let settings = settings, !syncing else { return }
    syncing = true
    let fix = location.last
    let body = SyncRequest(uid: settings.uid, name: name, pos: fix, sos: sos, sosAt: sosAt,
                           cursor: cursor, events: texts)
    client.sync(settings, body) { [weak self] response in
      guard let self = self else { return }
      self.syncing = false
      guard let response = response else { return }
      self.lastSyncOK = Date()
      self.cursor = response.cursor
      self.texts.removeAll { response.acked.contains($0.id) }
      if !response.acked.isEmpty { self.onTextAcked?() }
      self.onResponse?(response, fix)
      self.uploadNext()
    }
  }

  private func uploadNext() {
    guard let settings = settings, !uploading, let next = clips.first else { return }
    uploading = true
    client.upload(settings, next.clip) { [weak self] ok in
      guard let self = self else { return }
      self.uploading = false
      guard ok else { return } // kept: the next sync tries again
      self.clips.removeAll { $0.clip.id == next.clip.id }
      // The relay has it; the file was only kept to hand it to the phone.
      try? FileManager.default.removeItem(at: next.url)
      self.onClipSent?()
      self.uploadNext()
    }
  }
}

enum SoloGeometry {
  static func distanceMeters(_ a: RelayPosition, _ b: RelayPosition) -> Double {
    let r = 6_371_000.0
    let dLat = (b.lat - a.lat) * .pi / 180
    let dLon = (b.lon - a.lon) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * r * asin(min(1, sqrt(h)))
  }

  static func bearingDegrees(_ a: RelayPosition, _ b: RelayPosition) -> Double {
    let lat1 = a.lat * .pi / 180
    let lat2 = b.lat * .pi / 180
    let dLon = (b.lon - a.lon) * .pi / 180
    let y = sin(dLon) * cos(lat2)
    let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
  }

  /// The riders of a relay answer, in the form the compass already draws.
  static func riders(_ response: SyncResponse, me: RelayPosition?, myUid: Int64) -> [Rider] {
    let nowMs = response.now
    return Dictionary(grouping: response.riders.filter { $0.uid != myUid }, by: { $0.uid }).map { uid, rows in
      let watch = rows.first { $0.source == "watch" }?.pos
      let phone = rows.first { $0.source == "phone" }?.pos
      let pos: RelayPosition?
      if let w = watch, nowMs - w.t <= SoloLink.watchFixMaxAge * 1000 {
        pos = w
      } else {
        pos = [watch, phone].compactMap { $0 }.max { $0.t < $1.t }
      }
      let both = pos.flatMap { p in me.map { (p, $0) } }
      return Rider(uid: uid, name: rows.first?.name, lat: pos?.lat, lon: pos?.lon, t: pos?.t,
                   dist: both.map { distanceMeters($0.1, $0.0).rounded() },
                   brg: both.map { bearingDegrees($0.1, $0.0) },
                   speaking: false, sos: rows.contains { $0.sos },
                   stale: pos.map { nowMs - $0.t > 30_000 } ?? true)
    }
  }
}
