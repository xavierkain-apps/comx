# ComX step 2: Apple Watch "Signal · Radar" restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Apple Watch app looks like the "2b Signal · Radar" handoff (dark teal palette, condensed uppercase type, radar badges, Talk circle, History markers) with its navigation and behaviour unchanged.

**Architecture:** A new `Theme.swift` holds the palette and the condensed font helpers. Every view in `Views.swift` switches to it; the Talk page and the recording pages share a new `TalkCircle` view. No change to `AppModel`, the protocol, the crown paging, the Action button control or the history logic. One small pure helper is added: `Format.short` (badge distances).

**Tech Stack:** SwiftUI, watchOS 10+ (`Font.width(.condensed)`, `.containerBackground(_:for: .tabView)`), Xcode 27, watch simulator (Series 11 46 mm and Ultra 3 49 mm), the iPhone simulator in demo mode for live data.

**Spec:** `docs/superpowers/specs/2026-10-18-comx-standalone-signal-radar-design.md` ("Visual system", "Step 2: Apple Watch restyle") and `design_handoff_comx_signal_radar/README.md` ("Watch: three main pages"). Open `design_handoff_comx_signal_radar/comx-2b-signal-radar.html` in a browser for the target look.

**Testing note:** the watch target has no XCTest target, and adding one is out of scope (this includes `Format.short`, checked on screen: "180" under 1000 m, "1.4K" above, "--" without a distance). Each task is verified by building the watch target and by a simulator screenshot checked against the "Expected" list of the task. Logic is not touched, so the existing `npx jest` suite and the CI watch build check stay the safety net.

**Repository rules:** work on branch `watch-signal-radar` from `main` of `xavierkain-apps/comx`; open a pull request, never push to `main` (the ComX server session reviews and merges); commit messages without any AI attribution trailer.

---

## Files

| File | Responsibility |
|---|---|
| `ios/SoarXVoiceWatch/Theme.swift` (new) | Palette (`Theme.*` colours), `Font.condensed(_:_:)`, `Font.plain(_:_:)`, `View.overline()` |
| `ios/SoarXVoiceWatch/Protocol.swift` | `Format.short` for badge distances |
| `ios/SoarXVoiceWatch/Views.swift` | Every view restyled; new `TalkCircle` |
| `ios/SoarXVoice.xcodeproj/project.pbxproj` | `Theme.swift` added by `scripts/add-watch-target.rb` (never edit by hand) |
| `docs/watch-ios.md` | "Watch app" section: the look |

## Build and screenshot commands (used by every task)

Build the watch app for the simulator:

```bash
cd ios && xcodebuild -project SoarXVoice.xcodeproj -target SoarXVoiceWatch \
  -sdk watchsimulator -configuration Debug CODE_SIGNING_ALLOWED=NO \
  SYMROOT="$PWD/../build-watch" build 2>&1 | grep -E "error|\*\* BUILD"; cd ..
```

Expected: `** BUILD SUCCEEDED **`.

Install, launch and capture (W = the watch simulator UDID paired with the iPhone simulator, `xcrun simctl list pairs`):

```bash
APP=build-watch/Debug-watchsimulator/SoarXVoiceWatch.app
codesign --force --sign - --timestamp=none "$APP/PlugIns/SoarXVoiceWatchControls.appex"
codesign --force --sign - --timestamp=none "$APP"
xcrun simctl install "$W" "$APP"
xcrun simctl launch --terminate-running-process "$W" com.xavier.comx.watchkitapp
sleep 8 && xcrun simctl io "$W" screenshot /tmp/watch.png
```

Live data: on the paired iPhone simulator, open ComX → Settings → Demo riders ON (three riders at 150, 450 and 900 m). Set a location first: `xcrun simctl location "$P" set 36.0143,-5.6044`. Swipe left/right on the watch to change horizontal page; scroll the crown (or swipe down/up) for the vertical compass pages.

---

### Task 1: Theme

