# Apple Watch companion — iOS specifics

Protocol and architecture: [`watch-companion.md`](watch-companion.md). This page
covers the iOS/watchOS implementation, how it is built, and what has to be done
by hand before the first signed release.

## Status

| What | State |
| --- | --- |
| `WatchBridge` native module and the watch app compile (iOS Simulator, unsigned) | Verified on CI (`watch-ios-build.yml`) |
| Behaviour on a real iPhone + Apple Watch | **Not tested** — no device run yet |
| Garmin on iOS (Connect IQ SDK 1.8.0, Swift Package) | Compiles on CI; **not tested** with Garmin Connect or a Garmin watch |
| Input test page, crown compass, double tap, Action button | Compiles on CI; **not tested** on a watch — the Input test page exists to find out |
| Signed TestFlight build including the watch app | **Not run** — needs the manual steps below first |

## Pieces

| Path | Role |
| --- | --- |
| `ios/WatchBridge.swift`, `ios/WatchBridge.m` | React Native module `WatchBridge` (RCTEventEmitter) and `WatchHub`, the process-wide `WCSession` delegate |
| `ios/GarminLink.h`, `ios/GarminLink.m` | Garmin watches through the Connect IQ iOS SDK (Objective-C, so the SDK is called exactly as its headers declare). Exposed to Swift by `ios/SoarXVoice-Bridging-Header.h` |
| `ios/SoarXVoice/AppDelegate.swift` | Activates `WatchHub` at launch, so messages and clips arriving before JS listens are buffered (up to 50) and delivered when JS subscribes |
| `ios/SoarXVoiceWatch/` | The watchOS app (SwiftUI, watchOS 10+, single target) |
| `scripts/add-watch-target.rb` | Adds the watch target to `project.pbxproj`, embeds it, compiles `WatchBridge.*` and `GarminLink.*` into the iOS target, adds the Connect IQ Swift Package. Idempotent |
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
| `readClipBase64(path): Promise<string>` | Base64 of the file (plain path or `file://`). Rejects `E_READ_CLIP` |
| `writeClip(base64, ext): Promise<string>` | Writes `vc-<ms>-<id>.<ext>` into `getClipDir()` and resolves its absolute path. `ext` is reduced to letters/digits (`m4a` if empty). Rejects `E_WRITE_CLIP`. Like every file there, it is **deleted by `sendClip`** |
| `selectGarminDevices(): Promise<void>` | Opens Garmin Connect on its device picker; resolves once it was asked to open. Rejects `E_GARMIN_CONNECT_MISSING` (message is user-readable) when Garmin Connect is not installed |

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
- `WatchClip.to` is the uid (number) the rider addressed the clip to, or
  `null` for the group. Always present on iOS.
- `sendClip` metadata is passed to the watch unchanged; `"private": true`
  makes the watch announce the clip as "<name> (to you)".
- Garmin: `getStatus()` / `WatchStatus` add one entry per selected Garmin
  device: `{platform: "garmin", name, id, paired: true, installed, reachable}`
  (`installed` is `false` until the SDK confirmed the app or the watch sent
  something). Garmin messages arrive as `WatchMessage` with
  `platform: "garmin"`. `sendState` / `sendEvent` go to Garmin too; clips never.
- `WatchStatus` fires on activation, pairing / install changes and
  reachability changes, and once when JS starts listening.
- There is a single Apple Watch entry (`name: "Apple Watch"`):
  WatchConnectivity does not expose the watch's name.

## Watch input mapping (touch-free)

| Input | Not recording | Recording |
| --- | --- | --- |
| Digital Crown | Compass pages: overview radar first, then one page per rider (nearest first, SOS first); stops at the first and last page | Choose the recipient, one page per recipient: Group → the rider on the compass → the other riders (`directionUp` haptic for a rider, `directionDown` for Group) |
| Double tap (watchOS 11+, Series 9 / Ultra 2 and later) | Start talking **to the group** | Stop and send to the chosen recipient |
| Action button (Ultra), assigned to the *Talk* shortcut | Same as double tap | Same as double tap |
| Action button, assigned to *Workout > ComX* | Starts the session | — |
| Touch (fallback) | Talk page: swipe down from the overview radar, one big round TALK button; swipe left/right for Riders and Messages; tap a rider in the list to put it on the compass | Tap SEND; tap the "To:" label to cycle recipients |

Why this mapping: talk must default to the group with nothing to choose, so a
private message needs a deliberate extra step. Turning the crown *while
recording* is that step: it is unused otherwise, needs no touch, and the
first detent lands on the rider already on the compass, so "Talk to Carlos"
is: crown to Carlos, double tap, one crown step, speak, double tap. A
"double tap while focused > 2 s = private" rule was rejected: the compass
always has a focused rider, so it would make nearly every message private.

