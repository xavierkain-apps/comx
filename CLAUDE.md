# ComX

A friend compass for kitesurfers and wingfoilers (like Surfr's Friend
Compass): every rider in the group with a distance and an arrow, quick
messages, SOS, and voice messages from the watch. The phone stays in a
waterproof pouch; everything on the watch must work **without the
touchscreen** (wet screen, water lock).

## Relationship to SoarX Voice

ComX is built from the SoarX Voice code (React Native + Agora) but is a
**separate app**. The owner does not want SoarX Voice touched.

- Same GitHub repo, `xavierkain-apps/soarx-voice`, branch **`comx`** (this
  checkout; remote name `org`). Never push to `master`, never run the
  `iOS — TestFlight` or `Android — Release` workflows from here.
- Separate identifiers: iOS `com.xavier.comx`, watch
  `com.xavier.comx.watchkitapp` (both App IDs exist, HealthKit enabled on the
  watch one). Android still uses `com.soarxvoice` — rename before any
  Android release. Garmin app id `8ac2d628-66c4-40a4-96b0-10061a6d6519`.
- It stays in the SoarX repo because GitHub secrets (App Store Connect key,
  match passphrase) cannot be copied: a separate repo means re-supplying them
  from the original sources.
- Xcode target names are still `SoarXVoice` / `SoarXVoiceWatch` (internal only).

## Where things are

| Path | What |
| --- | --- |
| `docs/watch-companion.md` | Architecture and the phone ↔ watch protocol. Read first |
| `docs/watch-ios.md`, `docs/watch-android.md`, `docs/watch-garmin.md` | Per-platform details, input mapping, test steps |
| `src/contexts/RideContext.tsx` | Positions, quick messages, SOS over the Agora data stream |
| `src/contexts/WatchContext.tsx` | Relay to watches: voice clips in/out, mic policy, private voice messages |
| `src/ride/` | Pure, tested logic (protocol, mic policy, voice clip chunking) |
| `ios/SoarXVoiceWatch/` | Apple Watch app (SwiftUI, watchOS 10+) |
| `ios/WatchBridge.swift`, `ios/GarminLink.m` | iOS bridge: WatchConnectivity + Garmin Connect IQ iOS SDK |
| `android/wear/`, `android/app/.../watch/` | Wear OS app and Android bridge (Wear Data Layer + Garmin) |
| `garmin/` | Connect IQ app (button-only) |
| `scripts/add-watch-target.rb` | The only way to change the watch target in the Xcode project (xcodeproj gem). Never sed the pbxproj |

## Building — read before running anything heavy

This Linux machine has ~7 GB RAM shared with other services; local Gradle
builds OOM-restarted it three times. **Never run Gradle, monkeyc or Xcode-like
builds locally.** Everything compiles on GitHub Actions:

| Workflow | Builds | Trigger |
| --- | --- | --- |
| `watch-ios-build.yml` | iOS app + watch app, simulator, unsigned | push on `comx` |
| `watch-garmin-build.yml` | Connect IQ `.prg` for 14 devices (artifact `comx-garmin-prg`) | push on `comx` touching `garmin/**` |
| `watch-android-build.yml` | Phone + Wear OS debug APKs | push on `feature/watch-android`, `feature/watch-companion` (add `comx` when needed) |
| `comx-testflight.yml` | Signed ComX build to TestFlight | tag `comx-v*` |

Local checks that are cheap: `npx tsc --noEmit`, `npx eslint src --quiet`,
`npx jest --maxWorkers=1` (50 tests).

## Status (2026-10-17)

- All CI builds green. First TestFlight build sent: **0.1 (1)**, tag
  `comx-v0.1.0`, distributed to internal testers. **Not yet tested on a real
  device.**
- App Store Connect record exists (`com.xavier.comx`, name "ComX Rider").
  Internal TestFlight group "Team" (all builds) with the owner in it.
- Demo mode (Settings → Demo) gives virtual riders for testing alone; see
  `docs/watch-companion.md`.
- Next release: bump the tag (`git tag comx-v0.1.1 && git push org comx-v0.1.1`);
  the build number is read from TestFlight and incremented.
- Signing uses the shared match store (`xavierkain-apps/apple-certs`); see the
  owner's global notes on certificates before touching signing.

## Decisions taken with the owner

- Garmin Connect IQ iOS SDK licence accepted (2026-10-17): the iOS build
  keeps the Garmin link.
- Phone in a pouch first; a watch working alone (cellular, needs a server)
  comes later.
- Voice = voice messages (to the group, or private to one rider), not live
  calls. Live calls from Apple Watch would need CallKit VoIP + a custom audio
  transport + a relay server.
- Garmin has no voice: Connect IQ gives no microphone access (and the owner's
  fenix 7 has no mic or speaker). Garmin gets compass, quick messages, SOS and
  "talk via phone".
- Apple Watch inputs: crown = change rider (and pick the recipient while
  recording), double tap = talk/send (watchOS 11+), Action button = talk
  (Ultra). Unverified in water — the watch app has an **Input test** page;
  the owner is to test with water lock on and off, and the mapping should be
  adjusted to what really works.

## Commits

No `Co-Authored-By` or any AI attribution trailer.
