import SwiftUI

// "Signal · Radar" palette and type (design_handoff_comx_signal_radar).
// Teal = normal or listening, yellow = someone speaking, red = SOS.

enum Theme {
  static let bg = Color(hex: 0x071518)
  static let surface = Color(hex: 0x0F2327)
  static let surfaceAlt = Color(hex: 0x12282C)
  static let ring = Color(hex: 0x16343A)
  static let outline = Color(hex: 0x2A4448)
  static let text = Color(hex: 0xEAF4F3)
  static let textMuted = Color(hex: 0x7FA3A6)
  static let textDim = Color(hex: 0x4E7276)
  static let teal = Color(hex: 0x2ED3C4)
  static let yellow = Color(hex: 0xFFD23F)
  static let red = Color(hex: 0xFF453A)
  static let amber = Color(hex: 0xFFB020)
  /// Text and icons on a teal or yellow fill.
  static let onAccent = Color(hex: 0x071518)
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255)
  }
}

extension Font {
  /// Headings, names, distances, button labels (Barlow Condensed on the
  /// phone; the system font's condensed width here). Use with uppercase text.
  static func condensed(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font {
    .system(size: size, weight: weight).width(.condensed)
  }

  /// Secondary sentences ("Voice, 6 s", "Action button").
  static func plain(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight)
  }
}

extension View {
  /// Small spaced uppercase label above a block ("HISTORY", "TARIFA-01 · GROUP").
  func overline(_ color: Color = Theme.textMuted) -> some View {
    font(.condensed(12, .bold)).tracking(2).textCase(.uppercase).foregroundStyle(color)
  }
}
