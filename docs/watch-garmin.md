# Garmin watch app (Connect IQ)

The Garmin side of the watch companion. Protocol and architecture:
[watch-companion.md](watch-companion.md). Code: `garmin/`. CI:
`.github/workflows/watch-garmin-build.yml`.

App id `8ac2d628-66c4-40a4-96b0-10061a6d6519` (written without dashes in
`garmin/manifest.xml`, as Connect IQ requires). Type: watch-app. Minimum API
3.4.0. Permissions: Communications, Positioning, Sensor.

## What it does

**Rider list** (the main screen)
- One row per rider: arrow, name, distance (`340 m`, `1.2 km`).
- Arrow angle = `brg - heading`. Heading comes from, in order: the watch
  compass (`Sensor.Info.heading`), the watch's own GPS course if the system
  already has a moving fix (the app never switches GPS on), the phone's
  `me.cog`, otherwise north-up. The source is shown at the bottom
  (`compass`, `watch GPS`, `course`, `north-up`).
- Unknown bearing: an empty ring instead of an arrow.
- Talking rider: green dot and green name. SOS rider: red row, sorted first.
  Stale rider (`stale: true`): grey, sorted last; on monochrome screens a `~`
  prefix on the distance replaces the grey.
- Order: SOS first, then by distance, then stale/unknown. Capped at 16 riders
  (8 on watches with < 200 KB app memory).
- Header: channel name, or the link problem (`No phone link`,
  `Open SoarX on phone`, `Phone silent 25s`, `Phone not in channel`,
  `Last send failed`), or `MY SOS ON` on red.
- UP/DOWN move, START on a rider opens the **compass view**, START on the
  last row (`Menu`) or a long UP (MENU) opens the actions menu, BACK exits.
  Touch watches: swipe = UP/DOWN, tap = START.

**Compass view**: one rider, big arrow, a north mark on the rim when the
heading is known, distance in large type. UP/DOWN switch rider, START opens
the menu, BACK returns.

**Actions menu**
- *Talk via phone* toggle: sends `ptt` `active: true/false`; the phone opens
  its mic while it is on. Automatically switched off after 2 minutes, and when
  the app exits (best effort).
- *Quick message*: the six contract messages (`ok`, `back`, `wait`, `where`,
  `gear`, `help`) with their English labels.
- *SOS* / *Cancel my SOS*: always behind a confirmation. Sent with retries for
  about a minute.

**Incoming**
- `speaking` `active: true`: short vibration and the toast "Carlos talking"
  (at most one buzz per rider every 4 s); the flag clears on `active: false`
  or after 30 s.
- `text`: double vibration, backlight, full-screen message (label from the id
  when known, else `text`), closes itself after 30 s.
- `sos` `active: true`: strong vibration plus alarm tone every 4 s for up to
  2 minutes, backlight, a persistent red screen with the arrow and distance to
  the rider. START silences, a second START (or BACK) closes; the rider stays
  red in the list until the phone sends `sos` `active: false`.

**Outgoing on start**: `hello` with `platform: "garmin"`, `model` = the
device part number (e.g. `006-B3907-00`), `hasCompass`. Resent each time the
phone link comes back.

**Link**: `Communications.registerForPhoneAppMessages` for incoming,
`Communications.transmit` with a `ConnectionListener` for outgoing. One
message in flight at a time, failures retried every 2 s, a transmit whose
listener never answers is abandoned after 20 s. When delivery finally fails
the watch vibrates and shows "Not sent - phone unreachable".

## What is impossible on Garmin, and why

- **No voice.** Connect IQ gives apps no microphone access and no way to play
  arbitrary audio (only predefined tones). Hence "Talk via phone": the watch
  asks the phone to open its own mic.
- **No clips.** The phone never sends `clip` messages to Garmin; the watch
  ignores them anyway.
- **Messages only while the app is open.** A Connect IQ *watch-app* receives
  phone messages only while it runs in the foreground. If the rider leaves the
  app, alerts (including SOS) do not reach the watch through it. A background
  service or a glance could relay some of this; not implemented.
- **Magnetic vs true north.** The watch compass gives magnetic heading, the
  phone sends true bearings. The arrow is off by the local declination (about
  1° at Tarifa, up to 10-15° at high latitudes). Not corrected.
- **Bandwidth.** BLE to Garmin is slow; the phone throttles state to one
  message every 5 s, so distances and arrows update at that pace (the
  heading itself updates every second).

## Building

The Connect IQ SDK must **not** be run on the dev machine (memory). CI builds
every push to `feature/watch-garmin` and `feature/watch-companion` that touches
`garmin/`, and on demand (*Actions > Garmin watch build > Run workflow*; tick
*all_devices* to build every manifest product).

