import SwiftUI
import WatchKit

// Designed for kitesurf: wet screen, wind, sun. Black background, very large
// type and targets, high contrast colours, few words.

struct ContentView: View {
  @EnvironmentObject var model: AppModel
  @State private var page = 0

  var body: some View {
    ZStack(alignment: .top) {
      NavigationStack {
        TabView(selection: $page) {
          TalkView().tag(0)
          RidersView().tag(1)
          MessagesView().tag(2)
        }
        .tabViewStyle(.verticalPage)
      }
      if let banner = model.banner {
        BannerView(banner: banner)
          .onTapGesture { model.banner = nil }
          .transition(.move(edge: .top))
      }
      if let alert = model.sosAlert {
        SOSAlertView(alert: alert)
      }
    }
    .animation(.easeInOut(duration: 0.2), value: model.banner)
  }
}

// MARK: - Talk

struct TalkView: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(spacing: 4) {
      StatusLine()
      if let who = model.speakingLabel, !model.isRecording {
        Label(who, systemImage: "waveform")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(.yellow)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
      Button(action: { model.toggleTalk() }) {
        ZStack {
          Circle()
            .fill(model.isRecording ? Color.red : Color.blue)
          if model.isRecording {
            Circle()
              .trim(from: 0, to: model.recordingElapsed / AppModel.maxClipSeconds)
              .stroke(Color.white, style: StrokeStyle(lineWidth: 6, lineCap: .round))
              .rotationEffect(.degrees(-90))
              .padding(4)
          }
          VStack(spacing: 0) {
            Image(systemName: model.isRecording ? "paperplane.fill" : "mic.fill")
              .font(.system(size: 34, weight: .bold))
            Text(model.isRecording ? "SEND \(Int(AppModel.maxClipSeconds - model.recordingElapsed))" : "TALK")
              .font(.system(size: 22, weight: .heavy))
          }
          .foregroundStyle(.white)
        }
      }
      .buttonStyle(.plain)
      .primaryActionShortcut()
      .accessibilityLabel(model.isRecording ? "Stop and send" : "Talk")
      if model.micDenied {
        Text("Microphone off: allow it in Settings")
          .font(.footnote).foregroundStyle(.orange)
      }
    }
    .padding(.horizontal, 4)
  }
}

private struct PrimaryActionShortcut: ViewModifier {
  func body(content: Content) -> some View {
    if #available(watchOS 11.0, *) {
      // Double tap (Series 9 / Ultra 2 and later) triggers talk.
      content.handGestureShortcut(.primaryAction)
    } else {
      content
    }
  }
}

extension View {
  func primaryActionShortcut() -> some View { modifier(PrimaryActionShortcut()) }
}

struct StatusLine: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    HStack(spacing: 4) {
      Circle()
        .fill(model.channelConnected ? Color.green : (model.linkUp ? Color.orange : Color.red))
        .frame(width: 10, height: 10)
      Text(statusText)
        .font(.system(size: 14, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Spacer(minLength: 0)
      if !model.workoutRunning {
        Image(systemName: "bolt.slash.fill").foregroundStyle(.orange).font(.system(size: 12))
      }
    }
  }

  private var statusText: String {
    if !model.linkUp { return "No phone" }
    if !(model.state?.connected ?? false) { return "Not in channel" }
    return model.state?.channel ?? "Connected"
  }
}

// MARK: - Riders

struct RidersView: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    let riders = model.riders
    List {
      HeadingSourceRow()
      if riders.isEmpty {
        Text(model.linkUp ? "No riders yet" : "Waiting for phone")
          .font(.title3)
          .foregroundStyle(.secondary)
      }
      ForEach(riders) { rider in
        NavigationLink {
          RiderDetailView(uid: rider.uid)
        } label: {
          RiderRow(rider: rider)
        }
        .listRowBackground(rider.isSOS ? Color.red.opacity(0.85) : Color.clear)
      }
    }
    .navigationTitle("Riders")
  }
}

struct HeadingSourceRow: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    let source: String = {
      switch model.heading.1 {
      case .compass: return "Arrows: compass"
      case .course: return "Arrows: your course"
      case .north: return "Arrows: north up"
      }
    }()
    Text(source).font(.footnote).foregroundStyle(.secondary)
  }
}

struct RiderRow: View {
  @EnvironmentObject var model: AppModel
  let rider: Rider

  var body: some View {
    HStack(spacing: 8) {
      DirectionArrow(angle: model.arrowAngle(bearing: rider.brg),
                     color: rider.isSOS ? .white : .cyan)
        .frame(width: 34, height: 34)
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          Text(rider.displayName)
            .font(.system(size: 18, weight: .bold))
            .lineLimit(1)
          if rider.isSpeaking {
            Image(systemName: "waveform").foregroundStyle(.yellow)
          }
          if rider.isSOS {
            Text("SOS").font(.system(size: 14, weight: .heavy))
          }
        }
        Text(Format.distance(rider.dist))
          .font(.system(size: 22, weight: .heavy, design: .rounded))
      }
    }
    .opacity(rider.isStale ? 0.4 : 1)
  }
}

