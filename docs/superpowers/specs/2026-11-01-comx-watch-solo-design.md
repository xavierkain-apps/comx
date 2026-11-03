# ComX watch solo mode

Date: 2026-11-01. Status: design approved by the owner in conversation, spec to
be reviewed. Builds on PR #4 (`watch-ride-reliability`): the self-healing
workout session, the session log and the *No phone* alert.

## Goal

An Apple Watch with its own cellular plan or Wi-Fi keeps working when its phone
stays on the beach: it shares its own GPS position, sees the group, and sends
and receives quick messages, SOS and voice memos.

Field test of 2026-11-01: a rider left the phone on the beach and stayed frozen
at the phone's position. The watch has no GPS updates and no network path of
its own today; everything goes through the phone.

## Decisions taken with the owner

- Voice memos are in the first version, not a later step.
- The relay runs on Cloudflare (Worker and Durable Objects), on the owner's
  existing account, with a token dedicated to ComX.
- The zone `frenchrdv.com` on that account is a client site in production and
  is not touched. The relay uses a `workers.dev` address.
- Agora stays between phones. The relay is added next to it.

## Out of scope

- Starting a session with no phone at all. A watch needs one phone join first.
- Wear OS and Garmin solo.
- Live voice from the watch.
- Real user accounts or authentication.
- Replacing Agora.

## Constraints

- Agora has no watchOS SDK.
- watchOS allows `URLSession` HTTP for every app but not WebSockets or other
  low-level networking outside audio streaming and CallKit (Apple TN3135).
  The watch therefore polls.
- Workers free plan: 100,000 requests a day for the whole account, and SQLite
  Durable Objects only. Past a limit, calls fail until 00:00 UTC, SOS included.
- The owner's watch has no eSIM: it must behave as it does today when it loses
  the phone and has no network.

## Architecture

```
phone ── Agora data stream ── phone          (unchanged)
  │                             │
  └── POST sync, every 5 s ─┐ ┌─┘
                            ▼ ▼
                 relay: Worker + Durable Object (one per channel)
                            ▲
       POST sync, every 10 s│
                  watch in solo mode
```

| Unit | Place | Does |
|---|---|---|
| Relay | `relay/` (TypeScript) | Keeps riders, events and clips of one channel, expires them |
| Relay client | `src/ride/relay.ts`, used by `RideContext` and `MemoContext` | Phone sync loop, clip upload and download |
| Rider merge | `src/ride/` (pure, tested) | Picks the position to show per rider, removes duplicate events |
| Watch relay client | `ios/SoarXVoiceWatch/` | Solo sync loop, outgoing queues, clip transfer |
| Watch solo mode | `AppModel` | Decides between phone and solo modes |
| Watch GPS | `ios/SoarXVoiceWatch/Sensors.swift` | `CLLocationManager` updates, in solo mode only |

## Relay API

Base: `https://comx-relay.<subdomain>.workers.dev`. Every call carries the
header `X-ComX-Key`, a key built into the apps. The repository is public, so
the key comes from a CI secret. It can still be extracted from an app, so it
only slows abuse down and is not authentication.

`channelKey` is the hex SHA-256 of `comx:` followed by the upper-case channel
name, so the relay never receives the name. Each channel key maps to one
Durable Object.

### `POST /v1/channels/{channelKey}/sync`

```json
{
  "uid": 12345,
  "name": "Xavier",
  "source": "watch",
  "pos": {"lat": 36.01, "lon": -5.6, "cog": 120, "sog": 8.2, "acc": 5, "t": 1793560000000},
  "sos": false,
  "cursor": 41,
  "events": [{"id": "9f2c", "type": "text", "msg": "ok", "text": "All good"}]
}
```

```json
{
  "now": 1793560000500,
  "riders": [{"uid": 777, "name": "Tom", "source": "phone", "pos": {}, "sos": false, "seenAt": 1793559998000}],
  "events": [{"seq": 42, "id": "a1b7", "uid": 777, "from": "Tom", "type": "clip", "clip": "a1b7", "durationMs": 3100, "to": 0}],
  "cursor": 42,
  "acked": ["9f2c"]
}
```

- `source` is `phone` or `watch`. A rider has one row per `uid` and `source`.
- `pos` may be null, for instance before the first GPS fix.
- A first sync sends `cursor: 0` and only gets events from the last 2 minutes.
- `events` returned exclude the caller's own, and private events for others.
- Events are not returned to a client with the sender's uid: a phone and its
  watch are one rider.
- `type` is `text`, `clip` or `sos`. `to` is `0` for the group, otherwise a uid.
- A resent event id is acknowledged and not stored twice.
- Riders not seen for 2 minutes are not returned.
- `sos` in the body keeps the rider's SOS state. A `sos` event is added when the
  state changes, so a rider who syncs later sees an active SOS from `riders`.

### Clips

- `POST /v1/channels/{channelKey}/clips`, JSON body
  `{"id", "uid", "from", "to", "durationMs", "ext", "data"}`, `data` being the
  audio in base64, 350,000 characters at most. Stored in SQLite.
- `GET /v1/channels/{channelKey}/clips/{id}` returns the same fields.

The upload adds the `clip` event, so the sender does not send one in `sync`.

### Limits and expiry

- Events are kept 15 minutes, 200 per channel at most.
- Clips are kept 15 minutes.
- A Durable Object alarm deletes the whole channel 1 hour after its last sync.
- `429` for a second sync from the same `uid` and `source` within 1 s, or a
  second clip within 3 s.
- Unknown key: `401`. Body too large: `413`. Clients treat every failure the
  same way: retry at the next sync.

## Identity and merging riders

The watch uses its phone's Agora uid. The phone sends `relay`, `uid` and `name`
in the watch state, and the watch stores them.

