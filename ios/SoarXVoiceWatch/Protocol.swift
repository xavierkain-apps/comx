import Foundation

// Phone <-> watch JSON protocol, version 1. Source of truth:
// docs/watch-companion.md. Every field is optional on decode so a phone build
// that adds or omits a field never blanks the watch.

struct MePosition: Decodable {
  var name: String?
  var lat: Double?
  var lon: Double?
  var cog: Double?
  var sog: Double?
  var t: Double?
}

struct Rider: Decodable, Identifiable, Equatable {
  var uid: Int
  var name: String?
  var lat: Double?
  var lon: Double?
  var t: Double?
  var dist: Double?
  var brg: Double?
  var speaking: Bool?
  var sos: Bool?
  var stale: Bool?

  var id: Int { uid }
  var displayName: String { (name?.isEmpty == false ? name! : "Rider \(uid)") }
  var isSpeaking: Bool { speaking ?? false }
  var isSOS: Bool { sos ?? false }
  var isStale: Bool { stale ?? false }
}

struct PhoneState: Decodable {
  var v: Int?
  var kind: String?
  var connected: Bool?
  var channel: String?
  var watchMode: Bool?
  var me: MePosition?
  var riders: [Rider]?
  var ts: Double?
}

struct PhoneEvent: Decodable {
  var v: Int?
  var kind: String?
  var type: String?
  var uid: Int?
  var from: String?
  var active: Bool?
  var id: String?
  var text: String?
  var dist: Double?
  var brg: Double?
}

struct ClipMeta: Decodable {
  var v: Int?
  var kind: String?
  var uid: Int?
  var from: String?
  var durationMs: Double?
  /// The sender addressed this clip to us only (ComX targeted message).
  var isPrivate: Bool?

  enum CodingKeys: String, CodingKey {
    case v, kind, uid, from, durationMs
    case isPrivate = "private"
  }
}

/// Only used to read "kind" before decoding the full payload.
private struct KindProbe: Decodable { var kind: String? }

enum Incoming {
  case state(PhoneState)
  case event(PhoneEvent)
  case unknown

  static func parse(_ json: String) -> Incoming {
    guard let data = json.data(using: .utf8) else { return .unknown }
    let decoder = JSONDecoder()
    guard let probe = try? decoder.decode(KindProbe.self, from: data) else { return .unknown }
    switch probe.kind {
    case "state":
      if let s = try? decoder.decode(PhoneState.self, from: data) { return .state(s) }
    case "event":
      if let e = try? decoder.decode(PhoneEvent.self, from: data) { return .event(e) }
    default:
      break
    }
    return .unknown
  }
}

enum Outgoing {
  static func encode(_ object: [String: Any]) -> String {
    var obj = object
    obj["v"] = 1
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
          let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }

  static func text(_ m: QuickMessage) -> String {
    encode(["kind": "text", "id": m.rawValue, "text": m.label])
  }

  static func sos(active: Bool) -> String {
    encode(["kind": "sos", "active": active])
  }

  static func hello(model: String, hasCompass: Bool) -> String {
    encode(["kind": "hello", "platform": "watchos", "model": model, "hasCompass": hasCompass])
  }

  /// `to`: uid of the one rider the clip is for; nil = the whole group
  /// (the key is then omitted, which the contract reads as group).
  static func clipMeta(durationMs: Int, to: Int?) -> String {
    var obj: [String: Any] = ["kind": "clip", "durationMs": durationMs]
    if let to = to { obj["to"] = to }
    return encode(obj)
  }
}

/// Fixed ids so every watch platform can label them in its own language.
enum QuickMessage: String, CaseIterable, Identifiable {
  case ok, back, wait, `where`, gear, help

  var id: String { rawValue }

  var label: String {
    switch self {
    case .ok: return "All good"
    case .back: return "Heading back"
    case .wait: return "Wait for me"
    case .where: return "Where are you?"
    case .gear: return "Gear broken"
    case .help: return "I need help"
    }
  }

  var symbol: String {
    switch self {
    case .ok: return "hand.thumbsup.fill"
    case .back: return "arrow.uturn.backward"
    case .wait: return "hand.raised.fill"
    case .where: return "questionmark"
    case .gear: return "wrench.fill"
    case .help: return "exclamationmark.triangle.fill"
    }
  }

  static func label(forId id: String?, fallback: String?) -> String {
    if let id = id, let m = QuickMessage(rawValue: id) { return m.label }
    return fallback ?? ""
  }
}

enum Format {
  static func distance(_ metres: Double?) -> String {
    guard let m = metres, m.isFinite else { return "--" }
    if m < 1000 { return "\(Int(m.rounded())) m" }
    if m < 10_000 { return String(format: "%.1f km", m / 1000) }
    return "\(Int((m / 1000).rounded())) km"
  }

  /// Under a radar badge, no unit: "180", "1.4K", "12K", "--".
  static func short(_ metres: Double?) -> String {
    guard let m = metres, m.isFinite else { return "--" }
    if m < 1000 { return "\(Int(m.rounded()))" }
    if m < 10_000 { return String(format: "%.1fK", m / 1000) }
    return "\(Int((m / 1000).rounded()))K"
  }
}
