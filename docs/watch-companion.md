# Watch companion — design and protocol

Goal: ride with **only a watch** (Apple Watch, Wear OS / Galaxy Watch, Garmin)
and the phone sealed in a waterproof pouch. No Bluetooth headset.

- See every rider of the channel with a **distance and an arrow**.
- **Talk** from the watch (push a button, speak, release) and **hear** the
  others on the watch speaker.
- Send **quick messages** and an **SOS** from the watch.

## Architecture

The phone stays the hub. It is the only device in the Agora channel; watches
talk to the phone over the platform link (WatchConnectivity, Wearable Data
Layer, Garmin Connect IQ).

```
 watch ──(platform link)── phone in pouch ──(Agora RTC + data stream)── other phones ── their watches
```

Voice from a watch is **walkie-talkie style**, not a live call:

1. The rider presses the talk button, speaks, presses again (or releases).
2. The watch records an AAC clip (mono, 16 kHz, ≤ 30 s) and sends the file
   to the phone.
3. The phone sends it as a **voice memo** over the Agora data stream (`vc`
   messages, below) to the group or to one rider. Every receiving phone plays
   it (unless it is in watch mode), forwards it to its watch and keeps it in
   its history. Since protocol version 2 it is no longer mixed into the live
   audio.

Hearing on a watch:

1. When a remote rider starts speaking (Agora volume indication), the phone
   tells the watch `speaking` (haptic cue) and starts recording the remote
   audio (`startAudioRecording`, playback only).
2. After 1.2 s of silence (or 30 s max) it stops and sends the clip file to the
   watch, which plays it on its speaker.

Why clips and not a live stream: watchOS gives third-party apps no supported
way to stream full-duplex audio to the phone in real time, Agora has no
watchOS SDK, and Garmin apps have no microphone access. Clips work the same
on every platform and survive a flaky link.

In **watch mode** the phone mic is silenced (`adjustRecordingSignalVolume(0)`)
because it sits in a pouch.

### Garmin

Connect IQ exposes no microphone and no arbitrary audio playback. Garmin
watches get everything **except voice**: rider list with distance and arrow,
quick messages, SOS, and a vibration when someone talks.

With a Garmin connected (and no headphones) the phone switches to **talk via
phone**: its mic stays off, so the group does not hear wind in the pouch, and
opens only while the watch sends `ptt` `active: true`. The voice is muffled by
the pouch — it is a fallback, not the main use.

## Demo mode

Settings → Demo → *Demo riders* (`src/ride/demo.ts`, stored under
`@comx_demo`). For testing alone with one phone and one watch:

- Three virtual riders (uids 990001–990003) circle around where the phone was
  when the demo started, at 150 m, 450 m and 900 m.
- No channel is needed: the watch receives `connected: true`, channel `Demo`.
- They send a quick message every 45–90 s, answer ours after 3 s and answer an
  SOS after 4 s. Settings can raise an SOS from Tom.
- A voice clip from the watch comes back from a virtual rider 2 s later (a
  private clip from its recipient), with `speaking` events around it. In a
  real channel only clips addressed to a virtual rider are echoed.

## Phone ↔ phone (Agora data stream)

JSON, UTF-8 (see `src/utils/encoding.ts`), each message < 1 KB.

| `type` | Fields | When |
| --- | --- | --- |
| `name` | `name`, `v` (protocol version, 2) | On join and when someone joins. No `v` or `v < 2`: the rider runs an older ComX (banner) |
| `pos` | `lat`, `lon`, `cog` (deg true or `null`), `sog` (m/s or `null`), `acc` (m), `t` (epoch ms) | Every 3 s while in a channel |
| `text` | `id` (quick message id or `custom`), `text` | Quick message sent |
| `sos` | `active` (bool), `lat`, `lon` | SOS raised or cancelled |

## Phone ↔ watch

All payloads are JSON strings. Version field `v` (currently 2; watches ignore it).

### Phone → watch: state (latest wins)

Sent every 2 s while connected and on any change. Watches keep only the last one.