CI uses the public image `ghcr.io/matco/connectiq-tester` (pinned tag,
Connect IQ SDK 9.2.0 plus device files of 2026-08-31), because downloading
device files straight from Garmin requires a Garmin account login. Steps:
check that every manifest product exists in the image, compile each selected
device with strict type checking (`-l 3`), upload the `.prg` files (artifact
`soarx-garmin-prg`), then compile with `-t` and run the unit tests
(`garmin/source/Tests.mc`) in the simulator under Xvfb.

Each job signs with a throwaway key generated by openssl. That is fine for
sideloading. Store uploads need the owner's own developer key (see below).

Manual build on a machine with the SDK (VS Code + Monkey C extension, or):

```bash
openssl genrsa -out developer_key.pem 4096
openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in developer_key.pem -out developer_key.der
monkeyc -f garmin/monkey.jungle -d fenix7 -y developer_key.der -o soarx-fenix7.prg -w
```

Keys and build output are git-ignored (`garmin/.gitignore`). Never commit a
`.der`.

## Sideloading a build

1. Download the `soarx-garmin-prg` artifact from the CI run and unzip it.
2. Plug the watch in by USB. On macOS use Garmin's *Android File Transfer* or
   *OpenMTP*; on Linux, Windows or the Garmin Express file view it mounts as a
   drive.
3. Copy `soarx-<device>.prg` for **your exact model** into `GARMIN/APPS/`.
4. Unplug. The app appears in the activity / apps list as *SoarX Voice*.

Sideloaded apps cannot be updated by the store and are removed if the app is
later installed from the store.

## Testing with the phone

1. Pair the watch with Garmin Connect on the phone (required: the Connect IQ
   mobile SDK talks through Garmin Connect).
2. Install a phone build containing the Garmin `WatchBridge` (Android:
   `GarminLink.kt`; iOS: Connect IQ iOS SDK).
3. Open SoarX Voice on the phone and join a channel, then open the app on the
   watch. Expected: header turns from `Open SoarX on phone` to the channel
   name within 5 s, riders appear.
4. Check in order: quick message arrives on the other phones; SOS confirm,
   arrival, cancel; "Talk via phone" opens and closes the phone mic; an
   incoming quick message, a `speaking` buzz and an SOS from another rider.
5. Leave the app on the watch: `ptt` must close (the watch sends `ptt false`
   on exit; the phone should also time it out on its side).

Not covered by CI: anything involving the phone link, vibration, the compass,
the screen layout on real hardware. The simulator can feed phone messages
(*Simulation > Phone App Message* on a desktop with the SDK).

## Store publication

1. Create (or reuse) a Connect IQ developer account and a **permanent**
   developer key. Keep it safe: every future update must be signed with the
   same key.
2. Build the store package: `monkeyc -e -f garmin/monkey.jungle -y
   developer_key.der -o soarx.iq -w` (all manifest products).
3. Upload `soarx.iq` at <https://apps.garmin.com/developer/upload> with
   screenshots, description, privacy statement (positions are shown, not
   stored), and category.
4. The app id in the manifest must stay
   `8ac2d62866c440a496b010061a6d6519`: the phone apps address the watch by
   it.
5. Review usually takes a few days.

## Devices

Products in the manifest (all exist in SDK 9.2.0's device set, checked by CI):

| Family | Product ids |
| --- | --- |
| fenix 7 / 7 Pro | `fenix7`, `fenix7s`, `fenix7x`, `fenix7pro`, `fenix7pronowifi`, `fenix7spro`, `fenix7xpro`, `fenix7xpronowifi` |
| fenix 8 / E / 9 | `fenix843mm`, `fenix847mm`, `fenix8pro47mm`, `fenix8solar47mm`, `fenix8solar51mm`, `fenixe`, `fenix943mm`, `fenix947mm` |
| epix 2 / 2 Pro | `epix2`, `epix2pro42mm`, `epix2pro47mm`, `epix2pro51mm` |
| Enduro 3 | `enduro3` |
| Forerunner | `fr255`, `fr255m`, `fr255s`, `fr255sm`, `fr265`, `fr265s`, `fr570 42/47mm` (`fr57042mm`, `fr57047mm`), `fr955`, `fr965`, `fr970` |
| Instinct 2 / Crossover (monochrome) | `instinct2`, `instinct2s`, `instinct2x`, `instinctcrossover` |
| Instinct 3 | `instinct3solar45mm` (monochrome), `instinct3amoled45mm`, `instinct3amoled50mm` |
| Venu 3 / 4 | `venu3`, `venu3s`, `venu441mm`, `venu445mm` |

Built by default on every push (one per screen/input family): `fenix7`,
`fenix7pro`, `fenix847mm`, `epix2pro47mm`, `enduro3`, `fr255`, `fr265`,
`fr955`, `fr965`, `fr970`, `instinct2`, `instinct3solar45mm`,
`instinct3amoled45mm`, `venu3`.

Monochrome screens get the `(:mono)` code path and icon (see
`garmin/monkey.jungle`).