**Files:**
- Create: `ios/SoarXVoiceWatch/Theme.swift`
- Modify: `ios/SoarXVoice.xcodeproj/project.pbxproj` (by script)

- [ ] **Step 1: Switch to the branch**

The branch `watch-signal-radar` already exists on `origin`, starting with this plan:

```bash
git fetch origin && git switch watch-signal-radar && git pull --ff-only
```

- [ ] **Step 2: Write `Theme.swift`**

```swift
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
```

- [ ] **Step 3: Add the file to the watch target**

```bash
export LANG=en_US.UTF-8 && bundle exec ruby scripts/add-watch-target.rb
```

Expected: `file ref SoarXVoiceWatch/Theme.swift` and `Theme.swift -> SoarXVoiceWatch Sources`.

- [ ] **Step 4: Build**

Run the build command. Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add ios/SoarXVoiceWatch/Theme.swift ios/SoarXVoice.xcodeproj/project.pbxproj
git commit -m "feat(watch): Signal · Radar palette and condensed type"
```

Only those two files: `pod install` leaves unrelated changes in `project.pbxproj` and `Podfile.lock` on a local machine. If `git diff --cached ios/SoarXVoice.xcodeproj/project.pbxproj` shows lines other than the `Theme.swift` references, run `git checkout -- ios/SoarXVoice.xcodeproj/project.pbxproj`, rerun Step 3 and stage again.

### Task 2: App background and status line

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`ContentView`, `StatusLine`)

- [ ] **Step 1: Page backgrounds**

In `ContentView.body`, replace the `TabView` block with:

```swift
        TabView(selection: $page) {
          CompassView().tag(0)
            .containerBackground(Theme.bg, for: .tabView)
          RidersView(onSelect: { uid in
            model.select(uid)
            page = 0
          }).tag(1)
            .containerBackground(Theme.bg, for: .tabView)
          MessagesView().tag(2)
            .containerBackground(Theme.bg, for: .tabView)
          HistoryView().tag(3)
            .containerBackground(Theme.bg, for: .tabView)
        }
        .tabViewStyle(.page)
```

- [ ] **Step 2: Status line**

Replace the whole `StatusLine` struct with:

```swift
struct StatusLine: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    HStack(spacing: 4) {
      Circle()
        .fill(dotColor)
        .frame(width: 8, height: 8)
      Text(statusText)
        .font(.condensed(13, .semibold))
        .tracking(2)
        .textCase(.uppercase)
        .foregroundStyle(dotColor)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Spacer(minLength: 0)
      if !model.workoutRunning {
        Image(systemName: "bolt.slash.fill").foregroundStyle(Theme.amber).font(.system(size: 12))
      }
    }
  }

  private var dotColor: Color {
    model.channelConnected ? Theme.teal : (model.linkUp ? Theme.amber : Theme.red)
  }

  private var statusText: String {
    if !model.linkUp { return "No phone" }
    if !(model.state?.connected ?? false) { return "Not in channel" }
    return model.state?.channel ?? "Connected"
  }
}
```

- [ ] **Step 3: Build and check**

Build, install, launch with demo riders on. Expected screenshot: background `#071518` (dark teal-black, not pure black) on the radar page and on the Riders, Messages and History pages; status line "● DEMO" in teal condensed caps, spaced.

- [ ] **Step 4: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): teal-black pages and a Signal status line"
```

### Task 3: Radar

**Files:**
- Modify: `ios/SoarXVoiceWatch/Protocol.swift` (`Format`)
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`OverviewPage`, `RiderBadge`)

- [ ] **Step 1: Short distance for badges**

In `Protocol.swift`, inside `enum Format`, after `distance(_:)`, add:

```swift
  /// Under a radar badge, no unit: "180", "1.4K", "12K", "--".
  static func short(_ metres: Double?) -> String {
    guard let m = metres, m.isFinite else { return "--" }
    if m < 1000 { return "\(Int(m.rounded()))" }
    if m < 10_000 { return String(format: "%.1fK", m / 1000) }
    return "\(Int((m / 1000).rounded()))K"
  }