struct RiderDetailView: View {
  @EnvironmentObject var model: AppModel
  let uid: Int

  var body: some View {
    let rider = model.rider(uid)
    VStack(spacing: 2) {
      Text(rider?.displayName ?? "Rider")
        .font(.system(size: 18, weight: .bold))
        .lineLimit(1)
      DirectionArrow(angle: model.arrowAngle(bearing: rider?.brg),
                     color: (rider?.isSOS ?? false) ? .red : .cyan)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(6)
      Text(Format.distance(rider?.dist))
        .font(.system(size: 34, weight: .heavy, design: .rounded))
      if rider?.isStale ?? true {
        Text("Position is old").font(.footnote).foregroundStyle(.orange)
      }
    }
    .opacity((rider?.isStale ?? true) ? 0.6 : 1)
  }
}

/// Arrow pointing at `angle` degrees clockwise from the top of the screen.
struct DirectionArrow: View {
  let angle: Double?
  var color: Color = .cyan

  var body: some View {
    if let angle = angle {
      Image(systemName: "location.north.fill")
        .resizable()
        .scaledToFit()
        .foregroundStyle(color)
        .rotationEffect(.degrees(angle))
        .animation(.easeOut(duration: 0.3), value: angle)
    } else {
      Image(systemName: "questionmark.circle")
        .resizable()
        .scaledToFit()
        .foregroundStyle(.gray)
    }
  }
}

// MARK: - Messages and SOS

struct MessagesView: View {
  @EnvironmentObject var model: AppModel
  @State private var confirmSOS = false

  private let columns = [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)]

  var body: some View {
    ScrollView {
      LazyVGrid(columns: columns, spacing: 6) {
        ForEach(QuickMessage.allCases) { m in
          Button { model.send(m) } label: {
            VStack(spacing: 2) {
              Image(systemName: m.symbol).font(.system(size: 20, weight: .bold))
              Text(m.label)
                .font(.system(size: 13, weight: .semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
          }
          .tint(m == .help ? .orange : .blue)
        }
      }

      if model.mySOSActive {
        Button(role: .cancel) { model.setSOS(false) } label: {
          Text("Cancel my SOS").font(.system(size: 18, weight: .heavy))
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .tint(.green)
        .padding(.top, 6)
      } else {
        // Long press, then confirm: a wet screen must not raise an SOS.
        Text("SOS")
          .font(.system(size: 26, weight: .heavy))
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity, minHeight: 60)
          .background(RoundedRectangle(cornerRadius: 14).fill(Color.red))
          .onLongPressGesture(minimumDuration: 1.2) {
            WKInterfaceDevice.current().play(.click)
            confirmSOS = true
          }
          .padding(.top, 6)
        Text("Hold to send SOS").font(.footnote).foregroundStyle(.secondary)
      }

      Button {
        WKInterfaceDevice.current().enableWaterLock()
      } label: {
        Label("Water lock", systemImage: "drop.fill")
      }
      .padding(.top, 8)

      if model.workoutRunning {
        Button(role: .destructive) { model.endSession() } label: {
          Label("End session", systemImage: "stop.fill")
        }
      } else {
        Button { model.startSession() } label: {
          Label("Start session", systemImage: "play.fill")
        }
      }
    }
    .confirmationDialog("Send SOS to every rider?", isPresented: $confirmSOS) {
      Button("Send SOS", role: .destructive) { model.setSOS(true) }
      Button("Cancel", role: .cancel) {}
    }
  }
}

struct BannerView: View {
  let banner: Banner

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(banner.title).font(.system(size: 14, weight: .bold)).foregroundStyle(.yellow)
      Text(banner.body).font(.system(size: 20, weight: .heavy)).lineLimit(2).minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8)
    .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.15)))
  }
}

struct SOSAlertView: View {
  @EnvironmentObject var model: AppModel
  let alert: SOSAlert

  var body: some View {
    VStack(spacing: 2) {
      Text("SOS \(alert.from)")
        .font(.system(size: 20, weight: .heavy))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      DirectionArrow(angle: model.arrowAngle(bearing: alert.brg), color: .white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(4)
      Text(Format.distance(alert.dist))
        .font(.system(size: 30, weight: .heavy, design: .rounded))
      Button("Dismiss") { model.dismissSOSAlert() }
        .tint(.black)
    }
    .foregroundStyle(.white)
    .padding(6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.red)
    .ignoresSafeArea()
  }
}
