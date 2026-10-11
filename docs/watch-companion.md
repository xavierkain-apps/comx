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
3. The phone plays the clip **into the channel** (`startAudioMixing`, not
   heard locally). Phone users hear it live; watch users get it as a clip.

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
because it sits in a pouch; the stream stays published so injected clips go
out.

### Garmin

Connect IQ exposes no microphone and no arbitrary audio playback. Garmin
watches get everything **except voice**: rider list with distance and arrow,
quick messages, SOS, and a vibration when someone talks.

With a Garmin connected (and no headphones) the phone switches to **talk via
phone**: its mic stays off, so the group does not hear wind in the pouch, and
opens only while the watch sends `ptt` `active: true`. The voice is muffled by
the pouch — it is a fallback, not the main use.

## Phone ↔ phone (Agora data stream)

JSON, UTF-8 (see `src/utils/encoding.ts`), each message < 1 KB.

| `type` | Fields | When |
| --- | --- | --- |
| `name` | `name` | Existing. On join and when someone joins |
| `pos` | `lat`, `lon`, `cog` (deg true or `null`), `sog` (m/s or `null`), `acc` (m), `t` (epoch ms) | Every 3 s while in a channel |
| `text` | `id` (quick message id or `custom`), `text` | Quick message sent |
| `sos` | `active` (bool), `lat`, `lon` | SOS raised or cancelled |

## Phone ↔ watch

All payloads are JSON strings. Version field `v: 1`.

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