```

- [ ] **Step 2: Badge size**

In `OverviewPage`, change `static let badge: CGFloat = 28` to:

```swift
  static let badge: CGFloat = 34
```

(`spread` keeps `minGap = badge + 10`, so badges and their distance stay apart.)

- [ ] **Step 3: Rings, N mark, "me" arrow**

In `OverviewPage.body`, replace the `Text("N")` and `Image(systemName: "location.north.fill")` blocks with:

```swift
          Text("N")
            .font(.condensed(15))
            .foregroundStyle(Theme.red)
            .position(point(centre, radius + 10, angle: -model.heading.0, fraction: 1))
          Image(systemName: "location.north.fill")
            .resizable()
            .scaledToFit()
            .frame(width: 14, height: 16)
            .foregroundStyle(Theme.text)
            .position(centre)
```

Replace the whole `ring(_:_:label:lineWidth:)` function with:

```swift
  private func ring(_ c: CGPoint, _ r: CGFloat, label: String, lineWidth: CGFloat) -> some View {
    ZStack {
      Circle()
        .stroke(Theme.ring, lineWidth: lineWidth)
        .frame(width: r * 2, height: r * 2)
        .position(c)
      // Label at the bottom right of the ring, where N rarely is.
      Text(label)
        .font(.condensed(11, .semibold))
        .textCase(.uppercase)
        .foregroundStyle(Theme.textDim)
        .padding(.horizontal, 2)
        .background(Capsule().fill(Theme.bg))
        .position(point(c, r, angle: 135, fraction: 1))
    }
  }
```

In the "riders without a position" `Text` under the `GeometryReader`, replace `.font(.system(size: 13, weight: .bold))` and `.foregroundStyle(.secondary)` with `.font(.condensed(13, .bold))` and `.foregroundStyle(Theme.textMuted)`.

- [ ] **Step 4: Badges**

Replace the `body` and `color` of `RiderBadge` (keep `initials`) with:

```swift
  var body: some View {
    let d: CGFloat = rider.isSOS ? OverviewPage.badge + 6 : OverviewPage.badge
    VStack(spacing: 1) {
      Text(RiderBadge.initials(rider))
        .font(.condensed(rider.isSOS ? 17 : 15))
        .foregroundStyle(rider.isSOS ? Theme.text : Theme.onAccent)
        .minimumScaleFactor(0.6)
        .frame(width: d, height: d)
        .background(Circle().fill(color))
      Text(Format.short(rider.dist))
        .font(.condensed(12, .bold))
        .foregroundStyle(Theme.text)
        .fixedSize()
    }
    // Centre the badge, not the badge + label, on the rider's spot.
    .offset(y: 8)
    .opacity(rider.isStale ? 0.4 : 1)
  }

  private var color: Color {
    if rider.isSOS { return Theme.red }
    if rider.isSpeaking { return Theme.yellow }
    return Theme.teal
  }
```

- [ ] **Step 5: Build and check**

Expected screenshot of the radar page (demo, north up): white "me" arrow 14 × 16 at the centre; outer ring 3 pt and inner ring 2 pt in `#16343A`; ring labels "900 M" / "200 M" small and dim; red "N" above the outer ring; three 34 pt teal badges with dark initials "L", "T", "M" and "150", "450", "900" under them in white, no black capsule; badges do not overlap each other or their numbers. Turn on "Simulate an SOS from Tom" on the phone, dismiss the alert, scroll the crown up to the radar: "T" is red, bigger, with light initials.

- [ ] **Step 6: Commit**

```bash
git add ios/SoarXVoiceWatch/Protocol.swift ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Signal radar badges and rings"
```

### Task 4: Talk circle (talk page and recording pages)

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`CompassView`, `CompassPage`, `TalkTargetPage`, `TalkButton`, `RoundWhenBig`)

The talk page shows the channel and a 150 pt teal circle; while recording, each recipient page shows the recipient and the same circle in red with the seconds left. The crown still moves between recipients (pages), as today.

