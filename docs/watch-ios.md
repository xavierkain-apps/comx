# Apple Watch companion — iOS specifics

Protocol and architecture: [`watch-companion.md`](watch-companion.md). This page
covers the iOS/watchOS implementation, how it is built, and what has to be done
by hand before the first signed release.

## Status

| What | State |
| --- | --- |
| `WatchBridge` native module and the watch app compile (iOS Simulator, unsigned) | Verified on CI (`watch-ios-build.yml`) |
| Behaviour on a real iPhone + Apple Watch | **Not tested** — no device run yet |
| Signed TestFlight build including the watch app | **Not run** — needs the manual steps below first |

## Pieces

| Path | Role |
| --- | --- |
| `ios/WatchBridge.swift`, `ios/WatchBridge.m` | React Native module `WatchBridge` (RCTEventEmitter) and `WatchHub`, the process-wide `WCSession` delegate |
| `ios/SoarXVoice/AppDelegate.swift` | Activates `WatchHub` at launch, so messages and clips arriving before JS listens are buffered (up to 50) and delivered when JS subscribes |
| `ios/SoarXVoiceWatch/` | The watchOS app (SwiftUI, watchOS 10+, single target) |
| `scripts/add-watch-target.rb` | Adds the watch target to `project.pbxproj`, embeds it, compiles `WatchBridge.*` into the iOS target. Idempotent |
| `.github/workflows/watch-ios-build.yml` | Unsigned simulator build on `macos-26` |

`RCTNewArchEnabled` in the watch `Info.plist` is there because React
Native's `pod install` writes it into every target's plist; keeping it
committed avoids a dirty working tree after each `pod install`. It has no
effect on the watch.

Re-run the script after adding a Swift file to `ios/SoarXVoiceWatch/` **and
after changing the iOS `MARKETING_VERSION`** (the embedded app must carry the
same version string, or App Store validation rejects the upload). The build
number is shared automatically: fastlane's `increment_build_number` (agvtool)
updates every target.

```sh
GEM_PATH="$HOME/.local/share/gem/ruby/3.2.0:$GEM_PATH" ruby scripts/add-watch-target.rb
```

## Native module

| Method | iOS behaviour |
| --- | --- |
| `start()` | Activates `WCSession` (already done at launch; harmless to repeat) |
| `sendState(json)` | `updateApplicationContext(["json": json])`, plus `sendMessage` when the watch is reachable |
| `sendEvent(json)` | `sendMessage` when reachable, `transferUserInfo` otherwise or on failure (queued, delivered in order) |
| `sendClip(path, metaJson)` | Copies the file to `Caches/watch-outbox/`, `transferFile(copy, metadata: ["json": metaJson])`, deletes the copy when the transfer finishes |
| `getStatus()` | Resolves an **array** (`[]` when no watch is paired or the session is not active yet) |
| `getClipDir()` | `Caches/watch-clips` (absolute path, no `file://`, created if missing) |

Payload notes for the JS side:

- Every WatchConnectivity payload is a dictionary with one key, `json`, holding
  the JSON string. Both sides use the same convention.
- **`sendClip` deletes its source file when that file is inside `getClipDir()`**
  — immediately, whether or not a watch was there to receive it. Do not reuse
  the path after the call. Files elsewhere are left alone.
- `sendState`/`sendEvent`/`sendClip` are silent no-ops unless a watch is paired
  **and** has the app installed.
- `WatchClip.path` is a plain absolute path in `Caches/watch-inbox/`
  (`.m4a`), suitable for `startAudioMixing`. The inbox keeps the 30 most
  recent clips; older ones are deleted.
- `WatchClip.durationMs` comes from the clip metadata (0 if absent).
- `WatchStatus` fires on activation, pairing / install changes and
  reachability changes, and once when JS starts listening.
- There is a single Apple Watch entry (`name: "Apple Watch"`):
  WatchConnectivity does not expose the watch's name.

## Watch app

- **Talk** (first page): one large button. Tap to start, tap again to stop and
  send; auto-stops at 30 s. AAC `.m4a`, mono, 16 kHz, `AVAudioRecorder`.
  Haptics: `start`, `stop`, then `success` once handed to WatchConnectivity
  (not a delivery receipt). Clips under 0.3 s are discarded as mis-taps. On
  watchOS 11+ the double-tap gesture also triggers the button.
- **Hear**: clips from the phone are queued (max 10, oldest dropped) and played
  one after another on the watch speaker, with a `notification` haptic and the
  speaker's name before each. Recording interrupts playback.
- **Speaking** events: `directionUp` haptic and a yellow name label.
- **Riders** (second page): sorted SOS first, then by distance. Arrow at
  `brg - heading` (watch compass if available, else `me.cog`, else north-up —
  the active reference is shown on top of the list). Stale riders are dimmed.
  Tap a rider for a full-screen compass view.
- **Messages** (third page): the six contract quick messages, an SOS that needs
  a 1.2 s press and then a confirmation, *Cancel my SOS*, *Water lock*, and
  start / end session.
- Incoming text: banner for 6 s. Incoming SOS: full-screen red alert with
  arrow and distance, kept until dismissed or cancelled by the sender, with a
  repeated strong haptic.
- `hello` is sent on WCSession activation and each time the app becomes active.

### Staying alive: `HKWorkoutSession`

