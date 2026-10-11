# Watch companion — Android side

Android implementation of [watch-companion.md](watch-companion.md): the
phone-side `WatchBridge` native module (Wear OS + Garmin) and the Wear OS app.

## Layout

| Path | What |
| --- | --- |
| `android/app/src/main/java/com/soarxvoice/watch/` | `WatchBridge` module (`WatchBridgeModule`), Wear OS link (`WearLink`, `WatchListenerService`), Garmin link (`GarminLink`, `GarminJson`), `WatchHub` (buffers watch traffic until React Native is up) |
| `android/watch-shared/src/` | Data Layer paths and the clip channel-path codec, compiled verbatim into **both** `:app` and `:wear` |
| `android/wear/` | Wear OS app (Kotlin, Compose for Wear OS, minSdk 30) |
| `.github/workflows/watch-android-build.yml` | CI: builds both debug APKs, runs the unit tests, lints the wear release build |

## Transport (Wear OS Data Layer)

| What | Direction | Transport |
| --- | --- | --- |
| state | phone → watch | urgent DataItem `/soarx/state`, key `json` (+ `sentAt` so identical JSON still fires) |
| event | phone → watch | MessageClient `/soarx/event`, UTF-8 JSON |
| voice clip | phone → watch | ChannelClient `/soarx/clip/<id>/<hex(meta JSON)>` |
| message (`text`, `sos`, `ptt`, `hello`) | watch → phone | MessageClient `/soarx/msg`, UTF-8 JSON |
| voice clip | watch → phone | ChannelClient `/soarx/clip-up/<id>/<hex(meta JSON)>` |