- [ ] **Step 1: `TalkCircle`**

Add after the `TalkTargetPage` struct:

```swift
/// The big round talk control: teal "TALK" (Action button hint), red
/// "SEND n" while recording. Double tap and the Action button do the same.
struct TalkCircle: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    Button(action: { model.toggleTalk() }) {
      VStack(spacing: 2) {
        Text(model.isRecording ? "SEND \(secondsLeft)" : "TALK")
          .font(.condensed(36))
          .tracking(1)
        Text(model.isRecording ? "Tap to send" : "Action button")
          .font(.plain(12))
      }
      .foregroundStyle(model.isRecording ? Theme.text : Theme.onAccent)
      .frame(maxWidth: 150, maxHeight: 150)
      .aspectRatio(1, contentMode: .fit)
      .background(Circle().fill(model.isRecording ? Theme.red : Theme.teal))
    }
    .buttonStyle(.plain)
    .primaryActionShortcut()
    .accessibilityLabel(model.isRecording ? "Stop and send" : "Talk")
  }

  private var secondsLeft: Int { max(0, Int(AppModel.maxClipSeconds - model.recordingElapsed)) }
}
```

- [ ] **Step 2: Talk page content**

In `CompassPage.body`, replace

```swift
      if talk == .big {
        // The talk page: one huge button, the easiest target with wet fingers.
        TalkButton(big: true).frame(maxHeight: .infinity)
      } else {
```

with

```swift
      if talk == .big {
        // The talk page: one huge button, the easiest target with wet fingers.
        VStack(spacing: 10) {
          Text("\(model.state?.channel ?? "ComX") · Group").overline()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          TalkCircle()
          if model.micDenied {
            Text("Microphone off: allow it in Settings").font(.plain(12)).foregroundStyle(Theme.amber)
          }
        }
        .frame(maxHeight: .infinity)
      } else {
```

and in the same body replace the speaking label block with:

```swift
      if let who = model.speakingLabel, !model.isRecording {
        Text(who)
          .font(.condensed(14, .bold))
          .textCase(.uppercase)
          .foregroundStyle(Theme.yellow)
          .lineLimit(1)
      }
```

- [ ] **Step 3: Recording pages use the circle**

In `CompassView.body`, in the `if model.isRecording` branch, change

```swift
            CompassPage { TalkTargetPage(uid: uid) }.page(uid ?? CompassView.group)
```

to

```swift
            CompassPage(talk: .none) { TalkTargetPage(uid: uid) }.page(uid ?? CompassView.group)
```

Replace the whole `TalkTargetPage` struct with:

```swift
/// While recording: who the clip goes to (nil = the whole group), over the
/// red send circle. The crown moves to the next recipient page.
struct TalkTargetPage: View {
  @EnvironmentObject var model: AppModel
  let uid: Int?

  var body: some View {
    let rider = uid.flatMap { model.rider($0) }
    VStack(spacing: 10) {
      Text("To \(uid == nil ? "Group" : rider?.displayName ?? "Rider \(uid!)")")
        .overline(uid == nil ? Theme.textMuted : Theme.yellow)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      TalkCircle()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
```

- [ ] **Step 4: Remove the big variant of `TalkButton`**

`TalkButton(big:)` is no longer used. In `TalkButton`, delete `var big = false` and its comment, replace `big ? 30 : 22` with `22` (twice), replace `.frame(maxWidth: .infinity, minHeight: 50, maxHeight: big ? .infinity : nil)` with `.frame(maxWidth: .infinity, minHeight: 50)`, delete `.modifier(RoundWhenBig(big: big))`, and delete the whole `RoundWhenBig` struct. Then restyle its colours: `.foregroundStyle(.white)` becomes `.foregroundStyle(model.isRecording ? Theme.text : Theme.onAccent)`, `Color.red` becomes `Theme.red`, `Color.blue` becomes `Theme.teal`, both `.font(.system(size: 22, ...))` become `.font(.condensed(22))`, and the "To:" label colours `.white` / `.yellow` become `Theme.text` / `Theme.yellow`.