The compass opens on the **overview**: a radar with me in the centre, the top
of the screen being the heading the arrows use (compass, else course, else
north, with an N mark). Each rider is a round badge with initials ("Xavier
Kain" gives XK, "Lea (demo)" gives L) and the distance under it; the
farthest rider sits on the outer ring, and a second ring marks a round
distance (1, 2 or 5 × 10ⁿ, at most half the farthest), both labelled.
Distance from the centre is the square root of the real distance so that
near riders stay readable, and badges that would overlap are pushed apart.
SOS riders are red and bigger, speaking riders yellow, stale ones dimmed;
riders without a position are listed under the radar ("M ?"). The overview
and the rider pages are full screen, without a talk button (the status line
is drawn over the radar). Talking by touch is on its own page, above the
overview: swipe down from the radar. While recording, the recipient pages
keep a SEND button. The double tap shortcut is attached to the visible talk
button, so it only works on the talk page and while recording. There are no profile pictures: the phone does not send
any (a picture does not fit the 1 KB data stream messages). The crown then goes through
the riders, one page each. A rider whose SOS started after your last crown
pick takes over the compass. Pages swipe **horizontally** so the crown never
scrolls pages; it belongs to the compass.

How the compass gets the crown: a paged vertical `ScrollView`
(`.scrollTargetBehavior(.paging)`, `.scrollPosition(id:)`, `PagedColumn` in
`Views.swift`) holding the talk page, the overview and one page per rider
(one per recipient while recording, no talk page or overview then), nested in
the horizontal page `TabView`. A scroll view takes the crown natively, like
the `List` on the Riders page, in both directions. Each page is the whole
screen (the scroll view runs under the clock), padded to keep the clock row
and the bottom edge free.

What did not work: a `.focusable()` view with `.digitalCrownRotation` worked
in the simulator, but on a real watch (Watch7,5, watchOS 26.6, workout
session running) the rotation never reached the app and the system went back
to the watch face; the Input test log showed no crown event at all. A
`TabView` with `.tabViewStyle(.verticalPage)` took the crown, but opened on
its second page (the overview) it could not be crowned up to the first one
(the talk page) until the user had scrolled down once, in the simulator.

Voice is recorded at **16 kbit/s** AAC (`AVEncoderBitRateKey`), mono, 16 kHz:
about 20 KB for 10 s. Not yet checked on a watch that the encoder accepts it
(`AVAudioRecorder` would fail to start, the watch plays a failure haptic).

## Watch app

- **Compass** (first page): the focused rider big (name, arrow, distance,
  position `2/5`), who is speaking, and a wide TALK button. Tap to start, tap
  again to stop and send; auto-stops at 30 s. AAC `.m4a`, mono, 16 kHz,
  16 kbit/s, `AVAudioRecorder`. Haptics: `start`, `stop`, then `success` once
  handed to WatchConnectivity (not a delivery receipt). Clips under 0.3 s are
  discarded as mis-taps. See the input mapping above.
- **Hear**: clips from the phone are queued (max 10, oldest dropped) and played
  one after another on the watch speaker, with a `notification` haptic and the
  speaker's name before each. Recording interrupts playback.
- **Speaking** events: `directionUp` haptic and a yellow name label.
- **Riders** (second page): sorted SOS first, then by distance. Arrow at
  `brg - heading` (watch compass if available, else `me.cog`, else north-up —
  the active reference is shown on top of the list). Stale riders are dimmed.
  Tap a rider to put it on the compass.
- **Messages** (third page): the six contract quick messages, an SOS that needs
  a 1.2 s press and then a confirmation, *Cancel my SOS*, *Water lock*,
  *Input test*, and start / end session.
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
   > Workout*. Pressing the button then launches ComX and starts the
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
   team `S96H22CQ8W`: register `com.xavier.comx.watchkitapp`
   (App IDs > App, platform iOS/watchOS, explicit). Enable **HealthKit**.
   Nothing else is needed (WatchConnectivity needs no capability).
2. **App Store Connect** — no new app record: the watch app ships inside the
   iOS app `com.xavier.comx`.
3. **Profiles** — the Fastfile now asks match (shared store
   `xavierkain-apps/apple-certs`, branch `match-certs`, certificate
   `KC2337J32V`) for `match AppStore com.xavier.comx.watchkitapp` next
   to the iOS one. match creates it on the first run with the existing
   certificate; no new certificate is created.
4. **Stale profiles** — if any App Store profile for
   `com.xavier.comx.watchkitapp` already exists (for example created by
   Xcode automatic signing while testing on a device), delete it first with the
   `delete_profiles` lane (`ios-certs.yml`, bundle id
   `com.xavier.comx.watchkitapp`). Otherwise match creates
   `match AppStore com.xavier.comx.watchkitapp <timestamp>`, the
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

## Input test (watch)

*Messages* page → **Input test**. The page logs every input with a counter, a
timestamp (`HH:mm:ss.S`) and a drop icon when water lock was on at that
moment. The last five events are on screen; the full log also goes to the
console (`[InputTest]`, visible in Console.app with the watch attached).

| Counter | What increments it |
| --- | --- |
| Crown | One Digital Crown detent (`+1` / `-1`). Simulator only: the page uses `.focusable()` + `.digitalCrownRotation`, which never receives the crown on a real watch (see the input mapping), so this counter stays at 0 there |
| Dbl tap | The blue button fired **without** a finger on it: the double-tap gesture (watchOS 11+) |
| Btn touch | The blue button fired by a finger |
| Tap | A finger anywhere else on the page |
| Action | `ToggleTalkIntent` (Action button > Shortcut *Talk*, Siri), `StartSessionIntent`, or the system launching a workout (Action button > Workout) |
| Wrist | Scene phase changes, and dim / bright (`isLuminanceReduced`, wrist down / up) |

Top line: water lock state (polled every 0.5 s; changes are logged as *Lock*)
and **Lock**, which calls `enableWaterLock()`. Long-press the counters to
reset. While the page is open, talk inputs are only logged (the Action
button does not start a recording).

"Dbl tap" vs "Btn touch" is a heuristic: a finger also ends a simultaneous
tap gesture, the hand gesture does not.

Procedure (start a session first so the app stays in front):

1. Water lock **off**, dry: turn the crown, double tap, tap, press the Action
   button, lower and raise the wrist. Every counter should move. This is the
   reference.
2. Tap **Lock**. Check "Lock ON". Repeat each input. Expected unknowns: does
   the crown reach the app or does it only offer to unlock? Does double tap
   still fire? Does the Action button run the shortcut?
3. Same under the shower (screen wet), lock on and off.
4. In the water, with the watch in a session for 30 min+.
5. Unlock (hold the crown on watchOS 10+) and note whether that produced crown
   events.

Report the counters per case; the input mapping above is adjusted from that.

## Garmin on iOS

Implemented in `ios/GarminLink.m` with Garmin's Connect IQ iOS companion SDK
(Swift Package `github.com/garmin/connectiq-companion-app-sdk-ios`,
`upToNextMajorVersion` from 1.8.0, binary `ConnectIQ.xcframework`). Using it
means accepting Garmin's SDK licence.

How it works:

- The iOS SDK cannot discover watches. JS calls `selectGarminDevices()`
  (e.g. a "Connect Garmin watch" button); Garmin Connect Mobile opens on its
  device picker and returns to ComX through `comx-ciq://…`, which
  `AppDelegate` hands to `GarminLink` (`parseDeviceSelectionResponseFromURL:`).
- The selection replaces the previous one, is archived in UserDefaults
  (`comx.garmin.devices`, `NSKeyedArchiver`) and re-registered at every launch.
  The SDK is only initialised once a selection exists, so users without a
  Garmin never trigger it.
- App id `8ac2d628-66c4-40a4-96b0-10061a6d6519` (also used as store id).
- JSON → Connect IQ values like Android's `GarminJson`: objects → NSDictionary,
  arrays → NSArray, integers → 32-bit when they fit else 64-bit, fractions →
  double, booleans kept. **One difference:** `null` members of objects are
  dropped instead of sent, because the SDK's support for `NSNull` is not
  documented; Monkey C reads a missing key as `null`, so the watch sees the
  same thing. Watch → phone: dictionaries become JSON, a string holding a JSON
  object is passed through.
- State: one message every 5 s at most (latest wins, a trailing send carries
  the newest), skipped for a device whose previous state is still in transit.
  Events: immediately. Clips: never. Only sent to devices the SDK reports
  connected and whose app is not known to be missing.
- Info.plist: URL type `comx-ciq`, `LSApplicationQueriesSchemes` `gcm-ciq`
  (the SDK's check for Garmin Connect), Bluetooth usage strings mention the
  Garmin watch; `bluetooth-central` background mode was already there.
- Garmin Connect missing: `selectGarminDevices()` rejects with
  `E_GARMIN_CONNECT_MISSING` and a readable message; nothing else happens.

Test steps (not done yet):

1. Install Garmin Connect, pair the Garmin watch, install the ComX Connect IQ
   app on it (sideload or store).
2. In ComX, trigger `selectGarminDevices()`; pick the watch in Garmin Connect;
   ComX must come back to the front.
3. `getStatus()` should list `{platform: "garmin", reachable: true}`; join a
   channel and check the rider list on the Garmin (updates every 5 s).
4. Send a quick message from the Garmin: JS gets `WatchMessage` with
   `platform: "garmin"`.
5. Kill and relaunch ComX: the watch must reconnect without a new selection.
6. Uninstall Garmin Connect: `selectGarminDevices()` must reject cleanly.
