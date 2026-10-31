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

/// Makes a clip loud enough for the watch speaker. watchOS gives apps no way
/// to raise the system volume and AVAudioPlayer stops at 1.0, while voices
/// recorded by a phone in a pouch or by a watch at arm's length arrive very
/// quiet. So each clip is normalised to a strong level, and tanh rounds the
/// peaks off instead of clipping them.
enum ClipLoudness {
  static let targetRMS: Float = 0.25
  /// A silent clip must not turn into loud hiss.
  static let maxGain: Float = 30

  static func gain(rms: Float) -> Float {
    guard rms > 0 else { return 1 }
    return min(max(targetRMS / rms, 1), maxGain)
  }

  /// A louder copy in the temporary folder, nil if the clip cannot be decoded.
  static func boostedCopy(of url: URL) -> URL? {
    do {
      let input = try AVAudioFile(forReading: url)
      let format = input.processingFormat
      guard input.length > 0,
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(input.length)) else {
        return nil
      }
      try input.read(into: buffer)
      guard let channels = buffer.floatChannelData else { return nil }
      let frames = Int(buffer.frameLength)
      let count = Int(format.channelCount)

      var energy: Float = 0
      for c in 0..<count {
        for i in 0..<frames { energy += channels[c][i] * channels[c][i] }
      }
      let g = gain(rms: (energy / Float(max(frames * count, 1))).squareRoot())
      for c in 0..<count {
        for i in 0..<frames { channels[c][i] = tanh(channels[c][i] * g) }
      }

      let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent("loud-\(UUID().uuidString).caf")
      // The file is finished when `output` goes out of scope.
      do {
        let output = try AVAudioFile(forWriting: dest, settings: format.settings,
                                     commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        try output.write(from: buffer)
      }
      return dest
    } catch {
      NSLog("[Watch] cannot boost clip: \(error)")
      return nil
    }
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
  /// The louder copy being played, deleted with the clip.
  private var boosted: URL?
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
      // Leave the recording setup completely before playing on the speaker.
      if session.category != .playback { try? session.setActive(false) }
      try session.setCategory(.playback, mode: .default, policy: .default, options: [])
      try session.setActive(true)
      boosted = ClipLoudness.boostedCopy(of: item.url)
      let p = try AVAudioPlayer(contentsOf: boosted ?? item.url)
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
      removeBoosted()
      playNext()
    }
  }

  private func finishCurrent() {
    if let item = current { try? FileManager.default.removeItem(at: item.url) }
    removeBoosted()
    current = nil
    player = nil
    if queue.isEmpty { onIdle?() }
    playNext()
  }

  private func removeBoosted() {
    if let url = boosted { try? FileManager.default.removeItem(at: url) }
    boosted = nil
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    DispatchQueue.main.async { self.finishCurrent() }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    DispatchQueue.main.async { self.finishCurrent() }
  }
}