Run: `grep -n "big\|RoundWhenBig" ios/SoarXVoiceWatch/Views.swift`
Expected: only `case none, normal, big`, `talk == .big` and `CompassPage(talk: .big)`.

- [ ] **Step 5: Build and check**

Expected screenshots:
- Talk page (crown up from the radar): overline "DEMO · GROUP" spaced, muted; a 150 pt teal circle with "TALK" in big dark condensed caps and "Action button" under it.
- After a tap on TALK: overline "TO GROUP"; red circle "SEND 29", "Tap to send". Crown down one page: overline "TO LEA (DEMO)" in yellow, same red circle. Tap: the clip is sent and the app returns to the radar.

- [ ] **Step 6: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Talk circle on the talk and recipient pages"
```

### Task 5: Rider page and rider list

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`RiderPage`, `RidersView`, `HeadingSourceRow`, `RiderRow`)

- [ ] **Step 1: Rider page**

Replace the `body` of `RiderPage` (keep `position`) with:

```swift
  var body: some View {
    VStack(spacing: 1) {
      HStack(spacing: 4) {
        if rider.isSOS {
          Text("SOS").font(.condensed(16)).foregroundStyle(Theme.red)
        }
        Text(rider.displayName)
          .font(.condensed(26))
          .textCase(.uppercase)
          .foregroundStyle(rider.isSpeaking ? Theme.yellow : Theme.text)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        if let pos = position, pos.1 > 1 {
          Text("\(pos.0)/\(pos.1)").font(.condensed(13, .semibold)).foregroundStyle(Theme.textMuted)
        }
      }
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS ? Theme.red : Theme.teal)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(2)
        .opacity(rider.isStale ? 0.4 : 1)
      Text(rider.isStale ? "\(Format.distance(rider.dist)) old" : Format.distance(rider.dist))
        .font(.condensed(40))
        .textCase(.uppercase)
        .foregroundStyle(Theme.text)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
  }
```

- [ ] **Step 2: Rider list**

In `RidersView`, replace `.listRowBackground(rider.isSOS ? Color.red.opacity(0.85) : Color.clear)` with:

```swift
        .listRowBackground(
          RoundedRectangle(cornerRadius: 14)
            .fill(rider.isSOS ? Theme.red : (rider.isSpeaking ? Theme.yellow : Theme.surfaceAlt)))
```

and replace the empty-list `Text` styling (`.font(.title3)`, `.foregroundStyle(.secondary)`) with `.font(.condensed(18, .bold))` and `.foregroundStyle(Theme.textMuted)`.

In `HeadingSourceRow`, replace `Text(source).font(.footnote).foregroundStyle(.secondary)` with:

```swift
    Text(source).overline().listRowBackground(Color.clear)
```

Replace the `body` of `RiderRow` with:

```swift
  var body: some View {
    let ink: Color = rider.isSOS ? Theme.text : (rider.isSpeaking ? Theme.onAccent : Theme.text)
    HStack(spacing: 10) {
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS || rider.isSpeaking ? ink : Theme.teal)
        .frame(width: 22, height: 24)
      Text(rider.displayName)
        .font(.condensed(20))
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Spacer(minLength: 0)
      Text(rider.dist == nil ? "No GPS" : Format.distance(rider.dist))
        .font(rider.dist == nil ? .plain(13) : .condensed(22))
        .textCase(rider.dist == nil ? nil : .uppercase)
    }
    .foregroundStyle(ink)
    .opacity(rider.isStale || rider.dist == nil ? 0.45 : 1)
  }
```

- [ ] **Step 3: Build and check**

Expected: rider page (crown down from the radar) "LEA (DEMO)" condensed caps, teal arrow, "150 M" very large. Riders page (swipe left): overline "ARROWS: NORTH UP", rows on `#12282C` rounded 14 with teal arrow, name and distance in condensed caps; with a demo voice playing, the speaking rider's row is yellow with dark text.