Clip metadata rides in the channel path (hex of the UTF-8 JSON) so the
receiver has it before the first audio byte. Both ends share the codec in
`watch-shared`. Capabilities `soarx_phone` / `soarx_watch` (declared in each
module's `res/values/wear.xml`) pick the target nodes.

The Data Layer only connects apps with the **same package name and the same
signing key**: the wear app's applicationId is `com.soarxvoice` and it signs
exactly like the phone app (debug keystore `android/app/debug.keystore`
for debug builds, the release keystore for release builds).

Both directions work with the app in the background: `WatchListenerService`
(phone) and `DataLayerService` (watch) are `WearableListenerService`s that
Google Play services binds on demand. Watch messages that arrive before React
Native is up are buffered (32 max) and delivered when the module starts.

### Bridge behaviour the JS side should know

- `getStatus()` resolves an **array** of `{platform, name, paired, installed, reachable}`;
  the `WatchStatus` event carries `{watches: [...]}`.
- Wear OS: a connected node is `paired: true, reachable: true`;
  `installed` is true when it advertises `soarx_watch`. A node with the app
  that is out of range shows `reachable: false`.
- Garmin: one entry per device known to Garmin Connect. `installed` is false
  until Connect IQ has confirmed the app is on the watch. No entry at all
  without Garmin Connect Mobile on the phone.
- `WatchClip.path` is an absolute path without `file://`, inside
  `getClipDir()`, `.m4a` (AAC in MP4). `durationMs` is a number.
- `sendClip(path, meta)`: a file inside `getClipDir()` is **deleted** once
  every watch has received it (or after 90 s); a file elsewhere is left alone.
  The bridge also deletes clips older than 15 min in that directory whenever a
  watch clip arrives, and older than 1 h at start.
- `sendClip` ignores Garmin (no audio). `sendState` reaches Garmin at most once
  every 5 s (latest wins); events go out immediately.
- Garmin numbers: a JSON integer arrives on the watch as `Number` (`Long` if it
  does not fit 32 bits, e.g. `ts`), a decimal as `Float`/`Double`. JSON `null`
  becomes `null`.

## Wear OS app

- Home: link status, a large **TALK** button (tap to record, tap again to
  send; auto-send at 30 s; programmable stem buttons where the watch exposes
  them — Galaxy Watch keys are system-reserved), who is talking / being
  played, SOS banners, rider list sorted by distance, Messages, SOS, Stop.
- Arrow angle = `brg - heading`; heading is the watch rotation-vector compass
  (declination-corrected from the phone's GPS), else `me.cog` when moving
  faster than 1 m/s, else north-up. The label under the list says which.
- Tap a rider for a large compass view.
- Recording: AAC in `.m4a`, mono, 16 kHz, 32 kbps. Incoming clips are held while
  recording and resume after.
- Incoming clips: queued (8 max), a haptic pulse, then playback on the
  built-in speaker (`setPreferredDevice`), media usage, +6 dB
  `LoudnessEnhancer`. Tap the "Hearing ..." line to skip.
- `speaking` event: haptic + "X is talking". Quick message and SOS alerts are
  full screen (SOS vibrates at alarm priority until opened).
- `RideService`: foreground service (`mediaPlayback|microphone`) with an
  Ongoing Activity on the watch face, sends `hello` every 2 min. "Stop
  session" ends it.

## Testing on a Galaxy Watch

1. Get the APKs from the latest green run of **Watch — Android build**
   (Actions tab → run → Artifacts): `soarxvoice-wear-debug`
   (`wear-debug.apk`) and `soarxvoice-phone-debug`
   (`app-arm64-v8a-debug.apk`). `gh run download <run-id> -R xavierkain-apps/soarx-voice`
   does it from a terminal.
2. **Both apps must be debug builds** (same debug key). A Play / release phone
   app and a debug watch app never see each other. Uninstall the Play version
   of SoarX Voice from the phone first (`adb uninstall com.soarxvoice`).
3. Phone: `adb install -r app-arm64-v8a-debug.apk`. Debug builds load JS from
   Metro: run `npx react-native start` and `adb reverse tcp:8081 tcp:8081`,
   or use a build of the branch that includes the JS (`feature/watch-companion`).
4. Watch, ADB over Wi-Fi:
   - Settings → About watch → Software → tap *Software version* 5× (developer
     mode). Settings → Developer options → **ADB debugging** on, **Wireless
     debugging** on. Watch and computer on the same Wi-Fi.
   - Wireless debugging → *Pair new device*: `adb pair <ip>:<pair-port>`
     with the code shown, then `adb connect <ip>:<port>` (the port on the
     Wireless debugging screen, not the pairing one).
   - `adb -s <ip>:<port> install -r wear-debug.apk`.
5. Open SoarX on the watch, allow microphone and notifications. Join a channel
   on the phone. The watch shows the channel, riders and arrows within ~2 s.
6. Checks: talk from the watch (others hear it through the phone), speak from
   another phone (watch vibrates, then plays the clip), quick message, SOS
   and cancel, screen off for 10 min then a clip still arrives.
7. Logs: `adb logcat -s WatchBridge WearLink WatchListener WatchHub GarminLink`
   on the phone, `adb logcat -s DataLayerService PhoneLink ClipPlayer Talk` on
   the watch.

## Shipping the Wear OS app on Google Play

The watch app ships in **the same Play listing** as the phone app, as a
separate Wear OS AAB with the same package name and signing key.

1. Build: `cd android && ./gradlew :wear:bundleRelease` with the release
   keystore env vars set (same as the phone release). The tagged release
   workflow already builds every module (`bundleRelease` at the root), so it
   produces `android/wear/build/outputs/bundle/release/wear-release.aab` too,
   but it does **not** upload it yet: add that path to its artifact list (not
   done here on purpose — the release workflow is out of scope for this
   branch).
2. versionCode: the wear module uses its own range (`100001` and up in
   `android/wear/build.gradle`); bump it on every wear upload. It must never
   equal a phone versionCode.
3. Play Console → the app → **Test and release → Advanced settings → Form
   factors → + Add form factor → Wear OS**. Accept the Wear OS requirements;
   add at least 1 Wear OS screenshot (384×384 or larger, square) and, if you
   want, a Wear-specific description.
4. Play Console → **Testing → Internal testing** (or Closed) → pick the
   **Wear OS only** track from the track selector → Create release → upload
   `wear-release.aab` → roll out. Testers install it from the Play Store on
   the watch (or from the phone's Play Store "Apps on your watch").
5. Production: same, on the Wear OS production track. The first Wear OS
   release goes through a separate Wear review (UI on round screens,
   standalone flag): the app declares `standalone=false` because it needs the
   phone app.

## Garmin testing

1. Install Garmin Connect Mobile on the phone and pair the Garmin watch.
2. Install the Connect IQ app (app id `8ac2d628-66c4-40a4-96b0-10061a6d6519`)
   on the watch: sideload the `.prg` from the Connect IQ SDK, or install the
   beta from the Connect IQ store.
3. Start a session in SoarX Voice. `adb logcat -s GarminLink` shows
   `Connect IQ ready` then device status; the watch list in the app shows the
   Garmin with `installed` once Connect IQ has answered.
4. Without Garmin Connect the log says `Connect IQ unavailable:
   GCM_NOT_INSTALLED` and nothing else happens (no dialog).

## Limitations and risks

- **Not tested on a device.** CI proves it compiles, lints (wear release) and
  passes the unit tests (JSON ↔ Garmin conversion, throttle, geo/arrow maths,
  protocol parsing, channel-path codec). Everything involving Bluetooth,
  audio, sensors and Doze is unverified.
- **Speaker loudness**: watch speakers are weak and media volume may be low;
  `LOUDNESS_GAIN_MB` in `ClipPlayer.kt` (+6 dB) is a guess to tune on the
  water. Some Wear OS watches have no speaker; clips then play nowhere.
- **Doze**: the foreground service + Ongoing Activity should keep the watch
  process alive, but message delivery latency with the screen off is
  untested. Without the service (after "Stop session") clips still arrive
  through `DataLayerService`, but playback may be cut by the system.
- **Microphone in background**: recording is started from the visible UI. The
  service claims the `microphone` type only once the permission is granted.
- **Galaxy Watch buttons** cannot be remapped by apps: Talk is on screen.
- **Garmin SDK**: initialisation, device events and message callbacks are
  untested on hardware; the SDK has a history of needing Garmin Connect open
  once after a reboot, and of `FAILURE_DURING_TRANSFER` on busy BLE links.
  Messages from the watch must be a Dictionary (or a JSON string).
- **Release build**: the root `bundleRelease assembleRelease` in the release
  workflow now also builds `:wear`. CI runs `:wear:assembleRelease` so a
  wear problem is caught here first.
