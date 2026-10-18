import AVFoundation
import Foundation

/// Records one push-to-talk clip: AAC in .m4a, mono, 16 kHz, 16 kbit/s
/// (about 20 KB for 10 s, small enough for the Agora data stream).
final class ClipRecorder {
  private var recorder: AVAudioRecorder?
  private(set) var url: URL?
  /// Wall clock, not AVAudioRecorder.currentTime: in the simulator currentTime
  /// went negative, so the 30 s limit never fired and the clip was dropped.
  private var startedAt: Date?

  var isRecording: Bool { recorder?.isRecording ?? false }
  var elapsed: TimeInterval { startedAt.map { Date().timeIntervalSince($0) } ?? 0 }

  static func requestPermission(_ done: @escaping (Bool) -> Void) {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: done(true)
    case .denied: done(false)
    default:
      AVAudioApplication.requestRecordPermission { granted in
        DispatchQueue.main.async { done(granted) }
      }
    }
  }

  func start() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [])
    try session.setActive(true)

    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("tx", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("watch-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")

    let settings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: 16_000,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 16_000,
    ]
    let rec = try AVAudioRecorder(url: url, settings: settings)
    guard rec.record() else {
      throw NSError(domain: "SoarXVoiceWatch", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Recorder refused to start"])
    }
    recorder = rec
    self.url = url
    startedAt = Date()
  }

  /// Stops and returns the file with its duration, or nil if nothing usable.
  func stop() -> (URL, Int)? {
    guard let rec = recorder, let url = url else { return nil }
    let seconds = elapsed
    rec.stop()
    recorder = nil
    self.url = nil
    startedAt = nil
    let ms = Int(seconds * 1000)
    if ms < 300 { // a mis-tap, not a message
      try? FileManager.default.removeItem(at: url)
      return nil
    }
    return (url, ms)
  }

  func cancel() {
    recorder?.stop()
    recorder?.deleteRecording()
    recorder = nil
    url = nil
    startedAt = nil
  }
}

/// Plays incoming clips one after another on the watch speaker.
final class ClipPlayer: NSObject, AVAudioPlayerDelegate {
  struct Item { let url: URL; let from: String }

  var onStart: ((String) -> Void)?
  var onIdle: (() -> Void)?

  private var queue: [Item] = []
  private var player: AVAudioPlayer?
  private var current: Item?
  var paused = false { didSet { if !paused { playNext() } } }

  var isPlaying: Bool { player?.isPlaying ?? false }

  func enqueue(_ item: Item) {
    queue.append(item)
    if queue.count > 10 { // keep the latest; a backlog is useless out on the water
      let dropped = queue.removeFirst()
      try? FileManager.default.removeItem(at: dropped.url)
    }
    if player == nil { playNext() }
  }

  /// Stops the current clip (e.g. the rider starts talking).
  func interrupt() {
    player?.stop()
    finishCurrent()
  }

  private func playNext() {
    guard !paused, player == nil, !queue.isEmpty else { return }
    let item = queue.removeFirst()
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, policy: .default, options: [])
      try session.setActive(true)
      let p = try AVAudioPlayer(contentsOf: item.url)
      p.delegate = self
      p.volume = 1.0
      p.prepareToPlay()
      current = item
      player = p
      onStart?(item.from)
      p.play()
    } catch {
      NSLog("[Watch] cannot play clip: \(error)")
      try? FileManager.default.removeItem(at: item.url)
      playNext()
    }
  }

  private func finishCurrent() {
    if let item = current { try? FileManager.default.removeItem(at: item.url) }
    current = nil
    player = nil
    if queue.isEmpty { onIdle?() }
    playNext()
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    DispatchQueue.main.async { self.finishCurrent() }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    DispatchQueue.main.async { self.finishCurrent() }
  }
}
