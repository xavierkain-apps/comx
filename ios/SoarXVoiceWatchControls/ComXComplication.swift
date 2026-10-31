import SwiftUI
import WidgetKit

// Watch face complication: shows ComX on the face, a tap opens the app. It has
// no live data, so a single timeline entry that never refreshes is enough.

private struct ComXEntry: TimelineEntry {
  let date: Date
}

private struct ComXTimeline: TimelineProvider {
  func placeholder(in context: Context) -> ComXEntry { ComXEntry(date: Date()) }

  func getSnapshot(in context: Context, completion: @escaping (ComXEntry) -> Void) {
    completion(ComXEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ComXEntry>) -> Void) {
    completion(Timeline(entries: [ComXEntry(date: Date())], policy: .never))
  }
}

/// The radar of the app: two rings and the "me" arrow.
private struct RadarMark: View {
  private let teal = Color(red: 0x2E / 255, green: 0xD3 / 255, blue: 0xC4 / 255)

  var body: some View {
    ZStack {
      Circle().stroke(teal, lineWidth: 2)
      Circle().stroke(teal.opacity(0.6), lineWidth: 1.5).padding(7)
      Image(systemName: "location.north.fill")
        .resizable()
        .scaledToFit()
        .padding(12)
        .foregroundStyle(.white)
    }
    .widgetAccentable()
  }
}

private struct ComplicationView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch family {
    case .accessoryRectangular:
      HStack(spacing: 8) {
        RadarMark().frame(width: 36, height: 36)
        Text("ComX").font(.headline)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    case .accessoryInline:
      Label("ComX", systemImage: "location.north.fill")
    case .accessoryCorner:
      Image(systemName: "location.north.circle.fill")
        .font(.title2)
        .widgetLabel("ComX")
    default:
      RadarMark().padding(2)
    }
  }
}

struct ComXComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "com.xavier.comx.watchkitapp.complication", provider: ComXTimeline()) { _ in
      ComplicationView()
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName("ComX")
    .description("Open ComX from the watch face.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
  }
}
