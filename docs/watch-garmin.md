# ComX Garmin watch app (Connect IQ)

The Garmin side of the watch companion. Protocol and architecture:
[watch-companion.md](watch-companion.md). Code: `garmin/`. CI:
`.github/workflows/watch-garmin-build.yml`.

App id `8ac2d628-66c4-40a4-96b0-10061a6d6519` (written without dashes in
`garmin/manifest.xml`, as Connect IQ requires), unchanged from SoarX Voice so the phone bridge
still reaches it. Type: watch-app. Displayed name: *ComX*. Minimum API
3.4.0. Permissions: Communications, Positioning, Sensor.

## What it does

ComX is a **friend compass** for kitesurfers: each rider's distance and
direction, quick messages and SOS. The phone rides in a waterproof pouch and
talks to the watch through Garmin Connect. In the water the touchscreen is
useless (wet screen, water lock), so the app is **100 % button-driven**: taps
are ignored on every screen, vertical swipes only browse (so 2-button
watches such as the Venu stay usable), horizontal swipes are swallowed.

### Button map (5-button watches: fenix, epix, Enduro, Forerunner, Instinct)

| Screen | UP / DOWN | START (short) | START held 1.5 s | BACK | MENU (hold UP) |
| --- | --- | --- | --- | --- | --- |
| Compass (start screen) | previous / next rider, short buzz | actions menu | SOS (or cancel my SOS), then confirmation | exit confirmation | actions menu |
| Actions menu | move | choose | - | close | - |
| Quick message | move | send, back to compass | - | back | - |
| All riders | move | focus compass on that rider | - | back | - |
| Confirmation (SOS, exit) | - | yes | - | no | - |
| Incoming message | - | close | - | close | - |
| Incoming SOS | - | silence, then close | - | silence and close | actions menu |

LIGHT and every other key are left to the system. An unanswered
confirmation closes itself after 15 s (= no). START acts on **release**, so
that holding it can mean SOS; the watch buzzes once at 1.5 s to say "let go,
the SOS confirmation is open". The SOS itself is only sent after a second
START on the red confirmation screen.

Two-button watches (Venu 3 / 4): top button = START, bottom = BACK, swipe
up/down = DOWN/UP. Holding the top button is taken by the system on Venu, so
SOS goes through *START > SOS* there.

**Compass** (the start screen): one rider, big. Name at the top, a large
arrow, the distance in large type, a north mark on the rim when the heading
is known. The focus follows the contract rule (watch-companion.md, *Compass
focus*): the rider in **SOS** first (the screen turns red), else the rider the
user **last selected** (UP/DOWN or *All riders*), else the **nearest**. A new
SOS takes the focus even from a selection; selecting someone after that SOS
started keeps the selection. Footer: `MY SOS ON`, else the link problem
(`No phone link`, `Open ComX on phone`, `Phone silent 25s`,
`Phone not in channel`, `Last send failed`), else a toast, else
`PHONE MIC ON`, else the heading source and the rider's place, e.g.
`compass  2/5`.

- Arrow angle = `brg - heading`. Heading comes from, in order: the watch
  compass (`Sensor.Info.heading`), the watch's own GPS course if the system
  already has a moving fix (the app never switches GPS on), the phone's
  `me.cog`, otherwise north-up.
- Unknown bearing: an empty ring instead of an arrow. Stale rider: grey,
  `(old)` after the distance.

**Actions menu** (in this order, SOS last so START, START never reaches it)
- *Quick message*: the six contract messages (`ok`, `back`, `wait`, `where`,
  `gear`, `help`) with their English labels.
- *Talk via phone* toggle: sends `ptt` `active: true/false`; the phone opens
  its mic while it is on. Automatically switched off after 2 minutes, and when
  the app exits (best effort).
- *All riders*: list sorted SOS first, then by distance, then stale/unknown
  (arrow, name, distance; talking rider green with a dot; SOS row red;
  monochrome screens prefix stale distances with `~`). Capped at 16 riders
  (8 on watches with < 200 KB app memory).
- *Heading cue* (off by default, remembered in `Application.Storage`): when
  the focused rider is farther than 300 m and the watch heading is within
  ±20° of them, a short double vibration, at most every 30 s. Needs a real
  heading (compass, GPS course or phone course), never in north-up mode.
- *SOS* / *Cancel my SOS*: behind the same button confirmation. Sent with
  retries for about a minute.

**Incoming**
- `speaking` `active: true`: short vibration and the toast "Carlos talking"
  (at most one buzz per rider every 4 s); the flag clears on `active: false`
  or after 30 s.
- `text`: double vibration, backlight, full-screen message (label from the id
  when known, else `text`), closes itself after 30 s.
- `sos` `active: true`: strong vibration plus alarm tone every 4 s for up to
  2 minutes, backlight, a persistent red screen with the arrow and distance to
  the rider. START silences, a second START (or BACK) closes; the compass
  then stays on that rider, red, until the phone sends `sos` `active: false`.

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
every push to `comx`, `comx-garmin`, `feature/watch-garmin` and
`feature/watch-companion` that touches
`garmin/`, and on demand (*Actions > Garmin watch build > Run workflow*; tick
*all_devices* to build every manifest product).