```json
{
  "v": 1,
  "kind": "state",
  "connected": true,
  "channel": "TARIFA-01",
  "watchMode": true,
  "me": {"name": "Xav", "lat": 36.01, "lon": -5.60, "cog": 270.0, "sog": 8.2, "t": 1760000000000},
  "riders": [
    {"uid": 12345, "name": "Carlos", "lat": 36.02, "lon": -5.61, "t": 1760000000000,
     "dist": 340, "brg": 45.0, "speaking": false, "sos": false, "stale": false}
  ],
  "ts": 1760000000000
}
```

- `dist`: metres from `me`, `brg`: initial bearing from `me`, degrees true
  (0 = north, clockwise). Both `null` when a position is missing.
- `stale`: no position for more than 30 s.
- The watch draws the arrow at `brg - heading`, where `heading` is the
  watch compass if it has one, else `me.cog` (direction of travel), else north-up.

### Phone → watch: events

```json
{"v": 1, "kind": "event", "type": "speaking", "uid": 12345, "from": "Carlos", "active": true}
{"v": 1, "kind": "event", "type": "text", "uid": 12345, "from": "Carlos", "id": "back", "text": "Heading back"}
{"v": 1, "kind": "event", "type": "sos", "uid": 12345, "from": "Carlos", "active": true, "dist": 800, "brg": 120.0}
```

### Phone → watch: voice clip (file)

A file plus metadata `{"v": 1, "kind": "clip", "uid": 12345, "from": "Carlos", "durationMs": 4200}`.
AAC in an `.aac` (ADTS) or `.m4a` container — players must accept both.

### Watch → phone

```json
{"v": 1, "kind": "text", "id": "help", "text": "I need help"}
{"v": 1, "kind": "sos", "active": true}
{"v": 1, "kind": "ptt", "active": true}
{"v": 1, "kind": "hello", "platform": "watchos", "model": "Watch7,5", "hasCompass": true}
```

`ptt` asks the phone to open its own mic (Garmin fallback); `active: false`
closes it again.

`speaking` events are debounced on the phone: `active: true` once when a rider
starts, `active: false` after 1.5 s of silence. A voice clip is
a file `.m4a` (AAC, mono, 16 kHz) with metadata `{"v": 1, "kind": "clip", "durationMs": 3100}`.

### Quick messages

Ids are fixed so every watch can label them in its own language.

| id | English text |
| --- | --- |
| `ok` | All good |
| `back` | Heading back |
| `wait` | Wait for me |
| `where` | Where are you? |
| `gear` | Gear broken |
| `help` | I need help |

## Native bridge contract (React Native ↔ native)

One native module named **`WatchBridge`** on both iOS and Android. It hides
which watch platforms are present.

Methods:

| Method | Purpose |
| --- | --- |
| `start()` | Activate the links (WCSession, Data Layer, Connect IQ) |
| `sendState(json: string)` | Latest-wins state to every watch |
| `sendEvent(json: string)` | Event to every watch |
| `sendClip(path: string, metaJson: string)` | Audio file to watches that can play it |
| `getStatus(): Promise<WatchStatus[]>` | `{platform, name, paired, installed, reachable}` per watch |
| `getClipDir(): Promise<string>` | Absolute writable directory (no `file://`) where the phone records remote speech (`rx-<ts>.aac`) before `sendClip`. The bridge may delete a clip once it is delivered |

Events (`NativeEventEmitter(NativeModules.WatchBridge)`):

| Event | Payload |
| --- | --- |
| `WatchMessage` | `{platform, json}` — any watch → phone JSON message |
| `WatchClip` | `{platform, path, durationMs}` — clip saved to a local file on the phone |
| `WatchStatus` | `{watches: WatchStatus[]}` — pairing / reachability changed |

`platform` is `watchos`, `wearos` or `garmin`.

## Phone permissions

The phone shares its own GPS position (`@react-native-community/geolocation`),
so it needs location permission "while in use", with background updates
(iOS `UIBackgroundModes: location`, Android foreground service type
`location`). The phone compass is never used: in a pouch it is meaningless.
Phone users see north-up arrows; watches rotate them with their own heading.