The app starts a **surfing workout session** (`.surfingSports`, outdoor) when
it launches. That keeps it running and frontmost with the wrist down, which is
what a rider needs for haptics and auto-played clips. No `HKWorkoutBuilder` is
attached, so nothing is written to Health; the system still shows the workout
indicator and uses more battery than an idle app. *End session* in the
Messages page stops it.

`WKExtendedRuntimeSession` was not used: its session types (self-care,
mindfulness, physical therapy, smart alarm) do not fit and are capped in
duration; a kitesurf session is a workout.

Implications:

- The watch target has the **HealthKit** entitlement and
  `WKBackgroundModes = workout-processing`. The App ID needs the HealthKit
  capability (see below) or the signed build fails.
- First launch shows the HealthKit permission sheet (share: workouts).
- App Review may ask why a communication app uses HealthKit; the answer is
  that it runs a water sports workout during the session.

### Apple Watch Ultra Action button

Two routes are implemented; **neither has been tried on a device.**

1. `StartSessionIntent` conforms to `StartWorkoutIntent`. That is the
   documented way for a workout app to appear under *Settings > Action Button
   > Workout*. Pressing the button then launches SoarX Voice and starts the
   session.
2. `ToggleTalkIntent` is an App Shortcut ("Talk"). It can be assigned with
   *Action Button > Shortcut*, and also runs from Siri and the Smart Stack.
   It opens the app and toggles recording.

There is no public API, as far as I know, for a third-party app to receive
*every* Action button press as a push-to-talk key (I may be wrong; this is not
verified). Route 2 is the candidate for talk; whether starting the recorder
from a Shortcut works without an extra tap must be checked on a watch.

## Manual steps before the first signed release

Do these **before** merging this branch to the default branch or running
`ios-testflight.yml` with it: once the watch target is in the project, the
release lane signs it and fails if the App ID or its profile is missing.

1. **App ID** — <https://developer.apple.com/account/resources/identifiers>,
   team `S96H22CQ8W`: register `com.xavier.soarxvoice.watchkitapp`
   (App IDs > App, platform iOS/watchOS, explicit). Enable **HealthKit**.
   Nothing else is needed (WatchConnectivity needs no capability).
2. **App Store Connect** — no new app record: the watch app ships inside the
   iOS app `com.xavier.soarxvoice`.
3. **Profiles** — the Fastfile now asks match (shared store
   `xavierkain-apps/apple-certs`, branch `match-certs`, certificate
   `KC2337J32V`) for `match AppStore com.xavier.soarxvoice.watchkitapp` next
   to the iOS one. match creates it on the first run with the existing
   certificate; no new certificate is created.
4. **Stale profiles** — if any App Store profile for
   `com.xavier.soarxvoice.watchkitapp` already exists (for example created by
   Xcode automatic signing while testing on a device), delete it first with the
   `delete_profiles` lane (`ios-certs.yml`, bundle id
   `com.xavier.soarxvoice.watchkitapp`). Otherwise match creates
   `match AppStore com.xavier.soarxvoice.watchkitapp <timestamp>`, the
   project's `PROVISIONING_PROFILE_SPECIFIER` does not match, and the archive
   fails with "No profile for team ... matching ... found".
   **Do not delete the iOS app's profile** unless it is also stale: it is in
   the shared store already and the release has been green with it.
5. If the HealthKit capability is enabled **after** a watch profile was
   generated, that profile lacks the entitlement: delete it (step 4) so match
   regenerates it.
6. Run `ios-testflight.yml` and check both profiles are present in the store.

## Device testing checklist (not done yet)

- Install via Xcode on a paired watch (development signing; automatic signing
  will create a development profile, which is fine and not used by match).
- Volume of the watch speaker outdoors, in wind. Expect it to be the weak
  point; a Bluetooth headset is not part of the design.
- Clip latency end to end (record → phone → channel; channel → phone → watch).
- Behaviour with the wrist down, water lock on, and after 1-2 hours
  (battery, workout session still running).
- Clips received while the watch app is not running are delivered by
  WatchConnectivity on the next launch; they then play in a burst.

## Garmin on iOS

Not implemented in this branch. Findings:

- The SDK is available: [`garmin/connectiq-companion-app-sdk-ios`](https://github.com/garmin/connectiq-companion-app-sdk-ios)
  ships a Swift Package (`Package.swift`, binary `ConnectIQ.xcframework`,
  latest tag 1.8.0). Using it means accepting Garmin's SDK licence.
- Unlike Android, the iOS SDK cannot discover watches by itself. The app must
  call `showConnectIQDeviceSelection`, which opens Garmin Connect Mobile; the
  user picks devices there and Garmin Connect returns to the app through a
  custom URL scheme that `AppDelegate` must hand to the SDK. The app then has
  to persist the device list.
- The current JS contract has no method to start that selection, and
  triggering it automatically from `start()` would bounce every user without
  a Garmin into Garmin Connect. It needs a new bridge method (for example
  `selectGarminDevices()`) and a button in the watch settings screen, i.e. a
  change on the JS side too.

Work to do when picked up: add the package to the iOS target (the
`xcodeproj` gem supports `XCRemoteSwiftPackageReference`), register a URL
scheme plus `LSApplicationQueriesSchemes` = `gcm-ciq`, forward
`application(_:open:options:)` to the SDK, add the selection method, then
reuse `WatchHub`'s event plumbing with `platform: "garmin"`, app id
`8ac2d628-66c4-40a4-96b0-10061a6d6519`, JSON ↔ dictionary conversion, state
throttled to 5 s, no clips (see the contract).