- [ ] **Step 4: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Signal rider page and rider list"
```

### Task 6: History

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`HistoryView`)

- [ ] **Step 1: Header and empty state**

In `HistoryView.body`, replace the `header:` closure content with:

```swift
        HStack {
          Text("History").overline()
          Spacer(minLength: 0)
          if let who = model.playingFrom {
            Label(who, systemImage: "speaker.wave.2.fill")
              .font(.condensed(12, .bold))
              .foregroundStyle(Theme.yellow)
              .lineLimit(1)
          }
        }
```

and replace `Text("No messages yet").foregroundStyle(.secondary)` with:

```swift
          Text("No messages yet").font(.plain(13)).foregroundStyle(Theme.textMuted)
            .listRowBackground(Color.clear)
```

- [ ] **Step 2: Rows**

In the `ForEach`, give every row its background: replace the `if item.isVoice { … } else { … }` block with:

```swift
          Group {
            if item.isVoice {
              Button { model.replay(item) } label: { row(item) }
            } else {
              row(item)
            }
          }
          .listRowBackground(
            RoundedRectangle(cornerRadius: 12)
              .fill(item.id == newestVoiceId ? Theme.surfaceAlt : Color.clear))
```

Add to `HistoryView`:

```swift
  /// The newest voice message gets a highlighted row (the one to replay).
  private var newestVoiceId: UUID? { model.history.first(where: { $0.isVoice })?.id }
```

Replace the whole `row(_:)` function with:

```swift
  private func row(_ item: HistoryItem) -> some View {
    HStack(spacing: 8) {
      // Yellow dot = voice (tap to replay), teal ring = text.
      Group {
        if item.isVoice {
          Circle().fill(Theme.yellow)
        } else {
          Circle().strokeBorder(item.summary == "SOS" ? Theme.red : Theme.teal, lineWidth: 2)
        }
      }
      .frame(width: 26, height: 26)
      VStack(alignment: .leading, spacing: 0) {
        Text("\(item.outgoing ? "To \(item.who)" : item.who) · \(HistoryView.time.string(from: item.at))")
          .font(.condensed(14, .bold))
          .textCase(.uppercase)
          .foregroundStyle(item.isPrivate ? Theme.yellow : Theme.text)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(item.summary)
          .font(.plain(13))
          .foregroundStyle(item.summary == "SOS" ? Theme.red : (item.isVoice ? Theme.textMuted : Theme.text))
          .lineLimit(2)
          .minimumScaleFactor(0.7)
      }
    }
  }
```

- [ ] **Step 3: Build and check**

Send "All good" from the Messages page and record a short clip, then swipe to History. Expected: overline "HISTORY"; rows "LEA (DEMO) · 15:35 / All good" with a teal ring, "TO GROUP · 15:36 / Voice, 4 s" with a yellow dot on a `#12282C` rounded row (newest voice); tap the voice row: header shows the yellow speaker label "Me".

- [ ] **Step 4: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Signal history rows"
```

### Task 7: Messages page

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`MessagesView`)

- [ ] **Step 1: Quick message pills**

Replace the `LazyVGrid { … }` block with:

```swift
      LazyVGrid(columns: columns, spacing: 6) {
        ForEach(QuickMessage.allCases) { m in
          Button { model.send(m) } label: {
            VStack(spacing: 2) {
              Image(systemName: m.symbol).font(.system(size: 18, weight: .bold))
              Text(m.label)
                .font(.condensed(15, .bold))
                .tracking(1)
                .textCase(.uppercase)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            }
            .foregroundStyle(m == .help ? Theme.amber : Theme.text)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(RoundedRectangle(cornerRadius: 22).fill(Theme.surfaceAlt))
          }
          .buttonStyle(.plain)
        }
      }
