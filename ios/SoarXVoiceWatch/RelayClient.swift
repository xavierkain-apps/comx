import Foundation

// Calls to the ComX relay. watchOS allows URLSession HTTP on cellular for every
// app, but not WebSockets (Apple TN3135), so the watch polls. Completions run
// on the main queue, with nil on any failure: the caller retries next time.

struct RelayPosition: Codable {
  var lat: Double
  var lon: Double
  var cog: Double?
  var sog: Double?
  var acc: Double
  var t: Double
}

struct RelayOutEvent: Codable {
  var id: String
  var type = "text"
  var msg: String
  var text: String
}

/// The relay cursor is opaque (epoch * 2^32 + seq) and exceeds 2^32, so it is
/// an Int64: Swift's Int is 32-bit on arm64_32 watches.
typealias RelayCursor = Int64

struct SyncRequest: Encodable {
  var uid: Int64
  var name: String
  var source = "watch"
  var pos: RelayPosition?
  var sos: Bool
  /// When this rider's SOS state last changed (epoch ms): the newest change wins.
  var sosAt: Double
  var cursor: RelayCursor
  var events: [RelayOutEvent]

  enum CodingKeys: String, CodingKey { case uid, name, source, pos, sos, sosAt, cursor, events }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(uid, forKey: .uid)
    try c.encode(name, forKey: .name)
    try c.encode(source, forKey: .source)
    try c.encode(pos, forKey: .pos) // explicit null before the first fix
    try c.encode(sos, forKey: .sos)
    try c.encode(sosAt, forKey: .sosAt)
    try c.encode(cursor, forKey: .cursor)
    try c.encode(events, forKey: .events)
  }
}

struct RelayRider: Decodable {
  var uid: Int64
  var name: String
  var source: String
  var pos: RelayPosition?
  var sos: Bool
  /// When the uid's SOS state last changed (epoch ms), the same on every row.
  var sosAt: Double?
  var seenAt: Double
}

struct RelayEvent: Decodable {
  var id: String
  var uid: Int64
  var from: String
  var to: Int64?
  var type: String
  var msg: String?
  var text: String?
  var active: Bool?
  var clip: String?
  var durationMs: Double?
  var ext: String?
  /// `sos`: when that SOS state was set (epoch ms).
  var at: Double?
  /// Relay time (epoch ms) at which the event was stored; absent from an older relay.
  var sentAt: Double?
}

/// The caller's own SOS state on the relay after its request.
struct RelaySelf: Decodable {
  var sos: Bool
  var sosAt: Double
}

struct SyncResponse: Decodable {
  var now: Double
  var riders: [RelayRider]
  var events: [RelayEvent]
  var cursor: RelayCursor
  var acked: [String]
  /// `self` in the JSON; absent from an older relay.
  var own: RelaySelf?

  enum CodingKeys: String, CodingKey {
    case now, riders, events, cursor, acked
    case own = "self"
  }
}

struct RelayClip: Codable {
  var id: String
  var uid: Int64
  var from: String
  var to: Int64
  var durationMs: Int
  var ext: String
  var data: String
}

final class RelayClient {
  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 8
    config.timeoutIntervalForResource = 30
    config.waitsForConnectivity = false
    config.allowsCellularAccess = true
    session = URLSession(configuration: config)
  }

  func sync(_ settings: RelaySettings, _ body: SyncRequest, done: @escaping (SyncResponse?) -> Void) {
    call(settings, path: "sync", body: body, done: done)
  }

  func upload(_ settings: RelaySettings, _ clip: RelayClip, done: @escaping (Bool) -> Void) {
    send(request(settings, path: "clips", body: try? JSONEncoder().encode(clip))) { data in done(data != nil) }
  }

  func download(_ settings: RelaySettings, id: String, done: @escaping (RelayClip?) -> Void) {
    send(request(settings, path: "clips/\(id)", body: nil)) { data in
      done(data.flatMap { try? JSONDecoder().decode(RelayClip.self, from: $0) })
    }
  }

  private func call<Req: Encodable, Res: Decodable>(_ settings: RelaySettings, path: String, body: Req,
                                                    done: @escaping (Res?) -> Void) {
    send(request(settings, path: path, body: try? JSONEncoder().encode(body))) { data in
      done(data.flatMap { try? JSONDecoder().decode(Res.self, from: $0) })
    }
  }

  private func request(_ settings: RelaySettings, path: String, body: Data?) -> URLRequest? {
    guard let url = URL(string: "\(settings.url)/v1/channels/\(settings.channelKey)/\(path)") else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = body == nil ? "GET" : "POST"
    req.httpBody = body
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.setValue(settings.key, forHTTPHeaderField: "x-comx-key")
    return req
  }

  private func send(_ request: URLRequest?, done: @escaping (Data?) -> Void) {
    guard let request = request else { return done(nil) }
    session.dataTask(with: request) { data, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(ok ? data : nil) }
    }.resume()
  }
}