## Platform identifiers

| Platform | Identifier |
| --- | --- |
| iOS app | `com.xavier.soarxvoice` |
| watchOS app | `com.xavier.soarxvoice.watchkitapp` (companion of the iOS app) |
| Android phone app | `com.soarxvoice` |
| Wear OS app | `com.soarxvoice` — the Data Layer only pairs apps with the **same package name and signing key** |
| Garmin Connect IQ app id | `8ac2d628-66c4-40a4-96b0-10061a6d6519` |

### Garmin transport details

Monkey C has no JSON parser. On the Garmin link the bridge converts every JSON
payload above to a native dictionary/array before sending, and converts
dictionaries coming from the watch back to JSON before emitting
`WatchMessage`. State is throttled to one message every 5 s on Garmin (BLE
bandwidth), events are sent immediately, clips are never sent.

## ComX additions (branch `comx`)

ComX is the standalone app built from this code: a **friend compass** first
(every rider's distance and direction, no interaction needed), voice messages
second. Everything must be usable **without the touchscreen** (wet screen,
water lock).

### Voice memos (protocol version 2)

A memo goes to the whole group or to **one rider**. It is recorded on the
watch (clip metadata `to`) or on the phone (MEMO button: tap to record, the
live microphone is muted meanwhile, tap again to send to the group, or tap a
rider row to send to that rider only; 30 s at most).

```json
{"v": 2, "kind": "clip", "durationMs": 3100, "to": 12345}
```

`to` absent, `null` or `0` = group. The phone sends the file over the Agora
data stream, sliced (`src/ride/voiceClips.ts`); `to: 0` addresses every rider
(Agora never assigns uid 0), any other value one rider. Receiving phones play
it (not in watch mode), forward it to their watch (`sendClip` with
`"private": true` for a private memo) and keep it in the MSG history (30 items,
10 memos, for the app's run). Phone memos are recorded with Agora's own file
recorder (`startAudioRecording`, `AudioFileRecordingMic`) while the live
stream is muted.

Phone ↔ phone, chunked over the data stream (each message < 1 KB):

| `type` | Fields |
| --- | --- |
| `vc` | `id` (clip id), `to` (uid, or `0` for the group), `seq` (0-based), `n` (chunk count), `d` (base64 slice, ≤ 600 chars), `ms` (duration, on chunk 0), `ext` (`m4a` / `aac`, on chunk 0) |

Slices go out every 150 ms: about 7 s for 10 s of voice at 16 kbit/s.

**Older riders** (protocol version 1) ignore `to: 0` slices, so they do not
get group memos; their own watch group clips are still mixed into the live
audio, which new phones hear. The `name` message now carries `v`; a rider
whose `name` has no `v` or `v < 2` gets an amber "<name> uses an older ComX"
banner on the live screen, once per rider per session. Every rider should run
the same ComX.

**Follow-up (transfer time).** A 30 s memo takes about 20 s to send: 600
base64 characters every 150 ms is 4 KB/s. Agora's data stream allows about
30 packets/s and 6 KB/s, so there is about 40 % headroom (for example 800
characters per slice, as long as each JSON message stays under 1 KB). The real
lever is the AAC bitrate of the clips (watch and phone recorders): halving it
halves the transfer time.

### New bridge methods

| Method | Purpose |
| --- | --- |
| `readClipBase64(path): Promise<string>` | Read a clip file as base64 (to send it as a memo) |
| `writeClip(base64, ext): Promise<string>` | Write a received clip to `getClipDir()` and return its absolute path |
| `selectGarminDevices(): Promise<void>` | iOS only: open Garmin Connect so the user picks the Garmin watches ComX may talk to (Connect IQ iOS SDK device selection). Resolves immediately on Android, where devices are discovered automatically |

Both exist on iOS and Android.

### Compass focus

Watches show one rider big at a time, chosen without touching:
the rider in **SOS** first, else the one the user last selected, else the
**nearest**. Buttons (or whatever input works in water) move the focus to the
next / previous rider.
