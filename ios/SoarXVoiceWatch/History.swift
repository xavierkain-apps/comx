import Foundation

// The last messages sent and received, text and voice, for the History page:
// a voice message that was not understood can be played again. Kept in
// memory for the session only. Voice clips are copied into Caches/history,
// because the player and the file transfer delete their own copies.

struct HistoryItem: Identifiable, Equatable {
  enum Kind: Equatable {
    case text(String)
    case voice(URL, durationMs: Int?)
  }

  let id = UUID()
  let at = Date()
  /// Sender name; for what I sent, the recipient ("Group" or a rider).
  let who: String
  let outgoing: Bool
  let isPrivate: Bool
  let kind: Kind
}

final class MessageHistory {
  static let maxItems = 30
  /// Voice clips kept on disk (about 20 KB per 10 s).
  static let maxClips = 10

  private(set) var items: [HistoryItem] = []
  private let dir: URL

  init() {
    dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("history", isDirectory: true)
    // The history does not outlive the app: clear what a previous run left.
    try? FileManager.default.removeItem(at: dir)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  /// Copies a clip into the history folder, nil if the copy failed.
  func keepClip(_ url: URL) -> URL? {
    let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension
    let dest = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    do {
      try FileManager.default.copyItem(at: url, to: dest)
      return dest
    } catch {
      NSLog("[Watch] cannot keep clip for history: \(error)")
      return nil
    }
  }

  /// Newest first. Drops the oldest items, and the oldest voice items beyond
  /// `maxClips`, deleting their files.
  func add(_ item: HistoryItem) {
    items.insert(item, at: 0)
    var clips = 0
    items = items.enumerated().compactMap { index, it in
      guard case .voice(let url, _) = it.kind else {
        return index < MessageHistory.maxItems ? it : nil
      }
      clips += 1
      if index < MessageHistory.maxItems, clips <= MessageHistory.maxClips { return it }
      try? FileManager.default.removeItem(at: url)
      return nil
    }
  }

  /// A throwaway copy for the player, which deletes what it has played.
  func playableCopy(of url: URL) -> URL? {
    let dest = FileManager.default.temporaryDirectory
      .appendingPathComponent("replay-\(UUID().uuidString).\(url.pathExtension)")
    return (try? FileManager.default.copyItem(at: url, to: dest)).map { dest }
  }
}