Riders shown on a phone are the Agora riders plus the relay riders, merged by
uid. On every client:

1. A `watch` position whose fix is under 30 s old wins over a `phone` position
   of the same uid. This fixes the phone left on the beach.
2. Otherwise the most recent fix wins.
3. `sos` is true if either row is true.

A rider who is only on the relay leaves the list when the relay stops returning
them. The phone also applies the first rule to its own uid, so the rider's own
phone does not show a position that the group no longer uses.

Agora and the relay can both deliver the same event. Quick messages sent by a
phone go out on both, so `text` stream messages gain a message id (SOS repeats
are already ignored), and clients ignore an id they have already seen (last 200 ids). The
existing `id` of a `text` message is the quick message id, so the new field is
`mid`.

Voice memos from a phone stay on Agora and are only uploaded to the relay when
a `watch` rider seen in the last 30 s is on the relay, to save quota. A phone
ignores a relay `clip` event for a clip id it already got over Agora.

## Watch modes

| Mode | When | Position and messages go through |
|---|---|---|
| Phone | Phone state received in the last 15 s | The phone, as today, no watch GPS |
| Solo | No phone state for 15 s, and the watch has relay settings from a channel | The relay, watch GPS on |

- Back to phone mode after 5 s of phone state. Outgoing queues are handed to the
  phone, except clips already uploaded.
- *End session* or leaving the channel clears the stored relay settings.
- The watch does not check for a network first: it starts syncing and reports
  what happens.

### Status shown

| State | Status row | Alert |
|---|---|---|
| Solo, last sync under 30 s old | `SOLO` in teal | None |
| Solo, no sync for 30 s | `NO NETWORK` in red | Failure haptic and *No network: your position is no longer shared* |
| Solo, relay settings missing | `NO PHONE` in red | The PR #4 alert |

### Sync

Every 10 s in solo mode, one request at a time, with an 8 s timeout. After a
failure the next try comes at the next tick. Each mode change, failed period
and recovery goes in the session log, and the battery level every 15 minutes.
That gives the numbers to tune the 10 s after a field test.

### Outgoing queues

- Texts: 20 at most, in memory, resent until `acked`.
- SOS: the state is in every sync, so it cannot be lost. *SOS sent* only shows
  once a sync succeeded. After 15 s without one: failure haptic and *SOS not
  transmitted*, and it keeps retrying.
- Clips: 5 files at most, oldest dropped. The success haptic plays when the
  upload is accepted, not when the recording stops.

### Incoming

Clip events are downloaded with `URLSession` and go to the existing player and
History. Text and SOS events go through the code that handles phone events.

## Phone

The relay loop runs while in a real channel, not in demo mode, every 5 s. It
needs no new permission and runs in the background with the rest of the app,
because GPS keeps the app alive. Relay failures are logged and change nothing
for Agora users. Android gets all of this from the shared code.

`COMX_RELAY_URL` and `COMX_RELAY_KEY` come from `.env` and CI secrets, like the
Agora App ID. Without them the relay is off and the app behaves as today.

## Watch permissions

`WKBackgroundModes` gains `location`, and the location usage text is updated:
the watch now shares its position in solo mode. The App Store privacy details
must mention that position and voice go through a server.

## Deployment

- The owner creates a token with *Account > Workers Scripts > Edit*, and adds
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `COMX_RELAY_KEY` to the
  repository secrets. The token of the client sites is not reused.
- `.github/workflows/relay-deploy.yml` deploys on pushes to `main` touching
  `relay/**`, and `relay` tests run on pull requests.
- The account's `workers.dev` subdomain may need choosing once in the dashboard.

## Quota

Three phones at 5 s and three solo watches at 10 s make about 3,200 requests an
hour, which is about 30 session hours a day on the free plan. Client sites on
the same account share that quota if they ever use Workers. The Workers paid
plan is required before ComX opens to the public, so that SOS never depends on
the free daily limit.

## Privacy

The relay stores positions, names and voice for the times above. It has the
channel hash, not the channel name. A short channel name can be guessed, and
anyone who knows it can join, as with Agora today.

## Testing

- Relay: Vitest with the Cloudflare Workers pool, covering sync, cursors,
  duplicate ids, private events, clips, limits and expiry.
- Merge and duplicate removal: Jest tests in `src/ride/`.
- Simulators with `wrangler dev`: stop the phone app, check that the watch goes
  solo, that the phone in a second simulator or the Android emulator sees it
  move, and that a text, a clip each way and a demo SOS with its cancellation
  all arrive. `simctl location` moves the watch.
- Real test, on the water: a rider with an eSIM, phone left on the beach, and a
  second rider with a phone. Check range from the shore, delay, and battery over
  two hours. No simulator covers these. Never send a real SOS: a test SOS is
  cancelled at once and the group is told beforehand.

## Done when

- With the phone left behind, the group sees the solo rider move within 20 s.
- The solo rider sees the group, and text and voice go both ways.
- A demo SOS from a solo watch reaches the group, and cancelling it clears it.
- The watch never shows a message or SOS as sent without the relay's answer.
- A watch with no eSIM that loses its phone shows `NO NETWORK` and recovers when
  the phone is back.
- With no relay settings at build time, the app works as it does today.
- Battery use over two hours is measured and written down in `docs/watch-ios.md`.

## Risks

- **Battery**: GPS plus the cellular radio waking every 10 s may be heavy. The
  interval is the first thing to change after the field test.
- **Coverage at sea**: 4G may fade far from shore. The app says so; it cannot
  fix it.
- **Durable Objects on this account**: the docs say the free plan has SQLite
  Durable Objects, but nothing has been deployed on this account yet. The first
  implementation step deploys a minimal relay to prove it.