```

- [ ] **Step 2: SOS pill**

Replace the `if model.mySOSActive { … } else { … }` block with:

```swift
      if model.mySOSActive {
        Button { model.setSOS(false) } label: {
          Text("Cancel my SOS")
            .font(.condensed(20))
            .tracking(1)
            .textCase(.uppercase)
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(Capsule().fill(Theme.red))
        }
        .buttonStyle(.plain)
        .padding(.top, 6)
      } else {
        // Long press, then confirm: a wet screen must not raise an SOS.
        Text("Hold · SOS")
          .font(.condensed(22))
          .tracking(1)
          .textCase(.uppercase)
          .foregroundStyle(Theme.red)
          .frame(maxWidth: .infinity, minHeight: 58)
          .overlay(Capsule().strokeBorder(Theme.red, lineWidth: 2))
          .contentShape(Capsule())
          .onLongPressGesture(minimumDuration: 1.2) {
            WKInterfaceDevice.current().play(.click)
            confirmSOS = true
          }
          .padding(.top, 6)
      }
```

- [ ] **Step 3: Secondary rows**

For the "Water lock", "Input test" and "Start / End session" labels, add `.font(.plain(14))` and `.foregroundStyle(Theme.textMuted)` to each `Label`.

- [ ] **Step 4: Build and check**

Expected: six quick messages as dark `#12282C` rounded tiles with condensed caps labels ("I NEED HELP" in amber), a red outlined "HOLD · SOS" pill; holding it 1.2 s opens the "Send SOS to every rider?" confirmation (unchanged); after sending, a red filled "CANCEL MY SOS" pill.

- [ ] **Step 5: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Signal quick messages and SOS pill"
```

### Task 8: SOS alert and banner

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift` (`SOSAlertView`, `BannerView`)

- [ ] **Step 1: SOS alert**

Replace the `body` of `SOSAlertView` with:

```swift
  var body: some View {
    VStack(spacing: 2) {
      Text("SOS · \(alert.from)")
        .font(.condensed(22))
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      DirectionArrow(angle: model.arrowAngle(bearing: alert.brg), color: Theme.text)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(4)
      Text(Format.distance(alert.dist))
        .font(.condensed(40))
        .textCase(.uppercase)
      Button { model.dismissSOSAlert() } label: {
        Text("Dismiss")
          .font(.condensed(18))
          .textCase(.uppercase)
          .foregroundStyle(Theme.text)
          .frame(maxWidth: .infinity, minHeight: 44)
          .background(Capsule().fill(Theme.onAccent.opacity(0.35)))
      }
      .buttonStyle(.plain)
    }
    .foregroundStyle(Theme.text)
    .padding(6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.red.ignoresSafeArea())
  }
```

- [ ] **Step 2: Banner (incoming messages)**

Replace the `body` of `BannerView` with:

```swift
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(banner.title)
        .font(.condensed(13, .bold))
        .tracking(1)
        .textCase(.uppercase)
      Text(banner.body)
        .font(.condensed(20))
        .textCase(.uppercase)
        .lineLimit(2)
        .minimumScaleFactor(0.7)
    }
    .foregroundStyle(Theme.onAccent)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8)
    .background(RoundedRectangle(cornerRadius: 14).fill(Theme.yellow))
  }
```

- [ ] **Step 3: Build and check**

Expected: a demo quick message from Max shows a yellow banner "MAX (DEMO) / WAIT FOR ME" in dark text; "Simulate an SOS from Tom" shows a full red screen "SOS · TOM (DEMO)", a light arrow, "450 M" big, a darker "DISMISS" pill.

- [ ] **Step 4: Commit**

```bash
git add ios/SoarXVoiceWatch/Views.swift
git commit -m "feat(watch): Signal SOS alert and message banner"
```

### Task 9: Documentation, Ultra check, pull request

**Files:**
- Modify: `docs/watch-ios.md` ("Watch app" section)

- [ ] **Step 1: Document the look**

In `docs/watch-ios.md`, at the start of the "## Watch app" section, add:

