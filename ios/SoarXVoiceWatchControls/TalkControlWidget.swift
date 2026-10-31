import AppIntents
import SwiftUI
import WidgetKit

// The ComX watch face complication (watchOS 10+) and controls (watchOS 26+).
// Settings > Action Button > ComX > Talk puts Talk on the Ultra's Action
// button; it also shows in Control Center and the Smart Stack. See
// docs/watch-ios.md.

@main
struct ComXControls: WidgetBundle {
  var body: some Widget {
    ComXComplication()
    if #available(watchOS 26.0, *) {
      TalkControl()
    }
  }
}

@available(watchOS 26.0, *)
struct TalkControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.xavier.comx.watchkitapp.controls.talk") {
      ControlWidgetButton(action: TalkControlIntent()) {
        Label("Talk", systemImage: "mic.fill")
      }
    }
    .displayName("Talk")
    .description("Start a voice message to your riders, or stop and send it.")
  }
}