CI uses the public image `ghcr.io/matco/connectiq-tester` (pinned tag,
Connect IQ SDK 9.2.0 plus device files of 2026-08-31), because downloading
device files straight from Garmin requires a Garmin account login. Steps:
check that every manifest product exists in the image, compile each selected
device with strict type checking (`-l 3`), upload the `.prg` files (artifact
`comx-garmin-prg`), then compile with `-t` and run the unit tests
(`garmin/source/Tests.mc`) in the simulator under Xvfb.

Each job signs with a throwaway key generated by openssl. That is fine for
sideloading. Store uploads need the owner's own developer key (see below).

Manual build on a machine with the SDK (VS Code + Monkey C extension, or):

```bash
openssl genrsa -out developer_key.pem 4096
openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in developer_key.pem -out developer_key.der
monkeyc -f garmin/monkey.jungle -d fenix7 -y developer_key.der -o comx-fenix7.prg -w
```

Keys and build output are git-ignored (`garmin/.gitignore`). Never commit a
`.der`.

## Sideloading a build (fenix 7 from a Mac)

1. Download the `comx-garmin-prg` artifact from the CI run (*Actions >
   Garmin watch build > the run > Artifacts*) and unzip it.
2. macOS does not mount Garmin watches (they use MTP). Install
   [OpenMTP](https://openmtp.ganeshrvel.com) (free); quit Garmin Express
   first, it grabs the USB connection.
3. Plug the fenix 7 in by USB, open OpenMTP, allow access on the watch if
   asked. Open `Internal Storage > GARMIN > APPS` on the device side.
4. Drag `comx-fenix7.prg` into `GARMIN/APPS`. Use the file for **your exact
   model** (`fenix7` for a fenix 7, `fenix7pro` for a 7 Pro, `fenix7x`...).
5. Unplug. The watch installs it within a few seconds; it appears in the
   apps list (START from the watch face, then *Apps*) as *ComX*.
6. To remove it, delete the `.prg` from `GARMIN/APPS` the same way.

On Linux or Windows the watch mounts as a drive (or MTP device): same
`GARMIN/APPS` folder. Sideloaded apps cannot be updated by the store and are
removed if the app is later installed from the store.

## Running it in the simulator on a Mac

1. Install the **Connect IQ SDK Manager** from
   <https://developer.garmin.com/connect-iq/sdk/>, sign in with a Garmin
   account, download the latest SDK and the device files for at least
   `fenix 7` (and any other model you want to try).
2. Install **VS Code** and the **Monkey C** extension (by Garmin). Run
   *Monkey C: Verify Installation*, then *Monkey C: Generate a Developer Key*
   (keep it outside the repo; `*.der` is git-ignored anyway).
3. Open the repository, then *Run > Run Without Debugging* with
   `garmin/monkey.jungle` and pick `fenix7`. The simulator opens with the
   watch. Buttons: click the bezel buttons, or use the keyboard shortcuts
   listed in the simulator's *Settings* menu. Hold START by holding the
   mouse button on it.
4. Phone link: *Settings > Connection Type* / *Phone connected* toggles the
   link. To feed phone messages, use *Simulation > Phone App Message*
   (older SDKs: *Simulation > Send Phone App Message*); paste a dictionary
   matching docs/watch-companion.md, e.g. a `state` with two riders, then an
   `event` `sos`. Messages the watch transmits show up in the simulator log.
5. Unit tests: build with *Monkey C: Run Tests* (or
   `monkeyc ... -t` then `monkeydo bin/test.prg fenix7 -t`).
6. Heading: *Simulation > Set Sensor Data* (compass heading) or a FIT file
   playback for a moving GPS course.

## Testing with the phone

1. Pair the watch with Garmin Connect on the phone (required: the Connect IQ
   mobile SDK talks through Garmin Connect).
2. Install a phone build containing the Garmin `WatchBridge` (Android:
   `GarminLink.kt`). **With an iPhone** the phone side needs the Garmin link
   in the ComX iOS app, which is being added in parallel (Connect IQ iOS SDK,
   plus `selectGarminDevices()` to choose the watch in Garmin Connect):
   until it ships, the watch will show `Open ComX on phone` forever.
3. Open ComX on the phone and join a channel, then open the app on the
   watch. Expected: within 5 s the compass footer stops showing
   `Open ComX on phone` and the nearest rider appears.
4. Check in order, buttons only: UP/DOWN cycle riders with a buzz; quick
   message arrives on the other phones; hold START, confirm, SOS arrives,
   hold START again to cancel; BACK asks before exiting; "Talk via phone"
   opens and closes the phone mic; the heading cue buzzes when facing a
   rider over 300 m away; an incoming quick message, a `speaking` buzz and an SOS from another rider.
5. Leave the app on the watch: `ptt` must close (the watch sends `ptt false`
   on exit; the phone should also time it out on its side).

Not covered by CI: anything involving the phone link, vibration, the compass,
the screen layout on real hardware. See the simulator section above.

## Store publication

1. Create (or reuse) a Connect IQ developer account and a **permanent**
   developer key. Keep it safe: every future update must be signed with the
   same key.
2. Build the store package: `monkeyc -e -f garmin/monkey.jungle -y
   developer_key.der -o comx.iq -w` (all manifest products).
3. Upload `comx.iq` at <https://apps.garmin.com/developer/upload> with
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