```markdown
The look follows the "Signal · Radar" design (`design_handoff_comx_signal_radar/`):
teal-black background, teal for riders and Talk, yellow when someone speaks,
red for SOS, the system font's condensed width in uppercase for names,
distances and labels. Palette and type helpers: `Theme.swift`.
```

- [ ] **Step 2: Check the smallest and the largest case**

Boot the smallest watch simulator available (Apple Watch Series 11 42 mm; `xcrun simctl list devices | grep -i "watch"`) and the Apple Watch Ultra 3 (49 mm); install and launch on each as above (they run without the phone; pair the 42 mm one with an iPhone simulator in demo mode to see riders). Expected on both: the radar, the talk page (overline + 150 pt circle), a rider page ("150 M" at 40 pt), History and Messages are not clipped and nothing overlaps the clock.

If the talk circle or the overline is cut on the 42 mm case, cap the circle to the page: in `TalkCircle`, wrap the `Button` in

```swift
    GeometryReader { geo in
      let side = min(150, geo.size.width - 8, geo.size.height - 8)
      Button(action: { model.toggleTalk() }) { /* same label as above */ }
        .frame(width: side, height: side)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
```

replacing `.frame(maxWidth: 150, maxHeight: 150).aspectRatio(1, contentMode: .fit)` by `.frame(width: side, height: side)` on the label. If the rider page distance is cut, lower `.minimumScaleFactor(0.6)` to `0.45` on it.

- [ ] **Step 3: Full iOS scheme still builds**

```bash
cd ios && export LANG=en_US.UTF-8 && bundle exec pod install >/dev/null && \
xcodebuild -workspace SoarXVoice.xcworkspace -scheme SoarXVoice -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ../build-ios \
  CODE_SIGNING_ALLOWED=NO IPHONEOS_DEPLOYMENT_TARGET=15.1 build 2>&1 | grep -E "error:|\*\* BUILD"; cd ..
```

Expected: `** BUILD SUCCEEDED **`.

`pod install` adds its own lines to `project.pbxproj` and `Podfile.lock`; they must not reach the branch, but a plain checkout of `project.pbxproj` would also drop the `Theme.swift` lines of Task 1. Restore, then re-add `Theme.swift`:

```bash
git checkout -- ios/Podfile.lock ios/SoarXVoice.xcodeproj/project.pbxproj
git diff main -- ios/SoarXVoice.xcodeproj/project.pbxproj | grep '^[+-][^+-]'
```

Expected: only lines mentioning `Theme.swift` (the committed Task 1 change). If anything else shows, it was committed by mistake: fix the commit before the pull request.

- [ ] **Step 4: Commit, push the branch, open the pull request**

```bash
git add docs/watch-ios.md
git commit -m "docs(watch): Signal · Radar look"
git push -u origin watch-signal-radar
gh pr create -R xavierkain-apps/comx --base main --head watch-signal-radar \
  --title "Apple Watch: Signal · Radar restyle" \
  --body "Step 2 of docs/superpowers/specs/2026-10-18-comx-standalone-signal-radar-design.md. Restyle only: palette and condensed type (Theme.swift), radar badges, Talk circle on the talk and recipient pages, rider page and list, history rows, quick messages and SOS pill, SOS alert and banner. Navigation, crown paging, Action button and logic unchanged. Checked in the Series 11 42 mm and 46 mm and Ultra 3 simulators with demo riders."
```

The PR description carries no AI attribution line (owner's rule).

- [ ] **Step 5: Hand over**

Tell the ComX server session the PR URL; it reviews, merges and ships a TestFlight build for Xavier to try on the water.

---

## Done when

- Every watch page matches its "Expected" list in the 42 mm, 46 mm and Ultra 3 (49 mm) simulators.
- The watch target and the full iOS scheme build; CI (`iOS — watch build check`) is green on the pull request.
- The crown paging, the Action button Talk control, double tap, the history replay and the SOS long press behave exactly as before.
- The pull request is merged by the ComX session and a TestFlight build is on Xavier's watch.
